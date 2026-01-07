/**
 * Agent 测试模块枚举定义
 *
 * 统一管理测试相关的状态枚举，避免字面量散落各处
 */

/**
 * 测试执行状态
 * 表示单个测试用例的执行结果
 */
export enum ExecutionStatus {
  /** 待执行 */
  PENDING = 'pending',
  /** 执行成功 */
  SUCCESS = 'success',
  /** 执行失败 */
  FAILURE = 'failure',
  /** 执行超时 */
  TIMEOUT = 'timeout',
}

/**
 * 评审状态
 * 表示测试结果的人工评审状态
 */
export enum ReviewStatus {
  /** 待评审 */
  PENDING = 'pending',
  /** 评审通过 */
  PASSED = 'passed',
  /** 评审失败 */
  FAILED = 'failed',
  /** 跳过评审 */
  SKIPPED = 'skipped',
}

/**
 * 批次状态
 * 表示测试批次的生命周期状态
 *
 * 状态转换规则：
 * - created → running, cancelled
 * - running → reviewing, cancelled
 * - reviewing → completed, cancelled
 * - completed → (终态)
 * - cancelled → (终态)
 */
export enum BatchStatus {
  /** 已创建，待执行 */
  CREATED = 'created',
  /** 执行中 */
  RUNNING = 'running',
  /** 评审中 */
  REVIEWING = 'reviewing',
  /** 已完成 */
  COMPLETED = 'completed',
  /** 已取消 */
  CANCELLED = 'cancelled',
}

/**
 * 批次来源
 * 表示测试用例的导入来源
 */
export enum BatchSource {
  /** 手动创建 */
  MANUAL = 'manual',
  /** 从飞书导入 */
  FEISHU = 'feishu',
}

/**
 * 失败原因分类
 * 用于标记测试失败的原因类型
 */
export enum FailureReason {
  /** 回答错误 */
  WRONG_ANSWER = 'wrong_answer',
  /** 回答不完整 */
  INCOMPLETE = 'incomplete',
  /** 产生幻觉（虚假信息） */
  HALLUCINATION = 'hallucination',
  /** 工具调用错误 */
  TOOL_ERROR = 'tool_error',
  /** 格式问题 */
  FORMAT_ISSUE = 'format_issue',
  /** 语气问题 */
  TONE_ISSUE = 'tone_issue',
  /** 其他原因 */
  OTHER = 'other',
}

/**
 * 飞书测试状态（中文）
 * 用于回写飞书多维表格的测试结果字段
 */
export enum FeishuTestStatus {
  /** 测试通过 */
  PASSED = '通过',
  /** 测试失败 */
  FAILED = '失败',
  /** 跳过测试 */
  SKIPPED = '跳过',
}

/**
 * 消息角色
 * 重新导出共享枚举，保持模块接口兼容性
 */
export { MessageRole } from '@shared/enums';

/**
 * 反馈类型
 * 用于用户提交的测试反馈
 */
export enum FeedbackType {
  /** 负面案例 */
  BADCASE = 'badcase',
  /** 正面案例 */
  GOODCASE = 'goodcase',
}
