// 公共接口导出
export * from './agent.module';
export * from './agent.service';
export * from './utils/types';
export * from './utils/exceptions';

// 导出常用的服务供其他模块使用
export { ProfileLoaderService } from './services/profile-loader.service';
export { BrandConfigService } from './services/brand-config.service';
export { AgentConfigValidator } from './utils/validator';

// 导出辅助工具
export {
  AgentResultHelper,
  createSuccessResult,
  createFallbackResult,
  createErrorResult,
} from './utils/result-helper';

// 内部服务通过 AgentModule 依赖注入，不对外暴露：
// - AgentApiClientService
// - AgentCacheService
// - AgentFallbackService
// - AgentRegistryService
// - BrandConfigMonitor
