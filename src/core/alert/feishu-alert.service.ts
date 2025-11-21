import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
import { AlertErrorType } from './types';

interface AgentAlertOptions {
  errorType?: AlertErrorType;
  fallbackMessage?: string;
  fallbackSuccess?: boolean; // 降级是否成功（用户是否看到错误）
  scenario?: string;
  channel?: string;
  contactName?: string; // 用户昵称
  requestParams?: any; // Chat API 请求参数（用于排查问题）
  apiKey?: string; // Agent API Key（会自动脱敏）
  requestHeaders?: Record<string, any>; // 请求头信息
  // 告警编排层传递的字段
  severity?: 'info' | 'warning' | 'error' | 'critical'; // 告警严重程度
  aggregatedCount?: number; // 聚合的告警数量
  aggregatedErrors?: string[]; // 聚合的错误消息列表
  aggregatedTimeWindow?: { start: string; end: string }; // 聚合时间窗口
  duration?: number; // 请求耗时（毫秒）
}

/**
 * 飞书告警服务
 * 负责发送告警通知到飞书群聊
 *
 * 使用飞书自定义机器人 Webhook
 * 文档：https://open.feishu.cn/document/ukTMukTMukTM/ucTM5YjL3ETO24yNxkjN
 */
@Injectable()
export class FeiShuAlertService {
  private readonly logger = new Logger(FeiShuAlertService.name);
  private readonly webhookUrl: string;
  private readonly secret: string;
  private readonly enabled: boolean;
  private readonly httpClient: AxiosInstance;

  // 品牌配置告警频次限制（5分钟内只发一次）
  private lastBrandConfigAlertTime: number = 0;
  private readonly BRAND_CONFIG_ALERT_INTERVAL_MS = 5 * 60 * 1000; // 5分钟

  constructor(private readonly configService: ConfigService) {
    this.webhookUrl = this.configService.get<string>('FEISHU_ALERT_WEBHOOK_URL', '');
    this.secret = this.configService.get<string>('FEISHU_ALERT_SECRET', '');
    this.enabled = this.configService.get<string>('ENABLE_FEISHU_ALERT', 'false') === 'true';

    if (this.enabled && !this.webhookUrl) {
      this.logger.warn('飞书告警已启用，但未配置 FEISHU_ALERT_WEBHOOK_URL，告警将被禁用');
      this.enabled = false;
    }

    this.httpClient = axios.create({
      timeout: 5000, // 5秒超时
    });

    if (this.enabled) {
      this.logger.log('飞书告警服务已启用');
      if (this.secret) {
        this.logger.log('飞书签名验证已启用');
      } else {
        this.logger.log('飞书签名验证未启用');
      }
    } else {
      this.logger.log('飞书告警服务未启用');
    }
  }

  /**
   * 发送 Agent API 调用失败告警
   * @param error 错误信息
   * @param conversationId 会话ID
   * @param userMessage 用户消息
   * @param apiEndpoint API 端点
   */
  async sendAgentApiFailureAlert(
    error: any,
    conversationId: string,
    userMessage: string,
    apiEndpoint: string = '/api/v1/chat',
    options?: AgentAlertOptions,
  ): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const apiResponse = error.response || (error as any)?.apiResponse;
    const errorDetails = apiResponse?.data || error.response?.data || {};
    const statusCode = apiResponse?.status || 'N/A';
    const errorMessage = this.extractErrorMessage(error, apiResponse);
    const requestHeaders = (error as any)?.requestHeaders;

    const content = this.buildAgentApiFailureMessage(
      errorMessage,
      statusCode,
      conversationId,
      userMessage,
      apiEndpoint,
      errorDetails,
      requestHeaders,
      error, // 传递原始错误对象用于提取堆栈信息
      options,
    );

