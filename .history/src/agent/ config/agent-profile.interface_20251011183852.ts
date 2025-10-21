import { ChatContext, ToolContext } from './dto/chat-request.dto';

/**
 * Agent 配置档案
 * 定义了 Agent 的职责、使用的模型、工具和上下文
 */
export interface AgentProfile {
  /**
   * 配置名称（唯一标识）
   * 例如: 'wecom-customer-service', 'boss-zhipin-recruiter'
   */
  name: string;

  /**
   * 配置描述
   */
  description: string;

  /**
   * 系统提示词（直接指定）
   * 优先级高于 promptType
   */
  systemPrompt?: string;

  /**
   * 系统提示词类型（从 context.systemPrompts 查找）
   * 可选值: 'bossZhipinSystemPrompt', 'bossZhipinLocalSystemPrompt', 'generalComputerSystemPrompt'
   */
  promptType?: 'bossZhipinSystemPrompt' | 'bossZhipinLocalSystemPrompt' | 'generalComputerSystemPrompt';

  /**
   * 使用的模型
   * 例如: 'anthropic/claude-3-7-sonnet-20250219'
   */
  model: string;

  /**
   * 允许的工具列表
   * 例如: ['bash', 'zhipin_reply_generator']
   */
  allowedTools?: string[];

  /**
   * 默认上下文（全局配置）
   */
  context?: ChatContext;

  /**
   * 工具特定上下文
   */
  toolContext?: ToolContext;
}

/**
 * 场景类型
 * 用于根据不同场景选择不同的 Agent 配置
 */
export enum ScenarioType {
  /** 企微客服（纯文本对话） */
  WECOM_CUSTOMER_SERVICE = 'wecom-customer-service',

  /** BOSS直聘招聘助手 */
  BOSS_ZHIPIN_RECRUITER = 'boss-zhipin-recruiter',

  /** 通用助手 */
  GENERAL_ASSISTANT = 'general-assistant',
}
