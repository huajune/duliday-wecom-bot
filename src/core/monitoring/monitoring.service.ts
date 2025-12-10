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
import { MonitoringSnapshotService } from './monitoring-snapshot.service';
import { SupabaseService } from '@core/supabase/supabase.service';
import { RedisService } from '@core/redis';

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
  private readonly MAX_ERROR_LOGS = 500; // 最多保存500条错误日志

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

  constructor(
    private readonly snapshotService: MonitoringSnapshotService,
    private readonly supabaseService: SupabaseService,
    private readonly redisService: RedisService,
  ) {
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

    this.logger.log(
      `[Monitoring] 记录消息接收 [${messageId}], chatId=${chatId}, scenario=${metadata?.scenario ?? 'unknown'}`,
    );
    this.persistSnapshot();
  }

  /**
   * 记录 Worker 开始处理（用于计算真正的队列等待时间）
   * 应在 Bull Worker 回调函数入口处调用
   */
  recordWorkerStart(messageId: string): void {
    const record = this.findRecord(messageId);
    if (record) {
      const now = Date.now();
      // queueDuration = Worker 开始处理时间 - 消息接收时间
      // 这个时间包含：消息聚合等待 + Bull Queue 等待
      record.queueDuration = now - record.receivedAt;
      this.logger.debug(`记录 Worker 开始处理 [${messageId}], queue=${record.queueDuration}ms`);
      this.persistSnapshot();
    }
  }

  /**
   * 记录 AI 处理开始
   * 应在调用 Agent API 之前调用
   */
  recordAiStart(messageId: string): void {
    const record = this.findRecord(messageId);
    if (record) {
      const now = Date.now();
      record.aiStartAt = now;

      // 如果已经记录了 queueDuration（Worker 开始时间），计算预处理耗时
      if (record.queueDuration !== undefined) {
        // prepDuration = AI 开始时间 - Worker 开始时间
        // Worker 开始时间 = receivedAt + queueDuration
        const workerStartAt = record.receivedAt + record.queueDuration;
        record.prepDuration = now - workerStartAt;
        this.logger.debug(`记录 AI 开始处理 [${messageId}], prep=${record.prepDuration}ms`);
      } else {
        // 兼容旧逻辑：如果没有调用 recordWorkerStart，直接计算 queueDuration
        record.queueDuration = now - record.receivedAt;
        this.logger.debug(
          `记录 AI 开始处理 [${messageId}], queue=${record.queueDuration}ms (legacy)`,
        );
      }
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
    this.logger.debug(
      `[recordSuccess] 开始处理 [${messageId}], 当前记录数: ${this.detailRecords.length}`,
    );

    // 查找所有匹配的记录（处理重复记录的情况）
    const records = this.findAllRecords(messageId);

    if (records.length > 0) {
      // 更新所有匹配的记录
      records.forEach((record, index) => {
        if (index > 0) {
          this.logger.warn(
            `[recordSuccess] 更新重复记录 ${index + 1}/${records.length} [${messageId}]`,
          );
        }

        record.status = 'success';
        record.totalDuration = Date.now() - record.receivedAt;
        record.scenario = metadata?.scenario || record.scenario;
        record.tools = metadata?.tools || record.tools;
        record.tokenUsage = metadata?.tokenUsage ?? record.tokenUsage;
        record.replyPreview = metadata?.replyPreview ?? record.replyPreview;
        record.replySegments = metadata?.replySegments ?? record.replySegments;
        record.isFallback = metadata?.isFallback ?? record.isFallback;
        record.fallbackSuccess = metadata?.fallbackSuccess ?? record.fallbackSuccess;
        record.agentInvocation = metadata?.agentInvocation ?? record.agentInvocation;

        // 更新降级统计（只在第一条记录时更新全局计数器）
        if (index === 0 && record.isFallback) {
          this.globalCounters.totalFallback++;
          if (record.fallbackSuccess) {
            this.globalCounters.totalFallbackSuccess++;
          }
        }

        // 更新小时级别统计（只在第一条记录时更新）
        if (index === 0) {
          this.updateHourlyStats(record);
        }
      });

      // 全局计数器只增加一次
      this.globalCounters.totalSuccess++;
      this.currentProcessing = Math.max(this.currentProcessing - 1, 0);

      const firstRecord = records[0];
      this.logger.log(
        `消息处理成功 [${messageId}], 总耗时: ${firstRecord.totalDuration}ms, scenario=${
          firstRecord.scenario || 'unknown'
        }, fallback=${firstRecord.isFallback ? 'true' : 'false'}` +
          (records.length > 1 ? `, 已更新 ${records.length} 条重复记录` : ''),
      );
      this.persistSnapshot();

      // 异步保存用户活跃数据到数据库（不阻塞主流程）
      this.saveUserActivityToDatabase(firstRecord).catch((err) => {
        this.logger.warn(`保存用户活跃数据失败: ${err.message}`);
      });

      // 异步保存消息处理记录到数据库（不阻塞主流程）
      this.saveMessageProcessingRecordToDatabase(firstRecord).catch((err) => {
        this.logger.warn(`保存消息处理记录失败: ${err.message}`);
      });
    } else {
      // ⚠️ 记录未找到，可能原因：
      // 1. 服务重启后快照恢复不完整（Redis TTL 过期）
      // 2. 环形缓冲区溢出（超过 MAX_DETAIL_RECORDS）
      // 3. recordMessageReceived 未被调用或 messageId 不匹配
      // 【重要】使用 error 级别确保日志可见
      this.logger.error(
        `[recordSuccess] ❌ 消息记录未找到 [${messageId}]，无法更新状态为 success。` +
          `当前记录数: ${this.detailRecords.length}/${this.MAX_DETAIL_RECORDS}。` +
          `已有记录 ID: ${this.detailRecords
            .slice(-5)
            .map((r) => r.messageId)
            .join(', ')}`,
      );
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
    this.logger.debug(
      `[recordFailure] 开始处理 [${messageId}], 当前记录数: ${this.detailRecords.length}`,
    );

    // 🔧 修复：获取所有匹配的记录（可能存在重复）
    const records = this.findAllRecords(messageId);

    if (records.length > 0) {
      // 🔧 修复：更新所有匹配的记录
      records.forEach((record, index) => {
        if (index > 0) {
          this.logger.warn(
            `[recordFailure] 更新重复记录 ${index + 1}/${records.length} [${messageId}]`,
          );
        }

        record.status = 'failure';
        record.error = error;
        record.totalDuration = Date.now() - record.receivedAt;
        record.scenario = metadata?.scenario || record.scenario;
        record.tools = metadata?.tools || record.tools;
        record.tokenUsage = metadata?.tokenUsage ?? record.tokenUsage;
        record.replySegments = metadata?.replySegments ?? record.replySegments;
        record.isFallback = metadata?.isFallback ?? record.isFallback;
        record.fallbackSuccess = metadata?.fallbackSuccess ?? record.fallbackSuccess;

        // 更新小时级别统计（每条记录都需要更新）
        this.updateHourlyStats(record);
      });

      // 🔧 修复：全局计数器只增加一次（即使有重复记录）
      this.globalCounters.totalFailure++;
      this.currentProcessing = Math.max(this.currentProcessing - 1, 0);

      // 更新降级统计（使用第一条记录的数据）
      const firstRecord = records[0];
      if (firstRecord.isFallback) {
        this.globalCounters.totalFallback++;
        if (firstRecord.fallbackSuccess) {
          this.globalCounters.totalFallbackSuccess++;
        }
      }

      // 添加到错误日志
      this.addErrorLog(messageId, error);

      this.logger.error(
        `消息处理失败 [${messageId}]: ${error}, scenario=${firstRecord.scenario || 'unknown'}, fallback=${firstRecord.isFallback ? 'true' : 'false'}` +
          (records.length > 1 ? ` (已更新 ${records.length} 条重复记录)` : ''),
      );
      this.persistSnapshot();

      // 异步保存消息处理记录到数据库（失败也要保存）
      this.saveMessageProcessingRecordToDatabase(firstRecord).catch((err) => {
        this.logger.warn(`保存失败消息处理记录失败: ${err.message}`);
      });
    } else {
      // ⚠️ 记录未找到，可能原因同 recordSuccess
      // 【重要】使用 error 级别确保日志可见
      this.logger.error(
        `[recordFailure] ❌ 消息记录未找到 [${messageId}]，无法更新状态为 failure。` +
          `当前记录数: ${this.detailRecords.length}/${this.MAX_DETAIL_RECORDS}。` +
          `已有记录 ID: ${this.detailRecords
            .slice(-5)
            .map((r) => r.messageId)
            .join(', ')}`,
      );
      // 即使记录不存在，也要记录错误日志
      this.addErrorLog(messageId, error);
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

    // 根据时间范围过滤告警日志
    const filteredErrorLogs = this.filterErrorLogsByTimeRange(timeRange);
    const now = Date.now();
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const alertsLastHour = this.errorLogs.filter(
      (log) => now - log.timestamp <= ONE_HOUR_MS,
    ).length;

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
        total: filteredErrorLogs.length, // 修复：使用时间范围过滤后的告警数
        lastHour: alertsLastHour, // 修复：改为真正的近1小时
        last24Hours: this.errorLogs.filter((log) => now - log.timestamp <= 24 * ONE_HOUR_MS).length, // 近24小时告警数（用于错误率检查）
        byType: this.buildAlertTypeMetrics(filteredErrorLogs), // 修复：只统计过滤后的日志
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
      todayUsers: [], // 用户数据从数据库获取，由 getDashboardDataAsync 填充
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
      recentAlertCount: this.errorLogs.filter((log) => Date.now() - log.timestamp <= 5 * 60 * 1000)
        .length,
    };
  }

  /**
   * 获取今日用户列表（用于账号托管管理页面）
   * 从数据库读取，数据已迁移到 user_activity 表
   * 使用 Redis 缓存减少 Supabase 请求量（30秒 TTL）
   */
  async getTodayUsers(): Promise<TodayUser[]> {
    const CACHE_KEY = 'monitoring:today_users';
    const CACHE_TTL_SEC = 30; // 30秒缓存

    // 1. 尝试从 Redis 获取缓存
    try {
      const cached = await this.redisService.get<string>(CACHE_KEY);
      if (cached) {
        const parsedData = JSON.parse(cached) as TodayUser[];
        this.logger.debug(`[Redis] 命中今日用户缓存 (${parsedData.length} 条记录)`);
        return parsedData;
      }
    } catch (error) {
      this.logger.warn('[Redis] 获取今日用户缓存失败，降级到数据库查询', error);
    }

    // 2. 从数据库查询
    const users = await this.getTodayUsersFromDatabase();

    // 3. 写入 Redis 缓存
    if (users.length > 0) {
      try {
        await this.redisService.setex(CACHE_KEY, CACHE_TTL_SEC, JSON.stringify(users));
        this.logger.debug(
          `[Redis] 已缓存今日用户数据 (${users.length} 条记录, TTL: ${CACHE_TTL_SEC}s)`,
        );
      } catch (error) {
        this.logger.warn('[Redis] 写入今日用户缓存失败', error);
      }
    }

    return users;
  }

  /**
   * 获取仪表盘数据（含数据库用户数据）
   * @param timeRange 时间范围：today/week/month
   */
  async getDashboardDataAsync(timeRange: TimeRange = 'today'): Promise<DashboardData> {
    const data = this.getDashboardData(timeRange);

    // 仅在 today 范围时从数据库获取用户数据
    if (timeRange === 'today') {
      const dbUsers = await this.getTodayUsersFromDatabase();
      data.todayUsers = dbUsers;
    }

    return data;
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
   * @param errorLogs 过滤后的错误日志（按时间范围）
   */
  private buildAlertTypeMetrics(errorLogs: MonitoringErrorLog[]): AlertTypeMetric[] {
    const typeMap = new Map<AlertErrorType | 'unknown', number>();

    // 只统计传入的错误日志，避免重复计数
    for (const log of errorLogs) {
      const type = log.alertType || 'unknown';
      typeMap.set(type, (typeMap.get(type) || 0) + 1);
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
        // ✅ 使用工具执行状态判断预约成功（与 calculateBusinessMetrics 保持一致）
        const bookingSuccess = this.checkBookingToolSuccess(record);
        if (bookingSuccess === true) {
          bucket.successfulBookings += 1;
        } else if (bookingSuccess === null) {
          // 无法确定状态时，按消息整体状态判断（兼容旧数据）
          if (record.status === 'success') {
            bucket.successfulBookings += 1;
          }
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
        // ✅ 使用工具执行状态判断预约成功（与 calculateBusinessMetrics 保持一致）
        const bookingSuccess = this.checkBookingToolSuccess(record);
        if (bookingSuccess === true) {
          bucket.successfulBookings += 1;
        } else if (bookingSuccess === null) {
          // 无法确定状态时，按消息整体状态判断（兼容旧数据）
          if (record.status === 'success') {
            bucket.successfulBookings += 1;
          }
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
   * 保存用户活跃数据到数据库
   * 每次消息处理成功后异步调用
   */
  private async saveUserActivityToDatabase(record: MessageProcessingRecord): Promise<void> {
    if (!record.userId || !record.chatId) {
      return;
    }

    await this.supabaseService.upsertUserActivity({
      chatId: record.chatId,
      odId: record.userId,
      odName: record.userName,
      groupId: undefined, // TODO: 后续支持群聊
      groupName: undefined,
      messageCount: 1,
      tokenUsage: record.tokenUsage || 0,
      activeAt: record.receivedAt,
    });
  }

  /**
   * 保存消息处理记录到数据库
   * 用于持久化实时消息详情，支持历史查询
   */
  private async saveMessageProcessingRecordToDatabase(
    record: MessageProcessingRecord,
  ): Promise<void> {
    if (!record.messageId) {
      return;
    }

    await this.supabaseService.saveMessageProcessingRecord({
      messageId: record.messageId,
      chatId: record.chatId,
      userId: record.userId,
      userName: record.userName,
      managerName: record.managerName,
      receivedAt: record.receivedAt,
      messagePreview: record.messagePreview,
      replyPreview: record.replyPreview,
      replySegments: record.replySegments,
      status: record.status,
      error: record.error,
      scenario: record.scenario,
      totalDuration: record.totalDuration,
      queueDuration: record.queueDuration,
      prepDuration: record.prepDuration,
      aiStartAt: record.aiStartAt,
      aiEndAt: record.aiEndAt,
      aiDuration: record.aiDuration,
      sendDuration: record.sendDuration,
      tools: record.tools,
      tokenUsage: record.tokenUsage,
      isFallback: record.isFallback,
      fallbackSuccess: record.fallbackSuccess,
      agentInvocation: record.agentInvocation,
    });
  }

  /**
   * 从数据库获取今日活跃用户（带托管状态）
   */
  async getTodayUsersFromDatabase(): Promise<TodayUser[]> {
    const dbUsers = await this.supabaseService.getTodayActiveUsers();

    // 批量获取托管状态
    const chatIds = dbUsers.map((u) => u.chatId);
    const pausedSet = new Set<string>();

    // 从 Supabase 获取托管状态
    for (const chatId of chatIds) {
      const status = await this.supabaseService.getUserHostingStatus(chatId);
      if (status.isPaused) {
        pausedSet.add(chatId);
      }
    }

    return dbUsers.map((user) => ({
      chatId: user.chatId,
      odId: user.odId || user.chatId,
      odName: user.odName || user.chatId,
      groupName: user.groupName,
      messageCount: user.messageCount,
      tokenUsage: user.tokenUsage,
      firstActiveAt: user.firstActiveAt, // 已经是 number 类型（时间戳）
      lastActiveAt: user.lastActiveAt, // 已经是 number 类型（时间戳）
      isPaused: pausedSet.has(user.chatId),
    }));
  }

  /**
   * 获取指定日期的活跃用户（带托管状态）
   * @param date 日期字符串 (YYYY-MM-DD)
   */
  async getUsersByDate(date: string): Promise<TodayUser[]> {
    const dbUsers = await this.supabaseService.getActiveUsersByDate(date);

    // 批量获取托管状态
    const chatIds = dbUsers.map((u) => u.chatId);
    const pausedSet = new Set<string>();

    // 从 Supabase 获取托管状态
    for (const chatId of chatIds) {
      const status = await this.supabaseService.getUserHostingStatus(chatId);
      if (status.isPaused) {
        pausedSet.add(chatId);
      }
    }

    return dbUsers.map((user) => ({
      chatId: user.chatId,
      odId: user.odId || user.chatId,
      odName: user.odName || user.chatId,
      groupName: user.groupName,
      messageCount: user.messageCount,
      tokenUsage: user.tokenUsage,
      firstActiveAt: user.firstActiveAt,
      lastActiveAt: user.lastActiveAt,
      isPaused: pausedSet.has(user.chatId),
    }));
  }

  /**
   * 获取近1月咨询用户趋势数据
   */
  async getUserTrend(): Promise<
    Array<{
      date: string;
      userCount: number;
      messageCount: number;
    }>
  > {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30); // 过去30天

    return this.supabaseService.getDailyUserStats(startDate, endDate);
  }

  // ========== 私有方法 ==========

  /**
   * 添加记录（环形缓冲区）
   * 防止重复插入相同 messageId 的记录
   */
  private addRecord(record: MessageProcessingRecord): void {
    // 检查是否已存在相同 messageId 的记录
    const existingIndex = this.detailRecords.findIndex((r) => r.messageId === record.messageId);
    if (existingIndex !== -1) {
      this.logger.warn(
        `[addRecord] 检测到重复的 messageId [${record.messageId}]，跳过添加。` +
          `已存在记录状态: ${this.detailRecords[existingIndex].status}`,
      );
      return;
    }

    if (this.detailRecords.length >= this.MAX_DETAIL_RECORDS) {
      this.detailRecords.shift(); // 移除最旧的记录
    }
    this.detailRecords.push(record);
  }

  /**
   * 查找记录（返回所有匹配的记录）
   * 注意：正常情况下应该只有一条，但为了处理异常情况，返回数组
   */
  private findRecord(messageId: string): MessageProcessingRecord | undefined {
    const records = this.detailRecords.filter((r) => r.messageId === messageId);

    if (records.length > 1) {
      this.logger.warn(
        `[findRecord] 发现 ${records.length} 条重复的 messageId [${messageId}]，` +
          `将返回第一条（receivedAt=${records[0].receivedAt}）`,
      );
    }

    return records[0];
  }

  /**
   * 查找所有匹配的记录（用于批量更新）
   */
  private findAllRecords(messageId: string): MessageProcessingRecord[] {
    return this.detailRecords.filter((r) => r.messageId === messageId);
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

    const totalDurations = records.map((r) => r.totalDuration!).sort((a, b) => a - b);
    const aiDurations = records.filter((r) => r.aiDuration !== undefined).map((r) => r.aiDuration!);
    const sendDurations = records
      .filter((r) => r.sendDuration !== undefined)
      .map((r) => r.sendDuration!);

    // avgDuration 使用 aiDuration（首条响应时间），更能反映用户体验
    stats.avgDuration =
      aiDurations.length > 0 ? this.average(aiDurations) : this.average(totalDurations);
    stats.minDuration = Math.min(...totalDurations);
    stats.maxDuration = Math.max(...totalDurations);
    stats.p50Duration = this.percentile(totalDurations, 0.5);
    stats.p95Duration = this.percentile(totalDurations, 0.95);
    stats.p99Duration = this.percentile(totalDurations, 0.99);
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
    // 过滤异常值：排除超过 10 分钟（600,000ms）的记录，这些通常是异常或超时
    const MAX_REASONABLE_DURATION = 10 * 60 * 1000; // 10 分钟

    const durations = this.detailRecords
      .filter(
        (r) =>
          r.status !== 'processing' &&
          r.totalDuration !== undefined &&
          r.totalDuration > 0 &&
          r.totalDuration <= MAX_REASONABLE_DURATION,
      )
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
   * 获取首条响应最慢的记录（按 aiDuration 排序）
   */
  private getSlowestRecords(limit: number): MessageProcessingRecord[] {
    return [...this.detailRecords]
      .filter((r) => r.status !== 'processing' && r.aiDuration !== undefined)
      .sort((a, b) => (b.aiDuration || 0) - (a.aiDuration || 0))
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

    // 🔧 修复: 排除异常记录 - "服务重启导致处理中断"会产生极端长的耗时
    // 这些记录的 totalDuration 是从接收到服务重启的时间,不代表真实处理时长
    const completedRecords = records.filter(
      (r) =>
        r.status !== 'processing' &&
        r.totalDuration !== undefined &&
        r.error !== '服务重启导致处理中断', // 排除服务重启导致的异常记录
    );

    const avgDuration =
      completedRecords.length > 0
        ? completedRecords.reduce((sum, r) => sum + (r.totalDuration || 0), 0) /
          completedRecords.length
        : 0;

    const activeUsers = new Set(records.filter((r) => r.userId).map((r) => r.userId!)).size;
    const activeChats = new Set(records.map((r) => r.chatId)).size;

    // 🔧 修复: 成功率只统计已完成的记录 (不包含 processing 状态)
    // processing 状态的消息还在处理中,不应计入成功率分母
    const completedCount = successRecords.length + failureRecords.length;
    const successRate = completedCount > 0 ? (successRecords.length / completedCount) * 100 : 0;

    return {
      totalMessages: records.length,
      successCount: successRecords.length,
      failureCount: failureRecords.length,
      successRate,
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

    // 统计唯一用户数
    const uniqueUsers = new Set(records.filter((r) => r.userId).map((r) => r.userId!)).size;

    // 统计使用了面试预约工具的记录
    const bookingRecords = records.filter(
      (r) => r.tools && r.tools.includes('duliday_interview_booking'),
    );

    // 从 agentInvocation.response 中检测预约工具是否真正成功
    // 工具状态为 'output-available' 才表示成功执行
    let successfulBookings = 0;
    let failedBookings = 0;

    for (const record of bookingRecords) {
      const bookingSuccess = this.checkBookingToolSuccess(record);
      if (bookingSuccess === true) {
        successfulBookings++;
      } else if (bookingSuccess === false) {
        failedBookings++;
      } else {
        // 无法确定状态，按消息整体状态判断（兼容旧数据）
        if (record.status === 'success') {
          successfulBookings++;
        } else if (record.status === 'failure') {
          failedBookings++;
        }
      }
    }

    // 🔧 修复: 预约转化率应统计唯一用户数,而非预约尝试次数
    // 原逻辑: 转化率 = 预约尝试次数 / 咨询人数 (可能>100%)
    // 新逻辑: 转化率 = 预约用户数 / 咨询人数 (≤100%)
    const bookingUsers = new Set(
      bookingRecords
        .filter(
          (r) => r.userId && r.status === 'success' && this.checkBookingToolSuccess(r) !== false, // 排除明确失败的预约
        )
        .map((r) => r.userId!),
    );

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
          uniqueUsers > 0 ? parseFloat(((bookingUsers.size / uniqueUsers) * 100).toFixed(2)) : 0,
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
   * 检查预约工具是否成功执行
   * 从 agentInvocation.response 中查找 duliday_interview_booking 工具的状态
   * @returns true=成功, false=失败, null=无法确定
   */
  private checkBookingToolSuccess(record: MessageProcessingRecord): boolean | null {
    const response = record.agentInvocation?.response as {
      messages?: Array<{
        role: string;
        parts?: Array<{
          type: string;
          toolName?: string;
          state?: string;
          output?: Record<string, unknown>;
          error?: string;
        }>;
      }>;
    };
    if (!response?.messages) {
      return null; // 无法确定
    }

    // 遍历所有消息查找预约工具
    for (const message of response.messages) {
      if (message.role !== 'assistant' || !message.parts) continue;

      for (const part of message.parts) {
        if (part.type === 'dynamic-tool' && part.toolName === 'duliday_interview_booking') {
          // 状态为 output-available 表示工具执行成功
          if (part.state === 'output-available') {
            return true;
          }
          // 状态为 error 表示工具执行失败
          if (part.state === 'error') {
            return false;
          }
        }
      }
    }

    return null; // 未找到工具或无法确定状态
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
    this.logger.log('[restoreFromSnapshot] 开始从 Redis 恢复监控快照...');

    const snapshot = await this.snapshotService.readSnapshot();
    if (!snapshot) {
      this.logger.log('[restoreFromSnapshot] Redis 中没有找到监控快照，将从空白状态开始');
      return;
    }

    if (snapshot.version !== this.SNAPSHOT_VERSION) {
      this.logger.warn(
        `监控快照版本不匹配（当前: ${snapshot.version}, 预期: ${this.SNAPSHOT_VERSION}），将使用最新结构重建`,
      );
    }

    this.applySnapshot(snapshot);

    // 清理过期的 processing 状态记录（服务重启后这些记录无法被正常更新）
    const cleanedCount = this.cleanupStaleProcessingRecords();

    this.logger.log(
      `已从监控快照恢复数据: records=${this.detailRecords.length}, hourlyStats=${this.hourlyStatsMap.size}` +
        (cleanedCount > 0 ? `, 已清理 ${cleanedCount} 条过期 processing 记录` : ''),
    );
  }

  /**
   * 清理过期的 processing 状态记录
   * 服务重启后，之前处于 processing 状态的消息将永远无法被正常完成
   * 将超过阈值的 processing 记录标记为 failure
   * @returns 清理的记录数
   */
  private cleanupStaleProcessingRecords(): number {
    const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 分钟
    const now = Date.now();
    let cleanedCount = 0;

    for (const record of this.detailRecords) {
      if (record.status === 'processing' && now - record.receivedAt > STALE_THRESHOLD_MS) {
        record.status = 'failure';
        record.error = '服务重启导致处理中断';
        record.totalDuration = now - record.receivedAt;

        // 更新计数器
        this.globalCounters.totalFailure++;
        cleanedCount++;

        // 添加错误日志
        this.addErrorLog(record.messageId, record.error);

        this.logger.debug(`清理过期 processing 记录: ${record.messageId}`);
      }
    }

    // 重置 currentProcessing 计数（服务重启后没有正在处理的任务）
    this.currentProcessing = 0;

    return cleanedCount;
  }

  private applySnapshot(snapshot: MonitoringSnapshot): void {
    const detailRecords = snapshot.detailRecords || [];

    // 🔧 修复: 快照恢复时去重,防止重复记录
    // 按 messageId 去重,保留最新的记录 (receivedAt 最大)
    const uniqueRecordsMap = new Map<string, MessageProcessingRecord>();
    for (const record of detailRecords) {
      const existing = uniqueRecordsMap.get(record.messageId);
      if (!existing || record.receivedAt > existing.receivedAt) {
        uniqueRecordsMap.set(record.messageId, record);
      }
    }

    this.detailRecords = Array.from(uniqueRecordsMap.values())
      .sort((a, b) => a.receivedAt - b.receivedAt) // 按时间排序
      .slice(-this.MAX_DETAIL_RECORDS) // 保留最新的记录
      .map((record) => ({
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
