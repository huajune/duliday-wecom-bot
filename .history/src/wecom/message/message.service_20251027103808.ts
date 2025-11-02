import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentService, AgentConfigService, ScenarioType } from '@agent';
import { MessageSenderService } from '../message-sender/message-sender.service';
import { MessageType as SendMessageType } from '../message-sender/dto/send-message.dto';
import { IncomingMessageData, isTextPayload } from './dto/send-message.dto';

/**
 * 消息历史记录项
 */
interface MessageHistoryItem {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
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
  private readonly dedupeWindow = 300000; // 5分钟去重窗口

  // 发送消息缓存 (chatId:contentHash -> timestamp)
  // 用于防止处理机器人自己刚发送的消息（防止循环回复）
  private readonly sentMessages = new Map<string, number>();
  private readonly sentMessageWindow = 10000; // 10秒窗口，刚发送的消息在此时间内不再处理

  // 定时清理任务的句柄
  private cleanupIntervalHandle: NodeJS.Timeout | null = null;

  constructor(
    private readonly messageSenderService: MessageSenderService,
    private readonly agentService: AgentService,
    private readonly agentConfigService: AgentConfigService,
    private readonly configService: ConfigService,
  ) {
    // 从环境变量读取是否启用 AI 回复
    this.enableAiReply = this.configService.get<string>('ENABLE_AI_REPLY', 'true') === 'true';
    this.logger.log(`AI 自动回复功能: ${this.enableAiReply ? '已启用' : '已禁用'}`);

    // 从环境变量读取历史消息配置
    this.maxHistoryPerChat = this.configService.get<number>('MAX_HISTORY_PER_CHAT', 20);
    this.historyTTL = this.configService.get<number>('HISTORY_TTL_MS', 36000000); // 默认10小时

    this.logger.log(
      `消息历史配置: 每个会话最多保留 ${this.maxHistoryPerChat} 条消息，过期时间 ${this.historyTTL / 1000 / 60} 分钟`,
    );

    // 启动定期清理任务
    this.startHistoryCleanup();
  }

  /**
   * 模块销毁钩子
   * 清理定时器
   */
  onModuleDestroy() {
    if (this.cleanupIntervalHandle) {
      clearInterval(this.cleanupIntervalHandle);
      this.cleanupIntervalHandle = null;
      this.logger.log('已清理历史记录定时任务');
    }
  }

  /**
   * 处理接收到的消息
   */
  async handleMessage(messageData: IncomingMessageData) {
    try {
      // 如果启用了 AI 回复，处理消息并生成回复
      if (this.enableAiReply) {
        await this.processMessageWithAI(messageData);
      }

      return { success: true, message: 'Message processed successfully' };
    } catch (error: any) {
      this.logger.error('处理消息失败:', error.message);
      // 返回成功以避免托管平台重试，但记录错误
      return { success: true, error: error.message };
    }
  }

