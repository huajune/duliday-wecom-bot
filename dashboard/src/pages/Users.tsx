import { useState } from 'react';
import { useDashboard, useToggleUserHosting } from '@/hooks/useMonitoring';
import { formatRelativeTime } from '@/utils/format';

export default function Users() {
  const [timeRange] = useState<'today' | 'week' | 'month'>('today');
  const [searchQuery, setSearchQuery] = useState('');
  const { data: dashboard, isLoading } = useDashboard(timeRange);
  const toggleHosting = useToggleUserHosting();

  const users = dashboard?.todayUsers || [];

  // Filter users by search query
  const filteredUsers = users.filter(
    (u) =>
      !searchQuery ||
      (u.odName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.chatId.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Calculate Stats
  const stats = {
    totalUsers: users.length,
    hostedUsers: users.filter((u) => !u.isPaused).length,
    totalMessages: users.reduce((acc, u) => acc + (u.messageCount || 0), 0),
    totalTokens: users.reduce((acc, u) => acc + (u.tokenUsage || 0), 0),
  };

  return (
    <div id="page-users" className="page-section active" style={{ paddingBottom: '40px' }}>
      {/* Top Stats Grid */}
      <div className="stats-grid">
        <div className="glass-panel stat-card">
          <div className="stat-icon primary-bg">👥</div>
          <div className="stat-content">
            <div className="stat-label">今日咨询用户</div>
            <div className="stat-value primary">{stats.totalUsers}</div>
          </div>
        </div>
        <div className="glass-panel stat-card">
          <div className="stat-icon success-bg">🤖</div>
          <div className="stat-content">
            <div className="stat-label">正在托管</div>
            <div className="stat-value success">{stats.hostedUsers}</div>
          </div>
        </div>
        <div className="glass-panel stat-card">
          <div className="stat-icon info-bg">💬</div>
          <div className="stat-content">
            <div className="stat-label">累计消息</div>
            <div className="stat-value info">{stats.totalMessages}</div>
          </div>
        </div>
        <div className="glass-panel stat-card">
          <div className="stat-icon warning-bg">🪙</div>
          <div className="stat-content">
            <div className="stat-label">Token 消耗</div>
            <div className="stat-value warning">{stats.totalTokens.toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* Main Content - Card List */}
      <section className="glass-panel list-panel">
        <div className="panel-header">
          <div className="header-title">
            <span style={{ fontSize: '20px' }}>📋</span>
            <h3>用户列表</h3>
          </div>
          <div className="header-actions">
            <div className="search-box">
              <span>🔍</span>
              <input
                type="text"
                placeholder="搜索用户..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="user-list">
          {isLoading ? (
            <div className="loading-state">
              <div className="loading-spinner"></div>
              <span>加载中...</span>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="empty-state">
              <span>📭</span>
              <p>{searchQuery ? '没有找到匹配的用户' : '暂无数据'}</p>
            </div>
          ) : (
            filteredUsers.map((user) => (
              <div key={user.chatId} className="user-card">
                {/* Avatar */}
                <div className="user-avatar">
                  <img
                    src={`https://api.dicebear.com/7.x/thumbs/svg?seed=${encodeURIComponent(user.odName || user.chatId)}`}
                    alt={user.odName || '用户'}
                  />
                </div>

                {/* Main Content */}
                <div className="user-main">
                  <div className="user-header">
                    <span className="user-name">{user.odName || '未知用户'}</span>
                    {user.groupName && <span className="group-tag">{user.groupName}</span>}
                  </div>
                  <div className="user-preview">
                    {user.chatId.slice(0, 16)}...
                  </div>
                </div>

                {/* Right Side - Time, Count, Toggle */}
                <div className="user-meta">
                  <div className="meta-row">
                    <span className="user-time">{formatRelativeTime(user.lastActiveAt)}</span>
                  </div>
                  <div className="meta-row">
                    <span className="message-count">{user.messageCount}</span>
                    <label className="toggle-switch">
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
                      <div className={`toggle-track ${!user.isPaused ? 'on' : 'off'}`}>
                        <div className="toggle-thumb"></div>
                      </div>
                    </label>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Local Styles */}
      <style>{`
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 20px;
          margin-bottom: 24px;
        }

        @media (max-width: 1200px) {
          .stats-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        @media (max-width: 600px) {
          .stats-grid {
            grid-template-columns: 1fr;
          }
        }

        .glass-panel {
          background: #fff;
          border-radius: 20px;
          box-shadow: 0 8px 30px rgba(0,0,0,0.04);
          border: 1px solid rgba(255,255,255,0.6);
          overflow: hidden;
        }

        .stat-card {
          padding: 20px;
          display: flex;
          align-items: center;
          gap: 16px;
          transition: transform 0.2s;
        }
        .stat-card:hover { transform: translateY(-2px); }

        .stat-icon {
          width: 48px;
          height: 48px;
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
        }
        .primary-bg { background: rgba(59, 130, 246, 0.1); color: var(--primary); }
        .success-bg { background: rgba(16, 185, 129, 0.1); color: var(--success); }
        .warning-bg { background: rgba(245, 158, 11, 0.1); color: var(--warning); }
        .info-bg { background: rgba(99, 102, 241, 0.1); color: #6366f1; }

        .stat-content { display: flex; flex-direction: column; }
        .stat-label { font-size: 13px; color: var(--text-secondary); margin-bottom: 4px; }
        .stat-value { font-size: 24px; font-weight: 700; color: var(--text-primary); }
        .stat-value.primary { color: var(--primary); }
        .stat-value.success { color: var(--success); }
        .stat-value.warning { color: var(--warning); }
        .stat-value.info { color: #6366f1; }

        /* List Panel */
        .list-panel { padding: 0; }

        .panel-header {
          padding: 20px 24px;
          border-bottom: 1px solid var(--border);
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: rgba(249, 250, 251, 0.5);
        }
        .header-title { display: flex; align-items: center; gap: 10px; }
        .header-title h3 { margin: 0; font-size: 16px; font-weight: 600; }

        .search-box {
          position: relative;
          display: flex;
          align-items: center;
        }
        .search-box span { position: absolute; left: 10px; color: var(--text-muted); font-size: 14px; }
        .search-box input {
          padding: 8px 12px 8px 32px;
          border: 1px solid var(--border);
          border-radius: 8px;
          font-size: 13px;
          width: 200px;
          transition: all 0.2s;
          background: #fff;
        }
        .search-box input:focus {
          border-color: var(--primary);
          outline: none;
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
        }

        /* User List */
        .user-list {
          padding: 8px 16px;
        }

        .loading-state,
        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 60px 20px;
          color: var(--text-muted);
        }
        .empty-state span { font-size: 48px; margin-bottom: 12px; }
        .empty-state p { margin: 0; font-size: 14px; }

        /* User Card */
        .user-card {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 16px;
          border-radius: 16px;
          transition: background 0.2s;
          cursor: pointer;
        }
        .user-card:hover {
          background: rgba(249, 250, 251, 0.8);
        }
        .user-card:not(:last-child) {
          border-bottom: 1px solid var(--border);
        }

        /* Avatar */
        .user-avatar {
          width: 52px;
          height: 52px;
          border-radius: 14px;
          overflow: hidden;
          flex-shrink: 0;
          background: linear-gradient(135deg, #f0f4ff, #e8f0fe);
          box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        }
        .user-avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        /* Main Content */
        .user-main {
          flex: 1;
          min-width: 0;
        }
        .user-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 4px;
        }
        .user-name {
          font-size: 15px;
          font-weight: 600;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .group-tag {
          font-size: 11px;
          padding: 2px 8px;
          background: linear-gradient(135deg, #10b981, #059669);
          color: white;
          border-radius: 10px;
          font-weight: 500;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .user-preview {
          font-size: 13px;
          color: var(--text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* Meta */
        .user-meta {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 8px;
          flex-shrink: 0;
        }
        .meta-row {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .user-time {
          font-size: 12px;
          color: var(--text-muted);
        }
        .message-count {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 22px;
          height: 22px;
          padding: 0 7px;
          background: linear-gradient(135deg, #3b82f6, #2563eb);
          color: white;
          border-radius: 11px;
          font-size: 12px;
          font-weight: 600;
        }

        /* Toggle Switch */
        .toggle-switch {
          position: relative;
          display: inline-block;
          width: 44px;
          height: 24px;
          cursor: pointer;
        }
        .toggle-switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }
        .toggle-track {
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          border-radius: 24px;
          transition: .3s;
        }
        .toggle-track.on {
          background: linear-gradient(135deg, #10b981, #059669);
        }
        .toggle-track.off {
          background: #e5e7eb;
        }
        .toggle-thumb {
          position: absolute;
          height: 20px;
          width: 20px;
          left: 2px;
          bottom: 2px;
          background-color: white;
          border-radius: 50%;
          transition: .3s;
          box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        }
        .toggle-switch input:checked + .toggle-track .toggle-thumb {
          transform: translateX(20px);
        }
      `}</style>
    </div>
  );
}
