import { RefreshCw, Rocket, Sparkles, Play } from 'lucide-react';
import { useBatches, useReview } from './hooks';
import { BatchList } from './components/BatchList';
import { StatsRow } from './components/StatsRow';
import { CaseList } from './components/CaseList';
import { ReviewModal } from './components/ReviewModal';
import { SkeletonLoader } from './components/SkeletonLoader';
import styles from './styles/index.module.scss';

/**
 * 飞书测试集页面
 * 从飞书多维表格导入测试用例，执行自动化测试并进行评审
 */
export default function TestSuite() {
  // 批次数据管理
  const {
    batches,
    selectedBatch,
    batchStats,
    executions,
    loading,
    loadingMore,
    detailLoading,
    quickCreating,
    total,
    hasMore,
    setSelectedBatch,
    setExecutions,
    loadBatches,
    loadMoreBatches,
    refreshBatchStats,
    handleQuickCreate,
  } = useBatches();

  // 评审功能
  const {
    reviewMode,
    currentReviewIndex,
    currentExecution,
    pendingCount,
    showFailureOptions,
    reviewLoading,
    setShowFailureOptions,
    startReview,
    closeReview,
    openExecution,
    goToPrevious,
    goToNext,
    handleReview,
  } = useReview({
    executions,
    onExecutionsChange: setExecutions,
    onReviewComplete: () => {
      refreshBatchStats();
      loadBatches();
    },
  });

  return (
    <div className={styles.page}>
      {/* 页面标题 */}
      <div className={styles.pageHeader}>
        <div className={styles.headerLeft}>
          <h1>飞书测试集</h1>
          <p className={styles.subtitle}>从飞书多维表格导入测试用例，执行自动化测试并进行评审</p>
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.primaryBtn}
            onClick={handleQuickCreate}
            disabled={quickCreating}
          >
            <Rocket size={16} />
            {quickCreating ? '创建中...' : '一键测试'}
          </button>
          <button className={styles.iconBtn} onClick={loadBatches} disabled={loading}>
            <RefreshCw size={16} className={loading ? styles.spinning : ''} />
          </button>
        </div>
      </div>

      {/* 主内容区 */}
      <div className={styles.mainContent}>
        {/* 左侧：批次列表 */}
        <BatchList
          batches={batches}
          selectedBatch={selectedBatch}
          loading={loading}
          loadingMore={loadingMore}
          hasMore={hasMore}
          total={total}
          onSelect={setSelectedBatch}
          onLoadMore={loadMoreBatches}
        />

        {/* 右侧：批次详情 */}
        <div className={styles.detailPanel}>
          {detailLoading ? (
            <SkeletonLoader />
          ) : selectedBatch ? (
            <>
              {/* 统计卡片 */}
              {batchStats && <StatsRow stats={batchStats} />}

              {/* 评审按钮 */}
              {pendingCount > 0 && !reviewMode && (
                <button className={styles.reviewBtn} onClick={startReview}>
                  <Play size={16} />
                  开始评审 ({pendingCount} 条待评审)
                </button>
              )}

              {/* 用例列表 */}
              <CaseList
                executions={executions}
                currentReviewIndex={currentReviewIndex}
                reviewMode={reviewMode}
                onSelect={openExecution}
              />
            </>
          ) : (
            <div className={styles.noSelection}>
              <Sparkles size={48} strokeWidth={1} />
              <p>选择左侧批次查看详情</p>
              <p className={styles.hint}>或创建新的测试批次</p>
            </div>
          )}
        </div>
      </div>

      {/* 评审弹窗 */}
      {reviewMode && currentExecution && (
        <ReviewModal
          execution={currentExecution}
          currentIndex={currentReviewIndex}
          totalCount={executions.length}
          showFailureOptions={showFailureOptions}
          loading={reviewLoading}
          onClose={closeReview}
          onPrevious={goToPrevious}
          onNext={goToNext}
          onPass={() => handleReview('passed')}
          onFail={(reason) => {
            handleReview('failed', reason);
            setShowFailureOptions(false);
          }}
          onShowFailureOptions={setShowFailureOptions}
        />
      )}
    </div>
  );
}
