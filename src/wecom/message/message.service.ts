import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MonitoringService } from '@/core/monitoring/monitoring.service';
import { AlertService } from '@/core/alert/alert.service';
import { SupabaseService } from '@core/supabase';
import { ScenarioType } from '@agent';
import { AgentException } from '@/agent/utils/agent-exceptions';

// 导入子服务
import { MessageDeduplicationService } from './services/message-deduplication.service';
import { MessageHistoryService } from './services/message-history.service';
import { MessageFilterService } from './services/message-filter.service';
import { MessageMergeService } from './services/message-merge.service';
import { MessageStatisticsService } from './services/message-statistics.service';
import { MessageDeliveryService } from './services/message-delivery.service';
import { AgentGatewayService } from './services/message-agent-gateway.service';

// 导入工具和类型
import { MessageParser } from './utils/message-parser.util';
import { LogSanitizer } from './utils/log-sanitizer.util';
import {
  EnterpriseMessageCallbackDto,
  getMessageSourceDescription,
} from './dto/message-callback.dto';
import { DeliveryContext, PipelineResult, AlertErrorType } from './types';

/**
 * 消息处理服务（重构版 v3 - 优化服务结构）
 *
 * 重构亮点：
 * 1. 消息处理管线：过滤 → 去重 → 监控 → 分派
 * 2. AgentGatewayService 增强：Agent 调用 + 上下文构建 + 降级处理（三合一）
 * 3. 统一的消息发送：MessageDeliveryService
 * 4. 消除所有 any 类型，完整类型安全
 * 5. 修复聚合流程缺少去重标记的 bug
 * 6. 服务数量优化：10 个 → 8 个
 *
 * 从 990 行精简到 ~400 行（含注释）
 */
@Injectable()
export class MessageService implements OnModuleInit {
  private readonly logger = new Logger(MessageService.name);
  private enableAiReply: boolean; // 可动态切换，由 SupabaseService 持久化
  private readonly enableMessageMerge: boolean;

  // 监控统计：跟踪正在处理的消息数
  private processingCount: number = 0;

  constructor(
    private readonly configService: ConfigService,
    // 子服务（8个核心服务）
    private readonly deduplicationService: MessageDeduplicationService,
    private readonly historyService: MessageHistoryService,
    private readonly filterService: MessageFilterService,
    private readonly mergeService: MessageMergeService,
    private readonly statisticsService: MessageStatisticsService,
    private readonly deliveryService: MessageDeliveryService,
    private readonly agentGateway: AgentGatewayService, // 增强版：包含上下文构建和降级处理
    // 监控和告警
    private readonly monitoringService: MonitoringService,
    private readonly alertService: AlertService,
    // Supabase 持久化服务
    private readonly supabaseService: SupabaseService,
  ) {
    // 初始值从环境变量读取，模块初始化时会从 Supabase 加载
    this.enableAiReply = this.configService.get<string>('ENABLE_AI_REPLY', 'true') === 'true';
    this.enableMessageMerge =
      this.configService.get<string>('ENABLE_MESSAGE_MERGE', 'true') === 'true';

    this.logger.log(`消息聚合功能: ${this.enableMessageMerge ? '已启用' : '已禁用'}`);
  }

  /**
   * 模块初始化 - 从 Supabase 加载 AI 回复状态
   */
  async onModuleInit() {
    this.enableAiReply = await this.supabaseService.getAiReplyEnabled();
    this.logger.log(`AI 自动回复功能: ${this.enableAiReply ? '已启用' : '已禁用'} (来自 Supabase)`);
  }

