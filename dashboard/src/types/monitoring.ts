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
  receivedAt: string;
  userName?: string;
  chatId: string;
  messagePreview?: string;
  replyPreview?: string;
  totalDuration: number;
  aiDuration?: number;
  replySegments?: number;
  status: 'success' | 'failed' | 'failure' | 'processing';
  error?: string;
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
