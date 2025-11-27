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
  useDashboard,
  useHealthStatus,
  useAiReplyStatus,
  useToggleAiReply,
  useAvailableModels,
  useConfiguredTools,
  useBrandConfigStatus,
} from '@/hooks/useMonitoring';
import { formatDateTime, formatDuration, formatMinuteLabel, formatDayLabel } from '@/utils/format';


// 圣诞装饰 emoji 列表 - 与 monitoring.html 完全一致
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
  const [hoveredCard, setHoveredCard] = useState<'model' | 'tool' | 'brand' | null>(null);
  const { data: dashboard, isLoading: dashboardLoading, dataUpdatedAt } = useDashboard(timeRange, autoRefresh);
  const { data: health } = useHealthStatus(autoRefresh);
  const { data: aiStatus } = useAiReplyStatus();
  const toggleAiReply = useToggleAiReply();

  // 详情数据（悬浮时加载）
  const { data: modelsData } = useAvailableModels();
  const { data: toolsData } = useConfiguredTools();
  const { data: brandData } = useBrandConfigStatus();

  // 圣诞装饰效果 - 与 monitoring.html 的 DOMContentLoaded 逻辑完全一致
  useEffect(() => {
    const cards = document.querySelectorAll('.metric-card, .chart-card, .insight-card');

    cards.forEach((card) => {
      // 清除之前的贴纸（避免重复添加）
      card.querySelectorAll('.christmas-sticker').forEach(s => s.remove());

      // Randomly decide to add a sticker (80% chance)
      if (Math.random() > 0.2) {
        const sticker = document.createElement('div');
        sticker.className = 'christmas-sticker sticker-tr';
        sticker.textContent = christmasDecorations[Math.floor(Math.random() * christmasDecorations.length)];
        sticker.style.animationDelay = `${Math.random() * 2}s`;
        card.appendChild(sticker);
      }

      // Occasionally add a second sticker to the left (30% chance)
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
  }, [dashboardLoading]); // 当数据加载完成后重新添加装饰

  const overview = dashboard?.overview;
  const overviewDelta = dashboard?.overviewDelta;
  const business = dashboard?.business;
  const businessDelta = dashboard?.businessDelta;

  // 判断是否为今日视图
  const isToday = timeRange === 'today';
  // 根据时间范围选择格式化函数
  const formatLabel = isToday ? formatMinuteLabel : formatDayLabel;

  // 本日：显示最近90个数据点；本周/本月：显示全部数据点 - 与 monitoring.html 一致
  const businessPoints = isToday
    ? (dashboard?.businessTrend || []).slice(-90)
    : (dashboard?.businessTrend || []);

  // 咨询人数趋势图表配置 - 冰雪蓝 #3b82f6 - 与 monitoring.html 完全一致
  const consultationChartData = {
    labels: businessPoints.map((p) => formatLabel(p.minute)),
    datasets: [
      {
        label: '咨询人数',
        data: businessPoints.map((p) => p.consultations || 0),
        borderColor: '#3b82f6', // Ice Blue
        backgroundColor: 'rgba(59, 130, 246, 0.2)',
        fill: true,
        pointBackgroundColor: '#ffffff',
        pointBorderColor: '#3b82f6',
        pointRadius: 4,
        pointHoverRadius: 6,
      },
    ],
  };

  // 预约转化趋势图表配置 - 圣诞红 #ef4444 & 圣诞绿 #10b981（双轴）- 与 monitoring.html 完全一致
  const bookingChartData = {
    labels: businessPoints.map((p) => formatLabel(p.minute)),
    datasets: [
      {
        label: '预约次数',
        data: businessPoints.map((p) => p.bookingAttempts || 0),
        borderColor: '#ef4444', // Christmas Red
        backgroundColor: 'rgba(239, 68, 68, 0.2)',
        fill: true,
        yAxisID: 'y',
        pointBackgroundColor: '#ffffff',
        pointBorderColor: '#ef4444',
        pointRadius: 4,
        pointHoverRadius: 6,
      },
      {
        label: '预约成功率',
        data: businessPoints.map((p) => p.bookingSuccessRate || 0),
        borderColor: '#10b981', // Christmas Green
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

  // 图表通用配置 - 与 monitoring.html commonOptions 完全一致
  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
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
        grid: { display: false },
        ticks: {
          color: '#94a3b8',
          font: { size: 11 },
        },
      },
      y: {
        beginAtZero: true,
        border: { display: false },
        grid: { color: 'rgba(0, 0, 0, 0.03)' },
        ticks: {
          color: '#94a3b8',
          font: { size: 11 },
          padding: 10,
        },
      },
    },
    elements: {
      line: { tension: 0.4, borderWidth: 3 },
      point: { radius: 0, hoverRadius: 6, borderWidth: 2, hoverBorderWidth: 3 },
    },
  };

  // 咨询人数图表配置 - 与 monitoring.html 一致（y 轴 stepSize: 1）
  const chartOptions = {
    ...commonOptions,
    scales: {
      ...commonOptions.scales,
      y: {
        ...commonOptions.scales.y,
        ticks: { stepSize: 1, precision: 0 },
      },
    },
  };

  // 预约转化图表配置（双轴 + legend）- 与 monitoring.html 完全一致
  const bookingChartOptions = {
    ...commonOptions,
    plugins: {
      ...commonOptions.plugins,
      legend: {
        display: true,
        labels: { color: '#6b7280', usePointStyle: true, boxWidth: 8 },
      },
    },
    scales: {
      x: commonOptions.scales.x,
      y: {
        ...commonOptions.scales.y,
        position: 'left' as const,
        title: { display: true, text: '预约次数', color: '#ef4444', font: { size: 10 } },
      },
      y1: {
        ...commonOptions.scales.y,
        position: 'right' as const,
        grid: { drawOnChartArea: false },
        ticks: { callback: (value: number | string) => `${value}%` },
        title: { display: true, text: '成功率 (%)', color: '#10b981', font: { size: 10 } },
      },
    },
  };

  // 每日 Token 消耗图表 - 圣诞金 #f59e0b (Bar 图)
  const tokenChartData = {
    labels: (dashboard?.dailyTrend || []).map((p) => p.date?.substring(5) || p.date), // MM-DD 格式
    datasets: [
      {
        label: 'Token 消耗',
        data: (dashboard?.dailyTrend || []).map((p) => p.tokenUsage),
        backgroundColor: '#f59e0b', // Gold
        borderRadius: 6,
        hoverBackgroundColor: '#d97706',
      },
    ],
  };

  // 每日咨询人数图表 - 圣诞绿 #10b981
  const dailyUserChartData = {
    labels: (dashboard?.dailyTrend || []).map((p) => p.date?.substring(5) || p.date), // MM-DD 格式
    datasets: [
      {
        label: '咨询人数',
        data: (dashboard?.dailyTrend || []).map((p) => p.uniqueUsers),
        borderColor: '#10b981', // Green
        backgroundColor: 'rgba(16, 185, 129, 0.2)',
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#ffffff',
        pointBorderColor: '#10b981',
        pointRadius: 4,
        pointHoverRadius: 6,
      },
    ],
  };

  // 响应耗时趋势 - 圣诞绿 #10b981
  const responseChartData = {
    labels: (dashboard?.responseTrend || []).slice(-60).map((p) => formatMinuteLabel(p.minute)),
    datasets: [
      {
        label: '平均耗时 (秒)',
        data: (dashboard?.responseTrend || [])
          .slice(-60)
          .map((p) => (p.avgDuration ? p.avgDuration / 1000 : 0)),
        borderColor: '#10b981', // Green
        backgroundColor: 'rgba(16, 185, 129, 0.2)',
        fill: true,
        tension: 0.4,
        borderWidth: 3,
        pointRadius: 0,
        pointHoverRadius: 6,
        pointBackgroundColor: '#ffffff',
        pointBorderColor: '#10b981',
        pointBorderWidth: 2,
        pointHoverBorderWidth: 3,
      },
    ],
  };

  return (
    <div id="page-dashboard" className="page-section active">
      {/* 统一控制面板 - 合并筛选和健康状态 */}
      <section className="control-panel">
        {/* 装饰性光点 */}
        <span className="decorative-dot"></span>
        <span className="decorative-dot"></span>
        <div className="control-panel-header">
          <div className="control-panel-left">
            <div className="control-panel-title">系统控制</div>
            <div className="filters">
              <button
                className={timeRange === 'today' ? 'active' : ''}
                onClick={() => setTimeRange('today')}
              >
                本日
              </button>
              <button
                className={timeRange === 'week' ? 'active' : ''}
                onClick={() => setTimeRange('week')}
              >
                本周
              </button>
              <button
                className={timeRange === 'month' ? 'active' : ''}
                onClick={() => setTimeRange('month')}
              >
                本月
              </button>
            </div>
            <label className="toggle-switch">
              <span>🤖 智能回复</span>
              <input
                type="checkbox"
                id="aiReplyToggle"
                checked={aiStatus?.enabled ?? false}
                onChange={(e) => toggleAiReply.mutate(e.target.checked)}
              />
              <span className={`status-text ${aiStatus?.enabled ? 'enabled' : 'disabled'}`} id="aiReplyStatus">
                {aiStatus?.enabled ? '已启用' : '已禁用'}
              </span>
            </label>
          </div>
          <div className="control-panel-right">
            <span className={`health-panel-badge ${health?.status === 'healthy' && health?.models?.allConfiguredModelsAvailable && health?.tools?.allAvailable && health?.brandConfig?.synced
              ? ''
              : health?.status !== 'healthy' ? 'error' : 'warning'
              }`} id="overallHealthBadge">
              {health?.status === 'healthy' && health?.models?.allConfiguredModelsAvailable && health?.tools?.allAvailable && health?.brandConfig?.synced
                ? '全部正常'
                : health?.status !== 'healthy' ? '服务异常' : health ? '部分异常' : '检查中...'}
            </span>
            <label className="auto-refresh">
              <input
                type="checkbox"
                id="autoRefresh"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              自动刷新
            </label>
            <div className="last-update">
              <span className="status-indicator"></span>
              <span id="lastUpdate">{dataUpdatedAt ? formatDateTime(dataUpdatedAt) : '-'}</span>
            </div>
          </div>
        </div>
        <div className="health-grid">
          <article className="health-item" id="overallHealthCard" data-state={health?.status === 'healthy' ? 'healthy' : 'loading'}>
            <div className="health-icon">🛰️</div>
            <div className="health-info">
              <div className="health-title">整体状态</div>
              <div className="health-status" id="overallHealthStatus">
                {health?.status === 'healthy' ? '运行正常' : health?.status === 'degraded' ? '服务降级' : '-'}
              </div>
              <div className="health-desc" id="overallHealthMessage">
                {health?.message || '检查中...'}
              </div>
            </div>
          </article>
          <article
            className="health-item health-item-hoverable"
            id="modelHealthCard"
            data-state={health?.models?.allConfiguredModelsAvailable ? 'healthy' : 'loading'}
            onMouseEnter={() => setHoveredCard('model')}
            onMouseLeave={() => setHoveredCard(null)}
          >
            <div className="health-icon">🤖</div>
            <div className="health-info">
              <div className="health-title">AI 模型</div>
              <div className="health-status" id="modelHealthStatus">
                {health?.models?.allConfiguredModelsAvailable ? '服务可用' : health?.models ? '需关注' : '-'}
              </div>
              <div className="health-desc" id="modelHealthDetails">
                {health?.models ? `${health.models.availableCount}/${health.models.configuredCount} 模型可用` : '检查中...'}
              </div>
            </div>
            {/* 悬浮弹窗：可用模型列表 */}
            {hoveredCard === 'model' && modelsData && (
              <div className="health-tooltip">
                <div className="tooltip-title">可用模型列表</div>
                <div className="tooltip-content">
                  {modelsData.availableModels?.length > 0 ? (
                    <ul className="tooltip-list">
                      {modelsData.availableModels.map((model) => (
                        <li key={model} className={model === modelsData.defaultModel ? 'default-item' : ''}>
                          {model}
                          {model === modelsData.defaultModel && <span className="default-badge">默认</span>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="tooltip-empty">暂无可用模型</div>
                  )}
                </div>
                <div className="tooltip-footer">
                  更新于 {modelsData.lastRefreshTime ? formatDateTime(modelsData.lastRefreshTime) : '-'}
                </div>
              </div>
            )}
          </article>
          <article
            className="health-item health-item-hoverable"
            id="toolHealthCard"
            data-state={health?.tools?.allAvailable ? 'healthy' : 'loading'}
            onMouseEnter={() => setHoveredCard('tool')}
            onMouseLeave={() => setHoveredCard(null)}
          >
            <div className="health-icon">🧰</div>
            <div className="health-info">
              <div className="health-title">工具服务</div>
              <div className="health-status" id="toolHealthStatus">
                {health?.tools?.allAvailable ? '响应正常' : health?.tools ? '响应缓慢' : '-'}
              </div>
              <div className="health-desc" id="toolHealthDetails">
                {health?.tools ? `${health.tools.availableCount}/${health.tools.configuredCount} 工具可用` : '检查中...'}
              </div>
            </div>
            {/* 悬浮弹窗：配置工具列表 */}
            {hoveredCard === 'tool' && toolsData && (
              <div className="health-tooltip">
                <div className="tooltip-title">配置工具列表</div>
                <div className="tooltip-content">
                  {toolsData.configuredTools?.length > 0 ? (
                    <ul className="tooltip-list">
                      {toolsData.configuredTools.map((tool) => (
                        <li key={tool}>{tool}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="tooltip-empty">暂无配置工具</div>
                  )}
                </div>
                <div className="tooltip-footer">
                  共 {toolsData.count} 个工具 | 更新于 {toolsData.lastRefreshTime ? formatDateTime(toolsData.lastRefreshTime) : '-'}
                </div>
              </div>
            )}
          </article>
          <article
            className="health-item health-item-hoverable"
            id="brandHealthCard"
            data-state={health?.brandConfig?.available && health?.brandConfig?.synced ? 'healthy' : 'loading'}
            onMouseEnter={() => setHoveredCard('brand')}
            onMouseLeave={() => setHoveredCard(null)}
          >
            <div className="health-icon">🏷️</div>
            <div className="health-info">
              <div className="health-title">品牌数据</div>
              <div className="health-status" id="brandHealthStatus">
                {health?.brandConfig?.available && health?.brandConfig?.synced ? '数据同步' : health?.brandConfig?.available ? '需同步' : '-'}
              </div>
              <div className="health-desc" id="brandHealthDetails">
                {health?.brandConfig?.available && health?.brandConfig?.synced
                  ? `更新于 ${health.brandConfig.lastUpdated ? formatDateTime(health.brandConfig.lastUpdated) : '未知'}`
                  : health?.brandConfig?.available ? '品牌数据待同步' : '检查中...'}
              </div>
            </div>
            {/* 悬浮弹窗：品牌配置状态 */}
            {hoveredCard === 'brand' && brandData && (
              <div className="health-tooltip">
                <div className="tooltip-title">品牌配置状态</div>
                <div className="tooltip-content">
                  <div className="tooltip-status-grid">
                    <div className="status-row">
                      <span className="status-label">配置可用</span>
                      <span className={`status-value ${brandData.available ? 'success' : 'error'}`}>
                        {brandData.available ? '是' : '否'}
                      </span>
                    </div>
                    <div className="status-row">
                      <span className="status-label">数据已同步</span>
                      <span className={`status-value ${brandData.synced ? 'success' : 'warning'}`}>
                        {brandData.synced ? '是' : '否'}
                      </span>
                    </div>
                    <div className="status-row">
                      <span className="status-label">品牌数据</span>
                      <span className={`status-value ${brandData.hasBrandData ? 'success' : 'warning'}`}>
                        {brandData.hasBrandData ? '已加载' : '未加载'}
                      </span>
                    </div>
                    <div className="status-row">
                      <span className="status-label">回复模板</span>
                      <span className={`status-value ${brandData.hasReplyPrompts ? 'success' : 'warning'}`}>
                        {brandData.hasReplyPrompts ? '已加载' : '未加载'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="tooltip-footer">
                  更新于 {brandData.lastUpdated ? formatDateTime(brandData.lastUpdated) : '-'}
                </div>
              </div>
            )}
          </article>
        </div>
      </section>

      {/* 核心指标 */}
      <section className="metric-grid">
        <article className="metric-card primary">
          <div className="metric-label">
            消息总量
            <span className="time-range-badge" id="timeRangeBadge" style={{ fontSize: '11px', opacity: 0.7 }}>
              {timeRange === 'today' ? '本日' : timeRange === 'week' ? '本周' : '本月'}
            </span>
          </div>
          <div className="metric-value" id="totalMessages">
            {dashboardLoading ? '-' : (overview?.totalMessages ?? 0)}
          </div>
          <div className="metric-subtitle">成功 + 失败</div>
          <div className={`metric-delta ${overviewDelta?.totalMessages !== undefined && overviewDelta.totalMessages >= 0 ? 'positive' : 'negative'}`} id="totalMessagesDelta">
            {overviewDelta?.totalMessages !== undefined ? `${overviewDelta.totalMessages >= 0 ? '+' : ''}${overviewDelta.totalMessages.toFixed(1)}%` : '-'}
          </div>
        </article>
        <article className="metric-card success">
          <div className="metric-label">成功率</div>
          <div className="metric-value" id="successRate">
            {dashboardLoading ? '-' : `${(overview?.successRate ?? 0).toFixed(1)}%`}
          </div>
          <div className="metric-subtitle" id="successCount">
            成功 {overview?.successCount ?? 0} 条
          </div>
          <div className={`metric-delta ${overviewDelta?.successRate !== undefined && overviewDelta.successRate >= 0 ? 'positive' : 'negative'}`} id="successRateDelta">
            {overviewDelta?.successRate !== undefined ? `${overviewDelta.successRate >= 0 ? '+' : ''}${overviewDelta.successRate.toFixed(1)}%` : '-'}
          </div>
        </article>
        <article className="metric-card">
          <div className="metric-label">平均响应</div>
          <div className="metric-value" id="avgDuration">
            {dashboardLoading ? '-' : formatDuration(overview?.avgDuration ?? 0)}
          </div>
          <div className="metric-subtitle">秒</div>
          <div className={`metric-delta ${overviewDelta?.avgDuration !== undefined && overviewDelta.avgDuration <= 0 ? 'positive' : 'negative'}`} id="avgDurationDelta">
            {overviewDelta?.avgDuration !== undefined ? `${overviewDelta.avgDuration <= 0 ? '' : '+'}${overviewDelta.avgDuration.toFixed(1)}%` : '-'}
          </div>
        </article>
        <article className="metric-card">
          <div className="metric-label">活跃用户</div>
          <div className="metric-value" id="activeUsers">
            {dashboardLoading ? '-' : (overview?.activeUsers ?? 0)}
          </div>
          <div className="metric-subtitle" id="activeChats">
            {overview?.activeChats ?? 0} 个会话
          </div>
          <div className={`metric-delta ${overviewDelta?.activeUsers !== undefined && overviewDelta.activeUsers >= 0 ? 'positive' : 'negative'}`} id="activeUsersDelta">
            {overviewDelta?.activeUsers !== undefined ? `${overviewDelta.activeUsers >= 0 ? '+' : ''}${overviewDelta.activeUsers.toFixed(1)}%` : '-'}
          </div>
        </article>
        <article className="metric-card" style={{ border: '1px solid rgba(245, 158, 11, 0.3)' }}>
          <div className="metric-label">降级次数</div>
          <div className="metric-value" id="fallbackCount">
            {dashboardLoading ? '-' : (dashboard?.fallback?.totalCount ?? 0)}
          </div>
          <div className="metric-subtitle" id="fallbackRate">
            成功率 {(dashboard?.fallback?.successRate ?? 0).toFixed(1)}% ({dashboard?.fallback?.successCount ?? 0}/{dashboard?.fallback?.totalCount ?? 0})
          </div>
          <div className={`metric-delta ${dashboard?.fallbackDelta?.totalCount !== undefined && dashboard.fallbackDelta.totalCount <= 0 ? 'positive' : 'negative'}`} id="fallbackDelta">
            {dashboard?.fallbackDelta?.totalCount !== undefined ? `${dashboard.fallbackDelta.totalCount <= 0 ? '' : '+'}${dashboard.fallbackDelta.totalCount.toFixed(1)}%` : '-'}
          </div>
        </article>
      </section>

      {/* 业务指标卡片 */}
      <section className="metric-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <article className="metric-card" style={{ border: '1px solid rgba(99, 102, 241, 0.3)' }}>
          <div className="metric-label">
            总咨询人数
            <span className="time-range-badge" id="businessTimeRangeBadge" style={{ fontSize: '11px', opacity: 0.7 }}>
              {timeRange === 'today' ? '本日' : timeRange === 'week' ? '本周' : '本月'}
            </span>
          </div>
          <div className="metric-value" id="businessConsultationsTotal">
            {dashboardLoading ? '-' : (business?.consultations?.total ?? 0)}
          </div>
          <div className="metric-subtitle">
            新增 <span id="businessConsultationsNew">{business?.consultations?.new ?? 0}</span> 人
          </div>
          <div className={`metric-delta ${businessDelta?.consultations !== undefined && businessDelta.consultations >= 0 ? 'positive' : 'negative'}`} id="businessConsultationsDelta">
            {businessDelta?.consultations !== undefined ? `${businessDelta.consultations >= 0 ? '+' : ''}${businessDelta.consultations.toFixed(1)}%` : '-'}
          </div>
        </article>

        <article className="metric-card" style={{ border: '1px solid rgba(168, 85, 247, 0.3)' }}>
          <div className="metric-label">预约面试次数</div>
          <div className="metric-value" id="businessBookingAttempts">
            {dashboardLoading ? '-' : (business?.bookings?.attempts ?? 0)}
          </div>
          <div className="metric-subtitle">
            成功 <span id="businessBookingSuccessful" style={{ color: 'var(--success)' }}>{business?.bookings?.successful ?? 0}</span> /
            失败 <span id="businessBookingFailed" style={{ color: 'var(--danger)' }}>{business?.bookings?.failed ?? 0}</span>
          </div>
          <div className={`metric-delta ${businessDelta?.bookingAttempts !== undefined && businessDelta.bookingAttempts >= 0 ? 'positive' : 'negative'}`} id="businessBookingAttemptsDelta">
            {businessDelta?.bookingAttempts !== undefined ? `${businessDelta.bookingAttempts >= 0 ? '+' : ''}${businessDelta.bookingAttempts.toFixed(1)}%` : '-'}
          </div>
        </article>

        <article className="metric-card success" style={{ border: '1px solid rgba(16, 185, 129, 0.3)' }}>
          <div className="metric-label">预约成功率</div>
          <div className="metric-value" id="businessBookingSuccessRate">
            {dashboardLoading ? '-' : `${(business?.bookings?.successRate ?? 0).toFixed(1)}%`}
          </div>
          <div className="metric-subtitle">
            咨询转化率 <span id="businessConversionRate" style={{ color: 'var(--success)' }}>{(business?.conversion?.consultationToBooking ?? 0).toFixed(1)}%</span>
          </div>
          <div className={`metric-delta ${businessDelta?.bookingSuccessRate !== undefined && businessDelta.bookingSuccessRate >= 0 ? 'positive' : 'negative'}`} id="businessBookingSuccessRateDelta">
            {businessDelta?.bookingSuccessRate !== undefined ? `${businessDelta.bookingSuccessRate >= 0 ? '+' : ''}${businessDelta.bookingSuccessRate.toFixed(1)}%` : '-'}
          </div>
        </article>
      </section>

      {/* 趋势图表 */}
      <section className="charts-row">
        <div className="chart-card">
          <div className="chart-header">
            <div>
              <h3>咨询人数趋势</h3>
              <p>活跃用户数量变化</p>
            </div>
          </div>
          <div className="chart-container">
            <Line data={consultationChartData} options={chartOptions} />
          </div>
        </div>
        <div className="chart-card">
          <div className="chart-header">
            <div>
              <h3>预约转化趋势</h3>
              <p>预约次数与成功率</p>
            </div>
          </div>
          <div className="chart-container">
            <Line data={bookingChartData} options={bookingChartOptions} />
          </div>
        </div>
      </section>

      {/* 每日趋势 */}
      <section className="charts-row">
        <div className="chart-card">
          <div className="chart-header">
            <div>
              <h3>每日 Token 消耗</h3>
              <p>最近 7 天使用量</p>
            </div>
            <div className="chart-kpi">
              <span>今日消耗</span>
              <strong>
                {dashboard?.dailyTrend?.[dashboard.dailyTrend.length - 1]?.tokenUsage ?? '-'}
              </strong>
            </div>
          </div>
          <div className="chart-container">
            <Bar data={tokenChartData} options={commonOptions} />
          </div>
        </div>
        <div className="chart-card">
          <div className="chart-header">
            <div>
              <h3>每日咨询人数</h3>
              <p>最近 7 天唯一用户</p>
            </div>
            <div className="chart-kpi">
              <span>今日人数</span>
              <strong>
                {dashboard?.dailyTrend?.[dashboard.dailyTrend.length - 1]?.uniqueUsers ?? '-'}
              </strong>
            </div>
          </div>
          <div className="chart-container">
            <Line data={dailyUserChartData} options={commonOptions} />
          </div>
        </div>
      </section>

      {/* 响应耗时 */}
      <section className="charts-row">
        <div className="chart-card" style={{ flex: 1 }}>
          <div className="chart-header">
            <div>
              <h3>响应耗时</h3>
              <p>最近 60 分钟平均响应时间</p>
            </div>
            <div className="chart-kpi">
              <span>当前平均</span>
              <strong>
                {dashboard?.overview?.avgDuration
                  ? formatDuration(dashboard.overview.avgDuration)
                  : '-'}
              </strong>
            </div>
          </div>
          <div className="chart-container">
            <Line data={responseChartData} options={commonOptions} />
          </div>
        </div>
      </section>
    </div>
  );
}
