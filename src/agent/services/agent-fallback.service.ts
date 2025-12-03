import { Injectable } from '@nestjs/common';
import { AgentFallbackInfo } from '../utils/agent-types';

/**
 * Agent 降级消息管理服务
 * 统一管理所有智能回复的降级策略和消息
 *
 * 职责：
 * 1. 提供统一的降级消息（随机选择，更自然）
 * 2. 确保降级消息对用户友好，不暴露系统问题
 * 3. 原始错误信息直接透传，不做加工处理
 */
@Injectable()
export class AgentFallbackService {
  /**
   * 统一话术库
   * 所有降级场景使用同一套话术，每次随机选择一条
   */
  private readonly fallbackMessages: string[] = [
    '这个我得确认一下，稍等。',
    '等我快速核实下最新情况，马上回来。',
    '我问下相关同事，确保信息准确，很快。',
  ];

  /**
   * 获取降级消息
   * 从统一话术库中随机选择一条
   */
  getFallbackMessage(): string {
    if (this.fallbackMessages.length === 0) {
      return '稍等，我马上处理。';
    }
    const randomIndex = Math.floor(Math.random() * this.fallbackMessages.length);
    return this.fallbackMessages[randomIndex];
  }

  /**
   * 获取结构化的降级信息
   * @param reason 降级原因（直接使用花卷 API 返回的原始错误信息）
   * @param retryAfter 可重试时间（秒），来自 HTTP 429 响应
   * @returns 结构化的降级信息
   */
  getFallbackInfo(reason: string, retryAfter?: number): AgentFallbackInfo {
    const message = this.getFallbackMessage();

    return {
      reason,
      message,
      suggestion: '花卷Agent调用异常，请检查花卷Agent配置',
      retryAfter,
    };
  }
}
