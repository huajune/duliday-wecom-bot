import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios, { AxiosInstance } from 'axios';
import { MonitoringSnapshotService } from '@core/monitoring/monitoring-snapshot.service';
import { MessageProcessingRecord } from '@core/monitoring/interfaces/monitoring.interface';
import { feishuBitableConfig } from '../constants/feishu-bitable.config';
import { ConfigService } from '@nestjs/config';

interface FeishuTokenCache {
  token: string;
  expireAt: number;
}

interface FeishuRecordPayload {
  fields: Record<string, any>;
}

/**
 * 每日将上一日聊天记录写入飞书多维表格（使用代码内配置为主）
 */
@Injectable()
export class FeishuBitableSyncService {
  private readonly logger = new Logger(FeishuBitableSyncService.name);
  private readonly apiBase = 'https://open.feishu.cn/open-apis';
  private readonly http: AxiosInstance;
  private tokenCache?: FeishuTokenCache;

  constructor(
    private readonly snapshotService: MonitoringSnapshotService,
    private readonly configService: ConfigService,
  ) {
    this.http = axios.create({ timeout: 5000 });
  }

  /**
   * 每日 0 点同步前一日数据
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async syncYesterday(): Promise<void> {
    const { appId, appSecret, tables } = this.loadConfig();
    if (!appId || !appSecret || !tables.chat?.appToken || !tables.chat?.tableId) {
      this.logger.warn(
        '[FeishuSync] 未配置完整的飞书表格参数（appId/appSecret/appToken/tableId），跳过同步',
      );
      return;
    }

    const snapshot = await this.snapshotService.readSnapshot();
    if (!snapshot) {
      this.logger.warn('[FeishuSync] 未找到监控快照，跳过同步');
      return;
    }

    const window = this.getYesterdayWindow();
    const rows = (snapshot.detailRecords || [])
      .filter((r) => r.receivedAt >= window.start && r.receivedAt < window.end)
      .map((r) => this.buildFeishuRecord(r))
      .filter((item): item is FeishuRecordPayload => !!item);

    if (rows.length === 0) {
      this.logger.log(
        `[FeishuSync] 前一日无可同步数据 (${new Date(window.start).toISOString()} ~ ${new Date(
          window.end,
        ).toISOString()})`,
      );
      return;
    }

    try {
      await this.pushInBatches(rows, tables.chat.appToken, tables.chat.tableId, appId, appSecret);
      this.logger.log(`[FeishuSync] 同步完成，本次写入 ${rows.length} 条`);
    } catch (error: any) {
      this.logger.error(`[FeishuSync] 同步失败: ${error?.message ?? error}`);
    }
  }

  private buildFeishuRecord(record: MessageProcessingRecord): FeishuRecordPayload | null {
    const userName = record.userName || record.userId;
    if (!userName) {
      return null;
    }

    const chatLogParts: string[] = [];
    if (record.messagePreview) chatLogParts.push(`[用户] ${record.messagePreview}`);
    if (record.replyPreview) chatLogParts.push(`[机器人] ${record.replyPreview}`);
    const chatLog = this.truncate(chatLogParts.join('\n'), 2000);

    return {
      fields: {
        候选人微信昵称: userName,
        招募经理姓名: record.managerName || '未知招募经理',
        咨询时间: new Date(record.receivedAt).toISOString(),
        聊天记录: chatLog || '[空消息]',
        message_id: record.messageId, // 隐藏列去重用（若表中存在）
      },
    };
  }

  private async pushInBatches(
    records: FeishuRecordPayload[],
    appToken: string,
    tableId: string,
    appId: string,
    appSecret: string,
    batchSize = 200,
  ): Promise<void> {
    const token = await this.getTenantToken(appId, appSecret);

    for (let i = 0; i < records.length; i += batchSize) {
      const chunk = records.slice(i, i + batchSize);
      await this.http.post(
        `${this.apiBase}/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`,
        { records: chunk },
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      this.logger.log(`[FeishuSync] 已写入 ${i + chunk.length}/${records.length}`);
    }
  }

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

  private loadConfig() {
    // 代码配置优先，其次兼容环境变量
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

  private truncate(text: string, max = 2000): string {
    if (!text) return '';
    return text.length > max ? `${text.slice(0, max)}...(truncated)` : text;
  }

  private getYesterdayWindow(): { start: number; end: number } {
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setDate(start.getDate() - 1);
    return { start: start.getTime(), end: end.getTime() };
  }
}
