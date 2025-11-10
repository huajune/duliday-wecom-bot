import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentService, AgentConfigService } from '@agent';
import { MessageSenderService } from '../message-sender/message-sender.service';
import { MessageType as SendMessageType } from '../message-sender/dto/send-message.dto';
import {
  EnterpriseMessageCallbackDto,
  getMessageSourceDescription,
} from './dto/message-callback.dto';

// 导入新创建的服务
import { MessageDeduplicationService } from './services/message-deduplication.service';
import { MessageHistoryService } from './services/message-history.service';
import { MessageFilterService } from './services/message-filter.service';
import { MessageMergeService } from './services/message-merge.service';
import { MessageStatisticsService } from './services/message-statistics.service';

// 导入工具类
import { MessageParser } from './utils/message-parser.util';
import { MessageSplitter } from './utils/message-splitter.util';

// 导入监控服务
import { MonitoringService } from '@/core/monitoring/monitoring.service';

/**
 * 消息处理服务（重构版）
 * 职责：协调各个子服务，处理主业务流程
 *
 * 重构说明：
 * - 从 1099 行精简到 ~300 行
 * - 将职责拆分到 5 个子服务
 * - 提高代码可测试性和可维护性
 */
@Injectable()
export class MessageService {
  private readonly logger = new Logger(MessageService.name);
  private readonly enableAiReply: boolean;
  private readonly enableMessageMerge: boolean;
  private readonly enableMessageSplitSend: boolean;
  private readonly messageSendDelay: number;

  // 监控统计：跟踪正在处理的消息数（用于监控，不做并发限制）
  private processingCount: number = 0;

  constructor(
    // 原有依赖
    private readonly messageSenderService: MessageSenderService,
    private readonly agentService: AgentService,
    private readonly agentConfigService: AgentConfigService,
    private readonly configService: ConfigService,
    // 新的子服务
    private readonly deduplicationService: MessageDeduplicationService,
    private readonly historyService: MessageHistoryService,
    private readonly filterService: MessageFilterService,
    private readonly mergeService: MessageMergeService,
    private readonly statisticsService: MessageStatisticsService,
    // 监控服务
    private readonly monitoringService: MonitoringService,
  ) {
    // 从环境变量读取配置
    this.enableAiReply = this.configService.get<string>('ENABLE_AI_REPLY', 'true') === 'true';
    this.enableMessageMerge =
      this.configService.get<string>('ENABLE_MESSAGE_MERGE', 'true') === 'true';
    this.enableMessageSplitSend =
      this.configService.get<string>('ENABLE_MESSAGE_SPLIT_SEND', 'true') === 'true';
    this.messageSendDelay = this.configService.get<number>('MESSAGE_SEND_DELAY', 1500);

    this.logger.log(`AI 自动回复功能: ${this.enableAiReply ? '已启用' : '已禁用'}`);
    this.logger.log(`消息聚合功能: ${this.enableMessageMerge ? '已启用' : '已禁用'}`);
    this.logger.log(`消息分段发送功能: ${this.enableMessageSplitSend ? '已启用' : '已禁用'}`);
    this.logger.log(`消息发送延迟: ${this.messageSendDelay}ms`);
  }

