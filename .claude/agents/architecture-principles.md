---
name: architecture-principles
role: system
model: sonnet
visibility: global
description: >
  系统架构设计原则、分层架构、SOLID原则、设计模式指导。
  用于指导模块划分、依赖管理和架构决策。

tags:
  - architecture
  - design-patterns
  - solid-principles
  - layering

priority: high
---

# Architecture Principles & Design Patterns

> System architecture guidelines and design patterns for the DuLiDay WeChat Service

**Last Updated**: 2024-10-15
**Scope**: System design, module structure, and architectural decisions

---

## 📋 Table of Contents

- [Architectural Philosophy](#architectural-philosophy)
- [Layered Architecture](#layered-architecture)
- [SOLID Principles](#solid-principles)
- [Design Patterns](#design-patterns)
- [Module Organization](#module-organization)
- [Dependency Management](#dependency-management)
- [Anti-Patterns to Avoid](#anti-patterns-to-avoid)

---

## Architectural Philosophy

### Core Principles

#### 🎯 Simplicity Over Complexity

```
"A complex system that works is invariably found to have evolved from
a simple system that worked." — John Gall
```

**Guidelines:**
- Start simple, add complexity only when needed
- Don't build for imaginary future requirements (YAGNI)
- Prefer proven solutions over new experiments
- Refactor as you grow, don't over-architect upfront

**Example:**

```typescript
// ❌ Over-engineered for current needs
interface IMessageProcessor {
  process(message: Message): Promise<void>;
}
interface IMessageValidator { validate(message: Message): boolean; }
interface IMessageRouter { route(message: Message): Destination; }
interface IMessageTransformer { transform(message: Message): Message; }
// ... 10+ interfaces for simple message handling

// ✅ Simple and practical for current needs
@Injectable()
export class MessageService {
  async handleMessage(message: IncomingMessageData): Promise<void> {
    // Direct implementation, refactor when complexity grows
  }
}
```

#### 🏗️ Do One Thing Well (Unix Philosophy)

Each service should have a single, well-defined responsibility.

```typescript
// ❌ God object - does everything
@Injectable()
export class MessageService {
  async handleMessage(data: IncomingMessageData) {
    // 1. Parse message
    // 2. Validate permissions
    // 3. Call AI
    // 4. Translate reply
    // 5. Moderate content
    // 6. Send message
    // 7. Log analytics
    // 8. Update user profile
    // ... 100+ lines of mixed responsibilities
  }
}

// ✅ Single responsibility - orchestrates workflow
@Injectable()
export class MessageService {
  constructor(
    private readonly agentService: AgentService,
    private readonly senderService: MessageSenderService,
    private readonly conversationService: ConversationService,
  ) {}

  async handleMessage(data: IncomingMessageData) {
    // Only orchestrates the workflow
    const conversationId = this.conversationService.generateId(
      data.contactId,
      data.roomId,
      data.isRoom,
    );

    const reply = await this.agentService.chat({
      conversationId,
      userMessage: data.content,
    });

    await this.senderService.sendMessage({
      token: data.token,
      content: reply,
      toWxid: data.contactId,
    });
  }
}
```

---

## Layered Architecture

### Four-Layer Architecture

```
┌─────────────────────────────────────────┐
│  Presentation Layer (Controllers)       │  ← HTTP/API
│  - Request validation                   │
│  - Response formatting                  │
└───────────────┬─────────────────────────┘
                │
┌───────────────▼─────────────────────────┐
│  Business Logic Layer (Services)        │  ← Core Logic
│  - Business rules                       │
│  - Workflow orchestration               │
└───────────────┬─────────────────────────┘
                │
┌───────────────▼─────────────────────────┐
│  Common Layer (Shared Services)         │  ← Utilities
│  - Conversation management              │
│  - Shared utilities                     │
└───────────────┬─────────────────────────┘
                │
┌───────────────▼─────────────────────────┐
│  Infrastructure Layer (Core)            │  ← Foundation
│  - HTTP client, Config, Logger          │
│  - External integrations                │
└─────────────────────────────────────────┘
```

### Layer Rules

**Dependency Direction:**
- ✅ Higher layers can depend on lower layers
- ✅ Business layer can skip Common and use Infrastructure directly
- ❌ Lower layers NEVER depend on higher layers
- ❌ NO circular dependencies at any level

**Project Structure:**

```
src/
├── core/                    # Infrastructure Layer
│   ├── config/             # Configuration management
│   └── http/               # HTTP client wrapper
│
├── common/                  # Common Layer
│   └── conversation/       # Conversation management
│
├── agent/                   # AI Integration Layer
│   ├── agent.service.ts    # AI service
│   └── agent-config.service.ts
│
└── modules/                 # Business Layer
    ├── message/            # Message handling
    ├── message-sender/     # Message sending
    ├── chat/               # Chat operations
    ├── contact/            # Contact management
    └── room/               # Room management
```

**Validation:**

```bash
# Check for circular dependencies
npx madge --circular --extensions ts src/
```

---

## SOLID Principles

### Single Responsibility Principle (SRP)

Each class should have one reason to change.

```typescript
// ✅ Correct: Separate responsibilities
@Injectable()
export class MessageService {
  // Only handles message processing logic
  async handleMessage(data: IncomingMessageData) {
    // Processing only
  }
}

@Injectable()
export class MessageSenderService {
  // Only handles message sending
  async sendMessage(dto: SendMessageDto) {
    // Sending only
  }
}

// ❌ Wrong: Too many responsibilities
@Injectable()
export class MessageService {
  async handleMessage(data: IncomingMessageData) {
    // Process, validate, send, log, analyze...
    // Too many reasons to change
  }
}
```

### Open/Closed Principle (OCP)

Open for extension, closed for modification.

```typescript
// ✅ Extensible through interfaces
interface IConversationStorage {
  get(conversationId: string): Promise<Message[]>;
  set(conversationId: string, messages: Message[]): Promise<void>;
}

// Implementation 1: Memory (v1.0)
@Injectable()
export class MemoryConversationStorage implements IConversationStorage {
  private store = new Map<string, Message[]>();

  async get(conversationId: string): Promise<Message[]> {
    return this.store.get(conversationId) || [];
  }

  async set(conversationId: string, messages: Message[]): Promise<void> {
    this.store.set(conversationId, messages);
  }
}

// Implementation 2: Redis (v1.1) - extends without modifying interface
@Injectable()
export class RedisConversationStorage implements IConversationStorage {
  constructor(private readonly redis: RedisService) {}

  async get(conversationId: string): Promise<Message[]> {
    const data = await this.redis.get(conversationId);
    return JSON.parse(data || '[]');
  }

  async set(conversationId: string, messages: Message[]): Promise<void> {
    await this.redis.set(conversationId, JSON.stringify(messages));
  }
}
```

### Liskov Substitution Principle (LSP)

Subtypes must be substitutable for their base types.

```typescript
// ✅ Correct: All implementations honor the contract
interface IMessageSender {
  send(message: string, recipient: string): Promise<void>;
}

class WeChatSender implements IMessageSender {
  async send(message: string, recipient: string): Promise<void> {
    // Always sends the message
  }
}

class EmailSender implements IMessageSender {
  async send(message: string, recipient: string): Promise<void> {
    // Always sends the message
  }
}

// ❌ Wrong: Violates LSP
class LoggingOnlySender implements IMessageSender {
  async send(message: string, recipient: string): Promise<void> {
    // Only logs, doesn't actually send - violates contract!
    console.log(`Would send: ${message}`);
  }
}
```

### Interface Segregation Principle (ISP)

Clients should not depend on interfaces they don't use.

```typescript
// ❌ Wrong: Fat interface
interface IMessage {
  send(): Promise<void>;
  receive(): Promise<void>;
  forward(): Promise<void>;
  delete(): Promise<void>;
  archive(): Promise<void>;
  // ... many methods
}

// ✅ Correct: Segregated interfaces
interface IMessageSender {
  send(): Promise<void>;
}

interface IMessageReceiver {
  receive(): Promise<void>;
}

interface IMessageManager {
  delete(): Promise<void>;
  archive(): Promise<void>;
}

// Use only what you need
class SimpleSender implements IMessageSender {
  async send(): Promise<void> {
    // Only implements send
  }
}
```

### Dependency Inversion Principle (DIP)

Depend on abstractions, not concretions.

```typescript
// ❌ Wrong: Depends on concrete implementation
@Injectable()
export class MessageService {
  async handleMessage(data: IncomingMessageData) {
    // Direct dependency on axios
    const response = await axios.post('https://api.ai.com/chat', data);
  }
}

// ✅ Correct: Depends on abstraction
@Injectable()
export class MessageService {
  constructor(
    private readonly agentService: AgentService,  // Abstraction
  ) {}

  async handleMessage(data: IncomingMessageData) {
    const response = await this.agentService.chat({
      conversationId: data.fromUser,
      userMessage: data.content,
    });
  }
}
```

---

## Design Patterns

### Strategy Pattern

Use when you need to switch between different algorithms.

```typescript
// Strategy interface
interface IMessageProcessor {
  process(message: IncomingMessageData): Promise<void>;
}

// Concrete strategies
@Injectable()
export class TextMessageProcessor implements IMessageProcessor {
  async process(message: IncomingMessageData): Promise<void> {
    // Handle text messages
  }
}

@Injectable()
export class ImageMessageProcessor implements IMessageProcessor {
  async process(message: IncomingMessageData): Promise<void> {
    // Handle image messages
  }
}

// Context
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

### Factory Pattern

Use for creating objects with complex initialization.

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

// Usage
const conversationId = this.conversationFactory.create('user', 'wxid_123');
```

### Decorator Pattern (NestJS Built-in)

```typescript
// Custom decorator for performance monitoring
export function Monitor(metricName: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const start = Date.now();

      try {
        const result = await originalMethod.apply(this, args);
        const duration = Date.now() - start;
        console.log(`${metricName} took ${duration}ms`);
        return result;
      } catch (error) {
        console.error(`${metricName} failed:`, error);
        throw error;
      }
    };

    return descriptor;
  };
}

// Usage
@Injectable()
export class AgentService {
  @Monitor('agent_chat')
  async chat(params: ChatParams): Promise<string> {
    // Automatically monitored
  }
}
```

---

## Module Organization

### Module Structure

```
feature-module/
├── feature.module.ts        # Module definition
├── feature.service.ts       # Business logic
├── feature.controller.ts    # API endpoints
├── dto/                     # DTOs
│   ├── create-feature.dto.ts
│   └── update-feature.dto.ts
├── interfaces/              # Type definitions
│   └── feature.interface.ts
└── __tests__/              # Tests
    ├── feature.service.spec.ts
    └── feature.controller.spec.ts
```

### Module Definition

```typescript
import { Module } from '@nestjs/common';
import { FeatureController } from './feature.controller';
import { FeatureService } from './feature.service';
import { DependencyModule } from '../dependency/dependency.module';

@Module({
  imports: [DependencyModule],      // Import other modules
  controllers: [FeatureController], // Register controllers
  providers: [FeatureService],      // Register services
  exports: [FeatureService],        // Export for other modules
})
export class FeatureModule {}
```

### Feature Flags for Evolution

```typescript
@Injectable()
export class FeatureFlagService {
  constructor(private readonly configService: ConfigService) {}

  isEnabled(feature: string): boolean {
    return this.configService.get<boolean>(`FEATURE_${feature}`, false);
  }
}

// Usage
@Injectable()
export class ConversationService {
  constructor(
    private readonly memoryStorage: MemoryStorage,
    private readonly redisStorage: RedisStorage,
    private readonly featureFlag: FeatureFlagService,
  ) {}

  async getHistory(conversationId: string): Promise<Message[]> {
    // Gradual rollout of Redis storage
    if (this.featureFlag.isEnabled('REDIS_STORAGE')) {
      return this.redisStorage.get(conversationId);
    }

    return this.memoryStorage.get(conversationId);
  }
}
```

---

## Dependency Management

### Dependency Injection

```typescript
// ✅ Always use constructor injection
@Injectable()
export class MessageService {
  constructor(
    private readonly agentService: AgentService,
    private readonly senderService: MessageSenderService,
    private readonly logger: Logger,
  ) {}
}

// ❌ NEVER instantiate dependencies manually
@Injectable()
export class MessageService {
  private agentService = new AgentService();  // WRONG!
}
```

### Circular Dependency Prevention

```typescript
// ❌ Circular dependency
// message.service.ts
@Injectable()
export class MessageService {
  constructor(private readonly agentService: AgentService) {}
}

// agent.service.ts
@Injectable()
export class AgentService {
  constructor(private readonly messageService: MessageService) {}  // Circular!
}

// ✅ Solution: Introduce intermediate layer
// conversation.service.ts
@Injectable()
export class ConversationService {
  // Shared logic, no dependency on Message or Agent
}

// message.service.ts
@Injectable()
export class MessageService {
  constructor(
    private readonly agentService: AgentService,
    private readonly conversationService: ConversationService,
  ) {}
}

// agent.service.ts
@Injectable()
export class AgentService {
  constructor(
    private readonly conversationService: ConversationService,
  ) {}
}
```

---

## Anti-Patterns to Avoid

### God Object

```typescript
// ❌ Anti-pattern: One class doing everything
@Injectable()
export class MessageService {
  // 50+ methods, 500+ lines
  async handleMessage() {}
  async parseMessage() {}
  async validatePermission() {}
  async callAI() {}
  async translateReply() {}
  async sendMessage() {}
  async logAnalytics() {}
  async updateUserProfile() {}
  // ... many more
}

// ✅ Correct: Separate responsibilities
@Injectable()
export class MessageService {
  constructor(
    private readonly agentService: AgentService,
    private readonly senderService: MessageSenderService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  async handleMessage(data: IncomingMessageData) {
    // Only orchestrates, delegates to specialized services
  }
}
```

### Leaky Abstraction

```typescript
// ❌ Abstraction leaks implementation details
interface IConversationStorage {
  redis: RedisClient;  // Leaks Redis implementation!
  get(key: string): Promise<string>;
}

// ✅ Pure abstraction
interface IConversationStorage {
  get(conversationId: string): Promise<Message[]>;
  set(conversationId: string, messages: Message[]): Promise<void>;
  delete(conversationId: string): Promise<void>;
  // No implementation details exposed
}
```

### Premature Optimization

```typescript
// ❌ Over-optimized before needed
@Injectable()
export class MessageService {
  // Complex 3-tier cache before proving it's needed
  private l1Cache = new Map();
  private l2Cache: RedisClient;
  private l3Cache: Database;

  async getMessage(id: string) {
    // Complex cache logic...
  }
}

// ✅ Start simple, optimize when needed
@Injectable()
export class MessageService {
  async getMessage(id: string) {
    // Simple implementation first
    return this.database.findById(id);
  }

  // Add cache later when performance becomes an issue
}
```

### Magic Numbers

```typescript
// ❌ Magic numbers
if (messageType === 7) {  // What is 7?
  // Handle text message
}

// ✅ Named constants
enum MessageType {
  TEXT = 7,
  IMAGE = 3,
  VOICE = 34,
}

if (messageType === MessageType.TEXT) {
  // Clear intent
}
```

---

## Architecture Decision Records (ADR)

### ADR Template

```markdown
# ADR-001: Choose NestJS as Backend Framework

## Context
Need to build an enterprise WeChat intelligent reply service that is modular, scalable, and maintainable.

## Decision
Use NestJS instead of Express/Koa/Fastify.

## Rationale
- ✅ Built-in dependency injection (IoC container)
- ✅ Native TypeScript support
- ✅ Modular architecture (like Spring Boot)
- ✅ Rich ecosystem (Swagger, testing, validation)
- ✅ Best choice for enterprise projects

## Consequences
- Learning curve (decorators, DI concepts)
- Heavier framework (acceptable for enterprise use)

## Status
Accepted
```

---

## Evolution Strategy

### Current State (v1.0)

```
Single Application
- Memory storage
- Synchronous processing
- Single instance
```

### Future State (v1.1+)

```
Scalable Application
- Redis storage
- Message queue (Bull)
- Multiple instances
- Monitoring (Prometheus)
```

### Migration Approach

**Gradual Evolution:**
1. Keep interfaces stable
2. Implement new features behind feature flags
3. Dual-write during migration
4. Validate before full cutover
5. Remove old code only after validation

---

## Best Practices Summary

✅ **DO:**
- Keep services focused (single responsibility)
- Use dependency injection
- Depend on abstractions, not concretions
- Design for testability
- Use feature flags for gradual rollout
- Document architectural decisions (ADRs)

❌ **DON'T:**
- Create god objects
- Hard-code dependencies
- Create circular dependencies
- Over-engineer for unknown future needs
- Expose implementation details in interfaces
- Optimize prematurely

---

**Next Steps:**
- Review [code-standards.md](code-standards.md) for coding conventions
- Check [development-workflow.md](development-workflow.md) for development practices
- See [performance-optimization.md](performance-optimization.md) for performance tuning
