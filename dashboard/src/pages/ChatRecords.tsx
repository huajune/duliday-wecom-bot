import { useState, useMemo } from 'react';
import { useChatSessions, useChatSessionMessages, type ChatSession, type ChatMessage } from '@/hooks/useMonitoring';

// 格式化时间戳
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// 格式化日期（用于分组）
function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return '今天';
  } else if (date.toDateString() === yesterday.toDateString()) {
    return '昨天';
  }
  return date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
}

// 客户类型标签映射
const CONTACT_TYPE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  PERSONAL_WECHAT: { label: '个微', color: '#16a34a', bg: 'rgba(22, 163, 74, 0.1)' },
  ENTERPRISE_WECHAT: { label: '企微', color: '#2563eb', bg: 'rgba(37, 99, 235, 0.1)' },
  OFFICIAL_ACCOUNT: { label: '公众号', color: '#9333ea', bg: 'rgba(147, 51, 234, 0.1)' },
  UNKNOWN: { label: '', color: '#6b7280', bg: 'rgba(107, 114, 128, 0.1)' },
};

// 消息类型图标（用于非文本消息的展示）
function getMessageTypeIcon(messageType?: string): string {
  const icons: Record<string, string> = {
    IMAGE: '🖼️',
    VOICE: '🎤',
    VIDEO: '🎬',
    FILE: '📎',
    LINK: '🔗',
    LOCATION: '📍',
    EMOTION: '😊',
    MINI_PROGRAM: '📱',
  };
  return messageType ? icons[messageType] || '' : '';
}

