import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosInstance } from 'axios';
import { HttpClientFactory } from '@core/client-http';
import { RedisService } from '@core/redis';
import {
  StorageMessageType,
  StorageMessageSource,
  StorageContactType,
  toStorageMessageType,
  toStorageMessageSource,
  toStorageContactType,
} from '@wecom/message/enums';

/**
 * 系统配置键
 */
export enum SystemConfigKey {
  AI_REPLY_ENABLED = 'ai_reply_enabled',
  MESSAGE_MERGE_ENABLED = 'message_merge_enabled',
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
  typingDelayPerCharMs: number; // 每字符延迟（毫秒）- 已废弃，使用 typingSpeedCharsPerSec
  typingSpeedCharsPerSec: number; // 打字速度（字符/秒）
  paragraphGapMs: number; // 段落间隔（毫秒）

  // 告警节流配置
  alertThrottleWindowMs: number; // 告警节流窗口（毫秒）
  alertThrottleMaxCount: number; // 窗口内最大告警次数

  // 业务指标告警开关
  businessAlertEnabled: boolean; // 是否启用业务指标告警
  minSamplesForAlert: number; // 最小样本量（低于此值不检查）
  alertIntervalMinutes: number; // 同类告警最小间隔（分钟）

  // 告警阈值配置
  successRateCritical: number; // 成功率严重阈值（百分比，低于此值触发严重告警）
  avgDurationCritical: number; // 响应时间严重阈值（毫秒，高于此值触发严重告警）
  queueDepthCritical: number; // 队列深度严重阈值（条数，高于此值触发严重告警）
  errorRateCritical: number; // 错误率严重阈值（每小时次数，高于此值触发严重告警）
}

/**
 * Agent 回复策略配置默认值
 */
