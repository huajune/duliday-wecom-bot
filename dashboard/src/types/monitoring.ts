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

/**
 * Agent 响应消息部分 - 文本类型
 */
export interface AgentTextPart {
  type: 'text';
  text: string;
  state?: 'done' | 'streaming';
}

/**
 * Agent 响应消息部分 - 动态工具类型
 */
export interface AgentDynamicToolPart {
  type: 'dynamic-tool';
  toolName: string;
  toolCallId: string;
  state: 'pending' | 'running' | 'output-available' | 'error';
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
}

/**
 * Agent 响应消息部分（联合类型）
 */
export type AgentMessagePart = AgentTextPart | AgentDynamicToolPart;

/**
 * Agent 响应消息
 */
export interface AgentResponseMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  parts: AgentMessagePart[];
}

/**
 * 简单消息结构（用于历史消息展示）
 */
export interface SimpleMessageItem {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Agent 调用输入参数（用于调试，去除品牌数据）
 */
export interface AgentInputParams {
  conversationId: string;
  userMessage: string;
  historyCount: number; // 历史消息数量
  historyMessages?: SimpleMessageItem[]; // 历史消息详情（用于调试）
  model?: string;
  promptType?: string;
  allowedTools?: string[];
  contextStrategy?: string;
  prune?: boolean;
  // Prompt 相关字段（仅记录是否传入和长度，不记录内容）
  hasSystemPrompt?: boolean;
  systemPromptLength?: number;
  hasContext?: boolean;
  contextLength?: number;
  hasToolContext?: boolean;
  toolContextLength?: number;
  // 品牌配置相关（configData = brandData, replyPrompts 来自 brandConfigService）
  hasConfigData?: boolean;
  hasReplyPrompts?: boolean;
  brandPriorityStrategy?: string;
  // 调试字段
  _mergedContextKeys?: string[];
}

/**
 * 完整 Agent 响应结构
 */
export interface RawAgentResponse {
  // HTTP 响应信息（不包含 headers）
  http?: {
    status: number;
    statusText: string;
  };
  // API 响应外层包装
  apiResponse?: {
    success: boolean;
    error?: string;
    correlationId?: string;
  };
  // Agent 调用输入参数（用于调试）
  input?: AgentInputParams;
  // 完整消息数组（保留原始结构，包含所有类型的 parts）
  messages: any[];
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
  rawAgentResponse?: RawAgentResponse;
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
  detailRecords: MessageRecord[];
  hourlyStats: any[];
  globalCounters: any;
  percentiles: {
    p50: number;
    p95: number;
    p99: number;
    p999: number;
  };
  slowestRecords: MessageRecord[];
  recentAlertCount: number;
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
  typingDelayPerCharMs: number; // 每字符延迟（毫秒）- 已废弃
  typingSpeedCharsPerSec: number; // 打字速度（字符/秒）
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