export default function ChatRecords() {
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [days, setDays] = useState<number>(1);

  const { data: sessionsData, isLoading: sessionsLoading } = useChatSessions(days);
  const { data: messagesData, isLoading: messagesLoading } = useChatSessionMessages(selectedChatId);

  const sessions = sessionsData?.sessions || [];
  const messages = messagesData?.messages || [];

  // 获取当前选中的会话详情
  const currentSession = useMemo(() =>
    sessions.find(s => s.chatId === selectedChatId),
    [sessions, selectedChatId]
  );

  // 过滤会话
  const filteredSessions = sessions.filter((session: ChatSession) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      session.chatId.toLowerCase().includes(term) ||
      session.candidateName?.toLowerCase().includes(term) ||
      session.managerName?.toLowerCase().includes(term)
    );
  });

  // 按日期分组消息
  const groupedMessages: { date: string; messages: ChatMessage[] }[] = [];
  let currentDate = '';
  messages.forEach((msg: ChatMessage) => {
    const msgDate = formatDate(msg.timestamp);
    if (msgDate !== currentDate) {
      currentDate = msgDate;
      groupedMessages.push({ date: msgDate, messages: [] });
    }
    groupedMessages[groupedMessages.length - 1].messages.push(msg);
  });

  // 计算统计数据
  const stats = {
    totalSessions: sessions.length,
    totalMessages: sessions.reduce((acc: number, s: ChatSession) => acc + s.messageCount, 0),
    activeSessions: sessions.filter((s: ChatSession) => {
      const lastTime = s.lastTimestamp || 0;
      const hourAgo = Date.now() - 60 * 60 * 1000;
      return lastTime > hourAgo;
    }).length,
  };

  return (
    <div className="page-section active" style={{ paddingBottom: '40px' }}>
      {/* 顶部统计 */}
      <div className="stat-grid-3">
        <div className="glass-panel stat-card">
          <div className="stat-icon primary-bg">💬</div>
          <div className="stat-content">
            <div className="stat-label">会话总数</div>
            <div className="stat-value primary">{stats.totalSessions}</div>
          </div>
        </div>
        <div className="glass-panel stat-card">
          <div className="stat-icon success-bg">📝</div>
          <div className="stat-content">
            <div className="stat-label">消息总数</div>
            <div className="stat-value success">{stats.totalMessages}</div>
          </div>
        </div>
        <div className="glass-panel stat-card">
          <div className="stat-icon warning-bg">🔥</div>
          <div className="stat-content">
            <div className="stat-label">近1小时活跃</div>
            <div className="stat-value warning">{stats.activeSessions}</div>
          </div>
        </div>
      </div>

      {/* 主内容区 */}
      <div className="chat-layout">
        {/* 左侧会话列表 */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="chat-panel-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h3 className="panel-title">会话列表</h3>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', background: 'rgba(0,0,0,0.04)', padding: '2px 8px', borderRadius: '10px' }}>{filteredSessions.length}</span>
            </div>

            <div className="header-controls-row">
              <div className="filter-group">
                <select
                  className="days-select"
                  value={days}
                  onChange={(e) => {
                    setDays(Number(e.target.value));
                    setSelectedChatId(null);
                  }}
                >
                  <option value={1}>今天</option>
                  <option value={3}>近 3 天</option>
                  <option value={7}>近 7 天</option>
                  <option value={30}>近 30 天</option>
                  <option value={90}>近 90 天</option>
                </select>
              </div>
              <div className="search-box-wrapper" style={{ flex: 1 }}>
                <span className="search-box-icon">🔍</span>
                <input
                  className="search-input-refined"
                  type="text"
                  placeholder="搜索候选人..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {sessionsLoading ? (
              <div className="state-container">
                <div className="loading-spinner"></div>
                加载中...
              </div>
            ) : filteredSessions.length === 0 ? (
              <div className="state-container">暂无会话记录</div>
            ) : (
              filteredSessions.map((session: ChatSession) => {
                const contactTypeInfo = CONTACT_TYPE_LABELS[session.contactType || 'UNKNOWN'];
                const avatarChar = (session.candidateName || session.chatId || '?').charAt(0).toUpperCase();

                return (
                  <div
                    key={session.chatId}
                    className={`session-item-refined ${selectedChatId === session.chatId ? 'active' : ''}`}
                    onClick={() => setSelectedChatId(session.chatId)}
                  >
                    {/* 头像：优先使用真实头像，否则显示首字母 */}
                    {session.avatar ? (
                      <img
                        src={session.avatar}
                        alt={session.candidateName || '头像'}
                        className="chat-avatar"
                        style={{ objectFit: 'cover' }}
                        onError={(e) => {
                          // 头像加载失败时显示首字母
                          const target = e.target as HTMLImageElement;
                          target.style.display = 'none';
                          target.nextElementSibling?.classList.remove('hidden');
                        }}
                      />
                    ) : null}
                    <div
                      className={`chat-avatar ${session.avatar ? 'hidden' : ''}`}
                      style={{ display: session.avatar ? 'none' : 'flex' }}
                    >
                      {avatarChar}
                    </div>

                    <div className="session-content">
                      <div className="session-top-row">
                        <div className="session-name-wrapper">
                          <span className="candidate-name" title={session.candidateName || '未知候选人'}>
                            {session.candidateName || '未知候选人'}
                          </span>
                          {/* 客户类型徽章 */}
                          {contactTypeInfo.label && (
                            <span
                              className="contact-type-badge"
                              style={{
                                fontSize: '10px',
                                padding: '1px 5px',
                                borderRadius: '4px',
                                color: contactTypeInfo.color,
                                background: contactTypeInfo.bg,
                                marginLeft: '4px',
                              }}
                            >
                              {contactTypeInfo.label}
                            </span>
                          )}
                          {session.managerName && (
                            <span className="manager-badge">
                              @{session.managerName}
                            </span>
                          )}
                        </div>
                        <span className="session-time">
                          {session.lastTimestamp ? formatTime(session.lastTimestamp).split(' ')[1] : '-'}
                        </span>
                      </div>

                      <div className="session-bottom-row">
                        <span className="session-preview">
                          {session.lastMessage || '暂无消息'}
                        </span>
                        {session.messageCount > 0 && (
                          <span className="msg-count-badge">{session.messageCount}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* 右侧消息详情 */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column' }}>
          {!selectedChatId ? (
            <div className="state-container">
              <div className="state-icon-large">💬</div>
              <div>选择一个会话查看消息</div>
            </div>
          ) : messagesLoading ? (
            <div className="state-container">
              <div className="loading-spinner"></div>
              加载消息中...
            </div>
          ) : messages.length === 0 ? (
            <div className="state-container">
              <div className="state-icon-large">📭</div>
              <div>该会话暂无消息</div>
            </div>
          ) : (
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
              {groupedMessages.map((group) => (
                <div key={group.date} className="message-group">
                  <div className="message-date-divider">
                    <span className="message-date-badge">{group.date}</span>
                  </div>
                  {group.messages.map((msg: ChatMessage) => {
                    // Determine names and avatar
                    const isAssistant = msg.role === 'assistant';
                    const displayName = isAssistant
                      ? (msg.managerName || currentSession?.managerName || '招募经理')
                      : (msg.candidateName || currentSession?.candidateName || '候选人');
                    const avatarChar = displayName.charAt(0).toUpperCase();
                    // 用户消息可能有头像，助手消息使用默认
                    const avatarUrl = !isAssistant ? (msg.avatar || currentSession?.avatar) : undefined;
                    const messageTypeIcon = getMessageTypeIcon(msg.messageType);

                    return (
                      <div
                        key={msg.id}
                        className={`message-row ${isAssistant ? 'assistant' : ''}`}
                      >
                        {/* 头像：用户消息优先使用真实头像 */}
                        {avatarUrl ? (
                          <img
                            src={avatarUrl}
                            alt={displayName}
                            className="chat-avatar"
                            style={{
                              width: '36px',
                              height: '36px',
                              objectFit: 'cover',
                              boxShadow: '0 4px 10px rgba(59, 130, 246, 0.2)',
                            }}
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.style.display = 'none';
                              target.nextElementSibling?.removeAttribute('style');
                            }}
                          />
                        ) : null}
                        <div
                          className="chat-avatar"
                          style={{
                            display: avatarUrl ? 'none' : 'flex',
                            width: '36px',
                            height: '36px',
                            fontSize: '14px',
                            background: isAssistant
                              ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                              : 'linear-gradient(135deg, #60a5fa, #3b82f6)',
                            boxShadow: isAssistant
                              ? '0 4px 10px rgba(245, 158, 11, 0.2)'
                              : '0 4px 10px rgba(59, 130, 246, 0.2)',
                          }}
                        >
                          {avatarChar}
                        </div>
                        <div style={{ maxWidth: '70%' }}>
                          <div className={`message-meta ${isAssistant ? 'assistant' : ''}`}>
                            <span className="message-sender">
                              {displayName}
                            </span>
                            <span className="message-time">{formatTime(msg.timestamp)}</span>
                          </div>
                          <div
                            className={`chat-message-bubble ${isAssistant ? 'assistant' : 'user'}`}
                            style={isAssistant ? {
                              background: 'linear-gradient(135deg, rgba(254, 243, 199, 0.5), rgba(253, 230, 138, 0.3))',
                              border: '1px solid rgba(251, 191, 36, 0.2)',
                              color: '#92400e',
                            } : undefined}
                          >
                            {messageTypeIcon && <span style={{ marginRight: '4px' }}>{messageTypeIcon}</span>}
                            {msg.content}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
