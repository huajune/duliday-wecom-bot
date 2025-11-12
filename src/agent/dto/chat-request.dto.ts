/**
 * /api/v1/chat 接口请求类型定义
 * 符合 Open API Agent Spec 规范
 */

/**
 * AI SDK v5 兼容消息格式
 */
export interface UIMessagePart {
  type: 'text';
  text: string;
}

export interface UIMessage {
  role: 'user' | 'assistant' | 'system';
  parts: UIMessagePart[];
}

/**
 * 简单消息格式（会在服务端转换为 UIMessage）
 */
export interface SimpleMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * 消息剪裁选项
 */
export interface PruneOptions {
  maxOutputTokens?: number;
  targetTokens?: number;
  preserveRecentMessages?: number;
}

/**
 * 模型配置
 */
export interface ModelConfig {
  chatModel?: string;
  classifyModel?: string;
  replyModel?: string;
}

/**
 * 品牌优先级策略
 * - user-selected: UI选择优先
 * - conversation-extracted: 职位详情识别优先（工具调用时从岗位信息提取）
 * - smart: 智能判断（推荐）
 */
export type BrandPriorityStrategy = 'user-selected' | 'conversation-extracted' | 'smart';

/**
 * 品牌筛选配置
 */
export interface BrandScreening {
  age?: {
    min?: number;
    max?: number;
    preferred?: number[];
  };
  blacklistKeywords?: string[];
  preferredKeywords?: string[];
}

/**
 * 品牌配置
 */
export interface BrandConfig {
  templates?: {
    [key: string]: string[];
  };
  screening?: BrandScreening;
}

/**
 * 配置数据
 */
export interface ConfigData {
  city?: string;
  stores?: any[];
  brands?: {
    [brandName: string]: BrandConfig;
  };
  defaultBrand?: string;
}

/**
 * 系统提示词映射
 */
export interface SystemPrompts {
  bossZhipinSystemPrompt?: string;
  bossZhipinLocalSystemPrompt?: string;
  generalComputerSystemPrompt?: string;
  [key: string]: string | undefined;
}

/**
 * 回复提示词映射
 */
export interface ReplyPrompts {
  general_chat?: string;
  initial_inquiry?: string;
  schedule_inquiry?: string;
  salary_inquiry?: string;
  interview_request?: string;
  availability_inquiry?: string;
  followup_chat?: string;
  age_concern?: string;
  [key: string]: string | undefined;
}

/**
 * 上下文配置
 */
export interface ChatContext {
  preferredBrand?: string;
  brandPriorityStrategy?: BrandPriorityStrategy;
  modelConfig?: ModelConfig;
  configData?: ConfigData;
  systemPrompts?: SystemPrompts;
  replyPrompts?: ReplyPrompts;
  dulidayToken?: string | null;
  defaultWechatId?: string | null;
  sandboxId?: string | null;
  [key: string]: any;
}

/**
 * 工具特定上下文
 */
export interface ToolContext {
  [toolName: string]: {
    [key: string]: any;
  };
}

/**
 * 上下文策略
 */
export type ContextStrategy = 'error' | 'skip' | 'report';

/**
 * /api/v1/chat 请求体
 * 注意：本项目不使用流式输出，stream 参数固定为 false
 */
export interface ChatRequest {
  // 必填字段
  model: string;
  messages: (UIMessage | SimpleMessage)[];

  // 流式输出配置（本项目不使用）
  stream?: false;

  // 消息剪裁配置
  prune?: boolean;
  pruneOptions?: PruneOptions;

  // 系统提示词配置（二选一，systemPrompt 优先级更高）
  systemPrompt?: string;
  promptType?:
    | 'bossZhipinSystemPrompt'
    | 'bossZhipinLocalSystemPrompt'
    | 'generalComputerSystemPrompt';

  // 工具配置
  allowedTools?: string[];
  sandboxId?: string | null;

  // 上下文配置
  context?: ChatContext;
  toolContext?: ToolContext;

  // 上下文策略
  contextStrategy?: ContextStrategy;

  // 仅验证模式
  validateOnly?: boolean;
}

/**
 * 非流式响应 - 使用情况统计
 */
export interface UsageStats {
  inputTokens: number; // 实际 API 返回的字段名
  outputTokens: number; // 实际 API 返回的字段名
  totalTokens: number;
  cachedInputTokens?: number; // 可选的缓存 token 统计
}

/**
 * 非流式响应 - 工具使用信息
 */
export interface ToolsInfo {
  used: string[];
  skipped: string[];
}

/**
 * 非流式响应体
 */
export interface ChatResponse {
  messages: UIMessage[];
  usage: UsageStats;
  tools: ToolsInfo;
}

/**
 * API 响应包装器（实际 API 返回格式）
 */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
  correlationId?: string;
}

/**
 * 错误响应
 */
export interface ErrorResponse {
  error: string;
  message: string;
  details?: any;
  statusCode: number;
  correlationId?: string;
}
