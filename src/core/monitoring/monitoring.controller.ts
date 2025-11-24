import {
  Controller,
  Get,
  Post,
  HttpCode,
  Logger,
  Body,
  Inject,
  forwardRef,
  Query,
  Param,
} from '@nestjs/common';
import { MonitoringService } from './monitoring.service';
import { DashboardData, MetricsData, TimeRange } from './interfaces/monitoring.interface';
import { MessageService } from '@wecom/message/message.service';
import { MessageFilterService } from '@wecom/message/services/message-filter.service';

/**
 * 监控控制器
 * 提供监控数据查询 API
 */
@Controller('monitoring')
export class MonitoringController {
  private readonly logger = new Logger(MonitoringController.name);

  constructor(
    private readonly monitoringService: MonitoringService,
    @Inject(forwardRef(() => MessageService))
    private readonly messageService: MessageService,
    @Inject(forwardRef(() => MessageFilterService))
    private readonly filterService: MessageFilterService,
  ) {}

  /**
   * 获取仪表盘数据
   * GET /monitoring/dashboard?range=today|week|month
   */
  @Get('dashboard')
  getDashboard(@Query('range') range?: TimeRange): DashboardData {
    const timeRange = range || 'today';
    this.logger.debug(`获取仪表盘数据 [range=${timeRange}]`);
    return this.monitoringService.getDashboardData(timeRange);
  }

  /**
   * 获取详细指标数据
   * GET /monitoring/metrics
   */
  @Get('metrics')
  getMetrics(): MetricsData {
    this.logger.debug('获取详细指标数据');
    return this.monitoringService.getMetricsData();
  }

  /**
   * 清空所有监控数据
   * POST /monitoring/clear
   */
  @Post('clear')
  @HttpCode(200)
  clearData(): { message: string } {
    this.logger.log('清空监控数据');
    this.monitoringService.clearAllData();
    return { message: '监控数据已清空' };
  }

  /**
   * 健康检查
   * GET /monitoring/health
   */
  @Get('health')
  health(): { status: string; timestamp: number } {
    return {
      status: 'ok',
      timestamp: Date.now(),
    };
  }

  /**
   * 获取 AI 回复开关状态
   * GET /monitoring/ai-reply-status
   */
  @Get('ai-reply-status')
  getAiReplyStatus(): { enabled: boolean } {
    this.logger.debug('获取 AI 回复开关状态');
    return {
      enabled: this.messageService.getAiReplyStatus(),
    };
  }

  /**
   * 切换 AI 回复开关
   * POST /monitoring/toggle-ai-reply
   */
  @Post('toggle-ai-reply')
  @HttpCode(200)
  async toggleAiReply(
    @Body('enabled') enabled: boolean,
  ): Promise<{ enabled: boolean; message: string }> {
    this.logger.log(`切换 AI 回复开关: ${enabled}`);
    const newStatus = await this.messageService.toggleAiReply(enabled);
    return {
      enabled: newStatus,
      message: `AI 自动回复功能已${newStatus ? '启用' : '禁用'}（已持久化）`,
    };
  }

  /**
   * 暂停用户托管
   * POST /monitoring/users/:userId/pause
   */
  @Post('users/:userId/pause')
  @HttpCode(200)
  async pauseUserHosting(@Param('userId') userId: string): Promise<{
    userId: string;
    isPaused: boolean;
    message: string;
  }> {
    this.logger.log(`暂停用户托管: ${userId}`);
    await this.filterService.pauseUser(userId);
    return {
      userId,
      isPaused: true,
      message: `用户 ${userId} 的托管已暂停（已持久化）`,
    };
  }

  /**
   * 恢复用户托管
   * POST /monitoring/users/:userId/resume
   */
  @Post('users/:userId/resume')
  @HttpCode(200)
  async resumeUserHosting(@Param('userId') userId: string): Promise<{
    userId: string;
    isPaused: boolean;
    message: string;
  }> {
    this.logger.log(`恢复用户托管: ${userId}`);
    await this.filterService.resumeUser(userId);
    return {
      userId,
      isPaused: false,
      message: `用户 ${userId} 的托管已恢复（已持久化）`,
    };
  }

  /**
   * 获取暂停托管的用户列表
   * GET /monitoring/users/paused
   */
  @Get('users/paused')
  async getPausedUsers(): Promise<{ users: { userId: string; pausedAt: number }[] }> {
    this.logger.debug('获取暂停托管用户列表');
    return {
      users: await this.filterService.getPausedUsers(),
    };
  }

  /**
   * 检查用户是否被暂停托管
   * GET /monitoring/users/:userId/status
   */
  @Get('users/:userId/status')
  async getUserHostingStatus(
    @Param('userId') userId: string,
  ): Promise<{ userId: string; isPaused: boolean }> {
    return {
      userId,
      isPaused: await this.filterService.isUserPaused(userId),
    };
  }

  /**
   * 生成测试数据（仅用于开发/演示）
   * POST /monitoring/generate-test-data
   */
  @Post('generate-test-data')
  @HttpCode(200)
  generateTestData(@Body('days') days?: number): { message: string; recordsGenerated: number } {
    const targetDays = days || 7;
    this.logger.log(`生成 ${targetDays} 天的测试数据`);
    const count = this.monitoringService.generateTestData(targetDays);
    return {
      message: `已生成 ${targetDays} 天的测试数据`,
      recordsGenerated: count,
    };
  }
}
