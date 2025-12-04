import { useState, useMemo } from 'react';
import type { MessageRecord } from '@/types/monitoring';
import styles from './index.module.scss';

// Agent API 消息结构
interface AgentMessagePart {
  type: string;
  text?: string;
}

interface AgentMessage {
  role: 'user' | 'assistant' | 'system';
  parts?: AgentMessagePart[];
}

// 简化的历史消息结构
interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface HistorySectionProps {
  message: MessageRecord;
}

/**
 * 从 Agent API 消息格式提取文本内容
 */
function extractTextFromParts(parts?: AgentMessagePart[]): string {
  if (!parts || parts.length === 0) return '';
  return parts
    .filter((p) => p.type === 'text' && p.text)
    .map((p) => p.text)
    .join('\n');
}

/**
 * 从 request.messages 中提取历史消息（排除当前用户消息）
 */
function extractHistoryMessages(messages: AgentMessage[] | undefined): HistoryMessage[] {
  if (!messages || messages.length === 0) return [];

  const history: HistoryMessage[] = [];

  // 遍历消息，排除最后一条用户消息（当前消息）
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // 跳过 system 消息
    if (msg.role === 'system') continue;

    // 最后一条用户消息是当前消息，不算历史
    const isLastUserMessage =
      msg.role === 'user' &&
      messages.slice(i + 1).every((m) => m.role !== 'user');

    if (isLastUserMessage) continue;

    const content = extractTextFromParts(msg.parts);
    if (content) {
      history.push({
        role: msg.role as 'user' | 'assistant',
        content,
      });
    }
  }

  return history;
}

export default function HistorySection({ message }: HistorySectionProps) {
  const [expanded, setExpanded] = useState(true);

  // 从 agentInvocation.request.messages 中提取历史消息
  const historyMessages = useMemo(() => {
    const request = message.agentInvocation?.request as {
      messages?: AgentMessage[];
    } | undefined;
    return extractHistoryMessages(request?.messages);
  }, [message.agentInvocation?.request]);

  // 如果没有历史消息，不显示此区域
  if (historyMessages.length === 0) {
    return null;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header} onClick={() => setExpanded(!expanded)}>
        <div className={styles.title}>
          <span>💬</span>
          <span>历史对话</span>
          <span className={styles.badge}>{historyMessages.length} 条</span>
        </div>
        <span className={`${styles.toggleIcon} ${expanded ? styles.expanded : ''}`}>
          ▼
        </span>
      </div>

      {expanded && (
        <div className={styles.content}>
          {historyMessages.length === 0 ? (
            <div className={styles.emptyState}>暂无历史消息</div>
          ) : (
            <div className={styles.messageList}>
              {historyMessages.map((msg, index) => (
                <div
                  key={index}
                  className={`${styles.messageItem} ${styles[msg.role]}`}
                >
                  <span className={styles.roleIcon}>
                    {msg.role === 'user' ? '👤' : '🤖'}
                  </span>
                  <div className={styles.messageContent}>{msg.content}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
