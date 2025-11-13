import { Controller, Post, Body, Logger, Get, Query } from '@nestjs/common';
import { MessageService } from './message.service';
import { RawResponse } from '@core/server';
import {
  MessageType,
  ContactType,
  MessageSource,
  EnterpriseMessageCallbackDto,
} from './dto/message-callback.dto';
import { AgentService } from '@agent';

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
  ) {}

  /**
   * 接收企微机器人推送的消息
   * @description 接收消息回调，支持 AI 自动回复
   * @example POST /message
   */
  @RawResponse() // 企微回调必须返回原始格式，不使用统一包装
  @Post()
  async receiveMessage(@Body() body: EnterpriseMessageCallbackDto) {
    this.logger.log(
      `收到消息回调: messageId=${body.messageId}, source=${body.source}, chatId=${body.chatId}`,
    );
    return await this.messageService.handleMessage(body);
  }

  /**
   * 接收消息发送结果回调（连字符命名）
   * @description 接收消息发送状态的回调通知
   * @example POST /message/sent-result
   */
  @RawResponse() // 企微回调必须返回原始格式，不使用统一包装
  @Post('sent-result')
  async receiveSentResult(@Body() body: any) {
    this.logger.debug('接收到发送结果回调 (sent-result)');
    return await this.messageService.handleSentResult(body);
  }

  /**
   * 接收消息发送结果回调（驼峰命名）
   * @description 兼容托管平台的驼峰命名回调
   * @example POST /message/sentResult
   */
  @RawResponse()
  @Post('sentResult')
  async receiveSentResultCamelCase(@Body() body: any) {
    this.logger.debug('接收到发送结果回调 (sentResult)');
    return await this.messageService.handleSentResult(body);
  }

  /**
   * 测试接口：模拟消息回调
   * @description 用于测试和调试，模拟企微推送消息，触发 AI 自动回复
   * @example POST /message/test
   * @body { "text": "你好，有什么岗位？", "chatId": "test_chat_123", "orgId": "test_org" }
   */
  @Post('test')
  async testMessage(
    @Body()
    body: {
      text: string;
      chatId?: string;
      orgId?: string;
      token?: string;
    },
  ) {
    this.logger.log('收到测试消息请求:', body);

    // 构造模拟的消息数据，符合 EnterpriseMessageCallbackDto 格式
    const mockMessageData: EnterpriseMessageCallbackDto = {
      orgId: body.orgId || 'test_org_123',
      token: body.token || 'test_token_for_development',
      botId: 'test_bot_123',
      imBotId: 'test_bot_wxid',
      chatId: body.chatId || `test_chat_${Date.now()}`,
      messageType: MessageType.TEXT,
      messageId: `test_msg_${Date.now()}`,
      timestamp: Date.now().toString(),
      isSelf: false,
      source: MessageSource.NEW_CUSTOMER_ANSWER_SOP, // 新客户应答sop，触发 AI 回复
      contactType: ContactType.PERSONAL_WECHAT,
      payload: {
        text: body.text,
        pureText: body.text,
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

  /**
   * 获取服务状态
   * @description 获取消息服务的当前运行状态（并发、缓存使用率等）
   * @example GET /message/service/status
   */
  @Get('service/status')
  getServiceStatus() {
    return this.messageService.getServiceStatus();
  }

  /**
   * 获取缓存统计信息
   * @description 获取详细的缓存统计数据，包括去重缓存、历史记录、聚合队列等
   * @example GET /message/cache/stats
   */
  @Get('cache/stats')
  getCacheStats() {
    return this.messageService.getCacheStats();
  }

  /**
   * 获取内存中的聊天记录
   * @description 获取所有会话的聊天历史记录，或获取指定会话的历史
   * @example GET /message/history/all
   * @example GET /message/history/all?chatId=wxid_xxx
   */
  @Get('history/all')
  getAllHistory(@Query('chatId') chatId?: string) {
    return this.messageService.getAllHistory(chatId);
  }

  /**
   * 手动清理内存缓存
   * @description 清理消息服务的内存缓存，支持选择性清理
   * @example POST /message/cache/clear
   * @body { "deduplication": true, "history": true, "mergeQueues": true }
   * @example POST /message/cache/clear?chatId=wxid_xxx (清理指定会话)
   */
  @Post('cache/clear')
  clearCache(
    @Body()
    body?: {
      deduplication?: boolean;
      history?: boolean;
      mergeQueues?: boolean;
    },
    @Query('chatId') chatId?: string,
  ) {
    const options = {
      ...body,
      chatId,
    };

    return this.messageService.clearCache(options);
  }

  /**
   * 测试接口：模拟 Agent API 失败
   * @description 用于测试错误处理流程，包括飞书告警和降级回复
   * @example POST /message/test-error
   * @body { "text": "测试消息", "chatId": "test_chat_123", "errorType": "timeout" }
   */
  @Post('test-error')
  async testError(
    @Body()
    body: {
      text?: string;
      chatId?: string;
      orgId?: string;
      token?: string;
      errorType?: 'timeout' | 'network' | 'unauthorized' | 'server_error';
    },
  ) {
    this.logger.log('收到错误测试请求:', body);

    // 构造模拟的消息数据
    const mockMessageData: EnterpriseMessageCallbackDto = {
      orgId: body.orgId || 'test_org_123',
      token: body.token || 'test_token_for_development',
      botId: 'test_bot_123',
      imBotId: 'test_bot_wxid',
      chatId: body.chatId || `test_chat_${Date.now()}`,
      messageType: MessageType.TEXT,
      messageId: `test_msg_${Date.now()}`,
      timestamp: Date.now().toString(),
      isSelf: false,
      source: MessageSource.NEW_CUSTOMER_ANSWER_SOP, // 触发 AI 回复
      contactType: ContactType.PERSONAL_WECHAT,
      payload: {
        text: body.text || '测试 Agent API 失败',
        pureText: body.text || '测试 Agent API 失败',
      },
    };

    this.logger.log('构造的模拟消息:', JSON.stringify(mockMessageData, null, 2));

    try {
      // 调用消息处理服务，由于我们会在测试环境中模拟失败，
      // 这里应该会触发错误处理流程
      const result = await this.messageService.handleMessage(mockMessageData);

      return {
        success: true,
        message: '测试消息已发送（预期会触发 Agent API 失败处理）',
        mockData: mockMessageData,
        result,
        note: '如果 Agent API 配置不正确或不可用，应该会收到飞书告警和降级回复',
      };
    } catch (error) {
      // 如果这里捕获到错误，说明错误处理可能有问题
      this.logger.error('测试过程中发生未预期的错误:', error);
      return {
        success: false,
        message: '测试失败（消息服务抛出了异常）',
        error: error.message,
        note: '消息服务应该内部处理错误，不应该向外抛出',
      };
    }
  }
}
