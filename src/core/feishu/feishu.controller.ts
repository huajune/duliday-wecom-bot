import { Controller, Post, Body, HttpCode, Logger } from '@nestjs/common';
import { FeishuAlertService } from './services/feishu-alert.service';
import { FeishuBookingService } from './services/feishu-booking.service';
// import { ChatRecordSyncService } from './services/feishu-chat-record.service'; // 暂时注释，避免循环依赖
import { InterviewBookingInfo } from './interfaces/feishu.interface';
import { AlertContext } from './services/feishu-alert.service';

/**
 * 飞书统一控制器
 * 提供测试接口，用于验证告警、通知和同步功能
 */
@Controller('feishu')
export class FeishuController {
  private readonly logger = new Logger(FeishuController.name);

  constructor(
    private readonly alertService: FeishuAlertService,
    private readonly bookingService: FeishuBookingService,
    // private readonly chatRecordSyncService: ChatRecordSyncService, // 暂时注释
  ) {}

  /**
   * 发送测试告警
   * POST /feishu/test/alert
   */
  @Post('test/alert')
  @HttpCode(200)
  async sendTestAlert(
    @Body() context: AlertContext,
  ): Promise<{ success: boolean; message: string }> {
    this.logger.log(`发送测试告警: ${context.errorType}`);

    const sent = await this.alertService.sendAlert(context);

    return {
      success: sent,
      message: sent ? '告警已发送到飞书' : '告警发送失败或被节流',
    };
  }

  /**
   * 发送测试预约通知
   * POST /feishu/test/booking
   */
  @Post('test/booking')
  @HttpCode(200)
  async sendTestBooking(
    @Body() bookingInfo: InterviewBookingInfo,
  ): Promise<{ success: boolean; message: string }> {
    this.logger.log(`发送测试预约通知: ${bookingInfo.candidateName}`);

    const sent = await this.bookingService.sendBookingNotification(bookingInfo);

    return {
      success: sent,
      message: sent ? '预约通知已发送到飞书' : '预约通知发送失败',
    };
  }

  // 同步功能暂时注释，避免循环依赖
  // /**
  //  * 触发手动同步
  //  * POST /feishu/sync/manual
  //  */
  // @Post('sync/manual')
  // @HttpCode(200)
  // async triggerManualSync(): Promise<{ success: boolean; message: string; count: number }> {
  //   this.logger.log('触发手动同步');
  //
  //   try {
  //     const result = await this.chatRecordSyncService.manualSync();
  //
  //     return {
  //       success: result.success,
  //       message: result.message,
  //       count: result.recordCount || 0,
  //     };
  //   } catch (error) {
  //     this.logger.error(`手动同步失败: ${error.message}`);
  //     return {
  //       success: false,
  //       message: `同步失败: ${error.message}`,
  //       count: 0,
  //     };
  //   }
  // }
  //
  // /**
  //  * 获取同步状态
  //  * GET /feishu/sync/status
  //  */
  // @Get('sync/status')
  // async getSyncStatus(): Promise<{
  //   lastSyncTime: Date | null;
  //   totalSynced: number;
  //   syncEnabled: boolean;
  // }> {
  //   return {
  //     lastSyncTime: null, // TODO: 实现状态跟踪
  //     totalSynced: 0,
  //     syncEnabled: true,
  //   };
  // }
}
