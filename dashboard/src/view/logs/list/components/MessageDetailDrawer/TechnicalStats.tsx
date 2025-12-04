import { useMemo } from 'react';
import { formatDuration } from '@/utils/format';
import type { MessageRecord } from '@/types/monitoring';

// 场景类型中文映射
const scenarioLabels: Record<string, string> = {
  consultation: '咨询',
  'candidate-consultation': '候选人咨询',
  booking: '预约',
  followup: '跟进',
  general: '通用',
};

// Part 类型定义（Agent API 返回的 messages.parts 结构）
interface MessagePart {
  type: string;
  text?: string;
  toolName?: string;
  state?: string;
  output?: Record<string, unknown>;
  input?: Record<string, unknown>;
}

interface AgentMessage {
  role: string;
  parts?: MessagePart[];
}

/**
 * 从 Agent 响应的 messages 中提取实际使用的工具
 * 通过遍历 parts 找出 type === 'dynamic-tool' 且 state === 'output-available' 的条目
 */
function extractUsedToolsFromMessages(messages: AgentMessage[] | undefined): string[] {
  if (!messages || !Array.isArray(messages)) return [];

  const usedTools = new Set<string>();

  for (const message of messages) {
    if (!message.parts) continue;
    for (const part of message.parts) {
      // dynamic-tool 类型且有 output-available 状态表示工具被实际调用并返回了结果
      if (part.type === 'dynamic-tool' && part.toolName && part.state === 'output-available') {
        usedTools.add(part.toolName);
      }
    }
  }

  return Array.from(usedTools);
}

interface TechnicalStatsProps {
  message: MessageRecord;
}

// ChatRequest 请求结构（用于展示）
interface ChatRequestDisplay {
  messages?: unknown[];
  model?: string;
  stream?: boolean;
  tools?: string[];
  systemPrompt?: string;
  context?: unknown;
  toolContext?: string;
}

