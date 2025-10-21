import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosInstance } from 'axios';
import { HttpClientFactory } from './http-client.factory';

/**
 * HTTP 客户端服务
 * 提供通用的 HTTP 请求能力
 */
@Injectable()
export class HttpService {
  private readonly logger = new Logger(HttpService.name);
  private readonly httpClient: AxiosInstance;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpClientFactory: HttpClientFactory,
  ) {
    // 从环境变量读取配置，必须配置
    const timeout = this.configService.get<number>('HTTP_CLIENT_TIMEOUT');
    if (!timeout) {
      throw new Error('HTTP_CLIENT_TIMEOUT 环境变量未配置，请在 .env 文件中设置');
    }

    this.logger.log(`初始化通用 HTTP 客户端，超时设置: ${timeout}ms`);

    // 使用工厂创建 HTTP 客户端实例
    this.httpClient = this.httpClientFactory.create({
      timeout,
      logPrefix: '[HTTP Service]',
      verbose: true, // 通用服务启用详细日志
    });
  }

  /**
   * 调用第三方 API - GET 请求
   */
  async get(url: string, params?: any) {
    try {
      const response = await this.httpClient.get(url, { params });
      this.logger.log('GET 请求成功:', response.data);
      return response.data;
    } catch (error) {
      this.logger.error('GET 请求失败:', error);
      throw error;
    }
  }

  /**
   * 调用第三方 API - POST 请求
   */
  async post(url: string, data?: any) {
    try {
      const response = await this.httpClient.post(url, data);
      this.logger.log('POST 请求成功:', response.data);
      return response.data;
    } catch (error) {
      this.logger.error('POST 请求失败:', error);
      throw error;
    }
  }
}
