import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { AgentService, AgentConfigService, ScenarioType } from '@agent';
import { MessageSenderService } from '../message-sender/message-sender.service';
import { MessageType as SendMessageType } from '../message-sender/dto/send-message.dto';
import {
  EnterpriseMessageCallbackDto,
  isTextPayload,
  MessageType,
  MessageSource,
  getMessageSourceDescription,
} from './dto/send-message.dto';

/**
 * 消息历史记录项
 */
interface MessageHistoryItem {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

/**
 * 待聚合的消息队列项
 */
interface PendingMessage {
  messageData: EnterpriseMessageCallbackDto;
  receivedAt: number;
}

/**
 * 消息聚合队列
 */
interface MessageMergeQueue {
  messages: PendingMessage[];
  timer: NodeJS.Timeout;
  firstMessageTime: number;
}

/**
 * 消息处理服务
 * 负责接收、解析消息并触发 AI 自动回复
 */
@Injectable()
export class MessageService implements OnModuleDestroy {
  private readonly logger = new Logger(MessageService.name);
  private readonly enableAiReply: boolean;

  // 基于 chatId 的消息历史缓存 (chatId -> messages)
  private readonly messageHistory = new Map<string, MessageHistoryItem[]>();
  private readonly maxHistoryPerChat: number;
  private readonly historyTTL: number; // 历史记录过期时间（毫秒）

  // 消息去重缓存 (messageId -> timestamp)
  private readonly processedMessages = new Map<string, number>();
  private readonly messageDedupeTTL: number = 300000; // 消息去重缓存时间 5分钟
  private readonly maxProcessedMessages: number = 10000; // 最大缓存消息数，防止内存溢出

  // 并发控制：跟踪正在处理的消息数
  private processingCount: number = 0;
  private readonly maxConcurrentProcessing: number = 50; // 最大并发处理数

  // 消息聚合队列 (chatId -> MessageMergeQueue)
  private readonly messageMergeQueues = new Map<string, MessageMergeQueue>();
  private readonly messageMergeWindow: number; // 消息聚合时间窗口（毫秒）
  private readonly maxMergedMessages: number; // 单次最多聚合消息数
  private readonly enableMessageMerge: boolean; // 是否启用消息聚合
  private readonly enableBullQueue: boolean; // 是否启用 Bull 队列

  // 定时清理任务的句柄
  private cleanupIntervalHandle: NodeJS.Timeout | null = null;

  constructor(
    private readonly messageSenderService: MessageSenderService,
    private readonly agentService: AgentService,
    private readonly agentConfigService: AgentConfigService,
    private readonly configService: ConfigService,
    @Optional() @InjectQueue('message-merge') private readonly messageQueue?: Queue,
  ) {
    // 从环境变量读取是否启用 AI 回复
    this.enableAiReply = this.configService.get<string>('ENABLE_AI_REPLY', 'true') === 'true';
    this.logger.log(`AI 自动回复功能: ${this.enableAiReply ? '已启用' : '已禁用'}`);

    // 从环境变量读取历史消息配置
    this.maxHistoryPerChat = parseInt(
      this.configService.get<string>('MAX_HISTORY_PER_CHAT', '20'),
      10,
    );
    this.historyTTL = parseInt(this.configService.get<string>('HISTORY_TTL_MS', '36000000'), 10); // 默认10小时

    this.logger.log(
      `消息历史配置: 每个会话最多保留 ${this.maxHistoryPerChat} 条消息，过期时间 ${this.historyTTL / 1000 / 60} 分钟`,
    );

    // 从环境变量读取消息聚合配置
    this.enableMessageMerge =
      this.configService.get<string>('ENABLE_MESSAGE_MERGE', 'true') === 'true';
    this.messageMergeWindow = parseInt(
      this.configService.get<string>('MESSAGE_MERGE_WINDOW_MS', '3000'),
      10,
    ); // 默认3秒
    this.maxMergedMessages = parseInt(
      this.configService.get<string>('MAX_MERGED_MESSAGES', '5'),
      10,
    ); // 默认最多合并5条

    // 从环境变量读取是否启用 Bull 队列
    this.enableBullQueue = this.configService.get<string>('ENABLE_BULL_QUEUE', 'false') === 'true';

    if (this.enableMessageMerge) {
      const queueType = this.enableBullQueue && this.messageQueue ? 'Bull 队列' : '内存队列';
      this.logger.log(
        `消息聚合功能: 已启用 (${queueType}, 时间窗口: ${this.messageMergeWindow}ms, 最多聚合: ${this.maxMergedMessages} 条)`,
      );

      if (this.enableBullQueue && !this.messageQueue) {
        this.logger.warn('启用了 Bull 队列但注入失败，将降级使用内存队列');
      }
    } else {
      this.logger.log(`消息聚合功能: 已禁用`);
    }

    // 启动定期清理任务
    this.startHistoryCleanup();
  }

