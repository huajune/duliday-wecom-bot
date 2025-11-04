---
name: architecture-principles
role: system
model: sonnet
visibility: global
description: >
  系统架构设计原则、DDD领域驱动、SOLID原则、设计模式指导。
  用于指导模块划分、依赖管理和架构决策。

tags:
  - architecture
  - design-patterns
  - solid-principles
  - ddd

priority: high
---

# Architecture Principles

> 系统架构指导原则 - DuLiDay 企业微信服务

**Last Updated**: 2025-11-04

---

## 核心架构哲学

### 1. 简单优先（KISS）

```
"A complex system that works is invariably found to have evolved from
a simple system that worked." — John Gall
```

**原则**：
- 从简单开始，需要时再增加复杂度
- 不为未来的假想需求设计（YAGNI）
- 优先使用成熟方案

**案例**：MessageService 重构
- **重构前**：1099 行巨石服务，职责混乱
- **重构后**：300 行主服务 + 5 个专职子服务

### 2. 单一职责（Unix Philosophy）

每个服务只做一件事，并做好。

```typescript
// ❌ 错误：上帝对象
@Injectable()
export class MessageService {
  async handleMessage() {
    // 解析、验证、调用AI、翻译、审核、发送、日志、分析...
    // 100+ 行混合职责
  }
}

// ✅ 正确：职责分离
@Injectable()
export class MessageService {
  constructor(
    private readonly agentService: AgentService,
    private readonly senderService: MessageSenderService,
    private readonly historyService: MessageHistoryService,
  ) {}

  async handleMessage(data: IncomingMessageData) {
    // 仅协调流程
    const conversationId = this.generateId(data);
    const reply = await this.agentService.chat({ conversationId, message: data.content });
    await this.senderService.send({ token: data.token, content: reply });
  }
}
```

---

## DDD 分层架构

### 架构模式：领域驱动设计（DDD）

```
┌─────────────────────────────────────────┐
│  Core Layer (基础设施层)                │
│  - client-http (HTTP 客户端)            │
│  - config (配置管理)                    │
│  - redis (缓存)                         │
│  - server/response (统一响应)           │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│  Domain Layers (业务域层)               │
│  - agent (AI Agent 域)                  │
│  - wecom (企业微信域)                   │
│  - sponge (海绵系统域)                  │
│  - analytics (数据分析域)               │
└─────────────────────────────────────────┘
```

### 真实项目结构

```
src/
├── core/                          # 基础设施层（横向复用）
│   ├── client-http/              # HTTP 客户端（工厂模式 + Bearer Token）
│   ├── config/                   # 配置管理
│   ├── redis/                    # Redis 缓存
│   └── server/response/          # 统一响应（拦截器 + 过滤器）
│
├── agent/                         # AI Agent 业务域
│   ├── agent.service.ts          # API 调用层
│   ├── agent-cache.service.ts    # 缓存管理
│   ├── agent-registry.service.ts # 模型/工具注册
│   └── agent-config.service.ts   # 配置档案
│
├── wecom/                         # 企业微信业务域（核心）
│   ├── message/                  # 消息处理
│   │   ├── message.service.ts    # 主协调服务
│   │   └── services/             # 子服务（去重/过滤/历史/聚合/统计）
│   ├── message-sender/           # 消息发送
│   ├── bot/                      # 机器人管理
│   ├── chat/                     # 会话管理
│   ├── contact/                  # 联系人
│   └── room/                     # 群聊
│
├── sponge/                        # 海绵系统集成域（骨架）
│   ├── job/                      # 岗位管理
│   └── interview/                # 面试管理
│
└── analytics/                     # 数据分析域（骨架）
    └── metrics/                  # 指标统计
```

### 依赖规则

- ✅ 业务域可依赖基础设施层
- ✅ 业务域之间通过接口通信
- ❌ 基础设施层**禁止**依赖业务域
- ❌ **禁止**循环依赖

---

## SOLID 原则（精简版）

