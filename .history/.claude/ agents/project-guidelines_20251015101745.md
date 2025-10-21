---
name: project-guidelines
role: system
model: sonnet
visibility: global
description: >
  定义项目内代码开发与协作的统一规范，包括 TypeScript 编码规则、
  NestJS 最佳实践、Prettier 与 ESLint 风格约束、Git 提交规范等。
  Claude Code 在编写或修改项目代码时应严格遵循本指南。

tags:
  - coding-style
  - nestjs
  - typescript
  - lint
  - prettier

priority: medium
---

# Claude Code Agent 工作说明书与编码规范

> 本文档为 Claude Code Agent 执行编码任务时提供完整的项目规范、最佳实践和开发指南

**文档版本**: v1.0
**最后更新**: 2025-10-14
**适用范围**: DuLiDay 企业微信服务项目

---

## 目录

- [1. 项目概述](#1-项目概述)
- [2. 架构理解要求](#2-架构理解要求)
- [3. NestJS 最佳实践](#3-nestjs-最佳实践)
- [4. TypeScript 编码规范](#4-typescript-编码规范)
- [5. 代码风格统一](#5-代码风格统一)
- [6. 设计模式与原则](#6-设计模式与原则)
- [7. 开发工作流程](#7-开发工作流程)
- [8. 质量保证清单](#8-质量保证清单)
- [9. 常见开发场景](#9-常见开发场景)
- [10. 禁止事项](#10-禁止事项)

---

## 1. 项目概述

### 1.1 核心定位

**DuLiDay 企业微信服务** 是一个基于 NestJS 的**中间层服务**，扮演以下角色：

```
企业微信托管平台 ←→ 本服务 ←→ AI Agent (agent-computer-user)
```

**职责**:
- 接收托管平台的消息回调
- 调用 AI Agent 生成智能回复
- 管理多轮对话上下文
- 封装托管平台 API 能力

### 1.2 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| **NestJS** | 10.3.0 | 后端框架 |
| **TypeScript** | 5.3.3 | 开发语言 |
| **Node.js** | 20.x+ | 运行时 |
| **Axios** | 1.6.2 | HTTP 客户端 |
| **Winston** | 3.11.0 | 日志管理 |
| **class-validator** | 0.14.0 | 参数验证 |
| **Swagger** | 7.1.17 | API 文档 |

### 1.3 分层架构

```
src/
├── core/                    # 核心层：基础设施服务
│   ├── config/             # 配置管理
│   └── http/               # HTTP 客户端
│
├── common/                  # 共享层：跨模块通用能力
│   └── conversation/       # 会话管理
│
├── agent/                   # AI 层：AI Agent 集成
│   ├── agent.service.ts    # AI 对话服务
│   └── agent-config.service.ts
│
└── modules/                 # 业务模块层
    ├── message/            # 消息接收与处理
    ├── message-sender/     # 消息发送
    ├── chat/               # 会话查询
    ├── contact/            # 联系人管理
    ├── room/               # 群聊管理
    ├── customer/           # 客户管理
    ├── bot/                # 机器人管理
    └── user/               # 用户管理
```

**依赖规则**:
- ✅ 业务模块可依赖 Common 和 Core 层
- ✅ 业务模块之间可相互依赖
- ❌ Core 和 Common 层不依赖业务模块
- ✅ 遵循依赖倒置原则

---

## 2. 架构理解要求

### 2.1 必须理解的核心概念

在开始编码前，必须理解以下内容：

#### 2.1.1 依赖注入（DI）

```typescript
// ✅ 正确：通过构造函数注入
@Injectable()
export class MessageService {
  constructor(
    private readonly messageSenderService: MessageSenderService,
    private readonly agentService: AgentService,
    private readonly conversationService: ConversationService,
  ) {}
}

// ❌ 错误：直接实例化
export class MessageService {
  private messageSenderService = new MessageSenderService();  // 不要这样做
}
```

#### 2.1.2 模块化设计

每个功能模块必须包含：

```
feature-module/
├── feature.module.ts        # 模块定义（必需）
├── feature.service.ts       # 业务逻辑（必需）
├── feature.controller.ts    # API 接口（如果需要对外暴露）
└── dto/                     # 数据传输对象（如果有 API）
    ├── create-feature.dto.ts
    └── update-feature.dto.ts
```

#### 2.1.3 会话管理机制

**关键理解**:
- 每个用户/群聊对应一个 `conversationId`
- 会话 ID 生成规则:
  - 私聊: `user_{wxid}`
  - 群聊: `room_{roomId}`
- 会话历史存储在内存中（未来迁移到 Redis）
- 自动管理消息历史（最多 50 条，2 小时超时）

```typescript
// 使用 ConversationService 管理会话
const conversationId = this.conversationService.generateConversationId(
  contactId,
  roomId,
  isRoom,
);

// 获取历史消息
const history = this.conversationService.getHistory(conversationId);

// 添加消息到历史
this.conversationService.addMessage(conversationId, {
  role: 'user',
  content: 'Hello',
});
```

### 2.2 数据流理解

**完整消息处理流程**:

```
1. 企业微信用户发送消息
        ↓
2. 托管平台收到消息并回调 POST /message
        ↓
3. MessageController 接收回调
        ↓
4. MessageService.handleMessage()
        ↓
5. 解析消息数据，生成 conversationId
        ↓
6. ConversationService 获取历史消息
        ↓
7. AgentService.chat() 调用 AI 生成回复
        ↓
8. ConversationService 保存对话历史
        ↓
9. MessageSenderService.sendMessage() 发送回复
        ↓
10. 用户收到 AI 回复
```

---

## 3. NestJS 最佳实践

### 3.1 服务类（Service）编写规范

#### 3.1.1 基本结构

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * 功能模块服务
 * 负责核心业务逻辑处理
 */
@Injectable()
export class FeatureService {
  // 1. Logger 必须是第一个私有属性
  private readonly logger = new Logger(FeatureService.name);

  // 2. 配置项使用 private readonly
  private readonly configValue: string;

  // 3. 构造函数：依赖注入
  constructor(
    private readonly configService: ConfigService,
    private readonly dependencyService: DependencyService,
  ) {
    // 4. 构造函数中初始化配置
    this.configValue = this.configService.get<string>('CONFIG_KEY', 'default');
    this.logger.log('FeatureService 初始化完成');
  }

  // 5. 公共方法在前
  async publicMethod(param: string): Promise<Result> {
    this.logger.log(`执行公共方法: ${param}`);
    try {
      const result = await this.privateMethod(param);
      return { success: true, data: result };
    } catch (error) {
      this.logger.error('公共方法执行失败:', error);
      throw error;
    }
  }

  // 6. 私有方法在后
  private async privateMethod(param: string): Promise<any> {
    // 实现细节
  }
}
```

#### 3.1.2 Logger 使用规范

```typescript
// ✅ 正确的日志记录
this.logger.log('正常操作日志');
this.logger.log(`包含变量的日志: ${value}`);
this.logger.log('复杂对象:', JSON.stringify(object, null, 2));
this.logger.warn('警告信息');
this.logger.error('错误信息:', error.stack || error);
this.logger.debug('调试信息（开发环境）');

// ❌ 错误的日志记录
console.log('不要使用 console.log');  // 禁止
this.logger.log(object);  // 对象会显示 [Object object]，不友好
```

#### 3.1.3 异步方法规范

```typescript
// ✅ 正确：使用 async/await
async fetchData(id: string): Promise<Data> {
  try {
    const result = await this.httpService.get(`/api/data/${id}`);
    return result.data;
  } catch (error) {
    this.logger.error('获取数据失败:', error);
    throw new HttpException('数据获取失败', HttpStatus.INTERNAL_SERVER_ERROR);
  }
}

// ❌ 错误：使用 .then/.catch
fetchData(id: string): Promise<Data> {
  return this.httpService.get(`/api/data/${id}`)
    .then(result => result.data)
    .catch(error => {
      // 不推荐这种写法
    });
}
```

### 3.2 控制器（Controller）编写规范

#### 3.2.1 基本结构

```typescript
import { Controller, Get, Post, Body, Query, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

/**
 * 功能模块控制器
 * 负责处理 HTTP 请求和响应
 */
@Controller('feature')  // 路由前缀
@ApiTags('功能模块')     // Swagger 标签
export class FeatureController {
  constructor(private readonly featureService: FeatureService) {}

  /**
   * 获取资源列表
   */
  @Get()
  @ApiOperation({ summary: '获取列表' })
  @ApiResponse({ status: 200, description: '获取成功' })
  async getList(@Query('page') page: number = 1) {
    return this.featureService.getList(page);
  }

  /**
   * 创建资源
   */
  @Post()
  @ApiOperation({ summary: '创建资源' })
  @ApiResponse({ status: 201, description: '创建成功' })
  @ApiResponse({ status: 400, description: '参数错误' })
  async create(@Body() dto: CreateFeatureDto) {
    return this.featureService.create(dto);
  }

  /**
   * 获取单个资源
   */
  @Get(':id')
  @ApiOperation({ summary: '获取详情' })
  async getById(@Param('id') id: string) {
    return this.featureService.getById(id);
  }
}
```

#### 3.2.2 路由命名规范

```typescript
// ✅ 正确：使用 RESTful 风格
@Controller('messages')          // 名词复数
@Get()                          // GET /messages
@Post()                         // POST /messages
@Get(':id')                     // GET /messages/:id
@Put(':id')                     // PUT /messages/:id
@Delete(':id')                  // DELETE /messages/:id

// ❌ 错误：使用动词或不规范命名
@Controller('message')          // 应该用复数
@Get('getAll')                  // 不要在路由中使用动词
@Post('sendMessage')            // 不要在路由中使用动词
```

### 3.3 模块（Module）编写规范

```typescript
import { Module } from '@nestjs/common';
import { FeatureController } from './feature.controller';
import { FeatureService } from './feature.service';
import { DependencyModule } from '../dependency/dependency.module';

/**
 * 功能模块
 */
@Module({
  // 1. imports: 导入依赖的模块
  imports: [
    DependencyModule,  // 导入其他模块
  ],

  // 2. controllers: 注册控制器
  controllers: [FeatureController],

  // 3. providers: 注册服务（提供者）
  providers: [FeatureService],

  // 4. exports: 导出服务供其他模块使用
  exports: [FeatureService],
})
export class FeatureModule {}
```

### 3.4 DTO（数据传输对象）编写规范

#### 3.4.1 基本结构

```typescript
import { IsString, IsNotEmpty, IsNumber, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 发送消息 DTO
 */
export class SendMessageDto {
  @ApiProperty({ description: '小组 Token', example: 'group_token_123' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ description: '消息内容', example: '你好，这是一条测试消息' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiProperty({ description: '接收者微信 ID', example: 'wxid_abc123' })
  @IsString()
  @IsNotEmpty()
  toWxid: string;

  @ApiProperty({ description: '消息类型', enum: MessageType, default: MessageType.TEXT })
  @IsEnum(MessageType)
  @IsOptional()
  msgType?: MessageType = MessageType.TEXT;
}

/**
 * 消息类型枚举
 */
export enum MessageType {
  TEXT = 1,      // 文本
  IMAGE = 3,     // 图片
  VOICE = 34,    // 语音
  VIDEO = 43,    // 视频
}
```

#### 3.4.2 验证装饰器使用

```typescript
// 常用验证装饰器
@IsString()              // 字符串
@IsNumber()              // 数字
@IsBoolean()             // 布尔值
@IsEmail()               // 邮箱
@IsEnum(EnumType)        // 枚举
@IsArray()               // 数组
@IsOptional()            // 可选字段
@IsNotEmpty()            // 非空
@MinLength(5)            // 最小长度
@MaxLength(100)          // 最大长度
@Min(0)                  // 最小值
@Max(100)                // 最大值
@Matches(/^[a-z]+$/)     // 正则匹配
```

### 3.5 异常处理规范

```typescript
import { HttpException, HttpStatus } from '@nestjs/common';

// ✅ 推荐：使用 NestJS 内置异常
throw new HttpException('资源未找到', HttpStatus.NOT_FOUND);
throw new HttpException('参数错误', HttpStatus.BAD_REQUEST);
throw new HttpException('未授权', HttpStatus.UNAUTHORIZED);
throw new HttpException('服务器错误', HttpStatus.INTERNAL_SERVER_ERROR);

// ✅ 推荐：使用特定异常类
import { NotFoundException, BadRequestException } from '@nestjs/common';
throw new NotFoundException('用户不存在');
throw new BadRequestException('参数格式错误');

// ✅ 服务层统一异常处理模式
async processData(id: string): Promise<Result> {
  try {
    // 业务逻辑
    const data = await this.fetchData(id);
    return { success: true, data };
  } catch (error) {
    this.logger.error('处理数据失败:', error);

    // 根据错误类型抛出相应异常
    if (error.response?.status === 404) {
      throw new NotFoundException('数据不存在');
    }

    throw new HttpException(
      '数据处理失败',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
```

---

## 4. TypeScript 编码规范

### 4.1 类型定义规范

#### 4.1.1 避免使用 any

```typescript
// ❌ 错误：使用 any
function process(data: any): any {
  return data.value;
}

// ✅ 正确：使用具体类型
interface ProcessData {
  value: string;
  timestamp: number;
}

function process(data: ProcessData): string {
  return data.value;
}

// ✅ 正确：使用泛型
function process<T>(data: T): T {
  return data;
}

// ✅ 如果真的不确定类型，使用 unknown
function process(data: unknown): string {
  if (typeof data === 'object' && data !== null && 'value' in data) {
    return (data as ProcessData).value;
  }
  throw new Error('Invalid data');
}
```

#### 4.1.2 接口 vs 类型别名

```typescript
// ✅ 推荐：使用 interface 定义对象结构
interface User {
  id: string;
  name: string;
  email: string;
}

// ✅ 推荐：使用 type 定义联合类型、交叉类型
type Status = 'pending' | 'approved' | 'rejected';
type Result = Success | Error;

// ✅ 接口命名：以 I 开头（可选，但要保持一致）
interface IAgentProfile {
  model: string;
  temperature: number;
}
```

#### 4.1.3 函数类型定义

```typescript
// ✅ 正确：明确参数和返回值类型
async function sendMessage(
  token: string,
  content: string,
  toWxid: string,
): Promise<SendResult> {
  // 实现
}

// ✅ 正确：可选参数
function fetchData(
  id: string,
  options?: {
    timeout?: number;
    retry?: boolean;
  },
): Promise<Data> {
  // 实现
}

// ✅ 正确：解构参数
async function process({
  token,
  content,
  toWxid,
}: {
  token: string;
  content: string;
  toWxid: string;
}): Promise<Result> {
  // 实现
}
```

### 4.2 命名规范

#### 4.2.1 文件命名

```bash
# ✅ 正确：kebab-case（短横线命名）
agent.service.ts
message-sender.service.ts
create-message.dto.ts
agent-profile.interface.ts

# ❌ 错误
AgentService.ts          # 不要用 PascalCase
agent_service.ts         # 不要用 snake_case
agentService.ts          # 不要用 camelCase
```

#### 4.2.2 类和接口命名

```typescript
// ✅ 正确：PascalCase（大驼峰）
class AgentService {}
class MessageSenderService {}
interface IAgentProfile {}
interface CreateMessageDto {}
enum MessageType {}

// ❌ 错误
class agentService {}     // 不要用 camelCase
class agent_service {}    // 不要用 snake_case
```

#### 4.2.3 变量和函数命名

```typescript
// ✅ 正确：camelCase（小驼峰）
const apiKey = 'xxx';
const maxRetryCount = 3;
const isEnabled = true;

function sendMessage() {}
function getUserById() {}
async function processData() {}

// ❌ 错误
const api_key = 'xxx';         // 不要用 snake_case
const MaxRetryCount = 3;       // 不要用 PascalCase
function SendMessage() {}      // 不要用 PascalCase
```

#### 4.2.4 常量命名

```typescript
// ✅ 正确：UPPER_SNAKE_CASE（大写下划线）
const API_TIMEOUT = 30000;
const MAX_RETRY_COUNT = 3;
const DEFAULT_PAGE_SIZE = 20;

// ✅ 枚举值也使用 UPPER_SNAKE_CASE 或 PascalCase
enum MessageType {
  TEXT = 1,
  IMAGE = 3,
  VOICE = 34,
  VIDEO = 43,
}
```

### 4.3 代码组织规范

#### 4.3.1 导入顺序

```typescript
// 1. Node.js 内置模块
import * as path from 'path';
import * as fs from 'fs';

// 2. 第三方依赖
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

// 3. 项目内部模块（按层级分组）
import { ApiConfigService } from '../../core/config';
import { HttpService } from '../../core/http';
import { ConversationService } from '../../common/conversation';

// 4. 当前模块相对导入
import { CreateMessageDto } from './dto/create-message.dto';
import { MessageType } from './message.types';

// 5. 类型导入（可选：放在最后）
import type { AxiosInstance } from 'axios';
```

#### 4.3.2 类成员顺序

```typescript
@Injectable()
export class ExampleService {
  // 1. 静态属性
  static readonly VERSION = '1.0.0';

  // 2. 实例属性（private readonly 在前）
  private readonly logger = new Logger(ExampleService.name);
  private readonly config: Config;

  // 3. 实例属性（private）
  private cache = new Map<string, any>();

  // 4. 构造函数
  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.config = this.loadConfig();
  }

  // 5. 生命周期钩子（如果有）
  onModuleInit() {
    this.logger.log('模块初始化');
  }

  // 6. 公共方法
  async publicMethod(): Promise<Result> {
    // 实现
  }

  // 7. 保护方法（protected）
  protected protectedMethod(): void {
    // 实现
  }

  // 8. 私有方法
  private privateMethod(): void {
    // 实现
  }
}
```

---

## 5. 代码风格统一

### 5.1 Prettier 配置

项目使用 Prettier 进行代码格式化，配置如下：

```json
{
  "singleQuote": true,          // 使用单引号
  "trailingComma": "all",       // 尾随逗号
  "printWidth": 100,            // 每行最大 100 字符
  "tabWidth": 2,                // 缩进 2 空格
  "semi": true,                 // 语句末尾使用分号
  "arrowParens": "always"       // 箭头函数参数总是使用括号
}
```

### 5.2 代码格式化示例

```typescript
// ✅ 正确：符合 Prettier 规范
const data = {
  name: 'test',
  value: 123,
  items: ['a', 'b', 'c'],
};

const result = await this.service.process({
  param1: 'value1',
  param2: 'value2',
  param3: 'value3',
});

// ✅ 正确：长函数调用自动换行
const response = await this.httpService.post(
  'https://api.example.com/endpoint',
  {
    token: 'xxx',
    content: 'message',
    type: 1,
  },
);
```

### 5.3 注释规范

#### 5.3.1 文件头注释（可选）

```typescript
/**
 * Agent 服务
 *
 * 负责调用 agent-computer-user API，实现 AI 智能对话功能
 *
 * @module agent
 * @author DuLiDay Team
 */
```

#### 5.3.2 类和方法注释

```typescript
/**
 * 消息发送服务
 * 负责调用托管平台 API 发送消息
 */
@Injectable()
export class MessageSenderService {
  /**
   * 发送单条消息
   *
   * @param dto 消息数据
   * @returns 发送结果
   * @throws HttpException 当发送失败时
   */
  async sendMessage(dto: SendMessageDto): Promise<SendResult> {
    // 实现
  }

  /**
   * 群发消息
   *
   * @param dto 群发消息数据，包含多个接收者
   * @returns 群发结果，包含成功和失败的详情
   */
  async broadcastMessage(dto: BroadcastMessageDto): Promise<BroadcastResult> {
    // 实现
  }
}
```

#### 5.3.3 行内注释

```typescript
// ✅ 正确：解释复杂逻辑
// 跳过机器人自己发送的消息，避免死循环
if (isSelf) {
  return;
}

// 限制消息历史数量，防止内存溢出
if (messages.length > this.maxMessagesPerConversation) {
  messages = messages.slice(-this.maxMessagesPerConversation);
}

// ❌ 错误：注释显而易见的代码
// 创建变量
const name = 'test';

// 调用函数
this.service.process();
```

#### 5.3.4 TODO 注释

```typescript
// TODO: 迁移到 Redis 存储
// TODO: 添加错误重试机制
// FIXME: 修复并发场景下的数据竞争问题
// NOTE: 此处逻辑依赖托管平台 API 的特定行为
```

---

## 6. 设计模式与原则

### 6.1 SOLID 原则

#### 6.1.1 单一职责原则（SRP）

每个类只负责一个功能：

```typescript
// ✅ 正确：职责分离
@Injectable()
export class MessageService {
  // 只负责消息处理逻辑
  async handleMessage(data: IncomingMessageData) {
    // 处理逻辑
  }
}

@Injectable()
export class MessageSenderService {
  // 只负责消息发送
  async sendMessage(dto: SendMessageDto) {
    // 发送逻辑
  }
}

// ❌ 错误：职责混合
@Injectable()
export class MessageService {
  async handleMessage(data: IncomingMessageData) {
    // 处理消息
    // 调用 AI
    // 发送回复
    // 记录日志
    // 更新数据库
    // ... 太多职责
  }
}
```

#### 6.1.2 依赖倒置原则（DIP）

依赖抽象而非具体实现：

```typescript
// ✅ 正确：依赖注入
@Injectable()
export class MessageService {
  constructor(
    private readonly agentService: AgentService,  // 依赖接口/抽象
    private readonly senderService: MessageSenderService,
  ) {}
}

// ❌ 错误：直接依赖具体实现
@Injectable()
export class MessageService {
  private agentService = new AgentService();  // 不要这样做
}
```

### 6.2 常用设计模式

#### 6.2.1 策略模式

```typescript
// 定义策略接口
interface IMessageProcessor {
  process(message: IncomingMessageData): Promise<void>;
}

// 具体策略实现
@Injectable()
export class TextMessageProcessor implements IMessageProcessor {
  async process(message: IncomingMessageData): Promise<void> {
    // 处理文本消息
  }
}

@Injectable()
export class ImageMessageProcessor implements IMessageProcessor {
  async process(message: IncomingMessageData): Promise<void> {
    // 处理图片消息
  }
}

// 使用策略
@Injectable()
export class MessageService {
  private processors = new Map<string, IMessageProcessor>();

  constructor(
    private readonly textProcessor: TextMessageProcessor,
    private readonly imageProcessor: ImageMessageProcessor,
  ) {
    this.processors.set('text', textProcessor);
    this.processors.set('image', imageProcessor);
  }

  async handleMessage(message: IncomingMessageData): Promise<void> {
    const processor = this.processors.get(message.type);
    if (processor) {
      await processor.process(message);
    }
  }
}
```

#### 6.2.2 工厂模式

```typescript
@Injectable()
export class ConversationFactory {
  create(type: 'user' | 'room', id: string): string {
    switch (type) {
      case 'user':
        return `user_${id}`;
      case 'room':
        return `room_${id}`;
      default:
        throw new Error('Unknown conversation type');
    }
  }
}
```

---

## 7. 开发工作流程

### 7.1 添加新功能的标准流程

#### 步骤 1: 需求分析

- 明确功能需求和边界
- 确定功能归属的模块层次
- 评估对现有代码的影响

#### 步骤 2: 设计接口

```typescript
// 1. 定义 DTO
export class CreateFeatureDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;
}

// 2. 定义返回类型
export interface FeatureResult {
  id: string;
  name: string;
  createdAt: Date;
}
```

#### 步骤 3: 实现 Service

```typescript
@Injectable()
export class FeatureService {
  private readonly logger = new Logger(FeatureService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async create(dto: CreateFeatureDto): Promise<FeatureResult> {
    this.logger.log(`创建功能: ${dto.name}`);

    try {
      // 实现业务逻辑
      const result = await this.callExternalApi(dto);

      this.logger.log(`功能创建成功: ${result.id}`);
      return result;
    } catch (error) {
      this.logger.error('创建功能失败:', error);
      throw new HttpException('创建失败', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  private async callExternalApi(dto: CreateFeatureDto): Promise<any> {
    // 调用外部 API
  }
}
```

#### 步骤 4: 实现 Controller

```typescript
@Controller('features')
@ApiTags('功能管理')
export class FeatureController {
  constructor(private readonly featureService: FeatureService) {}

  @Post()
  @ApiOperation({ summary: '创建功能' })
  @ApiResponse({ status: 201, description: '创建成功' })
  async create(@Body() dto: CreateFeatureDto) {
    return this.featureService.create(dto);
  }
}
```

#### 步骤 5: 注册模块

```typescript
@Module({
  imports: [HttpModule],
  controllers: [FeatureController],
  providers: [FeatureService],
  exports: [FeatureService],
})
export class FeatureModule {}
```

#### 步骤 6: 测试

```bash
# 运行单元测试
npm run test

# 手动测试 API
curl -X POST http://localhost:8080/features \
  -H "Content-Type: application/json" \
  -d '{"name": "test"}'
```

### 7.2 修改现有功能的流程

#### 步骤 1: 理解现有代码

- 阅读相关服务的实现
- 理解数据流和依赖关系
- 查看相关测试用例

#### 步骤 2: 评估影响范围

- 确定修改点
- 识别依赖此功能的其他模块
- 考虑向后兼容性

#### 步骤 3: 实施修改

```typescript
// ✅ 正确：保持向后兼容
async sendMessage(dto: SendMessageDto, options?: SendOptions) {
  // 添加新参数但设为可选
}

// ❌ 错误：破坏性修改
async sendMessage(dto: NewSendMessageDto) {
  // 修改必需参数会破坏现有调用
}
```

#### 步骤 4: 更新文档和测试

- 更新 JSDoc 注释
- 更新 Swagger 文档
- 添加或修改测试用例
- 更新 README 或相关文档

---

## 8. 质量保证清单

### 8.1 代码提交前检查清单

在提交代码前，必须确认以下事项：

- [ ] **代码格式化**
  ```bash
  npm run format
  ```

- [ ] **代码静态检查**
  ```bash
  npm run lint
  ```

- [ ] **编译通过**
  ```bash
  npm run build
  ```

- [ ] **测试通过**
  ```bash
  npm run test
  ```

- [ ] **类型检查通过**（无 any 类型滥用）

- [ ] **日志记录完整**（关键操作有日志）

- [ ] **错误处理完善**（有 try-catch 和错误日志）

- [ ] **API 文档更新**（Swagger 注解完整）

- [ ] **注释清晰**（复杂逻辑有解释）

- [ ] **没有敏感信息**（API Key、密码等）

### 8.2 代码审查要点

#### 8.2.1 功能性

- 代码是否实现了需求？
- 边界条件是否处理？
- 错误场景是否考虑？

#### 8.2.2 可维护性

- 代码是否易于理解？
- 变量和函数命名是否清晰？
- 是否有必要的注释？

#### 8.2.3 性能

- 是否有明显的性能问题？
- 数据库查询是否优化？
- 是否有不必要的循环或计算？

#### 8.2.4 安全性

- 是否有 SQL 注入风险？
- 用户输入是否验证？
- 敏感数据是否加密？

---

## 9. 常见开发场景

### 9.1 调用托管平台 API

```typescript
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly baseURL: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.baseURL = this.configService.get<string>(
      'STRIDE_API_BASE_URL',
      'https://stride-bg.dpclouds.com',
    );
  }

  /**
   * 获取会话列表
   */
  async getConversationList(params: {
    token: string;
    pageSize?: number;
    iterator?: string;
  }): Promise<any> {
    this.logger.log('获取会话列表');

    try {
      const url = `${this.baseURL}/stream-api/chat/list`;
      const response = await this.httpService.get(url, { params });

      this.logger.log(`获取到 ${response.data?.conversations?.length || 0} 个会话`);
      return response.data;
    } catch (error) {
      this.logger.error('获取会话列表失败:', error);
      throw new HttpException('获取会话列表失败', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
```

### 9.2 调用 AI Agent API

```typescript
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly httpClient: AxiosInstance;

  constructor(
    private readonly configService: ConfigService,
    private readonly conversationService: ConversationService,
  ) {
    const apiKey = this.configService.get<string>('AGENT_API_KEY');
    const baseURL = this.configService.get<string>('AGENT_API_BASE_URL');

    this.httpClient = axios.create({
      baseURL,
      timeout: 60000,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * AI 对话（非流式）
   */
  async chat(params: {
    conversationId: string;
    userMessage: string;
    model?: string;
  }): Promise<ChatResponse> {
    const { conversationId, userMessage, model } = params;

    // 获取历史消息
    const history = this.conversationService.getHistory(conversationId);

    // 添加用户消息到历史
    this.conversationService.addMessage(conversationId, {
      role: 'user',
      content: userMessage,
    });

    try {
      const response = await this.httpClient.post('/chat', {
        model: model || this.defaultModel,
        messages: [
          ...history,
          { role: 'user', content: userMessage },
        ],
        conversation_id: conversationId,
      });

      const assistantMessage = this.extractMessage(response.data);

      // 保存助手回复到历史
      this.conversationService.addMessage(conversationId, {
        role: 'assistant',
        content: assistantMessage,
      });

      return response.data;
    } catch (error) {
      this.logger.error('AI 对话失败:', error);
      throw error;
    }
  }

  private extractMessage(data: any): string {
    // 提取 AI 回复内容
    return data.messages[0]?.parts[0]?.text || '';
  }
}
```

### 9.3 实现消息过滤和路由

```typescript
@Injectable()
export class MessageService {
  /**
   * 处理消息回调
   */
  async handleMessage(messageData: IncomingMessageData) {
    // 1. 过滤：跳过机器人自己的消息
    if (messageData.isSelf) {
      this.logger.log('跳过机器人自己的消息');
      return { success: true };
    }

    // 2. 过滤：只处理文本消息
    if (messageData.messageType !== 7) {
      this.logger.log(`跳过非文本消息，类型: ${messageData.messageType}`);
      return { success: true };
    }

    // 3. 路由：群聊消息处理
    if (messageData.isRoom) {
      return this.handleRoomMessage(messageData);
    }

    // 4. 路由：私聊消息处理
    return this.handlePrivateMessage(messageData);
  }

  /**
   * 处理群聊消息
   */
  private async handleRoomMessage(messageData: IncomingMessageData) {
    // 群聊特殊逻辑（如：只响应 @ 消息）
    if (!messageData.mentionSelf) {
      this.logger.log('群聊消息未 @ 机器人，跳过');
      return { success: true };
    }

    return this.processWithAI(messageData);
  }

  /**
   * 处理私聊消息
   */
  private async handlePrivateMessage(messageData: IncomingMessageData) {
    // 私聊消息处理逻辑
    return this.processWithAI(messageData);
  }
}
```

### 9.4 会话管理

```typescript
// 生成会话 ID
const conversationId = this.conversationService.generateConversationId(
  contactId,
  roomId,
  isRoom,
);

// 获取历史消息
const history = this.conversationService.getHistory(conversationId);

// 添加消息
this.conversationService.addMessage(conversationId, {
  role: 'user',
  content: 'Hello',
});

// 清空会话
this.conversationService.clearConversation(conversationId);

// 获取会话统计
const stats = this.conversationService.getStats(conversationId);
```

---

## 10. 禁止事项

### 10.1 绝对禁止

❌ **禁止在代码中硬编码敏感信息**

```typescript
// ❌ 绝对禁止
const apiKey = 'sk-1234567890abcdef';
const password = 'admin123';
const secretToken = 'my-secret-token';

// ✅ 正确：使用环境变量
const apiKey = this.configService.get<string>('AGENT_API_KEY');
```

❌ **禁止使用 console.log**

```typescript
// ❌ 禁止
console.log('debug info');
console.error('error');

// ✅ 正确：使用 Logger
this.logger.log('debug info');
this.logger.error('error');
```

❌ **禁止直接实例化依赖**

```typescript
// ❌ 禁止
class MyService {
  private otherService = new OtherService();
}

// ✅ 正确：使用依赖注入
@Injectable()
class MyService {
  constructor(private readonly otherService: OtherService) {}
}
```

❌ **禁止滥用 any 类型**

```typescript
// ❌ 禁止
function process(data: any): any {
  return data;
}

// ✅ 正确：使用具体类型
function process(data: ProcessData): Result {
  return { success: true, data };
}
```

### 10.2 强烈不推荐

⚠️ **不推荐同步阻塞操作**

```typescript
// ⚠️ 不推荐
const data = fs.readFileSync('file.txt');

// ✅ 推荐：使用异步
const data = await fs.promises.readFile('file.txt');
```

⚠️ **不推荐在 Service 中直接使用 HTTP 请求库**

```typescript
// ⚠️ 不推荐
import axios from 'axios';

@Injectable()
class MyService {
  async fetchData() {
    return axios.get('https://api.example.com/data');
  }
}

// ✅ 推荐：使用封装的 HttpService
@Injectable()
class MyService {
  constructor(private readonly httpService: HttpService) {}

  async fetchData() {
    return this.httpService.get('https://api.example.com/data');
  }
}
```

⚠️ **不推荐过长的函数**

```typescript
// ⚠️ 不推荐：函数超过 50 行
async processMessage(data) {
  // 100 行代码...
}

// ✅ 推荐：拆分为多个小函数
async processMessage(data) {
  const parsed = this.parseData(data);
  const validated = this.validateData(parsed);
  const result = await this.process(validated);
  return this.formatResult(result);
}
```

---

## 附录

### A. 常用命令速查

```bash
# 安装依赖
npm install

# 开发模式（热重载）
npm run start:dev

# 生产构建
npm run build

# 启动生产服务
npm run start:prod

# 代码格式化
npm run format

# 代码检查
npm run lint

# 运行测试
npm run test

# 测试覆盖率
npm run test:cov
```

### B. 环境变量清单

| 变量名 | 说明 | 必填 | 默认值 |
|--------|------|------|--------|
| `NODE_ENV` | 运行环境 | 否 | development |
| `PORT` | 服务端口 | 否 | 8080 |
| `AGENT_API_KEY` | AI API 密钥 | 是 | - |
| `AGENT_API_BASE_URL` | AI API 地址 | 是 | - |
| `AGENT_DEFAULT_MODEL` | 默认 AI 模型 | 否 | anthropic/claude-3-7-sonnet-20250219 |
| `ENABLE_AI_REPLY` | 启用 AI 自动回复 | 否 | true |
| `STRIDE_API_BASE_URL` | 托管平台 API 地址 | 是 | - |

### C. 相关文档链接

- **项目文档**: [README.md](../README.md)
- **架构设计**: [ARCHITECTURE.md](./ARCHITECTURE.md)
- **API 配置**: [API_CONFIG.md](./API_CONFIG.md)
- **待办事项**: [TODO.md](./TODO.md)
- **NestJS 文档**: https://docs.nestjs.com/
- **TypeScript 文档**: https://www.typescriptlang.org/docs/
- **托管平台 API**: https://s.apifox.cn/34adc635-40ac-4161-8abb-8cd1eea9f445
- **Agent API**: https://docs.wolian.cc/

### D. Git 提交规范

```bash
# 功能开发
git commit -m "feat: 添加消息群发功能"
git commit -m "feat(message): 支持图片消息处理"

# Bug 修复
git commit -m "fix: 修复会话超时问题"
git commit -m "fix(agent): 修复 AI 响应解析错误"

# 文档更新
git commit -m "docs: 更新 API 文档"
git commit -m "docs(readme): 添加部署说明"

# 代码重构
git commit -m "refactor: 重构消息处理逻辑"

# 性能优化
git commit -m "perf: 优化 API 调用性能"

# 测试相关
git commit -m "test: 添加消息服务单元测试"

# 构建/配置
git commit -m "chore: 更新依赖版本"
git commit -m "build: 优化 Docker 镜像"
```

---

**文档版本**: v1.0
**最后更新**: 2025-10-14
**维护者**: DuLiDay Team

**重要提示**: 本文档是 Claude Code Agent 执行编码任务的核心指南，请严格遵守所有规范和最佳实践。
