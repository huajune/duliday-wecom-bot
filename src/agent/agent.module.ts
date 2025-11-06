import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@core/http';
import { AgentService } from './agent.service';
import { AgentConfigService } from './agent-config.service';
import { AgentCacheService } from './agent-cache.service';
import { AgentRegistryService } from './agent-registry.service';
import { AgentController } from './agent.controller';

/**
 * AI Agent 模块
 * 提供 AI Agent 集成能力，包括配置管理、缓存管理和资源注册表
 *
 * 服务架构：
 * - AgentService: 核心 API 调用层
 * - AgentCacheService: 统一缓存管理
 * - AgentRegistryService: 模型和工具注册表
 * - AgentConfigService: 配置档案管理（从文件系统加载）
 *
 * 注：AgentService 和 AgentRegistryService 之间有循环依赖，
 * 已在各自的构造函数中使用 forwardRef 解决
 */
@Module({
  imports: [
    ConfigModule,
    HttpModule, // 依赖 HTTP 模块提供的 HttpClientFactory
  ],
  controllers: [AgentController],
  providers: [AgentCacheService, AgentRegistryService, AgentService, AgentConfigService],
  exports: [AgentService, AgentConfigService, AgentCacheService, AgentRegistryService],
})
export class AgentModule {}