### S - 单一职责原则（SRP）

**真实案例：MessageService 重构**

```typescript
// ❌ 重构前：1099 行，职责混乱
@Injectable()
export class MessageService {
  async handleMessage() {
    // 去重、过滤、历史、聚合、调用AI、分段、发送、统计...
  }
}

// ✅ 重构后：300 行主服务 + 5 个子服务
@Injectable()
export class MessageService {
  constructor(
    private readonly dedup: MessageDeduplicationService,  // 去重
    private readonly filter: MessageFilterService,        // 过滤
    private readonly history: MessageHistoryService,      // 历史
    private readonly merge: MessageMergeService,          // 聚合
    private readonly stats: MessageStatisticsService,     // 统计
  ) {}

  async handleMessage(data: IncomingMessageData): Promise<void> {
    if (await this.dedup.isDuplicate(data)) return;
    if (!this.filter.shouldProcess(data)) return;
    await this.history.save(data);
    await this.merge.enqueue(data); // 异步处理
  }
}
```

### O - 开闭原则（OCP）

```typescript
// ✅ 通过接口扩展，无需修改
interface IConversationStorage {
  get(id: string): Promise<Message[]>;
  set(id: string, messages: Message[]): Promise<void>;
}

// 实现 1: 内存存储（v1.0）
@Injectable()
export class MemoryStorage implements IConversationStorage { }

// 实现 2: Redis 存储（v1.1） - 无需修改接口
@Injectable()
export class RedisStorage implements IConversationStorage { }
```

### D - 依赖倒置原则（DIP）

```typescript
// ❌ 错误：依赖具体实现
@Injectable()
export class MessageService {
  async handleMessage() {
    const response = await axios.post('https://api.ai.com/chat', data);  // 硬编码
  }
}

// ✅ 正确：依赖抽象
@Injectable()
export class MessageService {
  constructor(private readonly agentService: AgentService) {}  // 抽象

  async handleMessage(data: IncomingMessageData) {
    const response = await this.agentService.chat({ message: data.content });
  }
}
```

---

## 核心设计模式

### 1. 工厂模式（HttpClientFactory）

用于创建配置复杂的对象。

```typescript
@Injectable()
export class HttpClientFactory {
  create(token: string): AxiosInstance {
    return axios.create({
      baseURL: 'https://api.example.com',
      headers: { Authorization: `Bearer ${token}` },
      timeout: 30000,
    });
  }
}

// 使用
const client = this.factory.create(token);
const response = await client.post('/send', data);
```

### 2. 策略模式（消息处理器）

```typescript
interface IMessageProcessor {
  process(message: IncomingMessageData): Promise<void>;
}

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

// 上下文
@Injectable()
export class MessageService {
  private processors = new Map<number, IMessageProcessor>();

  constructor(
    private readonly textProcessor: TextMessageProcessor,
    private readonly imageProcessor: ImageMessageProcessor,
  ) {
    this.processors.set(MessageType.TEXT, textProcessor);
    this.processors.set(MessageType.IMAGE, imageProcessor);
  }

  async handleMessage(message: IncomingMessageData): Promise<void> {
    const processor = this.processors.get(message.msgType);
    await processor?.process(message);
  }
}
```

### 3. 多层缓存策略

```typescript
// L1: 内存缓存（配置档案）
// L2: Redis 缓存（Agent 响应、历史记录）
// L3: Bull Queue（消息聚合处理）

@Injectable()
export class AgentCacheService {
  private memoryCache = new Map<string, any>();  // L1

  constructor(private readonly redis: RedisService) {}  // L2

  async get(key: string): Promise<any> {
    // 1. 检查内存
    if (this.memoryCache.has(key)) return this.memoryCache.get(key);

    // 2. 检查 Redis
    const cached = await this.redis.get(key);
    if (cached) {
      this.memoryCache.set(key, cached);  // 回填 L1
      return cached;
    }

    return null;
  }
}
```

---

## 模块组织

