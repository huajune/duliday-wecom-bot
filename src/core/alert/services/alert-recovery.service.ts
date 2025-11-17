import { Injectable, Logger } from '@nestjs/common';
import { RecoveryState } from '../interfaces/alert-config.interface';
import { AlertContext } from '../interfaces/alert-context.interface';

/**
 * 告警恢复检测服务
 * 追踪告警状态，检测故障恢复并发送恢复通知
 *
 * 策略：
 * 1. 记录每个告警键的首次故障时间和失败次数
 * 2. 追踪连续成功次数
 * 3. 达到阈值后认为已恢复
 * 4. 发送恢复通知并清除状态
 */
@Injectable()
export class AlertRecoveryService {
  private readonly logger = new Logger(AlertRecoveryService.name);
  private readonly recoveryStates = new Map<string, RecoveryState>();
  private readonly CONSECUTIVE_SUCCESS_THRESHOLD = 5; // 连续成功5次认为恢复

  /**
   * 记录告警（故障发生）
   */
  recordFailure(context: AlertContext): void {
    const key = this.generateRecoveryKey(context);
    let state = this.recoveryStates.get(key);

    if (!state) {
      // 首次故障，创建状态
      state = {
        key,
        startTime: Date.now(),
        failureCount: 1,
        consecutiveSuccess: 0,
        isRecovered: false,
      };
      this.recoveryStates.set(key, state);
      this.logger.debug(
        `新故障记录 [${key}]: startTime=${new Date(state.startTime).toLocaleString()}`,
      );
    } else {
      // 已存在故障，累加失败次数并重置连续成功计数
      state.failureCount++;
      state.consecutiveSuccess = 0;
      state.isRecovered = false;
      this.logger.debug(`故障更新 [${key}]: failureCount=${state.failureCount}`);
    }
  }

  /**
   * 记录成功（检测恢复）
   * @returns 恢复信息（如果已恢复）
   */
  recordSuccess(context: {
    errorType: string;
    scenario?: string;
    errorCode?: string;
  }): RecoveryState | null {
    const key = this.generateRecoveryKey(context);
    const state = this.recoveryStates.get(key);

    if (!state) {
      // 无活跃故障，无需处理
      return null;
    }

    // 累加连续成功次数
    state.consecutiveSuccess++;
    this.logger.debug(
      `成功记录 [${key}]: consecutiveSuccess=${state.consecutiveSuccess}/${this.CONSECUTIVE_SUCCESS_THRESHOLD}`,
    );

    // 检查是否达到恢复阈值
    if (state.consecutiveSuccess >= this.CONSECUTIVE_SUCCESS_THRESHOLD && !state.isRecovered) {
      state.isRecovered = true;
      this.logger.log(
        `故障已恢复 [${key}]: 故障时长=${Math.floor((Date.now() - state.startTime) / 1000)}秒, 失败次数=${state.failureCount}`,
      );

      // 返回恢复状态（用于发送恢复通知）
      return { ...state };
    }

    return null;
  }

  /**
   * 清除恢复状态（发送恢复通知后调用）
   */
  clearRecoveryState(key: string): void {
    if (this.recoveryStates.delete(key)) {
      this.logger.debug(`恢复状态已清除 [${key}]`);
    }
  }

  /**
   * 获取活跃的故障状态（用于监控）
   */
  getActiveFailures(): RecoveryState[] {
    return Array.from(this.recoveryStates.values()).filter((state) => !state.isRecovered);
  }

  /**
   * 获取特定告警的恢复状态
   */
  getRecoveryState(key: string): RecoveryState | undefined {
    return this.recoveryStates.get(key);
  }

  /**
   * 生成恢复键
   * 格式: errorType:scenario:errorCode
   */
  private generateRecoveryKey(context: {
    errorType: string;
    scenario?: string;
    errorCode?: string;
  }): string {
    const parts = [context.errorType];

    if (context.scenario) {
      parts.push(context.scenario);
    }

    if (context.errorCode) {
      parts.push(String(context.errorCode));
    }

    return parts.join(':');
  }

  /**
   * 获取故障持续时长（秒）
   */
  getFailureDuration(key: string): number | null {
    const state = this.recoveryStates.get(key);
    if (!state) return null;

    return Math.floor((Date.now() - state.startTime) / 1000);
  }
}