  /**
   * 处理接收到的消息（主入口）
   * 消息处理管线：开关检查 → 过滤 → 去重 → 监控 → 分派
   *
   * 性能优化：立即返回响应，避免企微回调超时
   */
  async handleMessage(messageData: EnterpriseMessageCallbackDto) {
    // 【安全】仅在 debug 级别输出脱敏后的消息数据
    const sanitized = LogSanitizer.sanitizeMessageCallback(messageData);
    this.logger.debug('=== [回调消息数据(已脱敏)] ===');
    this.logger.debug(JSON.stringify(sanitized, null, 2));

    this.logger.log(
      `[handleMessage] 收到消息 [${messageData.messageId}], source=${messageData.source}(${getMessageSourceDescription(messageData.source)}), isSelf=${messageData.isSelf}`,
    );

    // 管线步骤 0: 处理 bot 自己发送的消息（存储为 assistant 历史）
    if (messageData.isSelf === true) {
      await this.handleSelfMessage(messageData);
      return { success: true, message: 'Self message stored' };
    }

    // 管线步骤 1: 检查 AI 回复开关
    const switchResult = this.checkAiReplySwitch();
    if (!switchResult.continue) {
      return switchResult.response;
    }

    // 管线步骤 2: 消息过滤
    const filterResult = await this.filterMessage(messageData);
    if (!filterResult.continue) {
      return filterResult.response;
    }

    // 管线步骤 3: 消息去重（检查 + 立即标记）
    const dedupeResult = this.checkDuplication(messageData);
    if (!dedupeResult.continue) {
      return dedupeResult.response;
    }
    // 立即标记为已处理，防止企微重试导致重复处理
    this.deduplicationService.markMessageAsProcessed(messageData.messageId);

    // 管线步骤 4: 记录监控
    this.recordMessageReceived(messageData);

    // 管线步骤 5: 分派处理（聚合 or 直接处理）
    // 🚀 关键优化：不等待处理完成，立即返回响应
    this.dispatchMessage(messageData).catch((error) => {
      this.logger.error(`[分派异常] 消息 [${messageData.messageId}] 分派失败: ${error.message}`);
    });

    // 立即返回成功，避免企微超时重试
    return { success: true, message: 'Message received' };
  }

  /**
   * 管线步骤 0: 处理 bot 自己发送的消息
   * 将 isSelf=true 的消息存储为 assistant 历史记录
   */
  private async handleSelfMessage(messageData: EnterpriseMessageCallbackDto): Promise<void> {
    const parsed = MessageParser.parse(messageData);
    const { chatId, content } = parsed;

    if (!content || content.trim().length === 0) {
      this.logger.debug(`[自发消息] 消息内容为空，跳过存储 [${messageData.messageId}]`);
      return;
    }

    // 存储为 assistant 消息（包含元数据）
    await this.historyService.addMessageToHistory(chatId, 'assistant', content, {
      messageId: messageData.messageId,
      candidateName: messageData.contactName,
      managerName: messageData.botUserId,
      orgId: messageData.orgId,
      botId: messageData.botId,
    });

    this.logger.log(
      `[自发消息] 已存储为 assistant 历史 [${messageData.messageId}]: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`,
    );
  }

  /**
   * 管线步骤 1: 检查 AI 回复开关
   */
  private checkAiReplySwitch(): PipelineResult {
    if (!this.enableAiReply) {
      this.logger.log(`[AI回复已禁用] 跳过消息处理`);
      return {
        continue: false,
        response: { success: true, message: 'AI reply disabled' },
      };
    }

    return { continue: true };
  }

  /**
   * 管线步骤 2: 消息过滤
   */
  private async filterMessage(messageData: EnterpriseMessageCallbackDto): Promise<PipelineResult> {
    const filterResult = await this.filterService.validate(messageData);

    if (!filterResult.pass) {
      return {
        continue: false,
        response: { success: true, message: `${filterResult.reason} ignored` },
      };
    }

    // 处理 historyOnly 模式（小组黑名单）：记录历史但不触发 AI 回复
    if (filterResult.historyOnly) {
      const parsed = MessageParser.parse(messageData);
      const { chatId, content, contactName } = parsed;

      // 记录到历史（包含元数据）
      await this.historyService.addMessageToHistory(chatId, 'user', content, {
        messageId: messageData.messageId,
        candidateName: messageData.contactName || contactName,
        managerName: messageData.botUserId,
        orgId: messageData.orgId,
        botId: messageData.botId,
      });

      this.logger.log(
        `[historyOnly] 消息已记录到历史但不触发AI回复 [${messageData.messageId}], ` +
          `chatId=${chatId}, contact=${contactName}, reason=${filterResult.reason}`,
      );

      return {
        continue: false,
        response: { success: true, message: 'Message recorded to history only' },
      };
    }

    return { continue: true };
  }

  /**
   * 管线步骤 3: 消息去重
   */
  private checkDuplication(messageData: EnterpriseMessageCallbackDto): PipelineResult {
    if (this.deduplicationService.isMessageProcessed(messageData.messageId)) {
      this.logger.log(`[消息去重] 消息 [${messageData.messageId}] 已处理过，跳过重复处理`);
      return {
        continue: false,
        response: { success: true, message: 'Duplicate message ignored' },
      };
    }

    return { continue: true };
  }

