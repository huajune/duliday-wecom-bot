import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentApiService } from '../agent-api/agent-api.service';
import { CustomerService } from '../customer/customer.service';
import { ApiClientService } from '../api-client/api-client.service';
import { IncomingMessageData } from './dto/send-message.dto';

@Injectable()
export class MessageService {
  private readonly logger = new Logger(MessageService.name);
  private readonly enableAiReply: boolean;

  constructor(
    private readonly customerService: CustomerService,
    private readonly agentApiService: AgentApiService,
    private readonly apiClientService: ApiClientService,
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
      const { token, fromUser, content, messageType, roomId, isRoom } = messageData;

      // 只处理文本消息
      if (messageType !== 'text' && messageType !== 'Text') {
        this.logger.log(`跳过非文本消息，类型: ${messageType}`);
        return;
      }

      // 构建会话 ID（用于多轮对话）
      const conversationId = this.generateConversationId(fromUser, roomId, isRoom);

      // 构建上下文
      const context = {
        fromUser,
        roomId,
        isRoom,
        timestamp: Date.now(),
      };

      this.logger.log(`正在为${isRoom ? `群 ${roomId}` : `用户 ${fromUser}`} 生成 AI 回复...`);
      this.logger.log(`会话 ID: ${conversationId}`);

      // 调用 Agent API 生成回复（使用标准 /api/v1/chat 接口）
      const aiResponse = await this.agentApiService.generateReply(content, context);

      // 提取回复内容
      const replyContent = aiResponse?.reply;

      if (!replyContent) {
        this.logger.warn('AI 未生成有效回复');
        return;
      }

      // 记录 token 使用情况
      if (aiResponse?.usage) {
        this.logger.log(
          `Token 使用: prompt=${aiResponse.usage.promptTokens}, ` +
            `completion=${aiResponse.usage.completionTokens}, ` +
            `total=${aiResponse.usage.totalTokens}`,
        );
      }

      // 记录使用的工具
      if (aiResponse?.tools?.used && aiResponse.tools.used.length > 0) {
        this.logger.log(`使用的工具: ${aiResponse.tools.used.join(', ')}`);
      }

      this.logger.log(`AI 生成回复成功 (${replyContent.length} 字符)`);

      // 发送回复消息（复用 CustomerService 的 sendMessage 方法）
      const targetId = isRoom ? roomId : fromUser;
      await this.customerService.sendMessage({
        token,
        wxid: targetId,
        content: replyContent,
        type: 'text',
      });

      this.logger.log(`成功发送 AI 回复给 ${isRoom ? `群 ${roomId}` : `用户 ${fromUser}`}`);
    } catch (error) {
      this.logger.error('AI 处理消息失败:', error);
      // 不抛出错误，避免影响其他消息处理
    }
  }

  /**
   * 生成会话 ID
   * 对于私聊：使用 fromUser
   * 对于群聊：使用 roomId
   */
  private generateConversationId(fromUser: string, roomId?: string, isRoom?: boolean): string {
    if (isRoom && roomId) {
      return `room_${roomId}`;
    }
    return `user_${fromUser}`;
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
