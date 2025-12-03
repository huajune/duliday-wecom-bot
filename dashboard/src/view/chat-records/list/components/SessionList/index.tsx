import type { ChatSession } from '@/hooks/useMonitoring';
import styles from './index.module.scss';

// 客户类型标签映射
const CONTACT_TYPE_LABELS: Record<string, { label: string; className: string }> = {
  PERSONAL_WECHAT: { label: '个微', className: 'personal' },
  ENTERPRISE_WECHAT: { label: '企微', className: 'enterprise' },
  OFFICIAL_ACCOUNT: { label: '公众号', className: 'official' },
  UNKNOWN: { label: '', className: 'unknown' },
};

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

interface SessionListProps {
  sessions: ChatSession[];
  selectedChatId: string | null;
  onSelectChat: (chatId: string) => void;
  searchTerm: string;
  onSearchChange: (term: string) => void;
  isLoading: boolean;
  timeRangeLabel: string;
}

export default function SessionList({
  sessions,
  selectedChatId,
  onSelectChat,
  searchTerm,
  onSearchChange,
  isLoading,
  timeRangeLabel,
}: SessionListProps) {
  // 过滤会话（搜索）
  const filteredSessions = sessions.filter((session) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      session.chatId.toLowerCase().includes(term) ||
      session.candidateName?.toLowerCase().includes(term) ||
      session.managerName?.toLowerCase().includes(term)
    );
  });

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerTop}>
          <h3 className={styles.title}>会话列表</h3>
          <span className={styles.count}>{filteredSessions.length}</span>
        </div>

        <div className={styles.searchWrapper}>
          <span className={styles.searchIcon}>🔍</span>
          <input
            className={styles.searchInput}
            type="text"
            placeholder="搜索候选人..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      </div>

      <div className={styles.listContainer}>
        {isLoading ? (
          <div className={styles.stateContainer}>
            <div className="loading-spinner"></div>
            加载中...
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className={styles.stateContainer}>
            <div className={styles.stateIcon}>📭</div>
            <div>{timeRangeLabel}暂无会话记录</div>
          </div>
        ) : (
          filteredSessions.map((session) => {
            const contactTypeInfo = CONTACT_TYPE_LABELS[session.contactType || 'UNKNOWN'];
            const avatarChar = (session.candidateName || session.chatId || '?')
              .charAt(0)
              .toUpperCase();

            return (
              <div
                key={session.chatId}
                className={`${styles.sessionItem} ${selectedChatId === session.chatId ? styles.active : ''}`}
                onClick={() => onSelectChat(session.chatId)}
              >
                {session.avatar ? (
                  <img
                    src={session.avatar}
                    alt={session.candidateName || '头像'}
                    className={styles.avatar}
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
                      target.nextElementSibling?.classList.remove(styles.hidden);
                    }}
                  />
                ) : null}
                <div
                  className={`${styles.avatar} ${session.avatar ? styles.hidden : ''}`}
                  style={{ display: session.avatar ? 'none' : 'flex' }}
                >
                  {avatarChar}
                </div>

                <div className={styles.sessionContent}>
                  <div className={styles.topRow}>
                    <div className={styles.nameWrapper}>
                      <span
                        className={styles.candidateName}
                        title={session.candidateName || '未知候选人'}
                      >
                        {session.candidateName || '未知候选人'}
                      </span>
                      {contactTypeInfo.label && (
                        <span
                          className={`contact-type-badge ${contactTypeInfo.className}`}
                        >
                          {contactTypeInfo.label}
                        </span>
                      )}
                      {session.managerName && (
                        <span className={styles.managerBadge}>@{session.managerName}</span>
                      )}
                    </div>
                    <span className={styles.sessionTime}>
                      {session.lastTimestamp
                        ? formatTime(session.lastTimestamp).split(' ')[1]
                        : '-'}
                    </span>
                  </div>

                  <div className={styles.bottomRow}>
                    <span className={styles.preview}>{session.lastMessage || '暂无消息'}</span>
                    {session.messageCount > 0 && (
                      <span className={styles.msgCountBadge}>{session.messageCount}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
