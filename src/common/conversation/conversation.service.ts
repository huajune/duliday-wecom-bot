import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversationStatsDto, CreateConversationDto } from './dto';

/**
 * 会话管理服务
 * 负责存储和管理多轮对话的消息历史
 *
 * 这是一个通用的会话管理服务，可以被任何需要管理对话历史的模块使用（如 Agent、聊天机器人等）
 */
@Injectable()
export class ConversationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConversationService.name);

  // 会话存储：conversationId -> messages（使用 any[] 保持灵活性）
  private readonly conversations = new Map<string, any[]>();

  // 会话最大消息数限制（可配置）
  private readonly maxMessagesPerConversation: number;

  // 会话超时时间（毫秒，可配置）
  private readonly conversationTimeout: number;

  // 清理间隔时间（毫秒，可配置）
  private readonly cleanupInterval: number;

  // 会话最后活动时间
  private readonly lastActivity = new Map<string, number>();

  // 定时器引用（用于清理）
  private cleanupTimer: NodeJS.Timeout;

  constructor(private readonly configService: ConfigService) {
    // 从配置读取参数，必须配置
    const maxMessages = this.configService.get<number>('CONVERSATION_MAX_MESSAGES');
    if (!maxMessages) {
      throw new Error('CONVERSATION_MAX_MESSAGES 环境变量未配置，请在 .env 文件中设置');
    }
    this.maxMessagesPerConversation = maxMessages;

    const timeout = this.configService.get<number>('CONVERSATION_TIMEOUT_MS');
    if (!timeout) {
      throw new Error('CONVERSATION_TIMEOUT_MS 环境变量未配置，请在 .env 文件中设置');
    }
    this.conversationTimeout = timeout;

    const cleanupInterval = this.configService.get<number>('CONVERSATION_CLEANUP_INTERVAL_MS');
    if (!cleanupInterval) {
      throw new Error('CONVERSATION_CLEANUP_INTERVAL_MS 环境变量未配置，请在 .env 文件中设置');
    }
    this.cleanupInterval = cleanupInterval;

    this.logger.log('会话管理服务配置:');
    this.logger.log(`- 最大消息数: ${this.maxMessagesPerConversation}`);
    this.logger.log(`- 超时时间: ${this.conversationTimeout / 1000 / 60} 分钟`);
    this.logger.log(`- 清理间隔: ${this.cleanupInterval / 1000 / 60} 分钟`);
  }

  /**
   * 模块初始化时启动定时清理任务
   */
  onModuleInit() {
    this.cleanupTimer = setInterval(() => this.cleanupExpiredConversations(), this.cleanupInterval);
    this.logger.log('会话清理定时任务已启动');
  }

  /**
   * 模块销毁时清理定时器
   */
  onModuleDestroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.logger.log('会话清理定时任务已停止');
    }
  }

  /**
   * 生成会话 ID
   * 对于私聊：使用 fromUser
   * 对于群聊：使用 roomId
   */
  generateConversationId(params: CreateConversationDto): string {
    const { fromUser, roomId, isRoom } = params;
    return isRoom && roomId ? `room_${roomId}` : `user_${fromUser}`;
  }

  /**
   * 获取会话历史（默认返回最新的20条消息）
   * @param conversationId 会话 ID
   * @param options 可选的分页参数
   * @returns 消息列表（按时间顺序，最新的20条）
   */
  getHistory(conversationId: string, options?: { limit?: number; offset?: number }): any[] {
    this.updateLastActivity(conversationId);
    const messages = this.conversations.get(conversationId) || [];

    // 默认只返回最新的20条消息
    const { offset = 0, limit = 20 } = options || {};

    // 从末尾开始取最新的消息
    const totalMessages = messages.length;
    const startIndex = Math.max(0, totalMessages - limit - offset);
    const endIndex = Math.max(0, totalMessages - offset);

    return messages.slice(startIndex, endIndex);
  }

  /**
   * 添加消息到会话历史
   * @param conversationId 会话 ID
   * @param message 消息对象
   * @throws BadRequestException 如果消息格式无效
   */
  addMessage(conversationId: string, message: any): void {
    try {
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
    } catch (error) {
      this.logger.error(
        `添加消息失败 [conversationId=${conversationId}]: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(`无效的消息格式: ${error.message}`);
    }
  }

  /**
   * 批量添加消息到会话历史（优化版本，避免多次 Map 操作）
   * @param conversationId 会话 ID
   * @param messages 消息数组
   * @throws BadRequestException 如果任何消息格式无效
   */
  addMessages(conversationId: string, messages: any[]): void {
    if (!messages || messages.length === 0) {
      return;
    }

    try {
      this.updateLastActivity(conversationId);

      let existingMessages = this.conversations.get(conversationId) || [];

      // 批量归一化消息
      const normalizedMessages = messages.map((m) => this.normalizeMessage(m));
      existingMessages.push(...normalizedMessages);

      // 限制消息数量，保留最近的消息
      if (existingMessages.length > this.maxMessagesPerConversation) {
        existingMessages = existingMessages.slice(-this.maxMessagesPerConversation);
        this.logger.log(
          `会话 ${conversationId} 消息数超限，保留最近 ${this.maxMessagesPerConversation} 条`,
        );
      }

      this.conversations.set(conversationId, existingMessages);
      this.logger.log(
        `会话 ${conversationId} 批量添加 ${messages.length} 条消息，当前消息数: ${existingMessages.length}`,
      );
    } catch (error) {
      this.logger.error(
        `批量添加消息失败 [conversationId=${conversationId}]: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(`批量添加失败: ${error.message}`);
    }
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
