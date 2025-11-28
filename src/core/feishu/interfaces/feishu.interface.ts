/**
 * 飞书相关接口定义
 */

/**
 * 飞书卡片消息颜色
 */
export type FeishuCardColor =
  | 'blue'
  | 'wathet'
  | 'turquoise'
  | 'green'
  | 'yellow'
  | 'orange'
  | 'red'
  | 'carmine'
  | 'violet'
  | 'purple'
  | 'indigo'
  | 'grey';

/**
 * 告警级别
 */
export enum AlertLevel {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
}

/**
 * 告警错误类型
 */
export enum AlertErrorType {
  AGENT_TIMEOUT = 'agent_timeout',
  AGENT_AUTH_ERROR = 'agent_auth_error',
  AGENT_RATE_LIMIT = 'agent_rate_limit',
  MESSAGE_DELIVERY_ERROR = 'message_delivery_error',
  SYSTEM_ERROR = 'system_error',
}

/**
 * 告警上下文（简化版，完整版在 feishu-alert.service.ts）
 */
export interface SimpleAlertContext {
  errorType: AlertErrorType;
  level?: AlertLevel;
  title?: string;
  message: string;
  details?: Record<string, unknown>;
  timestamp?: string;
}

/**
 * 面试预约信息
 */
export interface InterviewBookingInfo {
  candidateName?: string;
  chatId?: string;
  brandName?: string;
  storeName?: string;
  interviewTime?: string;
  contactInfo?: string;
  toolOutput?: Record<string, unknown>;
}

/**
 * 飞书 API 响应
 */
export interface FeishuApiResponse {
  code: number;
  msg?: string;
  data?: Record<string, unknown>;
}

/**
 * 飞书多维表格字段配置
 */
export interface BitableFieldConfig {
  field_name: string;
  type: number;
  property?: Record<string, unknown>;
}

/**
 * 飞书多维表格记录
 */
export interface BitableRecord {
  record_id?: string;
  fields: Record<string, unknown>;
}
