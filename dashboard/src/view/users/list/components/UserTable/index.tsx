import { formatTime } from '@/utils/format';
import styles from './index.module.scss';

interface UserData {
  chatId: string;
  odName?: string;
  groupName?: string;
  messageCount: number;
  tokenUsage: number;
  firstActiveAt: string;
  lastActiveAt: string;
  isPaused: boolean;
}

interface UserTableProps {
  users: UserData[];
  isLoading: boolean;
  onToggleHosting: (chatId: string, enabled: boolean) => void;
}

export default function UserTable({ users, isLoading, onToggleHosting }: UserTableProps) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h3>
          今日咨询用户 <span className={styles.userCount}>({users.length} 人)</span>
        </h3>
      </div>
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>用户</th>
              <th>会话</th>
              <th>消息数</th>
              <th>Token 消耗</th>
              <th>首次活跃</th>
              <th>最后活跃</th>
              <th>托管状态</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className={styles.loadingCell}>
                  加载中...
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={7} className={styles.loadingCell}>
                  暂无数据
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <tr key={user.chatId}>
                  <td>
                    <div className={styles.userCell}>
                      <div className={styles.avatar}>
                        {(user.odName || user.chatId || '?').charAt(0).toUpperCase()}
                      </div>
                      <span>{user.odName || '未知用户'}</span>
                    </div>
                  </td>
                  <td className={styles.chatIdCell}>
                    {user.chatId}
                    {user.groupName && <span className={styles.groupBadge}>群</span>}
                  </td>
                  <td>{user.messageCount}</td>
                  <td>{user.tokenUsage}</td>
                  <td>{formatTime(user.firstActiveAt)}</td>
                  <td>{formatTime(user.lastActiveAt)}</td>
                  <td>
                    <label className={styles.toggleSwitch}>
                      <input
                        type="checkbox"
                        checked={!user.isPaused}
                        onChange={(e) => onToggleHosting(user.chatId, e.target.checked)}
                      />
                      <span className={`${styles.statusText} ${!user.isPaused ? styles.enabled : styles.disabled}`}>
                        {!user.isPaused ? '已托管' : '已暂停'}
                      </span>
                    </label>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
