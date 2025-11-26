// 监控数据类型定义

export interface Overview {
  totalMessages: number;
  successCount: number;
  successRate: number;
  avgDuration: number;
  activeUsers: number;
  activeChats: number;
}

export interface OverviewDelta {
  totalMessages: number;
  successRate: number;
  avgDuration: number;
  activeUsers: number;
}

export interface QueueInfo {
  currentProcessing: number;
  peakProcessing: number;
  avgQueueDuration: number;
}

export interface AlertSummary {
  total: number;
  last24Hours: number;
  byType: AlertTypeItem[];
}

export interface AlertTypeItem {
  type: string;
  count: number;
  percentage: number;
}

export interface FallbackStats {
  totalCount: number;
  successCount: number;
  successRate: number;
}

export interface BusinessMetrics {
  consultations: {
    total: number;
    new: number;
  };
  bookings: {
    attempts: number;
    successful: number;
    failed: number;
    successRate: number;
  };
  conversion: {
    consultationToBooking: number;
  };
}

export interface TrendPoint {
  minute: string;
  avgDuration?: number;
  count?: number;
  consultations?: number;
  bookingAttempts?: number;
  bookingSuccessRate?: number;
}

export interface DailyTrendPoint {
  date: string;
  tokenUsage: number;
  uniqueUsers: number;
}

export interface MessageRecord {
  messageId?: string;
  receivedAt: string;
  userName?: string;
  chatId: string;
  messagePreview?: string;
  replyPreview?: string; // 完整的 Agent 响应内容
  totalDuration: number;
  aiDuration?: number;
  sendDuration?: number;
  queueDuration?: number;
  replySegments?: number;
  status: 'success' | 'failed' | 'failure' | 'processing';
  error?: string;
  scenario?: string;
  tools?: string[];
  tokenUsage?: number;
  isFallback?: boolean;
  fallbackSuccess?: boolean;
  // 完整 Agent 响应（用于排障）
  rawAgentResponse?: {
    content: string;
    usage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
    tools?: {
      used: string[];
      skipped: string[];
    };
    isFallback?: boolean;
    fallbackReason?: string;
  };
}

export interface TodayUser {
  chatId: string;
  odId: string;
  odName?: string;
  groupName?: string;
  messageCount: number;
  tokenUsage: number;
  firstActiveAt: string;
  lastActiveAt: string;
  isPaused: boolean;
}

export interface BlacklistItem {
  groupId: string;
  reason?: string;
  addedAt: string;
}

export interface BlacklistData {
  chatIds: string[];
  groupIds: string[];
}

export interface UserInfo {
  chatId: string;
  userName?: string;
  messageCount: number;
  lastActiveAt?: string;
  hostingEnabled: boolean;
}

export interface DashboardData {
  timeRange: 'today' | 'week' | 'month';
  overview: Overview;
  overviewDelta: OverviewDelta;
  queue: QueueInfo;
  alertsSummary: AlertSummary;
  fallback: FallbackStats;
  fallbackDelta: { totalCount: number };
  business: BusinessMetrics;
  businessDelta: {
    consultations: number;
    bookingAttempts: number;
    bookingSuccessRate: number;
  };
  responseTrend: TrendPoint[];
  alertTrend: TrendPoint[];
  businessTrend: TrendPoint[];
  dailyTrend: DailyTrendPoint[];
  recentMessages: MessageRecord[];
  todayUsers: TodayUser[];
}

export interface MetricsData {
  percentiles: {
    p50: number;
    p95: number;
    p99: number;
  };
  slowestRecords: MessageRecord[];
  pendingMessages: number;
  processingMessages: number;
  todayAlerts: number;
  weekAlerts: number;
  unhandledAlerts: number;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  message: string;
  models: {
    availableCount: number;
    configuredCount: number;
    configuredAvailable: boolean;
    allConfiguredModelsAvailable: boolean;
  };
  tools: {
    availableCount: number;
    configuredCount: number;
    allAvailable: boolean;
  };
  brandConfig: {
    available: boolean;
    synced: boolean;
    lastUpdated?: string;
  };
}

export interface SystemInfo {
  uptime: number;
  startTime: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  pid: number;
  cwd: string;
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  cpu: {
    usage: number;
    cores: number;
  };
}

/**
 * Agent 回复策略配置
 */
export interface AgentReplyConfig {
  // 消息聚合配置
  initialMergeWindowMs: number; // 首次聚合等待时间（毫秒）
  maxMergedMessages: number; // 最多聚合消息数

  // 打字延迟配置
  typingDelayPerCharMs: number; // 每字符延迟（毫秒）
  paragraphGapMs: number; // 段落间隔（毫秒）

  // 告警节流配置
  alertThrottleWindowMs: number; // 告警节流窗口（毫秒）
  alertThrottleMaxCount: number; // 窗口内最大告警次数

  // 业务指标告警配置（简化版）
  businessAlertEnabled: boolean; // 是否启用业务指标告警
  minSamplesForAlert: number; // 最小样本量（低于此值不检查）
  alertIntervalMinutes: number; // 同类告警最小间隔（分钟）
}

export interface AgentReplyConfigResponse {
  config: AgentReplyConfig;
  defaults: AgentReplyConfig;
}

/**
 * Worker 状态
 */
export interface WorkerStatus {
  concurrency: number;
  activeJobs: number;
  minConcurrency: number;
  maxConcurrency: number;
}

/**
 * Worker 并发数更新响应
 */
export interface WorkerConcurrencyResponse {
  success: boolean;
  message: string;
  previousConcurrency: number;
  currentConcurrency: number;
}
