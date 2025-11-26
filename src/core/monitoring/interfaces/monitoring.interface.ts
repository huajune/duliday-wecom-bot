import { ScenarioType } from '@agent';

/**
 * 告警错误类型（简化版）
 */
export type AlertErrorType = 'agent' | 'message' | 'delivery' | 'system' | 'merge' | 'unknown';

/**
 * 监控系统接口定义
 */

/**
 * 时间范围类型
 */
export type TimeRange = 'today' | 'week' | 'month';

export interface ToolUsageMetric {
  name: string;
  total: number;
  percentage: number; // 使用占比
}

export interface ScenarioUsageMetric {
  name: string;
  total: number;
  percentage: number;
}

export interface MonitoringErrorLog {
  messageId: string;
  timestamp: number;
  error: string;
  alertType?: AlertErrorType;
}

export interface MonitoringGlobalCounters {
  totalMessages: number;
  totalSuccess: number;
  totalFailure: number;
  totalAiDuration: number;
  totalSendDuration: number;
  totalFallback: number; // 总降级次数
  totalFallbackSuccess: number; // 降级成功次数（用户无感知）
}

export interface MonitoringSnapshot {
  version: number;
  savedAt: number;
  detailRecords: MessageProcessingRecord[];
  hourlyStats: HourlyStats[];
  errorLogs: MonitoringErrorLog[];
  globalCounters: MonitoringGlobalCounters;
  activeUsers: string[];
  activeChats: string[];
  currentProcessing: number;
  peakProcessing: number;
}

export interface ResponseMinuteTrendPoint {
  minute: string;
  avgDuration: number;
  messageCount: number;
  successRate: number;
}

export interface AlertTrendPoint {
  minute: string;
  count: number;
}

/**
 * 每日统计数据
 */
export interface DailyStats {
  date: string; // "2025-11-21"
  tokenUsage: number; // 当日 token 消耗
  uniqueUsers: number; // 当日咨询人头数（去重）
  messageCount: number; // 消息数
  successCount: number; // 成功数
  avgDuration: number; // 平均响应时间
}

/**
 * 今日咨询用户
 */
export interface TodayUser {
  odId: string;
  odName: string;
  groupId?: string; // 小组 ID（可选）
  groupName?: string; // 小组名称（可选）
  chatId: string;
  messageCount: number;
  tokenUsage: number;
  firstActiveAt: number; // 首次活跃时间
  lastActiveAt: number; // 最后活跃时间
  isPaused: boolean; // 是否暂停托管
}

export interface BusinessMetricTrendPoint {
  minute: string;
  consultations: number; // 咨询人数
  bookingAttempts: number; // 预约尝试次数
  successfulBookings: number; // 成功预约次数
  conversionRate: number; // 转化率 (%)
  bookingSuccessRate: number; // 预约成功率 (%)
}

/**
 * Agent 响应消息部分
 */
export interface AgentMessagePart {
  type: 'text';
  text: string;
}

/**
 * Agent 响应消息
 */
export interface AgentResponseMessage {
  role: 'user' | 'assistant' | 'system';
  parts: AgentMessagePart[];
}

/**
 * 完整 Agent 响应结构（对应 ChatResponse）
 */
export interface RawAgentResponse {
  // 完整消息数组（保留原始结构）
  messages: AgentResponseMessage[];
  // Token 使用统计
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedInputTokens?: number;
  };
  // 工具使用情况
  tools: {
    used: string[];
    skipped: string[];
  };
  // 是否降级响应
  isFallback?: boolean;
  // 降级原因
  fallbackReason?: string;
}

export interface MonitoringMetadata {
  scenario?: ScenarioType;
  tools?: string[];
  tokenUsage?: number;
  replyPreview?: string;
  replySegments?: number;
  isFallback?: boolean;
  alertType?: AlertErrorType;
  // 完整 Agent 响应（新结构）
  rawAgentResponse?: RawAgentResponse;
}

/**
 * 消息处理记录
 */
export interface MessageProcessingRecord {
  messageId: string;
  chatId: string;
  userId?: string;
  userName?: string;
  managerName?: string;
  scenario?: ScenarioType;

  // 时间戳
  receivedAt: number; // 收到消息时间
  aiStartAt?: number; // AI 开始处理时间
  aiEndAt?: number; // AI 完成处理时间
  sendStartAt?: number; // 开始发送消息时间
  sendEndAt?: number; // 完成发送消息时间

  // 耗时（毫秒）
  totalDuration?: number; // 总耗时
  aiDuration?: number; // AI 处理耗时
  sendDuration?: number; // 消息发送耗时
  queueDuration?: number; // 排队耗时（AI 开始前）

