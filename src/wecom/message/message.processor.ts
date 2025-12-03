import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, Job } from 'bull';
import {
  AgentService,
  ProfileLoaderService,
  AgentConfigValidator,
  AgentResultHelper,
  BrandConfigService,
  AgentRegistryService,
} from '@agent';
import { EnterpriseMessageCallbackDto } from './dto/message-callback.dto';
import { SupabaseService } from '@core/supabase';
import { MonitoringService } from '@core/monitoring/monitoring.service';
import { RawAgentResponse } from '@core/monitoring/interfaces/monitoring.interface';
import { FeishuBookingService } from '@core/feishu';

// 导入子服务
import { MessageHistoryService } from './services/message-history.service';
import { MessageFilterService } from './services/message-filter.service';
import { MessageMergeService } from './services/message-merge.service';
import { MessageDeliveryService } from './services/message-delivery.service';

// 导入工具类
import { MessageParser } from './utils/message-parser.util';
import { ReplyNormalizer } from './utils/reply-normalizer.util';
import { ScenarioType } from '@agent';

// 面试预约通知已迁移到 FeishuBookingService

/**
 * 消息队列处理器（动态并发版）
 * 负责处理 Bull 队列中的消息聚合任务
 *
 * 特性：
 * - 支持通过 Dashboard 动态调整 Worker 并发数
 * - 并发数范围：1-20
 * - 修改并发数时会等待当前任务完成（graceful）
 *
 * 注意：移除了 @Processor 装饰器，改用 Queue.process() 动态注册
 * 这样可以支持运行时修改并发数
 */
@Injectable()
export class MessageProcessor implements OnModuleInit {
  private readonly logger = new Logger(MessageProcessor.name);

  // Worker 状态
  private currentConcurrency = 4; // 默认并发数
  private isProcessing = false;
  private activeJobs = 0;

  // 并发数限制
  private readonly MIN_CONCURRENCY = 1;
  private readonly MAX_CONCURRENCY = 20;

  // 缓存最后一次有效的品牌配置（用于降级）
  private lastValidBrandConfig: Record<string, unknown> | null = null;

  constructor(
    @InjectQueue('message-merge') private readonly messageQueue: Queue,
    private readonly agentService: AgentService,
    private readonly profileLoader: ProfileLoaderService,
    private readonly configValidator: AgentConfigValidator,
    private readonly historyService: MessageHistoryService,
    private readonly filterService: MessageFilterService,
    private readonly mergeService: MessageMergeService,
    private readonly supabaseService: SupabaseService,
    private readonly deliveryService: MessageDeliveryService,
    private readonly monitoringService: MonitoringService,
    private readonly brandConfigService: BrandConfigService,
    private readonly feishuBookingService: FeishuBookingService,
    private readonly registryService: AgentRegistryService,
  ) {}

  /**
   * 模块初始化时注册 Worker
   */
  async onModuleInit() {
    // 从 Supabase 加载配置的并发数
    await this.loadConcurrencyFromConfig();

    // 注册队列事件监听
    this.setupQueueEventListeners();

    // 等待队列准备就绪
    await this.waitForQueueReady();

    // 动态注册 Worker
    this.registerWorker(this.currentConcurrency);

    // 等待 bclient 连接就绪（关键！否则第一条消息可能丢失）
    await this.waitForBclientReady();

    this.logger.log(
      `MessageProcessor 已初始化（动态 Worker 模式，并发数: ${this.currentConcurrency}）`,
    );
  }

  /**
   * 等待队列准备就绪
   */
  private async waitForQueueReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      // 诊断：打印队列的客户端信息
      this.logger.log(
        `[Bull:诊断] 队列客户端类型: client=${this.messageQueue.client?.constructor?.name || 'unknown'}`,
      );

      // 检查队列是否已经准备好
      if (this.messageQueue.client?.status === 'ready') {
        this.logger.log('Bull Queue 已就绪 (client.status = ready)');
        resolve();
        return;
      }

      // 监听 ready 事件
      const timeout = setTimeout(() => {
        reject(new Error('等待 Bull Queue 就绪超时'));
      }, 30000); // 30秒超时

      this.messageQueue.on('ready', () => {
        clearTimeout(timeout);
        this.logger.log('Bull Queue 已就绪 (via ready event)');
        // 诊断：打印连接数量信息
        this.logger.log(
          `[Bull:诊断] client.status=${this.messageQueue.client?.status}, ` +
            `isReady=${this.messageQueue.isReady()}`,
        );
        resolve();
      });

