import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { FeishuBitableApiService } from '@core/feishu/services/feishu-bitable-api.service';
import { ImportFromFeishuRequestDto, ImportResult } from '../dto/test-chat.dto';
import { TestBatchService } from './test-batch.service';
import { TestExecutionService } from './test-execution.service';
import { FeishuTestSyncService } from './feishu-test-sync.service';
import { TestSuiteProcessor } from '../test-suite.processor';
import { BatchStatus, BatchSource, ExecutionStatus } from '../enums';

/**
 * 测试导入服务
 *
 * 职责：
 * - 从飞书多维表格导入测试用例
 * - 提供一键创建批次功能
 * - 协调导入和执行流程
 */
@Injectable()
export class TestImportService {
  private readonly logger = new Logger(TestImportService.name);

  constructor(
    private readonly batchService: TestBatchService,
    private readonly executionService: TestExecutionService,
    private readonly feishuSyncService: FeishuTestSyncService,
    private readonly feishuBitableApi: FeishuBitableApiService,
    @Inject(forwardRef(() => TestSuiteProcessor))
    private readonly testProcessor: TestSuiteProcessor,
  ) {
    this.logger.log('TestImportService 初始化完成');
  }

  /**
   * 从飞书多维表格导入测试用例
   */
  async importFromFeishu(request: ImportFromFeishuRequestDto): Promise<ImportResult> {
    this.logger.log(`从飞书导入测试用例: appToken=${request.appToken}, tableId=${request.tableId}`);

    // 1. 获取测试用例
    const cases = await this.feishuSyncService.getTestCases(request.appToken, request.tableId);
    this.logger.log(`从飞书获取 ${cases.length} 个有效测试用例`);

    if (cases.length === 0) {
      throw new Error('飞书表格中没有数据');
    }

    // 2. 创建批次
    const batchName =
      request.batchName ||
      `飞书导入 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;
    const batch = await this.batchService.createBatch({
      name: batchName,
      source: BatchSource.FEISHU,
      feishuAppToken: request.appToken,
      feishuTableId: request.tableId,
    });

    // 3. 保存测试用例（不执行）
    const savedCases: ImportResult['cases'] = [];
    for (const testCase of cases) {
      const execution = await this.executionService.saveExecution({
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
    await this.batchService.updateBatchStats(batch.id);

    // 5. 如果需要立即执行，使用任务队列
    if (request.executeImmediately) {
      this.logger.log('将测试用例添加到任务队列...');

      await this.batchService.updateBatchStatus(batch.id, BatchStatus.RUNNING);

      // 异步执行，不阻塞返回
      this.testProcessor.addBatchTestJobs(batch.id, cases).catch((err: Error) => {
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

  /**
   * 一键从预配置的测试集表导入并执行
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
}
