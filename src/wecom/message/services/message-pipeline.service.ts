import { Injectable, Logger } from '@nestjs/common';
import { MonitoringService } from '@/core/monitoring/monitoring.service';
import { FeishuAlertService } from '@core/feishu';
import { ScenarioType } from '@agent';
import { AgentException } from '@/agent/utils/agent-exceptions';

// 导入子服务
import { MessageDeduplicationService } from './message-deduplication.service';
import { MessageHistoryService } from './message-history.service';
import { MessageFilterService } from './message-filter.service';
import { MessageDeliveryService } from './message-delivery.service';
import { AgentGatewayService } from './message-agent-gateway.service';

// 导入工具和类型
import { MessageParser } from '../utils/message-parser.util';
import { EnterpriseMessageCallbackDto } from '../dto/message-callback.dto';
import { DeliveryContext, PipelineResult, AlertErrorType } from '../types';

/**
 * 消息处理管线服务
 *
 * 职责：
 * 1. 管线步骤：过滤 → 去重 → 历史记录 → 监控
 * 2. 单消息处理（直发路径）
 * 3. 聚合消息处理（聚合路径）
 * 4. 错误处理和降级回复
 *
 * 从 MessageService 拆分，专注于消息处理逻辑
 */
@Injectable()
export class MessagePipelineService {
  private readonly logger = new Logger(MessagePipelineService.name);

  constructor(
    // 子服务
    private readonly deduplicationService: MessageDeduplicationService,
    private readonly historyService: MessageHistoryService,
    private readonly filterService: MessageFilterService,
    private readonly deliveryService: MessageDeliveryService,
    private readonly agentGateway: AgentGatewayService,
    // 监控和告警
    private readonly monitoringService: MonitoringService,
    private readonly feishuAlertService: FeishuAlertService,
  ) {}

  // ========================================
  // 管线步骤
  // ========================================

  /**
   * 管线步骤 0: 处理 bot 自己发送的消息
   * 将 isSelf=true 的消息存储为 assistant 历史记录
   */
  async handleSelfMessage(messageData: EnterpriseMessageCallbackDto): Promise<void> {
    const parsed = MessageParser.parse(messageData);
    const { chatId, content } = parsed;

    if (!content || content.trim().length === 0) {
      this.logger.debug(`[自发消息] 消息内容为空，跳过存储 [${messageData.messageId}]`);
      return;
    }

    // 从历史记录中获取候选人昵称（因为 isSelf=true 时 contactName 是招募经理的名字）
    const candidateName = await this.getCandidateNameFromHistory(chatId);

    // 存储为 assistant 消息（包含元数据）
    const isRoom = Boolean(messageData.imRoomId);
    await this.historyService.addMessageToHistory(chatId, 'assistant', content, {
      messageId: messageData.messageId,
      candidateName,
      managerName: messageData.contactName || messageData.botUserId,
      orgId: messageData.orgId,
      botId: messageData.botId,
      messageType: messageData.messageType,
      source: messageData.source,
      isRoom,
      imBotId: messageData.imBotId,
      imContactId: messageData.imContactId,
      contactType: messageData.contactType,
      isSelf: messageData.isSelf,
      payload: messageData.payload as Record<string, unknown>,
      avatar: messageData.avatar,
      externalUserId: messageData.externalUserId,
    });

    this.logger.log(
      `[自发消息] 已存储为 assistant 历史 [${messageData.messageId}]: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`,
    );
  }

