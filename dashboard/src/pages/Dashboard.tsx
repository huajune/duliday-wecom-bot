import { useQuery } from '@tanstack/react-query';
import Card, { StatCard } from '@/components/Card';
import { fetchMonitoringStats, fetchSystemHealth, fetchAlerts } from '@/services/api';
import clsx from 'clsx';

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['monitoring-stats'],
    queryFn: fetchMonitoringStats,
    refetchInterval: 30000, // 30秒刷新一次
  });

  const { data: health, isLoading: healthLoading } = useQuery({
    queryKey: ['system-health'],
    queryFn: fetchSystemHealth,
    refetchInterval: 10000, // 10秒刷新一次
  });

  const { data: alerts } = useQuery({
    queryKey: ['alerts'],
    queryFn: fetchAlerts,
    refetchInterval: 30000,
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">监控概览</h1>
          <p className="text-gray-500 mt-1">实时监控系统运行状态</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">系统状态:</span>
          <span
            className={clsx(
              'px-2 py-1 rounded-full text-xs font-medium',
              health?.status === 'healthy' && 'bg-green-100 text-green-700',
              health?.status === 'degraded' && 'bg-yellow-100 text-yellow-700',
              health?.status === 'unhealthy' && 'bg-red-100 text-red-700',
              !health && 'bg-gray-100 text-gray-500',
            )}
          >
            {health?.status === 'healthy' ? '正常' :
             health?.status === 'degraded' ? '降级' :
             health?.status === 'unhealthy' ? '异常' : '加载中...'}
          </span>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="今日消息"
          value={statsLoading ? '...' : (stats?.totalMessages ?? 0)}
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
          }
        />
        <StatCard
          label="AI 回复"
          value={statsLoading ? '...' : (stats?.totalReplies ?? 0)}
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          }
        />
        <StatCard
          label="活跃用户"
          value={statsLoading ? '...' : (stats?.activeUsers ?? 0)}
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          }
        />
        <StatCard
          label="成功率"
          value={statsLoading ? '...' : `${stats?.successRate ?? 0}%`}
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      </div>

      {/* System Info & Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* System Health */}
        <Card title="系统资源">
          {healthLoading ? (
            <div className="text-gray-500">加载中...</div>
          ) : health ? (
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">内存使用</span>
                  <span className="text-gray-900">
                    {health.memory?.used ?? 0} / {health.memory?.total ?? 0} MB
                  </span>
                </div>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-primary rounded-full transition-all duration-300"
                    style={{
                      width: `${health.memory?.total ? (health.memory.used / health.memory.total) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">CPU 使用率</span>
                  <span className="text-gray-900">{health.cpu ?? 0}%</span>
                </div>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-primary rounded-full transition-all duration-300"
                    style={{ width: `${health.cpu ?? 0}%` }}
                  />
                </div>
              </div>
              <div className="pt-2 border-t border-gray-100">
                <span className="text-sm text-gray-500">
                  运行时间: {formatUptime(health.uptime)}
                </span>
              </div>
            </div>
          ) : (
            <div className="text-gray-500">无法获取系统信息</div>
          )}
        </Card>

        {/* Recent Alerts */}
        <Card title="最近告警">
          {alerts && alerts.length > 0 ? (
            <div className="space-y-3 max-h-48 overflow-y-auto">
              {alerts.slice(0, 5).map((alert) => (
                <div
                  key={alert.id}
                  className={clsx(
                    'p-3 rounded-lg border-l-4',
                    alert.severity === 'critical' && 'bg-red-50 border-red-500',
                    alert.severity === 'error' && 'bg-red-50 border-red-400',
                    alert.severity === 'warning' && 'bg-yellow-50 border-yellow-400',
                    alert.severity === 'info' && 'bg-blue-50 border-blue-400',
                  )}
                >
                  <div className="text-sm font-medium text-gray-900">{alert.type}</div>
                  <div className="text-xs text-gray-600 mt-1">{alert.message}</div>
                  <div className="text-xs text-gray-400 mt-1">
                    {new Date(alert.timestamp).toLocaleString('zh-CN')}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-gray-500 text-sm">暂无告警信息</div>
          )}
        </Card>
      </div>

      {/* Placeholder for future charts */}
      <Card title="消息趋势" className="min-h-[300px]">
        <div className="flex items-center justify-center h-48 text-gray-400">
          <div className="text-center">
            <svg className="w-12 h-12 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
            </svg>
            <p>图表功能开发中...</p>
          </div>
        </div>
      </Card>
    </div>
  );
}

function formatUptime(seconds: number): string {
  if (!seconds) return '0秒';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0) parts.push(`${hours}小时`);
  if (minutes > 0) parts.push(`${minutes}分钟`);

  return parts.join(' ') || '0秒';
}
