import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';

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
 * - ENABLE_FEISHU_ALERT: 是否启用 (默认 false)
 * - FEISHU_ALERT_WEBHOOK_URL: 飞书 Webhook URL
 * - FEISHU_ALERT_SECRET: 签名密钥 (可选)
 */
@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);
  private readonly httpClient: AxiosInstance;

  // 配置
  private readonly enabled: boolean;
  private readonly webhookUrl: string;
  private readonly secret: string;

  // 节流配置（硬编码，不需要环境变量）
  private readonly THROTTLE_WINDOW_MS = 5 * 60 * 1000; // 5 分钟
  private readonly THROTTLE_MAX_COUNT = 3; // 窗口内最多发送 3 次

  // 节流状态 Map<errorType, ThrottleState>
  private readonly throttleMap = new Map<string, ThrottleState>();

  constructor(private readonly configService: ConfigService) {
    this.webhookUrl = this.configService.get<string>('FEISHU_ALERT_WEBHOOK_URL', '');
    this.secret = this.configService.get<string>('FEISHU_ALERT_SECRET', '');
    this.enabled = this.configService.get<string>('ENABLE_FEISHU_ALERT', 'false') === 'true';

    if (this.enabled && !this.webhookUrl) {
      this.logger.warn('飞书告警已启用但未配置 FEISHU_ALERT_WEBHOOK_URL，告警将被禁用');
      this.enabled = false;
    }

    this.httpClient = axios.create({ timeout: 5000 });

    if (this.enabled) {
      this.logger.log('飞书告警服务已启用');
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
    if (state && now - state.firstSeen > this.THROTTLE_WINDOW_MS) {
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
    if (currentState.count >= this.THROTTLE_MAX_COUNT) {
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
   */
  private generateSign(timestamp: string): string {
    const stringToSign = `${timestamp}\n${this.secret}`;
    const hmac = crypto.createHmac('sha256', stringToSign);
    return hmac.update('').digest('base64');
  }
}
