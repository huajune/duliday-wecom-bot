import { useState, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import { updateReview, writeBackToFeishu, TestExecution } from '@/services/agent-test';

interface UseReviewOptions {
  executions: TestExecution[];
  onExecutionsChange: (executions: TestExecution[]) => void;
  onReviewComplete?: () => void;
}

/**
 * 评审功能 Hook
 */
export function useReview({ executions, onExecutionsChange, onReviewComplete }: UseReviewOptions) {
  // 评审状态
  const [reviewMode, setReviewMode] = useState(false);
  const [currentReviewIndex, setCurrentReviewIndex] = useState<number>(-1);
  const [showFailureOptions, setShowFailureOptions] = useState(false);
  // 是否为批量评审模式（通过"开始评审"按钮进入）
  const [isBatchReviewMode, setIsBatchReviewMode] = useState(false);
  // 评审操作 loading 状态
  const [reviewLoading, setReviewLoading] = useState(false);

  // 当前评审的用例
  const currentExecution = useMemo(() => {
    return currentReviewIndex >= 0 ? executions[currentReviewIndex] : null;
  }, [currentReviewIndex, executions]);

  // 待评审数量
  const pendingCount = useMemo(() => {
    return executions.filter((e) => e.review_status === 'pending').length;
  }, [executions]);

  // 开始批量评审（通过"开始评审"按钮）
  const startReview = useCallback(() => {
    const pendingIndex = executions.findIndex((e) => e.review_status === 'pending');
    if (pendingIndex === -1) {
      toast('所有用例已评审完成');
      return;
    }
    setCurrentReviewIndex(pendingIndex);
    setReviewMode(true);
    setIsBatchReviewMode(true);
  }, [executions]);

  // 关闭评审
  const closeReview = useCallback(() => {
    setReviewMode(false);
    setCurrentReviewIndex(-1);
    setShowFailureOptions(false);
    setIsBatchReviewMode(false);
  }, []);

  // 打开指定用例的详情（单个查看模式）
  const openExecution = useCallback((index: number) => {
    setCurrentReviewIndex(index);
    setReviewMode(true);
    setIsBatchReviewMode(false);
  }, []);

  // 导航到上一个
  const goToPrevious = useCallback(() => {
    if (currentReviewIndex > 0) {
      setCurrentReviewIndex(currentReviewIndex - 1);
      setShowFailureOptions(false);
    }
  }, [currentReviewIndex]);

  // 导航到下一个
  const goToNext = useCallback(() => {
    if (currentReviewIndex < executions.length - 1) {
      setCurrentReviewIndex(currentReviewIndex + 1);
      setShowFailureOptions(false);
    }
  }, [currentReviewIndex, executions.length]);

  // 评审操作
  const handleReview = useCallback(
    async (status: 'passed' | 'failed', failureCategory?: string) => {
      if (currentReviewIndex < 0) return;
      const exec = executions[currentReviewIndex];

      setReviewLoading(true);
      try {
        await updateReview(exec.id, {
          reviewStatus: status,
          reviewedBy: 'dashboard-user',
          failureReason: failureCategory,
        });

        // 回写飞书（后台执行，不阻塞）
        if (exec.case_id) {
          const feishuStatus = status === 'passed' ? '通过' : '失败';
          writeBackToFeishu(exec.id, feishuStatus, failureCategory).catch((writeErr: unknown) => {
            const error = writeErr as { message?: string };
            console.warn('回写飞书失败:', error.message);
          });
        }

        // 更新本地状态
        const updated = [...executions];
        updated[currentReviewIndex] = {
          ...exec,
          review_status: status,
          reviewed_at: new Date().toISOString(),
          failure_reason: failureCategory || null,
        };
        onExecutionsChange(updated);

        // 显示成功提示
        toast.success(status === 'passed' ? '已标记通过' : '已标记失败');

        // 重置失败选项状态
        setShowFailureOptions(false);

        // 如果不是批量评审模式，直接关闭弹窗
        if (!isBatchReviewMode) {
          closeReview();
          onReviewComplete?.();
          return;
        }

        // 批量评审模式：移动到下一个待评审
        const nextPending = updated.findIndex(
          (e, i) => i > currentReviewIndex && e.review_status === 'pending',
        );
        if (nextPending !== -1) {
          setCurrentReviewIndex(nextPending);
        } else {
          const prevPending = updated.findIndex((e) => e.review_status === 'pending');
          if (prevPending !== -1) {
            setCurrentReviewIndex(prevPending);
          } else {
            // 所有用例评审完成
            toast.success('所有用例评审完成');
            closeReview();
            onReviewComplete?.();
          }
        }
      } catch (err: unknown) {
        const error = err as { message?: string };
        toast.error(error.message || '更新状态失败');
      } finally {
        setReviewLoading(false);
      }
    },
    [currentReviewIndex, executions, onExecutionsChange, closeReview, onReviewComplete, isBatchReviewMode],
  );

  return {
    // 状态
    reviewMode,
    currentReviewIndex,
    currentExecution,
    pendingCount,
    showFailureOptions,
    reviewLoading,

    // 操作
    setShowFailureOptions,
    startReview,
    closeReview,
    openExecution,
    goToPrevious,
    goToNext,
    handleReview,
  };
}
