import { Activity, ChevronRight, Check, X, Clock, Loader2, AlertTriangle } from 'lucide-react';
import { TestExecution } from '@/services/agent-test';
import styles from './index.module.scss';

interface CaseListProps {
  executions: TestExecution[];
  currentReviewIndex: number;
  reviewMode: boolean;
  onSelect: (index: number) => void;
}

// 执行状态图标配置
const getExecStatusIcon = (status: string) => {
  const config: Record<string, { icon: typeof Check; className: string; title: string }> = {
    success: { icon: Check, className: 'execSuccess', title: '执行成功' },
    failure: { icon: X, className: 'execFailure', title: '执行失败' },
    running: { icon: Loader2, className: 'execRunning', title: '执行中' },
    pending: { icon: Clock, className: 'execPending', title: '等待执行' },
    timeout: { icon: AlertTriangle, className: 'execFailure', title: '执行超时' },
  };
  return config[status] || config.pending;
};

// 评审状态图标配置
const getReviewStatusIcon = (status: string) => {
  const config: Record<string, { icon: typeof Check; className: string; title: string }> = {
    passed: { icon: Check, className: 'reviewPassed', title: '评审通过' },
    failed: { icon: X, className: 'reviewFailed', title: '评审不通过' },
    pending: { icon: Clock, className: 'reviewPending', title: '待评审' },
    skipped: { icon: Clock, className: 'reviewPending', title: '跳过评审' },
  };
  return config[status] || config.pending;
};

// 分类标签颜色映射（根据分类编号）
const getCategoryStyle = (category: string | null | undefined): string => {
  if (!category) return 'categoryDefault';
  // 提取分类编号（如 "1-缺少品牌名" -> "1"）
  const match = category.match(/^(\d+)-/);
  if (!match) return 'categoryDefault';
  const num = parseInt(match[1], 10);
  // 根据编号返回不同的颜色类
  const colorClasses = [
    'category1', 'category2', 'category3', 'category4',
    'category5', 'category6', 'category7', 'category8',
    'category9', 'category10', 'category11',
  ];
  return colorClasses[(num - 1) % colorClasses.length] || 'categoryDefault';
};

/**
 * 用例列表组件
 */
export function CaseList({ executions, currentReviewIndex, reviewMode, onSelect }: CaseListProps) {
  return (
    <>
      <div className={styles.caseListHeader}>
        <h4>
          <Activity size={16} /> 测试用例
        </h4>
        <span className={styles.caseCount}>共 {executions.length} 条</span>
      </div>

      <div className={styles.caseList}>
        {executions.map((exec, index) => {
          const execStatus = getExecStatusIcon(exec.execution_status);
          const reviewStatus = getReviewStatusIcon(exec.review_status);
          const ExecIcon = execStatus.icon;
          const ReviewIcon = reviewStatus.icon;

          return (
            <div
              key={exec.id}
              className={`${styles.caseItem} ${
                reviewMode && currentReviewIndex === index ? styles.reviewing : ''
              }`}
              onClick={() => onSelect(index)}
            >
              <div className={styles.caseIndex}>{index + 1}</div>
              <div className={styles.caseContent}>
                <div className={styles.caseNameRow}>
                  <span className={styles.caseName}>{exec.case_name || '未命名用例'}</span>
                  {exec.category && (
                    <span className={`${styles.categoryTag} ${styles[getCategoryStyle(exec.category)]}`}>
                      {exec.category}
                    </span>
                  )}
                </div>
                <div className={styles.caseMessage}>
                  {exec.input_message || exec.test_input?.message || '-'}
                </div>
              </div>
              <div className={styles.caseStatus}>
                <div className={styles.statusGroup} title={execStatus.title}>
                  <span className={styles.statusLabel}>执行</span>
                  <span className={`${styles.statusIcon} ${styles[execStatus.className]}`}>
                    <ExecIcon size={12} />
                  </span>
                </div>
                <div className={styles.statusGroup} title={reviewStatus.title}>
                  <span className={styles.statusLabel}>评审</span>
                  <span className={`${styles.statusIcon} ${styles[reviewStatus.className]}`}>
                    <ReviewIcon size={12} />
                  </span>
                </div>
                <ChevronRight size={14} className={styles.chevron} />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

export default CaseList;
