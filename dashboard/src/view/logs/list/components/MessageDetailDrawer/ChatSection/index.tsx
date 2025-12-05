import { useMemo } from 'react';
import type { MessageRecord } from '@/types/monitoring';
import styles from './index.module.scss';

// 需要截断的大字段路径（仅截断 request 部分，response 完整展示）
const TRUNCATE_PATHS = [
  'request.context.configData',
  'request.systemPrompt',
];

// 截断阈值（字符数）
const TRUNCATE_THRESHOLD = 500;

/**
 * 递归处理对象，对大字段进行截断摘要
 */
function truncateLargeFields(
  obj: unknown,
  currentPath = '',
  depth = 0
): unknown {
  // 防止无限递归
  // if (depth > 10) return '[深度限制]';

  if (obj === null || obj === undefined) return obj;

  // 处理数组
  if (Array.isArray(obj)) {
    // 检查是否需要截断整个数组
    if (TRUNCATE_PATHS.includes(currentPath)) {
      const jsonStr = JSON.stringify(obj);
      if (jsonStr.length > TRUNCATE_THRESHOLD) {
        return `[数组: ${obj.length} 项, ${formatSize(jsonStr.length)}] (已省略)`;
      }
    }
    // 递归处理数组元素
    return obj.map((item, i) =>
      truncateLargeFields(item, `${currentPath}[${i}]`, depth + 1)
    );
  }

  // 处理对象
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const fieldPath = currentPath ? `${currentPath}.${key}` : key;

      // 检查是否需要截断
      if (TRUNCATE_PATHS.includes(fieldPath)) {
        const jsonStr = JSON.stringify(value);
        if (jsonStr.length > TRUNCATE_THRESHOLD) {
          if (Array.isArray(value)) {
            result[key] = `[数组: ${value.length} 项, ${formatSize(jsonStr.length)}] (已省略)`;
          } else if (typeof value === 'object' && value !== null) {
            const keys = Object.keys(value);
            result[key] = `[对象: ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''}, ${formatSize(jsonStr.length)}] (已省略)`;
          } else if (typeof value === 'string') {
            result[key] = `${value.slice(0, 100)}... [${formatSize(jsonStr.length)}]`;
          } else {
            result[key] = value;
          }
          continue;
        }
      }

      // 递归处理子字段
      result[key] = truncateLargeFields(value, fieldPath, depth + 1);
    }
    return result;
  }

  // 处理长字符串
  if (typeof obj === 'string' && obj.length > 1000) {
    return `${obj.slice(0, 200)}... [共 ${obj.length} 字符]`;
  }

  return obj;
}

/**
 * 格式化大小显示
 */
function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} 字符`;
  if (bytes < 1000000) return `${(bytes / 1000).toFixed(1)}K`;
  return `${(bytes / 1000000).toFixed(1)}M`;
}

interface ChatSectionProps {
  message: MessageRecord;
  fullAgentResponse: string;
  showRaw: boolean;
  onToggleRaw: () => void;
}

export default function ChatSection({
  message,
  fullAgentResponse,
  showRaw,
  onToggleRaw,
}: ChatSectionProps) {
  // 对原始数据进行摘要处理，避免大字段占用过多空间
  const truncatedRawData = useMemo(() => {
    const rawData = message.agentInvocation || message;
    return truncateLargeFields(rawData);
  }, [message]);

  return (
    <>
      {/* Conversation Context */}
      <div>
        <h4 className={styles.sectionTitle}>当前会话</h4>

        {/* User Message Bubble */}
        <div className={`${styles.chatBubble} ${styles.user}`}>
          <div className={styles.bubbleHeader}>
            <span className={styles.bubbleIcon}>👤</span>
            <span className={styles.bubbleTitle}>用户消息</span>
          </div>
          <div className={styles.bubbleContent}>
            {message.messagePreview || '(无消息内容)'}
          </div>
        </div>

        {/* Agent Reply Bubble */}
        <div className={`${styles.chatBubble} ${styles.agent}`}>
          <div className={styles.bubbleHeader}>
            <span className={styles.bubbleIcon}>🤖</span>
            <span className={styles.bubbleTitle}>Agent 响应</span>
            {message.replySegments && (
              <span className={styles.bubbleMeta}>
                {message.replySegments} 条消息
              </span>
            )}
          </div>
          <div className={`${styles.bubbleContent} ${styles.primary}`}>
            {fullAgentResponse}
          </div>
        </div>

        {/* Fallback Box - 降级信息 */}
        {message.isFallback && (
          <div className={styles.fallbackBox}>
            <div className={styles.fallbackHeader}>
              <span>⚡</span> 降级响应
              <span className={`${styles.fallbackBadge} ${message.isFallback ? styles.success : styles.failed}`}>
                {message.isFallback ? '发送降级法术' : '降级失败'}
              </span>
            </div>
            <div className={styles.fallbackContent}>
              <strong>错误信息：</strong>{ }
            </div>
          </div>
        )}

        {/* Error Box */}
        {message.error && (
          <div className={styles.errorBox}>
            <div className={styles.errorHeader}>
              <span>⚠️</span> 错误信息
            </div>
            <div className={styles.errorContent}>
              {typeof message.error === 'string'
                ? message.error
                : JSON.stringify(message.error, null, 2)}
            </div>
          </div>
        )}
      </div>

      {/* Raw JSON Section */}
      <div className={styles.rawSection}>
        <div className={styles.rawHeader}>
          <h4 className={styles.rawTitle}>
            原始数据结构 (JSON)
          </h4>
          <button
            onClick={onToggleRaw}
            className={styles.toggleButton}
          >
            {showRaw ? '收起' : '展开'}
          </button>
        </div>

        {showRaw && (
          <pre className={styles.codeBlock}>
            {JSON.stringify(truncatedRawData, null, 2)}
          </pre>
        )}
      </div>
    </>
  );
}
