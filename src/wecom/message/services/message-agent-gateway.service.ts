import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AgentService,
  ProfileLoaderService,
  AgentConfigValidator,
  AgentResultHelper,
  AgentProfile,
  ChatResponse,
  BrandConfigService,
  ScenarioType,
  AgentError,
  AgentInvocationException,
  SimpleMessage,
} from '@agent';
import { MonitoringService } from '@/core/monitoring/monitoring.service';
import { AgentInvokeResult, AgentReply, FallbackMessageOptions } from '../types';
import { BrandContext } from '@agent';
import { ReplyNormalizer } from '../utils/reply-normalizer.util';
import { MessageParser } from '../utils/message-parser.util';

/**
 * Agent 网关服务（增强版）
 * 封装 Agent API 调用的完整流程 + 上下文构建 + 降级处理
 *
 * 职责：
 * - 构建会话上下文（合并品牌配置）
 * - 构造 Agent 请求参数
 * - 调用 Agent API
 * - 解析响应结果
 * - 记录监控指标
 * - 处理降级和告警
 * - 提供降级消息
 */
@Injectable()
export class AgentGatewayService {
  private readonly logger = new Logger(AgentGatewayService.name);

  // 缓存最后一次成功的品牌配置（用于降级）
  private lastValidBrandConfig: BrandContext | null = null;

  // 默认降级话术（优化版，学习真实招募经理 LiHanTing 的极简风格）
  // 分级设计：轻量级(12字以内)为主，中等复杂(18字以内)，复杂场景(25字以内)
  private readonly defaultFallbackMessages: string[] = [
    // 轻量级(12字以内) - 首选
    '我确认下哈，马上回你~',
    '我这边查一下，稍等~',
    '让我看看哈，很快~',

    // 中等复杂(18字以内)
    '这块我再核实下，确认好马上告诉你哈~',
    '这个涉及几个细节，我确认下再回你',

    // 复杂场景(25字以内)
    '这块资料我这边暂时没看到，我先帮你记下来，确认好回你~',
  ];

  constructor(
    private readonly configService: ConfigService,
    private readonly agentService: AgentService,
    private readonly profileLoader: ProfileLoaderService,
    private readonly configValidator: AgentConfigValidator,
    private readonly monitoringService: MonitoringService,
    private readonly brandConfigService: BrandConfigService,
  ) {}

  // ========================================
  // 上下文构建（合并自 ConversationContextBuilderService）
  // ========================================

  /**
   * 构建会话上下文
   * 合并品牌配置到 Agent 上下文
   *
   * @param baseContext 基础 context（来自 profile.json）
   * @returns 合并后的 context
   */
  async buildContext(baseContext?: Record<string, any>): Promise<BrandContext> {
    try {
      // 调试日志：检查 baseContext 中的 dulidayToken
      if (baseContext && 'dulidayToken' in baseContext) {
        const tokenLength = baseContext.dulidayToken ? String(baseContext.dulidayToken).length : 0;
        this.logger.debug(
          `✅ buildContext: baseContext 中包含 dulidayToken (长度: ${tokenLength})`,
        );
      } else {
        this.logger.warn('⚠️ buildContext: baseContext 中未找到 dulidayToken');
      }

      // 获取最新的品牌配置（从 Redis 缓存）
      const brandConfig = await this.brandConfigService.getBrandConfig();

      if (!brandConfig) {
        this.logger.warn('⚠️ 无法获取品牌配置，尝试使用缓存的旧配置');
        return this.buildFallbackContextWithCache(baseContext);
      }

      // 合并配置：基础 context + 品牌配置
      // 注意：API 契约要求使用 configData 字段传递品牌数据
      const mergedContext: BrandContext = {
        ...(baseContext || {}),
        configData: brandConfig.brandData,
        replyPrompts: brandConfig.replyPrompts,
        synced: brandConfig.synced,
        lastRefreshTime: brandConfig.lastRefreshTime,
      };

      // 【优化】缓存成功的品牌配置
      if (brandConfig.synced && brandConfig.brandData && brandConfig.replyPrompts) {
        this.lastValidBrandConfig = mergedContext;
        this.logger.debug(
          `✅ 已合并品牌配置到 context (synced: ${brandConfig.synced}, lastRefresh: ${brandConfig.lastRefreshTime})`,
        );
      }

      return mergedContext;
    } catch (error) {
      this.logger.error('❌ 合并品牌配置失败，尝试使用缓存的旧配置:', error);
      return this.buildFallbackContextWithCache(baseContext);
    }
  }

