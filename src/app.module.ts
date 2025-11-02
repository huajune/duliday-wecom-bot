/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule, RedisModule } from './core';
import { AgentModule } from './agent';
import { WecomModule } from './wecom/wecom.module';
import { SpongeModule } from './sponge/sponge.module';
import { AnalyticsModule } from './analytics/analytics.module';

/**
 * 应用根模块
 *
 * 采用扁平化 DDD 架构设计：
 * - Core Layer (核心层): 技术基础设施（水平分层）
 * - Business Domains (业务域): 各业务领域（垂直分层）
 *
 * 目录结构: src/
 *   ├── core/              - 核心技术层（完全扁平化）
 *   │   ├── client-http/   - 客户端 HTTP 工具
 *   │   ├── response/      - 响应处理（拦截器、过滤器）
 *   │   ├── redis/         - Redis 缓存服务
 *   │   └── config/        - 配置管理
 *   │
 *   ├── agent/             - AI Agent 业务域
 *   ├── wecom/             - 企业微信业务域
 *   ├── sponge/            - 海绵系统业务域（骨架）
 *   └── analytics/         - 数据分析业务域（骨架）
 */
@Module({
  imports: [
    // ==================== 全局配置 ====================
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${process.env.NODE_ENV || 'development'}`, '.env'],
      expandVariables: true,
    }),

    // ==================== 核心层 (Core Layer) ====================
    HttpModule, // HTTP 客户端服务
    RedisModule, // Redis 缓存服务（全局）

    // ==================== 业务域 (Business Domains) ====================
    AgentModule, // AI Agent 业务域
    WecomModule, // 企业微信业务域
    SpongeModule, // 海绵系统业务域（骨架）
    AnalyticsModule, // 数据分析业务域（骨架）
  ],
})
export class AppModule {}
