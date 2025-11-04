---
name: code-standards
role: system
model: sonnet
visibility: global
description: >
  TypeScript编码规范、NestJS最佳实践、Prettier与ESLint风格约束。
  编写或修改代码时必须遵循本文档。

tags:
  - coding-style
  - typescript
  - nestjs
  - prettier
  - eslint

priority: high
---

# Code Standards

> TypeScript、NestJS 代码规范 - DuLiDay 企业微信服务

**Last Updated**: 2025-11-04
**Target**: AI 代理和人类开发者

---

## ES6+ 现代 JavaScript（强制要求）

### 🚫 禁止使用 ES5 语法

本项目**严格禁止使用 ES5 语法**，所有 JavaScript/TypeScript 代码必须使用 ES6+ 标准。

#### 模块系统

```javascript
// ❌ 禁止使用 CommonJS (ES5)
const express = require('express');
const fs = require('fs');
module.exports = MyClass;
exports.helper = function() {};

// ✅ 必须使用 ES6 Modules
import express from 'express';
import fs from 'fs';
import { helper } from './utils';
export default MyClass;
export const helper = () => {};

// ✅ Node.js 脚本使用 .mjs 扩展名（或配置 package.json "type": "module"）
// 文件: scripts/my-script.mjs
import { execSync } from 'child_process';
import fs from 'fs';
```

#### 变量声明

```javascript
// ❌ 禁止使用 var (ES5)
var count = 0;
var name = 'test';

// ✅ 使用 const/let (ES6)
const count = 0;        // 常量
let name = 'test';      // 可变变量

// ✅ 优先使用 const
const config = { api: 'url' };
const users = ['user1', 'user2'];
```

#### 函数定义

```javascript
// ❌ 禁止使用 function 表达式 (ES5)
function add(a, b) {
  return a + b;
}

var multiply = function(a, b) {
  return a * b;
};

// ✅ 使用箭头函数 (ES6)
const add = (a, b) => a + b;

const multiply = (a, b) => {
  return a * b;
};

// ✅ 对象方法简写
const obj = {
  // ❌ ES5 方式
  getName: function() {
    return this.name;
  },

  // ✅ ES6 方式
  getName() {
    return this.name;
  },
};
```

#### 模板字符串

```javascript
// ❌ 禁止使用字符串拼接 (ES5)
const message = 'Hello, ' + name + '!';
const path = baseUrl + '/api/' + version;

// ✅ 使用模板字符串 (ES6)
const message = `Hello, ${name}!`;
const path = `${baseUrl}/api/${version}`;
```

#### 解构赋值

```javascript
// ❌ 传统方式 (ES5)
const name = user.name;
const email = user.email;
const first = array[0];
const second = array[1];

// ✅ 使用解构 (ES6)
const { name, email } = user;
const [first, second] = array;

// ✅ 函数参数解构
const getUserInfo = ({ name, email, age = 18 }) => {
  return `${name} (${age}): ${email}`;
};
```

#### 数组/对象操作

```javascript
// ❌ 传统方式 (ES5)
var newArray = array.map(function(item) {
  return item * 2;
});

// ✅ 使用箭头函数 (ES6)
const newArray = array.map((item) => item * 2);

// ✅ 展开运算符
const merged = [...array1, ...array2];
const copy = { ...original, newProp: 'value' };

// ✅ 数组方法
const filtered = users.filter((user) => user.age > 18);
const found = users.find((user) => user.id === targetId);
const names = users.map((user) => user.name);
```

#### 类定义

```javascript
// ❌ 构造函数方式 (ES5)
function User(name, email) {
  this.name = name;
  this.email = email;
}

User.prototype.greet = function() {
  return 'Hello, ' + this.name;
};

// ✅ 使用 class (ES6)
class User {
  constructor(name, email) {
    this.name = name;
    this.email = email;
  }

  greet() {
    return `Hello, ${this.name}`;
  }
}

// ✅ 继承
class AdminUser extends User {
  constructor(name, email, permissions) {
    super(name, email);
    this.permissions = permissions;
  }
}
```

#### Promise 和 Async/Await

