import { Module, Global, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MonitoringService } from './monitoring.service';
import { MonitoringController } from './monitoring.controller';
import { DashboardController } from './dashboard.controller';
import { MonitoringSnapshotService } from './monitoring-snapshot.service';
import { MonitoringAlertService } from './monitoring-alert.service';
import { DataCleanupService } from './data-cleanup.service';
import { MessageModule } from '@wecom/message/message.module';

/**
 * 监控模块
 * 全局模块，可在整个应用中使用
 *
 * 服务说明:
 * - MonitoringService: 核心监控数据收集与统计
 * - MonitoringSnapshotService: 实时快照存储 (Redis，允许丢失)
 * - DataCleanupService: 定期清理过期数据 (聊天消息、历史监控数据)
 * - MonitoringAlertService: 业务指标主动告警
 *
 * 存储策略:
 * - Redis: 实时监控数据（detailRecords, hourlyStats 等），服务重启后允许丢失
 * - Supabase: 仅用于聊天消息存储，不再持久化监控数据
 */
@Global()
@Module({
  imports: [
    ScheduleModule.forRoot(), // 启用定时任务
    forwardRef(() => MessageModule),
  ],
  controllers: [MonitoringController, DashboardController],
  providers: [
    MonitoringService,
    MonitoringSnapshotService,
    DataCleanupService, // 定期清理过期数据
    MonitoringAlertService, // 业务指标告警
  ],
  exports: [
    MonitoringService,
    MonitoringAlertService,
    MonitoringSnapshotService,
    DataCleanupService,
  ],
})
export class MonitoringModule {}
