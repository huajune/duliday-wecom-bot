import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnterpriseMessageCallbackDto } from '../dto/message-callback.dto';
import {
  ConversationState,
  ConversationStatus,
  OverflowStrategy,
  MessageProcessor,
} from '../interfaces/message-merge.interface';
import { MessageParser } from '../utils/message-parser.util';

/**
 * 智能消息聚合服务
 *
 * 核心策略：
 * 1. 首次聚合（WAITING）：收到第一条消息后等待短时间（1秒），聚合快速连发的消息
 * 2. Agent处理中（PROCESSING）：在Agent处理期间（~5秒），被动收集新消息
 * 3. 响应后检查：Agent响应完成后，检查是否有新消息
 *    - 有新消息 → 重新请求Agent（最多重试1次）
 *    - 无新消息 → 直接发送回复
 *
 * 优势：
 * - 单条消息响应快（1秒等待 + 5秒处理 = 6秒）
 * - 充分利用Agent处理时间收集用户补充信息
 * - 避免用户等待过长（最坏11秒 vs 旧方案16秒）
 */
@Injectable()
export class MessageMergeService implements OnModuleDestroy {
  private readonly logger = new Logger(MessageMergeService.name);

  // 会话状态映射 (chatId -> ConversationState)
  private readonly conversations = new Map<string, ConversationState>();

  // 配置参数
  private readonly initialMergeWindow: number; // 首次聚合等待时间
  private readonly maxMergedMessages: number; // 最多聚合消息数
  private readonly maxRetryCount: number; // 最大重试次数
  private readonly minMessageLength: number; // 触发重试的最小消息长度
  private readonly collectDuringProcessing: boolean; // 是否在处理期间收集新消息
  private readonly overflowStrategy: OverflowStrategy; // 溢出策略

  constructor(private readonly configService: ConfigService) {
    // 从环境变量读取配置
    this.initialMergeWindow = parseInt(
      this.configService.get<string>('INITIAL_MERGE_WINDOW_MS', '1000'),
      10,
    );
    this.maxMergedMessages = parseInt(
      this.configService.get<string>('MAX_MERGED_MESSAGES', '3'),
      10,
    );
    this.maxRetryCount = parseInt(this.configService.get<string>('MAX_RETRY_COUNT', '1'), 10);
    this.minMessageLength = parseInt(
      this.configService.get<string>('MIN_MESSAGE_LENGTH_TO_RETRY', '2'),
      10,
    );
    this.collectDuringProcessing =
      this.configService.get<string>('COLLECT_MESSAGES_DURING_PROCESSING', 'true') === 'true';
    this.overflowStrategy =
      (this.configService.get<string>('OVERFLOW_STRATEGY', 'take-latest') as OverflowStrategy) ||
      OverflowStrategy.TAKE_LATEST;

    this.logger.log(
      `智能消息聚合服务已初始化:\n` +
        `  - 首次等待时间: ${this.initialMergeWindow}ms\n` +
        `  - 最多聚合消息: ${this.maxMergedMessages} 条\n` +
        `  - 最大重试次数: ${this.maxRetryCount} 次\n` +
        `  - 最小消息长度: ${this.minMessageLength} 字符\n` +
        `  - 处理期间收集: ${this.collectDuringProcessing ? '启用' : '禁用'}\n` +
        `  - 溢出策略: ${this.overflowStrategy}`,
    );
  }

  /**
   * 处理新消息
   * 这是外部调用的主入口
   */
  async handleMessage(
    messageData: EnterpriseMessageCallbackDto,
    processor: MessageProcessor,
  ): Promise<void> {
    const chatId = messageData.chatId;
    const content = MessageParser.extractContent(messageData);

    this.logger.debug(
      `[${chatId}] 收到新消息 [${messageData.messageId}]: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`,
    );

    // 获取或创建会话状态
    let state = this.conversations.get(chatId);

    if (!state) {
      // 新会话：创建状态并进入 WAITING
      state = this.createConversationState(chatId);
      this.conversations.set(chatId, state);
      this.logger.log(`[${chatId}] 创建新会话状态`);
    }

    // 根据当前状态处理消息
    switch (state.status) {
      case ConversationStatus.IDLE:
        // 空闲状态：启动首次聚合等待
        await this.handleIdleState(state, messageData, processor);
        break;

      case ConversationStatus.WAITING:
        // 等待中：将消息加入队列（同步返回，避免阻塞 HTTP 回调）
        this.handleWaitingState(state, messageData, processor);
        break;

      case ConversationStatus.PROCESSING:
        // 处理中：根据配置决定是否收集
        this.handleProcessingState(state, messageData);
        break;
    }
  }

