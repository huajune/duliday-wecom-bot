import { Injectable, Logger } from '@nestjs/common';
import {
  MessageProcessingRecord,
  HourlyStats,
  DashboardData,
  MetricsData,
} from './interfaces/monitoring.interface';

/**
 * 监控服务
 * 负责收集、存储和统计消息处理数据
 */
@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  // 配置
  private readonly MAX_DETAIL_RECORDS = 1000; // 最多保存1000条详细记录
  private readonly MAX_HOURLY_STATS = 72; // 保留72小时的聚合统计
  private readonly MAX_ERROR_LOGS = 100; // 最多保存100条错误日志

  // 内存存储
  private detailRecords: MessageProcessingRecord[] = []; // 环形缓冲区
  private hourlyStatsMap = new Map<string, HourlyStats>(); // 按小时聚合

  // 全局计数器
  private globalCounters = {
    totalMessages: 0,
    totalSuccess: 0,
    totalFailure: 0,
    totalAiDuration: 0,
    totalSendDuration: 0,
  };

  // 错误日志
  private errorLogs: Array<{
    messageId: string;
    timestamp: number;
    error: string;
  }> = [];

  // 活跃用户和会话（用于去重统计）
  private activeUsersSet = new Set<string>();
  private activeChatsSet = new Set<string>();

  constructor() {
    // 定期清理过期数据（每小时执行一次）
    setInterval(
      () => {
        this.cleanupExpiredData();
      },
      60 * 60 * 1000,
    );

    this.logger.log('监控服务已启动');
  }

  /**
   * 记录消息接收
   */
  recordMessageReceived(
    messageId: string,
    chatId: string,
    userId?: string,
    userName?: string,
    messageContent?: string,
  ): void {
    const record: MessageProcessingRecord = {
      messageId,
      chatId,
      userId,
      userName,
      receivedAt: Date.now(),
      status: 'processing',
      messagePreview: messageContent ? messageContent.substring(0, 50) : undefined,
    };

    this.addRecord(record);
    this.globalCounters.totalMessages++;

    // 记录活跃用户和会话
    if (userId) this.activeUsersSet.add(userId);
    if (chatId) this.activeChatsSet.add(chatId);

    this.logger.debug(`记录消息接收 [${messageId}]`);
  }

  /**
   * 记录 AI 处理开始
   */
  recordAiStart(messageId: string): void {
    const record = this.findRecord(messageId);
    if (record) {
      record.aiStartAt = Date.now();
      this.logger.debug(`记录 AI 开始处理 [${messageId}]`);
    }
  }

  /**
   * 记录 AI 处理完成
   */
  recordAiEnd(messageId: string): void {
    const record = this.findRecord(messageId);
    if (record && record.aiStartAt) {
      record.aiEndAt = Date.now();
      record.aiDuration = record.aiEndAt - record.aiStartAt;
      this.globalCounters.totalAiDuration += record.aiDuration;
      this.logger.debug(`记录 AI 完成处理 [${messageId}], 耗时: ${record.aiDuration}ms`);
    }
  }

  /**
   * 记录消息发送开始
   */
  recordSendStart(messageId: string): void {
    const record = this.findRecord(messageId);
    if (record) {
      record.sendStartAt = Date.now();
      this.logger.debug(`记录消息发送开始 [${messageId}]`);
    }
  }

  /**
   * 记录消息发送完成
   */
  recordSendEnd(messageId: string): void {
    const record = this.findRecord(messageId);
    if (record && record.sendStartAt) {
      record.sendEndAt = Date.now();
      record.sendDuration = record.sendEndAt - record.sendStartAt;
      this.globalCounters.totalSendDuration += record.sendDuration;
      this.logger.debug(`记录消息发送完成 [${messageId}], 耗时: ${record.sendDuration}ms`);
    }
  }

  /**
   * 记录消息处理成功
   */
  recordSuccess(messageId: string): void {
    const record = this.findRecord(messageId);
    if (record) {
      record.status = 'success';
      record.totalDuration = Date.now() - record.receivedAt;
      this.globalCounters.totalSuccess++;

      // 更新小时级别统计
      this.updateHourlyStats(record);

      this.logger.log(`消息处理成功 [${messageId}], 总耗时: ${record.totalDuration}ms`);
    }
  }

  /**
   * 记录消息处理失败
   */
  recordFailure(messageId: string, error: string): void {
    const record = this.findRecord(messageId);
    if (record) {
      record.status = 'failure';
      record.error = error;
      record.totalDuration = Date.now() - record.receivedAt;
      this.globalCounters.totalFailure++;

      // 添加到错误日志
      this.addErrorLog(messageId, error);

      // 更新小时级别统计
      this.updateHourlyStats(record);

      this.logger.error(`消息处理失败 [${messageId}]: ${error}`);
    }
  }

  /**
   * 获取仪表盘数据
   */
  getDashboardData(): DashboardData {
    const successRate =
      this.globalCounters.totalMessages > 0
        ? (this.globalCounters.totalSuccess / this.globalCounters.totalMessages) * 100
        : 0;

    const avgDuration = this.calculateAverageDuration();
    const recentMessages = this.getRecentMessages(50);
    const processingCount = this.detailRecords.filter((r) => r.status === 'processing').length;

    // 获取最近24小时的统计
    const last24Hours = this.getHourlyStatsRange(24);

    return {
      overview: {
        totalMessages: this.globalCounters.totalMessages,
        successCount: this.globalCounters.totalSuccess,
        failureCount: this.globalCounters.totalFailure,
        successRate: parseFloat(successRate.toFixed(2)),
        avgDuration: parseFloat(avgDuration.toFixed(2)),
        activeUsers: this.activeUsersSet.size,
        activeChats: this.activeChatsSet.size,
      },
      trends: {
        hourly: last24Hours,
      },
      recentMessages,
      recentErrors: this.errorLogs.slice(-20),
      realtime: {
        processingCount,
        lastMessageTime: recentMessages.length > 0 ? recentMessages[0].receivedAt : undefined,
      },
    };
  }

  /**
   * 获取详细指标数据
   */
  getMetricsData(): MetricsData {
    const percentiles = this.calculatePercentiles();
    const slowestRecords = this.getSlowestRecords(10);

    return {
      detailRecords: [...this.detailRecords],
      hourlyStats: Array.from(this.hourlyStatsMap.values()).sort(
        (a, b) => new Date(b.hour).getTime() - new Date(a.hour).getTime(),
      ),
      globalCounters: { ...this.globalCounters },
      percentiles,
      slowestRecords,
    };
  }

  /**
   * 清空所有数据
   */
  clearAllData(): void {
    this.detailRecords = [];
    this.hourlyStatsMap.clear();
    this.errorLogs = [];
    this.activeUsersSet.clear();
    this.activeChatsSet.clear();
    this.globalCounters = {
      totalMessages: 0,
      totalSuccess: 0,
      totalFailure: 0,
      totalAiDuration: 0,
      totalSendDuration: 0,
    };
    this.logger.log('所有监控数据已清空');
  }

  // ========== 私有方法 ==========

  /**
   * 添加记录（环形缓冲区）
   */
  private addRecord(record: MessageProcessingRecord): void {
    if (this.detailRecords.length >= this.MAX_DETAIL_RECORDS) {
      this.detailRecords.shift(); // 移除最旧的记录
    }
    this.detailRecords.push(record);
  }

  /**
   * 查找记录
   */
  private findRecord(messageId: string): MessageProcessingRecord | undefined {
    return this.detailRecords.find((r) => r.messageId === messageId);
  }

  /**
   * 添加错误日志
   */
  private addErrorLog(messageId: string, error: string): void {
    if (this.errorLogs.length >= this.MAX_ERROR_LOGS) {
      this.errorLogs.shift();
    }
    this.errorLogs.push({
      messageId,
      timestamp: Date.now(),
      error,
    });
  }

  /**
   * 更新小时级别统计
   */
  private updateHourlyStats(record: MessageProcessingRecord): void {
    const hourKey = this.getHourKey(record.receivedAt);
    let stats = this.hourlyStatsMap.get(hourKey);

    if (!stats) {
      stats = this.initHourlyStats(hourKey);
      this.hourlyStatsMap.set(hourKey, stats);
    }

    // 更新统计
    stats.messageCount++;
    if (record.status === 'success') {
      stats.successCount++;
    } else if (record.status === 'failure') {
      stats.failureCount++;
    }
    stats.successRate =
      stats.messageCount > 0 ? (stats.successCount / stats.messageCount) * 100 : 0;

    // 更新耗时统计（需要重新计算）
    this.recalculateHourlyDurations(hourKey);

    // 更新活跃度
    stats.activeUsers = this.activeUsersSet.size;
    stats.activeChats = this.activeChatsSet.size;
  }

  /**
   * 初始化小时统计
   */
  private initHourlyStats(hourKey: string): HourlyStats {
    return {
      hour: hourKey,
      messageCount: 0,
      successCount: 0,
      failureCount: 0,
      successRate: 0,
      avgDuration: 0,
      minDuration: 0,
      maxDuration: 0,
      p50Duration: 0,
      p95Duration: 0,
      p99Duration: 0,
      avgAiDuration: 0,
      avgSendDuration: 0,
      activeUsers: 0,
      activeChats: 0,
    };
  }

  /**
   * 重新计算某个小时的耗时统计
   */
  private recalculateHourlyDurations(hourKey: string): void {
    const records = this.detailRecords.filter(
      (r) =>
        this.getHourKey(r.receivedAt) === hourKey &&
        r.status !== 'processing' &&
        r.totalDuration !== undefined,
    );

    if (records.length === 0) return;

    const stats = this.hourlyStatsMap.get(hourKey);
    if (!stats) return;

    const durations = records.map((r) => r.totalDuration!).sort((a, b) => a - b);
    const aiDurations = records.filter((r) => r.aiDuration !== undefined).map((r) => r.aiDuration!);
    const sendDurations = records
      .filter((r) => r.sendDuration !== undefined)
      .map((r) => r.sendDuration!);

    stats.avgDuration = this.average(durations);
    stats.minDuration = Math.min(...durations);
    stats.maxDuration = Math.max(...durations);
    stats.p50Duration = this.percentile(durations, 0.5);
    stats.p95Duration = this.percentile(durations, 0.95);
    stats.p99Duration = this.percentile(durations, 0.99);
    stats.avgAiDuration = this.average(aiDurations);
    stats.avgSendDuration = this.average(sendDurations);
  }

  /**
   * 获取小时 key（ISO格式，精确到小时）
   */
  private getHourKey(timestamp: number): string {
    const date = new Date(timestamp);
    date.setMinutes(0, 0, 0);
    return date.toISOString();
  }

  /**
   * 获取最近 N 条消息
   */
  private getRecentMessages(limit: number): MessageProcessingRecord[] {
    return [...this.detailRecords].sort((a, b) => b.receivedAt - a.receivedAt).slice(0, limit);
  }

  /**
   * 获取最近 N 小时的统计
   */
  private getHourlyStatsRange(hours: number): HourlyStats[] {
    const now = Date.now();
    const startTime = now - hours * 60 * 60 * 1000;

    return Array.from(this.hourlyStatsMap.values())
      .filter((stats) => new Date(stats.hour).getTime() >= startTime)
      .sort((a, b) => new Date(a.hour).getTime() - new Date(b.hour).getTime());
  }

  /**
   * 计算平均耗时
   */
  private calculateAverageDuration(): number {
    const completedRecords = this.detailRecords.filter(
      (r) => r.status !== 'processing' && r.totalDuration !== undefined,
    );

    if (completedRecords.length === 0) return 0;

    const totalDuration = completedRecords.reduce((sum, r) => sum + (r.totalDuration || 0), 0);
    return totalDuration / completedRecords.length;
  }

  /**
   * 计算百分位数
   */
  private calculatePercentiles(): {
    p50: number;
    p95: number;
    p99: number;
    p999: number;
  } {
    const durations = this.detailRecords
      .filter((r) => r.status !== 'processing' && r.totalDuration !== undefined)
      .map((r) => r.totalDuration!)
      .sort((a, b) => a - b);

    if (durations.length === 0) {
      return { p50: 0, p95: 0, p99: 0, p999: 0 };
    }

    return {
      p50: this.percentile(durations, 0.5),
      p95: this.percentile(durations, 0.95),
      p99: this.percentile(durations, 0.99),
      p999: this.percentile(durations, 0.999),
    };
  }

  /**
   * 获取最慢的记录
   */
  private getSlowestRecords(limit: number): MessageProcessingRecord[] {
    return [...this.detailRecords]
      .filter((r) => r.status !== 'processing' && r.totalDuration !== undefined)
      .sort((a, b) => (b.totalDuration || 0) - (a.totalDuration || 0))
      .slice(0, limit);
  }

  /**
   * 清理过期数据
   */
  private cleanupExpiredData(): void {
    const cutoffTime = Date.now() - this.MAX_HOURLY_STATS * 60 * 60 * 1000;

    // 清理过期的小时统计
    const keysToDelete: string[] = [];
    for (const [key, stats] of this.hourlyStatsMap.entries()) {
      if (new Date(stats.hour).getTime() < cutoffTime) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach((key) => this.hourlyStatsMap.delete(key));

    if (keysToDelete.length > 0) {
      this.logger.log(`清理了 ${keysToDelete.length} 条过期统计数据`);
    }
  }

  /**
   * 计算平均值
   */
  private average(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    const sum = numbers.reduce((a, b) => a + b, 0);
    return parseFloat((sum / numbers.length).toFixed(2));
  }

  /**
   * 计算百分位
   */
  private percentile(sortedNumbers: number[], percentile: number): number {
    if (sortedNumbers.length === 0) return 0;
    const index = Math.ceil(sortedNumbers.length * percentile) - 1;
    return sortedNumbers[Math.max(0, index)];
  }
}
