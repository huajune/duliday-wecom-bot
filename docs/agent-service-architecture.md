# Agent 服务架构文档

## 目录
- [1. 架构概述](#1-架构概述)
- [2. 核心组件](#2-核心组件)
- [3. 服务职责](#3-服务职责)
- [4. 数据流](#4-数据流)
- [5. 配置管理](#5-配置管理)
- [6. 缓存策略](#6-缓存策略)
- [7. API 接口](#7-api-接口)
- [8. 错误处理](#8-错误处理)
- [9. 扩展指南](#9-扩展指南)

---

## 1. 架构概述

### 1.1 设计理念

Agent 服务采用**单一职责原则**和**依赖注入**设计模式，将复杂的 AI Agent 集成能力拆分为 4 个核心服务，各司其职：

```
┌─────────────────────────────────────────────────────────────┐
│                      AgentModule                             │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                    AgentController                      │  │
│  │              (HTTP 接口层 - 17个端点)                    │  │
│  └────────────────────────────────────────────────────────┘  │
│                            ↓                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   Agent      │  │   Agent      │  │   Agent      │       │
│  │   Service    │←→│   Registry   │←→│   Cache      │       │
│  │ (API调用层)   │  │   Service    │  │   Service    │       │
│  │  461行代码    │  │  (注册表)     │  │  (缓存管理)   │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│         ↓                   ↓                                 │
│  ┌──────────────────────────────────────────────┐            │
│  │        AgentConfigService (配置管理)          │            │
│  │  - 加载配置文件                                │            │
│  │  - 场景配置管理                                │            │
│  │  - 环境变量解析                                │            │
│  └──────────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────┘
                            ↓
              ┌──────────────────────────┐
              │  外部 Agent API 服务      │
              │  (Claude/OpenAI 等)       │
              └──────────────────────────┘
```

### 1.2 技术栈

| 技术 | 用途 | 版本要求 |
|------|------|---------|
| **NestJS** | 模块化框架 | ^10.0.0 |
| **Axios** | HTTP 客户端 | ^1.6.0 |
| **Upstash Redis** | 分布式缓存 | - |
| **TypeScript** | 类型安全 | ^5.0.0 |
| **ConfigModule** | 配置管理 | @nestjs/config |

### 1.3 文件结构

```
src/agent/
├── agent.module.ts              # 模块定义（32行）
├── agent.controller.ts          # HTTP 控制器（17个API端点）
├── agent.service.ts             # 核心API调用服务（461行）
├── agent-config.service.ts      # 配置档案管理（500行）
├── agent-registry.service.ts    # 模型/工具注册表（402行）
├── agent-cache.service.ts       # 缓存管理服务（336行）
├── context/                     # 配置文件目录
│   └── candidate-consultation/  # 候选人咨询场景
│       ├── profile.json         # 场景元信息
│       ├── system-prompt.md     # 系统提示词
│       ├── context.json         # 上下文配置
│       └── tool-context.json    # 工具上下文
├── dto/                         # 数据传输对象
│   └── chat-request.dto.ts      # 聊天请求/响应定义
├── exceptions/                  # 自定义异常
│   └── agent.exception.ts       # Agent 异常类型
├── interfaces/                  # TypeScript 接口
│   └── agent-profile.interface.ts
└── utils/                       # 工具函数
    └── index.ts                 # 辅助方法
```

---

## 2. 核心组件

### 2.1 AgentService (API 调用层)

**位置**: [src/agent/agent.service.ts](../src/agent/agent.service.ts)
**代码量**: 461 行
**依赖**: `HttpClientFactory`, `AgentCacheService`, `AgentRegistryService`

#### 核心职责
1. **HTTP 客户端管理** - 使用工厂模式创建 Axios 实例
2. **API 调用封装** - 提供 `chat()`, `getModels()`, `getTools()` 等方法
3. **请求重试机制** - 指数退避策略，最多重试 3 次
4. **Token 使用统计** - 记录输入/输出/缓存 Token 数量

#### 关键方法

```typescript
/**
 * 调用 Agent API 的 /chat 接口
 * @returns Promise<ChatResponse>
 */
async chat(params: {
  conversationId: string;
  userMessage: string;
  historyMessages?: SimpleMessage[];
  model?: string;
  systemPrompt?: string;
  allowedTools?: string[];
  context?: any;
  // ... 更多参数
}): Promise<ChatResponse>

/**
 * 使用配置档案调用 chat
 */
async chatWithProfile(
  conversationId: string,
  userMessage: string,
  profile: AgentProfile,
  overrides?: Partial<AgentProfile>
): Promise<ChatResponse>
```

#### 重试策略

| 错误类型 | 重试行为 | 延迟策略 |
|---------|---------|---------|
| **429 频率限制** | 重试，最多 3 次 | 根据 `Retry-After` 头 |
| **500/502/503** | 重试，最多 3 次 | 指数退避 (1s, 2s, 4s) |
| **400/401/403** | 不重试 | 立即失败 |
| **网络错误** | 重试，最多 3 次 | 指数退避 |

---

### 2.2 AgentConfigService (配置管理)

**位置**: [src/agent/agent-config.service.ts](../src/agent/agent-config.service.ts)
**代码量**: 500 行
**特性**: 实现 `OnModuleInit` 钩子，自动加载配置

#### 核心职责
1. **文件系统加载** - 从 `context/` 目录加载配置文件
2. **场景配置管理** - 支持多场景（候选人咨询、客服等）
3. **环境变量解析** - 支持 `${VAR_NAME}` 语法
4. **配置验证** - 检查模型和工具的可用性
5. **运行时更新** - 支持热重载配置

#### 配置文件结构

```json
// context/candidate-consultation/profile.json
{
  "name": "candidate-consultation",
  "description": "候选人私聊咨询服务",
  "model": "${AGENT_DEFAULT_MODEL}",
  "allowedTools": "${AGENT_ALLOWED_TOOLS}",
  "contextStrategy": "skip",
  "prune": true,
  "pruneOptions": {
    "targetTokens": 8000,
    "preserveRecentMessages": 5
  },
  "files": {
    "systemPrompt": "system-prompt.md",
    "context": "context.json",
    "toolContext": "tool-context.json"
  }
}
```

#### 降级处理

当配置文件加载失败时，自动使用环境变量创建**最小化降级配置**：

```typescript
// 降级配置特点：
// ✅ 极简 systemPrompt（只有核心职责）
// ✅ 最小化 context（只有必需的 token）
// ⚠️ 功能受限，建议尽快修复配置文件
```

---

### 2.3 AgentRegistryService (注册表服务)

**位置**: [src/agent/agent-registry.service.ts](../src/agent/agent-registry.service.ts)
**代码量**: 402 行
**特性**: 实现 `OnModuleInit` 钩子，启动时初始化

#### 核心职责
1. **模型注册表** - 管理可用的 AI 模型列表
2. **工具注册表** - 管理 Agent 可用的工具（函数调用）
3. **健康检查** - 定期检查 Agent API 可用性（可选）
4. **资源验证** - 验证请求的模型/工具是否可用

#### 健康检查策略

| 配置项 | 环境变量 | 默认值 | 说明 |
|--------|---------|--------|------|
| 启用健康检查 | `ENABLE_AGENT_HEALTH_CHECK` | `false` | 是否启用 |
| 检查间隔 | `AGENT_HEALTH_CHECK_INTERVAL` | `300000` | 5分钟 |
| 缓存时长 | - | 60秒 | 避免频繁请求 |

#### 模型验证流程

```typescript
// 验证逻辑
validateModel(requestedModel?: string): string {
  // 1. 未指定模型 → 使用默认模型
  // 2. 模型在可用列表中 → 直接使用
  // 3. 模型不可用 → 回退到默认模型（记录警告）
}
```

---

### 2.4 AgentCacheService (缓存管理)

**位置**: [src/agent/agent.service.ts](../src/agent/agent.service.ts)
**代码量**: 336 行
**后端**: Upstash Redis

#### 核心职责
1. **智能缓存判断** - 判断响应是否应该缓存
2. **缓存键生成** - 基于请求参数生成唯一键
3. **TTL 管理** - 不同场景使用不同过期时间
4. **缓存清理** - 支持手动清理和自动过期

#### 缓存策略

| 条件 | 是否缓存 | TTL | 原因 |
|------|---------|-----|------|
| **使用了工具** | ❌ 否 | - | 工具返回动态数据 |
| **包含上下文** | ❌ 否 | - | 上下文可能变化 |
| **纯文本对话** | ✅ 是 | 3600秒 | 响应稳定 |

#### 缓存键生成算法

```typescript
generateCacheKey(params: {
  model: string;
  messages: SimpleMessage[];
  tools?: string[];
  context?: any;
  // ...
}): string {
  // 1. 提取关键字段
  // 2. 序列化为 JSON
  // 3. 计算 MD5 哈希
  // 4. 添加前缀 "agent:chat:"
  return `agent:chat:${md5Hash}`;
}
```

---

## 3. 服务职责

### 3.1 职责分离原则

| 服务 | 核心职责 | 不负责的事情 |
|------|---------|-------------|
| **AgentService** | API 调用、重试、日志 | ❌ 配置管理、❌ 缓存逻辑、❌ 健康检查 |
| **AgentConfigService** | 配置加载、场景管理 | ❌ API 调用、❌ 模型验证 |
| **AgentRegistryService** | 资源注册、验证 | ❌ API 调用、❌ 配置加载 |
| **AgentCacheService** | 缓存管理、键生成 | ❌ API 调用、❌ 业务逻辑 |

### 3.2 依赖关系图

```
AgentController
       ↓
AgentService ←─┬─→ AgentCacheService
               │
               ├─→ AgentRegistryService
               │
               └─→ AgentConfigService ──→ AgentRegistryService
```

> **注意**: `AgentService` 和 `AgentRegistryService` 之间有循环依赖，已通过 `forwardRef` 解决。

---

## 4. 数据流

### 4.1 完整的聊天请求流程

```
┌─────────────────────────────────────────────────────────────┐
│ 1. 接收请求                                                   │
│    POST /agent/chat                                          │
│    Body: { conversationId, message, model?, tools? }        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. 参数验证 (AgentService)                                   │
│    - 检查消息不为空                                           │
│    - 验证模型可用性 (委托给 RegistryService)                   │
│    - 验证工具可用性 (委托给 RegistryService)                   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. 缓存查找 (AgentCacheService)                              │
│    - 生成缓存键 (基于 model + messages + tools)              │
│    - 查询 Redis 缓存                                          │
│    - 命中 → 直接返回（跳到步骤 7）                             │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. 调用 Agent API                                            │
│    POST {AGENT_API_BASE_URL}/chat                           │
│    Headers: { Authorization: Bearer {API_KEY} }             │
│    Body: ChatRequest                                        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. 错误处理与重试                                             │
│    - 429 → 根据 Retry-After 延迟重试                         │
│    - 5xx → 指数退避重试 (1s, 2s, 4s)                         │
│    - 4xx → 立即失败                                           │
│    - 最多重试 3 次                                            │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 6. 响应处理                                                   │
│    - 提取 correlationId                                      │
│    - 记录 Token 使用统计                                      │
│    - 判断是否缓存（委托给 CacheService）                       │
│    - 写入缓存（如果适用）                                      │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 7. 返回结果                                                   │
│    ChatResponse: {                                          │
│      message, usage, tools, correlationId                   │
│    }                                                         │
└───────────────────��─────────────────────────────────────────┘
```

### 4.2 配置加载流程

```
┌─────────────────────────────────────────────────────────────┐
│ 应用启动                                                      │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ AgentConfigService.onModuleInit()                           │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 加载所有配置档案                                              │
│ context/                                                     │
│ └── candidate-consultation/                                 │
│     ├── profile.json ────→ 解析元信息                        │
│     ├── system-prompt.md ─→ 读取系统提示词                    │
│     ├── context.json ─────→ 解析上下文 + 环境变量替换         │
│     └── tool-context.json → 解析工具上下文                    │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 验证配置                                                      │
│ - 检查模型是否可用                                            │
│ - 检查工具是否可用                                            │
│ - 检查工具所需的上下文是否提供                                 │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 注册到内存                                                    │
│ Map<string, AgentProfile>                                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. 配置管理

### 5.1 环境变量

| 变量名 | 必需 | 默认值 | 说明 |
|--------|------|--------|------|
| `AGENT_API_KEY` | ✅ | - | Agent API 密钥 |
| `AGENT_API_BASE_URL` | ✅ | - | Agent API 基础 URL |
| `AGENT_DEFAULT_MODEL` | ✅ | - | 默认 AI 模型 |
| `AGENT_API_TIMEOUT` | ❌ | `120000` | API 超时时间（毫秒） |
| `AGENT_ALLOWED_TOOLS` | ❌ | `""` | 允许的工具列表（逗号分隔） |
| `ENABLE_AGENT_HEALTH_CHECK` | ❌ | `false` | 是否启用健康检查 |
| `AGENT_HEALTH_CHECK_INTERVAL` | ❌ | `300000` | 健康检查间隔（毫秒） |

### 5.2 配置档案 (AgentProfile)

#### 场景配置示例

```json
{
  "name": "candidate-consultation",
  "description": "候选人私聊咨询服务",
  "model": "${AGENT_DEFAULT_MODEL}",
  "allowedTools": ["duliday_job_list", "duliday_job_details"],
  "contextStrategy": "skip",
  "prune": true,
  "pruneOptions": {
    "maxOutputTokens": 4096,
    "targetTokens": 8000,
    "preserveRecentMessages": 5
  },
  "files": {
    "systemPrompt": "system-prompt.md",
    "context": "context.json",
    "toolContext": "tool-context.json"
  }
}
```

#### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | `string` | 场景唯一标识符 |
| `description` | `string` | 场景描述 |
| `model` | `string` | 使用的 AI 模型（支持环境变量） |
| `allowedTools` | `string[]` | 允许的工具列表 |
| `contextStrategy` | `'skip' \| 'error' \| 'report'` | 上下文缺失时的处理策略 |
| `prune` | `boolean` | 是否启用消息裁剪（节省 Token） |
| `pruneOptions` | `object` | 裁剪配置 |

---

## 6. 缓存策略

### 6.1 缓存架构

```
┌───────────────────────────────────────────────────────────┐
│                    Upstash Redis                          │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  agent:chat:{hash}                                   │  │
│  │  TTL: 3600s                                          │  │
│  │  Value: ChatResponse (JSON)                         │  │
│  └─────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────┘
                            ↑
                            │
┌───────────────────────────────────────────────────────────┐
│              AgentCacheService                            │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  shouldCache(params) → boolean                       │  │
│  │  generateCacheKey(params) → string                   │  │
│  │  get(key) → ChatResponse | null                      │  │
│  │  set(key, value, ttl?) → void                        │  │
│  │  clear(pattern?) → void                              │  │
│  └─────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────┘
```

### 6.2 缓存判断逻辑

```typescript
shouldCache(params: {
  usedTools?: string[];
  context?: any;
  toolContext?: any;
}): boolean {
  // 1. 使用了工具 → 不缓存（工具返回动态数据）
  if (usedTools && usedTools.length > 0) {
    return false;
  }

  // 2. 包含上下文 → 不缓存（上下文可能变化）
  if (context || toolContext) {
    return false;
  }

  // 3. 纯文本对话 → 缓存
  return true;
}
```

### 6.3 性能优化

| 优化点 | 说明 | 收益 |
|--------|------|------|
| **缓存命中** | 避免调用 Agent API | 节省 API 成本 + 降低延迟 |
| **智能判断** | 只缓存稳定的响应 | 提高缓存命中率 |
| **自动过期** | Redis TTL 自动清理 | 避免过期数据 |

---

## 7. API 接口

### 7.1 HTTP 端点列表

| 端点 | 方法 | 说明 | 请求体 |
|------|------|------|--------|
| `/agent/health` | GET | 健康检查 | - |
| `/agent/chat` | POST | 聊天接口 | `ChatRequestDto` |
| `/agent/chat/profile` | POST | 使用配置档案聊天 | `ChatWithProfileDto` |
| `/agent/models` | GET | 获取可用模型 | - |
| `/agent/tools` | GET | 获取可用工具 | - |
| `/agent/profiles` | GET | 获取所有配置档案 | - |
| `/agent/profiles/:name` | GET | 获取指定配置档案 | - |
| `/agent/profiles/:name/validate` | GET | 验证配置档案 | - |
| `/agent/profiles/:name/reload` | POST | 重新加载配置 | - |
| `/agent/cache/stats` | GET | 缓存统计 | - |
| `/agent/cache/clear` | POST | 清理缓存 | - |
| `/agent/registry/refresh` | POST | 刷新注册表 | - |
| `/agent/registry/models` | GET | 获取注册的模型 | - |
| `/agent/registry/tools` | GET | 获取注册的工具 | - |
| `/agent/registry/health` | GET | 注册表健康状态 | - |
| `/agent/registry/health/enable` | POST | 启用健康检查 | - |
| `/agent/registry/health/disable` | POST | 禁用健康检查 | - |

### 7.2 核心接口示例

#### POST /agent/chat

```typescript
// 请求
{
  "conversationId": "chat123",
  "message": "你好",
  "model": "claude-3-5-sonnet-20241022",
  "systemPrompt": "你是一个助手",
  "allowedTools": ["duliday_job_list"],
  "historyMessages": [
    { "role": "user", "content": "之前的消息" },
    { "role": "assistant", "content": "之前的回复" }
  ]
}

// 响应
{
  "message": "你好！有什么可以帮助你的吗？",
  "usage": {
    "inputTokens": 120,
    "outputTokens": 45,
    "totalTokens": 165,
    "cachedInputTokens": 0
  },
  "tools": {
    "used": [],
    "skipped": []
  },
  "correlationId": "abc-123-def"
}
```

#### POST /agent/chat/profile

```typescript
// 请求
{
  "conversationId": "chat123",
  "message": "有什么岗位？",
  "profileName": "candidate-consultation",
  "historyMessages": []
}

// 响应
// (与 /agent/chat 相同)
```

---

## 8. 错误处理

### 8.1 自定义异常类型

| 异常类 | HTTP 状态码 | 说明 |
|--------|------------|------|
| `AgentApiException` | 502 | Agent API 调用失败 |
| `AgentConfigException` | 500 | 配置错误 |
| `AgentContextMissingException` | 400 | 缺少必需的上下文 |
| `AgentRateLimitException` | 429 | 请求频率过高 |

### 8.2 错误响应格式

```typescript
// 示例：上下文缺失错误
{
  "statusCode": 400,
  "message": "工具 duliday_job_list 缺少必需的上下文",
  "error": "Bad Request",
  "details": {
    "missingContext": ["dulidayToken"],
    "tools": ["duliday_job_list"]
  }
}
```

### 8.3 错误日志

```typescript
// AgentService 使用 NestJS Logger 记录详细日志
this.logger.error(
  `Agent API 返回失败，会话: ${conversationId}, correlationId: ${correlationId}`,
  errorData
);

// 包含的信息：
// - 会话 ID
// - 关联 ID (correlationId)
// - 错误详情
// - 堆栈跟踪
```

---

## 9. 扩展指南

### 9.1 添加新的场景配置

1. **创建场景目录**
   ```bash
   mkdir -p src/agent/context/customer-service
   ```

2. **创建配置文件**
   ```bash
   # 元信息
   src/agent/context/customer-service/profile.json

   # 系统提示词
   src/agent/context/customer-service/system-prompt.md

   # 上下文配置
   src/agent/context/customer-service/context.json

   # 工具上下文
   src/agent/context/customer-service/tool-context.json
   ```

3. **更新 AgentConfigService**
   ```typescript
   // 在 loadAllProfilesFromFiles() 中添加场景名称
   const profileNames = [
     'candidate-consultation',
     'customer-service' // 新增
   ];
   ```

4. **重启应用**，配置自动加载

### 9.2 添加新的工具（Tool）

1. **在 Agent API 端注册工具**（外部服务）

2. **更新环境变量**
   ```bash
   AGENT_ALLOWED_TOOLS=duliday_job_list,duliday_job_details,new_tool
   ```

3. **在配置档案中启用**
   ```json
   {
     "allowedTools": ["duliday_job_list", "new_tool"]
   }
   ```

4. **提供工具所需的上下文**
   ```json
   // tool-context.json
   {
     "new_tool": {
       "apiKey": "${NEW_TOOL_API_KEY}"
     }
   }
   ```

### 9.3 自定义缓存策略

1. **修改 `AgentCacheService.shouldCache()`**
   ```typescript
   shouldCache(params): boolean {
     // 示例：根据模型决定缓存策略
     if (params.model?.includes('gpt-4')) {
       return true; // GPT-4 响应更稳定，可以缓存
     }

     // 原有逻辑...
   }
   ```

2. **调整 TTL**
   ```typescript
   // 在 set() 方法中
   const ttl = this.determineTtl(response);

   private determineTtl(response: ChatResponse): number {
     // 根据响应内容动态调整 TTL
     if (response.tools?.used?.length > 0) {
       return 60; // 工具响应：1分钟
     }
     return 3600; // 纯文本：1小时
   }
   ```

### 9.4 性能监控

#### 添加监控指标

```typescript
// 在 AgentService 中
private logUsageStats(response: ChatResponse, conversationId: string) {
  // 现有日志...

  // 添加监控上报
  this.metricsService.recordTokenUsage({
    conversationId,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    model: this.defaultModel,
  });
}
```

#### 关键指标

| 指标 | 说明 | 监控方式 |
|------|------|---------|
| **API 响应时间** | Agent API 调用延迟 | Axios 拦截器 |
| **缓存命中率** | 命中次数 / 总请求数 | `AgentCacheService` |
| **Token 使用量** | 每日 Token 消耗 | 日志聚合 |
| **错误率** | 失败请求 / 总请求 | 异常捕获 |

---

## 10. 最佳实践

### 10.1 配置管理

✅ **DO**
- 使用环境变量存储敏感信息（API Key、Token）
- 将配置文件存储在 `context/` 目录，便于管理
- 使用 `${VAR_NAME}` 语法引用环境变量

❌ **DON'T**
- 硬编码 API Key 或 Token
- 在代码中混合配置逻辑
- 忽略配置验证

### 10.2 缓存使用

✅ **DO**
- 只缓存稳定的、可重复的响应
- 设置合理的 TTL，避免过期数据
- 监控缓存命中率，优化策略

❌ **DON'T**
- 缓存包含动态数据的响应（工具调用、上下文）
- 使用无限 TTL
- 忽略缓存清理

### 10.3 错误处理

✅ **DO**
- 使用自定义异常类型，便于区分错误类型
- 记录详细的错误日志（correlationId、会话ID）
- 实现重试机制，提高可靠性

❌ **DON'T**
- 吞掉异常，导致问题难以排查
- 对所有错误都重试（如 4xx 错误）
- 忽略 Agent API 的错误响应

---

## 11. 常见问题

### Q1: 如何切换到不同的 Agent API 服务？

修改环境变量：
```bash
AGENT_API_BASE_URL=https://new-agent-api.com/api/v1
AGENT_API_KEY=your-new-api-key
```

### Q2: 如何禁用缓存？

方法 1: 在 `AgentCacheService.shouldCache()` 中永远返回 `false`
方法 2: 设置 TTL 为 0

### Q3: 如何查看当前加载的配置？

```bash
# 获取所有配置档案
GET /agent/profiles

# 获取指定配置
GET /agent/profiles/candidate-consultation
```

### Q4: 配置文件更新后如何生效？

```bash
# 重新加载指定配置
POST /agent/profiles/candidate-consultation/reload

# 或重启应用
```

---

## 12. 总结

Agent 服务通过**职责分离**和**依赖注入**实现了高内聚、低耦合的架构设计：

| 服务 | 代码量 | 核心职责 |
|------|--------|---------|
| `AgentService` | 461 行 | API 调用、重试、日志 |
| `AgentConfigService` | 500 行 | 配置管理、场景管理 |
| `AgentRegistryService` | 402 行 | 资源注册、验证 |
| `AgentCacheService` | 336 行 | 缓存管理、键生成 |

总计约 **1,700 行**核心业务代码，支持：
- ✅ 17 个 HTTP API 端点
- ✅ 完整的错误处理和重试机制
- ✅ 智能缓存策略（节省 API 成本）
- ✅ 多场景配置管理
- ✅ 健康检查和监控

该架构易于扩展、维护和测试，为企业级 AI Agent 集成提供了坚实的基础。
