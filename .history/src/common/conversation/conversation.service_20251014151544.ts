import { Injectable, Logger } from '@nestjs/common';
import { MessageDto, SimpleMessageDto, ConversationStatsDto, CreateConversationDto } from './dto';

/**
 * 会话管理服务
 * 负责存储和管理多轮对话的消息历史
 *
 * 这是一个通用的会话管理服务，可以被任何需要管理对话历史的模块使用（如 Agent、聊天机器人等）
 */
@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  // 会话存储：conversationId -> messages（支持任意消息格式）
  private readonly conversations = new Map<string, any[]>();

  // 会话最大消息数限制
  private readonly maxMessagesPerConversation = 50;

  // 会话超时时间（毫秒）：2小时
  private readonly conversationTimeout = 2 * 60 * 60 * 1000;

  // 会话最后活动时间
  private readonly lastActivity = new Map<string, number>();

  constructor() {
    // 每小时清理一次过期会话
    setInterval(() => this.cleanupExpiredConversations(), 60 * 60 * 1000);
  }

  /**
   * 生成会话 ID
   * 对于私聊：使用 fromUser
   * 对于群聊：使用 roomId
   */
  generateConversationId(params: CreateConversationDto): string;
  generateConversationId(fromUser: string, roomId?: string, isRoom?: boolean): string;
  generateConversationId(
    paramsOrFromUser: CreateConversationDto | string,
    roomId?: string,
    isRoom?: boolean,
  ): string {
    // 兼容两种调用方式
    if (typeof paramsOrFromUser === 'string') {
      const fromUser = paramsOrFromUser;
      if (isRoom && roomId) {
        return `room_${roomId}`;
      }
      return `user_${fromUser}`;
    } else {
      const { fromUser, roomId, isRoom } = paramsOrFromUser;
      if (isRoom && roomId) {
        return `room_${roomId}`;
      }
      return `user_${fromUser}`;
    }
  }

  /**
   * 获取会话历史
   */
  getHistory(conversationId: string): any[] {
    this.updateLastActivity(conversationId);
    return this.conversations.get(conversationId) || [];
  }

  /**
   * 添加消息到会话历史
   */
  addMessage(conversationId: string, message: any): void {
    this.updateLastActivity(conversationId);

    let messages = this.conversations.get(conversationId) || [];

    // 转换 SimpleMessage 为标准格式（如果需要）
    const normalizedMessage = this.normalizeMessage(message);

    messages.push(normalizedMessage);

    // 限制消息数量，保留最近的消息
    if (messages.length > this.maxMessagesPerConversation) {
      messages = messages.slice(-this.maxMessagesPerConversation);
      this.logger.log(
        `会话 ${conversationId} 消息数超限，保留最近 ${this.maxMessagesPerConversation} 条`,
      );
    }

    this.conversations.set(conversationId, messages);
    this.logger.log(`会话 ${conversationId} 添加消息，当前消息数: ${messages.length}`);
  }

  /**
   * 批量添加消息到会话历史
   */
  addMessages(conversationId: string, messages: any[]): void {
    messages.forEach((message) => this.addMessage(conversationId, message));
  }

  /**
   * 清空会话历史
   */
  clearConversation(conversationId: string): void {
    this.conversations.delete(conversationId);
    this.lastActivity.delete(conversationId);
    this.logger.log(`会话 ${conversationId} 已清空`);
  }

  /**
   * 获取所有活跃会话 ID
   */
  getActiveConversations(): string[] {
    return Array.from(this.conversations.keys());
  }

  /**
   * 获取会话统计信息
   */
  getStats(conversationId: string): ConversationStatsDto {
    const messages = this.conversations.get(conversationId) || [];
    const lastActivity = this.lastActivity.get(conversationId);

    return {
      conversationId,
      messageCount: messages.length,
      lastActivity: lastActivity ? new Date(lastActivity) : null,
      isActive: lastActivity ? Date.now() - lastActivity < this.conversationTimeout : false,
    };
  }

  /**
   * 归一化消息格式
   * 将 SimpleMessage 转换为标准格式
   */
  private normalizeMessage(message: any): any {
    if ('parts' in message) {
      // 已经是标准消息格式
      return message;
    }

    // 转换 SimpleMessage 为标准格式
    if ('content' in message) {
      const simpleMessage = message;

      // 验证内容不为空
      if (!simpleMessage.content || simpleMessage.content.trim() === '') {
        throw new Error('消息内容不能为空');
      }

      return {
        role: simpleMessage.role,
        parts: [
          {
            type: 'text',
            text: simpleMessage.content,
          },
        ],
      };
    }

    // 其他格式直接返回
    return message;
  }

  /**
   * 更新会话最后活动时间
   */
  private updateLastActivity(conversationId: string): void {
    this.lastActivity.set(conversationId, Date.now());
  }

  /**
   * 清理过期会话
   */
  private cleanupExpiredConversations(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [conversationId, lastActivityTime] of this.lastActivity.entries()) {
      if (now - lastActivityTime > this.conversationTimeout) {
        this.conversations.delete(conversationId);
        this.lastActivity.delete(conversationId);
        cleanedCount++;
        this.logger.log(`清理过期会话: ${conversationId}`);
      }
    }

    if (cleanedCount > 0) {
      this.logger.log(`清理了 ${cleanedCount} 个过期会话`);
    }
  }
}
