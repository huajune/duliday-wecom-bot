import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';

/**
 * 发送消息 DTO
 */
export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  token: string; // 托管平台的 token

  @IsString()
  @IsNotEmpty()
  targetId: string; // 接收者 ID（用户或群组）

  @IsString()
  @IsNotEmpty()
  content: string; // 消息内容

  @IsString()
  @IsOptional()
  messageType?: string; // 消息类型，默认为文本消息

  @IsObject()
  @IsOptional()
  metadata?: any; // 额外的元数据
}

/**
 * 消息接收回调数据结构（企微机器人托管平台）
 * 参考文档: https://s.apifox.cn/acec6592-fec1-443b-8563-10c4a10e64c4/315431403e0
 */
export interface IncomingMessageData {
  data?: {
    messageId: string; // 消息唯一标识
    chatId: string; // 会话 ID
    token: string; // 小组级 token
    botId: string; // 机器人账号 ID
    botWxid: string; // 机器人的系统微信号
    botWeixin: string; // 机器人的员工 ID
    contactName: string; // 客户昵称
    contactId: string; // 客户系统微信号
    externalUserId: string; // IM 联系人 ID
    type: number; // 消息类型: 0-未知, 1-文件, 2-名片, 3-联系人, 4-聊天记录, 5-表情, 6-图片, 7-文本, 8-位置, 9-小程序等
    timestamp: number; // 消息时间戳
    payload: any; // 消息内容详情（根据 type 不同而不同）
    contactType: number; // 客户类型
    isSelf: boolean; // 是否为机器人自己发送的消息
    mentionSelf?: boolean; // 是否 @ 了机器人（群聊中）
    roomId?: string; // 群聊 ID（群聊消息时存在）
    roomName?: string; // 群聊名称（群聊消息时存在）
  };

  // 兼容旧版本的字段（如果直接传递顶层字段）
  token?: string;
  msgId?: string;
  messageId?: string;
  fromUser?: string;
  contactId?: string;
  content?: string;
  messageType?: string | number;
  type?: number;
  timestamp?: number;
  roomId?: string;
  isRoom?: boolean;
  chatId?: string;
  botWxid?: string;
  isSelf?: boolean;
  mentionSelf?: boolean;
  payload?: any;

  [key: string]: any; // 其他字段
}