  /**
   * 构建带缓存的降级上下文
   * 优先使用缓存的旧配置，没有缓存时才使用空配置
   */
  private buildFallbackContextWithCache(baseContext?: Record<string, any>): BrandContext {
    if (this.lastValidBrandConfig) {
      this.logger.warn('⚠️ 使用缓存的旧品牌配置（标记为未同步）');
      return {
        ...this.lastValidBrandConfig,
        synced: false, // 标记为未同步，提示当前是旧数据
        lastRefreshTime: this.lastValidBrandConfig.lastRefreshTime, // 保留原始刷新时间
      };
    }

    this.logger.warn('⚠️ 无可用缓存，使用空配置');
    return this.buildFallbackContext(baseContext);
  }

  /**
   * 构建降级上下文（无品牌配置）
   */
  private buildFallbackContext(baseContext?: Record<string, any>): BrandContext {
    return {
      ...(baseContext || {}),
      synced: false,
      lastRefreshTime: new Date().toISOString(),
    };
  }

  /**
   * 清理 context，移除内部元数据字段
   * 这些字段只用于内部逻辑判断，不需要传给 Agent API
   */
  private cleanContextForAgent(context: BrandContext): Record<string, any> {
    const {
      synced: _synced,
      lastRefreshTime: _lastRefreshTime,
      configData,
      replyPrompts,
      ...cleanedContext
    } = context;
    // 注意：configData 和 replyPrompts 需要传给 Agent，所以要保留
    return {
      ...cleanedContext,
      ...(configData && { configData }),
      ...(replyPrompts && { replyPrompts }),
    };
  }

  // ========================================
  // 降级消息管理（合并自 FallbackMessageProviderService）
  // ========================================

  /**
   * 获取降级消息（内联自 FallbackMessageService）
   *
   * @param options 选项配置
   * @returns 降级消息文本
   */
  getFallbackMessage(options?: FallbackMessageOptions): string {
    // 1. 优先使用自定义消息
    if (options?.customMessage) {
      return options.customMessage;
    }

    // 2. 其次使用环境变量配置
    const envMessage = this.configService.get<string>('AGENT_FALLBACK_MESSAGE', '');
    if (envMessage) {
      return envMessage;
    }

    // 3. 不随机时返回第一条
    if (options?.random === false) {
      return this.defaultFallbackMessages[0];
    }

    // 4. 默认随机返回
    const index = Math.floor(Math.random() * this.defaultFallbackMessages.length);
    return this.defaultFallbackMessages[index];
  }

  // ========================================
  // Agent 调用（原有逻辑）
  // ========================================

