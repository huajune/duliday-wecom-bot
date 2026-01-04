import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import {
  getBatches,
  getBatchExecutions,
  getBatchStats,
  updateReview,
  importFromFeishu,
  TestBatch,
  TestExecution,
  BatchStats,
  ImportFromFeishuRequest,
} from '@/services/agent-test';
import styles from './styles/index.module.scss';

export default function TestSuite() {
  // 批次列表
  const [batches, setBatches] = useState<TestBatch[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<TestBatch | null>(null);
  const [batchStats, setBatchStats] = useState<BatchStats | null>(null);

  // 执行记录
  const [executions, setExecutions] = useState<TestExecution[]>([]);
  const [currentReviewIndex, setCurrentReviewIndex] = useState<number>(-1);

  // 状态
  const [loading, setLoading] = useState(false);
  const [reviewMode, setReviewMode] = useState(false);

  // 导入弹窗
  const [showImportModal, setShowImportModal] = useState(false);
  const [importForm, setImportForm] = useState<ImportFromFeishuRequest>({
    appToken: '',
    tableId: '',
    batchName: '',
    executeImmediately: true,
    parallel: false,
  });
  const [importing, setImporting] = useState(false);

  // 展开的详情
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['toolCalls']));

  // 加载批次列表
  const loadBatches = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getBatches(50, 0);
      setBatches(data);
    } catch (err: any) {
      toast.error(err.message || '加载批次失败');
    } finally {
      setLoading(false);
    }
  }, []);

  // 加载批次详情
  const loadBatchData = useCallback(async (batch: TestBatch) => {
    try {
      setLoading(true);
      const [stats, execs] = await Promise.all([
        getBatchStats(batch.id),
        getBatchExecutions(batch.id),
      ]);
      setBatchStats(stats);
      setExecutions(execs);
    } catch (err: any) {
      toast.error(err.message || '加载数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始加载
  useEffect(() => {
    loadBatches();
  }, []);

  // 选中批次时加载详情
  useEffect(() => {
    if (selectedBatch) {
      loadBatchData(selectedBatch);
    }
  }, [selectedBatch]);

  // 处理导入
  const handleImport = async () => {
    if (!importForm.appToken || !importForm.tableId) {
      toast.error('请填写飞书表格的 App Token 和 Table ID');
      return;
    }

    try {
      setImporting(true);
      const result = await importFromFeishu({
        ...importForm,
        executeImmediately: true, // 强制立即执行
      });
      toast.success(`成功导入 ${result.totalImported} 条测试用例，正在执行...`);
      setShowImportModal(false);
      setImportForm({
        appToken: '',
        tableId: '',
        batchName: '',
        executeImmediately: true,
        parallel: false,
      });
      // 刷新批次列表
      loadBatches();
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || '导入失败');
    } finally {
      setImporting(false);
    }
  };

  // 从 URL 解析
  const parseFeishuUrl = (url: string) => {
    const appTokenMatch = url.match(/\/base\/([a-zA-Z0-9]+)/);
    const tableIdMatch = url.match(/[?&]table=([a-zA-Z0-9]+)/);
    if (appTokenMatch) {
      setImportForm((prev) => ({ ...prev, appToken: appTokenMatch[1] }));
    }
    if (tableIdMatch) {
      setImportForm((prev) => ({ ...prev, tableId: tableIdMatch[1] }));
    }
  };

  // 开始评审
  const startReview = () => {
    const pendingIndex = executions.findIndex((e) => e.review_status === 'pending');
    if (pendingIndex === -1) {
      toast('所有用例都已评审完成');
      return;
    }
    setCurrentReviewIndex(pendingIndex);
    setReviewMode(true);
  };

  // 评审操作
  const handleReview = async (status: 'passed' | 'failed') => {
    if (currentReviewIndex < 0) return;
    const exec = executions[currentReviewIndex];

    try {
      await updateReview(exec.id, {
        reviewStatus: status,
        reviewedBy: 'dashboard-user',
      });

      // 更新本地状态
      const updated = [...executions];
      updated[currentReviewIndex] = {
        ...exec,
        review_status: status,
        reviewed_at: new Date().toISOString(),
      };
      setExecutions(updated);

      // 移动到下一个待评审
      const nextPending = updated.findIndex(
        (e, i) => i > currentReviewIndex && e.review_status === 'pending'
      );
      if (nextPending !== -1) {
        setCurrentReviewIndex(nextPending);
      } else {
        // 检查是否还有之前的待评审
        const prevPending = updated.findIndex((e) => e.review_status === 'pending');
        if (prevPending !== -1) {
          setCurrentReviewIndex(prevPending);
        } else {
          toast.success('所有用例评审完成！');
          setReviewMode(false);
          setCurrentReviewIndex(-1);
          // 刷新统计
          if (selectedBatch) {
            const stats = await getBatchStats(selectedBatch.id);
            setBatchStats(stats);
          }
        }
      }
    } catch (err: any) {
      toast.error(err.message || '更新评审状态失败');
    }
  };

  // 切换展开
  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  // 格式化 JSON
  const formatJson = (obj: any) => {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  };

  // 获取状态显示
  const getStatusDisplay = (batch: TestBatch) => {
    if (batch.status === 'running') return { text: '执行中', class: styles.running };
    if (batch.status === 'reviewing') return { text: '评审中', class: styles.reviewing };
    if (batch.status === 'completed') return { text: '已完成', class: styles.completed };
    return { text: '已创建', class: styles.created };
  };

  // 当前评审的用例
  const currentExecution = currentReviewIndex >= 0 ? executions[currentReviewIndex] : null;

  // 待评审数量
  const pendingCount = executions.filter((e) => e.review_status === 'pending').length;

  return (
    <div className={styles.page}>
      {/* 页面标题 */}
      <div className={styles.pageHeader}>
        <div className={styles.headerLeft}>
          <h1>📋 飞书测试集</h1>
          <p className={styles.subtitle}>从飞书多维表格导入测试用例，自动执行并进行人工评审</p>
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.importBtn}
            onClick={() => setShowImportModal(true)}
          >
            📥 导入并执行
          </button>
          <button
            className={styles.refreshBtn}
            onClick={loadBatches}
            disabled={loading}
          >
            🔄
          </button>
        </div>
      </div>

      {/* 主内容区 */}
      <div className={styles.mainContent}>
        {/* 左侧：批次列表 */}
        <div className={styles.batchPanel}>
          <div className={styles.panelHeader}>
            <h3>📁 测试批次</h3>
            <span className={styles.batchCount}>{batches.length} 个批次</span>
          </div>

          <div className={styles.batchList}>
            {loading && batches.length === 0 ? (
              <div className={styles.loading}>加载中...</div>
            ) : batches.length === 0 ? (
              <div className={styles.emptyBatch}>
                <p>暂无测试批次</p>
                <button onClick={() => setShowImportModal(true)}>导入测试用例</button>
              </div>
            ) : (
              batches.map((batch) => {
                const status = getStatusDisplay(batch);
                return (
                  <div
                    key={batch.id}
                    className={`${styles.batchItem} ${selectedBatch?.id === batch.id ? styles.selected : ''}`}
                    onClick={() => setSelectedBatch(batch)}
                  >
                    <div className={styles.batchInfo}>
                      <div className={styles.batchName}>{batch.name}</div>
                      <div className={styles.batchMeta}>
                        {new Date(batch.created_at).toLocaleString('zh-CN', {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        <span className={styles.sep}>·</span>
                        {batch.total_cases} 用例
                      </div>
                    </div>
                    <div className={styles.batchRight}>
                      <span className={`${styles.statusTag} ${status.class}`}>
                        {status.text}
                      </span>
                      {batch.pass_rate !== null && (
                        <span className={styles.passRate}>
                          {batch.pass_rate.toFixed(0)}%
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* 右侧：批次详情 */}
        <div className={styles.detailPanel}>
          {selectedBatch ? (
            <>
              {/* 统计卡片 */}
              {batchStats && (
                <div className={styles.statsRow}>
                  <div className={styles.statItem}>
                    <div className={styles.statValue}>{batchStats.totalCases}</div>
                    <div className={styles.statLabel}>总用例</div>
                  </div>
                  <div className={styles.statItem}>
                    <div className={`${styles.statValue} ${styles.success}`}>
                      {batchStats.passedCount}
                    </div>
                    <div className={styles.statLabel}>通过</div>
                  </div>
                  <div className={styles.statItem}>
                    <div className={`${styles.statValue} ${styles.danger}`}>
                      {batchStats.failedCount}
                    </div>
                    <div className={styles.statLabel}>失败</div>
                  </div>
                  <div className={styles.statItem}>
                    <div className={`${styles.statValue} ${styles.warning}`}>
                      {batchStats.pendingReviewCount}
                    </div>
                    <div className={styles.statLabel}>待评审</div>
                  </div>
                  <div className={styles.statItem}>
                    <div className={styles.statValue}>
                      {batchStats.passRate !== null ? `${batchStats.passRate.toFixed(1)}%` : '-'}
                    </div>
                    <div className={styles.statLabel}>通过率</div>
                  </div>
                  <div className={styles.statItem}>
                    <div className={styles.statValue}>
                      {batchStats.avgDurationMs
                        ? `${(batchStats.avgDurationMs / 1000).toFixed(1)}s`
                        : '-'}
                    </div>
                    <div className={styles.statLabel}>平均耗时</div>
                  </div>
                </div>
              )}

              {/* 评审按钮 */}
              {pendingCount > 0 && !reviewMode && (
                <button className={styles.reviewBtn} onClick={startReview}>
                  🔍 开始评审 ({pendingCount} 条待评审)
                </button>
              )}

              {/* 用例列表 */}
              <div className={styles.caseListHeader}>
                <h4>测试用例</h4>
                <div className={styles.caseFilters}>
                  <span className={styles.caseCount}>
                    共 {executions.length} 条
                  </span>
                </div>
              </div>

              <div className={styles.caseList}>
                {executions.map((exec, index) => (
                  <div
                    key={exec.id}
                    className={`${styles.caseItem} ${
                      reviewMode && currentReviewIndex === index ? styles.reviewing : ''
                    }`}
                    onClick={() => {
                      if (reviewMode) {
                        setCurrentReviewIndex(index);
                      }
                    }}
                  >
                    <div className={styles.caseIndex}>{index + 1}</div>
                    <div className={styles.caseContent}>
                      <div className={styles.caseName}>
                        {exec.case_name || '未命名用例'}
                      </div>
                      <div className={styles.caseMessage}>
                        {exec.input_message || exec.test_input?.message || '-'}
                      </div>
                    </div>
                    <div className={styles.caseStatus}>
                      {/* 执行状态 */}
                      <span
                        className={`${styles.execStatus} ${
                          exec.execution_status === 'success'
                            ? styles.success
                            : exec.execution_status === 'failure'
                              ? styles.failure
                              : exec.execution_status === 'running'
                                ? styles.running
                                : styles.pending
                        }`}
                      >
                        {exec.execution_status === 'success'
                          ? '✓'
                          : exec.execution_status === 'failure'
                            ? '✗'
                            : exec.execution_status === 'running'
                              ? '...'
                              : '○'}
                      </span>
                      {/* 评审状态 */}
                      <span
                        className={`${styles.reviewStatus} ${
                          exec.review_status === 'passed'
                            ? styles.passed
                            : exec.review_status === 'failed'
                              ? styles.failed
                              : styles.pending
                        }`}
                      >
                        {exec.review_status === 'passed'
                          ? '✅'
                          : exec.review_status === 'failed'
                            ? '❌'
                            : '⏳'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className={styles.noSelection}>
              <div className={styles.noSelectionIcon}>👈</div>
              <p>选择左侧批次查看详情</p>
            </div>
          )}
        </div>
      </div>

      {/* 评审模式弹窗 */}
      {reviewMode && currentExecution && (
        <div className={styles.reviewModal}>
          <div className={styles.reviewContent}>
            <div className={styles.reviewHeader}>
              <h3>
                评审用例 {currentReviewIndex + 1}/{executions.length}
              </h3>
              <button
                className={styles.closeBtn}
                onClick={() => {
                  setReviewMode(false);
                  setCurrentReviewIndex(-1);
                }}
              >
                ✕
              </button>
            </div>

            <div className={styles.reviewBody}>
              {/* 用例名称 */}
              <div className={styles.reviewSection}>
                <label>用例名称</label>
                <div className={styles.reviewValue}>
                  {currentExecution.case_name || '未命名用例'}
                </div>
              </div>

              {/* 用户消息 */}
              <div className={styles.reviewSection}>
                <label>用户消息</label>
                <div className={styles.reviewValue}>
                  {currentExecution.input_message ||
                    currentExecution.test_input?.message ||
                    '-'}
                </div>
              </div>

              {/* AI 回复 */}
              <div className={styles.reviewSection}>
                <label>AI 回复</label>
                <div className={styles.reviewReply}>
                  {currentExecution.actual_output || '(无回复)'}
                </div>
              </div>

              {/* 执行指标 */}
              <div className={styles.reviewMetrics}>
                <span>耗时: {currentExecution.duration_ms || '-'}ms</span>
                <span>Token: {currentExecution.token_usage?.totalTokens || '-'}</span>
                <span
                  className={
                    currentExecution.execution_status === 'success'
                      ? styles.success
                      : styles.failure
                  }
                >
                  {currentExecution.execution_status}
                </span>
              </div>

              {/* 工具调用 */}
              {currentExecution.tool_calls && currentExecution.tool_calls.length > 0 && (
                <div className={styles.collapsible}>
                  <div
                    className={styles.collapsibleHeader}
                    onClick={() => toggleSection('toolCalls')}
                  >
                    <span>🔧 工具调用 ({currentExecution.tool_calls.length})</span>
                    <span>{expandedSections.has('toolCalls') ? '−' : '+'}</span>
                  </div>
                  {expandedSections.has('toolCalls') && (
                    <div className={styles.toolCalls}>
                      {currentExecution.tool_calls.map((call: any, idx: number) => (
                        <div key={idx} className={styles.toolCall}>
                          <div className={styles.toolName}>
                            {call.toolName || call.name}
                          </div>
                          {call.input && (
                            <pre className={styles.toolDetail}>
                              输入: {formatJson(call.input)}
                            </pre>
                          )}
                          {call.output && (
                            <pre className={styles.toolDetail}>
                              输出:{' '}
                              {typeof call.output === 'string'
                                ? call.output.substring(0, 500)
                                : formatJson(call.output).substring(0, 500)}
                              {(typeof call.output === 'string'
                                ? call.output.length
                                : formatJson(call.output).length) > 500 && '...'}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 请求/响应详情 */}
              <div className={styles.collapsible}>
                <div
                  className={styles.collapsibleHeader}
                  onClick={() => toggleSection('request')}
                >
                  <span>📤 请求详情</span>
                  <span>{expandedSections.has('request') ? '−' : '+'}</span>
                </div>
                {expandedSections.has('request') && (
                  <pre className={styles.jsonViewer}>
                    {formatJson(currentExecution.agent_request)}
                  </pre>
                )}
              </div>

              <div className={styles.collapsible}>
                <div
                  className={styles.collapsibleHeader}
                  onClick={() => toggleSection('response')}
                >
                  <span>📥 响应详情</span>
                  <span>{expandedSections.has('response') ? '−' : '+'}</span>
                </div>
                {expandedSections.has('response') && (
                  <pre className={styles.jsonViewer}>
                    {formatJson(currentExecution.agent_response)}
                  </pre>
                )}
              </div>
            </div>

            {/* 评审操作 */}
            <div className={styles.reviewFooter}>
              <div className={styles.reviewNav}>
                <button
                  disabled={currentReviewIndex === 0}
                  onClick={() => setCurrentReviewIndex(currentReviewIndex - 1)}
                >
                  ← 上一个
                </button>
                <span>
                  {currentReviewIndex + 1} / {executions.length}
                </span>
                <button
                  disabled={currentReviewIndex === executions.length - 1}
                  onClick={() => setCurrentReviewIndex(currentReviewIndex + 1)}
                >
                  下一个 →
                </button>
              </div>
              {currentExecution.review_status === 'pending' ? (
                <div className={styles.reviewActions}>
                  <button
                    className={styles.failBtn}
                    onClick={() => handleReview('failed')}
                  >
                    ❌ 不通过
                  </button>
                  <button
                    className={styles.passBtn}
                    onClick={() => handleReview('passed')}
                  >
                    ✅ 通过
                  </button>
                </div>
              ) : (
                <div className={styles.reviewedTag}>
                  {currentExecution.review_status === 'passed' ? '✅ 已通过' : '❌ 已标记失败'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 导入弹窗 */}
      {showImportModal && (
        <div className={styles.modalOverlay} onClick={() => setShowImportModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>📥 导入飞书测试用例</h3>
              <button onClick={() => setShowImportModal(false)}>✕</button>
            </div>

            <div className={styles.modalBody}>
              {/* URL 快速解析 */}
              <div className={styles.formGroup}>
                <label>快速导入（粘贴 URL）</label>
                <input
                  type="text"
                  placeholder="粘贴飞书多维表格链接"
                  onChange={(e) => parseFeishuUrl(e.target.value)}
                />
                <p className={styles.hint}>
                  格式：https://xxx.feishu.cn/base/AppToken?table=TableId
                </p>
              </div>

              <div className={styles.divider}><span>或手动填写</span></div>

              <div className={styles.formGroup}>
                <label>App Token *</label>
                <input
                  type="text"
                  value={importForm.appToken}
                  onChange={(e) =>
                    setImportForm((prev) => ({ ...prev, appToken: e.target.value }))
                  }
                  placeholder="多维表格的 App Token"
                />
              </div>

              <div className={styles.formGroup}>
                <label>Table ID *</label>
                <input
                  type="text"
                  value={importForm.tableId}
                  onChange={(e) =>
                    setImportForm((prev) => ({ ...prev, tableId: e.target.value }))
                  }
                  placeholder="数据表的 Table ID"
                />
              </div>

              <div className={styles.formGroup}>
                <label>批次名称（可选）</label>
                <input
                  type="text"
                  value={importForm.batchName}
                  onChange={(e) =>
                    setImportForm((prev) => ({ ...prev, batchName: e.target.value }))
                  }
                  placeholder="默认使用当前时间"
                />
              </div>

              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={importForm.parallel}
                  onChange={(e) =>
                    setImportForm((prev) => ({ ...prev, parallel: e.target.checked }))
                  }
                />
                <span>并行执行（更快但消耗更多资源）</span>
              </label>

              <div className={styles.fieldInfo}>
                <h4>📋 字段自动映射</h4>
                <ul>
                  <li><b>用户消息：</b>用户消息、消息、message、输入、问题</li>
                  <li><b>用例名称：</b>用例名称、名称、case_name、标题</li>
                  <li><b>分类：</b>分类、类别、category、场景</li>
                </ul>
              </div>
            </div>

            <div className={styles.modalFooter}>
              <button
                className={styles.cancelBtn}
                onClick={() => setShowImportModal(false)}
              >
                取消
              </button>
              <button
                className={styles.confirmBtn}
                onClick={handleImport}
                disabled={importing || !importForm.appToken || !importForm.tableId}
              >
                {importing ? '导入中...' : '导入并执行'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
