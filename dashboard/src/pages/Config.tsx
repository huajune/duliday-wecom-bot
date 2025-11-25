import { useState } from 'react';
import {
  useBlacklist,
  useAddToBlacklist,
  useRemoveFromBlacklist,
  useRefreshCache,
  useClearDeduplication,
} from '@/hooks/useMonitoring';

export default function Config() {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newGroupId, setNewGroupId] = useState('');
  const [newReason, setNewReason] = useState('');

  const { data: blacklist, isLoading } = useBlacklist();
  const addToBlacklist = useAddToBlacklist();
  const removeFromBlacklist = useRemoveFromBlacklist();
  const refreshCache = useRefreshCache();
  const clearDeduplication = useClearDeduplication();

  const handleAddBlacklist = () => {
    if (!newGroupId.trim()) return;
    addToBlacklist.mutate(
      { id: newGroupId.trim(), type: 'groupId' },
      {
        onSuccess: () => {
          setShowAddDialog(false);
          setNewGroupId('');
          setNewReason('');
        },
      }
    );
  };

  return (
    <div id="page-config" className="page-section active">
      {/* 小组黑名单管理 */}
      <section className="section">
        <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>
            小组黑名单{' '}
            <span style={{ fontSize: '14px', color: 'var(--text-secondary)', fontWeight: 'normal' }}>
              ({blacklist?.groupIds?.length || 0} 个)
            </span>
          </h3>
          <button
            className="btn btn-primary"
            style={{ padding: '6px 12px', fontSize: '12px' }}
            onClick={() => setShowAddDialog(true)}
          >
            + 添加小组
          </button>
        </div>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '8px 0 16px 0' }}>
          黑名单中的小组发来的消息不会触发 AI 回复，但仍会记录聊天历史
        </p>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>小组 ID</th>
                <th>备注原因</th>
                <th>添加时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={4} className="loading">
                    加载中
                  </td>
                </tr>
              ) : (blacklist?.groupIds || []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="loading">
                    暂无黑名单数据
                  </td>
                </tr>
              ) : (
                (blacklist?.groupIds || []).map((groupId) => (
                  <tr key={groupId}>
                    <td className="font-mono text-xs">{groupId}</td>
                    <td>-</td>
                    <td>-</td>
                    <td>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => removeFromBlacklist.mutate({ id: groupId, type: 'groupId' })}
                        disabled={removeFromBlacklist.isPending}
                      >
                        移除
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 缓存管理 */}
      <section className="section" style={{ marginTop: '24px' }}>
        <div className="section-header">
          <h3>缓存管理</h3>
        </div>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '8px 0 16px 0' }}>
          管理系统缓存，包括消息去重、聊天历史等
        </p>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button
            className="btn btn-ghost"
            style={{ padding: '8px 16px' }}
            onClick={() => refreshCache.mutate()}
            disabled={refreshCache.isPending}
          >
            🔄 刷新配置缓存
          </button>
          <button
            className="btn btn-ghost"
            style={{ padding: '8px 16px', color: 'var(--warning)' }}
            onClick={() => clearDeduplication.mutate()}
            disabled={clearDeduplication.isPending}
          >
            🗑️ 清空去重缓存
          </button>
        </div>
      </section>

      {/* 添加黑名单对话框 */}
      {showAddDialog && (
        <div className="modal-overlay" style={{ display: 'flex' }}>
          <div className="modal-content" style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h3>添加小组到黑名单</h3>
              <button className="modal-close" onClick={() => setShowAddDialog(false)}>
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label htmlFor="blacklistGroupId">
                  小组 ID <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  type="text"
                  id="blacklistGroupId"
                  placeholder="输入小组 ID"
                  value={newGroupId}
                  onChange={(e) => setNewGroupId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    background: 'var(--bg-primary)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>
              <div className="form-group" style={{ marginTop: '12px' }}>
                <label htmlFor="blacklistReason">备注原因（可选）</label>
                <input
                  type="text"
                  id="blacklistReason"
                  placeholder="例如：测试小组"
                  value={newReason}
                  onChange={(e) => setNewReason(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    background: 'var(--bg-primary)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>
            </div>
            <div className="modal-footer" style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowAddDialog(false)}>
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={handleAddBlacklist}
                disabled={addToBlacklist.isPending || !newGroupId.trim()}
              >
                添加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