  /**
   * 模块销毁钩子
   * 清理定时器
   */
  onModuleDestroy() {
    // 清理历史记录定时任务
    if (this.cleanupIntervalHandle) {
      clearInterval(this.cleanupIntervalHandle);
      this.cleanupIntervalHandle = null;
      this.logger.log('已清理历史记录定时任务');
    }

    // 清理所有消息聚合队列的定时器
    for (const [chatId, queue] of this.messageMergeQueues.entries()) {
      clearTimeout(queue.timer);
      this.logger.log(`清理聚合队列定时器: ${chatId}`);
    }
    this.messageMergeQueues.clear();
  }

  /**
   * 处理接收到的消息
   * 快速响应模式：立即返回成功响应，避免企微回调超时重试
   */
  async handleMessage(messageData: EnterpriseMessageCallbackDto) {
    // 并发控制检查
    if (this.processingCount >= this.maxConcurrentProcessing) {
      this.logger.warn(
        `并发处理数已达上限 ${this.maxConcurrentProcessing}，跳过消息 [${messageData.messageId}]`,
      );
      return { success: true, message: 'Message queued (rate limited)' };
    }

    // 立即启动异步处理，不等待完成
    if (this.enableAiReply) {
      if (this.enableMessageMerge) {
        // 启用消息聚合：将消息加入队列
        this.logger.log(`[消息聚合] 消息加入聚合队列 [${messageData.messageId}]`);
        this.enqueueMessage(messageData);
      } else {
        // 未启用消息聚合：直接处理
        this.logger.log(`[直接处理] 消息开始处理 [${messageData.messageId}]`);
        this.processingCount++;

        this.processMessageWithAI(messageData)
          .catch((error) => {
            this.logger.error(`异步处理消息失败 [${messageData.messageId}]:`, error.message);
          })
          .finally(() => {
            this.processingCount--;
          });
      }
    } else {
      this.logger.log(`[AI回复已禁用] 跳过消息 [${messageData.messageId}]`);
    }

    // 立即返回成功，避免企微超时重试
    return { success: true, message: 'Message received' };
  }

