import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { RedisService } from '@core/redis';
import { ChatResponse } from '../utils/types';

/**
 * 缓存键生成参数接口
 */
export interface CacheKeyParams {
  model: string;
  messages: any[];
  tools?: string[];
  context?: any;
  toolContext?: any;
  systemPrompt?: string;
  promptType?: string;
}

/**
 * Agent 缓存服务（基于 Upstash Redis）
 * 负责统一管理所有缓存，包括响应缓存
 *
 * 优势：
 * 1. 分布式缓存，支持多实例部署
 * 2. 持久化存储，服务重启不丢失
 * 3. 自动过期（Redis TTL），无需手动清理
 * 4. 无内存溢出风险
 * 5. 使用集中式 RedisService，便于管理和复用
 *
 * 职责：
 * 1. 生成缓存键
 * 2. 存储和检索缓存的响应（使用 Redis）
 * 3. 控制缓存大小（单条限制）
 * 4. 提供缓存统计信息
 */
@Injectable()
export class AgentCacheService {
  private readonly logger = new Logger(AgentCacheService.name);

  // 缓存配置
  private readonly responseCacheTTL: number; // TTL（秒）
  private readonly maxItemSizeBytes: number; // 单条最大大小（字节）

  // 缓存键前缀
  private readonly CACHE_PREFIX = 'agent:response:';

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {
    // 从环境变量读取缓存配置，提供默认值避免 NaN
    // 默认 TTL: 3600 秒（1小时）
    // 默认最大大小: 100 KB
    this.responseCacheTTL = this.configService.get<number>(
      'AGENT_RESPONSE_CACHE_TTL_SECONDS',
      3600,
    );

    const maxItemSizeKB = this.configService.get<number>(
      'AGENT_RESPONSE_CACHE_MAX_ITEM_SIZE_KB',
      100,
    );
    this.maxItemSizeBytes = maxItemSizeKB * 1024;

    this.logger.log(`Agent 响应缓存已启用（使用集中式 RedisService）`);
    this.logger.log(
      `响应缓存 TTL: ${this.responseCacheTTL} 秒 (${this.responseCacheTTL / 60} 分钟)`,
    );
    this.logger.log(`单条最大大小: ${this.maxItemSizeBytes / 1024} KB`);
  }

  /**
   * 生成缓存键
   * 基于消息历史、模型、工具和上下文生成唯一键
   *
   * 注意：不包含 conversationId，允许不同会话共享缓存
   * （相同的对话历史和参数应该得到相同的响应）
   *
   * @param params 缓存键参数
   * @returns SHA-256 哈希值
   */
  generateCacheKey(params: CacheKeyParams): string {
    const keyParts = {
      model: params.model,
      // 消息摘要（数量 + 最近消息的哈希）
      messageCount: params.messages.length,
      messagesHash: this.hashMessages(params.messages),
      // 工具列表（排序后）- 使用数组副本避免修改原数组
      tools: params.tools ? [...params.tools].sort().join(',') : 'none',
      // 上下文摘要
      contextHash: params.context ? this.hashObject(params.context) : 'none',
      toolContextHash: params.toolContext ? this.hashObject(params.toolContext) : 'none',
      // 其他影响响应的参数
      systemPromptHash: params.systemPrompt ? this.hashString(params.systemPrompt) : 'none',
      // 提示类型（影响响应格式）
      promptType: params.promptType || 'default',
    };

    // 生成最终的哈希键
    const keyString = JSON.stringify(keyParts);
    const hash = createHash('sha256').update(keyString).digest('hex');

    // 添加前缀
    return `${this.CACHE_PREFIX}${hash}`;
  }

  /**
   * 从缓存获取响应
   *
   * @param key 缓存键
   * @returns 缓存的响应，如果不存在或已过期返回 null
   */
  async get(key: string): Promise<ChatResponse | null> {
    try {
      const cached = await this.redisService.get<ChatResponse>(key);

      if (!cached) {
        return null;
      }

      this.logger.debug(`缓存命中: ${this.formatKey(key)}`);
      return cached;
    } catch (error) {
      this.logger.error(`获取缓存失败: ${this.formatKey(key)}`, error);
      return null;
    }
  }

