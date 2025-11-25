import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import {
  MessageHistoryService,
  EnhancedMessageHistoryItem,
} from '@wecom/message/services/message-history.service';
import { feishuBitableConfig } from './feishu-bitable.config';

interface FeishuTokenCache {
  token: string;
  expireAt: number;
}

interface FeishuRecordPayload {
  fields: Record<string, any>;
}

/**
 * 聊天记录同步服务
 * 每日 0 点将前一天的聊天记录从 Redis 同步到飞书多维表格
 */
@Injectable()
export class ChatRecordSyncService {
  private readonly logger = new Logger(ChatRecordSyncService.name);
  private readonly apiBase = 'https://open.feishu.cn/open-apis';
  private readonly http: AxiosInstance;
  private tokenCache?: FeishuTokenCache;

  constructor(
    private readonly messageHistoryService: MessageHistoryService,
    private readonly configService: ConfigService,
  ) {
    this.http = axios.create({ timeout: 10000 });
  }

  /**
   * 每日 0 点同步前一日的聊天记录
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async syncYesterdayChatRecords(): Promise<void> {
    this.logger.log('[ChatRecordSync] 开始同步前一日聊天记录到飞书多维表格...');

    // 加载飞书配置
    const { appId, appSecret, tables } = this.loadConfig();
    if (!appId || !appSecret || !tables.chat?.appToken || !tables.chat?.tableId) {
      this.logger.warn(
        '[ChatRecordSync] 未配置完整的飞书表格参数（appId/appSecret/appToken/tableId），跳过同步',
      );
      return;
    }

    try {
      // 获取昨天的时间范围
      const { start, end } = this.getYesterdayWindow();
      this.logger.log(
        `[ChatRecordSync] 时间范围: ${new Date(start).toISOString()} ~ ${new Date(end).toISOString()}`,
      );

      // 从 Redis 获取昨天的所有聊天记录
      const chatRecords = await this.messageHistoryService.getChatRecordsByTimeRange(start, end);

      if (chatRecords.length === 0) {
        this.logger.log('[ChatRecordSync] 前一日无聊天记录，跳过同步');
        return;
      }

      this.logger.log(`[ChatRecordSync] 找到 ${chatRecords.length} 个会话，开始转换数据...`);

      // 转换为飞书多维表格格式（按会话聚合）
      const feishuRecords = this.convertToFeishuRecords(chatRecords);

      if (feishuRecords.length === 0) {
        this.logger.log('[ChatRecordSync] 无有效数据，跳过同步');
        return;
      }

      this.logger.log(`[ChatRecordSync] 准备写入 ${feishuRecords.length} 条记录到飞书...`);

      // 批量写入飞书多维表格
      await this.pushInBatches(
        feishuRecords,
        tables.chat.appToken,
        tables.chat.tableId,
        appId,
        appSecret,
      );

      this.logger.log(`[ChatRecordSync] ✓ 同步完成，本次写入 ${feishuRecords.length} 条记录`);
    } catch (error: any) {
      this.logger.error(`[ChatRecordSync] ✗ 同步失败: ${error?.message ?? error}`, error?.stack);
    }
  }

  /**
   * 转换聊天记录为飞书多维表格格式
   * 每个会话生成一条记录，包含：候选人昵称、招募经理昵称、咨询时间、聊天记录
   */
  private convertToFeishuRecords(
    chatRecords: Array<{ chatId: string; messages: EnhancedMessageHistoryItem[] }>,
  ): FeishuRecordPayload[] {
    const records: FeishuRecordPayload[] = [];

    for (const { chatId: _chatId, messages } of chatRecords) {
      if (messages.length === 0) continue;

      // 提取候选人昵称和招募经理昵称（从消息元数据中获取）
      const candidateName = messages.find((m) => m.candidateName)?.candidateName || '未知候选人';
      const managerName = messages.find((m) => m.managerName)?.managerName || '未知招募经理';

      // 咨询时间：第一条消息的时间（飞书 DateTime 字段需要毫秒时间戳）
      const firstMessage = messages[0];
      const consultTimestamp = new Date(firstMessage.timestamp).getTime();

      // 聊天记录：所有消息的完整对话
      const chatLog = this.formatChatLog(messages);

      // 构造飞书记录

      records.push({
        fields: {
          候选人微信昵称: candidateName,
          招募经理姓名: managerName,
          咨询时间: consultTimestamp, // 飞书 DateTime 字段需要毫秒时间戳
          聊天记录: this.truncate(chatLog, 5000), // 飞书多维表格富文本字段限制
        },
      });
    }

    return records;
  }

