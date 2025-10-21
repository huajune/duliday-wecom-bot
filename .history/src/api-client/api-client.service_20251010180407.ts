import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

@Injectable()
export class ApiClientService {
  private readonly logger = new Logger(ApiClientService.name);
  private readonly httpClient: AxiosInstance;

  constructor() {
    // 创建 axios 实例
    this.httpClient = axios.create({
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // 请求拦截器
    this.httpClient.interceptors.request.use(
      (config) => {
        this.logger.log(`发送请求: ${config.method?.toUpperCase()} ${config.url}`);
        this.logger.log(`发送请求: ${JSON.stringify(config)}`);
        this.logger.log(`发送请求: ${JSON.stringify( this.httpClient)}`);
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
  async callGetApi(url: string, params?: any) {
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
  async callPostApi(url: string, data?: any) {
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
