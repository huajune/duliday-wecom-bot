import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import styles from './index.module.scss';

export interface LogEntry {
  timestamp: string;
  level: 'log' | 'error' | 'warn' | 'debug' | 'verbose';
  context: string;
  message: string;
  trace?: string;
}

// 日志级别标签
const levelLabels: Record<string, string> = {
  log: 'LOG',
  error: 'ERR',
  warn: 'WRN',
  debug: 'DBG',
  verbose: 'VRB',
};

// 格式化时间
function formatTime(iso: string): string {
  const date = new Date(iso);
  return (
    date.toLocaleTimeString('zh-CN', { hour12: false }) +
    '.' +
    String(date.getMilliseconds()).padStart(3, '0')
  );
}

// 获取边框样式类
function getBorderClass(level: LogEntry['level']): string {
  switch (level) {
    case 'log':
      return styles.borderLog;
    case 'error':
      return styles.borderError;
    case 'warn':
      return styles.borderWarn;
    case 'debug':
      return styles.borderDebug;
    case 'verbose':
      return styles.borderVerbose;
    default:
      return '';
  }
}

export interface LogListRef {
  scrollToBottom: () => void;
}

interface LogListProps {
  logs: LogEntry[];
  connected: boolean;
  autoScroll: boolean;
  onScrollChange: (isAtBottom: boolean) => void;
}

const LogList = forwardRef<LogListRef, LogListProps>(
  ({ logs, connected, autoScroll, onScrollChange }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const logsEndRef = useRef<HTMLDivElement>(null);

    // 暴露滚动方法
    useImperativeHandle(ref, () => ({
      scrollToBottom: () => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      },
    }));

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
      onScrollChange(isAtBottom);
    };

    return (
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className={styles.container}
      >
        {logs.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>📋</div>
            <div className={styles.emptyText}>{connected ? '等待日志...' : '连接中...'}</div>
            <div className={styles.emptySubText}>
              {connected ? '新的日志将实时显示在这里' : '正在连接 WebSocket 服务'}
            </div>
          </div>
        ) : (
          <div className={styles.logWrapper}>
            {logs.map((log, i) => (
              <div
                key={i}
                className={`${styles.logEntry} ${getBorderClass(log.level)}`}
              >
                <span className={styles.logTimestamp}>
                  {formatTime(log.timestamp)}
                </span>
                <span className={`${styles.logLevel} ${styles[log.level]}`}>
                  {levelLabels[log.level]}
                </span>
                <span className={styles.logContext}>
                  [{log.context}]
                </span>
                <span className={styles.logMessage}>{log.message}</span>
                {log.trace && (
                  <div className={styles.logTrace}>
                    {log.trace}
                  </div>
                )}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        )}
      </div>
    );
  }
);

LogList.displayName = 'LogList';

export default LogList;