  /**
   * 管线步骤 4: 记录监控
   */
  private recordMessageReceived(messageData: EnterpriseMessageCallbackDto): void {
    const parsed = MessageParser.parse(messageData);
    const scenario = MessageParser.determineScenario(messageData);
    this.monitoringService.recordMessageReceived(
      messageData.messageId,
      parsed.chatId,
      parsed.imContactId,
      parsed.contactName,
      parsed.content,
      { scenario },
      parsed.managerName,
    );
  }

  /**
   * 管线步骤 5: 分派消息（聚合 or 直接处理）
   */
  private async dispatchMessage(messageData: EnterpriseMessageCallbackDto): Promise<void> {
    if (this.enableMessageMerge) {
      // 启用消息聚合：交给 MergeService 处理
      // MergeService 会在聚合完成后将任务添加到 Bull 队列
      this.mergeService.handleMessage(messageData).catch((error) => {
        this.logger.error(`[聚合调度] 处理消息 [${messageData.messageId}] 失败: ${error.message}`);
      });
      return;
    }

    // 未启用聚合：直接处理
    this.processingCount++;
    this.processSingleMessage(messageData)
      .catch((error) => {
        this.logger.error(`异步处理消息失败 [${messageData.messageId}]:`, error.message);
      })
      .finally(() => {
        this.processingCount--;
      });
  }

  /**
   * 处理单条消息（直发路径）
   */
  private async processSingleMessage(messageData: EnterpriseMessageCallbackDto): Promise<void> {
    const parsed = MessageParser.parse(messageData);
    const { chatId, content, contactName, messageId } = parsed;
    const scenario = MessageParser.determineScenario(messageData);

    try {
      // 1. 获取历史消息
      const historyMessages = await this.historyService.getHistory(chatId);

      // 2. 添加当前消息到历史（包含元数据）
      await this.historyService.addMessageToHistory(chatId, 'user', content, {
        messageId: messageData.messageId,
        candidateName: messageData.contactName || contactName,
        managerName: messageData.botUserId,
        orgId: messageData.orgId,
        botId: messageData.botId,
      });

      // 3. 调用 Agent
      const agentResult = await this.agentGateway.invoke({
        conversationId: chatId,
        userMessage: content,
        historyMessages,
        scenario,
        messageId,
        recordMonitoring: true,
      });

      // 注意：assistant 消息历史由 isSelf=true 的回调存储，这里不再重复存储

      this.logger.log(
        `[${contactName}] Agent 处理完成，耗时 ${agentResult.processingTime}ms，` +
          `tokens=${agentResult.reply.usage?.totalTokens || 'N/A'}`,
      );

      // 5. 发送回复
      const deliveryContext = this.buildDeliveryContext(parsed);
      const deliveryResult = await this.deliveryService.deliverReply(
        agentResult.reply,
        deliveryContext,
        true,
      );

      // 7. 记录成功
      this.monitoringService.recordSuccess(messageId, {
        scenario,
        tools: agentResult.reply.tools?.used,
        tokenUsage: agentResult.reply.usage?.totalTokens,
        replyPreview: agentResult.reply.content,
        replySegments: deliveryResult.segmentCount,
        isFallback: agentResult.isFallback,
        rawAgentResponse: {
          content: agentResult.reply.content,
          usage: agentResult.reply.usage,
          tools: agentResult.reply.tools,
          isFallback: agentResult.isFallback,
          fallbackReason: agentResult.result.fallbackInfo?.reason,
        },
      });

      // 8. 标记消息为已处理（直发路径）
      this.deduplicationService.markMessageAsProcessed(messageId);
      this.logger.debug(`[${contactName}] 消息 [${messageId}] 已标记为已处理`);
    } catch (error) {
      // 【修复】区分 Agent API 错误和其他消息处理错误
      const errorType: AlertErrorType = this.isAgentError(error) ? 'agent' : 'message';
      await this.handleProcessingError(error, parsed, { errorType, scenario });
    }
  }

