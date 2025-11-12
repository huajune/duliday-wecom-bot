import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { AxiosInstance } from 'axios';
import { AgentProfile, ScenarioType } from './interfaces/agent-profile.interface';
import { AgentRegistryService } from './agent-registry.service';
import { RedisService } from '@core/redis';
import { HttpClientFactory } from '@core/http';
import { FeiShuAlertService } from '@/core/alert/feishu-alert.service';

/**
 * 配置文件结构
 * 对应 context/{scenarioName}/profile.json 的结构
 */
interface ProfileConfig {
  name: string;
  description: string;
  model: string;
  allowedTools?: string | string[];
  contextStrategy?: 'skip' | 'error' | 'report';
  prune?: boolean;
  pruneOptions?: {
    maxOutputTokens?: number;
    targetTokens?: number;
    preserveRecentMessages?: number;
  };
  files?: {
    systemPrompt?: string;
    context?: string;
    toolContext?: string;
  };
  metadata?: {
    version?: string;
    author?: string;
    lastUpdated?: string;
    description?: string;
  };
}

/**
 * 品牌配置接口
 */
export interface BrandConfig {
  synced: boolean;
  brandData?: any;
  replyPrompts?: any;
  lastRefreshTime?: string; // 添加时间戳字段（由本地服务添加）
}

/**
 * Agent 配置管理服务
 * 负责从文件系统加载和管理不同场景下的 Agent 配置档案
 *
 * 文件结构:
 * context/
 * └── {scenarioName}/
 *     ├── profile.json         (元信息)
 *     ├── system-prompt.md     (systemPrompt)
 *     ├── context.json         (ChatContext)
 *     └── tool-context.json    (ToolContext)
 *
 * 职责：
 * 1. 从文件系统加载配置档案
 * 2. 根据场景获取配置
 * 3. 验证配置档案的有效性
 * 4. 支持运行时配置更新
 * 5. 管理品牌配置（定时刷新+缓存）
 *
 * 不负责：
 * - 模型/工具列表管理（委托给 AgentRegistryService）
 * - 健康检查（委托给 AgentRegistryService）
 */
