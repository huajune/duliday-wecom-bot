import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpClientFactory } from '@core/client-http';
import { AxiosInstance } from 'axios';
import { ExecutionStatus, ReviewStatus, FailureReason } from '../enums';

/**
 * 测试执行记录（数据库格式）
 */
export interface TestExecution {
  id: string;
  batch_id: string | null;
  case_id: string | null;
  case_name: string | null;
  category: string | null;
  test_input: unknown;
  expected_output: string | null;
  agent_request: unknown;
  agent_response: unknown;
  actual_output: string | null;
  tool_calls: unknown;
  execution_status: ExecutionStatus;
  duration_ms: number | null;
  token_usage: unknown;
  error_message: string | null;
  review_status: ReviewStatus;
  review_comment: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  failure_reason: FailureReason | null;
  created_at: string;
}

/**
 * 创建执行记录数据
 */
export interface CreateExecutionData {
  batchId?: string;
  caseId?: string;
  caseName?: string;
  category?: string;
  testInput: unknown;
  expectedOutput?: string;
  agentRequest: unknown;
  agentResponse: unknown;
  actualOutput: string;
  toolCalls: unknown[];
  executionStatus: ExecutionStatus;
  durationMs: number;
  tokenUsage: unknown;
  errorMessage: string | null;
}

/**
 * 更新执行结果数据
 */
export interface UpdateExecutionResultData {
  agentRequest?: unknown;
  agentResponse?: unknown;
  actualOutput?: string;
  toolCalls?: unknown[];
  executionStatus: ExecutionStatus;
  durationMs: number;
  tokenUsage?: unknown;
  errorMessage?: string;
}

/**
 * 更新评审数据
 */
export interface UpdateReviewData {
  reviewStatus: ReviewStatus;
  reviewComment?: string;
  failureReason?: FailureReason;
  reviewedBy?: string;
}

/**
 * 执行记录筛选条件
 */
export interface ExecutionFilters {
  reviewStatus?: ReviewStatus;
  executionStatus?: ExecutionStatus;
  category?: string;
}

/**
 * 测试执行记录 Repository
 *
 * 职责：
 * - 封装执行记录表的 CRUD 操作
 * - 管理评审状态更新
 * - 查询执行记录
 *
 * 从 AgentTestService 中抽取，遵循单一职责原则
 */
@Injectable()
export class TestExecutionRepository {
  private readonly logger = new Logger(TestExecutionRepository.name);
  private readonly supabaseClient: AxiosInstance;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpClientFactory: HttpClientFactory,
  ) {
    const supabaseUrl = this.configService.get<string>('NEXT_PUBLIC_SUPABASE_URL')!;
    const supabaseKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY')!;

    this.supabaseClient = this.httpClientFactory.create({
      baseURL: `${supabaseUrl}/rest/v1`,
      timeout: 30000,
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
    });

    this.logger.log('TestExecutionRepository 初始化完成');
  }

  // ==================== 基础 CRUD ====================

  /**
   * 创建执行记录
   */
  async create(data: CreateExecutionData): Promise<TestExecution> {
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
   * 获取执行记录详情
   */
  async findById(executionId: string): Promise<TestExecution | null> {
    const response = await this.supabaseClient.get<TestExecution[]>('/test_executions', {
      params: {
        id: `eq.${executionId}`,
      },
    });
    return response.data[0] || null;
  }

  /**
   * 获取执行记录列表
   */
  async findMany(limit = 50, offset = 0): Promise<TestExecution[]> {
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
   * 获取批次的执行记录
   */
  async findByBatchId(batchId: string, filters?: ExecutionFilters): Promise<TestExecution[]> {
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
   * 统计批次中已完成的执行记录数量（非 pending 状态）
   */
  async countCompletedByBatchId(batchId: string): Promise<{
    total: number;
    success: number;
    failure: number;
    timeout: number;
  }> {
    // 获取所有非 pending 状态的记录
    const response = await this.supabaseClient.get<TestExecution[]>('/test_executions', {
      params: {
        batch_id: `eq.${batchId}`,
        execution_status: 'neq.pending',
        select: 'execution_status',
      },
    });

    const records = response.data;
    return {
      total: records.length,
      success: records.filter((r) => r.execution_status === ExecutionStatus.SUCCESS).length,
      failure: records.filter((r) => r.execution_status === ExecutionStatus.FAILURE).length,
      timeout: records.filter((r) => r.execution_status === ExecutionStatus.TIMEOUT).length,
    };
  }

  // ==================== 更新操作 ====================

  /**
   * 根据 batchId 和 caseId 更新执行结果
   */
  async updateByBatchAndCase(
    batchId: string,
    caseId: string,
    data: UpdateExecutionResultData,
  ): Promise<void> {
    await this.supabaseClient.patch(
      `/test_executions?batch_id=eq.${batchId}&case_id=eq.${caseId}`,
      {
        agent_request: data.agentRequest || null,
        agent_response: data.agentResponse || null,
        actual_output: data.actualOutput || '',
        tool_calls: data.toolCalls || [],
        execution_status: data.executionStatus,
        duration_ms: data.durationMs,
        token_usage: data.tokenUsage || null,
        error_message: data.errorMessage || null,
      },
    );
  }

  /**
   * 更新评审状态
   */
  async updateReview(executionId: string, review: UpdateReviewData): Promise<TestExecution> {
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

    return response.data[0];
  }

  /**
   * 批量更新评审状态
   */
  async batchUpdateReview(
    executionIds: string[],
    review: UpdateReviewData,
  ): Promise<TestExecution[]> {
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

    return response.data;
  }
}
