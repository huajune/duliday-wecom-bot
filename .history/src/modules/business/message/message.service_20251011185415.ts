import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentApiService } from '../../../third-party/agent-api/agent-api.service';
import { AgentConfigService } from '../../../third-party/agent-api/agent-config.service';
import { ConversationManager } from '../../../third-party/agent-api/conversation.manager';
import { ScenarioType } from '../../../third-party/agent-api/agent-profile.interface';
import { MessageSenderService } from '../message-sender/message-sender.service';
import { IncomingMessageData } from './dto/send-message.dto';

/**
 * 消息处理服务
 * 负责接收、解析消息并触发 AI 自动回复
 */
@Injectable()
export class MessageService {
  private readonly logger = new Logger(MessageService.name);
  private readonly enableAiReply: boolean;

  constructor(
    private readonly messageSenderService: MessageSenderService,
    private readonly agentApiService: AgentApiService,
    private readonly agentConfigService: AgentConfigService,
    private readonly conversationManager: ConversationManager,
    private readonly configService: ConfigService,
  ) {
    // 从环境变量读取是否启用 AI 回复
    this.enableAiReply = this.configService.get<string>('ENABLE_AI_REPLY', 'true') === 'true';
    this.logger.log(`AI 自动回复功能: ${this.enableAiReply ? '已启用' : '已禁用'}`);
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
      } = parsedData;

      // 跳过机器人自己发送的消息
      if (isSelf) {
        this.logger.log('跳过机器人自己发送的消息');
        return;
      }

      // 只处理文本消息（type = 7）
      if (messageType !== 7 && messageType !== 'text' && messageType !== 'Text') {
        this.logger.log(`跳过非文本消息，类型: ${messageType}`);
        return;
      }

      // 如果是群聊消息但没有 @ 机器人，则跳过（可选逻辑）
      // if (isRoom && !mentionSelf) {
      //   this.logger.log('群聊消息未 @ 机器人，跳过处理');
      //   return;
      // }

      // 构建会话 ID（用于多轮对话）- 使用 ConversationManager 统一管理
      const conversationId = this.conversationManager.generateConversationId(
        contactId,
        roomId,
        isRoom,
      );

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

      // 4. 调用 Agent API 生成回复（使用完整的配置）
      const aiResponse = await this.agentApiService.chat({
        conversationId,
        userMessage: content,
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

      // 6. 记录 token 使用情况
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
      const targetId = isRoom ? roomId : contactId;
      await this.messageSenderService.sendMessage({
        token,
        wxid: targetId,
        content: replyContent,
        type: 'text',
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
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private determineScenario(parsedData: any): ScenarioType {
    // TODO: 根据实际业务需求实现场景判断逻辑
    // 例如：
    // - 根据 botId 判断是哪个业务场景
    // - 根据消息内容关键词判断
    // - 根据联系人信息判断
    // - 从数据库查询配置

    // 示例：简单判断逻辑（启用时移除参数名前的下划线）
    // if (_parsedData.botWxid === 'zhipin_bot') {
    //   return ScenarioType.BOSS_ZHIPIN_RECRUITER;
    // }

    // 默认使用企微客服场景
    return ScenarioType.WECOM_CUSTOMER_SERVICE;
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
        contactId: data.contactId,
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
    // 先暂停转发，方便调试
    // try {
    //   const apiUrl = 'https://stride-bg.dpclouds.com/stream-api/sentResult';
    //   const result = await this.apiClientService.callPostApi(apiUrl, resultData);
    //   this.logger.log('发送结果回调转发成功');
    //   return result;
    // } catch (error: any) {
    //   this.logger.error('处理发送结果回调失败:', error);
    //   const detail = error?.response?.data ?? error?.message ?? 'Unknown error';
    //   throw new HttpException(
    //     {
    //       message: '转发第三方发送结果接口失败',
    //       detail,
    //     },
    //     HttpStatus.BAD_GATEWAY,
    //   );
    // }
    return { success: true };
  }
}