  /**
   * 处理聚合后的消息（聚合路径）
   * 简化版：去除重试循环，由 MessageMergeService 管理重试
   */
  private async processMergedMessages(messages: EnterpriseMessageCallbackDto[]): Promise<void> {
    if (messages.length === 0) return;

    this.processingCount++;
    const scenario = MessageParser.determineScenario(messages[0]);

    try {
      const parsed = MessageParser.parse(messages[0]);
      const { chatId, contactName } = parsed;
      const scenario = MessageParser.determineScenario(messages[0]);

      this.logger.log(`[聚合处理][${chatId}] 处理 ${messages.length} 条消息`);

      // 1. 将所有消息添加到历史（除了最后一条，留给 Agent 作为 userMessage）
      for (let i = 0; i < messages.length - 1; i++) {
        const content = MessageParser.extractContent(messages[i]);
        const msg = messages[i];
        await this.historyService.addMessageToHistory(chatId, 'user', content, {
          messageId: msg.messageId,
          candidateName: msg.contactName,
          managerName: msg.botUserId,
          orgId: msg.orgId,
          botId: msg.botId,
        });
      }

      // 2. 获取历史消息
      const historyMessages = await this.historyService.getHistory(chatId);

      // 3. 最后一条消息作为 userMessage
      const lastMessage = messages[messages.length - 1];
      const lastContent = MessageParser.extractContent(lastMessage);

      // 4. 调用 Agent（最后一条消息记录监控，获取 AI 耗时）
      const lastMessageId = lastMessage.messageId;
      const agentResult = await this.agentGateway.invoke({
        conversationId: chatId,
        userMessage: lastContent,
        historyMessages,
        scenario,
        recordMonitoring: true, // 聚合路径记录最后一条消息的监控
        messageId: lastMessageId,
      });

      // 6. 将最后一条用户消息添加到历史（包含元数据）
      // 注意：assistant 消息历史由 isSelf=true 的回调存储，这里不再重复存储
      await this.historyService.addMessageToHistory(chatId, 'user', lastContent, {
        messageId: lastMessage.messageId,
        candidateName: lastMessage.contactName,
        managerName: lastMessage.botUserId,
        orgId: lastMessage.orgId,
        botId: lastMessage.botId,
      });

      this.logger.log(
        `[聚合处理][${contactName}] Agent 处理完成，耗时 ${agentResult.processingTime}ms`,
      );

      // 7. 先重置会话状态为 IDLE，再发送回复（避免竞态条件）
      await this.mergeService.resetToIdle(chatId);

      // 8. 发送回复
      const deliveryContext = this.buildDeliveryContext(MessageParser.parse(lastMessage));
      const deliveryResult = await this.deliveryService.deliverReply(
        agentResult.reply,
        deliveryContext,
        false,
      );

      // 9. 【修复】标记所有聚合的消息为已处理，并记录监控成功
      const sharedSuccessMetadata = {
        scenario,
        tools: agentResult.reply.tools?.used,
        tokenUsage: agentResult.reply.usage?.totalTokens,
        replyPreview: agentResult.reply.content,
        replySegments: deliveryResult.segmentCount,
        isFallback: agentResult.isFallback,
        rawAgentResponse: {
          content: agentResult.reply.content,
          usage: agentResult.reply.usage,
          tools: agentResult.reply.tools,
          isFallback: agentResult.isFallback,
          fallbackReason: agentResult.result.fallbackInfo?.reason,
        },
      };
      for (const message of messages) {
        this.deduplicationService.markMessageAsProcessed(message.messageId);
        // 记录监控成功（所有消息都标记为成功）
        this.monitoringService.recordSuccess(
          message.messageId,
          message.messageId === lastMessageId ? sharedSuccessMetadata : { scenario },
        );
      }
      this.logger.debug(`[聚合处理][${chatId}] 已标记 ${messages.length} 条消息为已处理`);
    } catch (error) {
      this.logger.error(`聚合消息处理失败:`, error.message);

      const fallbackTarget =
        messages.length > 0 ? MessageParser.parse(messages[messages.length - 1]) : null;
      if (fallbackTarget) {
        // 【修复】区分 Agent API 错误和消息合并错误
        const errorType: AlertErrorType = this.isAgentError(error) ? 'agent' : 'merge';
        await this.handleProcessingError(error, fallbackTarget, {
          errorType,
          scenario,
        });
        // 【修复】标记所有消息为已处理，并记录监控失败（使用正确的错误类型）
        const handledMessageId = fallbackTarget.messageId;
        for (const message of messages) {
          if (message.messageId === handledMessageId) {
            continue;
          }
          this.deduplicationService.markMessageAsProcessed(message.messageId);
          this.monitoringService.recordFailure(message.messageId, error.message || '聚合处理失败', {
            scenario,
            alertType: errorType, // 使用智能判断的错误类型
          });
        }
      }

      const chatId = messages.length > 0 ? MessageParser.parse(messages[0]).chatId : 'unknown';
      if (chatId !== 'unknown') {
        await this.mergeService.resetToIdle(chatId);
      }
    } finally {
      this.processingCount--;
    }
  }

  /**
   * 判断错误是否为 Agent API 错误
   */
  private isAgentError(error: any): boolean {
    return error instanceof AgentException || Boolean((error as any)?.isAgentError);
  }

