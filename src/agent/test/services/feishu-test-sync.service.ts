import { Injectable, Logger } from '@nestjs/common';
import {
  FeishuBitableApiService,
  BitableField,
  BitableRecord,
} from '@core/feishu/services/feishu-bitable-api.service';
import { testSuiteFieldNames } from '@core/feishu/constants/feishu-bitable.config';
import { FeishuTestStatus } from '../enums';

/**
 * 解析后的测试用例
 */
export interface ParsedTestCase {
  caseId: string; // 飞书记录 ID
  caseName: string;
  category?: string;
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  expectedOutput?: string;
}

/**
 * 飞书测试集同步服务
 *
 * 职责：
 * - 从飞书多维表格读取测试用例
 * - 解析飞书记录为测试用例格式
 * - 回写测试结果到飞书
 *
 * 重构说明：
 * - 使用 FeishuBitableApiService 进行 API 调用
 * - 移除重复的 Token 管理代码
 * - 遵循模块边界：业务逻辑在此，API 调用委托给 core/feishu
 */
@Injectable()
export class FeishuTestSyncService {
  private readonly logger = new Logger(FeishuTestSyncService.name);

  constructor(private readonly bitableApi: FeishuBitableApiService) {
    this.logger.log('FeishuTestSyncService 初始化完成');
  }

  // ==================== 测试用例读取 ====================

  /**
   * 从预配置的测试集表获取所有测试用例
   */
  async getTestCasesFromDefaultTable(): Promise<{
    appToken: string;
    tableId: string;
    cases: ParsedTestCase[];
  }> {
    const { appToken, tableId } = this.bitableApi.getTableConfig('testSuite');

    const fields = await this.bitableApi.getFields(appToken, tableId);
    const records = await this.bitableApi.getAllRecords(appToken, tableId);

    const cases = this.parseRecords(records, fields);

    return { appToken, tableId, cases };
  }

  /**
   * 从指定表格获取测试用例
   */
  async getTestCases(appToken: string, tableId: string): Promise<ParsedTestCase[]> {
    const fields = await this.bitableApi.getFields(appToken, tableId);
    const records = await this.bitableApi.getAllRecords(appToken, tableId);

    return this.parseRecords(records, fields);
  }

  // ==================== 记录解析 ====================

  /**
   * 解析飞书记录为测试用例
   */
  parseRecords(records: BitableRecord[], fields: BitableField[]): ParsedTestCase[] {
    const cases: ParsedTestCase[] = [];
    const fieldNameToId = this.bitableApi.buildFieldNameToIdMap(fields);

    for (const record of records) {
      try {
        const recordFields = record.fields;

        // 提取字段值（支持多种常见字段名）
        const caseName = this.extractFieldValue(recordFields, fieldNameToId, [
          '用例名称',
          '名称',
          'case_name',
          'name',
          '测试用例',
          '标题',
          '候选人微信昵称',
        ]);

        const message = this.extractFieldValue(recordFields, fieldNameToId, [
          '用户消息',
          '消息',
          'message',
          '输入',
          'input',
          '问题',
          'question',
        ]);

        // 消息是必填的
        if (!message) {
          this.logger.debug(`跳过记录 ${record.record_id}: 缺少消息字段`);
          continue;
        }

        const category = this.extractFieldValue(recordFields, fieldNameToId, [
          '分类',
          '类别',
          'category',
          '场景',
          '标签',
          'tag',
          '错误类型',
        ]);

        const historyText = this.extractFieldValue(recordFields, fieldNameToId, [
          '聊天记录',
          '历史记录',
          '对话历史',
          'history',
          '上下文',
          'context',
        ]);

        const expectedOutput = this.extractFieldValue(recordFields, fieldNameToId, [
          '预期输出',
          '预期答案',
          'expected',
          'expected_output',
          '答案',
          'answer',
        ]);

        cases.push({
          caseId: record.record_id,
          caseName: caseName || `测试用例 ${record.record_id}`,
          category: category || undefined,
          message,
          history: historyText ? this.parseHistory(historyText) : undefined,
          expectedOutput: expectedOutput || undefined,
        });
      } catch (error: any) {
        this.logger.warn(`解析记录 ${record.record_id} 失败: ${error.message}`);
      }
    }

    this.logger.log(`成功解析 ${cases.length}/${records.length} 条测试用例`);
    return cases;
  }

  /**
   * 从记录中提取字段值（支持多个字段名候选）
   */
  private extractFieldValue(
    recordFields: Record<string, any>,
    fieldNameToId: Record<string, string>,
    candidateNames: string[],
  ): string | undefined {
    for (const name of candidateNames) {
      // 先尝试用字段 ID
      const fieldId = fieldNameToId[name];
      if (fieldId && recordFields[fieldId]) {
        return this.normalizeFieldValue(recordFields[fieldId]);
      }
      // 再尝试用字段名直接访问
      if (recordFields[name]) {
        return this.normalizeFieldValue(recordFields[name]);
      }
    }
    return undefined;
  }