export const DEFAULT_AGENT_REPLY_CONFIG: AgentReplyConfig = {
  initialMergeWindowMs: 3000, // 默认 3000ms
  maxMergedMessages: 3, // 默认 3 条
  typingDelayPerCharMs: 125, // 兼容旧字段 (1000/8)
  typingSpeedCharsPerSec: 8, // 默认 8 字符/秒
  paragraphGapMs: 2000,
  alertThrottleWindowMs: 5 * 60 * 1000, // 5 分钟
  alertThrottleMaxCount: 3,
  businessAlertEnabled: true, // 默认启用
  minSamplesForAlert: 10, // 至少 10 条消息才检查
  alertIntervalMinutes: 30, // 同类告警间隔 30 分钟
  // 告警阈值默认值
  successRateCritical: 80, // 成功率低于 80% 触发告警
  avgDurationCritical: 60000, // 响应时间高于 60 秒触发告警
  queueDepthCritical: 20, // 队列深度高于 20 条触发告警
  errorRateCritical: 10, // 每小时错误超过 10 次触发告警
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
 * 聊天消息记录（Supabase 存储格式）
 * v1.2: message_type 和 source 改为英文字符串枚举，与外部契约解耦
 * v1.3: 新增 im_bot_id, im_contact_id, contact_type, is_self, payload, avatar, external_user_id
 */
interface ChatMessageRecord {
  chat_id: string;
  message_id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string; // ISO 格式
  candidate_name?: string;
  manager_name?: string;
  org_id?: string;
  bot_id?: string;
  message_type?: StorageMessageType; // 消息类型枚举: TEXT, IMAGE, VOICE 等
  source?: StorageMessageSource; // 消息来源枚举: MOBILE_PUSH, AI_REPLY 等
  is_room?: boolean; // 是否群聊
  // v1.3 新增字段
  im_bot_id?: string; // 托管账号的系统 wxid
  im_contact_id?: string; // 联系人系统ID
  contact_type?: StorageContactType; // 客户类型枚举
  is_self?: boolean; // 是否托管账号自己发送
  payload?: Record<string, unknown>; // 原始消息内容 (JSONB)
  avatar?: string; // 用户头像URL
  external_user_id?: string; // 企微外部用户ID
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

  // 消息聚合开关缓存（类似 aiReplyEnabled）
  private messageMergeEnabled: boolean | null = null;

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
    // 预加载消息聚合开关状态
    await this.loadMessageMergeStatus();
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
        timeout: 120000, // Increased to 120s to handle slow PostgREST queries
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

  // ==================== 消息聚合开关 ====================

  /**
   * 获取消息聚合开关状态
   * 优先级：内存缓存 -> Redis缓存 -> 数据库 -> 环境变量默认值
   */
  async getMessageMergeEnabled(): Promise<boolean> {
    // 1. 内存缓存
    if (this.messageMergeEnabled !== null) {
      return this.messageMergeEnabled;
    }

    // 2. Redis 缓存
    const cacheKey = `${this.CACHE_PREFIX}config:message_merge_enabled`;
    const cached = await this.redisService.get<boolean>(cacheKey);
    if (cached !== null) {
      this.messageMergeEnabled = cached;
      return cached;
    }

    // 3. 从数据库加载
    return this.loadMessageMergeStatus();
  }

  /**
   * 从数据库加载消息聚合开关状态
   */
  private async loadMessageMergeStatus(): Promise<boolean> {
    const defaultValue = this.configService.get<string>('ENABLE_MESSAGE_MERGE', 'true') === 'true';

    if (!this.isInitialized) {
      this.messageMergeEnabled = defaultValue;
      return defaultValue;
    }

    try {
      const response = await this.supabaseHttpClient.get('/system_config', {
        params: {
          key: 'eq.message_merge_enabled',
          select: 'value',
        },
      });

      if (response.data && response.data.length > 0) {
        const value = response.data[0].value;
        this.messageMergeEnabled = value === true || value === 'true';
      } else {
        // 数据库中没有记录，使用默认值并初始化
        this.messageMergeEnabled = defaultValue;
        await this.initMessageMergeConfig(defaultValue);
      }

      // 更新 Redis 缓存
      const cacheKey = `${this.CACHE_PREFIX}config:message_merge_enabled`;
      await this.redisService.setex(cacheKey, this.CONFIG_CACHE_TTL, this.messageMergeEnabled);

      this.logger.log(`消息聚合开关状态已加载: ${this.messageMergeEnabled}`);
      return this.messageMergeEnabled;
    } catch (error) {
      this.logger.error('加载消息聚合开关状态失败，使用默认值', error);
      this.messageMergeEnabled = defaultValue;
      return defaultValue;
    }
  }

  /**
   * 初始化消息聚合配置（首次运行时）
   */
  private async initMessageMergeConfig(value: boolean): Promise<void> {
    if (!this.isInitialized) return;

    try {
      await this.supabaseHttpClient.post('/system_config', {
        key: 'message_merge_enabled',
        value: value,
        description: '消息聚合功能开关（多条消息合并发送给 AI）',
      });
      this.logger.log('消息聚合配置已初始化到数据库');
    } catch (error: any) {
      // 忽略重复键错误
      if (error.response?.status !== 409) {
        this.logger.error('初始化消息聚合配置失败', error);
      }
    }
  }

  /**
   * 设置消息聚合开关状态
   */
  async setMessageMergeEnabled(enabled: boolean): Promise<boolean> {
    // 更新内存缓存
    this.messageMergeEnabled = enabled;

    // 更新 Redis 缓存
    const cacheKey = `${this.CACHE_PREFIX}config:message_merge_enabled`;
    await this.redisService.setex(cacheKey, this.CONFIG_CACHE_TTL, enabled);

    // 更新数据库
    if (this.isInitialized) {
      try {
        await this.supabaseHttpClient.patch(
          '/system_config',
          { value: enabled },
          {
            params: { key: 'eq.message_merge_enabled' },
          },
        );
        this.logger.log(`消息聚合开关已更新为: ${enabled}`);
      } catch (error) {
        this.logger.error('更新消息聚合状态到数据库失败', error);
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
          order: 'paused_at.desc', // 按禁止时间倒序排列（数据库层面）
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
   * 获取所有暂停托管的用户列表（附带用户资料）
   */
  async getPausedUsers(): Promise<
    { userId: string; pausedAt: number; odName?: string; groupName?: string }[]
  > {
    // 确保缓存是最新的
    if (Date.now() > this.pausedUsersCacheExpiry) {
      await this.loadPausedUsers();
    }

    const pausedUserIds = Array.from(this.pausedUsersCache.entries())
      .filter(([, status]) => status.isPaused)
      .map(([userId, status]) => ({
        userId,
        pausedAt: status.pausedAt,
      }));

    if (pausedUserIds.length === 0) {
      return [];
    }

    try {
      // 从 user_activity 表查询用户资料（取最新一条记录）
      const userIdList = pausedUserIds.map((u) => u.userId).join(',');
      const response = await this.supabaseHttpClient.get('/user_activity', {
        params: {
          chat_id: `in.(${userIdList})`,
          select: 'chat_id,od_name,group_name',
          order: 'last_active_at.desc',
        },
      });

      const data = response.data;
      if (!Array.isArray(data)) {
        this.logger.error('查询暂停用户资料失败: 响应格式错误');
        return pausedUserIds; // 降级：返回不带资料的数据
      }

      // 创建 userId -> profile 的映射（每个 userId 只保留最新记录）
      const profileMap = new Map<string, { odName?: string; groupName?: string }>();
      data.forEach((record: any) => {
        if (!profileMap.has(record.chat_id)) {
          profileMap.set(record.chat_id, {
            odName: record.od_name,
            groupName: record.group_name,
          });
        }
      });

      // 合并用户资料（保持 SQL 查询返回的倒序）
      return pausedUserIds.map((user) => ({
        userId: user.userId,
        pausedAt: user.pausedAt,
        odName: profileMap.get(user.userId)?.odName,
        groupName: profileMap.get(user.userId)?.groupName,
      }));
    } catch (error) {
      this.logger.error('查询暂停用户资料异常', error);
      // 降级：返回不带资料的数据（保持 SQL 查询返回的倒序）
      return pausedUserIds;
    }
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
    this.messageMergeEnabled = null;
    this.pausedUsersCacheExpiry = 0;
    this.groupBlacklistCacheExpiry = 0;
    this.agentReplyConfigExpiry = 0;

    await this.loadAiReplyStatus();
    await this.loadMessageMergeStatus();
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

  // ==================== 聊天消息 ====================

  /**
   * 保存聊天消息到 Supabase
   * 注意：只存储个微私聊消息，群聊消息和非个微用户消息会被过滤
   * v1.3: 新增 imBotId, imContactId, contactType, isSelf, payload, avatar, externalUserId 字段
   * v1.4: 新增 contactType 过滤，只存储个微用户消息
   */
  async saveChatMessage(message: {
    chatId: string;
    messageId: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    candidateName?: string;
    managerName?: string;
    orgId?: string;
    botId?: string;
    messageType?: number; // 消息类型
    source?: number; // 消息来源
    isRoom?: boolean; // 是否群聊
    // v1.3 新增字段
    imBotId?: string; // 托管账号的系统 wxid
    imContactId?: string; // 联系人系统ID
    contactType?: number; // 客户类型
    isSelf?: boolean; // 是否托管账号自己发送
    payload?: Record<string, unknown>; // 原始消息内容
    avatar?: string; // 用户头像URL
    externalUserId?: string; // 企微外部用户ID
  }): Promise<boolean> {
    if (!this.isInitialized) {
      this.logger.warn('Supabase 未初始化，跳过聊天消息保存');
      return false;
    }

    // 过滤群聊消息，只存储私聊
    if (message.isRoom === true) {
      this.logger.debug(`跳过群聊消息存储: ${message.messageId}`);
      return true;
    }

    // 只存储个微用户的消息（contactType === 1 表示个微）
    // 企微、公众号消息不落库
    // 注意：assistant 消息（机器人回复）不受此限制，始终存储
    if (
      message.role !== 'assistant' &&
      message.contactType !== undefined &&
      message.contactType !== 1
    ) {
      this.logger.debug(
        `跳过非个微用户消息存储: ${message.messageId}, contactType=${message.contactType}`,
      );
      return true;
    }

    try {
      const record: ChatMessageRecord = {
        chat_id: message.chatId,
        message_id: message.messageId,
        role: message.role,
        content: message.content,
        timestamp: new Date(message.timestamp).toISOString(),
        candidate_name: message.candidateName,
        manager_name: message.managerName,
        org_id: message.orgId,
        bot_id: message.botId,
        // 将外部数字枚举转换为内部字符串枚举存储
        message_type: toStorageMessageType(message.messageType),
        source: toStorageMessageSource(message.source),
        is_room: message.isRoom ?? false, // 默认私聊
        // v1.3 新增字段
        im_bot_id: message.imBotId,
        im_contact_id: message.imContactId,
        contact_type: toStorageContactType(message.contactType),
        is_self: message.isSelf,
        payload: message.payload,
        avatar: message.avatar,
        external_user_id: message.externalUserId,
      };

      // 使用 on_conflict 参数配合 ignore-duplicates 策略
      // 当 message_id 冲突时，忽略插入而不报错
      await this.supabaseHttpClient.post('/chat_messages?on_conflict=message_id', record, {
        headers: {
          Prefer: 'return=minimal,resolution=ignore-duplicates',
        },
      });

      return true;
    } catch (error: any) {
      // 忽略重复键错误 (409 Conflict)
      if (error.response?.status === 409) {
        this.logger.debug(`消息已存在，跳过: ${message.messageId}`);
        return true;
      }
      this.logger.error('保存聊天消息失败', error);
      return false;
    }
  }

  /**
   * 获取会话的历史消息（用于 AI 上下文）
   * @param chatId 会话ID
   * @param limit 最大返回条数，默认 60
   */
  async getChatHistory(
    chatId: string,
    limit: number = 60,
  ): Promise<Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>> {
    if (!this.isInitialized) {
      return [];
    }

    try {
      const response = await this.supabaseHttpClient.get('/chat_messages', {
        params: {
          chat_id: `eq.${chatId}`,
          select: 'role,content,timestamp',
          order: 'timestamp.desc',
          limit: limit,
        },
      });

      // 返回时反转顺序（从旧到新）
      const messages = (response.data ?? []).reverse();
      return messages.map((m: any) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: new Date(m.timestamp).getTime(),
      }));
    } catch (error) {
      this.logger.error(`获取会话历史失败 [${chatId}]:`, error);
      return [];
    }
  }

  /**
   * 获取会话的完整历史消息（包含元数据，用于飞书同步）
   * v1.3: 新增 messageType, source, contactType, avatar, externalUserId 等字段
   * @param chatId 会话ID
   */
  async getChatHistoryDetail(chatId: string): Promise<
    Array<{
      messageId: string;
      role: 'user' | 'assistant';
      content: string;
      timestamp: number;
      candidateName?: string;
      managerName?: string;
      // v1.3 新增字段
      messageType?: string;
      source?: string;
      contactType?: string;
      isSelf?: boolean;
      avatar?: string;
      externalUserId?: string;
    }>
  > {
    if (!this.isInitialized) {
      return [];
    }

    try {
      const response = await this.supabaseHttpClient.get('/chat_messages', {
        params: {
          chat_id: `eq.${chatId}`,
          select:
            'message_id,role,content,timestamp,candidate_name,manager_name,message_type,source,contact_type,is_self,avatar,external_user_id',
          order: 'timestamp.asc',
        },
      });

      return (response.data ?? []).map((m: any) => ({
        messageId: m.message_id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: new Date(m.timestamp).getTime(),
        candidateName: m.candidate_name,
        managerName: m.manager_name,
        // v1.3 新增字段
        messageType: m.message_type,
        source: m.source,
        contactType: m.contact_type,
        isSelf: m.is_self,
        avatar: m.avatar,
        externalUserId: m.external_user_id,
      }));
    } catch (error) {
      this.logger.error(`获取会话详情失败 [${chatId}]:`, error);
      return [];
    }
  }

  /**
   * 获取指定时间范围内的聊天记录（用于飞书同步）
   * @param startTime 开始时间（毫秒时间戳）
   * @param endTime 结束时间（毫秒时间戳）
   */
  async getChatMessagesByTimeRange(
    startTime: number,
    endTime: number,
  ): Promise<
    Array<{
      chatId: string;
      messages: Array<{
        messageId: string;
        role: 'user' | 'assistant';
        content: string;
        timestamp: number;
        candidateName?: string;
        managerName?: string;
      }>;
    }>
  > {
    if (!this.isInitialized) {
      return [];
    }

    try {
      const startIso = new Date(startTime).toISOString();
      const endIso = new Date(endTime).toISOString();

      const response = await this.supabaseHttpClient.get('/chat_messages', {
        params: {
          timestamp: `gte.${startIso}`,
          and: `(timestamp.lt.${endIso})`,
          select: 'chat_id,message_id,role,content,timestamp,candidate_name,manager_name',
          order: 'chat_id.asc,timestamp.asc',
        },
      });

      // 按 chat_id 分组
      const grouped = new Map<
        string,
        Array<{
          messageId: string;
          role: 'user' | 'assistant';
          content: string;
          timestamp: number;
          candidateName?: string;
          managerName?: string;
        }>
      >();

      for (const m of response.data ?? []) {
        const chatId = m.chat_id;
        if (!grouped.has(chatId)) {
          grouped.set(chatId, []);
        }
        grouped.get(chatId)!.push({
          messageId: m.message_id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          timestamp: new Date(m.timestamp).getTime(),
          candidateName: m.candidate_name,
          managerName: m.manager_name,
        });
      }

      return Array.from(grouped.entries()).map(([chatId, messages]) => ({
        chatId,
        messages,
      }));
    } catch (error) {
      this.logger.error('获取时间范围内的聊天记录失败:', error);
      return [];
    }
  }

  /**
   * 获取当天的聊天记录（用于仪表盘）
   * @param date 日期，默认今天
   * @param page 页码，从 1 开始
   * @param pageSize 每页条数，默认 50
   */
  async getTodayChatMessages(
    date?: Date,
    page: number = 1,
    pageSize: number = 50,
  ): Promise<{
    messages: Array<{
      id: string;
      chatId: string;
      role: 'user' | 'assistant';
      content: string;
      timestamp: number;
      candidateName?: string;
      managerName?: string;
    }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    if (!this.isInitialized) {
      return { messages: [], total: 0, page, pageSize };
    }

    try {
      const targetDate = date || new Date();
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

      const startIso = startOfDay.toISOString();
      const endIso = endOfDay.toISOString();

      // 获取总数
      const countResponse = await this.supabaseHttpClient.get('/chat_messages', {
        params: {
          timestamp: `gte.${startIso}`,
          and: `(timestamp.lte.${endIso})`,
          select: 'id',
        },
        headers: {
          Prefer: 'count=exact',
          'Range-Unit': 'items',
          Range: '0-0',
        },
      });

      const total = parseInt(countResponse.headers['content-range']?.split('/')[1] ?? '0', 10);

      // 获取分页数据
      const offset = (page - 1) * pageSize;
      const response = await this.supabaseHttpClient.get('/chat_messages', {
        params: {
          timestamp: `gte.${startIso}`,
          and: `(timestamp.lte.${endIso})`,
          select: 'id,chat_id,role,content,timestamp,candidate_name,manager_name',
          order: 'timestamp.desc',
          offset: offset,
          limit: pageSize,
        },
      });

      const messages = (response.data ?? []).map((m: any) => ({
        id: m.id,
        chatId: m.chat_id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: new Date(m.timestamp).getTime(),
        candidateName: m.candidate_name,
        managerName: m.manager_name,
      }));

      return { messages, total, page, pageSize };
    } catch (error) {
      this.logger.error('获取当天聊天记录失败:', error);
      return { messages: [], total: 0, page, pageSize };
    }
  }

  /**
   * 获取所有会话ID列表
   * 使用 RPC 函数 get_distinct_chat_ids() 进行 DISTINCT 查询，避免全表扫描
   */
  async getAllChatIds(): Promise<string[]> {
    if (!this.isInitialized) {
      return [];
    }

    try {
      // 使用 RPC 调用 DISTINCT 函数，性能更优
      const response = await this.supabaseHttpClient.post('/rpc/get_distinct_chat_ids');

      return (response.data ?? []).map((row: { chat_id: string }) => row.chat_id);
    } catch (error: any) {
      // 如果 RPC 函数不存在，回退到旧方法
      if (error.response?.status === 404) {
        this.logger.warn('RPC 函数 get_distinct_chat_ids 不存在，使用回退方案');
        return this.getAllChatIdsFallback();
      }
      this.logger.error('获取所有会话ID失败:', error);
      return [];
    }
  }

  /**
   * 获取所有会话ID（回退方法）
   * 当 RPC 函数不可用时使用
   */
  private async getAllChatIdsFallback(): Promise<string[]> {
    try {
      const response = await this.supabaseHttpClient.get('/chat_messages', {
        params: {
          select: 'chat_id',
          order: 'chat_id.asc',
        },
      });

      // 去重
      const chatIds = new Set<string>();
      for (const m of response.data ?? []) {
        chatIds.add(m.chat_id);
      }

      return Array.from(chatIds);
    } catch (error) {
      this.logger.error('获取所有会话ID失败（回退）:', error);
      return [];
    }
  }

  /**
   * 获取会话列表（用于 Dashboard 展示）
   * 返回每个会话的最新消息和统计信息
   * v1.3: 新增 avatar, contactType 字段
   * @param days 查询最近 N 天的数据，默认 1 天（今天）
   */
  async getChatSessionList(days: number = 1): Promise<
    Array<{
      chatId: string;
      candidateName?: string;
      managerName?: string;
      messageCount: number;
      lastMessage?: string;
      lastTimestamp?: number;
      // v1.3 新增字段
      avatar?: string;
      contactType?: string;
    }>
  > {
    if (!this.isInitialized) {
      return [];
    }

    try {
      // 计算时间范围
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      startDate.setHours(0, 0, 0, 0);

      // 获取指定时间范围内的会话统计信息
      // 增加 role 字段用于区分用户消息和机器人回复
      const response = await this.supabaseHttpClient.get('/chat_messages', {
        params: {
          select: 'chat_id,candidate_name,manager_name,content,timestamp,avatar,contact_type,role',
          order: 'timestamp.desc',
          timestamp: `gte.${startDate.toISOString()}`,
          limit: 10000, // 增加限制以避免数据截断
        },
      });

      // 按 chat_id 分组，取最新消息
      const sessionMap = new Map<
        string,
        {
          chatId: string;
          candidateName?: string;
          managerName?: string;
          messageCount: number;
          lastMessage?: string;
          lastTimestamp?: number;
          avatar?: string;
          contactType?: string;
        }
      >();

      for (const msg of response.data ?? []) {
        const chatId = msg.chat_id;
        if (!sessionMap.has(chatId)) {
          sessionMap.set(chatId, {
            chatId,
            // 优先使用用户消息的名称
            candidateName: msg.role === 'user' ? msg.candidate_name : undefined,
            managerName: msg.manager_name,
            messageCount: 1,
            lastMessage: msg.content?.substring(0, 50) + (msg.content?.length > 50 ? '...' : ''),
            lastTimestamp: new Date(msg.timestamp).getTime(),
            // 优先使用用户消息的头像
            avatar: msg.role === 'user' ? msg.avatar : undefined,
            // 只有用户消息的 contactType 才是准确的（机器人回复可能继承错误的值）
            contactType: msg.role === 'user' ? msg.contact_type : undefined,
          });
        } else {
          const session = sessionMap.get(chatId)!;
          session.messageCount++;
          // 补充缺失的名称（只从用户消息获取）
          if (!session.candidateName && msg.role === 'user' && msg.candidate_name) {
            session.candidateName = msg.candidate_name;
          }
          if (!session.managerName && msg.manager_name) {
            session.managerName = msg.manager_name;
          }
          // 补充缺失的头像（只从用户消息获取）
          if (!session.avatar && msg.role === 'user' && msg.avatar) {
            session.avatar = msg.avatar;
          }
          // 只从用户消息中获取 contactType
          if (!session.contactType && msg.contact_type && msg.role === 'user') {
            session.contactType = msg.contact_type;
          }
        }
      }

      // 按最后活跃时间排序
      return Array.from(sessionMap.values()).sort(
        (a, b) => (b.lastTimestamp || 0) - (a.lastTimestamp || 0),
      );
    } catch (error) {
      this.logger.error('获取会话列表失败:', error);
      return [];
    }
  }

  /**
   * 获取每日聊天统计数据（数据库聚合查询）
   * 用于消息趋势图表展示，性能优化版本
   * v1.5: 使用数据库 RPC 函数进行聚合查询，避免拉取大量原始数据
   * @param startDate 开始时间
   * @param endDate 结束时间
   * @returns 每日统计数据（日期、消息数、活跃会话数）
   */
  async getChatDailyStats(
    startDate: Date,
    endDate: Date,
  ): Promise<
    Array<{
      date: string;
      messageCount: number;
      sessionCount: number;
    }>
  > {
    if (!this.isInitialized) {
      return [];
    }

    try {
      const response = await this.supabaseHttpClient.post('/rpc/get_chat_daily_stats', {
        p_start_date: startDate.toISOString(),
        p_end_date: endDate.toISOString(),
      });

      const stats = response.data ?? [];
      this.logger.log(
        `获取每日聊天统计: ${stats.length} 天的数据（${startDate.toISOString().split('T')[0]} ~ ${endDate.toISOString().split('T')[0]}）`,
      );

      // 格式化返回数据
      return stats.map((item: any) => ({
        date: item.date,
        messageCount: parseInt(item.message_count, 10),
        sessionCount: parseInt(item.session_count, 10),
      }));
    } catch (error) {
      this.logger.error('获取每日聊天统计失败:', error);
      return [];
    }
  }

  /**
   * 获取聊天汇总统计数据（数据库聚合查询）
   * 用于顶部统计栏展示，性能优化版本
   * v1.5: 使用数据库 RPC 函数进行聚合查询，替代应用层计算
   * @param startDate 开始时间
   * @param endDate 结束时间
   * @returns 汇总统计（总会话数、总消息数、活跃会话数）
   */
  async getChatSummaryStats(
    startDate: Date,
    endDate: Date,
  ): Promise<{
    totalSessions: number;
    totalMessages: number;
    activeSessions: number;
  }> {
    if (!this.isInitialized) {
      return { totalSessions: 0, totalMessages: 0, activeSessions: 0 };
    }

    try {
      const response = await this.supabaseHttpClient.post('/rpc/get_chat_summary_stats', {
        p_start_date: startDate.toISOString(),
        p_end_date: endDate.toISOString(),
      });

      const stats = response.data ?? [];
      const result = stats[0] ?? { total_sessions: 0, total_messages: 0, active_sessions: 0 };

      this.logger.log(
        `获取聊天汇总统计: 总会话 ${result.total_sessions}, 总消息 ${result.total_messages}, 活跃会话 ${result.active_sessions}（${startDate.toISOString().split('T')[0]} ~ ${endDate.toISOString().split('T')[0]}）`,
      );

      return {
        totalSessions: parseInt(result.total_sessions, 10),
        totalMessages: parseInt(result.total_messages, 10),
        activeSessions: parseInt(result.active_sessions, 10),
      };
    } catch (error) {
      this.logger.error('获取聊天汇总统计失败:', error);
      return { totalSessions: 0, totalMessages: 0, activeSessions: 0 };
    }
  }

  /**
   * 获取会话列表（数据库聚合查询，性能优化版本）
   * 用于会话列表展示，性能优化版本
   * v1.5: 使用数据库 RPC 函数进行聚合查询，替代应用层计算
   * @param startDate 开始时间
   * @param endDate 结束时间
   * @returns 会话列表（含统计信息）
   */
  async getChatSessionListOptimized(
    startDate: Date,
    endDate: Date,
  ): Promise<
    Array<{
      chatId: string;
      candidateName?: string;
      managerName?: string;
      messageCount: number;
      lastMessage?: string;
      lastTimestamp?: number;
      avatar?: string;
      contactType?: string;
    }>
  > {
    if (!this.isInitialized) {
      return [];
    }

    try {
      const response = await this.supabaseHttpClient.post('/rpc/get_chat_session_list', {
        p_start_date: startDate.toISOString(),
        p_end_date: endDate.toISOString(),
      });

      const sessions = response.data ?? [];
      this.logger.log(
        `获取会话列表: ${sessions.length} 个会话（${startDate.toISOString().split('T')[0]} ~ ${endDate.toISOString().split('T')[0]}）`,
      );

      return sessions.map((item: any) => ({
        chatId: item.chat_id,
        candidateName: item.candidate_name,
        managerName: item.manager_name,
        messageCount: parseInt(item.message_count, 10),
        lastMessage: item.last_message,
        lastTimestamp: item.last_timestamp ? new Date(item.last_timestamp).getTime() : undefined,
        avatar: item.avatar,
        contactType: item.contact_type,
      }));
    } catch (error) {
      this.logger.error('获取会话列表失败:', error);
      return [];
    }
  }

  /**
   * 获取指定时间范围内的会话列表
   * v1.4: 支持精确的时间范围筛选
   * @param startDate 开始时间
   * @param endDate 结束时间
   */
  async getChatSessionListByDateRange(
    startDate: Date,
    endDate: Date,
  ): Promise<
    Array<{
      chatId: string;
      candidateName?: string;
      managerName?: string;
      messageCount: number;
      lastMessage?: string;
      lastTimestamp?: number;
      avatar?: string;
      contactType?: string;
    }>
  > {
    if (!this.isInitialized) {
      return [];
    }

    try {
      // 直接查询，返回有限数量（Supabase REST API 单次最多 1000 条）
      // 注意：由于数据量可能超过 1000 条，这里只返回最新的会话
      // 如需完整数据，应在前端实现分页加载
      const response = await this.supabaseHttpClient.get('/chat_messages', {
        params: {
          select: 'chat_id,candidate_name,manager_name,content,timestamp,avatar,contact_type,role',
          order: 'timestamp.desc',
          and: `(timestamp.gte.${startDate.toISOString()},timestamp.lte.${endDate.toISOString()})`,
          limit: 1000, // Supabase 单次最大限制
        },
      });

      const messages = response.data ?? [];
      this.logger.log(
        `获取到 ${messages.length} 条消息记录（${startDate.toISOString()} ~ ${endDate.toISOString()}）`,
      );

      // 按 chat_id 分组，取最新消息
      const sessionMap = new Map<
        string,
        {
          chatId: string;
          candidateName?: string;
          managerName?: string;
          messageCount: number;
          lastMessage?: string;
          lastTimestamp?: number;
          avatar?: string;
          contactType?: string;
        }
      >();

      for (const msg of messages) {
        const chatId = msg.chat_id;
        if (!sessionMap.has(chatId)) {
          sessionMap.set(chatId, {
            chatId,
            candidateName: msg.role === 'user' ? msg.candidate_name : undefined,
            managerName: msg.manager_name,
            messageCount: 1,
            lastMessage: msg.content?.substring(0, 50) + (msg.content?.length > 50 ? '...' : ''),
            lastTimestamp: new Date(msg.timestamp).getTime(),
            avatar: msg.role === 'user' ? msg.avatar : undefined,
            contactType: msg.role === 'user' ? msg.contact_type : undefined,
          });
        } else {
          const session = sessionMap.get(chatId)!;
          session.messageCount++;
          if (!session.candidateName && msg.role === 'user' && msg.candidate_name) {
            session.candidateName = msg.candidate_name;
          }
          if (!session.managerName && msg.manager_name) {
            session.managerName = msg.manager_name;
          }
          if (!session.avatar && msg.role === 'user' && msg.avatar) {
            session.avatar = msg.avatar;
          }
          if (!session.contactType && msg.contact_type && msg.role === 'user') {
            session.contactType = msg.contact_type;
          }
        }
      }

      return Array.from(sessionMap.values()).sort(
        (a, b) => (b.lastTimestamp || 0) - (a.lastTimestamp || 0),
      );
    } catch (error) {
      this.logger.error('获取会话列表(时间范围)失败:', error);
      return [];
    }
  }

  /**
   * 清理过期的聊天消息
   * 调用数据库函数 cleanup_chat_messages()
   * @param retentionDays 保留天数，默认 90 天
   * @returns 删除的消息数量
   */
  async cleanupChatMessages(retentionDays: number = 90): Promise<number> {
    if (!this.isInitialized) {
      this.logger.warn('Supabase 未初始化，跳过聊天消息清理');
      return 0;
    }

    try {
      const response = await this.supabaseHttpClient.post('/rpc/cleanup_chat_messages', {
        retention_days: retentionDays,
      });

      const deletedCount = response.data ?? 0;
      if (deletedCount > 0) {
        this.logger.log(`✅ 聊天消息清理完成: 删除 ${deletedCount} 条 ${retentionDays} 天前的消息`);
      }
      return deletedCount;
    } catch (error) {
      this.logger.error('清理聊天消息失败:', error);
      return 0;
    }
  }

  /**
   * 清理过期的用户活跃记录
   * 调用数据库函数 cleanup_user_activity()
   * @param retentionDays 保留天数，默认 14 天
   * @returns 删除的记录数量
   */
  async cleanupUserActivity(retentionDays: number = 14): Promise<number> {
    if (!this.isInitialized) {
      this.logger.warn('Supabase 未初始化，跳过用户活跃记录清理');
      return 0;
    }

    try {
      const response = await this.supabaseHttpClient.post('/rpc/cleanup_user_activity', {
        retention_days: retentionDays,
      });

      const deletedCount = response.data ?? 0;
      if (deletedCount > 0) {
        this.logger.log(
          `✅ 用户活跃记录清理完成: 删除 ${deletedCount} 条 ${retentionDays} 天前的记录`,
        );
      }
      return deletedCount;
    } catch (error) {
      this.logger.error('清理用户活跃记录失败:', error);
      return 0;
    }
  }

  /**
   * 批量保存聊天消息到 Supabase
   * 用于高并发场景，减少数据库请求次数
   * 注意：只存储私聊消息，群聊消息会被过滤
   * v1.3: 新增 imBotId, imContactId, contactType, isSelf, payload, avatar, externalUserId 字段
   * @param messages 消息数组
   * @returns 成功保存的消息数量
   */
  async saveChatMessagesBatch(
    messages: Array<{
      chatId: string;
      messageId: string;
      role: 'user' | 'assistant';
      content: string;
      timestamp: number;
      candidateName?: string;
      managerName?: string;
      orgId?: string;
      botId?: string;
      messageType?: number;
      source?: number;
      isRoom?: boolean;
      // v1.3 新增字段
      imBotId?: string;
      imContactId?: string;
      contactType?: number;
      isSelf?: boolean;
      payload?: Record<string, unknown>;
      avatar?: string;
      externalUserId?: string;
    }>,
  ): Promise<number> {
    if (!this.isInitialized || messages.length === 0) {
      return 0;
    }

    // 过滤群聊消息，只存储私聊
    const privateMessages = messages.filter((m) => m.isRoom !== true);

    if (privateMessages.length === 0) {
      this.logger.debug('批量写入：所有消息均为群聊，跳过');
      return 0;
    }

    try {
      const records: ChatMessageRecord[] = privateMessages.map((message) => ({
        chat_id: message.chatId,
        message_id: message.messageId,
        role: message.role,
        content: message.content,
        timestamp: new Date(message.timestamp).toISOString(),
        candidate_name: message.candidateName,
        manager_name: message.managerName,
        org_id: message.orgId,
        bot_id: message.botId,
        // 将外部数字枚举转换为内部字符串枚举存储
        message_type: toStorageMessageType(message.messageType),
        source: toStorageMessageSource(message.source),
        is_room: message.isRoom ?? false,
        // v1.3 新增字段
        im_bot_id: message.imBotId,
        im_contact_id: message.imContactId,
        contact_type: toStorageContactType(message.contactType),
        is_self: message.isSelf,
        payload: message.payload,
        avatar: message.avatar,
        external_user_id: message.externalUserId,
      }));

      // 使用 on_conflict 参数配合 ignore-duplicates 策略
      // 当 message_id 冲突时，忽略插入而不报错
      await this.supabaseHttpClient.post('/chat_messages?on_conflict=message_id', records, {
        headers: {
          Prefer: 'return=minimal,resolution=ignore-duplicates',
        },
      });

      this.logger.debug(`批量保存 ${records.length} 条聊天消息成功`);
      return records.length;
    } catch (error: any) {
      // 409 表示有部分重复，但其他记录可能已成功
      if (error.response?.status === 409) {
        this.logger.debug('批量保存部分消息已存在');
        return privateMessages.length; // 假设大部分成功
      }
      this.logger.error('批量保存聊天消息失败:', error);
      return 0;
    }
  }

  // ==================== 用户活跃记录 ====================

  /**
   * 更新用户活跃记录（Upsert）
   * 每次消息处理完成后调用，自动累加消息数和 Token
   */
  async upsertUserActivity(data: {
    chatId: string;
    odId?: string;
    odName?: string;
    groupId?: string;
    groupName?: string;
    messageCount: number;
    tokenUsage: number;
    activeAt: number; // 时间戳
  }): Promise<boolean> {
    if (!this.isInitialized) {
      this.logger.warn('Supabase 未初始化，跳过用户活跃记录保存');
      return false;
    }

    try {
      // 调用 RPC 函数进行 upsert
      await this.supabaseHttpClient.post('/rpc/upsert_user_activity', {
        p_chat_id: data.chatId,
        p_od_id: data.odId || null,
        p_od_name: data.odName || null,
        p_group_id: data.groupId || null,
        p_group_name: data.groupName || null,
        p_message_count: data.messageCount,
        p_token_usage: data.tokenUsage,
        p_active_at: new Date(data.activeAt).toISOString(),
      });

      return true;
    } catch (error: any) {
      // 如果 RPC 函数不存在，回退到手动 upsert
      if (error.response?.status === 404) {
        this.logger.warn('RPC 函数 upsert_user_activity 不存在，使用回退方案');
        return this.upsertUserActivityFallback(data);
      }
      this.logger.error('更新用户活跃记录失败:', error);
      return false;
    }
  }

  /**
   * 更新用户活跃记录（回退方案：手动 upsert）
   */
  private async upsertUserActivityFallback(data: {
    chatId: string;
    odId?: string;
    odName?: string;
    groupId?: string;
    groupName?: string;
    messageCount: number;
    tokenUsage: number;
    activeAt: number;
  }): Promise<boolean> {
    try {
      // 计算中国时区的日期
      const activeDate = new Date(data.activeAt);
      const chinaDate = new Date(activeDate.getTime() + 8 * 60 * 60 * 1000);
      const activityDate = chinaDate.toISOString().split('T')[0];

      const record = {
        chat_id: data.chatId,
        od_id: data.odId || null,
        od_name: data.odName || null,
        group_id: data.groupId || null,
        group_name: data.groupName || null,
        activity_date: activityDate,
        message_count: data.messageCount,
        token_usage: data.tokenUsage,
        first_active_at: new Date(data.activeAt).toISOString(),
        last_active_at: new Date(data.activeAt).toISOString(),
      };

      // 尝试插入，如果冲突则更新
      await this.supabaseHttpClient.post(
        '/user_activity?on_conflict=chat_id,activity_date',
        record,
        {
          headers: {
            Prefer: 'resolution=merge-duplicates',
          },
        },
      );

      return true;
    } catch (error) {
      this.logger.error('更新用户活跃记录失败（回退）:', error);
      return false;
    }
  }

  /**
   * 获取今日活跃用户列表
   */
  async getTodayActiveUsers(): Promise<
    Array<{
      chatId: string;
      odId?: string;
      odName?: string;
      groupId?: string;
      groupName?: string;
      messageCount: number;
      tokenUsage: number;
      firstActiveAt: number;
      lastActiveAt: number;
    }>
  > {
    if (!this.isInitialized) {
      return [];
    }

    try {
      // 尝试使用 RPC 函数
      const response = await this.supabaseHttpClient.post('/rpc/get_today_users');

      return (response.data ?? []).map((row: any) => ({
        chatId: row.chat_id,
        odId: row.od_id,
        odName: row.od_name,
        groupId: row.group_id,
        groupName: row.group_name,
        messageCount: row.message_count,
        tokenUsage: row.token_usage,
        firstActiveAt: new Date(row.first_active_at).getTime(),
        lastActiveAt: new Date(row.last_active_at).getTime(),
      }));
    } catch (error: any) {
      // 如果 RPC 函数不存在，回退到直接查询
      if (error.response?.status === 404) {
        this.logger.warn('RPC 函数 get_today_users 不存在，使用回退方案');
        return this.getTodayActiveUsersFallback();
      }
      this.logger.error('获取今日活跃用户失败:', error);
      return [];
    }
  }

  /**
   * 获取今日活跃用户（回退方案）
   */
  private async getTodayActiveUsersFallback(): Promise<
    Array<{
      chatId: string;
      odId?: string;
      odName?: string;
      groupId?: string;
      groupName?: string;
      messageCount: number;
      tokenUsage: number;
      firstActiveAt: number;
      lastActiveAt: number;
    }>
  > {
    try {
      // 计算中国时区的今天日期
      const now = new Date();
      const chinaDate = new Date(now.getTime() + 8 * 60 * 60 * 1000);
      const todayDate = chinaDate.toISOString().split('T')[0];

      const response = await this.supabaseHttpClient.get('/user_activity', {
        params: {
          activity_date: `eq.${todayDate}`,
          select: '*',
          order: 'last_active_at.desc',
        },
      });

      return (response.data ?? []).map((row: any) => ({
        chatId: row.chat_id,
        odId: row.od_id,
        odName: row.od_name,
        groupId: row.group_id,
        groupName: row.group_name,
        messageCount: row.message_count,
        tokenUsage: row.token_usage,
        firstActiveAt: new Date(row.first_active_at).getTime(),
        lastActiveAt: new Date(row.last_active_at).getTime(),
      }));
    } catch (error) {
      this.logger.error('获取今日活跃用户失败（回退）:', error);
      return [];
    }
  }

  /**
   * 获取指定日期的活跃用户
   * @param date 查询日期 (YYYY-MM-DD 格式)
   */
  async getActiveUsersByDate(date: string): Promise<
    Array<{
      chatId: string;
      odId?: string;
      odName?: string;
      groupId?: string;
      groupName?: string;
      messageCount: number;
      tokenUsage: number;
      firstActiveAt: number;
      lastActiveAt: number;
    }>
  > {
    if (!this.isInitialized) {
      return [];
    }

    try {
      const response = await this.supabaseHttpClient.get('/user_activity', {
        params: {
          activity_date: `eq.${date}`,
          select: '*',
          order: 'last_active_at.desc',
        },
      });

      return (response.data ?? []).map((row: any) => ({
        chatId: row.chat_id,
        odId: row.od_id,
        odName: row.od_name,
        groupId: row.group_id,
        groupName: row.group_name,
        messageCount: row.message_count,
        tokenUsage: row.token_usage,
        firstActiveAt: new Date(row.first_active_at).getTime(),
        lastActiveAt: new Date(row.last_active_at).getTime(),
      }));
    } catch (error) {
      this.logger.error(`获取指定日期活跃用户失败 (${date}):`, error);
      return [];
    }
  }

  /**
   * 获取指定日期范围内每日用户数统计（用于趋势图）
   */
  async getDailyUserStats(
    startDate: Date,
    endDate: Date,
  ): Promise<
    Array<{
      date: string;
      userCount: number;
      messageCount: number;
    }>
  > {
    if (!this.isInitialized) {
      return [];
    }

    try {
      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];

      // 使用 URL 查询参数直接拼接（Supabase PostgREST 支持多条件）
      const response = await this.supabaseHttpClient.get(
        `/user_activity?activity_date=gte.${startDateStr}&activity_date=lte.${endDateStr}&select=activity_date,chat_id,message_count`,
      );

      const rows = response.data ?? [];

      // 按日期分组统计
      const statsMap = new Map<string, { userCount: number; messageCount: number }>();

      rows.forEach((row: any) => {
        const date = row.activity_date;
        if (!statsMap.has(date)) {
          statsMap.set(date, { userCount: 0, messageCount: 0 });
        }
        const stats = statsMap.get(date)!;
        stats.userCount += 1;
        stats.messageCount += row.message_count || 0;
      });

      // 转换为数组并排序
      const result = Array.from(statsMap.entries())
        .map(([date, stats]) => ({
          date,
          userCount: stats.userCount,
          messageCount: stats.messageCount,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      return result;
    } catch (error: any) {
      this.logger.error('获取每日用户统计失败:', error.message);
      return [];
    }
  }

  /**
   * 获取指定日期范围内的活跃用户
   */
  async getActiveUsersByDateRange(
    startDate: Date,
    endDate: Date,
  ): Promise<
    Array<{
      chatId: string;
      odId?: string;
      odName?: string;
      groupId?: string;
      groupName?: string;
      totalMessageCount: number;
      totalTokenUsage: number;
      firstActiveAt: number;
      lastActiveAt: number;
      activeDays: number;
    }>
  > {
    if (!this.isInitialized) {
      return [];
    }

    try {
      // 转换为日期字符串
      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];

      // 尝试使用 RPC 函数
      const response = await this.supabaseHttpClient.post('/rpc/get_users_by_date_range', {
        p_start_date: startDateStr,
        p_end_date: endDateStr,
      });

      return (response.data ?? []).map((row: any) => ({
        chatId: row.chat_id,
        odId: row.od_id,
        odName: row.od_name,
        groupId: row.group_id,
        groupName: row.group_name,
        totalMessageCount: row.total_message_count,
        totalTokenUsage: row.total_token_usage,
        firstActiveAt: new Date(row.first_active_at).getTime(),
        lastActiveAt: new Date(row.last_active_at).getTime(),
        activeDays: row.active_days,
      }));
    } catch (error: any) {
      // 如果 RPC 函数不存在，回退到直接查询
      if (error.response?.status === 404) {
        this.logger.warn('RPC 函数 get_users_by_date_range 不存在');
      }
      this.logger.error('获取日期范围内活跃用户失败:', error);
      return [];
    }
  }

  // ==================== 消息处理记录持久化 ====================

  /**
   * 保存消息处理记录到数据库
   * 用于持久化实时消息详情，包括完整的 Agent 调用记录
   * @param record 消息处理记录
   */
  async saveMessageProcessingRecord(record: {
    messageId: string;
    chatId: string;
    userId?: string;
    userName?: string;
    managerName?: string;
    receivedAt: number;
    messagePreview?: string;
    replyPreview?: string;
    replySegments?: number;
    status: 'processing' | 'success' | 'failure';
    error?: string;
    scenario?: string;
    totalDuration?: number;
    queueDuration?: number;
    prepDuration?: number;
    aiStartAt?: number;
    aiEndAt?: number;
    aiDuration?: number;
    sendDuration?: number;
    tools?: string[];
    tokenUsage?: number;
    isFallback?: boolean;
    fallbackSuccess?: boolean;
    agentInvocation?: any;
  }): Promise<boolean> {
    if (!this.isInitialized) {
      this.logger.warn('[消息处理记录] Supabase 未初始化，跳过保存');
      return false;
    }

    try {
      const dbRecord = {
        message_id: record.messageId,
        chat_id: record.chatId,
        user_id: record.userId,
        user_name: record.userName,
        manager_name: record.managerName,
        received_at: new Date(record.receivedAt).toISOString(),
        message_preview: record.messagePreview,
        reply_preview: record.replyPreview,
        reply_segments: record.replySegments,
        status: record.status,
        error: record.error,
        scenario: record.scenario,
        total_duration: record.totalDuration,
        queue_duration: record.queueDuration,
        prep_duration: record.prepDuration,
        ai_start_at: record.aiStartAt,
        ai_end_at: record.aiEndAt,
        ai_duration: record.aiDuration,
        send_duration: record.sendDuration,
        tools: record.tools,
        token_usage: record.tokenUsage,
        is_fallback: record.isFallback,
        fallback_success: record.fallbackSuccess,
        agent_invocation: record.agentInvocation,
      };

      await this.supabaseHttpClient.post(
        '/message_processing_records?on_conflict=message_id',
        dbRecord,
        {
          headers: {
            Prefer: 'resolution=merge-duplicates',
          },
        },
      );

      this.logger.debug(`[消息处理记录] 已保存: ${record.messageId}`);
      return true;
    } catch (error) {
      this.logger.error(`[消息处理记录] 保存失败 [${record.messageId}]:`, error);
      return false;
    }
  }

  /**
   * 获取消息处理记录列表（支持时间范围过滤）
   * @param options 查询选项
   * @returns 消息处理记录列表
   */
  /**
   * 获取最慢的消息（按 AI 处理耗时降序排序）
   */
  async getSlowestMessages(
    startTime?: number,
    endTime?: number,
    limit: number = 10,
  ): Promise<any[]> {
    if (!this.isInitialized) {
      this.logger.warn('[最慢消息] Supabase 未初始化');
      return [];
    }

    try {
      const params: any = {
        // 过滤：只查询成功且有 AI 耗时的记录
        and: [],
        // 排序：按 ai_duration 降序
        order: 'ai_duration.desc',
        limit,
      };

      // 时间范围
      const conditions = ['status.eq.success', 'ai_duration.gt.0'];
      if (startTime) {
        conditions.push(`received_at.gte.${new Date(startTime).toISOString()}`);
      }
      if (endTime) {
        conditions.push(`received_at.lte.${new Date(endTime).toISOString()}`);
      }

      params.and = `(${conditions.join(',')})`;

      // 只选择需要的字段
      params.select =
        'message_id,chat_id,user_id,user_name,manager_name,received_at,message_preview,reply_preview,status,ai_duration,total_duration,scenario,tools,token_usage';

      const response = await this.supabaseHttpClient.get('/message_processing_records', {
        params,
      });

      return (response.data ?? []).map((row: any) => ({
        messageId: row.message_id,
        chatId: row.chat_id,
        userId: row.user_id,
        userName: row.user_name,
        managerName: row.manager_name,
        receivedAt: new Date(row.received_at).getTime(),
        messagePreview: row.message_preview,
        replyPreview: row.reply_preview,
        status: row.status,
        aiDuration: row.ai_duration,
        totalDuration: row.total_duration,
        scenario: row.scenario,
        tools: row.tools,
        tokenUsage: row.token_usage,
      }));
    } catch (error) {
      this.logger.error('[最慢消息] 查询失败:', error);
      return [];
    }
  }

  async getMessageProcessingRecords(options?: {
    startDate?: Date;
    endDate?: Date;
    status?: 'processing' | 'success' | 'failure';
    chatId?: string;
    limit?: number;
    offset?: number;
  }): Promise<any[]> {
    if (!this.isInitialized) {
      this.logger.warn('[消息处理记录] Supabase 未初始化');
      return [];
    }

    try {
      const params: any = {};

      // 时间范围过滤（使用 and 组合多个条件）
      if (options?.startDate && options?.endDate) {
        // 同时有开始和结束时间，使用 and 条件
        params.and = `(received_at.gte.${options.startDate.toISOString()},received_at.lte.${options.endDate.toISOString()})`;
      } else if (options?.startDate) {
        params.received_at = `gte.${options.startDate.toISOString()}`;
      } else if (options?.endDate) {
        params.received_at = `lte.${options.endDate.toISOString()}`;
      }

      // 状态过滤
      if (options?.status) {
        params.status = `eq.${options?.status}`;
      }

      // 会话ID过滤
      if (options?.chatId) {
        params.chat_id = `eq.${options.chatId}`;
      }

      // 排序和分页（默认按接收时间倒序）
      params.order = 'received_at.desc';
      if (options?.limit) {
        params.limit = options.limit;
      }
      if (options?.offset) {
        params.offset = options.offset;
      }

      // 只选择需要的字段，排除 agent_invocation（平均 677KB/行）以提升查询性能
      params.select =
        'message_id,chat_id,user_id,user_name,manager_name,received_at,message_preview,reply_preview,reply_segments,status,error,scenario,total_duration,queue_duration,prep_duration,ai_start_at,ai_end_at,ai_duration,send_duration,tools,token_usage,is_fallback,fallback_success';

      const response = await this.supabaseHttpClient.get('/message_processing_records', {
        params,
      });

      return (response.data ?? []).map((row: any) => ({
        messageId: row.message_id,
        chatId: row.chat_id,
        userId: row.user_id,
        userName: row.user_name,
        managerName: row.manager_name,
        receivedAt: new Date(row.received_at).getTime(),
        messagePreview: row.message_preview,
        replyPreview: row.reply_preview,
        replySegments: row.reply_segments,
        status: row.status,
        error: row.error,
        scenario: row.scenario,
        totalDuration: row.total_duration,
        queueDuration: row.queue_duration,
        prepDuration: row.prep_duration,
        aiStartAt: row.ai_start_at,
        aiEndAt: row.ai_end_at,
        aiDuration: row.ai_duration,
        sendDuration: row.send_duration,
        tools: row.tools,
        tokenUsage: row.token_usage,
        isFallback: row.is_fallback,
        fallbackSuccess: row.fallback_success,
        agentInvocation: row.agent_invocation,
      }));
    } catch (error) {
      this.logger.error('[消息处理记录] 查询失败:', error);
      return [];
    }
  }

  /**
   * 根据 messageId 获取单条消息处理记录详情（包含完整的 agent_invocation）
   * 用于弹窗按需加载详情，避免列表查询时传输大量 JSONB 数据
   * @param messageId 消息ID
   * @returns 完整的记录详情或 null
   */
  async getMessageProcessingRecordById(messageId: string): Promise<any | null> {
    if (!this.isInitialized) {
      this.logger.warn('[消息处理记录] Supabase 未初始化，跳过查询');
      return null;
    }

    try {
      const response = await this.supabaseHttpClient.get('/message_processing_records', {
        params: {
          message_id: `eq.${messageId}`,
          limit: 1,
        },
      });

      const rows = response.data ?? [];
      if (rows.length === 0) {
        this.logger.debug(`[消息处理记录] 未找到 messageId: ${messageId}`);
        return null;
      }

      const row = rows[0];
      return {
        messageId: row.message_id,
        chatId: row.chat_id,
        userId: row.user_id,
        userName: row.user_name,
        managerName: row.manager_name,
        receivedAt: new Date(row.received_at).getTime(),
        messagePreview: row.message_preview,
        replyPreview: row.reply_preview,
        replySegments: row.reply_segments,
        status: row.status,
        error: row.error,
        scenario: row.scenario,
        totalDuration: row.total_duration,
        queueDuration: row.queue_duration,
        prepDuration: row.prep_duration,
        aiStartAt: row.ai_start_at,
        aiEndAt: row.ai_end_at,
        aiDuration: row.ai_duration,
        sendDuration: row.send_duration,
        tools: row.tools,
        tokenUsage: row.token_usage,
        isFallback: row.is_fallback,
        fallbackSuccess: row.fallback_success,
        agentInvocation: row.agent_invocation, // 包含完整的 agent_invocation
      };
    } catch (error) {
      this.logger.error(`[消息处理记录] 查询详情失败 (messageId: ${messageId}):`, error);
      return null;
    }
  }

  /**
   * 清理过期的消息处理记录
   * @param retentionDays 保留天数，默认 30 天
   * @returns 删除的记录数量
   */
  async cleanupMessageProcessingRecords(retentionDays: number = 30): Promise<number> {
    if (!this.isInitialized) {
      this.logger.warn('[消息处理记录] Supabase 未初始化，跳过清理');
      return 0;
    }

    try {
      const response = await this.supabaseHttpClient.post(
        '/rpc/cleanup_message_processing_records',
        {
          days_to_keep: retentionDays,
        },
      );

      const deletedCount = response.data ?? 0;
      if (deletedCount > 0) {
        this.logger.log(
          `✅ [消息处理记录] 清理完成: 删除 ${deletedCount} 条 ${retentionDays} 天前的记录`,
        );
      }
      return deletedCount;
    } catch (error) {
      this.logger.error('[消息处理记录] 清理失败:', error);
      return 0;
    }
  }
}
