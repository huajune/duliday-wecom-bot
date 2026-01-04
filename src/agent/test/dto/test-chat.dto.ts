import { IsString, IsOptional, IsArray, IsBoolean, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 简单消息结构（用于对话历史）
 */
export class SimpleMessageDto {
  @ApiProperty({ description: '角色', enum: ['user', 'assistant', 'system'] })
  @IsString()
  role: 'user' | 'assistant' | 'system';

  @ApiProperty({ description: '消息内容' })
  @IsString()
  content: string;
}

/**
 * Vercel AI SDK UIMessage 格式的消息部件
 */
export class UIMessagePartDto {
  @ApiProperty({ description: '部件类型', example: 'text' })
  @IsString()
  type: string;

  @ApiPropertyOptional({ description: '文本内容（type=text时）' })
  @IsOptional()
  @IsString()
  text?: string;
}

/**
 * Vercel AI SDK UIMessage 格式
 */
export class UIMessageDto {
  @ApiProperty({ description: '消息ID' })
  @IsString()
  id: string;

  @ApiProperty({ description: '角色', enum: ['user', 'assistant', 'system'] })
  @IsString()
  role: 'user' | 'assistant' | 'system';

  @ApiProperty({ description: '消息部件数组', type: [UIMessagePartDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UIMessagePartDto)
  parts: UIMessagePartDto[];
}

/**
 * Vercel AI SDK useChat 请求格式
 * 用于接收 DefaultChatTransport 发送的请求
 */
export class VercelAIChatRequestDto {
  @ApiProperty({ description: '消息数组（UIMessage 格式）', type: [UIMessageDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UIMessageDto)
  messages: UIMessageDto[];

  @ApiPropertyOptional({ description: '场景配置', default: 'candidate-consultation' })
  @IsOptional()
  @IsString()
  scenario?: string;

  @ApiPropertyOptional({ description: '是否保存执行记录', default: false })
  @IsOptional()
  @IsBoolean()
  saveExecution?: boolean;
}

/**
 * 单条测试请求 DTO
 */
export class TestChatRequestDto {
  @ApiProperty({ description: '测试消息内容' })
  @IsString()
  message: string;

  @ApiPropertyOptional({ description: '对话历史', type: [SimpleMessageDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SimpleMessageDto)
  history?: SimpleMessageDto[];

  @ApiPropertyOptional({ description: '场景配置', default: 'candidate-consultation' })
  @IsOptional()
  @IsString()
  scenario?: string;

  @ApiPropertyOptional({ description: '是否保存执行记录', default: true })
  @IsOptional()
  @IsBoolean()
  saveExecution?: boolean;

  @ApiPropertyOptional({ description: '用例ID（来自飞书等）' })
  @IsOptional()
  @IsString()
  caseId?: string;

  @ApiPropertyOptional({ description: '用例名称/描述' })
  @IsOptional()
  @IsString()
  caseName?: string;

  @ApiPropertyOptional({ description: '分类/场景标签' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: '预期答案（用于人工对比）' })
  @IsOptional()
  @IsString()
  expectedOutput?: string;

  @ApiPropertyOptional({ description: '批次ID（关联测试批次）' })
  @IsOptional()
  @IsString()
  batchId?: string;
}

/**
 * 批量测试请求 DTO
 */
export class BatchTestRequestDto {
  @ApiProperty({ description: '测试用例数组', type: [TestChatRequestDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TestChatRequestDto)
  cases: TestChatRequestDto[];

  @ApiPropertyOptional({ description: '批次名称' })
  @IsOptional()
  @IsString()
  batchName?: string;

  @ApiPropertyOptional({ description: '是否并行执行', default: false })
  @IsOptional()
  @IsBoolean()
  parallel?: boolean;
}

/**
 * 创建测试批次请求 DTO
 */
export class CreateBatchRequestDto {
  @ApiProperty({ description: '批次名称' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: '来源', enum: ['manual', 'feishu'], default: 'manual' })
  @IsOptional()
  @IsString()
  source?: 'manual' | 'feishu';

  @ApiPropertyOptional({ description: '飞书表格 app_token' })
  @IsOptional()
  @IsString()
  feishuAppToken?: string;

  @ApiPropertyOptional({ description: '飞书表格 table_id' })
  @IsOptional()
  @IsString()
  feishuTableId?: string;
}

/**
 * 更新评审状态请求 DTO
 */
export class UpdateReviewRequestDto {
  @ApiProperty({ description: '评审状态', enum: ['passed', 'failed', 'skipped'] })
  @IsString()
  reviewStatus: 'passed' | 'failed' | 'skipped';

  @ApiPropertyOptional({ description: '评审备注' })
  @IsOptional()
  @IsString()
  reviewComment?: string;

  @ApiPropertyOptional({
    description: '失败原因',
    enum: [
      'wrong_answer',
      'incomplete',
      'hallucination',
      'tool_error',
      'format_issue',
      'tone_issue',
      'other',
    ],
  })
  @IsOptional()
  @IsString()
  failureReason?: string;

  @ApiPropertyOptional({ description: '评审人' })
  @IsOptional()
  @IsString()
  reviewedBy?: string;
}

/**
 * 测试执行响应
 */
export interface TestChatResponse {
  // 执行记录ID
  executionId?: string;

  // 结果
  actualOutput: string;
  status: 'success' | 'failure' | 'timeout';

  // 请求详情
  request: {
    url: string;
    method: string;
    body: any;
  };

  // 响应详情
  response: {
    statusCode: number;
    body: any;
    toolCalls?: any[];
  };

  // 指标
  metrics: {
    durationMs: number;
    tokenUsage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
  };
}

/**
 * 批次统计信息
 */
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

/**
 * 从飞书导入测试用例请求 DTO
 */
export class ImportFromFeishuRequestDto {
  @ApiProperty({ description: '飞书多维表格 app_token' })
  @IsString()
  appToken: string;

  @ApiProperty({ description: '飞书多维表格 table_id' })
  @IsString()
  tableId: string;

  @ApiPropertyOptional({ description: '批次名称（可选，默认自动生成）' })
  @IsOptional()
  @IsString()
  batchName?: string;

  @ApiPropertyOptional({ description: '是否立即执行测试', default: false })
  @IsOptional()
  @IsBoolean()
  executeImmediately?: boolean;

  @ApiPropertyOptional({ description: '是否并行执行', default: false })
  @IsOptional()
  @IsBoolean()
  parallel?: boolean;
}

/**
 * 飞书测试用例字段映射配置
 */
export interface FeishuFieldMapping {
  caseName?: string; // 用例名称字段
  category?: string; // 分类字段
  message?: string; // 用户消息字段
  history?: string; // 历史记录字段（JSON 格式）
  expectedOutput?: string; // 预期输出字段
}

/**
 * 导入结果
 */
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

/**
 * 提交反馈请求 DTO
 */
export class SubmitFeedbackRequestDto {
  @ApiProperty({ description: '反馈类型', enum: ['badcase', 'goodcase'] })
  @IsString()
  type: 'badcase' | 'goodcase';

  @ApiProperty({ description: '格式化的聊天记录' })
  @IsString()
  chatHistory: string;

  @ApiPropertyOptional({ description: '错误类型（仅 badcase）' })
  @IsOptional()
  @IsString()
  errorType?: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  remark?: string;

  @ApiPropertyOptional({ description: '会话 ID' })
  @IsOptional()
  @IsString()
  chatId?: string;
}
