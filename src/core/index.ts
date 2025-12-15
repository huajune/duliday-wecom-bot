/**
 * 核心层 - 统一导出入口
 *
 * 核心层提供技术基础设施（水平分层），包括：
 * - client-http: 客户端 HTTP 工具
 * - server: 服务端响应处理（拦截器、过滤器、装饰器）
 * - redis: Redis 缓存服务
 * - config: 配置管理
 *
 * 设计原则：
 * - 核心层只包含通用的、可复用的技术组件
 * - 完全扁平化，避免不必要的嵌套
 * - 业务相关的外部 API 调用应放在各业务域内部
 * - YAGNI: 不创建暂时用不到的模块骨架
 */

// 客户端功能
export * from './client-http';

// 服务端功能
export * from './server';

// 基础设施
export * from './redis';
export * from './config';

// 工具函数
export * from './utils';
