import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MessageController } from './message.controller';
import { MessageService } from './message.service';
import { AgentModule } from '@agent';
import { ConversationModule } from '@common/conversation';
import { MessageSenderModule } from '@modules/message-sender/message-sender.module';

/**
 * 消息处理模块
 * 负责接收、解析消息并触发 AI 自动回复
 */
@Module({
  imports: [ConfigModule, AgentModule, ConversationModule, MessageSenderModule],
  controllers: [MessageController],
  providers: [MessageService],
  exports: [MessageService],
})
export class MessageModule {}