  /**
   * 处理接收到的消息（主入口）
   * 快速响应模式：立即返回成功响应，避免企微回调超时重试
   */
  async handleMessage(messageData: EnterpriseMessageCallbackDto) {
    // 打印原始回调消息数据结构
    this.logger.log('=== [回调消息原始数据] ===');
    this.logger.log(JSON.stringify(messageData, null, 2));

    this.logger.log(
      `[handleMessage] 收到消息 [${messageData.messageId}], source=${messageData.source}(${getMessageSourceDescription(messageData.source)}), isSelf=${messageData.isSelf}, enableAiReply=${this.enableAiReply}`,
    );

    // 1. 检查 AI 回复是否启用
    if (!this.enableAiReply) {
      this.logger.log(`[AI回复已禁用] 跳过消息 [${messageData.messageId}]`);
      return { success: true, message: 'AI reply disabled' };
    }

    // 2. 消息过滤（委托给 FilterService）
    const filterResult = this.filterService.validate(messageData);
    if (!filterResult.pass) {
      // 日志已在 FilterService 中记录
      return { success: true, message: `${filterResult.reason} ignored` };
    }

    // 3. 消息去重检查（委托给 DeduplicationService）
    if (this.deduplicationService.isMessageProcessed(messageData.messageId)) {
      this.logger.log(`[消息去重] 消息 [${messageData.messageId}] 已处理过，跳过重复处理`);
      return { success: true, message: 'Duplicate message ignored' };
    }

    // 4. 标记消息为已处理（在入队列前标记，避免重复入队）
    this.deduplicationService.markMessageAsProcessed(messageData.messageId);

    // 5. 【监控埋点】记录消息接收
    const parsedForMonitoring = MessageParser.parse(messageData);
    this.monitoringService.recordMessageReceived(
      messageData.messageId,
      parsedForMonitoring.chatId,
      parsedForMonitoring.imContactId,
      parsedForMonitoring.contactName,
      parsedForMonitoring.content,
    );

    // 6. 处理消息（智能聚合 或 直接处理）
    if (this.enableMessageMerge) {
      // 启用智能消息聚合：交给 MergeService 处理
      await this.mergeService.handleMessage(messageData, (messages) =>
        this.processMergedMessages(messages),
      );
    } else {
      // 未启用消息聚合：直接处理
      this.processingCount++;

      this.processMessageWithAI(messageData)
        .catch((error) => {
          this.logger.error(`异步处理消息失败 [${messageData.messageId}]:`, error.message);
        })
        .finally(() => {
          this.processingCount--;
        });
    }

    // 立即返回成功，避免企微超时重试
    return { success: true, message: 'Message received' };
  }

