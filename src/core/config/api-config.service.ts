import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * API 配置服务
 * 统一管理所有外部 API 的基地址和端点
 */
@Injectable()
export class ApiConfigService {
  // Stride API 基地址
  private readonly strideBaseUrl: string;

  constructor(private readonly configService: ConfigService) {
    // 从环境变量读取（已在启动时验证，这里可以安全使用）
    this.strideBaseUrl = this.configService.get<string>('STRIDE_API_BASE_URL')!;
  }

  /**
   * 获取 Stride Stream API 基地址
   */
  getStrideStreamApiBaseUrl(): string {
    return `${this.strideBaseUrl}/stream-api`;
  }

  /**
   * 获取 Stride API v2 基地址
   */
  getStrideApiV2BaseUrl(): string {
    return `${this.strideBaseUrl}/api/v2`;
  }

  /**
   * 构建完整的 API URL
   * @param endpoint - API 端点（如 '/chat/list', '/message/send'）
   * @param version - API 版本（'stream-api' | 'v2'）
   */
  buildApiUrl(endpoint: string, version: 'stream-api' | 'v2' = 'stream-api'): string {
    const baseUrl =
      version === 'v2' ? this.getStrideApiV2BaseUrl() : this.getStrideStreamApiBaseUrl();
    // 确保 endpoint 以 / 开头
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return `${baseUrl}${normalizedEndpoint}`;
  }

  /**
   * Stream API 端点
   */
  readonly endpoints = {
    // 聊天相关
    chat: {
      list: () => this.buildApiUrl('/chat/list'),
    },
    // 消息相关
    message: {
      history: () => this.buildApiUrl('/message/history'),
      send: () => this.buildApiUrl('/message/send'),
      sentResult: () => this.buildApiUrl('/sentResult'),
    },
    // 联系人相关
    contact: {
      list: () => this.buildApiUrl('/contact/list'),
    },
    // 群聊相关
    room: {
      list: () => this.buildApiUrl('/room/list'),
      simpleList: () => this.buildApiUrl('/room/simpleList'),
      addMember: () => this.buildApiUrl('/room/addMember'),
      addFriendSend: () => this.buildApiUrl('/addFriend/room/send'), // 群聊加好友
    },
    // 用户相关
    user: {
      list: () => this.buildApiUrl('/user/list'),
    },
    // 机器人相关
    bot: {
      list: () => this.buildApiUrl('/bot/list'),
    },
    // 客户相关（使用 v2 API）
    customer: {
      list: () => this.buildApiUrl('/customer/list', 'v2'),
    },
  };
}
