import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MonitoringService } from './monitoring.service';
import { AlertOrchestratorService } from '../alert/services/alert-orchestrator.service';
import { AlertConfigService } from '../alert/services/alert-config.service';
import { AlertSeverity } from '../alert/interfaces/alert-config.interface';

/**
 * 监控告警服务
 * 定期检查业务指标，发现异常时主动告警
 *
 * 监控指标：
 * 1. 成功率下降
 * 2. 平均响应时间过高
 * 3. 队列积压
 * 4. 错误率激增
 */
@Injectable()
export class MonitoringAlertService {
  private readonly logger = new Logger(MonitoringAlertService.name);

  // 状态追踪（避免重复告警）
  private lastAlertTimestamps = new Map<string, number>();
  private readonly MIN_ALERT_INTERVAL = 5 * 60 * 1000; // 最小告警间隔：5分钟

  constructor(
    private readonly monitoringService: MonitoringService,
    private readonly alertOrchestrator: AlertOrchestratorService,
    private readonly alertConfigService: AlertConfigService,
  ) {}

  /**
   * 每分钟检查一次业务指标
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async checkBusinessMetrics(): Promise<void> {
    try {
      const dashboard = this.monitoringService.getDashboardData();
      const config = this.alertConfigService.getMetricsConfig();

      // 1. 成功率告警
      await this.checkSuccessRate(dashboard.overview.successRate, config.successRate);

      // 2. 响应时间告警
      await this.checkAvgDuration(dashboard.overview.avgDuration, config.avgDuration);

      // 3. 队列积压告警
      await this.checkQueueDepth(dashboard.queue.currentProcessing, config.queueDepth);

      // 4. 错误率告警（每分钟）
      await this.checkErrorRate(dashboard.alertsSummary.last24Hours, config.errorRate);
    } catch (error) {
      this.logger.error(`业务指标检查失败: ${error.message}`, error.stack);
    }
  }

  /**
   * 检查成功率
   */
  private async checkSuccessRate(
    currentValue: number,
    threshold: { warning: number; critical: number },
  ): Promise<void> {
    const key = 'success-rate';

    // Critical: 成功率 < 80%
    if (currentValue < threshold.critical) {
      if (this.shouldSendAlert(key + '-critical')) {
        await this.alertOrchestrator.sendMetricAlert({
          metricName: '成功率严重下降',
          currentValue,
          threshold: threshold.critical,
          severity: AlertSeverity.CRITICAL,
          timeWindow: '当前',
          additionalInfo: {
            message: '成功率已降至临界值以下，大量用户受影响',
            suggestion: '立即检查 Agent API 状态、数据库连接、网络状况',
          },
        });
        this.recordAlertSent(key + '-critical');
      }
      return;
    }

    // Warning: 成功率 < 90%
    if (currentValue < threshold.warning) {
      if (this.shouldSendAlert(key + '-warning')) {
        await this.alertOrchestrator.sendMetricAlert({
          metricName: '成功率下降',
          currentValue,
          threshold: threshold.warning,
          severity: AlertSeverity.WARNING,
          timeWindow: '当前',
          additionalInfo: {
            message: '成功率低于预期，部分用户可能受影响',
            suggestion: '关注 Agent API 响应、查看错误日志',
          },
        });
        this.recordAlertSent(key + '-warning');
      }
    }
  }

  /**
   * 检查平均响应时间
   */
  private async checkAvgDuration(
    currentValue: number,
    threshold: { warning: number; critical: number },
  ): Promise<void> {
    const key = 'avg-duration';

    // Critical: >10秒
    if (currentValue > threshold.critical) {
      if (this.shouldSendAlert(key + '-critical')) {
        await this.alertOrchestrator.sendMetricAlert({
          metricName: '响应时间严重超时',
          currentValue,
          threshold: threshold.critical,
          severity: AlertSeverity.ERROR,
          timeWindow: '当前',
          additionalInfo: {
            message: '平均响应时间严重超标，用户体验极差',
            suggestion: '检查 Agent API 延迟、数据库慢查询、网络抖动',
          },
        });
        this.recordAlertSent(key + '-critical');
      }
      return;
    }

    // Warning: >5秒
    if (currentValue > threshold.warning) {
      if (this.shouldSendAlert(key + '-warning')) {
        await this.alertOrchestrator.sendMetricAlert({
          metricName: '响应时间过高',
          currentValue,
          threshold: threshold.warning,
          severity: AlertSeverity.WARNING,
          timeWindow: '当前',
          additionalInfo: {
            message: '响应时间较慢，用户可能感知延迟',
            suggestion: '关注 Agent API 性能、消息队列积压情况',
          },
        });
        this.recordAlertSent(key + '-warning');
      }
    }
  }

