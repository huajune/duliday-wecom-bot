import { useState } from 'react';
import { useDashboard, useMetrics } from '@/hooks/useMonitoring';
import { formatDateTime, formatDuration } from '@/utils/format';

import type { MessageRecord } from '@/types/monitoring';

// 场景类型中文映射
const scenarioLabels: Record<string, string> = {
  consultation: '咨询',
  'candidate-consultation': '候选人咨询',
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
  const [showRaw, setShowRaw] = useState(true);

  // 从 rawAgentResponse.messages 中提取完整的 assistant 响应
  const getFullAgentResponse = (): string => {
    const messages = message.rawAgentResponse?.messages;
    if (!messages || messages.length === 0) {
      return message.replyPreview || '(无响应内容)';
    }
    // 找到 assistant 角色的消息，合并所有 text parts
    const assistantMessages = messages.filter(m => m.role === 'assistant');
    if (assistantMessages.length === 0) {
      return message.replyPreview || '(无响应内容)';
    }
    // 提取所有 assistant 消息的 text 内容
    return assistantMessages
      .flatMap((m: any) => m.parts.filter((p: any) => p.type === 'text').map((p: any) => p.text))
      .join('\n\n') || message.replyPreview || '(无响应内容)';
  };

  return (
    <div className="drawer-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="drawer-content">
        {/* Header */}
        <div className="modal-header" style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h3 style={{ margin: 0, fontSize: '18px' }}>消息详情</h3>
            <span className={`status-badge ${message.status === 'success' ? 'success' : message.status === 'failure' || message.status === 'failed' ? 'danger' : 'warning'}`}>
              {message.status}
            </span>
            {message.isFallback && (
              <span className="status-badge warning">
                {message.fallbackSuccess ? '降级成功' : '降级失败'}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
            <span>🕒 {formatDateTime(message.receivedAt)}</span>
            <span>👤 {message.userName || message.chatId}</span>
            <button className="modal-close" onClick={onClose} style={{ marginLeft: '8px' }}>
              &times;
            </button>
          </div>
        </div>

        {/* Unified Content Body */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

          {/* Left Column: Raw Data & Conversation (65%) */}
          <div style={{ flex: '1 1 65%', padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Conversation Context */}
            <div>
              <h4 style={{ margin: '0 0 16px 0', fontSize: '14px', color: 'var(--text-muted)' }}>当前会话</h4>

              {/* User Message Bubble */}
              <div className="chat-bubble user" style={{ marginBottom: '16px' }}>
                <div className="bubble-header">
                  <span style={{ fontSize: '16px' }}>👤</span>
                  <span style={{ fontWeight: 600, fontSize: '13px' }}>用户消息</span>
                </div>
                <div className="bubble-content">
                  {message.messagePreview || '(无消息内容)'}
                </div>
              </div>

              {/* Agent Reply Bubble */}
              <div className="chat-bubble agent">
                <div className="bubble-header">
                  <span style={{ fontSize: '16px' }}>🤖</span>
                  <span style={{ fontWeight: 600, fontSize: '13px' }}>Agent 响应</span>
                  {message.replySegments && (
                    <span className="bubble-meta">
                      {message.replySegments} 条消息
                    </span>
                  )}
                </div>
                <div className="bubble-content primary" style={{ maxHeight: '150px', overflowY: 'auto' }}>
                  {getFullAgentResponse()}
                </div>
              </div>

              {/* Error Box */}
              {message.error && (
                <div className="error-box" style={{ marginTop: '24px' }}>
                  <div className="error-header">
                    <span>⚠️</span> 错误信息
                  </div>
                  <div className="error-content">
                    {typeof message.error === 'string'
                      ? message.error
                      : JSON.stringify(message.error, null, 2)}
                  </div>
                </div>
              )}
            </div>

            {/* Raw JSON Section */}
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, borderTop: '1px solid var(--border)', paddingTop: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  原始数据结构 (JSON)
                </h4>
                <button
                  onClick={() => setShowRaw(!showRaw)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--primary)',
                    cursor: 'pointer',
                    fontSize: '12px',
                  }}
                >
                  {showRaw ? '收起' : '展开'}
                </button>
              </div>

              {showRaw && (
                <pre className="code-block" style={{ flex: 1, minHeight: '400px', fontSize: '12px', overflow: 'auto', margin: 0 }}>
                  {JSON.stringify(message.rawAgentResponse || message, null, 2)}
                </pre>
              )}
            </div>
          </div>

          {/* Right Column: Technical Stats */}
          <div style={{ flex: '0 0 360px', background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border)', padding: '20px', overflowY: 'auto' }}>

            <h4 style={{ margin: '0 0 16px 0', fontSize: '13px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              技术指标
            </h4>

            {/* Latency & Token - Compact Row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              {/* Latency Card */}
              <div className="stat-card" style={{ marginBottom: 0, textAlign: 'center' }}>
                <div className="stat-label" style={{ whiteSpace: 'nowrap' }}>总耗时</div>
                <div className="stat-value primary" style={{ fontSize: '18px' }}>{formatDuration(message.totalDuration)}</div>
              </div>

              {/* Token Card */}
              <div className="stat-card" style={{ marginBottom: 0, textAlign: 'center' }}>
                <div className="stat-label" style={{ whiteSpace: 'nowrap' }}>Token</div>
                <div className="stat-value warning" style={{ fontSize: '18px' }}>{message.tokenUsage?.toLocaleString() || '-'}</div>
              </div>
            </div>

            {/* Latency Breakdown */}
            {(message.queueDuration !== undefined || message.aiDuration !== undefined || message.sendDuration !== undefined) && (
              <div className="stat-card">
                <div className="stat-label">耗时明细</div>
                <div className="stat-breakdown" style={{ marginTop: '8px', paddingTop: '0', borderTop: 'none' }}>
                  {message.queueDuration !== undefined && (
                    <div className="breakdown-item">
                      <span>排队</span>
                      <span>{formatDuration(message.queueDuration)}</span>
                    </div>
                  )}
                  {message.aiDuration !== undefined && (
                    <div className="breakdown-item">
                      <span>首条响应</span>
                      <span>{formatDuration(message.aiDuration)}</span>
                    </div>
                  )}
                  {message.sendDuration !== undefined && (
                    <div className="breakdown-item">
                      <span>发送</span>
                      <span>{formatDuration(message.sendDuration)}</span>
                    </div>
                  )}
                  {message.rawAgentResponse?.usage && (
                    <>
                      <div className="breakdown-item" style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed var(--border)' }}>
                        <span>输入 Token</span>
                        <span>{message.rawAgentResponse.usage.inputTokens?.toLocaleString() || '-'}</span>
                      </div>
                      <div className="breakdown-item">
                        <span>输出 Token</span>
                        <span>{message.rawAgentResponse.usage.outputTokens?.toLocaleString() || '-'}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Tools Card */}
            {(message.tools && message.tools.length > 0) || (message.rawAgentResponse?.tools?.skipped && message.rawAgentResponse.tools.skipped.length > 0) ? (
              <div className="stat-card">
                <div className="stat-label">工具调用</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '10px' }}>
                  {/* 使用的工具 */}
                  {message.tools && message.tools.length > 0 && (
                    <div>
                      <div style={{ fontSize: '11px', color: 'var(--success)', marginBottom: '6px', fontWeight: 500 }}>
                        ✓ 已使用 ({message.tools.length})
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {message.tools.map((tool, i) => (
                          <span key={i} className="tool-tag">
                            {tool}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Skipped 的工具 */}
                  {message.rawAgentResponse?.tools?.skipped && message.rawAgentResponse.tools.skipped.length > 0 && (
                    <div style={{ paddingTop: '10px', borderTop: '1px dashed var(--border)' }}>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px' }}>
                        ○ 已跳过 ({message.rawAgentResponse.tools.skipped.length})
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {message.rawAgentResponse.tools.skipped.map((tool, i) => (
                          <span key={i} className="tool-tag skipped">
                            {tool}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {/* Input Params Card */}
            {message.rawAgentResponse?.input && (
              <div className="stat-card">
                <div className="stat-label">输入参数</div>
                <div className="stat-breakdown" style={{ marginTop: '8px', paddingTop: '0', borderTop: 'none' }}>
                  <div className="breakdown-item">
                    <span>历史消息</span>
                    <span>{message.rawAgentResponse.input.historyCount} 条</span>
                  </div>
                  {message.rawAgentResponse.input.model && (
                    <div className="breakdown-item">
                      <span>模型</span>
                      <span style={{ fontSize: '10px', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={message.rawAgentResponse.input.model}>
                        {message.rawAgentResponse.input.model}
                      </span>
                    </div>
                  )}
                  {message.rawAgentResponse.input.contextStrategy && (
                    <div className="breakdown-item">
                      <span>上下文策略</span>
                      <span>{message.rawAgentResponse.input.contextStrategy}</span>
                    </div>
                  )}
                  {message.rawAgentResponse.input.prune !== undefined && (
                    <div className="breakdown-item">
                      <span>剪枝</span>
                      <span>{message.rawAgentResponse.input.prune ? '是' : '否'}</span>
                    </div>
                  )}
                  {/* Prompt 相关字段 */}
                  <div className="breakdown-item" style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed var(--border)' }}>
                    <span>systemPrompt</span>
                    <span className={message.rawAgentResponse.input.hasSystemPrompt ? 'param-yes' : 'param-no'}>
                      {message.rawAgentResponse.input.hasSystemPrompt ? `✓ ${message.rawAgentResponse.input.systemPromptLength} 字符` : '✗ 无'}
                    </span>
                  </div>
                  <div className="breakdown-item">
                    <span>context</span>
                    <span className={message.rawAgentResponse.input.hasContext ? 'param-yes' : 'param-no'}>
                      {message.rawAgentResponse.input.hasContext ? `✓ ${message.rawAgentResponse.input.contextLength} 字符` : '✗ 无'}
                    </span>
                  </div>
                  <div className="breakdown-item">
                    <span>toolContext</span>
                    <span className={message.rawAgentResponse.input.hasToolContext ? 'param-yes' : 'param-no'}>
                      {message.rawAgentResponse.input.hasToolContext ? `✓ ${message.rawAgentResponse.input.toolContextLength} 字符` : '✗ 无'}
                    </span>
                  </div>
                  {/* 品牌配置相关 */}
                  <div className="breakdown-item" style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed var(--border)' }}>
                    <span>configData</span>
                    <span className={message.rawAgentResponse.input.hasConfigData ? 'param-yes' : 'param-no'}>
                      {message.rawAgentResponse.input.hasConfigData ? '✓ 已加载' : '✗ 无'}
                    </span>
                  </div>
                  <div className="breakdown-item">
                    <span>replyPrompts</span>
                    <span className={message.rawAgentResponse.input.hasReplyPrompts ? 'param-yes' : 'param-no'}>
                      {message.rawAgentResponse.input.hasReplyPrompts ? '✓ 已加载' : '✗ 无'}
                    </span>
                  </div>
                  <div className="breakdown-item">
                    <span>品牌策略</span>
                    <span className={message.rawAgentResponse.input.brandPriorityStrategy ? 'param-yes' : 'param-no'}>
                      {message.rawAgentResponse.input.brandPriorityStrategy || '✗ 无'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Metadata Card */}
            <div className="stat-card">
              <div className="stat-label">元数据</div>
              <div className="stat-breakdown" style={{ marginTop: '8px', paddingTop: '0', borderTop: 'none' }}>
                <div className="breakdown-item">
                  <span>场景</span>
                  <span>{scenarioLabels[message.scenario || ''] || message.scenario || '未知'}</span>
                </div>
                <div className="breakdown-item">
                  <span>会话 ID</span>
                  <span style={{ fontFamily: 'monospace', fontSize: '11px' }} title={message.chatId}>
                    {message.chatId.slice(0, 12)}...
                  </span>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* Local Styles for this component */}
      <style>{`
        .chat-bubble {
          background: #fff;
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 16px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.02);
        }
        .chat-bubble.user { border-left: 4px solid var(--primary); }
        .chat-bubble.agent { border-left: 4px solid var(--success); }
        
        .bubble-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
          color: var(--text-primary);
        }
        .bubble-meta {
          margin-left: auto;
          font-size: 12px;
          color: var(--text-muted);
          background: var(--bg-secondary);
          padding: 2px 8px;
          border-radius: 99px;
        }
        .bubble-content {
          font-size: 14px;
          line-height: 1.6;
          color: var(--text-secondary);
          white-space: pre-wrap;
        }
        
        .error-box {
          background: #fef2f2;
          border: 1px solid #fee2e2;
          border-radius: 12px;
          padding: 16px;
          color: #ef4444;
        }
        .error-header {
          font-weight: 600;
          margin-bottom: 8px;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        
        .stat-card {
          background: #fff;
          border-radius: 10px;
          padding: 12px 14px;
          margin-bottom: 12px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        }
        .stat-label {
          font-size: 12px;
          color: var(--text-muted);
          margin-bottom: 4px;
        }
        .stat-value {
          font-size: 20px;
          font-weight: 700;
          color: var(--text-primary);
        }
        .stat-value.primary { color: var(--primary); }
        .stat-value.warning { color: var(--warning); }
        
        .stat-breakdown {
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .breakdown-item {
          display: flex;
          flex:1;
          justify-content: space-between;
          font-size: 12px;
          color: var(--text-secondary);
        }

        .param-yes {
          color: var(--success);
          font-weight: 500;
        }
        .param-no {
          color: var(--text-muted);
        }

        .tool-tag {
          font-size: 10px;
          padding: 3px 6px;
          background: rgba(16, 185, 129, 0.1);
          color: var(--success);
          border-radius: 4px;
          border: 1px solid rgba(16, 185, 129, 0.2);
          white-space: nowrap;
        }
        .tool-tag.skipped {
          background: rgba(107, 114, 128, 0.1);
          color: var(--text-muted);
          border-color: rgba(107, 114, 128, 0.2);
          text-decoration: line-through;
        }

        .code-block {
          background: #1e1e1e;
          color: #d4d4d4;
          padding: 16px;
          border-radius: 8px;
          font-family: 'Menlo', 'Monaco', monospace;
        }
      `}</style>
    </div>
  );
}

export default function Logs() {
  const [timeRange] = useState<'today' | 'week' | 'month'>('today');
  const { data: dashboard, isLoading } = useDashboard(timeRange);
  const { data: metrics } = useMetrics();
  const [selectedMessage, setSelectedMessage] = useState<MessageRecord | null>(null);
  const [activeTab, setActiveTab] = useState<'realtime' | 'slowest'>('realtime');

  const messages = dashboard?.recentMessages || [];
  const slowestRecords = metrics?.slowestRecords || [];

  // 计算统计数据
  const stats = {
    total: messages.length,
    success: messages.filter((m) => m.status === 'success').length,
    failed: messages.filter((m) => m.status === 'failure' || m.status === 'failed').length,
    avgDuration:
      messages.length > 0
        ? Math.round(messages.reduce((sum, m) => sum + (m.aiDuration || 0), 0) / messages.length)
        : 0,
  };

  return (
    <div id="page-logs" className="page-section active">
      {/* 顶部控制面板 */}
      <section
        className="control-panel"
        style={{
          marginBottom: '20px',
          padding: '16px 20px',
        }}
      >
        {/* 单行布局：标题 + 统计 + Tab切换 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '24px',
          }}
        >
          {/* 左侧：标题 */}
          <h3
            style={{
              margin: 0,
              fontSize: '15px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ fontSize: '16px' }}>💬</span>
            消息记录
          </h3>

          {/* 分隔线 */}
          <div style={{ width: '1px', height: '24px', background: 'var(--border)' }} />

          {/* 统计数据 - 紧凑横向排列 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>总计</span>
              <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--primary)' }}>
                {stats.total}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>成功</span>
              <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--success)' }}>
                {stats.success}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>失败</span>
              <span
                style={{
                  fontSize: '15px',
                  fontWeight: 700,
                  color: stats.failed > 0 ? 'var(--danger)' : 'var(--text-muted)',
                }}
              >
                {stats.failed}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>首响</span>
              <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--warning)' }}>
                {formatDuration(stats.avgDuration)}
              </span>
            </div>
          </div>

          {/* 弹性空间 */}
          <div style={{ flex: 1 }} />

          {/* Tab 切换 - 简洁样式 */}
          <div
            style={{
              display: 'flex',
              background: 'var(--bg-secondary)',
              borderRadius: '8px',
              padding: '3px',
            }}
          >
            <button
              onClick={() => setActiveTab('realtime')}
              style={{
                padding: '6px 14px',
                background: activeTab === 'realtime' ? '#fff' : 'transparent',
                border: 'none',
                borderRadius: '6px',
                color: activeTab === 'realtime' ? 'var(--primary)' : 'var(--text-muted)',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: activeTab === 'realtime' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              实时 {messages.length}
            </button>
            <button
              onClick={() => setActiveTab('slowest')}
              style={{
                padding: '6px 14px',
                background: activeTab === 'slowest' ? '#fff' : 'transparent',
                border: 'none',
                borderRadius: '6px',
                color: activeTab === 'slowest' ? 'var(--danger)' : 'var(--text-muted)',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: activeTab === 'slowest' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              最慢 Top10
            </button>
          </div>
        </div>
      </section>

      {/* 最慢记录 Top 10 */}
      <section className="section" style={{ display: activeTab === 'slowest' ? 'block' : 'none' }}>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>用户</th>
                <th>用户消息</th>
                <th>回复预览</th>
                <th>回复条数</th>
                <th>Token</th>
                <th>首条响应 ↓</th>
                <th>总耗时</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {slowestRecords.length === 0 ? (
                <tr>
                  <td colSpan={9} className="loading">
                    暂无数据
                  </td>
                </tr>
              ) : (
                slowestRecords.map((record, i) => (
                  <tr
                    key={record.messageId || i}
                    onClick={() => setSelectedMessage(record as MessageRecord)}
                    style={{ cursor: 'pointer' }}
                    className="clickable-row"
                  >
                    <td>{formatDateTime(record.receivedAt)}</td>
                    <td>{record.userName || record.chatId}</td>
                    <td
                      style={{
                        maxWidth: '180px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {record.messagePreview || '-'}
                    </td>
                    <td
                      style={{
                        maxWidth: '200px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {record.replyPreview || '-'}
                    </td>
                    <td style={{ textAlign: 'center' }}>{record.replySegments ?? '-'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                      {record.tokenUsage?.toLocaleString() || '-'}
                    </td>
                    <td style={{ color: 'var(--danger)', fontWeight: 600 }}>
                      {record.aiDuration !== undefined ? formatDuration(record.aiDuration) : '-'}
                    </td>
                    <td>{formatDuration(record.totalDuration)}</td>
                    <td>
                      <span
                        className={`status-badge ${record.status === 'success' ? 'success' : 'danger'}`}
                      >
                        {record.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 实时消息 */}
      <section className="section" style={{ display: activeTab === 'realtime' ? 'block' : 'none' }}>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>用户</th>
                <th>用户消息</th>
                <th>回复预览</th>
                <th>回复条数</th>
                <th>Token</th>
                <th>首条响应</th>
                <th>总耗时</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="loading">
                    加载中...
                  </td>
                </tr>
              ) : messages.length === 0 ? (
                <tr>
                  <td colSpan={9} className="loading">
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
                    <td>{formatDateTime(msg.receivedAt)}</td>
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
                    <td style={{ textAlign: 'center' }}>
                      {msg.replySegments || '-'}
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                      {msg.tokenUsage?.toLocaleString() || '-'}
                    </td>
                    <td>{msg.aiDuration !== undefined ? formatDuration(msg.aiDuration) : '-'}</td>
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