  /**
   * 格式化聊天记录为文本格式
   * 示例：
   * [用户 张三] 你好，有什么岗位？
   * [机器人] 您好！我们目前有以下岗位...
   */
  private formatChatLog(messages: EnhancedMessageHistoryItem[]): string {
    return messages
      .map((msg) => {
        const time = new Date(msg.timestamp).toLocaleString('zh-CN', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
        const speaker = msg.role === 'user' ? '候选人' : '招募经理';
        return `[${time} ${speaker}] ${msg.content}`;
      })
      .join('\n\n');
  }

  /**
   * 批量写入飞书多维表格
   */
  private async pushInBatches(
    records: FeishuRecordPayload[],
    appToken: string,
    tableId: string,
    appId: string,
    appSecret: string,
    batchSize = 100, // 飞书 API 限制：单次最多 500 条，这里设置为 100 更安全
  ): Promise<void> {
    const token = await this.getTenantToken(appId, appSecret);

    for (let i = 0; i < records.length; i += batchSize) {
      const chunk = records.slice(i, i + batchSize);

      try {
        await this.http.post(
          `${this.apiBase}/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`,
          { records: chunk },
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );

        this.logger.log(`[ChatRecordSync] 已写入 ${i + chunk.length}/${records.length} 条`);
      } catch (error: any) {
        const errorData = error?.response?.data;
        this.logger.error(
          `[ChatRecordSync] 批次写入失败 (${i}-${i + chunk.length}): ${error?.message}`,
        );
        this.logger.error(
          `[ChatRecordSync] 飞书 API 错误详情: ${JSON.stringify(errorData, null, 2)}`,
        );
        this.logger.error(
          `[ChatRecordSync] 发送的数据: ${JSON.stringify(chunk[0]?.fields, null, 2)}`,
        );
        // 继续处理下一批次，不中断整个同步流程
      }
    }
  }

  /**
   * 获取飞书 tenant_access_token（带缓存）
   */
  private async getTenantToken(appId: string, appSecret: string): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expireAt > now + 60_000) {
      return this.tokenCache.token;
    }

    const resp = await this.http.post(`${this.apiBase}/auth/v3/tenant_access_token/internal`, {
      app_id: appId,
      app_secret: appSecret,
    });

    const { tenant_access_token, expire } = resp.data;
    this.tokenCache = {
      token: tenant_access_token,
      expireAt: now + (expire ? expire * 1000 : 90 * 60 * 1000),
    };

