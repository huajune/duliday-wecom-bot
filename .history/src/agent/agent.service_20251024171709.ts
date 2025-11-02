import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosInstance, AxiosResponse } from 'axios';
import { ApiResponse, ChatRequest, ChatResponse, SimpleMessage } from './dto/chat-request.dto';
import { HttpClientFactory } from '@core/http';
import {
  AgentApiException,
  AgentConfigException,
  AgentContextMissingException,
  AgentRateLimitException,
} from './exceptions/agent.exception';
import { parseToolsFromEnv, getModelDisplayName } from './utils';
import { AgentCacheService } from './agent-cache.service';
import { AgentRegistryService } from './agent-registry.service';

/**
 * Agent 服务（重构版）
 * 负责调用 Agent API 的 HTTP 接口，简化为纯 API 调用层
 *
 * 职责：
 * 1. HTTP 客户端管理
 * 2. API 调用封装（chat, getModels, getTools 等）
 * 3. 请求重试和错误处理
 * 4. Token 使用统计
 *
 * 不再负责：
 * - 模型/工具验证（委托给 AgentRegistryService）
 * - 响应缓存（委托给 AgentCacheService）
 * - 健康检查缓存（委托给 AgentConfigService）
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly httpClient: AxiosInstance;
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly defaultModel: string;
  private readonly timeout: number;
  private readonly maxRetries: number = 3;

  // 从环境变量读取的配置
  private readonly configuredTools: string[];

  constructor(
    private readonly configService: ConfigService,
    private readonly httpClientFactory: HttpClientFactory,
    private readonly cacheService: AgentCacheService,
    private readonly registryService: AgentRegistryService,
  ) {
    // 从环境变量读取配置（已在启动时验证，这里可以安全使用）
    this.apiKey = this.configService.get<string>('AGENT_API_KEY')!;
    this.baseURL = this.configService.get<string>('AGENT_API_BASE_URL')!;
    this.defaultModel = this.configService.get<string>('AGENT_DEFAULT_MODEL')!;
    this.timeout = this.configService.get<number>('AGENT_API_TIMEOUT')!;

    // 解析配置的工具列表
    const toolsString = this.configService.get<string>('AGENT_ALLOWED_TOOLS', '');
    this.configuredTools = parseToolsFromEnv(toolsString);

    this.logger.log(`初始化 Agent API 客户端: ${this.baseURL}`);
    this.logger.log(`默认模型: ${this.defaultModel}`);
    this.logger.log(
      `配置的工具: ${this.configuredTools.length > 0 ? this.configuredTools.join(', ') : '无'}`,
    );
    this.logger.log(`API 超时设置: ${this.timeout}ms`);

    // 使用工厂创建 HTTP 客户端实例
    this.httpClient = this.httpClientFactory.createWithBearerAuth(
      {
        baseURL: this.baseURL,
        timeout: this.timeout,
        logPrefix: '[Agent API]',
        verbose: false,
      },
      this.apiKey,
    );
  }

  /**
   * 调用 /api/v1/chat 接口（非流式）
   * 支持完整的 API 契约参数
   */
  async chat(params: {
    conversationId: string;
    userMessage: string;
    historyMessages?: SimpleMessage[];
    model?: string;
    systemPrompt?: string;
    promptType?: string;
    allowedTools?: string[];
    context?: any;
    toolContext?: any;
    contextStrategy?: 'error' | 'skip' | 'report';
    prune?: boolean;
    pruneOptions?: {
      maxOutputTokens?: number;
      targetTokens?: number;
      preserveRecentMessages?: number;
    };
    validateOnly?: boolean;
  }): Promise<ChatResponse> {
    const {
      conversationId,
      userMessage,
      historyMessages = [],
      model: requestedModel,
      systemPrompt,
      promptType,
      allowedTools,
      context,
      toolContext,
      contextStrategy,
      prune,
      pruneOptions,
      validateOnly,
    } = params;

    try {
      // 1. 验证用户消息不为空
      if (!userMessage || userMessage.trim() === '') {
        throw new AgentConfigException('用户消息内容不能为空');
      }

      // 2. 模型验证（委托给 RegistryService）
      const validatedModel = this.registryService.validateModel(requestedModel);
      if (requestedModel && requestedModel !== validatedModel) {
        this.logger.warn(
          `请求的模型 "${requestedModel}" 不可用，已回退到默认模型 "${validatedModel}"`,
        );
        this.logger.warn(`会话: ${conversationId}`);
      } else if (validatedModel !== this.defaultModel && requestedModel) {
        this.logger.log(
          `使用模型: ${getModelDisplayName(validatedModel)}，会话: ${conversationId}`,
        );
      }

      // 3. 工具验证（委托给 RegistryService）
      const validatedTools = this.registryService.validateTools(allowedTools);
      if (validatedTools.length > 0) {
        this.logger.log(`使用的工具: ${validatedTools.join(', ')}`);
      } else if (allowedTools && allowedTools.length > 0) {
        this.logger.warn(`请求的 ${allowedTools.length} 个工具全部不可用，将不使用任何工具`);
      }

      // 4. 构建请求
      const userMsg: SimpleMessage = { role: 'user', content: userMessage };
      const chatRequest: ChatRequest = {
        model: validatedModel,
        messages: [...historyMessages, userMsg],
        stream: false,
      };

      // 记录传递给 Agent API 的消息数量
      this.logger.log(
        `传递给 Agent API 的消息: ${chatRequest.messages.length} 条 (历史: ${historyMessages.length}, 当前: 1)`,
      );

      // 只添加有值的可选字段
      if (systemPrompt) chatRequest.systemPrompt = systemPrompt;
      if (promptType) chatRequest.promptType = promptType as any;
      if (validatedTools && validatedTools.length > 0) chatRequest.allowedTools = validatedTools;
      if (context && Object.keys(context).length > 0) chatRequest.context = context;
      if (toolContext && Object.keys(toolContext).length > 0) chatRequest.toolContext = toolContext;
      if (contextStrategy) chatRequest.contextStrategy = contextStrategy;
      if (prune !== undefined) chatRequest.prune = prune;
      if (pruneOptions) chatRequest.pruneOptions = pruneOptions;
      if (validateOnly !== undefined) chatRequest.validateOnly = validateOnly;

      this.logger.log(`调用 /api/v1/chat (非流式)，会话: ${conversationId}`);


      // 5. 尝试从缓存获取响应（委托给 CacheService）
      const cacheKey = this.cacheService.generateCacheKey({
        model: validatedModel,
        messages: chatRequest.messages,
        tools: validatedTools,
        context,
        toolContext,
        systemPrompt,
        promptType,
      });

      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        this.logger.log(`命中缓存，会话: ${conversationId}`);
        return cached;
      }

      // 6. 发送请求（带重试机制）
      const response = await this.chatWithRetry(chatRequest, conversationId);

      // 7. 提取 correlationId
      const correlationId =
        response.headers['x-correlation-id'] || response.data.correlationId || 'N/A';

      // 8. 检查 API 响应是否成功
      if (!response.data.success) {
        const errorData = response.data as any;

        this.logger.error(
          `Agent API 返回失败，会话: ${conversationId}, correlationId: ${correlationId}`,
          errorData,
        );

        // 处理上下文缺失错误
        if (errorData.details?.missingContext && errorData.details?.tools) {
          throw new AgentContextMissingException(
            errorData.details.missingContext,
            errorData.details.tools,
          );
        }

        throw new AgentApiException(response.data.error || '未知错误', errorData.details);
      }

      const chatResponse = response.data.data;

      // 9. 记录 correlationId 和使用统计
      this.logger.log(`Agent API 成功，会话: ${conversationId}, correlationId: ${correlationId}`);
      this.logUsageStats(chatResponse, conversationId);

      // 10. 缓存响应（委托给 CacheService）
      // 基于实际使用的工具（而不是 allowedTools）决定是否缓存
      if (
        this.cacheService.shouldCache({
          usedTools: chatResponse.tools?.used,
          context,
          toolContext,
        })
      ) {
        await this.cacheService.set(cacheKey, chatResponse);
      }

      this.logger.log(
        `AI 回复生成成功，会话: ${conversationId}，Token使用: ${chatResponse.usage?.totalTokens || 'N/A'}`,
      );
      return chatResponse;
    } catch (error) {
      // 如果已经是我们的自定义异常，直接抛出
      if (
        error instanceof AgentApiException ||
        error instanceof AgentConfigException ||
        error instanceof AgentContextMissingException
      ) {
        throw error;
      }

      // 处理网络错误
      if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
        this.logger.error(`Agent API 连接失败，会话: ${conversationId}`, error);
        throw new AgentApiException('无法连接到 Agent API 服务', {
          code: error.code,
          baseURL: this.baseURL,
        });
      }

      // 其他未知错误
      this.logger.error(`调用 /api/v1/chat 失败，会话: ${conversationId}`, error);
      throw new AgentApiException(
        error.message || '调用 Agent API 时发生未知错误',
        error.response?.data,
      );
    }
  }

  /**
   * 使用配置档案调用 chat 接口
   * @param conversationId 会话ID
   * @param userMessage 用户消息
   * @param profile Agent配置档案
   * @param overrides 覆盖配置档案的参数
   */
  async chatWithProfile(
    conversationId: string,
    userMessage: string,
    profile: {
      model: string;
      systemPrompt?: string;
      promptType?: string;
      allowedTools?: string[];
      context?: any;
      toolContext?: any;
      contextStrategy?: 'error' | 'skip' | 'report';
      prune?: boolean;
      pruneOptions?: any;
    },
    overrides?: Partial<typeof profile>,
  ): Promise<ChatResponse> {
    // 合并配置档案和覆盖参数
    const mergedConfig = { ...profile, ...overrides };

    return this.chat({
      conversationId,
      userMessage,
      ...mergedConfig,
    });
  }

  /**
   * 获取可用模型列表
   */
  async getModels() {
    try {
      this.logger.log('获取可用模型列表...');
      const response = await this.httpClient.get('/models');
      return response.data;
    } catch (error) {
      this.logger.error('获取模型列表失败:', error);
      throw error;
    }
  }

  /**
   * 获取可用工具列表
   */
  async getTools() {
    try {
      this.logger.log('获取可用工具列表...');
      const response = await this.httpClient.get('/tools');
      return response.data;
    } catch (error) {
      this.logger.error('获取工具列表失败:', error);
      throw error;
    }
  }

  /**
   * 带重试机制的 chat 请求
   * 实现指数退避策略
   */
  private async chatWithRetry(
    request: ChatRequest,
    conversationId: string,
  ): Promise<AxiosResponse<ApiResponse<ChatResponse>>> {
    let lastError: any;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await this.httpClient.post<ApiResponse<ChatResponse>>('/chat', request);
        return response;
      } catch (error: any) {
        lastError = error;

        // 处理 429 频率限制错误
        if (error.response?.status === 429) {
          const retryAfter = error.response.data?.details?.retryAfter || 60;
          this.logger.warn(
            `请求频率过高，会话: ${conversationId}, ${retryAfter}秒后可重试 (尝试 ${attempt + 1}/${this.maxRetries})`,
          );

          // 如果是最后一次尝试，抛出特定异常
          if (attempt === this.maxRetries - 1) {
            throw new AgentRateLimitException(retryAfter, `请求频率过高，请${retryAfter}秒后重试`);
          }

          // 等待 retryAfter 时间
          await this.sleep(retryAfter * 1000);
          continue;
        }

        // 不重试的错误类型
        if (
          error.response?.status === 400 || // 参数错误
          error.response?.status === 401 || // 认证失败
          error.response?.status === 403 // 权限不足
        ) {
          this.logger.error(
            `请求失败且不可重试，会话: ${conversationId}, 状态码: ${error.response.status}`,
          );
          throw error;
        }

        // 对于可重试的错误（5xx、网络错误等），使用指数退避
        if (attempt < this.maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
          this.logger.warn(
            `请求失败，${delay}ms后重试，会话: ${conversationId} (尝试 ${attempt + 1}/${this.maxRetries})`,
          );
          await this.sleep(delay);
        }
      }
    }

    // 所有重试都失败
    this.logger.error(`所有重试均失败，会话: ${conversationId}`, lastError);
    throw lastError;
  }

  /**
   * 记录使用统计
   */
  private logUsageStats(response: ChatResponse, conversationId: string): void {
    const { usage } = response;

    this.logger.log(`Token使用统计 [会话=${conversationId}]`, {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      cachedTokens: usage.cachedInputTokens || 0,
    });

    // 可以在这里添加监控指标上报逻辑
    // 例如：this.metricsService.recordTokenUsage(usage);
  }

  /**
   * 延迟辅助函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
