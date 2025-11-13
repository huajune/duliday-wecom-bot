import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { AgentProfile, ScenarioType } from '../utils/types';
import { AgentRegistryService } from './agent-registry.service';

/**
 * 配置文件结构
 * 对应 profiles/{scenarioName}/profile.json 的结构
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
 * Profile 加载服务
 * 负责从文件系统加载和管理 Agent Profile
 *
 * 职责：
 * 1. 从文件系统加载 profile.json、system-prompt.md 等
 * 2. 管理 profile 缓存（内存 Map）
 * 3. 提供 profile 注册、获取、重载接口
 * 4. 验证 profile 有效性
 */
@Injectable()
export class ProfileLoaderService implements OnModuleInit {
  private readonly logger = new Logger(ProfileLoaderService.name);
  private readonly profiles = new Map<string, AgentProfile>();
  private readonly contextBasePath: string;
  private initialized = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly registryService: AgentRegistryService,
  ) {
    // 配置文件基础路径 - profiles/ 文件夹
    // 编译后: dist/src/agent -> ../../agent/profiles
    this.contextBasePath = join(__dirname, '..', '..', '..', 'agent', 'profiles');
    this.logger.log(`Profile 配置文件路径: ${this.contextBasePath}`);
  }

  /**
   * 模块初始化时自动加载配置
   */
  async onModuleInit() {
    await this.initializeProfiles();
  }

  /**
   * 获取 Profile（不包含品牌配置）
   */
  getProfile(scenario: ScenarioType | string): AgentProfile | null {
    let profile = this.profiles.get(scenario);
    if (!profile) {
      this.logger.warn(`未找到场景 ${scenario} 的配置，将使用默认配置`);
      // 只有一个场景，直接返回候选人咨询配置
      profile = this.profiles.get(ScenarioType.CANDIDATE_CONSULTATION);
      if (!profile) {
        return null;
      }
    }
    return profile;
  }

  /**
   * 获取所有可用的配置档案
   */
  getAllProfiles(): AgentProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * 注册一个 Agent 配置档案
   */
  registerProfile(profile: AgentProfile): void {
    this.profiles.set(profile.name, profile);
    this.logger.log(`注册 Agent 配置: ${profile.name} - ${profile.description}`);
  }

  /**
   * 重新加载指定配置
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
   * 检查模型和工具是否在可用列表中
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

  // ==================== 私有方法 ====================

  /**
   * 初始化 Agent 配置档案
   */
  private async initializeProfiles(): Promise<void> {
    if (this.initialized) {
      this.logger.warn('配置已初始化，跳过重复初始化');
      return;
    }

    try {
      const loadedProfiles = await this.loadAllProfilesFromFiles();

      if (loadedProfiles.length === 0) {
        this.logger.warn('未加载到任何配置档案，将使用降级配置');
        this.initializeFallbackProfiles();
      } else {
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
   */
  private initializeFallbackProfiles(): void {
    const defaultModel = this.configService.get<string>('AGENT_DEFAULT_MODEL');
    const allowedToolsEnv = this.configService.get<string>('AGENT_ALLOWED_TOOLS', '');
    const defaultTools = allowedToolsEnv
      .split(',')
      .map((tool) => tool.trim())
      .filter((tool) => tool.length > 0);

    this.logger.warn('⚠️ 使用环境变量创建最小化降级配置（功能受限）');

    this.registerProfile({
      name: ScenarioType.CANDIDATE_CONSULTATION,
      description: '候选人私聊咨询服务（降级模式）',
      model: defaultModel,
      allowedTools: defaultTools,
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
      context: {
        dulidayToken: this.configService.get<string>('DULIDAY_API_TOKEN'),
      },
      contextStrategy: 'skip',
      prune: true,
      pruneOptions: {
        targetTokens: 32000,
        preserveRecentMessages: 50,
        maxOutputTokens: 4000,
      },
    });

    this.logger.log('✅ 降级配置创建完成（建议尽快修复配置文件以恢复完整功能）');
  }

  /**
   * 从文件系统加载所有配置档案
   */
  private async loadAllProfilesFromFiles(): Promise<AgentProfile[]> {
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
   */
  private async loadProfileFromFile(profileName: string): Promise<AgentProfile | null> {
    try {
      const scenarioDir = join(this.contextBasePath, profileName);
      const profilePath = join(scenarioDir, 'profile.json');

      const profileJson = await this.readJsonFile<ProfileConfig>(profilePath);

      if (!profileJson) {
        this.logger.warn(`未找到配置文件: ${profileName}`);
        return null;
      }

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

    // 加载 system prompt
    if (config.files?.systemPrompt) {
      const promptPath = join(scenarioDir, config.files.systemPrompt);
      profile.systemPrompt = await this.readTextFile(promptPath);
    }

    // 加载 context
    if (config.files?.context) {
      const contextPath = join(scenarioDir, config.files.context);
      const contextData = await this.readJsonFile(contextPath);
      if (contextData) {
        profile.context = this.resolveEnvVarsInObject(contextData);
      }
    }

    // 加载 toolContext
    if (config.files?.toolContext) {
      const toolContextPath = join(scenarioDir, config.files.toolContext);
      const toolContextData = await this.readConfigFile(toolContextPath);
      if (toolContextData) {
        profile.toolContext = this.resolveEnvVarsInObject(toolContextData);
      }
    }

    return profile;
  }

  /**
   * 解析允许的工具列表
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
      if (filePath.endsWith('.json')) {
        return await this.readJsonFile<T>(filePath);
      }

      if (filePath.endsWith('.ts') || filePath.endsWith('.js')) {
        let actualPath = filePath;
        if (filePath.endsWith('.ts')) {
          actualPath = filePath.replace(/\.ts$/, '.js');
          actualPath = actualPath.replace('/agent/profiles/', '/src/agent/profiles/');
        }

        const module = await import(actualPath);
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
}