  /**
   * Agent处理完成后的回调
   * MessageService 在收到 Agent 响应后调用此方法
   */
  async onAgentResponseReceived(chatId: string, processor: MessageProcessor): Promise<boolean> {
    const state = this.conversations.get(chatId);

    if (!state || state.status !== ConversationStatus.PROCESSING) {
      this.logger.warn(
        `[${chatId}] Agent响应完成，但会话状态异常: ${state?.status || 'not found'}`,
      );
      return false; // 不需要重试
    }

    const { currentRequest, pendingMessages } = state;
    const processingTime = Date.now() - currentRequest!.startTime;

    this.logger.log(
      `[${chatId}] Agent处理完成，耗时 ${processingTime}ms，` +
        `待处理消息: ${pendingMessages.length} 条，重试次数: ${currentRequest!.retryCount}`,
    );

    // 检查是否有新消息需要处理
    if (pendingMessages.length === 0) {
      // 没有新消息，结束流程
      this.logger.log(`[${chatId}] 无新消息，结束处理`);
      this.resetConversationState(chatId);
      return false; // 不需要重试
    }

    // 有新消息：检查是否可以重试
    const canRetry = currentRequest!.retryCount < this.maxRetryCount;

    if (!canRetry) {
      this.logger.warn(
        `[${chatId}] 达到最大重试次数 ${this.maxRetryCount}，` +
          `忽略 ${pendingMessages.length} 条新消息（已记录到历史）`,
      );
      this.resetConversationState(chatId);
      return false; // 不需要重试
    }

    // 检查新消息是否有效（至少有一条消息长度≥最小长度）
    const validMessages = pendingMessages.filter((pm) => {
      const content = MessageParser.extractContent(pm.messageData);
      return content.length >= this.minMessageLength;
    });

    if (validMessages.length === 0) {
      this.logger.log(
        `[${chatId}] 新消息长度不足（<${this.minMessageLength}字符），忽略并结束处理`,
      );
      this.resetConversationState(chatId);
      return false; // 不需要重试
    }

    // 重新处理消息
    this.logger.log(
      `[${chatId}] 发现 ${validMessages.length} 条有效新消息，准备重新处理（重试 ${currentRequest!.retryCount + 1}/${this.maxRetryCount}）`,
    );

    // 准备消息列表
    const messagesToProcess = this.prepareMessagesForProcessing(state);

    // 更新状态：增加重试次数
    state.currentRequest = {
      startTime: Date.now(),
      retryCount: currentRequest!.retryCount + 1,
      messageCount: messagesToProcess.length,
    };
    state.pendingMessages = []; // 清空待处理队列
    state.lastUpdateTime = Date.now();

    // 调用处理器
    try {
      await processor(messagesToProcess);
      return true; // 需要重试
    } catch (error) {
      this.logger.error(`[${chatId}] 重试处理失败:`, error);
      this.resetConversationState(chatId);
      return false;
    }
  }

  /**
   * 处理 IDLE 状态：启动首次聚合等待
   */
  private async handleIdleState(
    state: ConversationState,
    messageData: EnterpriseMessageCallbackDto,
    processor: MessageProcessor,
  ): Promise<void> {
    const chatId = state.chatId;

    // 添加消息到待处理队列
    state.pendingMessages.push({
      messageData,
      receivedAt: Date.now(),
    });

    // 启动聚合定时器
    state.initialTimer = setTimeout(async () => {
      await this.processInitialMerge(chatId, processor);
    }, this.initialMergeWindow);

    // 更新状态
    state.status = ConversationStatus.WAITING;
    state.firstMessageTime = Date.now();
    state.lastUpdateTime = Date.now();

    this.logger.log(
      `[${chatId}] 启动首次聚合，等待 ${this.initialMergeWindow}ms (或达到 ${this.maxMergedMessages} 条消息)`,
    );
  }

