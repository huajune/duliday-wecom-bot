import { Module } from '@nestjs/common';
import { JobModule } from './job/job.module';
import { InterviewModule } from './interview/interview.module';
import { NotificationModule } from './notification/notification.module';
import { SyncModule } from './sync/sync.module';

/**
 * 海绵系统业务域模块（骨架）
 *
 * 负责与海绵系统集成的所有业务功能，包括：
 * - 职位信息同步和查询 (Job)
 * - 面试信息同步和管理 (Interview)
 * - 群通知发送 (Notification)
 * - 定时数据同步 (Sync)
 *
 * 数据策略：
 * - 海绵系统的业务数据（职位、面试等）存储在海绵系统中，本系统通过 API 调用获取
 * - 本系统仅存储：同步日志、通知日志等运营数据
 */
@Module({
  imports: [JobModule, InterviewModule, NotificationModule, SyncModule],
  exports: [JobModule, InterviewModule, NotificationModule, SyncModule],
})
export class SpongeModule {}
