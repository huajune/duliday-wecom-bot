import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '@core/redis';
import {
  MonitoringSnapshot,
  MessageProcessingRecord,
  HourlyStats,
  MonitoringErrorLog,
  MonitoringGlobalCounters,
} from './interfaces/monitoring.interface';

/**
 * 元数据结构（轻量级，不含大数据）
 * 注意：activeUsers/activeChats 只存数量，服务重启后从 detailRecords 重建完整列表
 */
interface MonitoringMeta {
  version: number;
  savedAt: number;
  globalCounters: MonitoringGlobalCounters;
  activeUsersCount: number; // 只存数量，完整列表从 detailRecords 重建
  activeChatsCount: number; // 只存数量，完整列表从 detailRecords 重建
  currentProcessing: number;
  peakProcessing: number;
}

/**
 * 负责将监控数据持久化到 Redis
 *
 * 存储策略（按数据类型分离）:
 * - monitoring:meta          → 元数据（计数器、活跃用户等）
 * - monitoring:hourly-stats  → 小时级聚合统计
 * - monitoring:error-logs    → 错误日志
 * - monitoring:records       → 详细消息记录（数据量最大）
 *
 * 优点:
 * - 服务重启时快速恢复
 * - 多实例部署时数据共享
 * - 分离存储便于单独清理某类数据
 * - 减少单次写入数据量
 */
@Injectable()
export class MonitoringSnapshotService {
  private readonly logger = new Logger(MonitoringSnapshotService.name);

  // Redis Keys
  private readonly KEY_META = 'monitoring:meta';
  private readonly KEY_HOURLY_STATS = 'monitoring:hourly-stats';
  private readonly KEY_ERROR_LOGS = 'monitoring:error-logs';
  private readonly KEY_RECORDS = 'monitoring:records';

  // 兼容旧版本的 key（用于迁移）
  private readonly KEY_LEGACY = 'monitoring:snapshot';

  private readonly SNAPSHOT_TTL_SECONDS = 86400 * 14; // 14 天

  private readonly enabled: boolean;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {
    const enabledConfig = this.configService.get<string>('MONITORING_SNAPSHOT_ENABLED');
    this.enabled = enabledConfig !== 'false';
  }

