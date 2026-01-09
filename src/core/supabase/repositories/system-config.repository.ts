import { Injectable } from '@nestjs/common';
import { BaseRepository } from './base.repository';
import { SupabaseService } from '../supabase.service';

/**
 * 系统配置键枚举
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
 * 系统配置数据库记录
 */
interface SystemConfigRecord {
  key: string;
  value: unknown;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * 系统配置 Repository
 *
 * 负责管理 system_config 表的操作：
 * - AI 回复开关
 * - 消息聚合开关
 * - Agent 回复策略配置
 * - 系统配置（Worker 并发数等）
 */
@Injectable()
export class SystemConfigRepository extends BaseRepository {
  protected readonly tableName = 'system_config';

  // 缓存 TTL
  private readonly CONFIG_CACHE_TTL = 300; // 5分钟
  private readonly AGENT_CONFIG_CACHE_TTL = 60; // 1分钟

  // 内存缓存
  private aiReplyEnabled: boolean | null = null;
  private messageMergeEnabled: boolean | null = null;
  private agentReplyConfig: AgentReplyConfig | null = null;
  private agentReplyConfigExpiry = 0;

  // 配置变更回调列表
  private readonly configChangeCallbacks: Array<(config: AgentReplyConfig) => void> = [];

  constructor(supabaseService: SupabaseService) {
    super(supabaseService);
  }

  // ==================== AI 回复开关 ====================

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
    const cacheKey = `${this.supabaseService.getCachePrefix()}config:ai_reply_enabled`;
    const redis = this.supabaseService.getRedisService();
    const cached = await redis.get<boolean>(cacheKey);
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
    const configService = this.supabaseService.getConfigService();
    const defaultValue = configService.get<string>('ENABLE_AI_REPLY', 'true') === 'true';

    if (!this.isAvailable()) {
      this.aiReplyEnabled = defaultValue;
      return defaultValue;
    }

    try {
      const result = await this.selectOne<SystemConfigRecord>({
        key: 'eq.ai_reply_enabled',
        select: 'value',
      });

      if (result) {
        const value = result.value;
        this.aiReplyEnabled = value === true || value === 'true';
      } else {
        // 数据库中没有记录，使用默认值并初始化
        this.aiReplyEnabled = defaultValue;
        await this.initConfig('ai_reply_enabled', defaultValue, 'AI 自动回复功能开关');
      }

      // 更新 Redis 缓存
      const cacheKey = `${this.supabaseService.getCachePrefix()}config:ai_reply_enabled`;
      const redis = this.supabaseService.getRedisService();
      await redis.setex(cacheKey, this.CONFIG_CACHE_TTL, this.aiReplyEnabled);

      this.logger.log(`AI 回复开关状态已加载: ${this.aiReplyEnabled}`);
      return this.aiReplyEnabled;
    } catch (error) {
      this.logger.error('加载 AI 回复状态失败，使用默认值', error);
      this.aiReplyEnabled = defaultValue;
      return defaultValue;
    }
  }

  /**
   * 设置 AI 回复开关状态
   */
  async setAiReplyEnabled(enabled: boolean): Promise<boolean> {
    // 更新内存缓存
    this.aiReplyEnabled = enabled;

    // 更新 Redis 缓存
    const cacheKey = `${this.supabaseService.getCachePrefix()}config:ai_reply_enabled`;
    const redis = this.supabaseService.getRedisService();
    await redis.setex(cacheKey, this.CONFIG_CACHE_TTL, enabled);

    // 更新数据库
    if (this.isAvailable()) {
      try {
        await this.update({ key: 'eq.ai_reply_enabled' }, { value: enabled });
        this.logger.log(`AI 回复开关已更新为: ${enabled}`);
      } catch (error) {
        this.logger.error('更新 AI 回复状态到数据库失败', error);
      }
    }

    return enabled;
  }

  // ==================== 消息聚合开关 ====================

