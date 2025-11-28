import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@core/client-http';
import { FeishuModule } from '@core/feishu';
import { AgentService } from './agent.service';
import { AgentRegistryService } from './services/agent-registry.service';
import { AgentFallbackService } from './services/agent-fallback.service';
import { AgentApiClientService } from './services/agent-api-client.service';
import { AgentConfigValidator } from './utils/agent-validator';
import { BrandConfigMonitor } from './utils/agent-monitor';
import { AgentController } from './agent.controller';
import { ProfileLoaderService } from './services/agent-profile-loader.service';
import { BrandConfigService } from './services/brand-config.service';

/**
 * AI Agent 模块
 * 提供 AI Agent 集成能力，包括配置管理和资源注册表
 *
 * 服务架构（简化版）：
 * - AgentService: 核心业务逻辑层（组装请求、处理响应、降级策略）
 * - AgentApiClientService: HTTP 客户端层（API 调用、重试、速率限制）
 * - AgentRegistryService: 模型和工具注册表
 * - ProfileLoaderService: Profile 加载服务
 * - BrandConfigService: 品牌配置管理服务
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
    FeishuModule, // 依赖告警模块提供的 FeishuAlertService
  ],
  controllers: [AgentController],
  providers: [
    // 基础服务（按字母排序）
    AgentApiClientService,
    AgentFallbackService,
    AgentRegistryService,
    AgentConfigValidator,
    BrandConfigMonitor,

    // 配置服务
    ProfileLoaderService,
    BrandConfigService,

    // 主服务
    AgentService,
  ],
  exports: [
    AgentService,
    AgentApiClientService,
    AgentRegistryService,
    AgentFallbackService,
    AgentConfigValidator,
    BrandConfigMonitor,
    ProfileLoaderService,
    BrandConfigService,
  ],
})
export class AgentModule {}
