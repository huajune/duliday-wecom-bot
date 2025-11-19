import { Injectable, Logger } from '@nestjs/common';
import {
  EnterpriseMessageCallbackDto,
  MessageSource,
  MessageType,
  getMessageSourceDescription,
} from '../dto/message-callback.dto';
import { MessageParser } from '../utils/message-parser.util';

/**
 * 消息过滤结果
 */
export interface FilterResult {
  pass: boolean; // 是否通过过滤
  reason?: string; // 过滤原因（未通过时）
  content?: string; // 提取的消息内容（通过时）
  details?: any; // 额外的详细信息
}

/**
 * 消息过滤服务
 * 负责对接收到的消息进行各种过滤检查
 * 只处理：私聊、用户发送、手机推送、文本消息、非空内容
 *
 * 黑名单规则：
 * - 企业级消息：排除特定 groupId (691d3b171535fed6bcc94f66)
 * - 小组级消息：不应用 groupId 黑名单，允许通过
 */
@Injectable()
export class MessageFilterService {
  private readonly logger = new Logger(MessageFilterService.name);

  /**
   * 验证消息是否应该被处理
   * 返回过滤结果，包含是否通过和原因
   */
  validate(messageData: EnterpriseMessageCallbackDto): FilterResult {
    // 1. 拦截机器人自己发送的消息
    if (messageData.isSelf === true) {
      this.logger.log(`[过滤-自己发送] 跳过机器人自己发送的消息 [${messageData.messageId}]`);
      return {
        pass: false,
        reason: 'self-message',
      };
    }

    // 2. 只处理手机推送的消息（真实用户发送）
    const sourceDescription = getMessageSourceDescription(messageData.source);
    if (messageData.source !== MessageSource.MOBILE_PUSH) {
      this.logger.log(
        `[过滤-消息来源] 跳过非目标来源的消息 [${messageData.messageId}], source=${messageData.source}(${sourceDescription}), 期望=${MessageSource.MOBILE_PUSH}(${getMessageSourceDescription(MessageSource.MOBILE_PUSH)})`,
      );
      return {
        pass: false,
        reason: 'invalid-source',
        details: {
          actual: messageData.source,
          actualDescription: sourceDescription,
          expected: MessageSource.MOBILE_PUSH,
          expectedDescription: getMessageSourceDescription(MessageSource.MOBILE_PUSH),
        },
      };
    }

    // 3. 过滤企业级特定 groupId 的消息（仅对企业级消息生效，不影响小组级消息）
    const isEnterpriseMessage = messageData._apiType !== 'group';
    if (isEnterpriseMessage && messageData.groupId === '691d3b171535fed6bcc94f66') {
      this.logger.log(
        `[过滤-企业级分组] 跳过特定企业级分组的消息 [${messageData.messageId}], groupId=${messageData.groupId}, orgId=${messageData.orgId}`,
      );
      return {
        pass: false,
        reason: 'blocked-enterprise-group',
        details: {
          groupId: messageData.groupId,
          orgId: messageData.orgId,
          apiType: messageData._apiType || 'enterprise',
        },
      };
    }

    // 4. 暂时跳过群聊消息
    const isRoom = !!messageData.imRoomId;
    if (isRoom) {
      this.logger.log(
        `[过滤-群聊] 暂时跳过群聊消息 [${messageData.messageId}], roomId=${messageData.imRoomId}`,
      );
      return {
        pass: false,
        reason: 'room-message',
        details: {
          roomId: messageData.imRoomId,
          roomName: messageData.roomName,
        },
      };
    }

    // 5. 只处理文本消息
    if (messageData.messageType !== MessageType.TEXT) {
      this.logger.log(
        `[过滤-非文本] 跳过非文本消息 [${messageData.messageId}], messageType=${messageData.messageType}`,
      );
      return {
        pass: false,
        reason: 'non-text-message',
        details: {
          messageType: messageData.messageType,
        },
      };
    }

    // 6. 检查消息内容是否为空
    const content = MessageParser.extractContent(messageData);
    if (!content || content.trim().length === 0) {
      this.logger.log(`[过滤-空内容] 跳过空内容消息 [${messageData.messageId}]`);
      return {
        pass: false,
        reason: 'empty-content',
      };
    }

    // 全部通过，返回提取的内容
    return {
      pass: true,
      content,
    };
  }

  /**
   * 检查消息是否 @ 了机器人
   * 注意：此方法为未来群聊 @ 触发功能预留，当实现群聊场景时会用到
   */
  checkMentioned(messageData: EnterpriseMessageCallbackDto, botWxid: string): boolean {
    // 检查是否为文本消息
    if (messageData.messageType !== MessageType.TEXT) {
      return false;
    }

    const payload = messageData.payload as any;

    // 检查 payload 中是否有 mention 字段
    if (!payload.mention || !Array.isArray(payload.mention)) {
      return false;
    }

    // 检查 mention 列表中是否包含机器人的 wxid 或者是否 @all
    return payload.mention.includes(botWxid) || payload.mention.includes('@all');
  }
}
