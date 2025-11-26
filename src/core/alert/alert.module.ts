import { Module, Global } from '@nestjs/common';
import { AlertService } from './alert.service';
import { SupabaseModule } from '@core/supabase';

/**
 * 告警模块（简化版）
 *
 * 只提供一个 AlertService，负责：
 * - 发送告警到飞书
 * - 简单节流（动态配置，默认 5 分钟内同类错误最多 3 次）
 */
@Global()
@Module({
  imports: [SupabaseModule],
  providers: [AlertService],
  exports: [AlertService],
})
export class AlertModule {}