  /**
   * 管线步骤 1: 消息过滤
   */
  async filterMessage(
    messageData: EnterpriseMessageCallbackDto,
  ): Promise<PipelineResult<{ content?: string }>> {
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
      const isRoom = Boolean(messageData.imRoomId);

      await this.historyService.addMessageToHistory(chatId, 'user', content, {
        messageId: messageData.messageId,
        candidateName: messageData.contactName || contactName,
        managerName: messageData.botUserId,
        orgId: messageData.orgId,
        botId: messageData.botId,
        messageType: messageData.messageType,
        source: messageData.source,
        isRoom,
        imBotId: messageData.imBotId,
        imContactId: messageData.imContactId,
        contactType: messageData.contactType,
        isSelf: messageData.isSelf,
        payload: messageData.payload as Record<string, unknown>,
        avatar: messageData.avatar,
        externalUserId: messageData.externalUserId,
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

    return { continue: true, data: { content: filterResult.content } };
  }

  /**
   * 管线步骤 2: 消息去重（异步版本，使用 Redis）
   */
  async checkDuplicationAsync(messageData: EnterpriseMessageCallbackDto): Promise<PipelineResult> {
    const isProcessed = await this.deduplicationService.isMessageProcessedAsync(
      messageData.messageId,
    );
    if (isProcessed) {
      this.logger.log(`[消息去重] 消息 [${messageData.messageId}] 已处理过，跳过重复处理`);
      return {
        continue: false,
        response: { success: true, message: 'Duplicate message ignored' },
      };
    }

    return { continue: true };
  }

  /**
   * 管线步骤 3: 将用户消息记录到历史
   */
  async recordUserMessageToHistory(
    messageData: EnterpriseMessageCallbackDto,
    contentFromFilter?: string,
  ): Promise<void> {
    const parsed = MessageParser.parse(messageData);
    const { chatId, contactName } = parsed;
    const content = contentFromFilter ?? parsed.content;
    const isRoom = Boolean(messageData.imRoomId);

    if (!content || content.trim().length === 0) {
      this.logger.debug(`[历史记录] 消息内容为空，跳过记录历史 [${messageData.messageId}]`);
      return;
    }

    await this.historyService.addMessageToHistory(chatId, 'user', content, {
      messageId: messageData.messageId,
      candidateName: messageData.contactName || contactName,
      managerName: messageData.botUserId,
      orgId: messageData.orgId,
      botId: messageData.botId,
      messageType: messageData.messageType,
      source: messageData.source,
      isRoom,
      imBotId: messageData.imBotId,
      imContactId: messageData.imContactId,
      contactType: messageData.contactType,
      isSelf: messageData.isSelf,
      payload: messageData.payload as Record<string, unknown>,
      avatar: messageData.avatar,
      externalUserId: messageData.externalUserId,
    });
  }

  /**
   * 管线步骤 4: 记录监控
   */
  recordMessageReceived(messageData: EnterpriseMessageCallbackDto): void {
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

  // ========================================
  // 消息处理
  // ========================================

  /**
   * 处理单条消息（直发路径）
   */
  async processSingleMessage(messageData: EnterpriseMessageCallbackDto): Promise<void> {
    const parsed = MessageParser.parse(messageData);
    const { chatId, content, contactName, messageId } = parsed;
    const scenario = MessageParser.determineScenario(messageData);

    try {
      // 1. 获取历史消息（已预先写入当前消息，此处排除当前消息）
      const historyMessages = await this.historyService.getHistoryForContext(chatId, messageId);

      // 2. 调用 Agent
      const agentResult = await this.agentGateway.invoke({
        conversationId: chatId,
        userMessage: content,
        historyMessages,
        scenario,
        messageId,
        recordMonitoring: true,
      });

      this.logger.log(
        `[${contactName}] Agent 处理完成，耗时 ${agentResult.processingTime}ms，` +
          `tokens=${agentResult.reply.usage?.totalTokens || 'N/A'}`,
      );

      // 3. 发送回复
      const deliveryContext = this.buildDeliveryContext(parsed);
      const deliveryResult = await this.deliveryService.deliverReply(
        agentResult.reply,
        deliveryContext,
        true,
      );

      // 4. 记录成功
      const rawResponse = agentResult.reply.rawResponse;
      this.monitoringService.recordSuccess(messageId, {
        scenario,
        tools: agentResult.reply.tools?.used,
        tokenUsage: agentResult.reply.usage?.totalTokens,
        replyPreview: agentResult.reply.content,
        replySegments: deliveryResult.segmentCount,
        isFallback: agentResult.isFallback,
        rawAgentResponse: rawResponse
          ? {
              input: {
                conversationId: chatId,
                userMessage: content,
                historyCount: historyMessages.length,
              },
              messages: rawResponse.messages,
              usage: rawResponse.usage,
              tools: rawResponse.tools,
              isFallback: agentResult.isFallback,
              fallbackReason: agentResult.result.fallbackInfo?.reason,
            }
          : undefined,
      });

      // 5. 标记消息为已处理
      await this.deduplicationService.markMessageAsProcessedAsync(messageId);
      this.logger.debug(`[${contactName}] 消息 [${messageId}] 已标记为已处理`);
    } catch (error) {
      const errorType: AlertErrorType = this.isAgentError(error) ? 'agent' : 'message';
      await this.handleProcessingError(error, parsed, { errorType, scenario });
    }
  }

  /**
   * 处理聚合后的消息（聚合路径）
   * 由 MessageProcessor 调用
   */
  async processMergedMessages(messages: EnterpriseMessageCallbackDto[]): Promise<void> {
    if (messages.length === 0) return;

    const scenario = MessageParser.determineScenario(messages[0]);

    try {
      const parsed = MessageParser.parse(messages[0]);
      const { chatId, contactName } = parsed;

      this.logger.log(`[聚合处理][${chatId}] 处理 ${messages.length} 条消息`);

      // 1. 获取历史消息
      const lastMessage = messages[messages.length - 1];
      const historyMessages = await this.historyService.getHistoryForContext(
        chatId,
        lastMessage.messageId,
      );

      // 2. 最后一条消息作为 userMessage
      const lastContent = MessageParser.extractContent(lastMessage);

      // 3. 调用 Agent
      const lastMessageId = lastMessage.messageId;
      const agentResult = await this.agentGateway.invoke({
        conversationId: chatId,
        userMessage: lastContent,
        historyMessages,
        scenario,
        recordMonitoring: true,
        messageId: lastMessageId,
      });

      this.logger.log(
        `[聚合处理][${contactName}] Agent 处理完成，耗时 ${agentResult.processingTime}ms`,
      );

      // 4. 发送回复
      const deliveryContext = this.buildDeliveryContext(MessageParser.parse(lastMessage));
      const deliveryResult = await this.deliveryService.deliverReply(
        agentResult.reply,
        deliveryContext,
        false,
      );

      // 5. 标记所有聚合的消息为已处理
      const rawResponse = agentResult.reply.rawResponse;
      const sharedSuccessMetadata = {
        scenario,
        tools: agentResult.reply.tools?.used,
        tokenUsage: agentResult.reply.usage?.totalTokens,
        replyPreview: agentResult.reply.content,
        replySegments: deliveryResult.segmentCount,
        isFallback: agentResult.isFallback,
        rawAgentResponse: rawResponse
          ? {
              input: {
                conversationId: chatId,
                userMessage: lastContent,
                historyCount: historyMessages.length,
              },
              messages: rawResponse.messages,
              usage: rawResponse.usage,
              tools: rawResponse.tools,
              isFallback: agentResult.isFallback,
              fallbackReason: agentResult.result.fallbackInfo?.reason,
            }
          : undefined,
      };

      await Promise.all(
        messages.map(async (message) => {
          await this.deduplicationService.markMessageAsProcessedAsync(message.messageId);
          this.monitoringService.recordSuccess(
            message.messageId,
            message.messageId === lastMessageId ? sharedSuccessMetadata : { scenario },
          );
        }),
      );

      this.logger.debug(`[聚合处理][${chatId}] 已标记 ${messages.length} 条消息为已处理`);
    } catch (error) {
      this.logger.error(`聚合消息处理失败:`, error.message);

      const fallbackTarget =
        messages.length > 0 ? MessageParser.parse(messages[messages.length - 1]) : null;

      if (fallbackTarget) {
        const errorType: AlertErrorType = this.isAgentError(error) ? 'agent' : 'merge';
        await this.handleProcessingError(error, fallbackTarget, { errorType, scenario });

        const handledMessageId = fallbackTarget.messageId;
        await Promise.all(
          messages
            .filter((m) => m.messageId !== handledMessageId)
            .map(async (message) => {
              await this.deduplicationService.markMessageAsProcessedAsync(message.messageId);
              this.monitoringService.recordFailure(
                message.messageId,
                error.message || '聚合处理失败',
                { scenario, alertType: errorType },
              );
            }),
        );
      }

      throw error;
    }
  }

  // ========================================
  // 辅助方法
  // ========================================

  /**
   * 判断错误是否为 Agent API 错误
   */
  private isAgentError(error: unknown): boolean {
    return (
      error instanceof AgentException ||
      Boolean((error as { isAgentError?: boolean })?.isAgentError)
    );
  }

  /**
   * 处理错误并发送降级回复
   */
  private async handleProcessingError(
    error: unknown,
    parsed: ReturnType<typeof MessageParser.parse>,
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
    const errorMessage = error instanceof Error ? error.message : String(error);

    this.logger.error(`[${contactName}] 消息处理失败 [${messageId}]: ${errorMessage}`);

    // 记录失败
    this.monitoringService.recordFailure(messageId, errorMessage, {
      scenario,
      alertType: errorType,
    });

    // 发送告警
    const fallbackMessage = this.agentGateway.getFallbackMessage();

    this.feishuAlertService
      .sendAlert({
        errorType,
        error: error instanceof Error ? error : new Error(errorMessage),
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
        _apiType,
      };

      await this.deliveryService.deliverReply(
        {
          content: fallbackMessage,
          rawResponse: undefined,
        },
        deliveryContext,
        false,
      );

      this.logger.log(`[${contactName}] 已发送降级回复: "${fallbackMessage}"`);

      // 标记消息为已处理
      await this.deduplicationService.markMessageAsProcessedAsync(messageId);
    } catch (sendError) {
      const sendErrorMessage = sendError instanceof Error ? sendError.message : String(sendError);
      this.logger.error(`[${contactName}] 发送降级回复失败: ${sendErrorMessage}`);
    }
  }

  /**
   * 构建发送上下文
   */
  private buildDeliveryContext(parsed: ReturnType<typeof MessageParser.parse>): DeliveryContext {
    return {
      token: parsed.token,
      imBotId: parsed.imBotId,
      imContactId: parsed.imContactId,
      imRoomId: parsed.imRoomId,
      contactName: parsed.contactName || '客户',
      messageId: parsed.messageId,
      chatId: parsed.chatId,
      _apiType: parsed._apiType,
    };
  }

  /**
   * 从历史记录中获取候选人昵称
   */
  private async getCandidateNameFromHistory(chatId: string): Promise<string | undefined> {
    try {
      const detail = await this.historyService.getHistoryDetail(chatId);
      if (!detail?.messages) {
        return undefined;
      }
      const userMessage = detail.messages.find((m) => m.role === 'user' && m.candidateName);
      return userMessage?.candidateName;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.debug(`获取候选人昵称失败 [${chatId}]: ${errorMessage}`);
      return undefined;
    }
  }
}
