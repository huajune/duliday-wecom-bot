import { Injectable } from '@nestjs/common';
import { BaseRepository } from './base.repository';
import { SupabaseService } from '../supabase.service';

/**
 * 监控小时聚合数据
 */
export interface MonitoringHourlyData {
  hour: string;
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
 * Dashboard 概览统计
 */
export interface DashboardOverviewStats {
  totalMessages: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgDuration: number;
  activeUsers: number;
  activeChats: number;
  totalTokenUsage: number;
}

/**
 * Dashboard 降级统计
 */
export interface DashboardFallbackStats {
  totalCount: number;
  successCount: number;
  successRate: number;
  affectedUsers: number;
}

/**
 * 每日趋势数据
 */
export interface DailyTrendData {
  date: string;
  messageCount: number;
  successCount: number;
  avgDuration: number;
  tokenUsage: number;
  uniqueUsers: number;
}

/**
 * 小时趋势数据
 */
export interface HourlyTrendData {
  hour: string;
  messageCount: number;
  successCount: number;
  avgDuration: number;
  tokenUsage: number;
  uniqueUsers: number;
}

/**
 * 监控数据 Repository
 *
 * 负责管理 monitoring_hourly 表和 Dashboard 统计：
 * - 监控小时聚合数据
 * - Dashboard 概览统计
 * - 趋势数据查询
 */
@Injectable()
export class MonitoringRepository extends BaseRepository {
  protected readonly tableName = 'monitoring_hourly';

  constructor(supabaseService: SupabaseService) {
    super(supabaseService);
  }

  // ==================== 监控数据持久化 ====================

  /**
   * 插入或更新监控小时聚合数据
   */
  async upsertMonitoringHourly(data: MonitoringHourlyData): Promise<void> {
    if (!this.isAvailable()) {
      this.logger.warn('Supabase 未初始化，跳过监控数据持久化');
      return;
    }

    try {
      await this.insert(data, { resolution: 'merge-duplicates' });
      this.logger.debug(`监控数据已保存: ${data.hour}`);
    } catch (error) {
      this.logger.error('保存监控数据失败', error);
      throw error;
    }
  }

  /**
   * 删除指定日期之前的监控数据
   */
  async deleteMonitoringHourlyBefore(cutoffDate: Date): Promise<number> {
    if (!this.isAvailable()) {
      return 0;
    }

    try {
      const deleted = await this.delete<MonitoringHourlyData>(
        { hour: `lt.${cutoffDate.toISOString()}` },
        true,
      );
      return deleted.length;
    } catch (error) {
      this.logger.error('删除过期监控数据失败', error);
      return 0;
    }
  }

  /**
   * 获取最近 N 天的监控历史数据
   */
  async getMonitoringHourlyHistory(days: number = 7): Promise<MonitoringHourlyData[]> {
    if (!this.isAvailable()) {
      return [];
    }

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      return await this.select<MonitoringHourlyData>({
        hour: `gte.${cutoffDate.toISOString()}`,
        order: 'hour.desc',
        select: '*',
      });
    } catch (error) {
      this.logger.error('获取监控历史数据失败', error);
      return [];
    }
  }

  // ==================== Dashboard 统计 ====================

