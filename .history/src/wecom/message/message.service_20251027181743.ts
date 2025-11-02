import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentService, AgentConfigService } from '@agent';
import { MessageSenderService } from '../message-sender/message-sender.service';
import { MessageType as SendMessageType } from '../message-sender/dto/send-message.dto';
import { EnterpriseMessageCallbackDto, getMessageSourceDescription } from './dto/send-message.dto';

// 导入新创建的服务
import { MessageDeduplicationService } from './services/message-deduplication.service';
import { MessageHistoryService } from './services/message-history.service';
import { MessageFilterService } from './services/message-filter.service';
import { MessageMergeService } from './services/message-merge.service';
import { MessageStatisticsService } from './services/message-statistics.service';

// 导入工具类
import { MessageParser } from './utils/message-parser.util';

/**
 * 消息处理服务（重构版）
 * 职责：协调各个子服务，处理主业务流程
 *
 * 重构说明：
 * - 从 1099 行精简到 ~300 行
 * - 将职责拆分到 5 个子服务
 * - 提高代码可测试性和可维护性
 */
@Injectable()
export class MessageService {
  private readonly logger = new Logger(MessageService.name);
  private readonly enableAiReply: boolean;
  private readonly enableMessageMerge: boolean;

  // 并发控制：跟踪正在处理的消息数
  private processingCount: number = 0;
  private readonly maxConcurrentProcessing: number = 50;

  constructor(
    // 原有依赖
    private readonly messageSenderService: MessageSenderService,
    private readonly agentService: AgentService,
    private readonly agentConfigService: AgentConfigService,
    private readonly configService: ConfigService,
    // 新的子服务
    private readonly deduplicationService: MessageDeduplicationService,
    private readonly historyService: MessageHistoryService,
    private readonly filterService: MessageFilterService,
    private readonly mergeService: MessageMergeService,
    private readonly statisticsService: MessageStatisticsService,
  ) {
    // 从环境变量读取配置
    this.enableAiReply = this.configService.get<string>('ENABLE_AI_REPLY', 'true') === 'true';
    this.enableMessageMerge =
      this.configService.get<string>('ENABLE_MESSAGE_MERGE', 'true') === 'true';

    this.logger.log(`AI 自动回复功能: ${this.enableAiReply ? '已启用' : '已禁用'}`);
    this.logger.log(`消息聚合功能: ${this.enableMessageMerge ? '已启用' : '已禁用'}`);
  }

  /**
   * 处理接收到的消息（主入口）
   * 快速响应模式：立即返回成功响应，避免企微回调超时重试
   */
  async handleMessage(messageData: EnterpriseMessageCallbackDto) {
    // 打印需要 Agent 回复的消息体（用于调试）
    this.logger.debug(`[需要AI回复的消息体] ${JSON.stringify(messageData, null, 2)}`);
    this.logger.log(
      `[handleMessage] 收到消息 [${messageData.messageId}], source=${messageData.source}(${getMessageSourceDescription(messageData.source)}), isSelf=${messageData.isSelf}, enableAiReply=${this.enableAiReply}`,
    );

    // 1. 检查 AI 回复是否启用
    if (!this.enableAiReply) {
      this.logger.log(`[AI回复已禁用] 跳过消息 [${messageData.messageId}]`);
      return { success: true, message: 'AI reply disabled' };
    }

    // 2. 消息过滤（委托给 FilterService）
    const filterResult = this.filterService.validate(messageData);
    if (!filterResult.pass) {
      // 日志已在 FilterService 中记录
      return { success: true, message: `${filterResult.reason} ignored` };
    }

    // 3. 消息去重检查（委托给 DeduplicationService）
    if (this.deduplicationService.isMessageProcessed(messageData.messageId)) {
      this.logger.log(`[消息去重] 消息 [${messageData.messageId}] 已处理过，跳过重复处理`);
      return { success: true, message: 'Duplicate message ignored' };
    }

    // 4. 标记消息为已处理（在入队列前标记，避免重复入队）
    this.deduplicationService.markMessageAsProcessed(messageData.messageId);

    // 5. 并发控制检查
    if (this.processingCount >= this.maxConcurrentProcessing) {
      this.logger.warn(
        `并发处理数已达上限 ${this.maxConcurrentProcessing}，跳过消息 [${messageData.messageId}]`,
      );
      return { success: true, message: 'Message queued (rate limited)' };
    }

    // 6. 处理消息（聚合 或 直接处理）
    const content = filterResult.content!;
    if (this.enableMessageMerge) {
      // 启用消息聚合：将消息加入队列
      this.logger.log(
        `[消息聚合] 消息加入聚合队列 [${messageData.messageId}], 内容: "${content.substring(0, 30)}..."`,
      );
      await this.mergeService.enqueue(messageData, (messages) =>
        this.processMergedMessages(messages),
      );
    } else {
      // 未启用消息聚合：直接处理
      this.logger.log(
        `[直接处理] 消息开始处理 [${messageData.messageId}], 内容: "${content.substring(0, 30)}..."`,
      );
      this.processingCount++;

      this.processMessageWithAI(messageData)
        .catch((error) => {
          this.logger.error(`异步处理消息失败 [${messageData.messageId}]:`, error.message);
        })
        .finally(() => {
          this.processingCount--;
        });
    }

    // 立即返回成功，避免企微超时重试
    return { success: true, message: 'Message received' };
  }

