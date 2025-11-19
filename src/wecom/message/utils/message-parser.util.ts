import { EnterpriseMessageCallbackDto, isTextPayload } from '../dto/message-callback.dto';
import { ScenarioType } from '@agent';

/**
 * 消息解析工具类
 * 提供消息数据的解析和转换功能
 */
export class MessageParser {
  /**
   * 解析消息数据
   * 提取文本内容和基本信息，用于后续处理
   */
  static parse(messageData: EnterpriseMessageCallbackDto) {
    // 提取文本内容（优先使用 pureText，不含 @ 信息）
    const content = isTextPayload(messageData.messageType, messageData.payload)
      ? messageData.payload.pureText || messageData.payload.text
      : '';

    // 根据 imRoomId 是否有值来判断是否为群聊
    const isRoom = !!messageData.imRoomId;

    // 企业级接口 v2：使用回调数据中的 imContactId 字段（私聊时有值）
    const imContactId = isRoom ? undefined : messageData.imContactId;

    return {
      token: messageData.token,
      messageId: messageData.messageId,
      messageType: messageData.messageType,
      content,
      roomId: messageData.imRoomId, // 群聊的系统 room ID（仅群聊消息有值）
      roomName: messageData.roomName, // 群聊名称（仅群聊消息有值）
      roomWecomChatId: messageData.roomWecomChatId, // 群聊的企微 chatId（仅群聊消息有值）
      isRoom,
      chatId: messageData.chatId,
      imBotId: messageData.imBotId, // 托管账号的系统wxid（企业级接口 v2）
      imContactId, // 客户的系统wxid（企业级接口 v2，私聊时使用）
      imRoomId: messageData.imRoomId, // 群聊的系统wxid（企业级接口 v2，群聊时使用）
      botWxid: messageData.imBotId, // 兼容字段
      botId: messageData.botId,
      isSelf: messageData.isSelf,
      timestamp: parseInt(messageData.timestamp),
      payload: messageData.payload,
      contactType: messageData.contactType,
      contactName: messageData.contactName,
      externalUserId: messageData.externalUserId,
      coworker: messageData.coworker,
      avatar: messageData.avatar,
      _apiType: messageData._apiType, // 传递 API 类型标记（小组级 or 企业级）
    };
  }

  /**
   * 提取消息文本内容
   */
  static extractContent(messageData: EnterpriseMessageCallbackDto): string {
    return isTextPayload(messageData.messageType, messageData.payload)
      ? messageData.payload.pureText || messageData.payload.text
      : '';
  }

  /**
   * 判断消息场景
   * 当前业务只有候选人私聊咨询这一个场景，预留 messageData 以便未来扩展
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static determineScenario(_messageData?: EnterpriseMessageCallbackDto): ScenarioType {
    return ScenarioType.CANDIDATE_CONSULTATION;
  }
}
