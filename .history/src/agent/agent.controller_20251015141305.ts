import { Controller, Get, Post, Body, Logger, Query } from '@nestjs/common';
import { AgentService } from './agent.service';
import { AgentConfigService } from './agent-config.service';
import { ScenarioType } from './interfaces/agent-profile.interface';

@Controller('agent')
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(
    private readonly agentService: AgentService,
    private readonly agentConfigService: AgentConfigService,
  ) {}

  /**
   * 健康检查
   * GET /agent/health
   */
  @Get('health')
  async healthCheck() {
    return await this.agentService.healthCheck();
  }

  /**
   * 获取可用工具列表
   * GET /agent/tools
   */
  @Get('tools')
  async getTools() {
    return await this.agentService.getTools();
  }

  /**
   * 获取可用模型列表
   * GET /agent/models
   */
  @Get('models')
  async getModels() {
    return await this.agentService.getModels();
  }

  /**
   * 获取可用的 promptType 列表
   * GET /agent/prompt-types
   */
  @Get('prompt-types')
  async getPromptTypes() {
    return await this.agentService.getPromptTypes();
  }

  /**
   * 测试聊天接口
   * POST /agent/test-chat
   * Body: { "message": "你好", "conversationId": "test-user" }
   */
  @Post('test-chat')
  async testChat(@Body() body: { message: string; conversationId?: string; model?: string }) {
    this.logger.log('测试聊天:', body.message);
    const conversationId = body.conversationId || 'test-user';
    return await this.agentService.chat({
      conversationId,
      userMessage: body.message,
      model: body.model,
    });
  }

  /**
   * 获取所有配置档案
   * GET /agent/profiles
   */
  @Get('profiles')
  async getProfiles() {
    const profiles = this.agentConfigService.getAllProfiles();
    return {
      success: true,
      data: profiles.map((p) => ({
        name: p.name,
        description: p.description,
        model: p.model,
        allowedTools: p.allowedTools,
        hasContext: !!p.context,
        contextStrategy: p.contextStrategy,
        prune: p.prune,
      })),
    };
  }

  /**
   * 获取特定配置档案
   * GET /agent/profiles/:scenario
   */
  @Get('profiles/:scenario')
  async getProfile(@Query('scenario') scenario: string) {
    const profile = this.agentConfigService.getProfile(scenario);
    if (!profile) {
      return {
        success: false,
        error: `未找到场景 ${scenario} 的配置`,
      };
    }

    return {
      success: true,
      data: profile,
    };
  }

  /**
   * 验证配置档案
   * GET /agent/profiles/:scenario/validate
   */
  @Get('profiles/:scenario/validate')
  async validateProfile(@Query('scenario') scenario: string) {
    const profile = this.agentConfigService.getProfile(scenario);
    if (!profile) {
      return {
        success: false,
        error: `未找到场景 ${scenario} 的配置`,
      };
    }

    const validation = this.agentConfigService.validateProfile(profile);
    return {
      success: true,
      data: validation,
    };
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
    const profile = this.agentConfigService.getProfile(body.scenario);
    if (!profile) {
      return {
        success: false,
        error: `未找到场景 ${body.scenario} 的配置`,
      };
    }

    // 生成会话ID
    const conversationId = body.roomId ? `room_${body.roomId}` : `user_${body.fromUser}`;

    try {
      const response = await this.agentService.chatWithProfile(
        conversationId,
        body.message,
        profile,
        body.overrides,
      );

      return {
        success: true,
        data: {
          conversationId,
          scenario: body.scenario,
          response,
        },
      };
    } catch (error) {
      this.logger.error('聊天失败:', error);
      return {
        success: false,
        error: error.message,
        details: error.details || {},
      };
    }
  }
}
