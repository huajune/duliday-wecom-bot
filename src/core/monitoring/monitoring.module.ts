import { Module, Global, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MonitoringService } from './monitoring.service';
import { MonitoringController } from './monitoring.controller';
import { MonitoringSnapshotService } from './monitoring-snapshot.service';
import { MonitoringAlertService } from './monitoring-alert.service';
import { MessageModule } from '@wecom/message/message.module';

/**
 * 监控模块
 * 全局模块，可在整个应用中使用
 * 包含业务指标主动告警功能
 */
@Global()
@Module({
  imports: [
    ScheduleModule.forRoot(), // 启用定时任务
    forwardRef(() => MessageModule),
  ],
  controllers: [MonitoringController],
  providers: [
    MonitoringService,
    MonitoringSnapshotService,
    MonitoringAlertService, // 业务指标告警
  ],
  exports: [MonitoringService, MonitoringAlertService],
})
export class MonitoringModule {}
