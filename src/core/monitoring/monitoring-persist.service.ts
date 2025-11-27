import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from '@core/supabase';
import { MonitoringService } from './monitoring.service';

/**
 * 监控聚合数据
 */
export interface MonitoringHourlyData {
  hour: string; // ISO 格式时间
  message_count: number;
  success_count: number;
  failure_count: number;
  avg_duration: number;
  p95_duration: number;
  active_users: number;
  active_chats: number;
  total_tokens: number;
}

/**
 * 监控数据持久化服务
 *
 * 职责:
 * - 每小时将监控聚合数据同步到 Supabase
 * - 保留 30 天历史数据
 * - 支持历史趋势查询
 *
 * 成本优化:
 * - 每小时仅 1 次写入，每天 24 条记录
 * - 30 天数据 < 1 KB 存储
 */
@Injectable()
export class MonitoringPersistService implements OnModuleInit {
  private readonly logger = new Logger(MonitoringPersistService.name);

  private readonly enabled: boolean;
  private readonly RETENTION_DAYS = 30;
  private readonly CHAT_RETENTION_DAYS = 60; // 聊天记录保留 60 天
  private readonly TABLE_NAME = 'monitoring_hourly';

  constructor(
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
    private readonly monitoringService: MonitoringService,
  ) {
    // 检查是否启用持久化
    const enabledConfig = this.configService.get<string>('MONITORING_PERSIST_ENABLED');
    this.enabled = enabledConfig !== 'false' && this.supabaseService.isAvailable();
  }

  async onModuleInit(): Promise<void> {
    if (this.enabled) {
      this.logger.log('✅ 监控数据持久化服务已启动 (每小时同步到 Supabase)');
    } else {
      this.logger.warn('⚠️ 监控数据持久化服务已禁用 (Supabase 不可用或配置禁用)');
    }
  }

  /**
   * 每小时整点执行聚合数据同步
   * 例如: 10:00, 11:00, 12:00...
   */
  @Cron(CronExpression.EVERY_HOUR)
  async syncHourlyData(): Promise<void> {
    if (!this.enabled) {
      return;
    }

    try {
      const hourlyData = this.buildHourlyData();
      await this.saveToSupabase(hourlyData);
      this.logger.log(`[监控持久化] 小时聚合数据已同步: ${hourlyData.hour}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[监控持久化] 同步失败: ${message}`);
    }
  }

  /**
   * 每天凌晨 3 点清理过期数据
   * - 监控数据：保留 30 天
   * - 聊天消息：保留 90 天
   */
  @Cron('0 3 * * *')
  async cleanupExpiredData(): Promise<void> {
    // 1. 清理监控数据（无论服务是否启用都执行）
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.RETENTION_DAYS);

      const deletedCount = await this.deleteOldRecords(cutoffDate);
      if (deletedCount > 0) {
        this.logger.log(
          `[监控持久化] 已清理 ${deletedCount} 条过期监控数据 (${this.RETENTION_DAYS} 天前)`,
        );
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[监控持久化] 清理监控数据失败: ${message}`);
    }

    // 2. 清理聊天消息（保留 90 天，防止超出 Supabase 免费额度）
    try {
      const deletedChatMessages = await this.supabaseService.cleanupChatMessages(
        this.CHAT_RETENTION_DAYS,
      );
      if (deletedChatMessages > 0) {
        this.logger.log(
          `[聊天清理] 已清理 ${deletedChatMessages} 条过期聊天消息 (${this.CHAT_RETENTION_DAYS} 天前)`,
        );
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[聊天清理] 清理聊天消息失败: ${message}`);
    }
  }

  /**
   * 构建当前小时的聚合数据
   */
  private buildHourlyData(): MonitoringHourlyData {
    const metrics = this.monitoringService.getMetricsData();
    const now = new Date();
    now.setMinutes(0, 0, 0); // 对齐到小时整点

    // 获取当前小时的统计
    const hourKey = now.toISOString();
    const hourlyStats = metrics.hourlyStats.find((s) => s.hour === hourKey);

    // 计算总 token 使用量（从详细记录中累加）
    const currentHourRecords = metrics.detailRecords.filter((r) => {
      const recordHour = new Date(r.receivedAt);
      recordHour.setMinutes(0, 0, 0);
      return recordHour.toISOString() === hourKey;
    });

    const totalTokens = currentHourRecords.reduce((sum, r) => sum + (r.tokenUsage || 0), 0);

    return {
      hour: hourKey,
      message_count: hourlyStats?.messageCount ?? 0,
      success_count: hourlyStats?.successCount ?? 0,
      failure_count: hourlyStats?.failureCount ?? 0,
      avg_duration: hourlyStats?.avgDuration ?? 0,
      p95_duration: hourlyStats?.p95Duration ?? 0,
      active_users: hourlyStats?.activeUsers ?? 0,
      active_chats: hourlyStats?.activeChats ?? 0,
      total_tokens: totalTokens,
    };
  }

  /**
   * 保存数据到 Supabase
   */
  private async saveToSupabase(data: MonitoringHourlyData): Promise<void> {
    // 使用 SupabaseService 的 HTTP 客户端
    // 由于 SupabaseService 没有暴露通用的 upsert 方法，我们直接调用 RPC 或使用 REST API
    // 这里通过在 SupabaseService 中添加新方法来实现

    await this.supabaseService.upsertMonitoringHourly(data);
  }

  /**
   * 删除过期记录
   */
  private async deleteOldRecords(cutoffDate: Date): Promise<number> {
    return this.supabaseService.deleteMonitoringHourlyBefore(cutoffDate);
  }

  /**
   * 获取历史数据（供 Dashboard 使用）
   */
  async getHistoricalData(days: number = 7): Promise<MonitoringHourlyData[]> {
    if (!this.enabled) {
      return [];
    }

    return this.supabaseService.getMonitoringHourlyHistory(days);
  }

  /**
   * 手动触发同步（用于测试或管理）
   */
  async triggerSync(): Promise<MonitoringHourlyData> {
    const hourlyData = this.buildHourlyData();

    if (this.enabled) {
      await this.saveToSupabase(hourlyData);
      this.logger.log(`[监控持久化] 手动同步完成: ${hourlyData.hour}`);
    }

    return hourlyData;
  }
}
