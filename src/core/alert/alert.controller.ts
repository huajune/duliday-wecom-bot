import { Controller, Post, Body, HttpCode, Logger, Get, Inject, forwardRef } from '@nestjs/common';
import { AlertService, AlertContext, AlertLevel } from './alert.service';
import { MonitoringService } from '@core/monitoring/monitoring.service';

/**
 * 告警测试控制器
 * 仅用于开发/测试环境，用于验证告警系统是否正常工作
 */
@Controller('alert')
export class AlertController {
  private readonly logger = new Logger(AlertController.name);

  constructor(
    private readonly alertService: AlertService,
    @Inject(forwardRef(() => MonitoringService))
    private readonly monitoringService: MonitoringService,
  ) {}

  /**
   * 发送测试告警（完整参数）
   * POST /alert/test
   */
  @Post('test')
  @HttpCode(200)
  async sendTestAlert(
    @Body() context: AlertContext,
  ): Promise<{ success: boolean; message: string }> {
    this.logger.log(`发送测试告警: ${context.errorType}`);

    // 同时记录到监控系统
    const messageId = `test-alert-${Date.now()}`;
    this.monitoringService.recordMessageReceived(
      messageId,
      context.conversationId || 'test-chat',
      'test-user',
      '测试用户',
      context.userMessage,
      { scenario: context.scenario as any },
    );

    // 记录失败（这会添加到错误日志）
    this.monitoringService.recordFailure(
      messageId,
      typeof context.error === 'string' ? context.error : String(context.error),
      { scenario: context.scenario as any },
    );

    // 发送飞书告警
    const sent = await this.alertService.sendAlert(context);

    return {
      success: sent,
      message: sent ? '告警已发送到飞书' : '告警发送失败或被节流',
    };
  }

  /**
   * 发送简单测试告警
   * POST /alert/test/simple
   */
  @Post('test/simple')
  @HttpCode(200)
  async sendSimpleAlert(
    @Body() body: { title: string; message: string; level?: AlertLevel },
  ): Promise<{ success: boolean; message: string }> {
    this.logger.log(`发送简单测试告警: ${body.title}`);

    const sent = await this.alertService.sendSimpleAlert(
      body.title,
      body.message,
      body.level || 'error',
    );

    return {
      success: sent,
      message: sent ? '告警已发送到飞书' : '告警发送失败或被节流',
    };
  }

  /**
   * 模拟 Agent API 超时错误
   * POST /alert/test/agent-timeout
   */
  @Post('test/agent-timeout')
  @HttpCode(200)
  async testAgentTimeout(): Promise<{ success: boolean; message: string }> {
    this.logger.log('模拟 Agent API 超时错误');

    const context: AlertContext = {
      errorType: 'agent',
      error: 'ETIMEDOUT: Agent API 请求超时 (600000ms)',
      conversationId: `test-conv-${Date.now()}`,
      userMessage: '你好，我想了解一下职位信息',
      apiEndpoint: '/api/v1/chat',
      scenario: 'CANDIDATE_CONSULTATION',
    };

    return this.sendTestAlert(context);
  }

  /**
   * 模拟 Agent API 认证失败
   * POST /alert/test/auth-error
   */
  @Post('test/auth-error')
  @HttpCode(200)
  async testAuthError(): Promise<{ success: boolean; message: string }> {
    this.logger.log('模拟 Agent API 认证失败');

    const context: AlertContext = {
      errorType: 'agent',
      error: '401 Unauthorized: Invalid API key or token expired',
      conversationId: `test-conv-${Date.now()}`,
      apiEndpoint: '/api/v1/chat',
      scenario: 'CANDIDATE_CONSULTATION',
    };

    return this.sendTestAlert(context);
  }

  /**
   * 模拟 Agent API 限流
   * POST /alert/test/rate-limit
   */
  @Post('test/rate-limit')
  @HttpCode(200)
  async testRateLimit(): Promise<{ success: boolean; message: string }> {
    this.logger.log('模拟 Agent API 限流');

    const context: AlertContext = {
      errorType: 'agent',
      error: '429 Too Many Requests: Rate limit exceeded, please retry after 60 seconds',
      conversationId: `test-conv-${Date.now()}`,
      apiEndpoint: '/api/v1/chat',
      scenario: 'CANDIDATE_CONSULTATION',
    };

    return this.sendTestAlert(context);
  }

  /**
   * 模拟消息发送失败
   * POST /alert/test/delivery-error
   */
  @Post('test/delivery-error')
  @HttpCode(200)
  async testDeliveryError(): Promise<{ success: boolean; message: string }> {
    this.logger.log('模拟消息发送失败');

    const context: AlertContext = {
      errorType: 'delivery',
      error: '消息发送失败: 托管平台返回错误码 50001 - 用户已离开会话',
      conversationId: `test-conv-${Date.now()}`,
      fallbackMessage: '抱歉，我现在无法回复，请稍后再试',
      scenario: 'MESSAGE_DELIVERY',
    };

    return this.sendTestAlert(context);
  }

  /**
   * 模拟系统错误
   * POST /alert/test/system-error
   */
  @Post('test/system-error')
  @HttpCode(200)
  async testSystemError(): Promise<{ success: boolean; message: string }> {
    this.logger.log('模拟系统错误');

    const context: AlertContext = {
      errorType: 'system',
      error: 'Redis 连接失败: ECONNREFUSED 127.0.0.1:6379',
      scenario: 'MESSAGE_QUEUE',
      extra: {
        component: 'BullQueue',
        retryCount: 3,
      },
    };

    return this.sendTestAlert(context);
  }

  /**
   * 批量发送测试告警（用于测试节流功能）
   * POST /alert/test/batch
   */
  @Post('test/batch')
  @HttpCode(200)
  async testBatchAlerts(
    @Body() body: { count?: number; errorType?: string },
  ): Promise<{ sent: number; throttled: number; total: number }> {
    const count = body.count || 5;
    const errorType = body.errorType || 'agent';

    this.logger.log(`批量发送 ${count} 条测试告警，类型: ${errorType}`);

    let sent = 0;
    let throttled = 0;

    for (let i = 0; i < count; i++) {
      const context: AlertContext = {
        errorType,
        error: `测试错误 #${i + 1}: 模拟批量告警`,
        conversationId: `batch-test-${Date.now()}-${i}`,
      };

      const result = await this.alertService.sendAlert(context);
      if (result) {
        sent++;
      } else {
        throttled++;
      }

      // 短暂延迟，避免过快
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return {
      sent,
      throttled,
      total: count,
    };
  }

  /**
   * 获取告警服务状态
   * GET /alert/status
   */
  @Get('status')
  getStatus(): { enabled: boolean; message: string } {
    // 通过尝试发送一个静默检查来判断服务状态
    // 注意：这里我们无法直接访问 AlertService 的 enabled 属性
    // 所以返回一个提示信息
    return {
      enabled: true, // 假设已启用
      message: '告警服务状态需通过发送测试告警来验证',
    };
  }
}
