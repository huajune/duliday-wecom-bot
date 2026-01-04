import { useState, useCallback } from 'react';
import { submitFeedback, FeedbackType } from '@/services/agent-test';

export interface UseFeedbackOptions {
  onError?: (error: string) => void;
}

export interface UseFeedbackReturn {
  // Modal 状态
  isOpen: boolean;
  feedbackType: FeedbackType | null;
  errorType: string;
  remark: string;
  isSubmitting: boolean;
  successType: FeedbackType | null;

  // 操作
  openModal: (type: FeedbackType) => void;
  closeModal: () => void;
  setErrorType: (type: string) => void;
  setRemark: (remark: string) => void;
  submit: (chatHistory: string) => Promise<boolean>;
  clearSuccess: () => void;
}

/**
 * 反馈功能 Hook
 */
export function useFeedback({ onError }: UseFeedbackOptions = {}): UseFeedbackReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [feedbackType, setFeedbackType] = useState<FeedbackType | null>(null);
  const [errorType, setErrorType] = useState('');
  const [remark, setRemark] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successType, setSuccessType] = useState<FeedbackType | null>(null);

  const openModal = useCallback((type: FeedbackType) => {
    setFeedbackType(type);
    setErrorType('');
    setRemark('');
    setIsOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsOpen(false);
    setFeedbackType(null);
    setErrorType('');
    setRemark('');
  }, []);

  const submit = useCallback(
    async (chatHistory: string): Promise<boolean> => {
      if (!feedbackType || !chatHistory.trim()) return false;

      setIsSubmitting(true);
      try {
        await submitFeedback({
          type: feedbackType,
          chatHistory: chatHistory.trim(),
          errorType: errorType || undefined,
          remark: remark || undefined,
        });
        setSuccessType(feedbackType);
        closeModal();
        // 3 秒后清除成功状态
        setTimeout(() => setSuccessType(null), 3000);
        return true;
      } catch (err) {
        console.error('提交反馈失败:', err);
        onError?.('提交反馈失败，请重试');
        return false;
      } finally {
        setIsSubmitting(false);
      }
    },
    [feedbackType, errorType, remark, closeModal, onError],
  );

  const clearSuccess = useCallback(() => {
    setSuccessType(null);
  }, []);

  return {
    isOpen,
    feedbackType,
    errorType,
    remark,
    isSubmitting,
    successType,
    openModal,
    closeModal,
    setErrorType,
    setRemark,
    submit,
    clearSuccess,
  };
}
