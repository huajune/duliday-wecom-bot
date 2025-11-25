import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  MessageProcessingRecord,
  HourlyStats,
  DashboardData,
  MetricsData,
  MonitoringMetadata,
  ScenarioUsageMetric,
  ToolUsageMetric,
  MonitoringSnapshot,
  MonitoringErrorLog,
  MonitoringGlobalCounters,
  ResponseMinuteTrendPoint,
  AlertTrendPoint,
  AlertTypeMetric,
  TimeRange,
  DailyStats,
  TodayUser,
  AlertErrorType,
} from './interfaces/monitoring.interface';
import { ScenarioType } from '@agent';
import { MonitoringSnapshotService } from './monitoring-snapshot.service';

/**
 * 监控服务
 * 负责收集、存储和统计消息处理数据
 */
@Injectable()
export class MonitoringService implements OnModuleInit {
  private readonly logger = new Logger(MonitoringService.name);
  private readonly DEFAULT_WINDOW_HOURS = 24;
  private readonly SNAPSHOT_VERSION = 1;

  // 配置
  private readonly MAX_DETAIL_RECORDS = 1000; // 最多保存1000条详细记录
  private readonly MAX_HOURLY_STATS = 72; // 保留72小时的聚合统计
  private readonly MAX_ERROR_LOGS = 100; // 最多保存100条错误日志

  // 内存存储
  private detailRecords: MessageProcessingRecord[] = []; // 环形缓冲区
  private hourlyStatsMap = new Map<string, HourlyStats>(); // 按小时聚合

  // 全局计数器
  private globalCounters: MonitoringGlobalCounters = this.createDefaultCounters();

  // 错误日志
  private errorLogs: MonitoringErrorLog[] = [];

  // 活跃用户和会话（用于去重统计）
  private activeUsersSet = new Set<string>();
  private activeChatsSet = new Set<string>();
  private currentProcessing = 0;
  private peakProcessing = 0;

  constructor(private readonly snapshotService: MonitoringSnapshotService) {
    // 定期清理过期数据（每小时执行一次）
    setInterval(
      () => {
        this.cleanupExpiredData();
      },
      60 * 60 * 1000,
    );

    this.logger.log('监控服务已启动');
  }

  async onModuleInit(): Promise<void> {
    await this.restoreFromSnapshot();
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
    metadata?: MonitoringMetadata,
    managerName?: string,
  ): void {
    const record: MessageProcessingRecord = {
      messageId,
      chatId,
      userId,
      userName,
      managerName,
      receivedAt: Date.now(),
      status: 'processing',
      messagePreview: messageContent ? messageContent.substring(0, 50) : undefined,
      scenario: metadata?.scenario,
    };

    this.addRecord(record);
    this.globalCounters.totalMessages++;

    // 记录活跃用户和会话
    if (userId) this.activeUsersSet.add(userId);
    if (chatId) this.activeChatsSet.add(chatId);
    this.currentProcessing++;
    this.peakProcessing = Math.max(this.peakProcessing, this.currentProcessing);

    this.logger.debug(`记录消息接收 [${messageId}], scenario=${metadata?.scenario ?? 'unknown'}`);
    this.persistSnapshot();
  }

  /**
   * 记录 AI 处理开始
   */
  recordAiStart(messageId: string): void {
    const record = this.findRecord(messageId);
    if (record) {
      record.aiStartAt = Date.now();
      record.queueDuration = record.aiStartAt - record.receivedAt;
      this.logger.debug(`记录 AI 开始处理 [${messageId}], queue=${record.queueDuration ?? 0}ms`);
      this.persistSnapshot();
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
      this.persistSnapshot();
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
      this.persistSnapshot();
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
      this.persistSnapshot();
    }
  }

  /**
   * 记录消息处理成功
   */
  recordSuccess(
    messageId: string,
    metadata?: MonitoringMetadata & { fallbackSuccess?: boolean },
  ): void {
    const record = this.findRecord(messageId);
    if (record) {
      record.status = 'success';
      record.totalDuration = Date.now() - record.receivedAt;
      record.scenario = metadata?.scenario || record.scenario;
      record.tools = metadata?.tools || record.tools;
      record.tokenUsage = metadata?.tokenUsage ?? record.tokenUsage;
      record.replyPreview = metadata?.replyPreview ?? record.replyPreview;
      record.replySegments = metadata?.replySegments ?? record.replySegments;
      record.isFallback = metadata?.isFallback ?? record.isFallback;
      record.fallbackSuccess = metadata?.fallbackSuccess ?? record.fallbackSuccess;

      this.globalCounters.totalSuccess++;
      this.currentProcessing = Math.max(this.currentProcessing - 1, 0);

      // 更新降级统计
      if (record.isFallback) {
        this.globalCounters.totalFallback++;
        if (record.fallbackSuccess) {
          this.globalCounters.totalFallbackSuccess++;
        }
      }

      // 更新小时级别统计
      this.updateHourlyStats(record);

      this.logger.log(
        `消息处理成功 [${messageId}], 总耗时: ${record.totalDuration}ms, scenario=${
          record.scenario || 'unknown'
        }, fallback=${record.isFallback ? 'true' : 'false'}`,
      );
      this.persistSnapshot();
    }
  }