  /**
   * 从 Redis 读取完整快照（合并所有分离的数据）
   */
  async readSnapshot(): Promise<MonitoringSnapshot | null> {
    if (!this.enabled) {
      return null;
    }

    try {
      // 先尝试读取新格式
      const meta = await this.redisService.get<MonitoringMeta>(this.KEY_META);

      if (meta) {
        // 新格式：并行读取所有分离的数据
        const [hourlyStats, errorLogs, detailRecords] = await Promise.all([
          this.redisService.get<HourlyStats[]>(this.KEY_HOURLY_STATS),
          this.redisService.get<MonitoringErrorLog[]>(this.KEY_ERROR_LOGS),
          this.redisService.get<MessageProcessingRecord[]>(this.KEY_RECORDS),
        ]);

        const records = detailRecords || [];

        // 从 detailRecords 重建 activeUsers 和 activeChats
        const activeUsers = this.extractActiveUsers(records);
        const activeChats = this.extractActiveChats(records);

        const snapshot: MonitoringSnapshot = {
          version: meta.version,
          savedAt: meta.savedAt,
          detailRecords: records,
          hourlyStats: hourlyStats || [],
          errorLogs: errorLogs || [],
          globalCounters: meta.globalCounters,
          activeUsers,
          activeChats,
          currentProcessing: meta.currentProcessing,
          peakProcessing: meta.peakProcessing,
        };

        this.logger.log(
          `从 Redis 恢复监控快照（分离存储）, savedAt=${new Date(meta.savedAt).toISOString()}, ` +
            `records=${records.length}, activeUsers=${activeUsers.length}, activeChats=${activeChats.length}`,
        );

        return snapshot;
      }

      // 兼容旧格式：尝试读取旧的单一 key
      const legacySnapshot = await this.redisService.get<MonitoringSnapshot>(this.KEY_LEGACY);
      if (legacySnapshot) {
        this.logger.log(
          `从 Redis 恢复监控快照（旧格式）, savedAt=${new Date(legacySnapshot.savedAt).toISOString()}`,
        );
        // 删除旧格式数据，下次保存时会使用新格式
        await this.redisService.del(this.KEY_LEGACY);
        return legacySnapshot;
      }

      return null;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`读取 Redis 监控快照失败: ${message}`);
      return null;
    }
  }

  /**
   * 保存快照到 Redis（串行写入，避免竞争）
   */
  saveSnapshot(snapshot: MonitoringSnapshot): void {
    if (!this.enabled) {
      return;
    }

    this.writeQueue = this.writeQueue
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`监控快照写入队列异常: ${message}`);
      })
      .then(() => this.writeToRedis(snapshot));
  }

  /**
   * 清空所有监控数据
   */
  async clearAll(): Promise<void> {
    try {
      await Promise.all([
        this.redisService.del(this.KEY_META),
        this.redisService.del(this.KEY_HOURLY_STATS),
        this.redisService.del(this.KEY_ERROR_LOGS),
        this.redisService.del(this.KEY_RECORDS),
        this.redisService.del(this.KEY_LEGACY),
      ]);
      this.logger.log('已清空所有监控 Redis 数据');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`清空监控数据失败: ${message}`);
    }
  }

  /**
   * 仅清空详细记录（保留统计数据）
   */
  async clearRecords(): Promise<void> {
    try {
      await this.redisService.del(this.KEY_RECORDS);
      this.logger.log('已清空监控详细记录');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`清空详细记录失败: ${message}`);
    }
  }

  /**
   * 分离写入各类数据到 Redis
   */
  private async writeToRedis(snapshot: MonitoringSnapshot): Promise<void> {
    try {
      // 构建元数据
      const meta: MonitoringMeta = {
        version: snapshot.version,
        savedAt: snapshot.savedAt,
        globalCounters: snapshot.globalCounters,
        activeUsersCount: snapshot.activeUsers.length,
        activeChatsCount: snapshot.activeChats.length,
        currentProcessing: snapshot.currentProcessing,
        peakProcessing: snapshot.peakProcessing,
      };

      // 并行写入所有数据
      await Promise.all([
        this.redisService.setex(this.KEY_META, this.SNAPSHOT_TTL_SECONDS, meta),
        this.redisService.setex(
          this.KEY_HOURLY_STATS,
          this.SNAPSHOT_TTL_SECONDS,
          snapshot.hourlyStats,
        ),
        this.redisService.setex(this.KEY_ERROR_LOGS, this.SNAPSHOT_TTL_SECONDS, snapshot.errorLogs),
        this.redisService.setex(
          this.KEY_RECORDS,
          this.SNAPSHOT_TTL_SECONDS,
          snapshot.detailRecords,
        ),
      ]);

      this.logger.debug(
        `监控快照已写入 Redis（分离存储）, records=${snapshot.detailRecords.length}`,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`写入 Redis 监控快照失败: ${message}`);
    }
  }

  /**
   * 从 detailRecords 提取去重的活跃用户列表
   */
  private extractActiveUsers(records: MessageProcessingRecord[]): string[] {
    const userSet = new Set<string>();
    for (const record of records) {
      if (record.userId) {
        userSet.add(record.userId);
      }
    }
    return Array.from(userSet);
  }

  /**
   * 从 detailRecords 提取去重的活跃会话列表
   */
  private extractActiveChats(records: MessageProcessingRecord[]): string[] {
    const chatSet = new Set<string>();
    for (const record of records) {
      if (record.chatId) {
        chatSet.add(record.chatId);
      }
    }
    return Array.from(chatSet);
  }
}
