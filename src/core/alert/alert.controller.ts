import { Controller, Post, Body, Logger } from '@nestjs/common';
import { FeiShuAlertService } from './feishu-alert.service';

/**
 * 告警测试控制器
 * 用于测试飞书告警功能
 */
@Controller('alert')
export class AlertController {
  private readonly logger = new Logger(AlertController.name);

  constructor(private readonly feiShuAlertService: FeiShuAlertService) {}

  /**
   * 测试接口：发送 Agent API 失败告警
   * @description 用于测试飞书告警功能，不触发实际的消息处理
   * @example POST /alert/test-agent-failure
   */
  @Post('test-agent-failure')
  async testAgentFailure(
    @Body()
    body?: {
      errorMessage?: string;
      statusCode?: number;
      conversationId?: string;
      userMessage?: string;
    },
  ) {
    this.logger.log('收到飞书告警测试请求:', body);

    const mockError = {
      message: body?.errorMessage || '模拟 Agent API 调用超时',
      response: {
        status: body?.statusCode || 504,
        data: {
          error: 'Gateway Timeout',
          message: '连接 Agent API 服务超时，请检查网络或服务状态',
          timestamp: new Date().toISOString(),
        },
      },
    };

    const conversationId = body?.conversationId || `test_chat_${Date.now()}`;
    const userMessage = body?.userMessage || '测试用户消息：你好，有什么岗位推荐吗？';

    try {
      await this.feiShuAlertService.sendAgentApiFailureAlert(
        mockError,
        conversationId,
        userMessage,
        '/api/v1/chat',
      );

      return {
        success: true,
        message: '飞书告警已发送',
        data: {
          conversationId,
          errorMessage: mockError.message,
          statusCode: mockError.response.status,
          userMessage,
        },
        note: '请检查飞书群聊是否收到告警消息',
      };
    } catch (error) {
      this.logger.error('发送飞书告警失败:', error);
      return {
        success: false,
        message: '飞书告警发送失败',
        error: error.message,
      };
    }
  }

  /**
   * 测试接口：发送通用告警
   * @description 测试通用告警消息，支持 info/warning/error 级别
   * @example POST /alert/test-generic
   */
  @Post('test-generic')
  async testGeneric(
    @Body()
    body?: {
      title?: string;
      message?: string;
      level?: 'info' | 'warning' | 'error';
    },
  ) {
    this.logger.log('收到通用告警测试请求:', body);

    const title = body?.title || '测试告警';
    const message = body?.message || '这是一条测试告警消息，用于验证飞书集成是否正常工作。';
    const level = body?.level || 'info';

    try {
      await this.feiShuAlertService.sendAlert(title, message, level);

      return {
        success: true,
        message: '飞书告警已发送',
        data: { title, message, level },
        note: '请检查飞书群聊是否收到告警消息',
      };
    } catch (error) {
      this.logger.error('发送飞书告警失败:', error);
      return {
        success: false,
        message: '飞书告警发送失败',
        error: error.message,
      };
    }
  }
}