  /**
   * 处理错误并发送降级回复
   */
  private async handleProcessingError(
    error: any,
    parsed: any,
    options?: { errorType?: AlertErrorType; scenario?: ScenarioType },
  ): Promise<void> {
    const {
      chatId,
      content,
      contactName,
      messageId,
      token,
      imBotId,
      imContactId,
      imRoomId,
      _apiType,
    } = parsed;
    const scenario = options?.scenario || MessageParser.determineScenario();
    const errorType: AlertErrorType = options?.errorType || 'message';

    this.logger.error(`[${contactName}] 消息处理失败 [${messageId}]: ${error.message}`);

    // 记录失败
    this.monitoringService.recordFailure(messageId, error.message, {
      scenario,
      alertType: errorType, // 记录错误类型，确保根因（如401认证失败）被正确追踪
    });

    // 发送告警
    const fallbackMessage = this.agentGateway.getFallbackMessage();

    this.alertService
      .sendAlert({
        errorType,
        error,
        conversationId: chatId,
        userMessage: content,
        apiEndpoint: '/api/v1/chat',
        scenario,
        fallbackMessage,
      })
      .catch((alertError) => {
        this.logger.error(`告警发送失败: ${alertError.message}`);
      });

    // 发送降级回复
    try {
      const deliveryContext: DeliveryContext = {
        token,
        imBotId,
        imContactId,
        imRoomId,
        contactName,
        messageId,
        chatId,
        _apiType, // 传递 API 类型标记
      };

      await this.deliveryService.deliverReply(
        {
          content: fallbackMessage,
          rawResponse: {} as any,
        },
        deliveryContext,
        false,
      );

      this.logger.log(`[${contactName}] 已发送降级回复: "${fallbackMessage}"`);

      // 降级回复成功后，标记消息为已处理
      this.deduplicationService.markMessageAsProcessed(messageId);
    } catch (sendError) {
      this.logger.error(`[${contactName}] 发送降级回复失败: ${sendError.message}`);
    }
  }

  /**
   * 构建发送上下文
   */
  private buildDeliveryContext(parsed: any): DeliveryContext {
    return {
      token: parsed.token,
      imBotId: parsed.imBotId,
      imContactId: parsed.imContactId,
      imRoomId: parsed.imRoomId,
      contactName: parsed.contactName || '客户',
      messageId: parsed.messageId,
      chatId: parsed.chatId,
      _apiType: parsed._apiType, // 传递 API 类型标记（小组级 or 企业级）
    };
  }

  /**
   * 处理发送结果回调
   */
  async handleSentResult(resultData: any) {
    this.logger.debug(`收到发送结果回调: ${resultData?.requestId || 'N/A'}`);
    return { success: true };
  }

  /**
   * 获取服务状态
   */
  getServiceStatus() {
    return this.statisticsService.getServiceStatus(
      this.processingCount,
      0,
      this.enableAiReply,
      this.enableMessageMerge,
      true, // enableMessageSplitSend - 默认启用
    );
  }

  /**
   * 获取 AI 回复开关状态
   */
  getAiReplyStatus(): boolean {
    return this.enableAiReply;
  }

  /**
   * 切换 AI 回复开关（持久化到 Supabase）
   */
  async toggleAiReply(enabled: boolean): Promise<boolean> {
    this.enableAiReply = enabled;

    // 持久化到 Supabase
    await this.supabaseService.setAiReplyEnabled(enabled);

    this.logger.log(`AI 自动回复功能已${enabled ? '启用' : '禁用'} (已持久化到 Supabase)`);
    return this.enableAiReply;
  }

  /**
   * 获取缓存统计
   */
  getCacheStats() {
    return this.statisticsService.getCacheStats(this.processingCount, 0);
  }

  /**
   * 获取历史记录
   */
  async getAllHistory(chatId?: string) {
    if (chatId) {
      const detail = await this.historyService.getHistoryDetail(chatId);
      if (detail) {
        return {
          chatId,
          messages: detail.messages,
          count: detail.messageCount,
        };
      }
      return {
        chatId,
        messages: [],
        count: 0,
      };
    }

    // Redis 模式下不支持获取所有历史，返回统计信息
    return this.historyService.getStats();
  }

  /**
   * 清理缓存
   */
  clearCache(options?: {
    deduplication?: boolean;
    history?: boolean;
    mergeQueues?: boolean;
    chatId?: string;
  }) {
    return this.statisticsService.clearCache(options);
  }
}
