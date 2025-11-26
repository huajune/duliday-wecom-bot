import { Module, Global, forwardRef } from '@nestjs/common';
import { AlertService } from './alert.service';
import { AlertController } from './alert.controller';
import { SupabaseModule } from '@core/supabase';
import { MonitoringModule } from '@core/monitoring/monitoring.module';

/**
 * 告警模块（简化版）
 *
 * 只提供一个 AlertService，负责：
 * - 发送告警到飞书
 * - 简单节流（动态配置，默认 5 分钟内同类错误最多 3 次）
 *
 * AlertController 提供测试端点，用于验证告警系统是否正常工作
 */
@Global()
@Module({
  imports: [SupabaseModule, forwardRef(() => MonitoringModule)],
  controllers: [AlertController],
  providers: [AlertService],
  exports: [AlertService],
})
export class AlertModule {}