  /**
   * 使用 AI 处理消息并自动回复
   */
  private async processMessageWithAI(messageData: IncomingMessageData) {
    let contactName = '未知用户';
    let messageId = 'unknown';

    try {
      // 记录原始消息数据（用于调试循环问题）
      this.logger.log('========== 收到企微消息回调 ==========');
      this.logger.log(`原始消息: ${JSON.stringify(messageData, null, 2)}`);

      // 解析消息数据
      const parsedData = this.parseMessageData(messageData);
      const {
        token,
        contactId,
        messageType,
        content,
        chatId,
        botWxid,
        isSelf,
        mentionSelf,
        timestamp,
      } = parsedData;

      // 保存到外部作用域，供catch使用
      contactName = parsedData.contactName;
      messageId = parsedData.messageId;

      // 记录关键字段（用于判断是否为机器人消息）
      this.logger.log(
        `关键字段: isSelf=${isSelf}, contactId=${contactId}, botWxid=${botWxid}, contactName=${contactName}`,
      );
      this.logger.log('========================================');

      // 跳过机器人自己发送的消息
      if (isSelf) {
        this.logger.debug(`跳过机器人自己的消息 [${messageId}]`);
        return;
      }

      // 消息去重检查
      if (this.isDuplicateMessage(messageId)) {
        this.logger.debug(`跳过重复消息 [${messageId}]`);
        return;
      }

      // 标记消息已处理
      this.markMessageProcessed(messageId);

      // 检查是否为刚发送的消息（防止循环回复）
      // 这是一个额外的保护措施，即使 isSelf 字段不可靠也能防止循环
      if (this.isRecentlySentMessage(chatId, content)) {
        this.logger.debug(`跳过刚发送的消息（防止循环回复）[${messageId}]`);
        return;
      }

      // 直接使用 chatId 作为会话标识
      const conversationId = chatId;

      this.logger.log(
        `[${contactName}] 收到: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`,
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
        `[${contactName}] 回复: "${replyContent.substring(0, 50)}${replyContent.length > 50 ? '...' : ''}" (${tokenInfo}${toolsInfo})`,
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

      // 9. 标记消息已发送（防止循环回复）
      this.markMessageSent(chatId, replyContent);
    } catch (error) {
      this.logger.error(`[${contactName}] 消息处理失败 [${messageId}]: ${error.message}`);
      // 不抛出错误，避免影响其他消息处理
    }
  }

  /**
   * 检查消息是否已处理过（去重）
   */
  private isDuplicateMessage(messageId: string): boolean {
    const processedTime = this.processedMessages.get(messageId);
    if (!processedTime) {
      return false;
    }

    // 检查是否在去重窗口内
    const now = Date.now();
    if (now - processedTime < this.dedupeWindow) {
      return true;
    }

    // 过期则删除
    this.processedMessages.delete(messageId);
    return false;
  }

  /**
   * 标记消息已处理
   */
  private markMessageProcessed(messageId: string): void {
    this.processedMessages.set(messageId, Date.now());
  }

  /**
   * 检查消息是否为刚发送的消息（防止循环回复）
   * 对消息内容进行哈希，判断是否在最近发送窗口内
   */
  private isRecentlySentMessage(chatId: string, content: string): boolean {
    const contentHash = this.hashContent(content);
    const key = `${chatId}:${contentHash}`;
    const sentTime = this.sentMessages.get(key);

    if (!sentTime) {
      return false;
    }

    // 检查是否在发送窗口内
    const now = Date.now();
    if (now - sentTime < this.sentMessageWindow) {
      return true;
    }

    // 过期则删除
    this.sentMessages.delete(key);
    return false;
  }

  /**
   * 记录已发送的消息
   */
  private markMessageSent(chatId: string, content: string): void {
    const contentHash = this.hashContent(content);
    const key = `${chatId}:${contentHash}`;
    this.sentMessages.set(key, Date.now());
  }

  /**
   * 对消息内容生成简单哈希（用于去重）
   */
  private hashContent(content: string): string {
    // 简单的字符串哈希算法
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
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
  private sanitizeMessageData(messageData: IncomingMessageData): any {
    const sanitized: any = {
      data: { ...messageData.data },
    };

    // 脱敏 data 字段中的敏感信息
    if (sanitized.data.token) {
      sanitized.data.token = this.sanitizeString(sanitized.data.token, 4, 4);
    }
    if (sanitized.data.contactId) {
      sanitized.data.contactId = this.sanitizeString(sanitized.data.contactId, 3, 3);
    }
    if (sanitized.data.botWxid) {
      sanitized.data.botWxid = this.sanitizeString(sanitized.data.botWxid, 3, 3);
    }
    if (sanitized.data.botWeixin) {
      sanitized.data.botWeixin = this.sanitizeString(sanitized.data.botWeixin, 3, 3);
    }
    if (sanitized.data.externalUserId) {
      sanitized.data.externalUserId = this.sanitizeString(sanitized.data.externalUserId, 3, 3);
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
  private parseMessageData(messageData: IncomingMessageData) {
    const data = messageData.data;

    // 提取文本内容
    let content = '';
    if (isTextPayload(data.type, data.payload)) {
      // 文本消息，优先使用 pureText（不含 @ 信息），否则使用 text
      content = data.payload.pureText || data.payload.text;
    } else if (typeof data.payload === 'string') {
      // 某些消息类型的 payload 直接是字符串
      content = data.payload;
    } else if (data.payload?.text) {
      // 其他包含 text 字段的消息
      content = data.payload.text;
    }

    // 判断是否为群聊（roomId 存在且不为空字符串）
    const isRoom = !!(data.roomId && data.roomId.trim() !== '');

    return {
      token: data.token,
      messageId: data.messageId,
      contactId: data.contactId,
      contactName: data.contactName,
      messageType: data.type,
      content,
      roomId: data.roomId || undefined,
      roomName: data.roomTopic || undefined,
      isRoom,
      chatId: data.chatId,
      botWxid: data.botWxid,
      botWeixin: data.botWeixin,
      botId: data.botId,
      isSelf: data.isSelf,
      mentionSelf: data.mentionSelf,
      timestamp: data.timestamp,
      payload: data.payload,
      externalUserId: data.externalUserId || undefined,
      contactType: data.contactType,
      coworker: data.coworker,
      avatar: data.avatar,
      roomWecomChatId: data.roomWecomChatId,
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
   * 启动定期清理任务
   */
  private startHistoryCleanup() {
    // 每30分钟清理一次过期的历史记录
    this.cleanupIntervalHandle = setInterval(() => {
      const now = Date.now();
      let cleanedCount = 0;

      for (const [chatId, history] of this.messageHistory.entries()) {
        const validHistory = history.filter((msg) => now - msg.timestamp < this.historyTTL);

        if (validHistory.length === 0) {
          // 如果所有消息都过期了，删除整个会话
          this.messageHistory.delete(chatId);
          cleanedCount++;
        } else if (validHistory.length !== history.length) {
          // 更新为过滤后的历史
          this.messageHistory.set(chatId, validHistory);
        }
      }

      if (cleanedCount > 0) {
        this.logger.log(`清理了 ${cleanedCount} 个过期的会话历史`);
      }
    }, 1800000); // 30分钟

    this.logger.log('已启动历史记录定时清理任务 (每30分钟执行一次)');
  }
}
