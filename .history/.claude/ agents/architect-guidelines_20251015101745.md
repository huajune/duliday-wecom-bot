---
name: architect-guidelines
role: system
model: sonnet
visibility: global
description: >
  提供系统架构、技术演进、模块依赖、性能优化与可靠性设计的指导原则。
  用于约束 Claude Code 在高层设计、模块划分、依赖管理时的决策逻辑。
  所有涉及系统结构、分层设计或重构建议的任务均应参考此文件。

tags:
  - architecture
  - system-design
  - performance
  - reliability

priority: high
---

# 高级架构师视角：Claude Code Agent 技术指导手册

> 从架构设计、系统演进、技术决策的高度指导 AI Agent 进行高质量开发

**文档版本**: v1.0
**最后更新**: 2025-10-14
**目标读者**: Claude Code Agent（高级开发模式）
**文档性质**: 架构级技术指导

---

## 📖 目录

- [1. 架构哲学与设计原则](#1-架构哲学与设计原则)
- [2. 系统架构深度解析](#2-系统架构深度解析)
- [3. 关键技术决策与权衡](#3-关键技术决策与权衡)
- [4. 架构演进路径](#4-架构演进路径)
- [5. 性能优化策略](#5-性能优化策略)
- [6. 可扩展性设计](#6-可扩展性设计)
- [7. 可靠性与容错](#7-可靠性与容错)
- [8. 安全架构](#8-安全架构)
- [9. 监控与可观测性](#9-监控与可观测性)
- [10. 架构反模式识别](#10-架构反模式识别)
- [11. 代码审查的架构视角](#11-代码审查的架构视角)
- [12. 技术债务管理](#12-技术债务管理)

---

## 1. 架构哲学与设计原则

### 1.1 核心架构理念

#### 🎯 简单优于复杂（Simplicity over Complexity）

```
"A complex system that works is invariably found to have evolved from
a simple system that worked." — John Gall
```

**指导原则**:
- **当前阶段**: 项目处于 v1.0，优先保持简单可用
- **未来扩展**: 预留扩展点，但不过度设计
- **技术选型**: 选择成熟稳定的技术栈，避免尝试新技术

**实践**:
```typescript
// ❌ 过度设计：为未来可能不需要的功能设计复杂架构
interface IMessageProcessor {
  process(message: Message): Promise<void>;
}
interface IMessageValidator { validate(message: Message): boolean; }
interface IMessageRouter { route(message: Message): Destination; }
interface IMessageTransformer { transform(message: Message): Message; }
// ... 10 个接口

// ✅ 简单实用：从当前需求出发
@Injectable()
export class MessageService {
  async handleMessage(message: IncomingMessageData): Promise<void> {
    // 直接处理，需要时再抽象
  }
}
```

#### 🏗️ 分层架构（Layered Architecture）

**四层架构设计**:

```
┌─────────────────────────────────────────┐
│  Presentation Layer (表示层)            │
│  Controllers - RESTful API              │
│  职责: 接收请求、参数验证、响应格式化     │
└───────────────┬─────────────────────────┘
                │ 调用
┌───────────────▼─────────────────────────┐
│  Business Logic Layer (业务逻辑层)      │
│  Services - 核心业务逻辑                 │
│  职责: 业务规则、流程编排、数据处理       │
└───────────────┬─────────────────────────┘
                │ 调用
┌───────────────▼─────────────────────────┐
│  Common Layer (通用服务层)              │
│  ConversationService, Utilities         │
│  职责: 跨模块共享能力、通用工具          │
└───────────────┬─────────────────────────┘
                │ 调用
┌───────────────▼─────────────────────────┐
│  Infrastructure Layer (基础设施层)      │
│  HttpService, ConfigService, Logger     │
│  职责: 外部依赖封装、技术基础设施         │
└─────────────────────────────────────────┘
```

**关键约束**:
1. **依赖方向**: 只能从上向下依赖，不能反向依赖
2. **跨层依赖**: 业务层可以直接依赖基础设施层，跳过通用层
3. **循环依赖**: 严格禁止任何形式的循环依赖

**检查方法**:
```bash
# 使用 madge 检测循环依赖
npx madge --circular --extensions ts src/
```

#### 🔌 依赖倒置（Dependency Inversion）

```typescript
// ❌ 反模式：高层模块依赖低层模块的具体实现
@Injectable()
export class MessageService {
  async handleMessage(data: IncomingMessageData) {
    // 直接依赖具体实现
    const response = await axios.post('https://api.wolian.cc/chat', data);
  }
}

// ✅ 正确：依赖抽象（通过 DI 注入）
@Injectable()
export class MessageService {
  constructor(
    private readonly agentService: AgentService,  // 依赖抽象接口
  ) {}

  async handleMessage(data: IncomingMessageData) {
    const response = await this.agentService.chat({
      conversationId: data.fromUser,
      userMessage: data.content,
    });
  }
}
```

**优势**:
- 易于测试（可以 Mock AgentService）
- 易于替换实现（切换不同的 AI 服务）
- 降低耦合度

### 1.2 Unix 哲学在微服务中的应用

#### Do One Thing and Do It Well

```typescript
// ❌ 反模式：一个服务做太多事情
@Injectable()
export class MessageService {
  async handleMessage(data: IncomingMessageData) {
    // 1. 解析消息
    const parsed = this.parseMessage(data);

    // 2. 验证权限
    await this.checkPermission(parsed);

    // 3. 调用 AI
    const reply = await this.callAI(parsed);

    // 4. 翻译回复
    const translated = await this.translate(reply);

    // 5. 审核内容
    await this.moderateContent(translated);

    // 6. 发送消息
    await this.sendMessage(translated);

    // 7. 记录分析
    await this.logAnalytics(parsed, translated);

    // 8. 更新用户画像
    await this.updateUserProfile(parsed.fromUser);
  }
}

// ✅ 正确：职责分离，服务协作
@Injectable()
export class MessageService {
  constructor(
    private readonly agentService: AgentService,
    private readonly messageSenderService: MessageSenderService,
    private readonly conversationService: ConversationService,
  ) {}

  async handleMessage(data: IncomingMessageData) {
    // 只负责消息处理流程的编排
    const conversationId = this.conversationService.generateConversationId(
      data.contactId,
      data.roomId,
      data.isRoom,
    );

    const reply = await this.agentService.chat({
      conversationId,
      userMessage: data.content,
    });

    await this.messageSenderService.sendMessage({
      token: data.token,
      content: reply,
      toWxid: data.contactId,
    });
  }
}

// 其他职责由专门的服务处理
@Injectable()
export class ContentModerationService { /* 内容审核 */ }

@Injectable()
export class UserProfileService { /* 用户画像 */ }

@Injectable()
export class AnalyticsService { /* 数据分析 */ }
```

---

## 2. 系统架构深度解析

### 2.1 当前架构优势分析

#### ✅ 优势 1: 清晰的分层架构

```
src/
├── core/           → 基础设施层（可复用于其他项目）
├── common/         → 通用能力层（可复用于其他项目）
├── agent/          → AI 集成层（领域特定）
└── modules/        → 业务模块层（业务特定）
```

**价值**:
- 新人快速理解代码结构
- 模块边界清晰，易于维护
- 核心层可以独立测试

#### ✅ 优势 2: 统一的依赖注入

**IoC 容器管理所有依赖**:
```typescript
// NestJS 自动管理依赖的生命周期
@Module({
  providers: [
    MessageService,           // 自动单例
    AgentService,             // 自动单例
    ConversationService,      // 自动单例
  ],
})
export class AppModule {}
```

**好处**:
- 易于测试（可以注入 Mock）
- 避免循环依赖
- 自动管理单例

#### ✅ 优势 3: 会话管理的抽象

```typescript
// 统一的会话管理接口
interface IConversationService {
  generateConversationId(fromUser: string, roomId?: string, isRoom?: boolean): string;
  getHistory(conversationId: string): Message[];
  addMessage(conversationId: string, message: Message): void;
  clearConversation(conversationId: string): void;
}

// 当前实现：内存存储
@Injectable()
export class ConversationService implements IConversationService {
  private conversations = new Map<string, Message[]>();
  // ...
}

// 未来迁移：Redis 存储
@Injectable()
export class RedisConversationService implements IConversationService {
  constructor(private readonly redis: RedisService) {}
  // 实现相同接口，无需修改调用方代码
}
```

**扩展性**:
- 存储层可替换（内存 → Redis → 数据库）
- 调用方代码无需修改
- 符合开闭原则（对扩展开放，对修改关闭）

### 2.2 当前架构的技术债务

#### ⚠️ 技术债务 1: 会话存储在内存中

**问题**:
```typescript
@Injectable()
export class ConversationService {
  // ⚠️ 存储在内存中
  private conversations = new Map<string, any[]>();
}
```

**影响**:
- 服务重启后会话丢失
- 无法水平扩展（多实例会话不共享）
- 内存占用无法控制

**解决方案** (见 TODO.md):
```typescript
// Phase 1: 引入 Redis
@Injectable()
export class RedisConversationService {
  async getHistory(conversationId: string): Promise<Message[]> {
    const data = await this.redis.get(`conv:${conversationId}`);
    return JSON.parse(data || '[]');
  }

  async addMessage(conversationId: string, message: Message): Promise<void> {
    const history = await this.getHistory(conversationId);
    history.push(message);

    // 限制最多 50 条，TTL 2 小时
    if (history.length > 50) {
      history.shift();
    }

    await this.redis.setex(
      `conv:${conversationId}`,
      2 * 60 * 60,
      JSON.stringify(history),
    );
  }
}

// Phase 2: 引入数据库（长期存储）
@Injectable()
export class DatabaseConversationService {
  async getHistory(conversationId: string): Promise<Message[]> {
    return this.messageRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
      take: 50,
    });
  }
}
```

**迁移策略**:
1. 保持接口不变（IConversationService）
2. 实现新的服务（RedisConversationService）
3. 在模块中切换实现
4. 逐步迁移流量

#### ⚠️ 技术债务 2: 消息处理同步阻塞

**问题**:
```typescript
// 当前实现：同步处理消息
@Post()
async handleMessage(@Body() data: IncomingMessageData) {
  await this.messageService.handleMessage(data);  // 阻塞等待
  return { success: true };
}
```

**影响**:
- 并发能力受限（AI 响应慢时阻塞请求）
- 无法处理消息洪峰
- 托管平台可能超时

**解决方案** (见 TODO.md):
```typescript
// Phase 1: 引入消息队列
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

@Controller('message')
export class MessageController {
  constructor(
    @InjectQueue('message-processing')
    private messageQueue: Queue,
  ) {}

  @Post()
  async handleMessage(@Body() data: IncomingMessageData) {
    // 立即返回，异步处理
    await this.messageQueue.add('process', data, {
      attempts: 3,                  // 重试 3 次
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
    });

    return { success: true, queued: true };
  }
}

// Worker 处理队列消息
@Processor('message-processing')
export class MessageProcessor {
  constructor(private readonly messageService: MessageService) {}

  @Process('process')
  async handleProcess(job: Job<IncomingMessageData>) {
    await this.messageService.handleMessage(job.data);
  }
}
```

**优势**:
- 快速响应托管平台（< 100ms）
- 异步处理消息（不阻塞）
- 自动重试失败的消息
- 支持优先级队列

#### ⚠️ 技术债务 3: 缺少监控和告警

**问题**:
- 无法实时监控系统状态
- 问题发生后才被动发现
- 缺少性能指标

**解决方案**:
```typescript
// 引入 Prometheus + Grafana
import { Counter, Histogram } from 'prom-client';

@Injectable()
export class MessageService {
  // 定义指标
  private readonly messageCounter = new Counter({
    name: 'wecom_messages_total',
    help: 'Total number of messages processed',
    labelNames: ['status', 'type'],
  });

  private readonly processingDuration = new Histogram({
    name: 'wecom_message_processing_duration_seconds',
    help: 'Message processing duration',
    buckets: [0.1, 0.5, 1, 2, 5, 10],
  });

  async handleMessage(data: IncomingMessageData) {
    const start = Date.now();

    try {
      await this.processMessage(data);

      // 记录成功指标
      this.messageCounter.inc({ status: 'success', type: data.messageType });
    } catch (error) {
      // 记录失败指标
      this.messageCounter.inc({ status: 'failed', type: data.messageType });
      throw error;
    } finally {
      // 记录处理时长
      const duration = (Date.now() - start) / 1000;
      this.processingDuration.observe(duration);
    }
  }
}

// 暴露 Prometheus 指标端点
@Controller('metrics')
export class MetricsController {
  @Get()
  async getMetrics() {
    return register.metrics();
  }
}
```

**监控维度**:
- 消息处理量（QPS）
- 处理成功率
- 处理延迟（P50、P95、P99）
- AI API 调用次数和耗时
- 错误率和错误类型分布

### 2.3 架构决策记录（ADR）

#### ADR-001: 选择 NestJS 作为后端框架

**上下文**:
需要构建企业微信智能回复服务，要求模块化、可扩展、易维护。

**决策**:
选择 NestJS 而非 Express/Koa/Fastify。

**理由**:
- ✅ 内置依赖注入（IoC 容器）
- ✅ TypeScript 原生支持
- ✅ 模块化架构（类似 Spring Boot）
- ✅ 完善的生态（Swagger、测试、验证）
- ✅ 企业级项目的最佳选择

**后果**:
- 学习曲线较陡（需要理解装饰器、DI）
- 框架较重（但对企业项目不是问题）

#### ADR-002: 会话存储初期使用内存

**上下文**:
需要存储多轮对话的会话历史。

**决策**:
v1.0 阶段使用内存存储，预留接口用于未来迁移 Redis/数据库。

**理由**:
- ✅ 快速上线，无需额外依赖
- ✅ 开发和测试简单
- ✅ 单实例部署场景足够
- ✅ 通过接口抽象，易于迁移

**后果**:
- ⚠️ 服务重启后会话丢失（可接受）
- ⚠️ 无法水平扩展（v1.0 不需要）
- ✅ 迁移路径清晰（TODO.md 已规划）

**迁移计划**:
- v1.1: 引入 Redis
- v2.0: 引入数据库（历史记录持久化）

#### ADR-003: 消息处理初期同步处理

**上下文**:
接收托管平台的消息回调，需要调用 AI 生成回复。

**决策**:
v1.0 阶段同步处理消息，未来引入消息队列。

**理由**:
- ✅ 实现简单，快速验证
- ✅ 调试方便
- ✅ 满足初期流量（< 100 msg/min）

**后果**:
- ⚠️ 并发能力受限
- ⚠️ AI 响应慢时可能超时
- ✅ 迁移路径清晰（TODO.md 已规划）

**迁移触发条件**:
- 消息量 > 1000/min
- 或出现频繁超时

---

## 3. 关键技术决策与权衡

### 3.1 技术选型矩阵

#### 会话存储方案对比

| 方案 | 优势 | 劣势 | 适用场景 | 当前阶段 |
|------|------|------|----------|----------|
| **内存存储** | • 简单快速<br>• 无额外依赖<br>• 开发方便 | • 重启丢失<br>• 无法扩展<br>• 内存有限 | 单实例、低流量 | ✅ v1.0 |
| **Redis** | • 高性能<br>• 支持扩展<br>• 自动过期 | • 额外依赖<br>• 需要运维 | 多实例、中流量 | 🔄 v1.1 |
| **数据库** | • 持久化<br>• 可审计<br>• 复杂查询 | • 性能较低<br>• 存储成本高 | 长期存储、分析 | 📅 v2.0 |

**决策建议**:
- v1.0: 使用内存（当前）
- v1.1: 迁移到 Redis（优先级高）
- v2.0: 数据库作为冷存储（优先级中）

#### 消息处理方案对比

| 方案 | 吞吐量 | 延迟 | 复杂度 | 适用场景 |
|------|--------|------|--------|----------|
| **同步处理** | 10-50 msg/min | 高 | 低 | v1.0 MVP |
| **消息队列（Bull）** | 1000+ msg/min | 低 | 中 | v1.1 生产 |
| **Kafka + 微服务** | 10000+ msg/min | 低 | 高 | v3.0 大规模 |

**决策路径**:
```
v1.0: 同步处理 → v1.1: Bull 队列 → v2.0: 优化队列 → v3.0: Kafka（可选）
```

### 3.2 可扩展性设计决策

#### 策略 1: 接口抽象

```typescript
// 定义抽象接口
interface IConversationStorage {
  get(conversationId: string): Promise<Message[]>;
  set(conversationId: string, messages: Message[]): Promise<void>;
  delete(conversationId: string): Promise<void>;
}

// 实现 1: 内存存储（v1.0）
@Injectable()
export class MemoryConversationStorage implements IConversationStorage {
  private store = new Map<string, Message[]>();

  async get(conversationId: string): Promise<Message[]> {
    return this.store.get(conversationId) || [];
  }
}

// 实现 2: Redis 存储（v1.1）
@Injectable()
export class RedisConversationStorage implements IConversationStorage {
  constructor(private readonly redis: RedisService) {}

  async get(conversationId: string): Promise<Message[]> {
    const data = await this.redis.get(conversationId);
    return JSON.parse(data || '[]');
  }
}

// 使用方无需修改
@Injectable()
export class ConversationService {
  constructor(
    @Inject('IConversationStorage')
    private readonly storage: IConversationStorage,
  ) {}

  async getHistory(conversationId: string): Promise<Message[]> {
    return this.storage.get(conversationId);
  }
}

// 在模块中切换实现
@Module({
  providers: [
    {
      provide: 'IConversationStorage',
      useClass: MemoryConversationStorage,  // v1.0
      // useClass: RedisConversationStorage,  // v1.1 切换到这里
    },
  ],
})
export class ConversationModule {}
```

**优势**:
- 存储实现可替换
- 业务代码不受影响
- 易于测试（Mock 存储层）

#### 策略 2: 配置驱动

```typescript
// ❌ 反模式：硬编码配置
@Injectable()
export class MessageService {
  async handleMessage(data: IncomingMessageData) {
    if (data.isRoom && !data.mentionSelf) {
      return;  // 硬编码：群聊必须 @
    }
  }
}

// ✅ 正确：配置驱动
@Injectable()
export class MessageService {
  private readonly requireMentionInRoom: boolean;
  private readonly enabledMessageTypes: Set<number>;

  constructor(private readonly configService: ConfigService) {
    this.requireMentionInRoom = configService.get('REQUIRE_MENTION_IN_ROOM', false);
    this.enabledMessageTypes = new Set(
      configService.get('ENABLED_MESSAGE_TYPES', '7').split(',').map(Number),
    );
  }

  async handleMessage(data: IncomingMessageData) {
    // 配置驱动：可通过环境变量控制行为
    if (data.isRoom && this.requireMentionInRoom && !data.mentionSelf) {
      return;
    }

    if (!this.enabledMessageTypes.has(data.messageType)) {
      return;
    }
  }
}
```

**配置文件**:
```env
# 消息处理配置
REQUIRE_MENTION_IN_ROOM=false          # 群聊是否需要 @
ENABLED_MESSAGE_TYPES=7                 # 支持的消息类型（7=文本）
MAX_MESSAGE_LENGTH=1000                 # 最大消息长度
ENABLE_MESSAGE_FILTER=true              # 启用消息过滤
```

**优势**:
- 无需修改代码即可调整行为
- 不同环境使用不同配置
- 灰度发布更容易

#### 策略 3: 插件化架构

```typescript
// 定义插件接口
interface IMessagePlugin {
  name: string;
  priority: number;
  shouldHandle(message: IncomingMessageData): boolean;
  handle(message: IncomingMessageData): Promise<PluginResult>;
}

// 插件实现：关键词自动回复
@Injectable()
export class KeywordReplyPlugin implements IMessagePlugin {
  name = 'keyword-reply';
  priority = 100;  // 高优先级

  private keywords = new Map([
    ['价格', '请咨询客服获取报价'],
    ['联系方式', '官方微信: xxx'],
  ]);

  shouldHandle(message: IncomingMessageData): boolean {
    return Array.from(this.keywords.keys()).some(k =>
      message.content.includes(k)
    );
  }

  async handle(message: IncomingMessageData): Promise<PluginResult> {
    for (const [keyword, reply] of this.keywords) {
      if (message.content.includes(keyword)) {
        return { handled: true, reply };
      }
    }
    return { handled: false };
  }
}

// 插件实现：AI 智能回复
@Injectable()
export class AIReplyPlugin implements IMessagePlugin {
  name = 'ai-reply';
  priority = 10;  // 低优先级（兜底）

  constructor(private readonly agentService: AgentService) {}

  shouldHandle(message: IncomingMessageData): boolean {
    return true;  // 总是处理
  }

  async handle(message: IncomingMessageData): Promise<PluginResult> {
    const reply = await this.agentService.chat({
      conversationId: message.fromUser,
      userMessage: message.content,
    });
    return { handled: true, reply };
  }
}

// 插件管理器
@Injectable()
export class MessagePluginManager {
  private plugins: IMessagePlugin[] = [];

  constructor(
    private readonly keywordPlugin: KeywordReplyPlugin,
    private readonly aiPlugin: AIReplyPlugin,
  ) {
    this.plugins = [keywordPlugin, aiPlugin]
      .sort((a, b) => b.priority - a.priority);  // 按优先级排序
  }

  async process(message: IncomingMessageData): Promise<string> {
    for (const plugin of this.plugins) {
      if (plugin.shouldHandle(message)) {
        const result = await plugin.handle(message);
        if (result.handled) {
          return result.reply;
        }
      }
    }
    throw new Error('No plugin handled the message');
  }
}
```

**优势**:
- 易于添加新功能（新增插件）
- 灵活调整优先级
- 插件可独立测试
- 支持动态加载（高级功能）

---

## 4. 架构演进路径

### 4.1 演进阶段规划

#### v1.0: MVP（最小可行产品）- 当前阶段 ✅

**架构特点**:
- 单体应用
- 内存存储
- 同步处理
- 单实例部署

**满足场景**:
- 流量: < 100 msg/min
- 用户: < 1000
- 可用性: 99%（允许偶尔重启）

```
┌─────────────────────────────────────┐
│        NestJS Monolith              │
│  ┌─────────┐  ┌──────────┐         │
│  │ Message │→ │  Agent   │         │
│  │ Service │  │  Service │         │
│  └─────────┘  └──────────┘         │
│       ↓              ↓              │
│  ┌─────────────────────┐           │
│  │ Memory Conversation │           │
│  └─────────────────────┘           │
└─────────────────────────────────────┘
```

#### v1.1: 性能优化（1-2 个月） 🔄

**架构升级**:
- 引入 Redis（会话存储）
- 引入 Bull 队列（消息处理）
- 引入 Prometheus（监控）
- 支持多实例部署

**满足场景**:
- 流量: 100-1000 msg/min
- 用户: 1000-10000
- 可用性: 99.9%

```
┌──────────────────────────────────────────┐
│        NestJS Application (多实例)        │
│  ┌─────────┐  ┌──────────┐  ┌─────────┐ │
│  │ Message │→ │  Bull    │→ │  Agent  │ │
│  │ Queue   │  │  Worker  │  │ Service │ │
│  └─────────┘  └──────────┘  └─────────┘ │
└──────────────────┬───────────────────────┘
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
  ┌──────────┐          ┌──────────┐
  │  Redis   │          │Prometheus│
  │(会话存储) │          │ (监控)   │
  └──────────┘          └──────────┘
```

**迁移清单**:
- [ ] 集成 Redis 存储（优先级最高）
- [ ] 实现 Bull 消息队列
- [ ] 添加 Prometheus 指标
- [ ] 部署多实例 + 负载均衡
- [ ] 配置健康检查和自动重启

#### v1.2: 功能扩展（3-6 个月） 📅

**功能增强**:
- Web 管理后台
- 场景识别和多模型切换
- 消息过滤和路由规则
- 定时任务支持

**满足场景**:
- 流量: 1000-5000 msg/min
- 用户: 10000-50000
- 可用性: 99.95%

```
┌────────────────────────────────────────────┐
│           NestJS Backend                   │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  │
│  │ Message │  │  Rule    │  │  Scene   │  │
│  │ Router  │→ │  Engine  │→ │ Detector │  │
│  └─────────┘  └──────────┘  └──────────┘  │
└─────────────────┬──────────────────────────┘
                  │
    ┌─────────────┼─────────────┐
    ▼             ▼             ▼
┌──────┐    ┌──────────┐   ┌──────┐
│Redis │    │PostgreSQL│   │Nginx │
│      │    │(管理后台) │   │(前端)│
└──────┘    └──────────┘   └──────┘
```

#### v2.0: 微服务化（6-12 个月）📅

**架构重构**:
- 拆分 AI 服务
- 拆分消息处理服务
- 引入服务网格
- 引入数据库（持久化）

**满足场景**:
- 流量: 5000-20000 msg/min
- 用户: 50000-200000
- 可用性: 99.99%

```
                    ┌─────────────┐
                    │  API Gateway │
                    └──────┬───────┘
                           │
        ┏━━━━━━━━━━━━━━━━━━┻━━━━━━━━━━━━━━━━━┓
        ▼                  ▼                  ▼
  ┌──────────┐      ┌──────────┐      ┌──────────┐
  │ Message  │      │   AI     │      │  User    │
  │ Service  │─────→│ Service  │      │ Service  │
  └────┬─────┘      └────┬─────┘      └────┬─────┘
       │                 │                  │
       └─────────────────┼──────────────────┘
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
        ┌──────────┐          ┌──────────┐
        │  Redis   │          │PostgreSQL│
        │(缓存/队列)│          │(持久化)  │
        └──────────┘          └──────────┘
```

**迁移策略**:
1. 先拆分 AI 服务（独立扩展）
2. 再拆分消息处理（独立扩展）
3. 共享基础设施（Redis、数据库）
4. 最后拆分其他业务模块

### 4.2 迁移风险控制

#### 灰度发布策略

```typescript
// 特性开关（Feature Flag）
@Injectable()
export class FeatureFlagService {
  constructor(private readonly configService: ConfigService) {}

  isEnabled(feature: string, userId?: string): boolean {
    const rolloutPercent = this.configService.get<number>(
      `FEATURE_${feature}_ROLLOUT`,
      0,
    );

    if (rolloutPercent === 0) return false;
    if (rolloutPercent === 100) return true;

    // 基于用户 ID 的一致性哈希
    if (userId) {
      const hash = this.hashUserId(userId);
      return hash % 100 < rolloutPercent;
    }

    return false;
  }

  private hashUserId(userId: string): number {
    // 简单哈希实现
    return userId.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  }
}

// 使用特性开关
@Injectable()
export class ConversationService {
  constructor(
    private readonly memoryStorage: MemoryConversationStorage,
    private readonly redisStorage: RedisConversationStorage,
    private readonly featureFlag: FeatureFlagService,
  ) {}

  async getHistory(conversationId: string, userId: string): Promise<Message[]> {
    // 灰度发布 Redis 存储
    if (this.featureFlag.isEnabled('REDIS_STORAGE', userId)) {
      return this.redisStorage.get(conversationId);
    }

    // 默认使用内存存储
    return this.memoryStorage.get(conversationId);
  }
}
```

**环境变量**:
```env
# 灰度发布配置
FEATURE_REDIS_STORAGE_ROLLOUT=10    # 10% 用户使用 Redis
FEATURE_REDIS_STORAGE_ROLLOUT=50    # 50% 用户使用 Redis
FEATURE_REDIS_STORAGE_ROLLOUT=100   # 全量使用 Redis
```

#### 数据迁移策略

```typescript
// 双写策略（保证数据一致性）
@Injectable()
export class DualWriteConversationStorage implements IConversationStorage {
  constructor(
    private readonly oldStorage: MemoryConversationStorage,
    private readonly newStorage: RedisConversationStorage,
    private readonly logger: Logger,
  ) {}

  async set(conversationId: string, messages: Message[]): Promise<void> {
    try {
      // 同时写入新旧存储
      await Promise.all([
        this.oldStorage.set(conversationId, messages),
        this.newStorage.set(conversationId, messages),
      ]);
    } catch (error) {
      this.logger.error('双写失败:', error);
      // 保证至少旧存储成功
      await this.oldStorage.set(conversationId, messages);
    }
  }

  async get(conversationId: string): Promise<Message[]> {
    try {
      // 优先读取新存储
      const messages = await this.newStorage.get(conversationId);

      // 验证数据一致性（可选）
      this.verifyConsistency(conversationId, messages);

      return messages;
    } catch (error) {
      this.logger.error('读取新存储失败，降级到旧存储:', error);
      return this.oldStorage.get(conversationId);
    }
  }

  private async verifyConsistency(
    conversationId: string,
    newMessages: Message[],
  ): Promise<void> {
    const oldMessages = await this.oldStorage.get(conversationId);

    if (JSON.stringify(oldMessages) !== JSON.stringify(newMessages)) {
      this.logger.warn('数据不一致:', { conversationId, oldMessages, newMessages });
    }
  }
}
```

**迁移步骤**:
1. **双写阶段**: 同时写入内存和 Redis（1 周）
2. **验证阶段**: 监控数据一致性（1 周）
3. **切换阶段**: 读取切换到 Redis（1 天）
4. **清理阶段**: 移除内存存储代码（1 天）

---

## 5. 性能优化策略

### 5.1 性能优化金字塔

```
           ┌─────────────────┐
           │   业务优化      │  最大收益
           │ (算法、缓存)     │
           └─────────────────┘
          ┌───────────────────┐
          │   架构优化        │  中等收益
          │ (异步、并发)       │
          └───────────────────┘
        ┌─────────────────────┐
        │   代码优化          │  小收益
        │ (循环、数据结构)     │
        └─────────────────────┘
      ┌───────────────────────────┐
      │   基础设施优化            │  微小收益
      │ (CPU、内存、网络)          │
      └───────────────────────────┘
```

**优化原则**: 先优化上层（业务逻辑），再优化下层（基础设施）

### 5.2 关键性能指标

#### 指标体系

| 指标 | 目标值 | 当前值 | 优先级 |
|------|--------|--------|--------|
| **API 响应时间 P95** | < 200ms | ~150ms | 中 |
| **消息处理时长 P95** | < 5s | ~3s | 高 |
| **AI 调用成功率** | > 99.5% | ~99% | 高 |
| **系统吞吐量** | 100 msg/min | ~50 msg/min | 中 |
| **内存占用** | < 512MB | ~200MB | 低 |
| **CPU 使用率** | < 50% | ~20% | 低 |

#### 性能优化实战

##### 优化 1: 缓存常见问题的回复

```typescript
// ❌ 每次都调用 AI
async handleMessage(data: IncomingMessageData) {
  const reply = await this.agentService.chat({
    conversationId: data.fromUser,
    userMessage: data.content,
  });
  return reply;
}

// ✅ 缓存常见问题回复
@Injectable()
export class CachedAgentService {
  private cache = new LRUCache<string, string>({
    max: 1000,           // 最多缓存 1000 条
    ttl: 60 * 60 * 1000, // 1 小时过期
  });

  constructor(private readonly agentService: AgentService) {}

  async chat(params: ChatParams): Promise<string> {
    const cacheKey = this.generateCacheKey(params.userMessage);

    // 1. 查询缓存
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.logger.log('使用缓存回复');
      return cached;
    }

    // 2. 调用 AI
    const reply = await this.agentService.chat(params);

    // 3. 缓存结果（仅对通用问题缓存）
    if (this.isCommonQuestion(params.userMessage)) {
      this.cache.set(cacheKey, reply);
    }

    return reply;
  }

  private isCommonQuestion(message: string): boolean {
    const patterns = [
      /你是谁/,
      /价格/,
      /如何使用/,
      /营业时间/,
    ];
    return patterns.some(p => p.test(message));
  }

  private generateCacheKey(message: string): string {
    // 规范化消息（去除标点、转小写）
    return message.replace(/[^\w\s]/g, '').toLowerCase();
  }
}
```

**性能提升**:
- 常见问题响应时间: 3s → 50ms（60 倍提升）
- AI API 调用量减少: 30-40%
- 成本节省: 30-40%

##### 优化 2: 并行调用外部 API

```typescript
// ❌ 串行调用（慢）
async enrichMessageData(data: IncomingMessageData) {
  const userInfo = await this.getUserInfo(data.fromUser);      // 200ms
  const roomInfo = await this.getRoomInfo(data.roomId);        // 200ms
  const botInfo = await this.getBotInfo(data.botWxid);         // 200ms
  return { ...data, userInfo, roomInfo, botInfo };             // 总计 600ms
}

// ✅ 并行调用（快）
async enrichMessageData(data: IncomingMessageData) {
  const [userInfo, roomInfo, botInfo] = await Promise.all([
    this.getUserInfo(data.fromUser),      // 并行执行
    this.getRoomInfo(data.roomId),        // 并行执行
    this.getBotInfo(data.botWxid),        // 并行执行
  ]);
  return { ...data, userInfo, roomInfo, botInfo };  // 总计 200ms
}
```

**性能提升**: 600ms → 200ms（3 倍提升）

##### 优化 3: 数据库查询优化（未来）

```typescript
// ❌ N+1 查询问题
async getConversationsWithMessages(userIds: string[]) {
  const conversations = [];

  for (const userId of userIds) {
    const conv = await this.convRepo.findOne({ where: { userId } });     // N 次查询
    const messages = await this.msgRepo.find({ where: { convId: conv.id } });  // N 次查询
    conversations.push({ ...conv, messages });
  }

  return conversations;  // 总计 2N 次查询
}

// ✅ 批量查询 + JOIN
async getConversationsWithMessages(userIds: string[]) {
  // 1 次查询（使用 JOIN）
  return this.convRepo
    .createQueryBuilder('conv')
    .leftJoinAndSelect('conv.messages', 'msg')
    .where('conv.userId IN (:...userIds)', { userIds })
    .getMany();
}
```

**性能提升**: O(N) → O(1)

### 5.3 性能监控

```typescript
// 性能监控装饰器
export function Monitor(metricName: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const start = Date.now();
      const histogram = new Histogram({
        name: `${metricName}_duration_seconds`,
        help: `Duration of ${metricName}`,
      });

      try {
        const result = await originalMethod.apply(this, args);

        // 记录成功指标
        histogram.observe((Date.now() - start) / 1000);

        return result;
      } catch (error) {
        // 记录失败指标
        const counter = new Counter({
          name: `${metricName}_errors_total`,
          help: `Errors in ${metricName}`,
        });
        counter.inc();

        throw error;
      }
    };

    return descriptor;
  };
}

// 使用监控装饰器
@Injectable()
export class AgentService {
  @Monitor('agent_chat')
  async chat(params: ChatParams): Promise<string> {
    // 自动监控此方法的性能
    return this.httpClient.post('/chat', params);
  }
}
```

---

## 6. 可扩展性设计

### 6.1 水平扩展 vs 垂直扩展

#### 扩展策略对比

| 策略 | 成本 | 复杂度 | 可用性 | 推荐场景 |
|------|------|--------|--------|----------|
| **垂直扩展** | 高 | 低 | 中 | v1.0-v1.1 单实例优化 |
| **水平扩展** | 中 | 高 | 高 | v1.1+ 多实例部署 |

**当前阶段**: 垂直扩展（升级服务器配置）
**未来阶段**: 水平扩展（多实例 + 负载均衡）

#### 水平扩展的前提条件

```typescript
// ✅ 无状态服务（可水平扩展）
@Injectable()
export class MessageService {
  constructor(
    private readonly redisService: RedisService,  // 状态存储在 Redis
    private readonly agentService: AgentService,
  ) {}

  async handleMessage(data: IncomingMessageData) {
    // 会话状态存储在 Redis，任何实例都可以处理
    const conversationId = this.generateConversationId(data);
    const history = await this.redisService.get(conversationId);

    const reply = await this.agentService.chat({
      conversationId,
      history,
      userMessage: data.content,
    });

    await this.redisService.set(conversationId, [...history, reply]);
  }
}

// ❌ 有状态服务（不可水平扩展）
@Injectable()
export class MessageService {
  // 状态存储在实例内存中
  private conversations = new Map<string, Message[]>();

  async handleMessage(data: IncomingMessageData) {
    // 问题：负载均衡后，同一用户的请求可能分配到不同实例
    const history = this.conversations.get(data.fromUser);
    // 实例 A 的数据在实例 B 上不可见
  }
}
```

**水平扩展 Checklist**:
- [ ] 会话状态迁移到 Redis
- [ ] 文件上传使用对象存储（非本地磁盘）
- [ ] 配置集中管理（环境变量/配置中心）
- [ ] 日志集中收集（ELK/Loki）
- [ ] 使用负载均衡器（Nginx/ALB）

### 6.2 服务拆分策略

#### 拆分原则

**何时拆分**:
- ✅ 单体应用 > 100K LOC
- ✅ 团队 > 10 人
- ✅ 部分模块需要独立扩展
- ✅ 技术栈需要差异化

**何时不拆分**:
- ❌ 团队 < 5 人
- ❌ 流量 < 1000 QPS
- ❌ 为了"微服务"而微服务

#### 拆分顺序

```
Phase 1: 拆分 AI 服务
  理由: AI 调用耗时长，需要独立扩展和优化

Phase 2: 拆分消息处理服务
  理由: 消息量大，需要独立扩展

Phase 3: 拆分其他业务模块
  理由: 业务复杂度增加，需要团队独立维护
```

#### 拆分后的通信

```typescript
// gRPC 服务定义
// ai-service.proto
service AIService {
  rpc Chat (ChatRequest) returns (ChatResponse);
  rpc GetModels (Empty) returns (ModelsResponse);
}

// 客户端调用
@Injectable()
export class MessageService {
  constructor(
    @Inject('AI_SERVICE') private readonly aiClient: AIServiceClient,
  ) {}

  async handleMessage(data: IncomingMessageData) {
    const response = await this.aiClient.chat({
      conversationId: data.fromUser,
      message: data.content,
    });

    return response.reply;
  }
}
```

---

## 7. 可靠性与容错

### 7.1 高可用架构设计

#### 目标可用性

| 等级 | 可用性 | 年停机时间 | 适用场景 |
|------|--------|------------|----------|
| 基础 | 99% | 3.65 天 | 内部工具 |
| 标准 | 99.9% | 8.76 小时 | v1.0 MVP |
| 高可用 | 99.95% | 4.38 小时 | v1.1 生产 |
| 极高可用 | 99.99% | 52.6 分钟 | v2.0 关键业务 |

**当前目标**: 99.9%（v1.0） → 99.95%（v1.1）

#### 单点故障消除

```typescript
// ❌ 单点故障：依赖单一实例
┌────────────┐
│  Client    │
└──────┬─────┘
       │
┌──────▼─────┐
│ NestJS App │  ← 单点故障
└──────┬─────┘
       │
┌──────▼─────┐
│   Redis    │
└────────────┘

// ✅ 高可用：多实例 + 负载均衡
┌────────────┐
│  Client    │
└──────┬─────┘
       │
┌──────▼──────┐
│Load Balancer│
└──┬──────┬───┘
   │      │
┌──▼──┐ ┌▼───┐
│App 1│ │App2│  ← 多实例
└──┬──┘ └┬───┘
   │     │
   └──┬──┘
┌─────▼─────┐
│Redis(主从) │  ← 主从复制
└───────────┘
```

### 7.2 容错策略

#### 策略 1: 超时控制

```typescript
// ❌ 没有超时控制（可能永久阻塞）
async callAIService(message: string) {
  return axios.post('https://api.ai.com/chat', { message });
}

// ✅ 设置超时
async callAIService(message: string) {
  try {
    return await axios.post(
      'https://api.ai.com/chat',
      { message },
      { timeout: 30000 },  // 30 秒超时
    );
  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      throw new TimeoutException('AI 服务响应超时');
    }
    throw error;
  }
}
```

#### 策略 2: 重试机制

```typescript
// 指数退避重试
async callWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000,
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      const isLastAttempt = i === maxRetries - 1;

      if (isLastAttempt) {
        throw error;
      }

      // 指数退避：1s, 2s, 4s
      const delay = baseDelay * Math.pow(2, i);
      this.logger.warn(`重试第 ${i + 1} 次，延迟 ${delay}ms`);
      await this.sleep(delay);
    }
  }
}

// 使用
async callAIService(message: string) {
  return this.callWithRetry(
    () => this.httpClient.post('/chat', { message }),
    3,      // 最多重试 3 次
    1000,   // 初始延迟 1 秒
  );
}
```

#### 策略 3: 熔断器（Circuit Breaker）

```typescript
@Injectable()
export class CircuitBreaker {
  private failureCount = 0;
  private lastFailureTime = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';

  constructor(
    private readonly threshold: number = 5,       // 失败阈值
    private readonly timeout: number = 60000,     // 熔断时长 60s
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // 1. 熔断器打开：直接拒绝
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'HALF_OPEN';  // 进入半开状态
      } else {
        throw new ServiceUnavailableException('服务熔断中');
      }
    }

    try {
      // 2. 执行请求
      const result = await fn();

      // 3. 成功：重置失败计数
      this.onSuccess();
      return result;
    } catch (error) {
      // 4. 失败：增加失败计数
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.threshold) {
      this.state = 'OPEN';  // 打开熔断器
      this.logger.error('熔断器打开');
    }
  }
}

// 使用熔断器
@Injectable()
export class AgentService {
  private circuitBreaker = new CircuitBreaker();

  async chat(params: ChatParams): Promise<string> {
    return this.circuitBreaker.execute(async () => {
      return this.httpClient.post('/chat', params);
    });
  }
}
```

**状态转换**:
```
CLOSED (正常) → OPEN (熔断) → HALF_OPEN (尝试) → CLOSED (恢复)
    ↑                                               │
    └───────────────────────────────────────────────┘
```

#### 策略 4: 降级策略

```typescript
@Injectable()
export class AgentService {
  async chat(params: ChatParams): Promise<string> {
    try {
      // 尝试调用主 AI 服务
      return await this.primaryAI.chat(params);
    } catch (error) {
      this.logger.error('主 AI 服务失败，尝试降级');

      try {
        // 降级到备用 AI 服务
        return await this.fallbackAI.chat(params);
      } catch (fallbackError) {
        this.logger.error('备用 AI 服务也失败，返回默认回复');

        // 最终降级：返回预设回复
        return this.getDefaultReply(params.userMessage);
      }
    }
  }

  private getDefaultReply(message: string): string {
    return '抱歉，服务暂时不可用，请稍后再试。';
  }
}
```

---

## 8. 安全架构

### 8.1 安全威胁模型

#### STRIDE 威胁分析

| 威胁类型 | 描述 | 缓解措施 |
|---------|------|---------|
| **Spoofing（欺骗）** | 伪造 API 请求 | API Key 验证、JWT 认证 |
| **Tampering（篡改）** | 篡改消息内容 | 签名验证、HTTPS |
| **Repudiation（否认）** | 否认操作行为 | 审计日志、操作记录 |
| **Information Disclosure（信息泄露）** | 泄露敏感数据 | 加密存储、脱敏输出 |
| **Denial of Service（拒绝服务）** | 恶意流量攻击 | 限流、熔断 |
| **Elevation of Privilege（权限提升）** | 越权操作 | RBAC、权限校验 |

### 8.2 安全实践

#### 实践 1: API 认证

```typescript
// API Key 认证中间件
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'];

    const validApiKeys = this.configService
      .get<string>('VALID_API_KEYS', '')
      .split(',');

    if (!apiKey || !validApiKeys.includes(apiKey)) {
      throw new UnauthorizedException('Invalid API Key');
    }

    return true;
  }
}

// 使用认证守卫
@Controller('admin')
@UseGuards(ApiKeyGuard)  // 保护整个控制器
export class AdminController {
  // 所有接口都需要 API Key
}
```

#### 实践 2: 请求限流

```typescript
// 基于 IP 的限流
@Injectable()
export class RateLimitGuard implements CanActivate {
  private requests = new Map<string, number[]>();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const ip = request.ip;

    const now = Date.now();
    const windowMs = 60 * 1000;  // 1 分钟窗口
    const maxRequests = 100;      // 最多 100 次请求

    // 获取该 IP 的请求记录
    const timestamps = this.requests.get(ip) || [];

    // 清理过期记录
    const validTimestamps = timestamps.filter(t => now - t < windowMs);

    // 检查是否超限
    if (validTimestamps.length >= maxRequests) {
      throw new TooManyRequestsException('请求过于频繁');
    }

    // 记录本次请求
    validTimestamps.push(now);
    this.requests.set(ip, validTimestamps);

    return true;
  }
}

// 使用限流
@Controller('message')
@UseGuards(RateLimitGuard)
export class MessageController {
  // 每个 IP 每分钟最多 100 次请求
}
```

#### 实践 3: 输入验证和消毒

```typescript
// DTO 验证
export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)  // 防止超长消息
  content: string;

  @IsString()
  @Matches(/^wxid_[a-zA-Z0-9]+$/)  // 验证格式
  toWxid: string;
}

// 内容过滤
@Injectable()
export class ContentFilterService {
  private readonly sensitiveWords = new Set([
    '敏感词1',
    '敏感词2',
    // ...
  ]);

  filter(content: string): string {
    let filtered = content;

    for (const word of this.sensitiveWords) {
      filtered = filtered.replace(new RegExp(word, 'gi'), '***');
    }

    return filtered;
  }

  containsSensitiveWords(content: string): boolean {
    return Array.from(this.sensitiveWords).some(word =>
      content.toLowerCase().includes(word.toLowerCase()),
    );
  }
}
```

#### 实践 4: 敏感数据保护

```typescript
// ❌ 不要在日志中输出敏感信息
this.logger.log(`API Key: ${apiKey}`);  // 危险！

// ✅ 脱敏输出
this.logger.log(`API Key: ${this.maskApiKey(apiKey)}`);

private maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) return '***';
  return apiKey.substring(0, 4) + '***' + apiKey.substring(apiKey.length - 4);
}

// ❌ 不要在错误响应中暴露内部信息
throw new Error(error.stack);  // 危险！暴露堆栈信息

// ✅ 返回通用错误信息
throw new HttpException('操作失败', HttpStatus.INTERNAL_SERVER_ERROR);
// 详细错误记录在服务端日志中
this.logger.error('详细错误信息:', error);
```

---

## 9. 监控与可观测性

### 9.1 可观测性三大支柱

```
┌─────────────────────────────────────────┐
│           可观测性（Observability）      │
├─────────────────────────────────────────┤
│                                         │
│  ┌────────┐  ┌────────┐  ┌────────┐   │
│  │ Metrics│  │  Logs  │  │ Traces │   │
│  │ (指标) │  │ (日志) │  │ (链路) │   │
│  └────────┘  └────────┘  └────────┘   │
│      ↓            ↓           ↓        │
│  Prometheus   Winston     Jaeger       │
│  + Grafana    + ELK     (未来)         │
└─────────────────────────────────────────┘
```

### 9.2 关键监控指标

#### 黄金指标（Golden Signals）

```typescript
@Injectable()
export class MetricsService {
  // 1. Latency（延迟）
  private readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  });

  // 2. Traffic（流量）
  private readonly httpRequests = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status'],
  });

  // 3. Errors（错误率）
  private readonly httpErrors = new Counter({
    name: 'http_errors_total',
    help: 'Total HTTP errors',
    labelNames: ['method', 'route', 'error_type'],
  });

  // 4. Saturation（饱和度）
  private readonly queueSize = new Gauge({
    name: 'message_queue_size',
    help: 'Current message queue size',
  });

  recordHttpRequest(
    method: string,
    route: string,
    status: number,
    duration: number,
  ) {
    // 记录延迟
    this.httpDuration.observe({ method, route, status }, duration);

    // 记录流量
    this.httpRequests.inc({ method, route, status });

    // 记录错误
    if (status >= 400) {
      this.httpErrors.inc({ method, route, error_type: `${status}` });
    }
  }
}
```

#### 业务指标

```typescript
// 业务层面的监控
@Injectable()
export class BusinessMetrics {
  // 消息处理指标
  private readonly messagesProcessed = new Counter({
    name: 'messages_processed_total',
    help: 'Total messages processed',
    labelNames: ['type', 'source'],
  });

  // AI 调用指标
  private readonly aiCalls = new Counter({
    name: 'ai_calls_total',
    help: 'Total AI API calls',
    labelNames: ['model', 'status'],
  });

  private readonly aiTokens = new Counter({
    name: 'ai_tokens_used_total',
    help: 'Total AI tokens used',
    labelNames: ['model', 'type'],
  });

  // 会话指标
  private readonly activeConversations = new Gauge({
    name: 'active_conversations',
    help: 'Number of active conversations',
  });

  recordMessageProcessed(type: string, source: string) {
    this.messagesProcessed.inc({ type, source });
  }

  recordAICall(model: string, status: string, tokens: {
    prompt: number;
    completion: number;
  }) {
    this.aiCalls.inc({ model, status });
    this.aiTokens.inc({ model, type: 'prompt' }, tokens.prompt);
    this.aiTokens.inc({ model, type: 'completion' }, tokens.completion);
  }
}
```

### 9.3 告警规则

```yaml
# Prometheus 告警规则
groups:
  - name: duliday-wecom-service
    interval: 30s
    rules:
      # 错误率告警
      - alert: HighErrorRate
        expr: |
          rate(http_errors_total[5m]) / rate(http_requests_total[5m]) > 0.05
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "错误率过高"
          description: "过去 5 分钟错误率 {{ $value | humanizePercentage }}"

      # 响应时间告警
      - alert: HighLatency
        expr: |
          histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "响应时间过长"
          description: "P95 响应时间 {{ $value }}s"

      # AI 调用失败告警
      - alert: AIServiceDown
        expr: |
          rate(ai_calls_total{status="failed"}[5m]) > 0.1
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "AI 服务异常"
          description: "AI 服务失败率过高"

      # 消息队列积压告警
      - alert: QueueBacklog
        expr: |
          message_queue_size > 1000
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "消息队列积压"
          description: "当前队列大小 {{ $value }}"
```

---

## 10. 架构反模式识别

### 10.1 常见反模式

#### 反模式 1: God Object（上帝对象）

```typescript
// ❌ 反模式：一个类做所有事情
@Injectable()
export class MessageService {
  async handleMessage(data: IncomingMessageData) {
    // 1. 解析消息
    const parsed = this.parseMessage(data);

    // 2. 权限验证
    await this.checkPermission(parsed);

    // 3. 内容审核
    await this.moderateContent(parsed);

    // 4. 调用 AI
    const reply = await this.generateAIReply(parsed);

    // 5. 翻译回复
    const translated = await this.translateReply(reply);

    // 6. 发送消息
    await this.sendReply(translated);

    // 7. 记录分析
    await this.logAnalytics(parsed, translated);

    // 8. 更新用户画像
    await this.updateUserProfile(parsed);

    // 9. 触发工作流
    await this.triggerWorkflow(parsed);
  }

  // ... 100+ 个方法
}

// ✅ 正确：职责分离
@Injectable()
export class MessageService {
  constructor(
    private readonly agentService: AgentService,
    private readonly messageSenderService: MessageSenderService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  async handleMessage(data: IncomingMessageData) {
    // 只负责流程编排
    const reply = await this.agentService.chat({
      conversationId: data.fromUser,
      userMessage: data.content,
    });

    await this.messageSenderService.sendMessage({
      token: data.token,
      content: reply,
      toWxid: data.fromUser,
    });

    // 异步记录（不阻塞主流程）
    this.analyticsService.record(data, reply).catch(err => {
      this.logger.error('记录分析失败:', err);
    });
  }
}
```

#### 反模式 2: Circular Dependency（循环依赖）

```typescript
// ❌ 反模式：循环依赖
// message.service.ts
@Injectable()
export class MessageService {
  constructor(private readonly agentService: AgentService) {}
}

// agent.service.ts
@Injectable()
export class AgentService {
  constructor(private readonly messageService: MessageService) {}  // 循环！
}

// ✅ 正确：通过引入中间层打破循环
// conversation.service.ts（独立的中间层）
@Injectable()
export class ConversationService {
  // 不依赖 MessageService 和 AgentService
}

// message.service.ts
@Injectable()
export class MessageService {
  constructor(
    private readonly agentService: AgentService,
    private readonly conversationService: ConversationService,  // 依赖中间层
  ) {}
}

// agent.service.ts
@Injectable()
export class AgentService {
  constructor(
    private readonly conversationService: ConversationService,  // 依赖中间层
  ) {}
}
```

**检测循环依赖**:
```bash
npx madge --circular --extensions ts src/
```

#### 反模式 3: Leaky Abstraction（泄露抽象）

```typescript
// ❌ 反模式：抽象泄露实现细节
interface IConversationStorage {
  // 泄露了 Redis 的实现细节
  redis: RedisClient;
  get(key: string): Promise<string>;
}

// ✅ 正确：纯粹的抽象
interface IConversationStorage {
  get(conversationId: string): Promise<Message[]>;
  set(conversationId: string, messages: Message[]): Promise<void>;
  delete(conversationId: string): Promise<void>;
  // 不暴露任何实现细节
}
```

#### 反模式 4: Premature Optimization（过早优化）

```typescript
// ❌ 反模式：过早优化（未验证需求就引入复杂缓存）
@Injectable()
export class MessageService {
  // 引入 3 层缓存（L1/L2/L3）
  private l1Cache = new Map();
  private l2Cache: RedisClient;
  private l3Cache: Database;

  async getMessage(id: string) {
    // 检查 L1 缓存
    if (this.l1Cache.has(id)) return this.l1Cache.get(id);

    // 检查 L2 缓存
    const l2Data = await this.l2Cache.get(id);
    if (l2Data) {
      this.l1Cache.set(id, l2Data);
      return l2Data;
    }

    // 检查 L3 缓存
    // ... 更多复杂逻辑
  }
}

// ✅ 正确：从简单开始，按需优化
@Injectable()
export class MessageService {
  async getMessage(id: string) {
    // 先实现基本功能
    return this.database.findById(id);
  }

  // 等性能成为瓶颈时再引入缓存
}
```

**优化的正确顺序**:
1. 实现功能（Make it work）
2. 测试正确性（Make it right）
3. 性能优化（Make it fast）← 最后才考虑

### 10.2 代码异味识别

#### 异味 1: 魔法数字

```typescript
// ❌ 魔法数字
if (messageType === 7) {  // 7 是什么？
  // 处理文本消息
}

// ✅ 使用常量
enum MessageType {
  TEXT = 7,
  IMAGE = 3,
  VOICE = 34,
}

if (messageType === MessageType.TEXT) {
  // 处理文本消息
}
```

#### 异味 2: 长参数列表

```typescript
// ❌ 参数过多
async sendMessage(
  token: string,
  content: string,
  toWxid: string,
  msgType: number,
  roomId: string,
  isRoom: boolean,
  mentionList: string[],
  priority: number,
) {
  // ...
}

// ✅ 使用对象参数
async sendMessage(params: {
  token: string;
  content: string;
  toWxid: string;
  msgType: number;
  roomId?: string;
  isRoom?: boolean;
  mentionList?: string[];
  priority?: number;
}) {
  // ...
}
```

#### 异味 3: 深层嵌套

```typescript
// ❌ 深层嵌套
async handleMessage(data: IncomingMessageData) {
  if (data.messageType === 7) {
    if (!data.isSelf) {
      if (data.isRoom) {
        if (data.mentionSelf) {
          if (this.enableAI) {
            // 业务逻辑深埋在第 5 层
          }
        }
      }
    }
  }
}

// ✅ 提前返回（Guard Clauses）
async handleMessage(data: IncomingMessageData) {
  // 提前过滤不满足条件的情况
  if (data.messageType !== 7) return;
  if (data.isSelf) return;
  if (data.isRoom && !data.mentionSelf) return;
  if (!this.enableAI) return;

  // 业务逻辑在顶层
  await this.processWithAI(data);
}
```

---

## 11. 代码审查的架构视角

### 11.1 架构审查 Checklist

#### Level 1: 结构审查

```
□ 模块划分是否清晰？
  - 职责是否单一？
  - 是否有循环依赖？
  - 模块边界是否明确？

□ 依赖方向是否正确？
  - 是否遵循分层架构？
  - 是否依赖抽象而非具体实现？
  - 是否有违反依赖倒置原则？

□ 文件组织是否合理？
  - 命名是否规范？
  - 位置是否正确？
  - 是否有重复代码？
```

#### Level 2: 设计审查

```
□ 是否遵循 SOLID 原则？
  - 单一职责原则
  - 开闭原则
  - 里氏替换原则
  - 接口隔离原则
  - 依赖倒置原则

□ 是否有设计模式滥用？
  - 是否过度设计？
  - 是否符合当前需求？
  - 是否增加不必要的复杂度？

□ 接口设计是否合理？
  - 参数是否合理？
  - 返回值是否合理？
  - 是否易于测试？
```

#### Level 3: 质量审查

```
□ 错误处理是否完善？
  - 是否有 try-catch？
  - 错误日志是否记录？
  - 是否有降级策略？

□ 性能是否考虑？
  - 是否有明显的性能问题？
  - 是否有不必要的同步操作？
  - 是否有 N+1 查询？

□ 安全是否考虑？
  - 输入是否验证？
  - 敏感信息是否保护？
  - 是否有注入风险？
```

### 11.2 代码审查评论模板

#### 架构层面

```markdown
## 架构建议

### 🔴 Critical（阻塞合并）
- [ ] 发现循环依赖：MessageService ↔ AgentService
  - 建议：引入 ConversationService 作为中间层

### 🟡 Major（建议修改）
- [ ] MessageService 职责过重（300+ 行）
  - 建议：拆分为 MessageProcessor + MessageValidator

### 🟢 Minor（可选优化）
- [ ] 可以使用策略模式优化消息类型处理
  - 参考：docs/design-patterns.md
```

#### 设计层面

```markdown
## 设计建议

### 接口设计
- [ ] `sendMessage` 参数过多（8 个）
  - 建议：使用 DTO 对象封装

### 错误处理
- [ ] 缺少错误处理（第 45 行）
  ```typescript
  // ❌ 当前代码
  const reply = await this.agentService.chat(params);

  // ✅ 建议修改
  try {
    const reply = await this.agentService.chat(params);
  } catch (error) {
    this.logger.error('AI 调用失败:', error);
    throw new HttpException('生成回复失败', HttpStatus.INTERNAL_SERVER_ERROR);
  }
  ```
```

---

## 12. 技术债务管理

### 12.1 技术债务识别

#### 债务分类

| 类别 | 描述 | 影响 | 优先级 |
|------|------|------|--------|
| **架构债务** | 会话存储在内存 | 无法扩展 | 高 |
| **代码债务** | 重复代码、烂代码 | 维护困难 | 中 |
| **测试债务** | 缺少单元测试 | 质量风险 | 中 |
| **文档债务** | 缺少 API 文档 | 使用困难 | 低 |
| **依赖债务** | 依赖版本过旧 | 安全风险 | 低 |

#### 识别技术债务

```typescript
// 🔴 高优先级：架构债务
// 问题：会话存储在内存中，无法水平扩展
@Injectable()
export class ConversationService {
  private conversations = new Map<string, Message[]>();  // 技术债务！
}

// 🟡 中优先级：代码债务
// 问题：重复代码
async sendToUser(content: string, wxid: string) {
  await axios.post('https://api.stride.com/send', { content, wxid });
}
async sendToRoom(content: string, roomId: string) {
  await axios.post('https://api.stride.com/send', { content, roomId });
}
// 应该抽取公共方法

// 🟢 低优先级：文档债务
// 问题：缺少注释
async processMessage(data: any) {  // 没有说明 data 的结构
  // 没有说明这个方法的用途
}
```

### 12.2 技术债务偿还策略

#### 策略 1: 见机行事（Opportunistic）

```typescript
// 在修改相关代码时顺便偿还技术债务
async handleMessage(data: IncomingMessageData) {
  // 原有逻辑
  const reply = await this.generateReply(data);

  // 📝 偿还债务：添加错误处理
  try {
    await this.sendReply(reply);
  } catch (error) {
    this.logger.error('发送失败:', error);
    // 新增重试逻辑
    await this.retryWithBackoff(() => this.sendReply(reply));
  }
}
```

#### 策略 2: 专项偿还（Dedicated）

```typescript
// 专门安排 Sprint 偿还技术债务
// Sprint 6: 技术债务偿还
- [ ] 迁移会话存储到 Redis
- [ ] 重构 MessageService（拆分职责）
- [ ] 添加单元测试（覆盖率 > 80%）
- [ ] 更新 API 文档
```

#### 策略 3: 渐进式重构（Incremental）

```typescript
// 逐步迁移到新实现
@Module({
  providers: [
    // Phase 1: 双写（同时使用新旧实现）
    {
      provide: 'IConversationStorage',
      useClass: DualWriteConversationStorage,  // 双写
    },

    // Phase 2: 切换到新实现
    // {
    //   provide: 'IConversationStorage',
    //   useClass: RedisConversationStorage,  // 新实现
    // },

    // Phase 3: 移除旧实现
    // MemoryConversationStorage 可以删除了
  ],
})
export class ConversationModule {}
```

### 12.3 技术债务追踪

```typescript
// 在代码中标记技术债务
// TODO: [TECH-DEBT] 迁移到 Redis 存储（优先级：高）
// 当前：内存存储，服务重启后丢失
// 目标：Redis 存储，支持多实例
// 预计工作量：3 天
// 负责人：@zhangsan
// 截止日期：2025-11-01
@Injectable()
export class ConversationService {
  private conversations = new Map<string, Message[]>();
}

// FIXME: [TECH-DEBT] 重复代码，需要抽取公共方法（优先级：中）
async sendToUser() { /* ... */ }
async sendToRoom() { /* ... */ }
```

**技术债务看板**:
```
技术债务看板

┌──────────────┬──────────────┬──────────────┐
│   待处理     │   进行中     │   已完成     │
├──────────────┼──────────────┼──────────────┤
│ Redis 迁移   │ 单元测试     │ API 文档     │
│ 消息队列     │              │ 代码重构     │
│ 监控告警     │              │              │
└──────────────┴──────────────┴──────────────┘
```

---

## 总结：架构师的核心职责

作为高级架构师，在指导 AI Agent 开发时，需要关注以下核心要点：

### 🎯 架构设计

1. **保持简单**: 从简单架构开始，按需演进
2. **分层清晰**: 遵循分层架构，依赖方向明确
3. **接口抽象**: 依赖抽象而非具体实现，易于替换

### 📈 系统演进

1. **渐进式**: v1.0 → v1.1 → v2.0，逐步演进
2. **可扩展**: 预留扩展点，但不过度设计
3. **可迁移**: 灰度发布、双写策略、降级方案

### 🛡️ 质量保证

1. **可靠性**: 超时控制、重试机制、熔断降级
2. **安全性**: 认证授权、输入验证、敏感数据保护
3. **可观测**: 指标监控、日志收集、链路追踪

### 🔧 工程实践

1. **代码质量**: SOLID 原则、设计模式、代码审查
2. **性能优化**: 先业务优化，再架构优化，最后基础设施
3. **技术债务**: 识别、追踪、偿还

### 📝 关键原则

```
1. Make it work, make it right, make it fast
   先实现功能，再保证正确，最后优化性能

2. You Aren't Gonna Need It (YAGNI)
   不要实现当前不需要的功能

3. Don't Repeat Yourself (DRY)
   避免重复代码

4. Keep It Simple, Stupid (KISS)
   保持简单

5. Single Responsibility Principle (SRP)
   单一职责原则
```

---

**最后的话**

架构不是一蹴而就的，而是随着业务发展不断演进的过程。作为架构师，要在**当前需求**和**未来扩展**之间找到平衡，既不过度设计，也不忽视扩展性。

本文档提供的是指导思想和最佳实践，具体实施时要根据项目实际情况灵活调整。

**记住**：**最好的架构是能够支撑业务快速发展的架构，而不是最完美的架构。**

---

**文档版本**: v1.0
**最后更新**: 2025-10-14
**维护者**: DuLiDay 架构团队

---

## 附录：参考资源

### 经典书籍
- 《设计模式：可复用面向对象软件的基础》（GoF）
- 《企业应用架构模式》（Martin Fowler）
- 《微服务设计》（Sam Newman）
- 《领域驱动设计》（Eric Evans）
- 《代码整洁之道》（Robert C. Martin）

### 在线资源
- NestJS 官方文档: https://docs.nestjs.com/
- Microservices Patterns: https://microservices.io/
- Martin Fowler's Blog: https://martinfowler.com/
- The Twelve-Factor App: https://12factor.net/

### 项目文档
- [ARCHITECTURE.md](./ARCHITECTURE.md) - 架构设计文档
- [TODO.md](./TODO.md) - 技术债务和未来规划
- [CLAUDE_CODE_GUIDELINES.md](./CLAUDE_CODE_GUIDELINES.md) - 编码规范
