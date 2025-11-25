import { Controller, Post, Logger } from '@nestjs/common';
import { MessageHistoryService } from '@wecom/message/services/message-history.service';
import { ChatRecordSyncService } from './chat-record-sync.service';

/**
 * 飞书同步测试控制器
 * 仅用于开发测试
 */
@Controller('feishu-sync/test')
export class FeishuSyncTestController {
  private readonly logger = new Logger(FeishuSyncTestController.name);

  constructor(
    private readonly messageHistoryService: MessageHistoryService,
    private readonly chatRecordSyncService: ChatRecordSyncService,
  ) {}

  /**
   * 创建测试数据并触发同步
   */
  @Post('create-and-sync')
  async createTestDataAndSync() {
    this.logger.log('[测试] 开始创建测试数据...');

    // 创建昨天的时间戳（飞书同步查询昨天的数据）
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const _yesterdayTimestamp = yesterday.getTime();

    // 创建测试聊天记录
    const testChatId1 = 'test_feishu_chat_001';
    const testChatId2 = 'test_feishu_chat_002';

    // 会话1: 候选人 张三 与 招募经理李四 的对话
    await this.messageHistoryService.addMessageToHistory(
      testChatId1,
      'user',
      '你好，我想了解前端开发岗位',
      {
        messageId: 'test_msg_001',
        candidateName: '张三',
        managerName: '李四',
        orgId: 'test_org',
        botId: 'test_bot',
      },
    );

    // 手动设置时间戳为昨天（通过直接操作 Redis）
    // 注意：这是测试代码，生产环境不应该这样做

    await this.messageHistoryService.addMessageToHistory(
      testChatId1,
      'assistant',
      '您好！我们目前有以下前端开发岗位：\n1. 高级前端工程师 - React\n2. 前端开发实习生',
      {
        messageId: 'test_msg_002',
        candidateName: '张三',
        managerName: '李四',
        orgId: 'test_org',
        botId: 'test_bot',
      },
    );

    await this.messageHistoryService.addMessageToHistory(testChatId1, 'user', '薪资待遇如何？', {
      messageId: 'test_msg_003',
      candidateName: '张三',
      managerName: '李四',
      orgId: 'test_org',
      botId: 'test_bot',
    });

    // 会话2: 候选人 王五 的对话
    await this.messageHistoryService.addMessageToHistory(testChatId2, 'user', '有后端岗位吗？', {
      messageId: 'test_msg_004',
      candidateName: '王五',
      managerName: '赵六',
      orgId: 'test_org',
      botId: 'test_bot',
    });

    await this.messageHistoryService.addMessageToHistory(
      testChatId2,
      'assistant',
      '有的，我们有 Java 后端开发岗位',
      {
        messageId: 'test_msg_005',
        candidateName: '王五',
        managerName: '赵六',
        orgId: 'test_org',
        botId: 'test_bot',
      },
    );

    this.logger.log('[测试] 测试数据创建完成');

    // 验证数据
    const chat1 = await this.messageHistoryService.getHistoryDetail(testChatId1);
    const chat2 = await this.messageHistoryService.getHistoryDetail(testChatId2);

    this.logger.log(`[测试] 会话1: ${chat1?.messageCount} 条消息`);
    this.logger.log(`[测试] 会话2: ${chat2?.messageCount} 条消息`);

    // 由于数据是刚创建的（时间戳是现在），我们需要修改同步逻辑来测试今天的数据
    // 暂时返回测试数据信息，稍后手动触发同步时可以调整时间范围

    return {
      success: true,
      message: '测试数据创建完成',
      data: {
        chat1: {
          chatId: testChatId1,
          messageCount: chat1?.messageCount || 0,
          candidateName: '张三',
          managerName: '李四',
        },
        chat2: {
          chatId: testChatId2,
          messageCount: chat2?.messageCount || 0,
          candidateName: '王五',
          managerName: '赵六',
        },
        note: '数据已创建，但时间戳是今天。要测试同步，请调用 POST /feishu-sync/test/sync-today',
      },
    };
  }

  /**
   * 同步今天的数据（用于测试）
   */
  @Post('sync-today')
  async syncTodayData() {
    this.logger.log('[测试] 开始同步今天的数据...');

    // 获取今天的时间范围
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    this.logger.log(`[测试] 时间范围: ${start.toISOString()} ~ ${end.toISOString()}`);

    // 获取今天的所有聊天记录
    const chatRecords = await this.messageHistoryService.getChatRecordsByTimeRange(
      start.getTime(),
      end.getTime(),
    );

    this.logger.log(`[测试] 找到 ${chatRecords.length} 个会话`);

    if (chatRecords.length === 0) {
      return {
        success: false,
        message: '今天没有聊天记录',
      };
    }

    // 手动调用同步服务（使用指定时间范围）
    try {
      const result = await this.chatRecordSyncService.syncByTimeRange(
        start.getTime(),
        end.getTime(),
      );
      return {
        success: result.success,
        message: result.message,
        chatRecords: chatRecords.map((r) => ({
          chatId: r.chatId,
          messageCount: r.messages.length,
          candidateName: r.messages[0]?.candidateName,
          managerName: r.messages[0]?.managerName,
        })),
        syncResult: result,
      };
    } catch (error: any) {
      return {
        success: false,
        message: `同步失败: ${error?.message}`,
        error: error?.stack,
      };
    }
  }
}
