import { IsString, IsNotEmpty, IsOptional, IsNumber, IsObject } from 'class-validator';

/**
 * 消息类型枚举
 */
export enum MessageType {
  TEXT = 0, // 文本消息
  IMAGE = 1, // 图片消息
  LINK = 2, // 网页链接
  FILE = 3, // 文件消息
  MINIPROGRAM = 4, // 小程序消息
  VIDEO = 5, // 视频消息
  VIDEO_ACCOUNT = 7, // 视频号消息
  VOICE = 8, // 语音消息
  EMOJI = 9, // 表情消息
  LOCATION = 10, // 位置消息
}

/**
 * 文本消息 payload
 */
export interface TextMessagePayload {
  text: string; // 消息内容
  mention?: string[]; // @人的wxid列表, @all 可以@所有人
  quoteMessageId?: string; // 被引用的消息id
}

/**
 * 图片消息 payload
 */
export interface ImageMessagePayload {
  url: string; // 图片地址
  size?: number; // 图片大小
}

/**
 * 链接消息 payload
 */
export interface LinkMessagePayload {
  sourceUrl: string; // 跳转地址
  title: string; // 标题
  summary: string; // 描述
  imageUrl: string; // 封面地址
}

/**
 * 文件消息 payload
 */
export interface FileMessagePayload {
  name: string; // 文件名（需要带后缀）
  url: string; // 文件地址
  size?: number; // 文件大小
}

/**
 * 视频消息 payload
 */
export interface VideoMessagePayload {
  url: string; // 视频地址
}

/**
 * 语音消息 payload
 */
export interface VoiceMessagePayload {
  voiceUrl: string; // 语音地址
  duration?: number; // 语音时长（秒）
}

/**
 * 表情消息 payload
 */
export interface EmojiMessagePayload {
  imageUrl: string; // 图片地址
}

/**
 * 位置消息 payload
 */
export interface LocationMessagePayload {
  accuracy: number; // 精确度，默认为15
  address: string; // 地址描述
  latitude: number; // 纬度，北纬为正数
  longitude: number; // 经度，东经为正数
  name: string; // 地址名
}

/**
 * 小程序消息 payload
 */
export interface MiniProgramMessagePayload {
  appid: string; // 小程序原始ID
  username: string; // 小程序ID
  title: string; // 标题
  thumbUrl: string; // 封面图地址
  pagePath: string; // 跳转地址
  description: string; // 描述
  iconUrl?: string; // icon地址
}

/**
 * 视频号消息 payload
 */
export interface VideoAccountMessagePayload {
  avatarUrl: string; // 头像地址
  nickname: string; // 昵称
  feedType: number; // 未知，目前固定为4
  description: string; // 描述
  coverUrl: string; // 封面地址
  extras: string; // 未知，请使用收到的字段信息
  url: string; // 视频号地址
  thumbUrl: string; // 缩略图地址
}

/**
 * 消息 payload 联合类型
 */
export type MessagePayload =
  | TextMessagePayload
  | ImageMessagePayload
  | LinkMessagePayload
  | FileMessagePayload
  | VideoMessagePayload
  | VoiceMessagePayload
  | EmojiMessagePayload
  | LocationMessagePayload
  | MiniProgramMessagePayload
  | VideoAccountMessagePayload;

/**
 * 发送消息 DTO（符合企微托管平台 API 规范）
 */
export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  token: string; // 小组级token

  @IsString()
  @IsNotEmpty()
  chatId: string; // 对话ID（无论是群聊、私聊都是可以通过对话ID进行获取并发送消息）

  @IsNumber()
  @IsNotEmpty()
  messageType: MessageType; // 消息类型（0-10）

  @IsObject()
  @IsNotEmpty()
  payload: MessagePayload; // 消息内容

  @IsString()
  @IsOptional()
  externalRequestId?: string; // 回调时原样返回
}

/**
 * 发送消息响应
 */
export interface SendMessageResponse {
  code: number; // 返回码
  data: {
    requestId: string; // 返回的requestId
  };
}
