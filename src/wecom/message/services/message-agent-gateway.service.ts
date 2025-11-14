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
} from '@agent';
import { MonitoringService } from '@/core/monitoring/monitoring.service';
import { FeiShuAlertService } from '@/core/alert/feishu-alert.service';
import { AgentInvokeResult, AgentReply, FallbackMessageOptions } from '../types';
import { BrandContext } from '@agent';
import { FallbackMessageService } from './message-fallback.service';

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

  constructor(
    private readonly configService: ConfigService,
    private readonly agentService: AgentService,
    private readonly profileLoader: ProfileLoaderService,
    private readonly configValidator: AgentConfigValidator,
    private readonly monitoringService: MonitoringService,
    private readonly feiShuAlertService: FeiShuAlertService,
    private readonly brandConfigService: BrandConfigService,
    private readonly fallbackMessageService: FallbackMessageService,
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
      const mergedContext: BrandContext = {
        ...(baseContext || {}),
        brandData: brandConfig.brandData,
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

  // ========================================
  // 降级消息管理（合并自 FallbackMessageProviderService）
  // ========================================

  /**
   * 获取降级消息
   *
   * @param options 选项配置
   * @returns 降级消息文本
   */
  getFallbackMessage(options?: FallbackMessageOptions): string {
    return this.fallbackMessageService.getMessage(options);
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
    historyMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
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

      // 3. 调用 Agent API
      const agentResult = await this.agentService.chat({
        conversationId,
        userMessage,
        historyMessages,
        model: agentProfile.model,
        systemPrompt: agentProfile.systemPrompt,
        promptType: agentProfile.promptType,
        allowedTools: agentProfile.allowedTools,
        context: mergedContext,
        toolContext: agentProfile.toolContext,
        contextStrategy: agentProfile.contextStrategy,
        prune: agentProfile.prune,
        pruneOptions: agentProfile.pruneOptions,
      });

      const processingTime = Date.now() - startTime;

      // 4. 检查 Agent 调用结果
      if (AgentResultHelper.isError(agentResult)) {
        this.logger.error(`Agent 调用失败:`, agentResult.error);
        throw new Error(agentResult.error?.message || 'Agent 调用失败');
      }

      // 5. 检查是否为降级响应
      const isFallback = AgentResultHelper.isFallback(agentResult);
      if (isFallback && agentResult.fallbackInfo) {
        await this.handleFallbackResponse(agentResult, conversationId, userMessage, scenario);
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

      // 发送告警（异步，不阻塞主流程）
      this.feiShuAlertService
        .sendAgentApiFailureAlert(error, conversationId, userMessage, '/api/v1/chat', {
          errorType: 'agent',
          scenario,
        })
        .catch((alertError) => {
          this.logger.error(`飞书告警发送失败: ${alertError.message}`);
        });

      // 重新抛出异常，由调用方决定如何处理
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
   */
  private async handleFallbackResponse(
    agentResult: any,
    conversationId: string,
    userMessage: string,
    scenario: ScenarioType,
  ): Promise<void> {
    const fallbackReason = agentResult.fallbackInfo.reason;
    this.logger.warn(`Agent 降级响应（原因: ${fallbackReason}），触发飞书告警`);

    // 构造错误对象用于告警
    const mockError = {
      message: agentResult.fallbackInfo.message,
      response: {
        status: 'N/A',
        data: {
          error: fallbackReason,
          message: agentResult.fallbackInfo.message,
          suggestion: agentResult.fallbackInfo.suggestion,
          retryAfter: agentResult.fallbackInfo.retryAfter,
        },
      },
    };

    // 异步发送告警（不阻塞主流程）
    this.feiShuAlertService
      .sendAgentApiFailureAlert(mockError, conversationId, userMessage, '/api/v1/chat', {
        errorType: 'agent',
        fallbackMessage: agentResult.fallbackInfo.message,
        scenario,
      })
      .catch((alertError) => {
        this.logger.error(`飞书告警发送失败: ${alertError.message}`);
      });
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
    return textParts.join('\n\n');
  }
}
