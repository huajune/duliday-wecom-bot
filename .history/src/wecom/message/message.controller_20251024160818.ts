import { Controller, Post, Body, Logger } from '@nestjs/common';
import { MessageService } from './message.service';
import { RawResponse } from '@core/server';
import { AgentService, AgentConfigService, ScenarioType } from '@agent';

/**
 * 消息处理控制器
 * 负责接收和处理企微机器人的消息回调
 *
 * 注意：企微回调接口必须返回特定格式，使用 @RawResponse 豁免统一包装
 */
@Controller('message')
export class MessageController {
  private readonly logger = new Logger(MessageController.name);

  constructor(
    private readonly messageService: MessageService,
    private readonly agentService: AgentService,
    private readonly agentConfigService: AgentConfigService,
  ) {}

  /**
   * 接收企微机器人推送的消息
   * @description 接收消息回调，支持 AI 自动回复
   * @example POST /message
   */
  @RawResponse() // 企微回调必须返回原始格式，不使用统一包装
  @Post()
  async receiveMessage(@Body() body: any) {
    this.logger.log('接收到消息回调');
    return await this.messageService.handleMessage(body);
  }

  /**
   * 接收消息发送结果回调
   * @description 接收消息发送状态的回调通知
   * @example POST /message/sent-result
   */
  @RawResponse() // 企微回调必须返回原始格式，不使用统一包装
  @Post('sent-result')
  async receiveSentResult(@Body() body: any) {
    this.logger.log('接收到发送结果回调');
    return await this.messageService.handleSentResult(body);
  }

  /**
   * 测试接口：模拟消息回调并真实调用 Agent API
   * @description 用于测试 AI 回复质量，直接调用 Agent API 并返回详细响应
   * @example POST /message/test
   * @body { "text": "你好，有什么岗位？", "chatId": "test_chat_123", "contactName": "测试用户" }
   */
  @Post('test')
  async testMessage(
    @Body()
    body: {
      text: string;
      chatId?: string;
      contactName?: string;
      scenario?: ScenarioType;
    },
  ) {
    this.logger.log('收到测试消息请求:', body);

    const chatId = body.chatId || `test_chat_${Date.now()}`;
    const userMessage = body.text;
    const scenario = body.scenario || ScenarioType.CANDIDATE_CONSULTATION;

    try {
      // 1. 获取 Agent 配置
      const agentProfile = this.agentConfigService.getProfile(scenario);
      if (!agentProfile) {
        return {
          success: false,
          error: `无法获取场景 ${scenario} 的 Agent 配置`,
        };
      }

      this.logger.log(`使用 Agent 配置: ${agentProfile.name} - ${agentProfile.description}`);

      // 2. 验证配置有效性
      const validation = this.agentConfigService.validateProfile(agentProfile);
      if (!validation.valid) {
        return {
          success: false,
          error: `Agent 配置验证失败: ${validation.errors.join(', ')}`,
        };
      }

      // 3. 调用 Agent API
      this.logger.log(`正在调用 Agent API，会话 ID: ${chatId}`);
      const startTime = Date.now();

      const aiResponse = await this.agentService.chat({
        conversationId: chatId,
        userMessage,
        historyMessages: [], // 测试接口不保留历史
        model: agentProfile.model,
        systemPrompt: agentProfile.systemPrompt,
        promptType: agentProfile.promptType,
        allowedTools: agentProfile.allowedTools,
        context: agentProfile.context,
        toolContext: agentProfile.toolContext,
        contextStrategy: agentProfile.contextStrategy,
        prune: agentProfile.prune,
        pruneOptions: agentProfile.pruneOptions,
      });

      const responseTime = Date.now() - startTime;

      // 4. 提取回复内容
      let replyContent = '';
      if (aiResponse.messages && aiResponse.messages.length > 0) {
        const assistantMessage = aiResponse.messages.find((m) => m.role === 'assistant');
        if (assistantMessage && assistantMessage.parts && assistantMessage.parts.length > 0) {
          const textPart = assistantMessage.parts.find((p) => p.type === 'text');
          if (textPart && textPart.text) {
            replyContent = textPart.text;
          }
        }
      }

      // 5. 返回详细的测试结果
      return {
        success: true,
        message: '测试完成',
        testInfo: {
          scenario,
          scenarioName: agentProfile.name,
          chatId,
          contactName: body.contactName || '测试用户',
          userMessage,
          responseTime: `${responseTime}ms`,
        },
        agentResponse: {
          // AI 回复内容
          replyContent,
          replyLength: replyContent.length,

          // Token 使用情况
          usage: aiResponse.usage
            ? {
                inputTokens: aiResponse.usage.inputTokens,
                outputTokens: aiResponse.usage.outputTokens,
                totalTokens: aiResponse.usage.totalTokens,
                cachedInputTokens: aiResponse.usage.cachedInputTokens || 0,
              }
            : null,

          // 使用的工具
          toolsUsed: aiResponse.tools?.used || [],

          // 完整的 messages 数组（用于调试）
          messages: aiResponse.messages,
        },
        agentConfig: {
          model: agentProfile.model,
          allowedTools: agentProfile.allowedTools,
          promptType: agentProfile.promptType,
          contextStrategy: agentProfile.contextStrategy,
        },
      };
    } catch (error: any) {
      this.logger.error('测试消息处理失败:', error);
      return {
        success: false,
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      };
    }
  }
}
