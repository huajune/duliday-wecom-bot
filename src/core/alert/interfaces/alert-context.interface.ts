import { AlertErrorType } from '../types';
import { AlertSeverity } from './alert-config.interface';
import { ScenarioType } from '@agent';

/**
 * 告警上下文（统一告警入口参数）
 */
export interface AlertContext {
  // 基础信息
  errorType: AlertErrorType;
  error: any; // 原始错误对象
  severity?: AlertSeverity; // 可选，会自动判断

  // 业务上下文
  conversationId: string;
  userMessage?: string;
  scenario?: ScenarioType;
  channel?: string; // 如: wecom, feishu, etc.
  contactName?: string;

  // 技术细节
  apiEndpoint?: string;
  statusCode?: number | string;
  errorCode?: string;
  duration?: number; // 请求耗时（毫秒）

  // 扩展信息
  fallbackMessage?: string; // 降级话术
  fallbackSuccess?: boolean; // 降级是否成功（用户是否看到错误）
  requestParams?: any; // 请求参数
  apiKey?: string; // API Key（会自动脱敏）
  requestHeaders?: Record<string, any>;

  // 监控元数据
  metadata?: {
    tools?: string[];
    tokenUsage?: number;
    duration?: number;
    isFallback?: boolean;
  };

  // 告警控制（可选）
  forceSkipThrottle?: boolean; // 强制跳过限流
  customRecipients?: string[]; // 自定义接收人
}

/**
 * 告警处理结果
 */
export interface AlertResult {
  sent: boolean; // 是否发送
  skipped: boolean; // 是否跳过
  reason?: string; // 跳过原因（如: 静默中、限流中）
  channels: {
    // 各渠道发送结果
    channel: string;
    success: boolean;
    error?: string;
  }[];
  throttleState?: {
    // 限流状态
    aggregatedCount: number;
    windowEndsAt: number;
  };
}

/**
 * 业务指标告警上下文
 */
export interface MetricAlertContext {
  metricName: string; // 指标名称（如: successRate, avgDuration）
  currentValue: number; // 当前值
  threshold: number; // 阈值
  severity: AlertSeverity; // 严重程度
  timeWindow?: string; // 时间窗口（如: 最近1小时）
  unit?: string; // 单位（如: %, ms, 条, 次/小时）
  additionalInfo?: Record<string, any>; // 附加信息
}