  /**
   * 记录消息处理失败
   */
  recordFailure(
    messageId: string,
    error: string,
    metadata?: MonitoringMetadata & { fallbackSuccess?: boolean },
  ): void {
    const record = this.findRecord(messageId);
    if (record) {
      record.status = 'failure';
      record.error = error;
      record.totalDuration = Date.now() - record.receivedAt;
      record.scenario = metadata?.scenario || record.scenario;
      record.tools = metadata?.tools || record.tools;
      record.tokenUsage = metadata?.tokenUsage ?? record.tokenUsage;
      record.replySegments = metadata?.replySegments ?? record.replySegments;
      record.isFallback = metadata?.isFallback ?? record.isFallback;
      record.fallbackSuccess = metadata?.fallbackSuccess ?? record.fallbackSuccess;

      this.globalCounters.totalFailure++;
      this.currentProcessing = Math.max(this.currentProcessing - 1, 0);

      // 更新降级统计
      if (record.isFallback) {
        this.globalCounters.totalFallback++;
        if (record.fallbackSuccess) {
          this.globalCounters.totalFallbackSuccess++;
        }
      }

      // 添加到错误日志
      this.addErrorLog(messageId, error);

      // 更新小时级别统计
      this.updateHourlyStats(record);

      this.logger.error(
        `消息处理失败 [${messageId}]: ${error}, scenario=${record.scenario || 'unknown'}, fallback=${record.isFallback ? 'true' : 'false'}`,
      );
      this.persistSnapshot();
    }
  }

