import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseService } from '@core/supabase';

/**
 * 数据清理服务
 *
 * 职责:
 * - 定期清理过期的聊天消息（Supabase）
 * - 定期清理过期的监控数据（Supabase，如有）
 *
 * 简化说明:
 * - 移除了每小时同步监控聚合数据到 Supabase 的功能
 * - 实时监控数据仅存储在 Redis，允许丢失（服务重启后从零开始）
 * - 保留定期清理功能，防止数据库膨胀
 */
@Injectable()
export class DataCleanupService implements OnModuleInit {
  private readonly logger = new Logger(DataCleanupService.name);

  private readonly CHAT_RETENTION_DAYS = 60; // 聊天记录保留 60 天
  private readonly MONITORING_RETENTION_DAYS = 30; // 监控数据保留 30 天（如有历史数据）

  constructor(private readonly supabaseService: SupabaseService) {}

  async onModuleInit(): Promise<void> {
    if (this.supabaseService.isAvailable()) {
      this.logger.log('✅ 数据清理服务已启动 (每日凌晨 3 点执行清理)');
    } else {
      this.logger.warn('⚠️ 数据清理服务已禁用 (Supabase 不可用)');
    }
  }

  /**
   * 每天凌晨 3 点清理过期数据
   * - 聊天消息：保留 60 天
   * - 监控历史数据：保留 30 天（如有）
   */
  @Cron('0 3 * * *')
  async cleanupExpiredData(): Promise<void> {
    if (!this.supabaseService.isAvailable()) {
      return;
    }

    // 1. 清理过期聊天消息
    await this.cleanupChatMessages();

    // 2. 清理过期监控历史数据（兼容旧数据）
    await this.cleanupMonitoringHistory();
  }

  /**
   * 清理过期聊天消息
   */
  private async cleanupChatMessages(): Promise<void> {
    try {
      const deletedCount = await this.supabaseService.cleanupChatMessages(this.CHAT_RETENTION_DAYS);
      if (deletedCount > 0) {
        this.logger.log(
          `[数据清理] 已清理 ${deletedCount} 条过期聊天消息 (${this.CHAT_RETENTION_DAYS} 天前)`,
        );
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[数据清理] 清理聊天消息失败: ${message}`);
    }
  }

  /**
   * 清理过期监控历史数据
   * 兼容可能存在的旧 monitoring_hourly 表数据
   */
  private async cleanupMonitoringHistory(): Promise<void> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.MONITORING_RETENTION_DAYS);

      const deletedCount = await this.supabaseService.deleteMonitoringHourlyBefore(cutoffDate);
      if (deletedCount > 0) {
        this.logger.log(
          `[数据清理] 已清理 ${deletedCount} 条过期监控数据 (${this.MONITORING_RETENTION_DAYS} 天前)`,
        );
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      // 如果表不存在或没有数据，不记录错误
      if (!message.includes('does not exist') && !message.includes('not found')) {
        this.logger.error(`[数据清理] 清理监控数据失败: ${message}`);
      }
    }
  }

  /**
   * 手动触发清理（用于测试或管理）
   */
  async triggerCleanup(): Promise<{ chatMessages: number; monitoringData: number }> {
    let chatMessages = 0;
    let monitoringData = 0;

    if (!this.supabaseService.isAvailable()) {
      this.logger.warn('[数据清理] Supabase 不可用，跳过清理');
      return { chatMessages, monitoringData };
    }

    try {
      chatMessages = await this.supabaseService.cleanupChatMessages(this.CHAT_RETENTION_DAYS);
    } catch {
      // ignore
    }

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.MONITORING_RETENTION_DAYS);
      monitoringData = await this.supabaseService.deleteMonitoringHourlyBefore(cutoffDate);
    } catch {
      // ignore
    }

    this.logger.log(
      `[数据清理] 手动清理完成: 聊天消息 ${chatMessages} 条, 监控数据 ${monitoringData} 条`,
    );

    return { chatMessages, monitoringData };
  }
}