      this.messageQueue.on('error', (error) => {
        clearTimeout(timeout);
        this.logger.error('Bull Queue 连接错误:', error);
        reject(error);
      });
    });
  }

  /**
   * 等待 bclient（blocking client）连接就绪
   * bclient 用于 BRPOPLPUSH 阻塞等待新任务，必须就绪才能处理消息
   */
  private async waitForBclientReady(): Promise<void> {
    const queue = this.messageQueue as any;
    const maxWaitTime = 30000; // 最多等待 30 秒
    const checkInterval = 100; // 每 100ms 检查一次
    const startTime = Date.now();

    this.logger.log('[Bull] 等待 bclient 连接就绪...');

    return new Promise((resolve) => {
      const checkBclient = () => {
        const bclientStatus = queue.bclient?.status;

        if (bclientStatus === 'ready') {
          this.logger.log('[Bull] ✅ bclient 连接就绪');
          resolve();
          return;
        }

        if (Date.now() - startTime > maxWaitTime) {
          this.logger.error(
            `[Bull] ❌ bclient 连接超时（${maxWaitTime}ms），当前状态: ${bclientStatus}`,
          );
          // 不 reject，允许继续运行，但记录警告
          this.logger.warn('[Bull] ⚠️ Worker 可能无法正常处理任务，请检查 Redis 连接');
          resolve();
          return;
        }

        // 继续等待
        setTimeout(checkBclient, checkInterval);
      };

      // 如果 bclient 还不存在，等待 process 调用创建它
      if (!queue.bclient) {
        this.logger.log('[Bull] bclient 尚未创建，等待 process 调用...');
      }

      checkBclient();
    });
  }

  /**
   * 设置队列事件监听器
   */
  private setupQueueEventListeners(): void {
    this.logger.log('[Bull] 正在设置队列事件监听器...');

    // 任务完成事件
    this.messageQueue.on('completed', (job: Job) => {
      this.logger.log(`[Bull] ✅ 任务 ${job.id} 完成`);
    });

    // 任务失败事件
    this.messageQueue.on('failed', (job: Job, error: Error) => {
      this.logger.error(`[Bull] ❌ 任务 ${job.id} 失败: ${error.message}`);
    });

    // 任务进行中事件
    this.messageQueue.on('active', (job: Job) => {
      this.logger.log(`[Bull] 🔄 任务 ${job.id} 开始处理 (Worker 已拾取)`);
    });

    // 任务等待事件（改为 LOG 级别用于调试）
    this.messageQueue.on('waiting', (jobId: string) => {
      this.logger.log(`[Bull] ⏳ 任务 ${jobId} 进入等待队列`);
    });

    // 任务卡住事件（用于诊断问题）
    this.messageQueue.on('stalled', (job: Job) => {
      this.logger.warn(`[Bull] ⚠️ 任务 ${job.id} 卡住（stalled），可能需要检查 Worker 状态`);
    });

    // 任务被移除事件
    this.messageQueue.on('removed', (job: Job) => {
      this.logger.warn(`[Bull] ⚠️ 任务 ${job.id} 被移除`);
    });

    // 队列错误事件
    this.messageQueue.on('error', (error: Error) => {
      this.logger.error(`[Bull] ❌ 队列错误: ${error.message}`);
    });

    // 全局事件 - 用于诊断
    this.messageQueue.on('global:waiting', (jobId: string) => {
      this.logger.log(`[Bull:Global] ⏳ 任务 ${jobId} 进入等待队列 (global)`);
    });

    this.messageQueue.on('global:active', (jobId: string) => {
      this.logger.log(`[Bull:Global] 🔄 任务 ${jobId} 开始处理 (global)`);
    });

    this.messageQueue.on('global:completed', (jobId: string) => {
      this.logger.log(`[Bull:Global] ✅ 任务 ${jobId} 完成 (global)`);
    });

    this.messageQueue.on('global:failed', (jobId: string, err: string) => {
      this.logger.error(`[Bull:Global] ❌ 任务 ${jobId} 失败 (global): ${err}`);
    });

    this.logger.log('[Bull] 队列事件监听器设置完成');
  }

  /**
   * 从 Supabase 加载并发数配置
   */
  private async loadConcurrencyFromConfig(): Promise<void> {
    try {
      const config = await this.supabaseService.getSystemConfig();
      if (config?.workerConcurrency) {
        const concurrency = Math.max(
          this.MIN_CONCURRENCY,
          Math.min(this.MAX_CONCURRENCY, config.workerConcurrency),
        );
        this.currentConcurrency = concurrency;
        this.logger.log(`从配置加载 Worker 并发数: ${concurrency}`);
      }
    } catch (error) {
      this.logger.warn(
        `加载 Worker 并发数配置失败，使用默认值 ${this.currentConcurrency}: ${error.message}`,
      );
    }
  }

  /**
   * 动态注册 Worker
   * 注意：Queue.process() 是同步方法，不返回 Promise
   */
  private registerWorker(concurrency: number): void {
    this.logger.log(`[Bull] 正在注册 Worker，并发数: ${concurrency}...`);

    // 诊断：检查队列状态和客户端连接
    this.logQueueStatus('Worker 注册前');

    // 诊断：检查队列的各个客户端
    const queue = this.messageQueue as any;
    this.logger.log(
      `[Bull:诊断] 队列客户端状态: ` +
        `client=${queue.client?.status || 'N/A'}, ` +
        `bclient=${queue.bclient?.status || 'N/A'}, ` +
        `eclient=${queue.eclient?.status || 'N/A'}`,
    );

    this.messageQueue.process('merge', concurrency, async (job: Job) => {
      this.logger.log(`[Bull] 🎯 收到任务 ${job.id}，开始处理...`);
      try {
        const result = await this.handleMessageMerge(job);
        this.logger.log(`[Bull] 🎯 任务 ${job.id} 处理完成`);
        return result;
      } catch (error) {
        this.logger.error(`[Bull] 🎯 任务 ${job.id} 处理异常: ${error.message}`);
        throw error;
      }
    });

    this.logger.log(`[Bull] ✅ Worker 已注册，job name: 'merge'，并发数: ${concurrency}`);

    // 诊断：注册后检查队列状态和客户端
    setTimeout(() => {
      this.logQueueStatus('Worker 注册后 1s');
      this.logger.log(
        `[Bull:诊断] 注册后客户端状态: ` +
          `client=${queue.client?.status || 'N/A'}, ` +
          `bclient=${queue.bclient?.status || 'N/A'}, ` +
          `eclient=${queue.eclient?.status || 'N/A'}`,
      );
    }, 1000);
  }

  /**
   * 诊断：打印队列状态
   */
  private async logQueueStatus(context: string): Promise<void> {
    try {
      const jobCounts = await this.messageQueue.getJobCounts();
      const isPaused = await this.messageQueue.isPaused();
      const client = this.messageQueue.client;

      this.logger.log(
        `[Bull:诊断] ${context}: ` +
          `waiting=${jobCounts.waiting}, active=${jobCounts.active}, ` +
          `completed=${jobCounts.completed}, failed=${jobCounts.failed}, ` +
          `delayed=${jobCounts.delayed}, paused=${isPaused}, ` +
          `redis=${client?.status || 'unknown'}`,
      );
    } catch (error) {
      this.logger.error(`[Bull:诊断] 获取队列状态失败: ${error.message}`);
    }
  }

  /**
   * 动态修改并发数（供 API 调用）
   * @param newConcurrency 新的并发数
   * @returns 修改结果
   */
  async setConcurrency(newConcurrency: number): Promise<{
    success: boolean;
    message: string;
    previousConcurrency: number;
    currentConcurrency: number;
  }> {
    const previousConcurrency = this.currentConcurrency;

    // 验证范围
    if (newConcurrency < this.MIN_CONCURRENCY || newConcurrency > this.MAX_CONCURRENCY) {
      return {
        success: false,
        message: `并发数必须在 ${this.MIN_CONCURRENCY}-${this.MAX_CONCURRENCY} 之间`,
        previousConcurrency,
        currentConcurrency: this.currentConcurrency,
      };
    }

    // 如果并发数相同，直接返回
    if (newConcurrency === this.currentConcurrency) {
      return {
        success: true,
        message: '并发数未变化',
        previousConcurrency,
        currentConcurrency: this.currentConcurrency,
      };
    }

    try {
      this.logger.log(`开始修改 Worker 并发数: ${previousConcurrency} -> ${newConcurrency}`);

      // 等待当前活跃任务完成（最多等待 30 秒）
      if (this.activeJobs > 0) {
        this.logger.log(`等待 ${this.activeJobs} 个活跃任务完成...`);
        const maxWaitTime = 30000;
        const startTime = Date.now();

        while (this.activeJobs > 0 && Date.now() - startTime < maxWaitTime) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        if (this.activeJobs > 0) {
          this.logger.warn(`等待超时，仍有 ${this.activeJobs} 个任务在处理中，强制切换并发数`);
        }
      }

      // 暂停队列处理
      await this.messageQueue.pause(true);

      // 移除旧的处理器
      // Bull 不直接支持移除处理器，但重新注册会覆盖
      this.currentConcurrency = newConcurrency;

      // 重新注册 Worker
      this.registerWorker(newConcurrency);

      // 恢复队列处理
      await this.messageQueue.resume(true);

      // 保存到 Supabase
      await this.saveConcurrencyToConfig(newConcurrency);

      this.logger.log(`Worker 并发数已修改: ${previousConcurrency} -> ${newConcurrency}`);

      return {
        success: true,
        message: `并发数已从 ${previousConcurrency} 修改为 ${newConcurrency}`,
        previousConcurrency,
        currentConcurrency: newConcurrency,
      };
    } catch (error) {
      this.logger.error(`修改 Worker 并发数失败: ${error.message}`);
      return {
        success: false,
        message: `修改失败: ${error.message}`,
        previousConcurrency,
        currentConcurrency: this.currentConcurrency,
      };
    }
  }

  /**
   * 保存并发数到 Supabase
   */
  private async saveConcurrencyToConfig(concurrency: number): Promise<void> {
    try {
      await this.supabaseService.updateSystemConfig({ workerConcurrency: concurrency });
      this.logger.log(`Worker 并发数已保存到配置: ${concurrency}`);
    } catch (error) {
      this.logger.error(`保存 Worker 并发数配置失败: ${error.message}`);
    }
  }

  /**
   * 获取当前 Worker 状态
   */
  getWorkerStatus(): {
    concurrency: number;
    activeJobs: number;
    minConcurrency: number;
    maxConcurrency: number;
  } {
    return {
      concurrency: this.currentConcurrency,
      activeJobs: this.activeJobs,
      minConcurrency: this.MIN_CONCURRENCY,
      maxConcurrency: this.MAX_CONCURRENCY,
    };
  }

  /**
   * 获取队列状态
   * 返回各状态的任务数量
   */
  async getQueueStatus(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: number;
  }> {
    const [waiting, active, completed, failed, delayed, paused] = await Promise.all([
      this.messageQueue.getWaitingCount(),
      this.messageQueue.getActiveCount(),
      this.messageQueue.getCompletedCount(),
      this.messageQueue.getFailedCount(),
      this.messageQueue.getDelayedCount(),
      this.messageQueue.getPausedCount(),
    ]);

    return { waiting, active, completed, failed, delayed, paused };
  }

  /**
   * 清理队列中的卡住任务
   * 可以清理指定状态的任务，或清理所有非等待状态的任务
   *
   * @param options 清理选项
   * @returns 清理结果
   */
  async cleanStuckJobs(options?: {
    cleanActive?: boolean;
    cleanFailed?: boolean;
    cleanCompleted?: boolean;
    cleanDelayed?: boolean;
    gracePeriodMs?: number; // 只清理超过此时间的任务（毫秒）
  }): Promise<{
    success: boolean;
    cleaned: {
      active: number;
      failed: number;
      completed: number;
      delayed: number;
    };
    message: string;
  }> {
    const {
      cleanActive = true,
      cleanFailed = true,
      cleanCompleted = false,
      cleanDelayed = false,
      gracePeriodMs = 0, // 默认清理所有
    } = options || {};

    const cleaned = { active: 0, failed: 0, completed: 0, delayed: 0 };

    try {
      // 清理 active（处理中/卡住）的任务
      if (cleanActive) {
        const activeJobs = await this.messageQueue.getActive();
        for (const job of activeJobs) {
          const jobAge = Date.now() - job.timestamp;
          if (jobAge >= gracePeriodMs) {
            await job.moveToFailed(new Error('手动清理：任务卡住'), true);
            await job.remove();
            cleaned.active++;
            this.logger.log(
              `[清理队列] 已移除卡住的任务 ${job.id}, 年龄: ${Math.round(jobAge / 1000)}s`,
            );
          }
        }
      }

      // 清理 failed 的任务
      if (cleanFailed) {
        const failedJobs = await this.messageQueue.getFailed();
        for (const job of failedJobs) {
          await job.remove();
          cleaned.failed++;
        }
        if (cleaned.failed > 0) {
          this.logger.log(`[清理队列] 已移除 ${cleaned.failed} 个失败任务`);
        }
      }

      // 清理 completed 的任务（一般不需要，Bull 会自动清理）
      if (cleanCompleted) {
        const completedJobs = await this.messageQueue.getCompleted();
        for (const job of completedJobs) {
          await job.remove();
          cleaned.completed++;
        }
        if (cleaned.completed > 0) {
          this.logger.log(`[清理队列] 已移除 ${cleaned.completed} 个已完成任务`);
        }
      }

      // 清理 delayed 的任务
      if (cleanDelayed) {
        const delayedJobs = await this.messageQueue.getDelayed();
        for (const job of delayedJobs) {
          await job.remove();
          cleaned.delayed++;
        }
        if (cleaned.delayed > 0) {
          this.logger.log(`[清理队列] 已移除 ${cleaned.delayed} 个延迟任务`);
        }
      }

      const totalCleaned = cleaned.active + cleaned.failed + cleaned.completed + cleaned.delayed;

      return {
        success: true,
        cleaned,
        message: totalCleaned > 0 ? `已清理 ${totalCleaned} 个任务` : '没有需要清理的任务',
      };
    } catch (error) {
      this.logger.error(`[清理队列] 清理失败: ${error.message}`);
      return {
        success: false,
        cleaned,
        message: `清理失败: ${error.message}`,
      };
    }
  }

  /**
   * 处理消息聚合任务
   */
  private async handleMessageMerge(job: Job<{ messages: EnterpriseMessageCallbackDto[] }>) {
    this.activeJobs++;

    try {
      const { messages } = job.data;

      if (!messages || messages.length === 0) {
        this.logger.warn(`[Bull] 任务 ${job.id} 数据为空`);
        return;
      }

      const chatId = messages[0].chatId;
      this.logger.log(
        `[Bull] 开始处理任务 ${job.id}, chatId: ${chatId}, 消息数: ${messages.length}`,
      );

      // 记录 Worker 开始处理时间（用于计算真正的队列等待时间）
      for (const msg of messages) {
        this.monitoringService.recordWorkerStart(msg.messageId);
      }

      // 过滤有效消息（复用 FilterService）
      const validMessages: EnterpriseMessageCallbackDto[] = [];

      for (const messageData of messages) {
        const filterResult = await this.filterService.validate(messageData);
        if (filterResult.pass) {
          validMessages.push(messageData);
        } else {
          this.logger.debug(
            `[Bull] 跳过消息 [${messageData.messageId}], 原因: ${filterResult.reason}`,
          );
          // 立即标记被过滤的消息为成功
          this.monitoringService.recordSuccess(messageData.messageId, {
            scenario: ScenarioType.CANDIDATE_CONSULTATION,
            replyPreview: `[消息被过滤: ${filterResult.reason}]`,
          });
        }
      }

      if (validMessages.length === 0) {
        this.logger.debug(`[Bull] 任务 ${job.id} 没有有效内容（已在过滤时标记状态）`);
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
      const result = await this.processWithAI(chatId, mergedContent, validMessages[0]);

      // 更新任务进度
      await job.progress(100);

      // 检查 AI 处理是否成功
      if (!result.success) {
        // AI 处理失败，记录失败状态
        for (const msg of validMessages) {
          this.monitoringService.recordFailure(msg.messageId, result.error || '未知错误', {
            scenario: ScenarioType.CANDIDATE_CONSULTATION,
          });
        }
        // 检查是否有待处理消息
        await this.mergeService.onAgentResponseReceived(chatId);
        return;
      }

      // 记录处理成功 - 为聚合的每条消息记录成功状态
      for (const msg of validMessages) {
        this.monitoringService.recordSuccess(msg.messageId, {
          scenario: ScenarioType.CANDIDATE_CONSULTATION,
          replyPreview: result.replyContent?.substring(0, 100),
          tokenUsage: result.tokenUsage,
          tools: result.tools,
          replySegments: result.segmentCount,
          isFallback: result.isFallback,
          rawAgentResponse: result.rawAgentResponse,
        });
      }

      // 检查是否有在处理期间到达的新消息
      // onAgentResponseReceived 会检查并自动添加新任务到队列
      await this.mergeService.onAgentResponseReceived(chatId);
    } catch (error) {
      const chatId = job.data.messages?.[0]?.chatId;
      this.logger.error(`[Bull] 任务 ${job.id} 处理失败: ${error.message}`);

      // 记录处理失败 - 为聚合的每条消息记录失败状态
      const failedMessages = job.data.messages || [];
      for (const msg of failedMessages) {
        this.monitoringService.recordFailure(msg.messageId, error.message, {
          scenario: ScenarioType.CANDIDATE_CONSULTATION,
        });
      }

      if (chatId) {
        // 检查是否有在处理期间到达的新消息
        // 如果有，将它们重新入队，避免丢失
        const hasNewMessages = await this.mergeService.requeuePendingMessagesOnFailure(chatId);
        if (hasNewMessages) {
          this.logger.log(`[Bull] 已将处理期间收到的新消息重新入队`);
        }
        // 重置会话状态
        await this.mergeService.resetToIdle(chatId);
      }

      throw error; // 抛出错误触发重试
    } finally {
      this.activeJobs--;
    }
  }

  /**
   * 使用 AI 处理消息
   */
  private async processWithAI(
    chatId: string,
    mergedContent: string,
    messageData: EnterpriseMessageCallbackDto,
  ): Promise<{
    success: boolean;
    replyContent?: string;
    tokenUsage?: number;
    tools?: string[];
    segmentCount?: number;
    isFallback?: boolean;
    rawAgentResponse?: RawAgentResponse;
    error?: string;
  }> {
    const parsedData = MessageParser.parse(messageData);
    const { token, contactName = '客户', _apiType } = parsedData;
    const scenarioType = parsedData.isRoom ? '群聊' : '私聊';

    try {
      // 判断消息场景（复用 MessageParser）
      const scenario = MessageParser.determineScenario();
      const agentProfile = this.profileLoader.getProfile(scenario);

      if (!agentProfile) {
        this.logger.error(`无法获取场景 ${scenario} 的 Agent 配置`);
        return { success: false, error: `无法获取场景 ${scenario} 的 Agent 配置` };
      }

      // 验证配置有效性
      try {
        this.configValidator.validateRequiredFields(agentProfile);
        const contextValidation = this.configValidator.validateContext(agentProfile.context);
        if (!contextValidation.isValid) {
          const errorMsg = `Agent 配置验证失败: ${contextValidation.errors.join(', ')}`;
          this.logger.error(errorMsg);
          return { success: false, error: errorMsg };
        }
      } catch (error) {
        const errorMsg = `Agent 配置验证失败: ${error.message}`;
        this.logger.error(errorMsg);
        return { success: false, error: errorMsg };
      }

      // 获取会话历史消息（复用 HistoryService）
      const historyMessages = await this.historyService.getHistory(chatId);
      this.logger.debug(`[Bull] 使用历史消息: ${historyMessages.length} 条`);

      // 添加当前用户消息到历史（复用 HistoryService，包含完整元数据）
      const isRoom = Boolean(messageData.imRoomId);
      await this.historyService.addMessageToHistory(chatId, 'user', mergedContent, {
        messageId: messageData.messageId,
        candidateName: messageData.contactName || contactName,
        managerName: messageData.botUserId,
        orgId: messageData.orgId,
        botId: messageData.botId,
        messageType: messageData.messageType,
        source: messageData.source,
        isRoom,
        // v1.3 新增字段
        imBotId: messageData.imBotId,
        imContactId: messageData.imContactId,
        contactType: messageData.contactType,
        isSelf: messageData.isSelf,
        payload: messageData.payload as Record<string, unknown>,
        avatar: messageData.avatar,
        externalUserId: messageData.externalUserId,
      });

      // 记录 AI 处理开始
      this.monitoringService.recordAiStart(messageData.messageId);

      // 合并品牌配置到 context（关键：确保品牌数据被传递给 Agent）
      const mergedContext = await this.buildContextWithBrand(
        agentProfile.context as Record<string, unknown>,
      );

      // 注入时间上下文到用户消息中，使 Agent 具备时间感知能力
      const userMessageWithTime = MessageParser.injectTimeContext(
        mergedContent,
        parseInt(messageData.timestamp),
      );

      // 构建 Agent 调用参数
      const agentParams = {
        conversationId: chatId,
        userMessage: userMessageWithTime,
        historyMessages,
        model: agentProfile.model,
        systemPrompt: agentProfile.systemPrompt,
        promptType: agentProfile.promptType,
        allowedTools: agentProfile.allowedTools,
        context: mergedContext,
        toolContext: agentProfile.toolContext,
        contextStrategy: agentProfile.contextStrategy,
        prune: agentProfile.prune,
        pruneOptions: agentProfile.pruneOptions,
      };

      // 记录完整的 Agent 调用参数（用于调试）
      this.logger.debug(
        `[Bull][${scenarioType}] Agent 调用参数: ${JSON.stringify({
          conversationId: agentParams.conversationId,
          userMessage:
            agentParams.userMessage.substring(0, 100) +
            (agentParams.userMessage.length > 100 ? '...' : ''),
          historyCount: agentParams.historyMessages?.length || 0,
          model: agentParams.model || '(未指定)',
          hasSystemPrompt: !!agentParams.systemPrompt,
          systemPromptLength: agentParams.systemPrompt?.length || 0,
          promptType: agentParams.promptType || '(未指定)',
          allowedTools: agentParams.allowedTools || [],
          hasContext: !!agentParams.context && Object.keys(agentParams.context).length > 0,
          contextLength: JSON.stringify(agentParams.context || '').length,
          hasConfigData: !!(agentParams.context as Record<string, unknown>)?.configData,
          hasToolContext: !!agentParams.toolContext,
          toolContextLength: JSON.stringify(agentParams.toolContext || '').length,
          contextStrategy: agentParams.contextStrategy || '(未指定)',
          prune: agentParams.prune,
          pruneOptions: agentParams.pruneOptions || null,
        })}`,
      );

      // 调用 Agent API 生成回复
      const agentResult = await this.agentService.chat(agentParams);

      // 记录 AI 处理结束
      this.monitoringService.recordAiEnd(messageData.messageId);

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

      // 提取回复内容（优先使用 zhipin_reply_generator.output.reply）
      const { content: replyContent, source: replySource } = this.extractReplyContent(aiResponse);

      // 注意：assistant 消息历史由 isSelf=true 的回调存储，这里不再重复存储

      // 记录 token 使用情况
      const tokenInfo = aiResponse.usage ? `tokens=${aiResponse.usage.totalTokens}` : 'tokens=N/A';
      const toolsInfo =
        aiResponse.tools?.used && aiResponse.tools.used.length > 0
          ? `, tools=${aiResponse.tools.used.length}`
          : '';

      this.logger.log(
        `[Bull][${scenarioType}][${contactName}] 回复: "${replyContent.substring(0, 50)}${replyContent.length > 50 ? '...' : ''}" (${tokenInfo}${toolsInfo}, source=${replySource})`,
      );

      // 使用 MessageDeliveryService 发送消息（支持分段、打字延迟、字符清理）
      const deliveryResult = await this.deliveryService.deliverReply(
        { content: replyContent },
        {
          messageId: messageData.messageId,
          token,
          chatId,
          contactName,
          // 企业级字段
          imBotId: parsedData.imBotId,
          imContactId: parsedData.imContactId,
          imRoomId: parsedData.imRoomId,
          // API 类型标记
          _apiType,
        },
        true, // 记录监控
      );

      if (!deliveryResult.success) {
        this.logger.warn(
          `[Bull][${scenarioType}][${contactName}] 消息发送部分失败: ${deliveryResult.failedSegments}/${deliveryResult.segmentCount} 个片段失败`,
        );
      }

      // 构建完整的 rawAgentResponse（保留原始结构）
      const isFallback = AgentResultHelper.isFallback(agentResult);
      const rawAgentResponse: RawAgentResponse = {
        // HTTP 响应信息（来自 AgentResult.rawHttpResponse）- 不包含 headers
        http: agentResult.rawHttpResponse
          ? {
              status: agentResult.rawHttpResponse.status,
              statusText: agentResult.rawHttpResponse.statusText,
            }
          : undefined,
        // API 响应外层包装（Axios response.data 就是 ApiResponse）
        apiResponse: agentResult.rawHttpResponse?.data
          ? {
              success: agentResult.rawHttpResponse.data.success,
              error: agentResult.rawHttpResponse.data.error,
              correlationId: agentResult.rawHttpResponse.data.correlationId,
              // 【修复】保留原始 API 返回的 details 字段（如 "Payment Required"）
              details: agentResult.rawHttpResponse.data.details,
            }
          : undefined,
        // 输入参数（用于调试，去除品牌数据）
        input: {
          conversationId: chatId,
          userMessage: mergedContent,
          historyCount: historyMessages.length,
          // 包含完整历史消息（用于调试查看传给 Agent 的上下文）
          historyMessages: historyMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          model: agentProfile.model,
          promptType: agentProfile.promptType || undefined,
          allowedTools: agentProfile.allowedTools,
          contextStrategy: agentProfile.contextStrategy,
          prune: agentProfile.prune,
          // 模型配置（花卷 API 多模型配置，从 registryService 获取，与 agent.service 保持一致）
          modelConfig: this.registryService.getModelConfig(),
          // Prompt 相关字段（仅记录是否传入和长度，不记录内容）
          hasSystemPrompt: !!agentProfile.systemPrompt,
          systemPromptLength: agentProfile.systemPrompt?.length || 0,
          hasContext: !!mergedContext && Object.keys(mergedContext).length > 0,
          contextLength: JSON.stringify(mergedContext || '').length,
          hasToolContext: !!agentProfile.toolContext,
          toolContextLength: JSON.stringify(agentProfile.toolContext || '').length,
          // 品牌配置相关（configData = brandData, replyPrompts 来自 brandConfigService）
          hasConfigData: !!(mergedContext as Record<string, unknown>)?.configData,
          hasReplyPrompts: !!(mergedContext as Record<string, unknown>)?.replyPrompts,
          brandPriorityStrategy:
            ((mergedContext as Record<string, unknown>)?.brandPriorityStrategy as string) ||
            undefined,
          // 调试：记录完整的 mergedContext keys
          _mergedContextKeys: Object.keys(mergedContext || {}),
          // 完整原始入参 JSON - 使用真正的 API 请求体（ChatRequest）
          // 优先使用 agentResult.requestBody（成功时的 ChatRequest），失败时回退到 agentParams
          rawParams: this.buildRawParamsJson((agentResult as any).requestBody || agentParams),
          // rawParams 来源指示器：帮助 Dashboard 区分是实际 API 请求还是回退参数
          // 当错误发生在 prepareRequest 之前（如参数验证失败），chatRequest 为 undefined，回退到 agentParams
          rawParamsSource: (agentResult as any).requestBody ? 'ChatRequest' : 'agentParams',
        },
        // 完整的原始 messages（不做任何过滤和映射，保留所有 part 类型）
        messages: aiResponse.messages as any,
        usage: {
          inputTokens: aiResponse.usage?.inputTokens ?? 0,
          outputTokens: aiResponse.usage?.outputTokens ?? 0,
          totalTokens: aiResponse.usage?.totalTokens ?? 0,
          cachedInputTokens: aiResponse.usage?.cachedInputTokens,
        },
        tools: {
          used: aiResponse.tools?.used ?? [],
          skipped: aiResponse.tools?.skipped ?? [],
        },
        isFallback,
        fallbackReason: isFallback ? agentResult.fallbackInfo?.reason : undefined,
        replySource, // 回复内容来源（用于排障）
      };

      // 调试：验证 brandPriorityStrategy 是否存在
      this.logger.debug(
        `[rawAgentResponse] brandPriorityStrategy = ${rawAgentResponse.input?.brandPriorityStrategy || '(未设置)'}`,
      );

      // 检测面试预约成功并发送飞书通知
      await this.checkAndNotifyInterviewBooking(chatId, contactName, aiResponse);

      // 从 messages 中提取真正使用的工具列表（而不是使用 tools.used）
      const actuallyUsedTools = this.extractActuallyUsedTools(aiResponse.messages);

      // 返回成功结果
      return {
        success: true,
        replyContent,
        tokenUsage: aiResponse.usage?.totalTokens,
        tools: actuallyUsedTools, // 使用从 messages 中提取的真实工具列表
        segmentCount: deliveryResult.segmentCount,
        isFallback,
        rawAgentResponse,
      };
    } catch (error) {
      this.logger.error(`[Bull][${scenarioType}][${contactName}] 消息处理失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 回复提取结果
   */
  private static readonly REPLY_SOURCE_TOOL = 'zhipin_reply_generator.output.reply' as const;
  private static readonly REPLY_SOURCE_TEXT = 'assistant.parts.text' as const;

  /**
   * 提取 AI 回复内容
   * 优先级：
   * 1. zhipin_reply_generator 工具的 output.reply（最后一个成功调用）
   * 2. 最后一条 assistant 消息的 text parts（降级）
   *
   * 包含兜底清洗逻辑：将 Markdown 格式转换为自然口语
   */
  private extractReplyContent(aiResponse: any): {
    content: string;
    source: 'zhipin_reply_generator.output.reply' | 'assistant.parts.text';
  } {
    if (!aiResponse.messages || aiResponse.messages.length === 0) {
      throw new Error('AI 未生成有效回复');
    }

    // 优先：查找最后一个 zhipin_reply_generator 工具的成功输出
    const replyFromTool = this.extractReplyFromZhipinTool(aiResponse.messages);
    if (replyFromTool) {
      this.logger.log(
        `[extractReplyContent] 使用 zhipin_reply_generator.output.reply: "${replyFromTool.substring(0, 50)}${replyFromTool.length > 50 ? '...' : ''}"`,
      );
      return {
        content: this.normalizeReplyContent(replyFromTool),
        source: MessageProcessor.REPLY_SOURCE_TOOL,
      };
    }

    // 降级：从最后一条 assistant 消息的 text parts 提取
    const replyFromText = this.extractReplyFromTextParts(aiResponse.messages);
    if (replyFromText) {
      this.logger.log(
        `[extractReplyContent] 降级使用 assistant.parts.text: "${replyFromText.substring(0, 50)}${replyFromText.length > 50 ? '...' : ''}"`,
      );
      return {
        content: this.normalizeReplyContent(replyFromText),
        source: MessageProcessor.REPLY_SOURCE_TEXT,
      };
    }

    throw new Error('AI 响应中没有找到有效回复内容（zhipin_reply_generator 和 text 均为空）');
  }

  /**
   * 从 zhipin_reply_generator 工具输出中提取回复
   * 遍历所有 assistant 消息，找到最后一个成功的 zhipin_reply_generator 调用
   */
  private extractReplyFromZhipinTool(messages: any[]): string | null {
    let lastReply: string | null = null;

    for (const message of messages) {
      if (message.role !== 'assistant' || !message.parts) continue;

      for (const part of message.parts) {
        if (
          part.type === 'dynamic-tool' &&
          part.toolName === 'zhipin_reply_generator' &&
          part.state === 'output-available' &&
          part.output?.reply &&
          typeof part.output.reply === 'string'
        ) {
          lastReply = part.output.reply;
        }
      }
    }

    return lastReply;
  }

  /**
   * 从 assistant 消息的 text parts 中提取回复
   * 取最后一条 assistant 消息的所有 text parts
   */
  private extractReplyFromTextParts(messages: any[]): string | null {
    const lastAssistantMessage = messages.filter((m) => m.role === 'assistant').pop();

    if (!lastAssistantMessage?.parts || lastAssistantMessage.parts.length === 0) {
      return null;
    }

    const textParts = lastAssistantMessage.parts
      .filter((p: any) => p.type === 'text' && p.text)
      .map((p: any) => p.text);

    if (textParts.length === 0) {
      return null;
    }

    return textParts.join('\n\n');
  }

  /**
   * 清洗回复内容
   * 将 Markdown 列表格式转换为自然口语
   */
  private normalizeReplyContent(rawContent: string): string {
    if (ReplyNormalizer.needsNormalization(rawContent)) {
      const normalizedContent = ReplyNormalizer.normalize(rawContent);
      this.logger.debug(
        `[ReplyNormalizer] 已清洗回复: "${rawContent.substring(0, 50)}..." → "${normalizedContent.substring(0, 50)}..."`,
      );
      return normalizedContent;
    }
    return rawContent;
  }

  /**
   * 构建包含品牌配置的 context
   * 合并 profile 中的静态 context 和动态品牌数据
   */
  private async buildContextWithBrand(
    baseContext?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    try {
      // 获取最新的品牌配置（从 Redis 缓存）
      const brandConfig = await this.brandConfigService.getBrandConfig();

      if (!brandConfig) {
        this.logger.warn('⚠️ 无法获取品牌配置，尝试使用缓存的旧配置');
        return this.buildFallbackContext(baseContext);
      }

      // 合并配置：基础 context + 品牌配置
      const mergedContext = {
        ...(baseContext || {}),
        configData: brandConfig.brandData,
        replyPrompts: brandConfig.replyPrompts,
      };

      // 调试日志：检查 brandPriorityStrategy 是否正确合并
      this.logger.debug(
        `[buildContextWithBrand] baseContext keys: ${Object.keys(baseContext || {}).join(', ')}`,
      );
      this.logger.debug(
        `[buildContextWithBrand] baseContext.brandPriorityStrategy: ${(baseContext as Record<string, unknown>)?.brandPriorityStrategy || '(原始context中未找到)'}`,
      );
      this.logger.debug(
        `[buildContextWithBrand] mergedContext.brandPriorityStrategy: ${(mergedContext as Record<string, unknown>)?.brandPriorityStrategy || '(合并后未找到)'}`,
      );
      this.logger.debug(
        `[buildContextWithBrand] mergedContext keys: ${Object.keys(mergedContext || {}).join(', ')}`,
      );

      // 缓存成功的品牌配置
      if (brandConfig.synced && brandConfig.brandData && brandConfig.replyPrompts) {
        this.lastValidBrandConfig = mergedContext;
        this.logger.debug(`✅ 已合并品牌配置到 context (synced: ${brandConfig.synced})`);
      }

      return mergedContext;
    } catch (error) {
      this.logger.error('❌ 合并品牌配置失败，尝试使用缓存的旧配置:', error);
      return this.buildFallbackContext(baseContext);
    }
  }

  /**
   * 构建降级 context（优先使用缓存）
   */
  private buildFallbackContext(baseContext?: Record<string, unknown>): Record<string, unknown> {
    if (this.lastValidBrandConfig) {
      this.logger.warn('⚠️ 使用缓存的旧品牌配置');
      return { ...this.lastValidBrandConfig };
    }

    this.logger.warn('⚠️ 无可用缓存，使用空配置');
    return { ...(baseContext || {}) };
  }

  /**
   * 检测面试预约成功并发送飞书通知
   * 检查 Agent 响应中是否有 duliday_interview_booking 工具调用成功
   */
  private async checkAndNotifyInterviewBooking(
    chatId: string,
    contactName: string,
    aiResponse: {
      messages?: Array<{
        role: string;
        parts: Array<{
          type: string;
          toolName?: string;
          state?: string;
          output?: Record<string, unknown>;
        }>;
      }>;
    },
  ): Promise<void> {
    if (!aiResponse.messages) return;

    // 遍历所有消息，查找 duliday_interview_booking 工具调用
    for (const message of aiResponse.messages) {
      if (message.role !== 'assistant' || !message.parts) continue;

      for (const part of message.parts) {
        // 检查是否是面试预约工具且状态为 output-available（调用成功）
        if (
          part.type === 'dynamic-tool' &&
          part.toolName === 'duliday_interview_booking' &&
          part.state === 'output-available' &&
          part.output
        ) {
          this.logger.log(`[面试预约] 检测到预约成功，准备发送飞书通知`);

          // 从工具输出中提取预约信息
          const toolOutput = part.output;
          const bookingInfo = {
            candidateName: contactName,
            chatId,
            brandName: (toolOutput.brand_name as string) || (toolOutput.brandName as string),
            storeName: (toolOutput.store_name as string) || (toolOutput.storeName as string),
            interviewTime:
              (toolOutput.interview_time as string) || (toolOutput.interviewTime as string),
            contactInfo: (toolOutput.contact_info as string) || (toolOutput.contactInfo as string),
            toolOutput,
          };

          // 发送飞书通知（异步，不阻塞主流程）
          this.feishuBookingService
            .sendBookingNotification(bookingInfo)
            .then((success: boolean) => {
              if (success) {
                this.logger.log(
                  `[面试预约] 飞书通知发送成功: ${contactName} - ${bookingInfo.brandName || '未知品牌'}`,
                );
              } else {
                this.logger.warn(`[面试预约] 飞书通知发送失败`);
              }
            })
            .catch((error: Error) => {
              this.logger.error(`[面试预约] 飞书通知发送异常: ${error.message}`);
            });

          // 只处理第一个预约成功的工具调用
          return;
        }
      }
    }
  }

  /**
   * 从 messages 中提取真正使用的工具列表
   * 遍历所有 assistant 消息的 parts，收集 toolName
   */
  private extractActuallyUsedTools(messages: unknown): string[] {
    type RawMessage = {
      role: string;
      parts: Array<{
        type: string;
        toolName?: string;
      }>;
    };

    const rawMessages = messages as RawMessage[];
    const usedTools = new Set<string>();

    for (const message of rawMessages) {
      if (message.role !== 'assistant' || !message.parts) continue;

      for (const part of message.parts) {
        if (part.type === 'dynamic-tool' && part.toolName) {
          usedTools.add(part.toolName);
        }
      }
    }

    return Array.from(usedTools);
  }

  /**
   * 映射 Agent 消息到监控接口格式
   * 支持 text 和 dynamic-tool 类型的 parts
   */
  private mapAgentMessages(
    messages: unknown,
  ): import('@core/monitoring/interfaces/monitoring.interface').AgentResponseMessage[] {
    type RawMessage = {
      id?: string;
      role: string;
      parts: Array<{
        type: string;
        text?: string;
        state?: string;
        toolName?: string;
        toolCallId?: string;
        input?: Record<string, unknown>;
        output?: Record<string, unknown>;
        error?: string;
      }>;
    };

    const rawMessages = messages as RawMessage[];

    return rawMessages.map((m) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant' | 'system',
      parts: m.parts.map(
        (p): import('@core/monitoring/interfaces/monitoring.interface').AgentMessagePart => {
          if (p.type === 'text') {
            return {
              type: 'text',
              text: p.text || '',
              state: p.state as 'done' | 'streaming' | undefined,
            };
          } else if (p.type === 'dynamic-tool') {
            return {
              type: 'dynamic-tool',
              toolName: p.toolName || '',
              toolCallId: p.toolCallId || '',
              state: (p.state as 'pending' | 'running' | 'output-available' | 'error') || 'pending',
              input: p.input,
              output: p.output,
              error: p.error,
            };
          }
          // 默认作为 text 类型处理
          return { type: 'text', text: String(p.text || '') };
        },
      ),
    }));
  }

  /**
   * 构建原始入参 JSON 字符串（超长字段截断）
   * 用于 Dashboard 展示完整的 Agent 调用参数
   *
   * @param agentParams 原始 Agent 调用参数
   * @param maxStringLength 字符串字段最大长度（默认 200）
   * @param maxArrayItems 数组最大元素数（默认 5）
   */
  private buildRawParamsJson(
    agentParams: Record<string, unknown>,
    maxStringLength = 200,
    maxArrayItems = 5,
  ): string {
    const truncateValue = (value: unknown, depth = 0): unknown => {
      if (depth > 3) {
        return '[深度超限...]';
      }

      if (typeof value === 'string') {
        if (value.length > maxStringLength) {
          return `${value.substring(0, maxStringLength)}... [共${value.length}字符]`;
        }
        return value;
      }

      if (Array.isArray(value)) {
        const truncated = value
          .slice(0, maxArrayItems)
          .map((item) => truncateValue(item, depth + 1));
        if (value.length > maxArrayItems) {
          return [...truncated, `... [还有${value.length - maxArrayItems}项]`];
        }
        return truncated;
      }

      if (value !== null && typeof value === 'object') {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
          result[k] = truncateValue(v, depth + 1);
        }
        return result;
      }

      return value;
    };

    try {
      const truncatedParams = truncateValue(agentParams) as Record<string, unknown>;
      return JSON.stringify(truncatedParams, null, 2);
    } catch {
      return '{"error": "无法序列化入参"}';
    }
  }
}