  /**
   * 获取消息聚合开关状态
   */
  async getMessageMergeEnabled(): Promise<boolean> {
    // 1. 内存缓存
    if (this.messageMergeEnabled !== null) {
      return this.messageMergeEnabled;
    }

    // 2. Redis 缓存
    const cacheKey = `${this.supabaseService.getCachePrefix()}config:message_merge_enabled`;
    const redis = this.supabaseService.getRedisService();
    const cached = await redis.get<boolean>(cacheKey);
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
    const configService = this.supabaseService.getConfigService();
    const defaultValue = configService.get<string>('ENABLE_MESSAGE_MERGE', 'true') === 'true';

    if (!this.isAvailable()) {
      this.messageMergeEnabled = defaultValue;
      return defaultValue;
    }

    try {
      const result = await this.selectOne<SystemConfigRecord>({
        key: 'eq.message_merge_enabled',
        select: 'value',
      });

      if (result) {
        const value = result.value;
        this.messageMergeEnabled = value === true || value === 'true';
      } else {
        this.messageMergeEnabled = defaultValue;
        await this.initConfig(
          'message_merge_enabled',
          defaultValue,
          '消息聚合功能开关（多条消息合并发送给 AI）',
        );
      }

      // 更新 Redis 缓存
      const cacheKey = `${this.supabaseService.getCachePrefix()}config:message_merge_enabled`;
      const redis = this.supabaseService.getRedisService();
      await redis.setex(cacheKey, this.CONFIG_CACHE_TTL, this.messageMergeEnabled);

      this.logger.log(`消息聚合开关状态已加载: ${this.messageMergeEnabled}`);
      return this.messageMergeEnabled;
    } catch (error) {
      this.logger.error('加载消息聚合开关状态失败，使用默认值', error);
      this.messageMergeEnabled = defaultValue;
      return defaultValue;
    }
  }

  /**
   * 设置消息聚合开关状态
   */
  async setMessageMergeEnabled(enabled: boolean): Promise<boolean> {
    // 更新内存缓存
    this.messageMergeEnabled = enabled;

    // 更新 Redis 缓存
    const cacheKey = `${this.supabaseService.getCachePrefix()}config:message_merge_enabled`;
    const redis = this.supabaseService.getRedisService();
    await redis.setex(cacheKey, this.CONFIG_CACHE_TTL, enabled);

    // 更新数据库
    if (this.isAvailable()) {
      try {
        await this.update({ key: 'eq.message_merge_enabled' }, { value: enabled });
        this.logger.log(`消息聚合开关已更新为: ${enabled}`);
      } catch (error) {
        this.logger.error('更新消息聚合状态到数据库失败', error);
      }
    }

    return enabled;
  }

  // ==================== Agent 回复策略配置 ====================

