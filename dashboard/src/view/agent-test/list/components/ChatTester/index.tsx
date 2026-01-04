import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { TestChatResponse, SimpleMessage, TokenUsage } from '@/services/agent-test';
import {
  Trash2,
  Copy,
  Check,
  AlertTriangle,
  Bot,
  Activity,
  Clock,
  Sparkles,
  Zap,
  FileJson,
  X,
  Send,
  Radio,
} from 'lucide-react';
import { MessagePartsAdapter } from './MessagePartsAdapter';
import styles from './index.module.scss';

interface ChatTesterProps {
  onTestComplete?: (result: TestChatResponse) => void;
}

export default function ChatTester({ onTestComplete }: ChatTesterProps) {
  // 历史记录输入（JSON 格式）
  const [historyText, setHistoryText] = useState('');
  // 校验历史记录格式
  const [historyStatus, setHistoryStatus] = useState<'valid' | 'invalid' | 'empty'>('empty');

  // 当前用户输入
  const [currentInput, setCurrentInput] = useState('');

  // 状态
  const [localError, setLocalError] = useState<string | null>(null);
  const [result, setResult] = useState<TestChatResponse | null>(null);
  const [isRequesting, setIsRequesting] = useState(false); // 请求发起标记

  // 指标统计
  const [metrics, setMetrics] = useState<{
    durationMs: number;
    tokenUsage: TokenUsage;
  } | null>(null);
  const startTimeRef = useRef<number>(0);

  // 复制状态
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // refs
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const replyContentRef = useRef<HTMLDivElement>(null);

  // 创建 transport，配置 API 端点
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/agent/test/chat/ai-stream',
        body: {
          scenario: 'candidate-consultation',
          saveExecution: false,
        },
      }),
    [],
  );

  // 保存当前轮次的用户输入（用于回写历史记录）
  const currentInputRef = useRef<string>('');

  // 使用 Vercel AI SDK 的 useChat hook
  const {
    messages,
    sendMessage,
    status,
    stop,
    setMessages,
    error: chatError,
  } = useChat({
    transport,
    // 错误处理
    onError: (err: Error) => {
      let displayError = err.message || '流式测试执行失败';
      if (displayError.includes('500') || displayError.includes('Internal Server Error')) {
        displayError = '服务暂时不可用 (500)。请确认后端服务已启动';
      } else if (
        displayError.includes('Network Error') ||
        displayError.includes('Failed to fetch')
      ) {
        displayError = '网络请求失败。请检查网络连接或服务地址。';
      }
      setLocalError(displayError);
      setIsRequesting(false);
    },
    // 完成处理
    onFinish: ({ message }: { message: UIMessage }) => {
      const durationMs = Date.now() - startTimeRef.current;

      // 从 message.parts 中提取工具调用
      const toolCalls = message.parts
        .filter((p) => p.type.startsWith('tool-'))
        .map((p) => {
          // 工具调用部件的类型包含 toolName 和 args
          const toolPart = p as unknown as { toolName: string; args: unknown; result?: unknown };
          return {
            toolName: toolPart.toolName || 'unknown',
            input: toolPart.args,
            output: toolPart.result,
          };
        });

      // 提取文本内容
      const textContent = message.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('');

      // 更新指标（token 使用量需要从响应头或其他方式获取，这里先用估算）
      const estimatedTokens = Math.round(textContent.length / 4);
      setMetrics({
        durationMs,
        tokenUsage: {
          inputTokens: 0,
          outputTokens: estimatedTokens,
          totalTokens: estimatedTokens,
        },
      });

      // 构建完整的 TestChatResponse
      const finalResult: TestChatResponse = {
        actualOutput: textContent,
        status: 'success',
        request: {
          url: '/agent/test/chat/ai-stream',
          method: 'POST',
          body: { message: currentInputRef.current, scenario: 'candidate-consultation' },
        },
        response: {
          statusCode: 200,
          body: { content: textContent },
          toolCalls,
        },
        metrics: {
          durationMs,
          tokenUsage: {
            inputTokens: 0,
            outputTokens: estimatedTokens,
            totalTokens: estimatedTokens,
          },
        },
      };

      setResult(finalResult);
      onTestComplete?.(finalResult);

      // 自动回写历史记录：将本轮对话追加到历史记录框
      const now = new Date();
      const timeStr = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const userLine = `[${timeStr} 候选人] ${currentInputRef.current}`;
      const aiLine = `[${timeStr} 招募经理] ${textContent}`;

      setHistoryText((prev) => {
        const newHistory = prev.trim() ? `${prev}\n\n${userLine}\n\n${aiLine}` : `${userLine}\n\n${aiLine}`;
        // 异步校验新历史记录
        setTimeout(() => validateHistory(newHistory), 0);
        return newHistory;
      });

      // 清空当前输入框，准备下一轮对话
      setCurrentInput('');
      setIsRequesting(false);
    },
  });

  // 判断是否正在流式输出
  const isStreaming = status === 'streaming';
  const isLoading = isRequesting || status === 'submitted' || isStreaming;

  // 自动滚动到底部
  useEffect(() => {
    if (isStreaming && replyContentRef.current) {
      replyContentRef.current.scrollTop = replyContentRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  // 同步 chatError 到 localError state
  useEffect(() => {
    if (chatError) {
      setLocalError(chatError.message);
    }
  }, [chatError]);

  // 当流式输出开始时，清空上一次的 result
  useEffect(() => {
    if (isStreaming) {
      setResult(null);
    }
  }, [isStreaming]);

  // 解析历史记录（仅支持对话记录格式）
  const parseHistory = useCallback((text: string): SimpleMessage[] => {
    if (!text.trim()) return [];

    const lines = text.split('\n').filter((l) => l.trim());
    const parsedMessages: SimpleMessage[] = [];

    for (const line of lines) {
      // format: [12/04 14:23 候选人] 消息内容
      const bracketMatch = line.match(/^\[.*? (候选人|招募经理|经理).*?\]\s*(.*)$/);
      if (bracketMatch) {
        const roleText = bracketMatch[1];
        const content = bracketMatch[2];
        const role = roleText === '候选人' ? 'user' : 'assistant';
        parsedMessages.push({ role, content });
        continue;
      }

      // Fallback: 追加到上一条消息（多行内容）
      if (parsedMessages.length > 0) {
        parsedMessages[parsedMessages.length - 1].content += '\n' + line;
      }
    }
    return parsedMessages;
  }, []);

  // 监听历史记录变化进行校验
  const validateHistory = useCallback(
    (text: string) => {
      if (!text.trim()) {
        setHistoryStatus('empty');
        return;
      }

      const parsed = parseHistory(text);
      if (parsed.length > 0) {
        setHistoryStatus('valid');
      } else {
        setHistoryStatus('invalid');
      }
    },
    [parseHistory],
  );

  const handleHistoryChange = (text: string) => {
    setHistoryText(text);
    validateHistory(text);
  };

  // 执行测试
  const handleTest = useCallback(async () => {
    if (!currentInput.trim()) return;

    // 保存当前输入到 ref（用于 onFinish 回调中回写历史记录）
    currentInputRef.current = currentInput.trim();

    // 立即设置请求状态，避免白屏
    setIsRequesting(true);

    // 清除之前的错误（但保留 result，避免白屏，等流式开始时再清空）
    setLocalError(null);
    setMetrics(null);
    startTimeRef.current = Date.now();

    // 将历史记录转换为 messages 格式
    const history = parseHistory(historyText);
    const historyMessages: UIMessage[] = history.map((msg, idx) => ({
      id: `history-${idx}`,
      role: msg.role,
      parts: [{ type: 'text' as const, text: msg.content }],
    }));

    // 设置历史消息并发送用户消息
    // 注意：先设置历史消息，再发送新消息
    // 使用 setTimeout 确保 React 状态更新完成后再发送消息，避免竞态条件
    setMessages(historyMessages);

    // 延迟发送消息，确保 setMessages 状态更新完成
    requestAnimationFrame(() => {
      sendMessage({ text: currentInput.trim() });
    });
  }, [currentInput, historyText, parseHistory, setMessages, sendMessage]);

  // 取消流式请求
  const handleCancel = useCallback(() => {
    stop();
  }, [stop]);

  // 复制到剪贴板
  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error('复制失败:', err);
    }
  };

  // 清空所有
  const handleClear = () => {
    setHistoryText('');
    setHistoryStatus('empty');
    setCurrentInput('');
    setMessages([]);
    setResult(null);
    setLocalError(null);
    setMetrics(null);
    setIsRequesting(false);
    messageInputRef.current?.focus();
  };

  // 获取最新的 assistant 消息用于显示
  const latestAssistantMessage = messages.filter((m: UIMessage) => m.role === 'assistant').pop();

  return (
    <div className={styles.chatTester}>
      {/* 主内容区：左右分栏 */}
      <div className={styles.mainContent}>
        {/* 左侧：输入区域 */}
        <div className={styles.inputPanel}>
          <div className={styles.panelHeader}>
            <h3>
              <FileJson size={18} /> 测试输入
            </h3>
            <button onClick={handleClear} className={styles.clearBtn} disabled={isLoading}>
              <Trash2 size={14} /> 清空
            </button>
          </div>

          {/* 可滚动的输入区域 */}
          <div className={styles.inputPanelBody}>
            {/* 历史记录输入 */}
            <div className={styles.inputGroup}>
              <div className={styles.inputLabel}>
                <span className={styles.labelText}>历史聊天记录</span>
                <span className={styles.labelHint}>可选，多轮对话自动回填</span>
                {historyStatus === 'invalid' && (
                  <span className={styles.statusInvalid}>
                    <AlertTriangle size={12} /> 格式有误
                  </span>
                )}
                {historyStatus === 'valid' && (
                  <span className={styles.statusValid}>
                    <Check size={12} /> 格式正确
                  </span>
                )}
              </div>
              <textarea
                value={historyText}
                onChange={(e) => handleHistoryChange(e.target.value)}
                placeholder={`粘贴对话记录，格式如：
[12/04 14:23 候选人] 你好
[12/04 14:24 招募经理] 你好，有什么可以帮您？`}
                disabled={isLoading}
                className={`${styles.historyInput} ${historyStatus === 'invalid' ? styles.inputError : ''}`}
              />
            </div>

            {/* 当前消息输入 */}
            <div className={styles.inputGroup}>
              <div className={styles.inputLabel}>
                <span className={styles.labelText}>当前用户消息</span>
                <span className={styles.labelRequired}>*</span>
              </div>
              <div className={styles.messageInputWrapper}>
                <textarea
                  ref={messageInputRef}
                  value={currentInput}
                  onChange={(e) => setCurrentInput(e.target.value)}
                  placeholder="输入要测试的用户消息..."
                  disabled={isLoading}
                  className={styles.messageInput}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleTest();
                    }
                  }}
                />
                <button
                  className={styles.sendIconBtn}
                  onClick={() => handleTest()}
                  disabled={isLoading || !currentInput.trim()}
                >
                  <Send size={16} />
                </button>
              </div>
              <div className={styles.inputHint}>
                按 <kbd>⌘</kbd> + <kbd>Enter</kbd> 快速发送
              </div>
            </div>
          </div>
        </div>

        {/* 右侧：结果区域 */}
        <div className={styles.resultPanel}>
          <div className={styles.panelHeader}>
            <h3>
              <Activity size={18} /> 测试结果
            </h3>
            {result && (
              <div className={`${styles.statusTag} ${styles[result.status]}`}>
                {result.status === 'success' ? (
                  <>
                    <Check size={12} /> 成功
                  </>
                ) : result.status === 'failure' ? (
                  <>
                    <X size={12} /> 失败
                  </>
                ) : (
                  <>
                    <Clock size={12} /> 超时
                  </>
                )}
              </div>
            )}
          </div>

          {/* 可滚动的内容区域 */}
          <div className={styles.scrollableContent} ref={replyContentRef}>
            {/* 错误提示 */}
            {localError && (
              <div className={styles.errorBox}>
                <AlertTriangle className={styles.errorIcon} size={18} />
                <span className={styles.errorText}>{localError}</span>
                <button onClick={() => setLocalError(null)} className={styles.errorClose}>
                  <X size={14} />
                </button>
              </div>
            )}

            {/* 无结果状态 - 只在初始状态（无历史消息也无结果）时显示 */}
            {!latestAssistantMessage && !localError && !isLoading && !result && messages.length === 0 && (
              <div className={styles.emptyState}>
                <div className={styles.emptyIcon}>
                  <Sparkles size={48} strokeWidth={1} />
                </div>
                <p>输入消息并点击"执行测试"</p>
                <p className={styles.emptyHint}>测试结果将在这里显示</p>
              </div>
            )}

            {/* 流式输出中 - 使用 MessagePartsAdapter */}
            {isStreaming && latestAssistantMessage && (
              <div className={styles.streamingContent}>
                {/* 流式指标（如果有） */}
                {metrics && (
                  <div className={styles.metricsRow}>
                    <div className={styles.metricCard}>
                      <span className={styles.metricValue}>{metrics.durationMs}</span>
                      <span className={styles.metricLabel}>
                        <Clock size={10} /> 耗时 (ms)
                      </span>
                    </div>
                    <div className={styles.metricCard}>
                      <span className={styles.metricValue}>{metrics.tokenUsage.totalTokens}</span>
                      <span className={styles.metricLabel}>
                        <Zap size={10} /> Total Tokens
                      </span>
                    </div>
                  </div>
                )}

                {/* AI 回复头部 */}
                <div className={styles.replySection}>
                  <div className={styles.sectionHeader}>
                    <h4>
                      <Radio size={16} className={styles.streamingIcon} /> AI 回复中...
                    </h4>
                    <button className={styles.cancelBtn} onClick={handleCancel}>
                      <X size={12} /> 取消
                    </button>
                  </div>
                  {/* 使用 MessagePartsAdapter 渲染消息 */}
                  <MessagePartsAdapter message={latestAssistantMessage} isStreaming={true} />
                </div>
              </div>
            )}

            {/* 加载中状态（等待首个响应，或第二次请求等待中） */}
            {isLoading && !isStreaming && (
              <div className={styles.loadingState}>
                <div className={styles.loadingSpinner}></div>
                <p>正在调用 Agent API...</p>
                <p className={styles.loadingHint}>通常需要 5-30 秒</p>
              </div>
            )}

            {/* 完成后的测试结果 */}
            {result && !isLoading && latestAssistantMessage && (
              <div className={styles.resultContent}>
                {/* 指标概览 */}
                <div className={styles.metricsRow}>
                  <div className={styles.metricCard}>
                    <span className={styles.metricValue}>{result.metrics.durationMs}</span>
                    <span className={styles.metricLabel}>
                      <Clock size={10} /> 耗时 (ms)
                    </span>
                  </div>
                  <div className={styles.metricCard}>
                    <span className={styles.metricValue}>
                      {result.metrics.tokenUsage.totalTokens}
                    </span>
                    <span className={styles.metricLabel}>
                      <Zap size={10} /> Total Tokens
                    </span>
                  </div>
                  <div className={styles.metricCard}>
                    <span className={styles.metricValue}>
                      {result.metrics.tokenUsage.inputTokens}
                    </span>
                    <span className={styles.metricLabel}>Input</span>
                  </div>
                  <div className={styles.metricCard}>
                    <span className={styles.metricValue}>
                      {result.metrics.tokenUsage.outputTokens}
                    </span>
                    <span className={styles.metricLabel}>Output</span>
                  </div>
                </div>

                {/* AI 回复 - 使用 MessagePartsAdapter */}
                <div className={styles.replySection}>
                  <div className={styles.sectionHeader}>
                    <h4>
                      <Bot size={16} /> AI 回复
                    </h4>
                    <button
                      className={styles.copyBtn}
                      onClick={() => copyToClipboard(result.actualOutput || '', 'reply')}
                    >
                      {copiedField === 'reply' ? (
                        <>
                          <Check size={12} /> 已复制
                        </>
                      ) : (
                        <>
                          <Copy size={12} /> 复制
                        </>
                      )}
                    </button>
                  </div>
                  <MessagePartsAdapter message={latestAssistantMessage} isStreaming={false} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
