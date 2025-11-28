import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SupabaseService, AgentReplyConfig } from '@core/supabase';
import { FeishuWebhookService } from './feishu-webhook.service';
import { AlertLevel } from '../interfaces/feishu.interface';
import { ALERT_THROTTLE } from '../constants/feishu.constants';

/**
 * 告警上下文（兼容旧接口）
 */
export interface AlertContext {
  /** 错误类型 */
  errorType: string;
  /** 错误信息（支持 Error、字符串或任意对象） */
  error?: Error | string | unknown;
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
  /** 告警级别（可选） */
  level?: AlertLevel;
  /** 标题（可选） */
  title?: string;
  /** 消息（可选，直接指定消息内容） */
  message?: string;
  /** 详情（可选） */
  details?: Record<string, unknown>;
  /** 时间戳（可选） */
  timestamp?: string;
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
 * 飞书告警服务
 * 功能：
 * - 发送告警到飞书群聊
 * - 节流控制（可动态配置）
 */
@Injectable()
export class FeishuAlertService implements OnModuleInit {
  private readonly logger = new Logger(FeishuAlertService.name);

  // 节流配置（支持动态更新）
  private throttleWindowMs: number;
  private throttleMaxCount: number;

  // 节流状态
  private readonly throttleMap = new Map<string, ThrottleState>();

  constructor(
    private readonly webhookService: FeishuWebhookService,
    private readonly supabaseService: SupabaseService,
  ) {
    // 初始化默认配置
    this.throttleWindowMs = ALERT_THROTTLE.WINDOW_MS;
    this.throttleMaxCount = ALERT_THROTTLE.MAX_COUNT;

    // 注册配置变更回调
    this.supabaseService.onAgentReplyConfigChange((config) => {
      this.onConfigChange(config);
    });

    this.logger.log(
      `飞书告警服务已初始化 (节流窗口=${this.throttleWindowMs / 1000}s, 最大次数=${this.throttleMaxCount})`,
    );
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
        `告警节流配置已更新: 节流窗口=${this.throttleWindowMs / 1000}s, 最大次数=${this.throttleMaxCount}`,
      );
    }
  }

  /**
   * 发送告警（兼容旧接口）
   */
  async sendAlert(context: AlertContext): Promise<boolean> {
    // 节流检查
    const throttleKey = context.errorType;
    if (!this.shouldSend(throttleKey)) {
      this.logger.debug(`告警被节流: ${throttleKey}`);
      return false;
    }

    try {
      const level = context.level || AlertLevel.ERROR;
      const title = context.title || this.getDefaultTitle(context.errorType);
      const color = this.getLevelColor(level);

      // 提取错误消息
      const errorMessage = context.message || this.extractErrorMessage(context.error);

      // 构建消息内容
      const fields: string[] = [];
      const time =
        context.timestamp || new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
      fields.push(`**时间**: ${time}`);
      fields.push(`**级别**: ${level.toUpperCase()}`);
      fields.push(`**类型**: ${context.errorType}`);

      if (errorMessage) {
        fields.push(`**消息**: ${errorMessage}`);
      }

      if (context.conversationId) {
        fields.push(`**会话 ID**: ${context.conversationId}`);
      }

      if (context.userMessage) {
        fields.push(`**用户消息**: ${this.truncate(context.userMessage, 100)}`);
      }

      if (context.apiEndpoint) {
        fields.push(`**API 端点**: ${context.apiEndpoint}`);
      }

      if (context.scenario) {
        fields.push(`**场景**: ${context.scenario}`);
      }

      if (context.fallbackMessage) {
        fields.push(`**降级消息**: ${context.fallbackMessage}`);
      }

      if (context.details) {
        fields.push(`**详情**: \`\`\`json\n${JSON.stringify(context.details, null, 2)}\n\`\`\``);
      }

      if (context.extra) {
        fields.push(`**额外信息**: \`\`\`json\n${JSON.stringify(context.extra, null, 2)}\n\`\`\``);
      }

      // 构建卡片
      const card = this.webhookService.buildCard(title, fields.join('\n'), color);

      // 发送
      const success = await this.webhookService.sendMessage('ALERT', card);

      if (success) {
        this.recordSent(throttleKey);
      }

      return success;
    } catch (error) {
      this.logger.error(`发送告警失败: ${error.message}`);
      return false;
    }
  }

  /**
   * 发送简单文本告警
   */
  async sendSimpleAlert(
    title: string,
    message: string,
    level: 'info' | 'warning' | 'error' | 'critical' = 'error',
  ): Promise<boolean> {
    return this.sendAlert({
      errorType: 'custom',
      title,
      message,
      level: level as AlertLevel,
    });
  }

  /**
   * 提取错误消息
   */
  private extractErrorMessage(error: Error | string | unknown): string {
    if (!error) return '';
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message;
    if (typeof error === 'object' && error !== null && 'message' in error) {
      return String((error as any).message);
    }
    return String(error);
  }

  /**
   * 截断文本
   */
  private truncate(text: string, maxLength: number): string {
    if (!text || text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '...';
  }

  /**
   * 节流检查
   */
  private shouldSend(key: string): boolean {
    const now = Date.now();
    const state = this.throttleMap.get(key);

    if (!state) {
      // 首次出现
      this.throttleMap.set(key, { count: 1, firstSeen: now, lastSent: now });
      return true;
    }

    // 检查是否超过窗口时间
    if (now - state.firstSeen > this.throttleWindowMs) {
      // 重置窗口
      this.throttleMap.set(key, { count: 1, firstSeen: now, lastSent: now });
      return true;
    }

    // 检查是否达到最大次数
    if (state.count >= this.throttleMaxCount) {
      return false;
    }

    return true;
  }

  /**
   * 记录发送
   */
  private recordSent(key: string): void {
    const now = Date.now();
    const state = this.throttleMap.get(key);

    if (state) {
      state.count += 1;
      state.lastSent = now;
    }
  }

  /**
   * 获取默认标题
   */
  private getDefaultTitle(errorType: string): string {
    const titles: Record<string, string> = {
      agent_timeout: '⏰ Agent API 超时',
      agent_auth_error: '🔒 Agent API 认证失败',
      agent_rate_limit: '⚡ Agent API 限流',
      message_delivery_error: '📤 消息发送失败',
      system_error: '🔥 系统错误',
      agent: '🤖 Agent 错误',
      message: '💬 消息处理错误',
      delivery: '📤 消息发送错误',
      system: '⚙️ 系统错误',
      merge: '🔄 消息聚合错误',
    };

    return titles[errorType] || '⚠️ 系统告警';
  }

  /**
   * 获取级别对应的卡片颜色
   */
  private getLevelColor(level: AlertLevel): 'blue' | 'green' | 'yellow' | 'red' {
    const colors: Record<AlertLevel, 'blue' | 'green' | 'yellow' | 'red'> = {
      [AlertLevel.INFO]: 'blue',
      [AlertLevel.WARNING]: 'yellow',
      [AlertLevel.ERROR]: 'red',
      [AlertLevel.CRITICAL]: 'red',
    };

    return colors[level] || 'yellow';
  }
}
