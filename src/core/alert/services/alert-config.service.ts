import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AlertConfig,
  AlertRule,
  AlertSeverity,
  AlertThrottleConfig,
  MetricAlertConfig,
} from '../interfaces/alert-config.interface';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 告警配置管理服务
 * 负责加载、缓存和提供告警规则配置
 *
 * 配置优先级：
 * 1. 环境变量（运行时动态配置）
 * 2. JSON 配置文件（可热加载）
 * 3. 默认配置（兜底）
 */
@Injectable()
export class AlertConfigService implements OnModuleInit {
  private readonly logger = new Logger(AlertConfigService.name);
  private config: AlertConfig;
  private configFilePath: string;
  private fileWatcher?: fs.FSWatcher;

  constructor(private readonly configService: ConfigService) {
    // 初始化默认配置
    this.config = this.getDefaultConfig();
    this.configFilePath = path.join(process.cwd(), 'config', 'alert-rules.json');
  }

  async onModuleInit(): Promise<void> {
    await this.loadConfig();
    this.watchConfigFile();
  }

  /**
   * 加载配置
   */
  private async loadConfig(): Promise<void> {
    try {
      // 1. 尝试从文件加载
      if (fs.existsSync(this.configFilePath)) {
        const fileContent = fs.readFileSync(this.configFilePath, 'utf-8');
        const fileConfig = JSON.parse(fileContent) as Partial<AlertConfig>;
        this.config = this.mergeConfig(this.config, fileConfig);
        this.logger.log(`告警配置已从文件加载: ${this.configFilePath}`);
      } else {
        this.logger.warn(`告警配置文件不存在，使用默认配置: ${this.configFilePath}`);
      }

      // 2. 环境变量覆盖
      this.applyEnvOverrides();

      this.logger.log(
        `告警配置加载完成: enabled=${this.config.enabled}, rules=${this.config.rules.length}`,
      );
    } catch (error) {
      this.logger.error(`告警配置加载失败，使用默认配置: ${error.message}`, error.stack);
    }
  }

  /**
   * 监听配置文件变化（热加载）
   */
  private watchConfigFile(): void {
    if (!fs.existsSync(this.configFilePath)) {
      return;
    }

    try {
      this.fileWatcher = fs.watch(this.configFilePath, async (eventType) => {
        if (eventType === 'change') {
          this.logger.log('检测到告警配置文件变化，正在重新加载...');
          await this.loadConfig();
        }
      });
      this.logger.log('告警配置文件监听已启动（支持热加载）');
    } catch (error) {
      this.logger.warn(`无法监听配置文件变化: ${error.message}`);
    }
  }

  /**
   * 应用环境变量覆盖
   */
  private applyEnvOverrides(): void {
    // 全局开关
    const enabledEnv = this.configService.get<string>('ALERT_ENABLED');
    if (enabledEnv !== undefined) {
      this.config.enabled = enabledEnv === 'true';
    }

    // 业务指标阈值覆盖
    const successRateWarning = this.configService.get<number>('ALERT_SUCCESS_RATE_WARNING');
    if (successRateWarning !== undefined) {
      this.config.metrics.successRate.warning = successRateWarning;
    }

    const successRateCritical = this.configService.get<number>('ALERT_SUCCESS_RATE_CRITICAL');
    if (successRateCritical !== undefined) {
      this.config.metrics.successRate.critical = successRateCritical;
    }

    // 默认限流窗口
    const throttleWindow = this.configService.get<number>('ALERT_THROTTLE_WINDOW_MS');
    if (throttleWindow !== undefined) {
      this.config.defaultThrottle.windowMs = throttleWindow;
    }
  }

  /**
   * 获取完整配置
   */
  getConfig(): AlertConfig {
    return { ...this.config };
  }

  /**
   * 根据条件查找匹配的规则
   */
  findMatchingRule(options: {
    errorType?: string;
    errorCode?: string;
    scenario?: string;
  }): AlertRule | null {
    const { errorType, errorCode, scenario } = options;

    for (const rule of this.config.rules) {
      if (!rule.enabled) continue;

      // 匹配 errorType
      if (rule.match.errorType) {
        const types = Array.isArray(rule.match.errorType)
          ? rule.match.errorType
          : [rule.match.errorType];
        if (errorType && !types.includes(errorType as any)) {
          continue;
        }
      }

      // 匹配 errorCode（支持正则）
      if (rule.match.errorCode && errorCode) {
        const regex = new RegExp(rule.match.errorCode);
        if (!regex.test(String(errorCode))) {
          continue;
        }
      }

      // 匹配 scenario
      if (rule.match.scenario) {
        const scenarios = Array.isArray(rule.match.scenario)
          ? rule.match.scenario
          : [rule.match.scenario];
        if (scenario && !scenarios.includes(scenario)) {
          continue;
        }
      }

      // 所有条件匹配，返回规则
      return rule;
    }

    return null;
  }

