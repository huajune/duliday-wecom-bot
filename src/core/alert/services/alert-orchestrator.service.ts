import { Injectable, Logger } from '@nestjs/common';
import {
  AlertContext,
  AlertResult,
  MetricAlertContext,
} from '../interfaces/alert-context.interface';
import { AlertSeverity } from '../interfaces/alert-config.interface';
import { AlertConfigService } from './alert-config.service';
import { AlertSeverityService } from './alert-severity.service';
import { AlertThrottleService } from './alert-throttle.service';
import { AlertRecoveryService } from './alert-recovery.service';
import { AlertSilenceService } from './alert-silence.service';
import { FeiShuAlertService } from '../feishu-alert.service';

/**
 * 告警编排器服务（核心）
 * 统一告警入口，协调各个子服务完成告警流程
 *
 * 处理流程：
 * 1. 判断严重程度 (AlertSeverityService)
 * 2. 检查是否静默 (AlertSilenceService)
 * 3. 检查是否限流 (AlertThrottleService)
 * 4. 记录恢复状态 (AlertRecoveryService)
 * 5. 发送到各渠道 (FeiShuAlertService, ...)
 */
@Injectable()
export class AlertOrchestratorService {
  private readonly logger = new Logger(AlertOrchestratorService.name);

  constructor(
    private readonly configService: AlertConfigService,
    private readonly severityService: AlertSeverityService,
    private readonly throttleService: AlertThrottleService,
    private readonly recoveryService: AlertRecoveryService,
    private readonly silenceService: AlertSilenceService,
    private readonly feiShuAlertService: FeiShuAlertService,
  ) {}

  /**
   * 发送告警（统一入口）
   * @param context 告警上下文
   * @returns 处理结果
   */
  async sendAlert(context: AlertContext): Promise<AlertResult> {
    try {
      // 0. 检查全局开关
      if (!this.configService.isEnabled()) {
        this.logger.debug('告警系统已全局禁用');
        return {
          sent: false,
          skipped: true,
          reason: 'globally-disabled',
          channels: [],
        };
      }

      // 1. 判断严重程度
      const severity = this.severityService.determineSeverity(context);
      this.logger.debug(`告警严重程度: ${severity}`);

      // 2. 检查是否静默
      if (this.silenceService.isSilenced(context.errorType, context.scenario)) {
        const silenceInfo = this.silenceService.getSilenceInfo(context.errorType, context.scenario);
        const remaining = this.silenceService.getRemainingTime(context.errorType, context.scenario);

        this.logger.warn(
          `告警已静默 [${context.errorType}${context.scenario ? `:${context.scenario}` : ''}]: ` +
            `reason="${silenceInfo?.reason}", remaining=${remaining}s`,
        );

        return {
          sent: false,
          skipped: true,
          reason: `silenced-${remaining}s-remaining`,
          channels: [],
        };
      }

      // 3. 记录到恢复服务（用于后续恢复检测）
      this.recoveryService.recordFailure(context);

      // 4. 检查限流
      const throttleResult = this.throttleService.shouldSendAlert(context);

      if (!throttleResult.shouldSend) {
        this.logger.debug(`告警被限流: ${throttleResult.reason}`);
        return {
          sent: false,
          skipped: true,
          reason: throttleResult.reason,
          channels: [],
          throttleState: throttleResult.state
            ? {
                aggregatedCount: throttleResult.state.count,
                windowEndsAt:
                  throttleResult.state.lastSent + this.configService.getDefaultThrottle().windowMs,
              }
            : undefined,
        };
      }

      // 5. 发送到告警渠道
      const channelResults = await this.sendToChannels(context, severity, throttleResult.state);

      // 6. 构造返回结果
      const sent = channelResults.some((r) => r.success);

      if (sent) {
        this.logger.log(
          `告警已发送 [${context.errorType}]: severity=${severity}, reason=${throttleResult.reason}`,
        );
      }

      return {
        sent,
        skipped: !sent,
        reason: sent ? throttleResult.reason : 'all-channels-failed',
        channels: channelResults,
        throttleState: throttleResult.state
          ? {
              aggregatedCount: throttleResult.state.count,
              windowEndsAt:
                throttleResult.state.lastSent + this.configService.getDefaultThrottle().windowMs,
            }
          : undefined,
      };
    } catch (error) {
      this.logger.error(`告警发送失败: ${error.message}`, error.stack);
      return {
        sent: false,
        skipped: true,
        reason: `orchestrator-error: ${error.message}`,
        channels: [],
      };
    }
  }

  /**
   * 发送恢复通知
   * @param recoveryKey 恢复键（如: agent, agent:job_search）
   * @param context 可选的额外上下文
   */
  async sendRecoveryNotification(
    recoveryKey: string,
    _context?: Partial<AlertContext>,
  ): Promise<void> {
    try {
      const recoveryState = this.recoveryService.getRecoveryState(recoveryKey);
      if (!recoveryState || !recoveryState.isRecovered) {
        this.logger.warn(`无效的恢复键或未恢复: ${recoveryKey}`);
        return;
      }

      const durationSeconds = Math.floor((Date.now() - recoveryState.startTime) / 1000);
      const durationMinutes = Math.floor(durationSeconds / 60);

      const message =
        `**恢复时间**: ${new Date().toLocaleString('zh-CN')}\n` +
        `**故障时长**: ${durationMinutes} 分钟 (${durationSeconds} 秒)\n` +
        `**故障期间失败次数**: ${recoveryState.failureCount}\n` +
        `**恢复判定**: 连续成功 ${recoveryState.consecutiveSuccess} 次`;

      await this.feiShuAlertService.sendAlert(`✅ 告警已恢复 [${recoveryKey}]`, message, 'info');

      // 清除恢复状态
      this.recoveryService.clearRecoveryState(recoveryKey);

      this.logger.log(`恢复通知已发送 [${recoveryKey}]: 故障时长=${durationMinutes}分钟`);
    } catch (error) {
      this.logger.error(`恢复通知发送失败: ${error.message}`, error.stack);
    }
  }

