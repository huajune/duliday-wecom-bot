import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentService } from '../agent.service';
import { ProfileLoaderService } from '../services/agent-profile-loader.service';
import { BrandConfigService } from '../services/brand-config.service';
import { AgentApiClientService } from '../services/agent-api-client.service';
import {
  TestChatRequestDto,
  TestChatResponse,
  BatchStats,
  CreateBatchRequestDto,
  UpdateReviewRequestDto,
  ImportFromFeishuRequestDto,
  ImportResult,
} from './dto/test-chat.dto';
import { HttpClientFactory } from '@core/client-http';
import { AxiosInstance } from 'axios';
import { feishuBitableConfig } from '@core/feishu/constants/feishu-bitable.config';

/**
 * 测试执行记录（数据库格式）
 */
export interface TestExecution {
  id: string;
  batch_id: string | null;
  case_id: string | null;
  case_name: string | null;
  category: string | null;
  test_input: any;
  expected_output: string | null;
  agent_request: any;
  agent_response: any;
  actual_output: string | null;
  tool_calls: any;
  execution_status: 'pending' | 'running' | 'success' | 'failure' | 'timeout';
  duration_ms: number | null;
  token_usage: any;
  error_message: string | null;
  review_status: 'pending' | 'passed' | 'failed' | 'skipped';
  review_comment: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  failure_reason: string | null;
  created_at: string;
}

/**
 * 测试批次（数据库格式）
 */
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

/**
 * Agent 测试服务
 * 提供测试执行、结果保存、批次管理等功能
 */
@Injectable()
export class AgentTestService {
  private readonly logger = new Logger(AgentTestService.name);
  private readonly supabaseClient: AxiosInstance;
  private readonly supabaseUrl: string;

