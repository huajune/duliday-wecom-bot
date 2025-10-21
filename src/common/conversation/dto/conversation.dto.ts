/**
 * 创建会话 DTO
 */
export interface CreateConversationDto {
  fromUser: string;
  roomId?: string;
  isRoom?: boolean;
}

/**
 * 会话统计信息
 */
export interface ConversationStatsDto {
  conversationId: string;
  messageCount: number;
  lastActivity: Date | null;
  isActive: boolean;
}
