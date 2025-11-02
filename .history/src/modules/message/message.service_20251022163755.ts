import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentService, AgentConfigService, ScenarioType } from '@agent';
import { MessageSenderService } from '@modules/message-sender/message-sender.service';
import { MessageType } from '@modules/message-sender/dto/send-message.dto';
import { IncomingMessageData } from './dto/send-message.dto';
import { MessageSource, getMessageSourceDescription } from './enums/message-source.enum';

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
export class MessageService {
  private readonly logger = new Logger(MessageService.name);
  private readonly enableAiReply: boolean;

  // 基于 chatId 的消息历史缓存 (chatId -> messages)
  private readonly messageHistory = new Map<string, MessageHistoryItem[]>();
  private readonly maxHistoryPerChat: number;
  private readonly historyTTL: number; // 历史记录过期时间（毫秒）

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
    this.historyTTL = this.configService.get<number>('HISTORY_TTL_MS', 7200000); // 默认2小时

    this.logger.log(
      `消息历史配置: 每个会话最多保留 ${this.maxHistoryPerChat} 条消息，过期时间 ${this.historyTTL / 1000 / 60} 分钟`,
    );

    // 启动定期清理任务
    this.startHistoryCleanup();
  }

  /**
   * 处理接收到的消息
   */
  async handleMessage(messageData: IncomingMessageData) {
    this.logger.log('收到消息回调:', JSON.stringify(messageData));

    try {
      // 如果启用了 AI 回复，处理消息并生成回复
      if (this.enableAiReply) {
        await this.processMessageWithAI(messageData);
      }

      return { success: true, message: 'Message processed successfully' };
    } catch (error: any) {
      this.logger.error('处理消息失败:', error);
      // 返回成功以避免托管平台重试，但记录错误
      return { success: true, error: error.message };
    }
  }

  /**
   * 使用 AI 处理消息并自动回复
   */
  private async processMessageWithAI(messageData: IncomingMessageData) {
    try {
      // 解析消息数据（支持新旧两种格式）
      const parsedData = this.parseMessageData(messageData);
      const {
        token,
        contactId,
        contactName,
        messageType,
        content,
        roomId,
        roomName,
        isRoom,
        chatId,
        botWxid,
        isSelf,
        mentionSelf,
        timestamp,
        source,
      } = parsedData;

      // 跳过机器人自己发送的消息
      if (isSelf) {
        this.logger.log('跳过机器人自己发送的消息');
        return;
      }

      // 检查消息来源，只处理新客户应答sop (source === 7)
      if (source !== undefined && source !== MessageSource.NEW_CUSTOMER_ANSWER_SOP) {
        this.logger.log(
          `跳过非新客户应答sop消息，来源: ${getMessageSourceDescription(source)} (${source})`,
        );
        return;
      }

      

      // 直接使用 chatId 作为会话标识
      const conversationId = chatId;

      this.logger.log(
        `正在为${isRoom ? `群 ${roomName || roomId}` : `用户 ${contactName || contactId}`} 生成 AI 回复...`,
      );
      this.logger.log(`会话 ID: ${conversationId}`);

      // 1. 根据场景选择合适的 Agent 配置
      const scenario = this.determineScenario(parsedData);
      const agentProfile = this.agentConfigService.getProfile(scenario);

      if (!agentProfile) {
        this.logger.error(`无法获取场景 ${scenario} 的 Agent 配置`);
        return;
      }

      this.logger.log(`使用 Agent 配置: ${agentProfile.name} - ${agentProfile.description}`);

      // 2. 验证配置有效性
      const validation = this.agentConfigService.validateProfile(agentProfile);
      if (!validation.valid) {
        this.logger.warn(`Agent 配置验证失败: ${validation.errors.join(', ')}`);
      }

      // 3. 合并企微消息上下文和 Agent 配置的上下文
      const messageContext = {
        contactId,
        contactName,
        roomId,
        roomName,
        isRoom,
        chatId,
        botWxid,
        mentionSelf,
        timestamp,
      };

      const mergedContext = {
        ...agentProfile.context,
        ...messageContext, // 企微消息上下文优先级更高
      };

      // 4. 获取会话历史消息
      const historyMessages = this.getHistory(chatId);
      this.logger.log(`会话历史: ${historyMessages.length} 条消息`);

      // 5. 添加当前用户消息到历史
      this.addMessageToHistory(chatId, 'user', content);

      // 6. 调用 Agent API 生成回复（使用完整的配置和历史消息）
      const aiResponse = await this.agentService.chat({
        conversationId,
        userMessage: content,
        historyMessages, // 传入历史消息
        model: agentProfile.model,
        systemPrompt: agentProfile.systemPrompt,
        promptType: agentProfile.promptType,
        allowedTools: agentProfile.allowedTools,
        context: mergedContext,
        toolContext: agentProfile.toolContext,
      });
      this.logger.log('AI 回复:', JSON.stringify(aiResponse));

      // 5. 提取回复内容
      if (!aiResponse.messages || aiResponse.messages.length === 0) {
        this.logger.warn('AI 未生成有效回复');
        return;
      }

      const assistantMessage = aiResponse.messages.find((m) => m.role === 'assistant');
      if (!assistantMessage || !assistantMessage.parts || assistantMessage.parts.length === 0) {
        this.logger.warn('AI 响应中没有找到助手消息');
        return;
      }

      const textPart = assistantMessage.parts.find((p) => p.type === 'text');
      if (!textPart || !textPart.text) {
        this.logger.warn('AI 响应中没有找到文本内容');
        return;
      }

      const replyContent = textPart.text;

      // 7. 将 AI 回复添加到历史记录
      this.addMessageToHistory(chatId, 'assistant', replyContent);

      // 8. 记录 token 使用情况
      if (aiResponse.usage) {
        this.logger.log(
          `Token 使用: input=${aiResponse.usage.inputTokens}, ` +
            `output=${aiResponse.usage.outputTokens}, ` +
            `total=${aiResponse.usage.totalTokens}` +
            (aiResponse.usage.cachedInputTokens
              ? `, cached=${aiResponse.usage.cachedInputTokens}`
              : ''),
        );
      }

      // 7. 记录使用的工具
      if (aiResponse.tools?.used && aiResponse.tools.used.length > 0) {
        this.logger.log(`使用的工具: ${aiResponse.tools.used.join(', ')}`);
      }

      this.logger.log(`AI 生成回复成功 (${replyContent.length} 字符)`);

      // 8. 发送回复消息（使用 MessageSenderService）
      await this.messageSenderService.sendMessage({
        token,
        chatId, // 使用 chatId 而不是 wxid
        messageType: MessageType.TEXT, // 文本消息类型为 0
        payload: {
          text: replyContent, // 文本内容放在 payload.text 中
        },
      });

      this.logger.log(
        `成功发送 AI 回复给 ${isRoom ? `群 ${roomName || roomId}` : `用户 ${contactName || contactId}`}`,
      );
    } catch (error) {
      this.logger.error('AI 处理消息失败:', error);
      // 不抛出错误，避免影响其他消息处理
    }
  }

  /**
   * 根据消息数据判断应该使用哪个场景的 Agent 配置
   * 可以根据实际业务需求扩展判断逻辑
   *
   * TODO: 根据实际业务需求实现场景判断逻辑
   * - 根据 botId 判断是哪个业务场景
   * - 根据消息内容关键词判断
   * - 根据联系人信息判断
   * - 从数据库查询配置
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private determineScenario(parsedData: any): ScenarioType {
    // 默认使用企微客服场景
    return ScenarioType.WECHAT_GROUP_CUSTOMER_SERVICE;
  }

  /**
   * 解析消息数据，支持新旧两种格式
   */
  private parseMessageData(messageData: IncomingMessageData) {
    // 如果存在 data 字段，说明是新格式（企微机器人托管平台标准格式）
    if (messageData.data) {
      const data = messageData.data;

      // 提取文本内容
      let content = '';
      if (data.type === 7 && data.payload) {
        // 文本消息，payload 可能是字符串或对象
        content = typeof data.payload === 'string' ? data.payload : data.payload.text || '';
      }

      return {
        token: data.token,
        messageId: data.messageId,
        contactId: data.chatId,
        contactName: data.contactName,
        messageType: data.type,
        content,
        roomId: data.roomId,
        roomName: data.roomName,
        isRoom: !!data.roomId,
        chatId: data.chatId,
        botWxid: data.botWxid,
        isSelf: data.isSelf,
        mentionSelf: data.mentionSelf || false,
        timestamp: data.timestamp,
        payload: data.payload,
        source: data.source,
      };
    }

    // 兼容旧格式
    return {
      token: messageData.token || '',
      messageId: messageData.messageId || messageData.msgId || '',
      contactId: messageData.contactId || messageData.fromUser || '',
      contactName: messageData.contactName || '',
      messageType: messageData.type || messageData.messageType || '',
      content: messageData.content || '',
      roomId: messageData.roomId,
      roomName: messageData.roomName,
      isRoom: messageData.isRoom || !!messageData.roomId,
      chatId: messageData.chatId || '',
      botWxid: messageData.botWxid || '',
      isSelf: messageData.isSelf || false,
      mentionSelf: messageData.mentionSelf || false,
      timestamp: messageData.timestamp || Date.now(),
      payload: messageData.payload,
    };
  }

  /**
   * 处理发送结果回调
   */
  async handleSentResult(resultData: any) {
    this.logger.log('收到发送结果回调:', JSON.stringify(resultData));
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
    setInterval(() => {
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
  }
}
