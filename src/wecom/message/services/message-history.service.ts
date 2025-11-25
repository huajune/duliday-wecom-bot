import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '@core/redis';

/**
 * 消息历史记录项（基础版本）
 */
interface MessageHistoryItem {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

/**
 * 增强的消息历史记录项（包含完整元数据，用于飞书同步）
 */
export interface EnhancedMessageHistoryItem extends MessageHistoryItem {
  messageId: string; // 消息ID
  chatId: string; // 会话ID
  candidateName?: string; // 候选人昵称（contactName）
  managerName?: string; // 招募经理昵称（botUserId）
  orgId?: string; // 企业ID
  botId?: string; // Bot ID
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
   * 添加消息到历史记录（增强版本，支持完整元数据）
   * 使用 Redis List 原子操作 (rpush + ltrim + expire) 避免并发竞态
   * @param chatId 会话ID
   * @param role 角色（user 或 assistant）
   * @param content 消息内容
   * @param metadata 可选的元数据（用于飞书同步等高级功能）
   */
  async addMessageToHistory(
    chatId: string,
    role: 'user' | 'assistant',
    content: string,
    metadata?: {
      messageId?: string;
      candidateName?: string;
      managerName?: string;
      orgId?: string;
      botId?: string;
    },
  ): Promise<void> {
    try {
      const key = `${this.HISTORY_KEY_PREFIX}${chatId}`;

      // 序列化消息（包含元数据）
      const message: EnhancedMessageHistoryItem = {
        role,
        content,
        timestamp: Date.now(),
        chatId,
        messageId: metadata?.messageId || `msg_${Date.now()}`,
        candidateName: metadata?.candidateName,
        managerName: metadata?.managerName,
        orgId: metadata?.orgId,
        botId: metadata?.botId,
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
   * 获取指定会话的历史记录详情（完整版本，包含元数据）
   * 使用 Redis List (lrange)
   * @param chatId 会话 ID
   * @returns 会话的历史记录详情
   */
  async getHistoryDetail(chatId: string): Promise<{
    chatId: string;
    messages: Array<EnhancedMessageHistoryItem>;
    messageCount: number;
  } | null> {
    try {
      const key = `${this.HISTORY_KEY_PREFIX}${chatId}`;
      const rawHistory = await this.redisService.lrange<string>(key, 0, -1);

      if (!rawHistory || rawHistory.length === 0) {
        return null;
      }

      // 解析每条消息（支持旧格式和新格式）
      const messages = rawHistory.map((raw) => {
        const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return {
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
          timestamp: msg.timestamp,
          chatId: msg.chatId || chatId,
          messageId: msg.messageId || `msg_${msg.timestamp}`,
          candidateName: msg.candidateName,
          managerName: msg.managerName,
          orgId: msg.orgId,
          botId: msg.botId,
        } as EnhancedMessageHistoryItem;
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

  /**
   * 获取所有会话ID列表
   * @returns 所有存在历史记录的会话ID列表
   */
  async getAllChatIds(): Promise<string[]> {
    try {
      // 使用 Redis SCAN 命令扫描所有符合前缀的键（推荐做法，避免阻塞）
      const pattern = `${this.HISTORY_KEY_PREFIX}*`;
      const allKeys: string[] = [];
      let cursor: string | number = 0;

      // 循环 SCAN 直到遍历完所有键
      do {
        const [nextCursor, keys] = await this.redisService.scan(cursor, {
          match: pattern,
          count: 100, // 每次扫描 100 个键
        });

        allKeys.push(...keys);
        cursor = nextCursor;
      } while (cursor !== 0 && cursor !== '0');

      if (allKeys.length === 0) {
        return [];
      }

      // 提取 chatId（移除前缀）
      const chatIds = allKeys.map((key: string) => key.replace(this.HISTORY_KEY_PREFIX, ''));

      return chatIds;
    } catch (error) {
      this.logger.error('获取所有会话ID失败:', error);
      return [];
    }
  }

  /**
   * 获取指定时间范围内的所有聊天记录
   * @param startTime 开始时间（毫秒时间戳）
   * @param endTime 结束时间（毫秒时间戳）
   * @returns 所有会话的聊天记录列表
   */
  async getChatRecordsByTimeRange(
    startTime: number,
    endTime: number,
  ): Promise<
    Array<{
      chatId: string;
      messages: EnhancedMessageHistoryItem[];
    }>
  > {
    try {
      // 获取所有会话ID
      const chatIds = await this.getAllChatIds();

      if (chatIds.length === 0) {
        this.logger.log('没有找到任何会话记录');
        return [];
      }

      this.logger.log(`找到 ${chatIds.length} 个会话，开始过滤时间范围内的消息...`);

      const result: Array<{ chatId: string; messages: EnhancedMessageHistoryItem[] }> = [];

      // 遍历每个会话，过滤时间范围内的消息
      for (const chatId of chatIds) {
        const detail = await this.getHistoryDetail(chatId);
        if (!detail) continue;

        // 过滤时间范围内的消息
        const filteredMessages = detail.messages.filter(
          (msg) => msg.timestamp >= startTime && msg.timestamp < endTime,
        );

        if (filteredMessages.length > 0) {
          result.push({
            chatId,
            messages: filteredMessages,
          });
        }
      }

      this.logger.log(
        `时间范围过滤完成：找到 ${result.length} 个会话共 ${result.reduce((sum, r) => sum + r.messages.length, 0)} 条消息`,
      );

      return result;
    } catch (error) {
      this.logger.error('获取时间范围内的聊天记录失败:', error);
      return [];
    }
  }
}