    return tenant_access_token;
  }

  /**
   * 加载飞书配置（代码配置优先，兼容环境变量）
   */
  private loadConfig() {
    const appId =
      feishuBitableConfig.appId && feishuBitableConfig.appId !== 'PLEASE_SET_APP_ID'
        ? feishuBitableConfig.appId
        : this.configService.get<string>('FEISHU_APP_ID') || '';

    const appSecret =
      feishuBitableConfig.appSecret && feishuBitableConfig.appSecret !== 'PLEASE_SET_APP_SECRET'
        ? feishuBitableConfig.appSecret
        : this.configService.get<string>('FEISHU_APP_SECRET') || '';

    const chatConfig = feishuBitableConfig.tables.chat;
    const appToken =
      chatConfig.appToken && chatConfig.appToken !== 'PLEASE_SET_APP_TOKEN'
        ? chatConfig.appToken
        : this.configService.get<string>('FEISHU_BTABLE_APP_TOKEN') || '';

    const tableId =
      chatConfig.tableId && chatConfig.tableId !== 'PLEASE_SET_TABLE_ID'
        ? chatConfig.tableId
        : this.configService.get<string>('FEISHU_BTABLE_TABLE_ID_CHAT') || '';

    return {
      appId,
      appSecret,
      tables: {
        chat: { appToken, tableId },
      },
    };
  }

  /**
   * 获取昨天的时间窗口
   * 返回昨天 00:00:00 ~ 今天 00:00:00 的时间戳
   */
  private getYesterdayWindow(): { start: number; end: number } {
    const end = new Date();
    end.setHours(0, 0, 0, 0); // 今天 00:00:00

    const start = new Date(end);
    start.setDate(start.getDate() - 1); // 昨天 00:00:00

    return { start: start.getTime(), end: end.getTime() };
  }

  /**
   * 截断文本到指定长度
   */
  private truncate(text: string, max = 5000): string {
    if (!text) return '';
    return text.length > max ? `${text.slice(0, max)}...(内容过长已截断)` : text;
  }

  /**
   * 手动触发同步（用于测试）
   */
  async manualSync(): Promise<{ success: boolean; message: string; recordCount?: number }> {
    try {
      await this.syncYesterdayChatRecords();
      return { success: true, message: '手动同步完成' };
    } catch (error: any) {
      return { success: false, message: `同步失败: ${error?.message}` };
    }
  }

  /**
   * 同步指定时间范围的数据（仅用于测试）
   */
  async syncByTimeRange(
    startTime: number,
    endTime: number,
  ): Promise<{
    success: boolean;
    message: string;
    recordCount?: number;
    error?: string;
  }> {
    this.logger.log('[ChatRecordSync] 开始同步指定时间范围的聊天记录到飞书多维表格...');

    const { appId, appSecret, tables } = this.loadConfig();
    if (!appId || !appSecret || !tables.chat?.appToken || !tables.chat?.tableId) {
      return {
        success: false,
        message: '未配置完整的飞书表格参数',
      };
    }

    try {
      this.logger.log(
        `[ChatRecordSync] 时间范围: ${new Date(startTime).toISOString()} ~ ${new Date(endTime).toISOString()}`,
      );

      const chatRecords = await this.messageHistoryService.getChatRecordsByTimeRange(
        startTime,
        endTime,
      );

      if (chatRecords.length === 0) {
        return {
          success: true,
          message: '指定时间范围内无聊天记录',
          recordCount: 0,
        };
      }

      this.logger.log(`[ChatRecordSync] 找到 ${chatRecords.length} 个会话，开始转换数据...`);

      const feishuRecords = this.convertToFeishuRecords(chatRecords);

      if (feishuRecords.length === 0) {
        return {
          success: true,
          message: '无有效数据',
          recordCount: 0,
        };
      }

      this.logger.log(`[ChatRecordSync] 准备写入 ${feishuRecords.length} 条记录到飞书...`);

      await this.pushInBatches(
        feishuRecords,
        tables.chat.appToken,
        tables.chat.tableId,
        appId,
        appSecret,
      );

      this.logger.log(`[ChatRecordSync] ✓ 同步完成，本次写入 ${feishuRecords.length} 条记录`);

      return {
        success: true,
        message: '同步完成',
        recordCount: feishuRecords.length,
      };
    } catch (error: any) {
      this.logger.error(`[ChatRecordSync] ✗ 同步失败: ${error?.message ?? error}`, error?.stack);
      return {
        success: false,
        message: `同步失败: ${error?.message}`,
        error: error?.stack,
      };
    }
  }
}
