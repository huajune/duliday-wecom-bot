import { Injectable, Logger } from '@nestjs/common';
import { FeishuWebhookService } from './feishu-webhook.service';
import { InterviewBookingInfo } from '../interfaces/feishu.interface';
import { ALERT_RECEIVERS } from '../constants/feishu.constants';

/**
 * 飞书面试预约通知服务
 * 专门处理面试预约成功的通知
 */
@Injectable()
export class FeishuBookingService {
  private readonly logger = new Logger(FeishuBookingService.name);

  constructor(private readonly webhookService: FeishuWebhookService) {}

  /**
   * 发送面试预约成功通知
   * @param bookingInfo 预约信息
   * @returns 是否发送成功
   */
  async sendBookingNotification(bookingInfo: InterviewBookingInfo): Promise<boolean> {
    try {
      const time = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

      // 构建消息字段
      const fields: string[] = [`**通知时间**: ${time}`];

      if (bookingInfo.candidateName) {
        fields.push(`**候选人**: ${bookingInfo.candidateName}`);
      }
      if (bookingInfo.brandName) {
        fields.push(`**品牌**: ${bookingInfo.brandName}`);
      }
      if (bookingInfo.storeName) {
        fields.push(`**门店**: ${bookingInfo.storeName}`);
      }
      if (bookingInfo.interviewTime) {
        fields.push(`**面试时间**: ${bookingInfo.interviewTime}`);
      }
      if (bookingInfo.contactInfo) {
        fields.push(`**联系方式**: ${bookingInfo.contactInfo}`);
      }
      if (bookingInfo.chatId) {
        fields.push(`**会话 ID**: ${bookingInfo.chatId}`);
      }

      // 如果有工具输出，展示关键信息
      if (bookingInfo.toolOutput) {
        const output = bookingInfo.toolOutput;
        if (output.message) {
          fields.push(`**预约结果**: ${output.message}`);
        }
        if (output.booking_id) {
          fields.push(`**预约 ID**: ${output.booking_id}`);
        }
      }

      // 构建卡片（@ 琪琪）
      const card = this.webhookService.buildCard('🎉 面试预约成功', fields.join('\n'), 'green', [
        ...ALERT_RECEIVERS.INTERVIEW_BOOKING,
      ]);

      // 发送
      const success = await this.webhookService.sendMessage('INTERVIEW_BOOKING', card);

      if (success) {
        this.logger.log(
          `面试预约通知已发送: ${bookingInfo.candidateName || '未知候选人'} - ${bookingInfo.brandName || '未知品牌'}`,
        );
      } else {
        this.logger.warn(`面试预约通知发送失败`);
      }

      return success;
    } catch (error) {
      this.logger.error(`面试预约通知发送异常: ${error.message}`);
      return false;
    }
  }
}