  /**
   * 保存响应到缓存
   *
   * @param key 缓存键
   * @param response 要缓存的响应
   */
  async set(key: string, response: ChatResponse): Promise<void> {
    try {
      // 检查数据大小
      const itemSize = this.estimateSize(response);

      if (itemSize > this.maxItemSizeBytes) {
        this.logger.warn(
          `响应过大 (${(itemSize / 1024).toFixed(2)}KB)，超过限制 (${this.maxItemSizeBytes / 1024}KB)，不缓存`,
        );
        return;
      }

      // 保存到 Redis，设置 TTL（秒）
      // RedisService.setex 自动处理 JSON.stringify
      await this.redisService.setex(key, this.responseCacheTTL, response);

      this.logger.debug(
        `缓存已保存: ${this.formatKey(key)} (大小: ${(itemSize / 1024).toFixed(2)}KB, TTL: ${this.responseCacheTTL}s)`,
      );
    } catch (error) {
      this.logger.error(`保存缓存失败: ${this.formatKey(key)}`, error);
    }
  }

  /**
   * 判断是否应该缓存此次响应
   * 只缓存没有实际使用工具且无上下文的简单查询
   *
   * @param params 缓存判断参数
   * @returns 是否应该缓存
   */
  shouldCache(params: {
    usedTools?: string[]; // 实际使用的工具（来自响应）
    context?: any;
    toolContext?: any;
  }): boolean {
    // 检查是否实际使用了工具（而不是检查 allowedTools）
    const hasUsedTools = params.usedTools && params.usedTools.length > 0;
    const hasContext = params.context && Object.keys(params.context).length > 0;
    const hasToolContext = params.toolContext && Object.keys(params.toolContext).length > 0;

    const shouldCache = !hasUsedTools && !hasContext && !hasToolContext;

    if (!shouldCache) {
      this.logger.debug(
        `不缓存此次响应: usedTools=${hasUsedTools ? params.usedTools?.join(',') : 'none'}, context=${hasContext}, toolContext=${hasToolContext}`,
      );
    } else {
      this.logger.debug('缓存此次响应: 未使用工具且无上下文');
    }

    return shouldCache;
  }

  /**
   * 清空所有缓存
   */
  async clear(): Promise<void> {
    try {
      // 使用 SCAN 查找所有匹配前缀的键
      const keys: string[] = [];
      let cursor: string | number = 0;

      do {
        const result = await this.redisService.scan(cursor, {
          match: `${this.CACHE_PREFIX}*`,
          count: 100,
        });
        cursor = result[0];
        keys.push(...result[1]);
      } while (cursor !== 0 && cursor !== '0');

      // 批量删除
      if (keys.length > 0) {
        await this.redisService.del(...keys);
        this.logger.log(`已清空响应缓存: ${keys.length} 个条目`);
      } else {
        this.logger.log('缓存为空，无需清空');
      }
    } catch (error) {
      this.logger.error('清空缓存失败:', error);
    }
  }

  /**
   * 删除过期的缓存条目
   * 注意：Redis 会自动删除过期的键，此方法主要用于统计
   * @returns 删除的条目数量
   */
  async evictExpired(): Promise<number> {
    // Redis 自动处理过期，返回 0
    this.logger.debug('Redis 自动处理过期缓存，无需手动清理');
    return 0;
  }

