import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from '@upstash/redis';

/**
 * Redis 服务（基于 Upstash）
 * 提供统一的 Redis 客户端，供所有模块使用
 *
 * 优势：
 * 1. 单例模式，所有模块共享同一个 Redis 连接
 * 2. 配置集中管理
 * 3. 便于测试（可注入 mock）
 * 4. 符合 NestJS 依赖注入模式
 */
@Injectable()
export class RedisService implements OnModuleInit {
  private readonly logger = new Logger(RedisService.name);
  private redisClient: Redis;

  constructor(private readonly configService: ConfigService) {
    this.initializeClient();
  }

  /**
   * 初始化 Redis 客户端
   */
  private initializeClient() {
    const redisUrl = this.configService.get<string>('UPSTASH_REDIS_REST_URL');
    const redisToken = this.configService.get<string>('UPSTASH_REDIS_REST_TOKEN');

    this.redisClient = new Redis({
      url: redisUrl,
      token: redisToken,
    });

    this.logger.log('Redis 客户端已初始化');
  }

  /**
   * 模块初始化：测试连接
   */
  async onModuleInit() {
    try {
      await this.redisClient.ping();
      this.logger.log('✓ Redis 连接测试成功');
    } catch (error) {
      this.logger.error('✗ Redis 连接测试失败:', error);
      throw error;
    }
  }

  /**
   * 获取 Redis 客户端实例
   */
  getClient(): Redis {
    return this.redisClient;
  }

  /**
   * 便捷方法：get
   */
  async get<T = any>(key: string): Promise<T | null> {
    return this.redisClient.get<T>(key);
  }

  /**
   * 便捷方法：set
   */
  async set(key: string, value: any): Promise<void> {
    await this.redisClient.set(key, value);
  }

  /**
   * 便捷方法：setex (带过期时间)
   */
  async setex(key: string, seconds: number, value: any): Promise<void> {
    await this.redisClient.setex(key, seconds, value);
  }

  /**
   * 便捷方法：del
   */
  async del(...keys: string[]): Promise<number> {
    return this.redisClient.del(...keys);
  }

  /**
   * 便捷方法：exists
   */
  async exists(...keys: string[]): Promise<number> {
    return this.redisClient.exists(...keys);
  }

  /**
   * 便捷方法：scan
   */
  async scan(
    cursor: string | number,
    options?: { match?: string; count?: number },
  ): Promise<[string | number, string[]]> {
    return this.redisClient.scan(cursor, options);
  }

  /**
   * 便捷方法：ping
   */
  async ping(): Promise<string> {
    return this.redisClient.ping();
  }
}
