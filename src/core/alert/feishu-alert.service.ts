import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';

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
  ): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const errorMessage = error.message || '未知错误';
    const statusCode = error.response?.status || 'N/A';
    const errorDetails = error.response?.data || {};

    const content = this.buildAgentApiFailureMessage(
      errorMessage,
      statusCode,
      conversationId,
      userMessage,
      apiEndpoint,
      errorDetails,
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

    const errorMessage = error.message || error.toString() || '未知错误';
    const errorStack = error.stack || '';

    const content = this.buildBrandConfigUnavailableMessage(errorMessage, errorStack, isFirstLoad);

    await this.send(content);
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
  ): any {
    const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const env = this.configService.get<string>('NODE_ENV', 'unknown');
    const logViewerUrl = this.configService.get<string>('LOG_VIEWER_URL', '');

    const elements: any[] = [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**告警时间**: ${timestamp}\n**环境**: ${env}\n**会话ID**: ${conversationId}`,
        },
      },
      {
        tag: 'hr',
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**错误信息**: ${errorMessage}\n**HTTP 状态码**: ${statusCode}\n**API 端点**: ${apiEndpoint}`,
        },
      },
      {
        tag: 'hr',
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**用户消息**: ${userMessage.substring(0, 100)}${userMessage.length > 100 ? '...' : ''}`,
        },
      },
      {
        tag: 'hr',
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**错误详情**:\n\`\`\`json\n${JSON.stringify(errorDetails, null, 2).substring(0, 500)}\n\`\`\``,
        },
      },
    ];

    // 只有配置了日志查看器 URL 时才添加按钮
    if (logViewerUrl) {
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
            url: logViewerUrl,
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
            content: '🚨 Agent API 调用失败告警',
          },
          template: 'red', // 红色表示错误
        },
        elements,
      },
    };
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
  private buildBrandConfigUnavailableMessage(
    errorMessage: string,
    errorStack: string,
    isFirstLoad: boolean,
  ): any {
    const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const env = this.configService.get<string>('NODE_ENV', 'unknown');
    const apiBaseUrl = this.configService.get<string>('AGENT_API_BASE_URL', '未配置');

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
          content: `**错误信息**: ${errorMessage}\n**API 地址**: ${apiBaseUrl}/config/export`,
        },
      },
      {
        tag: 'hr',
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**影响**: ${isFirstLoad ? '⚠️ 服务启动但无法提供智能回复，所有用户消息将返回降级提示' : 'ℹ️ 使用旧缓存数据，服务可继续运行'}\n**建议操作**: \n1. 检查 Agent API 服务是否正常\n2. 验证 AGENT_API_KEY 是否正确\n3. 查看服务日志获取详细错误信息`,
        },
      },
    ];

    // 如果有错误堆栈，添加详细信息
    if (errorStack) {
      elements.push({
        tag: 'hr',
      });
      elements.push({
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**错误堆栈**: \n\`\`\`\n${errorStack.substring(0, 500)}${errorStack.length > 500 ? '\n...(省略)' : ''}\n\`\`\``,
        },
      });
    }

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
