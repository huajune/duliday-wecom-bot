import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '@core/redis';

/**
 * 消息历史记录项
 */
interface MessageHistoryItem {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

/**
 * 消息历史管理服务
 * 负责管理每个会话的消息历史记录，用于 Agent 上下文
 * 使用 Redis 持久化存储，支持服务重启后恢复
 */
@Injectable()
export class MessageHistoryService {
  private readonly logger = new Logger(MessageHistoryService.name);

  // Redis key 前缀
  private readonly HISTORY_KEY_PREFIX = 'chat:history:';

  // 配置参数
  private readonly maxHistoryPerChat: number;
  private readonly historyTTLSeconds: number; // Redis TTL（秒）

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {
    // 从环境变量读取历史消息配置
    this.maxHistoryPerChat = parseInt(
      this.configService.get<string>('MAX_HISTORY_PER_CHAT', '60'),
      10,
    );
    const historyTTLMs = parseInt(this.configService.get<string>('HISTORY_TTL_MS', '7200000'), 10); // 默认2小时
    this.historyTTLSeconds = Math.floor(historyTTLMs / 1000);

    this.logger.log(
      `消息历史服务已初始化 (Redis 持久化): 每个会话最多保留 ${this.maxHistoryPerChat} 条消息（约 ${Math.floor(this.maxHistoryPerChat / 2)} 轮对话），TTL ${this.historyTTLSeconds / 60} 分钟`,
    );
  }

  /**
   * 获取指定会话的历史消息
   * 使用 Redis List (lrange) 获取列表
   */
  async getHistory(
    chatId: string,
  ): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
    try {
      const key = `${this.HISTORY_KEY_PREFIX}${chatId}`;
      // 使用 lrange 获取最近 N 条消息
      const rawHistory = await this.redisService.lrange<string>(key, -this.maxHistoryPerChat, -1);

      if (!rawHistory || rawHistory.length === 0) {
        return [];
      }

      // 解析每条消息
      return rawHistory.map((raw) => {
        const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return {
          role: msg.role,
          content: msg.content,
        };
      });
    } catch (error) {
      this.logger.error(`获取会话历史失败 [${chatId}]:`, error);
      return [];
    }
  }

  /**
   * 添加消息到历史记录
   * 使用 Redis List 原子操作 (rpush + ltrim + expire) 避免并发竞态
   */
  async addMessageToHistory(
    chatId: string,
    role: 'user' | 'assistant',
    content: string,
  ): Promise<void> {
    try {
      const key = `${this.HISTORY_KEY_PREFIX}${chatId}`;

      // 序列化消息
      const message: MessageHistoryItem = {
        role,
        content,
        timestamp: Date.now(),
      };

      // 原子操作：追加到列表末尾
      await this.redisService.rpush(key, JSON.stringify(message));

      // 原子操作：只保留最近 N 条消息
      await this.redisService.ltrim(key, -this.maxHistoryPerChat, -1);

      // 刷新 TTL
      await this.redisService.expire(key, this.historyTTLSeconds);
    } catch (error) {
      this.logger.error(`添加消息到历史失败 [${chatId}]:`, error);
    }
  }

  /**
   * 清理指定会话的历史记录
   * 使用 Redis List (llen + del)
   */
  async clearHistory(chatId?: string): Promise<number> {
    if (chatId) {
      // 清理指定会话
      try {
        const key = `${this.HISTORY_KEY_PREFIX}${chatId}`;
        const count = await this.redisService.llen(key);
        if (count > 0) {
          await this.redisService.del(key);
          this.logger.log(`已清理指定会话 [${chatId}] 的历史记录: ${count} 条`);
          return count;
        }
      } catch (error) {
        this.logger.error(`清理会话历史失败 [${chatId}]:`, error);
      }
      return 0;
    } else {
      // 清理所有会话（通过模式匹配删除）
      this.logger.warn('清理所有会话历史记录功能在 Redis 模式下需要谨慎使用');
      // 注意：Redis 不支持批量删除，这里只记录日志
      // 实际生产环境建议通过 TTL 自动过期
      return 0;
    }
  }

  /**
   * 获取统计信息
   * 注意：Redis 模式下无法准确统计所有会话，返回配置信息
   */
  getStats() {
    return {
      storageType: 'redis',
      maxMessagesPerConversation: this.maxHistoryPerChat,
      ttlMinutes: this.historyTTLSeconds / 60,
      keyPrefix: this.HISTORY_KEY_PREFIX,
    };
  }

  /**
   * 获取指定会话的历史记录详情
   * 使用 Redis List (lrange)
   * @param chatId 会话 ID
   * @returns 会话的历史记录详情
   */
  async getHistoryDetail(chatId: string): Promise<{
    chatId: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>;
    messageCount: number;
  } | null> {
    try {
      const key = `${this.HISTORY_KEY_PREFIX}${chatId}`;
      const rawHistory = await this.redisService.lrange<string>(key, 0, -1);

      if (!rawHistory || rawHistory.length === 0) {
        return null;
      }

      // 解析每条消息
      const messages = rawHistory.map((raw) => {
        const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return {
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
          timestamp: msg.timestamp,
        };
      });

      return {
        chatId,
        messages,
        messageCount: messages.length,
      };
    } catch (error) {
      this.logger.error(`获取会话历史详情失败 [${chatId}]:`, error);
      return null;
    }
  }
}