  /**
   * 使用 AI 处理消息并自动回复
   */
  private async processMessageWithAI(messageData: EnterpriseMessageCallbackDto) {
    let contactName = '未知用户';
    let messageId = 'unknown';
    let scenarioType = '未知场景';

    try {
      // 消息去重检查 - 防止企微回调重试导致重复处理
      if (this.isMessageProcessed(messageData.messageId)) {
        this.logger.log(`[消息去重] 消息 [${messageData.messageId}] 已处理过，跳过重复处理`);
        return;
      }

      // 记录消息为已处理
      this.markMessageAsProcessed(messageData.messageId);

      // 解析消息数据
      const parsedData = this.parseMessageData(messageData);
      const { token, content, chatId, botWxid, isSelf, isRoom } = parsedData;

      // 保存到外部作用域，供catch使用
      contactName = parsedData.contactName || '客户';
      messageId = parsedData.messageId;

      // 判断消息场景
      scenarioType = isRoom ? '群聊' : '私聊';
      const sourceDescription = getMessageSourceDescription(messageData.source);

      // 记录关键字段
      this.logger.log(
        `场景: ${scenarioType}, isSelf=${isSelf}, source=${messageData.source}(${sourceDescription}), contactType=${messageData.contactType}`,
      );
      this.logger.log(`chatId=${chatId}, messageId=${messageId}`);
      this.logger.log('========================================');

      // 拦截机器人自己发送的消息，避免自问自答循环
      if (isSelf === true) {
        this.logger.log(
          `[过滤-自己发送] [${scenarioType}] 跳过机器人自己发送的消息 [${messageId}]`,
        );
        return;
      }

      // 只处理特定 source 的消息（手机推送）
      if (messageData.source !== MessageSource.MOBILE_PUSH) {
        this.logger.log(
          `[过滤-消息来源] [${scenarioType}] 跳过非目标来源的消息 [${messageId}], source=${messageData.source}(${sourceDescription}), 期望source=${MessageSource.MOBILE_PUSH}(${getMessageSourceDescription(MessageSource.MOBILE_PUSH)})`,
        );
        return;
      }

      // 暂时跳过群聊消息
      if (isRoom) {
        this.logger.log(`[过滤-群聊] [${scenarioType}] 暂时跳过群聊消息 [${messageId}]`);
        return;
      }

      // 检查消息内容是否为空或无法处理（如图片、表情等）
      if (!content || content.trim().length === 0) {
        this.logger.log(
          `[过滤-空内容] [${scenarioType}] 跳过空内容或非文本消息 [${messageId}], messageType=${messageData.messageType}`,
        );
        return;
      }

      // 直接使用 chatId 作为会话标识
      const conversationId = chatId;

      this.logger.log(
        `[${scenarioType}][${contactName}] 收到: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`,
      );
      this.logger.debug(`会话ID: ${conversationId}, 消息ID: ${messageId}`);

      // 1. 根据场景选择合适的 Agent 配置
      const scenario = this.determineScenario(parsedData);
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

      // 4. 获取会话历史消息
      const historyMessages = this.getHistory(chatId);
      this.logger.debug(`使用历史消息: ${historyMessages.length} 条`);

      // 5. 添加当前用户消息到历史
      this.addMessageToHistory(chatId, 'user', content);

      // 6. 调用 Agent API 生成回复（使用完整的 Agent 配置和历史消息）
      const aiResponse = await this.agentService.chat({
        conversationId,
        userMessage: content,
        historyMessages, // 传入历史消息
        model: agentProfile.model,
        systemPrompt: agentProfile.systemPrompt,
        promptType: agentProfile.promptType,
        allowedTools: agentProfile.allowedTools,
        context: agentProfile.context, // 使用合并后的上下文（包含 agentProfile.context）
        toolContext: agentProfile.toolContext,
        contextStrategy: agentProfile.contextStrategy,
        prune: agentProfile.prune,
        pruneOptions: agentProfile.pruneOptions,
      });

      // 5. 提取回复内容 - 获取最后一条消息
      if (!aiResponse.messages || aiResponse.messages.length === 0) {
        this.logger.warn('AI 未生成有效回复');
        return;
      }

      // 获取最后一条 assistant 消息（而不是第一条）
      const lastAssistantMessage = aiResponse.messages.filter((m) => m.role === 'assistant').pop(); // 获取最后一个元素

      if (
        !lastAssistantMessage ||
        !lastAssistantMessage.parts ||
        lastAssistantMessage.parts.length === 0
      ) {
        this.logger.warn('AI 响应中没有找到助手消息');
        return;
      }

      // 提取所有文本类型的 parts 并拼接
      const textParts = lastAssistantMessage.parts
        .filter((p) => p.type === 'text' && p.text)
        .map((p) => p.text);

      if (textParts.length === 0) {
        this.logger.warn('AI 响应中没有找到文本内容');
        return;
      }

      // 拼接所有文本内容（通常只有一个文本 part，但为了兼容性处理多个）
      const replyContent = textParts.join('\n\n');

      // 7. 将 AI 回复添加到历史记录
      this.addMessageToHistory(chatId, 'assistant', replyContent);

      // 8. 记录 token 使用情况和工具使用
      const tokenInfo = aiResponse.usage ? `tokens=${aiResponse.usage.totalTokens}` : 'tokens=N/A';
      const toolsInfo =
        aiResponse.tools?.used && aiResponse.tools.used.length > 0
          ? `, tools=${aiResponse.tools.used.length}`
          : '';

      this.logger.log(
        `[${scenarioType}][${contactName}] 回复: "${replyContent.substring(0, 50)}${replyContent.length > 50 ? '...' : ''}" (${tokenInfo}${toolsInfo})`,
      );

      // 8. 发送回复消息（使用 MessageSenderService）
      await this.messageSenderService.sendMessage({
        token,
        chatId, // 使用 chatId 而不是 wxid
        messageType: SendMessageType.TEXT, // 发送文本消息类型为 0
        payload: {
          text: replyContent, // 文本内容放在 payload.text 中
        },
      });
    } catch (error) {
      this.logger.error(
        `[${scenarioType}][${contactName}] 消息处理失败 [${messageId}]: ${error.message}`,
      );
      // 不抛出错误，避免影响其他消息处理
    }
  }

  /**
   * 检查消息是否 @ 了机器人
   * @param messageData 企业级消息回调数据
   * @param botWxid 机器人的 wxid
   * @returns 是否被 @
   * @note 此方法为未来群聊 @ 触发功能预留，当实现群聊场景时会用到
   */
  private checkMentioned(messageData: EnterpriseMessageCallbackDto, botWxid: string): boolean {
    // 检查是否为文本消息
    if (messageData.messageType !== MessageType.TEXT) {
      return false;
    }

    const payload = messageData.payload as any;

    // 检查 payload 中是否有 mention 字段
    if (!payload.mention || !Array.isArray(payload.mention)) {
      return false;
    }

    // 检查 mention 列表中是否包含机器人的 wxid
    // 或者是否 @all
    return payload.mention.includes(botWxid) || payload.mention.includes('@all');
  }

