import { Injectable, Logger } from '@nestjs/common';
import { ApiClientService } from '../api-client/api-client.service';
import { CreateBroadcastDto } from './dto/create-broadcast.dto';

@Injectable()
export class CustomerService {
  private readonly logger = new Logger(CustomerService.name);

  constructor(private readonly apiClientService: ApiClientService) {}

  /**
   * 获取客户列表
   */
  async getCustomerList(
    token: string,
    wecomUserId?: string,
    imBotId?: string,
    coworker?: boolean,
    current?: number,
    pageSize?: number,
    includeStranger?: boolean,
    seq?: string,
    friendshipStatus?: number,
  ) {
    try {
      const apiUrl = 'https://stride-bg.dpclouds.com/stream-api/api/v2/customer/list';

      const params: any = { token };

      if (wecomUserId) params.wecomUserId = wecomUserId;
      if (imBotId) params.imBotId = imBotId;
      if (coworker !== undefined) params.coworker = coworker;
      if (current !== undefined) params.current = current;
      if (pageSize !== undefined) params.pageSize = pageSize;
      if (includeStranger !== undefined) params.includeStranger = includeStranger;
      if (seq) params.seq = seq;
      if (friendshipStatus !== undefined) params.friendshipStatus = friendshipStatus;

      const result = await this.apiClientService.callGetApi(apiUrl, params);

      this.logger.log('获取客户列表成功');
      return result;
    } catch (error) {
      this.logger.error('获取客户列表失败:', error);
      throw error;
    }
  }

  /**
   * 获取客户详情
   */
  async getCustomerDetail(token: string, customerId: string) {
    try {
      const apiUrl = 'https://stride-bg.dpclouds.com/stream-api/api/v2/customer/detail';

      const params = {
        token,
        customerId,
      };

      const result = await this.apiClientService.callGetApi(apiUrl, params);

      this.logger.log(`获取客户详情成功: ${customerId}`);
      return result;
    } catch (error) {
      this.logger.error('获取客户详情失败:', error);
      throw error;
    }
  }

  /**
   * 创建群发消息
   */
  async createBroadcast(data: CreateBroadcastDto) {
    try {
      const apiUrl = 'https://stride-bg.dpclouds.com/stream-api/message/send';

      const result = await this.apiClientService.callPostApi(apiUrl, data);

      this.logger.log('创建群发消息成功');
      return result;
    } catch (error) {
      this.logger.error('创建群发消息失败:', error);
      throw error;
    }
  }

  /**
   * 获取群列表(不包含成员信息)
   */
  async getRoomSimpleList(token: string, current: number, pageSize: number, wxid?: string) {
    try {
      const apiUrl = 'https://stride-bg.dpclouds.com/stream-api/room/simpleList';

      const params: any = {
        token,
        current,
        pageSize,
      };

      if (wxid) {
        params.wxid = wxid;
      }

      const result = await this.apiClientService.callGetApi(apiUrl, params);

      this.logger.log('获取群列表成功');
      return result;
    } catch (error) {
      this.logger.error('获取群列表失败:', error);
      throw error;
    }
  }

  /**
   * 发送消息
   */
  async sendMessage(data: any) {
    try {
      const apiUrl = 'https://stride-bg.dpclouds.com/stream-api/message/send';

      const result = await this.apiClientService.callPostApi(apiUrl, data);

      this.logger.log('发送消息成功');
      return result;
    } catch (error) {
      this.logger.error('发送消息失败:', error);
      throw error;
    }
  }

  /**
   * 获取企业成员列表
   */
  async getUserList(token: string, current?: number, pageSize?: number) {
    try {
      const apiUrl = 'https://stride-bg.dpclouds.com/stream-api/api/v1/user/list';

      const params: any = { token };

      if (current !== undefined) params.current = current;
      if (pageSize !== undefined) params.pageSize = pageSize;

      const result = await this.apiClientService.callGetApi(apiUrl, params);

      this.logger.log('获取企业成员列表成功');
      return result;
    } catch (error) {
      this.logger.error('获取企业成员列表失败:', error);
      throw error;
    }
  }
}