### 标准模块结构

```
feature-module/
├── feature.module.ts        # 模块定义
├── feature.service.ts       # 业务逻辑
├── feature.controller.ts    # API 端点
├── dto/                     # 数据传输对象
│   └── create-feature.dto.ts
└── interfaces/              # 类型定义
    └── feature.interface.ts
```

### 模块定义

```typescript
@Module({
  imports: [DependencyModule],      // 依赖的其他模块
  controllers: [FeatureController], // 注册控制器
  providers: [FeatureService],      // 注册服务
  exports: [FeatureService],        // 导出供其他模块使用
})
export class FeatureModule {}
```

---

## 依赖管理

### 构造函数注入（DI）

```typescript
// ✅ 始终使用构造函数注入
@Injectable()
export class MessageService {
  constructor(
    private readonly agentService: AgentService,
    private readonly logger: Logger,
  ) {}
}

// ❌ 禁止手动实例化
@Injectable()
export class MessageService {
  private agentService = new AgentService();  // 错误！
}
```

### 避免循环依赖

```typescript
// ❌ 循环依赖
// message.service.ts
constructor(private readonly agentService: AgentService) {}

// agent.service.ts
constructor(private readonly messageService: MessageService) {}  // 循环！

// ✅ 解决方案：引入中间层
// conversation.service.ts - 共享逻辑
@Injectable()
export class ConversationService {}

// message.service.ts
constructor(private readonly conversationService: ConversationService) {}

// agent.service.ts
constructor(private readonly conversationService: ConversationService) {}
```

---

## 反模式（禁止）

### 1. 上帝对象

```typescript
// ❌ 一个类做所有事情
@Injectable()
export class MessageService {
  // 50+ 方法，500+ 行
  async handleMessage() {}
  async parseMessage() {}
  async validatePermission() {}
  async callAI() {}
  async translateReply() {}
  // ...
}

// ✅ 分离职责
@Injectable()
export class MessageService {
  constructor(
    private readonly agentService: AgentService,
    private readonly senderService: MessageSenderService,
  ) {}
}
```

### 2. 泄露抽象

```typescript
// ❌ 暴露实现细节
interface IStorage {
  redis: RedisClient;  // 泄露实现！
  get(key: string): Promise<string>;
}

// ✅ 纯粹抽象
interface IStorage {
  get(key: string): Promise<string>;
  set(key: string, value: string): Promise<void>;
}
```

### 3. 魔法数字

```typescript
// ❌ 魔法数字
if (messageType === 7) {  // 7 是什么？
  // 处理文本消息
}

// ✅ 命名常量
enum MessageType {
  TEXT = 7,
  IMAGE = 3,
  VOICE = 34,
}

if (messageType === MessageType.TEXT) {
  // 清晰明确
}
```

---

## 架构演进策略

### 当前状态（v1.0）

- 单应用实例
- 内存 + Redis 混合存储
- Bull 队列（消息聚合）
- 同步 + 异步混合处理

### 未来演进（v1.1+）

- 多实例部署（水平扩展）
- Redis 主存储
- 完整的消息队列（所有异步任务）
- 监控与告警（Prometheus）

### 渐进式迁移

1. 保持接口稳定
2. 新功能使用 Feature Flag
3. 双写期间验证数据一致性
4. 验证通过后完全切换
5. 移除旧代码

---

## 最佳实践总结

✅ **务必遵守**：
- 服务单一职责（< 500 行）
- 使用依赖注入
- 依赖抽象而非具体实现
- 为可测试性设计
- 使用 Feature Flag 渐进发布
- 记录架构决策（ADR）

❌ **绝对禁止**：
- 创建上帝对象
- 硬编码依赖
- 循环依赖
- 为未来过度设计
- 在接口中暴露实现细节
- 过早优化

---

**相关文档**：
- [code-standards.md](code-standards.md) - 代码规范
- [code-quality-guardian.md](code-quality-guardian.md) - 质量检查
