import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatRequest, ChatResponse } from './agent-types';

/**
 * Agent logging utility
 * Handles request and response logging
 */
export class AgentLogger {
  constructor(
    private readonly logger: Logger,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Log chat request
   */
  logRequest(conversationId: string, request: ChatRequest): void {
    const toolsCount = request.allowedTools?.length || 0;
    this.logger.log(
      `[Request] conversation:${conversationId}, messages:${request.messages.length}, tools:${toolsCount}`,
    );
  }

  /**
   * Log chat response
   */
  logResponse(conversationId: string, response: ChatResponse): void {
    const messageCount = response.messages?.length || 0;
    const usedTools = response.tools?.used || [];
    const toolsStr = usedTools.length > 0 ? usedTools.join(', ') : 'none';

    // 记录响应概览
    this.logger.log(
      `[Response] conversation:${conversationId}, messages:${messageCount}, usedTools:${toolsStr}`,
    );

    // 记录完整的响应体结构
    try {
      const responseJson = JSON.stringify(response, null, 2);
      const maxLength = 2000; // 限制最大长度避免日志过长
      const preview =
        responseJson.length > maxLength
          ? `${responseJson.substring(0, maxLength)}...\n[响应体过长，已截断。完整长度: ${responseJson.length} 字符]`
          : responseJson;

      this.logger.log(`[Response Body] conversation:${conversationId}\n${preview}`);
    } catch (error) {
      this.logger.error(`[Response Body] 序列化失败: ${error.message}`);
    }

    // 记录 Agent 返回的消息内容（简洁版）
    if (response.messages && response.messages.length > 0) {
      response.messages.forEach((msg, index) => {
        // UIMessage 使用 parts 数组，需要提取文本内容
        let content = '';
        if ('parts' in msg && msg.parts) {
          content = msg.parts.map((part) => part.text).join('');
        } else if ('content' in msg) {
          content = (msg as any).content || '';
        }

        const preview = content.length > 200 ? `${content.substring(0, 200)}...` : content;
        const fullLength = content.length;
        this.logger.log(
          `[Response Content ${index + 1}/${messageCount}] conversation:${conversationId}, ` +
            `length:${fullLength}, content: ${preview}`,
        );
      });
    }
  }
}