  // 飞书 Token 缓存
  private feishuTokenCache: { token: string; expireAt: number } | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly agentService: AgentService,
    private readonly profileLoader: ProfileLoaderService,
    private readonly brandConfig: BrandConfigService,
    private readonly httpClientFactory: HttpClientFactory,
    private readonly apiClient: AgentApiClientService,
  ) {
    // 初始化 Supabase HTTP 客户端
    this.supabaseUrl = this.configService.get<string>('NEXT_PUBLIC_SUPABASE_URL')!;
    const supabaseKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY')!;

    this.supabaseClient = this.httpClientFactory.create({
      baseURL: `${this.supabaseUrl}/rest/v1`,
      timeout: 30000,
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
    });

    this.logger.log('AgentTestService 初始化完成');
  }

  /**
   * 执行单条测试
   */
  async executeTest(request: TestChatRequestDto): Promise<TestChatResponse> {
    const startTime = Date.now();
    const scenario = request.scenario || 'candidate-consultation';

    // 获取配置档案
    const profile = this.profileLoader.getProfile(scenario);
    if (!profile) {
      throw new Error(`未找到场景 ${scenario} 的配置`);
    }

    // 获取品牌配置
    const brandConfigData = await this.brandConfig.getBrandConfig();
    const mergedContext = {
      ...(profile.context || {}),
      ...(brandConfigData?.brandData && { configData: brandConfigData.brandData }),
      ...(brandConfigData?.replyPrompts && { replyPrompts: brandConfigData.replyPrompts }),
    };

    // 构建测试 ID
    const testId = `test-${Date.now()}`;

    this.logger.log(`执行测试: ${request.caseName || request.message.substring(0, 50)}...`);

    let result: any;
    let executionStatus: 'success' | 'failure' | 'timeout' = 'success';
    let errorMessage: string | null = null;

    try {
      // 调用 Agent API（直接调用 chat 方法以支持 messages 参数）
      result = await this.agentService.chat({
        conversationId: testId,
        userMessage: request.message,
        messages: request.history || [],
        model: profile.model,
        systemPrompt: profile.systemPrompt,
        promptType: profile.promptType,
        allowedTools: profile.allowedTools,
        context: mergedContext,
        toolContext: profile.toolContext,
        contextStrategy: profile.contextStrategy,
        prune: profile.prune,
        pruneOptions: profile.pruneOptions,
      });

      if (result.status === 'error') {
        executionStatus = 'failure';
        errorMessage = result.error?.message || '未知错误';
      }
    } catch (error: any) {
      executionStatus = error.message?.includes('timeout') ? 'timeout' : 'failure';
      errorMessage = error.message;
      result = { status: 'error', error: { message: error.message } };
    }

    const durationMs = Date.now() - startTime;

    // 提取实际输出
    const actualOutput = this.extractResponseText(result);

    // 提取工具调用
    const toolCalls = this.extractToolCalls(result);

    // 提取 Token 使用
    const tokenUsage = result.data?.usage || {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };

    // 构建响应
    const response: TestChatResponse = {
      actualOutput,
      status: executionStatus,
      request: {
        url: `${this.configService.get('AGENT_API_BASE_URL')}/chat`,
        method: 'POST',
        body: (result as any).requestBody || null,
      },
      response: {
        statusCode: executionStatus === 'success' ? 200 : 500,
        body: result.data || result.fallback || result.error,
        toolCalls,
      },
      metrics: {
        durationMs,
        tokenUsage,
      },
    };

    // 保存执行记录
    if (request.saveExecution !== false) {
      const execution = await this.saveExecution({
        batchId: request.batchId,
        caseId: request.caseId,
        caseName: request.caseName,
        category: request.category,
        testInput: {
          message: request.message,
          history: request.history,
          scenario,
        },
        expectedOutput: request.expectedOutput,
        agentRequest: response.request.body,
        agentResponse: response.response.body,
        actualOutput,
        toolCalls,
        executionStatus,
        durationMs,
        tokenUsage,
        errorMessage,
      });

      response.executionId = execution.id;
    }

    return response;
  }

  /**
   * 执行流式测试
   * 返回 Agent API 的原始流式响应
   */
  async executeTestStream(request: TestChatRequestDto): Promise<NodeJS.ReadableStream> {
    const scenario = request.scenario || 'candidate-consultation';

    // 获取配置档案
    const profile = this.profileLoader.getProfile(scenario);
    if (!profile) {
      throw new Error(`未找到场景 ${scenario} 的配置`);
    }

    // 获取品牌配置
    const brandConfigData = await this.brandConfig.getBrandConfig();
    const mergedContext = {
      ...(profile.context || {}),
      ...(brandConfigData?.brandData && { configData: brandConfigData.brandData }),
      ...(brandConfigData?.replyPrompts && { replyPrompts: brandConfigData.replyPrompts }),
    };

    // 构建测试 ID
    const testId = `test-stream-${Date.now()}`;

    this.logger.log(
      `[Stream] 执行流式测试: ${request.caseName || request.message.substring(0, 50)}...`,
    );

    // 构建消息历史，将当前消息添加到历史末尾
    const messages = [
      ...(request.history || []),
      { role: 'user' as const, content: request.message },
    ];

    // 构建请求参数（符合 ChatRequest 接口）
    const chatRequest = {
      model: profile.model,
      messages,
      systemPrompt: profile.systemPrompt,
      promptType: profile.promptType,
      allowedTools: profile.allowedTools,
      context: mergedContext,
      toolContext: profile.toolContext,
      contextStrategy: profile.contextStrategy,
      prune: profile.prune,
      pruneOptions: profile.pruneOptions,
    };

    // 调用流式 API
    return this.apiClient.chatStream(chatRequest, testId);
  }

  /**
   * 批量执行测试
   */
  async executeBatch(
    cases: TestChatRequestDto[],
    batchId?: string,
    parallel = false,
  ): Promise<TestChatResponse[]> {
    this.logger.log(`批量执行测试: ${cases.length} 个用例, 并行: ${parallel}`);

    // 更新批次状态为 running
    if (batchId) {
      await this.updateBatchStatus(batchId, 'running');
    }

    const results: TestChatResponse[] = [];

    if (parallel) {
      // 并行执行（限制并发数为 5）
      const batchSize = 5;
      for (let i = 0; i < cases.length; i += batchSize) {
        const batch = cases.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map((testCase) => this.executeTest({ ...testCase, batchId })),
        );
        results.push(...batchResults);
      }
    } else {
      // 串行执行
      for (const testCase of cases) {
        const result = await this.executeTest({ ...testCase, batchId });
        results.push(result);
      }
    }

    // 更新批次状态和统计
    if (batchId) {
      await this.updateBatchStats(batchId);
      await this.updateBatchStatus(batchId, 'reviewing');
    }

    return results;
  }

  /**
   * 创建测试批次
   */
  async createBatch(request: CreateBatchRequestDto): Promise<TestBatch> {
    const response = await this.supabaseClient.post<TestBatch[]>('/test_batches', {
      name: request.name,
      source: request.source || 'manual',
      feishu_app_token: request.feishuAppToken || null,
      feishu_table_id: request.feishuTableId || null,
      status: 'created',
    });

    const batch = response.data[0];
    this.logger.log(`创建测试批次: ${batch.id} - ${batch.name}`);
    return batch;
  }

  /**
   * 获取测试批次列表
   */
  async getBatches(limit = 20, offset = 0): Promise<TestBatch[]> {
    const response = await this.supabaseClient.get<TestBatch[]>('/test_batches', {
      params: {
        order: 'created_at.desc',
        limit,
        offset,
      },
    });
    return response.data;
  }

  /**
   * 获取批次详情
   */
  async getBatch(batchId: string): Promise<TestBatch | null> {
    const response = await this.supabaseClient.get<TestBatch[]>('/test_batches', {
      params: {
        id: `eq.${batchId}`,
      },
    });
    return response.data[0] || null;
  }

  /**
   * 获取批次的执行记录
   */
  async getBatchExecutions(
    batchId: string,
    filters?: {
      reviewStatus?: string;
      executionStatus?: string;
      category?: string;
    },
  ): Promise<TestExecution[]> {
    const params: any = {
      batch_id: `eq.${batchId}`,
      order: 'created_at.asc',
    };

    if (filters?.reviewStatus) {
      params.review_status = `eq.${filters.reviewStatus}`;
    }
    if (filters?.executionStatus) {
      params.execution_status = `eq.${filters.executionStatus}`;
    }
    if (filters?.category) {
      params.category = `eq.${filters.category}`;
    }

    const response = await this.supabaseClient.get<TestExecution[]>('/test_executions', {
      params,
    });
    return response.data;
  }

  /**
   * 获取执行记录详情
   */
  async getExecution(executionId: string): Promise<TestExecution | null> {
    const response = await this.supabaseClient.get<TestExecution[]>('/test_executions', {
      params: {
        id: `eq.${executionId}`,
      },
    });
    return response.data[0] || null;
  }

  /**
   * 获取执行记录列表（不关联批次）
   */
  async getExecutions(limit = 50, offset = 0): Promise<TestExecution[]> {
    const response = await this.supabaseClient.get<TestExecution[]>('/test_executions', {
      params: {
        order: 'created_at.desc',
        limit,
        offset,
      },
    });
    return response.data;
  }

  /**
   * 更新评审状态
   */
  async updateReview(executionId: string, review: UpdateReviewRequestDto): Promise<TestExecution> {
    const response = await this.supabaseClient.patch<TestExecution[]>(
      `/test_executions?id=eq.${executionId}`,
      {
        review_status: review.reviewStatus,
        review_comment: review.reviewComment || null,
        failure_reason: review.failureReason || null,
        reviewed_by: review.reviewedBy || null,
        reviewed_at: new Date().toISOString(),
      },
    );

    const execution = response.data[0];

    // 更新批次统计
    if (execution.batch_id) {
      await this.updateBatchStats(execution.batch_id);
    }

    this.logger.log(`更新评审状态: ${executionId} -> ${review.reviewStatus}`);
    return execution;
  }

  /**
   * 批量更新评审状态
   */
  async batchUpdateReview(executionIds: string[], review: UpdateReviewRequestDto): Promise<number> {
    // 使用 IN 查询更新
    const response = await this.supabaseClient.patch<TestExecution[]>(
      `/test_executions?id=in.(${executionIds.join(',')})`,
      {
        review_status: review.reviewStatus,
        review_comment: review.reviewComment || null,
        failure_reason: review.failureReason || null,
        reviewed_by: review.reviewedBy || null,
        reviewed_at: new Date().toISOString(),
      },
    );

    // 获取涉及的批次并更新统计
    const batchIds = new Set(response.data.map((e) => e.batch_id).filter(Boolean));
    for (const batchId of batchIds) {
      await this.updateBatchStats(batchId!);
    }

    return response.data.length;
  }

  /**
   * 获取批次统计信息
   */
  async getBatchStats(batchId: string): Promise<BatchStats> {
    const executions = await this.getBatchExecutions(batchId);

    const totalCases = executions.length;
    const executedCount = executions.filter((e) => e.execution_status !== 'pending').length;
    const passedCount = executions.filter((e) => e.review_status === 'passed').length;
    const failedCount = executions.filter((e) => e.review_status === 'failed').length;
    const pendingReviewCount = executions.filter((e) => e.review_status === 'pending').length;

    const reviewedCount = passedCount + failedCount;
    const passRate = reviewedCount > 0 ? (passedCount / reviewedCount) * 100 : null;

    const completedExecutions = executions.filter(
      (e) => e.execution_status === 'success' && e.duration_ms,
    );
    const avgDurationMs =
      completedExecutions.length > 0
        ? Math.round(
            completedExecutions.reduce((sum, e) => sum + (e.duration_ms || 0), 0) /
              completedExecutions.length,
          )
        : null;

    const executionsWithTokens = executions.filter((e) => e.token_usage?.totalTokens);
    const avgTokenUsage =
      executionsWithTokens.length > 0
        ? Math.round(
            executionsWithTokens.reduce((sum, e) => sum + (e.token_usage?.totalTokens || 0), 0) /
              executionsWithTokens.length,
          )
        : null;

    return {
      totalCases,
      executedCount,
      passedCount,
      failedCount,
      pendingReviewCount,
      passRate,
      avgDurationMs,
      avgTokenUsage,
    };
  }

  /**
   * 获取分类统计
   */
  async getCategoryStats(
    batchId: string,
  ): Promise<Array<{ category: string; total: number; passed: number; failed: number }>> {
    const executions = await this.getBatchExecutions(batchId);

    const categoryMap = new Map<string, { total: number; passed: number; failed: number }>();

    for (const execution of executions) {
      const category = execution.category || '未分类';
      const stats = categoryMap.get(category) || { total: 0, passed: 0, failed: 0 };
      stats.total++;
      if (execution.review_status === 'passed') stats.passed++;
      if (execution.review_status === 'failed') stats.failed++;
      categoryMap.set(category, stats);
    }

    return Array.from(categoryMap.entries()).map(([category, stats]) => ({
      category,
      ...stats,
    }));
  }

  /**
   * 获取失败原因统计
   */
  async getFailureReasonStats(
    batchId: string,
  ): Promise<Array<{ reason: string; count: number; percentage: number }>> {
    const executions = await this.getBatchExecutions(batchId, { reviewStatus: 'failed' });

    const reasonMap = new Map<string, number>();

    for (const execution of executions) {
      const reason = execution.failure_reason || 'other';
      reasonMap.set(reason, (reasonMap.get(reason) || 0) + 1);
    }

    const total = executions.length;
    return Array.from(reasonMap.entries())
      .map(([reason, count]) => ({
        reason,
        count,
        percentage: total > 0 ? Math.round((count / total) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }

  // ========== 私有方法 ==========

  /**
   * 保存执行记录
   */
  private async saveExecution(data: {
    batchId?: string;
    caseId?: string;
    caseName?: string;
    category?: string;
    testInput: any;
    expectedOutput?: string;
    agentRequest: any;
    agentResponse: any;
    actualOutput: string;
    toolCalls: any[];
    executionStatus: string;
    durationMs: number;
    tokenUsage: any;
    errorMessage: string | null;
  }): Promise<TestExecution> {
    const response = await this.supabaseClient.post<TestExecution[]>('/test_executions', {
      batch_id: data.batchId || null,
      case_id: data.caseId || null,
      case_name: data.caseName || null,
      category: data.category || null,
      test_input: data.testInput,
      expected_output: data.expectedOutput || null,
      agent_request: data.agentRequest,
      agent_response: data.agentResponse,
      actual_output: data.actualOutput,
      tool_calls: data.toolCalls,
      execution_status: data.executionStatus,
      duration_ms: data.durationMs,
      token_usage: data.tokenUsage,
      error_message: data.errorMessage,
    });

    return response.data[0];
  }

  /**
   * 更新批次状态
   */
  private async updateBatchStatus(
    batchId: string,
    status: 'created' | 'running' | 'completed' | 'reviewing',
  ): Promise<void> {
    const updateData: any = { status };
    if (status === 'completed') {
      updateData.completed_at = new Date().toISOString();
    }

    await this.supabaseClient.patch(`/test_batches?id=eq.${batchId}`, updateData);
  }

  /**
   * 更新批次统计信息
   */
  private async updateBatchStats(batchId: string): Promise<void> {
    const stats = await this.getBatchStats(batchId);

    await this.supabaseClient.patch(`/test_batches?id=eq.${batchId}`, {
      total_cases: stats.totalCases,
      executed_count: stats.executedCount,
      passed_count: stats.passedCount,
      failed_count: stats.failedCount,
      pending_review_count: stats.pendingReviewCount,
      pass_rate: stats.passRate,
      avg_duration_ms: stats.avgDurationMs,
      avg_token_usage: stats.avgTokenUsage,
    });
  }

  /**
   * 提取响应文本
   */
  private extractResponseText(result: any): string {
    try {
      const response = result.data || result.fallback;
      if (!response?.messages?.length) return '';

      return response.messages
        .map((msg: any) => {
          if (msg.parts) {
            return msg.parts.map((p: any) => p.text || '').join('');
          }
          return msg.content || '';
        })
        .join('\n\n');
    } catch {
      return '';
    }
  }

  /**
   * 提取工具调用
   */
  private extractToolCalls(result: any): any[] {
    try {
      const response = result.data || result.fallback;
      if (!response?.messages?.length) return [];

      const toolCalls: any[] = [];
      for (const msg of response.messages) {
        if (msg.parts) {
          for (const part of msg.parts) {
            if (part.type === 'tool_call' || part.toolName) {
              toolCalls.push({
                toolName: part.toolName,
                input: part.input,
                output: part.output,
              });
            }
          }
        }
      }
      return toolCalls;
    } catch {
      return [];
    }
  }

  // ========== 飞书导入相关方法 ==========

  /**
   * 从飞书多维表格导入测试用例
   */
  async importFromFeishu(request: ImportFromFeishuRequestDto): Promise<ImportResult> {
    this.logger.log(`从飞书导入测试用例: appToken=${request.appToken}, tableId=${request.tableId}`);

    // 1. 获取飞书 Token
    const token = await this.getFeishuToken();

    // 2. 获取表格字段列表（用于确定字段映射）
    const fields = await this.getFeishuTableFields(token, request.appToken, request.tableId);
    this.logger.log(`表格字段: ${fields.map((f: any) => f.field_name).join(', ')}`);

    // 3. 获取所有记录
    const records = await this.getFeishuTableRecords(token, request.appToken, request.tableId);
    this.logger.log(`获取到 ${records.length} 条记录`);

    if (records.length === 0) {
      throw new Error('飞书表格中没有数据');
    }

    // 4. 创建批次
    const batchName =
      request.batchName ||
      `飞书导入 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;
    const batch = await this.createBatch({
      name: batchName,
      source: 'feishu',
      feishuAppToken: request.appToken,
      feishuTableId: request.tableId,
    });

    // 5. 解析记录并转换为测试用例
    const cases = this.parseFeishuRecords(records, fields);
    this.logger.log(`解析得到 ${cases.length} 个有效测试用例`);

    // 6. 保存测试用例（不执行）
    const savedCases: ImportResult['cases'] = [];
    for (const testCase of cases) {
      const execution = await this.saveExecution({
        batchId: batch.id,
        caseId: testCase.caseId,
        caseName: testCase.caseName,
        category: testCase.category,
        testInput: {
          message: testCase.message,
          history: testCase.history,
          scenario: 'candidate-consultation',
        },
        expectedOutput: testCase.expectedOutput,
        agentRequest: null,
        agentResponse: null,
        actualOutput: '',
        toolCalls: [],
        executionStatus: 'pending',
        durationMs: 0,
        tokenUsage: null,
        errorMessage: null,
      });

      savedCases.push({
        caseId: execution.id,
        caseName: testCase.caseName || '未命名',
        category: testCase.category,
        message: testCase.message,
      });
    }

    // 7. 更新批次统计
    await this.updateBatchStats(batch.id);

    // 8. 如果需要立即执行
    if (request.executeImmediately) {
      this.logger.log('开始执行测试用例...');
      // 异步执行，不阻塞返回
      this.executeImportedCases(batch.id, cases, request.parallel || false).catch((err) => {
        this.logger.error(`批量执行失败: ${err.message}`, err.stack);
      });
    }

    return {
      batchId: batch.id,
      batchName: batch.name,
      totalImported: savedCases.length,
      cases: savedCases,
    };
  }

  /**
   * 执行已导入的测试用例
   */
  private async executeImportedCases(
    batchId: string,
    cases: Array<{
      caseId: string;
      caseName: string;
      category?: string;
      message: string;
      history?: any[];
      expectedOutput?: string;
    }>,
    parallel: boolean,
  ): Promise<void> {
    const testCases: TestChatRequestDto[] = cases.map((c) => ({
      message: c.message,
      history: c.history,
      caseId: c.caseId,
      caseName: c.caseName,
      category: c.category,
      expectedOutput: c.expectedOutput,
      batchId,
      saveExecution: false, // 已经保存过了，这里只更新
    }));

    await this.updateBatchStatus(batchId, 'running');

    // 执行单个测试用例的函数
    const executeOne = async (testCase: TestChatRequestDto) => {
      try {
        const result = await this.executeTest({ ...testCase, saveExecution: false });

        // 更新执行记录
        await this.supabaseClient.patch(
          `/test_executions?batch_id=eq.${batchId}&case_id=eq.${testCase.caseId}`,
          {
            agent_request: result.request.body,
            agent_response: result.response.body,
            actual_output: result.actualOutput,
            tool_calls: result.response.toolCalls || [],
            execution_status: result.status,
            duration_ms: result.metrics.durationMs,
            token_usage: result.metrics.tokenUsage,
          },
        );
      } catch (error: any) {
        this.logger.error(`执行测试用例失败: ${testCase.caseName}`, error.stack);
        await this.supabaseClient.patch(
          `/test_executions?batch_id=eq.${batchId}&case_id=eq.${testCase.caseId}`,
          {
            execution_status: 'failure',
            error_message: error.message,
          },
        );
      }
    };

    // 根据 parallel 参数决定执行方式
    if (parallel) {
      // 并行执行（但限制并发数为 5）
      const concurrencyLimit = 5;
      for (let i = 0; i < testCases.length; i += concurrencyLimit) {
        const batch = testCases.slice(i, i + concurrencyLimit);
        await Promise.all(batch.map(executeOne));
      }
    } else {
      // 串行执行
      for (const testCase of testCases) {
        await executeOne(testCase);
      }
    }

    await this.updateBatchStats(batchId);
    await this.updateBatchStatus(batchId, 'reviewing');
  }

  /**
   * 获取飞书 Tenant Access Token
   */
  private async getFeishuToken(): Promise<string> {
    const now = Date.now();

    // 检查缓存
    if (this.feishuTokenCache && this.feishuTokenCache.expireAt > now + 60_000) {
      return this.feishuTokenCache.token;
    }

    const { appId, appSecret } = feishuBitableConfig;
    const client = this.httpClientFactory.create({
      baseURL: 'https://open.feishu.cn/open-apis',
      timeout: 10000,
    });

    const response = await client.post('/auth/v3/tenant_access_token/internal', {
      app_id: appId,
      app_secret: appSecret,
    });

    if (response.data.code !== 0) {
      throw new Error(`获取飞书 Token 失败: ${response.data.msg}`);
    }

    const token = response.data.tenant_access_token;
    const expireAt = now + response.data.expire * 1000;

    this.feishuTokenCache = { token, expireAt };
    this.logger.log('获取飞书 Token 成功');

    return token;
  }

  /**
   * 获取飞书表格字段列表
   */
  private async getFeishuTableFields(
    token: string,
    appToken: string,
    tableId: string,
  ): Promise<any[]> {
    const client = this.httpClientFactory.create({
      baseURL: 'https://open.feishu.cn/open-apis',
      timeout: 10000,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const response = await client.get(`/bitable/v1/apps/${appToken}/tables/${tableId}/fields`);

    if (response.data.code !== 0) {
      throw new Error(`获取表格字段失败: ${response.data.msg}`);
    }

    return response.data.data.items || [];
  }

  /**
   * 获取飞书表格所有记录（支持分页）
   */
  private async getFeishuTableRecords(
    token: string,
    appToken: string,
    tableId: string,
  ): Promise<any[]> {
    const client = this.httpClientFactory.create({
      baseURL: 'https://open.feishu.cn/open-apis',
      timeout: 30000,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const allRecords: any[] = [];
    let pageToken: string | undefined;

    do {
      const params: any = { page_size: 500 };
      if (pageToken) {
        params.page_token = pageToken;
      }

      const response = await client.get(`/bitable/v1/apps/${appToken}/tables/${tableId}/records`, {
        params,
      });

      if (response.data.code !== 0) {
        throw new Error(`获取表格记录失败: ${response.data.msg}`);
      }

      const items = response.data.data.items || [];
      allRecords.push(...items);

      pageToken = response.data.data.has_more ? response.data.data.page_token : undefined;
    } while (pageToken);

    return allRecords;
  }

  /**
   * 解析飞书记录为测试用例
   * 自动识别字段映射
   */
  private parseFeishuRecords(
    records: any[],
    fields: any[],
  ): Array<{
    caseId: string;
    caseName: string;
    category?: string;
    message: string;
    history?: any[];
    expectedOutput?: string;
  }> {
    // 字段名映射（支持多种常见命名）
    const fieldMappings = {
      caseName: ['用例名称', '名称', 'case_name', 'name', '测试用例', '标题'],
      category: ['分类', '类别', 'category', '场景', '标签', 'tag'],
      message: ['用户消息', '消息', 'message', '输入', 'input', '问题', 'question'],
      history: ['历史记录', '对话历史', 'history', '上下文', 'context'],
      expectedOutput: ['预期输出', '预期答案', 'expected', 'expected_output', '答案', 'answer'],
    };

    // 查找字段 ID
    const findFieldId = (mappings: string[]): string | null => {
      for (const mapping of mappings) {
        const field = fields.find((f) => f.field_name.toLowerCase() === mapping.toLowerCase());
        if (field) return field.field_id;
      }
      return null;
    };

    const caseNameFieldId = findFieldId(fieldMappings.caseName);
    const categoryFieldId = findFieldId(fieldMappings.category);
    const messageFieldId = findFieldId(fieldMappings.message);
    const historyFieldId = findFieldId(fieldMappings.history);
    const expectedOutputFieldId = findFieldId(fieldMappings.expectedOutput);

    if (!messageFieldId) {
      throw new Error(
        '未找到消息字段，请确保表格中包含以下字段之一: ' + fieldMappings.message.join(', '),
      );
    }

    const cases: Array<{
      caseId: string;
      caseName: string;
      category?: string;
      message: string;
      history?: any[];
      expectedOutput?: string;
    }> = [];

    for (const record of records) {
      const recordFields = record.fields || {};

      // 提取消息内容
      const messageValue = this.extractFieldValue(recordFields[messageFieldId]);
      if (!messageValue) continue; // 跳过空消息

      // 解析历史记录
      let history: any[] | undefined;
      if (historyFieldId && recordFields[historyFieldId]) {
        const historyText = this.extractFieldValue(recordFields[historyFieldId]);
        if (historyText) {
          try {
            history = JSON.parse(historyText);
          } catch {
            // 不是 JSON，尝试按行解析
            history = this.parseHistoryText(historyText);
          }
        }
      }

      cases.push({
        caseId: record.record_id,
        caseName: caseNameFieldId
          ? this.extractFieldValue(recordFields[caseNameFieldId]) || `用例 ${record.record_id}`
          : `用例 ${record.record_id}`,
        category: categoryFieldId
          ? this.extractFieldValue(recordFields[categoryFieldId])
          : undefined,
        message: messageValue,
        history,
        expectedOutput: expectedOutputFieldId
          ? this.extractFieldValue(recordFields[expectedOutputFieldId])
          : undefined,
      });
    }

    return cases;
  }

  /**
   * 提取飞书字段值
   */
  private extractFieldValue(field: any): string | undefined {
    if (!field) return undefined;

    // 文本字段
    if (typeof field === 'string') return field;

    // 富文本数组
    if (Array.isArray(field)) {
      return field
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item.text) return item.text;
          return '';
        })
        .join('');
    }

    // 对象类型
    if (typeof field === 'object') {
      if (field.text) return field.text;
      if (field.value) return String(field.value);
    }

    return String(field);
  }

  /**
   * 按行解析历史记录文本
   */
  private parseHistoryText(text: string): any[] {
    const lines = text.split('\n').filter((l) => l.trim());
    return lines.map((line) => {
      if (line.startsWith('用户:') || line.startsWith('user:')) {
        return { role: 'user', content: line.replace(/^(用户|user):\s*/i, '') };
      } else if (line.startsWith('AI:') || line.startsWith('assistant:')) {
        return { role: 'assistant', content: line.replace(/^(AI|assistant):\s*/i, '') };
      }
      return { role: 'user', content: line };
    });
  }
}
