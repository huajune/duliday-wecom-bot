import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConversationService } from './conversation.service';

/**
 * 会话管理模块
 * 提供通用的会话历史管理能力
 */
@Module({
  imports: [ConfigModule],
  providers: [ConversationService],
  exports: [ConversationService],
})
export class ConversationModule {}
