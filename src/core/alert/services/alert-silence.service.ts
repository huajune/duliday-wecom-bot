import { Injectable, Logger } from '@nestjs/common';
import { AlertErrorType } from '../types';

/**
 * 告警静默规则
 */
interface SilenceRule {
  key: string; // 静默键（errorType 或 errorType:scenario）
  until: number; // 静默截止时间（时间戳）
  reason: string; // 静默原因
  createdAt: number; // 创建时间
  createdBy?: string; // 创建人
}

/**
 * 告警静默服务
 * 支持临时屏蔽特定类型的告警
 *
 * 使用场景：
 * 1. 计划内维护
 * 2. 已知问题修复中
 * 3. 非紧急告警临时关闭
 */
@Injectable()
export class AlertSilenceService {
  private readonly logger = new Logger(AlertSilenceService.name);
  private readonly silenceRules = new Map<string, SilenceRule>();

  constructor() {
    // 定期清理过期规则（每分钟）
    setInterval(() => {
      this.cleanupExpiredRules();
    }, 60 * 1000);
  }

  /**
   * 添加静默规则
   * @param options 静默选项
   */
  addSilence(options: {
    errorType: AlertErrorType;
    scenario?: string;
    durationMs: number;
    reason: string;
    createdBy?: string;
  }): SilenceRule {
    const key = this.generateSilenceKey(options.errorType, options.scenario);
    const now = Date.now();

    const rule: SilenceRule = {
      key,
      until: now + options.durationMs,
      reason: options.reason,
      createdAt: now,
      createdBy: options.createdBy,
    };

    this.silenceRules.set(key, rule);

    this.logger.log(
      `静默规则已添加 [${key}]: until=${new Date(rule.until).toLocaleString()}, reason="${rule.reason}"`,
    );

    return rule;
  }

  /**
   * 检查告警是否被静默
   */
  isSilenced(errorType: AlertErrorType, scenario?: string): boolean {
    const now = Date.now();

    // 1. 检查精确匹配（errorType + scenario）
    if (scenario) {
      const specificKey = this.generateSilenceKey(errorType, scenario);
      const specificRule = this.silenceRules.get(specificKey);

      if (specificRule && specificRule.until > now) {
        this.logger.debug(`告警被静默 [${specificKey}]: reason="${specificRule.reason}"`);
        return true;
      }
    }

    // 2. 检查通配匹配（只有 errorType）
    const generalKey = this.generateSilenceKey(errorType);
    const generalRule = this.silenceRules.get(generalKey);

    if (generalRule && generalRule.until > now) {
      this.logger.debug(`告警被静默 [${generalKey}]: reason="${generalRule.reason}"`);
      return true;
    }

    return false;
  }

  /**
   * 获取静默信息
   */
  getSilenceInfo(errorType: AlertErrorType, scenario?: string): SilenceRule | null {
    const now = Date.now();

    // 先检查精确匹配
    if (scenario) {
      const specificKey = this.generateSilenceKey(errorType, scenario);
      const specificRule = this.silenceRules.get(specificKey);

      if (specificRule && specificRule.until > now) {
        return specificRule;
      }
    }

    // 再检查通配匹配
    const generalKey = this.generateSilenceKey(errorType);
    const generalRule = this.silenceRules.get(generalKey);

    if (generalRule && generalRule.until > now) {
      return generalRule;
    }

    return null;
  }

  /**
   * 移除静默规则（通过 errorType 和 scenario）
   */
  removeSilence(errorType: AlertErrorType, scenario?: string): boolean;
  /**
   * 移除静默规则（通过 key）
   */
  removeSilence(key: string): boolean;
  removeSilence(errorTypeOrKey: AlertErrorType | string, scenario?: string): boolean {
    let key: string;

    // 判断是通过 key 还是通过 errorType + scenario
    if (scenario !== undefined || !errorTypeOrKey.includes(':')) {
      // 通过 errorType + scenario
      key = this.generateSilenceKey(errorTypeOrKey as AlertErrorType, scenario);
    } else {
      // 通过 key
      key = errorTypeOrKey;
    }

    const deleted = this.silenceRules.delete(key);

    if (deleted) {
      this.logger.log(`静默规则已移除 [${key}]`);
    }

    return deleted;
  }

  /**
   * 列出所有静默规则（包括已过期的）
   */
  listSilenceRules(): Array<SilenceRule & { errorType: AlertErrorType; scenario?: string }> {
    return Array.from(this.silenceRules.values()).map((rule) => {
      const [errorType, ...scenarioParts] = rule.key.split(':');
      const scenario = scenarioParts.length > 0 ? scenarioParts.join(':') : undefined;

      return {
        ...rule,
        errorType: errorType as AlertErrorType,
        scenario,
      };
    });
  }

  /**
   * 获取所有活跃的静默规则
   */
  getActiveSilenceRules(): SilenceRule[] {
    const now = Date.now();
    return Array.from(this.silenceRules.values()).filter((rule) => rule.until > now);
  }

  /**
   * 清空所有静默规则
   */
  clearAllSilenceRules(): number {
    const count = this.silenceRules.size;
    this.silenceRules.clear();
    this.logger.log(`已清空所有静默规则，共 ${count} 条`);
    return count;
  }

  /**
   * 生成静默键
   */
  private generateSilenceKey(errorType: AlertErrorType, scenario?: string): string {
    return scenario ? `${errorType}:${scenario}` : errorType;
  }

  /**
   * 清理过期规则
   */
  private cleanupExpiredRules(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, rule] of this.silenceRules.entries()) {
      if (rule.until <= now) {
        this.silenceRules.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.log(`清理了 ${cleanedCount} 个过期静默规则`);
    }
  }

  /**
   * 获取静默剩余时间（秒）
   */
  getRemainingTime(errorType: AlertErrorType, scenario?: string): number | null {
    const rule = this.getSilenceInfo(errorType, scenario);
    if (!rule) return null;

    const remaining = Math.ceil((rule.until - Date.now()) / 1000);
    return Math.max(0, remaining);
  }
}
