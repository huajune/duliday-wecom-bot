/**
 * 消息处理模块类型定义
 * 消除 any 类型，提供完整的类型安全
 */

import { ChatResponse, AgentResult } from '@agent';
export { AlertErrorType } from '@core/monitoring/interfaces/monitoring.interface';

// ========================================
// 品牌配置类型
// ========================================

// ========================================
// Agent 回复相关类型
// ========================================

/**
 * Agent 回复内容
 * 从 ChatResponse 中提取的结构化数据
 */
export interface AgentReply {
  /** 回复文本内容 */
  content: string;
  /** Token 使用情况 */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  /** 使用的工具列表 */
  tools?: {
    used: string[];
    skipped: string[];
  };
  /** 原始响应数据（可选，仅供调试使用） */
  rawResponse?: ChatResponse;
}

/**
 * Agent 调用结果
 * 包含原始结果和提取的回复
 */
export interface AgentInvokeResult {
  /** 原始 Agent 结果 */
  result: AgentResult;
  /** 提取的回复内容 */
  reply: AgentReply;
  /** 是否为降级响应 */
  isFallback: boolean;
  /** 处理耗时（毫秒） */
  processingTime: number;
}

// ========================================
// 消息发送相关类型
// ========================================

/**
 * 消息片段
 * 用于分段发送
 */
export interface MessageSegment {
  /** 片段内容 */
  content: string;
  /** 片段索引（从 0 开始） */
  index: number;
  /** 总片段数 */
  total: number;
  /** 是否为第一个片段 */
  isFirst: boolean;
  /** 是否为最后一个片段 */
  isLast: boolean;
}

/**
 * 消息发送上下文
 * 包含发送所需的所有信息
 */
export interface DeliveryContext {
  /** 企业级 token */
  token: string;
  /** 托管账号的系统 wxid */
  imBotId: string;
  /** 私聊：客户的系统 wxid */
  imContactId: string;
  /** 群聊：群的系统 wxid */
  imRoomId: string;
  /** 联系人名称 */
  contactName: string;
  /** 消息 ID（用于监控） */
  messageId: string;
  /** 会话 ID */
  chatId: string;
  /** API 类型（用于动态选择发送接口） */
  _apiType?: 'enterprise' | 'group';
}

/**
 * 消息发送结果
 */
export interface DeliveryResult {
  /** 是否成功 */
  success: boolean;
  /** 发送的片段数 */
  segmentCount: number;
  /** 失败的片段数 */
  failedSegments: number;
  /** 总耗时（毫秒） */
  totalTime: number;
  /** 错误信息（如果有） */
  error?: string;
}

// ========================================
// 消息处理管线相关类型
// ========================================

/**
 * 管线处理结果
 */
export interface PipelineResult<T = any> {
  /** 是否继续处理 */
  continue: boolean;
  /** 结果数据 */
  data?: T;
  /** 停止原因 */
  reason?: string;
  /** 响应给调用方的消息 */
  response?: {
    success: boolean;
    message: string;
  };
}

/**
 * 消息过滤结果
 */
export interface FilterResult {
  /** 是否通过过滤 */
  pass: boolean;
  /** 未通过的原因 */
  reason?: string;
}

// ========================================
// 会话上下文相关类型
// ========================================

/**
 * 降级消息选项
 */
export interface FallbackMessageOptions {
  /** 自定义降级消息 */
  customMessage?: string;
  /** 是否随机选择 */
  random?: boolean;
}

// ========================================
// 聚合处理相关类型
// ========================================

/**
 * 聚合会话状态
 */
