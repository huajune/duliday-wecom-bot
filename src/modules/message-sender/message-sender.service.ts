import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@core/http';
import { ApiConfigService } from '@core/config';
import { SendMessageDto } from './dto/send-message.dto';
import { CreateBroadcastDto } from './dto/create-broadcast.dto';

/**
 * 消息发送服务
 * 负责消息的发送（单发、群发）
 */
@Injectable()
export class MessageSenderService {
  private readonly logger = new Logger(MessageSenderService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly apiConfig: ApiConfigService,
  ) {}

  /**
   * 发送消息
   * @param data - 发送消息数据
   * @returns 发送结果
   */
  async sendMessage(data: SendMessageDto | any) {
    try {
      const apiUrl = this.apiConfig.endpoints.message.send();

      const result = await this.httpService.post(apiUrl, data);

      this.logger.log('发送消息成功');
      return result;
    } catch (error) {
      this.logger.error('发送消息失败:', error);
      throw error;
    }
  }

  /**
   * 创建群发消息
   * @param data - 群发消息数据
   * @returns 群发结果
   */
  async createBroadcast(data: CreateBroadcastDto) {
    try {
      const apiUrl = this.apiConfig.endpoints.message.send();

      const result = await this.httpService.post(apiUrl, data);

      this.logger.log('创建群发消息成功');
      return result;
    } catch (error) {
      this.logger.error('创建群发消息失败:', error);
      throw error;
    }
  }
}