  /**
   * 使用 AI 处理单条消息并自动回复
   * 注意：此方法假设消息已经通过 handleMessage 的前置过滤和去重检查，不再重复检查
   * @param messageData 消息数据
   * @param skipCheckRetry 是否跳过检查重试（聚合流程中使用循环控制重试）
   */
  private async processMessageWithAI(
    messageData: EnterpriseMessageCallbackDto,
    skipCheckRetry: boolean = false,
  ) {
    const scenarioType = '私聊';
    let contactName = '未知用户';
    let messageId = 'unknown';
    let chatId = 'unknown';

    try {
      // 解析消息数据
      const parsedData = MessageParser.parse(messageData);
      const { content, imBotId, imContactId, imRoomId, token } = parsedData;
      chatId = parsedData.chatId; // 更新 chatId 以便在 catch 块中使用

      // 打印解析后的数据
      this.logger.log('=== [解析后的消息数据] ===');
      this.logger.log(
        JSON.stringify(
          {
            token,
            chatId,
            imBotId,
            imContactId,
            imRoomId,
            content: content.substring(0, 100),
          },
          null,
          2,
        ),
      );

      // 保存到外部作用域，供catch使用
      contactName = parsedData.contactName || '客户';
      messageId = parsedData.messageId;

      // 直接使用 chatId 作为会话标识
      const conversationId = chatId;

      this.logger.log(
        `[${scenarioType}][${contactName}] 收到: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`,
      );

      // 1. 根据场景选择合适的 Agent 配置
      const scenario = MessageParser.determineScenario();
      const agentProfile = this.agentConfigService.getProfile(scenario);

      if (!agentProfile) {
        this.logger.error(`无法获取场景 ${scenario} 的 Agent 配置`);
        return;
      }

      // 2. 验证配置有效性
      const validation = this.agentConfigService.validateProfile(agentProfile);
      if (!validation.valid) {
        this.logger.error(`Agent 配置验证失败: ${validation.errors.join(', ')}`);
        return;
      }

      // 3. 获取会话历史消息（委托给 HistoryService）
      const historyMessages = this.historyService.getHistory(chatId);

      // 4. 添加当前用户消息到历史（委托给 HistoryService）
      this.historyService.addMessageToHistory(chatId, 'user', content);

      // 5. 【监控埋点】AI 处理开始
      this.monitoringService.recordAiStart(messageId);

      // 6. 调用 Agent API 生成回复
      const aiResponse = await this.agentService.chat({
        conversationId,
        userMessage: content,
        historyMessages,
        model: agentProfile.model,
        systemPrompt: agentProfile.systemPrompt,
        promptType: agentProfile.promptType,
        allowedTools: agentProfile.allowedTools,
        context: agentProfile.context,
        toolContext: agentProfile.toolContext,
        contextStrategy: agentProfile.contextStrategy,
        prune: agentProfile.prune,
        pruneOptions: agentProfile.pruneOptions,
      });

      // 7. 【监控埋点】AI 处理完成
      this.monitoringService.recordAiEnd(messageId);

      // 8. 提取回复内容
      const replyContent = this.extractReplyContent(aiResponse);

      // 9. 将 AI 回复添加到历史记录（委托给 HistoryService）
      this.historyService.addMessageToHistory(chatId, 'assistant', replyContent);

      // 8. 记录 token 使用情况和工具使用
      const tokenInfo = aiResponse.usage ? `tokens=${aiResponse.usage.totalTokens}` : 'tokens=N/A';
      const toolsInfo =
        aiResponse.tools?.used && aiResponse.tools.used.length > 0
          ? `, tools=${aiResponse.tools.used.length}`
          : '';

      this.logger.log(
        `[${scenarioType}][${contactName}] 回复: "${replyContent.substring(0, 50)}${replyContent.length > 50 ? '...' : ''}" (${tokenInfo}${toolsInfo})`,
      );

      // 10. 【监控埋点】消息发送开始
      this.monitoringService.recordSendStart(messageId);

      // 11. 发送回复消息（使用企业级接口 v2）
      // 检查是否启用消息分段发送功能，以及消息是否需要按双换行符或"～"拆分
      if (this.enableMessageSplitSend && MessageSplitter.needsSplit(replyContent)) {
        const segments = MessageSplitter.split(replyContent);
        this.logger.log(
          `[${scenarioType}][${contactName}] 消息包含双换行符或"～"，拆分为 ${segments.length} 条消息发送`,
        );
        this.logger.log(`[${scenarioType}][${contactName}] 原始消息: "${replyContent}"`);
        this.logger.log(`[${scenarioType}][${contactName}] 拆分结果: ${JSON.stringify(segments)}`);

        // 依次发送每个片段
        for (let i = 0; i < segments.length; i++) {
          const segment = segments[i];
          this.logger.log(
            `[${scenarioType}][${contactName}] 发送第 ${i + 1}/${segments.length} 条消息: "${segment.substring(0, 30)}${segment.length > 30 ? '...' : ''}"`,
          );

          try {
            await this.messageSenderService.sendMessage({
              token, // 企业级token
              imBotId, // 托管账号的系统wxid
              imContactId, // 私聊：客户的系统wxid
              imRoomId, // 群聊：群的系统wxid
              messageType: SendMessageType.TEXT, // TEXT = 7
              payload: {
                text: segment,
              },
            });

            this.logger.debug(
              `[${scenarioType}][${contactName}] 第 ${i + 1}/${segments.length} 条消息发送成功`,
            );

            // 添加延迟，确保消息按顺序到达
            if (i < segments.length - 1) {
              await new Promise((resolve) => setTimeout(resolve, this.messageSendDelay));
            }
          } catch (error) {
            this.logger.error(
              `[${scenarioType}][${contactName}] 第 ${i + 1}/${segments.length} 条消息发送失败: ${error.message}`,
            );
            // 发送失败时仍然继续发送后续消息
          }
        }

        this.logger.log(`[${scenarioType}][${contactName}] 已成功发送 ${segments.length} 条消息`);
      } else {
        // 未启用分段发送或不包含换行符，发送单条完整消息
        await this.messageSenderService.sendMessage({
          token, // 企业级token
          imBotId, // 托管账号的系统wxid
          imContactId, // 私聊：客户的系统wxid
          imRoomId, // 群聊：群的系统wxid
          messageType: SendMessageType.TEXT, // TEXT = 7
          payload: {
            text: replyContent,
          },
        });
      }

      // 12. 【监控埋点】消息发送完成
      this.monitoringService.recordSendEnd(messageId);

      // 13. 【监控埋点】记录处理成功
      this.monitoringService.recordSuccess(messageId);

      // 14. 智能聚合：通知 MergeService Agent 响应已完成（仅在非聚合流程中检查）
      // 聚合流程中由 processMergedMessages 循环控制重试
      if (this.enableMessageMerge && !skipCheckRetry) {
        const needRetry = await this.mergeService.onAgentResponseReceived(chatId, (messages) =>
          this.processMergedMessages(messages),
        );

        if (needRetry) {
          this.logger.log(
            `[${scenarioType}][${contactName}] Agent 响应后发现新消息，已触发重新处理`,
          );
          // 注意：processMergedMessages 会被 onAgentResponseReceived 调用，这里不需要额外操作
        }
      }
    } catch (error) {
      this.logger.error(
        `[${scenarioType}][${contactName}] 消息处理失败 [${messageId}]: ${error.message}`,
      );

      // 【监控埋点】记录处理失败
      this.monitoringService.recordFailure(messageId, error.message);

      // 不抛出错误，避免影响其他消息处理
    }
  }

