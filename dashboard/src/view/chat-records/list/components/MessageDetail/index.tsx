import type { ChatMessage, ChatSession } from '@/hooks/monitoring/useChatRecords';
import styles from './index.module.scss';

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

// 消息类型图标
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

interface MessageDetailProps {
  selectedChatId: string | null;
  messages: ChatMessage[];
  currentSession?: ChatSession;
  isLoading: boolean;
}

export default function MessageDetail({
  selectedChatId,
  messages,
  currentSession,
  isLoading,
}: MessageDetailProps) {
  // 按日期分组消息
  const groupedMessages: { date: string; messages: ChatMessage[] }[] = [];
  let currentDate = '';
  messages.forEach((msg) => {
    const msgDate = formatDate(msg.timestamp);
    if (msgDate !== currentDate) {
      currentDate = msgDate;
      groupedMessages.push({ date: msgDate, messages: [] });
    }
    groupedMessages[groupedMessages.length - 1].messages.push(msg);
  });

  if (!selectedChatId) {
    return (
      <div className={styles.panel}>
        <div className={styles.stateContainer}>
          <div className={styles.stateIcon}>💬</div>
          <div>选择一个会话查看消息</div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={styles.panel}>
        <div className={styles.stateContainer}>
          <div className="loading-spinner"></div>
          加载消息中...
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className={styles.panel}>
        <div className={styles.stateContainer}>
          <div className={styles.stateIcon}>📭</div>
          <div>该会话暂无消息</div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.messagesContainer}>
        {groupedMessages.map((group) => (
          <div key={group.date} className={styles.messageGroup}>
            <div className={styles.dateDivider}>
              <span className={styles.dateBadge}>{group.date}</span>
            </div>
            {group.messages.map((msg) => {
              const isAssistant = msg.role === 'assistant';
              const displayName = isAssistant
                ? msg.managerName || currentSession?.managerName || '招募经理'
                : msg.candidateName || currentSession?.candidateName || '候选人';
              const avatarChar = displayName.charAt(0).toUpperCase();
              const avatarUrl = !isAssistant
                ? msg.avatar || currentSession?.avatar
                : undefined;
              const messageTypeIcon = getMessageTypeIcon(msg.messageType);

              return (
                <div
                  key={msg.id}
                  className={`${styles.messageRow} ${isAssistant ? styles.assistant : ''}`}
                >
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={displayName}
                      className={`${styles.avatar} ${styles.user}`}
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                        target.nextElementSibling?.removeAttribute('style');
                      }}
                    />
                  ) : null}
                  <div
                    className={`${styles.avatar} ${isAssistant ? styles.assistant : styles.user}`}
                    style={{ display: avatarUrl ? 'none' : 'flex' }}
                  >
                    {avatarChar}
                  </div>
                  <div className={styles.messageContent}>
                    <div
                      className={`${styles.messageMeta} ${isAssistant ? styles.assistant : ''}`}
                    >
                      <span className={styles.senderName}>{displayName}</span>
                      <span className={styles.messageTime}>{formatTime(msg.timestamp)}</span>
                    </div>
                    <div
                      className={`${styles.messageBubble} ${isAssistant ? styles.assistant : styles.user}`}
                    >
                      {messageTypeIcon && (
                        <span className={styles.messageTypeIcon}>{messageTypeIcon}</span>
                      )}
                      {msg.content}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