  /**
   * 调用 Agent 获取回复
   *
   * @param params 调用参数
   * @returns Agent 调用结果
   */
  async invoke(params: {
    conversationId: string;
    userMessage: string;
    historyMessages: SimpleMessage[];
    scenario?: ScenarioType;
    messageId?: string; // 可选，用于监控埋点
    recordMonitoring?: boolean; // 是否记录监控（默认 true）
  }): Promise<AgentInvokeResult> {
    const {
      conversationId,
      userMessage,
      historyMessages,
      scenario = ScenarioType.CANDIDATE_CONSULTATION,
      messageId,
      recordMonitoring = true,
    } = params;

    const startTime = Date.now();
    let shouldRecordAiEnd = false;

    try {
      // 1. 获取 Agent 配置档案
      const agentProfile = this.loadAndValidateProfile(scenario);
      const mergedContext = await this.buildContext(agentProfile.context);

      // 2. 【监控埋点】记录 AI 处理开始
      if (recordMonitoring && messageId) {
        this.monitoringService.recordAiStart(messageId);
        shouldRecordAiEnd = true;
      }

      // 3. 清理 context，移除内部元数据字段（不传给 Agent API）
      const cleanedContext = this.cleanContextForAgent(mergedContext);

      // 4. 动态注入当前时间到 System Prompt
      const systemPrompt = this.injectCurrentTime(agentProfile.systemPrompt);

      // 5. 调用 Agent API
      const agentResult = await this.agentService.chat({
        conversationId,
        userMessage,
        messages: historyMessages, // API 契约字段名
        model: agentProfile.model,
        systemPrompt,
        promptType: agentProfile.promptType,
        allowedTools: agentProfile.allowedTools,
        context: cleanedContext,
        toolContext: agentProfile.toolContext,
        contextStrategy: agentProfile.contextStrategy,
        prune: agentProfile.prune,
        pruneOptions: agentProfile.pruneOptions,
      });

      const processingTime = Date.now() - startTime;

      // 4. 检查 Agent 调用结果
      if (AgentResultHelper.isError(agentResult)) {
        this.logger.error(`Agent 调用失败:`, agentResult.error);
        throw this.buildAgentInvocationError(agentResult.error);
      }

      // 5. 检查是否为降级响应
      const isFallback = AgentResultHelper.isFallback(agentResult);
      if (isFallback && agentResult.fallbackInfo) {
        this.handleFallbackResponse(agentResult, conversationId, userMessage, scenario);
      }

      // 6. 提取响应数据
      const chatResponse = AgentResultHelper.getResponse(agentResult);
      if (!chatResponse) {
        this.logger.error(`Agent 返回空响应`);
        throw new Error('Agent 返回空响应');
      }

      // 7. 构造回复对象
      const reply = this.buildAgentReply(chatResponse);

      this.logger.log(
        `Agent 调用成功，耗时 ${processingTime}ms，tokens=${reply.usage?.totalTokens || 'N/A'}`,
      );

      return {
        result: agentResult,
        reply,
        isFallback,
        processingTime,
      };
    } catch (error) {
      this.logger.error(`Agent 调用异常: ${error.message}`);
      throw error;
    } finally {
      // 8. 【监控埋点】记录 AI 处理完成（无论成功还是失败）
      if (shouldRecordAiEnd && messageId) {
        this.monitoringService.recordAiEnd(messageId);
      }
    }
  }

  /**
   * 加载并验证 Agent 配置档案
   */
  private loadAndValidateProfile(scenario: string): AgentProfile {
    const agentProfile = this.profileLoader.getProfile(scenario);

    if (!agentProfile) {
      throw new Error(`无法获取场景 ${scenario} 的 Agent 配置`);
    }

    // 验证配置有效性
    try {
      this.configValidator.validateRequiredFields(agentProfile);
      const contextValidation = this.configValidator.validateContext(agentProfile.context);

      if (!contextValidation.isValid) {
        throw new Error(`Agent 配置验证失败: ${contextValidation.errors.join(', ')}`);
      }
    } catch (error) {
      throw new Error(`Agent 配置验证失败: ${error.message}`);
    }

    return agentProfile;
  }

  /**
   * 处理降级响应
   *
   * 注意：告警已统一移至 MessagePipelineService.handleProcessingError
   * 此处仅记录日志，避免重复告警
   */
  private handleFallbackResponse(
    agentResult: any,
    _conversationId: string,
    _userMessage: string,
    _scenario: ScenarioType,
  ): void {
    const fallbackReason = agentResult.fallbackInfo.reason;
    this.logger.warn(`Agent 降级响应（原因: ${fallbackReason}）`);
  }

