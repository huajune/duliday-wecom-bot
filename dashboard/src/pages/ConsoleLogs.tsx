import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

interface LogEntry {
  timestamp: string;
  level: 'log' | 'error' | 'warn' | 'debug' | 'verbose';
  context: string;
  message: string;
  trace?: string;
}

// 日志级别配色
const levelStyles: Record<string, { bg: string; color: string; label: string }> = {
  log: { bg: 'rgba(34, 197, 94, 0.1)', color: 'var(--success)', label: 'LOG' },
  error: { bg: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', label: 'ERR' },
  warn: { bg: 'rgba(245, 158, 11, 0.1)', color: 'var(--warning)', label: 'WRN' },
  debug: { bg: 'rgba(59, 130, 246, 0.1)', color: 'var(--primary)', label: 'DBG' },
  verbose: { bg: 'rgba(156, 163, 175, 0.1)', color: 'var(--text-muted)', label: 'VRB' },
};

export default function ConsoleLogs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState({
    level: 'all' as 'all' | LogEntry['level'],
    context: '',
    search: '',
  });
  const [isPaused, setIsPaused] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 连接 WebSocket
  useEffect(() => {
    const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';
    const socket = io(`${apiBase}/logs`, {
      transports: ['websocket', 'polling'],
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('history', (history: LogEntry[]) => {
      setLogs(history);
    });

    socket.on('log', (entry: LogEntry) => {
      if (!isPaused) {
        setLogs((prev) => {
          const newLogs = [...prev, entry];
          // 保留最近 500 条
          if (newLogs.length > 500) {
            return newLogs.slice(-500);
          }
          return newLogs;
        });
      }
    });

    socket.on('error', (err: { message: string }) => {
      console.error('WebSocket 错误:', err.message);
    });

    return () => {
      socket.disconnect();
    };
  }, [isPaused]);

  // 自动滚动
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  // 检测手动滚动
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  // 过滤日志
  const filteredLogs = logs.filter((log) => {
    if (filter.level !== 'all' && log.level !== filter.level) return false;
    if (filter.context && !log.context.toLowerCase().includes(filter.context.toLowerCase()))
      return false;
    if (filter.search && !log.message.toLowerCase().includes(filter.search.toLowerCase()))
      return false;
    return true;
  });

  // 获取所有上下文
  const contexts = [...new Set(logs.map((l) => l.context))].sort();

  // 清空日志
  const clearLogs = () => setLogs([]);

  // 格式化时间
  const formatTime = (iso: string) => {
    const date = new Date(iso);
    return date.toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(date.getMilliseconds()).padStart(3, '0');
  };

  return (
    <div id="page-console-logs" className="page-section active">
      {/* 工具栏 - 使用 control-panel 风格 */}
      <section
        className="control-panel"
        style={{
          marginBottom: '16px',
          padding: '20px 24px',
        }}
      >
        {/* 顶部：标题和连接状态 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px',
            paddingBottom: '16px',
            borderBottom: '1px solid rgba(148, 163, 184, 0.15)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <h3
              style={{
                margin: 0,
                fontSize: '16px',
                fontWeight: 600,
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span style={{ fontSize: '18px' }}>📡</span>
              实时日志
            </h3>
            {/* 连接状态徽章 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 12px',
                borderRadius: '20px',
                background: connected
                  ? 'rgba(16, 185, 129, 0.12)'
                  : 'rgba(239, 68, 68, 0.12)',
                border: `1px solid ${connected ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
              }}
            >
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: connected ? 'var(--success)' : 'var(--danger)',
                  boxShadow: connected
                    ? '0 0 8px var(--success)'
                    : '0 0 8px var(--danger)',
                  animation: connected ? 'pulse-dot 2s infinite' : 'none',
                }}
              />
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 500,
                  color: connected ? 'var(--success)' : 'var(--danger)',
                }}
              >
                {connected ? 'WebSocket 已连接' : '连接断开'}
              </span>
            </div>
          </div>

          {/* 统计信息 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 14px',
              background: 'rgba(99, 102, 241, 0.08)',
              borderRadius: '20px',
              border: '1px solid rgba(99, 102, 241, 0.15)',
            }}
          >
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
            <span
              style={{
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--primary)',
              }}
            >
              {filteredLogs.length}
            </span>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              / {logs.length} 条日志
            </span>
          </div>
        </div>

        {/* 底部：筛选和操作 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          {/* 日志级别筛选 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>级别</span>
            <select
              value={filter.level}
              onChange={(e) =>
                setFilter((f) => ({ ...f, level: e.target.value as typeof filter.level }))
              }
              style={{
                padding: '8px 14px',
                background: 'rgba(255, 255, 255, 0.7)',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                color: 'var(--text-primary)',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                outline: 'none',
              }}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>服务</span>
            <select
              value={filter.context}
              onChange={(e) => setFilter((f) => ({ ...f, context: e.target.value }))}
              style={{
                padding: '8px 14px',
                background: 'rgba(255, 255, 255, 0.7)',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                color: 'var(--text-primary)',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                maxWidth: '180px',
                transition: 'all 0.2s ease',
                outline: 'none',
              }}
            >
              <option value="">全部服务</option>
              {contexts.map((ctx) => (
                <option key={ctx} value={ctx}>
                  {ctx}
                </option>
              ))}
            </select>
          </div>

          {/* 搜索框 */}
          <div
            style={{
              position: 'relative',
              flex: 1,
              minWidth: '200px',
              maxWidth: '320px',
            }}
          >
            <span
              style={{
                position: 'absolute',
                left: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: '14px',
                color: 'var(--text-muted)',
                pointerEvents: 'none',
              }}
            >
              🔍
            </span>
            <input
              type="text"
              placeholder="搜索日志内容..."
              value={filter.search}
              onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
              style={{
                width: '100%',
                padding: '8px 14px 8px 36px',
                background: 'rgba(255, 255, 255, 0.7)',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                color: 'var(--text-primary)',
                fontSize: '13px',
                transition: 'all 0.2s ease',
                outline: 'none',
              }}
            />
          </div>

          <div style={{ flex: 1 }} />

          {/* 操作按钮组 */}
          <div style={{ display: 'flex', gap: '8px' }}>
            {/* 暂停/继续 */}
            <button
              onClick={() => setIsPaused(!isPaused)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 16px',
                background: isPaused
                  ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'
                  : 'rgba(255, 255, 255, 0.7)',
                border: isPaused ? 'none' : '1px solid var(--border)',
                borderRadius: '10px',
                color: isPaused ? '#fff' : 'var(--text-primary)',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: isPaused ? '0 4px 12px rgba(245, 158, 11, 0.3)' : 'none',
              }}
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
              onClick={clearLogs}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 16px',
                background: 'rgba(255, 255, 255, 0.7)',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                color: 'var(--text-secondary)',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.5)';
                e.currentTarget.style.color = 'var(--danger)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border)';
                e.currentTarget.style.color = 'var(--text-secondary)';
              }}
            >
              <span>🗑️</span> 清空
            </button>
          </div>
        </div>
      </section>

      {/* 日志列表 */}
      <section className="section" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div
          ref={containerRef}
          onScroll={handleScroll}
          style={{
            flex: 1,
            overflow: 'auto',
            background: 'var(--bg-primary)',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            fontFamily: 'ui-monospace, "SF Mono", Menlo, Monaco, monospace',
            fontSize: '12px',
            lineHeight: '1.6',
            minHeight: '500px',
            maxHeight: 'calc(100vh - 280px)',
          }}
        >
          {filteredLogs.length === 0 ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '300px',
                color: 'var(--text-muted)',
              }}
            >
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>📋</div>
              <div>{connected ? '等待日志...' : '连接中...'}</div>
              <div style={{ fontSize: '11px', marginTop: '8px' }}>
                {connected ? '新的日志将实时显示在这里' : '正在连接 WebSocket 服务'}
              </div>
            </div>
          ) : (
            <div style={{ padding: '8px 0' }}>
              {filteredLogs.map((log, i) => {
                const style = levelStyles[log.level] || levelStyles.log;
                return (
                  <div
                    key={i}
                    style={{
                      padding: '4px 12px',
                      borderLeft: `3px solid ${style.color}`,
                      background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                    }}
                  >
                    <span style={{ color: 'var(--text-muted)', marginRight: '8px' }}>
                      {formatTime(log.timestamp)}
                    </span>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        background: style.bg,
                        color: style.color,
                        fontSize: '10px',
                        fontWeight: 600,
                        marginRight: '8px',
                        minWidth: '32px',
                        textAlign: 'center',
                      }}
                    >
                      {style.label}
                    </span>
                    <span
                      style={{
                        color: 'var(--primary)',
                        marginRight: '8px',
                      }}
                    >
                      [{log.context}]
                    </span>
                    <span style={{ color: 'var(--text-primary)' }}>{log.message}</span>
                    {log.trace && (
                      <div
                        style={{
                          marginTop: '4px',
                          padding: '8px',
                          background: 'rgba(239, 68, 68, 0.1)',
                          borderRadius: '4px',
                          color: 'var(--danger)',
                          whiteSpace: 'pre-wrap',
                          fontSize: '11px',
                        }}
                      >
                        {log.trace}
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={logsEndRef} />
            </div>
          )}
        </div>

        {/* 自动滚动提示 */}
        {!autoScroll && (
          <button
            onClick={() => {
              setAutoScroll(true);
              logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }}
            style={{
              position: 'fixed',
              bottom: '24px',
              right: '24px',
              padding: '8px 16px',
              background: 'var(--primary)',
              border: 'none',
              borderRadius: '20px',
              color: '#fff',
              fontSize: '13px',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            }}
          >
            ↓ 滚动到底部
          </button>
        )}
      </section>
    </div>
  );
}