  /**
   * 处理 WAITING 状态：将消息加入队列
   */
  private handleWaitingState(
    state: ConversationState,
    messageData: EnterpriseMessageCallbackDto,
    processor: MessageProcessor,
  ): void {
    const chatId = state.chatId;

    // 添加消息到待处理队列
    state.pendingMessages.push({
      messageData,
      receivedAt: Date.now(),
    });
    state.lastUpdateTime = Date.now();

    const currentCount = state.pendingMessages.length;

    this.logger.debug(
      `[${chatId}] 消息加入等待队列，当前队列长度: ${currentCount}/${this.maxMergedMessages}`,
    );

    // 检查是否达到最大聚合数
    if (currentCount >= this.maxMergedMessages) {
      this.logger.log(`[${chatId}] 队列已达到最大聚合数 ${this.maxMergedMessages}，立即处理`);

      // 清除定时器
      if (state.initialTimer) {
        clearTimeout(state.initialTimer);
        state.initialTimer = undefined;
      }

      // 异步触发处理（不阻塞当前调用，避免企微回调超时）
      // 使用 setImmediate 确保在下一个事件循环中执行
      setImmediate(() => {
        this.processInitialMerge(chatId, processor).catch((error) => {
          this.logger.error(`[${chatId}] 立即处理失败:`, error);
        });
      });
    }
  }

  /**
   * 处理 PROCESSING 状态：Agent处理期间收到新消息
   */
  private handleProcessingState(
    state: ConversationState,
    messageData: EnterpriseMessageCallbackDto,
  ): void {
    const chatId = state.chatId;

    if (!this.collectDuringProcessing) {
      this.logger.debug(`[${chatId}] 处理期间收集功能已禁用，忽略新消息`);
      return;
    }

    // 添加到待处理队列
    state.pendingMessages.push({
      messageData,
      receivedAt: Date.now(),
    });
    state.lastUpdateTime = Date.now();

    const content = MessageParser.extractContent(messageData);
    this.logger.log(
      `[${chatId}] Agent处理中收到新消息 [${messageData.messageId}]: "${content.substring(0, 30)}..."，` +
        `待处理队列: ${state.pendingMessages.length} 条`,
    );
  }

  /**
   * 处理首次聚合：定时器触发或达到最大数量
   */
  private async processInitialMerge(chatId: string, processor: MessageProcessor): Promise<void> {
    const state = this.conversations.get(chatId);

    if (!state || state.status !== ConversationStatus.WAITING) {
      this.logger.warn(
        `[${chatId}] 聚合定时器触发，但会话状态异常: ${state?.status || 'not found'}`,
      );
      return;
    }

    const messageCount = state.pendingMessages.length;
    const waitTime = Date.now() - state.firstMessageTime;

    this.logger.log(
      `[${chatId}] 首次聚合完成，收集到 ${messageCount} 条消息，等待时间 ${waitTime}ms`,
    );

    // 准备消息列表
    const messagesToProcess = this.prepareMessagesForProcessing(state);

    // 更新状态
    state.status = ConversationStatus.PROCESSING;
    state.currentRequest = {
      startTime: Date.now(),
      retryCount: 0,
      messageCount: messagesToProcess.length,
    };
    state.pendingMessages = []; // 清空待处理队列
    state.initialTimer = undefined;
    state.lastUpdateTime = Date.now();

    // 调用处理器
    try {
      await processor(messagesToProcess);
    } catch (error) {
      this.logger.error(`[${chatId}] 消息处理失败:`, error);
      this.resetConversationState(chatId);
    }
  }