```javascript
// ❌ 回调函数 (ES5)
fs.readFile('file.txt', function(err, data) {
  if (err) {
    console.error(err);
    return;
  }
  processData(data);
});

// ✅ 使用 Promise (ES6)
const readFileAsync = (path) => {
  return new Promise((resolve, reject) => {
    fs.readFile(path, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
};

// ✅ 使用 async/await (ES7, 推荐)
const processFile = async (path) => {
  try {
    const data = await readFileAsync(path);
    return processData(data);
  } catch (error) {
    console.error('Failed to process file:', error);
    throw error;
  }
};
```

#### 默认参数和剩余参数

```javascript
// ❌ ES5 方式
function greet(name, greeting) {
  greeting = greeting || 'Hello';
  return greeting + ', ' + name;
}

function sum() {
  var args = Array.prototype.slice.call(arguments);
  return args.reduce(function(a, b) { return a + b; }, 0);
}

// ✅ ES6 方式
const greet = (name, greeting = 'Hello') => {
  return `${greeting}, ${name}`;
};

const sum = (...numbers) => {
  return numbers.reduce((a, b) => a + b, 0);
};
```

### Node.js 脚本 ES6 模块配置

对于 Node.js 脚本（非 TypeScript），有两种方式使用 ES6 modules：

#### 方式 1: 使用 .mjs 扩展名（推荐）

```javascript
// 文件: scripts/my-script.mjs
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ES6 模块中获取 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const main = () => {
  console.log('Script running...');
};

main();
```

#### 方式 2: 配置 package.json

```json
{
  "type": "module",
  "scripts": {
    "script": "node scripts/my-script.js"
  }
}
```

**注意**: NestJS 项目通常不使用 `"type": "module"`，建议脚本使用 `.mjs` 扩展名。

---

## TypeScript 规范

### 类型安全（严格模式）

```typescript
// ❌ 禁止使用 any
function process(data: any): any {
  return data.value;
}

// ✅ 使用具体类型
interface ProcessData {
  value: string;
  timestamp: number;
}

function process(data: ProcessData): string {
  return data.value;
}

// ✅ 不确定时使用 unknown
function process(data: unknown): string {
  if (typeof data === 'object' && data !== null && 'value' in data) {
    return (data as ProcessData).value;
  }
  throw new Error('Invalid data');
}

// ✅ 使用泛型
function process<T>(data: T): T {
  return data;
}
```

### Interface vs Type

```typescript
// ✅ 对象结构用 interface
interface User {
  id: string;
  name: string;
  email: string;
}

// ✅ 联合/交叉类型用 type
type Status = 'pending' | 'approved' | 'rejected';
type Result = Success | Error;

// ✅ 扩展 interface
interface AdminUser extends User {
  permissions: string[];
}
```

### 函数类型注解

```typescript
// ✅ 明确参数和返回类型
async function sendMessage(
  token: string,
  content: string,
  toWxid: string,
): Promise<SendResult> {
  // 实现
}

// ✅ 可选参数
function fetchData(
  id: string,
  options?: {
    timeout?: number;
    retry?: boolean;
  },
): Promise<Data> {
  // 实现
}

// ✅ 解构参数带类型
async function process({
  token,
  content,
}: {
  token: string;
  content: string;
}): Promise<Result> {
  // 实现
}
```

---

## NestJS 最佳实践

### Service 标准结构

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * 消息处理服务
 * 负责处理企业微信消息回调
 */
@Injectable()
export class MessageService {
  // 1. Logger（必须第一个）
  private readonly logger = new Logger(MessageService.name);

  // 2. 配置属性（readonly）
  private readonly apiBaseUrl: string;

  // 3. 构造函数（依赖注入）
  constructor(
    private readonly configService: ConfigService,
    private readonly agentService: AgentService,
    private readonly senderService: MessageSenderService,
  ) {
    // 4. 初始化配置
    this.apiBaseUrl = this.configService.get<string>(
      'API_BASE_URL',
      'https://default.com',
    );
    this.logger.log('MessageService initialized');
  }

  // 5. 公共方法
  async handleMessage(data: IncomingMessageData): Promise<Result> {
    this.logger.log(`Processing message from ${data.fromUser}`);
    try {
      const result = await this.processInternal(data);
      return { success: true, data: result };
    } catch (error) {
      this.logger.error('Message processing failed:', error);
      throw error;
    }
  }

