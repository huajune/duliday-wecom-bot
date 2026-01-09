import { Injectable } from '@nestjs/common';
import { BaseRepository } from './base.repository';
import { SupabaseService } from '../supabase.service';

/**
 * 小组黑名单项
 */
export interface GroupBlacklistItem {
  groupId: string;
  reason?: string;
  addedAt: number;
}

/**
 * 小组黑名单 Repository
 *
 * 负责管理群组黑名单功能：
 * - 黑名单群组不触发 AI 回复，但记录聊天历史
 * - 数据存储在 system_config 表的 group_blacklist 键中
 */
@Injectable()
export class GroupBlacklistRepository extends BaseRepository {
  protected readonly tableName = 'system_config';

  // 缓存配置
  private readonly GROUP_BLACKLIST_CACHE_TTL = 300; // 5分钟

  // 内存缓存
  private groupBlacklistCache = new Map<string, GroupBlacklistItem>();
  private groupBlacklistCacheExpiry = 0;

  constructor(supabaseService: SupabaseService) {
    super(supabaseService);
  }

  // ==================== 黑名单操作 ====================

  /**
   * 检查小组是否在黑名单中
   */
  async isGroupBlacklisted(groupId: string): Promise<boolean> {
    if (!groupId) return false;

    // 检查缓存是否过期
    if (Date.now() > this.groupBlacklistCacheExpiry) {
      await this.loadGroupBlacklist();
    }

    return this.groupBlacklistCache.has(groupId);
  }

  /**
   * 添加小组到黑名单
   */
  async addGroupToBlacklist(groupId: string, reason?: string): Promise<void> {
    const item: GroupBlacklistItem = {
      groupId,
      reason,
      addedAt: Date.now(),
    };

    // 更新内存缓存
    this.groupBlacklistCache.set(groupId, item);

    // 保存到数据库和 Redis
    await this.saveGroupBlacklist();

    this.logger.log(`[小组黑名单] 已添加小组 ${groupId}${reason ? ` (原因: ${reason})` : ''}`);
  }

  /**
   * 从黑名单移除小组
   */
  async removeGroupFromBlacklist(groupId: string): Promise<boolean> {
    if (!this.groupBlacklistCache.has(groupId)) {
      return false;
    }

    // 更新内存缓存
    this.groupBlacklistCache.delete(groupId);

    // 保存到数据库和 Redis
    await this.saveGroupBlacklist();

    this.logger.log(`[小组黑名单] 已移除小组 ${groupId}`);
    return true;
  }

  /**
   * 获取黑名单列表
   */
  async getGroupBlacklist(): Promise<GroupBlacklistItem[]> {
    // 确保缓存是最新的
    if (Date.now() > this.groupBlacklistCacheExpiry) {
      await this.loadGroupBlacklist();
    }

    return Array.from(this.groupBlacklistCache.values());
  }

  // ==================== 缓存管理 ====================

  /**
   * 从数据库/Redis 加载小组黑名单
   */
  async loadGroupBlacklist(): Promise<void> {
    // 1. 先尝试从 Redis 加载
    const cacheKey = `${this.supabaseService.getCachePrefix()}config:group_blacklist`;
    const redis = this.supabaseService.getRedisService();
    const cached = await redis.get<GroupBlacklistItem[]>(cacheKey);

    if (cached && Array.isArray(cached)) {
      this.groupBlacklistCache.clear();
      for (const item of cached) {
        this.groupBlacklistCache.set(item.groupId, item);
      }
      this.groupBlacklistCacheExpiry = Date.now() + this.GROUP_BLACKLIST_CACHE_TTL * 1000;
      this.logger.debug(`已从 Redis 加载 ${this.groupBlacklistCache.size} 个黑名单小组`);
      return;
    }

    // 2. 从数据库加载
    if (!this.isAvailable()) {
      this.groupBlacklistCacheExpiry = Date.now() + this.GROUP_BLACKLIST_CACHE_TTL * 1000;
      return;
    }

    try {
      const result = await this.selectOne<{ value: GroupBlacklistItem[] }>({
        key: 'eq.group_blacklist',
        select: 'value',
      });

      this.groupBlacklistCache.clear();

      if (result && Array.isArray(result.value)) {
        for (const item of result.value) {
          this.groupBlacklistCache.set(item.groupId, item);
        }
      }

      // 更新 Redis 缓存
      const blacklistArray = Array.from(this.groupBlacklistCache.values());
      await redis.setex(cacheKey, this.GROUP_BLACKLIST_CACHE_TTL, blacklistArray);

      this.groupBlacklistCacheExpiry = Date.now() + this.GROUP_BLACKLIST_CACHE_TTL * 1000;
      this.logger.log(`已加载 ${this.groupBlacklistCache.size} 个黑名单小组`);
    } catch (error) {
      this.logger.error('加载小组黑名单失败', error);
      this.groupBlacklistCacheExpiry = Date.now() + 30000; // 30秒后重试
    }
  }

  /**
   * 刷新缓存
   */
  async refreshCache(): Promise<void> {
    this.groupBlacklistCacheExpiry = 0;
    await this.loadGroupBlacklist();
    this.logger.log('小组黑名单缓存已刷新');
  }

  // ==================== 私有方法 ====================

  /**
   * 保存小组黑名单到数据库和 Redis
   */
  private async saveGroupBlacklist(): Promise<void> {
    const blacklistArray = Array.from(this.groupBlacklistCache.values());

    // 更新 Redis 缓存
    const cacheKey = `${this.supabaseService.getCachePrefix()}config:group_blacklist`;
    const redis = this.supabaseService.getRedisService();
    await redis.setex(cacheKey, this.GROUP_BLACKLIST_CACHE_TTL, blacklistArray);

    // 更新数据库
    if (this.isAvailable()) {
      try {
        // 先尝试更新
        const updated = await this.update({ key: 'eq.group_blacklist' }, { value: blacklistArray });

        // 如果没有更新到任何记录，则插入
        if (!updated || updated.length === 0) {
          await this.insert({
            key: 'group_blacklist',
            value: blacklistArray,
            description: '小组黑名单（不触发AI回复但记录历史）',
          });
        }
      } catch (error) {
        this.logger.error('保存小组黑名单到数据库失败', error);
      }
    }
  }
}
