import { useState, useEffect } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import {
  useDashboardOverview,
  useHealthStatus,
  useAiReplyStatus,
  useToggleAiReply,
  useAvailableModels,
  useConfiguredTools,
  useBrandConfigStatus,
} from '@/hooks/useMonitoring';
import { formatDuration, formatMinuteLabel, formatDayLabel } from '@/utils/format';

// 组件导入
import ControlPanel from './components/ControlPanel';
import HealthGrid from './components/HealthGrid';
import MetricCard, { MetricGrid } from './components/MetricCard';
import ChartCard, { ChartsRow } from './components/ChartCard';

// 样式导入
import styles from './styles/index.module.scss';

// 圣诞装饰 emoji 列表
const christmasDecorations = ['🎀', '🧦', '⛄', '🎁', '🍬', '🔔', '🦌', '🎅', '🎄', '🍭', '🎈', '🎉', '🎊', '🥨', '🍩', '❄️', '☃️'];

// 注册 Chart.js 组件
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

export default function Dashboard() {
  const [timeRange, setTimeRange] = useState<'today' | 'week' | 'month'>('today');
  const [autoRefresh, setAutoRefresh] = useState(true);

  const { data: dashboard, isLoading: dashboardLoading, dataUpdatedAt } = useDashboardOverview(timeRange, autoRefresh);
  const { data: health } = useHealthStatus(autoRefresh);
  const { data: aiStatus } = useAiReplyStatus();
  const toggleAiReply = useToggleAiReply();

  // 详情数据（悬浮时加载）
  const { data: modelsData } = useAvailableModels();
  const { data: toolsData } = useConfiguredTools();
  const { data: brandData } = useBrandConfigStatus();

  // 圣诞装饰效果
  useEffect(() => {
    const cards = document.querySelectorAll('.metric-card, .chart-card, .insight-card');

    cards.forEach((card) => {
      card.querySelectorAll('.christmas-sticker').forEach(s => s.remove());

      if (Math.random() > 0.2) {
        const sticker = document.createElement('div');
        sticker.className = 'christmas-sticker sticker-tr';
        sticker.textContent = christmasDecorations[Math.floor(Math.random() * christmasDecorations.length)];
        sticker.style.animationDelay = `${Math.random() * 2}s`;
        card.appendChild(sticker);
      }

      if (Math.random() > 0.7) {
        const sticker2 = document.createElement('div');
        sticker2.className = 'christmas-sticker sticker-tl';
        sticker2.textContent = christmasDecorations[Math.floor(Math.random() * christmasDecorations.length)];
        card.appendChild(sticker2);
      }
    });

    return () => {
      document.querySelectorAll('.christmas-sticker').forEach(s => s.remove());
    };
  }, [dashboardLoading]);

  const overview = dashboard?.overview;
  const overviewDelta = dashboard?.overviewDelta;
  const business = dashboard?.business;
  const businessDelta = dashboard?.businessDelta;

  const isToday = timeRange === 'today';
  const formatLabel = isToday ? formatMinuteLabel : formatDayLabel;
  const businessPoints = isToday
    ? (dashboard?.businessTrend || []).slice(-90)
    : (dashboard?.businessTrend || []);

  // 健康状态
  const healthStatus = health?.status === 'healthy' &&
    health?.models?.allConfiguredModelsAvailable &&
    health?.tools?.allAvailable &&
    health?.brandConfig?.synced
    ? 'healthy'
    : health?.status !== 'healthy' ? 'error' : 'warning';

  const healthMessage = healthStatus === 'healthy'
    ? '全部正常'
    : health?.status !== 'healthy' ? '服务异常' : health ? '部分异常' : '检查中...';

  // 图表配置
  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index' as const, intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        titleColor: '#1e293b',
        bodyColor: '#475569',
        borderColor: 'rgba(148, 163, 184, 0.2)',
        borderWidth: 1,
        padding: 12,
        cornerRadius: 8,
        displayColors: false,
      },
    },
    scales: {
      x: {
        display: true,
        grid: { display: false, drawBorder: true },
        border: { display: true },
        ticks: { display: true, color: '#94a3b8', font: { size: 11 }, autoSkip: true, maxRotation: 0 }
      },
      y: {
        beginAtZero: true,
        border: { display: false },
        grid: { color: 'rgba(0, 0, 0, 0.03)' },
        ticks: { color: '#94a3b8', font: { size: 11 }, padding: 10 },
      },
    },
    elements: {
      line: { tension: 0.4, borderWidth: 3 },
      point: { radius: 0, hoverRadius: 6, borderWidth: 2, hoverBorderWidth: 3 },
    },
  };

  // 咨询人数趋势
  const consultationChartData = {
    labels: businessPoints.map((p) => formatLabel(p.minute)),
    datasets: [{
      label: '咨询人数',
      data: businessPoints.map((p) => p.consultations || 0),
      borderColor: '#6366f1',
      backgroundColor: 'rgba(99, 102, 241, 0.2)',
      fill: true,
      pointBackgroundColor: '#ffffff',
      pointBorderColor: '#6366f1',
      pointRadius: 4,
      pointHoverRadius: 6,
    }],
  };

  // 预约转化趋势
  const bookingChartData = {
    labels: businessPoints.map((p) => formatLabel(p.minute)),
    datasets: [
      {
        label: '预约次数',
        data: businessPoints.map((p) => p.bookingAttempts || 0),
        borderColor: '#8b5cf6',
        backgroundColor: 'rgba(139, 92, 246, 0.2)',
        fill: true,
        yAxisID: 'y',
        pointBackgroundColor: '#ffffff',
        pointBorderColor: '#8b5cf6',
        pointRadius: 4,
        pointHoverRadius: 6,
      },
      {
        label: '预约成功率',
        data: businessPoints.map((p) => p.bookingSuccessRate || 0),
        borderColor: '#10b981',
        backgroundColor: 'transparent',
        borderDash: [5, 5],
        fill: false,
        yAxisID: 'y1',
        pointBackgroundColor: '#ffffff',
        pointBorderColor: '#10b981',
        pointRadius: 4,
        pointHoverRadius: 6,
      },
    ],
  };

  const bookingChartOptions = {
    ...commonOptions,
    plugins: {
      ...commonOptions.plugins,
      legend: { display: true, labels: { color: '#6b7280', usePointStyle: true, boxWidth: 8 } },
    },
    scales: {
      x: commonOptions.scales.x,
      y: { ...commonOptions.scales.y, position: 'left' as const, title: { display: true, text: '预约次数', color: '#8b5cf6', font: { size: 10 } } },
      y1: { ...commonOptions.scales.y, position: 'right' as const, grid: { drawOnChartArea: false }, ticks: { callback: (value: number | string) => `${value}%` }, title: { display: true, text: '成功率 (%)', color: '#10b981', font: { size: 10 } } },
    },
  };

  // Token 消耗
  const tokenChartData = {
    labels: (dashboard?.dailyTrend || []).map((p) => p.date?.substring(5) || p.date),
    datasets: [{
      label: 'Token 消耗',
      data: (dashboard?.dailyTrend || []).map((p) => p.tokenUsage),
      backgroundColor: '#f59e0b',
      borderRadius: 6,
      hoverBackgroundColor: '#d97706',
      barThickness: 'flex' as const,
      maxBarThickness: 32,
    }],
  };

  // 每日咨询人数
  const dailyUserChartData = {
    labels: (dashboard?.dailyTrend || []).map((p) => p.date?.substring(5) || p.date),
    datasets: [{
      label: '咨询人数',
      data: (dashboard?.dailyTrend || []).map((p) => p.uniqueUsers),
      borderColor: '#6366f1',
      backgroundColor: 'rgba(99, 102, 241, 0.2)',
      fill: true,
      tension: 0.4,
      pointBackgroundColor: '#ffffff',
      pointBorderColor: '#6366f1',
      pointRadius: 4,
      pointHoverRadius: 6,
    }],
  };

  // 响应耗时
  const responseChartData = {
    labels: (dashboard?.responseTrend || []).slice(-60).map((p) => formatMinuteLabel(p.minute)),
    datasets: [{
      label: '平均耗时 (秒)',
      data: (dashboard?.responseTrend || []).slice(-60).map((p) => (p.avgDuration ? p.avgDuration / 1000 : 0)),
      borderColor: '#06b6d4',
      backgroundColor: 'rgba(6, 182, 212, 0.2)',
      fill: true,
      tension: 0.4,
      borderWidth: 3,
      pointRadius: 0,
      pointHoverRadius: 6,
      pointBackgroundColor: '#ffffff',
      pointBorderColor: '#06b6d4',
      pointBorderWidth: 2,
      pointHoverBorderWidth: 3,
    }],
  };

  const timeRangeBadge = timeRange === 'today' ? '本日' : timeRange === 'week' ? '本周' : '本月';

  return (
    <div className={styles.page}>
      {/* 控制面板 */}
      <ControlPanel
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
        autoRefresh={autoRefresh}
        onAutoRefreshChange={setAutoRefresh}
        aiEnabled={aiStatus?.enabled ?? false}
        onAiToggle={(enabled) => toggleAiReply.mutate(enabled)}
        healthStatus={healthStatus}
        healthMessage={healthMessage}
        lastUpdate={dataUpdatedAt ?? null}
      >
        {/* 健康状态网格 */}
        <HealthGrid
          health={health}
          modelsData={modelsData}
          toolsData={toolsData}
          brandData={brandData}
        />
      </ControlPanel>

      {/* 核心指标 */}
      <MetricGrid>
        <MetricCard
          label="消息总量"
          value={dashboardLoading ? '-' : (overview?.totalMessages ?? 0)}
          subtitle="成功 + 失败"
          delta={overviewDelta?.totalMessages}
          variant="primary"
          timeRangeBadge={timeRangeBadge}
        />
        <MetricCard
          label="成功率"
          value={dashboardLoading ? '-' : `${(overview?.successRate ?? 0).toFixed(1)}%`}
          subtitle={`成功 ${overview?.successCount ?? 0} 条`}
          delta={overviewDelta?.successRate}
          variant="success"
        />
        <MetricCard
          label="平均响应"
          value={dashboardLoading ? '-' : formatDuration(overview?.avgDuration ?? 0)}
          subtitle="秒"
          delta={overviewDelta?.avgDuration}
          deltaInverse
        />
        <MetricCard
          label="活跃用户"
          value={dashboardLoading ? '-' : (overview?.activeUsers ?? 0)}
          subtitle={`${overview?.activeChats ?? 0} 个会话`}
          delta={overviewDelta?.activeUsers}
        />
        <MetricCard
          label="降级次数"
          value={dashboardLoading ? '-' : (dashboard?.fallback?.totalCount ?? 0)}
          subtitle={`成功率 ${(dashboard?.fallback?.successRate ?? 0).toFixed(1)}% (${dashboard?.fallback?.successCount ?? 0}/${dashboard?.fallback?.totalCount ?? 0})`}
          delta={dashboard?.fallbackDelta?.totalCount}
          deltaInverse
          className="border-warning-soft"
        />
      </MetricGrid>

      {/* 业务指标 */}
      <MetricGrid columns={3}>
        <MetricCard
          label="总咨询人数"
          value={dashboardLoading ? '-' : (business?.consultations?.total ?? 0)}
          subtitle={<>新增 <span>{business?.consultations?.new ?? 0}</span> 人</>}
          delta={businessDelta?.consultations}
          timeRangeBadge={timeRangeBadge}
          className="border-primary-soft"
        />
        <MetricCard
          label="预约面试次数"
          value={dashboardLoading ? '-' : (business?.bookings?.attempts ?? 0)}
          subtitle={<>成功 <span className="text-success">{business?.bookings?.successful ?? 0}</span> / 失败 <span className="text-danger">{business?.bookings?.failed ?? 0}</span></>}
          delta={businessDelta?.bookingAttempts}
          className="border-purple-soft"
        />
        <MetricCard
          label="预约成功率"
          value={dashboardLoading ? '-' : `${(business?.bookings?.successRate ?? 0).toFixed(1)}%`}
          subtitle={<>咨询转化率 <span className="text-success">{(business?.conversion?.consultationToBooking ?? 0).toFixed(1)}%</span></>}
          delta={businessDelta?.bookingSuccessRate}
          variant="success"
          className="border-success-soft"
        />
      </MetricGrid>

      {/* 趋势图表 */}
      <ChartsRow>
        <ChartCard title="咨询人数趋势" subtitle="活跃用户数量变化">
          <Line data={consultationChartData} options={{ ...commonOptions, scales: { ...commonOptions.scales, y: { ...commonOptions.scales.y, ticks: { stepSize: 1, precision: 0 } } } }} />
        </ChartCard>
        <ChartCard title="预约转化趋势" subtitle="预约次数与成功率">
          <Line data={bookingChartData} options={bookingChartOptions} />
        </ChartCard>
      </ChartsRow>

      {/* 每日趋势 */}
      <ChartsRow>
        <ChartCard
          title="每日 Token 消耗"
          subtitle="最近 7 天使用量"
          kpiLabel="今日消耗"
          kpiValue={dashboard?.dailyTrend?.[dashboard.dailyTrend.length - 1]?.tokenUsage ?? '-'}
        >
          <Bar data={tokenChartData} options={commonOptions} />
        </ChartCard>
        <ChartCard
          title="每日咨询人数"
          subtitle="最近 7 天唯一用户"
          kpiLabel="今日人数"
          kpiValue={dashboard?.dailyTrend?.[dashboard.dailyTrend.length - 1]?.uniqueUsers ?? '-'}
        >
          <Line data={dailyUserChartData} options={commonOptions} />
        </ChartCard>
      </ChartsRow>

      {/* 响应耗时 */}
      <ChartsRow>
        <ChartCard
          title="响应耗时"
          subtitle="最近 60 分钟平均响应时间"
          kpiLabel="当前平均"
          kpiValue={dashboard?.overview?.avgDuration ? formatDuration(dashboard.overview.avgDuration) : '-'}
          fullWidth
        >
          <Line data={responseChartData} options={commonOptions} />
        </ChartCard>
      </ChartsRow>
    </div>
  );
}