  /**
   * 处理聚合后的消息
   * 策略：
   * 1. 一次性将初始消息添加到历史（避免重复写入）
   * 2. 调用 Agent 获取回复（不写入历史）
   * 3. **调用完成后再检查是否有新消息**
   * 4. 如果有新消息且未达到重试上限：丢弃回复，将新消息添加到历史，重新处理
   * 5. 如果没有新消息或已达到重试上限：将回复写入历史并发送
   */
  private async processMergedMessages(messages: EnterpriseMessageCallbackDto[]): Promise<void> {
    if (messages.length === 0) return;

    // 增加并发计数
    this.processingCount++;

    try {
      const chatId = MessageParser.parse(messages[0]).chatId;
      const maxRetry = this.configService.get<number>('MAX_RETRY_COUNT', 1);
      let retryCount = 0;
      let currentMessages = [...messages]; // 当前要处理的消息列表

      // 一次性写入初始用户消息到历史（避免重复写入）
      // 注意：只写入前 N-1 条消息，最后一条将作为 userMessage 传给 Agent
      for (let i = 0; i < currentMessages.length - 1; i++) {
        const content = MessageParser.extractContent(currentMessages[i]);
        this.historyService.addMessageToHistory(chatId, 'user', content);
        this.logger.debug(
          `[聚合处理][${chatId}] 消息 ${i + 1}/${currentMessages.length - 1} 已添加到历史: "${content.substring(0, 30)}..."`,
        );
      }
      this.logger.debug(
        `[聚合处理][${chatId}] 最后一条消息将作为 userMessage 传给 Agent（不提前写入历史）`,
      );

      while (true) {
        this.logger.log(
          `[聚合处理][${chatId}] 调用 Agent 处理 ${currentMessages.length} 条消息（重试 ${retryCount}/${maxRetry}）`,
        );

        // 调用 Agent 获取回复（不写入历史）
        const reply = await this.processMessagesAndGetReply(currentMessages, chatId);

        // Agent 调用完成后，检查是否有新消息
        const newMessages = this.mergeService.getPendingMessages(chatId);

        if (newMessages.length === 0) {
          // 没有新消息，将最后一条用户消息和回复写入历史并发送给用户
          this.logger.log(
            `[聚合处理][${chatId}] 没有新消息，写入最后一条用户消息和回复到历史并发送`,
          );
          const lastUserContent = MessageParser.extractContent(
            currentMessages[currentMessages.length - 1],
          );
          this.historyService.addMessageToHistory(chatId, 'user', lastUserContent);
          this.historyService.addMessageToHistory(chatId, 'assistant', reply.content);
          // 先重置会话状态为 IDLE，再发送回复（避免竞态条件）
          this.mergeService.resetToIdle(chatId);
          await this.sendReplyToUser(reply, currentMessages[currentMessages.length - 1]);
          break;
        }

        // 有新消息
        if (retryCount >= maxRetry) {
          // 已达到重试上限，将最后一条用户消息和回复写入历史并发送，忽略新消息
          this.logger.warn(
            `[聚合处理][${chatId}] 达到重试上限，写入最后一条用户消息和回复到历史并发送，忽略 ${newMessages.length} 条新消息`,
          );
          const lastUserContent = MessageParser.extractContent(
            currentMessages[currentMessages.length - 1],
          );
          this.historyService.addMessageToHistory(chatId, 'user', lastUserContent);
          this.historyService.addMessageToHistory(chatId, 'assistant', reply.content);
          // 先重置会话状态为 IDLE，再发送回复（避免竞态条件）
          // 这样在发送期间到达的新消息（如 msg7）会触发新的聚合流程
          this.mergeService.resetToIdle(chatId);
          await this.sendReplyToUser(reply, currentMessages[currentMessages.length - 1]);
          break;
        }

        // 未达到重试上限，丢弃回复，将上一轮最后一条消息和新消息添加到历史，准备重新处理
        this.logger.log(
          `[聚合处理][${chatId}] Agent 响应后发现 ${newMessages.length} 条新消息，` +
            `丢弃回复，将上一轮最后一条消息和新消息添加到历史并重新处理`,
        );

        // 先写入上一轮的最后一条用户消息（之前作为 userMessage 传给 Agent，但还没写入历史）
        const lastUserContent = MessageParser.extractContent(
          currentMessages[currentMessages.length - 1],
        );
        this.historyService.addMessageToHistory(chatId, 'user', lastUserContent);
        this.logger.debug(
          `[聚合处理][${chatId}] 上一轮最后一条用户消息已添加到历史: "${lastUserContent.substring(0, 30)}..."`,
        );

        // 将新消息写入历史（前 N-1 条，最后一条留给下次 Agent 调用）
        for (let i = 0; i < newMessages.length - 1; i++) {
          const content = MessageParser.extractContent(newMessages[i]);
          this.historyService.addMessageToHistory(chatId, 'user', content);
          this.logger.debug(
            `[聚合处理][${chatId}] 新消息 ${i + 1}/${newMessages.length - 1} 已添加到历史: "${content.substring(0, 30)}..."`,
          );
        }
        this.logger.debug(
          `[聚合处理][${chatId}] 新消息的最后一条将作为下次 userMessage 传给 Agent`,
        );

        // 将新消息添加到当前消息列表（用于下次 Agent 调用）
        currentMessages = [...currentMessages, ...newMessages];
        retryCount++;
      }

      // 注意：不再需要在这里清理会话状态，因为：
      // 1. 正常结束或达到重试上限时，已在循环内通过 resetToIdle 重置为 IDLE
      // 2. 状态已经是 IDLE，后续的消息会触发新的聚合流程
    } catch (error) {
      this.logger.error(`聚合消息处理失败:`, error.message);
      // 异常情况下重置会话状态，避免卡在 PROCESSING 状态
      const chatId = messages.length > 0 ? MessageParser.parse(messages[0]).chatId : 'unknown';
      if (chatId !== 'unknown') {
        this.mergeService.resetToIdle(chatId);
      }
    } finally {
      this.processingCount--;
    }
  }

