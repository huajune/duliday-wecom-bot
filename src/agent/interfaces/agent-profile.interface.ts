import { ChatContext, ToolContext, ContextStrategy } from '../dto/chat-request.dto';

/**
 * Agent 配置档案
 * 定义了 Agent 的职责、使用的模型、工具和上下文
 * 完全对齐 /api/v1/chat 接口契约
 */
export interface AgentProfile {
  /**
   * 配置名称（唯一标识）
   * 例如: 'wechat-group-assistant', 'boss-zhipin-recruiter'
   */
  name: string;

  /**
   * 配置描述
   */
  description: string;

  /**
   * 使用的模型（必填）
   * 例如: 'anthropic/claude-3-7-sonnet-20250219'
   */
  model: string;

  /**
   * 系统提示词（直接指定）
   * 优先级高于 promptType
   */
  systemPrompt?: string;

  /**
   * 预定义的场景标识符
   * 具有两个作用:
   * 1. 自动启用该场景对应的工具集
   * 2. 从 context.systemPrompts[promptType] 查找提示词
   */
  promptType?: string;

  /**
   * 允许的工具列表
   * 例如: ['bash', 'zhipin_reply_generator']
   */
  allowedTools?: string[];

  /**
   * 全局上下文数据
   * 包含工具配置、系统提示词等
   */
  context?: ChatContext;

  /**
   * 工具级别的上下文配置
   * 会覆盖全局 context
   */
  toolContext?: ToolContext;

  /**
   * 上下文缺失时的处理策略
   * - error: 返回 400 错误
   * - skip: 跳过无法实例化的工具
   * - report: 仅返回验证报告
   * @default 'error'
   */
  contextStrategy?: ContextStrategy;

  /**
   * 是否启用消息剪裁
   * @default false
   */
  prune?: boolean;

  /**
   * 消息剪裁配置选项
   */
  pruneOptions?: {
    maxOutputTokens?: number;
    targetTokens?: number;
    preserveRecentMessages?: number;
  };
}

/**
 * 场景类型枚举
 * 当前只有候选人咨询服务这一个场景
 */
export enum ScenarioType {
  /** 候选人私聊咨询服务 - 通过企微私聊为候选人提供招聘咨询 */
  CANDIDATE_CONSULTATION = 'candidate-consultation',
}
