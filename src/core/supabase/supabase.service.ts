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
  GROUP_BLACKLIST = 'group_blacklist',
  AGENT_REPLY_CONFIG = 'agent_reply_config',
  SYSTEM_CONFIG = 'system_config',
}

/**
 * 系统配置接口
 */
export interface SystemConfig {
  workerConcurrency?: number; // Worker 并发数 (1-20)
}

/**
 * Agent 回复策略配置
 */
export interface AgentReplyConfig {
  // 消息聚合配置
  initialMergeWindowMs: number; // 首次聚合等待时间（毫秒）
  maxMergedMessages: number; // 最多聚合消息数

  // 打字延迟配置
  typingDelayPerCharMs: number; // 每字符延迟（毫秒）
  paragraphGapMs: number; // 段落间隔（毫秒）

  // 告警节流配置
  alertThrottleWindowMs: number; // 告警节流窗口（毫秒）
  alertThrottleMaxCount: number; // 窗口内最大告警次数

  // 业务指标告警开关
  businessAlertEnabled: boolean; // 是否启用业务指标告警
  minSamplesForAlert: number; // 最小样本量（低于此值不检查）
  alertIntervalMinutes: number; // 同类告警最小间隔（分钟）
}

/**
 * Agent 回复策略配置默认值
 */
export const DEFAULT_AGENT_REPLY_CONFIG: AgentReplyConfig = {
  initialMergeWindowMs: 1000,
  maxMergedMessages: 3,
  typingDelayPerCharMs: 100,
  paragraphGapMs: 2000,
  alertThrottleWindowMs: 5 * 60 * 1000, // 5 分钟
  alertThrottleMaxCount: 3,
  businessAlertEnabled: true, // 默认启用
  minSamplesForAlert: 10, // 至少 10 条消息才检查
  alertIntervalMinutes: 30, // 同类告警间隔 30 分钟
};

/**
 * 小组黑名单项
 */
export interface GroupBlacklistItem {
  groupId: string;
  reason?: string;
  addedAt: number;
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

  // 小组黑名单缓存
  private groupBlacklistCache = new Map<string, GroupBlacklistItem>();
  private groupBlacklistCacheExpiry = 0;
  private readonly GROUP_BLACKLIST_CACHE_TTL = 300; // 5分钟

  // Agent 回复策略配置缓存
  private agentReplyConfig: AgentReplyConfig | null = null;
  private agentReplyConfigExpiry = 0;
  private readonly AGENT_REPLY_CONFIG_CACHE_TTL = 60; // 1分钟（允许快速生效）

  // 配置变更回调列表
  private readonly configChangeCallbacks: Array<(config: AgentReplyConfig) => void> = [];

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
    // 预加载小组黑名单
    await this.loadGroupBlacklist();
    // 预加载 Agent 回复策略配置
    await this.loadAgentReplyConfig();
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
    this.groupBlacklistCacheExpiry = 0;
    this.agentReplyConfigExpiry = 0;

    await this.loadAiReplyStatus();
    await this.loadPausedUsers();
    await this.loadGroupBlacklist();
    await this.loadAgentReplyConfig();

