import { Injectable, Logger } from '@nestjs/common';
import { AgentFallbackInfo } from './models/agent-result.model';

/**
 * 降级场景枚举
 */
export enum FallbackScenario {
  /** 通用网络错误 */
  NETWORK_ERROR = 'network_error',
  /** 品牌配置不可用 */
  BRAND_CONFIG_UNAVAILABLE = 'brand_config_unavailable',
  /** Agent API 错误 */
  AGENT_API_ERROR = 'agent_api_error',
  /** 频率限制 */
  RATE_LIMIT = 'rate_limit',
  /** 上下文缺失 */
  CONTEXT_MISSING = 'context_missing',
}

/**
 * Agent 降级消息管理服务
 * 统一管理所有智能回复的降级策略和消息
 *
 * 职责：
 * 1. 根据不同场景返回合适的降级消息
 * 2. 提供随机降级消息（更自然）
 * 3. 确保降级消息对用户友好，不暴露系统问题
 */
@Injectable()
export class AgentFallbackService {
  private readonly logger = new Logger(AgentFallbackService.name);

  /**
   * 获取降级消息
   * @param scenario 降级场景
   * @returns 降级消息文本
   */
  getFallbackMessage(scenario: FallbackScenario = FallbackScenario.NETWORK_ERROR): string {
    const messages = this.getScenarioMessages(scenario);
    return this.getRandomMessage(messages);
  }

  /**
   * 获取场景对应的预定义消息列表
   * 所有场景统一使用友好话术，不暴露技术问题
   */
  private getScenarioMessages(scenario: FallbackScenario): string[] {
    // CONTEXT_MISSING 特殊处理：需要引导用户提供更多信息
    if (scenario === FallbackScenario.CONTEXT_MISSING) {
      return [
        '你具体想了解哪个岗位？多说一点你的情况，我好帮你精准匹配。',
        '是关于职位、薪资还是别的情况？直接告诉我，我帮你看看。',
        '多分享些细节吧，比如你的意向岗位或经历，这样我的建议会更准。',
      ];
    }

    // RATE_LIMIT 特殊处理：提示消息量大
    if (scenario === FallbackScenario.RATE_LIMIT) {
      return [
        '稍等哈，消息比较多，我逐个看，马上到你。',
        '正在回复大家，稍等一下，马上为你处理。',
        '稍等片刻，我手上同时处理几个咨询，很快给你答复。',
      ];
    }

    // 其他所有场景使用通用话术（不暴露任何技术问题）
    return [
      '这个我得确认一下，稍等。',
      '等我快速核实下最新情况，马上回来。',
      '我问下相关同事，确保信息准确，很快。',
    ];
  }

  /**
   * 从消息列表中随机选择一条
   */
  private getRandomMessage(messages: string[]): string {
    if (messages.length === 0) {
      // 兜底消息（不暴露系统问题）
      return '稍等，我马上处理。';
    }

    const randomIndex = Math.floor(Math.random() * messages.length);
    return messages[randomIndex];
  }

  /**
   * 获取友好的错误提示（给用户看）
   * @param error 错误对象
   * @returns 友好的错误提示
   */
  getFriendlyErrorMessage(error: any): string {
    // 根据错误类型返回不同的降级消息
    const errorMessage = error?.message || '';

    if (errorMessage.includes('品牌配置') || errorMessage.includes('系统配置')) {
      return this.getFallbackMessage(FallbackScenario.BRAND_CONFIG_UNAVAILABLE);
    }

    if (errorMessage.includes('频率') || errorMessage.includes('rate limit')) {
      return this.getFallbackMessage(FallbackScenario.RATE_LIMIT);
    }

    if (errorMessage.includes('上下文') || errorMessage.includes('context')) {
      return this.getFallbackMessage(FallbackScenario.CONTEXT_MISSING);
    }

    // 默认返回网络错误消息
    return this.getFallbackMessage(FallbackScenario.NETWORK_ERROR);
  }

  /**
   * 获取结构化的降级信息（包含原因、建议、可重试时间）
   * @param scenario 降级场景
   * @param retryAfter 可重试时间（秒）
   * @returns 结构化的降级信息
   */
  getFallbackInfo(scenario: FallbackScenario, retryAfter?: number): AgentFallbackInfo {
    const message = this.getFallbackMessage(scenario);
    const reason = this.getScenarioReason(scenario);
    const suggestion = this.getScenarioSuggestion(scenario);

    return {
      reason,
      message,
      suggestion,
      retryAfter,
    };
  }

  /**
   * 获取场景对应的原因描述
   */
  private getScenarioReason(scenario: FallbackScenario): string {
    switch (scenario) {
      case FallbackScenario.CONTEXT_MISSING:
        return '用户信息不足，需要更多上下文';
      case FallbackScenario.RATE_LIMIT:
        return '请求频率过高，触发限流';
      case FallbackScenario.BRAND_CONFIG_UNAVAILABLE:
        return '品牌配置不可用';
      case FallbackScenario.AGENT_API_ERROR:
        return 'Agent API 调用失败';
      case FallbackScenario.NETWORK_ERROR:
      default:
        return '网络连接异常';
    }
  }

  /**
   * 获取场景对应的建议操作
   */
  private getScenarioSuggestion(scenario: FallbackScenario): string {
    switch (scenario) {
      case FallbackScenario.CONTEXT_MISSING:
        return '请用户提供更多详细信息';
      case FallbackScenario.RATE_LIMIT:
        return '稍后重试，或引导用户耐心等待';
      case FallbackScenario.BRAND_CONFIG_UNAVAILABLE:
        return '使用通用配置继续服务';
      case FallbackScenario.AGENT_API_ERROR:
        return '检查 API 状态或切换降级策略';
      case FallbackScenario.NETWORK_ERROR:
      default:
        return '检查网络连接，稍后重试';
    }
  }
}
