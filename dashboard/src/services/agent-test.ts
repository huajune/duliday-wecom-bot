import axios from 'axios';

const api = axios.create({
  baseURL: '',
  timeout: 120000, // Agent API 可能需要较长时间
});

// ==================== 类型定义 ====================

export interface SimpleMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface TestChatRequest {
  message: string;
  history?: SimpleMessage[];
  scenario?: string;
  saveExecution?: boolean;
  caseId?: string;
  caseName?: string;
  category?: string;
  expectedOutput?: string;
  batchId?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface TestChatResponse {
  executionId?: string;
  actualOutput: string;
  status: 'success' | 'failure' | 'timeout';
  request: {
    url: string;
    method: string;
    body: any;
  };
  response: {
    statusCode: number;
    body: any;
    toolCalls?: any[];
  };
  metrics: {
    durationMs: number;
    tokenUsage: TokenUsage;
  };
}

export interface TestBatch {
  id: string;
  name: string;
  source: 'manual' | 'feishu';
  feishu_app_token: string | null;
  feishu_table_id: string | null;
  total_cases: number;
  executed_count: number;
  passed_count: number;
  failed_count: number;
  pending_review_count: number;
  pass_rate: number | null;
  avg_duration_ms: number | null;
  avg_token_usage: number | null;
  status: 'created' | 'running' | 'completed' | 'reviewing';
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface TestExecution {
  id: string;
  batch_id: string | null;
  case_id: string | null;
  case_name: string | null;
  category: string | null;
  input_message: string | null; // 用户输入消息（从 test_input 提取）
  test_input: any;
  expected_output: string | null;
  agent_request: any;
  agent_response: any;
  actual_output: string | null;
  tool_calls: any;
  execution_status: 'pending' | 'running' | 'success' | 'failure' | 'timeout';
  duration_ms: number | null;
  token_usage: TokenUsage | null;
  error_message: string | null;
  review_status: 'pending' | 'passed' | 'failed' | 'skipped';
  review_comment: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  failure_reason: string | null;
  executed_at: string; // 执行时间
  created_at: string;
}

export interface BatchStats {
  totalCases: number;
  executedCount: number;
  passedCount: number;
  failedCount: number;
  pendingReviewCount: number;
  passRate: number | null;
  avgDurationMs: number | null;
  avgTokenUsage: number | null;
}

export interface CategoryStats {
  category: string;
  total: number;
  passed: number;
  failed: number;
}

export interface FailureReasonStats {
  reason: string;
  count: number;
  percentage: number;
}

export interface UpdateReviewRequest {
  reviewStatus: 'passed' | 'failed' | 'skipped';
  reviewComment?: string;
  failureReason?: string;
  reviewedBy?: string;
}

// ==================== 流式测试类型 ====================

/**
 * SSE 事件类型
 */
export type StreamEventType =
  | 'start'
  | 'text'
  | 'tool_call'
  | 'tool_result'
  | 'metrics'
  | 'done'
  | 'error';

/**
 * SSE 事件数据
 */
export interface StreamEvent {
  type: StreamEventType;
  data: any;
}

/**
 * 流式测试回调函数
 */
export interface StreamCallbacks {
  onStart?: () => void;
  onText?: (text: string, fullText: string) => void;
  onToolCall?: (toolCall: { toolName: string; input: any }) => void;
  onToolResult?: (result: { toolName: string; output: any }) => void;
  onMetrics?: (metrics: { durationMs: number; tokenUsage: TokenUsage; toolCallsCount: number }) => void;
  onDone?: (result: {
    status: string;
    actualOutput: string;
    toolCalls: any[];
    metrics: { durationMs: number; tokenUsage: TokenUsage };
  }) => void;
  onError?: (error: string) => void;
}

export interface ImportFromFeishuRequest {
  appToken: string;
  tableId: string;
  batchName?: string;
  executeImmediately?: boolean;
  parallel?: boolean;
}

export interface ImportResult {
  batchId: string;
  batchName: string;
  totalImported: number;
  cases: Array<{
    caseId: string;
    caseName: string;
    category?: string;
    message: string;
  }>;
}

// ==================== API 函数 ====================

/**
 * 执行单条测试
 */
export async function executeTest(request: TestChatRequest): Promise<TestChatResponse> {
  const { data } = await api.post('/agent/test/chat', request);
  return data.data;
}

/**
 * 执行流式测试
 * 使用 fetch API 接收 SSE 事件流
 *
 * @param request 测试请求参数
 * @param callbacks 事件回调函数
 * @returns AbortController 用于取消请求
 */
export function executeTestStream(
  request: TestChatRequest,
  callbacks: StreamCallbacks,
): AbortController {
  const controller = new AbortController();

  // 使用 fetch 发起 POST 请求接收 SSE
  fetch('/agent/test/chat/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(request),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无法获取响应流');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // 解析 SSE 事件（以 \n\n 分隔）
        const events = buffer.split('\n\n');
        buffer = events.pop() || ''; // 保留最后一个可能不完整的事件

        for (const eventStr of events) {
          if (!eventStr.trim()) continue;

          // 解析事件类型和数据
          const lines = eventStr.split('\n');
          let eventType = '';
          let eventData = '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7);
            } else if (line.startsWith('data: ')) {
              eventData = line.slice(6);
            }
          }

