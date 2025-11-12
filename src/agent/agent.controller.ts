import {
  Controller,
  Get,
  Post,
  Body,
  Logger,
  Query,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { AgentService } from './agent.service';
import { AgentConfigService } from './agent-config.service';
import { AgentRegistryService } from './agent-registry.service';
import { AgentCacheService } from './agent-cache.service';
import { ConfigService } from '@nestjs/config';
import { RawResponse } from '@/core';

@Controller('agent')
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(
    private readonly agentService: AgentService,
    private readonly agentConfigService: AgentConfigService,
    private readonly registryService: AgentRegistryService,
    private readonly cacheService: AgentCacheService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 健康检查（从注册表获取健康状态）
   * GET /agent/health
   */
  @Get('health')
  async healthCheck() {
    const healthStatus = this.registryService.getHealthStatus();
    const brandConfigStatus = await this.agentConfigService.getBrandConfigStatus();

    const isModelHealthy = healthStatus.models.configuredAvailable;
    const isToolHealthy = healthStatus.tools.allAvailable;
    const isBrandConfigHealthy = brandConfigStatus.available && brandConfigStatus.synced;

    // 整体健康状态：模型、工具和品牌配置都必须正常
    const isHealthy = isModelHealthy && isToolHealthy && isBrandConfigHealthy;

    // 返回自定义格式的健康状态（只包含状态信息，不暴露敏感数据）
    return {
      success: true,
      data: {
        status: isHealthy ? 'healthy' : 'degraded',
        message: isHealthy ? 'Agent 服务正常' : '⚠️ Agent 服务运行中（部分功能降级）',
        ...healthStatus,
        brandConfig: {
          available: brandConfigStatus.available,
          synced: brandConfigStatus.synced,
          lastRefreshTime: brandConfigStatus.lastRefreshTime,
          // 不返回完整的品牌配置数据，避免暴露敏感信息
        },
      },
    };
  }

  /**
   * 快速健康检查（从缓存读取）
   * GET /agent/health/quick
   */
  @Get('health/quick')
  async quickHealthCheck() {
    return this.registryService.getHealthStatus();
  }

  /**
   * 获取注册表状态详情
   * GET /agent/health/cache
   */
  @Get('health/cache')
  async getHealthCache() {
    const healthStatus = this.registryService.getHealthStatus();
    const cacheStats = await this.cacheService.getStats();

    return {
      registry: healthStatus,
      responseCache: cacheStats,
    };
  }

  /**
   * 清空所有会话缓存数据
   * POST /agent/cache/clear
   */
  @Post('cache/clear')
  async clearCache() {
    this.logger.log('清空会话缓存数据');
    await this.cacheService.clear();
    const stats = await this.cacheService.getStats();

    return {
      success: true,
      message: '会话缓存已清空',
      currentCacheSize: stats.size,
    };
  }

  /**
   * 强制刷新注册表（重新加载模型和工具列表）
   * POST /agent/health/refresh
   */
  @Post('health/refresh')
  async refreshHealth() {
    await this.registryService.refresh();
    return this.registryService.getHealthStatus();
  }

  /**
   * 手动刷新品牌配置
   * POST /agent/config/refresh
   */
  @Post('config/refresh')
  async refreshBrandConfig() {
    this.logger.log('手动刷新品牌配置');
    await this.agentConfigService.refreshBrandConfig();
    const brandConfigStatus = await this.agentConfigService.getBrandConfigStatus();

    return {
      success: true,
      message: brandConfigStatus.available ? '品牌配置刷新成功' : '⚠️ 品牌配置刷新失败，请检查日志',
      data: brandConfigStatus,
    };
  }

  /**
   * 获取品牌配置状态
   * GET /agent/config/status
   */
  @Get('config/status')
  async getBrandConfigStatus() {
    return await this.agentConfigService.getBrandConfigStatus();
  }

  /**
   * 获取可用工具列表（Agent API 原始响应）
   * GET /agent/tools
   */
  @RawResponse() // 保持 Agent API 原始响应格式
  @Get('tools')
  async getTools() {
    return await this.agentService.getTools();
  }

  /**
   * 获取可用模型列表（Agent API 原始响应）
   * GET /agent/models
   */
  @RawResponse() // 保持 Agent API 原始响应格式
  @Get('models')
  async getModels() {
    return await this.agentService.getModels();
  }

  /**
   * 获取配置的工具列表（从环境变量）
   * GET /agent/configured-tools
   */
  @Get('configured-tools')
  async getConfiguredTools() {
    const configuredTools = this.registryService.getConfiguredTools();
    const healthStatus = this.registryService.getHealthStatus();

    return {
      configuredTools,
      count: configuredTools.length,
      allAvailable: healthStatus.tools.allAvailable,
      lastRefreshTime: healthStatus.lastRefreshTime,
    };
  }

  /**
   * 获取可用的模型列表（从 Agent API 动态获取）
   * GET /agent/available-models
   */
  @Get('available-models')
  async getAvailableModels() {
    const defaultModel = this.configService.get<string>('AGENT_DEFAULT_MODEL');
    const availableModels = this.registryService.getAvailableModels();
    const healthStatus = this.registryService.getHealthStatus();

    return {
      defaultModel,
      availableModels,
      count: availableModels.length,
      defaultModelAvailable: healthStatus.models.defaultAvailable,
      lastRefreshTime: healthStatus.lastRefreshTime,
    };
  }

  /**
   * 测试聊天接口
   * POST /agent/test-chat
   * Body: { "message": "你好", "conversationId": "test-user", "model"?: "...", "allowedTools"?: [...], "scenario"?: "..." }
   *
   * 改进：使用配置档案自动传递 context 和 toolContext，避免缺少必需参数的错误
   */
  @Post('test-chat')
  async testChat(
    @Body()
    body: {
      message: string;
      conversationId?: string;
      model?: string;
      allowedTools?: string[];
      scenario?: string; // 新增：指定使用的场景配置
    },
  ) {
    this.logger.log('测试聊天:', body.message);
    const conversationId = body.conversationId || 'test-user';

    // 默认使用 candidate-consultation 场景配置（包含所有必需的 context）
    const scenario = body.scenario || 'candidate-consultation';
    const profile = await this.agentConfigService.getProfile(scenario);

    if (!profile) {
      throw new HttpException(
        `未找到场景 ${scenario} 的配置，请检查配置文件`,
        HttpStatus.NOT_FOUND,
      );
    }

    this.logger.log(`使用配置档案: ${profile.name} (${profile.description})`);

    // 使用配置档案调用聊天接口（自动传递 context 和 toolContext）
    const result = await this.agentService.chatWithProfile(conversationId, body.message, profile, {
      // 允许通过请求参数覆盖配置档案的设置
      model: body.model,
      allowedTools: body.allowedTools,
    });

    // 基于状态返回不同响应
    if (result.status === 'error') {
      throw new HttpException(
        result.error?.message || 'Agent 调用失败',
        result.error?.retryable ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // 返回扁平结构
    return {
      response: result.data || result.fallback,
      metadata: {
        status: result.status,
        fromCache: result.fromCache,
        correlationId: result.correlationId,
        ...(result.fallbackInfo && { fallbackInfo: result.fallbackInfo }),
      },
    };
  }

  /**
   * 测试工具安全校验
   * POST /agent/test-tool-validation
   * Body: { "message": "你好", "allowedTools": ["duliday_job_list", "unsafe_tool"] }
   */
  @Post('test-tool-validation')
  async testToolValidation(
    @Body()
    body: {
      message: string;
      allowedTools: string[];
      conversationId?: string;
    },
  ) {
    this.logger.log(`测试工具安全校验，请求的工具: ${body.allowedTools.join(', ')}`);
    const conversationId = body.conversationId || 'test-tool-validation';

    const result = await this.agentService.chat({
      conversationId,
      userMessage: body.message,
      allowedTools: body.allowedTools,
    });

    // 基于状态返回不同响应
    if (result.status === 'error') {
      throw new HttpException(
        result.error?.message || 'Agent 调用失败',
        result.error?.retryable ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return {
      requestedTools: body.allowedTools,
      message: '工具校验通过，已过滤不安全的工具',
      response: result.data || result.fallback,
      metadata: {
        status: result.status,
        fromCache: result.fromCache,
        correlationId: result.correlationId,
        ...(result.fallbackInfo && { fallbackInfo: result.fallbackInfo }),
      },
    };
  }

  /**
   * 测试模型安全校验
   * POST /agent/test-model-validation
   * Body: { "message": "你好", "model": "gpt-4" }
   */
  @Post('test-model-validation')
  async testModelValidation(
    @Body()
    body: {
      message: string;
      model: string;
      conversationId?: string;
    },
  ) {
    this.logger.log(`测试模型安全校验，请求的模型: ${body.model}`);
    const conversationId = body.conversationId || 'test-model-validation';

    const result = await this.agentService.chat({
      conversationId,
      userMessage: body.message,
      model: body.model,
    });

    // 基于状态返回不同响应
    if (result.status === 'error') {
      throw new HttpException(
        result.error?.message || 'Agent 调用失败',
        result.error?.retryable ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return {
      requestedModel: body.model,
      message: '模型校验完成，如果请求的模型不被允许，已自动使用默认模型',
      response: result.data || result.fallback,
      metadata: {
        status: result.status,
        fromCache: result.fromCache,
        correlationId: result.correlationId,
        ...(result.fallbackInfo && { fallbackInfo: result.fallbackInfo }),
      },
    };
  }

  /**
   * 获取所有配置档案
   * GET /agent/profiles
   */
  @Get('profiles')
  async getProfiles() {
    const profiles = this.agentConfigService.getAllProfiles();
    return profiles.map((p) => ({
      name: p.name,
      description: p.description,
      model: p.model,
      allowedTools: p.allowedTools,
      hasContext: !!p.context,
      contextStrategy: p.contextStrategy,
      prune: p.prune,
    }));
  }

  /**
   * 获取特定配置档案
   * GET /agent/profiles/:scenario
   */
  @Get('profiles/:scenario')
  async getProfile(@Query('scenario') scenario: string) {
    const profile = await this.agentConfigService.getProfile(scenario);
    if (!profile) {
      throw new HttpException(`未找到场景 ${scenario} 的配置`, HttpStatus.NOT_FOUND);
    }

    return profile;
  }

  /**
   * 验证配置档案
   * GET /agent/profiles/:scenario/validate
   */
  @Get('profiles/:scenario/validate')
  async validateProfile(@Query('scenario') scenario: string) {
    const profile = await this.agentConfigService.getProfile(scenario);
    if (!profile) {
      throw new HttpException(`未找到场景 ${scenario} 的配置`, HttpStatus.NOT_FOUND);
    }

    return this.agentConfigService.validateProfile(profile);
  }

  /**
   * 使用配置档案进行聊天（微信群场景示例）
   * POST /agent/chat-with-profile
   * Body: {
   *   "scenario": "wechat-group-assistant",
   *   "message": "你好",
   *   "roomId": "room-123",
   *   "fromUser": "user-456"
   * }
   */
  @Post('chat-with-profile')
  async chatWithProfile(
    @Body()
    body: {
      scenario: string;
      message: string;
      roomId?: string;
      fromUser: string;
      overrides?: any;
    },
  ) {
    this.logger.log(`使用配置档案聊天: ${body.scenario}, 消息: ${body.message}`);

    // 获取配置档案
    const profile = await this.agentConfigService.getProfile(body.scenario);
    if (!profile) {
      throw new HttpException(`未找到场景 ${body.scenario} 的配置`, HttpStatus.NOT_FOUND);
    }

    // 生成会话ID
    const conversationId = body.roomId ? `room_${body.roomId}` : `user_${body.fromUser}`;

    const result = await this.agentService.chatWithProfile(
      conversationId,
      body.message,
      profile,
      body.overrides,
    );

    // 基于状态返回不同响应
    if (result.status === 'error') {
      throw new HttpException(
        result.error?.message || 'Agent 调用失败',
        result.error?.retryable ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return {
      conversationId,
      scenario: body.scenario,
      response: result.data || result.fallback,
      metadata: {
        status: result.status,
        fromCache: result.fromCache,
        correlationId: result.correlationId,
        ...(result.fallbackInfo && { fallbackInfo: result.fallbackInfo }),
      },
    };
  }
}
