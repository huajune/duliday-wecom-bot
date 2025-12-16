/**
 * Monitoring Hooks 统一导出
 *
 * 按业务领域拆分的 React Query Hooks
 * 从 useMonitoring.ts (905 行, 41 个函数) 拆分而来（2025-12-16）
 *
 * @see https://github.com/duliday/wecom-service/issues/xxx
 */

// 共享工具
export * from './shared';

// 聊天记录相关 (11 个函数)
export * from './useChatRecords';

// 用户管理相关 (7 个函数)
export * from './useUsers';

// 系统配置相关 (9 个函数)
export * from './useSystemConfig';

// 监控指标相关 (4 个函数)
export * from './useMetrics';

// Dashboard 相关 (4 个函数)
export * from './useDashboard';

// Worker 并发管理 (3 个函数)
export * from './useWorker';
