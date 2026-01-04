import { memo, useState } from 'react';
import type { UIMessage } from 'ai';
import {
  Zap,
  CheckCircle2,
  Loader2,
  ArrowRight,
  ArrowLeft,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import styles from './index.module.scss';

/**
 * 格式化 JSON 输出
 */
const formatJson = (obj: unknown): string => {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
};

/**
 * 格式化工具返回结果，提升可读性
 * - 如果是 { type: 'text', text: '...' } 格式，提取 text 内容
 * - 将 \n 转换为真正的换行
 * - 其他情况格式化为 JSON
 */
const formatToolResult = (result: unknown): string => {
  // 处理字符串类型
  if (typeof result === 'string') {
    // 将字面量 \n 转换为真正的换行
    return result.replace(/\\n/g, '\n');
  }

  // 处理对象类型
  if (typeof result === 'object' && result !== null) {
    const obj = result as Record<string, unknown>;

    // 检查是否是 { type: 'text', text: '...' } 格式
    if (obj.type === 'text' && typeof obj.text === 'string') {
      // 提取 text 内容并转换换行符
      return obj.text.replace(/\\n/g, '\n');
    }

    // 其他对象格式化为 JSON
    return formatJson(result);
  }

  return String(result);
};

/**
 * 工具调用组件（可展开收起）
 */
interface ToolInvocationProps {
  toolName: string;
  args: unknown;
  state: string;
  result?: unknown;
  defaultExpanded?: boolean;
}

function ToolInvocation({
  toolName,
  args,
  state,
  result,
  defaultExpanded = false,
}: ToolInvocationProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const isCompleted = state === 'result';
  const isCalling = state !== 'result';

  // 检查是否有内容可展开
  const hasContent =
    (args !== undefined && args !== null) ||
    (isCompleted && result !== undefined && result !== null);

  return (
    <div className={`${styles.toolCallItem} ${isCalling ? styles.toolCalling : ''}`}>
      <div
        className={`${styles.toolHeader} ${hasContent ? styles.toolHeaderClickable : ''}`}
        onClick={() => hasContent && setIsExpanded(!isExpanded)}
      >
        <div className={styles.toolName}>
          {isCalling ? <Loader2 size={12} className={styles.toolSpinnerIcon} /> : <Zap size={12} />}
          {toolName}
        </div>
        <div className={styles.toolHeaderRight}>
          <div
            className={`${styles.toolStatus} ${isCalling ? styles.statusCalling : styles.statusSuccess}`}
          >
            {isCalling ? (
              <>
                <Loader2 size={12} className={styles.toolSpinnerIcon} /> 调用中
              </>
            ) : (
              <>
                <CheckCircle2 size={12} /> 完成
              </>
            )}
          </div>
          {hasContent && (
            <span className={styles.toolExpandIcon}>
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          )}
        </div>
      </div>
      {isExpanded && (
        <div className={styles.toolBody}>
          {args !== undefined && args !== null && (
            <div className={styles.toolSection}>
              <div className={styles.toolSectionLabel}>
                <ArrowRight size={12} /> 输入参数
              </div>
              <pre className={styles.toolDetail}>{formatJson(args)}</pre>
            </div>
          )}
          {isCompleted && result !== undefined && result !== null && (
            <div className={styles.toolSection}>
              <div className={styles.toolSectionLabel}>
                <ArrowLeft size={12} /> 返回结果
              </div>
              <pre className={styles.toolDetail}>{formatToolResult(result)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 从 UIMessage.parts 中提取工具调用信息
 */
interface ExtractedToolCall {
  toolCallId: string;
  toolName: string;
  args: unknown;
  state: string;
  result?: unknown;
}

function extractToolCalls(parts: UIMessage['parts']): ExtractedToolCall[] {
  const toolCalls: ExtractedToolCall[] = [];

  for (const part of parts) {
    // 检查是否是工具相关的部件（type 以 'tool-' 开头）
    if (part.type.startsWith('tool-')) {
      // 类型断言以访问工具调用属性
      const toolPart = part as unknown as {
        type: string;
        toolCallId?: string;
        toolName?: string; // dynamic-tool 使用这个字段
        input?: unknown; // Vercel AI SDK 使用 input
        state?: string;
        output?: unknown; // Vercel AI SDK 使用 output
      };

      // 从 type 字段提取工具名称（格式: "tool-{toolName}"）
      // 例如: "tool-duliday_job_list" -> "duliday_job_list"
      const extractedToolName = toolPart.toolName || part.type.replace(/^tool-/, '');

      // 判断是否已完成（output-available 或 output-error 状态）
      const isCompleted =
        toolPart.state === 'output-available' ||
        toolPart.state === 'output-error' ||
        toolPart.output !== undefined;

      toolCalls.push({
        toolCallId: toolPart.toolCallId || `tool-${Date.now()}`,
        toolName: extractedToolName,
        args: toolPart.input,
        state: isCompleted ? 'result' : 'call',
        result: toolPart.output,
      });
    }
  }

  return toolCalls;
}

/**
 * 消息部件适配器
 *
 * 根据 Vercel AI SDK 的 UIMessage.parts 数组渲染不同类型的内容:
 * - text: 文本内容
 * - tool-*: 工具调用相关（包含多种状态）
 */
interface MessagePartsAdapterProps {
  message: UIMessage;
  isStreaming?: boolean;
}

function MessagePartsAdapterComponent({ message, isStreaming }: MessagePartsAdapterProps) {
  const parts = message.parts;

  // 调试：打印 message parts 信息
  console.log('[MessagePartsAdapter] message.id:', message.id);
  console.log('[MessagePartsAdapter] parts count:', parts?.length || 0);
  console.log('[MessagePartsAdapter] parts types:', parts?.map(p => p.type).join(', ') || 'none');

  // 如果没有 parts，显示空状态
  if (!parts || parts.length === 0) {
    return (
      <div className={styles.replyContent}>
        <span className={styles.streamingPlaceholder}>等待响应...</span>
        {isStreaming && <span className={styles.streamCursor}>|</span>}
      </div>
    );
  }

  // 提取工具调用
  const toolInvocations = extractToolCalls(parts);
  console.log('[MessagePartsAdapter] toolInvocations count:', toolInvocations.length);

  // 提取文本内容
  const textParts: string[] = [];
  for (const part of parts) {
    if (part.type === 'text') {
      textParts.push((part as { type: 'text'; text: string }).text);
    }
  }
  const fullText = textParts.join('');

  return (
    <div className={styles.messagePartsContainer}>
      {/* 工具调用（先显示，因为 Agent 执行流程是先调工具再生成文本） */}
      {toolInvocations.length > 0 && (
        <div className={styles.collapsibleSection}>
          <div className={styles.collapsibleHeader}>
            <h4>
              <Zap size={16} /> 工具调用 ({toolInvocations.length})
            </h4>
          </div>
          <div className={styles.toolCallsList}>
            {toolInvocations.map((tool) => (
              <ToolInvocation
                key={tool.toolCallId}
                toolName={tool.toolName}
                args={tool.args}
                state={tool.state}
                result={tool.result}
              />
            ))}
          </div>
        </div>
      )}

      {/* 文本内容 */}
      {(fullText || isStreaming) && (
        <div className={styles.replyContent}>
          {fullText || <span className={styles.streamingPlaceholder}>等待响应...</span>}
          {isStreaming && <span className={styles.streamCursor}>|</span>}
        </div>
      )}
    </div>
  );
}

/**
 * 使用 memo 优化，只在流式输出时实时更新最新的 assistant 消息
 */
export const MessagePartsAdapter = memo(MessagePartsAdapterComponent, (prevProps, nextProps) => {
  // 如果正在流式输出，始终重新渲染以显示最新内容
  if (nextProps.isStreaming) {
    return false;
  }
  // 否则只在消息 ID 变化时重新渲染
  return prevProps.message.id === nextProps.message.id;
});

export default MessagePartsAdapter;