  // 6. 私有方法
  private async processInternal(data: IncomingMessageData): Promise<any> {
    // 实现
  }
}
```

### Controller 标准结构

```typescript
import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

/**
 * 消息控制器
 * 处理消息相关的 HTTP 请求
 */
@Controller('messages')
@ApiTags('消息管理')
export class MessageController {
  constructor(private readonly messageService: MessageService) {}

  /**
   * 接收消息回调
   */
  @Post()
  @ApiOperation({ summary: '接收消息回调' })
  @ApiResponse({ status: 200, description: '处理成功' })
  @ApiResponse({ status: 400, description: '参数错误' })
  async receiveMessage(@Body() dto: IncomingMessageDto) {
    return this.messageService.handleMessage(dto);
  }

  /**
   * 获取消息列表
   */
  @Get()
  @ApiOperation({ summary: '获取消息列表' })
  async getMessages(@Query('page') page: number = 1) {
    return this.messageService.getMessages(page);
  }
}
```

### Module 定义

```typescript
import { Module } from '@nestjs/common';
import { MessageController } from './message.controller';
import { MessageService } from './message.service';
import { AgentModule } from '../agent/agent.module';

@Module({
  imports: [AgentModule],           // 依赖的模块
  controllers: [MessageController], // 控制器
  providers: [MessageService],      // 服务提供者
  exports: [MessageService],        // 导出服务
})
export class MessageModule {}
```

### DTO 定义（验证）

```typescript
import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 发送消息 DTO
 */
