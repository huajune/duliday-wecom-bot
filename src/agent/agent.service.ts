import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosInstance, AxiosResponse } from 'axios';
import { ApiResponse, ChatRequest, ChatResponse, SimpleMessage } from './dto/chat-request.dto';
import { ConversationService } from '@common/conversation';
import { HttpClientFactory } from '@core/http/http-client.factory';
import {
  AgentApiException,
  AgentConfigException,
  AgentContextMissingException,
  AgentRateLimitException,
} from './exceptions/agent.exception';

/**
 * 响应缓存项
 */
interface CacheItem {
  response: ChatResponse;
  timestamp: number;
}

/**
 * Agent 服务
 * 用于调用 花卷agent 项目的 /api/v1/chat 接口
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

  // 响应缓存（简单的内存缓存）
  private readonly responseCache = new Map<string, CacheItem>();
  private readonly cacheTTL: number = 3600000; // 1小时

  constructor(
    private readonly configService: ConfigService,
    private readonly conversationService: ConversationService,
    private readonly httpClientFactory: HttpClientFactory,
  ) {
    // 从环境变量读取配置（已在启动时验证，这里可以安全使用）
    this.apiKey = this.configService.get<string>('AGENT_API_KEY')!;
    this.baseURL = this.configService.get<string>('AGENT_API_BASE_URL')!;
    this.defaultModel = this.configService.get<string>('AGENT_DEFAULT_MODEL')!;
    this.timeout = this.configService.get<number>('AGENT_API_TIMEOUT')!;

    this.logger.log(`初始化 Agent API 客户端: ${this.baseURL}`);
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
   * 自动管理会话历史，支持完整的 API 契约参数
   */
  async chat(params: {
    conversationId: string;
    userMessage: string;
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
      model = this.defaultModel,
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
      // 验证用户消息不为空
      if (!userMessage || userMessage.trim() === '') {
        throw new AgentConfigException('用户消息内容不能为空');
      }

      // 获取会话历史（默认最近20条）
      const history = this.conversationService.getHistory(conversationId);

      // 添加用户消息到历史
      const userMsg: SimpleMessage = { role: 'user', content: userMessage };
      this.conversationService.addMessage(conversationId, userMsg);

      // 构建请求（完全对齐 API 契约）
      const chatRequest: ChatRequest = {
        model,
        messages: [...history, userMsg],
        stream: false, // 本项目不使用流式输出
      };

      // 只添加有值的可选字段
      if (systemPrompt) chatRequest.systemPrompt = systemPrompt;
      if (promptType) chatRequest.promptType = promptType as any;
      if (allowedTools && allowedTools.length > 0) chatRequest.allowedTools = allowedTools;
      if (context && Object.keys(context).length > 0) chatRequest.context = context;
      if (toolContext && Object.keys(toolContext).length > 0) chatRequest.toolContext = toolContext;
      if (contextStrategy) chatRequest.contextStrategy = contextStrategy;
      if (prune !== undefined) chatRequest.prune = prune;
      if (pruneOptions) chatRequest.pruneOptions = pruneOptions;
      if (validateOnly !== undefined) chatRequest.validateOnly = validateOnly;

      this.logger.log(`调用 /api/v1/chat (非流式)，会话: ${conversationId}`);

      // 生产环境不打印详细请求体（避免泄露敏感信息）
      if (process.env.NODE_ENV !== 'production') {
        this.logger.debug('发送给 Agent 的请求体:', JSON.stringify(chatRequest, null, 2));
      }

      // 尝试从缓存获取响应（仅针对简单查询）
      const cacheKey = this.getCacheKey(chatRequest);
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        this.logger.log(`命中缓存，会话: ${conversationId}`);
        return cached;
      }

      // 发送请求（带重试机制）
      const response = await this.chatWithRetry(chatRequest, conversationId);

      // 提取 correlationId
      const correlationId =
        response.headers['x-correlation-id'] || response.data.correlationId || 'N/A';

      // 检查 API 响应是否成功
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

      // 记录 correlationId 和使用统计
      this.logger.log(`Agent API 成功，会话: ${conversationId}, correlationId: ${correlationId}`);
      this.logUsageStats(chatResponse, conversationId);

      // 验证模式不需要保存历史
      if (validateOnly) {
        this.logger.log(`配置验证完成，会话: ${conversationId}`);
        return chatResponse;
      }

      // 添加助手回复到历史
      if (chatResponse.messages && chatResponse.messages.length > 0) {
        const assistantMessages = chatResponse.messages.filter((m) => m.role === 'assistant');
        this.conversationService.addMessages(conversationId, assistantMessages);
      }

      // 缓存响应（仅缓存简单查询）
      if (!allowedTools || allowedTools.length === 0) {
        this.saveToCache(cacheKey, chatResponse);
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
   * 获取可用的 promptType 列表
   */
  async getPromptTypes() {
    try {
      this.logger.log('获取可用的 promptType 列表...');
      const response = await this.httpClient.get('/prompt-types');
      return response.data;
    } catch (error) {
      this.logger.error('获取 promptType 列表失败:', error);
      throw error;
    }
  }

  /**
   * 获取配置 Schema
   */
  async getConfigSchema() {
    try {
      this.logger.log('获取配置 Schema...');
      const response = await this.httpClient.get('/config-schema');
      return response.data;
    } catch (error) {
      this.logger.error('获取配置 Schema 失败:', error);
      throw error;
    }
  }

  /**
   * 清空会话历史
   */
  clearConversation(conversationId: string) {
    this.conversationService.clearConversation(conversationId);
    this.logger.log(`会话 ${conversationId} 已清空`);
  }

  /**
   * 获取会话统计信息
   */
  getConversationStats(conversationId: string) {
    return this.conversationService.getStats(conversationId);
  }

  /**
   * 健康检查
   */
  async healthCheck() {
    try {
      // 尝试获取模型列表来验证连接
      await this.getModels();
      return {
        status: 'healthy',
        baseURL: this.baseURL,
        message: 'Agent API 连接正常',
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        baseURL: this.baseURL,
        message: 'Agent API 连接失败',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
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
   * 生成缓存键
   * 基于消息内容和模型生成唯一键
   */
  private getCacheKey(request: ChatRequest): string {
    const lastMessage = request.messages[request.messages.length - 1];
    const content =
      'content' in lastMessage
        ? lastMessage.content
        : lastMessage.parts?.map((p) => p.text).join('') || '';

    // 生成简单的哈希键
    return `${request.model}:${content.substring(0, 100)}`;
  }

  /**
   * 从缓存获取响应
   */
  private getFromCache(key: string): ChatResponse | null {
    const cached = this.responseCache.get(key);
    if (!cached) {
      return null;
    }

    // 检查是否过期
    if (Date.now() - cached.timestamp > this.cacheTTL) {
      this.responseCache.delete(key);
      return null;
    }

    return cached.response;
  }

  /**
   * 保存响应到缓存
   */
  private saveToCache(key: string, response: ChatResponse): void {
    this.responseCache.set(key, {
      response,
      timestamp: Date.now(),
    });

    // 限制缓存大小，避免内存泄漏
    if (this.responseCache.size > 1000) {
      const firstKey = this.responseCache.keys().next().value;
      this.responseCache.delete(firstKey);
    }
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
