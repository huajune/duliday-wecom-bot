// 公共接口导出
export * from './agent.module';
export * from './agent.service';
export * from './utils/agent-enums'; // 枚举单独导出
export * from './utils/agent-types';
export * from './utils/agent-exceptions';

// 导出常用的服务供其他模块使用
export { ProfileLoaderService } from './services/agent-profile-loader.service';
export { BrandConfigService } from './services/brand-config.service';
export { AgentRegistryService } from './services/agent-registry.service';
export { AgentConfigValidator } from './utils/agent-validator';
export {
  AgentFacadeService,
  type StreamChatResult,
  type ScenarioOptions,
} from './services/agent-facade.service';

// 导出辅助工具
export {
  AgentResultHelper,
  createSuccessResult,
  createFallbackResult,
  createErrorResult,
} from './utils/agent-result-helper';

// 内部服务通过 AgentModule 依赖注入，不对外暴露：
// - AgentApiClientService
// - AgentFallbackService
// - BrandConfigMonitor
