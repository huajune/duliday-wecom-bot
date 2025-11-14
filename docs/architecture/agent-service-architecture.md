# Agent 服务架构文档

> 企业微信 AI Agent 服务的封装与实现

**最后更新**: 2025-11-13
**作者**: DuLiDay Team

---

## 📋 目录

1. [概述](#1-概述)
2. [核心概念](#2-核心概念)
3. [架构设计](#3-架构设计)
4. [关键设计改进](#4-关键设计改进2025-11-13)

---

## 1. 概述

### 1.1 服务定位

Agent 服务封装花卷 Agent API，为企业微信消息处理提供 AI 对话能力。

#### 四个核心职责

**1. 封装 HTTP 调用**
- 消息服务调用 `agentService.chat(params)` 即可，无需处理 HTTP 细节
- TypeScript 类型检查避免参数错误

**2. 管理上下文工程**
- 通过配置目录 `src/agent/profiles/<场景名>/` 管理场景
- 品牌配置通过 BrandConfigService 从 Supabase 动态获取并合并到 context

**3. 智能缓存**
- 纯文本问题缓存 1 小时，成本降低 30-40%
- 工具调用不缓存，保证实时性

**4. 自动重试**
- 429/5xx 错误自动重试，成功率从 85% 提升到 98%

### 1.2 架构总览

```
候选人消息 → MessageService
    ↓
1. ProfileLoaderService
   加载场景配置（system-prompt.md、context.json、tool-context.json）
    ↓
2. BrandConfigService
   从 Supabase 获取最新品牌配置，动态合并到 context
    ↓
3. AgentRegistryService
   验证模型和工具可用性
    ↓
4. AgentCacheService
   查 Redis，命中直接返回
    ↓
5. AgentService
   调用花卷 API，失败自动重试3次
    ↓
返回 AI 回复 → MessageService 发送给用户
```

---

## 2. 核心概念

### 2.1 上下文工程

**目录结构**：
```
src/agent/profiles/candidate-consultation/
├── profile.json        # API 调用配置：模型、工具权限、裁剪策略
├── system-prompt.md    # AI 角色定义：身份、职责、约束
├── context.json        # 业务知识库：公司信息、业务规则
└── tool-context.json   # 工具上下文配置：工具话术（JSON 格式）
```

**核心价值**：
- 业务可配置：产品经理可直接修改 AI 行为
- 版本管理：配置文件纳入 Git，可追溯变更
- 环境隔离：通过环境变量支持开发/生产环境

### 2.2 Profile 配置（profile.json）

**完整示例**：
```json
{
  "name": "candidate-consultation",
  "model": "${AGENT_DEFAULT_MODEL}",
  "allowedTools": ["duliday_job_list", "duliday_job_details"],
  "prune": true,
  "pruneOptions": {
    "targetTokens": 8000,
    "preserveRecentMessages": 5,
    "preserveToolCalls": true
  }
}
```

**核心字段**：
| 字段 | 说明 | 示例 |
|------|------|------|
| `name` | 场景标识，需与目录名一致 | `"candidate-consultation"` |
| `model` | 模型，支持环境变量 | `"${AGENT_DEFAULT_MODEL}"` |
| `allowedTools` | 允许调用的工具列表 | `["duliday_job_list"]` |
| `prune` | 是否启用消息裁剪 | `true` |

### 2.3 智能缓存

**缓存判断逻辑**：
```typescript
shouldCache(params: ChatParams, response: ChatResponse): boolean {
  if (response.toolCalls?.length > 0) return false; // 工具调用不缓存
  if (params.context && Object.keys(params.context).length > 0) return false; // 个性化内容不缓存
  return true; // 纯文本缓存
}
```

**缓存场景**：
| 用户问题 | 是否缓存 | 原因 |
|----------|----------|------|
| "服务哪些城市？" | ✅ 缓存 | 答案稳定 |
| "有哪些兼职？" | ❌ 不缓存 | 调用工具，实时数据 |

### 2.4 容错重试

**重试策略**：
- **429 频率限制**：按 `Retry-After` 头等待
- **5xx 服务器错误**：指数退避（1s → 2s → 4s）
- **4xx 客户端错误**：立即失败（重试无意义）

---

## 3. 架构设计

### 3.1 服务职责划分

```
┌─────────────────────────────┐
│ MessageService               │  协调消息处理
└───────────┬─────────────────┘
            │
   ┌────────┼────────┐
   │        │        │
   ▼        ▼        ▼
ProfileLoader  BrandConfig  AgentRegistry
   │              │            │
   └──────────────┼────────────┘
                  │
           ┌──────▼──────┐
           │ AgentCache   │
           └──────┬───────┘
                  │
           ┌──────▼──────┐
           │ AgentService │  调用花卷 API
           └─────────────┘
```

**服务接口**：
```typescript
// ProfileLoaderService：配置加载
loadProfile(name: string): AgentProfile;

// BrandConfigService：品牌配置
getBrandConfig(): Promise<BrandConfig | null>;

// AgentRegistryService：资源验证
validateModel(model: string): string;
validateTools(tools: string[]): void;

// AgentCacheService：缓存管理
get(key: string): Promise<ChatResponse | null>;
shouldCache(params, response): boolean;

// AgentService：API 调用
chat(params: ChatParams): Promise<ChatResponse>;
chatWithRetry(params: ChatParams): Promise<ChatResponse>;
```

### 3.2 配置驱动设计

**新增场景流程**：
```bash
# 1. 复制场景配置
cp -r src/agent/profiles/candidate-consultation/ src/agent/profiles/new-scenario/

# 2. 修改配置文件
vim src/agent/profiles/new-scenario/profile.json       # 场景名、工具权限
vim src/agent/profiles/new-scenario/system-prompt.md   # AI 角色
vim src/agent/profiles/new-scenario/context.json       # 业务知识
vim src/agent/profiles/new-scenario/tool-context.json  # 工具话术

# 3. 重启服务（自动加载）
pnpm run start:dev
```

**无需修改代码**，只需配置文件即可新增场景。

### 3.3 容错降级

**降级策略矩阵**：
| 故障类型 | 降级策略 | 用户体验 |
|----------|----------|----------|
| 配置文件缺失 | 使用默认配置 | 功能受限 |
| 模型不可用 | 回退到默认模型 | 响应质量下降 |
| 工具不可用 | 禁用该工具 | 无法调用工具 |
| Redis 故障 | 跳过缓存 | 响应变慢 |
| API 临时失败 | 自动重试 3 次 | 无感知 |

### 3.4 服务协作流程

**MessageService 处理企微消息**：
```typescript
async processMessage(messageData: MessageCallbackDto) {
  // 1. 加载场景配置
  const profile = this.profileLoader.getProfile('candidate-consultation');

  // 2. 动态合并最新品牌配置（从 Supabase + Redis）
  const mergedContext = await this.mergeLatestBrandConfig(profile.context);

  // 3. 验证资源
  const validatedModel = this.registryService.validateModel(profile.model);

  // 4. 查询缓存
  const cached = await this.cacheService.get(cacheKey);
  if (cached) return cached;

  // 5. 调用 API（使用合并后的 context）
  const response = await this.agentService.chat({
    conversationId: chatId,
    userMessage: content,
    model: validatedModel,
    systemPrompt: profile.systemPrompt,
    context: mergedContext,              // ✅ 动态合并品牌配置
    allowedTools: profile.allowedTools,
    toolContext: profile.toolContext
  });

  // 6. 发送回复给用户
  await this.messageSender.sendMessage({ ... });

  // 7. 标记消息为已处理（成功后才标记）
  this.deduplicationService.markMessageAsProcessed(messageId);
}

// 合并最新品牌配置到 context
private async mergeLatestBrandConfig(baseContext?: any): Promise<any> {
  try {
    const brandConfig = await this.brandConfigService.getBrandConfig();
    if (!brandConfig) return baseContext || {};

    return {
      ...(baseContext || {}),
      brandData: brandConfig.brandData,
      replyPrompts: brandConfig.replyPrompts,
    };
  } catch (error) {
    this.logger.error('❌ 合并品牌配置失败，使用基础 context:', error);
    return baseContext || {};
  }
}
```


---

## 相关文档

- [花卷 Agent API 使用指南](../guides/huajune-agent-api-guide.md)
- [消息服务架构](message-service-architecture.md)
- [代码规范](../../.claude/agents/code-standards.md)
- [架构原则](../../.claude/agents/architecture-principles.md)

---

**维护者**: DuLiDay Team
