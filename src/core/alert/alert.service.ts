import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
import { SupabaseService, AgentReplyConfig } from '@core/supabase';

/**
 * 告警级别
 */
export type AlertLevel = 'info' | 'warning' | 'error' | 'critical';

/**
 * 告警上下文
 */
export interface AlertContext {
  /** 错误类型 (agent | message | delivery | system) */
  errorType: string;
  /** 错误信息（支持 Error、字符串或任意对象） */
  error: Error | string | unknown;
  /** 会话 ID */
  conversationId?: string;
  /** 用户消息 */
  userMessage?: string;
  /** API 端点 */
  apiEndpoint?: string;
  /** 降级消息 */
  fallbackMessage?: string;
  /** 场景 */
  scenario?: string;
  /** 额外信息 */
  extra?: Record<string, unknown>;
}

/**
 * 节流状态
 */
interface ThrottleState {
  count: number;
  firstSeen: number;
  lastSent: number;
}

/**
 * 告警服务（简化版）
 *
 * 功能：
 * - 发送告警到飞书群聊
 * - 简单节流（5 分钟内同类错误最多发 3 次）
 *
 * 环境变量：
 * - FEISHU_ALERT_WEBHOOK_URL: 飞书 Webhook URL（必填，配置后自动启用告警）
 * - FEISHU_ALERT_SECRET: 签名密钥（可选）
 */
@Injectable()
export class AlertService implements OnModuleInit {
  private readonly logger = new Logger(AlertService.name);
  private readonly httpClient: AxiosInstance;

  // 配置
  private readonly enabled: boolean;
  private readonly webhookUrl: string;
  private readonly secret: string;

  // 节流配置（支持动态更新）
  private throttleWindowMs: number; // 节流窗口（毫秒）
  private throttleMaxCount: number; // 窗口内最大告警次数

  // 节流状态 Map<errorType, ThrottleState>
  private readonly throttleMap = new Map<string, ThrottleState>();

  constructor(
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
  ) {
    this.webhookUrl = this.configService.get<string>('FEISHU_ALERT_WEBHOOK_URL', '');
    this.secret = this.configService.get<string>('FEISHU_ALERT_SECRET', '');

    // 初始节流配置（默认值）
    this.throttleWindowMs = 5 * 60 * 1000; // 5 分钟
    this.throttleMaxCount = 3; // 窗口内最多发送 3 次

    // 只要配置了 Webhook URL 就启用告警
    if (this.webhookUrl) {
      this.enabled = true;
      this.logger.log('飞书告警服务已启用');
    } else {
      this.enabled = false;
      this.logger.warn('未配置 FEISHU_ALERT_WEBHOOK_URL，飞书告警已禁用');
    }

    this.httpClient = axios.create({ timeout: 5000 });

    // 注册配置变更回调
    this.supabaseService.onAgentReplyConfigChange((config) => {
      this.onConfigChange(config);
    });
  }

  /**
   * 模块初始化：从 Supabase 加载动态配置
   */
  async onModuleInit() {
    try {
      const config = await this.supabaseService.getAgentReplyConfig();
      this.throttleWindowMs = config.alertThrottleWindowMs;
      this.throttleMaxCount = config.alertThrottleMaxCount;
      this.logger.log(
        `已从 Supabase 加载配置: 节流窗口=${this.throttleWindowMs / 1000}s, 最大次数=${this.throttleMaxCount}`,
      );
    } catch (error) {
      this.logger.warn('从 Supabase 加载配置失败，使用默认值');
    }
  }

  /**
   * 配置变更回调
   */
  private onConfigChange(config: AgentReplyConfig): void {
    const oldWindowMs = this.throttleWindowMs;
    const oldMaxCount = this.throttleMaxCount;

    this.throttleWindowMs = config.alertThrottleWindowMs;
    this.throttleMaxCount = config.alertThrottleMaxCount;

    if (oldWindowMs !== this.throttleWindowMs || oldMaxCount !== this.throttleMaxCount) {
      this.logger.log(
        `告警节流配置已更新:\n` +
          `  - 节流窗口: ${oldWindowMs / 1000}s → ${this.throttleWindowMs / 1000}s\n` +
          `  - 最大次数: ${oldMaxCount} → ${this.throttleMaxCount}`,
      );
    }
  }

