import { Injectable, Logger, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentProfile, ScenarioType } from './interfaces/agent-profile.interface';
import { AgentService } from './agent.service';

/**
 * Agent 配置管理服务
 * 负责管理不同场景下的 Agent 配置档案
 */
@Injectable()
export class AgentConfigService implements OnModuleInit {
  private readonly logger = new Logger(AgentConfigService.name);
  private readonly profiles = new Map<string, AgentProfile>();
  private availableModels: string[] = [];
  private availableTools: Map<string, { requiresSandbox: boolean; requiredContext: string[] }> =
    new Map();

  constructor(
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => AgentService))
    private readonly agentService: AgentService,
  ) {
    this.initializeProfiles();
  }

  /**
   * 模块初始化时，从 Agent API 获取可用的模型和工具
   * 并验证所有配置档案
   */
  async onModuleInit() {
    try {
      // 获取可用模型
      const modelsResponse = await this.agentService.getModels();
      if (modelsResponse?.data?.models) {
        this.availableModels = modelsResponse.data.models.map((m: any) => m.id);
        this.logger.log(`已加载 ${this.availableModels.length} 个可用模型`);
      }

      // 获取可用工具
      const toolsResponse = await this.agentService.getTools();
      if (toolsResponse?.data?.tools) {
        toolsResponse.data.tools.forEach((tool: any) => {
          this.availableTools.set(tool.name, {
            requiresSandbox: tool.requiresSandbox,
            requiredContext: tool.requiredContext,
          });
        });
        this.logger.log(`已加载 ${this.availableTools.size} 个可用工具`);
      }

      // 验证所有配置档案
      this.validateAllProfiles();
    } catch (error) {
      this.logger.warn('无法从 Agent API 获取模型和工具信息，将使用默认配置', error);
    }
  }

  /**
   * 初始化预定义的 Agent 配置档案
   */
  private initializeProfiles() {
    const defaultModel = this.configService.get<string>('AGENT_DEFAULT_MODEL');
    if (!defaultModel) {
      throw new Error('AGENT_DEFAULT_MODEL 环境变量未配置，请在 .env 文件中设置');
    }

    // ========== 微信群运营场景 ==========

    // 1. 微信群通用助手（纯文本对话）
    this.registerProfile({
      name: ScenarioType.WECHAT_GROUP_ASSISTANT,
      description: '微信群通用助手 - 友好地回答群成员的问题，促进群活跃度',
      model: defaultModel,
      systemPrompt:
        '你是一个微信群助手，负责回答群成员的问题。' +
        '请保持友好、热情、简洁的态度。' +
        '回复要适合微信群聊天场景，不要过于正式。' +
        '如果不确定答案，可以引导群成员进行讨论。',
      allowedTools: [],
      contextStrategy: 'skip',
    });

    // 2. 微信群活动运营助手
    this.registerProfile({
      name: ScenarioType.WECHAT_GROUP_EVENT,
      description: '微信群活动运营助手 - 发布活动通知、收集报名、回答活动相关问题',
      model: defaultModel,
      systemPrompt:
        '你是一个微信群活动运营助手。' +
        '主要职责是发布活动通知、收集报名信息、回答活动相关问题。' +
        '请保持热情、积极的语气，鼓励群成员参与活动。' +
        '回复要简洁明了，重点信息用表情符号突出。',
      allowedTools: [],
      contextStrategy: 'skip',
      prune: true,
      pruneOptions: {
        targetTokens: 8000,
        preserveRecentMessages: 5,
      },
    });

    // 3. 微信群客户服务助手
    this.registerProfile({
      name: ScenarioType.WECHAT_GROUP_CUSTOMER_SERVICE,
      description: '微信群客户服务助手 - 处理客户咨询、投诉、售后问题',
      model: defaultModel,
      systemPrompt:
        '你是一个微信群客户服务助手。' +
        '负责处理客户的咨询、投诉和售后问题。' +
        '请保持礼貌、专业、耐心的态度。' +
        '对于无法解决的问题，引导客户联系人工客服。' +
        '回复要简洁，提供明确的解决方案或下一步操作指引。',
      allowedTools: [],
      contextStrategy: 'skip',
      prune: true,
      pruneOptions: {
        targetTokens: 8000,
        preserveRecentMessages: 3,
      },
    });

    // ========== BOSS直聘招聘场景 ==========

    // 4. BOSS直聘招聘助手（使用智能回复工具）
    this.registerProfile({
      name: ScenarioType.BOSS_ZHIPIN_RECRUITER,
      description: 'BOSS直聘招聘助手 - 使用智能回复工具与候选人沟通',
      model: defaultModel,
      promptType: 'bossZhipinSystemPrompt',
      allowedTools: ['zhipin_reply_generator'],
      contextStrategy: 'error', // 招聘场景需要严格验证配置
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

    // ========== 通用场景 ==========

    // 5. 通用助手（基础功能，兼容旧代码）
    this.registerProfile({
      name: ScenarioType.GENERAL_ASSISTANT,
      description: '通用AI助手 - 提供基础的对话和帮助',
      model: defaultModel,
      systemPrompt: '你是一个有帮助的AI助手。',
      allowedTools: [],
      contextStrategy: 'skip',
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

  /**
   * 验证所有配置档案
   * 在模块初始化时自动执行
   */
  private validateAllProfiles(): void {
    this.logger.log('开始验证所有配置档案...');
    let validCount = 0;
    let invalidCount = 0;

    for (const profile of this.profiles.values()) {
      const validation = this.validateProfile(profile);
      if (validation.valid) {
        this.logger.log(`✓ 配置档案 "${profile.name}" 验证通过`);
        validCount++;
      } else {
        this.logger.warn(`✗ 配置档案 "${profile.name}" 验证失败:`);
        validation.errors.forEach((error) => {
          this.logger.warn(`  - ${error}`);
        });
        invalidCount++;
      }
    }

    this.logger.log(
      `配置档案验证完成: ${validCount} 个通过, ${invalidCount} 个失败 (共 ${this.profiles.size} 个)`,
    );
  }
}
