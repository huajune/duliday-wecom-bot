import { useState } from 'react';
import { useDashboard, useToggleUserHosting } from '@/hooks/useMonitoring';
import { formatDateTime } from '@/utils/format';

export default function Users() {
  const [timeRange] = useState<'today' | 'week' | 'month'>('today');
  const { data: dashboard, isLoading } = useDashboard(timeRange);
  const toggleHosting = useToggleUserHosting();

  const users = dashboard?.todayUsers || [];

  // Calculate Stats
  const stats = {
    totalUsers: users.length,
    hostedUsers: users.filter(u => !u.isPaused).length,
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

      {/* Main Content */}
      <section className="glass-panel table-panel">
        <div className="panel-header">
          <div className="header-title">
            <span style={{ fontSize: '20px' }}>📋</span>
            <h3>用户列表</h3>
          </div>
          <div className="header-actions">
            <div className="search-box">
              <span>🔍</span>
              <input type="text" placeholder="搜索用户..." />
            </div>
          </div>
        </div>

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>用户</th>
                <th>会话 ID</th>
                <th style={{ textAlign: 'center' }}>消息数</th>
                <th style={{ textAlign: 'right' }}>Token 消耗</th>
                <th>首次活跃</th>
                <th>最后活跃</th>
                <th style={{ textAlign: 'center' }}>托管状态</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="loading">
                    <div className="loading-spinner"></div> 加载中...
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
                  <tr key={user.chatId} className="hover-row">
                    <td>
                      <div className="user-cell">
                        <div className="avatar">
                          {(user.odName || user.chatId || '?').charAt(0).toUpperCase()}
                        </div>
                        <div className="user-info">
                          <span className="user-name">{user.odName || '未知用户'}</span>
                          {user.groupName && <span className="badge-tag">群</span>}
                        </div>
                      </div>
                    </td>
                    <td className="mono-text" title={user.chatId}>
                      {user.chatId.slice(0, 8)}...
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className="count-badge">{user.messageCount}</span>
                    </td>
                    <td style={{ textAlign: 'right' }} className="mono-text">
                      {user.tokenUsage?.toLocaleString()}
                    </td>
                    <td className="date-text">{formatDateTime(user.firstActiveAt)}</td>
                    <td className="date-text">{formatDateTime(user.lastActiveAt)}</td>
                    <td style={{ textAlign: 'center' }}>
                      <label className="toggle-switch-wrapper">
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
                        <div className={`toggle-slider ${!user.isPaused ? 'on' : 'off'}`}>
                          <div className="toggle-knob"></div>
                        </div>
                      </label>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
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

        .table-panel { padding: 0; }
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
        .search-box input:focus { border-color: var(--primary); outline: none; box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1); }

        .table-wrapper { padding: 0; }
        table { width: 100%; border-collapse: collapse; }
        th {
          text-align: left;
          padding: 16px 24px;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-secondary);
          background: rgba(249, 250, 251, 0.5);
          border-bottom: 1px solid var(--border);
        }
        td {
          padding: 16px 24px;
          font-size: 13px;
          color: var(--text-primary);
          border-bottom: 1px solid var(--border);
          vertical-align: middle;
        }
        .hover-row:hover { background: rgba(249, 250, 251, 0.8); }

        .user-cell { display: flex; align-items: center; gap: 12px; }
        .avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: linear-gradient(135deg, #60a5fa, #3b82f6);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-weight: 600;
          box-shadow: 0 2px 4px rgba(59, 130, 246, 0.2);
        }
        .user-info { display: flex; flex-direction: column; gap: 2px; }
        .user-name { font-weight: 500; }
        .badge-tag {
          font-size: 10px;
          background: rgba(245, 158, 11, 0.1);
          color: var(--warning);
          padding: 1px 6px;
          border-radius: 4px;
          width: fit-content;
        }

        .mono-text { font-family: 'SF Mono', Menlo, monospace; font-size: 12px; color: var(--text-secondary); }
        .date-text { font-size: 12px; color: var(--text-muted); }
        .count-badge {
          background: rgba(243, 244, 246, 1);
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 500;
          color: var(--text-secondary);
        }

        /* Custom Toggle */
        .toggle-switch-wrapper {
          position: relative;
          display: inline-block;
          width: 44px;
          height: 24px;
          cursor: pointer;
        }
        .toggle-switch-wrapper input { opacity: 0; width: 0; height: 0; }
        .toggle-slider {
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          border-radius: 24px;
          transition: .3s;
        }
        .toggle-slider.on { background: var(--success); }
        .toggle-slider.off { background: #e5e7eb; }
        .toggle-knob {
          position: absolute;
          content: "";
          height: 20px;
          width: 20px;
          left: 2px;
          bottom: 2px;
          background-color: white;
          border-radius: 50%;
          transition: .3s;
          box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        }
        .toggle-switch-wrapper input:checked + .toggle-slider .toggle-knob {
          transform: translateX(20px);
        }
      `}</style>
    </div>
  );
}
