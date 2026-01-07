import { BatchStats } from '@/services/agent-test';
import { Layers, CheckCircle2, XCircle, Clock, Activity, Timer } from 'lucide-react';
import styles from './index.module.scss';

interface StatsRowProps {
  stats: BatchStats;
}

/**
 * 统计卡片行组件
 */
export function StatsRow({ stats }: StatsRowProps) {
  return (
    <div className={styles.statsRow}>
      <div className={styles.statCard}>
        <div className={styles.statValue}>{stats.totalCases}</div>
        <div className={styles.statLabel}>
          <Layers size={12} />
          总用例
        </div>
      </div>
      <div className={styles.divider} />
      <div className={styles.statCard}>
        <div className={`${styles.statValue} ${styles.success}`}>{stats.passedCount}</div>
        <div className={styles.statLabel}>
          <CheckCircle2 size={12} />
          通过
        </div>
      </div>
      <div className={styles.divider} />
      <div className={styles.statCard}>
        <div className={`${styles.statValue} ${styles.danger}`}>{stats.failedCount}</div>
        <div className={styles.statLabel}>
          <XCircle size={12} />
          失败
        </div>
      </div>
      <div className={styles.divider} />
      <div className={styles.statCard}>
        <div className={`${styles.statValue} ${styles.warning}`}>{stats.pendingReviewCount}</div>
        <div className={styles.statLabel}>
          <Clock size={12} />
          待评审
        </div>
      </div>
      <div className={styles.divider} />
      <div className={styles.statCard}>
        <div className={styles.statValue}>
          {stats.passRate !== null ? `${stats.passRate.toFixed(1)}%` : '-'}
        </div>
        <div className={styles.statLabel}>
          <Activity size={12} />
          通过率
        </div>
      </div>
      <div className={styles.divider} />
      <div className={styles.statCard}>
        <div className={styles.statValue}>
          {stats.avgDurationMs ? `${(stats.avgDurationMs / 1000).toFixed(1)}s` : '-'}
        </div>
        <div className={styles.statLabel}>
          <Timer size={12} />
          平均耗时
        </div>
      </div>
    </div>
  );
}

export default StatsRow;
