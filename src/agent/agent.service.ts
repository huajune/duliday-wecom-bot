import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosResponse } from 'axios';
import { ApiResponse, ChatRequest, ChatResponse, SimpleMessage } from './dto/chat-request.dto';
import {
  AgentApiException,
  AgentConfigException,
  AgentContextMissingException,
  AgentRateLimitException,
} from './exceptions/agent.exception';
import { parseToolsFromEnv, getModelDisplayName } from './utils';
import { AgentCacheService } from './agent-cache.service';
import { AgentRegistryService } from './agent-registry.service';
import { AgentFallbackService, FallbackScenario } from './agent-fallback.service';
import { AgentApiClientService } from './agent-api-client.service';
import { ProfileSanitizer, AgentProfile } from './utils/profile-sanitizer';
import { AgentLogger } from './utils/agent-logger';
import {
  AgentResult,
  createSuccessResult,
  createFallbackResult,
  createErrorResult,
} from './models/agent-result.model';

/**
 * Agent 服务（重构版）
 * 负责调用 Agent API 的核心业务逻辑
 *
 * 职责：
 * 1. 参数验证和预处理
 * 2. 组装请求并调用 API
 * 3. 处理响应和错误
 * 4. 统一降级策略
 *
 * 已委托给其他服务：
 * - API 调用和重试 → AgentApiClientService
 * - 模型/工具验证 → AgentRegistryService
 * - 缓存管理 → AgentCacheService
 * - 降级策略 → AgentFallbackService
 * - 配置验证和品牌配置监控 → AgentConfigService (在 getProfile 中处理)
 * - 日志处理 → AgentLogger
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly defaultModel: string;
  private readonly configuredTools: string[];
  private readonly agentLogger: AgentLogger;

  constructor(
    private readonly configService: ConfigService,
    private readonly apiClient: AgentApiClientService,
    private readonly cacheService: AgentCacheService,
    private readonly registryService: AgentRegistryService,
    private readonly fallbackService: AgentFallbackService,
  ) {
    // 初始化配置
    this.defaultModel = this.configService.get<string>('AGENT_DEFAULT_MODEL')!;
    const toolsString = this.configService.get<string>('AGENT_ALLOWED_TOOLS', '');
    this.configuredTools = parseToolsFromEnv(toolsString);

    // 初始化日志工具
    this.agentLogger = new AgentLogger(this.logger, this.configService);

    this.logger.log(`默认模型: ${this.defaultModel}`);
    this.logger.log(
      `配置的工具: ${this.configuredTools.length > 0 ? this.configuredTools.join(', ') : '无'}`,
    );
  }

  /**
   * 调用 /api/v1/chat 接口（非流式）
   * 支持完整的 API 契约参数
   * @returns AgentResult 统一响应模型
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
  }): Promise<AgentResult> {
    const { conversationId, historyMessages = [] } = params;

    try {
      // 1. 准备请求（验证 + 构建）
      const preparedRequest = this.prepareRequest(params, conversationId, historyMessages);

      // 2. 执行请求（缓存协调 + API 调用）
      const result = await this.executeRequest(preparedRequest, params, conversationId);

      // 3. 记录结果（日志 + 统计）
      this.recordResult(result, conversationId);

      // 4. 返回成功结果
      return createSuccessResult(result.data, undefined, result.fromCache);
    } catch (error) {
      // 统一错误处理
      return this.handleChatError(error, conversationId);
    }
  }

  /**
   * 使用配置档案调用 chat 接口
   * @param conversationId 会话ID
   * @param userMessage 用户消息
   * @param profile Agent配置档案
   * @param overrides 覆盖配置档案的参数
   * @returns AgentResult 统一响应模型
   */
  async chatWithProfile(
    conversationId: string,
    userMessage: string,
    profile: AgentProfile,
    overrides?: Partial<AgentProfile>,
  ): Promise<AgentResult> {
    // 1. 清洗和合并配置
    const sanitized = ProfileSanitizer.merge(profile, overrides);

    // 2. 调用 chat 方法
    // 注意：品牌配置验证已在 AgentConfigService.getProfile() 中完成
    return this.chat({
      conversationId,
      userMessage,
      ...sanitized,
    });
  }

  /**
   * 获取可用模型列表
   */
  async getModels() {
    return this.apiClient.getModels();
  }

  /**
   * 获取可用工具列表
   */
  async getTools() {
    return this.apiClient.getTools();
  }

  // ========== 私有辅助方法 ==========

  /**
   * 准备请求（验证 + 构建）
   * 职责：验证用户输入、模型和工具，构建最终的请求对象
   */
  private prepareRequest(
    params: any,
    conversationId: string,
    historyMessages: SimpleMessage[],
  ): { chatRequest: ChatRequest; validatedModel: string; validatedTools: string[] } {
    const { userMessage } = params;

    // 验证用户消息
    this.validateUserMessage(userMessage);

    // 验证和准备模型、工具
    const validatedModel = this.registryService.validateModel(params.model);
    const validatedTools = this.registryService.validateTools(params.allowedTools);

    // 记录模型和工具信息
    this.logModelAndTools(conversationId, validatedModel, validatedTools, params.model);

    // 构建请求
    const chatRequest = this.buildChatRequest({
      ...params,
      model: validatedModel,
      allowedTools: validatedTools,
      historyMessages,
      userMessage,
    });

    // 记录请求日志
    this.agentLogger.logRequest(conversationId, chatRequest);

    return { chatRequest, validatedModel, validatedTools };
  }

  /**
   * 执行请求（缓存协调 + API 调用）
   * 职责：尝试从缓存获取，缓存未命中则调用 API
   */
  private async executeRequest(
    preparedRequest: { chatRequest: ChatRequest; validatedModel: string; validatedTools: string[] },
    params: any,
    conversationId: string,
  ): Promise<{ data: ChatResponse; fromCache: boolean }> {
    const { chatRequest, validatedModel, validatedTools } = preparedRequest;

    return await this.cacheService.fetchOrStore(
      {
        model: validatedModel,
        messages: chatRequest.messages,
        tools: validatedTools,
        context: params.context,
        toolContext: params.toolContext,
        systemPrompt: params.systemPrompt,
        promptType: params.promptType,
      },
      async () => {
        // 缓存未命中，调用 API
        const response = await this.apiClient.chat(chatRequest, conversationId);
        return this.handleChatResponse(response, conversationId);
      },
      (response) => {
        // 判断是否应该缓存
        return this.cacheService.shouldCache({
          usedTools: response.tools?.used,
          context: params.context,
          toolContext: params.toolContext,
        });
      },
    );
  }

  /**
   * 记录结果（日志 + 统计）
   * 职责：记录响应日志和使用统计
   */
  private recordResult(
    result: { data: ChatResponse; fromCache: boolean },
    conversationId: string,
  ): void {
    // 记录响应日志
    this.agentLogger.logResponse(conversationId, result.data);

    // 记录使用统计
    this.logUsageStats(result.data, conversationId);
  }

  /**
   * 验证用户消息
   */
  private validateUserMessage(userMessage: string): void {
    if (!userMessage || userMessage.trim() === '') {
      throw new AgentConfigException('用户消息内容不能为空');
    }
  }

  /**
   * 记录模型和工具信息
   */
  private logModelAndTools(
    conversationId: string,
    validatedModel: string,
    validatedTools: string[],
    requestedModel?: string,
  ): void {
    if (requestedModel && requestedModel !== validatedModel) {
      this.logger.warn(
        `请求的模型 "${requestedModel}" 不可用，已回退到默认模型 "${validatedModel}"`,
      );
      this.logger.warn(`会话: ${conversationId}`);
    } else if (validatedModel !== this.defaultModel && requestedModel) {
      this.logger.log(`使用模型: ${getModelDisplayName(validatedModel)}，会话: ${conversationId}`);
    }

    this.logger.log(
      `传递给 Agent API 的消息: ${validatedTools.length} 个工具, 会话: ${conversationId}`,
    );
  }

  /**
   * 构建聊天请求
   */
  private buildChatRequest(params: {
    model: string;
    userMessage: string;
    historyMessages: SimpleMessage[];
    systemPrompt?: string;
    promptType?: string;
    allowedTools?: string[];
    context?: any;
    toolContext?: any;
    contextStrategy?: 'error' | 'skip' | 'report';
    prune?: boolean;
    pruneOptions?: any;
    validateOnly?: boolean;
  }): ChatRequest {
    const userMsg: SimpleMessage = { role: 'user', content: params.userMessage };
    const chatRequest: ChatRequest = {
      model: params.model,
      messages: [...params.historyMessages, userMsg],
      stream: false,
    };

    // 只添加有值的可选字段
    if (params.systemPrompt) chatRequest.systemPrompt = params.systemPrompt;
    if (params.promptType) chatRequest.promptType = params.promptType as any;
    if (params.allowedTools && params.allowedTools.length > 0) {
      chatRequest.allowedTools = params.allowedTools;
    }
    if (params.context && Object.keys(params.context).length > 0) {
      chatRequest.context = params.context;
    }
    if (params.toolContext && Object.keys(params.toolContext).length > 0) {
      chatRequest.toolContext = params.toolContext;
    }
    if (params.contextStrategy) chatRequest.contextStrategy = params.contextStrategy;
    if (params.prune !== undefined) chatRequest.prune = params.prune;
    if (params.pruneOptions) chatRequest.pruneOptions = params.pruneOptions;
    if (params.validateOnly !== undefined) chatRequest.validateOnly = params.validateOnly;

    return chatRequest;
  }

  /**
   * 处理聊天响应
   */
  private handleChatResponse(
    response: AxiosResponse<ApiResponse<ChatResponse>>,
    conversationId: string,
  ): ChatResponse {
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

    // 记录 correlationId
    this.logger.log(`Agent API 成功，会话: ${conversationId}, correlationId: ${correlationId}`);

    return chatResponse;
  }

  /**
   * 处理聊天错误（统一降级策略）
   */
  private handleChatError(error: any, conversationId: string): AgentResult {
    this.logger.error(`Agent API 调用失败，会话: ${conversationId}`, error);

    // 1. 配置错误（必须抛出，这是开发问题）
    if (error instanceof AgentConfigException) {
      return createErrorResult(
        {
          code: 'CONFIG_ERROR',
          message: error.message,
          retryable: false,
        },
        conversationId,
      );
    }

    // 2. 上下文缺失 → 返回引导消息（降级）
    if (error instanceof AgentContextMissingException) {
      this.logger.warn(`上下文缺失，返回引导消息，会话: ${conversationId}`);
      const fallbackInfo = this.fallbackService.getFallbackInfo(FallbackScenario.CONTEXT_MISSING);
      const fallbackResponse = this.createFallbackResponse(fallbackInfo.message);
      return createFallbackResult(fallbackResponse, fallbackInfo, conversationId);
    }

    // 3. 频率限制 → 返回等待消息（降级）
    if (error instanceof AgentRateLimitException) {
      this.logger.warn(`请求频率受限，返回等待消息，会话: ${conversationId}`);
      const fallbackInfo = this.fallbackService.getFallbackInfo(
        FallbackScenario.RATE_LIMIT,
        error.retryAfter,
      );
      const fallbackResponse = this.createFallbackResponse(fallbackInfo.message);
      return createFallbackResult(fallbackResponse, fallbackInfo, conversationId);
    }

    // 4. 网络错误 → 返回通用降级消息
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      this.logger.error(`网络连接失败，返回降级消息，会话: ${conversationId}`, {
        code: error.code,
      });
      const fallbackInfo = this.fallbackService.getFallbackInfo(FallbackScenario.NETWORK_ERROR);
      const fallbackResponse = this.createFallbackResponse(fallbackInfo.message);
      return createFallbackResult(fallbackResponse, fallbackInfo, conversationId);
    }

    // 5. Agent API 异常 → 根据错误类型决定
    if (error instanceof AgentApiException) {
      const fallbackInfo = this.fallbackService.getFallbackInfo(FallbackScenario.AGENT_API_ERROR);
      this.logger.warn(
        `Agent API 异常，返回降级消息: "${fallbackInfo.message}"，会话: ${conversationId}`,
      );
      const fallbackResponse = this.createFallbackResponse(fallbackInfo.message);
      return createFallbackResult(fallbackResponse, fallbackInfo, conversationId);
    }

    // 6. 其他未知错误 → 返回通用降级消息
    this.logger.error(`未知错误，返回降级消息，会话: ${conversationId}`, error);
    const fallbackInfo = this.fallbackService.getFallbackInfo(FallbackScenario.NETWORK_ERROR);
    const fallbackResponse = this.createFallbackResponse(fallbackInfo.message);
    return createFallbackResult(fallbackResponse, fallbackInfo, conversationId);
  }

  /**
   * 记录使用统计
   */
  private logUsageStats(response: ChatResponse, conversationId: string): void {
    const { usage, tools } = response;

    // 记录 Token 使用情况
    this.logger.log(
      `Token使用 [会话: ${conversationId}] - ` +
        `输入: ${usage.inputTokens}, 输出: ${usage.outputTokens}, 总计: ${usage.totalTokens}` +
        (usage.cachedInputTokens ? `, 缓存: ${usage.cachedInputTokens}` : ''),
    );

    // 记录工具调用情况
    if (tools) {
      if (tools.used && tools.used.length > 0) {
        this.logger.log(`工具调用 [会话: ${conversationId}] - 已使用: [${tools.used.join(', ')}]`);
      } else {
        this.logger.log(`工具调用 [会话: ${conversationId}] - 未使用任何工具`);
      }

      if (tools.skipped && tools.skipped.length > 0) {
        this.logger.debug(
          `工具调用 [会话: ${conversationId}] - 已跳过: [${tools.skipped.join(', ')}]`,
        );
      }
    }
  }

  /**
   * 创建降级响应
   * @param fallbackMessage 降级消息文本
   * @returns 模拟的 ChatResponse
   */
  private createFallbackResponse(fallbackMessage: string): ChatResponse {
    return {
      messages: [
        {
          role: 'assistant',
          parts: [
            {
              type: 'text',
              text: fallbackMessage,
            },
          ],
        },
      ],
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
      tools: {
        used: [],
        skipped: [],
      },
    };
  }
}
