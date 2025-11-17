import { Injectable, Logger } from '@nestjs/common';
import { AlertSeverity } from '../interfaces/alert-config.interface';
import { AlertContext } from '../interfaces/alert-context.interface';
import { AgentAuthException, AgentRateLimitException } from '@agent/utils/agent-exceptions';
import { AlertConfigService } from './alert-config.service';

/**
 * 告警严重程度判断服务
 * 根据错误类型、状态码、错误码等自动判断告警的严重程度
 */
@Injectable()
export class AlertSeverityService {
  private readonly logger = new Logger(AlertSeverityService.name);

  constructor(private readonly configService: AlertConfigService) {}

  /**
   * 判断告警严重程度
   * @param context 告警上下文
   * @returns 严重程度
   */
  determineSeverity(context: AlertContext): AlertSeverity {
    // 1. 如果已手动指定，直接使用
    if (context.severity) {
      return context.severity;
    }

    // 2. 尝试从配置规则匹配
    const matchedRule = this.configService.findMatchingRule({
      errorType: context.errorType,
      errorCode: context.errorCode || String(context.statusCode),
      scenario: context.scenario,
    });

    if (matchedRule) {
      this.logger.debug(`匹配到规则 "${matchedRule.name}", 严重程度: ${matchedRule.severity}`);
      return matchedRule.severity;
    }

    // 3. 基于错误类型自动判断
    return this.inferSeverityFromError(context);
  }

  /**
   * 根据错误信息推断严重程度
   */
  private inferSeverityFromError(context: AlertContext): AlertSeverity {
    const { error, statusCode, errorCode } = context;

    // 认证失败 - CRITICAL
    if (
      error instanceof AgentAuthException ||
      statusCode === 401 ||
      statusCode === 403 ||
      errorCode === '401' ||
      errorCode === '403'
    ) {
      return AlertSeverity.CRITICAL;
    }

    // 限流 - WARNING
    if (error instanceof AgentRateLimitException || statusCode === 429 || errorCode === '429') {
      return AlertSeverity.WARNING;
    }

    // 5xx 服务器错误 - ERROR
    if (typeof statusCode === 'number' && statusCode >= 500 && statusCode < 600) {
      return AlertSeverity.ERROR;
    }

    // 4xx 客户端错误（除了 401/403/429）- WARNING
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      return AlertSeverity.WARNING;
    }

    // 根据错误类型判断
    switch (context.errorType) {
      case 'agent':
        return AlertSeverity.ERROR; // Agent 错误默认 ERROR
      case 'message':
        return AlertSeverity.WARNING; // 消息处理错误默认 WARNING
      case 'delivery':
        return AlertSeverity.WARNING; // 发送失败默认 WARNING
      case 'merge':
        return AlertSeverity.WARNING; // 聚合失败默认 WARNING
      default:
        return this.configService.getDefaultSeverity();
    }
  }

  /**
   * 获取严重程度的颜色模板（飞书卡片）
   */
  getSeverityColorTemplate(severity: AlertSeverity): string {
    switch (severity) {
      case AlertSeverity.CRITICAL:
        return 'purple'; // 紫色 - 最严重
      case AlertSeverity.ERROR:
        return 'red'; // 红色 - 严重
      case AlertSeverity.WARNING:
        return 'orange'; // 橙色 - 警告
      case AlertSeverity.INFO:
        return 'blue'; // 蓝色 - 信息
      default:
        return 'blue';
    }
  }

  /**
   * 获取严重程度的图标
   */
  getSeverityIcon(severity: AlertSeverity): string {
    switch (severity) {
      case AlertSeverity.CRITICAL:
        return '🔴'; // 红圈 - 最严重
      case AlertSeverity.ERROR:
        return '🚨'; // 警报 - 严重
      case AlertSeverity.WARNING:
        return '⚠️'; // 警告标志
      case AlertSeverity.INFO:
        return 'ℹ️'; // 信息标志
      default:
        return '📢';
    }
  }

  /**
   * 获取严重程度的文本标签
   */
  getSeverityLabel(severity: AlertSeverity): string {
    switch (severity) {
      case AlertSeverity.CRITICAL:
        return 'CRITICAL';
      case AlertSeverity.ERROR:
        return 'ERROR';
      case AlertSeverity.WARNING:
        return 'WARNING';
      case AlertSeverity.INFO:
        return 'INFO';
      default:
        return 'UNKNOWN';
    }
  }
}
