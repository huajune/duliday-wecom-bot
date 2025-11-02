import { Controller, Post, Body, Logger } from '@nestjs/common';
import { MessageService } from './message.service';
import { RawResponse } from '@core/server';
import { MessageType, ContactType } from './dto/send-message.dto';
import { MessageSource } from './enums/message-source.enum';
import { AgentService, AgentConfigService, ScenarioType } from '@agent';

/**
 * 消息处理控制器
 * 负责接收和处理企微机器人的消息回调
 *
 * 注意：企微回调接口必须返回特定格式，使用 @RawResponse 豁免统一包装
 */
@Controller('message')
export class MessageController {
  private readonly logger = new Logger(MessageController.name);

  constructor(
    private readonly messageService: MessageService,
    private readonly agentService: AgentService,
    private readonly agentConfigService: AgentConfigService,
  ) {}

  /**
   * 接收企微机器人推送的消息
   * @description 接收消息回调，支持 AI 自动回复
   * @example POST /message
   */
  @RawResponse() // 企微回调必须返回原始格式，不使用统一包装
  @Post()
  async receiveMessage(@Body() body: any) {
    this.logger.log('接收到消息回调');
    return await this.messageService.handleMessage(body);
  }

  /**
   * 接收消息发送结果回调
   * @description 接收消息发送状态的回调通知
   * @example POST /message/sent-result
   */
  @RawResponse() // 企微回调必须返回原始格式，不使用统一包装
  @Post('sent-result')
  async receiveSentResult(@Body() body: any) {
    this.logger.log('接收到发送结果回调');
    return await this.messageService.handleSentResult(body);
  }

  /**
   * 测试接口：模拟消息回调
   * @description 用于测试和调试，模拟企微推送消息，触发 AI 自动回复
   * @example POST /message/test
   * @body { "text": "你好，有什么岗位？", "chatId": "test_chat_123", "contactName": "测试用户" }
   */
  @Post('test')
  async testMessage(
    @Body()
    body: {
      text: string;
      chatId?: string;
      contactName?: string;
      token?: string;
    },
  ) {
    this.logger.log('收到测试消息请求:', body);

    // 构造模拟的消息数据，符合 IncomingMessageData 格式
    const mockMessageData = {
      data: {
        // 基本信息
        messageId: `test_msg_${Date.now()}`,
        chatId: body.chatId || `test_chat_${Date.now()}`,
        timestamp: Date.now(),
        type: MessageType.TEXT,
        payload: {
          text: body.text,
          pureText: body.text,
        },

        // 会话信息
        token: body.token || 'test_token_for_development',

        // 机器人信息
        botId: 'test_bot_123',
        botWxid: 'test_bot_wxid',
        botWeixin: 'test_bot_weixin',

        // 联系人信息
        contactName: body.contactName || '测试用户',
        contactId: 'test_contact_wxid_123',
        externalUserId: 'test_external_user_123',
        chatExternalUserId: '',
        avatar: '',
        contactType: ContactType.EXTERNAL_CUSTOMER,
        coworker: false,

        // 群聊信息（私聊为空）
        roomId: '',
        roomName: '',
        roomTopic: '',
        roomWecomChatId: null,

        // 消息状态
        isSelf: false,
        mentionSelf: false,
        source: MessageSource.NEW_CUSTOMER_ANSWER_SOP, // 设置为新客户应答sop，触发AI回复

        // 其他信息
        sendBy: '',
      },
    };

    this.logger.log('构造的模拟消息:', JSON.stringify(mockMessageData, null, 2));

    // 调用消息处理服务
    const result = await this.messageService.handleMessage(mockMessageData);

    return {
      success: true,
      message: '测试消息已发送',
      mockData: mockMessageData,
      result,
    };
  }
}