  // 状态
  status: 'processing' | 'success' | 'failure';
  error?: string;
  isFallback?: boolean; // 是否使用了降级
  fallbackSuccess?: boolean; // 降级是否成功（用户无感知）

  // 消息内容（用于调试）
  messagePreview?: string; // 消息预览（前50字符）
  replyPreview?: string; // AI 回复预览
  tokenUsage?: number; // Token 使用
  tools?: string[]; // 使用的工具
  replySegments?: number; // 实际发送的回复条数
  alertType?: AlertErrorType;

  // 完整 Agent 响应（用于排障）
  rawAgentResponse?: RawAgentResponse;
}
export interface AlertTypeMetric {
  type: AlertErrorType | 'unknown';
  count: number;
  percentage: number;
}

/**
 * 小时级别聚合统计
 */
export interface HourlyStats {
  hour: string; // 小时标识，如 "2025-01-15T10:00:00Z"

  // 消息统计
  messageCount: number;
  successCount: number;
  failureCount: number;
  successRate: number; // 成功率（百分比）

  // 耗时统计
  avgDuration: number; // 平均耗时
  minDuration: number; // 最小耗时
  maxDuration: number; // 最大耗时
  p50Duration: number; // P50 百分位
  p95Duration: number; // P95 百分位
  p99Duration: number; // P99 百分位

  avgAiDuration: number; // 平均 AI 处理耗时
  avgSendDuration: number; // 平均发送耗时

  // 活跃度
  activeUsers: number; // 活跃用户数
  activeChats: number; // 活跃会话数
}

/**
 * 仪表盘数据
 */
export interface DashboardData {
  timeRange: TimeRange; // 当前时间范围
  lastWindowHours: number;

  // 总览
  overview: {
    totalMessages: number;
    successCount: number;
    failureCount: number;
    successRate: number;
    avgDuration: number;
    activeUsers: number;
    activeChats: number;
  };

  overviewDelta: {
    totalMessages: number;
    successRate: number;
    avgDuration: number;
    activeUsers: number;
  };

  // 降级统计（NEW）
  fallback: {
    totalCount: number; // 总降级次数
    successCount: number; // 降级成功次数
    successRate: number; // 降级成功率
    affectedUsers: number; // 影响用户数
  };

  fallbackDelta: {
    totalCount: number; // 降级次数增长
    successRate: number; // 降级成功率变化
  };

  // 业务指标（NEW）
  business: {
    consultations: {
      total: number; // 总咨询人数
      new: number; // 新增咨询人数（时间范围内）
    };
    bookings: {
      attempts: number; // 预约尝试次数
      successful: number; // 成功预约次数
      failed: number; // 失败预约次数
      successRate: number; // 成功率 (%)
    };
    conversion: {
      consultationToBooking: number; // 咨询到预约转化率 (%)
    };
  };

  businessDelta: {
    consultations: number; // 咨询人数增长
    bookingAttempts: number; // 预约次数增长
    bookingSuccessRate: number; // 预约成功率变化
  };

  usage: {
    tools: ToolUsageMetric[];
    scenarios: ScenarioUsageMetric[];
  };

  queue: {
    currentProcessing: number;
    peakProcessing: number;
    avgQueueDuration: number;
  };

  alertsSummary: {
    total: number;
    last24Hours: number;
    byType: AlertTypeMetric[];
  };

  // 趋势数据
  trends: {
    hourly: HourlyStats[];
    previous?: HourlyStats[];
  };

  responseTrend: ResponseMinuteTrendPoint[];
  alertTrend: AlertTrendPoint[];
  businessTrend: BusinessMetricTrendPoint[];

  // 每日统计趋势
  dailyTrend: DailyStats[];

  // 今日用户列表
  todayUsers: TodayUser[];

  // 最近消息（最新50条）
  recentMessages: MessageProcessingRecord[];

  // 错误日志（最新20条）
  recentErrors: MonitoringErrorLog[];

  // 实时状态
  realtime: {
    processingCount: number; // 当前处理中的消息数
    lastMessageTime?: number; // 最后一条消息时间
  };
}

/**
 * 详细指标数据
 */
export interface MetricsData {
  // 详细记录
  detailRecords: MessageProcessingRecord[];

  // 聚合统计
  hourlyStats: HourlyStats[];

  // 全局计数器
  globalCounters: MonitoringGlobalCounters;

  // 百分位统计（全量）
  percentiles: {
    p50: number;
    p95: number;
    p99: number;
    p999: number;
  };

  // 最慢记录
  slowestRecords: MessageProcessingRecord[];

  // 最近5分钟告警数
  recentAlertCount: number;
}
