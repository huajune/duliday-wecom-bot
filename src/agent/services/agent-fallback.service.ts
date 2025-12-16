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
   * 优化后的降级话术库
   * 基于真实招募经理沟通风格优化，更简洁自然
   *
   * 设计原则：
   * - 轻量级(12字以内)为主，适用于快速工具调用
   * - 中等复杂(18字以内)用于多轮确认
   * - 复杂场景(25字以内)处理工具失败/数据缺失
   */
  private readonly fallbackMessages: string[] = [
    // 轻量级(12字以内) - 首选
    '我确认下哈，马上回你~',
    '我这边查一下，稍等~',
    '让我看看哈，很快~',

    // 中等复杂(18字以内)
    '这块我再核实下，确认好马上告诉你哈~',
    '这个涉及几个细节，我确认下再回你',

    // 复杂场景(25字以内)
    '这块资料我这边暂时没看到，我先帮你记下来，确认好回你~',
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
