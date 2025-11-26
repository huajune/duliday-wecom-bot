/**
 * Agent API 相关常量配置
 * 这些值通常不需要频繁修改，直接硬编码
 */

// Agent API 超时配置
export const AGENT_API_TIMEOUT = 600000; // 10 分钟
export const AGENT_API_MAX_RETRIES = 5;

// Agent 响应缓存配置
export const AGENT_RESPONSE_CACHE_TTL_SECONDS = 3600; // 1 小时
export const AGENT_RESPONSE_CACHE_MAX_ITEM_SIZE_KB = 100;
