import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosInstance } from 'axios';
import { RedisService } from '@core/redis';
import { HttpClientFactory } from '@core/http';
import { FeiShuAlertService } from '@/core/alert/feishu-alert.service';

/**
 * 品牌配置接口
 */
export interface BrandConfig {
  synced: boolean;
  brandData?: any;
  replyPrompts?: any;
  metadata?: {
    lastUpdated?: string;
    [key: string]: any;
  };
  lastRefreshTime?: string;
}

/**
 * 品牌配置状态接口
 */
export interface BrandConfigStatus {
  available: boolean;
  synced: boolean;
  hasBrandData: boolean;
  hasReplyPrompts: boolean;
  lastRefreshTime: string | null;
  lastUpdated: string | null;
}

/**
 * 品牌配置服务
 * 负责管理品牌配置的获取、刷新、缓存
 *
 * 职责：
 * 1. 从 Supabase Storage 获取品牌配置
 * 2. 缓存品牌配置到 Redis
 * 3. 定时刷新品牌配置
 * 4. 提供品牌配置状态查询
 * 5. 首次加载失败时的重试机制
 */
@Injectable()
export class BrandConfigService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BrandConfigService.name);

  // 缓存配置
  private readonly BRAND_CONFIG_CACHE_KEY = 'agent:brand-config';
  private readonly BRAND_CONFIG_REFRESH_INTERVAL = 5 * 60 * 1000; // 5分钟
  private readonly BRAND_CONFIG_RETRY_INTERVAL = 1 * 60 * 1000; // 1分钟

  // Supabase 客户端
  private supabaseHttpClient: AxiosInstance;
  private supabaseBucketName: string;
  private supabaseBrandConfigPath: string;

  // 定时器
  private brandConfigRefreshTimer: NodeJS.Timeout | null = null;
  private brandConfigRetryTimer: NodeJS.Timeout | null = null;

  // 状态
  private brandConfigAvailable = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly httpClientFactory: HttpClientFactory,
    private readonly feiShuAlertService: FeiShuAlertService,
  ) {
    this.initSupabaseClient();
  }

  /**
   * 模块初始化
   */
  async onModuleInit() {
    await this.refreshBrandConfig();
    this.startAutoRefresh();
  }

  /**
   * 模块销毁
   */
  onModuleDestroy() {
    this.stopTimers();
  }

  /**
   * 获取品牌配置（从缓存）
   */
  async getBrandConfig(): Promise<BrandConfig | null> {
    try {
      const cached = await this.redisService.get<BrandConfig>(this.BRAND_CONFIG_CACHE_KEY);

      if (cached) {
        return cached;
      }

      if (!this.brandConfigAvailable) {
        this.logger.error('⚠️ 品牌配置不可用，Agent 服务无法正常提供服务');
        return null;
      }

      // 尝试主动刷新
      await this.refreshBrandConfig();
      return await this.redisService.get<BrandConfig>(this.BRAND_CONFIG_CACHE_KEY);
    } catch (error) {
      this.logger.error('获取品牌配置失败:', error);
      return null;
    }
  }

  /**
   * 刷新品牌配置（从 Supabase）
   */
  async refreshBrandConfig(): Promise<void> {
    try {
      this.logger.log('正在从 Supabase 存储刷新品牌配置...');

      // 构建 Supabase Storage 请求路径
      const encodedPath = this.supabaseBrandConfigPath
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');
      const storagePath = `/object/${this.supabaseBucketName}/${encodedPath}`;

      this.logger.debug(`请求 Supabase Storage: ${storagePath}`);

      const response = await this.supabaseHttpClient.get(storagePath);

      if (!response.data) {
        throw new Error('Supabase 存储返回空数据');
      }

      // 处理响应格式
      let brandConfig: BrandConfig;

      if (response.data.success === true) {
        brandConfig = response.data.data;
      } else if (response.data.synced !== undefined) {
        brandConfig = response.data;
      } else {
        this.logger.warn('品牌配置格式不标准，尝试直接使用');
        brandConfig = {
          synced: true,
          brandData: response.data.brandData || response.data,
          replyPrompts: response.data.replyPrompts,
          metadata: response.data.metadata,
        };
      }

      // 验证必需字段
      if (typeof brandConfig.synced !== 'boolean') {
        this.logger.warn('品牌配置缺少 synced 字段，默认设置为 true');
        brandConfig.synced = true;
      }

      // 添加时间戳
      const brandConfigWithTimestamp: BrandConfig = {
        ...brandConfig,
        lastRefreshTime: brandConfig.lastRefreshTime || new Date().toISOString(),
      };

      // 存储到 Redis（TTL: 5.5分钟，留30秒缓冲）
      await this.redisService.setex(this.BRAND_CONFIG_CACHE_KEY, 330, brandConfigWithTimestamp);

      this.brandConfigAvailable = true;

      // 首次加载成功，清除重试定时器
      if (this.brandConfigRetryTimer) {
        clearInterval(this.brandConfigRetryTimer);
        this.brandConfigRetryTimer = null;
        this.logger.log('✅ 品牌配置加载成功，重试定时器已清除');
      }

      this.logger.log(
        `✅ 品牌配置从 Supabase 刷新成功 (同步状态: ${brandConfig.synced ? '已同步' : '未同步'}, 更新时间: ${brandConfig.metadata?.lastUpdated || '未知'})`,
      );

      if (!brandConfig.synced) {
        this.logger.warn('⚠️ 品牌配置未同步，可能影响服务质量');
      }
    } catch (error: any) {
      this.logger.error('❌ 从 Supabase 刷新品牌配置失败，Agent 服务将无法正常工作', error);

      const isFirstLoad = !this.brandConfigAvailable;

      if (isFirstLoad) {
        this.logger.error('⚠️ 首次加载品牌配置失败，服务启动但功能受限');
        this.startRetry();
      }

      // 发送飞书告警
      await this.feiShuAlertService.sendBrandConfigUnavailableAlert(error, isFirstLoad);
    }
  }

  /**
   * 检查品牌配置是否可用
   */
  isBrandConfigAvailable(): boolean {
    return this.brandConfigAvailable;
  }

  /**
   * 获取品牌配置状态
   */
  async getBrandConfigStatus(): Promise<BrandConfigStatus> {
    const config = await this.getBrandConfig();

    return {
      available: this.brandConfigAvailable,
      synced: config?.synced || false,
      hasBrandData: !!config?.brandData,
      hasReplyPrompts: !!config?.replyPrompts,
      lastRefreshTime: config?.lastRefreshTime || null,
      lastUpdated: config?.metadata?.lastUpdated || null,
    };
  }

  // ==================== 私有方法 ====================

  /**
   * 初始化 Supabase 客户端
   */
  private initSupabaseClient(): void {
    const supabaseUrl = this.configService.get<string>('NEXT_PUBLIC_SUPABASE_URL');
    const supabaseKey =
      this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY') ||
      this.configService.get<string>('NEXT_PUBLIC_SUPABASE_ANON_KEY');

    if (!supabaseUrl || !supabaseKey) {
      this.logger.error(
        '⚠️ Supabase 配置缺失（NEXT_PUBLIC_SUPABASE_URL 或密钥），品牌配置功能将不可用',
      );
      throw new Error('Supabase configuration is required for brand config management');
    }

    this.supabaseBucketName = this.configService.get<string>(
      'SUPABASE_BUCKET_NAME',
      'brand-configs',
    );
    this.supabaseBrandConfigPath = this.configService.get<string>(
      'SUPABASE_BRAND_CONFIG_PATH',
      'config/brand-data.json',
    );

    this.supabaseHttpClient = this.httpClientFactory.createWithBearerAuth(
      {
        baseURL: `${supabaseUrl}/storage/v1`,
        timeout: 20000, // 20秒超时，考虑到网络延迟和文件大小
        logPrefix: '[Supabase Storage]',
        verbose: false,
      },
      supabaseKey,
    );

    this.logger.log(
      `✅ Supabase 品牌配置管理已初始化 (桶: ${this.supabaseBucketName}, 路径: ${this.supabaseBrandConfigPath})`,
    );
  }

  /**
   * 启动自动刷新定时器
   */
  private startAutoRefresh(): void {
    if (this.brandConfigRefreshTimer) {
      clearInterval(this.brandConfigRefreshTimer);
    }

    this.brandConfigRefreshTimer = setInterval(async () => {
      try {
        await this.refreshBrandConfig();
      } catch (error) {
        this.logger.error('自动刷新品牌配置失败:', error);
      }
    }, this.BRAND_CONFIG_REFRESH_INTERVAL);

    this.logger.log(
      `✅ 品牌配置自动刷新已启动（间隔: ${this.BRAND_CONFIG_REFRESH_INTERVAL / 1000 / 60} 分钟）`,
    );
  }

  /**
   * 启动重试定时器
   */
  private startRetry(): void {
    if (this.brandConfigRetryTimer) {
      return;
    }

    this.brandConfigRetryTimer = setInterval(async () => {
      try {
        this.logger.log('⏰ 重试加载品牌配置...');
        await this.refreshBrandConfig();
      } catch (error) {
        this.logger.error('重试加载品牌配置失败，将继续重试:', error);
      }
    }, this.BRAND_CONFIG_RETRY_INTERVAL);

    this.logger.log(
      `⚠️ 品牌配置重试定时器已启动（间隔: ${this.BRAND_CONFIG_RETRY_INTERVAL / 1000 / 60} 分钟）`,
    );
  }

  /**
   * 停止所有定时器
   */
  private stopTimers(): void {
    if (this.brandConfigRefreshTimer) {
      clearInterval(this.brandConfigRefreshTimer);
      this.brandConfigRefreshTimer = null;
      this.logger.log('品牌配置自动刷新定时器已清理');
    }
    if (this.brandConfigRetryTimer) {
      clearInterval(this.brandConfigRetryTimer);
      this.brandConfigRetryTimer = null;
      this.logger.log('品牌配置重试定时器已清理');
    }
  }
}
