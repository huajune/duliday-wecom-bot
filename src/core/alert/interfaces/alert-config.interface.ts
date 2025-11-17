import { AlertErrorType } from '../types';

/**
 * 告警严重程度
 */
export enum AlertSeverity {
  INFO = 'info', // 蓝色 - 信息通知
  WARNING = 'warning', // 橙色 - 需要关注
  ERROR = 'error', // 红色 - 需要处理
  CRITICAL = 'critical', // 紫色 - 紧急处理
}

/**
 * 告警渠道类型
 */
export enum AlertChannel {
  FEISHU = 'feishu',
  EMAIL = 'email',
  SMS = 'sms',
}

/**
 * 告警规则匹配条件
 */
export interface AlertRuleMatch {
  errorType?: AlertErrorType | AlertErrorType[];
  errorCode?: string; // 支持正则，如 "401|403"
  scenario?: string | string[];
  severity?: AlertSeverity;
}

/**
 * 告警限流配置
 */
export interface AlertThrottleConfig {
  enabled: boolean;
  windowMs: number; // 限流窗口（毫秒）
  maxOccurrences?: number; // 窗口内最大允许次数（超过则聚合）
}

/**
 * 告警路由配置
 */
export interface AlertRoutingConfig {
  channels: AlertChannel[];
  recipients?: {
    feishu?: string[]; // 飞书群组ID
    email?: string[]; // 邮箱地址
    sms?: string[]; // 手机号
  };
}

/**
 * 告警规则
 */
export interface AlertRule {
  name: string;
  description?: string;
  enabled: boolean;
  match: AlertRuleMatch;
  severity: AlertSeverity;
  throttle?: AlertThrottleConfig;
  routing?: AlertRoutingConfig;
  silence?: {
    enabled: boolean;
    until?: number; // 静默截止时间（时间戳）
    reason?: string;
  };
}

/**
 * 业务指标阈值配置
 */
export interface MetricThreshold {
  warning: number;
  critical: number;
}

/**
 * 业务指标告警配置
 */
export interface MetricAlertConfig {
  successRate: MetricThreshold; // 成功率阈值（百分比）
  avgDuration: MetricThreshold; // 平均响应时间（毫秒）
  queueDepth: MetricThreshold; // 队列积压数量
  errorRate: MetricThreshold; // 每分钟错误数
}

/**
 * 告警配置（完整）
 */
export interface AlertConfig {
  enabled: boolean; // 全局告警开关
  metricAlertsEnabled?: boolean; // 业务指标告警开关（可选，默认 true）
  defaultSeverity: AlertSeverity; // 默认严重程度
  defaultThrottle: AlertThrottleConfig; // 默认限流配置
  rules: AlertRule[]; // 告警规则列表
  metrics: MetricAlertConfig; // 业务指标告警配置
}

/**
 * 告警限流状态
 */
export interface ThrottleState {
  key: string; // 限流键
  count: number; // 聚合计数
  firstSeen: number; // 首次发生时间
  lastSeen: number; // 最后发生时间
  lastSent: number; // 最后发送时间
  aggregatedErrors?: string[]; // 聚合的错误信息（最多保留10条）
}

/**
 * 告警恢复状态
 */
export interface RecoveryState {
  key: string; // 告警键
  startTime: number; // 故障开始时间
  failureCount: number; // 故障期间失败次数
  consecutiveSuccess: number; // 连续成功次数
  isRecovered: boolean; // 是否已恢复
}