  /**
   * 获取 Agent 场景配置
   * 当前业务只有候选人私聊咨询这一个场景
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private determineScenario(parsedData: any): ScenarioType {
    // 只有一个场景：候选人私聊咨询服务
    return ScenarioType.CANDIDATE_CONSULTATION;
  }

  /**
   * 脱敏消息数据，移除敏感信息
   */
  private sanitizeMessageData(messageData: EnterpriseMessageCallbackDto): any {
    const sanitized: any = { ...messageData };

    // 脱敏敏感信息
    if (sanitized.token) {
      sanitized.token = this.sanitizeString(sanitized.token, 4, 4);
    }
    if (sanitized.imBotId) {
      sanitized.imBotId = this.sanitizeString(sanitized.imBotId, 3, 3);
    }
    if (sanitized.orgId) {
      sanitized.orgId = this.sanitizeString(sanitized.orgId, 3, 3);
    }

    return sanitized;
  }

  /**
   * 脱敏字符串（显示前后若干位，中间用****替换）
   * @param str 要脱敏的字符串
   * @param prefixLen 保留前缀长度
   * @param suffixLen 保留后缀长度
   * @returns 脱敏后的字符串
   */
  private sanitizeString(
    str: string | undefined,
    prefixLen: number = 3,
    suffixLen: number = 3,
  ): string | undefined {
    if (!str || typeof str !== 'string') {
      return str;
    }

    const minLen = prefixLen + suffixLen;
    if (str.length <= minLen) {
      return '****';
    }

    return `${str.substring(0, prefixLen)}****${str.substring(str.length - suffixLen)}`;
  }

