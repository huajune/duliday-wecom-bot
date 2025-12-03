import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

// 组件导入
import ToolBar from './components/ToolBar';
import LogList, { LogEntry, LogListRef } from './components/LogList';

// 样式导入
import styles from './styles/index.module.scss';

interface FilterState {
  level: 'all' | LogEntry['level'];
  context: string;
  search: string;
}

export default function ConsoleLogs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState<FilterState>({
    level: 'all',
    context: '',
    search: '',
  });
  const [isPaused, setIsPaused] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const logListRef = useRef<LogListRef>(null);

  // 连接 WebSocket
  useEffect(() => {
    // 自动检测当前访问的 host，支持 ngrok 等代理环境
    const host = window.location.host;
    // 如果是开发模式下的 5173 端口，连接到 8080；否则使用当前 host
    const wsHost = host.includes(':5173') ? 'localhost:8080' : host;
    const apiBase = import.meta.env.VITE_API_BASE_URL || `${window.location.protocol}//${wsHost}`;

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

  // 滚动到底部
  const scrollToBottom = () => {
    setAutoScroll(true);
    logListRef.current?.scrollToBottom();
  };

  return (
    <div className={styles.page}>
      {/* 工具栏 */}
      <ToolBar
        connected={connected}
        isPaused={isPaused}
        filteredCount={filteredLogs.length}
        totalCount={logs.length}
        filter={filter}
        contexts={contexts}
        onFilterChange={setFilter}
        onPauseToggle={() => setIsPaused(!isPaused)}
        onClear={clearLogs}
      />

      {/* 日志列表 */}
      <section className={styles.section}>
        <LogList
          ref={logListRef}
          logs={filteredLogs}
          connected={connected}
          autoScroll={autoScroll}
          onScrollChange={setAutoScroll}
        />

        {/* 自动滚动提示 */}
        {!autoScroll && (
          <button onClick={scrollToBottom} className={styles.scrollToBottomBtn}>
            ↓ 滚动到底部
          </button>
        )}
      </section>
    </div>
  );
}