  /**
   * 标准化字段值（处理飞书的复杂字段类型）
   */
  private normalizeFieldValue(value: any): string | undefined {
    if (!value) return undefined;

    // 文本字段
    if (typeof value === 'string') {
      return value.trim();
    }

    // 数组（多行文本或多值字段）
    if (Array.isArray(value)) {
      return value
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item.text) return item.text;
          return String(item);
        })
        .join('\n')
        .trim();
    }

    // 对象（富文本等）
    if (typeof value === 'object') {
      if (value.text) return value.text.trim();
      if (value.value) return String(value.value);
    }

    return String(value).trim();
  }

  /**
   * 解析对话历史文本
   */
  parseHistory(historyText: string): Array<{ role: 'user' | 'assistant'; content: string }> {
    if (!historyText?.trim()) return [];

    const lines = historyText.split('\n').filter((line) => line.trim());

    return lines.map((line) => {
      // 格式1: [时间 用户名] 消息内容
      const bracketMatch = line.match(/^\[[\d/]+ [\d:]+ ([^\]]+)\]\s*(.*)$/);
      if (bracketMatch) {
        const userName = bracketMatch[1].trim();
        const content = bracketMatch[2];
        const isAssistant =
          userName === '招募经理' ||
          userName === '经理' ||
          userName === 'AI' ||
          userName === 'assistant';
        return { role: isAssistant ? 'assistant' : 'user', content };
      }

      // 格式2: user:/候选人: 开头
      if (line.startsWith('user:') || line.startsWith('候选人:')) {
        return { role: 'user', content: line.replace(/^(user|候选人):\s*/i, '') };
      }

      // 格式3: AI:/assistant:/招募经理: 开头
      if (line.startsWith('AI:') || line.startsWith('assistant:') || line.startsWith('招募经理:')) {
        return { role: 'assistant', content: line.replace(/^(AI|assistant|招募经理):\s*/i, '') };
      }

      // 默认当作用户消息
      return { role: 'user', content: line };
    });
  }

  // ==================== 结果回写 ====================

  /**
   * 回写测试结果到飞书记录
   */
  async writeBackResult(
    recordId: string,
    testStatus: FeishuTestStatus,
    batchId?: string,
    failureCategory?: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { appToken, tableId } = this.bitableApi.getTableConfig('testSuite');

      // 获取表格字段（用于获取选项 ID）
      const fields = await this.bitableApi.getFields(appToken, tableId);

      // 构建更新数据
      const updateFields: Record<string, any> = {};

      // 1. 测试状态（单选字段）
      const statusField = fields.find((f) => f.field_name === testSuiteFieldNames.testStatus);
      if (statusField?.property?.options) {
        const option = statusField.property.options.find((opt) => opt.name === testStatus);
        if (option) {
          updateFields[statusField.field_id] = option.id;
        }
      }

      // 2. 最近测试时间（日期时间字段）
      const timeField = fields.find((f) => f.field_name === testSuiteFieldNames.lastTestTime);
      if (timeField) {
        updateFields[timeField.field_id] = Date.now();
      }

      // 3. 测试批次（文本字段）
      if (batchId) {
        const batchField = fields.find((f) => f.field_name === testSuiteFieldNames.testBatch);
        if (batchField) {
          updateFields[batchField.field_id] = batchId;
        }
      }

      // 4. 分类/失败原因（单选字段）- 仅在失败时更新
      if (testStatus === FeishuTestStatus.FAILED && failureCategory) {
        const categoryField = fields.find(
          (f) => f.field_name === testSuiteFieldNames.failureCategory,
        );
        if (categoryField?.property?.options) {
          const option = categoryField.property.options.find((opt) => opt.name === failureCategory);
          if (option) {
            updateFields[categoryField.field_id] = option.id;
          }
        }
      }

      // 调用飞书 API 更新记录
      const result = await this.bitableApi.updateRecord(appToken, tableId, recordId, updateFields);

      if (!result.success) {
        this.logger.error(`回写飞书失败: ${result.error}`);
        return { success: false, error: result.error };
      }

      this.logger.log(`回写飞书成功: ${recordId} -> ${testStatus}`);
      return { success: true };
    } catch (error: any) {
      this.logger.error(`回写飞书异常: ${error.message}`, error.stack);
      return { success: false, error: error.message };
    }
  }

  /**
   * 批量回写测试结果
   */
  async batchWriteBackResults(
    items: Array<{
      recordId: string;
      testStatus: FeishuTestStatus;
      batchId?: string;
      failureCategory?: string;
    }>,
  ): Promise<{ success: number; failed: number; errors: string[] }> {
    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const item of items) {
      const result = await this.writeBackResult(
        item.recordId,
        item.testStatus,
        item.batchId,
        item.failureCategory,
      );

      if (result.success) {
        success++;
      } else {
        failed++;
        errors.push(`${item.recordId}: ${result.error}`);
      }
    }

    return { success, failed, errors };
  }
}
