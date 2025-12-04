import { useState, useEffect } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import {
  useAgentReplyConfig,
  useUpdateAgentReplyConfig,
} from '@/hooks/useMonitoring';
import { formatDuration, formatHourLabel } from '@/utils/format';
import type { AgentReplyConfig } from '@/types/monitoring';

// 组件导入
import KpiCard, { KpiGrid } from './components/KpiCard';
import ConsolePanel from './components/ConsolePanel';

// 样式导入
import styles from './styles/index.module.scss';

// 注册 Chart.js 组件
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

export default function System() {
  const { data: configData } = useAgentReplyConfig();
  const updateConfig = useUpdateAgentReplyConfig();

  // 告警配置本地状态
  const [alertConfig, setAlertConfig] = useState({
    businessAlertEnabled: true,
    minSamplesForAlert: 10,
    alertIntervalMinutes: 30,
    alertThrottleWindowMs: 300000,
    alertThrottleMaxCount: 3,
    // 告警阈值
    successRateCritical: 80,
    avgDurationCritical: 60000,
    queueDepthCritical: 20,
    errorRateCritical: 10,
  });

  // 同步配置数据
  useEffect(() => {
    if (configData?.config) {
      setAlertConfig({
        businessAlertEnabled: configData.config.businessAlertEnabled ?? true,
        minSamplesForAlert: configData.config.minSamplesForAlert ?? 10,
        alertIntervalMinutes: configData.config.alertIntervalMinutes ?? 30,
        alertThrottleWindowMs: configData.config.alertThrottleWindowMs ?? 300000,
        alertThrottleMaxCount: configData.config.alertThrottleMaxCount ?? 3,
        // 告警阈值
        successRateCritical: configData.config.successRateCritical ?? 80,
        avgDurationCritical: configData.config.avgDurationCritical ?? 60000,
        queueDepthCritical: configData.config.queueDepthCritical ?? 20,
        errorRateCritical: configData.config.errorRateCritical ?? 10,
      });
    }
  }, [configData]);

  // Mock Data for Visualization
  const mockData = {
    queue: {
      currentProcessing: 12,
      peakProcessing: 45,
      avgQueueDuration: 1250,
    },
    percentiles: {
      p50: 800,
      p95: 2500,
      p99: 4500,
    },
    alertsSummary: {
      total: 128,
      last24Hours: 24,
      byType: [
        { type: 'Agent 调用失败', count: 15, percentage: 42 },
        { type: '响应时间过长', count: 8, percentage: 22 },
        { type: '成功率严重下降', count: 6, percentage: 17 },
        { type: '队列积压', count: 4, percentage: 11 },
        { type: '消息发送失败', count: 3, percentage: 8 },
      ],
    },
    recentAlertCount: 5,
    // 24小时趋势：每小时一个点
    alertTrend: Array.from({ length: 24 }, (_, i) => ({
      hour: new Date(Date.now() - (23 - i) * 3600000).toISOString(),
      count: Math.random() > 0.7 ? Math.floor(Math.random() * 8) : 0,
    })),
  };

  const queue = mockData.queue;
  const alerts = mockData.alertsSummary;
  const percentiles = mockData.percentiles;
  const recentAlertCount = mockData.recentAlertCount;
  const alertTrend = mockData.alertTrend;

  // 更新配置 - 只发送变更的字段
  const handleConfigChange = (key: keyof AgentReplyConfig, value: number | boolean) => {
    const newConfig = { ...alertConfig, [key]: value };
    setAlertConfig(newConfig);
    // 只发送变更的字段，减少数据传输
    updateConfig.mutate({ [key]: value });
  };

  // 切换告警开关
  const toggleAlert = () => {
    const newValue = !alertConfig.businessAlertEnabled;
    setAlertConfig((prev) => ({ ...prev, businessAlertEnabled: newValue }));
    updateConfig.mutate({ businessAlertEnabled: newValue });
  };

  // 告警趋势图表数据（24小时）
  const alertChartData = {
    labels: alertTrend.map((p) => formatHourLabel(p.hour)),
    datasets: [
      {
        label: '告警次数',
        data: alertTrend.map((p) => p.count || 0),
        borderColor: '#ef4444',
        backgroundColor: (context: { chart: { ctx: CanvasRenderingContext2D } }) => {
          const ctx = context.chart.ctx;
          const gradient = ctx.createLinearGradient(0, 0, 0, 300);
          gradient.addColorStop(0, 'rgba(239, 68, 68, 0.2)');
          gradient.addColorStop(1, 'rgba(239, 68, 68, 0)');
          return gradient;
        },
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        fill: true,
        tension: 0.4,
      },
    ],
  };

  // 图表配置
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        titleColor: '#1f2937',
        bodyColor: '#6b7280',
        borderColor: 'rgba(0,0,0,0.05)',
        borderWidth: 1,
        padding: 12,
        boxPadding: 6,
        usePointStyle: true,
        displayColors: false,
        callbacks: {
          label: (context: { parsed: { y: number | null } }) => `${context.parsed.y ?? 0} 次告警`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          color: '#94a3b8',
          font: { size: 10 },
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 12,
        },
      },
      y: {
        beginAtZero: true,
        border: { display: false },
        grid: { color: 'rgba(0, 0, 0, 0.02)' },
        ticks: {
          color: '#94a3b8',
          font: { size: 10 },
          padding: 10,
          stepSize: 1,
        },
      },
    },
  };

  return (
    <div className={styles.page}>
      {/* KPI 卡片 */}
      <KpiGrid>
        <KpiCard
          icon="⚡️"
          variant="primary"
          label="实时处理"
          value={queue?.currentProcessing ?? '-'}
          valueVariant="primary"
          trend={{ direction: 'up', value: '+12%', label: '较上小时' }}
          title="当前正在处理的消息数量"
        />
        <KpiCard
          icon="⏱️"
          variant="warning"
          label="P95 延迟"
          value={percentiles?.p95 ? formatDuration(percentiles.p95) : '-'}
          valueVariant="warning"
          trend={{ direction: 'down', value: '-5ms', label: '性能优化' }}
          title="95% 的请求在此时间内完成"
        />
        <KpiCard
          icon="🚨"
          variant="danger"
          label="今日告警"
          value={alerts?.total ?? '-'}
          valueVariant="danger"
          trend={{ direction: 'up', value: '+3', label: '新增异常' }}
          title="今日累计触发的告警总数"
        />
        <KpiCard
          icon="🌊"
          variant="info"
          label="峰值队列"
          value={queue?.peakProcessing ?? '-'}
          trend={{ direction: 'flat', value: '平稳', label: '负载正常' }}
          title="今日队列积压的最大数量"
        />
      </KpiGrid>

      {/* 控制台面板 */}
      <ConsolePanel
        alertConfig={alertConfig}
        onConfigChange={handleConfigChange}
        onToggleAlert={toggleAlert}
        isUpdating={updateConfig.isPending}
        chartData={alertChartData}
        chartOptions={chartOptions}
        recentAlertCount={recentAlertCount}
        alertTypes={alerts?.byType}
      />
    </div>
  );
}
