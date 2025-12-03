import { Line } from 'react-chartjs-2';
import type { ChartData, ChartOptions } from 'chart.js';
import type { AgentReplyConfig } from '@/types/monitoring';
import styles from './index.module.scss';

interface AlertType {
  type: string;
  count: number;
  percentage: number;
}

interface ConsolePanelProps {
  alertConfig: {
    businessAlertEnabled: boolean;
    minSamplesForAlert: number;
    alertIntervalMinutes: number;
  };
  onConfigChange: (key: keyof AgentReplyConfig, value: number | boolean) => void;
  onToggleAlert: () => void;
  isUpdating: boolean;
  chartData: ChartData<'line'>;
  chartOptions: ChartOptions<'line'>;
  recentAlertCount: number | null;
  alertTypes: AlertType[] | null;
}

export default function ConsolePanel({
  alertConfig,
  onConfigChange,
  onToggleAlert,
  isUpdating,
  chartData,
  chartOptions,
  recentAlertCount,
  alertTypes,
}: ConsolePanelProps) {
  return (
    <section className={styles.panel}>
      {/* 装饰 */}
      <div className={styles.decoration}>🌿</div>

      {/* 控制区域 */}
      <div className={styles.controlSection}>
        <div className={styles.headerRow}>
          <div className={styles.titleGroup}>
            <span className={styles.titleIcon}>🎛️</span>
            <h3 className={styles.title}>监控配置</h3>
          </div>
          <div className={styles.statusBadge}>
            <span className={styles.statusDot}></span> 实时监控中
          </div>
        </div>

        <div className={styles.controlGrid}>
          {/* 告警开关 */}
          <div className={`${styles.controlBox} ${alertConfig.businessAlertEnabled ? styles.active : ''}`}>
            <div className={styles.controlBoxHeader}>
              <span className={styles.controlBoxTitle}>告警总开关</span>
              <button
                onClick={onToggleAlert}
                disabled={isUpdating}
                className={`${styles.toggle} ${alertConfig.businessAlertEnabled ? styles.active : ''}`}
              >
                <div className={styles.toggleHandle}></div>
              </button>
            </div>
            <p className={styles.controlBoxDesc}>开启后，系统将自动监控异常指标并发送飞书告警。</p>
          </div>

          {/* 最小样本量 */}
          <div className={styles.controlBox}>
            <div className={styles.controlBoxHeader}>
              <span className={styles.controlBoxTitle}>
                最小样本量: {alertConfig.minSamplesForAlert}
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={50}
              step={1}
              value={alertConfig.minSamplesForAlert}
              onChange={(e) => onConfigChange('minSamplesForAlert', Number(e.target.value))}
              className={styles.slider}
            />
            <p className={styles.controlBoxDesc}>
              触发告警所需的最小请求数。防止因流量过小导致的误报。
            </p>
          </div>

          {/* 告警间隔 */}
          <div className={styles.controlBox}>
            <div className={styles.controlBoxHeader}>
              <span className={styles.controlBoxTitle}>
                告警间隔: {alertConfig.alertIntervalMinutes}m
              </span>
            </div>
            <input
              type="range"
              min={5}
              max={120}
              step={5}
              value={alertConfig.alertIntervalMinutes}
              onChange={(e) => onConfigChange('alertIntervalMinutes', Number(e.target.value))}
              className={styles.slider}
            />
            <p className={styles.controlBoxDesc}>
              相同告警的静默时间。在此时间内，不会重复发送相同的告警通知。
            </p>
          </div>
        </div>
      </div>

      {/* 内容区域 */}
      <div className={styles.content}>
        {/* 图表区 */}
        <div className={styles.chartArea}>
          <div className={styles.areaHeader}>
            <h4>告警趋势</h4>
            <div className={styles.kpiBadge}>
              近5分钟: <strong>{recentAlertCount ?? '-'}</strong>
            </div>
          </div>
          <div className={styles.chartWrapper}>
            <Line data={chartData} options={chartOptions} />
          </div>
        </div>

        {/* 列表区 */}
        <div className={styles.listArea}>
          <div className={styles.areaHeader}>
            <h4>告警分布</h4>
          </div>
          <div className={styles.alertList}>
            {!alertTypes || alertTypes.length === 0 ? (
              <div className={styles.emptyState}>暂无数据</div>
            ) : (
              alertTypes.slice(0, 6).map((item, i) => (
                <div key={i} className={styles.alertRow}>
                  <div className={styles.alertRowInfo}>
                    <span className={styles.alertName}>{item.type}</span>
                    <span className={styles.alertCount}>{item.count}</span>
                  </div>
                  <div className={styles.progressBg}>
                    <div
                      className={styles.progressFill}
                      style={{ width: `${item.percentage}%` }}
                    ></div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
