import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { EnterpriseMessageCallbackDto } from '../dto/send-message.dto';
import {
  PendingMessage,
  MessageMergeQueue,
  MessageProcessor,
} from '../interfaces/message-merge.interface';
import { MessageParser } from '../utils/message-parser.util';

/**
 * 消息聚合服务
 * 负责将短时间内的多条消息聚合为一次处理，减少 API 调用
 * 支持两种模式：内存队列（单实例） 和 Bull队列（多实例）
 */
@Injectable()
export class MessageMergeService implements OnModuleDestroy {
  private readonly logger = new Logger(MessageMergeService.name);

  // 消息聚合队列 (chatId -> MessageMergeQueue)
  private readonly messageMergeQueues = new Map<string, MessageMergeQueue>();
  private readonly messageMergeWindow: number; // 消息聚合时间窗口（毫秒）
  private readonly maxMergedMessages: number; // 单次最多聚合消息数
  private readonly enableBullQueue: boolean; // 是否启用 Bull 队列

  constructor(
    private readonly configService: ConfigService,
    @Optional() @InjectQueue('message-merge') private readonly messageQueue?: Queue,
  ) {
    // 从环境变量读取配置
    this.messageMergeWindow = parseInt(
      this.configService.get<string>('MESSAGE_MERGE_WINDOW_MS', '1000'),
      10,
    );
    this.maxMergedMessages = parseInt(
      this.configService.get<string>('MAX_MERGED_MESSAGES', '3'),
      10,
    );
    this.enableBullQueue = this.configService.get<string>('ENABLE_BULL_QUEUE', 'false') === 'true';

    const queueType = this.enableBullQueue && this.messageQueue ? 'Bull 队列' : '内存队列';
    this.logger.log(
      `消息聚合服务已初始化 (${queueType}, 时间窗口: ${this.messageMergeWindow}ms, 最多聚合: ${this.maxMergedMessages} 条)`,
    );

    if (this.enableBullQueue && !this.messageQueue) {
      this.logger.warn('启用了 Bull 队列但注入失败，将降级使用内存队列');
    }
  }

  /**
   * 将消息加入聚合队列
   * 根据配置自动选择 Bull 队列或内存队列
   */
  async enqueue(
    messageData: EnterpriseMessageCallbackDto,
    processor: MessageProcessor,
  ): Promise<void> {
    // 如果启用了 Bull 队列且可用，使用 Bull
    if (this.enableBullQueue && this.messageQueue) {
      await this.enqueueToBull(messageData);
    } else {
      // 否则使用内存队列
      this.enqueueToMemory(messageData, processor);
    }
  }

  /**
   * 将消息加入 Bull 队列
   */
  private async enqueueToBull(messageData: EnterpriseMessageCallbackDto): Promise<void> {
    const chatId = messageData.chatId;

    try {
      // 添加任务到 Bull 队列
      await this.messageQueue!.add(
        'merge',
        {
          messages: [messageData], // Bull 处理器期望的格式
        },
        {
          jobId: `merge-${chatId}-${Date.now()}`, // 唯一任务 ID
          delay: this.messageMergeWindow, // 延迟执行（聚合窗口）
          removeOnComplete: true,
        },
      );

      this.logger.debug(
        `[Bull] 消息加入队列 [${messageData.messageId}], chatId: ${chatId}, 延迟: ${this.messageMergeWindow}ms`,
      );
    } catch (error) {
      this.logger.error(
        `[Bull] 消息入队失败 [${messageData.messageId}]: ${error.message}, 降级使用内存队列`,
      );
      // 降级到内存队列
      // 注意：这里需要 processor，但 Bull 模式下没有传入
      // 在实际使用中，应该从外部注入或者通过其他方式获取
      throw new Error('Bull 队列入队失败，无法降级（缺少 processor）');
    }
  }

