/**
 * Agent API 相关常量配置
 * 这些值通常不需要频繁修改，直接硬编码
 */

// Agent API 超时配置
export const AGENT_API_TIMEOUT = 180000; // 3 分钟
export const AGENT_API_MAX_RETRIES = 5;

// Agent 响应缓存配置
export const AGENT_RESPONSE_CACHE_TTL_SECONDS = 3600; // 1 小时
export const AGENT_RESPONSE_CACHE_MAX_ITEM_SIZE_KB = 100;

// ==================== Agent API 认证配置（Fallback）====================
// 当环境变量加载失败时使用的硬编码配置
// 优先级：环境变量 > 硬编码配置

/**
 * Agent API Key - Fallback 配置
 * 生产环境强烈建议使用环境变量，此处仅作为开发环境 fallback
 */
export const AGENT_API_KEY_FALLBACK = 'f4174f.nEA0MYE3Vz-U0O2w4HawdA.QH1lUahJwLpKnvm6';

/**
 * Agent API Base URL - Fallback 配置
 */
export const AGENT_API_BASE_URL_FALLBACK = 'https://huajune.duliday.com/api/v1';
