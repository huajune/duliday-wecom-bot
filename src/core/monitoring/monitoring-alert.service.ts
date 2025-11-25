import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MonitoringService } from './monitoring.service';
import { AlertService } from '../alert/alert.service';

/**
 * 监控告警服务（简化版）
 *
 * 定期检查业务指标，发现异常时主动告警
 * 阈值硬编码，无需外部配置
 */
@Injectable()
export class MonitoringAlertService {
  private readonly logger = new Logger(MonitoringAlertService.name);

  // 告警阈值（硬编码）
  private readonly THRESHOLDS = {
    successRate: { warning: 90, critical: 80 }, // 百分比
    avgDuration: { warning: 5000, critical: 10000 }, // 毫秒
    queueDepth: { warning: 50, critical: 100 }, // 条数
    errorRate: { warning: 10, critical: 20 }, // 每小时错误数
  };

  // 状态追踪（避免重复告警）
  private lastAlertTimestamps = new Map<string, number>();
  private readonly MIN_ALERT_INTERVAL = 5 * 60 * 1000; // 最小告警间隔：5分钟

  constructor(
    private readonly monitoringService: MonitoringService,
    private readonly alertService: AlertService,
  ) {}

  /**
   * 每分钟检查一次业务指标
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async checkBusinessMetrics(): Promise<void> {
    try {
      const dashboard = this.monitoringService.getDashboardData();

      // 1. 成功率告警
      await this.checkSuccessRate(dashboard.overview.successRate);

      // 2. 响应时间告警
      await this.checkAvgDuration(dashboard.overview.avgDuration);

      // 3. 队列积压告警
      await this.checkQueueDepth(dashboard.queue.currentProcessing);

      // 4. 错误率告警
      await this.checkErrorRate(dashboard.alertsSummary.last24Hours);
    } catch (error) {
      this.logger.error(`业务指标检查失败: ${error.message}`);
    }
  }

  /**
   * 检查成功率
   */
  private async checkSuccessRate(currentValue: number): Promise<void> {
    const { warning, critical } = this.THRESHOLDS.successRate;
    const key = 'success-rate';

    if (currentValue < critical) {
      if (this.shouldSendAlert(key)) {
        await this.alertService.sendSimpleAlert(
          '成功率严重下降',
          `当前成功率: ${currentValue.toFixed(1)}%\n阈值: ${critical}%\n建议: 立即检查 Agent API 状态`,
          'critical',
        );
        this.recordAlertSent(key);
      }
    } else if (currentValue < warning) {
      if (this.shouldSendAlert(key)) {
        await this.alertService.sendSimpleAlert(
          '成功率下降',
          `当前成功率: ${currentValue.toFixed(1)}%\n阈值: ${warning}%`,
          'warning',
        );
        this.recordAlertSent(key);
      }
    }
  }

  /**
   * 检查响应时间
   */
  private async checkAvgDuration(currentValue: number): Promise<void> {
    const { warning, critical } = this.THRESHOLDS.avgDuration;
    const key = 'avg-duration';

    if (currentValue > critical) {
      if (this.shouldSendAlert(key)) {
        await this.alertService.sendSimpleAlert(
          '响应时间过长',
          `当前平均响应: ${(currentValue / 1000).toFixed(1)}秒\n阈值: ${critical / 1000}秒\n建议: 检查 Agent API 性能`,
          'critical',
        );
        this.recordAlertSent(key);
      }
    } else if (currentValue > warning) {
      if (this.shouldSendAlert(key)) {
        await this.alertService.sendSimpleAlert(
          '响应时间偏高',
          `当前平均响应: ${(currentValue / 1000).toFixed(1)}秒\n阈值: ${warning / 1000}秒`,
          'warning',
        );
        this.recordAlertSent(key);
      }
    }
  }

  /**
   * 检查队列深度
   */
  private async checkQueueDepth(currentValue: number): Promise<void> {
    const { warning, critical } = this.THRESHOLDS.queueDepth;
    const key = 'queue-depth';

    if (currentValue > critical) {
      if (this.shouldSendAlert(key)) {
        await this.alertService.sendSimpleAlert(
          '队列严重积压',
          `当前队列深度: ${currentValue}条\n阈值: ${critical}条\n建议: 检查消息处理速度`,
          'critical',
        );
        this.recordAlertSent(key);
      }
    } else if (currentValue > warning) {
      if (this.shouldSendAlert(key)) {
        await this.alertService.sendSimpleAlert(
          '队列积压',
          `当前队列深度: ${currentValue}条\n阈值: ${warning}条`,
          'warning',
        );
        this.recordAlertSent(key);
      }
    }
  }

  /**
   * 检查错误率
   */
  private async checkErrorRate(errorCount: number): Promise<void> {
    const { warning, critical } = this.THRESHOLDS.errorRate;
    const key = 'error-rate';

    // 将 24 小时错误数转换为每小时平均
    const hourlyRate = errorCount / 24;

    if (hourlyRate > critical) {
      if (this.shouldSendAlert(key)) {
        await this.alertService.sendSimpleAlert(
          '错误率过高',
          `24小时错误数: ${errorCount}次\n每小时平均: ${hourlyRate.toFixed(1)}次\n阈值: ${critical}次/小时`,
          'critical',
        );
        this.recordAlertSent(key);
      }
    } else if (hourlyRate > warning) {
      if (this.shouldSendAlert(key)) {
        await this.alertService.sendSimpleAlert(
          '错误率偏高',
          `24小时错误数: ${errorCount}次\n每小时平均: ${hourlyRate.toFixed(1)}次\n阈值: ${warning}次/小时`,
          'warning',
        );
        this.recordAlertSent(key);
      }
    }
  }

  /**
   * 检查是否应该发送告警（避免频繁告警）
   */
  private shouldSendAlert(key: string): boolean {
    const lastTime = this.lastAlertTimestamps.get(key);
    if (!lastTime) return true;
    return Date.now() - lastTime > this.MIN_ALERT_INTERVAL;
  }

  /**
   * 记录告警发送时间
   */
  private recordAlertSent(key: string): void {
    this.lastAlertTimestamps.set(key, Date.now());
  }
}
