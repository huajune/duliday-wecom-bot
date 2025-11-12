// 公共接口导出
export * from './agent.module';
export * from './agent.service';
export * from './dto/chat-request.dto';
export * from './exceptions/agent.exception';
export * from './interfaces';
export * from './models/agent-result.model';

// 内部服务通过 AgentModule 依赖注入，不对外暴露：
// - AgentFallbackService
// - AgentConfigService (包括 BrandConfig)
// - AgentRegistryService
// - AgentCacheService
// - AgentApiClientService
// - ProfileLoaderService
// - BrandConfigService