  /**
   * 获取缓存统计信息
   */
  async getStats() {
    try {
      // 使用 SCAN 统计所有缓存键
      const keys: string[] = [];
      let cursor: string | number = 0;

      do {
        const result = await this.redisService.scan(cursor, {
          match: `${this.CACHE_PREFIX}*`,
          count: 100,
        });
        cursor = result[0];
        keys.push(...result[1]);
      } while (cursor !== 0 && cursor !== '0');

      const size = keys.length;

      // 获取 Redis 内存使用情况
      let totalMemoryBytes = 0;
      if (size > 0) {
        // 采样计算平均大小（最多采样 10 个）
        const sampleSize = Math.min(10, size);
        const sampleKeys = keys.slice(0, sampleSize);

        for (const key of sampleKeys) {
          const value = await this.redisService.get(key);
          if (value) {
            totalMemoryBytes += this.estimateSize(value);
          }
        }

        // 估算总内存
        totalMemoryBytes = Math.round((totalMemoryBytes / sampleSize) * size);
      }

      return {
        size,
        ttl: this.responseCacheTTL,
        ttlFormatted: `${this.responseCacheTTL} 秒 (${this.responseCacheTTL / 60} 分钟)`,
        estimatedMemoryMB: (totalMemoryBytes / 1024 / 1024).toFixed(2),
        estimatedMemoryKB: (totalMemoryBytes / 1024).toFixed(2),
        maxItemSizeKB: this.maxItemSizeBytes / 1024,
        cacheType: 'Redis (Upstash) via RedisService',
        autoExpire: true,
      };
    } catch (error) {
      this.logger.error('获取缓存统计失败:', error);
      return {
        size: 0,
        ttl: this.responseCacheTTL,
        error: error.message,
      };
    }
  }

  // ========== 私有辅助方法 ==========

  /**
   * 估算数据大小（字节）
   */
  private estimateSize(data: any): number {
    const json = JSON.stringify(data);
    return Buffer.byteLength(json, 'utf8');
  }

  /**
   * 对消息列表生成哈希
   * 只取最后3条消息进行哈希，避免键过长
   */
  private hashMessages(messages: any[]): string {
    const recentMessages = messages.slice(-3);
    const content = recentMessages
      .map((msg) => {
        const text =
          'content' in msg ? msg.content : msg.parts?.map((p: any) => p.text).join('') || '';
        return `${msg.role}:${text}`;
      })
      .join('|');
    return this.hashString(content);
  }

  /**
   * 对对象生成哈希
   */
  private hashObject(obj: any): string {
    return this.hashString(JSON.stringify(obj));
  }

  /**
   * 对字符串生成哈希
   * 使用 SHA-256，取前16个字符
   */
  private hashString(str: string): string {
    return createHash('sha256').update(str).digest('hex').substring(0, 16);
  }

  /**
   * 格式化缓存键，只显示前8个字符
   */
  private formatKey(key: string): string {
    const hash = key.replace(this.CACHE_PREFIX, '');
    return `${hash.substring(0, 8)}...`;
  }

  /**
   * 从缓存获取或调用函数存储
   * 封装了完整的缓存逻辑：生成键 → 尝试获取 → 未命中则调用函数 → 存储结果
   *
   * @param params 缓存键参数
   * @param fetchFn 获取数据的函数（缓存未命中时调用）
   * @param shouldCacheFn 判断是否应该缓存的函数（可选，默认总是缓存）
   * @returns 数据和是否来自缓存的标志
   */
  async fetchOrStore(
    params: CacheKeyParams,
    fetchFn: () => Promise<ChatResponse>,
    shouldCacheFn?: (response: ChatResponse) => boolean,
  ): Promise<{ data: ChatResponse; fromCache: boolean }> {
    // 1. 生成缓存键
    const cacheKey = this.generateCacheKey(params);

    // 2. 尝试从缓存获取
    const cached = await this.get(cacheKey);
    if (cached) {
      this.logger.debug(`缓存命中: ${this.formatKey(cacheKey)}`);
      return { data: cached, fromCache: true };
    }

    // 3. 缓存未命中，调用函数获取数据
    this.logger.debug(`缓存未命中，调用函数获取数据: ${this.formatKey(cacheKey)}`);
    const data = await fetchFn();

    // 4. 判断是否应该缓存
    const shouldCache = shouldCacheFn ? shouldCacheFn(data) : true;
    if (shouldCache) {
      await this.set(cacheKey, data);
    }

    return { data, fromCache: false };
  }
}
