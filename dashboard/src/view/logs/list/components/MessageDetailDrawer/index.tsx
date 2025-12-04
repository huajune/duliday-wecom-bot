import { useState } from 'react';
import { formatDateTime } from '@/utils/format';
import type { MessageRecord } from '@/types/monitoring';
import HistorySection from './HistorySection';
import ChatSection from './ChatSection';
import TechnicalStats from './TechnicalStats';

interface MessageDetailDrawerProps {
  message: MessageRecord;
  onClose: () => void;
}

export default function MessageDetailDrawer({ message, onClose }: MessageDetailDrawerProps) {
  const [showRaw, setShowRaw] = useState(true);

  // 从 agentInvocation.response.messages 中提取完整的 assistant 响应
  const getFullAgentResponse = (): string => {
    const response = message.agentInvocation?.response as { messages?: Array<{ role: string; parts?: Array<{ type: string; text?: string }> }> } | undefined;
    const messages = response?.messages;
    if (!messages || messages.length === 0) {
      return message.replyPreview || '(无响应内容)';
    }
    const assistantMessages = messages.filter((m) => m.role === 'assistant');
    if (assistantMessages.length === 0) {
      return message.replyPreview || '(无响应内容)';
    }
    return (
      assistantMessages
        .flatMap((m) =>
          (m.parts || []).filter((p) => p.type === 'text').map((p) => p.text)
        )
        .join('\n\n') ||
      message.replyPreview ||
      '(无响应内容)'
    );
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="drawer-overlay" onClick={handleOverlayClick}>
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
            {/* History Messages */}
            <HistorySection message={message} />

            <ChatSection
              message={message}
              fullAgentResponse={getFullAgentResponse()}
              showRaw={showRaw}
              onToggleRaw={() => setShowRaw(!showRaw)}
            />
          </div>

          {/* Right Column: Technical Stats */}
          <div style={{ flex: '0 0 360px', background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border)', padding: '20px', overflowY: 'auto' }}>
            <TechnicalStats message={message} />
          </div>
        </div>
      </div>
    </div>
  );
}