  /**
   * 检查队列积压
   */
  private async checkQueueDepth(
    currentValue: number,
    threshold: { warning: number; critical: number },
  ): Promise<void> {
    const key = 'queue-depth';

    // Critical: >100条
    if (currentValue > threshold.critical) {
      if (this.shouldSendAlert(key + '-critical')) {
        await this.alertOrchestrator.sendMetricAlert({
          metricName: '消息队列严重积压',
          currentValue,
          threshold: threshold.critical,
          severity: AlertSeverity.CRITICAL,
          timeWindow: '当前',
          additionalInfo: {
            message: '队列积压严重，可能导致消息处理延迟甚至丢失',
            suggestion: '考虑扩容、暂停接收新消息、检查处理瓶颈',
          },
        });
        this.recordAlertSent(key + '-critical');
      }
      return;
    }

    // Warning: >50条
    if (currentValue > threshold.warning) {
      if (this.shouldSendAlert(key + '-warning')) {
        await this.alertOrchestrator.sendMetricAlert({
          metricName: '消息队列积压',
          currentValue,
          threshold: threshold.warning,
          severity: AlertSeverity.WARNING,
          timeWindow: '当前',
          additionalInfo: {
            message: '队列开始积压，需要关注处理速度',
            suggestion: '检查 Agent API 响应时间、增加处理并发',
          },
        });
        this.recordAlertSent(key + '-warning');
      }
    }
  }

  /**
   * 检查错误率
   */
  private async checkErrorRate(
    errors24h: number,
    threshold: { warning: number; critical: number },
  ): Promise<void> {
    const key = 'error-rate';
    const errorsPerMinute = errors24h / (24 * 60); // 简化计算

    // Critical: >20/分钟
    if (errorsPerMinute > threshold.critical) {
      if (this.shouldSendAlert(key + '-critical')) {
        await this.alertOrchestrator.sendMetricAlert({
          metricName: '错误率激增',
          currentValue: parseFloat(errorsPerMinute.toFixed(2)),
          threshold: threshold.critical,
          severity: AlertSeverity.CRITICAL,
          timeWindow: '最近24小时平均',
          additionalInfo: {
            message: '错误频率异常高，系统可能存在严重问题',
            suggestion: '立即查看错误日志、检查 Agent API 状态',
            errors24h,
          },
        });
        this.recordAlertSent(key + '-critical');
      }
      return;
    }

    // Warning: >10/分钟
    if (errorsPerMinute > threshold.warning) {
      if (this.shouldSendAlert(key + '-warning')) {
        await this.alertOrchestrator.sendMetricAlert({
          metricName: '错误率偏高',
          currentValue: parseFloat(errorsPerMinute.toFixed(2)),
          threshold: threshold.warning,
          severity: AlertSeverity.WARNING,
          timeWindow: '最近24小时平均',
          additionalInfo: {
            message: '错误发生频率高于正常水平',
            suggestion: '查看错误类型分布、关注 Agent API 可用性',
            errors24h,
          },
        });
        this.recordAlertSent(key + '-warning');
      }
    }
  }

  /**
   * 判断是否应该发送告警（避免频繁告警）
   */
  private shouldSendAlert(key: string): boolean {
    const lastAlert = this.lastAlertTimestamps.get(key);
    if (!lastAlert) return true;

    const elapsed = Date.now() - lastAlert;
    return elapsed >= this.MIN_ALERT_INTERVAL;
  }

  /**
   * 记录告警发送时间
   */
  private recordAlertSent(key: string): void {
    this.lastAlertTimestamps.set(key, Date.now());
  }
}