  /**
   * 构造 Agent 调用异常并附带诊断信息
   */
  private buildAgentInvocationError(agentError?: AgentError): AgentInvocationException {
    const code = agentError?.code || 'UNKNOWN_ERROR';
    const message = agentError?.message || 'Agent 调用失败';
    const exception = new AgentInvocationException(code, message, {
      details: agentError?.details,
      retryable: agentError?.retryable,
      retryAfter: agentError?.retryAfter,
    });

    const metaSource = agentError as any;
    if (metaSource) {
      if (metaSource.requestParams) {
        (exception as any).requestParams = metaSource.requestParams;
      }
      if (metaSource.apiKey) {
        (exception as any).apiKey = metaSource.apiKey;
      }
      if (metaSource.requestHeaders) {
        (exception as any).requestHeaders = metaSource.requestHeaders;
      }
      if (metaSource.response || metaSource.apiResponse) {
        (exception as any).response = metaSource.response || metaSource.apiResponse;
      }
    }

    (exception as any).isAgentError = true;
    return exception;
  }

  /**
   * 构造 Agent 回复对象
   */
  private buildAgentReply(chatResponse: ChatResponse): AgentReply {
    // 提取回复内容
    const content = this.extractReplyContent(chatResponse);

    return {
      content,
      usage: chatResponse.usage,
      tools: chatResponse.tools,
      rawResponse: chatResponse,
    };
  }

  /**
   * 提取 AI 回复内容
   * 优先级：
   * 1. zhipin_reply_generator 工具的 reply 字段（智能回复）
   * 2. 最后一条 assistant 消息的文本内容
   *
   * 包含兜底清洗逻辑：将 Markdown 格式转换为自然口语
   */
  private extractReplyContent(chatResponse: ChatResponse): string {
    if (!chatResponse.messages || chatResponse.messages.length === 0) {
      throw new Error('AI 未生成有效回复');
    }

    // 获取最后一条 assistant 消息
    const lastAssistantMessage = chatResponse.messages.filter((m) => m.role === 'assistant').pop();

    if (
      !lastAssistantMessage ||
      !lastAssistantMessage.parts ||
      lastAssistantMessage.parts.length === 0
    ) {
      throw new Error('AI 响应中没有找到助手消息');
    }

    // 提取所有文本类型的 parts 并拼接
    const textParts = lastAssistantMessage.parts
      .filter((p) => p.type === 'text' && p.text)
      .map((p) => p.text);

    if (textParts.length === 0) {
      throw new Error('AI 响应中没有找到文本内容');
    }

    // 拼接所有文本内容
    const rawContent = textParts.join('\n\n');

    return this.normalizeContent(rawContent);
  }

  /**
   * 规范化回复内容
   * 将 Markdown 列表格式转换为自然口语
   */
  private normalizeContent(rawContent: string): string {
    // 🛡️ 兜底清洗：将 Markdown 列表格式转换为自然口语
    // 即使 AI 偶尔生成带列表符号的回复，这里也能保证发出去的是人话
    if (ReplyNormalizer.needsNormalization(rawContent)) {
      const normalizedContent = ReplyNormalizer.normalize(rawContent);
      this.logger.debug(
        `[ReplyNormalizer] 已清洗回复: "${rawContent.substring(0, 50)}..." → "${normalizedContent.substring(0, 50)}..."`,
      );
      return normalizedContent;
    }

    return rawContent;
  }

  /**
   * 动态注入当前时间到 System Prompt
   * 替换 {{CURRENT_TIME}} 占位符为实际时间
   */
  private injectCurrentTime(systemPrompt?: string): string | undefined {
    if (!systemPrompt) return systemPrompt;

    const currentTime = MessageParser.formatCurrentTime();
    return systemPrompt.replace('{{CURRENT_TIME}}', currentTime);
  }
}
