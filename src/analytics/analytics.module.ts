import { Module } from '@nestjs/common';
import { MetricsModule } from './metrics/metrics.module';
import { ReportModule } from './report/report.module';
import { DashboardModule } from './dashboard/dashboard.module';

/**
 * 数据分析业务域模块（骨架）
 *
 * 负责系统运营数据的采集、分析和展示，包括：
 * - 指标统计 (Metrics)
 * - 报表生成 (Report)
 * - 监控仪表盘 (Dashboard)
 *
 * 数据存储：
 * - API 调用统计
 * - 会话日志
 * - 每日/每周/每月运营指标
 */
@Module({
  imports: [MetricsModule, ReportModule, DashboardModule],
  exports: [MetricsModule, ReportModule, DashboardModule],
})
export class AnalyticsModule {}
