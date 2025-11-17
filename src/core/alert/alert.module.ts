import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FeiShuAlertService } from './feishu-alert.service';
import { AlertController } from './alert.controller';
import { AlertConfigService } from './services/alert-config.service';
import { AlertSeverityService } from './services/alert-severity.service';
import { AlertThrottleService } from './services/alert-throttle.service';
import { AlertRecoveryService } from './services/alert-recovery.service';
import { AlertSilenceService } from './services/alert-silence.service';
import { AlertOrchestratorService } from './services/alert-orchestrator.service';

/**
 * 告警模块（全局）
 * 提供完整的告警体系：配置管理、严重程度判断、限流聚合、恢复检测、静默管理、告警编排
 *
 * @Global 装饰器使该模块成为全局模块，无需在每个模块中重复导入
 */
@Global()
@Module({
  imports: [ConfigModule],
  controllers: [AlertController],
  providers: [
    // 核心服务
    AlertConfigService,
    AlertSeverityService,
    AlertThrottleService,
    AlertRecoveryService,
    AlertSilenceService,
    AlertOrchestratorService,
    // 渠道服务
    FeiShuAlertService,
  ],
  exports: [
    AlertConfigService,
    AlertSeverityService,
    AlertThrottleService,
    AlertRecoveryService,
    AlertSilenceService,
    AlertOrchestratorService,
    FeiShuAlertService, // 保留兼容性
  ],
})
export class AlertModule {}
