import { Process, Processor, OnQueueFailed, OnQueueCompleted } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import {
  AgentService,
  ProfileLoaderService,
  AgentConfigValidator,
  AgentResultHelper,
} from '@agent';
import { MessageSenderService } from '../message-sender/message-sender.service';
import { MessageType as SendMessageType } from '../message-sender/dto/send-message.dto';
import { EnterpriseMessageCallbackDto } from './dto/message-callback.dto';

// 导入新的子服务
import { MessageHistoryService } from './services/message-history.service';
import { MessageFilterService } from './services/message-filter.service';
import { MessageMergeService } from './services/message-merge.service';

// 导入工具类
import { MessageParser } from './utils/message-parser.util';

/**
 * 消息队列处理器（重构版）
 * 负责处理 Bull 队列中的消息聚合任务
 *
 * 重构说明：
 * - 移除重复代码，复用新创建的子服务
 * - 从 312 行精简到 ~120 行
 */
@Processor('message-merge')
export class MessageProcessor {
  private readonly logger = new Logger(MessageProcessor.name);

  constructor(
    private readonly agentService: AgentService,
    private readonly profileLoader: ProfileLoaderService,
    private readonly configValidator: AgentConfigValidator,
    private readonly messageSenderService: MessageSenderService,
    // 注入新的子服务
    private readonly historyService: MessageHistoryService,
    private readonly filterService: MessageFilterService,
    private readonly mergeService: MessageMergeService,
  ) {
    this.logger.log('MessageProcessor 已初始化（Bull Queue 模式，并发数: 3）');
  }

  /**
   * 处理消息聚合任务
   * 设置并发数为 3，限制同时处理的 Agent API 调用数量
   */
  @Process({ name: 'merge', concurrency: 3 })
  async handleMessageMerge(job: Job<{ messages: EnterpriseMessageCallbackDto[] }>) {
    const { messages } = job.data;

    if (!messages || messages.length === 0) {
      this.logger.warn(`[Bull] 任务 ${job.id} 数据为空`);
      return;
    }

    const chatId = messages[0].chatId;
    this.logger.log(`[Bull] 开始处理任务 ${job.id}, chatId: ${chatId}, 消息数: ${messages.length}`);

    try {
      // 过滤有效消息（复用 FilterService）
      const validMessages: EnterpriseMessageCallbackDto[] = [];

      for (const messageData of messages) {
        const filterResult = this.filterService.validate(messageData);
        if (filterResult.pass) {
          validMessages.push(messageData);
        } else {
          this.logger.debug(
            `[Bull] 跳过消息 [${messageData.messageId}], 原因: ${filterResult.reason}`,
          );
        }
      }

      if (validMessages.length === 0) {
        this.logger.debug(`[Bull] 任务 ${job.id} 没有有效内容`);
        // 检查是否有在处理期间到达的新消息（不直接重置，避免丢失待处理消息）
        await this.mergeService.onAgentResponseReceived(chatId);
        return;
      }

      // 合并消息内容
      const mergedContents = validMessages.map((m) => MessageParser.extractContent(m));
      const mergedContent = mergedContents.join('\n');

      this.logger.log(
        `[Bull] 合并后的消息: "${mergedContent.substring(0, 100)}${mergedContent.length > 100 ? '...' : ''}" (原始 ${validMessages.length} 条)`,
      );

      // 调用 AI 处理
      await this.processWithAI(chatId, mergedContent, validMessages[0]);

      // 更新任务进度
      await job.progress(100);

      // 检查是否有在处理期间到达的新消息
      // onAgentResponseReceived 会检查并自动添加新任务到队列
      await this.mergeService.onAgentResponseReceived(chatId);
    } catch (error) {
      this.logger.error(`[Bull] 任务 ${job.id} 处理失败: ${error.message}`);
      // 检查是否有在处理期间到达的新消息
      // 如果有，将它们重新入队，避免丢失
      const hasNewMessages = await this.mergeService.requeuePendingMessagesOnFailure(chatId);
      if (hasNewMessages) {
        this.logger.log(`[Bull] 已将处理期间收到的新消息重新入队`);
      }
      // 重置会话状态
      await this.mergeService.resetToIdle(chatId);
      throw error; // 抛出错误触发重试
    }
  }

