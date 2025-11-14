import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { MessageController } from './message.controller';
import { MessageService } from './message.service';
import { MessageProcessor } from './message.processor';
import { AgentModule } from '@agent';
import { MessageSenderModule } from '../message-sender/message-sender.module';

// 导入子服务
import { MessageDeduplicationService } from './services/message-deduplication.service';
import { MessageHistoryService } from './services/message-history.service';
import { MessageFilterService } from './services/message-filter.service';
import { MessageMergeService } from './services/message-merge.service';
import { MessageStatisticsService } from './services/message-statistics.service';
import { TypingDelayService } from './services/message-typing-delay.service';
import { MessageDeliveryService } from './services/message-delivery.service';
import { AgentGatewayService } from './services/message-agent-gateway.service';
import { FallbackMessageService } from './services/message-fallback.service';

/**
 * 消息处理模块
 * 负责接收、解析消息并触发 AI 自动回复
 *
 * 重构说明 v3：
 * - 8 个核心子服务，职责清晰（从10个优化到8个）
 * - AgentGatewayService 增强：整合上下文构建和降级处理
 * - MessageService 作为协调者，职责精简
 */
@Module({
  imports: [
    ConfigModule,
    AgentModule,
    MessageSenderModule,
    // 配置 Bull 队列
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const enableBull = configService.get<string>('ENABLE_BULL_QUEUE', 'false') === 'true';

        if (!enableBull) {
          // 如果未启用 Bull，返回空配置（降级到内存队列）
          return {};
        }

        // 优先使用 Upstash TCP 连接
        const upstashTcpUrl = configService.get<string>('UPSTASH_REDIS_TCP_URL');
        if (upstashTcpUrl) {
          return {
            redis: upstashTcpUrl,
            defaultJobOptions: {
              removeOnComplete: 100, // 保留最近 100 个完成的任务
              removeOnFail: 1000, // 保留最近 1000 个失败的任务（用于排查）
            },
          };
        }

        // 其次使用通用 REDIS_URL
        const redisUrl = configService.get<string>('REDIS_URL');
        if (redisUrl) {
          return {
            redis: redisUrl,
            defaultJobOptions: {
              removeOnComplete: 100,
              removeOnFail: 1000,
            },
          };
        }

        // 最后使用分离的配置（兜底）
        return {
          redis: {
            host: configService.get<string>('REDIS_HOST', 'localhost'),
            port: parseInt(configService.get<string>('REDIS_PORT', '6379'), 10),
            password: configService.get<string>('REDIS_PASSWORD'),
            tls: configService.get<string>('REDIS_TLS', 'false') === 'true' ? {} : undefined,
            maxRetriesPerRequest: null, // Upstash 需要
            enableReadyCheck: false, // Upstash 需要
          },
          defaultJobOptions: {
            removeOnComplete: 100,
            removeOnFail: 1000,
          },
        };
      },
      inject: [ConfigService],
    }),
    // 注册消息聚合队列
    BullModule.registerQueueAsync({
      name: 'message-merge',
      imports: [ConfigModule],
      useFactory: async () => ({
        // 队列配置
        defaultJobOptions: {
          attempts: 3, // 失败重试 3 次
          backoff: {
            type: 'exponential',
            delay: 2000, // 2秒后重试
          },
          removeOnComplete: true, // 完成后自动删除
          removeOnFail: false, // 失败保留用于调试
        },
      }),
    }),
  ],
  controllers: [MessageController],
  providers: [
    // 主服务
    MessageService,
    MessageProcessor,
    // 子服务（8个核心服务，按职责分类）
    MessageDeduplicationService, // 消息去重
    MessageHistoryService, // 消息历史
    MessageFilterService, // 消息过滤
    MessageMergeService, // 消息聚合
    MessageStatisticsService, // 统计监控
    TypingDelayService, // 智能打字延迟
    MessageDeliveryService, // 消息发送（统一分段发送和监控）
    AgentGatewayService, // Agent 调用网关（增强版：包含上下文构建和降级处理）
    FallbackMessageService, // 用户降级话术集中管理
  ],
  exports: [MessageService],
})
export class MessageModule {}
