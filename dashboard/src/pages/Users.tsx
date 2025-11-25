import { useState } from 'react';
import { useDashboard, useToggleUserHosting } from '@/hooks/useMonitoring';
import { formatTime } from '@/utils/format';

export default function Users() {
  const [timeRange] = useState<'today' | 'week' | 'month'>('today');
  const { data: dashboard, isLoading } = useDashboard(timeRange);
  const toggleHosting = useToggleUserHosting();

  const users = dashboard?.todayUsers || [];

  return (
    <div id="page-users" className="page-section active">
      {/* 用户列表 */}
      <section className="section">
        <div className="section-header">
          <h3>
            今日咨询用户{' '}
            <span style={{ fontSize: '14px', color: 'var(--text-secondary)', fontWeight: 'normal' }}>
              ({users.length} 人)
            </span>
          </h3>
        </div>
        <div className="table-wrapper">
          <table>
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
                  <td colSpan={7} className="loading">
                    加载中
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="loading">
                    暂无数据
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.chatId}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div
                          className="avatar"
                          style={{
                            width: '24px',
                            height: '24px',
                            borderRadius: '50%',
                            background: 'var(--primary-soft)',
                            color: 'var(--primary)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '12px',
                            fontWeight: 500,
                          }}
                        >
                          {(user.odName || user.chatId || '?').charAt(0).toUpperCase()}
                        </div>
                        <span>{user.odName || '未知用户'}</span>
                      </div>
                    </td>
                    <td className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                      {user.chatId}
                      {user.groupName && <span className="badge warning" style={{ marginLeft: '4px' }}>群</span>}
                    </td>
                    <td>{user.messageCount}</td>
                    <td>{user.tokenUsage}</td>
                    <td>{formatTime(user.firstActiveAt)}</td>
                    <td>{formatTime(user.lastActiveAt)}</td>
                    <td>
                      <label className="toggle-switch" style={{ transform: 'scale(0.8)', transformOrigin: 'left center' }}>
                        <input
                          type="checkbox"
                          checked={!user.isPaused}
                          onChange={(e) =>
                            toggleHosting.mutate({
                              chatId: user.chatId,
                              enabled: e.target.checked,
                            })
                          }
                        />
                        <span className={`status-text ${!user.isPaused ? 'enabled' : 'disabled'}`}>
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
    </div>
  );
}
