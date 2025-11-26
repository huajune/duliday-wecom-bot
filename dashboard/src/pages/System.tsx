import { useState, useEffect } from 'react';
import { Line } from 'react-chartjs-2';
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
import { formatDuration, formatMinuteLabel } from '@/utils/format';

import type { AgentReplyConfig } from '@/types/monitoring';

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

  // Mock Data for Visualization
  const mockData = {
    queue: {
      currentProcessing: 12,
      peakProcessing: 45,
      avgQueueDuration: 1250, // 1.25s
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
    alertTrend: Array.from({ length: 60 }, (_, i) => ({
      minute: new Date(Date.now() - (59 - i) * 60000).toISOString(),
      count: Math.random() > 0.8 ? Math.floor(Math.random() * 5) : 0,
    })),
  };

  // Use Mock Data instead of real data
  const queue = mockData.queue;
  const alerts = mockData.alertsSummary;
  const percentiles = mockData.percentiles;
  const recentAlertCount = mockData.recentAlertCount;
  const alertTrend = mockData.alertTrend;

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

  // 告警趋势 - 渐变红 Line Chart
  const alertChartData = {
    labels: alertTrend.map((p) => formatMinuteLabel(p.minute)),
    datasets: [
      {
        label: '告警次数',
        data: alertTrend.map((p) => p.count || 0),
        borderColor: '#ef4444',
        backgroundColor: (context: any) => {
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
        tension: 0.4, // Smooth curves
      },
    ],
  };

  // 图表通用配置
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
          label: (context: any) => `${context.parsed.y} 次告警`,
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
        grid: { color: 'rgba(0, 0, 0, 0.02)', drawBorder: false },
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
    <div id="page-system" className="page-section active" style={{ paddingBottom: '40px' }}>

      {/* 1. Top Row: KPI Cards */}
      <div className="kpi-grid">
        <div className="glass-panel kpi-card" title="当前正在处理的消息数量">
          <div className="kpi-icon primary-bg">⚡️</div>
          <div className="kpi-content">
            <div className="kpi-label">实时处理</div>
            <div className="kpi-value primary">{queue?.currentProcessing ?? '-'}</div>
            <div className="kpi-trend up">↗ +12% <span className="trend-label">较上小时</span></div>
          </div>
        </div>
        <div className="glass-panel kpi-card" title="95% 的请求在此时间内完成">
          <div className="kpi-icon warning-bg">⏱️</div>
          <div className="kpi-content">
            <div className="kpi-label">P95 延迟</div>
            <div className="kpi-value warning">{percentiles?.p95 ? formatDuration(percentiles.p95) : '-'}</div>
            <div className="kpi-trend down">↘ -5ms <span className="trend-label">性能优化</span></div>
          </div>
        </div>
        <div className="glass-panel kpi-card" title="今日累计触发的告警总数">
          <div className="kpi-icon danger-bg">🚨</div>
          <div className="kpi-content">
            <div className="kpi-label">今日告警</div>
            <div className="kpi-value danger">{alerts?.total ?? '-'}</div>
            <div className="kpi-trend up">↗ +3 <span className="trend-label">新增异常</span></div>
          </div>
        </div>
        <div className="glass-panel kpi-card" title="今日队列积压的最大数量">
          <div className="kpi-icon info-bg">🌊</div>
          <div className="kpi-content">
            <div className="kpi-label">峰值队列</div>
            <div className="kpi-value">{queue?.peakProcessing ?? '-'}</div>
            <div className="kpi-trend flat">→ 平稳 <span className="trend-label">负载正常</span></div>
          </div>
        </div>
      </div>

      {/* 2. Main Console Panel */}
      <section className="glass-panel console-panel">
        {/* Decoration: Holly */}
        <div style={{ position: 'absolute', top: '-10px', right: '-10px', fontSize: '64px', opacity: 0.05, transform: 'rotate(15deg)', pointerEvents: 'none' }}>🌿</div>

        {/* Control Section with Explanations */}
        <div className="control-section">
          <div className="control-header-row">
            <div className="control-title-group">
              <span style={{ fontSize: '20px' }}>🎛️</span>
              <h3 className="panel-title">监控配置</h3>
            </div>
            <div className="last-updated">
              <span className="status-dot"></span> 实时监控中
            </div>
          </div>

          <div className="control-cards-grid">
            {/* Card 1: Switch */}
            <div className={`control-box ${alertConfig.businessAlertEnabled ? 'active' : ''}`}>
              <div className="control-box-header">
                <span className="control-box-title">告警总开关</span>
                <button
                  onClick={toggleAlert}
                  disabled={updateConfig.isPending}
                  className={`mini-toggle ${alertConfig.businessAlertEnabled ? 'active' : ''}`}
                >
                  <div className="mini-toggle-handle"></div>
                </button>
              </div>
              <p className="control-box-desc">开启后，系统将自动监控异常指标并发送飞书告警。</p>
            </div>

            {/* Card 2: Min Samples */}
            <div className="control-box">
              <div className="control-box-header">
                <span className="control-box-title">最小样本量: {alertConfig.minSamplesForAlert}</span>
              </div>
              <input
                type="range"
                min={1}
                max={50}
                step={1}
                value={alertConfig.minSamplesForAlert}
                onChange={(e) => handleConfigChange('minSamplesForAlert', Number(e.target.value))}
                className="mini-slider"
              />
              <p className="control-box-desc">触发告警所需的最小请求数。防止因流量过小（如1次失败）导致的误报。</p>
            </div>

            {/* Card 3: Interval */}
            <div className="control-box">
              <div className="control-box-header">
                <span className="control-box-title">告警间隔: {alertConfig.alertIntervalMinutes}m</span>
              </div>
              <input
                type="range"
                min={5}
                max={120}
                step={5}
                value={alertConfig.alertIntervalMinutes}
                onChange={(e) => handleConfigChange('alertIntervalMinutes', Number(e.target.value))}
                className="mini-slider"
              />
              <p className="control-box-desc">相同告警的静默时间。在此时间内，不会重复发送相同的告警通知。</p>
            </div>
          </div>
        </div>

        <div className="console-content">
          {/* Left: Chart */}
          <div className="chart-area">
            <div className="area-header">
              <h4>告警趋势</h4>
              <div className="kpi-badge">
                近5分钟: <strong>{recentAlertCount ?? '-'}</strong>
              </div>
            </div>
            <div className="chart-wrapper">
              <Line data={alertChartData} options={chartOptions} />
            </div>
          </div>

          {/* Right: List */}
          <div className="list-area">
            <div className="area-header">
              <h4>告警分布</h4>
            </div>
            <div className="alert-list-container">
              {!alerts?.byType || alerts.byType.length === 0 ? (
                <div className="loading-sm">暂无数据</div>
              ) : (
                alerts.byType.slice(0, 6).map((item, i) => (
                  <div key={i} className="alert-row">
                    <div className="alert-row-info">
                      <span className="alert-name">{item.type}</span>
                      <span className="alert-count">{item.count}</span>
                    </div>
                    <div className="alert-progress-bg">
                      <div className="alert-progress-fill" style={{ width: `${item.percentage}%` }}></div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Local Styles */}
      <style>{`


        /* Grid */
        .kpi-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 20px;
          margin-bottom: 24px;
        }

        /* Glass Panel */
        .glass-panel {
          background: #fff;
          border-radius: 20px;
          box-shadow: 0 8px 30px rgba(0,0,0,0.04);
          border: 1px solid rgba(255,255,255,0.6);
          position: relative;
          overflow: hidden;
        }

        /* KPI Cards */
        .kpi-card {
          padding: 20px;
          display: flex;
          align-items: center;
          gap: 16px;
          transition: transform 0.2s;
        }
        .kpi-card:hover { transform: translateY(-2px); }
        .kpi-icon {
          width: 44px;
          height: 44px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 22px;
        }
        .primary-bg { background: rgba(59, 130, 246, 0.08); color: var(--primary); }
        .warning-bg { background: rgba(245, 158, 11, 0.08); color: var(--warning); }
        .danger-bg { background: rgba(239, 68, 68, 0.08); color: var(--danger); }
        .info-bg { background: rgba(16, 185, 129, 0.08); color: #10b981; }
        
        .kpi-label { font-size: 13px; color: var(--text-secondary); margin-bottom: 2px; }
        .kpi-value { font-size: 22px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px; }
        .kpi-value.primary { color: var(--primary); }
        .kpi-value.warning { color: var(--warning); }
        .kpi-value.danger { color: var(--danger); }
        
        .kpi-trend { font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 4px; }
        .kpi-trend.up { color: var(--danger); }
        .kpi-trend.down { color: #10b981; }
        .kpi-trend.flat { color: var(--text-muted); }
        .trend-label { font-weight: 400; color: var(--text-muted); transform: scale(0.9); transform-origin: left; }



        /* Console Panel */
        .console-panel {
          padding: 0;
          display: flex;
          flex-direction: column;
        }

        /* Control Section */
        .control-section {
          padding: 20px 24px;
          border-bottom: 1px solid var(--border);
          background: rgba(249, 250, 251, 0.5);
        }
        
        .control-header-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }
        .control-title-group { display: flex; align-items: center; gap: 8px; }
        .panel-title { margin: 0; font-size: 16px; font-weight: 600; }

        .control-cards-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
        }

        .control-box {
          background: #fff;
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 12px 16px;
          transition: all 0.2s;
        }
        .control-box:hover {
          border-color: rgba(0,0,0,0.1);
          box-shadow: 0 2px 8px rgba(0,0,0,0.02);
        }
        .control-box.active {
          border-color: var(--primary);
          background: rgba(59, 130, 246, 0.02);
        }

        .control-box-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }
        .control-box-title {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
        }
        .control-box-desc {
          margin: 8px 0 0 0;
          font-size: 12px;
          color: var(--text-muted);
          line-height: 1.4;
        }

        /* Mini Toggle */
        .mini-toggle {
          width: 32px;
          height: 18px;
          background: #e5e7eb;
          border-radius: 9px;
          border: none;
          padding: 2px;
          cursor: pointer;
          transition: all 0.3s;
          position: relative;
        }
        .mini-toggle.active { background: var(--primary); }
        .mini-toggle-handle {
          width: 14px;
          height: 14px;
          background: #fff;
          border-radius: 50%;
          transition: transform 0.3s;
          box-shadow: 0 1px 2px rgba(0,0,0,0.2);
        }
        .mini-toggle.active .mini-toggle-handle { transform: translateX(14px); }

        /* Mini Slider */
        .mini-slider {
          width: 100%;
          height: 4px;
          background: #e5e7eb;
          border-radius: 2px;
          -webkit-appearance: none;
          display: block;
          margin: 8px 0;
        }
        .mini-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 12px;
          height: 12px;
          background: var(--primary);
          border-radius: 50%;
          cursor: pointer;
          border: 2px solid #fff;
          box-shadow: 0 1px 2px rgba(0,0,0,0.1);
        }

        .last-updated { font-size: 12px; color: var(--text-muted); display: flex; align-items: center; gap: 6px; }
        .status-dot { width: 6px; height: 6px; background: #10b981; border-radius: 50%; animation: pulse 2s infinite; }

        /* Console Content */
        .console-content {
          display: grid;
          grid-template-columns: 2fr 1fr;
          min-height: 400px;
        }
        .chart-area {
          padding: 24px;
          border-right: 1px solid var(--border);
          display: flex;
          flex-direction: column;
        }
        .list-area {
          padding: 24px;
          background: rgba(249, 250, 251, 0.3);
        }

        .area-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }
        .area-header h4 { margin: 0; font-size: 14px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
        
        .kpi-badge {
          font-size: 12px;
          color: var(--text-muted);
          background: rgba(0,0,0,0.03);
          padding: 4px 12px;
          border-radius: 12px;
        }
        .kpi-badge strong { color: var(--danger); margin-left: 4px; }

        .chart-wrapper { flex: 1; position: relative; }

        /* Alert List */
        .alert-list-container { display: flex; flex-direction: column; gap: 12px; }
        .alert-row {
          background: #fff;
          padding: 12px 16px;
          border-radius: 12px;
          border: 1px solid rgba(0,0,0,0.03);
          box-shadow: 0 2px 8px rgba(0,0,0,0.02);
          transition: transform 0.2s;
        }
        .alert-row:hover { transform: translateX(4px); border-color: rgba(0,0,0,0.06); }
        
        .alert-row-info { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px; }
        .alert-name { font-weight: 500; color: var(--text-primary); }
        .alert-count { font-weight: 700; color: var(--danger); background: rgba(239, 68, 68, 0.1); padding: 2px 8px; border-radius: 8px; font-size: 12px; }
        
        .alert-progress-bg { height: 4px; background: #f3f4f6; border-radius: 2px; overflow: hidden; }
        .alert-progress-fill { height: 100%; background: linear-gradient(90deg, #fca5a5, #ef4444); border-radius: 2px; }

        @keyframes pulse {
          0% { opacity: 1; box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); }
          70% { opacity: 0.7; box-shadow: 0 0 0 4px rgba(16, 185, 129, 0); }
          100% { opacity: 1; box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
        }
      `}</style>
    </div>
  );
}
