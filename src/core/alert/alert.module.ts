import { Module, Global } from '@nestjs/common';
import { AlertService } from './alert.service';

/**
 * 告警模块（简化版）
 *
 * 只提供一个 AlertService，负责：
 * - 发送告警到飞书
 * - 简单节流（5 分钟内同类错误最多 3 次）
 */
@Global()
@Module({
  providers: [AlertService],
  exports: [AlertService],
})
export class AlertModule {}
