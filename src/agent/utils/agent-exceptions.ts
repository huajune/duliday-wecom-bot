import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Agent API 异常基类
 */
export class AgentException extends HttpException {
  constructor(message: string, statusCode: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR) {
    super(message, statusCode);
  }
}

/**
 * Agent 配置错误
 */
export class AgentConfigException extends AgentException {
  constructor(message: string) {
    super(`Agent配置错误: ${message}`, HttpStatus.BAD_REQUEST);
  }
}

/**
 * Agent API 调用失败
 */
export class AgentApiException extends AgentException {
  constructor(
    message: string,
    public readonly details?: any,
  ) {
    super(`Agent API调用失败: ${message}`, HttpStatus.BAD_GATEWAY);
  }
}

/**
 * Agent 上下文缺失错误
 */
export class AgentContextMissingException extends AgentException {
  constructor(
    public readonly missingFields: string[],
    public readonly tools: string[],
  ) {
    super(
      `Agent上下文缺失: ${missingFields.join(', ')} (工具: ${tools.join(', ')})`,
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * Agent 验证错误
 */
export class AgentValidationException extends AgentException {
  constructor(
    public readonly errors: string[],
    public readonly profileName?: string,
  ) {
    super(
      `Agent配置验证失败${profileName ? ` (${profileName})` : ''}: ${errors.join('; ')}`,
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * Agent 频率限制错误
 */
export class AgentRateLimitException extends AgentException {
  constructor(
    public readonly retryAfter: number,
    message?: string,
  ) {
    super(message || `请求频率过高，请${retryAfter}秒后重试`, HttpStatus.TOO_MANY_REQUESTS);
  }
}

/**
 * Agent 品牌配置不可用错误
 */
export class AgentBrandConfigUnavailableException extends AgentException {
  constructor(message?: string) {
    super(
      message || '抱歉，系统配置暂时不可用，请稍后再试。如果问题持续存在，请联系管理员。',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

/**
 * Agent API 认证失败错误
 */
export class AgentAuthException extends AgentException {
  constructor(
    message?: string,
    public readonly statusCode?: number,
  ) {
    super(message || 'Agent API 认证失败：API Key 无效或已过期', HttpStatus.UNAUTHORIZED);
  }
}