  /**
   * 准备要处理的消息列表
   *
   * 策略：根据 overflowStrategy 处理溢出消息
   * - TAKE_LATEST: 只取最新的 maxMergedMessages 条
   * - TAKE_ALL: 全部处理（不推荐）
   */
  private prepareMessagesForProcessing(state: ConversationState): EnterpriseMessageCallbackDto[] {
    const { chatId, pendingMessages } = state;
    const messageCount = pendingMessages.length;

    if (messageCount === 0) {
      this.logger.warn(`[${chatId}] 待处理队列为空`);
      return [];
    }

    // 检查是否溢出
    if (messageCount > this.maxMergedMessages) {
      if (this.overflowStrategy === OverflowStrategy.TAKE_LATEST) {
        // 只取最新的 N 条消息
        const messages = pendingMessages.slice(-this.maxMergedMessages).map((pm) => pm.messageData);
        this.logger.warn(
          `[${chatId}] 消息溢出 (${messageCount} > ${this.maxMergedMessages})，` +
            `采用 TAKE_LATEST 策略，只处理最新 ${this.maxMergedMessages} 条`,
        );
        return messages;
      } else {
        // TAKE_ALL: 全部处理
        this.logger.warn(
          `[${chatId}] 消息溢出 (${messageCount} > ${this.maxMergedMessages})，` +
            `采用 TAKE_ALL 策略，处理全部 ${messageCount} 条消息`,
        );
        return pendingMessages.map((pm) => pm.messageData);
      }
    }

    // 未溢出，返回所有消息
    this.logger.log(`[${chatId}] 准备处理 ${messageCount} 条消息`);
    return pendingMessages.map((pm) => pm.messageData);
  }

  /**
   * 创建新的会话状态
   */
  private createConversationState(chatId: string): ConversationState {
    return {
      chatId,
      status: ConversationStatus.IDLE,
      firstMessageTime: Date.now(),
      pendingMessages: [],
      lastUpdateTime: Date.now(),
    };
  }

  /**
   * 重置会话状态到 IDLE
   */
  private resetConversationState(chatId: string): void {
    const state = this.conversations.get(chatId);

    if (!state) {
      return;
    }

    // 清除定时器
    if (state.initialTimer) {
      clearTimeout(state.initialTimer);
    }

    // 重置状态
    state.status = ConversationStatus.IDLE;
    state.pendingMessages = [];
    state.currentRequest = undefined;
    state.initialTimer = undefined;
    state.lastUpdateTime = Date.now();

    this.logger.debug(`[${chatId}] 会话状态已重置为 IDLE`);
  }

  /**
   * 获取并清空待处理的消息
   * 用于在 MessageService 中循环控制重试
   */
  getPendingMessages(chatId: string): EnterpriseMessageCallbackDto[] {
    const state = this.conversations.get(chatId);

    if (!state || state.pendingMessages.length === 0) {
      return [];
    }

    // 提取消息并清空队列
    const messages = state.pendingMessages.map((pm) => pm.messageData);
    state.pendingMessages = [];
    state.lastUpdateTime = Date.now();

    this.logger.debug(`[${chatId}] 提取 ${messages.length} 条待处理消息`);
    return messages;
  }

  /**
   * 重置会话状态为 IDLE（公共方法）
   * 用于在发送回复前重置状态，避免竞态条件
   */
  resetToIdle(chatId: string): void {
    this.resetConversationState(chatId);
  }

  clearConversation(chatId: string): void {
    const state = this.conversations.get(chatId);

    if (state) {
      // 清除定时器
      if (state.initialTimer) {
        clearTimeout(state.initialTimer);
      }

      this.conversations.delete(chatId);
      this.logger.log(`[${chatId}] 会话已清理`);
    }
  }

  /**
   * 获取会话统计信息
   */
  getStats() {
    const stats = {
      totalConversations: this.conversations.size,
      byStatus: {
        idle: 0,
        waiting: 0,
        processing: 0,
      },
      totalPendingMessages: 0,
    };

    for (const state of this.conversations.values()) {
      stats.byStatus[state.status]++;
      stats.totalPendingMessages += state.pendingMessages.length;
    }

    return {
      ...stats,
      config: {
        initialMergeWindow: this.initialMergeWindow,
        maxMergedMessages: this.maxMergedMessages,
        maxRetryCount: this.maxRetryCount,
        minMessageLength: this.minMessageLength,
        collectDuringProcessing: this.collectDuringProcessing,
        overflowStrategy: this.overflowStrategy,
      },
    };
  }

  /**
   * 模块销毁钩子
   */
  onModuleDestroy() {
    // 清理所有定时器
    for (const state of this.conversations.values()) {
      if (state.initialTimer) {
        clearTimeout(state.initialTimer);
      }
    }

    this.conversations.clear();
    this.logger.log('智能消息聚合服务已销毁');
  }
}
