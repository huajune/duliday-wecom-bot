import { Controller, Get, Post, HttpCode, Logger } from '@nestjs/common';
import { MonitoringService } from './monitoring.service';
import { DashboardData, MetricsData } from './interfaces/monitoring.interface';

/**
 * 监控控制器
 * 提供监控数据查询 API
 */
@Controller('monitoring')
export class MonitoringController {
  private readonly logger = new Logger(MonitoringController.name);

  constructor(private readonly monitoringService: MonitoringService) {}

  /**
   * 获取仪表盘数据
   * GET /monitoring/dashboard
   */
  @Get('dashboard')
  getDashboard(): DashboardData {
    this.logger.debug('获取仪表盘数据');
    return this.monitoringService.getDashboardData();
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
}
