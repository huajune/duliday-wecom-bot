import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
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
import { FeishuBitableApiService } from '@core/feishu/services/feishu-bitable-api.service';
import { AgentTestProcessor } from './agent-test.processor';
import { FeishuTestSyncService } from './services/feishu-test-sync.service';
import { TestStatsService } from './services/test-stats.service';
import {
  TestBatchRepository,
  TestExecutionRepository,
  TestBatch,
  TestExecution,
} from './repositories';
import {
  BatchStatus,
  BatchSource,
  ExecutionStatus,
  FeishuTestStatus,
  ReviewStatus,
  MessageRole,
} from './enums';

/**
 * Agent 测试服务
 * 提供测试执行、结果保存、批次管理等功能
 */
@Injectable()
export class AgentTestService {
  private readonly logger = new Logger(AgentTestService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly agentService: AgentService,
    private readonly profileLoader: ProfileLoaderService,
    private readonly brandConfig: BrandConfigService,
    private readonly apiClient: AgentApiClientService,
    @Inject(forwardRef(() => AgentTestProcessor))
    private readonly testProcessor: AgentTestProcessor,
    private readonly feishuSyncService: FeishuTestSyncService,
    private readonly feishuBitableApi: FeishuBitableApiService,
    private readonly statsService: TestStatsService,
    private readonly batchRepository: TestBatchRepository,
    private readonly executionRepository: TestExecutionRepository,
  ) {
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
    let executionStatus: ExecutionStatus = ExecutionStatus.SUCCESS;
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
        executionStatus = ExecutionStatus.FAILURE;
        errorMessage = result.error?.message || '未知错误';
      }
    } catch (error: any) {
      executionStatus = error.message?.includes('timeout')
        ? ExecutionStatus.TIMEOUT
        : ExecutionStatus.FAILURE;
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
        statusCode: executionStatus === ExecutionStatus.SUCCESS ? 200 : 500,
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
    const result = await this.executeTestStreamWithMeta(request);
    return result.stream;
  }

  /**
   * 执行流式测试（带元数据）
   * 返回流式响应和估算的 input token 数量
   *
   * 由于花卷 API 在流式模式下不返回 token usage，
   * 我们在这里估算 input token 数量，供前端展示使用
   */
  async executeTestStreamWithMeta(
    request: TestChatRequestDto,
  ): Promise<{ stream: NodeJS.ReadableStream; estimatedInputTokens: number }> {
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
      { role: MessageRole.USER, content: request.message },
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

    // 估算 input token 数量
    // 使用简单的字符数/4 估算法（Claude 平均每个 token 约 4 个字符）
    // 只计算 systemPrompt + messages，不计算 context（context 会被 Agent API 处理/压缩）
    const systemPromptLength = profile.systemPrompt?.length || 0;
    const messagesLength = messages.reduce((sum, msg) => sum + (msg.content?.length || 0), 0);
    const totalInputLength = systemPromptLength + messagesLength;
    // 乘以 1.3 系数，因为 tokenizer 对中文字符的处理比字符数/4 更复杂
    const estimatedInputTokens = Math.round((totalInputLength / 4) * 1.3);

    this.logger.debug(
      `[Stream] 估算 input tokens: ${estimatedInputTokens} (prompt: ${systemPromptLength}, messages: ${messagesLength})`,
    );

    // 调用流式 API
    const stream = await this.apiClient.chatStream(chatRequest, testId);

    return { stream, estimatedInputTokens };
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
      await this.updateBatchStatus(batchId, BatchStatus.RUNNING);
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
      await this.updateBatchStatus(batchId, BatchStatus.REVIEWING);
    }

    return results;
  }

  /**
   * 创建测试批次
   */
  async createBatch(request: CreateBatchRequestDto): Promise<TestBatch> {
    return this.batchRepository.create({
      name: request.name,
      source: request.source,
      feishuAppToken: request.feishuAppToken,
      feishuTableId: request.feishuTableId,
    });
  }

  /**
   * 获取测试批次列表
   */
  async getBatches(limit = 20, offset = 0): Promise<TestBatch[]> {
    return this.batchRepository.findMany(limit, offset);
  }

  /**
   * 获取批次详情
   */
  async getBatch(batchId: string): Promise<TestBatch | null> {
    return this.batchRepository.findById(batchId);
  }

  /**
   * 获取批次的执行记录
   */
  async getBatchExecutions(
    batchId: string,
    filters?: {
      reviewStatus?: ReviewStatus;
      executionStatus?: ExecutionStatus;
      category?: string;
    },
  ): Promise<TestExecution[]> {
    return this.executionRepository.findByBatchId(batchId, filters);
  }

  /**
   * 获取执行记录详情
   */
  async getExecution(executionId: string): Promise<TestExecution | null> {
    return this.executionRepository.findById(executionId);
  }

  /**
   * 获取执行记录列表（不关联批次）
   */
  async getExecutions(limit = 50, offset = 0): Promise<TestExecution[]> {
    return this.executionRepository.findMany(limit, offset);
  }

  /**
   * 更新评审状态
   */
  async updateReview(executionId: string, review: UpdateReviewRequestDto): Promise<TestExecution> {
    const execution = await this.executionRepository.updateReview(executionId, {
      reviewStatus: review.reviewStatus,
      reviewComment: review.reviewComment,
      failureReason: review.failureReason,
      reviewedBy: review.reviewedBy,
    });

    // 更新批次统计
    if (execution.batch_id) {
      await this.updateBatchStats(execution.batch_id);

      // 检查是否所有用例都已评审完成，如果是则更新批次状态为 completed
      const stats = await this.getBatchStats(execution.batch_id);
      if (stats.pendingReviewCount === 0 && stats.totalCases > 0) {
        await this.updateBatchStatus(execution.batch_id, BatchStatus.COMPLETED);
        this.logger.log(`批次 ${execution.batch_id} 所有用例评审完成，状态更新为 completed`);
      }
    }

    // 回写飞书（如果有 case_id）
    if (execution.case_id && review.reviewStatus !== ReviewStatus.PENDING) {
      const feishuStatus =
        review.reviewStatus === ReviewStatus.PASSED
          ? FeishuTestStatus.PASSED
          : review.reviewStatus === ReviewStatus.FAILED
            ? FeishuTestStatus.FAILED
            : FeishuTestStatus.SKIPPED;

      // 异步回写，不阻塞响应
      this.feishuSyncService
        .writeBackResult(
          execution.case_id,
          feishuStatus,
          execution.batch_id || undefined,
          review.failureReason,
        )
        .then((result) => {
          if (result.success) {
            this.logger.log(`飞书回写成功: ${execution.case_id} -> ${feishuStatus}`);
          } else {
            this.logger.warn(`飞书回写失败: ${execution.case_id} - ${result.error}`);
          }
        })
        .catch((error) => {
          this.logger.error(`飞书回写异常: ${execution.case_id}`, error);
        });
    }

    this.logger.log(`更新评审状态: ${executionId} -> ${review.reviewStatus}`);
    return execution;
  }

  /**
   * 批量更新评审状态
   */
  async batchUpdateReview(executionIds: string[], review: UpdateReviewRequestDto): Promise<number> {
    const updatedExecutions = await this.executionRepository.batchUpdateReview(executionIds, {
      reviewStatus: review.reviewStatus,
      reviewComment: review.reviewComment,
      failureReason: review.failureReason,
      reviewedBy: review.reviewedBy,
    });

    // 获取涉及的批次并更新统计
    const batchIds = new Set(
      updatedExecutions.map((e: TestExecution) => e.batch_id).filter(Boolean),
    );
    for (const batchId of batchIds) {
      await this.updateBatchStats(batchId as string);
    }

    return updatedExecutions.length;
  }

  /**
   * 获取批次统计信息
   * 委托给 TestStatsService 处理
   */
  async getBatchStats(batchId: string): Promise<BatchStats> {
    return this.statsService.calculateBatchStats(batchId);
  }

  /**
   * 获取分类统计
   * 委托给 TestStatsService 处理
   */
  async getCategoryStats(
    batchId: string,
  ): Promise<Array<{ category: string; total: number; passed: number; failed: number }>> {
    return this.statsService.calculateCategoryStats(batchId);
  }

  /**
   * 获取失败原因统计
   * 委托给 TestStatsService 处理
   */
  async getFailureReasonStats(
    batchId: string,
  ): Promise<Array<{ reason: string; count: number; percentage: number }>> {
    return this.statsService.calculateFailureReasonStats(batchId);
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
    executionStatus: ExecutionStatus;
    durationMs: number;
    tokenUsage: any;
    errorMessage: string | null;
  }): Promise<TestExecution> {
    return this.executionRepository.create(data);
  }

  /**
   * 更新批次状态（带状态机验证）
   * 状态机逻辑已移至 TestBatchRepository
   */
  private async updateBatchStatus(batchId: string, newStatus: BatchStatus): Promise<void> {
    await this.batchRepository.updateStatus(batchId, newStatus);
  }

  /**
   * 更新批次统计信息
   */
  private async updateBatchStats(batchId: string): Promise<void> {
    const stats = await this.getBatchStats(batchId);
    await this.batchRepository.updateStats(batchId, stats);
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
   * 使用 FeishuTestSyncService 处理飞书 API 交互
   */
  async importFromFeishu(request: ImportFromFeishuRequestDto): Promise<ImportResult> {
    this.logger.log(`从飞书导入测试用例: appToken=${request.appToken}, tableId=${request.tableId}`);

    // 1. 使用 FeishuTestSyncService 获取测试用例
    const cases = await this.feishuSyncService.getTestCases(request.appToken, request.tableId);
    this.logger.log(`从飞书获取 ${cases.length} 个有效测试用例`);

    if (cases.length === 0) {
      throw new Error('飞书表格中没有数据');
    }

    // 2. 创建批次
    const batchName =
      request.batchName ||
      `飞书导入 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;
    const batch = await this.createBatch({
      name: batchName,
      source: BatchSource.FEISHU,
      feishuAppToken: request.appToken,
      feishuTableId: request.tableId,
    });

    // 3. 保存测试用例（不执行）
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
        executionStatus: ExecutionStatus.PENDING,
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

    // 4. 更新批次统计
    await this.updateBatchStats(batch.id);

    // 5. 如果需要立即执行，使用任务队列
    if (request.executeImmediately) {
      this.logger.log('将测试用例添加到任务队列...');

      // 更新批次状态为 running
      await this.updateBatchStatus(batch.id, BatchStatus.RUNNING);

      // 通过任务队列执行（异步，不阻塞返回）
      this.testProcessor.addBatchTestJobs(batch.id, cases).catch((err) => {
        this.logger.error(`添加任务到队列失败: ${err.message}`, err.stack);
      });
    }

    return {
      batchId: batch.id,
      batchName: batch.name,
      totalImported: savedCases.length,
      cases: savedCases,
    };
  }

  // ========== 供 Processor 调用的公开方法 ==========

  /**
   * 更新批次状态（公开方法，供 Processor 调用）
   */
  async updateBatchStatusPublic(batchId: string, status: BatchStatus): Promise<void> {
    return this.updateBatchStatus(batchId, status);
  }

  /**
   * 更新批次统计信息（公开方法，供 Processor 调用）
   */
  async updateBatchStatsPublic(batchId: string): Promise<void> {
    return this.updateBatchStats(batchId);
  }

  /**
   * 统计批次中已完成的执行记录数量（公开方法，供 Processor 调用）
   */
  async countCompletedExecutions(batchId: string): Promise<{
    total: number;
    success: number;
    failure: number;
    timeout: number;
  }> {
    return this.executionRepository.countCompletedByBatchId(batchId);
  }

  /**
   * 根据 batchId 和 caseId 更新执行记录
   * 供 Processor 在任务完成后调用
   */
  async updateExecutionByBatchAndCase(
    batchId: string,
    caseId: string,
    data: {
      agentRequest?: unknown;
      agentResponse?: unknown;
      actualOutput?: string;
      toolCalls?: unknown[];
      executionStatus: ExecutionStatus;
      durationMs: number;
      tokenUsage?: unknown;
      errorMessage?: string;
    },
  ): Promise<void> {
    try {
      await this.executionRepository.updateByBatchAndCase(batchId, caseId, data);
    } catch (error: any) {
      this.logger.error(`更新执行记录失败: ${error.message}`);
      throw error;
    }
  }

  // ========== 一键导入执行相关方法 ==========

  /**
   * 一键从预配置的测试集表导入并执行
   * 使用 FeishuBitableApiService.getTableConfig('testSuite') 获取配置
   */
  async quickCreateBatch(options?: {
    batchName?: string;
    parallel?: boolean;
  }): Promise<ImportResult> {
    const { appToken, tableId } = this.feishuBitableApi.getTableConfig('testSuite');

    this.logger.log(`一键创建批量测试: 从测试集表 ${tableId} 导入`);

    return this.importFromFeishu({
      appToken,
      tableId,
      batchName:
        options?.batchName ||
        `批量测试 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
      executeImmediately: true,
      parallel: options?.parallel || false,
    });
  }

  /**
   * 回写测试结果到飞书测试集表
   * 使用 FeishuTestSyncService 处理飞书 API 交互
   */
  async writeBackToFeishu(
    executionId: string,
    testStatus: FeishuTestStatus,
    failureCategory?: string,
  ): Promise<{ success: boolean; error?: string }> {
    // 1. 获取执行记录
    const execution = await this.getExecution(executionId);
    if (!execution) {
      return { success: false, error: '执行记录不存在' };
    }

    // case_id 是飞书记录的 record_id
    const recordId = execution.case_id;
    if (!recordId) {
      return { success: false, error: '执行记录缺少飞书记录 ID' };
    }

    // 2. 使用 FeishuTestSyncService 回写结果
    return this.feishuSyncService.writeBackResult(
      recordId,
      testStatus,
      execution.batch_id || undefined,
      failureCategory,
    );
  }

  /**
   * 批量回写测试结果到飞书
   * 使用 FeishuTestSyncService 处理飞书 API 交互
   */
  async batchWriteBackToFeishu(
    items: Array<{
      executionId: string;
      testStatus: FeishuTestStatus;
      failureCategory?: string;
    }>,
  ): Promise<{ success: number; failed: number; errors: string[] }> {
    // 先获取所有执行记录的 recordId
    const writeBackItems: Array<{
      recordId: string;
      testStatus: FeishuTestStatus;
      batchId?: string;
      failureCategory?: string;
    }> = [];

    const errors: string[] = [];

    for (const item of items) {
      const execution = await this.getExecution(item.executionId);
      if (!execution) {
        errors.push(`${item.executionId}: 执行记录不存在`);
        continue;
      }
      if (!execution.case_id) {
        errors.push(`${item.executionId}: 执行记录缺少飞书记录 ID`);
        continue;
      }

      writeBackItems.push({
        recordId: execution.case_id,
        testStatus: item.testStatus,
        batchId: execution.batch_id || undefined,
        failureCategory: item.failureCategory,
      });
    }

    // 使用 FeishuTestSyncService 批量回写
    const result = await this.feishuSyncService.batchWriteBackResults(writeBackItems);

    return {
      success: result.success,
      failed: result.failed + errors.length,
      errors: [...errors, ...result.errors],
    };
  }
}