  /**
   * 解析消息数据
   * 提取文本内容和基本信息，用于后续处理
   */
  private parseMessageData(messageData: EnterpriseMessageCallbackDto) {
    // 提取文本内容（优先使用 pureText，不含 @ 信息）
    const content = isTextPayload(messageData.messageType, messageData.payload)
      ? messageData.payload.pureText || messageData.payload.text
      : '';

    // 根据 imRoomId 是否有值来判断是否为群聊
    const isRoom = !!messageData.imRoomId;

    return {
      token: messageData.token,
      messageId: messageData.messageId,
      messageType: messageData.messageType,
      content,
      roomId: messageData.imRoomId, // 群聊的系统 room ID（仅群聊消息有值）
      roomName: messageData.roomName, // 群聊名称（仅群聊消息有值）
      roomWecomChatId: messageData.roomWecomChatId, // 群聊的企微 chatId（仅群聊消息有值）
      isRoom,
      chatId: messageData.chatId,
      botWxid: messageData.imBotId,
      botId: messageData.botId,
      isSelf: messageData.isSelf,
      timestamp: parseInt(messageData.timestamp),
      payload: messageData.payload,
      contactType: messageData.contactType,
      contactName: messageData.contactName,
      externalUserId: messageData.externalUserId,
      coworker: messageData.coworker,
      avatar: messageData.avatar,
    };
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
   * 获取指定会话的历史消息
   */
  private getHistory(chatId: string): Array<{ role: 'user' | 'assistant'; content: string }> {
    const history = this.messageHistory.get(chatId) || [];
    const now = Date.now();

    // 过滤掉过期的消息
    const validHistory = history.filter((msg) => now - msg.timestamp < this.historyTTL);

    // 只返回最近 N 条消息
    const recentHistory = validHistory.slice(-this.maxHistoryPerChat);

    return recentHistory.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
  }

  /**
   * 添加消息到历史记录
   */
  private addMessageToHistory(chatId: string, role: 'user' | 'assistant', content: string) {
    let history = this.messageHistory.get(chatId) || [];

    // 添加新消息
    history.push({
      role,
      content,
      timestamp: Date.now(),
    });

    // 只保留最近 N 条消息
    if (history.length > this.maxHistoryPerChat) {
      history = history.slice(-this.maxHistoryPerChat);
    }

    this.messageHistory.set(chatId, history);
  }

  /**
   * 检查消息是否已处理
   */
  private isMessageProcessed(messageId: string): boolean {
    return this.processedMessages.has(messageId);
  }

  /**
   * 标记消息为已处理
   * 包含容量保护：达到上限时清理最老的记录
   */
  private markMessageAsProcessed(messageId: string): void {
    // 容量保护：如果达到上限，清理最老的 20% 记录
    if (this.processedMessages.size >= this.maxProcessedMessages) {
      this.logger.warn(`消息去重缓存达到上限 ${this.maxProcessedMessages}，执行紧急清理`);
      this.cleanupOldestMessages();
    }

    this.processedMessages.set(messageId, Date.now());
  }

  /**
   * 清理最老的消息记录（保留最新的 80%）
   */
  private cleanupOldestMessages(): void {
    const entries = Array.from(this.processedMessages.entries());
    // 按时间戳排序
    entries.sort((a, b) => a[1] - b[1]);

    // 删除最老的 20%
    const deleteCount = Math.floor(entries.length * 0.2);
    for (let i = 0; i < deleteCount; i++) {
      this.processedMessages.delete(entries[i][0]);
    }

    this.logger.log(`紧急清理完成，删除了 ${deleteCount} 条最老的消息记录`);
  }

  /**
   * 将消息加入聚合队列
   * 支持 Bull 队列和内存队列两种模式
   */
  private async enqueueMessage(messageData: EnterpriseMessageCallbackDto): Promise<void> {
    // 如果启用了 Bull 队列且可用，使用 Bull
    if (this.enableBullQueue && this.messageQueue) {
      await this.enqueueToBull(messageData);
      return;
    }

    // 否则使用内存队列（原有逻辑）
    this.enqueueToMemory(messageData);
  }

  /**
   * 将消息加入 Bull 队列
   */
  private async enqueueToBull(messageData: EnterpriseMessageCallbackDto): Promise<void> {
    const chatId = messageData.chatId;

    try {
      // 添加任务到 Bull 队列
      await this.messageQueue!.add(
        'merge',
        {
          messages: [messageData], // Bull 处理器期望的格式
        },
        {
          jobId: `merge-${chatId}-${Date.now()}`, // 唯一任务 ID
          delay: this.messageMergeWindow, // 延迟执行（聚合窗口）
          removeOnComplete: true,
        },
      );

      this.logger.debug(
        `[Bull] 消息加入队列 [${messageData.messageId}], chatId: ${chatId}, 延迟: ${this.messageMergeWindow}ms`,
      );
    } catch (error) {
      this.logger.error(
        `[Bull] 消息入队失败 [${messageData.messageId}]: ${error.message}, 降级使用内存队列`,
      );
      // 降级到内存队列
      this.enqueueToMemory(messageData);
    }
  }

  /**
   * 将消息加入内存队列（原有逻辑）
   */
  private enqueueToMemory(messageData: EnterpriseMessageCallbackDto): void {
    const chatId = messageData.chatId;

    // 获取或创建该会话的聚合队列
    let queue = this.messageMergeQueues.get(chatId);

    if (!queue) {
      // 创建新队列
      const now = Date.now();
      queue = {
        messages: [],
        timer: setTimeout(() => this.processMergedMessages(chatId), this.messageMergeWindow),
        firstMessageTime: now,
      };
      this.messageMergeQueues.set(chatId, queue);

      this.logger.debug(
        `[内存队列] 创建新队列 [${chatId}], 将在 ${this.messageMergeWindow}ms 后处理`,
      );
    }

    // 将消息加入队列
    queue.messages.push({
      messageData,
      receivedAt: Date.now(),
    });

    this.logger.debug(
      `[内存队列] 消息入队 [${messageData.messageId}], 当前队列长度: ${queue.messages.length}/${this.maxMergedMessages}`,
    );

    // 检查是否达到最大聚合数量
    if (queue.messages.length >= this.maxMergedMessages) {
      this.logger.log(
        `[内存队列] 队列 [${chatId}] 已达到最大聚合数 ${this.maxMergedMessages}, 立即处理`,
      );
      // 清除定时器并立即处理
      clearTimeout(queue.timer);
      this.processMergedMessages(chatId);
    }
  }

  /**
   * 处理聚合后的消息
   */
  private processMergedMessages(chatId: string): void {
    const queue = this.messageMergeQueues.get(chatId);

    if (!queue || queue.messages.length === 0) {
      this.messageMergeQueues.delete(chatId);
      return;
    }

    // 取出队列中的所有消息
    const messages = queue.messages;
    this.messageMergeQueues.delete(chatId);

    this.logger.log(`[消息聚合] 开始处理队列 [${chatId}], 聚合了 ${messages.length} 条消息`);

    // 增加并发计数
    this.processingCount++;

    // 合并处理所有消息
    this.processMessageBatch(messages)
      .catch((error) => {
        this.logger.error(`[消息聚合] 批量处理失败 [${chatId}]:`, error.message);
      })
      .finally(() => {
        this.processingCount--;
      });
  }

  /**
   * 批量处理消息（合并为一次 Agent 调用）
   */
  private async processMessageBatch(pendingMessages: PendingMessage[]): Promise<void> {
    if (pendingMessages.length === 0) return;

    // 使用第一条消息的元数据
    const firstMessage = pendingMessages[0].messageData;
    const chatId = firstMessage.chatId;

    try {
      // 检查所有消息是否已经处理过（去重）
      const unprocessedMessages = pendingMessages.filter((pm) => {
        const messageId = pm.messageData.messageId;
        if (this.isMessageProcessed(messageId)) {
          this.logger.debug(`[消息聚合] 跳过已处理的消息 [${messageId}]`);
          return false;
        }
        // 标记为已处理
        this.markMessageAsProcessed(messageId);
        return true;
      });

      if (unprocessedMessages.length === 0) {
        this.logger.debug(`[消息聚合] 队列 [${chatId}] 所有消息已处理过，跳过`);
        return;
      }

      // 合并消息内容
      const mergedContents: string[] = [];
      for (const pm of unprocessedMessages) {
        const parsedData = this.parseMessageData(pm.messageData);

        // 跳过检查（isSelf、isRoom、空内容等）
        if (parsedData.isSelf === true) {
          this.logger.debug(`[消息聚合] 跳过机器人自己的消息 [${pm.messageData.messageId}]`);
          continue;
        }

        if (parsedData.isRoom) {
          this.logger.debug(`[消息聚合] 跳过群聊消息 [${pm.messageData.messageId}]`);
          continue;
        }

        if (!parsedData.content || parsedData.content.trim().length === 0) {
          this.logger.debug(`[消息聚合] 跳过空内容消息 [${pm.messageData.messageId}]`);
          continue;
        }

        mergedContents.push(parsedData.content);
      }

      if (mergedContents.length === 0) {
        this.logger.debug(`[消息聚合] 队列 [${chatId}] 没有有效内容，跳过`);
        return;
      }

      // 合并为一条消息（用换行分隔）
      const mergedContent = mergedContents.join('\n');

      this.logger.log(
        `[消息聚合] 合并后的消息内容 [${chatId}]: "${mergedContent.substring(0, 100)}${mergedContent.length > 100 ? '...' : ''}" (原始 ${unprocessedMessages.length} 条)`,
      );

      // 调用原有的 AI 处理逻辑，传入合并后的消息
      // 复用第一条消息的元数据，但替换内容
      const mergedMessageData: EnterpriseMessageCallbackDto = {
        ...firstMessage,
        payload: {
          ...firstMessage.payload,
          text: mergedContent,
          pureText: mergedContent,
        },
      };

      // 调用 AI 处理（跳过前置检查，因为已经在这里检查过）
      await this.processMessageWithAIMerged(mergedMessageData, mergedContents.length);
    } catch (error) {
      this.logger.error(`[消息聚合] 处理失败 [${chatId}]:`, error.message);
      throw error;
    }
  }

  /**
   * 处理合并后的消息（专用于聚合场景，跳过重复检查）
   */
  private async processMessageWithAIMerged(
    messageData: EnterpriseMessageCallbackDto,
    originalMessageCount: number,
  ): Promise<void> {
    const parsedData = this.parseMessageData(messageData);
    const { content, chatId, isRoom } = parsedData;
    let contactName = parsedData.contactName || '客户';
    const scenarioType = isRoom ? '群聊' : '私聊';

    try {
      this.logger.log(
        `[消息聚合][${scenarioType}][${contactName}] 处理合并消息 (${originalMessageCount} 条): "${content.substring(0, 100)}${content.length > 100 ? '...' : ''}"`,
      );

      // 判断消息场景
      const scenario = this.determineScenario(parsedData);
      const agentProfile = this.agentConfigService.getProfile(scenario);

      if (!agentProfile) {
        this.logger.error(`无法获取场景 ${scenario} 的 Agent 配置`);
        return;
      }

      // 验证配置有效性
      const validation = this.agentConfigService.validateProfile(agentProfile);
      if (!validation.valid) {
        this.logger.error(`Agent 配置验证失败: ${validation.errors.join(', ')}`);
        return;
      }

      // 获取会话历史消息
      const historyMessages = this.getHistory(chatId);
      this.logger.debug(`使用历史消息: ${historyMessages.length} 条`);

      // 添加当前用户消息到历史
      this.addMessageToHistory(chatId, 'user', content);

      // 调用 Agent API 生成回复
      const conversationId = chatId;
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

      // 提取回复内容
      if (!aiResponse.messages || aiResponse.messages.length === 0) {
        this.logger.warn('[消息聚合] AI 未生成有效回复');
        return;
      }

      const lastAssistantMessage = aiResponse.messages.filter((m) => m.role === 'assistant').pop();

      if (
        !lastAssistantMessage ||
        !lastAssistantMessage.parts ||
        lastAssistantMessage.parts.length === 0
      ) {
        this.logger.warn('[消息聚合] AI 响应中没有找到助手消息');
        return;
      }

      const textParts = lastAssistantMessage.parts
        .filter((p) => p.type === 'text' && p.text)
        .map((p) => p.text);

      if (textParts.length === 0) {
        this.logger.warn('[消息聚合] AI 响应中没有找到文本内容');
        return;
      }

      const replyContent = textParts.join('\n\n');

      // 将 AI 回复添加到历史记录
      this.addMessageToHistory(chatId, 'assistant', replyContent);

      // 记录 token 使用情况
      const tokenInfo = aiResponse.usage ? `tokens=${aiResponse.usage.totalTokens}` : 'tokens=N/A';
      const toolsInfo =
        aiResponse.tools?.used && aiResponse.tools.used.length > 0
          ? `, tools=${aiResponse.tools.used.length}`
          : '';

      this.logger.log(
        `[消息聚合][${scenarioType}][${contactName}] 回复: "${replyContent.substring(0, 50)}${replyContent.length > 50 ? '...' : ''}" (${tokenInfo}${toolsInfo}, 合并了 ${originalMessageCount} 条消息)`,
      );

      // TODO: 发送回复消息
      // await this.messageSenderService.sendMessage({...});
    } catch (error) {
      this.logger.error(`[消息聚合][${scenarioType}][${contactName}] 消息处理失败:`, error.message);
    }
  }

  /**
   * 启动定期清理任务
   */
  private startHistoryCleanup() {
    // 每5分钟清理一次过期的历史记录和去重缓存
    const cleanupInterval = 300000; // 5分钟

    this.cleanupIntervalHandle = setInterval(() => {
      const now = Date.now();
      let cleanedHistoryCount = 0;
      let cleanedMessageCount = 0;

      // 清理过期的会话历史
      for (const [chatId, history] of this.messageHistory.entries()) {
        const validHistory = history.filter((msg) => now - msg.timestamp < this.historyTTL);

        if (validHistory.length === 0) {
          // 如果所有消息都过期了，删除整个会话
          this.messageHistory.delete(chatId);
          cleanedHistoryCount++;
        } else if (validHistory.length !== history.length) {
          // 更新为过滤后的历史
          this.messageHistory.set(chatId, validHistory);
        }
      }

      // 清理过期的消息去重记录
      for (const [messageId, timestamp] of this.processedMessages.entries()) {
        if (now - timestamp > this.messageDedupeTTL) {
          this.processedMessages.delete(messageId);
          cleanedMessageCount++;
        }
      }

      if (cleanedHistoryCount > 0 || cleanedMessageCount > 0) {
        this.logger.log(
          `定时清理完成: ${cleanedHistoryCount} 个过期会话历史, ${cleanedMessageCount} 条过期消息记录`,
        );
      }

      // 记录当前缓存状态和并发处理状态
      this.logger.debug(
        `系统状态 - 去重: ${this.processedMessages.size}/${this.maxProcessedMessages}, ` +
          `会话: ${this.messageHistory.size}, ` +
          `并发: ${this.processingCount}/${this.maxConcurrentProcessing}`,
      );
    }, cleanupInterval);

    this.logger.log('已启动历史记录定时清理任务 (每5分钟执行一次)');
  }

  /**
   * 获取当前服务状态（用于健康检查或监控）
   */
  getServiceStatus() {
    return {
      processingCount: this.processingCount,
      maxConcurrentProcessing: this.maxConcurrentProcessing,
      dedupeCache: {
        size: this.processedMessages.size,
        max: this.maxProcessedMessages,
        utilizationPercent: (this.processedMessages.size / this.maxProcessedMessages) * 100,
      },
      historyCache: {
        conversationCount: this.messageHistory.size,
      },
      aiReplyEnabled: this.enableAiReply,
    };
  }

  /**
   * 获取详细的缓存统计信息
   */
  getCacheStats() {
    // 计算历史记录统计
    let totalHistoryMessages = 0;
    const historyDetails: Record<string, number> = {};
    for (const [chatId, messages] of this.messageHistory.entries()) {
      totalHistoryMessages += messages.length;
      historyDetails[chatId] = messages.length;
    }

    // 计算聚合队列统计
    let totalQueuedMessages = 0;
    const queueDetails: Record<string, number> = {};
    for (const [chatId, queue] of this.messageMergeQueues.entries()) {
      totalQueuedMessages += queue.messages.length;
      queueDetails[chatId] = queue.messages.length;
    }

    return {
      timestamp: new Date().toISOString(),
      processing: {
        currentCount: this.processingCount,
        maxConcurrent: this.maxConcurrentProcessing,
        utilizationPercent: (this.processingCount / this.maxConcurrentProcessing) * 100,
      },
      messageDeduplication: {
        cachedMessageIds: this.processedMessages.size,
        maxCapacity: this.maxProcessedMessages,
        utilizationPercent: (this.processedMessages.size / this.maxProcessedMessages) * 100,
        ttlMinutes: this.messageDedupeTTL / 1000 / 60,
      },
      conversationHistory: {
        totalConversations: this.messageHistory.size,
        totalMessages: totalHistoryMessages,
        averageMessagesPerConversation:
          this.messageHistory.size > 0
            ? (totalHistoryMessages / this.messageHistory.size).toFixed(2)
            : 0,
        maxMessagesPerConversation: this.maxHistoryPerChat,
        ttlMinutes: this.historyTTL / 1000 / 60,
        // conversations: historyDetails, // 可选：详细列表（数据量大时注释掉）
      },
      messageMergeQueues: {
        enabled: this.enableMessageMerge,
        queueType: this.enableBullQueue && this.messageQueue ? 'Bull' : 'Memory',
        activeQueues: this.messageMergeQueues.size,
        totalQueuedMessages: totalQueuedMessages,
        windowMs: this.messageMergeWindow,
        maxMergedMessages: this.maxMergedMessages,
        // queues: queueDetails, // 可选：详细列表（数据量大时注释掉）
      },
      config: {
        aiReplyEnabled: this.enableAiReply,
        messageMergeEnabled: this.enableMessageMerge,
        bullQueueEnabled: this.enableBullQueue,
      },
    };
  }

  /**
   * 手动清理内存缓存
   * @param options 清理选项
   * @returns 清理结果统计
   */
  clearCache(options?: {
    deduplication?: boolean; // 清理消息去重缓存
    history?: boolean; // 清理聊天历史
    mergeQueues?: boolean; // 清理消息聚合队列
    chatId?: string; // 仅清理指定会话（用于 history 和 mergeQueues）
  }) {
    const result = {
      timestamp: new Date().toISOString(),
      cleared: {
        deduplication: 0,
        history: 0,
        mergeQueues: 0,
      },
      remaining: {
        deduplication: 0,
        history: 0,
        mergeQueues: 0,
      },
    };

    // 默认清理所有
    const opts = options || {
      deduplication: true,
      history: true,
      mergeQueues: true,
    };

    // 清理消息去重缓存
    if (opts.deduplication) {
      result.cleared.deduplication = this.processedMessages.size;
      this.processedMessages.clear();
      this.logger.log(`已清理消息去重缓存: ${result.cleared.deduplication} 条`);
    }

    // 清理聊天历史
    if (opts.history) {
      if (opts.chatId) {
        // 清理指定会话
        const messages = this.messageHistory.get(opts.chatId);
        if (messages) {
          result.cleared.history = messages.length;
          this.messageHistory.delete(opts.chatId);
          this.logger.log(
            `已清理指定会话 [${opts.chatId}] 的历史记录: ${result.cleared.history} 条`,
          );
        } else {
          this.logger.warn(`会话 [${opts.chatId}] 不存在，无需清理`);
        }
      } else {
        // 清理所有会话
        let totalMessages = 0;
        for (const messages of this.messageHistory.values()) {
          totalMessages += messages.length;
        }
        result.cleared.history = totalMessages;
        this.messageHistory.clear();
        this.logger.log(`已清理所有会话历史记录: ${result.cleared.history} 条消息`);
      }
    }

    // 清理消息聚合队列
    if (opts.mergeQueues) {
      if (opts.chatId) {
        // 清理指定会话的队列
        const queue = this.messageMergeQueues.get(opts.chatId);
        if (queue) {
          result.cleared.mergeQueues = queue.messages.length;
          clearTimeout(queue.timer);
          this.messageMergeQueues.delete(opts.chatId);
          this.logger.log(
            `已清理指定会话 [${opts.chatId}] 的聚合队列: ${result.cleared.mergeQueues} 条`,
          );
        } else {
          this.logger.warn(`会话 [${opts.chatId}] 的聚合队列不存在，无需清理`);
        }
      } else {
        // 清理所有队列
        let totalMessages = 0;
        for (const queue of this.messageMergeQueues.values()) {
          totalMessages += queue.messages.length;
          clearTimeout(queue.timer);
        }
        result.cleared.mergeQueues = totalMessages;
        this.messageMergeQueues.clear();
        this.logger.log(`已清理所有聚合队列: ${result.cleared.mergeQueues} 条消息`);
      }
    }

    // 统计剩余数据
    result.remaining.deduplication = this.processedMessages.size;
    result.remaining.history = this.messageHistory.size;
    result.remaining.mergeQueues = this.messageMergeQueues.size;

    this.logger.log(
      `缓存清理完成 - 去重: ${result.cleared.deduplication}, 历史: ${result.cleared.history}, 队列: ${result.cleared.mergeQueues}`,
    );

    return result;
  }
}