          if (!eventType || !eventData) continue;

          try {
            const data = JSON.parse(eventData);

            // 根据事件类型调用对应回调
            switch (eventType) {
              case 'start':
                callbacks.onStart?.();
                break;
              case 'text':
                callbacks.onText?.(data.text, data.fullText);
                break;
              case 'tool_call':
                callbacks.onToolCall?.(data);
                break;
              case 'tool_result':
                callbacks.onToolResult?.(data);
                break;
              case 'metrics':
                callbacks.onMetrics?.(data);
                break;
              case 'done':
                callbacks.onDone?.(data);
                break;
              case 'error':
                callbacks.onError?.(data.message);
                break;
            }
          } catch (e) {
            console.warn('解析 SSE 事件失败:', eventStr, e);
          }
        }
      }
    })
    .catch((error) => {
      if (error.name !== 'AbortError') {
        callbacks.onError?.(error.message || '流式请求失败');
      }
    });

  return controller;
}

/**
 * 批量执行测试
 */
export async function executeBatchTest(
  cases: TestChatRequest[],
  batchName?: string,
  parallel = false,
): Promise<{
  batchId: string;
  totalCases: number;
  successCount: number;
  failureCount: number;
  results: TestChatResponse[];
}> {
  const { data } = await api.post('/agent/test/batch', {
    cases,
    batchName,
    parallel,
  });
  return data.data;
}

/**
 * 创建测试批次
 */
export async function createBatch(request: {
  name: string;
  source?: 'manual' | 'feishu';
  feishuAppToken?: string;
  feishuTableId?: string;
}): Promise<TestBatch> {
  const { data } = await api.post('/agent/test/batches', request);
  return data.data;
}

/**
 * 获取批次列表
 */
export async function getBatches(limit = 20, offset = 0): Promise<TestBatch[]> {
  const { data } = await api.get('/agent/test/batches', {
    params: { limit, offset },
  });
  return data.data;
}

/**
 * 获取批次详情
 */
export async function getBatch(id: string): Promise<TestBatch> {
  const { data } = await api.get(`/agent/test/batches/${id}`);
  return data.data;
}

/**
 * 获取批次统计
 */
export async function getBatchStats(id: string): Promise<BatchStats> {
  const { data } = await api.get(`/agent/test/batches/${id}/stats`);
  return data.data;
}

/**
 * 获取批次分类统计
 */
export async function getCategoryStats(id: string): Promise<CategoryStats[]> {
  const { data } = await api.get(`/agent/test/batches/${id}/category-stats`);
  return data.data;
}

/**
 * 获取批次失败原因统计
 */
export async function getFailureReasonStats(id: string): Promise<FailureReasonStats[]> {
  const { data } = await api.get(`/agent/test/batches/${id}/failure-stats`);
  return data.data;
}

/**
 * 获取批次的执行记录
 */
export async function getBatchExecutions(
  batchId: string,
  filters?: {
    reviewStatus?: string;
    executionStatus?: string;
    category?: string;
  },
): Promise<TestExecution[]> {
  const { data } = await api.get(`/agent/test/batches/${batchId}/executions`, {
    params: filters,
  });
  return data.data;
}

/**
 * 获取执行记录列表
 */
export async function getExecutions(limit = 50, offset = 0): Promise<TestExecution[]> {
  const { data } = await api.get('/agent/test/executions', {
    params: { limit, offset },
  });
  return data.data;
}

/**
 * 获取执行记录详情
 */
export async function getExecution(id: string): Promise<TestExecution> {
  const { data } = await api.get(`/agent/test/executions/${id}`);
  return data.data;
}

/**
 * 更新评审状态
 */
export async function updateReview(
  executionId: string,
  review: UpdateReviewRequest,
): Promise<TestExecution> {
  const { data } = await api.patch(`/agent/test/executions/${executionId}/review`, review);
  return data.data;
}

/**
 * 批量更新评审状态
 */
export async function batchUpdateReview(
  executionIds: string[],
  review: UpdateReviewRequest,
): Promise<{ updatedCount: number }> {
  const { data } = await api.patch('/agent/test/executions/batch-review', {
    executionIds,
    review,
  });
  return data.data;
}

/**
 * 从飞书多维表格导入测试用例
 */
export async function importFromFeishu(request: ImportFromFeishuRequest): Promise<ImportResult> {
  const { data } = await api.post('/agent/test/batches/import-from-feishu', request);
  return data.data;
}

export default api;
