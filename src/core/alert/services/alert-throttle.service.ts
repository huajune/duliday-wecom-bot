import { Injectable, Logger } from '@nestjs/common';
import { ThrottleState } from '../interfaces/alert-config.interface';
import { AlertContext } from '../interfaces/alert-context.interface';
import { AlertConfigService } from './alert-config.service';

/**
 * 告警限流服务
 * 防止告警风暴，支持限流和聚合
 *
 * 策略：
 * 1. 同类型告警在窗口期内只发送一次
 * 2. 后续告警聚合计数
 * 3. 窗口期结束后发送聚合告警
 */
@Injectable()
export class AlertThrottleService {
  private readonly logger = new Logger(AlertThrottleService.name);
  private readonly throttleCache = new Map<string, ThrottleState>();
  private readonly MAX_AGGREGATED_ERRORS = 10; // 最多聚合10条错误信息

  constructor(private readonly configService: AlertConfigService) {
    // 定期清理过期状态（每5分钟）
    setInterval(
      () => {
        this.cleanupExpiredStates();
      },
      5 * 60 * 1000,
    );
  }

  /**
   * 判断是否应该发送告警（限流检查）
   * @param context 告警上下文
   * @returns { shouldSend: boolean, state?: ThrottleState, reason?: string }
   */
  shouldSendAlert(context: AlertContext): {
    shouldSend: boolean;
    state?: ThrottleState;
    reason?: string;
  } {
    // 强制跳过限流
    if (context.forceSkipThrottle) {
      return { shouldSend: true, reason: 'forced' };
    }

    // 获取限流配置
    const throttleConfig = this.getThrottleConfig(context);
    if (!throttleConfig.enabled) {
      return { shouldSend: true, reason: 'throttle-disabled' };
    }

    // 生成限流键
    const throttleKey = this.generateThrottleKey(context);
    const now = Date.now();

    // 获取或创建限流状态
    let state = this.throttleCache.get(throttleKey);

    if (!state) {
      // 首次发送，创建状态
      state = {
        key: throttleKey,
        count: 1,
        firstSeen: now,
        lastSeen: now,
        lastSent: now,
        aggregatedErrors: [this.extractErrorMessage(context)],
      };
      this.throttleCache.set(throttleKey, state);
      return { shouldSend: true, state, reason: 'first-occurrence' };
    }

    // 更新状态
    state.count++;
    state.lastSeen = now;
    this.addAggregatedError(state, this.extractErrorMessage(context));

    // 检查是否超过窗口期
    const windowElapsed = now - state.lastSent;
    const windowExpired = windowElapsed >= throttleConfig.windowMs;

    if (windowExpired) {
      // 窗口期已过，发送聚合告警
      state.lastSent = now;
      return {
        shouldSend: true,
        state,
        reason: `aggregated-${state.count}-occurrences`,
      };
    }

    // 窗口期内，聚合计数但不发送
    return {
      shouldSend: false,
      state,
      reason: `throttled-${Math.ceil((throttleConfig.windowMs - windowElapsed) / 1000)}s-remaining`,
    };
  }

  /**
   * 记录告警（即使被限流也要记录）
   */
  recordAlert(context: AlertContext): void {
    const throttleKey = this.generateThrottleKey(context);
    const state = this.throttleCache.get(throttleKey);

    if (state) {
      this.logger.debug(
        `告警已聚合 [${throttleKey}]: count=${state.count}, firstSeen=${new Date(state.firstSeen).toLocaleString()}`,
      );
    }
  }

  /**
   * 重置限流状态（用于测试或手动清除）
   */
  resetThrottle(throttleKey: string): void {
    this.throttleCache.delete(throttleKey);
    this.logger.log(`限流状态已重置: ${throttleKey}`);
  }

  /**
   * 获取所有限流状态（用于监控）
   */
  getAllThrottleStates(): ThrottleState[] {
    return Array.from(this.throttleCache.values());
  }

  /**
   * 生成限流键
   * 格式: errorType:scenario:errorCode
   */
  private generateThrottleKey(context: AlertContext): string {
    const parts: string[] = [context.errorType];

    if (context.scenario) {
      parts.push(context.scenario);
    }

    if (context.errorCode || context.statusCode) {
      parts.push(String(context.errorCode || context.statusCode));
    }

    return parts.join(':');
  }

  /**
   * 获取限流配置
   */
  private getThrottleConfig(context: AlertContext) {
    const matchedRule = this.configService.findMatchingRule({
      errorType: context.errorType,
      errorCode: context.errorCode || String(context.statusCode),
      scenario: context.scenario,
    });

    if (matchedRule?.throttle) {
      return matchedRule.throttle;
    }

    return this.configService.getDefaultThrottle();
  }

  /**
   * 提取错误信息
   */
  private extractErrorMessage(context: AlertContext): string {
    if (typeof context.error === 'string') {
      return context.error;
    }

    if (context.error?.message) {
      return context.error.message;
    }

    if (context.error?.response?.data?.message) {
      return context.error.response.data.message;
    }

    return '未知错误';
  }

  /**
   * 添加聚合错误信息（最多保留N条）
   */
  private addAggregatedError(state: ThrottleState, errorMessage: string): void {
    if (!state.aggregatedErrors) {
      state.aggregatedErrors = [];
    }

    // 避免重复
    if (state.aggregatedErrors.includes(errorMessage)) {
      return;
    }

    if (state.aggregatedErrors.length < this.MAX_AGGREGATED_ERRORS) {
      state.aggregatedErrors.push(errorMessage);
    }
  }

  /**
   * 清理过期的限流状态
   */
  private cleanupExpiredStates(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, state] of this.throttleCache.entries()) {
      const throttleConfig = this.configService.getDefaultThrottle();
      const expired = now - state.lastSeen > throttleConfig.windowMs * 2; // 2倍窗口期后清理

      if (expired) {
        this.throttleCache.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug(`清理了 ${cleanedCount} 个过期限流状态`);
    }
  }
}