export class SendMessageDto {
  @ApiProperty({ description: '小组Token', example: 'token_123' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ description: '消息内容', example: '你好' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiProperty({ description: '接收者ID', example: 'wxid_123' })
  @IsString()
  @IsNotEmpty()
  toWxid: string;

  @ApiPropertyOptional({ description: '消息类型', enum: MessageType })
  @IsEnum(MessageType)
  @IsOptional()
  msgType?: MessageType = MessageType.TEXT;
}

enum MessageType {
  TEXT = 1,
  IMAGE = 3,
  VOICE = 34,
}
```

### Logger 使用

```typescript
// ✅ 正确使用
this.logger.log('Normal operation');
this.logger.log(`User action: ${userId}`);
this.logger.warn('Warning message');
this.logger.error('Error occurred:', error.stack || error);
this.logger.debug('Debug info (dev only)');

// ❌ 绝对禁止
console.log('Do not use console.log');  // 禁止！
console.error('Do not use console.error');  // 禁止！
```

### Async/Await

```typescript
// ✅ 使用 async/await
async fetchData(id: string): Promise<Data> {
  try {
    const result = await this.httpService.get(`/api/data/${id}`);
    return result.data;
  } catch (error) {
    this.logger.error('Failed to fetch data:', error);
    throw new HttpException(
      'Data fetch failed',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

// ❌ 避免 .then/.catch
fetchData(id: string): Promise<Data> {
  return this.httpService
    .get(`/api/data/${id}`)
    .then((result) => result.data)
    .catch((error) => {
      // 不推荐
    });
}
```

---

## 代码风格

### Prettier 配置

```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "semi": true,
  "arrowParens": "always"
}
```

### Import 组织

```typescript
// 1. Node.js 内置模块
import * as path from 'path';
import * as fs from 'fs';

// 2. 第三方依赖
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

// 3. 项目内部模块（按层级）
import { ApiConfigService } from '../../core/config';
import { HttpService } from '../../core/client-http';

// 4. 当前模块相对导入
import { CreateMessageDto } from './dto/create-message.dto';
import { MessageType } from './message.types';

// 5. 类型导入（可选，放最后）
import type { AxiosInstance } from 'axios';
```

### 类成员顺序

```typescript
@Injectable()
export class ExampleService {
  // 1. 静态属性
  static readonly VERSION = '1.0.0';

  // 2. 实例属性（private readonly）
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

  // 5. 生命周期钩子
  onModuleInit() {
    this.logger.log('Module initialized');
  }

  // 6. 公共方法
  async publicMethod(): Promise<Result> {
    // 实现
  }

  // 7. 私有方法
  private privateMethod(): void {
    // 实现
  }
}
```

---

## 命名规范

| 类型 | 规范 | 示例 |
|-----|-----|-----|
| **代码文件** | kebab-case | `agent-api.service.ts`, `message-sender.controller.ts` |
| **文档文件** | kebab-case | `agent-service-architecture.md`, `product-definition.md` |
| **配置文件** | kebab-case 或特殊名 | `.cursorrules`, `tsconfig.json`, `package.json` |
| 类/接口 | PascalCase | `AgentService`, `IAgentProfile` |
| 变量/函数 | camelCase | `sendMessage`, `apiKey` |
| 常量 | UPPER_SNAKE_CASE | `API_TIMEOUT`, `MAX_RETRY_COUNT` |
| 枚举值 | UPPER_SNAKE_CASE | `MessageType.TEXT` |

### 文件命名详细规范

#### 代码文件（TypeScript/JavaScript）

**规则**：使用 kebab-case，全小写，单词用 `-` 连接

```
✅ 正确示例：
agent.service.ts                    # 服务文件
message-sender.controller.ts        # 控制器文件
agent-profile.interface.ts          # 接口文件
create-message.dto.ts               # DTO 文件
message-parser.util.ts              # 工具文件
agent.service.spec.ts               # 测试文件

❌ 错误示例：
AgentService.ts                     # 不要用 PascalCase
agent_service.ts                    # 不要用 snake_case
agentService.ts                     # 不要用 camelCase
AGENT_SERVICE.ts                    # 不要用全大写
```

#### 文档文件（Markdown）

**规则**：使用 kebab-case，全小写，描述性名称

```
✅ 正确示例：
agent-service-architecture.md       # 架构文档
message-processing-architecture.md  # 流程文档
chat-agent-best-practices.md        # 最佳实践
product-definition.md               # 产品定义
api-usage-guide.md                  # API 指南

❌ 错误示例：
ARCHITECTURE.md                     # 不要用全大写
API_CONFIG.md                       # 不要用 SNAKE_CASE
ChatAgentGuide.md                   # 不要用 PascalCase
productDefinition.md                # 不要用 camelCase
```

#### 配置文件

**规则**：遵循生态系统约定或使用 kebab-case

```
✅ 生态系统约定文件（保留原名）：
package.json                        # npm 约定
tsconfig.json                       # TypeScript 约定
.eslintrc.js                        # ESLint 约定
.prettierrc                         # Prettier 约定
nest-cli.json                       # NestJS 约定

✅ 自定义配置文件（kebab-case）：
.cursorrules                        # 自定义配置
api-config.service.ts               # 配置服务
env.validation.ts                   # 环境验证
```

### 命名原则

1. **一致性**：项目内保持统一的命名风格
2. **可读性**：使用清晰、描述性的名称
3. **简洁性**：避免过长的文件名（建议 < 50 字符）
4. **避免缩写**：除非是广泛认可的缩写（api、http、dto、id）
5. **语义化**：文件名应清楚表达其用途和内容

### 代码示例

```typescript
// ✅ 正确示例
// 文件: agent-api.service.ts
export class AgentApiService {
  private readonly API_TIMEOUT = 30000;
  private readonly maxRetryCount = 3;

  async sendMessage(content: string): Promise<Result> {
    // 实现
  }
}

// ❌ 错误示例
// 文件: AgentService.ts (应为 agent.service.ts)
export class agent_service {  // 应为 AgentService
  private readonly api_timeout = 30000;  // 常量应为 API_TIMEOUT

  async SendMessage(content: string) {  // 应为 sendMessage
    // 实现
  }
}
```

---

## 文件组织

### 模块结构

```
feature-module/
├── feature.module.ts        # 模块定义（必须）
├── feature.service.ts       # 业务逻辑（必须）
├── feature.controller.ts    # API 端点（可选）
├── dto/                     # 数据传输对象
│   ├── create-feature.dto.ts
│   └── update-feature.dto.ts
├── interfaces/              # 类型定义
│   └── feature.interface.ts
└── feature.types.ts         # 枚举和常量
```

### Barrel 导出

```typescript
// index.ts - 导出公共 API
export * from './feature.module';
export * from './feature.service';
export * from './dto';
export * from './interfaces';
```

---

## 错误处理

### 异常处理

```typescript
import { HttpException, HttpStatus } from '@nestjs/common';
import { NotFoundException, BadRequestException } from '@nestjs/common';

// ✅ 使用 NestJS 内置异常
throw new HttpException('Resource not found', HttpStatus.NOT_FOUND);
throw new NotFoundException('User does not exist');
throw new BadRequestException('Invalid parameters');

// ✅ Service 层错误处理模式
async processData(id: string): Promise<Result> {
  try {
    const data = await this.fetchData(id);
    return { success: true, data };
  } catch (error) {
    this.logger.error('Failed to process data:', error);

    if (error.response?.status === 404) {
      throw new NotFoundException('Data not found');
    }

    throw new HttpException(
      'Processing failed',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
```

---

## 绝对禁止项

### 🚫 禁止使用 ES5 语法

```javascript
// ❌ 禁止使用 var
var count = 0;  // 绝对禁止！

// ✅ 使用 const/let
const count = 0;
let counter = 0;

// ❌ 禁止使用 CommonJS
const fs = require('fs');  // 绝对禁止！
module.exports = MyClass;  // 绝对禁止！

// ✅ 使用 ES6 Modules
import fs from 'fs';
export default MyClass;

// ❌ 禁止使用 function 表达式
function add(a, b) {  // 绝对禁止！
  return a + b;
}

// ✅ 使用箭头函数或类方法
const add = (a, b) => a + b;

// ❌ 禁止字符串拼接
const message = 'Hello, ' + name + '!';  // 绝对禁止！

// ✅ 使用模板字符串
const message = `Hello, ${name}!`;
```

### 其他绝对禁止项

```typescript
// ❌ 禁止硬编码敏感信息
const apiKey = 'sk-1234567890abcdef';  // 绝对禁止！
const password = 'admin123';            // 绝对禁止！

// ✅ 使用环境变量
const apiKey = this.configService.get<string>('API_KEY');

// ❌ 禁止使用 console
console.log('debug info');  // 绝对禁止！

// ✅ 使用 Logger
this.logger.log('debug info');

// ❌ 禁止手动实例化服务
class MyService {
  private otherService = new OtherService();  // 绝对禁止！
}

// ✅ 使用依赖注入
@Injectable()
class MyService {
  constructor(private readonly otherService: OtherService) {}
}

// ❌ 禁止滥用 any
function process(data: any): any {  // 绝对禁止！
  return data;
}

// ✅ 使用具体类型
function process(data: ProcessData): Result {
  return { success: true, data };
}
```

---

## 注释规范

### JSDoc 文档注释

```typescript
/**
 * 消息发送服务
 * 通过托管平台 API 发送消息
 */
@Injectable()
export class MessageSenderService {
  /**
   * 发送单条消息
   *
   * @param dto - 消息数据
   * @returns 发送结果
   * @throws HttpException 发送失败时抛出
   */
  async sendMessage(dto: SendMessageDto): Promise<SendResult> {
    // 实现
  }
}
```

### 行内注释

```typescript
// ✅ 解释复杂逻辑
// 跳过来自机器人自己的消息，避免无限循环
if (isSelf) {
  return;
}

// 限制历史消息数量，防止内存溢出
if (messages.length > this.maxMessagesPerConversation) {
  messages = messages.slice(-this.maxMessagesPerConversation);
}

// ❌ 不要注释显而易见的代码
// 创建变量
const name = 'test';  // 多余

// 调用函数
this.service.process();  // 多余
```

### TODO 注释

```typescript
// TODO: 迁移到 Redis 存储
// TODO: 添加重试机制
// FIXME: 修复并发场景下的竞态条件
// NOTE: 此逻辑依赖特定的 API 行为
```

---

## 质量检查清单

提交代码前检查：

### ES6+ 现代语法检查
- [ ] 无 ES5 语法（无 `var`、`require`、`function` 表达式）
- [ ] 使用 ES6 Modules (`import`/`export`)
- [ ] 使用箭头函数和模板字符串
- [ ] Node.js 脚本使用 `.mjs` 扩展名

### TypeScript 类型检查
- [ ] 代码编译无错误
- [ ] 无 TypeScript `any` 类型（除非有充分理由）
- [ ] 所有函数有类型注解
- [ ] 使用具体类型或泛型

### 代码质量检查
- [ ] 正确的错误处理（try-catch）
- [ ] 使用 Logger（无 console.log）
- [ ] Prettier 格式化通过
- [ ] ESLint 检查通过
- [ ] 有意义的变量/函数名
- [ ] 注释解释"为什么"而非"是什么"
- [ ] 无敏感信息泄露

---

## 文档编写标准

### 文档类型与长度限制

| 文档类型 | 最大行数 | 推荐行数 | 说明 |
|---------|---------|---------|------|
| **架构文档** | 500 行 | 300-400 行 | 系统/模块架构设计 |
| **API 使用指南** | 600 行 | 300-500 行 | 外部 API 使用说明 |
| **开发规范** | 400 行 | 200-300 行 | 代码规范、最佳实践 |

### 核心原则

✅ **精简至上**：
- 只保留**核心实现思想**和**设计决策**
- 删除详细示例、重复说明、过度解释
- 突出核心算法、关键流程、重要配置
- 不写 step-by-step 教程，只记录核心模式
- 使用简洁的文字流程代替复杂图表
- 每个概念最多 1 个简洁示例
- 面向已理解业务的开发者，非新手教程

❌ **严格禁止**：
- 超过推荐行数限制
- 重复解释相同概念
- 冗长的故障排查章节
- 详尽的 FAQ 列表
- 过多的配置示例
- 教程式的分步指南
- 监控/调试章节（除非核心）
- 扩展指南（除非核心）
- 最佳实践章节（应融入正文）

### 标准结构模板

```markdown
# [文档标题]

## 目录
- 核心章节（4-6个）

## 1. 架构概述
- 简化的架构图（文字即可）
- 文件结构

## 2. 核心组件
- 每个组件的核心职责（3-5条）
- 关键方法签名
- 关键配置参数

## 3. 核心流程
- 简化的流程图（文字即可）
- 关键决策点

## 4. 配置管理
- 必需配置项
- 关键配置示例

## 5. 总结
- 核心要点
- 关键指标

---

**最后更新**: YYYY-MM-DD
```

### 精简示例

#### ❌ 冗长示例（不推荐）

```markdown
## 消息去重机制

### 5.1 去重策略

消息去重是消息处理流程中的关键环节...（200字说明）

#### LRU 缓存 + TTL

我们使用了 LRU 缓存结合 TTL 的方式来实现去重...（150字说明）

```typescript
// 数据结构
private readonly messageCache = new Map<string, number>();
// messageId → timestamp

// 容量限制
private readonly maxSize = 10000;
private readonly ttl = 300000; // 5 分钟
```

#### 去重逻辑

下面是详细的去重逻辑实现...（100字说明）

```typescript
// 完整实现代码（30行）
```

#### 去重流程图

```
┌─────────────────────────────────────────────────────────────┐
│ 收到消息 (messageId: msg-123)                                │
└─────────────────────────────────────────────────────────────┘
  （详细流程图 20行）
```

### 5.2 内存管理

#### LRU 淘汰策略

...（200字说明）

#### 定期清理

...（150字说明）
```

#### ✅ 精简示例（推荐）

```markdown
## 2.3 MessageDeduplicationService (去重)

**位置**: [src/wecom/message/services/message-deduplication.service.ts](...)

#### 去重策略
- **数据结构**: `Map<messageId, timestamp>`
- **TTL**: 5 分钟内重复视为去重
- **容量管理**: LRU 策略，最大 10,000 条
- **性能**: O(1) 查询，定期清理过期记录

```typescript
isDuplicate(messageId: string): boolean {
  const existingTimestamp = this.messageCache.get(messageId);
  if (existingTimestamp && (Date.now() - existingTimestamp) < this.ttl) {
    return true; // 重复消息
  }
  this.messageCache.set(messageId, Date.now());
  return false;
}
```
```

### 文档检查清单

提交文档前检查：

- [ ] 总行数是否在推荐范围内？
- [ ] 每个示例是否必不可少？
- [ ] 是否删除了所有冗余说明？
- [ ] 是否移除了故障排查/FAQ/监控/扩展章节？
- [ ] 是否避免了教程式写法？
- [ ] 目录章节是否精简（不超过 8 个）？
- [ ] 是否使用简洁的文字流程代替复杂图表？
- [ ] 每个概念是否只有 1 个简洁示例？

---

## 相关文档

- [architecture-principles.md](architecture-principles.md) - 架构设计原则
- [code-quality-guardian.md](code-quality-guardian.md) - AI 代理质量检查