  /**
   * 获取 Dashboard 概览统计
   */
  async getDashboardOverviewStats(startDate: Date, endDate: Date): Promise<DashboardOverviewStats> {
    const defaultResult: DashboardOverviewStats = {
      totalMessages: 0,
      successCount: 0,
      failureCount: 0,
      successRate: 0,
      avgDuration: 0,
      activeUsers: 0,
      activeChats: 0,
      totalTokenUsage: 0,
    };

    if (!this.isAvailable()) {
      return defaultResult;
    }

    try {
      const result = await this.rpc<
        Array<{
          total_messages: string;
          success_count: string;
          failure_count: string;
          success_rate: string;
          avg_duration: string;
          active_users: string;
          active_chats: string;
          total_token_usage: string;
        }>
      >('get_dashboard_overview_stats', {
        p_start_date: startDate.toISOString(),
        p_end_date: endDate.toISOString(),
      });

      if (!result || result.length === 0) {
        return defaultResult;
      }

      const stats = result[0];
      return {
        totalMessages: parseInt(stats.total_messages ?? '0', 10),
        successCount: parseInt(stats.success_count ?? '0', 10),
        failureCount: parseInt(stats.failure_count ?? '0', 10),
        successRate: parseFloat(stats.success_rate ?? '0'),
        avgDuration: parseFloat(stats.avg_duration ?? '0'),
        activeUsers: parseInt(stats.active_users ?? '0', 10),
        activeChats: parseInt(stats.active_chats ?? '0', 10),
        totalTokenUsage: parseInt(stats.total_token_usage ?? '0', 10),
      };
    } catch (error) {
      this.logger.error('获取 Dashboard 概览统计失败:', error);
      return defaultResult;
    }
  }

  /**
   * 获取 Dashboard 降级统计
   */
  async getDashboardFallbackStats(startDate: Date, endDate: Date): Promise<DashboardFallbackStats> {
    const defaultResult: DashboardFallbackStats = {
      totalCount: 0,
      successCount: 0,
      successRate: 0,
      affectedUsers: 0,
    };

    if (!this.isAvailable()) {
      return defaultResult;
    }

    try {
      const result = await this.rpc<
        Array<{
          fallback_total: string;
          fallback_success: string;
          fallback_success_rate: string;
          fallback_affected_users: string;
        }>
      >('get_dashboard_fallback_stats', {
        p_start_date: startDate.toISOString(),
        p_end_date: endDate.toISOString(),
      });

      if (!result || result.length === 0) {
        return defaultResult;
      }

      const stats = result[0];
      return {
        totalCount: parseInt(stats.fallback_total ?? '0', 10),
        successCount: parseInt(stats.fallback_success ?? '0', 10),
        successRate: parseFloat(stats.fallback_success_rate ?? '0'),
        affectedUsers: parseInt(stats.fallback_affected_users ?? '0', 10),
      };
    } catch (error) {
      this.logger.error('获取 Dashboard 降级统计失败:', error);
      return defaultResult;
    }
  }

  /**
   * 获取 Dashboard 每日趋势
   */
  async getDashboardDailyTrend(startDate: Date, endDate: Date): Promise<DailyTrendData[]> {
    if (!this.isAvailable()) {
      return [];
    }

    try {
      const result = await this.rpc<
        Array<{
          date: string;
          message_count: string;
          success_count: string;
          avg_duration: string;
          token_usage: string;
          unique_users: string;
        }>
      >('get_dashboard_daily_trend', {
        p_start_date: startDate.toISOString(),
        p_end_date: endDate.toISOString(),
      });

      if (!result) {
        return [];
      }

      return result.map((item) => ({
        date: item.date,
        messageCount: parseInt(item.message_count ?? '0', 10),
        successCount: parseInt(item.success_count ?? '0', 10),
        avgDuration: parseFloat(item.avg_duration ?? '0'),
        tokenUsage: parseInt(item.token_usage ?? '0', 10),
        uniqueUsers: parseInt(item.unique_users ?? '0', 10),
      }));
    } catch (error) {
      this.logger.error('获取 Dashboard 每日趋势失败:', error);
      return [];
    }
  }

