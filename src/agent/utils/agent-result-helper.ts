import { ChatResponse } from '../dto/chat-request.dto';
import { AgentResult } from '../models/agent-result.model';

/**
 * Agent Result 辅助函数
 * 提供从 AgentResult 中提取数据的便捷方法
 */
export class AgentResultHelper {
  /**
   * 从 AgentResult 中提取 ChatResponse
   * 优先返回 data，如果没有则返回 fallback
   *
   * @param result AgentResult 对象
   * @returns ChatResponse 对象
   * @throws Error 如果既没有 data 也没有 fallback
   */
  static extractResponse(result: AgentResult): ChatResponse {
    if (result.data) {
      return result.data;
    }

    if (result.fallback) {
      return result.fallback;
    }

    throw new Error('AgentResult 中既没有 data 也没有 fallback');
  }

  /**
   * 检查是否为降级响应
   */
  static isFallback(result: AgentResult): boolean {
    return result.status === 'fallback';
  }

  /**
   * 检查是否为错误响应
   */
  static isError(result: AgentResult): boolean {
    return result.status === 'error';
  }

  /**
   * 检查是否为成功响应
   */
  static isSuccess(result: AgentResult): boolean {
    return result.status === 'success';
  }

  /**
   * 检查是否来自缓存
   */
  static isFromCache(result: AgentResult): boolean {
    return result.fromCache === true;
  }
}