    await this.send(content);
  }

  /**
   * 发送通用告警
   * @param title 告警标题
   * @param message 告警内容
   * @param level 告警级别
   */
  async sendAlert(
    title: string,
    message: string,
    level: 'info' | 'warning' | 'error' = 'error',
  ): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const content = this.buildGenericMessage(title, message, level);
    await this.send(content);
  }

  /**
   * 发送品牌配置不可用告警
   * @param error 错误信息
   * @param isFirstLoad 是否首次加载失败
   */
  async sendBrandConfigUnavailableAlert(error: any, isFirstLoad: boolean = false): Promise<void> {
    if (!this.enabled) {
      return;
    }

    // 频次限制：5分钟内只发送一次（首次加载失败除外，始终发送）
    const now = Date.now();
    if (!isFirstLoad && now - this.lastBrandConfigAlertTime < this.BRAND_CONFIG_ALERT_INTERVAL_MS) {
      this.logger.debug(
        `品牌配置告警被节流，距上次发送仅 ${Math.round((now - this.lastBrandConfigAlertTime) / 1000)} 秒`,
      );
      return;
    }

    const errorMessage = error.message || error.toString() || '未知错误';

    const content = this.buildBrandConfigUnavailableMessage(errorMessage, isFirstLoad);

    await this.send(content);

    // 更新上次发送时间
    this.lastBrandConfigAlertTime = now;
  }

  /**
   * 脱敏 Token/Key
   * 只保留前 8 位和后 4 位，中间用 *** 替代
   */
  private maskToken(token: string): string {
    if (!token || token.length < 12) {
      return '[无效令牌]';
    }
    const prefix = token.substring(0, 8);
    const suffix = token.substring(token.length - 4);
    return `${prefix}***${suffix}`;
  }

  private extractErrorMessage(error: any, response?: any): string {
    if (response?.data) {
      if (typeof response.data === 'string') {
        return response.data;
      }
      return (
        response.data.message ||
        response.data.error ||
        response.data.detail ||
        JSON.stringify(response.data)
      );
    }

    return error?.message || '未知错误';
  }

  private shouldMaskHeader(headerName: string): boolean {
    const lower = headerName.toLowerCase();
    return (
      lower.includes('authorization') ||
      lower.includes('token') ||
      lower.includes('key') ||
      lower.includes('secret')
    );
  }

  private formatRequestHeaders(headers?: Record<string, any>): string | null {
    if (!headers || Object.keys(headers).length === 0) {
      return null;
    }

    const lines = Object.entries(headers).map(([key, rawValue]) => {
      let displayValue: string;
      if (typeof rawValue === 'string') {
        displayValue = rawValue;
      } else if (Array.isArray(rawValue)) {
        displayValue = rawValue.join(', ');
      } else if (rawValue !== undefined && rawValue !== null) {
        displayValue = JSON.stringify(rawValue);
      } else {
        displayValue = '';
      }

      if (displayValue && this.shouldMaskHeader(key)) {
        if (/^Bearer\s+/i.test(displayValue)) {
          const token = displayValue.replace(/^Bearer\s+/i, '').trim();
          displayValue = `Bearer ${this.maskToken(token)}`;
        } else {
          displayValue = this.maskToken(displayValue);
        }
      }

      return `- ${key}: ${displayValue || '[空]'}`;
    });

    return lines.join('\n');
  }

  private sanitizeErrorDetails(details: any, summary: string): any {
    if (!details) {
      return null;
    }

    if (typeof details === 'string') {
      return this.isSameMessage(details, summary) ? null : details;
    }

    if (Array.isArray(details)) {
      return details;
    }

    if (typeof details === 'object') {
      const clone = { ...details };
      ['message', 'detail', 'error_message', 'errorMessage'].forEach((key) => {
        if (typeof clone[key] === 'string' && this.isSameMessage(clone[key], summary)) {
          delete clone[key];
        }
      });

      return Object.keys(clone).length === 0 ? null : clone;
    }

    return details;
  }

  private stringifyErrorDetails(details: any): string | null {
    if (!details) {
      return null;
    }

    if (typeof details === 'string') {
      return details;
    }

    try {
      const str = JSON.stringify(details, null, 2);
      return str === '{}' ? null : str;
    } catch {
      return null;
    }
  }

  private isSameMessage(value: string, summary?: string): boolean {
    if (!value || !summary) {
      return false;
    }
    return value.trim().toLowerCase() === summary.trim().toLowerCase();
  }

  /**
   * 格式化用户消息（增加长度限制并显示总长度）
   */
  private formatUserMessage(message: string): string {
    const MAX_LENGTH = 500;

    if (message.length <= MAX_LENGTH) {
      return `**用户消息**:\n${message}`;
    }

    const truncated = message.substring(0, MAX_LENGTH);
    return `**用户消息**:\n${truncated}...\n\n<font color="grey">（完整消息长度: ${message.length} 字符，已截断显示前 ${MAX_LENGTH} 字符）</font>`;
  }

  /**
   * 构建智能日志链接（P0 改进）
   * 添加查询参数：conversationId, time, range
   */
  private buildSmartLogUrl(baseUrl: string, conversationId: string, timestamp: string): string {
    try {
      const url = new URL(baseUrl);

      // 添加会话ID参数
      url.searchParams.set('conversationId', conversationId);

      // 添加时间参数（使用告警时间）
      const alertTime = new Date(timestamp.replace(' ', 'T')); // 转换为 ISO 格式
      if (!isNaN(alertTime.getTime())) {
        url.searchParams.set('time', alertTime.toISOString());
      }

      // 添加时间范围参数（前后 5 分钟）
      url.searchParams.set('range', '5m');

      return url.toString();
    } catch (error) {
      // 如果 URL 解析失败，返回原始 URL
      this.logger.warn(`无法解析日志查看器 URL: ${baseUrl}，将使用原始 URL`);
      return baseUrl;
    }
  }

  /**
   * 构建 Agent API 失败告警消息
   */
  private buildAgentApiFailureMessage(
    errorMessage: string,
    statusCode: number | string,
    conversationId: string,
    userMessage: string,
    apiEndpoint: string,
    errorDetails: any,
    requestHeaders: Record<string, any> | undefined,
    error: any, // 原始错误对象（用于提取堆栈信息）
    options?: AgentAlertOptions,
  ): any {
    const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const env = this.configService.get<string>('NODE_ENV', 'unknown');
    const logViewerUrl = this.configService.get<string>('LOG_VIEWER_URL', '');
    const errorType = options?.errorType || 'agent';

    const { title, template } = this.getAlertHeaderMeta(errorType);
    const errorTypeLabel = this.getErrorTypeLabel(errorType);

    // 从 requestParams 中提取 dulidayToken
    const dulidayToken = options?.requestParams?.context?.dulidayToken;

    const metaLines = [
      `**告警时间**: ${timestamp}`,
      `**环境**: ${env}`,
      `**会话ID**: ${conversationId}`,
      `**错误类型**: ${errorTypeLabel}`,
    ];

    // 用户影响评估（P0 改进）
    if (options?.fallbackSuccess !== undefined) {
      const impactText = options.fallbackSuccess
        ? '<font color="green">✅ 已降级（用户无感知）</font>'
        : '<font color="red">❌ 降级失败（用户可见错误）</font>';
      metaLines.push(`**用户影响**: ${impactText}`);
    }

    // 聚合统计（来自编排层）
    if (options?.aggregatedCount && options.aggregatedCount > 1) {
      metaLines.push(`**聚合告警数**: ${options.aggregatedCount} 次相同错误`);
    }
    if (options?.aggregatedTimeWindow) {
      metaLines.push(
        `**聚合时间窗口**: ${options.aggregatedTimeWindow.start} ~ ${options.aggregatedTimeWindow.end}`,
      );
    }

    // 请求耗时（P0 改进）
    if (options?.duration !== undefined && options.duration !== null) {
      const durationSec = (options.duration / 1000).toFixed(2);
      let durationDisplay = `⏱️ ${durationSec}秒`;

      // 性能警告提示
      if (options.duration > 10000) {
        durationDisplay += ' <font color="red">（严重超时）</font>';
      } else if (options.duration > 5000) {
        durationDisplay += ' <font color="orange">（响应较慢）</font>';
      }

      metaLines.push(`**请求耗时**: ${durationDisplay}`);
    }

    if (options?.contactName) {
      metaLines.push(`**用户昵称**: ${options.contactName}`);
    }
    if (options?.scenario) {
      metaLines.push(`**场景**: ${options.scenario}`);
    }
    if (dulidayToken) {
      metaLines.push(`**DuLiDay Token**: ${this.maskToken(dulidayToken)}`);
    }
    if (options?.apiKey) {
      metaLines.push(`**API Key**: ${this.maskToken(options.apiKey)}`);
    }

    // 构建错误详情行（只在有 HTTP 状态码时显示）
    const errorInfoLines = [`**错误信息**: ${errorMessage}`];

    // 只在有有效的 HTTP 状态码时显示（排除 'N/A'）
    if (statusCode !== 'N/A' && statusCode !== null && statusCode !== undefined) {
      errorInfoLines.push(`**HTTP 状态码**: ${statusCode}`);
    }

    errorInfoLines.push(`**API 端点**: ${apiEndpoint}`);

    const elements: any[] = [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: metaLines.join('\n'),
        },
      },
      { tag: 'hr' },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: errorInfoLines.join('\n'),
        },
      },
      { tag: 'hr' },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: this.formatUserMessage(userMessage),
        },
      },
    ];

    if (options?.fallbackMessage) {
      elements.push(
        { tag: 'hr' },
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `**降级话术**: ${options.fallbackMessage}`,
          },
        },
      );
    }

    // 【优化】改进错误详情显示 - HTTP响应体
    const sanitizedErrorDetails = this.sanitizeErrorDetails(errorDetails, errorMessage);
    const errorDetailsStr = this.stringifyErrorDetails(sanitizedErrorDetails);
    const hasErrorDetails = Boolean(errorDetailsStr);

    if (hasErrorDetails) {
      const codeLanguage = typeof sanitizedErrorDetails === 'string' ? 'text' : 'json';
      // 限制显示长度为 1500 字符
      const maxLength = 1500;
      const truncatedDetails =
        errorDetailsStr.length > maxLength
          ? errorDetailsStr.substring(0, maxLength) + '\n...(已截断，查看日志获取完整信息)'
          : errorDetailsStr;

      elements.push(
        { tag: 'hr' },
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `**HTTP 响应体**:\n\`\`\`${codeLanguage}\n${truncatedDetails}\n\`\`\``,
          },
        },
      );
    }

    // 【新增】错误堆栈信息
    const errorStack = error?.stack;
    if (errorStack && typeof errorStack === 'string') {
      // 限制堆栈长度，避免过长
      const maxStackLength = 1000;
      const truncatedStack =
        errorStack.length > maxStackLength
          ? errorStack.substring(0, maxStackLength) + '\n...(已截断，查看日志获取完整堆栈)'
          : errorStack;

      elements.push(
        { tag: 'hr' },
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `**错误堆栈**:\n\`\`\`\n${truncatedStack}\n\`\`\``,
          },
        },
      );
    }

    const headersMarkdown = this.formatRequestHeaders(requestHeaders || options?.requestHeaders);
    if (headersMarkdown) {
      elements.push(
        { tag: 'hr' },
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `**请求 Headers**:\n${headersMarkdown}`,
          },
        },
      );
    }

    if (logViewerUrl) {
      // 智能日志链接（P0 改进）：添加查询参数
      const smartLogUrl = this.buildSmartLogUrl(logViewerUrl, conversationId, timestamp);

      elements.push({
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: {
              tag: 'plain_text',
              content: '查看日志',
            },
            type: 'default',
            url: smartLogUrl,
          },
        ],
      });
    }

    return {
      msg_type: 'interactive',
      card: {
        header: {
          title: {
            tag: 'plain_text',
            content: title,
          },
          template,
        },
        elements,
      },
    };
  }

  private getAlertHeaderMeta(errorType: AlertErrorType): { title: string; template: string } {
    switch (errorType) {
      case 'message':
        return { title: '⚠️ Message 处理失败告警', template: 'orange' };
      case 'delivery':
        return { title: '⚠️ 消息发送失败告警', template: 'yellow' };
      case 'merge':
        return { title: '⚠️ 聚合流程失败告警', template: 'wathet' };
      case 'agent':
      default:
        return { title: '🚨 Agent 调用失败告警', template: 'red' };
    }
  }

  private getErrorTypeLabel(errorType: AlertErrorType): string {
    switch (errorType) {
      case 'message':
        return 'Message Processing Error';
      case 'delivery':
        return 'Delivery Error';
      case 'merge':
        return 'Merge Processor Error';
      case 'agent':
      default:
        return 'Agent Invocation Error';
    }
  }

  /**
   * 构建通用告警消息
   */
  private buildGenericMessage(
    title: string,
    message: string,
    level: 'info' | 'warning' | 'error',
  ): any {
    const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const env = this.configService.get<string>('NODE_ENV', 'unknown');

    // 根据级别选择颜色
    const colorMap = {
      info: 'blue',
      warning: 'orange',
      error: 'red',
    };

    // 根据级别选择图标
    const iconMap = {
      info: 'ℹ️',
      warning: '⚠️',
      error: '🚨',
    };

    return {
      msg_type: 'interactive',
      card: {
        header: {
          title: {
            tag: 'plain_text',
            content: `${iconMap[level]} ${title}`,
          },
          template: colorMap[level],
        },
        elements: [
          {
            tag: 'div',
            text: {
              tag: 'lark_md',
              content: `**告警时间**: ${timestamp}\n**环境**: ${env}`,
            },
          },
          {
            tag: 'hr',
          },
          {
            tag: 'div',
            text: {
              tag: 'lark_md',
              content: message,
            },
          },
        ],
      },
    };
  }

  /**
   * 构建品牌配置不可用告警消息
   */
  private buildBrandConfigUnavailableMessage(errorMessage: string, isFirstLoad: boolean): any {
    const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const env = this.configService.get<string>('NODE_ENV', 'unknown');

    // 获取 Supabase Storage 配置（品牌配置的实际数据源）
    const supabaseUrl = this.configService.get<string>('NEXT_PUBLIC_SUPABASE_URL', '未配置');
    const bucketName = this.configService.get<string>('SUPABASE_BUCKET_NAME', 'brand-configs');
    const configPath = this.configService.get<string>(
      'SUPABASE_BRAND_CONFIG_PATH',
      'config/brand-data.json',
    );
    const storageApiUrl = `${supabaseUrl}/storage/v1/object/${bucketName}/${configPath}`;

    const elements: any[] = [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**告警时间**: ${timestamp}\n**环境**: ${env}\n**首次加载**: ${isFirstLoad ? '是' : '否'}`,
        },
      },
      {
        tag: 'hr',
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**错误信息**: ${errorMessage}\n**API 地址**: ${storageApiUrl}`,
        },
      },
      {
        tag: 'hr',
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**影响**: ${isFirstLoad ? '⚠️ 服务启动但无法提供智能回复，所有用户消息将返回降级提示' : 'ℹ️ 使用旧缓存数据，服务可继续运行'}\n**建议操作**: \n1. 检查 Supabase 存储服务是否正常\n2. 验证 Supabase 配置是否正确\n3. 检查网络连接到 Supabase 是否正常\n4. 查看服务日志获取详细错误信息`,
        },
      },
    ];

    return {
      msg_type: 'interactive',
      card: {
        header: {
          title: {
            tag: 'plain_text',
            content: isFirstLoad ? '🔴 品牌配置加载失败 (首次)' : '⚠️ 品牌配置刷新失败',
          },
          template: isFirstLoad ? 'red' : 'orange', // 首次加载失败用红色，刷新失败用橙色
        },
        elements,
      },
    };
  }

  /**
   * 生成飞书签名
   * @param timestamp 时间戳（秒）
   * @returns 签名字符串
   */
  private generateSign(timestamp: number): string {
    if (!this.secret) {
      return '';
    }

    // 把 timestamp + "\n" + secret 作为签名的原始字符串
    const stringToSign = `${timestamp}\n${this.secret}`;

    // 使用 HmacSHA256 算法计算签名，并进行 Base64 编码
    const sign = crypto.createHmac('sha256', stringToSign).update('').digest('base64');

    return sign;
  }

  /**
   * 发送消息到飞书
   */
  private async send(content: any): Promise<void> {
    if (!this.enabled || !this.webhookUrl) {
      this.logger.warn('飞书告警未启用或未配置 Webhook URL，跳过发送');
      return;
    }

    try {
      // 如果配置了签名密钥，添加签名验证
      if (this.secret) {
        const timestamp = Math.floor(Date.now() / 1000); // 当前时间戳（秒）
        const sign = this.generateSign(timestamp);

        // 添加签名字段到请求体
        content.timestamp = timestamp;
        content.sign = sign;

        this.logger.log(
          `正在发送飞书告警到: ${this.webhookUrl}（已签名: timestamp=${timestamp}, sign=${sign.substring(0, 20)}...）`,
        );
      } else {
        this.logger.log(`正在发送飞书告警到: ${this.webhookUrl}（无签名）`);
      }

      const response = await this.httpClient.post(this.webhookUrl, content);

      // 检查飞书 API 响应
      if (response.data.code === 0) {
        this.logger.log(`✅ 飞书告警发送成功`);
      } else {
        this.logger.error(
          `❌ 飞书告警发送失败，API 返回错误: code=${response.data.code}, msg=${response.data.msg}`,
        );
      }
    } catch (error) {
      // 告警发送失败不应影响主流程
      this.logger.error(
        `❌ 飞书告警发送失败: ${error.message}`,
        error.response?.data ? JSON.stringify(error.response.data) : error.stack,
      );
    }
  }
}
