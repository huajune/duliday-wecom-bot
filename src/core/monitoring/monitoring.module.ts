import { Module, Global, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MonitoringService } from './monitoring.service';
import { MonitoringController } from './monitoring.controller';
import { DashboardController } from './dashboard.controller';
import { MonitoringSnapshotService } from './monitoring-snapshot.service';
import { MonitoringAlertService } from './monitoring-alert.service';
import { MonitoringPersistService } from './monitoring-persist.service';
import { MessageModule } from '@wecom/message/message.module';

/**
 * 监控模块
 * 全局模块，可在整个应用中使用
 *
 * 服务说明:
 * - MonitoringService: 核心监控数据收集与统计
 * - MonitoringSnapshotService: 实时快照存储 (Redis)
 * - MonitoringPersistService: 小时聚合数据持久化 (Supabase)
 * - MonitoringAlertService: 业务指标主动告警
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
    MonitoringPersistService, // 每小时同步到 Supabase
    MonitoringAlertService, // 业务指标告警
  ],
  exports: [
    MonitoringService,
    MonitoringAlertService,
    MonitoringSnapshotService,
    MonitoringPersistService,
  ],
})
export class MonitoringModule {}
