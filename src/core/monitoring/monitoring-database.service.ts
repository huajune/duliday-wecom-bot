import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosInstance } from 'axios';
import { HttpClientFactory } from '@core/client-http';
import { SupabaseService } from '@core/supabase/supabase.service';
import {
  MessageProcessingRecord,
  HourlyStats,
  MonitoringErrorLog,
  DailyStats,
  TimeRange,
} from './interfaces/monitoring.interface';

/**
 * 监控数据库服务
 * 负责将监控数据持久化到 Supabase
 *
 * 数据表：
 * - message_processing_records: 详细消息处理记录（已存在）
 * - monitoring_hourly_stats: 小时级聚合统计（新建）
 * - monitoring_error_logs: 错误日志（新建）
 * - monitoring_daily_stats: 每日统计（新建）
 */
@Injectable()
export class MonitoringDatabaseService implements OnModuleInit {
  private readonly logger = new Logger(MonitoringDatabaseService.name);

  // HTTP Client
  private supabaseHttpClient!: AxiosInstance;

  // 表名常量
  private readonly TABLE_RECORDS = 'message_processing_records';
  private readonly TABLE_HOURLY_STATS = 'monitoring_hourly_stats';
  private readonly TABLE_ERROR_LOGS = 'monitoring_error_logs';
  private readonly TABLE_DAILY_STATS = 'monitoring_daily_stats';

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    private readonly httpClientFactory: HttpClientFactory,
  ) {}

  async onModuleInit() {
    const supabaseUrl = this.configService.get<string>('NEXT_PUBLIC_SUPABASE_URL');
    const supabaseKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      this.logger.error('Missing Supabase credentials');
      return;
    }

    // 创建 Supabase REST API 客户端
    this.supabaseHttpClient = this.httpClientFactory.createWithBearerAuth(
      {
        baseURL: `${supabaseUrl}/rest/v1`,
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseKey,
        },
      },
      supabaseKey,
    );
  }

  // ========================================
  // 详细记录（MessageProcessingRecord）
  // ========================================

  /**
   * 保存消息处理记录到数据库
   * 使用 SupabaseService 已有的 saveMessageProcessingRecord 方法
   */
  async saveDetailRecord(record: MessageProcessingRecord): Promise<void> {
    try {
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
    } catch (error) {
      this.logger.error(`保存消息记录异常 [${record.messageId}]:`, error);
    }
  }

  /**
   * 批量保存消息处理记录
   * 逐条调用 saveDetailRecord (SupabaseService 没有批量 API)
   */
  async saveDetailRecordsBatch(records: MessageProcessingRecord[]): Promise<void> {
    if (records.length === 0) return;

    try {
      await Promise.all(records.map((record) => this.saveDetailRecord(record)));
      this.logger.log(`批量保存消息记录成功 (${records.length} 条)`);
    } catch (error) {
      this.logger.error(`批量保存消息记录异常 (${records.length} 条):`, error);
    }
  }

  /**
   * 按时间范围查询消息处理记录
   */
  async getDetailRecordsByTimeRange(range: TimeRange): Promise<MessageProcessingRecord[]> {
    try {
      const cutoffTime = this.getTimeRangeCutoff(range);

      const records = await this.supabaseService.getMessageProcessingRecords({
        startDate: cutoffTime,
      });

      return records as MessageProcessingRecord[];
    } catch (error) {
      this.logger.error(`查询消息记录异常 [${range}]:`, error);
      return [];
    }
  }

  /**
   * 查询最近 N 条消息记录
   */
  async getRecentDetailRecords(limit: number = 50): Promise<MessageProcessingRecord[]> {
    try {
      const records = await this.supabaseService.getMessageProcessingRecords({ limit });
      return records as MessageProcessingRecord[];
    } catch (error) {
      this.logger.error('查询最近消息记录异常:', error);
      return [];
    }
  }

  /**
   * 按时间范围查询消息处理记录
   */
  async getRecordsByTimeRange(
    startTime: number,
    endTime: number,
  ): Promise<MessageProcessingRecord[]> {
    try {
      const startDate = new Date(startTime).toISOString();
      const endDate = new Date(endTime).toISOString();

      const response = await this.supabaseHttpClient.get<any[]>('/message_processing_records', {
        params: {
          and: `(received_at.gte.${startDate},received_at.lt.${endDate})`,
          order: 'received_at.desc',
          limit: 10000, // 最多查询 1 万条
        },
      });

      if (!response.data || response.data.length === 0) {
        return [];
      }

      // 转换 snake_case 到 camelCase
      return response.data.map((record: any) => ({
        messageId: record.message_id,
        chatId: record.chat_id,
        userId: record.user_id,
        userName: record.user_name,
        managerName: record.manager_name,
        scenario: record.scenario,
        receivedAt: new Date(record.received_at).getTime(),
        aiStartAt: record.ai_start_at ? new Date(record.ai_start_at).getTime() : undefined,
        aiEndAt: record.ai_end_at ? new Date(record.ai_end_at).getTime() : undefined,
        sendStartAt: record.send_start_at ? new Date(record.send_start_at).getTime() : undefined,
        sendEndAt: record.send_end_at ? new Date(record.send_end_at).getTime() : undefined,
        totalDuration: record.total_duration,
        aiDuration: record.ai_duration,
        sendDuration: record.send_duration,
        queueDuration: record.queue_duration,
        prepDuration: record.prep_duration,
        status: record.status,
        error: record.error,
        isFallback: record.is_fallback,
        fallbackSuccess: record.fallback_success,
        messagePreview: record.message_preview,
        replyPreview: record.reply_preview,
        tokenUsage: record.token_usage,
        tools: record.tools,
        replySegments: record.reply_segments,
        alertType: record.alert_type,
      }));
    } catch (error) {
      this.logger.error('按时间范围查询消息记录失败:', error);
      return [];
    }
  }

  // ========================================
  // 小时统计（HourlyStats）- TODO: 需要实现
  // ========================================

  /**
   * 保存小时级聚合统计（UPSERT）
   */
  async saveHourlyStats(stats: HourlyStats): Promise<void> {
    try {
      const statsRecord = {
        hour: stats.hour,
        message_count: stats.messageCount,
        success_count: stats.successCount,
        failure_count: stats.failureCount,
        success_rate: stats.successRate,
        avg_duration: stats.avgDuration,
        min_duration: stats.minDuration,
        max_duration: stats.maxDuration,
        p50_duration: stats.p50Duration,
        p95_duration: stats.p95Duration,
        p99_duration: stats.p99Duration,
        avg_ai_duration: stats.avgAiDuration,
        avg_send_duration: stats.avgSendDuration,
        active_users: stats.activeUsers,
        active_chats: stats.activeChats,
      };

      await this.supabaseHttpClient.post(`/monitoring_hourly_stats`, statsRecord, {
        headers: {
          Prefer: 'resolution=merge-duplicates',
        },
      });
    } catch (error) {
      this.logger.error(`保存小时统计失败 [${stats.hour}]:`, error);
    }
  }

  /**
   * 批量保存小时统计
   */
  async saveHourlyStatsBatch(statsList: HourlyStats[]): Promise<void> {
    if (!statsList || statsList.length === 0) return;

    try {
      const statsRecords = statsList.map((stats) => ({
        hour: stats.hour,
        message_count: stats.messageCount,
        success_count: stats.successCount,
        failure_count: stats.failureCount,
        success_rate: stats.successRate,
        avg_duration: stats.avgDuration,
        min_duration: stats.minDuration,
        max_duration: stats.maxDuration,
        p50_duration: stats.p50Duration,
        p95_duration: stats.p95Duration,
        p99_duration: stats.p99Duration,
        avg_ai_duration: stats.avgAiDuration,
        avg_send_duration: stats.avgSendDuration,
        active_users: stats.activeUsers,
        active_chats: stats.activeChats,
      }));

      await this.supabaseHttpClient.post(`/monitoring_hourly_stats`, statsRecords, {
        headers: {
          Prefer: 'resolution=merge-duplicates',
        },
      });

      this.logger.log(`批量保存 ${statsList.length} 条小时统计成功`);
    } catch (error) {
      this.logger.error(`批量保存小时统计失败:`, error);
    }
  }

  /**
   * 查询最近 N 小时的统计数据
   */
  async getHourlyStats(hours: number = 72): Promise<HourlyStats[]> {
    try {
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - hours);

      const response = await this.supabaseHttpClient.get(`/monitoring_hourly_stats`, {
        params: {
          select: '*',
          hour: `gte.${cutoffTime.toISOString()}`,
          order: 'hour.desc',
        },
      });

      return (response.data || []).map((row: any) => ({
        hour: row.hour,
        messageCount: row.message_count,
        successCount: row.success_count,
        failureCount: row.failure_count,
        successRate: row.success_rate,
        avgDuration: row.avg_duration,
        minDuration: row.min_duration,
        maxDuration: row.max_duration,
        p50Duration: row.p50_duration,
        p95Duration: row.p95_duration,
        p99Duration: row.p99_duration,
        avgAiDuration: row.avg_ai_duration,
        avgSendDuration: row.avg_send_duration,
        activeUsers: row.active_users,
        activeChats: row.active_chats,
      }));
    } catch (error) {
      this.logger.error(`查询小时统计失败:`, error);
      return [];
    }
  }

  /**
   * 按时间范围查询小时统计数据
   */
  async getHourlyStatsByTimeRange(startTime: number, endTime: number): Promise<HourlyStats[]> {
    try {
      const startDate = new Date(startTime).toISOString();
      const endDate = new Date(endTime).toISOString();

      const response = await this.supabaseHttpClient.get(`/monitoring_hourly_stats`, {
        params: {
          select: '*',
          and: `(hour.gte.${startDate},hour.lt.${endDate})`,
          order: 'hour.asc',
        },
      });

      return (response.data || []).map((row: any) => ({
        hour: row.hour,
        messageCount: row.message_count,
        successCount: row.success_count,
        failureCount: row.failure_count,
        successRate: row.success_rate,
        avgDuration: row.avg_duration,
        minDuration: row.min_duration,
        maxDuration: row.max_duration,
        p50Duration: row.p50_duration,
        p95Duration: row.p95_duration,
        p99Duration: row.p99_duration,
        avgAiDuration: row.avg_ai_duration,
        avgSendDuration: row.avg_send_duration,
        activeUsers: row.active_users,
        activeChats: row.active_chats,
      }));
    } catch (error) {
      this.logger.error(`按时间范围查询小时统计失败:`, error);
      return [];
    }
  }

  // ========================================
  // 错误日志（MonitoringErrorLog）- TODO: 需要实现
  // ========================================

  /**
   * 保存错误日志到 Supabase
   */
  async saveErrorLog(log: MonitoringErrorLog): Promise<void> {
    try {
      const errorRecord = {
        message_id: log.messageId,
        timestamp: log.timestamp, // 直接使用 Unix 毫秒时间戳
        error: log.error,
        alert_type: log.alertType,
      };

      await this.supabaseHttpClient.post(`/monitoring_error_logs`, errorRecord, {
        headers: {
          Prefer: 'resolution=merge-duplicates',
        },
      });
    } catch (error) {
      this.logger.error(`保存错误日志失败 [${log.messageId}]:`, error);
    }
  }

  /**
   * 批量保存错误日志
   */
  async saveErrorLogsBatch(logs: MonitoringErrorLog[]): Promise<void> {
    if (!logs || logs.length === 0) return;

    try {
      const errorRecords = logs.map((log) => ({
        message_id: log.messageId,
        timestamp: log.timestamp, // 直接使用 Unix 毫秒时间戳
        error: log.error,
        alert_type: log.alertType,
      }));

      await this.supabaseHttpClient.post(`/monitoring_error_logs`, errorRecords, {
        headers: {
          Prefer: 'resolution=merge-duplicates',
        },
      });

      this.logger.log(`批量保存 ${logs.length} 条错误日志成功`);
    } catch (error) {
      this.logger.error(`批量保存错误日志失败:`, error);
    }
  }

  /**
   * 查询最近的错误日志
   */
  async getRecentErrors(limit: number = 20): Promise<MonitoringErrorLog[]> {
    try {
      const response = await this.supabaseHttpClient.get(`/monitoring_error_logs`, {
        params: {
          select: '*',
          order: 'timestamp.desc',
          limit,
        },
      });

      return (response.data || []).map((row: any) => ({
        messageId: row.message_id,
        timestamp: Number(row.timestamp), // timestamp 已经是 bigint
        error: row.error,
        alertType: row.alert_type,
      }));
    } catch (error) {
      this.logger.error('查询错误日志失败:', error);
      return [];
    }
  }

  /**
   * 按时间范围查询错误日志
   */
  async getErrorLogsByTimeRange(range: TimeRange): Promise<MonitoringErrorLog[]> {
    try {
      const cutoff = this.getTimeRangeCutoff(range);
      const cutoffTimestamp = cutoff.getTime(); // 转换为 Unix 毫秒时间戳

      const response = await this.supabaseHttpClient.get(`/monitoring_error_logs`, {
        params: {
          select: '*',
          timestamp: `gte.${cutoffTimestamp}`,
          order: 'timestamp.desc',
        },
      });

      return (response.data || []).map((row: any) => ({
        messageId: row.message_id,
        timestamp: Number(row.timestamp), // timestamp 已经是 bigint
        error: row.error,
        alertType: row.alert_type,
      }));
    } catch (error) {
      this.logger.error(`查询错误日志失败 [${range}]:`, error);
      return [];
    }
  }

  /**
   * TODO: 删除过期错误日志
   */
  async deleteExpiredErrors(_daysToKeep: number = 30): Promise<void> {
    this.logger.warn('deleteExpiredErrors 未实现，跳过删除');
  }

  // ========================================
  // 每日统计（DailyStats）- TODO: 需要实现
  // ========================================

  /**
   * 保存每日统计（UPSERT）
   */
  async saveDailyStats(stats: DailyStats): Promise<void> {
    try {
      const statsRecord = {
        date: stats.date,
        message_count: stats.messageCount,
        success_count: stats.successCount,
        avg_duration: stats.avgDuration,
        token_usage: stats.tokenUsage,
        unique_users: stats.uniqueUsers,
      };

      await this.supabaseHttpClient.post(`/monitoring_daily_stats`, statsRecord, {
        headers: {
          Prefer: 'resolution=merge-duplicates',
        },
      });

      this.logger.log(`每日统计已保存: ${stats.date}`);
    } catch (error) {
      this.logger.error(`保存每日统计失败 [${stats.date}]:`, error);
    }
  }

  /**
   * TODO: 查询最近 N 天的统计
   */
  async getDailyStats(_days: number = 30): Promise<DailyStats[]> {
    this.logger.warn('getDailyStats 未实现，返回空数组');
    return [];
  }

  // ========================================
  // 用户活跃数据（TODO: 需要实现）
  // ========================================

  /**
   * TODO: 保存/更新用户活跃记录
   */
  async upsertUserActivity(_data: {
    chatId: string;
    odId: string;
    odName: string;
    groupId?: string;
    groupName?: string;
    messageCount?: number;
    tokenUsage?: number;
    activeAt?: number;
  }): Promise<void> {
    this.logger.warn('upsertUserActivity 未实现，跳过保存');
  }

  /**
   * TODO: 保存消息处理记录（已通过 SupabaseService 实现，这里是兼容层）
   */
  async saveMessageProcessingRecord(record: any): Promise<void> {
    // 委托给 SupabaseService
    await this.supabaseService.saveMessageProcessingRecord(record);
  }

  /**
   * 获取今日活跃用户
   */
  async getTodayActiveUsers(): Promise<any[]> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartISO = todayStart.toISOString();

    try {
      const response = await this.supabaseHttpClient.get<any[]>('/message_processing_records', {
        params: {
          select: 'user_id,user_name,chat_id,received_at,token_usage,status',
          and: `(received_at.gte.${todayStartISO},status.eq.success)`,
          order: 'received_at.asc',
        },
      });

      if (!response.data || response.data.length === 0) {
        return [];
      }

      // 按 user_id 聚合数据
      const userMap = new Map<
        string,
        {
          userId: string;
          userName: string;
          chatId: string;
          messageCount: number;
          tokenUsage: number;
          firstActiveAt: number;
          lastActiveAt: number;
        }
      >();

      for (const row of response.data) {
        const userId = row.user_id;
        if (!userId) continue;

        const receivedAt = new Date(row.received_at).getTime();
        const tokenUsage = row.token_usage || 0;

        if (!userMap.has(userId)) {
          userMap.set(userId, {
            userId,
            userName: row.user_name || '',
            chatId: row.chat_id,
            messageCount: 1,
            tokenUsage,
            firstActiveAt: receivedAt,
            lastActiveAt: receivedAt,
          });
        } else {
          const user = userMap.get(userId)!;
          user.messageCount++;
          user.tokenUsage += tokenUsage;
          user.lastActiveAt = Math.max(user.lastActiveAt, receivedAt);
        }
      }

      return Array.from(userMap.values());
    } catch (error) {
      this.logger.error('获取今日活跃用户失败:', error);
      return [];
    }
  }

  /**
   * 获取指定日期的活跃用户
   */
  async getActiveUsersByDate(date: string): Promise<any[]> {
    try {
      // 验证日期格式 (YYYY-MM-DD)
      const datePattern = /^\d{4}-\d{2}-\d{2}$/;
      if (!datePattern.test(date)) {
        this.logger.warn(`无效的日期格式 [${date}]，应为 YYYY-MM-DD`);
        return [];
      }

      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);

      const startISO = startDate.toISOString();
      const endISO = endDate.toISOString();

      const response = await this.supabaseHttpClient.get<any[]>('/message_processing_records', {
        params: {
          select: 'user_id,user_name,chat_id,received_at,token_usage,status',
          and: `(received_at.gte.${startISO},received_at.lte.${endISO},status.eq.success)`,
          order: 'received_at.asc',
        },
      });

      if (!response.data || response.data.length === 0) {
        return [];
      }

      // 按 user_id 聚合数据
      const userMap = new Map<
        string,
        {
          userId: string;
          userName: string;
          chatId: string;
          messageCount: number;
          tokenUsage: number;
          firstActiveAt: number;
          lastActiveAt: number;
        }
      >();

      for (const row of response.data) {
        const userId = row.user_id;
        if (!userId) continue;

        const receivedAt = new Date(row.received_at).getTime();
        const tokenUsage = row.token_usage || 0;

        if (!userMap.has(userId)) {
          userMap.set(userId, {
            userId,
            userName: row.user_name || '',
            chatId: row.chat_id,
            messageCount: 1,
            tokenUsage,
            firstActiveAt: receivedAt,
            lastActiveAt: receivedAt,
          });
        } else {
          const user = userMap.get(userId)!;
          user.messageCount++;
          user.tokenUsage += tokenUsage;
          user.lastActiveAt = Math.max(user.lastActiveAt, receivedAt);
        }
      }

      return Array.from(userMap.values());
    } catch (error) {
      this.logger.error(`获取指定日期活跃用户失败 [${date}]:`, error);
      return [];
    }
  }

  /**
   * 获取用户托管状态（占位实现）
   * TODO: 需要对接托管平台 API
   */
  async getUserHostingStatus(_chatId: string): Promise<{ isPaused: boolean }> {
    // 占位实现，返回默认未暂停
    // 实际应该调用托管平台 API 查询
    return { isPaused: false };
  }

  /**
   * 获取每日用户统计
   */
  async getDailyUserStats(startDate: Date, endDate: Date): Promise<any[]> {
    try {
      const startISO = startDate.toISOString();
      const endISO = endDate.toISOString();

      // 查询时间范围内的所有成功消息
      const response = await this.supabaseHttpClient.get<any[]>('/message_processing_records', {
        params: {
          select: 'user_id,received_at,token_usage',
          and: `(received_at.gte.${startISO},received_at.lte.${endISO},status.eq.success)`,
          order: 'received_at.asc',
        },
      });

      if (!response.data || response.data.length === 0) {
        return [];
      }

      // 按日期聚合用户数据
      const dailyStats = new Map<
        string,
        {
          date: string;
          uniqueUsers: Set<string>;
          messageCount: number;
          tokenUsage: number;
        }
      >();

      for (const row of response.data) {
        const receivedDate = new Date(row.received_at);
        const dateKey = receivedDate.toISOString().split('T')[0]; // YYYY-MM-DD

        if (!dailyStats.has(dateKey)) {
          dailyStats.set(dateKey, {
            date: dateKey,
            uniqueUsers: new Set(),
            messageCount: 0,
            tokenUsage: 0,
          });
        }

        const stats = dailyStats.get(dateKey)!;
        if (row.user_id) {
          stats.uniqueUsers.add(row.user_id);
        }
        stats.messageCount++;
        stats.tokenUsage += row.token_usage || 0;
      }

      // 转换为数组格式
      return Array.from(dailyStats.values()).map((stats) => ({
        date: stats.date,
        uniqueUsers: stats.uniqueUsers.size,
        messageCount: stats.messageCount,
        tokenUsage: stats.tokenUsage,
      }));
    } catch (error) {
      this.logger.error('获取每日用户统计失败:', error);
      return [];
    }
  }

  // ========================================
  // 辅助方法
  // ========================================

  /**
   * 根据时间范围获取截止时间
   */
  private getTimeRangeCutoff(range: TimeRange): Date {
    const now = new Date();
    switch (range) {
      case 'today':
        now.setHours(0, 0, 0, 0);
        return now;
      case 'week':
        now.setDate(now.getDate() - 7);
        return now;
      case 'month':
        now.setDate(now.getDate() - 30);
        return now;
      default:
        return now;
    }
  }
}