  /**
   * 发送业务指标告警
   * @param context 业务指标告警上下文
   */
  async sendMetricAlert(context: MetricAlertContext): Promise<void> {
    try {
      const icon = this.severityService.getSeverityIcon(context.severity);
      const severityLabel = this.severityService.getSeverityLabel(context.severity);

      // 格式化数值和单位
      const { currentValueText, thresholdText } = this.formatMetricValue(context);

      const message =
        `**指标名称**: ${context.metricName}\n` +
        `**当前值**: ${currentValueText}\n` +
        `**阈值**: ${thresholdText}\n` +
        `**严重程度**: ${severityLabel}\n` +
        (context.timeWindow ? `**时间窗口**: ${context.timeWindow}\n` : '') +
        (context.additionalInfo
          ? `\n**附加信息**:\n${JSON.stringify(context.additionalInfo, null, 2)}`
          : '');

      await this.feiShuAlertService.sendAlert(
        `${icon} 业务指标告警: ${context.metricName}`,
        message,
        context.severity === AlertSeverity.CRITICAL || context.severity === AlertSeverity.ERROR
          ? 'error'
          : 'warning',
      );

      this.logger.log(
        `业务指标告警已发送: ${context.metricName}=${currentValueText} (阈值: ${thresholdText})`,
      );
    } catch (error) {
      this.logger.error(`业务指标告警发送失败: ${error.message}`, error.stack);
    }
  }

  /**
   * 格式化业务指标数值和单位
   */
  private formatMetricValue(context: MetricAlertContext): {
    currentValueText: string;
    thresholdText: string;
    unit: string;
  } {
    let unit = context.unit || '';
    let currentValue = context.currentValue;
    let thresholdValue = context.threshold;

    // 如果没有指定单位，根据指标名称自动识别
    if (!unit) {
      const metricNameLower = context.metricName.toLowerCase();

      // 成功率 - 百分比
      if (metricNameLower.includes('成功率') || metricNameLower.includes('success')) {
        unit = '%';
      }
      // 响应时间 - 毫秒转秒
      else if (
        metricNameLower.includes('响应时间') ||
        metricNameLower.includes('duration') ||
        metricNameLower.includes('延迟') ||
        metricNameLower.includes('latency')
      ) {
        // 将毫秒转换为秒
        currentValue = currentValue / 1000;
        thresholdValue = thresholdValue / 1000;
        unit = '秒';
      }
      // 队列深度 - 条数
      else if (
        metricNameLower.includes('队列') ||
        metricNameLower.includes('queue') ||
        metricNameLower.includes('积压')
      ) {
        unit = '条';
      }
      // 错误率 - 次/小时
      else if (metricNameLower.includes('错误率') || metricNameLower.includes('error rate')) {
        unit = '次/小时';
      }
    }

    // 格式化数值（保留2位小数）
    const formatNumber = (val: number): string => {
      // 如果是整数，不显示小数位
      if (Number.isInteger(val)) {
        return val.toString();
      }
      // 否则保留2位小数
      return val.toFixed(2);
    };

    const currentValueText = `${formatNumber(currentValue)}${unit}`;
    const thresholdText = `${formatNumber(thresholdValue)}${unit}`;

    return { currentValueText, thresholdText, unit };
  }

  /**
   * 发送到各个告警渠道
   */
  private async sendToChannels(
    context: AlertContext,
    severity: AlertSeverity,
    throttleState?: any,
  ): Promise<Array<{ channel: string; success: boolean; error?: string }>> {
    const results: Array<{ channel: string; success: boolean; error?: string }> = [];

    // 飞书渠道
    try {
      const isAggregated = throttleState && throttleState.count > 1;

      await this.feiShuAlertService.sendAgentApiFailureAlert(
        context.error,
        context.conversationId,
        context.userMessage || '无用户消息',
        context.apiEndpoint || '/unknown',
        {
          errorType: context.errorType,
          fallbackMessage: context.fallbackMessage,
          scenario: context.scenario,
          channel: context.channel,
          contactName: context.contactName,
          requestParams: context.requestParams,
          apiKey: context.apiKey,
          requestHeaders: context.requestHeaders,
          // 传递严重程度和聚合信息
          severity,
          aggregatedCount: isAggregated ? throttleState.count : undefined,
          aggregatedErrors: isAggregated ? throttleState.aggregatedErrors : undefined,
          aggregatedTimeWindow: isAggregated
            ? {
                start: new Date(throttleState.firstSeen).toLocaleString('zh-CN'),
                end: new Date(throttleState.lastSeen).toLocaleString('zh-CN'),
              }
            : undefined,
        },
      );

      results.push({ channel: 'feishu', success: true });
    } catch (error) {
      this.logger.error(`飞书告警发送失败: ${error.message}`);
      results.push({ channel: 'feishu', success: false, error: error.message });
    }

    // 这里可以扩展其他渠道（邮件、短信等）
    // ...

    return results;
  }
}
