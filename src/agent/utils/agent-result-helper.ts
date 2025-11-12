import { ChatResponse } from '../dto/chat-request.dto';
import { AgentResult } from '../models/agent-result.model';

/**
 * Agent Result 辅助函数
 * 提供从 AgentResult 中提取数据的便捷方法
 */
export class AgentResultHelper {
  /**
   * 获取响应（优先返回 data，否则返回 fallback）
   * 这是推荐使用的方法，不会抛出异常
   *
   * @param result AgentResult 对象
   * @returns ChatResponse 对象，如果都不存在则返回 undefined
   */
  static getResponse(result: AgentResult): ChatResponse | undefined {
    return result.data || result.fallback;
  }

  /**
   * 获取响应文本
   * 从响应中提取第一条消息的文本内容
   *
   * @param result AgentResult 对象
   * @returns 响应文本，如果没有则返回空字符串
   */
  static getResponseText(result: AgentResult): string {
    const response = this.getResponse(result);
    if (!response) return '';

    const firstMessage = response.messages?.[0];
    if (!firstMessage) return '';

    const firstPart = firstMessage.parts?.[0];
    return firstPart?.text || '';
  }

  /**
   * 从 AgentResult 中提取 ChatResponse
   * 优先返回 data，如果没有则返回 fallback
   *
   * @param result AgentResult 对象
   * @returns ChatResponse 对象
   * @throws Error 如果既没有 data 也没有 fallback
   * @deprecated 请使用 getResponse() 替代，该方法保留仅为向后兼容
   */
  static extractResponse(result: AgentResult): ChatResponse {
    const response = this.getResponse(result);
    if (!response) {
      throw new Error('AgentResult 中既没有 data 也没有 fallback');
    }
    return response;
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
   * 检查是否成功（包括降级成功）
   * 当状态为 success 或 fallback 时，都可以正常使用响应数据
   */
  static isSuccessOrFallback(result: AgentResult): boolean {
    return result.status === 'success' || result.status === 'fallback';
  }

  /**
   * 检查是否来自缓存
   */
  static isFromCache(result: AgentResult): boolean {
    return result.fromCache === true;
  }
}
