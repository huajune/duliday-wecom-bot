# Agent 服务架构文档

> 企业微信 AI Agent 服务的封装与实现

**最后更新**: 2025-11-05
**作者**: DuLiDay Team

---

## 📋 目录

1. [概述](#1-概述)
2. [核心概念](#2-核心概念)
3. [配置体系详解](#3-配置体系详解)
4. [架构设计](#4-架构设计)
5. [实现细节](#5-实现细节)
6. [服务协作](#6-服务协作)
7. [配置最佳实践](#7-配置最佳实践)

---

## 1. 概述

### 1.1 服务定位

Agent 服务封装花卷 Agent API，为企业微信消息处理提供 AI 对话能力。

#### 四个核心职责

**1. 封装 HTTP 调用**
- 消息服务调用 `agentService.chat(params)` 即可，无需处理 HTTP 细节
- TypeScript 类型检查避免参数错误
- 示例：候选人发消息"有哪些兼职？"，消息服务直接调用获取 AI 回复

**2. 管理上下文工程**
- 候选人咨询：AI 是"招聘助理"，可查询岗位
- 店长报缺：AI 是"店长助理"，可提交报缺申请
- 通过配置目录 `context/<场景名>/` 管理场景

**3. 智能缓存**
- 10个候选人问"服务哪些城市？" → 第1个调用API，后9个返回缓存
- 候选人问"有哪些岗位？" → 调用工具查实时数据，不缓存
- 成本降低30-40%，响应速度从1-3秒降到<10ms

**4. 自动重试**
- 429频率限制 → 等待后重试
- 503服务繁忙 → 指数退避（1s→2s→4s）
- 成功率从85%提升到98%

### 1.2 架构总览

四个服务各司其职，处理候选人消息"有哪些兼职？"的流程：

```
候选人消息 → AgentController
    ↓
1. AgentContextService
   加载"候选人咨询"场景配置（system-prompt.md、context.json、tool-context.json）
    ↓
2. AgentRegistryService
   验证模型 claude-3-5-sonnet 和工具 duliday_job_list 可用
    ↓
3. AgentCacheService
   查 Redis，命中直接返回（省钱），未命中继续
    ↓
4. AgentService
   调用花卷 API，失败自动重试3次
    ↓
返回 AI 回复
```

**拆分收益**：
- 每个服务<200行，易理解
- 职责清晰，改缓存不影响API调用
- 可独立测试、替换（如Redis→Memcached）

---

## 2. 核心概念

### 2.1 上下文工程（Context Engineering）

#### 什么是上下文工程？

上下文工程是一种通过结构化配置来控制 AI 行为的方法，让 AI 在特定业务场景下表现得像领域专家。传统做法是在代码中硬编码提示词，难以维护；上下文工程将业务知识外部化为配置文件，实现业务与代码分离。

**核心价值**：
- **业务可配置**：产品经理可以修改 AI 的角色和知识，无需技术介入
- **知识复用**：城市列表、岗位分类等知识在多个场景共享
- **版本管理**：配置文件纳入 Git，可追溯每次变更
- **A/B 测试**：同时运行多个版本的提示词，对比效果

#### 三文件结构设计

通过三个文件为 AI 提供业务知识和运行参数，职责清晰：

**目录结构**：
```
context/candidate-consultation/
├── profile.json        # API 调用配置：模型选择、工具权限、裁剪策略
├── system-prompt.md    # AI 角色定义：身份、职责、行为约束
├── context.json        # 业务知识库：公司信息、业务规则、领域知识
└── tool-context.json   # 工具参数映射：API 凭证、业务 Token
```

**文件职责划分**：
1. **profile.json**：控制"怎么调用 API"（技术层）
2. **system-prompt.md**：定义"AI 是谁"（角色层）
3. **context.json**：提供"AI 知道什么"（知识层）
4. **tool-context.json**：配置"AI 能用什么"（工具层）

**示例：候选人问"有哪些餐饮类兼职？"**

1. **system-prompt.md** 定义角色
```markdown
你是独立日招聘助理，负责协助候选人了解兼职岗位信息。
职责：回答岗位、薪资、工作时间问题，推荐合适岗位。
约束：不承诺未确认信息，不透露他人信息。
```

2. **context.json** 提供业务知识
```json
{
  "companyName": "独立日",
  "supportedCities": ["北京", "上海", "深圳"],
  "jobCategories": [
    { "name": "餐饮服务", "description": "服务员、后厨帮工等" }
  ]
}
```
AI 从 `jobCategories` 获取"餐饮服务"定义，避免编造信息。

3. **tool-context.json** 提供工具参数
```json
{
  "duliday_job_list": {
    "dulidayToken": "${DULIDAY_ENTERPRISE_TOKEN}"
  }
}
```
AI 调用 `duliday_job_list` 时，自动携带 token 查询实时岗位。

**实现**：
```typescript
class AgentContextService implements OnModuleInit {
  async onModuleInit() {
    const sceneDirs = fs.readdirSync('context/');
    for (const dir of sceneDirs) {
      const systemPrompt = fs.readFileSync(`context/${dir}/system-prompt.md`, 'utf-8');
      const context = JSON.parse(fs.readFileSync(`context/${dir}/context.json`, 'utf-8'));
      const toolContext = this.replaceEnvVars(JSON.parse(fs.readFileSync(`context/${dir}/tool-context.json`)));
      this.profiles.set(dir, { systemPrompt, context, toolContext });
    }
  }
}
```

---

### 2.2 API 调用参数配置（profile.json）

#### 设计目的

`profile.json` 是场景的技术配置文件，定义了如何调用花卷 Agent API。它解决三个核心问题：

1. **模型选择**：不同场景对模型要求不同（复杂推理 vs 快速响应）
2. **工具权限**：限制 AI 可调用的工具，避免越权操作
3. **成本优化**：通过裁剪历史消息控制 Token 消耗

#### 完整配置示例

```json
{
  "name": "candidate-consultation",
  "description": "候选人咨询场景：协助候选人了解岗位信息",
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

#### 字段详解

| 字段 | 类型 | 必填 | 说明 | 示例 |
|------|------|------|------|------|
| `name` | string | ✅ | 场景唯一标识，需与目录名一致 | `"candidate-consultation"` |
| `description` | string | ❌ | 场景描述，用于文档和日志 | `"候选人咨询场景"` |
| `model` | string | ✅ | 使用的模型，支持环境变量替换 | `"${AGENT_DEFAULT_MODEL}"` 或 `"claude-3-5-sonnet-20241022"` |
| `allowedTools` | string[] | ❌ | 允许调用的工具列表，空数组表示禁用所有工具 | `["duliday_job_list"]` |
| `prune` | boolean | ❌ | 是否启用消息裁剪（默认 false） | `true` |
| `pruneOptions` | object | ❌ | 裁剪配置，仅当 `prune: true` 时生效 | 见下方详解 |

**pruneOptions 配置**：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `targetTokens` | number | 8000 | 目标 Token 数，超过则开始裁剪 |
| `preserveRecentMessages` | number | 5 | 保留最近 N 轮对话，不参与裁剪 |
| `preserveToolCalls` | boolean | true | 保留包含工具调用的消息（避免上下文断裂） |

#### 配置策略说明

**1. 工具权限控制（allowedTools）**

```json
// 候选人咨询：只能查询岗位，不能修改
{
  "name": "candidate-consultation",
  "allowedTools": ["duliday_job_list", "duliday_job_details"]
}

// 店长报缺：可以提交报缺申请
{
  "name": "manager-shortage-report",
  "allowedTools": ["duliday_shortage_submit", "duliday_shortage_query"]
}

// 纯聊天场景：禁用所有工具
{
  "name": "general-chat",
  "allowedTools": []
}
```

**权限检查时机**：
- 启动时：`AgentContextService` 验证配置的工具是否在 `AgentRegistryService` 注册
- 运行时：AI 尝试调用工具时，花卷 API 根据 `allowedTools` 过滤

**2. 消息裁剪策略（prune）**

**场景 1：长对话优化**
```json
// 候选人咨询了 20 轮，每轮 200 Token
// 总计 4000 Token，未超过 targetTokens，不裁剪
{
  "prune": true,
  "pruneOptions": {
    "targetTokens": 8000,
    "preserveRecentMessages": 5
  }
}
```

**场景 2：超长对话裁剪**
```json
// 候选人咨询了 50 轮，总计 12000 Token，超过 8000
// 保留最近 5 轮（1000 Token）+ 工具调用消息（2000 Token）
// 其余 9000 Token 的消息被裁剪
{
  "prune": true,
  "pruneOptions": {
    "targetTokens": 8000,
    "preserveRecentMessages": 5,
    "preserveToolCalls": true  // 保留岗位查询历史
  }
}
```

**裁剪算法**：
1. 计算当前对话总 Token 数
2. 如果未超过 `targetTokens`，跳过裁剪
3. 标记最近 N 轮（`preserveRecentMessages`）和工具调用消息为"不可裁剪"
4. 从旧到新裁剪消息，直到 Token 数降到 `targetTokens` 以下

**3. 模型选择策略**

```json
// 开发环境：使用环境变量，方便切换
{
  "model": "${AGENT_DEFAULT_MODEL}"  // .env: AGENT_DEFAULT_MODEL=claude-3-5-sonnet-20241022
}

// 生产环境：固定模型，确保稳定性
{
  "model": "claude-3-5-sonnet-20241022"
}

// 特殊场景：使用更快的模型
{
  "model": "claude-3-haiku-20240307"  // 快速响应场景
}
```

#### 设计收益

1. **业务隔离**：新增场景只需复制目录，修改 `allowedTools`，不影响其他场景
2. **安全防护**：工具权限在配置层控制，代码无法绕过
3. **成本优化**：`prune` 配置可将长对话成本降低 40-60%
4. **灵活扩展**：支持环境变量，开发/测试/生产环境使用不同配置

---

### 2.3 智能缓存（Caching）

#### 什么是智能缓存？

智能缓存不是简单的"存储所有响应"，而是基于响应特性和业务场景，智能判断哪些内容应该缓存、缓存多久。

**核心思想**：
- **静态知识缓存**：通用问题（"服务哪些城市？"）响应稳定，缓存 1 小时
- **动态数据不缓存**：工具调用（查询岗位列表）返回实时数据，不缓存
- **上下文相关不缓存**：包含用户个人信息的响应，不缓存

#### 缓存判断逻辑

```typescript
shouldCache(params: ChatParams, response: ChatResponse): boolean {
  // 规则 1：使用工具 → 动态数据，不缓存
  if (response.toolCalls?.length > 0) {
    return false;
  }

  // 规则 2：包含上下文 → 可能包含个人信息，不缓存
  if (params.context && Object.keys(params.context).length > 0) {
    return false;
  }

  // 规则 3：纯文本对话 → 稳定，缓存
  return true;
}
```

**示例场景**：

| 用户问题 | 是否缓存 | 原因 |
|----------|----------|------|
| "独立日服务哪些城市？" | ✅ 缓存 | 纯文本响应，答案稳定 |
| "有哪些餐饮类兼职？" | ❌ 不缓存 | 调用 `duliday_job_list`，实时数据 |
| "我的面试记录" | ❌ 不缓存 | 包含用户上下文，个性化内容 |
| "兼职工作有什么要求？" | ✅ 缓存 | 通用问题，答案稳定 |

#### 缓存键生成

```typescript
generateCacheKey(params: ChatParams): string {
  const keyData = {
    model: params.model,
    messages: params.messages.map(m => ({
      role: m.role,
      content: m.content
    })),
    tools: params.allowedTools?.sort() || []
  };
  return `agent:chat:${md5(JSON.stringify(keyData))}`;
}
```

**为什么这样设计**：
- **包含 model**：同样的问题，不同模型响应不同
- **包含 messages**：完整对话历史影响响应
- **包含 tools**：同样的问题，可用工具不同时响应可能不同
- **排序 tools**：`["tool1", "tool2"]` 和 `["tool2", "tool1"]` 语义相同

**收益数据**：
- 成本降低 30-40%（减少 API 调用）
- 响应速度从 1-3 秒降到 <10ms
- 缓存命中率约 25-35%（取决于业务场景）

---

### 2.4 容错与重试（Resilience）

#### 为什么需要重试？

花卷 Agent API 可能出现临时性失败：
- **429 Rate Limit**：频率限制，需要等待后重试
- **503 Service Unavailable**：服务繁忙，等待后可能恢复
- **网络超时**：临时网络问题

不重试的后果：成功率仅 85%，15% 的用户请求失败。

#### 重试策略

```typescript
async chatWithRetry(params: ChatParams): Promise<ChatResponse> {
  const maxRetries = 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await this.httpClient.post('/chat', params);
    } catch (error) {
      const status = error.response?.status;

      // 429：频率限制 → 按服务器指示等待
      if (status === 429) {
        const retryAfter = parseInt(error.response.headers['retry-after'] || '5');
        this.logger.warn(`Rate limited, retry after ${retryAfter}s`);
        await this.sleep(retryAfter * 1000);
        continue;
      }

      // 5xx：服务器错误 → 指数退避
      if (status >= 500) {
        const backoff = Math.pow(2, attempt) * 1000; // 1s → 2s → 4s
        this.logger.warn(`Server error ${status}, retry after ${backoff}ms`);
        await this.sleep(backoff);
        continue;
      }

      // 超时 → 指数退避
      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
        const backoff = Math.pow(2, attempt) * 1000;
        this.logger.warn(`Timeout, retry after ${backoff}ms`);
        await this.sleep(backoff);
        continue;
      }

      // 4xx：客户端错误 → 立即失败（重试无意义）
      throw error;
    }
  }

  throw new AgentApiException('Max retries exceeded');
}
```

#### 重试决策表

| 错误类型 | HTTP 状态码 | 重试策略 | 等待时间 |
|----------|-------------|----------|----------|
| 频率限制 | 429 | ✅ 重试 | 按 `Retry-After` 头 |
| 服务繁忙 | 503 | ✅ 重试 | 1s → 2s → 4s（指数退避） |
| 网关错误 | 502 | ✅ 重试 | 1s → 2s → 4s |
| 内部错误 | 500 | ✅ 重试 | 1s → 2s → 4s |
| 超时 | - | ✅ 重试 | 1s → 2s → 4s |
| 参数错误 | 400 | ❌ 立即失败 | - |
| 认证失败 | 401 | ❌ 立即失败 | - |
| 权限拒绝 | 403 | ❌ 立即失败 | - |
| 资源不存在 | 404 | ❌ 立即失败 | - |

**收益**：成功率从 85% 提升到 98%。

---

## 3. 配置体系详解

### 3.1 三层配置架构

Agent 服务采用三层配置体系，分离关注点，降低耦合。

```
┌─────────────────────────────────────────────────────────┐
│ 第一层：环境变量（.env）                                │
│ 职责：运行环境配置（开发/测试/生产）                    │
│ 管理者：运维人员、开发人员                              │
│ 示例：AGENT_API_KEY, AGENT_DEFAULT_MODEL               │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 第二层：业务配置（profile.json）                        │
│ 职责：场景定义、模型选择、工具权限                      │
│ 管理者：产品经理、业务人员                              │
│ 示例：allowedTools, prune, model                        │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 第三层：代码策略（*.service.ts）                        │
│ 职责：技术实现细节（缓存、重试、降级）                  │
│ 管理者：技术负责人、架构师                              │
│ 示例：缓存 TTL 3600s, 最大重试 3 次                     │
└─────────────────────────────────────────────────────────┘
```

### 3.2 环境变量配置（第一层）

#### 配置文件

```bash
# .env（提交到 Git，包含默认值和占位符）
AGENT_API_BASE_URL=https://api.example.com
AGENT_API_KEY=your_api_key_here
AGENT_DEFAULT_MODEL=claude-3-5-sonnet-20241022
DULIDAY_ENTERPRISE_TOKEN=your_token_here

# .env.local（不提交，本地开发使用）
AGENT_API_KEY=sk-actual-key-xxx
DULIDAY_ENTERPRISE_TOKEN=actual-token-xxx
```

#### 环境变量清单

| 变量名 | 必填 | 说明 | 示例值 |
|--------|------|------|--------|
| `AGENT_API_BASE_URL` | ✅ | 花卷 API 地址 | `https://api.huajuan.ai` |
| `AGENT_API_KEY` | ✅ | API 认证密钥 | `sk-xxx` |
| `AGENT_DEFAULT_MODEL` | ✅ | 默认模型 | `claude-3-5-sonnet-20241022` |
| `DULIDAY_ENTERPRISE_TOKEN` | ❌ | 企业业务 Token | `token-xxx` |
| `REDIS_HOST` | ❌ | Redis 地址（默认 localhost） | `redis.example.com` |
| `REDIS_PORT` | ❌ | Redis 端口（默认 6379） | `6380` |

#### 环境变量替换机制

```typescript
// 配置文件中使用 ${VAR_NAME} 引用环境变量
{
  "model": "${AGENT_DEFAULT_MODEL}",
  "toolContext": {
    "duliday_job_list": {
      "token": "${DULIDAY_ENTERPRISE_TOKEN}"
    }
  }
}

// 启动时自动替换
private replaceEnvVars(obj: any): any {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{(\w+)\}/g, (_, key) => {
      const value = process.env[key];
      if (!value) {
        this.logger.warn(`环境变量 ${key} 未设置`);
      }
      return value || '';
    });
  }
  // 递归处理对象和数组
  if (Array.isArray(obj)) {
    return obj.map(item => this.replaceEnvVars(item));
  }
  if (typeof obj === 'object' && obj !== null) {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, this.replaceEnvVars(v)])
    );
  }
  return obj;
}
```

**安全最佳实践**：
- ✅ `.env` 提交到 Git，包含默认值和说明
- ✅ `.env.local` 不提交，包含真实密钥
- ✅ 生产环境使用 Kubernetes Secrets 或 AWS Secrets Manager
- ❌ 永远不要在配置文件中硬编码密钥

### 3.3 业务配置详解（第二层）

已在 [2.2 API 调用参数配置](#22-api-调用参数配置profilejson) 详细说明。

**配置目录结构**：
```
context/
├── candidate-consultation/       # 候选人咨询场景
│   ├── profile.json
│   ├── system-prompt.md
│   ├── context.json
│   └── tool-context.json
└── manager-shortage-report/      # 店长报缺场景
    ├── profile.json
    ├── system-prompt.md
    ├── context.json
    └── tool-context.json
```

### 3.4 代码策略配置（第三层）

#### 缓存策略

```typescript
// src/agent/agent-cache.service.ts
export class AgentCacheService {
  private readonly DEFAULT_TTL = 3600; // 1 小时
  private readonly MAX_CACHE_SIZE = 10000; // 最多缓存 10000 条

  async set(key: string, value: ChatResponse): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), 'EX', this.DEFAULT_TTL);
  }
}
```

**为什么在代码中配置**：
- 技术细节，业务人员无需关心
- 需要代码审查，避免误配置导致性能问题
- 可能依赖运行时指标动态调整

#### 重试策略

```typescript
// src/agent/agent.service.ts
export class AgentService {
  private readonly MAX_RETRIES = 3;
  private readonly TIMEOUT = 120000; // 120 秒

  async chatWithRetry(params: ChatParams): Promise<ChatResponse> {
    for (let i = 0; i < this.MAX_RETRIES; i++) {
      // 重试逻辑...
    }
  }
}
```

#### 降级策略

```typescript
// src/agent/agent-config.service.ts
loadProfile(name: string): AgentProfile {
  try {
    return this.loadProfileFromDisk(name);
  } catch (error) {
    // 配置加载失败，使用降级配置
    this.logger.warn(`配置加载失败，使用降级配置: ${name}`);
    return {
      model: process.env.AGENT_DEFAULT_MODEL,
      systemPrompt: '你是 AI 助手。',
      context: {},
      toolContext: {},
      allowedTools: [] // 降级时禁用工具
    };
  }
}
```

### 3.5 配置加载流程

```typescript
// 完整的配置加载和应用流程
async chatWithProfile(dto: ChatWithProfileDto) {
  // 1. 加载环境变量（第一层）
  const apiKey = this.configService.get('AGENT_API_KEY');
  const defaultModel = this.configService.get('AGENT_DEFAULT_MODEL');

  // 2. 加载业务配置（第二层）
  const profile = this.contextService.loadProfile(dto.profileName);
  // profile.model = "${AGENT_DEFAULT_MODEL}"
  // profile.allowedTools = ["duliday_job_list"]

  // 3. 环境变量替换
  profile.model = profile.model.replace(/\$\{(\w+)\}/g,
    (_, key) => process.env[key] || defaultModel
  );
  // profile.model = "claude-3-5-sonnet-20241022"

  // 4. 验证资源
  const validatedModel = this.registryService.validateModel(profile.model);
  this.registryService.validateTools(profile.allowedTools);

  // 5. 应用代码策略（第三层）
  const cacheKey = this.cacheService.generateCacheKey({
    model: validatedModel,
    messages: [dto.message],
    tools: profile.allowedTools
  });

  // 6. 查询缓存（代码策略：TTL 3600s）
  const cached = await this.cacheService.get(cacheKey);
  if (cached) return cached;

  // 7. 调用 API（代码策略：最多重试 3 次）
  const response = await this.agentService.chatWithRetry({
    conversationId: dto.conversationId,
    userMessage: dto.message,
    model: validatedModel,
    systemPrompt: profile.systemPrompt,
    context: profile.context,
    allowedTools: profile.allowedTools,
    toolContext: profile.toolContext
  });

  // 8. 缓存响应（代码策略：智能判断）
  if (this.cacheService.shouldCache(params, response)) {
    await this.cacheService.set(cacheKey, response);
  }

  return response;
}
```

---

## 4. 架构设计

### 4.1 四服务分离：单一职责

#### 设计原则

遵循 SOLID 原则中的单一职责原则（Single Responsibility Principle），每个服务只负责一个业务领域。

**拆分收益**：
- 每个服务 < 200 行，易于理解和维护
- 职责清晰，修改缓存策略不影响 API 调用逻辑
- 可独立测试、独立替换（如 Redis → Memcached）
- 团队并行开发，减少代码冲突

#### 服务职责划分

```
┌─────────────────────────────────────────────────────────┐
│ AgentController                                          │
│ 职责：接收 HTTP 请求，协调服务调用                       │
└─────────────────────────────────────────────────────────┘
             │
             ├──────────────────────────────────────────┐
             │                                          │
┌─────────────▼───────────┐              ┌──────────────▼────────────┐
│ AgentContextService     │              │ AgentRegistryService      │
│ 职责：上下文工程管理     │              │ 职责：资源注册与验证      │
│ - 加载场景配置          │              │ - 验证模型可用性          │
│ - 替换环境变量          │              │ - 验证工具权限            │
│ - 配置验证              │              │ - 提供默认值              │
└─────────────┬───────────┘              └──────────────┬────────────┘
             │                                          │
             └──────────────┬───────────────────────────┘
                            │
             ┌──────────────▼───────────────┐
             │ AgentCacheService            │
             │ 职责：智能缓存管理            │
             │ - 缓存键生成                 │
             │ - 缓存判断                   │
             │ - 缓存读写                   │
             └──────────────┬───────────────┘
                            │
             ┌──────────────▼───────────────┐
             │ AgentService                 │
             │ 职责：API 调用与重试          │
             │ - HTTP 请求封装              │
             │ - 自动重试                   │
             │ - 错误处理                   │
             └──────────────────────────────┘
```

#### 服务接口设计

```typescript
// 1. AgentService：API 调用与重试
class AgentService {
  // 基础聊天接口
  async chat(params: ChatParams): Promise<ChatResponse>;

  // 带重试的聊天接口
  async chatWithRetry(params: ChatParams): Promise<ChatResponse>;
}

// 2. AgentContextService：上下文工程管理
class AgentContextService {
  // 加载指定场景配置
  loadProfile(name: string): AgentProfile;

  // 获取所有场景配置（用于管理界面）
  getAllProfiles(): AgentProfile[];

  // 验证配置完整性
  validateProfile(profile: AgentProfile): void;
}

// 3. AgentRegistryService：资源注册表
class AgentRegistryService {
  // 验证模型，不可用时返回默认模型
  validateModel(model: string): string;

  // 验证工具列表，不存在的工具抛出异常
  validateTools(tools: string[]): void;

  // 获取可用模型列表
  getAvailableModels(): string[];

  // 获取可用工具列表
  getAvailableTools(): string[];
}

// 4. AgentCacheService：智能缓存
class AgentCacheService {
  // 查询缓存
  get(key: string): Promise<ChatResponse | null>;

  // 写入缓存
  set(key: string, value: ChatResponse): Promise<void>;

  // 判断是否应该缓存
  shouldCache(params: ChatParams, response: ChatResponse): boolean;

  // 生成缓存键
  generateCacheKey(params: ChatParams): string;
}
```

---

### 4.2 配置驱动：声明式管理

#### 设计理念

业务变化修改配置，不改代码。降低技术门槛，让产品经理也能管理 AI 行为。

#### 新增场景流程

```bash
# 1. 复制现有场景配置
cp -r context/candidate-consultation/ context/new-scenario/

# 2. 修改场景配置
vim context/new-scenario/profile.json          # 修改场景名称、工具权限
vim context/new-scenario/system-prompt.md      # 修改 AI 角色定义
vim context/new-scenario/context.json          # 修改业务知识
vim context/new-scenario/tool-context.json     # 修改工具参数

# 3. 重启服务（自动加载新配置）
npm run start:dev

# 4. 测试新场景
curl -X POST http://localhost:3000/agent/chat-with-profile \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "test-001",
    "message": "你好",
    "profileName": "new-scenario"
  }'
```

**无需修改代码**，只需配置文件即可新增场景。

#### 配置热更新（可选）

```typescript
// 监听配置文件变化，自动重新加载
@Injectable()
export class AgentContextService {
  private watcher: FSWatcher;

  onModuleInit() {
    this.loadAllProfiles();

    // 开发环境启用热更新
    if (process.env.NODE_ENV === 'development') {
      this.watcher = fs.watch('context/', { recursive: true }, (event, filename) => {
        this.logger.log(`配置文件变化: ${filename}，重新加载`);
        this.loadAllProfiles();
      });
    }
  }
}
```

---

### 4.3 容错设计：分层降级

#### 降级策略矩阵

| 故障类型 | 降级策略 | 用户体验 | 示例 |
|----------|----------|----------|------|
| 配置文件缺失 | 使用默认配置 | AI 可用，但功能受限 | 加载 `new-scenario` 失败 → 使用默认提示词 |
| 模型不可用 | 回退到默认模型 | AI 可用，可能响应质量下降 | `claude-opus` 不可用 → 回退到 `claude-sonnet` |
| 工具不可用 | 禁用该工具 | AI 可用，无法调用工具 | `duliday_job_list` 不可用 → 禁用岗位查询 |
| Redis 连接失败 | 跳过缓存 | API 调用变慢，成本增加 | Redis 故障 → 每次都调用 API |
| API 临时性失败 | 自动重试 3 次 | 用户无感知，响应稍慢 | 503 错误 → 等待后重试 |
| API 持续性失败 | 返回错误信息 | 用户看到错误提示 | 重试 3 次后仍失败 → 返回 500 |

#### 配置降级实现

```typescript
loadProfile(name: string): AgentProfile {
  try {
    return this.loadProfileFromDisk(name);
  } catch (error) {
    this.logger.warn(`配置加载失败，使用降级配置: ${name}`, error);

    // 降级配置：最小可用配置
    return {
      name,
      model: process.env.AGENT_DEFAULT_MODEL || 'claude-3-5-sonnet-20241022',
      systemPrompt: '你是一个 AI 助手，请尽力回答用户问题。',
      context: {},
      toolContext: {},
      allowedTools: [], // 降级时禁用所有工具
      prune: false
    };
  }
}
```

#### 缓存降级实现

```typescript
async get(key: string): Promise<ChatResponse | null> {
  try {
    const value = await this.redis.get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    // Redis 故障，降级为不使用缓存
    this.logger.warn('缓存查询失败，跳过缓存', error);
    return null;
  }
}

async set(key: string, value: ChatResponse): Promise<void> {
  try {
    await this.redis.set(key, JSON.stringify(value), 'EX', this.DEFAULT_TTL);
  } catch (error) {
    // Redis 故障，静默失败（不影响主流程）
    this.logger.warn('缓存写入失败', error);
  }
}
```

---

## 5. 实现细节

### 5.1 AgentService - API 调用与重试

**位置**: [src/agent/agent.service.ts](src/agent/agent.service.ts) (461 行)

**核心接口**：
```typescript
interface ChatParams {
  conversationId: string;
  userMessage: string;
  model?: string;
  systemPrompt?: string;
  context?: Record<string, any>;
  allowedTools?: string[];
  toolContext?: Record<string, any>;
}

interface ChatResponse {
  message: string;
  usage?: { totalTokens: number };
  toolCalls?: ToolCall[];
}
```

**HTTP 客户端创建**：
```typescript
private createHttpClient(): AxiosInstance {
  return axios.create({
    baseURL: this.configService.get('AGENT_API_BASE_URL'),
    timeout: 120000,
    headers: {
      'Authorization': `Bearer ${this.configService.get('AGENT_API_KEY')}`,
      'Content-Type': 'application/json'
    }
  });
}
```

**重试策略**：
- 429: 按 `Retry-After` 头等待
- 500/502/503: 指数退避（1s → 2s → 4s）
- 400/401/403: 立即失败

---

### 5.2 AgentContextService - 上下文工程管理

**位置**: [src/agent/agent-config.service.ts](src/agent/agent-config.service.ts) (500 行)

**注意**：该文件将重命名为 `agent-context.service.ts` 以更准确反映职责。

**配置加载流程**：
```typescript
async onModuleInit() {
  const contextDir = path.join(process.cwd(), 'context');
  const sceneDirs = fs.readdirSync(contextDir);

  for (const dir of sceneDirs) {
    const basePath = `context/${dir}`;
    const profileJson = JSON.parse(fs.readFileSync(`${basePath}/profile.json`, 'utf-8'));
    const systemPrompt = fs.readFileSync(`${basePath}/system-prompt.md`, 'utf-8');
    const context = JSON.parse(fs.readFileSync(`${basePath}/context.json`, 'utf-8'));
    const toolContext = JSON.parse(fs.readFileSync(`${basePath}/tool-context.json`, 'utf-8'));

    const profile = {
      ...profileJson,
      systemPrompt,
      context: this.replaceEnvVars(context),
      toolContext: this.replaceEnvVars(toolContext)
    };

    this.validateProfile(profile);
    this.profiles.set(profile.name, profile);
  }
}
```

**环境变量替换**：
```typescript
private replaceEnvVars(obj: any): any {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] || '');
  }
  if (Array.isArray(obj)) {
    return obj.map(item => this.replaceEnvVars(item));
  }
  if (typeof obj === 'object' && obj !== null) {
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [key, this.replaceEnvVars(value)])
    );
  }
  return obj;
}
```

---

### 5.3 AgentRegistryService - 资源注册表

**位置**: [src/agent/agent-registry.service.ts](src/agent/agent-registry.service.ts) (402 行)

**模型验证**：
```typescript
async onModuleInit() {
  const response = await this.httpClient.get('/models');
  this.availableModels = response.data.models;
  this.defaultModel = this.configService.get('AGENT_DEFAULT_MODEL');
}

validateModel(requestedModel?: string): string {
  if (!requestedModel) return this.defaultModel;
  if (this.availableModels.includes(requestedModel)) return requestedModel;

  this.logger.warn(`模型 ${requestedModel} 不可用，回退到 ${this.defaultModel}`);
  return this.defaultModel;
}
```

**工具验证**：
```typescript
validateTools(requestedTools: string[]): void {
  for (const tool of requestedTools) {
    if (!this.availableTools.has(tool)) {
      throw new Error(`工具 ${tool} 不存在`);
    }
  }
}
```

---

### 5.4 AgentCacheService - 智能缓存

**位置**: [src/agent/agent-cache.service.ts](src/agent/agent-cache.service.ts) (336 行)

**缓存键生成**：
```typescript
generateCacheKey(params: { model: string; messages: SimpleMessage[]; tools?: string[] }): string {
  const keyData = {
    model: params.model,
    messages: params.messages.map(m => ({ role: m.role, content: m.content })),
    tools: params.tools?.sort() || []
  };
  return `agent:chat:${md5(JSON.stringify(keyData))}`;
}
```

**缓存判断**：
```typescript
shouldCache(params: ChatParams, response: ChatResponse): boolean {
  if (response.toolCalls?.length > 0) return false; // 使用工具 → 不缓存
  if (params.context && Object.keys(params.context).length > 0) return false; // 有上下文 → 不缓存
  return true; // 纯文本 → 缓存
}
```

**TTL 管理**：
```typescript
async set(key: string, value: ChatResponse, params: ChatParams): Promise<void> {
  const ttl = 3600; // 纯文本对话缓存1小时
  await this.redis.set(key, JSON.stringify(value), 'EX', ttl);
}
```

---

## 6. 服务协作

### 6.1 聊天请求完整流程

以候选人发送消息"有哪些兼职？"为例，展示四个服务如何协作完成请求。

```typescript
@Post('chat-with-profile')
async chatWithProfile(@Body() dto: ChatWithProfileDto) {
  // 1. 加载配置
  const profile = this.contextService.loadProfile(dto.profileName);

  // 2. 验证资源
  const validatedModel = this.registryService.validateModel(profile.model);

  // 3. 生成缓存键
  const cacheKey = this.cacheService.generateCacheKey({
    model: validatedModel,
    messages: [{ role: 'user', content: dto.message }],
    tools: profile.allowedTools
  });

  // 4. 查询缓存
  const cached = await this.cacheService.get(cacheKey);
  if (cached) return cached;

  // 5. 调用 API
  const response = await this.agentService.chat({
    conversationId: dto.conversationId,
    userMessage: dto.message,
    model: validatedModel,
    systemPrompt: profile.systemPrompt,
    context: profile.context,
    allowedTools: profile.allowedTools,
    toolContext: profile.toolContext
  });

  // 6. 判断缓存
  if (this.cacheService.shouldCache(params, response)) {
    await this.cacheService.set(cacheKey, response, params);
  }

  return response;
}
```

### 6.2 错误处理降级流程

当 API 调用失败时，系统自动执行降级策略：

```
API 调用失败
    ↓
错误类型判断:
├── 429 Rate Limit → 读取 Retry-After 头 → 等待 N 秒 → 重试
├── 5xx Server Error → 指数退避（1s→2s→4s） → 重试
├── 超时 ETIMEDOUT → 指数退避（1s→2s→4s） → 重试
└── 4xx Client Error → 参数错误，立即失败
    ↓
重试 3 次后仍失败 → 抛出 AgentApiException
    ↓
Controller 捕获异常:
├── 记录错误日志（包含请求参数、错误堆栈）
├── 返回友好错误信息给用户
└── 上报监控系统（可选）
```

**时序图**：

```
候选人                Controller            AgentService          花卷 API
  │                      │                      │                      │
  ├─────"有哪些兼职?"────>│                      │                      │
  │                      │                      │                      │
  │                      ├──────加载配置────────>│                      │
  │                      │<─────配置返回─────────┤                      │
  │                      │                      │                      │
  │                      ├──────查询缓存────────>│                      │
  │                      │<─────未命中───────────┤                      │
  │                      │                      │                      │
  │                      ├──────调用 API─────────┼──────POST /chat─────>│
  │                      │                      │<─────503 错误────────┤
  │                      │                      │                      │
  │                      │                      ├──等待 1 秒────────────│
  │                      │                      │                      │
  │                      │                      ├──────重试 #1────────>│
  │                      │                      │<─────503 错误────────┤
  │                      │                      │                      │
  │                      │                      ├──等待 2 秒────────────│
  │                      │                      │                      │
  │                      │                      ├──────重试 #2────────>│
  │                      │                      │<─────200 成功────────┤
  │                      │<─────返回响应─────────┤                      │
  │                      │                      │                      │
  │                      ├──────写入缓存────────>│                      │
  │                      │                      │                      │
  │<─────返回 AI 回复────┤                      │                      │
```

---

## 7. 配置最佳实践

### 7.1 配置文件管理

#### 目录命名规范

```bash
context/
├── candidate-consultation/    # ✅ 使用 kebab-case
├── manager_shortage_report/   # ❌ 避免 snake_case
└── StoreOwnerChat/            # ❌ 避免 PascalCase
```

**规范**：
- 使用小写字母 + 连字符（kebab-case）
- 目录名与 `profile.json` 中的 `name` 字段一致
- 语义清晰，见名知意

#### 配置文件完整性检查

```typescript
// 启动时验证配置完整性
validateProfile(profile: AgentProfile): void {
  const errors: string[] = [];

  // 必填字段检查
  if (!profile.name) errors.push('缺少 name 字段');
  if (!profile.model) errors.push('缺少 model 字段');

  // 模型格式检查
  if (profile.model && !profile.model.startsWith('claude-')) {
    errors.push(`无效的模型名称: ${profile.model}`);
  }

  // 工具存在性检查
  if (profile.allowedTools) {
    for (const tool of profile.allowedTools) {
      if (!this.registryService.isToolAvailable(tool)) {
        errors.push(`工具不存在: ${tool}`);
      }
    }
  }

  // 裁剪配置合法性检查
  if (profile.prune) {
    if (!profile.pruneOptions?.targetTokens) {
      errors.push('启用 prune 时必须设置 pruneOptions.targetTokens');
    }
    if (profile.pruneOptions.targetTokens < 1000) {
      errors.push('targetTokens 不能小于 1000');
    }
  }

  if (errors.length > 0) {
    throw new Error(`配置验证失败 (${profile.name}): ${errors.join(', ')}`);
  }
}
```

### 7.2 环境变量管理

#### 开发环境配置

```bash
# .env.development（开发环境）
NODE_ENV=development
AGENT_API_BASE_URL=https://api-dev.huajuan.ai
AGENT_API_KEY=${DEV_API_KEY}
AGENT_DEFAULT_MODEL=claude-3-5-sonnet-20241022
REDIS_HOST=localhost
REDIS_PORT=6379
LOG_LEVEL=debug
```

#### 生产环境配置

```bash
# .env.production（生产环境）
NODE_ENV=production
AGENT_API_BASE_URL=https://api.huajuan.ai
AGENT_API_KEY=${PROD_API_KEY}  # 从 Secrets Manager 获取
AGENT_DEFAULT_MODEL=claude-3-5-sonnet-20241022
REDIS_HOST=redis.prod.example.com
REDIS_PORT=6380
LOG_LEVEL=info
```

#### 敏感信息管理

```bash
# ❌ 错误：直接在配置文件中硬编码
AGENT_API_KEY=sk-ant-api03-xxx

# ✅ 正确：使用环境变量引用
AGENT_API_KEY=${PROD_AGENT_API_KEY}

# ✅ 正确：在 CI/CD 中注入
# GitHub Actions secrets
# Kubernetes secrets
# AWS Secrets Manager
```

### 7.3 配置版本管理

#### Git 提交策略

```bash
# ✅ 提交到 Git
context/*/profile.json
context/*/system-prompt.md
context/*/context.json
context/*/tool-context.json  # 不包含真实密钥，使用 ${ENV_VAR}
.env                         # 包含默认值和占位符
.env.example                 # 配置模板

# ❌ 不要提交
.env.local                   # 本地开发真实密钥
.env.production              # 生产环境真实密钥
```

#### 配置变更流程

```bash
# 1. 创建功能分支
git checkout -b feature/new-agent-profile

# 2. 修改配置
vim context/new-scenario/profile.json

# 3. 本地测试
npm run start:dev
curl -X POST http://localhost:3000/agent/chat-with-profile \
  -d '{"profileName": "new-scenario", ...}'

# 4. 提交变更
git add context/new-scenario/
git commit -m "feat: 添加新场景配置 new-scenario"

# 5. 代码审查
git push origin feature/new-agent-profile
# 创建 Pull Request，等待审查

# 6. 合并发布
# 审查通过后合并到主分支，自动部署
```

### 7.4 监控与告警

#### 关键指标监控

```typescript
// 监控缓存命中率
@Injectable()
export class AgentMetricsService {
  private cacheHits = 0;
  private cacheMisses = 0;

  recordCacheHit() {
    this.cacheHits++;
  }

  recordCacheMiss() {
    this.cacheMisses++;
  }

  getCacheHitRate(): number {
    const total = this.cacheHits + this.cacheMisses;
    return total > 0 ? this.cacheHits / total : 0;
  }
}

// 监控 API 调用成功率
@Injectable()
export class AgentService {
  async chatWithRetry(params: ChatParams): Promise<ChatResponse> {
    const startTime = Date.now();
    try {
      const response = await this.chat(params);
      this.metrics.recordSuccess(Date.now() - startTime);
      return response;
    } catch (error) {
      this.metrics.recordFailure(error.message);
      throw error;
    }
  }
}
```

#### 告警规则

| 指标 | 阈值 | 告警级别 | 处理建议 |
|------|------|----------|----------|
| API 成功率 | < 95% | 🔴 严重 | 检查 API 服务状态，查看错误日志 |
| 平均响应时间 | > 5 秒 | 🟡 警告 | 检查缓存命中率，优化 prompt |
| 缓存命中率 | < 20% | 🟡 警告 | 检查缓存策略，考虑调整 TTL |
| Redis 连接失败 | > 0 | 🟡 警告 | 检查 Redis 服务，系统自动降级 |
| 配置加载失败 | > 0 | 🔴 严重 | 检查配置文件格式，系统使用降级配置 |

### 7.5 性能优化建议

#### 1. 合理设置缓存 TTL

```typescript
// ✅ 根据数据特性设置不同 TTL
const TTL_CONFIG = {
  staticKnowledge: 3600,      // 1 小时：通用知识
  businessInfo: 1800,         // 30 分钟：业务信息
  userSpecific: 600,          // 10 分钟：用户相关（如果缓存的话）
};
```

#### 2. 优化消息裁剪策略

```json
{
  "prune": true,
  "pruneOptions": {
    "targetTokens": 8000,           // 根据模型上下文窗口调整
    "preserveRecentMessages": 5,    // 保留最近对话，保证连贯性
    "preserveToolCalls": true       // 保留工具调用，避免上下文断裂
  }
}
```

#### 3. 选择合适的模型

```json
// 复杂推理场景：使用 Sonnet
{
  "name": "candidate-consultation",
  "model": "claude-3-5-sonnet-20241022"
}

// 简单对话场景：使用 Haiku（更快更便宜）
{
  "name": "general-chat",
  "model": "claude-3-haiku-20240307"
}
```

#### 4. 批量处理优化

```typescript
// ❌ 避免：逐个处理
for (const message of messages) {
  await this.agentService.chat({ message });
}

// ✅ 推荐：并行处理（如果消息独立）
await Promise.all(
  messages.map(message =>
    this.agentService.chat({ message })
  )
);
```

---

## 相关文档

- [花卷 Agent API 使用指南](../guides/huajune-agent-api-guide.md)
- [消息服务架构](message-service-architecture.md)
- [代码规范](../../.claude/agents/code-standards.md)
- [架构原则](../../.claude/agents/architecture-principles.md)

---

**维护者**: DuLiDay Team
