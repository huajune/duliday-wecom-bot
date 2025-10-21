/**
 * 消息内容部分
 */
export interface MessagePart {
  type: 'text' | 'image' | 'file';
  text?: string;
  imageUrl?: string;
  fileUrl?: string;
}

/**
 * 通用消息格式（UI Message）
 */
export interface MessageDto {
  role: 'user' | 'assistant' | 'system';
  parts: MessagePart[];
}

/**
 * 简单消息格式
 */
export interface SimpleMessageDto {
  role: 'user' | 'assistant' | 'system';
  content: string;
}
