import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosInstance } from 'axios';
import { HttpClientFactory } from '@core/http';
import { RedisService } from '@core/redis';

/**
 * 系统配置键
 */
export enum SystemConfigKey {
  AI_REPLY_ENABLED = 'ai_reply_enabled',
}

/**
 * 用户托管状态
 */
export interface UserHostingStatus {
  user_id: string;
  is_paused: boolean;
  paused_at: string | null;
  resumed_at: string | null;
  pause_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * Supabase 服务
 * 负责与 Supabase 数据库交互，管理系统配置和用户托管状态
 *
 * 设计原则：
 * 1. 使用 Redis 缓存减少数据库请求
 * 2. 内存缓存作为热数据第一层
 * 3. 考虑 Supabase 免费额度限制
 */
@Injectable()
export class SupabaseService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseService.name);

  // HTTP 客户端
  private supabaseHttpClient: AxiosInstance;

  // 缓存配置
  private readonly CACHE_PREFIX = 'supabase:';
  private readonly CONFIG_CACHE_TTL = 300; // 5分钟
  private readonly HOSTING_STATUS_CACHE_TTL = 60; // 1分钟

  // 内存缓存（热数据）
  private aiReplyEnabled: boolean | null = null;
  private pausedUsersCache = new Map<string, { isPaused: boolean; pausedAt: number }>();
  private pausedUsersCacheExpiry = 0;

  // 配置
  private supabaseUrl: string;
  private isInitialized = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpClientFactory: HttpClientFactory,
    private readonly redisService: RedisService,
  ) {
    this.initClient();
  }

  async onModuleInit() {
    // 预加载 AI 回复状态
    await this.loadAiReplyStatus();
    // 预加载暂停用户列表
    await this.loadPausedUsers();
    this.logger.log('✅ Supabase 服务初始化完成');
  }

  /**
   * 初始化 Supabase HTTP 客户端
   */
  private initClient(): void {
    this.supabaseUrl = this.configService.get<string>('NEXT_PUBLIC_SUPABASE_URL', '');
    const supabaseKey =
      this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY') ||
      this.configService.get<string>('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');

    if (!this.supabaseUrl || !supabaseKey) {
      this.logger.warn('⚠️ Supabase 配置缺失，系统配置持久化功能将使用内存模式');
      return;
    }

    this.supabaseHttpClient = this.httpClientFactory.createWithBearerAuth(
      {
        baseURL: `${this.supabaseUrl}/rest/v1`,
        timeout: 10000,
        logPrefix: '[Supabase DB]',
        verbose: false,
        headers: {
          apikey: supabaseKey,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
      },
      supabaseKey,
    );

    this.isInitialized = true;
    this.logger.log('✅ Supabase 数据库客户端已初始化');
  }

  // ==================== 系统配置 ====================

  /**
   * 获取 AI 回复开关状态
   * 优先级：内存缓存 -> Redis缓存 -> 数据库 -> 环境变量默认值
   */
  async getAiReplyEnabled(): Promise<boolean> {
    // 1. 内存缓存
    if (this.aiReplyEnabled !== null) {
      return this.aiReplyEnabled;
    }

    // 2. Redis 缓存
    const cacheKey = `${this.CACHE_PREFIX}config:ai_reply_enabled`;
    const cached = await this.redisService.get<boolean>(cacheKey);
    if (cached !== null) {
      this.aiReplyEnabled = cached;
      return cached;
    }

    // 3. 从数据库加载
    return this.loadAiReplyStatus();
  }

  /**
   * 从数据库加载 AI 回复状态
   */
  private async loadAiReplyStatus(): Promise<boolean> {
    const defaultValue = this.configService.get<string>('ENABLE_AI_REPLY', 'true') === 'true';

    if (!this.isInitialized) {
      this.aiReplyEnabled = defaultValue;
      return defaultValue;
    }

    try {
      const response = await this.supabaseHttpClient.get('/system_config', {
        params: {
          key: 'eq.ai_reply_enabled',
          select: 'value',
        },
      });

      if (response.data && response.data.length > 0) {
        const value = response.data[0].value;
        this.aiReplyEnabled = value === true || value === 'true';
      } else {
        // 数据库中没有记录，使用默认值并初始化
        this.aiReplyEnabled = defaultValue;
        await this.initAiReplyConfig(defaultValue);
      }

      // 更新 Redis 缓存
      const cacheKey = `${this.CACHE_PREFIX}config:ai_reply_enabled`;
      await this.redisService.setex(cacheKey, this.CONFIG_CACHE_TTL, this.aiReplyEnabled);

      this.logger.log(`AI 回复开关状态已加载: ${this.aiReplyEnabled}`);
      return this.aiReplyEnabled;
    } catch (error) {
      this.logger.error('加载 AI 回复状态失败，使用默认值', error);
      this.aiReplyEnabled = defaultValue;
      return defaultValue;
    }
  }

  /**
   * 初始化 AI 回复配置（首次运行时）
   */
  private async initAiReplyConfig(value: boolean): Promise<void> {
    if (!this.isInitialized) return;

    try {
      await this.supabaseHttpClient.post('/system_config', {
        key: 'ai_reply_enabled',
        value: value,
        description: 'AI 自动回复功能开关',
      });
      this.logger.log('AI 回复配置已初始化到数据库');
    } catch (error: any) {
      // 忽略重复键错误
      if (error.response?.status !== 409) {
        this.logger.error('初始化 AI 回复配置失败', error);
      }
    }
  }

  /**
   * 设置 AI 回复开关状态
   */
  async setAiReplyEnabled(enabled: boolean): Promise<boolean> {
    // 更新内存缓存
    this.aiReplyEnabled = enabled;

    // 更新 Redis 缓存
    const cacheKey = `${this.CACHE_PREFIX}config:ai_reply_enabled`;
    await this.redisService.setex(cacheKey, this.CONFIG_CACHE_TTL, enabled);

    // 更新数据库
    if (this.isInitialized) {
      try {
        await this.supabaseHttpClient.patch(
          '/system_config',
          { value: enabled },
          {
            params: { key: 'eq.ai_reply_enabled' },
          },
        );
        this.logger.log(`AI 回复开关已更新为: ${enabled}`);
      } catch (error) {
        this.logger.error('更新 AI 回复状态到数据库失败', error);
        // 即使数据库更新失败，内存和 Redis 缓存已更新，服务仍可正常工作
      }
    }

    return enabled;
  }

  // ==================== 用户托管状态 ====================

  /**
   * 检查用户是否被暂停托管
   * 使用内存缓存，每60秒刷新一次
   */
  async isUserPaused(userId: string): Promise<boolean> {
    // 检查缓存是否过期
    if (Date.now() > this.pausedUsersCacheExpiry) {
      await this.loadPausedUsers();
    }

    return this.pausedUsersCache.has(userId) && this.pausedUsersCache.get(userId)!.isPaused;
  }

  /**
   * 从数据库加载所有暂停的用户
   */
  private async loadPausedUsers(): Promise<void> {
    if (!this.isInitialized) {
      this.pausedUsersCacheExpiry = Date.now() + this.HOSTING_STATUS_CACHE_TTL * 1000;
      return;
    }

    try {
      const response = await this.supabaseHttpClient.get('/user_hosting_status', {
        params: {
          is_paused: 'eq.true',
          select: 'user_id,paused_at',
        },
      });

      // 清空并重新填充缓存
      this.pausedUsersCache.clear();

      if (response.data && Array.isArray(response.data)) {
        for (const user of response.data) {
          this.pausedUsersCache.set(user.user_id, {
            isPaused: true,
            pausedAt: new Date(user.paused_at).getTime(),
          });
        }
      }

      this.pausedUsersCacheExpiry = Date.now() + this.HOSTING_STATUS_CACHE_TTL * 1000;
      this.logger.debug(`已加载 ${this.pausedUsersCache.size} 个暂停托管的用户`);
    } catch (error) {
      this.logger.error('加载暂停用户列表失败', error);
      // 保持现有缓存，延长过期时间
      this.pausedUsersCacheExpiry = Date.now() + 30000; // 30秒后重试
    }
  }

  /**
   * 暂停用户托管
   */
  async pauseUser(userId: string): Promise<void> {
    const now = Date.now();

    // 更新内存缓存
    this.pausedUsersCache.set(userId, { isPaused: true, pausedAt: now });

    // 更新数据库
    if (this.isInitialized) {
      try {
        // 使用 upsert
        await this.supabaseHttpClient.post(
          '/user_hosting_status',
          {
            user_id: userId,
            is_paused: true,
            paused_at: new Date(now).toISOString(),
            pause_count: 1,
          },
          {
            headers: {
              Prefer: 'resolution=merge-duplicates',
            },
          },
        );

        // 如果是更新，增加暂停次数
        await this.supabaseHttpClient.patch(
          '/user_hosting_status',
          {
            is_paused: true,
            paused_at: new Date(now).toISOString(),
          },
          {
            params: { user_id: `eq.${userId}` },
            headers: {
              Prefer: 'return=minimal',
            },
          },
        );

        this.logger.log(`[托管暂停] 用户 ${userId} 已暂停托管`);
      } catch (error) {
        this.logger.error(`暂停用户 ${userId} 托管失败`, error);
      }
    }
  }

  /**
   * 恢复用户托管
   */
  async resumeUser(userId: string): Promise<void> {
    // 更新内存缓存
    this.pausedUsersCache.delete(userId);

    // 更新数据库
    if (this.isInitialized) {
      try {
        await this.supabaseHttpClient.patch(
          '/user_hosting_status',
          {
            is_paused: false,
            resumed_at: new Date().toISOString(),
          },
          {
            params: { user_id: `eq.${userId}` },
          },
        );

        this.logger.log(`[托管恢复] 用户 ${userId} 已恢复托管`);
      } catch (error) {
        this.logger.error(`恢复用户 ${userId} 托管失败`, error);
      }
    }
  }

  /**
   * 获取所有暂停托管的用户列表
   */
  async getPausedUsers(): Promise<{ userId: string; pausedAt: number }[]> {
    // 确保缓存是最新的
    if (Date.now() > this.pausedUsersCacheExpiry) {
      await this.loadPausedUsers();
    }

    return Array.from(this.pausedUsersCache.entries())
      .filter(([, status]) => status.isPaused)
      .map(([userId, status]) => ({
        userId,
        pausedAt: status.pausedAt,
      }));
  }

  /**
   * 获取用户托管状态
   */
  async getUserHostingStatus(userId: string): Promise<{ userId: string; isPaused: boolean }> {
    const isPaused = await this.isUserPaused(userId);
    return { userId, isPaused };
  }

  // ==================== 维护功能 ====================

  /**
   * 执行每日清理任务
   * 建议通过 cron job 每天调用一次
   */
  async runDailyCleanup(): Promise<{
    cleanedRecords: number;
    remainingRecords: number;
    usagePercent: number;
  }> {
    if (!this.isInitialized) {
      return { cleanedRecords: 0, remainingRecords: 0, usagePercent: 0 };
    }

    try {
      const response = await this.supabaseHttpClient.post('/rpc/daily_cleanup');

      if (response.data && response.data.length > 0) {
        const result = response.data[0];
        this.logger.log(
          `每日清理完成: 清理 ${result.cleaned_hosting_records} 条, 剩余 ${result.remaining_hosting_records} 条 (${result.storage_usage_percent}%)`,
        );
        return {
          cleanedRecords: result.cleaned_hosting_records,
          remainingRecords: result.remaining_hosting_records,
          usagePercent: result.storage_usage_percent,
        };
      }

      return { cleanedRecords: 0, remainingRecords: 0, usagePercent: 0 };
    } catch (error) {
      this.logger.error('执行每日清理失败', error);
      return { cleanedRecords: 0, remainingRecords: 0, usagePercent: 0 };
    }
  }

  /**
   * 刷新所有缓存
   */
  async refreshCache(): Promise<void> {
    this.aiReplyEnabled = null;
    this.pausedUsersCacheExpiry = 0;

    await this.loadAiReplyStatus();
    await this.loadPausedUsers();

    this.logger.log('所有缓存已刷新');
  }

  /**
   * 检查服务是否可用
   */
  isAvailable(): boolean {
    return this.isInitialized;
  }
}
