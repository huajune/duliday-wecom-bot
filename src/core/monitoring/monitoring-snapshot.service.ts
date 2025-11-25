import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '@core/redis';
import { MonitoringSnapshot } from './interfaces/monitoring.interface';

/**
 * 负责将监控数据持久化到 Redis
 *
 * 存储策略:
 * - 实时快照存储在 Redis，TTL 1 小时
 * - 每小时聚合数据同步到 Supabase（由 MonitoringPersistService 处理）
 *
 * 优点:
 * - 服务重启时快速恢复
 * - 多实例部署时数据共享
 * - 避免文件 I/O 性能问题
 */
@Injectable()
export class MonitoringSnapshotService {
  private readonly logger = new Logger(MonitoringSnapshotService.name);

  private readonly REDIS_KEY = 'monitoring:snapshot';
  private readonly SNAPSHOT_TTL_SECONDS = 3600; // 1 小时

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
   * 从 Redis 读取快照
   */
  async readSnapshot(): Promise<MonitoringSnapshot | null> {
    if (!this.enabled) {
      return null;
    }

    try {
      const snapshot = await this.redisService.get<MonitoringSnapshot>(this.REDIS_KEY);
      if (snapshot) {
        this.logger.log(
          `从 Redis 恢复监控快照, savedAt=${new Date(snapshot.savedAt).toISOString()}`,
        );
      }
      return snapshot;
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

  private async writeToRedis(snapshot: MonitoringSnapshot): Promise<void> {
    try {
      await this.redisService.setex(this.REDIS_KEY, this.SNAPSHOT_TTL_SECONDS, snapshot);
      this.logger.debug(`监控快照已写入 Redis, key=${this.REDIS_KEY}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`写入 Redis 监控快照失败: ${message}`);
    }
  }
}
