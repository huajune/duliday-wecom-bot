import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { MonitoringModule } from '@core/monitoring/monitoring.module';
import { MessageModule } from '@wecom/message/message.module';
import { FeishuBitableSyncService } from './feishu-bitable-sync.service';
import { ChatRecordSyncService } from './chat-record-sync.service';
import { FeishuSyncController } from './feishu-sync.controller';
import { FeishuSyncTestController } from './feishu-sync-test.controller';

/**
 * 飞书同步模块
 * 职责：将聊天记录同步到飞书表格
 * - FeishuBitableSyncService: 从监控快照同步（旧方式，保留用于监控数据同步）
 * - ChatRecordSyncService: 从 Redis 聊天记录同步（新方式，完整聊天记录）
 */
@Module({
  imports: [
    ScheduleModule.forRoot(), // 定时任务
    ConfigModule,
    MonitoringModule, // 获取监控快照（旧同步服务使用）
    MessageModule, // 获取聊天记录服务（新同步服务使用）
  ],
  controllers: [FeishuSyncController, FeishuSyncTestController],
  providers: [FeishuBitableSyncService, ChatRecordSyncService],
  exports: [ChatRecordSyncService], // 导出以便其他模块手动触发同步
})
export class FeishuSyncModule {}
