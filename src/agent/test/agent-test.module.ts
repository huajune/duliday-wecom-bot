import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@core/client-http';
import { AgentTestController } from './agent-test.controller';
import { AgentTestService } from './agent-test.service';
import { AgentModule } from '../agent.module';
import { FeishuModule } from '@core/feishu';

/**
 * Agent 测试模块
 * 提供 Agent 测试执行、结果保存、批次管理等功能
 */
@Module({
  imports: [
    ConfigModule,
    HttpModule,
    AgentModule, // 导入 AgentModule 以使用 AgentService 等
    FeishuModule, // 导入 FeishuModule 以使用飞书多维表格服务
  ],
  controllers: [AgentTestController],
  providers: [AgentTestService],
  exports: [AgentTestService],
})
export class AgentTestModule {}
