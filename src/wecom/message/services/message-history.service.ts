import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
 */
@Injectable()
export class MessageHistoryService implements OnModuleDestroy {
  private readonly logger = new Logger(MessageHistoryService.name);

  // 基于 chatId 的消息历史缓存 (chatId -> messages)
  private readonly messageHistory = new Map<string, MessageHistoryItem[]>();
  private readonly maxHistoryPerChat: number;
  private readonly historyTTL: number; // 历史记录过期时间（毫秒）

  // 定时清理任务的句柄
  private cleanupIntervalHandle: NodeJS.Timeout | null = null;

  constructor(private readonly configService: ConfigService) {
    // 从环境变量读取历史消息配置（提高默认值以支持更长对话）
    this.maxHistoryPerChat = parseInt(
      this.configService.get<string>('MAX_HISTORY_PER_CHAT', '60'),
      10,
    );
    this.historyTTL = parseInt(this.configService.get<string>('HISTORY_TTL_MS', '7200000'), 10); // 默认2小时

    this.logger.log(
      `消息历史服务已初始化: 每个会话最多保留 ${this.maxHistoryPerChat} 条消息（约 ${Math.floor(this.maxHistoryPerChat / 2)} 轮对话），过期时间 ${this.historyTTL / 1000 / 60} 分钟`,
    );

    // 启动定期清理任务
    this.startCleanup();
  }

  /**
   * 获取指定会话的历史消息
   */
  getHistory(chatId: string): Array<{ role: 'user' | 'assistant'; content: string }> {
    const history = this.messageHistory.get(chatId) || [];
    const now = Date.now();

    // 过滤掉过期的消息
    const validHistory = history.filter((msg) => now - msg.timestamp < this.historyTTL);

    // 只返回最近 N 条消息
    const recentHistory = validHistory.slice(-this.maxHistoryPerChat);

    return recentHistory.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
  }

  /**
   * 添加消息到历史记录
   */
  addMessageToHistory(chatId: string, role: 'user' | 'assistant', content: string) {
    let history = this.messageHistory.get(chatId) || [];

    // 添加新消息
    history.push({
      role,
      content,
      timestamp: Date.now(),
    });

    // 只保留最近 N 条消息
    if (history.length > this.maxHistoryPerChat) {
      history = history.slice(-this.maxHistoryPerChat);
    }

    this.messageHistory.set(chatId, history);
  }

  /**
   * 清理指定会话的历史记录
   */
  clearHistory(chatId?: string): number {
    if (chatId) {
      // 清理指定会话
      const messages = this.messageHistory.get(chatId);
      if (messages) {
        const count = messages.length;
        this.messageHistory.delete(chatId);
        this.logger.log(`已清理指定会话 [${chatId}] 的历史记录: ${count} 条`);
        return count;
      }
      return 0;
    } else {
      // 清理所有会话
      let totalMessages = 0;
      for (const messages of this.messageHistory.values()) {
        totalMessages += messages.length;
      }
      this.messageHistory.clear();
      this.logger.log(`已清理所有会话历史记录: ${totalMessages} 条消息`);
      return totalMessages;
    }
  }

  /**
   * 清理过期的历史记录
   * @returns 清理的会话数和消息数
   */
  cleanupExpiredHistory(): { conversationCount: number; messageCount: number } {
    const now = Date.now();
    let cleanedConversations = 0;
    let cleanedMessages = 0;

    for (const [chatId, history] of this.messageHistory.entries()) {
      const beforeCount = history.length;
      const validHistory = history.filter((msg) => now - msg.timestamp < this.historyTTL);

      if (validHistory.length === 0) {
        // 如果所有消息都过期了，删除整个会话
        this.messageHistory.delete(chatId);
        cleanedConversations++;
        cleanedMessages += beforeCount;
      } else if (validHistory.length !== history.length) {
        // 更新为过滤后的历史
        this.messageHistory.set(chatId, validHistory);
        cleanedMessages += beforeCount - validHistory.length;
      }
    }

    if (cleanedConversations > 0 || cleanedMessages > 0) {
      this.logger.debug(`清理过期历史: ${cleanedConversations} 个会话, ${cleanedMessages} 条消息`);
    }

    return { conversationCount: cleanedConversations, messageCount: cleanedMessages };
  }

  /**
   * 获取统计信息
   */
  getStats() {
    let totalMessages = 0;
    for (const messages of this.messageHistory.values()) {
      totalMessages += messages.length;
    }

    return {
      totalConversations: this.messageHistory.size,
      totalMessages,
      averageMessagesPerConversation:
        this.messageHistory.size > 0 ? (totalMessages / this.messageHistory.size).toFixed(2) : 0,
      maxMessagesPerConversation: this.maxHistoryPerChat,
      ttlMinutes: this.historyTTL / 1000 / 60,
    };
  }

  /**
   * 获取所有会话的历史记录
   * @returns 所有会话的历史记录，包含统计信息
   */
  getAllHistory() {
    const now = Date.now();
    const conversations: Array<{
      chatId: string;
      messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>;
      messageCount: number;
      oldestTimestamp: number;
      newestTimestamp: number;
    }> = [];

    for (const [chatId, history] of this.messageHistory.entries()) {
      // 过滤掉过期的消息
      const validHistory = history.filter((msg) => now - msg.timestamp < this.historyTTL);

      if (validHistory.length > 0) {
        const timestamps = validHistory.map((msg) => msg.timestamp);
        conversations.push({
          chatId,
          messages: validHistory,
          messageCount: validHistory.length,
          oldestTimestamp: Math.min(...timestamps),
          newestTimestamp: Math.max(...timestamps),
        });
      }
    }

    // 按最新消息时间倒序排列
    conversations.sort((a, b) => b.newestTimestamp - a.newestTimestamp);

    return {
      totalConversations: conversations.length,
      totalMessages: conversations.reduce((sum, conv) => sum + conv.messageCount, 0),
      conversations,
    };
  }

  /**
   * 启动定期清理任务
   */
  private startCleanup() {
    // 每5分钟清理一次过期的历史记录
    const cleanupInterval = 300000; // 5分钟

    this.cleanupIntervalHandle = setInterval(() => {
      this.cleanupExpiredHistory();
    }, cleanupInterval);

    this.logger.log('已启动历史记录定时清理任务 (每5分钟执行一次)');
  }

  /**
   * 停止定期清理任务
   */
  stopCleanup() {
    if (this.cleanupIntervalHandle) {
      clearInterval(this.cleanupIntervalHandle);
      this.cleanupIntervalHandle = null;
      this.logger.log('已停止历史记录定时清理任务');
    }
  }

  /**
   * 模块销毁钩子
   */
  onModuleDestroy() {
    this.stopCleanup();
  }
}