  /**
   * 发送告警（统一入口）
   */
  async sendAlert(context: AlertContext): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }

    // 节流检查
    const throttleKey = context.errorType;
    if (!this.shouldSend(throttleKey)) {
      this.logger.debug(`告警被节流: ${throttleKey}`);
      return false;
    }

    try {
      const errorMessage = this.extractErrorMessage(context.error);
      const level = this.determineLevel(context);
      const content = this.buildAlertCard(context, errorMessage, level);

      await this.send(content);
      this.logger.log(`告警已发送 [${context.errorType}]: ${errorMessage.slice(0, 100)}`);
      return true;
    } catch (error) {
      this.logger.error(`告警发送失败: ${error.message}`);
      return false;
    }
  }

  /**
   * 发送简单文本告警
   */
  async sendSimpleAlert(
    title: string,
    message: string,
    level: AlertLevel = 'error',
  ): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }

    try {
      const content = this.buildSimpleCard(title, message, level);
      await this.send(content);
      return true;
    } catch (error) {
      this.logger.error(`告警发送失败: ${error.message}`);
      return false;
    }
  }

  /**
   * 节流检查
   */
  private shouldSend(key: string): boolean {
    const now = Date.now();
    const state = this.throttleMap.get(key);

    // 清理过期的节流状态
    if (state && now - state.firstSeen > this.throttleWindowMs) {
      this.throttleMap.delete(key);
    }

    const currentState = this.throttleMap.get(key);

    if (!currentState) {
      // 首次出现，记录并允许发送
      this.throttleMap.set(key, {
        count: 1,
        firstSeen: now,
        lastSent: now,
      });
      return true;
    }

    // 检查是否超过限制
    if (currentState.count >= this.throttleMaxCount) {
      currentState.count++;
      return false;
    }

    // 允许发送，更新状态
    currentState.count++;
    currentState.lastSent = now;
    return true;
  }

  /**
   * 提取错误信息
   */
  private extractErrorMessage(error: Error | string | unknown): string {
    if (typeof error === 'string') {
      return error;
    }
    if (error instanceof Error) {
      return error.message;
    }
    if (error && typeof error === 'object') {
      return (error as any).message || JSON.stringify(error);
    }
    return String(error);
  }

  /**
   * 判断告警级别
   */
  private determineLevel(context: AlertContext): AlertLevel {
    const errorStr = this.extractErrorMessage(context.error).toLowerCase();

    // 认证失败 - 严重
    if (errorStr.includes('401') || errorStr.includes('403') || errorStr.includes('unauthorized')) {
      return 'critical';
    }

    // 限流 - 警告
    if (errorStr.includes('429') || errorStr.includes('rate limit')) {
      return 'warning';
    }

    // 超时 - 警告
    if (errorStr.includes('timeout') || errorStr.includes('ETIMEDOUT')) {
      return 'warning';
    }

    // 默认 - 错误
    return 'error';
  }

  /**
   * 构建告警卡片
   */
  private buildAlertCard(
    context: AlertContext,
    errorMessage: string,
    level: AlertLevel,
  ): Record<string, unknown> {
    const levelConfig = {
      info: { icon: 'ℹ️', color: 'blue', title: '信息' },
      warning: { icon: '⚠️', color: 'yellow', title: '警告' },
      error: { icon: '❌', color: 'red', title: '错误' },
      critical: { icon: '🚨', color: 'red', title: '严重' },
    };

    const config = levelConfig[level];
    const time = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

    const fields: string[] = [
      `**错误类型**: ${context.errorType}`,
      `**错误信息**: ${errorMessage.slice(0, 500)}`,
      `**发生时间**: ${time}`,
    ];

    if (context.conversationId) {
      fields.push(`**会话 ID**: ${context.conversationId}`);
    }
    if (context.userMessage) {
      fields.push(`**用户消息**: ${context.userMessage.slice(0, 200)}`);
    }
    if (context.apiEndpoint) {
      fields.push(`**API 端点**: ${context.apiEndpoint}`);
    }
    if (context.fallbackMessage) {
      fields.push(`**降级消息**: ${context.fallbackMessage.slice(0, 100)}`);
    }
    if (context.scenario) {
      fields.push(`**场景**: ${context.scenario}`);
    }

    return {
      msg_type: 'interactive',
      card: {
        config: { wide_screen_mode: true },
        header: {
          title: {
            tag: 'plain_text',
            content: `${config.icon} ${config.title}: ${context.errorType}`,
          },
          template: config.color,
        },
        elements: [
          {
            tag: 'markdown',
            content: fields.join('\n'),
          },
        ],
      },
    };
  }

  /**
   * 构建简单卡片
   */
  private buildSimpleCard(
    title: string,
    message: string,
    level: AlertLevel,
  ): Record<string, unknown> {
    const levelConfig = {
      info: { icon: 'ℹ️', color: 'blue' },
      warning: { icon: '⚠️', color: 'yellow' },
      error: { icon: '❌', color: 'red' },
      critical: { icon: '🚨', color: 'red' },
    };

    const config = levelConfig[level];
    const time = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

    return {
      msg_type: 'interactive',
      card: {
        config: { wide_screen_mode: true },
        header: {
          title: { tag: 'plain_text', content: `${config.icon} ${title}` },
          template: config.color,
        },
        elements: [
          {
            tag: 'markdown',
            content: `${message}\n\n**时间**: ${time}`,
          },
        ],
      },
    };
  }

  /**
   * 发送到飞书
   */
  private async send(content: Record<string, unknown>): Promise<void> {
    let payload = content;

    // 如果配置了签名，添加签名
    if (this.secret) {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const sign = this.generateSign(timestamp);
      payload = { ...content, timestamp, sign };
    }

    const response = await this.httpClient.post(this.webhookUrl, payload);

    if (response.data?.code !== 0) {
      throw new Error(`飞书 API 返回错误: ${JSON.stringify(response.data)}`);
    }
  }

  /**
   * 生成签名
   * 飞书签名校验算法：https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot
   * - 签名字符串：timestamp + "\n" + secret
   * - 使用 HmacSHA256 算法，密钥为签名字符串，对空字节数组签名
   * - 结果进行 Base64 编码
   */
  private generateSign(timestamp: string): string {
    const stringToSign = `${timestamp}\n${this.secret}`;
    // 使用签名字符串作为 HMAC 密钥，对空 Buffer 进行签名
    const hmac = crypto.createHmac('sha256', stringToSign);
    hmac.update(Buffer.alloc(0)); // 对空字节数组签名
    return hmac.digest('base64');
  }
}
