import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
    this.maxHistoryPerChat = parseInt(
      this.configService.get<string>('MAX_HISTORY_PER_CHAT', '20'),
      10,
    );
    this.historyTTL = parseInt(this.configService.get<string>('HISTORY_TTL_MS', '36000000'), 10); // 默认10小时

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
  async handleMessage(messageData: EnterpriseMessageCallbackDto) {
    try {
      // 如果启用了 AI 回复，处理消息并生成回复
      if (this.enableAiReply) {
              // 记录原始消息数据（用于调试循环问题）
      this.logger.log('========== 收到企微消息回调 ==========');
      this.logger.log(`原始消息: ${JSON.stringify(messageData, null, 2)}`);
        // await this.processMessageWithAI(messageData);
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
  private async processMessageWithAI(messageData: EnterpriseMessageCallbackDto) {
    let contactName = '未知用户';
    let messageId = 'unknown';
    let scenarioType = '未知场景';

    try {
      // 记录原始消息数据（用于调试循环问题）
      this.logger.log('========== 收到企微消息回调 ==========');
      this.logger.log(`原始消息: ${JSON.stringify(messageData, null, 2)}`);

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
      if (isSelf) {
        this.logger.debug(`[${scenarioType}] 跳过机器人自己发送的消息 [${messageId}]`);
        return;
      }

      // 只处理特定 source 的消息（新客户应答sop）
      if (messageData.source !== MessageSource.MOBILE_PUSH) {
        this.logger.debug(
          `[${scenarioType}] 跳过非目标来源的消息 [${messageId}], source=${messageData.source}(${sourceDescription})`,
        );
        return;
      }

      // 暂时跳过群聊消息
      if (isRoom) {
        this.logger.debug(`[${scenarioType}] 暂时跳过群聊消息 [${messageId}]`);
        return;
      }

      // 检查消息内容是否为空或无法处理（如图片、表情等）
      if (!content || content.trim().length === 0) {
        this.logger.debug(
          `[${scenarioType}] 跳过空内容或非文本消息 [${messageId}], messageType=${messageData.messageType}`,
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
      // await this.messageSenderService.sendMessage({
      //   token,
      //   chatId, // 使用 chatId 而不是 wxid
      //   messageType: SendMessageType.TEXT, // 发送文本消息类型为 0
      //   payload: {
      //     text: replyContent, // 文本内容放在 payload.text 中
      //   },
      // });
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