  /**
   * 获取 Dashboard 小时级趋势
   */
  async getDashboardHourlyTrend(startDate: Date, endDate: Date): Promise<HourlyTrendData[]> {
    if (!this.isAvailable()) {
      return [];
    }

    try {
      const result = await this.rpc<
        Array<{
          hour: string;
          message_count: string;
          success_count: string;
          avg_duration: string;
          token_usage: string;
          unique_users: string;
        }>
      >('get_dashboard_hourly_trend', {
        p_start_date: startDate.toISOString(),
        p_end_date: endDate.toISOString(),
      });

      if (!result) {
        return [];
      }

      return result.map((item) => ({
        hour: item.hour,
        messageCount: parseInt(item.message_count ?? '0', 10),
        successCount: parseInt(item.success_count ?? '0', 10),
        avgDuration: parseFloat(item.avg_duration ?? '0'),
        tokenUsage: parseInt(item.token_usage ?? '0', 10),
        uniqueUsers: parseInt(item.unique_users ?? '0', 10),
      }));
    } catch (error) {
      this.logger.error('获取 Dashboard 小时趋势失败:', error);
      return [];
    }
  }

  /**
   * 获取 Dashboard 分钟级趋势
   */
  async getDashboardMinuteTrend(
    startDate: Date,
    endDate: Date,
    intervalMinutes: number = 5,
  ): Promise<
    Array<{
      minute: string;
      messageCount: number;
      successCount: number;
      avgDuration: number;
      uniqueUsers: number;
    }>
  > {
    if (!this.isAvailable()) {
      return [];
    }

    try {
      const result = await this.rpc<
        Array<{
          minute: string;
          message_count: string;
          success_count: string;
          avg_duration: string;
          unique_users: string;
        }>
      >('get_dashboard_minute_trend', {
        p_start_date: startDate.toISOString(),
        p_end_date: endDate.toISOString(),
        p_interval_minutes: intervalMinutes,
      });

      if (!result) {
        return [];
      }

      return result.map((item) => ({
        minute: item.minute,
        messageCount: parseInt(item.message_count ?? '0', 10),
        successCount: parseInt(item.success_count ?? '0', 10),
        avgDuration: parseFloat(item.avg_duration ?? '0'),
        uniqueUsers: parseInt(item.unique_users ?? '0', 10),
      }));
    } catch (error) {
      this.logger.error('获取 Dashboard 分钟趋势失败:', error);
      return [];
    }
  }

  /**
   * 获取 Dashboard 场景统计
   */
  async getDashboardScenarioStats(
    startDate: Date,
    endDate: Date,
  ): Promise<
    Array<{
      scenario: string;
      count: number;
      successCount: number;
      avgDuration: number;
    }>
  > {
    if (!this.isAvailable()) {
      return [];
    }

    try {
      const result = await this.rpc<
        Array<{
          scenario: string;
          count: string;
          success_count: string;
          avg_duration: string;
        }>
      >('get_dashboard_scenario_stats', {
        p_start_date: startDate.toISOString(),
        p_end_date: endDate.toISOString(),
      });

      if (!result) {
        return [];
      }

      return result.map((item) => ({
        scenario: item.scenario ?? 'unknown',
        count: parseInt(item.count ?? '0', 10),
        successCount: parseInt(item.success_count ?? '0', 10),
        avgDuration: parseFloat(item.avg_duration ?? '0'),
      }));
    } catch (error) {
      this.logger.error('获取 Dashboard 场景统计失败:', error);
      return [];
    }
  }

  /**
   * 获取 Dashboard 工具统计
   */
  async getDashboardToolStats(
    startDate: Date,
    endDate: Date,
  ): Promise<
    Array<{
      toolName: string;
      useCount: number;
    }>
  > {
    if (!this.isAvailable()) {
      return [];
    }

    try {
      const result = await this.rpc<
        Array<{
          tool_name: string;
          use_count: string;
        }>
      >('get_dashboard_tool_stats', {
        p_start_date: startDate.toISOString(),
        p_end_date: endDate.toISOString(),
      });

      if (!result) {
        return [];
      }

      return result.map((item) => ({
        toolName: item.tool_name ?? 'unknown',
        useCount: parseInt(item.use_count ?? '0', 10),
      }));
    } catch (error) {
      this.logger.error('获取 Dashboard 工具统计失败:', error);
      return [];
    }
  }
}