export default function TechnicalStats({ message }: TechnicalStatsProps) {
  // 新结构：agentInvocation.request 是 ChatRequest，agentInvocation.response 是 ChatResponse
  const invocation = message.agentInvocation;
  const request = invocation?.request as ChatRequestDisplay | undefined;
  const response = invocation?.response as {
    messages?: AgentMessage[];
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
    tools?: { used?: string[]; skipped?: string[] };
  } | undefined;

  // 从 messages 中解析实际使用的工具（而不是用 tools.used）
  const actualUsedTools = useMemo(() => {
    return extractUsedToolsFromMessages(response?.messages);
  }, [response?.messages]);

  return (
    <>
      <h4 style={{ margin: '0 0 16px 0', fontSize: '13px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        技术指标
      </h4>

      {/* Latency & Token - Compact Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
        {/* Latency Card */}
        <div className="stat-card" style={{ marginBottom: 0, textAlign: 'center' }}>
          <div className="stat-label" style={{ whiteSpace: 'nowrap' }}>总耗时</div>
          <div className="stat-value primary" style={{ fontSize: '18px' }}>{formatDuration(message.totalDuration)}</div>
        </div>

        {/* Token Card */}
        <div className="stat-card" style={{ marginBottom: 0, textAlign: 'center' }}>
          <div className="stat-label" style={{ whiteSpace: 'nowrap' }}>Token</div>
          <div className="stat-value warning" style={{ fontSize: '18px' }}>{message.tokenUsage?.toLocaleString() || '-'}</div>
        </div>
      </div>

      {/* Latency Breakdown */}
      {(message.queueDuration !== undefined ||
        message.aiDuration !== undefined ||
        message.sendDuration !== undefined) && (
        <div className="stat-card">
          <div className="stat-label">耗时明细</div>
          <div className="stat-breakdown" style={{ marginTop: '8px', paddingTop: '0', borderTop: 'none' }}>
            {message.queueDuration !== undefined && (
              <div className="breakdown-item">
                <span>排队</span>
                <span>{formatDuration(message.queueDuration)}</span>
              </div>
            )}
            {message.aiDuration !== undefined && (
              <div className="breakdown-item">
                <span>首条响应</span>
                <span>{formatDuration(message.aiDuration)}</span>
              </div>
            )}
            {message.sendDuration !== undefined && (
              <div className="breakdown-item">
                <span>发送</span>
                <span>{formatDuration(message.sendDuration)}</span>
              </div>
            )}
            {response?.usage && (
              <>
                <div className="breakdown-item" style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed var(--border)' }}>
                  <span>输入 Token</span>
                  <span>{response.usage.inputTokens?.toLocaleString() || '-'}</span>
                </div>
                <div className="breakdown-item">
                  <span>输出 Token</span>
                  <span>{response.usage.outputTokens?.toLocaleString() || '-'}</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Tools Card */}
      {(actualUsedTools.length > 0 || (response?.tools?.skipped && response.tools.skipped.length > 0)) && (
        <div className="stat-card">
          <div className="stat-label">工具调用</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '10px' }}>
            {/* 实际使用的工具（从 messages.parts 解析） */}
            {actualUsedTools.length > 0 && (
              <div>
                <div style={{ fontSize: '11px', color: 'var(--success)', marginBottom: '6px', fontWeight: 500 }}>
                  ✓ 已使用 ({actualUsedTools.length})
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {actualUsedTools.map((tool, i) => (
                    <span key={i} className="tool-tag">
                      {tool}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {/* Skipped 的工具 */}
            {response?.tools?.skipped && response.tools.skipped.length > 0 && (
              <div style={{ paddingTop: '10px', borderTop: '1px dashed var(--border)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px' }}>
                  ○ 已跳过 ({response.tools.skipped.length})
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {response.tools.skipped.map((tool: string, i: number) => (
                    <span key={i} className="tool-tag skipped">
                      {tool}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Request Params Card - ChatRequest 结构 */}
      {request && (
        <div className="stat-card">
          <div className="stat-label">请求参数 (ChatRequest)</div>
          <div className="stat-breakdown" style={{ marginTop: '8px', paddingTop: '0', borderTop: 'none' }}>
            {/* 消息数量 */}
            <div className="breakdown-item">
              <span>消息数</span>
              <span>{request.messages?.length ?? 0} 条</span>
            </div>

            {/* 模型 */}
            {request.model && (
              <div className="breakdown-item">
                <span>模型</span>
                <span style={{ fontSize: '10px', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={request.model}>
                  {request.model}
                </span>
              </div>
            )}

            {/* 流式 */}
            <div className="breakdown-item">
              <span>流式</span>
              <span>{request.stream ? '是' : '否'}</span>
            </div>

            {/* tools */}
            {request.tools && request.tools.length > 0 && (
              <div className="breakdown-item" style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed var(--border)', flexDirection: 'column', alignItems: 'flex-start', gap: '6px' }}>
                <span>tools ({request.tools.length})</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {request.tools.map((tool, i) => (
                    <span key={i} className="tool-tag" style={{ fontSize: '9px' }}>{tool}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Prompt 相关字段 */}
            <div className="breakdown-item" style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed var(--border)' }}>
              <span>systemPrompt</span>
              <span className={request.systemPrompt ? 'param-yes' : 'param-no'}>
                {request.systemPrompt ? `✓ ${request.systemPrompt.length} 字符` : '✗ 无'}
              </span>
            </div>
            <div className="breakdown-item">
              <span>context</span>
              <span className={request.context ? 'param-yes' : 'param-no'}>
                {request.context ? '✓ 已加载' : '✗ 无'}
              </span>
            </div>
            <div className="breakdown-item">
              <span>toolContext</span>
              <span className={request.toolContext ? 'param-yes' : 'param-no'}>
                {request.toolContext ? `✓ ${request.toolContext.length} 字符` : '✗ 无'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Metadata Card */}
      <div className="stat-card">
        <div className="stat-label">元数据</div>
        <div className="stat-breakdown" style={{ marginTop: '8px', paddingTop: '0', borderTop: 'none' }}>
          <div className="breakdown-item">
            <span>场景</span>
            <span>{scenarioLabels[message.scenario || ''] || message.scenario || '未知'}</span>
          </div>
          <div className="breakdown-item">
            <span>会话 ID</span>
            <span style={{ fontFamily: 'monospace', fontSize: '11px' }} title={message.chatId}>
              {message.chatId.slice(0, 12)}...
            </span>
          </div>
        </div>
      </div>

      {/* Local Styles for this component */}
      <style>{`
        .stat-card {
          display: flex;
          flex-direction: column;
          background: #fff;
          border-radius: 10px;
          padding: 12px 14px;
          margin-bottom: 12px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        }
        .stat-label {
          font-size: 12px;
          color: var(--text-muted);
          margin-bottom: 4px;
        }
        .stat-value {
          font-size: 20px;
          font-weight: 700;
          color: var(--text-primary);
        }
        .stat-value.primary { color: var(--primary); }
        .stat-value.warning { color: var(--warning); }

        .stat-breakdown {
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          flex:1;
          gap: 8px;
        }
        .breakdown-item {
          display: flex;
          flex:1;
          justify-content: space-between;
          font-size: 12px;
          color: var(--text-secondary);
        }

        .param-yes {
          color: var(--success);
          font-weight: 500;
        }
        .param-no {
          color: var(--text-muted);
        }

        .tool-tag {
          font-size: 10px;
          padding: 3px 6px;
          background: rgba(16, 185, 129, 0.1);
          color: var(--success);
          border-radius: 4px;
          border: 1px solid rgba(16, 185, 129, 0.2);
          white-space: nowrap;
        }
        .tool-tag.skipped {
          background: rgba(107, 114, 128, 0.1);
          color: var(--text-muted);
          border-color: rgba(107, 114, 128, 0.2);
          text-decoration: line-through;
        }
      `}</style>
    </>
  );
}
