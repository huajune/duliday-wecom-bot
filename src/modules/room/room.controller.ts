import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { RoomService } from './room.service';

/**
 * 群聊管理控制器
 * 提供群聊列表查询、群成员管理、群聊加好友等接口
 */
@Controller('room')
export class RoomController {
  constructor(private readonly roomService: RoomService) {}

  /**
   * 获取群列表（简单版，不包含成员信息）
   * @description 查询群聊列表，不返回成员详情，查询速度更快
   * @example GET /room/simple-list?token=xxx&current=0&pageSize=10
   */
  @Get('simple-list')
  async getRoomSimpleList(
    @Query('token') token: string,
    @Query('current') current: number,
    @Query('pageSize') pageSize: number,
    @Query('wxid') wxid?: string,
  ) {
    return await this.roomService.getRoomSimpleList(token, current, pageSize, wxid);
  }

  /**
   * 获取群列表（完整版，包含成员信息）
   * @description 查询群聊列表，包含群成员详细信息
   * @example GET /room/list?token=xxx&current=0&pageSize=10
   */
  @Get('list')
  async getRoomList(
    @Query('token') token: string,
    @Query('current') current: number,
    @Query('pageSize') pageSize: number,
    @Query('wxid') wxid?: string,
  ) {
    return await this.roomService.getRoomList(token, current, pageSize, wxid);
  }

  /**
   * 加入群聊
   * @description 将联系人加入到指定群聊
   * @example POST /room/addMember
   */
  @Post('addMember')
  async addMember(
    @Body() body: { token: string; botUserId: string; contactWxid: string; roomWxid: string },
  ) {
    return await this.roomService.addMember(body);
  }

  /**
   * 群聊加好友
   * @description 在群聊中向成员发送好友申请
   * @example POST /room/add-friend
   */
  @Post('add-friend')
  async addFriendFromRoom(
    @Body()
    body: {
      token: string;
      roomId: string;
      contactId: string;
      remark?: string;
      helloMsg: string;
      extraInfo?: string;
      userId: string;
    },
  ) {
    return await this.roomService.addFriendFromRoom(body);
  }

  /**
   * 加入群聊事件回调
   * @description 接收加入群聊事件的回调通知
   * @example POST /room/joined
   */
  @Post('joined')
  async handleJoinedCallback(
    @Body()
    body: {
      token: string;
      botUserId: string;
      contactWxid: string;
      roomWxid: string;
      status: string;
      timestamp: number;
    },
  ) {
    return await this.roomService.handleJoinedCallback(body);
  }
}
