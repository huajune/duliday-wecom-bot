import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { CustomerService } from './customer.service';
import { CreateBroadcastDto } from './dto/create-broadcast.dto';

@Controller('customer')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  /**
   * 获取客户列表(v2)
   * 访问: GET http://localhost:3000/customer/v2/list
   */
  @Get('v2/list')
  async getCustomerListV2(
    @Query('token') token: string,
    @Query('wecomUserId') wecomUserId?: string,
    @Query('imBotId') imBotId?: string,
    @Query('coworker') coworker?: boolean,
    @Query('current') current?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return await this.customerService.getCustomerListV2(
      token,
      wecomUserId,
      imBotId,
      coworker,
      current,
      pageSize,
    );
  }

  /**
   * 获取群列表(不包含成员信息)
   * 访问: GET http://localhost:3000/customer/room/simpleList
   */
  @Get('room/simpleList')
  async getRoomSimpleList(
    @Query('token') token: string,
    @Query('current') current: number,
    @Query('pageSize') pageSize: number,
    @Query('wxid') wxid?: string,
  ) {
    return await this.customerService.getRoomSimpleList(token, current, pageSize, wxid);
  }

  /**
   * 获取企业成员列表
   * 访问: GET http://localhost:3000/customer/user/list
   */
  @Get('user/list')
  async getUserList(
    @Query('token') token: string,
    @Query('current') current?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return await this.customerService.getUserList(token, current, pageSize);
  }

  /**
   * 获取企业成员列表(v1)
   * 访问: GET http://localhost:3000/customer/user/v1/list
   */
  @Get('user/v1/list')
  async getUserListV1(
    @Query('token') token: string,
    @Query('current') current?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return await this.customerService.getUserListV1(token, current, pageSize);
  }

  /**
   * 创建群发消息
   * 访问: POST http://localhost:3000/customer/broadcast/create
   */
  @Post('broadcast/create')
  async createBroadcast(@Body() body: CreateBroadcastDto) {
    return await this.customerService.createBroadcast(body);
  }

  /**
   * 发送消息
   * 访问: POST http://localhost:3000/customer/message/send
   */
  @Post('message/send')
  async sendMessage(@Body() body: Record<string, any>) {
    return await this.customerService.sendMessage(body);
  }
}
