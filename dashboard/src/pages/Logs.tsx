import { useState } from 'react';
import { useDashboard } from '@/hooks/useMonitoring';
import { formatTime, formatDuration } from '@/utils/format';

import type { MessageRecord } from '@/types/monitoring';

// 场景类型中文映射
const scenarioLabels: Record<string, string> = {
  consultation: '咨询',
  booking: '预约',
  followup: '跟进',
  general: '通用',
};

// 详情面板组件
function MessageDetailPanel({
  message,
  onClose,
}: {
  message: MessageRecord;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'reply' | 'details' | 'raw'>('reply');

  return (
    <div className="drawer-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="drawer-content">
        <div className="modal-header">
          <h3>
            消息详情
            <span className={`status-badge ${message.status === 'success' ? 'success' : message.status === 'failure' || message.status === 'failed' ? 'danger' : 'warning'}`}>
              {message.status}
            </span>
            {message.isFallback && (
              <span className="status-badge warning">
                {message.fallbackSuccess ? '降级成功' : '降级失败'}
              </span>
            )}
          </h3>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>

        {/* Tab 切换 */}
        <div className="modal-tabs">
          <button
            className={`modal-tab-btn ${activeTab === 'reply' ? 'active' : ''}`}
            onClick={() => setActiveTab('reply')}
          >
            Agent 响应
          </button>
          <button
            className={`modal-tab-btn ${activeTab === 'details' ? 'active' : ''}`}
            onClick={() => setActiveTab('details')}
          >
            详细信息
          </button>
          <button
            className={`modal-tab-btn ${activeTab === 'raw' ? 'active' : ''}`}
            onClick={() => setActiveTab('raw')}
          >
            原始响应
          </button>
        </div>

        <div className="modal-body">
          {activeTab === 'reply' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* 用户消息 */}
              <div className="modal-section">
                <div className="modal-label">
                  <span style={{ fontSize: '14px' }}>👤</span>
                  用户消息
                </div>
                <div className="modal-value-box">
                  {message.messagePreview || '(无消息内容)'}
                </div>
              </div>

              {/* Agent 响应 */}
              <div className="modal-section">
                <div className="modal-label">
                  <span style={{ fontSize: '14px' }}>🤖</span>
                  Agent 响应
                  {message.replySegments && (
                    <span style={{ color: 'var(--text-secondary)', fontWeight: 'normal', marginLeft: 'auto', fontSize: '11px' }}>
                      ({message.replySegments} 条消息)
                    </span>
                  )}
                </div>
                <div className="modal-value-box primary" style={{ maxHeight: '400px', overflow: 'auto' }}>
                  {message.replyPreview || '(无响应内容)'}
                </div>
              </div>

              {/* 错误信息 */}
              {message.error && (
                <div className="modal-section">
                  <div className="modal-label" style={{ color: 'var(--danger)' }}>
                    <span style={{ fontSize: '14px' }}>⚠️</span>
                    错误信息
                  </div>
                  <div className="modal-value-box danger">
                    {message.error}
                  </div>
                </div>
              )}
            </div>
          ) : activeTab === 'details' ? (

            <div className="modal-grid">
              {/* 基本信息 */}
              <div className="modal-info-card">
                <div className="modal-label">基本信息</div>
                <div className="modal-info-row">
                  <span className="modal-info-label">用户</span>
                  <span className="modal-info-value">{message.userName || message.chatId}</span>
                </div>
                <div className="modal-info-row">
                  <span className="modal-info-label">会话 ID</span>
                  <span className="modal-info-value" style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-muted)' }}>
                    {message.chatId}
                  </span>
                </div>
                <div className="modal-info-row">
                  <span className="modal-info-label">接收时间</span>
                  <span className="modal-info-value">{formatTime(message.receivedAt)}</span>
                </div>
                {message.scenario && (
                  <div className="modal-info-row">
                    <span className="modal-info-label">场景</span>
                    <span className="modal-info-value">
                      {scenarioLabels[message.scenario] || message.scenario}
                    </span>
                  </div>
                )}
              </div>

              {/* 耗时统计 */}
              <div className="modal-info-card">
                <div className="modal-label">耗时统计</div>
                <div className="modal-info-row">
                  <span className="modal-info-label">总耗时</span>
                  <span className="modal-info-value" style={{ color: 'var(--primary)' }}>
                    {formatDuration(message.totalDuration)}
                  </span>
                </div>
                {message.queueDuration !== undefined && (
                  <div className="modal-info-row">
                    <span className="modal-info-label">排队耗时</span>
                    <span className="modal-info-value">{formatDuration(message.queueDuration)}</span>
                  </div>
                )}
                {message.aiDuration !== undefined && (
                  <div className="modal-info-row">
                    <span className="modal-info-label">AI 处理</span>
                    <span className="modal-info-value">{formatDuration(message.aiDuration)}</span>
                  </div>
                )}
                {message.sendDuration !== undefined && (
                  <div className="modal-info-row">
                    <span className="modal-info-label">发送耗时</span>
                    <span className="modal-info-value">{formatDuration(message.sendDuration)}</span>
                  </div>
                )}
              </div>

              {/* Token 使用 */}
              {message.tokenUsage !== undefined && (
                <div className="modal-info-card">
                  <div className="modal-label">Token 使用</div>
                  <div style={{ fontSize: '24px', fontWeight: 600, color: 'var(--warning)' }}>
                    {message.tokenUsage.toLocaleString()}
                  </div>
                </div>
              )}

              {/* 使用的工具 */}
              {message.tools && message.tools.length > 0 && (
                <div className="modal-info-card">
                  <div className="modal-label">使用的工具</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {message.tools.map((tool, i) => (
                      <span key={i} className="modal-tag success">
                        {tool}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            // 原始响应 Tab
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {message.rawAgentResponse ? (
                <>
                  {/* 完整回复内容 */}
                  <div className="modal-section">
                    <div className="modal-label">
                      <span style={{ fontSize: '14px' }}>📝</span>
                      完整回复内容
                    </div>
                    <div className="modal-value-box" style={{ maxHeight: '300px', overflow: 'auto' }}>
                      {message.rawAgentResponse.content || '(无内容)'}
                    </div>
                  </div>

                  {/* Token 使用详情 */}
                  {message.rawAgentResponse.usage && (
                    <div className="modal-section">
                      <div className="modal-label">
                        <span style={{ fontSize: '14px' }}>📊</span>
                        Token 使用详情
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                        <div className="modal-info-card" style={{ alignItems: 'center', textAlign: 'center' }}>
                          <div className="modal-info-label" style={{ fontSize: '11px' }}>输入 Token</div>
                          <div style={{ fontSize: '18px', fontWeight: 600, color: 'var(--primary)' }}>
                            {message.rawAgentResponse.usage.inputTokens?.toLocaleString() || '-'}
                          </div>
                        </div>
                        <div className="modal-info-card" style={{ alignItems: 'center', textAlign: 'center' }}>
                          <div className="modal-info-label" style={{ fontSize: '11px' }}>输出 Token</div>
                          <div style={{ fontSize: '18px', fontWeight: 600, color: 'var(--success)' }}>
                            {message.rawAgentResponse.usage.outputTokens?.toLocaleString() || '-'}
                          </div>
                        </div>
                        <div className="modal-info-card" style={{ alignItems: 'center', textAlign: 'center' }}>
                          <div className="modal-info-label" style={{ fontSize: '11px' }}>总计</div>
                          <div style={{ fontSize: '18px', fontWeight: 600, color: 'var(--warning)' }}>
                            {message.rawAgentResponse.usage.totalTokens?.toLocaleString() || '-'}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 工具使用详情 */}
                  {message.rawAgentResponse.tools && (
                    <div className="modal-section">
                      <div className="modal-label">
                        <span style={{ fontSize: '14px' }}>🛠️</span>
                        工具使用详情
                      </div>
                      <div className="modal-grid">
                        <div className="modal-info-card">
                          <div className="modal-info-label" style={{ marginBottom: '8px' }}>
                            已使用工具 ({message.rawAgentResponse.tools.used?.length || 0})
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                            {message.rawAgentResponse.tools.used?.length > 0 ? (
                              message.rawAgentResponse.tools.used.map((tool, i) => (
                                <span key={i} className="modal-tag success">
                                  {tool}
                                </span>
                              ))
                            ) : (
                              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>无</span>
                            )}
                          </div>
                        </div>
                        <div className="modal-info-card">
                          <div className="modal-info-label" style={{ marginBottom: '8px' }}>
                            跳过的工具 ({message.rawAgentResponse.tools.skipped?.length || 0})
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                            {message.rawAgentResponse.tools.skipped?.length > 0 ? (
                              message.rawAgentResponse.tools.skipped.map((tool, i) => (
                                <span key={i} className="modal-tag warning">
                                  {tool}
                                </span>
                              ))
                            ) : (
                              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>无</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 降级信息 */}
                  {message.rawAgentResponse.isFallback && (
                    <div className="modal-section">
                      <div className="modal-label" style={{ color: 'var(--warning)' }}>
                        <span style={{ fontSize: '14px' }}>⚡</span>
                        降级信息
                      </div>
                      <div className="modal-value-box warning" style={{ background: 'var(--warning-soft)', color: 'var(--warning)', borderColor: 'rgba(245, 158, 11, 0.2)' }}>
                        {message.rawAgentResponse.fallbackReason || '使用了降级处理'}
                      </div>
                    </div>
                  )}

                  {/* 原始 JSON */}
                  <div className="modal-section">
                    <div className="modal-label">
                      <span style={{ fontSize: '14px' }}>{'{ }'}</span>
                      原始 JSON
                    </div>
                    <pre className="modal-value-box code" style={{ maxHeight: '300px', overflow: 'auto', margin: 0 }}>
                      {JSON.stringify(message.rawAgentResponse, null, 2)}
                    </pre>
                  </div>
                </>
              ) : (
                <div
                  style={{
                    textAlign: 'center',
                    padding: '40px 20px',
                    color: 'var(--text-muted)',
                  }}
                >
                  <div style={{ fontSize: '40px', marginBottom: '12px' }}>📭</div>
                  <div>暂无原始响应数据</div>
                  <div style={{ fontSize: '12px', marginTop: '8px' }}>
                    新的消息记录才会包含完整的 Agent 响应
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Logs() {
  const [timeRange] = useState<'today' | 'week' | 'month'>('today');
  const { data: dashboard, isLoading } = useDashboard(timeRange);
  const [selectedMessage, setSelectedMessage] = useState<MessageRecord | null>(null);

  const messages = dashboard?.recentMessages || [];

  return (
    <div id="page-logs" className="page-section active">
      {/* 实时消息 */}
      <section className="section">
        <div className="section-header">
          <h3>
            实时消息{' '}
            <span style={{ fontSize: '14px', color: 'var(--text-secondary)', fontWeight: 'normal' }}>
              ({messages.length} 条)
            </span>
          </h3>
          <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
            点击任意行查看完整的 Agent 响应和详细信息
          </p>
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>用户</th>
                <th>用户消息</th>
                <th>回复预览</th>
                <th>Token</th>
                <th>总耗时</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="loading">
                    加载中...
                  </td>
                </tr>
              ) : messages.length === 0 ? (
                <tr>
                  <td colSpan={7} className="loading">
                    暂无数据
                  </td>
                </tr>
              ) : (
                messages.map((msg, i) => (
                  <tr
                    key={msg.messageId || i}
                    onClick={() => setSelectedMessage(msg)}
                    style={{ cursor: 'pointer' }}
                    className="clickable-row"
                  >
                    <td>{formatTime(msg.receivedAt)}</td>
                    <td>{msg.userName || msg.chatId}</td>
                    <td
                      style={{
                        maxWidth: '180px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {msg.messagePreview || '-'}
                    </td>
                    <td
                      style={{
                        maxWidth: '200px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {msg.replyPreview || '-'}
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                      {msg.tokenUsage?.toLocaleString() || '-'}
                    </td>
                    <td>{formatDuration(msg.totalDuration)}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span
                          className={`status-badge ${msg.status === 'success'
                            ? 'success'
                            : msg.status === 'failure' || msg.status === 'failed'
                              ? 'danger'
                              : 'warning'
                            }`}
                        >
                          {msg.status}
                        </span>
                        {msg.isFallback && (
                          <span
                            title={msg.fallbackSuccess ? '降级成功' : '降级失败'}
                            style={{
                              fontSize: '12px',
                              color: msg.fallbackSuccess ? 'var(--warning)' : 'var(--danger)',
                            }}
                          >
                            ⚡
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 详情弹窗 */}
      {selectedMessage && (
        <MessageDetailPanel message={selectedMessage} onClose={() => setSelectedMessage(null)} />
      )}

      {/* 添加行 hover 样式 */}
      <style>{`
        .clickable-row:hover {
          background: var(--bg-secondary) !important;
        }
      `}</style>
    </div>
  );
}
