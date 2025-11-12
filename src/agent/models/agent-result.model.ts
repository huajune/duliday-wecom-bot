import { ChatResponse } from '../dto/chat-request.dto';

/**
 * Agent 错误信息
 */
export interface AgentError {
  /** 错误代码 */
  code: string;
  /** 错误消息 */
  message: string;
  /** 错误详情 */
  details?: any;
  /** 是否可重试 */
  retryable?: boolean;
  /** 建议重试时间（秒） */
  retryAfter?: number;
}

/**
 * Agent 降级响应信息
 */
export interface AgentFallbackInfo {
  /** 降级原因 */
  reason: string;
  /** 降级消息 */
  message: string;
  /** 建议的操作 */
  suggestion?: string;
  /** 可重试时间（秒） */
  retryAfter?: number;
}

/**
 * Agent 统一响应模型
 * 支持正常响应、降级响应和错误状态
 */
export interface AgentResult {
  /** 正常响应数据 */
  data?: ChatResponse;

  /** 降级响应（当主要服务不可用时） */
  fallback?: ChatResponse;

  /** 降级信息 */
  fallbackInfo?: AgentFallbackInfo;

  /** 错误信息 */
  error?: AgentError;

  /** 关联ID（用于追踪） */
  correlationId?: string;

  /** 是否来自缓存 */
  fromCache?: boolean;

  /** 响应状态 */
  status: 'success' | 'fallback' | 'error';
}

/**
 * 创建成功响应
 */
export function createSuccessResult(
  data: ChatResponse,
  correlationId?: string,
  fromCache = false,
): AgentResult {
  return {
    data,
    correlationId,
    fromCache,
    status: 'success',
  };
}

/**
 * 创建降级响应
 */
export function createFallbackResult(
  fallback: ChatResponse,
  fallbackInfo: AgentFallbackInfo,
  correlationId?: string,
): AgentResult {
  return {
    fallback,
    fallbackInfo,
    correlationId,
    status: 'fallback',
  };
}

/**
 * 创建错误响应
 */
export function createErrorResult(error: AgentError, correlationId?: string): AgentResult {
  return {
    error,
    correlationId,
    status: 'error',
  };
}