  /**
   * 将消息加入内存队列（原有逻辑）
   */
  private enqueueToMemory(
    messageData: EnterpriseMessageCallbackDto,
    processor: MessageProcessor,
  ): void {
    const chatId = messageData.chatId;

    // 获取或创建该会话的聚合队列
    let queue = this.messageMergeQueues.get(chatId);

    if (!queue) {
      // 创建新队列
      const now = Date.now();
      queue = {
        messages: [],
        timer: setTimeout(
          () => this.processMergedMessages(chatId, processor),
          this.messageMergeWindow,
        ),
        firstMessageTime: now,
      };
      this.messageMergeQueues.set(chatId, queue);

      this.logger.debug(
        `[内存队列] 创建新队列 [${chatId}], 将在 ${this.messageMergeWindow}ms 后处理`,
      );
    }

    // 将消息加入队列
    queue.messages.push({
      messageData,
      receivedAt: Date.now(),
    });

    this.logger.debug(
      `[内存队列] 消息入队 [${messageData.messageId}], 当前队列长度: ${queue.messages.length}/${this.maxMergedMessages}`,
    );

    // 检查是否达到最大聚合数量
    if (queue.messages.length >= this.maxMergedMessages) {
      this.logger.log(
        `[内存队列] 队列 [${chatId}] 已达到最大聚合数 ${this.maxMergedMessages}, 立即处理`,
      );
      // 清除定时器并立即处理
      clearTimeout(queue.timer);
      this.processMergedMessages(chatId, processor);
    }
  }

  /**
   * 处理聚合后的消息
   */
  private processMergedMessages(chatId: string, processor: MessageProcessor): void {
    const queue = this.messageMergeQueues.get(chatId);

    if (!queue || queue.messages.length === 0) {
      this.messageMergeQueues.delete(chatId);
      return;
    }

    // 取出队列中的所有消息
    const messages = queue.messages;
    this.messageMergeQueues.delete(chatId);

    this.logger.log(`[消息聚合] 开始处理队列 [${chatId}], 聚合了 ${messages.length} 条消息`);

    // 提取消息数据并处理
    const messageDataList = messages.map((m) => m.messageData);

    // 如果只有一条消息，直接处理
    if (messageDataList.length === 1) {
      processor(messageDataList).catch((error) => {
        this.logger.error(`[消息聚合] 单条消息处理失败 [${chatId}]:`, error.message);
      });
      return;
    }

    // 多条消息：合并内容
    const mergedMessage = this.mergeMessages(messageDataList);
    processor([mergedMessage]).catch((error) => {
      this.logger.error(`[消息聚合] 批量处理失败 [${chatId}]:`, error.message);
    });
  }

  /**
   * 合并多条消息为一条
   */
  private mergeMessages(messages: EnterpriseMessageCallbackDto[]): EnterpriseMessageCallbackDto {
    if (messages.length === 0) {
      throw new Error('无法合并空消息列表');
    }

    // 使用第一条消息作为基础
    const firstMessage = messages[0];

    // 合并所有消息的内容
    const contents = messages.map((m) => MessageParser.extractContent(m));
    const mergedContent = contents.join('\n');

    this.logger.log(
      `[消息聚合] 合并 ${messages.length} 条消息: "${mergedContent.substring(0, 100)}${mergedContent.length > 100 ? '...' : ''}"`,
    );

    // 返回合并后的消息
    return {
      ...firstMessage,
      payload: {
        ...firstMessage.payload,
        text: mergedContent,
        pureText: mergedContent,
      },
    };
  }

  /**
   * 获取队列统计信息
   */
  getQueueStats() {
    let totalQueuedMessages = 0;
    const queueDetails: Record<string, number> = {};

    for (const [chatId, queue] of this.messageMergeQueues.entries()) {
      totalQueuedMessages += queue.messages.length;
      queueDetails[chatId] = queue.messages.length;
    }

    return {
      queueType: this.enableBullQueue && this.messageQueue ? 'Bull' : 'Memory',
      activeQueues: this.messageMergeQueues.size,
      totalQueuedMessages,
      windowMs: this.messageMergeWindow,
      maxMergedMessages: this.maxMergedMessages,
      // queues: queueDetails, // 可选：详细列表
    };
  }

  /**
   * 清理聚合队列
   */
  clearQueue(chatId?: string): void {
    if (chatId) {
      // 清理指定会话的队列
      const queue = this.messageMergeQueues.get(chatId);
      if (queue) {
        clearTimeout(queue.timer);
        this.messageMergeQueues.delete(chatId);
        this.logger.log(`已清理指定会话 [${chatId}] 的聚合队列`);
      }
    } else {
      // 清理所有队列
      for (const queue of this.messageMergeQueues.values()) {
        clearTimeout(queue.timer);
      }
      const size = this.messageMergeQueues.size;
      this.messageMergeQueues.clear();
      this.logger.log(`已清理所有聚合队列: ${size} 个`);
    }
  }

  /**
   * 模块销毁钩子
   * 清理所有定时器
   */
  onModuleDestroy() {
    this.clearQueue();
  }
}