  /**
   * 获取仪表盘数据
   * @param timeRange 时间范围：today/week/month
   */
  getDashboardData(timeRange: TimeRange = 'today'): DashboardData {
    // 根据时间范围过滤记录
    const currentRecords = this.filterRecordsByTimeRange(this.detailRecords, timeRange);
    const previousRecords = this.getPreviousRangeRecords(timeRange);

    // 计算当前时间范围的聚合数据
    const currentStats = this.aggregateRecords(currentRecords);
    const previousStats = this.aggregateRecords(previousRecords);

    // 计算增长率
    const overviewDelta = {
      totalMessages: this.calculatePercentChange(
        currentStats.totalMessages,
        previousStats.totalMessages,
      ),
      successRate: this.calculatePercentChange(currentStats.successRate, previousStats.successRate),
      avgDuration: this.calculatePercentChange(currentStats.avgDuration, previousStats.avgDuration),
      activeUsers: this.calculatePercentChange(currentStats.activeUsers, previousStats.activeUsers),
    };

    // 计算降级统计
    const currentFallback = this.calculateFallbackStats(currentRecords);
    const previousFallback = this.calculateFallbackStats(previousRecords);
    const fallbackDelta = {
      totalCount: this.calculatePercentChange(
        currentFallback.totalCount,
        previousFallback.totalCount,
      ),
      successRate: this.calculatePercentChange(
        currentFallback.successRate,
        previousFallback.successRate,
      ),
    };

    const recentMessages = this.getRecentMessages(50);
    const processingCount = this.currentProcessing;

    // 获取小时级别统计
    const hourlyStats = this.getHourlyStatsForRange(timeRange);
    const previousHourlyStats = this.getHourlyStatsForPreviousRange(timeRange);

    const windowMs = this.DEFAULT_WINDOW_HOURS * 60 * 60 * 1000;
    const now = Date.now();
    const alertsLast24h = this.errorLogs.filter((log) => now - log.timestamp <= windowMs).length;

    return {
      timeRange,
      lastWindowHours: this.DEFAULT_WINDOW_HOURS,
      overview: {
        totalMessages: currentStats.totalMessages,
        successCount: currentStats.successCount,
        failureCount: currentStats.failureCount,
        successRate: parseFloat(currentStats.successRate.toFixed(2)),
        avgDuration: parseFloat(currentStats.avgDuration.toFixed(2)),
        activeUsers: currentStats.activeUsers,
        activeChats: currentStats.activeChats,
      },
      overviewDelta,
      fallback: {
        totalCount: currentFallback.totalCount,
        successCount: currentFallback.successCount,
        successRate: parseFloat(currentFallback.successRate.toFixed(2)),
        affectedUsers: currentFallback.affectedUsers,
      },
      fallbackDelta,
      business: this.calculateBusinessMetrics(currentRecords),
      businessDelta: this.calculateBusinessMetricsDelta(currentRecords, previousRecords),
      usage: {
        tools: this.buildToolUsageMetrics(currentRecords),
        scenarios: this.buildScenarioUsageMetrics(currentRecords),
      },
      queue: {
        currentProcessing: processingCount,
        peakProcessing: this.peakProcessing,
        avgQueueDuration: this.calculateAverageQueueDuration(currentRecords),
      },
      alertsSummary: {
        total: this.errorLogs.length,
        last24Hours: alertsLast24h,
        byType: this.buildAlertTypeMetrics(),
      },
      trends: {
        hourly: hourlyStats,
        previous: previousHourlyStats.length > 0 ? previousHourlyStats : undefined,
      },
      responseTrend:
        timeRange === 'today'
          ? this.buildResponseMinuteTrend(currentRecords)
          : this.buildResponseDayTrend(currentRecords),
      alertTrend:
        timeRange === 'today'
          ? this.buildAlertMinuteTrend(this.filterErrorLogsByTimeRange(timeRange))
          : this.buildAlertDayTrend(this.filterErrorLogsByTimeRange(timeRange)),
      businessTrend:
        timeRange === 'today'
          ? this.buildBusinessMetricMinuteTrend(currentRecords)
          : this.buildBusinessMetricDayTrend(currentRecords),
      dailyTrend: this.buildDailyTrend(this.detailRecords),
      todayUsers: this.buildTodayUsers(currentRecords),
      recentMessages,
      recentErrors: this.errorLogs.slice(-20).reverse(),
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

  private aggregateWindowStats(stats: HourlyStats[]): {
    messages: number;
    success: number;
    failure: number;
    successRate: number;
    avgDuration: number;
    activeUsers: number;
  } {
    if (stats.length === 0) {
      return {
        messages: 0,
        success: 0,
        failure: 0,
        successRate: 0,
        avgDuration: 0,
        activeUsers: this.activeUsersSet.size,
      };
    }

    const messages = stats.reduce((acc, item) => acc + item.messageCount, 0);
    const success = stats.reduce((acc, item) => acc + item.successCount, 0);
    const failure = stats.reduce((acc, item) => acc + item.failureCount, 0);
    const weightedDuration =
      messages > 0
        ? stats.reduce((acc, item) => acc + item.avgDuration * item.messageCount, 0) / messages
        : 0;
    const activeUsers = Math.max(...stats.map((item) => item.activeUsers), 0);

    return {
      messages,
      success,
      failure,
      successRate: messages > 0 ? (success / messages) * 100 : 0,
      avgDuration: weightedDuration,
      activeUsers,
    };
  }

  private calculatePercentChange(current: number, previous: number): number {
    if (previous === 0) {
      return current === 0 ? 0 : 100;
    }
    return parseFloat((((current - previous) / previous) * 100).toFixed(2));
  }

  /**
   * 构建工具使用统计
   */
  private buildToolUsageMetrics(records: MessageProcessingRecord[]): ToolUsageMetric[] {
    const toolMap = new Map<string, number>();

    for (const record of records) {
      if (!record.tools || record.tools.length === 0) continue;
      for (const tool of record.tools) {
        toolMap.set(tool, (toolMap.get(tool) || 0) + 1);
      }
    }

    const total = Array.from(toolMap.values()).reduce((acc, val) => acc + val, 0);
    if (total === 0) {
      return [];
    }

    return Array.from(toolMap.entries())
      .map(([name, count]) => ({
        name,
        total: count,
        percentage: parseFloat(((count / total) * 100).toFixed(1)),
      }))
      .sort((a, b) => b.total - a.total);
  }

  /**
   * 构建场景使用统计
   */
  private buildScenarioUsageMetrics(records: MessageProcessingRecord[]): ScenarioUsageMetric[] {
    const map = new Map<string, number>();

    for (const record of records) {
      if (!record.scenario) continue;
      map.set(record.scenario, (map.get(record.scenario) || 0) + 1);
    }

    const total = Array.from(map.values()).reduce((acc, value) => acc + value, 0);
    if (total === 0) {
      return [];
    }

    return Array.from(map.entries())
      .map(([name, count]) => ({
        name,
        total: count,
        percentage: parseFloat(((count / total) * 100).toFixed(1)),
      }))
      .sort((a, b) => b.total - a.total);
  }

  /**
   * 构建告警类型统计
   */
  private buildAlertTypeMetrics(): AlertTypeMetric[] {
    const typeMap = new Map<AlertErrorType | 'unknown', number>();

    // 统计所有错误日志中的告警类型
    for (const log of this.errorLogs) {
      const type = log.alertType || 'unknown';
      typeMap.set(type, (typeMap.get(type) || 0) + 1);
    }

    // 也统计失败记录中的告警类型
    for (const record of this.detailRecords) {
      if (record.status === 'failure' && record.alertType) {
        const type = record.alertType;
        typeMap.set(type, (typeMap.get(type) || 0) + 1);
      }
    }

    const total = Array.from(typeMap.values()).reduce((acc, value) => acc + value, 0);
    if (total === 0) {
      return [];
    }

    return Array.from(typeMap.entries())
      .map(([type, count]) => ({
        type,
        count,
        percentage: parseFloat(((count / total) * 100).toFixed(1)),
      }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * 计算平均排队时间
   */
  private calculateAverageQueueDuration(records: MessageProcessingRecord[]): number {
    const durations = records
      .filter((record) => typeof record.queueDuration === 'number')
      .map((record) => record.queueDuration || 0);

    if (durations.length === 0) {
      return 0;
    }

    const total = durations.reduce((acc, value) => acc + value, 0);
    return parseFloat((total / durations.length).toFixed(2));
  }

  private buildResponseMinuteTrend(records: MessageProcessingRecord[]): ResponseMinuteTrendPoint[] {
    const buckets = new Map<string, { durations: number[]; success: number; total: number }>();

    for (const record of records) {
      if (record.status === 'processing' || record.totalDuration === undefined) {
        continue;
      }

      const minuteKey = this.getMinuteKey(record.receivedAt);
      const bucket = buckets.get(minuteKey) || { durations: [], success: 0, total: 0 };
      bucket.durations.push(record.totalDuration || 0);
      bucket.total += 1;
      if (record.status === 'success') {
        bucket.success += 1;
      }
      buckets.set(minuteKey, bucket);
    }

    return Array.from(buckets.entries())
      .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
      .map(([minute, bucket]) => ({
        minute,
        avgDuration:
          bucket.durations.length > 0
            ? parseFloat(
                (
                  bucket.durations.reduce((sum, value) => sum + value, 0) / bucket.durations.length
                ).toFixed(2),
              )
            : 0,
        messageCount: bucket.total,
        successRate:
          bucket.total > 0 ? parseFloat(((bucket.success / bucket.total) * 100).toFixed(2)) : 0,
      }));
  }

  private buildAlertMinuteTrend(logs: MonitoringErrorLog[]): AlertTrendPoint[] {
    const buckets = new Map<string, number>();

    for (const log of logs) {
      const minuteKey = this.getMinuteKey(log.timestamp);
      buckets.set(minuteKey, (buckets.get(minuteKey) || 0) + 1);
    }

    return Array.from(buckets.entries())
      .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
      .map(([minute, count]) => ({ minute, count }));
  }

  private buildResponseDayTrend(records: MessageProcessingRecord[]): ResponseMinuteTrendPoint[] {
    const buckets = new Map<string, { durations: number[]; success: number; total: number }>();

    for (const record of records) {
      if (record.status === 'processing' || record.totalDuration === undefined) {
        continue;
      }

      const dayKey = this.getDayKey(record.receivedAt);
      const bucket = buckets.get(dayKey) || { durations: [], success: 0, total: 0 };
      bucket.durations.push(record.totalDuration || 0);
      bucket.total += 1;
      if (record.status === 'success') {
        bucket.success += 1;
      }
      buckets.set(dayKey, bucket);
    }

    return Array.from(buckets.entries())
      .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
      .map(([minute, bucket]) => ({
        minute,
        avgDuration:
          bucket.durations.length > 0
            ? parseFloat(
                (
                  bucket.durations.reduce((sum, value) => sum + value, 0) / bucket.durations.length
                ).toFixed(2),
              )
            : 0,
        messageCount: bucket.total,
        successRate:
          bucket.total > 0 ? parseFloat(((bucket.success / bucket.total) * 100).toFixed(2)) : 0,
      }));
  }

  private buildAlertDayTrend(logs: MonitoringErrorLog[]): AlertTrendPoint[] {
    const buckets = new Map<string, number>();

    for (const log of logs) {
      const dayKey = this.getDayKey(log.timestamp);
      buckets.set(dayKey, (buckets.get(dayKey) || 0) + 1);
    }

    return Array.from(buckets.entries())
      .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
      .map(([minute, count]) => ({ minute, count }));
  }

  /**
   * 构建业务指标分钟级趋势（今日）
   */
  private buildBusinessMetricMinuteTrend(
    records: MessageProcessingRecord[],
  ): import('./interfaces/monitoring.interface').BusinessMetricTrendPoint[] {
    const buckets = new Map<
      string,
      {
        users: Set<string>;
        bookingAttempts: number;
        successfulBookings: number;
      }
    >();

    for (const record of records) {
      const minuteKey = this.getMinuteKey(record.receivedAt);
      const bucket = buckets.get(minuteKey) || {
        users: new Set<string>(),
        bookingAttempts: 0,
        successfulBookings: 0,
      };

      // 统计活跃用户
      if (record.userId) {
        bucket.users.add(record.userId);
      }

      // 统计预约尝试
      const isBookingAttempt = record.tools && record.tools.includes('duliday_interview_booking');
      if (isBookingAttempt) {
        bucket.bookingAttempts += 1;
        // 注意：这里使用 status 作为预约成功的判断是不准确的
        // status='success' 只表示消息处理成功，不代表预约成功
        // TODO: 需要从工具执行结果或 AI 响应中提取真实的预约结果
        if (record.status === 'success') {
          bucket.successfulBookings += 1;
        }
      }

      buckets.set(minuteKey, bucket);
    }

    return Array.from(buckets.entries())
      .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
      .map(([minute, bucket]) => {
        const consultations = bucket.users.size;
        const bookingAttempts = bucket.bookingAttempts;
        const successfulBookings = bucket.successfulBookings;
        const conversionRate =
          consultations > 0 ? parseFloat(((bookingAttempts / consultations) * 100).toFixed(2)) : 0;
        const bookingSuccessRate =
          bookingAttempts > 0
            ? parseFloat(((successfulBookings / bookingAttempts) * 100).toFixed(2))
            : 0;

        return {
          minute,
          consultations,
          bookingAttempts,
          successfulBookings,
          conversionRate,
          bookingSuccessRate,
        };
      });
  }

  /**
   * 构建业务指标天级趋势（本周/本月）
   */
  private buildBusinessMetricDayTrend(
    records: MessageProcessingRecord[],
  ): import('./interfaces/monitoring.interface').BusinessMetricTrendPoint[] {
    const buckets = new Map<
      string,
      {
        users: Set<string>;
        bookingAttempts: number;
        successfulBookings: number;
      }
    >();

    for (const record of records) {
      const dayKey = this.getDayKey(record.receivedAt);
      const bucket = buckets.get(dayKey) || {
        users: new Set<string>(),
        bookingAttempts: 0,
        successfulBookings: 0,
      };

      // 统计活跃用户
      if (record.userId) {
        bucket.users.add(record.userId);
      }

      // 统计预约尝试
      const isBookingAttempt = record.tools && record.tools.includes('duliday_interview_booking');
      if (isBookingAttempt) {
        bucket.bookingAttempts += 1;
        // 注意：这里使用 status 作为预约成功的判断是不准确的
        // status='success' 只表示消息处理成功，不代表预约成功
        // TODO: 需要从工具执行结果或 AI 响应中提取真实的预约结果
        if (record.status === 'success') {
          bucket.successfulBookings += 1;
        }
      }

      buckets.set(dayKey, bucket);
    }

    return Array.from(buckets.entries())
      .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
      .map(([minute, bucket]) => {
        const consultations = bucket.users.size;
        const bookingAttempts = bucket.bookingAttempts;
        const successfulBookings = bucket.successfulBookings;
        const conversionRate =
          consultations > 0 ? parseFloat(((bookingAttempts / consultations) * 100).toFixed(2)) : 0;
        const bookingSuccessRate =
          bookingAttempts > 0
            ? parseFloat(((successfulBookings / bookingAttempts) * 100).toFixed(2))
            : 0;

        return {
          minute,
          consultations,
          bookingAttempts,
          successfulBookings,
          conversionRate,
          bookingSuccessRate,
        };
      });
  }

  /**
   * 构建每日统计趋势（最近7天）
   */
  private buildDailyTrend(records: MessageProcessingRecord[]): DailyStats[] {
    const buckets = new Map<
      string,
      {
        users: Set<string>;
        tokenUsage: number;
        messageCount: number;
        successCount: number;
        durations: number[];
      }
    >();

    // 只统计最近7天的数据
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);
    const cutoffTime = sevenDaysAgo.getTime();

    for (const record of records) {
      if (record.receivedAt < cutoffTime) {
        continue;
      }

      const dayKey = this.getDayKey(record.receivedAt);
      const bucket = buckets.get(dayKey) || {
        users: new Set<string>(),
        tokenUsage: 0,
        messageCount: 0,
        successCount: 0,
        durations: [],
      };

      // 统计活跃用户
      if (record.userId) {
        bucket.users.add(record.userId);
      }

      // 统计 token 使用量
      if (record.tokenUsage) {
        bucket.tokenUsage += record.tokenUsage;
      }

      // 统计消息数
      bucket.messageCount += 1;

      // 统计成功数
      if (record.status === 'success') {
        bucket.successCount += 1;
      }

      // 统计耗时
      if (record.totalDuration !== undefined && record.status !== 'processing') {
        bucket.durations.push(record.totalDuration);
      }

      buckets.set(dayKey, bucket);
    }

    return Array.from(buckets.entries())
      .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
      .map(([date, bucket]) => {
        const avgDuration =
          bucket.durations.length > 0
            ? parseFloat(
                (bucket.durations.reduce((sum, d) => sum + d, 0) / bucket.durations.length).toFixed(
                  2,
                ),
              )
            : 0;

        // 格式化日期为 YYYY-MM-DD
        const dateObj = new Date(date);
        const formattedDate = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;

        return {
          date: formattedDate,
          tokenUsage: bucket.tokenUsage,
          uniqueUsers: bucket.users.size,
          messageCount: bucket.messageCount,
          successCount: bucket.successCount,
          avgDuration,
        };
      });
  }

  /**
   * 构建今日咨询用户列表
   * TODO: isPaused 需要从 MessageService 的黑名单管理中获取实际状态
   */
  private buildTodayUsers(records: MessageProcessingRecord[]): TodayUser[] {
    const userMap = new Map<
      string,
      {
        odId: string;
        odName: string;
        groupId?: string;
        groupName?: string;
        chatId: string;
        messageCount: number;
        tokenUsage: number;
        firstActiveAt: number;
        lastActiveAt: number;
      }
    >();

    for (const record of records) {
      if (!record.userId) {
        continue;
      }

      const existing = userMap.get(record.userId);

      if (existing) {
        // 更新现有用户数据
        existing.messageCount += 1;
        existing.tokenUsage += record.tokenUsage || 0;
        existing.firstActiveAt = Math.min(existing.firstActiveAt, record.receivedAt);
        existing.lastActiveAt = Math.max(existing.lastActiveAt, record.receivedAt);
      } else {
        // 新增用户
        userMap.set(record.userId, {
          odId: record.userId,
          odName: record.userName || record.userId,
          groupId: undefined, // TODO: 需要从消息记录中获取
          groupName: undefined, // TODO: 需要从消息记录中获取
          chatId: record.chatId,
          messageCount: 1,
          tokenUsage: record.tokenUsage || 0,
          firstActiveAt: record.receivedAt,
          lastActiveAt: record.receivedAt,
        });
      }
    }

    // 转换为数组并按最后活跃时间排序（最近的排前面）
    return Array.from(userMap.values())
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
      .map((user) => ({
        ...user,
        isPaused: false, // TODO: 需要从实际的黑名单状态中获取
      }));
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
    this.currentProcessing = 0;
    this.peakProcessing = 0;
    this.globalCounters = this.createDefaultCounters();
    this.logger.log('所有监控数据已清空');
    this.persistSnapshot();
  }

  /**
   * 生成测试数据（仅用于开发/演示）
   * @param days 生成多少天的数据
   * @returns 生成的记录数
   */
  generateTestData(days: number = 7): number {
    this.logger.log(`开始生成 ${days} 天的测试数据`);

    const now = Date.now();
    const msPerDay = 24 * 60 * 60 * 1000;
    const startTime = now - (days - 1) * msPerDay;

    // 测试用户列表
    const testUsers = [
      { id: 'user_001', name: '张三' },
      { id: 'user_002', name: '李四' },
      { id: 'user_003', name: '王五' },
      { id: 'user_004', name: '赵六' },
      { id: 'user_005', name: '钱七' },
      { id: 'user_006', name: '孙八' },
      { id: 'user_007', name: '周九' },
      { id: 'user_008', name: '吴十' },
    ];

    // 测试场景
    const scenarios: ScenarioType[] = [ScenarioType.CANDIDATE_CONSULTATION];

    // 测试工具
    const toolSets = [
      ['duliday_job_list'],
      ['duliday_job_details'],
      ['duliday_interview_booking'],
      ['duliday_job_list', 'duliday_job_details'],
      [],
    ];

    let recordCount = 0;

    // 为每一天生成数据
    for (let dayOffset = 0; dayOffset < days; dayOffset++) {
      const dayStart = startTime + dayOffset * msPerDay;

      // 每天生成 15-40 条记录（模拟真实场景）
      const recordsPerDay = Math.floor(Math.random() * 26) + 15;

      for (let i = 0; i < recordsPerDay; i++) {
        // 随机时间（在当天的工作时间内：8:00-22:00）
        const hourOffset = Math.floor(Math.random() * 14) + 8;
        const minuteOffset = Math.floor(Math.random() * 60);
        const secondOffset = Math.floor(Math.random() * 60);
        const receivedAt =
          dayStart + hourOffset * 3600000 + minuteOffset * 60000 + secondOffset * 1000;

        // 如果时间超过当前时间，跳过
        if (receivedAt > now) continue;

        // 随机选择用户
        const user = testUsers[Math.floor(Math.random() * testUsers.length)];
        const chatId = `chat_${user.id}_${Math.floor(Math.random() * 3) + 1}`;

        // 随机选择场景和工具
        const scenario = scenarios[Math.floor(Math.random() * scenarios.length)];
        const tools = toolSets[Math.floor(Math.random() * toolSets.length)];

        // 生成消息 ID
        const messageId = `msg_${dayOffset}_${i}_${Date.now()}`;

        // 模拟处理时间（2-15秒）
        const aiDuration = Math.floor(Math.random() * 10000) + 2000;
        const sendDuration = Math.floor(Math.random() * 3000) + 500;
        const queueDuration = Math.floor(Math.random() * 1000) + 100;
        const totalDuration = queueDuration + aiDuration + sendDuration;

        // 模拟成功率（90%成功）
        const isSuccess = Math.random() > 0.1;
        const isFallback = Math.random() < 0.05;
        const fallbackSuccess = isFallback && Math.random() > 0.3;

        // Token 使用量（500-3000）
        const tokenUsage = Math.floor(Math.random() * 2500) + 500;

        // 创建记录
        const record: MessageProcessingRecord = {
          messageId,
          chatId,
          userId: user.id,
          userName: user.name,
          receivedAt,
          status: isSuccess ? 'success' : 'failure',
          messagePreview: this.generateRandomMessage(),
          scenario,
          tools: tools.length > 0 ? tools : undefined,
          tokenUsage,
          aiStartAt: receivedAt + queueDuration,
          aiEndAt: receivedAt + queueDuration + aiDuration,
          aiDuration,
          sendStartAt: receivedAt + queueDuration + aiDuration,
          sendEndAt: receivedAt + totalDuration,
          sendDuration,
          queueDuration,
          totalDuration,
          replyPreview: isSuccess ? this.generateRandomReply() : undefined,
          replySegments: isSuccess ? Math.floor(Math.random() * 3) + 1 : undefined,
          isFallback,
          fallbackSuccess,
          error: isSuccess ? undefined : '模拟错误: Agent 响应超时',
        };

        // 添加到记录列表
        this.addRecord(record);

        // 更新计数器
        this.globalCounters.totalMessages++;
        if (isSuccess) {
          this.globalCounters.totalSuccess++;
        } else {
          this.globalCounters.totalFailure++;
          this.addErrorLog(messageId, record.error || '未知错误');
        }

        if (isFallback) {
          this.globalCounters.totalFallback++;
          if (fallbackSuccess) {
            this.globalCounters.totalFallbackSuccess++;
          }
        }

        this.globalCounters.totalAiDuration += aiDuration;
        this.globalCounters.totalSendDuration += sendDuration;

        // 更新活跃用户
        this.activeUsersSet.add(user.id);
        this.activeChatsSet.add(chatId);

        // 更新小时级别统计
        this.updateHourlyStats(record);

        recordCount++;
      }
    }

    // 更新峰值处理数
    this.peakProcessing = Math.max(this.peakProcessing, Math.floor(Math.random() * 5) + 1);

    // 持久化快照
    this.persistSnapshot();

    this.logger.log(`测试数据生成完成: ${recordCount} 条记录`);
    return recordCount;
  }

  /**
   * 生成随机用户消息
   */
  private generateRandomMessage(): string {
    const messages = [
      '你好，我想找一份前端开发的工作',
      '请问有适合应届生的岗位吗？',
      '我想预约面试',
      '帮我查一下这个职位的详情',
      '有没有远程工作的机会？',
      '薪资范围是多少？',
      '需要什么技术栈？',
      '工作地点在哪里？',
      '请问面试流程是怎样的？',
      '我的简历需要更新吗？',
    ];
    return messages[Math.floor(Math.random() * messages.length)];
  }

  /**
   * 生成随机回复
   */
  private generateRandomReply(): string {
    const replies = [
      '为您找到了5个匹配的职位...',
      '已为您预约面试，时间是...',
      '这个职位的要求是...',
      '薪资范围在15k-25k之间...',
      '感谢咨询，还有其他问题吗？',
    ];
    return replies[Math.floor(Math.random() * replies.length)];
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

  private getMinuteKey(timestamp: number): string {
    const date = new Date(timestamp);
    date.setSeconds(0, 0);
    return date.toISOString();
  }

  private getDayKey(timestamp: number): string {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
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
      this.persistSnapshot();
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

  private createDefaultCounters(): MonitoringGlobalCounters {
    return {
      totalMessages: 0,
      totalSuccess: 0,
      totalFailure: 0,
      totalAiDuration: 0,
      totalSendDuration: 0,
      totalFallback: 0,
      totalFallbackSuccess: 0,
    };
  }

  /**
   * 根据时间范围过滤记录
   */
  private filterRecordsByTimeRange(
    records: MessageProcessingRecord[],
    range: TimeRange,
  ): MessageProcessingRecord[] {
    let cutoffTime: number;

    switch (range) {
      case 'today':
        // 本日 00:00:00
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        cutoffTime = today.getTime();
        break;
      case 'week':
        // 本周一 00:00:00
        const weekStart = new Date();
        const dayOfWeek = weekStart.getDay();
        const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        weekStart.setDate(weekStart.getDate() - daysToMonday);
        weekStart.setHours(0, 0, 0, 0);
        cutoffTime = weekStart.getTime();
        break;
      case 'month':
        // 本月1号 00:00:00
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        cutoffTime = monthStart.getTime();
        break;
      default:
        return records;
    }

    return records.filter((r) => r.receivedAt >= cutoffTime);
  }

  /**
   * 获取前一时间范围的记录（用于对比）
   */
  private getPreviousRangeRecords(range: TimeRange): MessageProcessingRecord[] {
    let startTime: number;
    let endTime: number;

    switch (range) {
      case 'today':
        // 昨日 00:00:00 ~ 23:59:59
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);
        startTime = yesterday.getTime();
        yesterday.setHours(23, 59, 59, 999);
        endTime = yesterday.getTime();
        break;
      case 'week':
        // 上周一 00:00:00 ~ 上周日 23:59:59
        const lastWeekStart = new Date();
        const dayOfWeek = lastWeekStart.getDay();
        const daysToLastMonday = dayOfWeek === 0 ? 13 : dayOfWeek + 6;
        lastWeekStart.setDate(lastWeekStart.getDate() - daysToLastMonday);
        lastWeekStart.setHours(0, 0, 0, 0);
        startTime = lastWeekStart.getTime();
        const lastWeekEnd = new Date(lastWeekStart);
        lastWeekEnd.setDate(lastWeekEnd.getDate() + 6);
        lastWeekEnd.setHours(23, 59, 59, 999);
        endTime = lastWeekEnd.getTime();
        break;
      case 'month':
        // 上月1号 00:00:00 ~ 上月最后一天 23:59:59
        const lastMonthStart = new Date();
        lastMonthStart.setMonth(lastMonthStart.getMonth() - 1);
        lastMonthStart.setDate(1);
        lastMonthStart.setHours(0, 0, 0, 0);
        startTime = lastMonthStart.getTime();
        const lastMonthEnd = new Date(lastMonthStart);
        lastMonthEnd.setMonth(lastMonthEnd.getMonth() + 1);
        lastMonthEnd.setDate(0);
        lastMonthEnd.setHours(23, 59, 59, 999);
        endTime = lastMonthEnd.getTime();
        break;
      default:
        return [];
    }

    return this.detailRecords.filter((r) => r.receivedAt >= startTime && r.receivedAt <= endTime);
  }

  /**
   * 根据时间范围过滤错误日志
   */
  private filterErrorLogsByTimeRange(range: TimeRange): MonitoringErrorLog[] {
    let cutoffTime: number;

    switch (range) {
      case 'today':
        // 本日 00:00:00
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        cutoffTime = today.getTime();
        break;
      case 'week':
        // 本周一 00:00:00
        const weekStart = new Date();
        const dayOfWeek = weekStart.getDay();
        const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        weekStart.setDate(weekStart.getDate() - daysToMonday);
        weekStart.setHours(0, 0, 0, 0);
        cutoffTime = weekStart.getTime();
        break;
      case 'month':
        // 本月1号 00:00:00
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        cutoffTime = monthStart.getTime();
        break;
      default:
        return this.errorLogs;
    }

    return this.errorLogs.filter((log) => log.timestamp >= cutoffTime);
  }

  /**
   * 聚合记录数据
   */
  private aggregateRecords(records: MessageProcessingRecord[]): {
    totalMessages: number;
    successCount: number;
    failureCount: number;
    successRate: number;
    avgDuration: number;
    activeUsers: number;
    activeChats: number;
  } {
    if (records.length === 0) {
      return {
        totalMessages: 0,
        successCount: 0,
        failureCount: 0,
        successRate: 0,
        avgDuration: 0,
        activeUsers: 0,
        activeChats: 0,
      };
    }

    const successRecords = records.filter((r) => r.status === 'success');
    const failureRecords = records.filter((r) => r.status === 'failure');

    const completedRecords = records.filter(
      (r) => r.status !== 'processing' && r.totalDuration !== undefined,
    );

    const avgDuration =
      completedRecords.length > 0
        ? completedRecords.reduce((sum, r) => sum + (r.totalDuration || 0), 0) /
          completedRecords.length
        : 0;

    const activeUsers = new Set(records.filter((r) => r.userId).map((r) => r.userId!)).size;
    const activeChats = new Set(records.map((r) => r.chatId)).size;

    return {
      totalMessages: records.length,
      successCount: successRecords.length,
      failureCount: failureRecords.length,
      successRate: records.length > 0 ? (successRecords.length / records.length) * 100 : 0,
      avgDuration,
      activeUsers,
      activeChats,
    };
  }

  /**
   * 计算降级统计
   */
  private calculateFallbackStats(records: MessageProcessingRecord[]): {
    totalCount: number;
    successCount: number;
    successRate: number;
    affectedUsers: number;
  } {
    const fallbackRecords = records.filter((r) => r.isFallback);

    if (fallbackRecords.length === 0) {
      return {
        totalCount: 0,
        successCount: 0,
        successRate: 0,
        affectedUsers: 0,
      };
    }

    const successCount = fallbackRecords.filter((r) => r.fallbackSuccess).length;
    const affectedUsers = new Set(fallbackRecords.filter((r) => r.userId).map((r) => r.userId!))
      .size;

    return {
      totalCount: fallbackRecords.length,
      successCount,
      successRate: (successCount / fallbackRecords.length) * 100,
      affectedUsers,
    };
  }

  /**
   * 计算业务指标
   * TODO: 后续需要实现具体的埋点计数逻辑
   */
  private calculateBusinessMetrics(records: MessageProcessingRecord[]): {
    consultations: {
      total: number;
      new: number;
    };
    bookings: {
      attempts: number;
      successful: number;
      failed: number;
      successRate: number;
    };
    conversion: {
      consultationToBooking: number;
    };
  } {
    // 当前返回占位符数据（placeholder）
    // 后续需要根据实际业务逻辑实现：
    // 1. 从 MessageProcessingRecord 中识别咨询用户（可能通过 scenario 或 tools）
    // 2. 从工具调用中统计面试预约次数（duliday_interview_booking）
    // 3. 从响应中判断预约是否成功

    // 占位符实现：根据现有数据模拟
    const uniqueUsers = new Set(records.filter((r) => r.userId).map((r) => r.userId!)).size;

    // 统计使用了面试预约工具的记录
    const bookingRecords = records.filter(
      (r) => r.tools && r.tools.includes('duliday_interview_booking'),
    );
    const successfulBookings = bookingRecords.filter((r) => r.status === 'success').length;
    const failedBookings = bookingRecords.filter((r) => r.status === 'failure').length;

    return {
      consultations: {
        total: uniqueUsers, // 临时：使用活跃用户数作为咨询人数
        new: uniqueUsers, // 临时：等同于 total（需要后续实现新老用户区分）
      },
      bookings: {
        attempts: bookingRecords.length,
        successful: successfulBookings,
        failed: failedBookings,
        successRate:
          bookingRecords.length > 0
            ? parseFloat(((successfulBookings / bookingRecords.length) * 100).toFixed(2))
            : 0,
      },
      conversion: {
        consultationToBooking:
          uniqueUsers > 0
            ? parseFloat(((bookingRecords.length / uniqueUsers) * 100).toFixed(2))
            : 0,
      },
    };
  }

  /**
   * 计算业务指标增长
   * TODO: 后续需要实现具体的对比逻辑
   */
  private calculateBusinessMetricsDelta(
    currentRecords: MessageProcessingRecord[],
    previousRecords: MessageProcessingRecord[],
  ): {
    consultations: number;
    bookingAttempts: number;
    bookingSuccessRate: number;
  } {
    const current = this.calculateBusinessMetrics(currentRecords);
    const previous = this.calculateBusinessMetrics(previousRecords);

    return {
      consultations: this.calculatePercentChange(
        current.consultations.total,
        previous.consultations.total,
      ),
      bookingAttempts: this.calculatePercentChange(
        current.bookings.attempts,
        previous.bookings.attempts,
      ),
      bookingSuccessRate: this.calculatePercentChange(
        current.bookings.successRate,
        previous.bookings.successRate,
      ),
    };
  }

  /**
   * 获取指定时间范围的小时统计
   */
  private getHourlyStatsForRange(range: TimeRange): HourlyStats[] {
    const records = this.filterRecordsByTimeRange(this.detailRecords, range);
    if (records.length === 0) {
      return [];
    }

    const startTime = Math.min(...records.map((r) => r.receivedAt));
    const now = Date.now();
    const hours = Math.ceil((now - startTime) / (60 * 60 * 1000));

    return this.getHourlyStatsRange(Math.max(hours, 1));
  }

  /**
   * 获取前一时间范围的小时统计
   */
  private getHourlyStatsForPreviousRange(range: TimeRange): HourlyStats[] {
    const previousRecords = this.getPreviousRangeRecords(range);
    if (previousRecords.length === 0) {
      return [];
    }

    // 这里返回空数组，因为 hourlyStatsMap 只保存最近的数据
    // 如果需要完整的历史对比，需要持久化到数据库
    return [];
  }

  private persistSnapshot(): void {
    this.snapshotService.saveSnapshot(this.buildSnapshotPayload());
  }

  private buildSnapshotPayload(): MonitoringSnapshot {
    return {
      version: this.SNAPSHOT_VERSION,
      savedAt: Date.now(),
      detailRecords: this.detailRecords.map((record) => ({
        ...record,
        tools: record.tools ? [...record.tools] : undefined,
      })),
      hourlyStats: Array.from(this.hourlyStatsMap.values()).map((stats) => ({ ...stats })),
      errorLogs: this.errorLogs.map((log) => ({ ...log })),
      globalCounters: { ...this.globalCounters },
      activeUsers: Array.from(this.activeUsersSet),
      activeChats: Array.from(this.activeChatsSet),
      currentProcessing: this.currentProcessing,
      peakProcessing: this.peakProcessing,
    };
  }

  private async restoreFromSnapshot(): Promise<void> {
    const snapshot = await this.snapshotService.readSnapshot();
    if (!snapshot) {
      return;
    }

    if (snapshot.version !== this.SNAPSHOT_VERSION) {
      this.logger.warn(
        `监控快照版本不匹配（当前: ${snapshot.version}, 预期: ${this.SNAPSHOT_VERSION}），将使用最新结构重建`,
      );
    }

    this.applySnapshot(snapshot);
    this.logger.log(
      `已从监控快照恢复数据: records=${this.detailRecords.length}, hourlyStats=${this.hourlyStatsMap.size}`,
    );
  }

  private applySnapshot(snapshot: MonitoringSnapshot): void {
    const detailRecords = snapshot.detailRecords || [];
    this.detailRecords = detailRecords.slice(-this.MAX_DETAIL_RECORDS).map((record) => ({
      ...record,
      tools: record.tools ? [...record.tools] : undefined,
    }));

    const hourlyStats = snapshot.hourlyStats || [];
    this.hourlyStatsMap = new Map(
      hourlyStats
        .sort((a, b) => new Date(a.hour).getTime() - new Date(b.hour).getTime())
        .slice(-this.MAX_HOURLY_STATS)
        .map((stats) => [stats.hour, { ...stats }]),
    );

    const errorLogs = snapshot.errorLogs || [];
    this.errorLogs = errorLogs.slice(-this.MAX_ERROR_LOGS).map((log) => ({ ...log }));

    this.globalCounters = snapshot.globalCounters
      ? { ...snapshot.globalCounters }
      : this.createDefaultCounters();

    this.activeUsersSet = new Set(snapshot.activeUsers || []);
    this.activeChatsSet = new Set(snapshot.activeChats || []);
    this.currentProcessing = snapshot.currentProcessing ?? 0;
    this.peakProcessing = snapshot.peakProcessing ?? 0;
  }
}
