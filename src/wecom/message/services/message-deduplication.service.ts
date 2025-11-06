import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * 消息去重服务
 * 负责防止重复处理相同的消息（企微回调重试场景）
 */
@Injectable()
export class MessageDeduplicationService {
  private readonly logger = new Logger(MessageDeduplicationService.name);

  // 消息去重缓存 (messageId -> timestamp)
  private readonly processedMessages = new Map<string, number>();
  private readonly messageDedupeTTL: number;
  private readonly maxProcessedMessages: number;

  constructor(private readonly configService: ConfigService) {
    // 从环境变量读取配置
    this.messageDedupeTTL = 300000; // 5分钟
    this.maxProcessedMessages = 10000; // 最大缓存消息数，防止内存溢出

    this.logger.log(
      `消息去重服务已初始化: TTL=${this.messageDedupeTTL / 1000}秒, 最大缓存=${this.maxProcessedMessages}`,
    );
  }

  /**
   * 检查消息是否已处理
   */
  isMessageProcessed(messageId: string): boolean {
    return this.processedMessages.has(messageId);
  }

  /**
   * 标记消息为已处理
   * 包含容量保护：达到上限时清理最老的记录
   */
  markMessageAsProcessed(messageId: string): void {
    // 容量保护：如果达到上限，清理最老的 20% 记录
    if (this.processedMessages.size >= this.maxProcessedMessages) {
      this.logger.warn(`消息去重缓存达到上限 ${this.maxProcessedMessages}，执行紧急清理`);
      this.cleanupOldestMessages();
    }

    this.processedMessages.set(messageId, Date.now());
  }

  /**
   * 清理过期的消息记录
   * @returns 清理的记录数
   */
  cleanupExpiredMessages(): number {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [messageId, timestamp] of this.processedMessages.entries()) {
      if (now - timestamp > this.messageDedupeTTL) {
        this.processedMessages.delete(messageId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug(`清理了 ${cleanedCount} 条过期的消息去重记录`);
    }

    return cleanedCount;
  }

  /**
   * 清理最老的消息记录（保留最新的 80%）
   */
  private cleanupOldestMessages(): void {
    const entries = Array.from(this.processedMessages.entries());
    // 按时间戳排序
    entries.sort((a, b) => a[1] - b[1]);

    // 删除最老的 20%
    const deleteCount = Math.floor(entries.length * 0.2);
    for (let i = 0; i < deleteCount; i++) {
      this.processedMessages.delete(entries[i][0]);
    }

    this.logger.log(`紧急清理完成，删除了 ${deleteCount} 条最老的消息记录`);
  }

  /**
   * 清理所有缓存
   */
  clearAll(): void {
    const size = this.processedMessages.size;
    this.processedMessages.clear();
    this.logger.log(`已清理所有消息去重缓存: ${size} 条`);
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      cachedMessageIds: this.processedMessages.size,
      maxCapacity: this.maxProcessedMessages,
      utilizationPercent: (this.processedMessages.size / this.maxProcessedMessages) * 100,
      ttlMinutes: this.messageDedupeTTL / 1000 / 60,
    };
  }
}
