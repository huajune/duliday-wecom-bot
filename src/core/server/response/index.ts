/**
 * 响应处理模块统一导出
 * 提供标准化的 API 响应格式和错误处理
 *
 * 使用说明：
 * - 拦截器和过滤器已在 main.ts 全局注册
 * - 所有 HTTP 响应自动统一包装
 * - 使用 @RawResponse() 装饰器豁免包装
 */

// DTO - 标准响应格式定义
export * from './dto/response.dto';

// 拦截器 - 全局自动包装响应
export * from './interceptors/response.interceptor';

// 过滤器 - 统一错误处理
export * from './filters/http-exception.filter';

// 装饰器 - @RawResponse 豁免包装
export * from './decorators/api-response.decorator';
