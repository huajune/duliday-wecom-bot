import { useState, useEffect } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import {
  useDashboard,
  useMetrics,
  useAgentReplyConfig,
  useUpdateAgentReplyConfig,
} from '@/hooks/useMonitoring';
import { formatTime, formatDuration, formatMinuteLabel } from '@/utils/format';

import type { AgentReplyConfig } from '@/types/monitoring';

// 注册 Chart.js 组件
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

export default function System() {
  const [timeRange] = useState<'today' | 'week' | 'month'>('today');
  const { data: dashboard } = useDashboard(timeRange);
  const { data: metrics } = useMetrics();
  const { data: configData } = useAgentReplyConfig();
  const updateConfig = useUpdateAgentReplyConfig();

  // 告警配置本地状态
  const [alertConfig, setAlertConfig] = useState({
    businessAlertEnabled: true,
    minSamplesForAlert: 10,
    alertIntervalMinutes: 30,
    alertThrottleWindowMs: 300000,
    alertThrottleMaxCount: 3,
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
      });
    }
  }, [configData]);



  const queue = dashboard?.queue;
  const alerts = dashboard?.alertsSummary;
  const percentiles = metrics?.percentiles;

  // 更新配置
  const handleConfigChange = (key: keyof AgentReplyConfig, value: number | boolean) => {
    const newConfig = { ...alertConfig, [key]: value };
    setAlertConfig(newConfig);
    updateConfig.mutate(newConfig);
  };

  // 切换告警开关
  const toggleAlert = () => {
    handleConfigChange('businessAlertEnabled', !alertConfig.businessAlertEnabled);
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

  // 告警趋势 - 圣诞红 #ef4444
  const alertChartData = {
    labels: (dashboard?.alertTrend || []).slice(-60).map((p) => formatMinuteLabel(p.minute)),
    datasets: [
      {
        label: '告警次数',
        data: (dashboard?.alertTrend || []).slice(-60).map((p) => p.count || 0),
        backgroundColor: '#ef4444', // Red
        borderRadius: 6,
        hoverBackgroundColor: '#dc2626',
      },
    ],
  };

  // 图表通用配置 - 与 monitoring.html 一致
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        titleColor: '#1f2937',
        bodyColor: '#6b7280',
        borderColor: '#e5e7eb',
        borderWidth: 1,
        padding: 12,
        boxPadding: 6,
        usePointStyle: true,
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



  return (
    <div id="page-system" className="page-section active">
      {/* 告警控制面板 */}
      <section className="alert-control-panel">
        {/* 告警总开关 */}
        <div className={`control-card toggle-card ${alertConfig.businessAlertEnabled ? 'active' : ''}`}>
          <div>
            <div className="control-title">业务指标告警</div>
            <div className="control-subtitle">检查成功率、响应时间等指标</div>
          </div>
          <button
            onClick={toggleAlert}
            disabled={updateConfig.isPending}
            className={`control-toggle-btn ${alertConfig.businessAlertEnabled ? 'active' : ''}`}
          >
            <span className="control-toggle-handle" />
          </button>
        </div>

        {/* 最小样本量 */}
        <div className="control-card">
          <div className="control-card-header">
            <div>
              <div className="control-title">最小样本量</div>
              <div className="control-subtitle">消息数低于此值不检查</div>
            </div>
            <div className="control-value">{alertConfig.minSamplesForAlert}</div>
          </div>
          <input
            type="range"
            min={1}
            max={50}
            step={1}
            value={alertConfig.minSamplesForAlert}
            onChange={(e) => handleConfigChange('minSamplesForAlert', Number(e.target.value))}
            className="control-slider"
          />
          <div className="control-labels">
            <span>1 条</span>
            <span>50 条</span>
          </div>
        </div>

        {/* 告警间隔 */}
        <div className="control-card">
          <div className="control-card-header">
            <div>
              <div className="control-title">告警间隔</div>
              <div className="control-subtitle">同类告警最小间隔</div>
            </div>
            <div className="control-value">
              {alertConfig.alertIntervalMinutes}
              <span style={{ fontSize: '12px', fontWeight: 400 }}> 分钟</span>
            </div>
          </div>
          <input
            type="range"
            min={5}
            max={120}
            step={5}
            value={alertConfig.alertIntervalMinutes}
            onChange={(e) => handleConfigChange('alertIntervalMinutes', Number(e.target.value))}
            className="control-slider"
          />
          <div className="control-labels">
            <span>5 分钟</span>
            <span>2 小时</span>
          </div>
        </div>
      </section>

      {/* 运维洞察 */}
      <section className="insight-grid">
        <article className="insight-card">
          <div className="insight-title">排队与响应</div>
          <div className="insight-metrics">
            <div>
              <span>实时处理中</span>
              <strong>{queue?.currentProcessing ?? '-'}</strong>
            </div>
            <div>
              <span>峰值队列</span>
              <strong>{queue?.peakProcessing ?? '-'}</strong>
            </div>
            <div>
              <span>平均等待</span>
              <strong>
                {queue?.avgQueueDuration ? formatDuration(queue.avgQueueDuration) : '-'}
              </strong>
            </div>
          </div>
        </article>

        <article className="insight-card">
          <div className="insight-title">延迟分布</div>
          <div className="percentiles">
            <div>
              <span>P50</span>
              <strong>{percentiles?.p50 ? formatDuration(percentiles.p50) : '-'}</strong>
            </div>
            <div>
              <span>P95</span>
              <strong>{percentiles?.p95 ? formatDuration(percentiles.p95) : '-'}</strong>
            </div>
            <div>
              <span>P99</span>
              <strong>{percentiles?.p99 ? formatDuration(percentiles.p99) : '-'}</strong>
            </div>
          </div>
        </article>

        <article className="insight-card">
          <div className="insight-title">告警概览</div>
          <div className="insight-metrics">
            <div>
              <span>累计</span>
              <strong>{alerts?.total ?? '-'}</strong>
            </div>
            <div>
              <span>近24小时</span>
              <strong>{alerts?.last24Hours ?? '-'}</strong>
            </div>
          </div>
        </article>

        <article className="insight-card">
          <div className="insight-title">告警类型分布</div>
          <div className="alert-type-list">
            {!alerts?.byType || alerts.byType.length === 0 ? (
              <div className="loading-sm">
                暂无数据
              </div>
            ) : (
              alerts.byType.map((item, i) => {
                const typeLabels: Record<string, string> = {
                  agent: 'AI 代理',
                  message: '消息处理',
                  delivery: '消息发送',
                  merge: '消息合并',
                  unknown: '未知类型',
                };
                return (
                  <div key={i} className="alert-type-item">
                    <div className="alert-type-label">
                      <span>{typeLabels[item.type] || item.type}</span>
                    </div>
                    <div className="alert-type-bar">
                      <div
                        className={`alert-type-bar-fill ${item.type}`}
                        style={{ width: `${item.percentage}%` }}
                      ></div>
                    </div>
                    <div className="alert-type-stats">
                      <span className="alert-type-count">{item.count}</span>
                      <span className="alert-type-percentage">{item.percentage}%</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </article>
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
            <Bar data={tokenChartData} options={chartOptions} />
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
            <Line data={dailyUserChartData} options={chartOptions} />
          </div>
        </div>
      </section>

      {/* 实时性能 */}
      <section className="charts-row">
        <div className="chart-card">
          <div className="chart-header">
            <div>
              <h3>响应耗时</h3>
              <p>最近 60 分钟</p>
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
            <Line data={responseChartData} options={chartOptions} />
          </div>
        </div>
        <div className="chart-card">
          <div className="chart-header">
            <div>
              <h3>告警趋势</h3>
              <p>最近 60 分钟</p>
            </div>
            <div className="chart-kpi">
              <span>近5分钟</span>
              <strong>{metrics?.todayAlerts ?? '-'}</strong>
            </div>
          </div>
          <div className="chart-container">
            <Bar data={alertChartData} options={chartOptions} />
          </div>
        </div>
      </section>

      {/* 最慢记录 */}
      <section className="section">
        <div className="section-header">
          <h3>最慢记录 (Top 10)</h3>
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>用户</th>
                <th>消息预览</th>
                <th>总耗时</th>
                <th>AI 耗时</th>
                <th>回复条数</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {(metrics?.slowestRecords || []).length === 0 ? (
                <tr>
                  <td colSpan={7} className="loading">
                    暂无数据
                  </td>
                </tr>
              ) : (
                (metrics?.slowestRecords || []).map((record, i) => (
                  <tr key={i}>
                    <td>{formatTime(record.receivedAt)}</td>
                    <td>{record.userName || record.chatId}</td>
                    <td className="table-cell-truncate">
                      {record.messagePreview || '-'}
                    </td>
                    <td>{formatDuration(record.totalDuration)}</td>
                    <td>{formatDuration(record.aiDuration ?? 0)}</td>
                    <td>{record.replySegments ?? '-'}</td>
                    <td>
                      <span
                        className={`status-badge ${record.status === 'success' ? 'success' : 'danger'}`}
                      >
                        {record.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
