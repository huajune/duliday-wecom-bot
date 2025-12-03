// import styles from './index.module.scss';

interface FilterState {
  level: 'all' | 'log' | 'error' | 'warn' | 'debug' | 'verbose';
  context: string;
  search: string;
}

interface ToolBarProps {
  connected: boolean;
  isPaused: boolean;
  filteredCount: number;
  totalCount: number;
  filter: FilterState;
  contexts: string[];
  onFilterChange: (filter: FilterState) => void;
  onPauseToggle: () => void;
  onClear: () => void;
}

export default function ToolBar({
  connected,
  isPaused,
  filteredCount,
  totalCount,
  filter,
  contexts,
  onFilterChange,
  onPauseToggle,
  onClear,
}: ToolBarProps) {
  return (
    <section className="log-toolbar">
      {/* 顶部：标题和连接状态 */}
      <div className="toolbar-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <h3 className="toolbar-title">
            <span>📡</span>
            实时日志
          </h3>
          {/* 连接状态徽章 */}
          <div className={`connection-badge ${connected ? 'connected' : 'disconnected'}`}>
            <span className="dot" />
            <span className="text">{connected ? 'WebSocket 已连接' : '连接断开'}</span>
          </div>
        </div>

        {/* 统计信息 */}
        <div className="stats-badge">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="3" y="12" width="5" height="9" rx="2.5" fill="url(#grad1)" />
            <rect x="9.5" y="8" width="5" height="13" rx="2.5" fill="url(#grad2)" />
            <rect x="16" y="4" width="5" height="17" rx="2.5" fill="url(#grad3)" />
            <defs>
              <linearGradient id="grad1" x1="5.5" y1="12" x2="5.5" y2="21" gradientUnits="userSpaceOnUse">
                <stop stopColor="#4ade80" />
                <stop offset="1" stopColor="#22c55e" />
              </linearGradient>
              <linearGradient id="grad2" x1="12" y1="8" x2="12" y2="21" gradientUnits="userSpaceOnUse">
                <stop stopColor="#f87171" />
                <stop offset="1" stopColor="#ef4444" />
              </linearGradient>
              <linearGradient id="grad3" x1="18.5" y1="4" x2="18.5" y2="21" gradientUnits="userSpaceOnUse">
                <stop stopColor="#60a5fa" />
                <stop offset="1" stopColor="#3b82f6" />
              </linearGradient>
            </defs>
          </svg>
          <span className="count">{filteredCount}</span>
          <span className="total">/ {totalCount} 条日志</span>
        </div>
      </div>

      {/* 底部：筛选和操作 */}
      <div className="toolbar-actions">
        {/* 日志级别筛选 */}
        <div className="filter-group">
          <span className="label">级别</span>
          <select
            value={filter.level}
            onChange={(e) => onFilterChange({ ...filter, level: e.target.value as FilterState['level'] })}
          >
            <option value="all">全部级别</option>
            <option value="log">LOG</option>
            <option value="warn">WARN</option>
            <option value="error">ERROR</option>
            <option value="debug">DEBUG</option>
            <option value="verbose">VERBOSE</option>
          </select>
        </div>

        {/* 上下文筛选 */}
        <div className="filter-group">
          <span className="label">服务</span>
          <select
            value={filter.context}
            onChange={(e) => onFilterChange({ ...filter, context: e.target.value })}
            style={{ maxWidth: '180px' }}
          >
            <option value="">全部服务</option>
            {contexts.map((ctx) => (
              <option key={ctx} value={ctx}>{ctx}</option>
            ))}
          </select>
        </div>

        {/* 搜索框 */}
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder="搜索日志内容..."
            value={filter.search}
            onChange={(e) => onFilterChange({ ...filter, search: e.target.value })}
          />
        </div>

        <div style={{ flex: 1 }} />

        {/* 操作按钮组 */}
        <div style={{ display: 'flex', gap: '8px' }}>
          {/* 暂停/继续 */}
          <button
            onClick={onPauseToggle}
            className={`action-btn pause-btn ${isPaused ? 'paused' : ''}`}
          >
            {isPaused ? (
              <>
                <span>▶</span> 继续
              </>
            ) : (
              <>
                <span>⏸</span> 暂停
              </>
            )}
          </button>

          {/* 清空 */}
          <button
            onClick={onClear}
            className="action-btn clear-btn"
          >
            <span>🗑️</span> 清空
          </button>
        </div>
      </div>
    </section>
  );
}
