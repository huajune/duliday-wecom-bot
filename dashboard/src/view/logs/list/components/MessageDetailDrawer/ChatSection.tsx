import type { MessageRecord } from '@/types/monitoring';

interface ChatSectionProps {
  message: MessageRecord;
  fullAgentResponse: string;
  showRaw: boolean;
  onToggleRaw: () => void;
}

export default function ChatSection({
  message,
  fullAgentResponse,
  showRaw,
  onToggleRaw,
}: ChatSectionProps) {
  return (
    <>
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
            {fullAgentResponse}
          </div>
        </div>

        {/* Fallback Box - 降级信息 */}
        {message.isFallback && (
          <div className="fallback-box" style={{ marginTop: '24px' }}>
            <div className="fallback-header">
              <span>⚡</span> 降级响应
              <span className={`fallback-badge ${message.fallbackSuccess ? 'success' : 'failed'}`}>
                {message.fallbackSuccess ? '用户无感知' : '降级失败'}
              </span>
            </div>
            <div className="fallback-content">
              <strong>降级标记：</strong>{message.agentInvocation?.isFallback ? '是' : '否'}
            </div>
          </div>
        )}

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
            onClick={onToggleRaw}
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
            {JSON.stringify(message.agentInvocation || message, null, 2)}
          </pre>
        )}
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

        .code-block {
          background: #1e1e1e;
          color: #d4d4d4;
          padding: 16px;
          border-radius: 8px;
          font-family: 'Menlo', 'Monaco', monospace;
        }

        .fallback-box {
          background: #fffbeb;
          border: 1px solid #fde68a;
          border-radius: 12px;
          padding: 16px;
          color: #b45309;
        }
        .fallback-header {
          font-weight: 600;
          margin-bottom: 8px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .fallback-badge {
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 99px;
        }
        .fallback-badge.success {
          background: #fef3c7;
          color: #b45309;
        }
        .fallback-badge.failed {
          background: #fee2e2;
          color: #dc2626;
        }
        .fallback-content {
          font-size: 13px;
        }
        .fallback-details {
          margin-top: 8px;
          font-size: 12px;
          font-family: monospace;
          background: #fef3c7;
          padding: 8px;
          border-radius: 6px;
        }

        .error-details {
          margin-top: 8px;
          font-size: 12px;
          font-family: monospace;
          background: #fff1f2;
          padding: 8px;
          border-radius: 6px;
        }
        .error-content {
          font-size: 13px;
          white-space: pre-wrap;
          font-family: monospace;
        }
      `}</style>
    </>
  );
}