  /**
   * 处理一批消息并获取 Agent 回复（但不发送，也不写入历史）
   * 注意：历史记录由调用方管理
   * @param messages 消息列表
   * @param chatId 会话ID
   * @returns Agent 回复信息
   */
  private async processMessagesAndGetReply(
    messages: EnterpriseMessageCallbackDto[],
    chatId: string,
  ): Promise<{ content: string; messageData: EnterpriseMessageCallbackDto }> {
    if (messages.length === 0) {
      throw new Error('消息列表为空');
    }

    // 用最后一条消息调用 Agent
    const lastMessage = messages[messages.length - 1];
    const parsedData = MessageParser.parse(lastMessage);
    const { content } = parsedData;

    // 获取 Agent 配置
    const scenario = MessageParser.determineScenario();
    const agentProfile = this.agentConfigService.getProfile(scenario);

    if (!agentProfile) {
      throw new Error(`无法获取场景 ${scenario} 的 Agent 配置`);
    }

    // 获取会话历史
    const historyMessages = this.historyService.getHistory(chatId);

    this.logger.log(
      `[聚合处理][${chatId}] 调用 Agent，userMessage: "${content.substring(0, 30)}..."`,
    );

    // 调用 Agent API
    const aiResponse = await this.agentService.chat({
      conversationId: chatId,
      userMessage: content,
      historyMessages,
      model: agentProfile.model,
      systemPrompt: agentProfile.systemPrompt,
      promptType: agentProfile.promptType,
      allowedTools: agentProfile.allowedTools,
      context: agentProfile.context,
      toolContext: agentProfile.toolContext,
      contextStrategy: agentProfile.contextStrategy,
      prune: agentProfile.prune,
      pruneOptions: agentProfile.pruneOptions,
    });

    // 提取回复内容
    const replyContent = this.extractReplyContent(aiResponse);

    // 注意：不在这里写入历史，由调用方决定是否写入（避免丢弃的回复写入历史）

    // 记录 token 使用情况
    const tokenInfo = aiResponse.usage ? `tokens=${aiResponse.usage.totalTokens}` : 'tokens=N/A';
    const toolsInfo =
      aiResponse.tools?.used && aiResponse.tools.used.length > 0
        ? `, tools=${aiResponse.tools.used.length}`
        : '';

    this.logger.log(
      `[聚合处理][${chatId}] Agent 回复: "${replyContent.substring(0, 50)}..." (${tokenInfo}${toolsInfo})`,
    );

    return {
      content: replyContent,
      messageData: lastMessage,
    };
  }

