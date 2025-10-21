import { Injectable, Logger } from '@nestjs/common';
import { ApiClientService } from '../api-client/api-client.service';

@Injectable()
export class MessageService {
  private readonly logger = new Logger(MessageService.name);

  constructor(private readonly apiClientService: ApiClientService) {}

  /**
   * 处理接收到的消息
   */
  async handleMessage(messageData: any) {
    this.logger.log('收到消息回调:', JSON.stringify(messageData));
    // 先暂停转发，方便调试
    // try {
    //   const apiUrl = 'https://stride-bg.dpclouds.com/stream-api/message';
    //   const result = await this.apiClientService.callPostApi(apiUrl, messageData);
    //   this.logger.log('消息回调转发成功');
    //   return result;
    // } catch (error: any) {
    //   this.logger.error('处理消息失败:', error);
    //   const detail = error?.response?.data ?? error?.message ?? 'Unknown error';
    //   throw new HttpException(
    //     {
    //       message: '转发第三方消息接口失败',
    //       detail,
    //     },
    //     HttpStatus.BAD_GATEWAY,
    //   );
    // }
    return { success: true };
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

  /**
   * 获取聊天历史
   */
  async getMessageHistory(token: string, pageSize: number, snapshotDay: string, seq?: string) {
    try {
      const apiUrl = 'https://stride-bg.dpclouds.com/stream-api/message/history';

      const params: any = {
        token,
        pageSize,
        snapshotDay,
      };

      if (seq) {
        params.seq = seq;
      }

      const result = await this.apiClientService.callGetApi(apiUrl, params);

      this.logger.log('获取聊天历史成功');
      return result;
    } catch (error) {
      this.logger.error('获取聊天历史失败:', error);
      throw error;
    }
  }

  /**
   * 获取会话列表
   */
  async getChatList(token: string, iterator?: string, pageSize?: number) {
    try {
      const apiUrl = 'https://stride-bg.dpclouds.com/stream-api/chat/list';

      const params: any = { token };

      if (iterator) {
        params.iterator = iterator;
      }

      if (pageSize !== undefined) {
        params.pageSize = pageSize;
      }

      const result = await this.apiClientService.callGetApi(apiUrl, params);

      this.logger.log('获取会话列表成功');
      return result;
    } catch (error) {
      this.logger.error('获取会话列表失败:', error);
      throw error;
    }
  }
}