  /**
   * 使用 AI 处理单条消息并自动回复
   * 注意：此方法假设消息已经通过 handleMessage 的前置过滤和去重检查，不再重复检查
   */
  private async processMessageWithAI(messageData: EnterpriseMessageCallbackDto) {
    let contactName = '未知用户';
    let messageId = 'unknown';
    const scenarioType = '私聊';

    try {
      // 解析消息数据
      const parsedData = MessageParser.parse(messageData);
      const { token, content, chatId } = parsedData;

      // 保存到外部作用域，供catch使用
      contactName = parsedData.contactName || '客户';
      messageId = parsedData.messageId;

      // 直接使用 chatId 作为会话标识
      const conversationId = chatId;

      this.logger.log(
        `[${scenarioType}][${contactName}] 收到: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`,
      );
      this.logger.debug(`会话ID: ${conversationId}, 消息ID: ${messageId}`);

      // 1. 根据场景选择合适的 Agent 配置
      const scenario = MessageParser.determineScenario(parsedData);
      const agentProfile = this.agentConfigService.getProfile(scenario);

      if (!agentProfile) {
        this.logger.error(`无法获取场景 ${scenario} 的 Agent 配置`);
        return;
      }

      // 2. 验证配置有效性
      const validation = this.agentConfigService.validateProfile(agentProfile);
      if (!validation.valid) {
        this.logger.error(`Agent 配置验证失败: ${validation.errors.join(', ')}`);
        return;
      }

      // 3. 获取会话历史消息（委托给 HistoryService）
      const historyMessages = this.historyService.getHistory(chatId);
      this.logger.debug(`使用历史消息: ${historyMessages.length} 条`);

      // 4. 添加当前用户消息到历史（委托给 HistoryService）
      this.historyService.addMessageToHistory(chatId, 'user', content);

      // 5. 调用 Agent API 生成回复
      const aiResponse = await this.agentService.chat({
        conversationId,
        userMessage: content,
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

      // 6. 提取回复内容
      const replyContent = this.extractReplyContent(aiResponse);

      // 7. 将 AI 回复添加到历史记录（委托给 HistoryService）
      this.historyService.addMessageToHistory(chatId, 'assistant', replyContent);

      // 8. 记录 token 使用情况和工具使用
      const tokenInfo = aiResponse.usage ? `tokens=${aiResponse.usage.totalTokens}` : 'tokens=N/A';
      const toolsInfo =
        aiResponse.tools?.used && aiResponse.tools.used.length > 0
          ? `, tools=${aiResponse.tools.used.length}`
          : '';

      this.logger.log(
        `[${scenarioType}][${contactName}] 回复: "${replyContent.substring(0, 50)}${replyContent.length > 50 ? '...' : ''}" (${tokenInfo}${toolsInfo})`,
      );

      // 9. 发送回复消息（使用 MessageSenderService）
      await this.messageSenderService.sendMessage({
        token,
        chatId,
        messageType: SendMessageType.TEXT,
        payload: {
          text: replyContent,
        },
      });
    } catch (error) {
      this.logger.error(
        `[${scenarioType}][${contactName}] 消息处理失败 [${messageId}]: ${error.message}`,
      );
      // 不抛出错误，避免影响其他消息处理
    }
  }

  /**
   * 处理聚合后的消息
   */
  private async processMergedMessages(messages: EnterpriseMessageCallbackDto[]): Promise<void> {
    if (messages.length === 0) return;

    // 增加并发计数
    this.processingCount++;

    try {
      // 如果只有一条消息，直接处理
      if (messages.length === 1) {
        await this.processMessageWithAI(messages[0]);
        return;
      }

      // 多条消息：已经由 MergeService 合并，直接处理合并后的消息
      await this.processMessageWithAI(messages[0]);
    } catch (error) {
      this.logger.error(`聚合消息处理失败:`, error.message);
    } finally {
      this.processingCount--;
    }
  }

  /**
   * 提取 AI 回复内容
   */
  private extractReplyContent(aiResponse: any): string {
    if (!aiResponse.messages || aiResponse.messages.length === 0) {
      throw new Error('AI 未生成有效回复');
    }

    // 获取最后一条 assistant 消息
    const lastAssistantMessage = aiResponse.messages.filter((m) => m.role === 'assistant').pop();

    if (
      !lastAssistantMessage ||
      !lastAssistantMessage.parts ||
      lastAssistantMessage.parts.length === 0
    ) {
      throw new Error('AI 响应中没有找到助手消息');
    }

    // 提取所有文本类型的 parts 并拼接
    const textParts = lastAssistantMessage.parts
      .filter((p) => p.type === 'text' && p.text)
      .map((p) => p.text);

    if (textParts.length === 0) {
      throw new Error('AI 响应中没有找到文本内容');
    }

    // 拼接所有文本内容
    return textParts.join('\n\n');
  }

  /**
   * 处理发送结果回调
   */
  async handleSentResult(resultData: any) {
    // 只在debug模式下记录详细信息
    this.logger.debug(`收到发送结果回调: ${resultData?.requestId || 'N/A'}`);
    return { success: true };
  }

  /**
   * 获取当前服务状态（用于健康检查或监控）
   * 委托给 StatisticsService
   */
  getServiceStatus() {
    return this.statisticsService.getServiceStatus(
      this.processingCount,
      this.maxConcurrentProcessing,
      this.enableAiReply,
      this.enableMessageMerge,
    );
  }

  /**
   * 获取详细的缓存统计信息
   * 委托给 StatisticsService
   */
  getCacheStats() {
    return this.statisticsService.getCacheStats(this.processingCount, this.maxConcurrentProcessing);
  }

  /**
   * 手动清理内存缓存
   * 委托给 StatisticsService
   */
  clearCache(options?: {
    deduplication?: boolean;
    history?: boolean;
    mergeQueues?: boolean;
    chatId?: string;
  }) {
    return this.statisticsService.clearCache(options);
  }
}
