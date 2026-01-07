import { FolderOpen, Sparkles } from 'lucide-react';
import { TestBatch } from '@/services/agent-test';
import { getBatchStatusDisplay } from '../../constants';
import styles from './index.module.scss';

interface BatchListProps {
  batches: TestBatch[];
  selectedBatch: TestBatch | null;
  loading: boolean;
  onSelect: (batch: TestBatch) => void;
}

/**
 * 批次列表组件
 */
export function BatchList({ batches, selectedBatch, loading, onSelect }: BatchListProps) {
  return (
    <div className={styles.batchPanel}>
      <div className={styles.panelHeader}>
        <h3>
          <FolderOpen size={18} /> 测试批次
        </h3>
        <span className={styles.badge}>{batches.length}</span>
      </div>

      <div className={styles.batchList}>
        {loading && batches.length === 0 ? (
          <div className={`${styles.loadingState} ${styles.centered}`}>
            <div className={styles.spinner} />
            <p>加载中...</p>
          </div>
        ) : batches.length === 0 ? (
          <div className={styles.emptyState}>
            <Sparkles size={40} strokeWidth={1} />
            <p>暂无测试批次</p>
            <p className={styles.hint}>点击"一键测试"创建</p>
          </div>
        ) : (
          batches.map((batch) => {
            const status = getBatchStatusDisplay(batch.status);
            const reviewedCount = batch.total_cases - (batch.pending_review_count || 0);
            return (
              <div
                key={batch.id}
                className={`${styles.batchItem} ${selectedBatch?.id === batch.id ? styles.selected : ''}`}
                onClick={() => onSelect(batch)}
              >
                {/* 第一行：标题 + 状态 */}
                <div className={styles.batchRow}>
                  <div className={styles.batchName}>{batch.name}</div>
                  <span className={`${styles.batchStatusTag} ${styles[status.className]}`}>
                    {status.text}
                  </span>
                </div>
                {/* 第二行：统计信息 */}
                <div className={styles.batchMeta}>
                  <span>用例 {batch.total_cases}</span>
                  <span className={styles.sep}>·</span>
                  <span>评审 {batch.total_cases > 0 ? Math.round((reviewedCount / batch.total_cases) * 100) : 0}%</span>
                  <span className={styles.sep}>·</span>
                  <span>通过 {batch.pass_rate !== null ? `${batch.pass_rate.toFixed(0)}%` : '-'}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default BatchList;
