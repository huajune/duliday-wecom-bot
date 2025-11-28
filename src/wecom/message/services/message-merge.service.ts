import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { RedisService } from '@core/redis';
import { SupabaseService, AgentReplyConfig } from '@core/supabase';
import { EnterpriseMessageCallbackDto } from '../dto/message-callback.dto';
import {
  ConversationState,
  ConversationStatus,
  OverflowStrategy,
  PersistableConversationState,
} from '../interfaces/message-merge.interface';
import { MessageParser } from '../utils/message-parser.util';
import {
  MAX_RETRY_COUNT,
  MIN_MESSAGE_LENGTH_TO_RETRY,
  COLLECT_MESSAGES_DURING_PROCESSING,
  OVERFLOW_STRATEGY,
} from '@core/config/constants/message.constants';

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
export class MessageMergeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessageMergeService.name);

  // Redis key 前缀
  private readonly STATE_KEY_PREFIX = 'chat:merge:';
  private readonly STATE_TTL_SECONDS = 300; // 5分钟 TTL，足够覆盖聚合和处理时间

  // 定时器映射（只在内存中，不能序列化）
  private readonly timers = new Map<string, NodeJS.Timeout>();

  // 超时扫描定时器
  private timeoutScanTimer: NodeJS.Timeout | null = null;
  private readonly TIMEOUT_SCAN_INTERVAL_MS = 60 * 1000; // 每分钟扫描一次
  private readonly PROCESSING_TIMEOUT_MS = 3 * 60 * 1000; // 3分钟超时

  // 配置参数（支持动态更新）
  private initialMergeWindow: number; // 首次聚合等待时间
  private maxMergedMessages: number; // 最多聚合消息数
  private readonly maxRetryCount: number; // 最大重试次数（不支持动态更新）
  private readonly minMessageLength: number; // 触发重试的最小消息长度（不支持动态更新）
  private readonly collectDuringProcessing: boolean; // 是否在处理期间收集新消息（不支持动态更新）
  private readonly overflowStrategy: OverflowStrategy; // 溢出策略（不支持动态更新）

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly supabaseService: SupabaseService,
    @InjectQueue('message-merge') private readonly messageQueue: Queue,
  ) {
    // 从环境变量读取初始配置（作为默认值）
    // 注意：这些值随后会被 Supabase 的动态配置覆盖
    this.initialMergeWindow = 3000;
    this.maxMergedMessages = 3;

    // 使用常量配置
    this.maxRetryCount = MAX_RETRY_COUNT;
    this.minMessageLength = MIN_MESSAGE_LENGTH_TO_RETRY;
    this.collectDuringProcessing = COLLECT_MESSAGES_DURING_PROCESSING;
    this.overflowStrategy = OVERFLOW_STRATEGY as OverflowStrategy;

    // 注册配置变更回调
    this.supabaseService.onAgentReplyConfigChange((config) => {
      this.onConfigChange(config);
    });

    this.logger.log(
      `智能消息聚合服务已初始化 (Redis 持久化):\n` +
        `  - 首次等待时间: ${this.initialMergeWindow}ms\n` +
        `  - 最多聚合消息: ${this.maxMergedMessages} 条\n` +
        `  - 最大重试次数: ${this.maxRetryCount} 次\n` +
        `  - 最小消息长度: ${this.minMessageLength} 字符\n` +
        `  - 处理期间收集: ${this.collectDuringProcessing ? '启用' : '禁用'}\n` +
        `  - 溢出策略: ${this.overflowStrategy}`,
    );
  }

  /**
   * 配置变更回调
   */
  private onConfigChange(config: AgentReplyConfig): void {
    const oldMergeWindow = this.initialMergeWindow;
    const oldMaxMessages = this.maxMergedMessages;

    this.initialMergeWindow = config.initialMergeWindowMs;
    this.maxMergedMessages = config.maxMergedMessages;

    if (oldMergeWindow !== this.initialMergeWindow || oldMaxMessages !== this.maxMergedMessages) {
      this.logger.log(
        `消息聚合配置已更新:\n` +
          `  - 首次等待时间: ${oldMergeWindow}ms → ${this.initialMergeWindow}ms\n` +
          `  - 最多聚合消息: ${oldMaxMessages} → ${this.maxMergedMessages} 条`,
      );
    }
  }

  /**
   * 模块初始化：从 Redis 恢复会话状态，并加载动态配置
   */
  async onModuleInit() {
    this.logger.log('智能消息聚合服务已启动...');

    // 从 Supabase 加载动态配置
    try {
      const config = await this.supabaseService.getAgentReplyConfig();
      this.initialMergeWindow = config.initialMergeWindowMs;
      this.maxMergedMessages = config.maxMergedMessages;
      this.logger.log(
        `已从 Supabase 加载配置: 聚合等待=${this.initialMergeWindow}ms, 最大消息数=${this.maxMergedMessages}`,
      );
    } catch (error) {
      this.logger.warn('从 Supabase 加载配置失败，使用环境变量默认值');
    }

    // 延迟执行恢复，确保其他服务已初始化
    setTimeout(() => {
      this.recoverOrphanedStates().catch((error) => {
        this.logger.error('恢复孤立会话状态时发生错误:', error);
      });
    }, 2000);

    // 启动定时超时扫描
    this.startTimeoutScanner();
  }

  /**
   * 启动定时超时扫描器
   * 每分钟扫描一次，清理超时的 PROCESSING 状态
   */
  private startTimeoutScanner(): void {
    this.timeoutScanTimer = setInterval(() => {
      this.scanAndRecoverTimeoutStates().catch((error) => {
        this.logger.error('超时扫描失败:', error);
      });
    }, this.TIMEOUT_SCAN_INTERVAL_MS);

    this.logger.log(
      `超时扫描器已启动，间隔: ${this.TIMEOUT_SCAN_INTERVAL_MS / 1000}s，超时阈值: ${this.PROCESSING_TIMEOUT_MS / 1000}s`,
    );
  }

  /**
   * 扫描并恢复超时的 PROCESSING 状态
   */
  private async scanAndRecoverTimeoutStates(): Promise<void> {
    try {
      let cursor: string | number = 0;
      const pattern = `${this.STATE_KEY_PREFIX}*`;
      let recoveredCount = 0;

      do {
        const [nextCursor, keys] = await this.redisService.scan(cursor, {
          match: pattern,
          count: 100,
        });
        cursor = nextCursor;

        for (const key of keys) {
          const chatId = key.replace(this.STATE_KEY_PREFIX, '');
          const state = await this.getState(chatId);

          if (!state) continue;

          // 只处理 PROCESSING 状态
          if (state.status !== ConversationStatus.PROCESSING) continue;

          // 检查是否超时
          const processingDuration = Date.now() - (state.currentRequest?.startTime || 0);
          if (processingDuration <= this.PROCESSING_TIMEOUT_MS) continue;

          this.logger.warn(
            `[${chatId}] 扫描发现超时的 PROCESSING 状态 (${Math.round(processingDuration / 1000)}s)，` +
              `待处理消息: ${state.pendingMessages.length} 条，正在恢复...`,
          );

          // 收集待处理消息
          const pendingMessages = state.pendingMessages.map((pm) => pm.messageData);

          // 重置状态
          await this.resetConversationState(chatId);

          // 将待处理消息重新入队
          if (pendingMessages.length > 0) {
            try {
              await this.messageQueue.add('merge', { messages: pendingMessages });
              this.logger.log(
                `[${chatId}] 超时恢复：已将 ${pendingMessages.length} 条消息重新入队`,
              );
            } catch (error) {
              this.logger.error(`[${chatId}] 超时恢复：重新入队失败:`, error);
            }
          }

          recoveredCount++;
        }
      } while (cursor !== 0 && cursor !== '0');

      if (recoveredCount > 0) {
        this.logger.log(`超时扫描完成，已恢复 ${recoveredCount} 个超时会话`);
      }
    } catch (error) {
      this.logger.error('扫描超时状态失败:', error);
    }
  }

  /**
   * 恢复孤立的会话状态（WAITING/PROCESSING 状态但没有活跃的处理）
   */
  private async recoverOrphanedStates(): Promise<void> {
    try {
      // 使用 SCAN 扫描所有状态 key
      let cursor: string | number = 0;
      const pattern = `${this.STATE_KEY_PREFIX}*`;
      let recoveredCount = 0;

      do {
        const [nextCursor, keys] = await this.redisService.scan(cursor, {
          match: pattern,
          count: 100,
        });
        cursor = nextCursor;

        for (const key of keys) {
          const chatId = key.replace(this.STATE_KEY_PREFIX, '');
          const state = await this.getState(chatId);

          if (!state) continue;

          // 检查是否需要恢复
          if (
            (state.status === ConversationStatus.WAITING ||
              state.status === ConversationStatus.PROCESSING) &&
            state.pendingMessages.length > 0
          ) {
            this.logger.warn(
              `[${chatId}] 发现孤立的 ${state.status} 状态，待处理消息: ${state.pendingMessages.length} 条，正在恢复...`,
            );

            // 准备消息并入队
            const messagesToProcess = this.prepareMessagesForProcessingFromPersisted(state);
            if (messagesToProcess.length > 0) {
              try {
                await this.messageQueue.add('merge', { messages: messagesToProcess });
                // 更新状态为 PROCESSING
                state.status = ConversationStatus.PROCESSING;
                state.currentRequest = {
                  startTime: Date.now(),
                  retryCount: 0,
                  messageCount: messagesToProcess.length,
                };
                state.pendingMessages = [];
                state.lastUpdateTime = Date.now();
                await this.saveState(state);
                recoveredCount++;
              } catch (error) {
                this.logger.error(`[${chatId}] 恢复失败:`, error);
                // 重置状态
                await this.resetConversationState(chatId);
              }
            } else {
              // 没有有效消息，重置状态
              await this.resetConversationState(chatId);
            }
          }
        }
      } while (cursor !== 0 && cursor !== '0');

      if (recoveredCount > 0) {
        this.logger.log(`会话状态恢复完成，已恢复 ${recoveredCount} 个孤立会话`);
      } else {
        this.logger.log('会话状态扫描完成，没有需要恢复的孤立会话');
      }
    } catch (error) {
      this.logger.error('扫描孤立会话状态失败:', error);
    }
  }

  // ==================== Redis 状态操作 ====================

  /**
   * 从 Redis 获取会话状态
   */
  private async getState(chatId: string): Promise<PersistableConversationState | null> {
    try {
      const key = `${this.STATE_KEY_PREFIX}${chatId}`;
      return await this.redisService.get<PersistableConversationState>(key);
    } catch (error) {
      this.logger.error(`获取会话状态失败 [${chatId}]:`, error);
      return null;
    }
  }

  /**
   * 保存会话状态到 Redis
   */
  private async saveState(state: PersistableConversationState): Promise<void> {
    try {
      const key = `${this.STATE_KEY_PREFIX}${state.chatId}`;
      await this.redisService.setex(key, this.STATE_TTL_SECONDS, state);
    } catch (error) {
      this.logger.error(`保存会话状态失败 [${state.chatId}]:`, error);
    }
  }

  /**
   * 删除 Redis 中的会话状态
   */
  private async deleteState(chatId: string): Promise<void> {
    try {
      const key = `${this.STATE_KEY_PREFIX}${chatId}`;
      await this.redisService.del(key);
    } catch (error) {
      this.logger.error(`删除会话状态失败 [${chatId}]:`, error);
    }
  }

  /**
   * 将内存中的 ConversationState 转换为可持久化状态
   */
  private toPersistable(state: ConversationState): PersistableConversationState {
    return {
      chatId: state.chatId,
      status: state.status,
      firstMessageTime: state.firstMessageTime,
      pendingMessages: state.pendingMessages,
      currentRequest: state.currentRequest,
      lastUpdateTime: state.lastUpdateTime,
    };
  }

  /**
   * 处理新消息
   * 这是外部调用的主入口
   */
  async handleMessage(messageData: EnterpriseMessageCallbackDto): Promise<void> {
    const chatId = messageData.chatId;
    const content = MessageParser.extractContent(messageData);

    this.logger.debug(
      `[${chatId}] 收到新消息 [${messageData.messageId}]: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`,
    );

    // 从 Redis 获取会话状态
    let persistedState = await this.getState(chatId);

    if (!persistedState) {
      // 新会话：创建状态
      persistedState = {
        chatId,
        status: ConversationStatus.IDLE,
        firstMessageTime: Date.now(),
        pendingMessages: [],
        lastUpdateTime: Date.now(),
      };
      this.logger.log(`[${chatId}] 创建新会话状态`);
    }

    // 转换为内存状态（附加 timer）
    const state: ConversationState = {
      ...persistedState,
      initialTimer: this.timers.get(chatId),
    };

    // 根据当前状态处理消息
    switch (state.status) {
      case ConversationStatus.IDLE:
        // 空闲状态：启动首次聚合等待
        await this.handleIdleState(state, messageData);
        break;

      case ConversationStatus.WAITING:
        // 等待中：将消息加入队列
        // 检查是否是重启后的孤立 WAITING 状态（timer 丢失）
        if (!state.initialTimer && state.pendingMessages.length > 0) {
          this.logger.warn(
            `[${chatId}] 检测到孤立的 WAITING 状态（无 timer），先处理已有 ${state.pendingMessages.length} 条消息`,
          );
          // 添加当前消息到队列
          state.pendingMessages.push({
            messageData,
            receivedAt: Date.now(),
          });
          state.lastUpdateTime = Date.now();
          await this.saveState(this.toPersistable(state));
          // 立即触发处理
          setImmediate(() => {
            this.processInitialMerge(chatId).catch((error) => {
              this.logger.error(`[${chatId}] 恢复处理失败:`, error);
            });
          });
        } else {
          await this.handleWaitingState(state, messageData);
        }
        break;

      case ConversationStatus.PROCESSING:
        // 处理中：根据配置决定是否收集
        await this.handleProcessingState(state, messageData);
        break;
    }
  }

  /**
   * Agent处理完成后的回调
   * MessageProcessor 在处理完成后调用此方法检查是否有新消息
   */
  async onAgentResponseReceived(chatId: string): Promise<boolean> {
    const persistedState = await this.getState(chatId);

    if (!persistedState || persistedState.status !== ConversationStatus.PROCESSING) {
      this.logger.warn(
        `[${chatId}] Agent响应完成，但会话状态异常: ${persistedState?.status || 'not found'}`,
      );
      return false; // 不需要重试
    }

    const { currentRequest, pendingMessages } = persistedState;
    const processingTime = Date.now() - currentRequest!.startTime;

    this.logger.log(
      `[${chatId}] Agent处理完成，耗时 ${processingTime}ms，` +
        `待处理消息: ${pendingMessages.length} 条，重试次数: ${currentRequest!.retryCount}`,
    );

    // 检查是否有新消息需要处理
    if (pendingMessages.length === 0) {
      // 没有新消息，结束流程
      this.logger.log(`[${chatId}] 无新消息，结束处理`);
      await this.resetConversationState(chatId);
      return false; // 不需要重试
    }

    // 有新消息：检查是否可以重试
    const canRetry = currentRequest!.retryCount < this.maxRetryCount;

    if (!canRetry) {
      this.logger.warn(
        `[${chatId}] 达到最大重试次数 ${this.maxRetryCount}，` +
          `忽略 ${pendingMessages.length} 条新消息（已记录到历史）`,
      );
      await this.resetConversationState(chatId);
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
      await this.resetConversationState(chatId);
      return false; // 不需要重试
    }

    // 重新处理消息
    this.logger.log(
      `[${chatId}] 发现 ${validMessages.length} 条有效新消息，准备重新处理（重试 ${currentRequest!.retryCount + 1}/${this.maxRetryCount}）`,
    );

    // 准备消息列表
    const messagesToProcess = this.prepareMessagesForProcessingFromPersisted(persistedState);

    // 更新状态：增加重试次数
    persistedState.currentRequest = {
      startTime: Date.now(),
      retryCount: currentRequest!.retryCount + 1,
      messageCount: messagesToProcess.length,
    };
    persistedState.pendingMessages = []; // 清空待处理队列
    persistedState.lastUpdateTime = Date.now();

    // 保存状态到 Redis
    await this.saveState(persistedState);

    // 添加任务到队列
    try {
      await this.messageQueue.add('merge', { messages: messagesToProcess });
      this.logger.log(`[${chatId}] 重试任务已添加到队列，消息数: ${messagesToProcess.length}`);
      return true; // 需要重试
    } catch (error) {
      this.logger.error(`[${chatId}] 重试任务添加失败:`, error);
      await this.resetConversationState(chatId);
      return false;
    }
  }

  /**
   * 处理失败时重新入队待处理消息
   * 当 Bull 任务处理失败时，确保处理期间收到的新消息不会丢失
   */
  async requeuePendingMessagesOnFailure(chatId: string): Promise<boolean> {
    const persistedState = await this.getState(chatId);

    if (!persistedState || persistedState.pendingMessages.length === 0) {
      return false; // 没有待处理消息
    }

    // 准备消息列表
    const messagesToProcess = this.prepareMessagesForProcessingFromPersisted(persistedState);

    if (messagesToProcess.length === 0) {
      return false;
    }

    this.logger.log(`[${chatId}] 处理失败，将 ${messagesToProcess.length} 条待处理消息重新入队`);

    // 添加到队列（作为新任务，不是重试）
    try {
      await this.messageQueue.add('merge', { messages: messagesToProcess });
      return true;
    } catch (error) {
      this.logger.error(`[${chatId}] 重新入队失败:`, error);
      return false;
    }
  }

  /**
   * 处理 IDLE 状态：启动首次聚合等待
   */
  private async handleIdleState(
    state: ConversationState,
    messageData: EnterpriseMessageCallbackDto,
  ): Promise<void> {
    const chatId = state.chatId;

    // 添加消息到待处理队列
    state.pendingMessages.push({
      messageData,
      receivedAt: Date.now(),
    });

    // 启动聚合定时器（只存储在内存中）
    const timer = setTimeout(async () => {
      await this.processInitialMerge(chatId);
    }, this.initialMergeWindow);
    this.timers.set(chatId, timer);

    // 更新状态
    state.status = ConversationStatus.WAITING;
    state.firstMessageTime = Date.now();
    state.lastUpdateTime = Date.now();

    // 保存状态到 Redis（不含 timer）
    await this.saveState(this.toPersistable(state));

    this.logger.log(
      `[${chatId}] 启动首次聚合，等待 ${this.initialMergeWindow}ms (或达到 ${this.maxMergedMessages} 条消息)`,
    );
  }

  /**
   * 处理 WAITING 状态：将消息加入队列
   */
  private async handleWaitingState(
    state: ConversationState,
    messageData: EnterpriseMessageCallbackDto,
  ): Promise<void> {
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

    // 保存状态到 Redis
    await this.saveState(this.toPersistable(state));

    // 检查是否达到最大聚合数
    if (currentCount >= this.maxMergedMessages) {
      this.logger.log(`[${chatId}] 队列已达到最大聚合数 ${this.maxMergedMessages}，立即处理`);

      // 清除定时器
      const timer = this.timers.get(chatId);
      if (timer) {
        clearTimeout(timer);
        this.timers.delete(chatId);
      }

      // 异步触发处理（不阻塞当前调用，避免企微回调超时）
      // 使用 setImmediate 确保在下一个事件循环中执行
      setImmediate(() => {
        this.processInitialMerge(chatId).catch((error) => {
          this.logger.error(`[${chatId}] 立即处理失败:`, error);
        });
      });
    }
  }

  /**
   * 处理 PROCESSING 状态：Agent处理期间收到新消息
   * 包含超时保护：如果 PROCESSING 状态超过阈值，自动重置并重新处理
   */
  private async handleProcessingState(
    state: ConversationState,
    messageData: EnterpriseMessageCallbackDto,
  ): Promise<void> {
    const chatId = state.chatId;

    // 超时保护：检查 PROCESSING 状态是否卡住
    const PROCESSING_TIMEOUT_MS = 3 * 60 * 1000; // 3分钟
    const processingDuration = Date.now() - (state.currentRequest?.startTime || 0);

    if (processingDuration > PROCESSING_TIMEOUT_MS) {
      this.logger.warn(
        `[${chatId}] PROCESSING 状态超时 (${Math.round(processingDuration / 1000)}s > ${PROCESSING_TIMEOUT_MS / 1000}s)，强制重置并重新入队`,
      );

      // 收集所有待处理消息（包括当前新消息）
      const allPendingMessages = [
        ...state.pendingMessages.map((pm) => pm.messageData),
        messageData,
      ];

      // 重置状态
      await this.resetConversationState(chatId);

      // 将所有消息重新入队处理
      if (allPendingMessages.length > 0) {
        try {
          await this.messageQueue.add('merge', { messages: allPendingMessages });
          this.logger.log(`[${chatId}] 超时后已将 ${allPendingMessages.length} 条消息重新入队`);
        } catch (error) {
          this.logger.error(`[${chatId}] 超时后重新入队失败:`, error);
          // 降级：按 IDLE 状态重新处理当前消息
          const newState: ConversationState = {
            chatId,
            status: ConversationStatus.IDLE,
            firstMessageTime: Date.now(),
            pendingMessages: [],
            lastUpdateTime: Date.now(),
          };
          return this.handleIdleState(newState, messageData);
        }
      }

      return;
    }

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

    // 保存状态到 Redis
    await this.saveState(this.toPersistable(state));

    const content = MessageParser.extractContent(messageData);
    this.logger.log(
      `[${chatId}] Agent处理中收到新消息 [${messageData.messageId}]: "${content.substring(0, 30)}..."，` +
        `待处理队列: ${state.pendingMessages.length} 条`,
    );
  }

  /**
   * 处理首次聚合：定时器触发或达到最大数量
   */
  private async processInitialMerge(chatId: string): Promise<void> {
    // 清除内存中的定时器引用
    this.timers.delete(chatId);

    const persistedState = await this.getState(chatId);

    if (!persistedState || persistedState.status !== ConversationStatus.WAITING) {
      this.logger.warn(
        `[${chatId}] 聚合定时器触发，但会话状态异常: ${persistedState?.status || 'not found'}`,
      );
      return;
    }

    const messageCount = persistedState.pendingMessages.length;
    const waitTime = Date.now() - persistedState.firstMessageTime;

    this.logger.log(
      `[${chatId}] 首次聚合完成，收集到 ${messageCount} 条消息，等待时间 ${waitTime}ms`,
    );

    // 准备消息列表
    const messagesToProcess = this.prepareMessagesForProcessingFromPersisted(persistedState);

    // 更新状态
    persistedState.status = ConversationStatus.PROCESSING;
    persistedState.currentRequest = {
      startTime: Date.now(),
      retryCount: 0,
      messageCount: messagesToProcess.length,
    };
    persistedState.pendingMessages = []; // 清空待处理队列
    persistedState.lastUpdateTime = Date.now();

    // 保存状态到 Redis
    await this.saveState(persistedState);

    // 添加任务到 Bull 队列
    try {
      await this.messageQueue.add('merge', { messages: messagesToProcess });
      this.logger.log(`[${chatId}] 任务已添加到队列，消息数: ${messagesToProcess.length}`);
    } catch (error) {
      this.logger.error(`[${chatId}] 任务添加到队列失败:`, error);
      await this.resetConversationState(chatId);
    }
  }

  /**
   * 从持久化状态准备要处理的消息列表
   */
  private prepareMessagesForProcessingFromPersisted(
    state: PersistableConversationState,
  ): EnterpriseMessageCallbackDto[] {
    const { chatId, pendingMessages } = state;
    const messageCount = pendingMessages.length;

    if (messageCount === 0) {
      this.logger.warn(`[${chatId}] 待处理队列为空`);
      return [];
    }

    // 检查是否溢出
    if (messageCount > this.maxMergedMessages) {
      if (this.overflowStrategy === OverflowStrategy.TAKE_LATEST) {
        const messages = pendingMessages.slice(-this.maxMergedMessages).map((pm) => pm.messageData);
        this.logger.warn(
          `[${chatId}] 消息溢出 (${messageCount} > ${this.maxMergedMessages})，` +
            `采用 TAKE_LATEST 策略，只处理最新 ${this.maxMergedMessages} 条`,
        );
        return messages;
      } else {
        this.logger.warn(
          `[${chatId}] 消息溢出 (${messageCount} > ${this.maxMergedMessages})，` +
            `采用 TAKE_ALL 策略，处理全部 ${messageCount} 条消息`,
        );
        return pendingMessages.map((pm) => pm.messageData);
      }
    }

    this.logger.log(`[${chatId}] 准备处理 ${messageCount} 条消息`);
    return pendingMessages.map((pm) => pm.messageData);
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
  private async resetConversationState(chatId: string): Promise<void> {
    // 清除内存中的定时器
    const timer = this.timers.get(chatId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(chatId);
    }

    // 删除 Redis 中的状态
    await this.deleteState(chatId);

    this.logger.debug(`[${chatId}] 会话状态已重置为 IDLE`);
  }

  /**
   * 获取并清空待处理的消息
   * 用于在 MessageService 中循环控制重试
   */
  async getPendingMessages(chatId: string): Promise<EnterpriseMessageCallbackDto[]> {
    const state = await this.getState(chatId);

    if (!state || state.pendingMessages.length === 0) {
      return [];
    }

    // 提取消息并清空队列
    const messages = state.pendingMessages.map((pm) => pm.messageData);
    state.pendingMessages = [];
    state.lastUpdateTime = Date.now();

    // 保存更新后的状态
    await this.saveState(state);

    this.logger.debug(`[${chatId}] 提取 ${messages.length} 条待处理消息`);
    return messages;
  }

  /**
   * 重置会话状态为 IDLE（公共方法）
   * 用于在发送回复前重置状态，避免竞态条件
   */
  async resetToIdle(chatId: string): Promise<void> {
    await this.resetConversationState(chatId);
  }

  async clearConversation(chatId: string): Promise<void> {
    // 清除内存中的定时器
    const timer = this.timers.get(chatId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(chatId);
    }

    // 删除 Redis 中的状态
    await this.deleteState(chatId);
    this.logger.log(`[${chatId}] 会话已清理`);
  }

  /**
   * 获取会话统计信息
   * 注意：Redis 模式下无法准确统计所有会话
   */
  getStats() {
    return {
      storageType: 'redis',
      activeTimers: this.timers.size,
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
    // 清理超时扫描定时器
    if (this.timeoutScanTimer) {
      clearInterval(this.timeoutScanTimer);
      this.timeoutScanTimer = null;
      this.logger.log('超时扫描器已停止');
    }

    // 清理所有聚合定时器
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }

    this.timers.clear();
    this.logger.log('智能消息聚合服务已销毁');
  }
}