  /**
   * 获取 Agent 回复策略配置
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
   * 从数据库加载 Agent 回复策略配置
   */
  private async loadAgentReplyConfig(): Promise<AgentReplyConfig> {
    // 1. 先尝试从 Redis 加载
    const cacheKey = `${this.supabaseService.getCachePrefix()}config:agent_reply_config`;
    const redis = this.supabaseService.getRedisService();
    const cached = await redis.get<AgentReplyConfig>(cacheKey);

    if (cached) {
      this.agentReplyConfig = { ...DEFAULT_AGENT_REPLY_CONFIG, ...cached };
      this.agentReplyConfigExpiry = Date.now() + this.AGENT_CONFIG_CACHE_TTL * 1000;
      this.logger.debug('已从 Redis 加载 Agent 回复策略配置');
      return this.agentReplyConfig;
    }

    // 2. 从数据库加载
    if (!this.isAvailable()) {
      this.agentReplyConfig = { ...DEFAULT_AGENT_REPLY_CONFIG };
      this.agentReplyConfigExpiry = Date.now() + this.AGENT_CONFIG_CACHE_TTL * 1000;
      return this.agentReplyConfig;
    }

    try {
      const result = await this.selectOne<SystemConfigRecord>({
        key: 'eq.agent_reply_config',
        select: 'value',
      });

      if (result) {
        const dbConfig = result.value as Partial<AgentReplyConfig>;
        this.agentReplyConfig = { ...DEFAULT_AGENT_REPLY_CONFIG, ...dbConfig };
      } else {
        this.agentReplyConfig = { ...DEFAULT_AGENT_REPLY_CONFIG };
        await this.initConfig(
          'agent_reply_config',
          DEFAULT_AGENT_REPLY_CONFIG,
          'Agent 回复策略配置（消息聚合、打字延迟、告警节流）',
        );
      }

      // 更新 Redis 缓存
      await redis.setex(cacheKey, this.AGENT_CONFIG_CACHE_TTL, this.agentReplyConfig);

      this.agentReplyConfigExpiry = Date.now() + this.AGENT_CONFIG_CACHE_TTL * 1000;
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
    this.agentReplyConfigExpiry = Date.now() + this.AGENT_CONFIG_CACHE_TTL * 1000;

    // 更新 Redis 缓存
    const cacheKey = `${this.supabaseService.getCachePrefix()}config:agent_reply_config`;
    const redis = this.supabaseService.getRedisService();
    await redis.setex(cacheKey, this.AGENT_CONFIG_CACHE_TTL, newConfig);

    // 更新数据库
    if (this.isAvailable()) {
      try {
        const updated = await this.update({ key: 'eq.agent_reply_config' }, { value: newConfig });

        // 如果没有更新到任何记录，则插入
        if (!updated || updated.length === 0) {
          await this.insert({
            key: 'agent_reply_config',
            value: newConfig,
            description: 'Agent 回复策略配置（消息聚合、打字延迟、告警节流）',
          });
        }

        this.logger.log('Agent 回复策略配置已更新');
      } catch (error) {
        this.logger.error('更新 Agent 回复策略配置到数据库失败', error);
      }
    }

    // 通知所有订阅者配置已变更
    this.notifyConfigChange(newConfig);

    return newConfig;
  }

  /**
   * 注册配置变更回调
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
    const cacheKey = `${this.supabaseService.getCachePrefix()}config:system_config`;
    const redis = this.supabaseService.getRedisService();
    const cached = await redis.get<SystemConfig>(cacheKey);

    if (cached) {
      return cached;
    }

    // 2. 从数据库加载
    if (!this.isAvailable()) {
      return null;
    }

    try {
      const result = await this.selectOne<SystemConfigRecord>({
        key: 'eq.system_config',
        select: 'value',
      });

      if (result) {
        const config = result.value as SystemConfig;
        await redis.setex(cacheKey, this.CONFIG_CACHE_TTL, config);
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
    const cacheKey = `${this.supabaseService.getCachePrefix()}config:system_config`;
    const redis = this.supabaseService.getRedisService();
    await redis.setex(cacheKey, this.CONFIG_CACHE_TTL, newConfig);

    // 更新数据库
    if (this.isAvailable()) {
      try {
        const updated = await this.update({ key: 'eq.system_config' }, { value: newConfig });

        if (!updated || updated.length === 0) {
          await this.insert({
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

  // ==================== 缓存管理 ====================

  /**
   * 刷新所有缓存
   */
  async refreshCache(): Promise<void> {
    this.aiReplyEnabled = null;
    this.messageMergeEnabled = null;
    this.agentReplyConfigExpiry = 0;

    await this.loadAiReplyStatus();
    await this.loadMessageMergeStatus();
    await this.loadAgentReplyConfig();

    this.logger.log('系统配置缓存已刷新');
  }

  // ==================== 私有方法 ====================

  /**
   * 初始化配置项（首次运行时）
   */
  private async initConfig(key: string, value: unknown, description: string): Promise<void> {
    if (!this.isAvailable()) return;

    try {
      await this.insert({
        key,
        value,
        description,
      });
      this.logger.log(`配置项 ${key} 已初始化到数据库`);
    } catch {
      // 忽略重复键错误
      this.logger.debug(`配置项 ${key} 可能已存在`);
    }
  }
}