    this.logger.log('所有缓存已刷新');
  }

  /**
   * 检查服务是否可用
   */
  isAvailable(): boolean {
    return this.isInitialized;
  }

  // ==================== 小组黑名单 ====================

  /**
   * 从数据库/Redis加载小组黑名单
   */
  private async loadGroupBlacklist(): Promise<void> {
    // 1. 先尝试从 Redis 加载
    const cacheKey = `${this.CACHE_PREFIX}config:group_blacklist`;
    const cached = await this.redisService.get<GroupBlacklistItem[]>(cacheKey);

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
    if (!this.isInitialized) {
      this.groupBlacklistCacheExpiry = Date.now() + this.GROUP_BLACKLIST_CACHE_TTL * 1000;
      return;
    }

    try {
      const response = await this.supabaseHttpClient.get('/system_config', {
        params: {
          key: 'eq.group_blacklist',
          select: 'value',
        },
      });

      this.groupBlacklistCache.clear();

      if (response.data && response.data.length > 0) {
        const blacklist = response.data[0].value;
        if (Array.isArray(blacklist)) {
          for (const item of blacklist) {
            this.groupBlacklistCache.set(item.groupId, item);
          }
        }
      }

      // 更新 Redis 缓存
      const blacklistArray = Array.from(this.groupBlacklistCache.values());
      await this.redisService.setex(cacheKey, this.GROUP_BLACKLIST_CACHE_TTL, blacklistArray);

      this.groupBlacklistCacheExpiry = Date.now() + this.GROUP_BLACKLIST_CACHE_TTL * 1000;
      this.logger.log(`已加载 ${this.groupBlacklistCache.size} 个黑名单小组`);
    } catch (error) {
      this.logger.error('加载小组黑名单失败', error);
      this.groupBlacklistCacheExpiry = Date.now() + 30000; // 30秒后重试
    }
  }

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

  /**
   * 保存小组黑名单到数据库和 Redis
   */
  private async saveGroupBlacklist(): Promise<void> {
    const blacklistArray = Array.from(this.groupBlacklistCache.values());

    // 更新 Redis 缓存
    const cacheKey = `${this.CACHE_PREFIX}config:group_blacklist`;
    await this.redisService.setex(cacheKey, this.GROUP_BLACKLIST_CACHE_TTL, blacklistArray);

    // 更新数据库
    if (this.isInitialized) {
      try {
        // 先尝试更新
        const updateResponse = await this.supabaseHttpClient.patch(
          '/system_config',
          { value: blacklistArray },
          {
            params: { key: 'eq.group_blacklist' },
          },
        );

        // 如果没有更新到任何记录，则插入
        if (!updateResponse.data || updateResponse.data.length === 0) {
          await this.supabaseHttpClient.post('/system_config', {
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

  // ==================== Agent 回复策略配置 ====================

  /**
   * 从数据库加载 Agent 回复策略配置
   */
  private async loadAgentReplyConfig(): Promise<AgentReplyConfig> {
    // 1. 先尝试从 Redis 加载
    const cacheKey = `${this.CACHE_PREFIX}config:agent_reply_config`;
    const cached = await this.redisService.get<AgentReplyConfig>(cacheKey);

    if (cached) {
      this.agentReplyConfig = { ...DEFAULT_AGENT_REPLY_CONFIG, ...cached };
      this.agentReplyConfigExpiry = Date.now() + this.AGENT_REPLY_CONFIG_CACHE_TTL * 1000;
      this.logger.debug('已从 Redis 加载 Agent 回复策略配置');
      return this.agentReplyConfig;
    }

    // 2. 从数据库加载
    if (!this.isInitialized) {
      this.agentReplyConfig = { ...DEFAULT_AGENT_REPLY_CONFIG };
      this.agentReplyConfigExpiry = Date.now() + this.AGENT_REPLY_CONFIG_CACHE_TTL * 1000;
      return this.agentReplyConfig;
    }

    try {
      const response = await this.supabaseHttpClient.get('/system_config', {
        params: {
          key: 'eq.agent_reply_config',
          select: 'value',
        },
      });

      if (response.data && response.data.length > 0) {
        const dbConfig = response.data[0].value;
        this.agentReplyConfig = { ...DEFAULT_AGENT_REPLY_CONFIG, ...dbConfig };
      } else {
        // 数据库中没有记录，使用默认值并初始化
        this.agentReplyConfig = { ...DEFAULT_AGENT_REPLY_CONFIG };
        await this.initAgentReplyConfig();
      }

      // 更新 Redis 缓存
      await this.redisService.setex(
        cacheKey,
        this.AGENT_REPLY_CONFIG_CACHE_TTL,
        this.agentReplyConfig,
      );

      this.agentReplyConfigExpiry = Date.now() + this.AGENT_REPLY_CONFIG_CACHE_TTL * 1000;
      this.logger.log('Agent 回复策略配置已加载');
      return this.agentReplyConfig;
    } catch (error) {
      this.logger.error('加载 Agent 回复策略配置失败，使用默认值', error);
      this.agentReplyConfig = { ...DEFAULT_AGENT_REPLY_CONFIG };
      this.agentReplyConfigExpiry = Date.now() + 30000; // 30秒后重试
      return this.agentReplyConfig;
    }
  }

  /**
   * 初始化 Agent 回复策略配置（首次运行时）
   */
  private async initAgentReplyConfig(): Promise<void> {
    if (!this.isInitialized) return;

    try {
      await this.supabaseHttpClient.post('/system_config', {
        key: 'agent_reply_config',
        value: DEFAULT_AGENT_REPLY_CONFIG,
        description: 'Agent 回复策略配置（消息聚合、打字延迟、告警节流）',
      });
      this.logger.log('Agent 回复策略配置已初始化到数据库');
    } catch (error: any) {
      // 忽略重复键错误
      if (error.response?.status !== 409) {
        this.logger.error('初始化 Agent 回复策略配置失败', error);
      }
    }
  }

  /**
   * 获取 Agent 回复策略配置
   * 优先级：内存缓存 -> Redis缓存 -> 数据库 -> 默认值
   */
  async getAgentReplyConfig(): Promise<AgentReplyConfig> {
    // 1. 检查内存缓存是否有效
    if (this.agentReplyConfig && Date.now() < this.agentReplyConfigExpiry) {
      return this.agentReplyConfig;
    }

    // 2. 重新加载
    return this.loadAgentReplyConfig();
  }

  /**
   * 更新 Agent 回复策略配置
   */
  async setAgentReplyConfig(config: Partial<AgentReplyConfig>): Promise<AgentReplyConfig> {
    // 合并配置
    const newConfig: AgentReplyConfig = {
      ...(this.agentReplyConfig || DEFAULT_AGENT_REPLY_CONFIG),
      ...config,
    };

    // 更新内存缓存
    this.agentReplyConfig = newConfig;
    this.agentReplyConfigExpiry = Date.now() + this.AGENT_REPLY_CONFIG_CACHE_TTL * 1000;

    // 更新 Redis 缓存
    const cacheKey = `${this.CACHE_PREFIX}config:agent_reply_config`;
    await this.redisService.setex(cacheKey, this.AGENT_REPLY_CONFIG_CACHE_TTL, newConfig);

    // 更新数据库
    if (this.isInitialized) {
      try {
        // 先尝试更新
        const updateResponse = await this.supabaseHttpClient.patch(
          '/system_config',
          { value: newConfig },
          {
            params: { key: 'eq.agent_reply_config' },
          },
        );

        // 如果没有更新到任何记录，则插入
        if (!updateResponse.data || updateResponse.data.length === 0) {
          await this.supabaseHttpClient.post('/system_config', {
            key: 'agent_reply_config',
            value: newConfig,
            description: 'Agent 回复策略配置（消息聚合、打字延迟、告警节流）',
          });
        }

        this.logger.log('Agent 回复策略配置已更新');
      } catch (error) {
        this.logger.error('更新 Agent 回复策略配置到数据库失败', error);
        // 即使数据库更新失败，内存和 Redis 缓存已更新，服务仍可正常工作
      }
    }

    // 通知所有订阅者配置已变更
    this.notifyConfigChange(newConfig);

    return newConfig;
  }

  /**
   * 注册配置变更回调
   * 用于服务在配置变更时更新本地配置
   */
  onAgentReplyConfigChange(callback: (config: AgentReplyConfig) => void): void {
    this.configChangeCallbacks.push(callback);
  }

  /**
   * 通知所有订阅者配置已变更
   */
  private notifyConfigChange(config: AgentReplyConfig): void {
    for (const callback of this.configChangeCallbacks) {
      try {
        callback(config);
      } catch (error) {
        this.logger.error('配置变更回调执行失败', error);
      }
    }
  }

  // ==================== 系统配置（Worker 并发数等） ====================

  /**
   * 获取系统配置
   */
  async getSystemConfig(): Promise<SystemConfig | null> {
    // 1. 先尝试从 Redis 加载
    const cacheKey = `${this.CACHE_PREFIX}config:system_config`;
    const cached = await this.redisService.get<SystemConfig>(cacheKey);

    if (cached) {
      return cached;
    }

    // 2. 从数据库加载
    if (!this.isInitialized) {
      return null;
    }

    try {
      const response = await this.supabaseHttpClient.get('/system_config', {
        params: {
          key: 'eq.system_config',
          select: 'value',
        },
      });

      if (response.data && response.data.length > 0) {
        const config = response.data[0].value as SystemConfig;

        // 更新 Redis 缓存
        await this.redisService.setex(cacheKey, this.CONFIG_CACHE_TTL, config);

        return config;
      }

      return null;
    } catch (error) {
      this.logger.error('获取系统配置失败', error);
      return null;
    }
  }

  /**
   * 更新系统配置
   */
  async updateSystemConfig(config: Partial<SystemConfig>): Promise<SystemConfig> {
    // 获取现有配置
    const existingConfig = (await this.getSystemConfig()) || {};

    // 合并配置
    const newConfig: SystemConfig = {
      ...existingConfig,
      ...config,
    };

    // 更新 Redis 缓存
    const cacheKey = `${this.CACHE_PREFIX}config:system_config`;
    await this.redisService.setex(cacheKey, this.CONFIG_CACHE_TTL, newConfig);

    // 更新数据库
    if (this.isInitialized) {
      try {
        // 先尝试更新
        const updateResponse = await this.supabaseHttpClient.patch(
          '/system_config',
          { value: newConfig },
          {
            params: { key: 'eq.system_config' },
          },
        );

        // 如果没有更新到任何记录，则插入
        if (!updateResponse.data || updateResponse.data.length === 0) {
          await this.supabaseHttpClient.post('/system_config', {
            key: 'system_config',
            value: newConfig,
            description: '系统配置（Worker 并发数等）',
          });
        }

        this.logger.log(`系统配置已更新: ${JSON.stringify(config)}`);
      } catch (error) {
        this.logger.error('更新系统配置到数据库失败', error);
      }
    }

    return newConfig;
  }

  // ==================== 监控数据持久化 ====================

  /**
   * 插入或更新监控小时聚合数据
   * 使用 hour 作为唯一键进行 upsert
   */
  async upsertMonitoringHourly(data: {
    hour: string;
    message_count: number;
    success_count: number;
    failure_count: number;
    avg_duration: number;
    p95_duration: number;
    active_users: number;
    active_chats: number;
    total_tokens: number;
  }): Promise<void> {
    if (!this.isInitialized) {
      this.logger.warn('Supabase 未初始化，跳过监控数据持久化');
      return;
    }

    try {
      await this.supabaseHttpClient.post('/monitoring_hourly', data, {
        headers: {
          // 使用 on_conflict 进行 upsert
          Prefer: 'resolution=merge-duplicates',
        },
      });
      this.logger.debug(`监控数据已保存: ${data.hour}`);
    } catch (error) {
      this.logger.error('保存监控数据失败', error);
      throw error;
    }
  }

  /**
   * 删除指定日期之前的监控数据
   */
  async deleteMonitoringHourlyBefore(cutoffDate: Date): Promise<number> {
    if (!this.isInitialized) {
      return 0;
    }

    try {
      const response = await this.supabaseHttpClient.delete('/monitoring_hourly', {
        params: {
          hour: `lt.${cutoffDate.toISOString()}`,
        },
        headers: {
          Prefer: 'return=representation',
        },
      });

      const deletedCount = response.data?.length ?? 0;
      return deletedCount;
    } catch (error) {
      this.logger.error('删除过期监控数据失败', error);
      return 0;
    }
  }

  /**
   * 获取最近 N 天的监控历史数据
   */
  async getMonitoringHourlyHistory(days: number = 7): Promise<
    Array<{
      hour: string;
      message_count: number;
      success_count: number;
      failure_count: number;
      avg_duration: number;
      p95_duration: number;
      active_users: number;
      active_chats: number;
      total_tokens: number;
    }>
  > {
    if (!this.isInitialized) {
      return [];
    }

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const response = await this.supabaseHttpClient.get('/monitoring_hourly', {
        params: {
          hour: `gte.${cutoffDate.toISOString()}`,
          order: 'hour.desc',
          select: '*',
        },
      });

      return response.data ?? [];
    } catch (error) {
      this.logger.error('获取监控历史数据失败', error);
      return [];
    }
  }
}
