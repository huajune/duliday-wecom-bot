import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentProfile, ScenarioType } from './interfaces/agent-profile.interface';
import { AgentRegistryService } from './agent-registry.service';
import { ConfigLoaderService } from './loaders/config-loader.service';

/**
 * Agent 配置管理服务（动态配置版）
 * 负责管理不同场景下的 Agent 配置档案
 *
 * 职责：
 * 1. 动态加载和管理配置档案（支持文件系统、数据库等多种来源）
 * 2. 根据场景获取配置
 * 3. 验证配置档案的有效性
 * 4. 支持运行时配置更新
 *
 * 不再负责：
 * - 模型/工具列表管理（委托给 AgentRegistryService）
 * - 健康检查（委托给 AgentRegistryService）
 * - 硬编码配置（通过 ConfigLoaderService 动态加载）
 */
@Injectable()
export class AgentConfigService implements OnModuleInit {
  private readonly logger = new Logger(AgentConfigService.name);
  private readonly profiles = new Map<string, AgentProfile>();
  private initialized = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly registryService: AgentRegistryService,
    private readonly configLoader: ConfigLoaderService,
  ) {}

  /**
   * 模块初始化时自动加载配置
   */
  async onModuleInit() {
    await this.initializeProfiles();
  }

  /**
   * 初始化 Agent 配置档案
   * 优先从配置文件加载，支持运行时动态注册
   */
  private async initializeProfiles() {
    if (this.initialized) {
      this.logger.warn('配置已初始化，跳过重复初始化');
      return;
    }

    try {
      // 从配置加载器加载所有配置档案
      const loadedProfiles = await this.configLoader.loadAllProfiles();

      if (loadedProfiles.length === 0) {
        this.logger.warn('未加载到任何配置档案，将使用默认配置');
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
      this.logger.error('配置初始化失败，使用默认配置', error);
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
    if (!defaultModel) {
      throw new Error('AGENT_DEFAULT_MODEL 环境变量未配置，且无法加载配置文件，服务无法启动');
    }

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
        '你是一位专业的招聘顾问助手，通过企业微信与候选人进行私聊沟通。',
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
        targetTokens: 8000,
        preserveRecentMessages: 5,
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
   */
  getProfile(scenario: ScenarioType | string): AgentProfile | null {
    const profile = this.profiles.get(scenario);
    if (!profile) {
      this.logger.warn(`未找到场景 ${scenario} 的配置，将使用默认配置`);
      // 只有一个场景，直接返回候选人咨询配置
      return this.profiles.get(ScenarioType.CANDIDATE_CONSULTATION) || null;
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
   * 从配置加载器重新加载指定配置
   * 支持运行时配置更新
   */
  async reloadProfile(profileName: string): Promise<boolean> {
    try {
      const reloadedProfile = await this.configLoader.reloadProfile(profileName);
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
   * 从配置加载器重新加载所有配置
   */
  async reloadAllProfiles(): Promise<void> {
    try {
      const loadedProfiles = await this.configLoader.loadAllProfiles();
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
}
