/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from './core/http';
import { ConversationModule } from './common/conversation';
import { AgentModule } from './agent';
import { CustomerModule } from './modules/customer/customer.module';
import { MessageModule } from './modules/message/message.module';
import { MessageSenderModule } from './modules/message-sender/message-sender.module';
import { ChatModule } from './modules/chat/chat.module';
import { RoomModule } from './modules/room/room.module';
import { UserModule } from './modules/user/user.module';
import { BotModule } from './modules/bot/bot.module';
import { ContactModule } from './modules/contact/contact.module';

/**
 * 应用根模块
 *
 * 采用分层架构设计：
 * - Core Layer (核心层): 基础设施服务
 * - Common Layer (共享层): 跨模块共享的通用能力
 * - Agent Layer (AI层): AI Agent 集成
 * - Modules Layer (业务模块层): 各业务功能模块
 *
 * 目录结构: src/
 *   ├── core/              - 核心基础设施（HTTP、日志等）
 *   ├── common/            - 共享模块（会话管理、工具类等）
 *   ├── agent/             - AI Agent 集成
 *   └── modules/           - 业务模块
 *       ├── customer/      - 客户管理
 *       ├── room/          - 群聊管理
 *       ├── user/          - 用户管理
 *       ├── bot/           - 机器人管理
 *       ├── contact/       - 联系人管理
 *       ├── message/       - 消息处理
 *       ├── message-sender/- 消息发送
 *       └── chat/          - 聊天会话
 */
@Module({
  imports: [
    // 全局配置模块 - 支持多环境配置
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        `.env.${process.env.NODE_ENV || 'development'}`,
        '.env',
      ],
      // 允许环境变量覆盖 .env 文件中的值
      expandVariables: true,
    }),

    // 核心层 (Core Layer)
    HttpModule, // HTTP 客户端服务

    // 共享层 (Common Layer)
    ConversationModule, // 会话管理（跨模块共享）

    // AI 层 (Agent Layer)
    AgentModule, // AI Agent 服务集成

    // 业务模块层 (Modules Layer)
    CustomerModule, // 客户关系管理
    RoomModule, // 群聊管理
    UserModule, // 企业成员管理
    BotModule, // 机器人管理
    ContactModule, // 联系人管理
    MessageModule, // 消息处理
    MessageSenderModule, // 消息发送
    ChatModule, // 会话管理
  ],
})
export class AppModule {}
