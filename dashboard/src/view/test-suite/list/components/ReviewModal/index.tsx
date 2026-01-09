import { X, Check, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { TestExecution } from '@/services/agent-test';
import { FAILURE_REASONS } from '../../constants';
import { ExecutionDetailViewer } from '../ExecutionDetailViewer';
import { DetailSkeleton } from './DetailSkeleton';
import styles from './index.module.scss';

interface ReviewModalProps {
  execution: TestExecution;
  currentIndex: number;
  totalCount: number;
  showFailureOptions: boolean;
  loading?: boolean;
  detailLoading?: boolean;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onPass: () => void;
  onFail: (reason: string) => void;
  onShowFailureOptions: (show: boolean) => void;
}

/**
 * 评审弹窗组件
 */
export function ReviewModal({
  execution,
  currentIndex,
  totalCount,
  showFailureOptions,
  loading = false,
  detailLoading = false,
  onClose,
  onPrevious,
  onNext,
  onPass,
  onFail,
  onShowFailureOptions,
}: ReviewModalProps) {
  return (
    <div className={styles.reviewModal}>
      <div className={styles.reviewContent}>
        <div className={styles.reviewHeader}>
          <h3>
            用例详情 {currentIndex + 1}/{totalCount}
          </h3>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className={styles.reviewBody}>
          {detailLoading ? <DetailSkeleton /> : <ExecutionDetailViewer execution={execution} showHistory />}
        </div>

        <div className={styles.reviewFooter}>
          <div className={styles.reviewNav}>
            <button disabled={currentIndex === 0} onClick={onPrevious} title="上一个">
              <ChevronLeft size={16} />
            </button>
            <span>
              {currentIndex + 1} / {totalCount}
            </span>
            <button disabled={currentIndex === totalCount - 1} onClick={onNext} title="下一个">
              <ChevronRight size={16} />
            </button>
          </div>

          <div className={styles.reviewActions}>
            {showFailureOptions ? (
              <div className={styles.failureOptions}>
                <span className={styles.failureLabel}>选择原因：</span>
                {FAILURE_REASONS.map((reason) => (
                  <button
                    key={reason}
                    className={styles.failureReasonBtn}
                    onClick={() => onFail(reason)}
                  >
                    {reason}
                  </button>
                ))}
                <button className={styles.cancelFailBtn} onClick={() => onShowFailureOptions(false)}>
                  取消
                </button>
              </div>
            ) : execution.review_status === 'pending' ? (
              <>
                {loading ? (
                  <div className={styles.loadingState}>
                    <Loader2 size={20} className={styles.spinner} />
                    <span>处理中...</span>
                  </div>
                ) : (
                  <>
                    <button
                      className={styles.failBtn}
                      onClick={() => onShowFailureOptions(true)}
                      data-tip="不通过"
                    >
                      <X size={22} />
                    </button>
                    <button className={styles.passBtn} onClick={onPass} data-tip="通过">
                      <Check size={22} />
                    </button>
                  </>
                )}
              </>
            ) : (
              <div className={styles.reviewedTag}>
                {execution.review_status === 'passed' ? (
                  <>
                    <Check size={14} /> 已通过
                  </>
                ) : (
                  <>
                    <X size={14} /> 已标记失败
                  </>
                )}
                {execution.failure_reason && (
                  <span className={styles.failureReasonText}>（{execution.failure_reason}）</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ReviewModal;