  /**
   * 发送回复给用户
   */
  private async sendReplyToUser(
    reply: { content: string; messageData: EnterpriseMessageCallbackDto },
    originalMessage: EnterpriseMessageCallbackDto,
  ): Promise<void> {
    const parsedData = MessageParser.parse(originalMessage);
    const { token, imBotId, imContactId, imRoomId } = parsedData;
    const contactName = parsedData.contactName || '客户';
    const replyContent = reply.content;

    // 检查是否启用消息分段发送
    if (this.enableMessageSplitSend && MessageSplitter.needsSplit(replyContent)) {
      const segments = MessageSplitter.split(replyContent);
      this.logger.log(`[聚合处理] 消息包含双换行符或"～"，拆分为 ${segments.length} 条消息发送`);
      this.logger.log(`[聚合处理] 原始消息: "${replyContent}"`);
      this.logger.log(`[聚合处理] 拆分结果: ${JSON.stringify(segments)}`);

      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        this.logger.log(
          `[聚合处理] 发送第 ${i + 1}/${segments.length} 条消息: "${segment.substring(0, 30)}..."`,
        );

        try {
          await this.messageSenderService.sendMessage({
            token,
            imBotId,
            imContactId,
            imRoomId,
            messageType: SendMessageType.TEXT,
            payload: { text: segment },
          });

          this.logger.debug(`[聚合处理] 第 ${i + 1}/${segments.length} 条消息发送成功`);

          // 添加延迟，确保消息按顺序到达
          if (i < segments.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, this.messageSendDelay));
          }
        } catch (error) {
          this.logger.error(
            `[聚合处理] 第 ${i + 1}/${segments.length} 条消息发送失败: ${error.message}`,
          );
          // 发送失败时仍然继续发送后续消息
        }
      }

      this.logger.log(`[聚合处理] 已成功发送 ${segments.length} 条消息`);
    } else {
      await this.messageSenderService.sendMessage({
        token,
        imBotId,
        imContactId,
        imRoomId,
        messageType: SendMessageType.TEXT,
        payload: { text: replyContent },
      });

      this.logger.log(`[聚合处理] 已发送回复给 ${contactName}`);
    }
  }

  /**
   * 提取 AI 回复内容
   */
  private extractReplyContent(aiResponse: any): string {
    if (!aiResponse.messages || aiResponse.messages.length === 0) {
      throw new Error('AI 未生成有效回复');
    }

    // 获取最后一条 assistant 消息
    const lastAssistantMessage = aiResponse.messages.filter((m) => m.role === 'assistant').pop();

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

  /**
   * 处理发送结果回调
   */
  async handleSentResult(resultData: any) {
    // 只在debug模式下记录详细信息
    this.logger.debug(`收到发送结果回调: ${resultData?.requestId || 'N/A'}`);
    return { success: true };
  }

  /**
   * 获取当前服务状态（用于健康检查或监控）
   * 委托给 StatisticsService
   */
  getServiceStatus() {
    return this.statisticsService.getServiceStatus(
      this.processingCount,
      0, // 已移除并发限制，传 0 表示无限制
      this.enableAiReply,
      this.enableMessageMerge,
      this.enableMessageSplitSend,
    );
  }

  /**
   * 获取详细的缓存统计信息
   * 委托给 StatisticsService
   */
  getCacheStats() {
    return this.statisticsService.getCacheStats(this.processingCount, 0); // 已移除并发限制
  }

  /**
   * 获取内存中的聊天记录
   * @param chatId 可选，指定获取某个会话的历史记录
   * @returns 所有会话的历史记录或指定会话的历史记录
   */
  getAllHistory(chatId?: string) {
    if (chatId) {
      // 获取指定会话的历史
      const history = this.historyService.getHistory(chatId);
      return {
        chatId,
        messages: history,
        count: history.length,
      };
    }

    // 获取所有会话的历史
    return this.historyService.getAllHistory();
  }

  /**
   * 手动清理内存缓存
   * 委托给 StatisticsService
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
