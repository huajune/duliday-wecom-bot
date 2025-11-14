import { ScenarioType } from '@agent';

/**
 * 监控系统接口定义
 */

export interface ToolUsageMetric {
  name: string;
  total: number;
  failureCount: number;
  failureRate: number;
  lastUsedAt: number;
}

export interface ScenarioUsageMetric {
  name: string;
  total: number;
  percentage: number;
}

export interface MonitoringMetadata {
  scenario?: ScenarioType;
  tools?: string[];
  tokenUsage?: number;
  replyPreview?: string;
  isFallback?: boolean;
}

/**
 * 消息处理记录
 */
export interface MessageProcessingRecord {
  messageId: string;
  chatId: string;
  userId?: string;
  userName?: string;
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
  isFallback?: boolean;

  // 消息内容（用于调试）
  messagePreview?: string; // 消息预览（前50字符）
  replyPreview?: string; // AI 回复预览
  tokenUsage?: number; // Token 使用
  tools?: string[]; // 使用的工具
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
  };

  // 趋势数据
  trends: {
    hourly: HourlyStats[];
    previous?: HourlyStats[];
  };

  // 最近消息（最新50条）
  recentMessages: MessageProcessingRecord[];

  // 错误日志（最新20条）
  recentErrors: Array<{
    messageId: string;
    timestamp: number;
    error: string;
  }>;

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
  globalCounters: {
    totalMessages: number;
    totalSuccess: number;
    totalFailure: number;
    totalAiDuration: number;
    totalSendDuration: number;
  };

  // 百分位统计（全量）
  percentiles: {
    p50: number;
    p95: number;
    p99: number;
    p999: number;
  };

  // 最慢记录
  slowestRecords: MessageProcessingRecord[];
}
