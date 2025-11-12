import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@core/http';
import { AgentService } from './agent.service';
import { AgentConfigService } from './agent-config.service';
import { AgentCacheService } from './agent-cache.service';
import { AgentRegistryService } from './agent-registry.service';
import { AgentFallbackService } from './agent-fallback.service';
import { AgentApiClientService } from './agent-api-client.service';
import { AgentConfigValidator } from './validators/agent-config.validator';
import { BrandConfigMonitor } from './monitors/brand-config.monitor';
import { AgentController } from './agent.controller';
import { ProfileLoaderService } from './services/profile-loader.service';
import { BrandConfigService } from './services/brand-config.service';

/**
 * AI Agent 模块
 * 提供 AI Agent 集成能力，包括配置管理、缓存管理和资源注册表
 *
 * 服务架构（重构版 - 拆分后）：
 * - AgentService: 核心业务逻辑层（组装请求、处理响应、降级策略）
 * - AgentApiClientService: HTTP 客户端层（API 调用、重试、速率限制）
 * - AgentCacheService: 统一缓存管理
 * - AgentRegistryService: 模型和工具注册表（无循环依赖）
 * - AgentConfigService: 配置编排服务（Orchestrator）
 *   - ProfileLoaderService: Profile 加载服务
 *   - BrandConfigService: 品牌配置管理服务
 * - AgentFallbackService: 降级消息管理
 * - AgentConfigValidator: 配置验证器
 * - BrandConfigMonitor: 品牌配置监控器
 *
 * 工具类：
 * - ProfileSanitizer: Profile 清洗器（静态类，无需注册）
 * - AgentLogger: 日志工具（在 AgentService 中实例化）
 */
@Module({
  imports: [
    ConfigModule,
    HttpModule, // 依赖 HTTP 模块提供的 HttpClientFactory
  ],
  controllers: [AgentController],
  providers: [
    // 1. 基础服务（无依赖或最小依赖）
    AgentApiClientService,
    AgentCacheService,
    AgentFallbackService,
    AgentConfigValidator,
    BrandConfigMonitor,

    // 2. Registry（依赖 ApiClient）
    AgentRegistryService,

    // 3. 配置服务（拆分后的三层结构）
    ProfileLoaderService, // Profile 加载
    BrandConfigService, // 品牌配置管理
    AgentConfigService, // Orchestrator（依赖上面两个）

    // 4. 主服务（依赖所有服务）
    AgentService,
  ],
  exports: [
    AgentService,
    AgentApiClientService,
    AgentConfigService,
    AgentCacheService,
    AgentRegistryService,
    AgentFallbackService,
    AgentConfigValidator,
    BrandConfigMonitor,
  ],
})
export class AgentModule {}
