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
} from '@nestjs/common';
import { MonitoringService } from './monitoring.service';
import { DashboardData, MetricsData, TimeRange } from './interfaces/monitoring.interface';
import { MessageService } from '@wecom/message/message.service';

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
  toggleAiReply(@Body('enabled') enabled: boolean): { enabled: boolean; message: string } {
    this.logger.log(`切换 AI 回复开关: ${enabled}`);
    const newStatus = this.messageService.toggleAiReply(enabled);
    return {
      enabled: newStatus,
      message: `AI 自动回复功能已${newStatus ? '启用' : '禁用'}`,
    };
  }
}
