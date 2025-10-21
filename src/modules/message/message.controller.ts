import { Controller, Post, Body, Logger } from '@nestjs/common';
import { MessageService } from './message.service';

/**
 * 消息处理控制器
 * 负责接收和处理企微机器人的消息回调
 */
@Controller('message')
export class MessageController {
  private readonly logger = new Logger(MessageController.name);

  constructor(private readonly messageService: MessageService) {}

  /**
   * 接收企微机器人推送的消息
   * @description 接收消息回调，支持 AI 自动回复
   * @example POST /message
   */
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
  @Post('sent-result')
  async receiveSentResult(@Body() body: any) {
    this.logger.log('接收到发送结果回调');
    return await this.messageService.handleSentResult(body);
  }
}
