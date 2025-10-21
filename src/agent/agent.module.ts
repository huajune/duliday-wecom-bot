import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConversationModule } from '@common/conversation';
import { HttpModule } from '@core/http/http.module';
import { AgentService } from './agent.service';
import { AgentConfigService } from './agent-config.service';
import { AgentController } from './agent.controller';

/**
 * AI Agent 模块
 * 提供 AI Agent 集成能力，包括对话管理、配置管理等
 */
@Module({
  imports: [
    ConfigModule,
    ConversationModule, // 依赖会话管理模块
    HttpModule, // 依赖 HTTP 模块提供的 HttpClientFactory
  ],
  controllers: [AgentController],
  providers: [AgentService, AgentConfigService],
  exports: [AgentService, AgentConfigService],
})
export class AgentModule {}
