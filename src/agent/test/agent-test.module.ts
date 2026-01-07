import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { HttpModule } from '@core/client-http';
import { AgentTestController } from './agent-test.controller';
import { AgentTestService } from './agent-test.service';
import { AgentTestProcessor } from './agent-test.processor';
import { FeishuTestSyncService } from './services/feishu-test-sync.service';
import { TestStatsService } from './services/test-stats.service';
import { TestBatchRepository, TestExecutionRepository } from './repositories';
import { AgentModule } from '../agent.module';
import { FeishuModule } from '@core/feishu';

/**
 * Agent 测试模块
 * 提供 Agent 测试执行、结果保存、批次管理等功能
 *
 * 特性：
 * - 使用 Bull Queue 处理长时间运行的测试任务（30-50秒/任务）
 * - 支持任务进度实时查询
 * - 支持批次取消和失败重试
 */
@Module({
  imports: [
    ConfigModule,
    HttpModule,
    AgentModule, // 导入 AgentModule 以使用 AgentService 等
    FeishuModule, // 导入 FeishuModule 以使用飞书多维表格服务
    // 注册 Agent 测试队列
    BullModule.registerQueueAsync({
      name: 'agent-test',
      imports: [ConfigModule],
      useFactory: async (_configService: ConfigService) => {
        // 复用项目已有的 Redis 连接配置
        // Bull Queue 的根模块配置在 MessageModule 中，这里只需注册队列
        return {
          defaultJobOptions: {
            attempts: 2, // 失败重试 1 次
            backoff: {
              type: 'exponential',
              delay: 5000, // 5 秒后重试
            },
            timeout: 120000, // 2 分钟超时（Agent 调用耗时长）
            removeOnComplete: true, // 完成后自动删除
            removeOnFail: false, // 失败保留用于调试
          },
        };
      },
      inject: [ConfigService],
    }),
  ],
  controllers: [AgentTestController],
  providers: [
    AgentTestService,
    AgentTestProcessor,
    FeishuTestSyncService,
    TestStatsService,
    TestBatchRepository,
    TestExecutionRepository,
  ],
  exports: [
    AgentTestService,
    AgentTestProcessor,
    FeishuTestSyncService,
    TestStatsService,
    TestBatchRepository,
    TestExecutionRepository,
  ],
})
export class AgentTestModule {}
