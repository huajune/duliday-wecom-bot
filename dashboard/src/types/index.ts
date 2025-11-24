export interface MonitoringStats {
  totalMessages: number;
  totalReplies: number;
  activeUsers: number;
  avgResponseTime: number;
  successRate: number;
}

export interface AlertItem {
  id: string;
  type: string;
  message: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  timestamp: string;
}

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  memory: {
    used: number;
    total: number;
  };
  cpu: number;
}