@Injectable()
export class AgentConfigService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentConfigService.name);
  private readonly profiles = new Map<string, AgentProfile>();
  private readonly contextBasePath: string;
  private initialized = false;

  // 品牌配置管理
  private readonly BRAND_CONFIG_CACHE_KEY = 'agent:brand-config';
  private readonly BRAND_CONFIG_REFRESH_INTERVAL = 5 * 60 * 1000; // 5分钟
  private readonly BRAND_CONFIG_RETRY_INTERVAL = 1 * 60 * 1000; // 1分钟（首次加载失败时的重试间隔）
  private supabaseHttpClient: AxiosInstance;
  private supabaseBucketName: string;
  private supabaseBrandConfigPath: string;
  private brandConfigRefreshTimer: NodeJS.Timeout | null = null;
  private brandConfigRetryTimer: NodeJS.Timeout | null = null; // 重试定时器
  private brandConfigAvailable = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly registryService: AgentRegistryService,
    private readonly redisService: RedisService,
    private readonly httpClientFactory: HttpClientFactory,
    private readonly feiShuAlertService: FeiShuAlertService,
  ) {
    // 配置文件基础路径 - context/ 文件夹
    // 编译后: dist/src/agent -> ../../agent/context
    // nest-cli.json 的 assets 配置会将 JSON 文件复制到 dist/agent/context
    this.contextBasePath = join(__dirname, '..', '..', 'agent', 'context');
    this.logger.log(`配置文件路径: ${this.contextBasePath}`);

    // 创建 Supabase Storage HTTP 客户端
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

    // 读取桶名称和文件路径
    this.supabaseBucketName = this.configService.get<string>(
      'SUPABASE_BUCKET_NAME',
      'brand-configs',
    );
    this.supabaseBrandConfigPath = this.configService.get<string>(
      'SUPABASE_BRAND_CONFIG_PATH',
      'config/brand-data.json',
    );

    // 创建 HTTP 客户端，使用 Bearer Token 认证
    this.supabaseHttpClient = this.httpClientFactory.createWithBearerAuth(
      {
        baseURL: `${supabaseUrl}/storage/v1`,
        timeout: 10000,
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
   * 模块初始化时自动加载配置
   */
  async onModuleInit() {
    await this.initializeProfiles();
    await this.refreshBrandConfig(); // 首次加载品牌配置
    this.startBrandConfigAutoRefresh(); // 启动定时刷新
  }

  /**
   * 模块销毁时清理定时器
   */
  onModuleDestroy() {
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

  /**
   * 初始化 Agent 配置档案
   * 从文件系统加载，如失败则使用降级配置
   */
  private async initializeProfiles() {
    if (this.initialized) {
      this.logger.warn('配置已初始化，跳过重复初始化');
      return;
    }

    try {
      // 从文件系统加载所有配置档案
      const loadedProfiles = await this.loadAllProfilesFromFiles();

      if (loadedProfiles.length === 0) {
        this.logger.warn('未加载到任何配置档案，将使用降级配置');
        this.initializeFallbackProfiles();
      } else {
        // 注册所有加载的配置
        for (const profile of loadedProfiles) {
          this.registerProfile(profile);
        }
      }

      this.initialized = true;
      this.logger.log(`配置初始化完成，已加载 ${this.profiles.size} 个配置档案`);
    } catch (error) {
      this.logger.error('配置初始化失败，使用降级配置', error);
      this.initializeFallbackProfiles();
      this.initialized = true;
    }
  }

  /**
   * 降级处理：使用环境变量创建最小化配置
   *
   * 注意：
   * 1. 只创建最小化配置，保证服务可以启动
   * 2. systemPrompt 极简（几行），不包含复杂的业务逻辑
   * 3. 只包含必需的 context（dulidayToken）
   * 4. 明确日志提示这是降级配置
   */
  private initializeFallbackProfiles() {
    // 检查必需的环境变量
    const defaultModel = this.configService.get<string>('AGENT_DEFAULT_MODEL');

    // 从环境变量读取工具列表
    const allowedToolsEnv = this.configService.get<string>('AGENT_ALLOWED_TOOLS', '');
    const defaultTools = allowedToolsEnv
      .split(',')
      .map((tool) => tool.trim())
      .filter((tool) => tool.length > 0);

    this.logger.warn('⚠️ 使用环境变量创建最小化降级配置（功能受限）');

    // 创建最小化降级配置
    this.registerProfile({
      name: ScenarioType.CANDIDATE_CONSULTATION,
      description: '候选人私聊咨询服务（降级模式）',
      model: defaultModel,
      allowedTools: defaultTools,

      // ✅ 极简 systemPrompt - 只有核心职责
      systemPrompt: [
        '你是一位专业的招聘经理，通过企业微信与候选人进行私聊沟通。',
        '',
        '核心职责：',
        '1. 使用 duliday_job_list 工具查询岗位信息',
        '2. 使用 duliday_job_details 工具获取岗位详情',
        '3. 使用 duliday_interview_booking 工具预约面试',
        '',
        '注意：请优先使用工具获取真实信息，不要编造数据。',
      ].join('\n'),

      // ✅ 最小化 context - 只有必需的 token
      context: {
        dulidayToken: this.configService.get<string>('DULIDAY_API_TOKEN'),
      },

      contextStrategy: 'skip',
      prune: true,
      pruneOptions: {
        targetTokens: 32000, // 提高 token 预算，支持更长的对话历史
        preserveRecentMessages: 50, // 保留最近 50 条消息（约 25 轮对话）
        maxOutputTokens: 4000, // 预留给模型生成回复的 token 数量
      },
    });

    this.logger.log('✅ 降级配置创建完成（建议尽快修复配置文件以恢复完整功能）');
  }

  /**
   * 注册一个 Agent 配置档案
   * 支持运行时动态注册配置
   */
  registerProfile(profile: AgentProfile) {
    this.profiles.set(profile.name, profile);
    this.logger.log(`注册 Agent 配置: ${profile.name} - ${profile.description}`);
  }

  /**
   * 根据场景类型获取 Agent 配置
   * 每次调用都会动态合并最新的品牌配置
   */
  async getProfile(scenario: ScenarioType | string): Promise<AgentProfile | null> {
    let profile = this.profiles.get(scenario);
    if (!profile) {
      this.logger.warn(`未找到场景 ${scenario} 的配置，将使用默认配置`);
      // 只有一个场景，直接返回候选人咨询配置
      profile = this.profiles.get(ScenarioType.CANDIDATE_CONSULTATION);
      if (!profile) {
        return null;
      }
    }

    // 动态合并最新的品牌配置
    return this.mergeProfileWithBrandConfig(profile);
  }

  /**
   * 将品牌配置动态合并到 profile 中
   * 返回新对象，不修改缓存的 profile
   */
  private async mergeProfileWithBrandConfig(profile: AgentProfile): Promise<AgentProfile> {
    const brandConfig = await this.getBrandConfig();

    if (!brandConfig) {
      this.logger.warn(`品牌配置不可用，profile "${profile.name}" 缺少关键数据`);
      // 返回原 profile，但标记为未同步
      return {
        ...profile,
        context: {
          ...profile.context,
          configSynced: false,
        },
      };
    }

    // 返回新对象，动态合并最新的品牌配置
    return {
      ...profile,
      context: {
        ...profile.context,
        brandData: brandConfig.brandData,
        replyPrompts: brandConfig.replyPrompts,
        configSynced: brandConfig.synced,
      },
    };
  }

  /**
   * 获取所有可用的配置档案
   */
  getAllProfiles(): AgentProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * 重新加载指定配置
   * 支持运行时配置更新
   */
  async reloadProfile(profileName: string): Promise<boolean> {
    try {
      const reloadedProfile = await this.loadProfileFromFile(profileName);
      if (reloadedProfile) {
        this.registerProfile(reloadedProfile);
        this.logger.log(`配置 ${profileName} 已重新加载`);
        return true;
      }
      this.logger.warn(`无法重新加载配置 ${profileName}`);
      return false;
    } catch (error) {
      this.logger.error(`重新加载配置 ${profileName} 失败`, error);
      return false;
    }
  }

  /**
   * 重新加载所有配置
   */
  async reloadAllProfiles(): Promise<void> {
    try {
      const loadedProfiles = await this.loadAllProfilesFromFiles();
      this.profiles.clear();
      for (const profile of loadedProfiles) {
        this.registerProfile(profile);
      }
      this.logger.log(`所有配置已重新加载，共 ${this.profiles.size} 个`);
    } catch (error) {
      this.logger.error('重新加载所有配置失败', error);
    }
  }

  /**
   * 检查配置是否存在
   */
  hasProfile(profileName: string): boolean {
    return this.profiles.has(profileName);
  }

  /**
   * 删除配置档案
   * 用于运行时动态管理
   */
  removeProfile(profileName: string): boolean {
    const removed = this.profiles.delete(profileName);
    if (removed) {
      this.logger.log(`配置 ${profileName} 已删除`);
    }
    return removed;
  }

  /**
   * 验证配置是否有效
   * 检查模型和工具是否在可用列表中（委托给 RegistryService）
   */
  validateProfile(profile: AgentProfile): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // 从注册表服务获取可用的模型和工具列表
    const availableModels = this.registryService.getAvailableModels();
    const availableTools = this.registryService.getAvailableTools();

    // 检查模型是否可用
    if (availableModels.length > 0 && !availableModels.includes(profile.model)) {
      errors.push(`模型 ${profile.model} 不在可用列表中`);
    }

    // 检查工具是否可用
    if (profile.allowedTools && profile.allowedTools.length > 0) {
      for (const tool of profile.allowedTools) {
        const toolInfo = availableTools.get(tool);
        if (!toolInfo && availableTools.size > 0) {
          errors.push(`工具 ${tool} 不在可用列表中`);
          continue;
        }

        // 检查工具所需的上下文是否提供
        if (toolInfo && toolInfo.requiredContext.length > 0) {
          const providedContext = { ...profile.context, ...profile.toolContext?.[tool] };
          for (const requiredKey of toolInfo.requiredContext) {
            if (!providedContext[requiredKey]) {
              errors.push(`工具 ${tool} 缺少必需的上下文: ${requiredKey}`);
            }
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  // ==================== 文件加载相关私有方法 ====================

  /**
   * 从文件系统加载所有配置档案
   */
  private async loadAllProfilesFromFiles(): Promise<AgentProfile[]> {
    // 目前只支持 candidate-consultation，未来可以扫描目录
    const profileNames = ['candidate-consultation'];
    const profiles: AgentProfile[] = [];

    for (const name of profileNames) {
      const profile = await this.loadProfileFromFile(name);
      if (profile) {
        profiles.push(profile);
      }
    }

    return profiles;
  }

  /**
   * 从文件系统加载单个配置档案
   * 文件结构: context/{profileName}/profile.json
   */
  private async loadProfileFromFile(profileName: string): Promise<AgentProfile | null> {
    try {
      // 场景目录: context/candidate-consultation/
      const scenarioDir = join(this.contextBasePath, profileName);
      const profilePath = join(scenarioDir, 'profile.json');

      const profileJson = await this.readJsonFile<ProfileConfig>(profilePath);

      if (!profileJson) {
        this.logger.warn(`未找到配置文件: ${profileName}`);
        return null;
      }

      // 构建完整的 AgentProfile
      const profile = await this.buildProfile(profileJson, scenarioDir);
      this.logger.log(`成功加载配置: ${profileName}`);
      return profile;
    } catch (error) {
      this.logger.error(`加载配置失败: ${profileName}`, error);
      return null;
    }
  }

  /**
   * 构建完整的 AgentProfile
   * @param config 配置元信息
   * @param scenarioDir 场景目录路径（如 context/candidate-consultation）
   */
  private async buildProfile(config: ProfileConfig, scenarioDir: string): Promise<AgentProfile> {
    const profile: AgentProfile = {
      name: config.name,
      description: config.description,
      model: this.resolveEnvVar(config.model),
      contextStrategy: config.contextStrategy || 'skip',
      prune: config.prune ?? false,
      pruneOptions: config.pruneOptions,
    };

    // 解析 allowedTools
    if (config.allowedTools) {
      if (typeof config.allowedTools === 'string') {
        profile.allowedTools = this.parseAllowedTools(config.allowedTools);
      } else {
        profile.allowedTools = config.allowedTools;
      }
    }

    // 加载 system prompt (相对于场景目录)
    if (config.files?.systemPrompt) {
      const promptPath = join(scenarioDir, config.files.systemPrompt);
      profile.systemPrompt = await this.readTextFile(promptPath);
    }

    // 加载 context (相对于场景目录)
    if (config.files?.context) {
      const contextPath = join(scenarioDir, config.files.context);
      const contextData = await this.readJsonFile(contextPath);
      if (contextData) {
        profile.context = this.resolveEnvVarsInObject(contextData);
      }
    }

    // 加载 toolContext (相对于场景目录)
    if (config.files?.toolContext) {
      const toolContextPath = join(scenarioDir, config.files.toolContext);
      const toolContextData = await this.readConfigFile(toolContextPath);
      if (toolContextData) {
        profile.toolContext = this.resolveEnvVarsInObject(toolContextData);
      }
    }

    // 注意：品牌配置现在在 getProfile() 中动态合并，不在此处合并
    // 这样可以确保每次获取 profile 时都使用最新的品牌配置

    return profile;
  }

  /**
   * 解析允许的工具列表
   * 支持环境变量引用：${AGENT_ALLOWED_TOOLS}
   */
  private parseAllowedTools(toolsStr: string): string[] {
    const resolved = this.resolveEnvVar(toolsStr);
    return resolved
      .split(',')
      .map((tool) => tool.trim())
      .filter((tool) => tool.length > 0);
  }

  /**
   * 解析单个环境变量
   * 格式: ${VAR_NAME} 或 直接字符串
   */
  private resolveEnvVar(value: string): string {
    if (!value) return value;

    const envVarPattern = /\$\{([^}]+)\}/g;
    return value.replace(envVarPattern, (_, varName) => {
      const envValue = this.configService.get<string>(varName);
      if (!envValue) {
        this.logger.warn(`环境变量未设置: ${varName}, 使用空字符串`);
        return '';
      }
      return envValue;
    });
  }

  /**
   * 递归解析对象中的所有环境变量
   */
  private resolveEnvVarsInObject<T>(obj: T): T {
    if (typeof obj === 'string') {
      return this.resolveEnvVar(obj) as T;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.resolveEnvVarsInObject(item)) as T;
    }

    if (obj && typeof obj === 'object') {
      const resolved: any = {};
      for (const [key, value] of Object.entries(obj)) {
        resolved[key] = this.resolveEnvVarsInObject(value);
      }
      return resolved;
    }

    return obj;
  }

  /**
   * 读取配置文件（支持 JSON 和 TypeScript 模块）
   */
  private async readConfigFile<T = any>(filePath: string): Promise<T | null> {
    try {
      // 检测文件扩展名
      if (filePath.endsWith('.json')) {
        return await this.readJsonFile<T>(filePath);
      }

      // 对于 .ts/.js 文件，使用动态 import
      if (filePath.endsWith('.ts') || filePath.endsWith('.js')) {
        // 如果是 .ts 文件，在编译环境下尝试加载对应的 .js 文件
        let actualPath = filePath;
        if (filePath.endsWith('.ts')) {
          actualPath = filePath.replace(/\.ts$/, '.js');
          // 转换路径：dist/agent/context -> dist/src/agent/context
          actualPath = actualPath.replace('/agent/context/', '/src/agent/context/');
        }

        const module = await import(actualPath);
        // 支持 default export 或命名 export
        return module.default || module.toolContext || module;
      }

      this.logger.warn(`不支持的配置文件格式: ${filePath}`);
      return null;
    } catch (error) {
      this.logger.error(`读取配置文件失败: ${filePath}`, error);
      return null;
    }
  }

  /**
   * 读取 JSON 文件
   */
  private async readJsonFile<T = any>(filePath: string): Promise<T | null> {
    try {
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      this.logger.error(`读取 JSON 文件失败: ${filePath}`, error);
      return null;
    }
  }

  /**
   * 读取文本文件
   */
  private async readTextFile(filePath: string): Promise<string | undefined> {
    try {
      return await readFile(filePath, 'utf-8');
    } catch (error) {
      this.logger.error(`读取文本文件失败: ${filePath}`, error);
      return undefined;
    }
  }

  // ==================== 品牌配置管理 ====================

  /**
   * 获取品牌配置（从缓存）
   * 如果缓存不存在，返回 null（表示配置不可用）
   */
  async getBrandConfig(): Promise<BrandConfig | null> {
    try {
      const cached = await this.redisService.get<BrandConfig>(this.BRAND_CONFIG_CACHE_KEY);
      if (cached) {
        return cached;
      }

      // 缓存未命中，检查是否已加载过
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
   * 刷新品牌配置（从 Supabase 桶存储获取）
   */
  async refreshBrandConfig(): Promise<void> {
    try {
      this.logger.log('正在从 Supabase 存储刷新品牌配置...');

      // 构建 Supabase Storage 请求路径
      // 格式: /object/{bucket}/{path}
      // 注意：路径中可能包含空格等特殊字符，需要进行 URL 编码
      const encodedPath = this.supabaseBrandConfigPath
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');
      const storagePath = `/object/${this.supabaseBucketName}/${encodedPath}`;

      this.logger.debug(`请求 Supabase Storage: ${storagePath}`);

      const response = await this.supabaseHttpClient.get(storagePath);

      // 检查响应格式
      if (!response.data) {
        throw new Error('Supabase 存储返回空数据');
      }

      // Supabase Storage 直接返回 JSON 对象
      let brandConfig: BrandConfig;

      // 处理不同的响应格式
      if (response.data.success === true) {
        // 如果有包装格式: { success: true, data: {...} }
        brandConfig = response.data.data;
      } else if (response.data.synced !== undefined) {
        // 直接返回品牌配置对象: { synced: true, brandData: {...}, replyPrompts: {...} }
        brandConfig = response.data;
      } else {
        // 兼容其他格式，尝试直接使用
        this.logger.warn('品牌配置格式不标准，尝试直接使用');
        brandConfig = {
          synced: true,
          brandData: response.data.brandData || response.data,
          replyPrompts: response.data.replyPrompts,
        };
      }

      // 验证必需字段
      if (typeof brandConfig.synced !== 'boolean') {
        this.logger.warn('品牌配置缺少 synced 字段，默认设置为 true');
        brandConfig.synced = true;
      }

      // 确保 lastRefreshTime 存在（优先使用返回值，若无则添加本地时间戳）
      const brandConfigWithTimestamp: BrandConfig = {
        ...brandConfig,
        lastRefreshTime: brandConfig.lastRefreshTime || new Date().toISOString(),
      };

      // 存储到 Redis（TTL: 5.5分钟，留30秒缓冲）
      await this.redisService.setex(this.BRAND_CONFIG_CACHE_KEY, 330, brandConfigWithTimestamp);

      this.brandConfigAvailable = true;

      // 【重要】首次加载成功，清除重试定时器
      if (this.brandConfigRetryTimer) {
        clearInterval(this.brandConfigRetryTimer);
        this.brandConfigRetryTimer = null;
        this.logger.log('✅ 品牌配置加载成功，重试定时器已清除');
      }

      this.logger.log(
        `✅ 品牌配置从 Supabase 刷新成功 (同步状态: ${brandConfig.synced ? '已同步' : '未同步'})`,
      );

      // 如果品牌数据未同步，记录警告
      if (!brandConfig.synced) {
        this.logger.warn('⚠️ 品牌配置未同步，可能影响服务质量');
      }
    } catch (error: any) {
      this.logger.error('❌ 从 Supabase 刷新品牌配置失败，Agent 服务将无法正常工作', error);

      const isFirstLoad = !this.brandConfigAvailable;

      // 如果是首次加载失败，启动重试机制
      if (isFirstLoad) {
        this.logger.error('⚠️ 首次加载品牌配置失败，服务启动但功能受限');
        this.startBrandConfigRetry();
      }

      // 【飞书告警】发送品牌配置不可用告警
      await this.feiShuAlertService.sendBrandConfigUnavailableAlert(error, isFirstLoad);

      // 不抛出异常，保持服务稳定
    }
  }

  /**
   * 启动品牌配置自动刷新定时器
   */
  private startBrandConfigAutoRefresh(): void {
    if (this.brandConfigRefreshTimer) {
      clearInterval(this.brandConfigRefreshTimer);
    }

    this.brandConfigRefreshTimer = setInterval(async () => {
      try {
        await this.refreshBrandConfig();
      } catch (error) {
        this.logger.error('自动刷新品牌配置失败:', error);
        // 不抛出错误，继续运行
      }
    }, this.BRAND_CONFIG_REFRESH_INTERVAL);

    this.logger.log(
      `✅ 品牌配置自动刷新已启动（间隔: ${this.BRAND_CONFIG_REFRESH_INTERVAL / 1000 / 60} 分钟）`,
    );
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
  async getBrandConfigStatus() {
    const config = await this.getBrandConfig();

    return {
      available: this.brandConfigAvailable,
      synced: config?.synced || false,
      hasBrandData: !!config?.brandData,
      hasReplyPrompts: !!config?.replyPrompts,
      lastRefreshTime: config?.lastRefreshTime || null,
    };
  }

  /**
   * 启动品牌配置重试定时器（仅在首次加载失败时使用）
   */
  private startBrandConfigRetry(): void {
    // 避免重复启动
    if (this.brandConfigRetryTimer) {
      return;
    }

    this.brandConfigRetryTimer = setInterval(async () => {
      try {
        this.logger.log('⏰ 重试加载品牌配置...');
        await this.refreshBrandConfig();
      } catch (error) {
        this.logger.error('重试加载品牌配置失败，将继续重试:', error);
        // 继续重试，不抛出错误
      }
    }, this.BRAND_CONFIG_RETRY_INTERVAL);

    this.logger.log(
      `⚠️ 品牌配置重试定时器已启动（间隔: ${this.BRAND_CONFIG_RETRY_INTERVAL / 1000 / 60} 分钟）`,
    );
  }
}
