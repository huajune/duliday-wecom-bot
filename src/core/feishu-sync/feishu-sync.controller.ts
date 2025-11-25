import { Controller, Post, Get, Logger } from '@nestjs/common';
import { ChatRecordSyncService } from './chat-record-sync.service';

/**
 * 飞书同步控制器
 * 提供手动触发同步的接口
 */
@Controller('feishu-sync')
export class FeishuSyncController {
  private readonly logger = new Logger(FeishuSyncController.name);

  constructor(private readonly chatRecordSyncService: ChatRecordSyncService) {}

  /**
   * 手动触发聊天记录同步
   * @description 用于测试和手动触发昨天的聊天记录同步
   * @example POST /feishu-sync/chat-records/manual
   */
  @Post('chat-records/manual')
  async manualSyncChatRecords() {
    this.logger.log('[手动同步] 开始同步聊天记录...');
    const result = await this.chatRecordSyncService.manualSync();
    return {
      success: result.success,
      message: result.message,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 获取同步状态
   * @description 获取飞书同步服务的状态信息
   * @example GET /feishu-sync/status
   */
  @Get('status')
  getStatus() {
    return {
      success: true,
      services: [
        {
          name: 'ChatRecordSyncService',
          description: '从 Redis 聊天记录同步到飞书多维表格',
          schedule: '每日 00:00',
          enabled: true,
        },
        {
          name: 'FeishuBitableSyncService',
          description: '从监控快照同步到飞书多维表格（旧方式）',
          schedule: '每日 00:00',
          enabled: true,
        },
      ],
      note: '两个服务同时运行，ChatRecordSyncService 提供完整聊天记录，FeishuBitableSyncService 提供监控概览',
    };
  }
}
