import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosInstance } from 'axios';
import { HttpClientFactory } from '@core/client-http';
import { RedisService } from '@core/redis';
import { StorageMessageType, StorageMessageSource, StorageContactType } from '@wecom/message/enums';

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
export interface ChatMessageRecord {
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
 * Supabase 基础服务（精简版）
 *
 * 重构后职责：
 * - 提供 HTTP 客户端给 Repository 层使用
 * - 提供 Redis 服务给 Repository 层使用
 * - 提供配置服务给 Repository 层使用
 *
 * 所有业务逻辑已迁移到专门的 Repository：
 * - SystemConfigRepository: 系统配置管理
 * - UserHostingRepository: 用户托管状态
 * - GroupBlacklistRepository: 群组黑名单
 * - ChatMessageRepository: 聊天消息
 * - MonitoringRepository: 监控统计
 * - MessageProcessingRepository: 消息处理记录
 * - BookingRepository: 预约统计
 */
@Injectable()
export class SupabaseService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseService.name);

  // HTTP 客户端
  private supabaseHttpClient: AxiosInstance;

  // 缓存配置（供 Repository 使用）
  private readonly CACHE_PREFIX = 'supabase:';

  // 配置
  private isInitialized = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpClientFactory: HttpClientFactory,
    private readonly redisService: RedisService,
  ) {
    this.initClient();
  }

  async onModuleInit() {
    this.logger.log('✅ Supabase 基础服务初始化完成');
  }

  /**
   * 初始化 Supabase HTTP 客户端
   */
  private initClient(): void {
    const supabaseUrl = this.configService.get<string>('NEXT_PUBLIC_SUPABASE_URL', '');
    const supabaseKey =
      this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY') ||
      this.configService.get<string>('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');

    if (!supabaseUrl || !supabaseKey) {
      this.logger.warn('⚠️ Supabase 配置缺失，系统配置持久化功能将使用内存模式');
      return;
    }

    this.supabaseHttpClient = this.httpClientFactory.createWithBearerAuth(
      {
        baseURL: `${supabaseUrl}/rest/v1`,
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

  // ==================== 公共接口（供 Repository 使用） ====================

  /**
   * 获取 HTTP 客户端
   */
  getHttpClient(): AxiosInstance | null {
    return this.isInitialized ? this.supabaseHttpClient : null;
  }

  /**
   * 检查客户端是否已初始化
   */
  isClientInitialized(): boolean {
    return this.isInitialized;
  }

  /**
   * 检查是否可用（isClientInitialized 的别名）
   */
  isAvailable(): boolean {
    return this.isInitialized;
  }

  /**
   * 获取 Redis 服务
   */
  getRedisService(): RedisService {
    return this.redisService;
  }

  /**
   * 获取缓存前缀
   */
  getCachePrefix(): string {
    return this.CACHE_PREFIX;
  }

  /**
   * 获取配置服务
   */
  getConfigService(): ConfigService {
    return this.configService;
  }
}
