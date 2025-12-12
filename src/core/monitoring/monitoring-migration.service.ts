import { Injectable, Logger } from '@nestjs/common';
import { MonitoringDatabaseService } from './monitoring-database.service';
import { MonitoringCacheService } from './monitoring-cache.service';

/**
 * 监控数据迁移服务
 *
 * ⚠️  已废弃：快照系统已移除，迁移服务暂时保留为空实现
 *
 * 旧逻辑（已移除）：
 * 1. 从 Redis 读取快照数据
 * 2. 批量写入 Supabase（详细记录、小时统计、错误日志）
 * 3. 批量写入 Redis（全局计数器、活跃用户/会话、并发数）
 * 4. 清空旧快照数据
 *
 * 新架构：
 * - 数据直接写入 Supabase + Redis
 * - 不再需要快照和迁移
 */
@Injectable()
export class MonitoringMigrationService {
  private readonly logger = new Logger(MonitoringMigrationService.name);

  constructor(
    private readonly databaseService: MonitoringDatabaseService,
    private readonly cacheService: MonitoringCacheService,
  ) {}

  /**
   * 执行数据迁移（已废弃，返回空结果）
   */
  async migrateSnapshotToNewArchitecture(): Promise<{
    success: boolean;
    recordsMigrated: number;
    hourlyStatsMigrated: number;
    errorLogsMigrated: number;
  }> {
    this.logger.warn('⚠️  迁移服务已废弃（快照系统已移除），跳过迁移');
    return {
      success: true,
      recordsMigrated: 0,
      hourlyStatsMigrated: 0,
      errorLogsMigrated: 0,
    };
  }
}