  /**
   * 使用 AI 处理消息
   */
  private async processWithAI(
    chatId: string,
    mergedContent: string,
    messageData: EnterpriseMessageCallbackDto,
  ): Promise<void> {
    const parsedData = MessageParser.parse(messageData);
    const { token, contactName = '客户' } = parsedData;
    const scenarioType = parsedData.isRoom ? '群聊' : '私聊';

    try {
      // 判断消息场景（复用 MessageParser）
      const scenario = MessageParser.determineScenario();
      const agentProfile = this.profileLoader.getProfile(scenario);

      if (!agentProfile) {
        this.logger.error(`无法获取场景 ${scenario} 的 Agent 配置`);
        return;
      }

      // 验证配置有效性
      try {
        this.configValidator.validateRequiredFields(agentProfile);
        const contextValidation = this.configValidator.validateContext(agentProfile.context);
        if (!contextValidation.isValid) {
          this.logger.error(`Agent 配置验证失败: ${contextValidation.errors.join(', ')}`);
          return;
        }
      } catch (error) {
        this.logger.error(`Agent 配置验证失败: ${error.message}`);
        return;
      }

      // 获取会话历史消息（复用 HistoryService）
      const historyMessages = await this.historyService.getHistory(chatId);
      this.logger.debug(`[Bull] 使用历史消息: ${historyMessages.length} 条`);

      // 添加当前用户消息到历史（复用 HistoryService）
      await this.historyService.addMessageToHistory(chatId, 'user', mergedContent);

      // 调用 Agent API 生成回复
      const agentResult = await this.agentService.chat({
        conversationId: chatId,
        userMessage: mergedContent,
        historyMessages,
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

      // 检查 Agent 调用结果
      if (AgentResultHelper.isError(agentResult)) {
        this.logger.error(`[Bull] Agent 调用失败:`, agentResult.error);
        throw new Error(agentResult.error?.message || 'Agent 调用失败');
      }

      // 提取响应（优先使用 data，降级时使用 fallback）
      const aiResponse = AgentResultHelper.getResponse(agentResult);
      if (!aiResponse) {
        this.logger.error(`[Bull] Agent 返回空响应`);
        throw new Error('Agent 返回空响应');
      }

      // 提取回复内容
      const replyContent = this.extractReplyContent(aiResponse);

      // 注意：assistant 消息历史由 isSelf=true 的回调存储，这里不再重复存储

      // 记录 token 使用情况
      const tokenInfo = aiResponse.usage ? `tokens=${aiResponse.usage.totalTokens}` : 'tokens=N/A';
      const toolsInfo =
        aiResponse.tools?.used && aiResponse.tools.used.length > 0
          ? `, tools=${aiResponse.tools.used.length}`
          : '';

      this.logger.log(
        `[Bull][${scenarioType}][${contactName}] 回复: "${replyContent.substring(0, 50)}${replyContent.length > 50 ? '...' : ''}" (${tokenInfo}${toolsInfo})`,
      );

      // 发送回复消息
      await this.messageSenderService.sendMessage({
        token,
        chatId,
        messageType: SendMessageType.TEXT,
        payload: {
          text: replyContent,
        },
      });
    } catch (error) {
      this.logger.error(`[Bull][${scenarioType}][${contactName}] 消息处理失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 提取 AI 回复内容
   */
  private extractReplyContent(aiResponse: any): string {
    if (!aiResponse.messages || aiResponse.messages.length === 0) {
      throw new Error('AI 未生成有效回复');
    }

    const lastAssistantMessage = aiResponse.messages.filter((m) => m.role === 'assistant').pop();

    if (!lastAssistantMessage?.parts || lastAssistantMessage.parts.length === 0) {
      throw new Error('AI 响应中没有找到助手消息');
    }

    const textParts = lastAssistantMessage.parts
      .filter((p) => p.type === 'text' && p.text)
      .map((p) => p.text);

    if (textParts.length === 0) {
      throw new Error('AI 响应中没有找到文本内容');
    }

    return textParts.join('\n\n');
  }

  /**
   * 任务完成回调
   */
  @OnQueueCompleted()
  onCompleted(job: Job) {
    this.logger.log(`[Bull] 任务 ${job.id} 完成`);
  }

  /**
   * 任务失败回调
   */
  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(`[Bull] 任务 ${job.id} 失败: ${error.message}`);
  }
}