  /**
   * 获取业务指标配置
   */
  getMetricsConfig(): MetricAlertConfig {
    return { ...this.config.metrics };
  }

  /**
   * 获取默认限流配置
   */
  getDefaultThrottle(): AlertThrottleConfig {
    return { ...this.config.defaultThrottle };
  }

  /**
   * 获取默认严重程度
   */
  getDefaultSeverity(): AlertSeverity {
    return this.config.defaultSeverity;
  }

  /**
   * 检查告警是否全局启用
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * 合并配置
   */
  private mergeConfig(base: AlertConfig, override: Partial<AlertConfig>): AlertConfig {
    return {
      enabled: override.enabled ?? base.enabled,
      defaultSeverity: override.defaultSeverity ?? base.defaultSeverity,
      defaultThrottle: override.defaultThrottle ?? base.defaultThrottle,
      rules: override.rules ?? base.rules,
      metrics: override.metrics ?? base.metrics,
    };
  }

  /**
   * 获取默认配置
   */
  private getDefaultConfig(): AlertConfig {
    return {
      enabled: true,
      defaultSeverity: AlertSeverity.ERROR,
      defaultThrottle: {
        enabled: true,
        windowMs: 5 * 60 * 1000, // 5分钟
        maxOccurrences: 5,
      },
      rules: [
        // Agent 认证失败 - 严重告警
        {
          name: 'agent-auth-failure',
          description: 'Agent API 认证失败（401/403）',
          enabled: true,
          match: {
            errorType: 'agent',
            errorCode: '401|403',
          },
          severity: AlertSeverity.CRITICAL,
          throttle: {
            enabled: true,
            windowMs: 5 * 60 * 1000,
            maxOccurrences: 3,
          },
        },
        // Agent 限流 - 警告
        {
          name: 'agent-rate-limit',
          description: 'Agent API 请求限流（429）',
          enabled: true,
          match: {
            errorType: 'agent',
            errorCode: '429',
          },
          severity: AlertSeverity.WARNING,
          throttle: {
            enabled: true,
            windowMs: 10 * 60 * 1000,
            maxOccurrences: 5,
          },
        },
        // Agent 通用错误
        {
          name: 'agent-general-error',
          description: 'Agent API 通用错误',
          enabled: true,
          match: {
            errorType: 'agent',
          },
          severity: AlertSeverity.ERROR,
          throttle: {
            enabled: true,
            windowMs: 5 * 60 * 1000,
            maxOccurrences: 10,
          },
        },
        // 消息处理错误
        {
          name: 'message-processing-error',
          description: '消息处理错误',
          enabled: true,
          match: {
            errorType: 'message',
          },
          severity: AlertSeverity.WARNING,
          throttle: {
            enabled: true,
            windowMs: 5 * 60 * 1000,
            maxOccurrences: 10,
          },
        },
        // 消息发送失败
        {
          name: 'message-delivery-failure',
          description: '消息发送失败',
          enabled: true,
          match: {
            errorType: 'delivery',
          },
          severity: AlertSeverity.WARNING,
          throttle: {
            enabled: true,
            windowMs: 5 * 60 * 1000,
            maxOccurrences: 10,
          },
        },
        // 消息聚合失败
        {
          name: 'message-merge-failure',
          description: '消息聚合处理失败',
          enabled: true,
          match: {
            errorType: 'merge',
          },
          severity: AlertSeverity.WARNING,
          throttle: {
            enabled: true,
            windowMs: 5 * 60 * 1000,
            maxOccurrences: 5,
          },
        },
      ],
      metrics: {
        successRate: {
          warning: 90,
          critical: 80,
        },
        avgDuration: {
          warning: 5000,
          critical: 10000,
        },
        queueDepth: {
          warning: 50,
          critical: 100,
        },
        errorRate: {
          warning: 10,
          critical: 20,
        },
      },
    };
  }

  /**
   * 清理资源
   */
  onModuleDestroy() {
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.logger.log('告警配置文件监听已停止');
    }
  }
}
