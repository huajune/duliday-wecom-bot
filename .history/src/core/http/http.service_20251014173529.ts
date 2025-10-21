import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

/**
 * HTTP 客户端服务
 * 提供通用的 HTTP 请求能力
 */
@Injectable()
export class HttpService {
  private readonly logger = new Logger(HttpService.name);
  private readonly httpClient: AxiosInstance;
  private readonly timeout: number;

  constructor(private readonly configService: ConfigService) {
    // 从环境变量读取配置
    this.timeout = this.configService.get<number>(
      'HTTP_CLIENT_TIMEOUT',
      10000, // 默认 10 秒超时
    );

    this.logger.log(`初始化 HTTP 客户端，超时设置: ${this.timeout}ms`);

    // 创建 axios 实例
    this.httpClient = axios.create({
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // 请求拦截器
    this.httpClient.interceptors.request.use(
      (config) => {
        this.logger.log(`发送请求: ${config.method?.toUpperCase()} ${config.url}`);
        this.logger.log(`发送请求体: ${config.method?.toUpperCase()} ${JSON.stringify(config)}`);
        return config;
      },
      (error) => {
        this.logger.error('请求错误:', error);
        return Promise.reject(error);
      },
    );

    // 响应拦截器
    this.httpClient.interceptors.response.use(
      (response) => {
        this.logger.log(`收到响应: ${response.status} ${response.config.url}`);
        return response;
      },
      (error) => {
        this.logger.error('响应错误:', error.message);
        return Promise.reject(error);
      },
    );
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
