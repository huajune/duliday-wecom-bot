import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentProfile, ScenarioType } from './agent-profile.interface';
import { AgentApiService } from './agent-api.service';

/**
 * Agent 配置管理服务
 * 负责管理不同场景下的 Agent 配置档案
 */
@Injectable()
export class AgentConfigService implements OnModuleInit {
  private readonly logger = new Logger(AgentConfigService.name);
  private readonly profiles = new Map<string, AgentProfile>();
  private availableModels: string[] = [];
  private availableTools: Map<string, { requiresSandbox: boolean; requiredContext: string[] }> = new Map();

  constructor(
    private readonly configService: ConfigService,
    private readonly agentApiService: AgentApiService,
  ) {
    this.initializeProfiles();
  }

  /**
   * 模块初始化时，从 Agent API 获取可用的模型和工具
   */
  async onModuleInit() {
    try {
      // 获取可用模型
      const modelsResponse = await this.agentApiService.getModels();
      if (modelsResponse?.data?.models) {
        this.availableModels = modelsResponse.data.models.map((m: any) => m.id);
        this.logger.log(`已加载 ${this.availableModels.length} 个可用模型`);
      }

      // 获取可用工具
      const toolsResponse = await this.agentApiService.getTools();
      if (toolsResponse?.data?.tools) {
        toolsResponse.data.tools.forEach((tool: any) => {
          this.availableTools.set(tool.name, {
            requiresSandbox: tool.requiresSandbox,
            requiredContext: tool.requiredContext,
          });
        });
        this.logger.log(`已加载 ${this.availableTools.size} 个可用工具`);
      }
    } catch (error) {
      this.logger.warn('无法从 Agent API 获取模型和工具信息，将使用默认配置', error);
    }
  }

  /**
   * 初始化预定义的 Agent 配置档案
   */
  private initializeProfiles() {
    const defaultModel = this.configService.get<string>(
      'AGENT_DEFAULT_MODEL',
      'anthropic/claude-3-7-sonnet-20250219',
    );

    // 1. 企微客服助手（纯文本对话）
    this.registerProfile({
      name: ScenarioType.WECOM_CUSTOMER_SERVICE,
      description: '企业微信客服助手 - 纯文本对话，友好礼貌地回答用户问题',
      systemPrompt:
        '你是一个企业微信客服助手，负责回答用户的问题。' +
        '请保持礼貌、专业、简洁的态度。' +
        '如果用户问题不在你的知识范围内，请礼貌地告知用户。',
      model: defaultModel,
      allowedTools: [], // 纯文本对话，不需要工具
    });

    // 2. BOSS直聘招聘助手（使用智能回复工具）
    this.registerProfile({
      name: ScenarioType.BOSS_ZHIPIN_RECRUITER,
      description: 'BOSS直聘招聘助手 - 使用智能回复工具与候选人沟通',
      promptType: 'bossZhipinSystemPrompt',
      model: defaultModel,
      allowedTools: ['zhipin_reply_generator'],
      context: {
        // 这些配置应该从数据库或配置文件加载
        configData: {
          city: '上海',
          stores: [],
          brands: {},
          defaultBrand: '默认品牌',
        },
        replyPrompts: {
          general_chat: '你是连锁餐饮招聘助手，请用简洁礼貌的语气与候选人沟通。',
          initial_inquiry: '向候选人简要介绍品牌与岗位，并询问其城市与时间安排。',
          schedule_inquiry: '用要点列出出勤安排与班次信息，避免冗长。',
          salary_inquiry: '提供基础薪资与可能的补贴说明，避免承诺不可兑现的条款。',
          interview_request: '给出面试可选时间段与地点/视频会议方式，并礼貌确认。',
          availability_inquiry: '确认候选人的可用时间段，如不匹配则给备选方案。',
        },
      },
      toolContext: {
        zhipin_reply_generator: {
          replyPrompts: {
            general_chat: '你是连锁餐饮招聘助手，请用简洁礼貌的语气与候选人沟通。',
          },
        },
      },
    });

    // 3. 通用助手（基础功能）
    this.registerProfile({
      name: ScenarioType.GENERAL_ASSISTANT,
      description: '通用AI助手 - 提供基础的对话和帮助',
      systemPrompt: '你是一个有帮助的AI助手。',
      model: defaultModel,
      allowedTools: [],
    });

    this.logger.log(`已注册 ${this.profiles.size} 个 Agent 配置档案`);
  }

  /**
   * 注册一个 Agent 配置档案
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
      return this.profiles.get(ScenarioType.GENERAL_ASSISTANT) || null;
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
   * 验证配置是否有效
   * 检查模型和工具是否在可用列表中
   */
  validateProfile(profile: AgentProfile): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // 检查模型是否可用
    if (this.availableModels.length > 0 && !this.availableModels.includes(profile.model)) {
      errors.push(`模型 ${profile.model} 不在可用列表中`);
    }

    // 检查工具是否可用
    if (profile.allowedTools && profile.allowedTools.length > 0) {
      for (const tool of profile.allowedTools) {
        const toolInfo = this.availableTools.get(tool);
        if (!toolInfo && this.availableTools.size > 0) {
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

  /**
   * 获取可用的模型列表
   */
  getAvailableModels(): string[] {
    return this.availableModels;
  }

  /**
   * 获取可用的工具列表
   */
  getAvailableTools(): Map<string, { requiresSandbox: boolean; requiredContext: string[] }> {
    return this.availableTools;
  }
}
