/**
 * 消息角色枚举
 * 统一定义对话消息的角色类型，用于 Agent、消息历史、监控等多个模块
 */
export enum MessageRole {
  /** 用户消息 */
  USER = 'user',
  /** AI 助手消息 */
  ASSISTANT = 'assistant',
  /** 系统消息 */
  SYSTEM = 'system',
}

/**
 * 对话消息角色（仅用户和助手）
 * 用于聊天记录等不包含系统消息的场景
 */
export enum ChatMessageRole {
  /** 用户消息 */
  USER = 'user',
  /** AI 助手消息 */
  ASSISTANT = 'assistant',
}
