import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { SupabaseModule } from '@core/supabase';
import { FeishuWebhookService } from './services/feishu-webhook.service';
import { FeishuAlertService } from './services/feishu-alert.service';
import { FeishuBookingService } from './services/feishu-booking.service';
import { FeishuBitableSyncService } from './services/feishu-bitable.service';
import { ChatRecordSyncService } from './services/feishu-chat-record.service';
import { FeishuController } from './feishu.controller';

/**
 * 飞书统一模块
 * 整合所有飞书相关功能：
 * - Webhook 通知（告警、预约等）
 * - 多维表格同步（聊天记录等）
 */
@Global() // 设为全局模块，其他模块可直接注入
@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
    SupabaseModule, // ChatRecordSyncService 直接依赖 SupabaseService，无需 MessageModule
  ],
  controllers: [FeishuController],
  providers: [
    FeishuWebhookService,
    FeishuAlertService,
    FeishuBookingService,
    FeishuBitableSyncService,
    ChatRecordSyncService, // 恢复：从 Supabase 同步聊天记录到飞书
  ],
  exports: [
    FeishuWebhookService,
    FeishuAlertService,
    FeishuBookingService,
    FeishuBitableSyncService,
    ChatRecordSyncService,
  ],
})
export class FeishuModule {}
