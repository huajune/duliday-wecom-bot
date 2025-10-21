# Chat Agent API 最佳实践指南

> 基于花卷智能体 API 文档整理的完整使用指南

## 目录

- [1. 快速开始](#1-快速开始)
- [2. 认证与安全](#2-认证与安全)
- [3. 模型选择](#3-模型选择)
- [4. System Prompt 配置](#4-system-prompt-配置)
- [5. 消息格式](#5-消息格式)
- [6. 工具系统](#6-工具系统)
- [7. 上下文管理](#7-上下文管理)
- [8. 消息剪裁](#8-消息剪裁)
- [9. 错误处理](#9-错误处理)
- [10. 性能优化](#10-性能优化)
- [11. 调试技巧](#11-调试技巧)
- [12. 常见错误码](#12-常见错误码)

---

## 1. 快速开始

### 1.1 基本配置

```typescript
const API_BASE_URL = 'https://huajune.duliday.com/api/v1';
const API_KEY = process.env.AGENT_API_KEY; // 从环境变量读取

const headers = {
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json'
};
```

### 1.2 第一个请求

```typescript
const response = await fetch(`${API_BASE_URL}/chat`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    model: 'anthropic/claude-3-7-sonnet-20250219',
    messages: [
      { role: 'user', content: '你好，请介绍一下你自己' }
    ]
  })
});

const data = await response.json();
const reply = data.data.messages[0].parts[0].text;
```

### 1.3 关键要点

✅ **必须使用 HTTPS**
✅ **API Key 存储在环境变量中**
✅ **处理响应中的 correlationId 用于调试**
✅ **检查 response.data.success 判断请求是否成功**

---

## 2. 认证与安全

### 2.1 API Key 获取

1. 访问 [Wolian AI 平台](https://wolian.cc/platform/clients-management)
2. 登录账号
3. 在管理页面创建客户端密钥
4. **激活密钥**（未激活无法使用）
5. **立即复制保存**（仅显示一次）

### 2.2 API Key 格式

```
31ad14.************************** (32位字符)
前6位：密钥标识符
```

### 2.3 安全最佳实践

```typescript
// ✅ 推荐：使用环境变量
const apiKey = process.env.AGENT_API_KEY;

// ❌ 避免：硬编码在代码中
// const apiKey = '31ad14.**********';

// ✅ 推荐：服务端存储
// - 使用加密存储
// - 限制访问权限
// - 定期轮换密钥

// ✅ 推荐：请求日志脱敏
logger.log('API Request', {
  url: '/chat',
  apiKey: apiKey.substring(0, 6) + '****' // 只记录标识符
});
```

---

## 3. 模型选择

### 3.1 可用模型对比

| 模型 | 适用场景 | 特点 | 推荐度 |
|------|---------|------|--------|
| **Claude 3.7 Sonnet** | 通用对话、代码生成、复杂推理 | 性能优秀、价格均衡、长上下文 | ⭐⭐⭐⭐⭐ |
| **GPT-4o** | 多模态任务、视觉理解 | 响应快速、通用能力强 | ⭐⭐⭐⭐ |
| **Qwen Max** | 中文场景、成本敏感 | 中文能力出色、性价比高 | ⭐⭐⭐⭐ |
| **Qwen Plus** | 高频调用、开发测试 | 价格实惠、响应快速 | ⭐⭐⭐ |

### 3.2 模型选择决策树

```
是否需要多模态（图像理解）？
├─ 是 → GPT-4o
└─ 否 → 是否中文为主？
    ├─ 是 → 预算充足？
    │   ├─ 是 → Qwen Max
    │   └─ 否 → Qwen Plus
    └─ 否 → 复杂推理/代码生成？
        ├─ 是 → Claude 3.7 Sonnet
        └─ 否 → Qwen Plus
```

### 3.3 动态获取可用模型

```typescript
async getAvailableModels() {
  const response = await fetch(`${API_BASE_URL}/models`, { headers });
  const data = await response.json();

  return data.data.models.map(m => ({
    id: m.id,
    provider: m.provider,
    name: m.name,
    contextWindow: m.contextWindow
  }));
}
```

---

## 4. System Prompt 配置

### 4.1 配置优先级（从高到低）

```
1️⃣ systemPrompt（直接指定）
    ↓
2️⃣ context.systemPrompts[promptType]（动态查找）
    ↓
3️⃣ 默认值: "You are a helpful AI assistant"
```

### 4.2 三种配置方式

#### 方式 1: 直接指定（推荐用于简单场景）

```typescript
{
  "model": "anthropic/claude-3-7-sonnet-20250219",
  "systemPrompt": "你是一个微信群助手，负责回答群成员的问题。请保持友好、热情、简洁的态度。",
  "messages": [...]
}
```

✅ **优点**: 简单直接
❌ **缺点**: 不支持多场景管理

#### 方式 2: 使用 promptType + context（推荐用于多场景）

```typescript
{
  "model": "anthropic/claude-3-7-sonnet-20250219",
  "promptType": "wechatGroupAssistant",
  "context": {
    "systemPrompts": {
      "wechatGroupAssistant": "你是一个微信群助手...",
      "customerService": "你是一个客户服务助手...",
      "eventOperator": "你是一个活动运营助手..."
    }
  },
  "messages": [...]
}
```

✅ **优点**: 支持多场景、易于管理
✅ **promptType 自动启用对应工具集**

#### 方式 3: 仅使用 promptType（启用工具）

```typescript
{
  "model": "anthropic/claude-3-7-sonnet-20250219",
  "promptType": "bossZhipinSystemPrompt", // 自动启用招聘工具
  "messages": [...]
}
```

✅ **优点**: 自动工具映射
⚠️ **注意**: 使用默认 system prompt

### 4.3 System Prompt 编写最佳实践

```typescript
// ✅ 好的 System Prompt
const goodPrompt = `你是一个微信群助手，负责以下职责：

1. 回答群成员的问题
2. 活跃群氛围
3. 引导话题讨论

回复风格：
- 保持友好、热情、简洁
- 适合微信群聊天场景，不要过于正式
- 使用适当的表情符号（不要过多）
- 如果不确定答案，引导群成员进行讨论

限制：
- 不回答与群主题无关的问题
- 不参与争论或敏感话题
- 单次回复不超过200字`;

// ❌ 不好的 System Prompt
const badPrompt = '你是一个助手'; // 太简单
```

**编写清单**：
- ✅ 明确定义角色和职责
- ✅ 设定具体的行为规范
- ✅ 指定输出格式
- ✅ 说明限制和边界
- ✅ 提供示例（如有必要）

---

## 5. 消息格式

### 5.1 两种格式对比

#### 简化格式（推荐）

```typescript
// 服务端自动生成 ID 和 parts
{
  "role": "user",
  "content": "你好，请介绍一下你自己"
}
```

#### AI SDK 格式（完整控制）

```typescript
{
  "id": "msg_abc123",
  "role": "user",
  "parts": [
    {
      "type": "text",
      "text": "你好，请介绍一下你自己"
    }
  ]
}
```

### 5.2 角色说明

| 角色 | 用途 | 示例 |
|------|------|------|
| `user` | 用户提问/命令 | 用户在群里发的消息 |
| `assistant` | AI 回复 | AI 助手的回答 |
| `system` | 系统级指令 | 临时补充指令（罕用） |

### 5.3 多轮对话管理

```typescript
class ConversationManager {
  private conversations = new Map<string, Message[]>();

  addMessage(conversationId: string, message: Message) {
    const history = this.conversations.get(conversationId) || [];
    history.push(message);

    // 限制历史长度（避免过长）
    if (history.length > 20) {
      history.shift(); // 移除最早的消息
    }

    this.conversations.set(conversationId, history);
  }

  getHistory(conversationId: string): Message[] {
    return this.conversations.get(conversationId) || [];
  }
}

// 使用示例
const manager = new ConversationManager();
const conversationId = `room_${roomId}`;

// 添加用户消息
manager.addMessage(conversationId, {
  role: 'user',
  content: userMessage
});

// 发送请求（包含历史）
const response = await chat({
  model: 'anthropic/claude-3-7-sonnet-20250219',
  messages: manager.getHistory(conversationId)
});

// 添加助手回复
manager.addMessage(conversationId, response.messages[0]);
```

---

## 6. 工具系统

### 6.1 可用工具

| 工具名称 | 功能 | 使用场景 | 需要上下文 |
|---------|------|---------|-----------|
| `bash` | 执行系统命令 | 代码执行、文件操作 | E2B Sandbox |
| `zhipin_reply_generator` | 生成招聘回复 | BOSS直聘招聘 | configData, replyPrompts |

### 6.2 工具调用配置

```typescript
// 基础配置
{
  "model": "anthropic/claude-3-7-sonnet-20250219",
  "messages": [...],
  "allowedTools": ["zhipin_reply_generator"],
  "context": {
    "preferredBrand": "蜀地源冒菜",
    "configData": {
      "city": "上海",
      "brands": {
        "蜀地源冒菜": {
          "address": "上海市浦东新区XX路",
          "templates": {
            "salary_inquiry": ["基本工资4000-6000元，另有全勤奖"]
          }
        }
      }
    },
    "replyPrompts": {
      "general_chat": "你是连锁餐饮招聘助手，请用简洁礼貌的语气与候选人沟通。",
      "salary_inquiry": "用礼貌的语气说明薪资待遇"
    }
  }
}
```

### 6.3 上下文策略（contextStrategy）

```typescript
// 策略 1: error（默认，严格模式）
{
  "contextStrategy": "error",
  // 缺少必需上下文时返回 400 错误
}

// 策略 2: skip（宽松模式）
{
  "contextStrategy": "skip",
  // 跳过无法实例化的工具，继续执行
  // 推荐用于微信群场景
}

// 策略 3: report（验证模式）
{
  "contextStrategy": "report",
  // 只返回验证报告，不执行请求
}
```

### 6.4 工具调用限制

⚠️ **重要限制**：
- 最多执行 **30 步**
- 超时时间 **2 分钟**
- 超出后自动中止

### 6.5 验证工具配置

```typescript
// 验证模式：不执行请求，只检查配置
const validation = await fetch(`${API_BASE_URL}/chat`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    model: 'anthropic/claude-3-7-sonnet-20250219',
    messages: [...],
    allowedTools: ['zhipin_reply_generator'],
    context: {...},
    validateOnly: true // 关键参数
  })
});

const result = await validation.json();
if (!result.data.valid) {
  console.error('配置错误:', result.data.errors);
}
```

---

## 7. 上下文管理

### 7.1 上下文结构

```typescript
interface ChatContext {
  // 业务配置数据
  configData?: {
    city: string;
    stores: Store[];
    brands: Record<string, BrandConfig>;
  };

  // 回复提示词
  replyPrompts?: {
    general_chat: string;
    salary_inquiry: string;
    // ... 更多场景
  };

  // System Prompt 映射表
  systemPrompts?: {
    [promptType: string]: string;
  };

  // API Token
  dulidayToken?: string;

  // 首选品牌
  preferredBrand?: string;

  // 模型配置
  modelConfig?: {
    chatModel?: string;
    classifyModel?: string;
  };

  // 其他业务字段
  [key: string]: any;
}
```

### 7.2 工具级上下文（toolContext）

```typescript
// toolContext 优先级更高，会覆盖全局 context
{
  "context": {
    "replyPrompts": {
      "general_chat": "全局提示词"
    }
  },
  "toolContext": {
    "zhipin_reply_generator": {
      "replyPrompts": {
        "general_chat": "工具专用提示词（优先使用）"
      }
    }
  }
}
```

### 7.3 上下文管理最佳实践

```typescript
// 方式 1: 分层管理（推荐）
class ContextManager {
  // 基础配置（所有场景共享）
  getBaseContext() {
    return {
      configData: this.loadConfigFromDB(),
      dulidayToken: process.env.DULIDAY_TOKEN
    };
  }

  // 场景特定配置
  getScenarioContext(scenario: string) {
    const base = this.getBaseContext();

    switch (scenario) {
      case 'wechat-group':
        return {
          ...base,
          systemPrompts: {
            wechatGroupAssistant: '微信群助手提示词...'
          }
        };

      case 'boss-zhipin':
        return {
          ...base,
          replyPrompts: {
            general_chat: '招聘助手提示词...'
          }
        };

      default:
        return base;
    }
  }
}

// 使用
const contextManager = new ContextManager();
const context = contextManager.getScenarioContext('wechat-group');
```

---

## 8. 消息剪裁

### 8.1 为什么需要消息剪裁？

- 📉 **降低成本**: Token 使用量减少 50-68%
- ⚡ **提升速度**: 更少的 Token 处理更快
- ✅ **避免超限**: 防止超出模型上下文长度

### 8.2 剪裁配置

```typescript
{
  "prune": true,
  "pruneOptions": {
    // 最大输出 Token 数
    "maxOutputTokens": 15000,

    // 目标 Token 数（剪裁到此值）
    "targetTokens": 8000,

    // 保留最近 N 条消息（不剪裁）
    "preserveRecentMessages": 5
  }
}
```

### 8.3 剪裁策略

1. **始终保留**:
   - System Prompt
   - 最近 N 条消息（由 `preserveRecentMessages` 控制）

2. **优先删除**:
   - 时间较早的消息
   - 保持用户-助手消息对完整性

3. **渐进式剪裁**:
   - 第一轮：删除早期消息
   - 第二轮：如仍超限，继续删除

### 8.4 场景推荐配置

```typescript
// 场景 1: 活跃微信群（推荐）
{
  "prune": true,
  "pruneOptions": {
    "targetTokens": 8000,
    "preserveRecentMessages": 10 // 保留最近10条
  }
}

// 场景 2: 长时间招聘对话
{
  "prune": true,
  "pruneOptions": {
    "targetTokens": 12000,
    "preserveRecentMessages": 3 // 招聘对话通常较短
  }
}

// 场景 3: 客服对话（不建议剪裁）
{
  "prune": false
  // 需要完整历史记录
}
```

### 8.5 检查是否被剪裁

```typescript
const response = await fetch(...);

// 检查响应头
const wasPruned = response.headers.get('X-Message-Pruned');
if (wasPruned === 'true') {
  console.warn('消息历史被剪裁');
}
```

### 8.6 剪裁注意事项

⚠️ **谨慎使用的场景**：
- 客户投诉处理（需要完整上下文）
- 复杂问题排查
- 法律/合规对话

✅ **适合使用的场景**：
- 微信群闲聊
- 高频简单问答
- 活动通知回复

---

## 9. 错误处理

### 9.1 标准错误响应

```typescript
interface ErrorResponse {
  error: string;           // 错误类型
  message: string;         // 人类可读描述
  details?: any;          // 额外上下文
  statusCode: number;     // HTTP 状态码
  correlationId?: string; // 请求唯一标识
}
```

### 9.2 完整错误处理示例

```typescript
async function chatWithErrorHandling(params: ChatParams) {
  try {
    const response = await fetch(`${API_BASE_URL}/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify(params)
    });

    const data = await response.json();

    // 检查业务错误
    if (!data.success) {
      throw new AgentApiError(data.error, data.details, response.status);
    }

    return data.data;

  } catch (error) {
    // 分类处理错误
    if (error instanceof AgentApiError) {
      return handleAgentError(error);
    }

    if (error.code === 'ECONNREFUSED') {
      throw new Error('Agent API 服务不可用');
    }

    if (error.code === 'ETIMEDOUT') {
      throw new Error('请求超时');
    }

    throw error;
  }
}

function handleAgentError(error: AgentApiError) {
  switch (error.statusCode) {
    case 400:
      // 参数错误
      if (error.details?.missingContext) {
        throw new Error(
          `缺少必需上下文: ${error.details.missingContext.join(', ')}`
        );
      }
      throw new Error(`请求参数错误: ${error.message}`);

    case 401:
      // 认证失败
      throw new Error('API Key 无效或已过期');

    case 403:
      // 权限不足
      throw new Error('模型或工具不在授权列表中');

    case 429:
      // 频率限制
      const retryAfter = error.details?.retryAfter || 60;
      throw new Error(`请求频率过高，请 ${retryAfter} 秒后重试`);

    case 500:
    case 503:
      // 服务器错误
      throw new Error('服务暂时不可用，请稍后重试');

    default:
      throw new Error(`未知错误: ${error.message}`);
  }
}
```

### 9.3 重试机制（指数退避）

```typescript
async function chatWithRetry(
  params: ChatParams,
  maxRetries = 3
): Promise<ChatResponse> {
  let lastError;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await chatWithErrorHandling(params);
    } catch (error) {
      lastError = error;

      // 不重试的错误类型
      if (
        error.statusCode === 400 || // 参数错误
        error.statusCode === 401 || // 认证失败
        error.statusCode === 403    // 权限不足
      ) {
        throw error;
      }

      // 指数退避
      const delay = Math.pow(2, i) * 1000; // 1s, 2s, 4s
      await sleep(delay);
    }
  }

  throw lastError;
}
```

### 9.4 记录 correlationId

```typescript
async function chat(params: ChatParams) {
  try {
    const response = await fetch(...);
    const data = await response.json();

    // 从响应头或响应体获取 correlationId
    const correlationId =
      response.headers.get('X-Correlation-Id') ||
      data.correlationId;

    // 记录到日志
    logger.info('Chat request completed', {
      correlationId,
      conversationId: params.conversationId,
      success: data.success
    });

    return data;

  } catch (error) {
    logger.error('Chat request failed', {
      error: error.message,
      params
    });
    throw error;
  }
}
```

---

## 10. 性能优化

### 10.1 优化策略总览

| 策略 | Token 节省 | 延迟改善 | 成本节省 | 实施难度 |
|------|-----------|---------|---------|---------|
| 消息剪裁 | 50-68% | ⭐⭐⭐ | ⭐⭐⭐⭐ | 简单 |
| 模型选择 | 视场景 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 简单 |
| 响应缓存 | N/A | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 中等 |
| 精简 Prompt | 10-20% | ⭐⭐ | ⭐⭐ | 简单 |
| 选择性工具 | 5-15% | ⭐⭐⭐ | ⭐⭐ | 简单 |

### 10.2 消息剪裁（最有效）

```typescript
// 可节省 40-70% Token 使用量
{
  "prune": true,
  "pruneOptions": {
    "targetTokens": 8000,
    "preserveRecentMessages": 5
  }
}
```

**效果示例**：
- 小型应用: $45/月 → $20/月 ✅
- 中型应用: $600/月 → $250/月 ✅
- 大型应用: $5400/月 → $2200/月 ✅

### 10.3 智能模型选择

```typescript
function selectModel(taskType: string, complexity: 'simple' | 'complex') {
  if (complexity === 'simple') {
    return 'qwen/qwen-plus'; // 高性价比
  }

  switch (taskType) {
    case 'chinese-qa':
      return 'qwen/qwen-max'; // 中文场景

    case 'code-generation':
    case 'reasoning':
      return 'anthropic/claude-3-7-sonnet-20250219'; // 复杂推理

    case 'multimodal':
      return 'openai/gpt-4o'; // 多模态

    default:
      return 'anthropic/claude-3-7-sonnet-20250219'; // 通用
  }
}
```

### 10.4 响应缓存

```typescript
class ResponseCache {
  private cache = new Map<string, {
    response: ChatResponse;
    timestamp: number;
  }>();

  private TTL = 3600000; // 1小时

  getCacheKey(params: ChatParams): string {
    // 基于消息内容生成缓存键
    const lastMessage = params.messages[params.messages.length - 1];
    return `${params.model}:${lastMessage.content}`;
  }

  get(params: ChatParams): ChatResponse | null {
    const key = this.getCacheKey(params);
    const cached = this.cache.get(key);

    if (!cached) return null;

    // 检查是否过期
    if (Date.now() - cached.timestamp > this.TTL) {
      this.cache.delete(key);
      return null;
    }

    return cached.response;
  }

  set(params: ChatParams, response: ChatResponse) {
    const key = this.getCacheKey(params);
    this.cache.set(key, {
      response,
      timestamp: Date.now()
    });
  }
}

// 使用
const cache = new ResponseCache();

async function chatWithCache(params: ChatParams) {
  // 尝试从缓存获取
  const cached = cache.get(params);
  if (cached) {
    return cached;
  }

  // 调用 API
  const response = await chat(params);

  // 缓存响应
  cache.set(params, response);

  return response;
}
```

### 10.5 精简 System Prompt

```typescript
// ❌ 冗长的 Prompt (1200 tokens)
const verbosePrompt = `
你是一个非常专业的、经验丰富的、知识渊博的...
（省略大段描述）
你应该始终保持礼貌、友好、耐心...
（省略更多描述）
`;

// ✅ 精简的 Prompt (400 tokens)
const concisePrompt = `你是微信群助手，职责：
1. 回答群成员问题
2. 活跃群氛围

风格：友好、简洁（≤200字）
限制：避免敏感话题`;
```

### 10.6 选择性启用工具

```typescript
// ❌ 总是启用所有工具
{
  "allowedTools": ["bash", "zhipin_reply_generator", "..."]
}

// ✅ 根据场景选择工具
function getTools(scenario: string) {
  switch (scenario) {
    case 'recruitment':
      return ['zhipin_reply_generator'];

    case 'code-assistance':
      return ['bash'];

    default:
      return []; // 纯对话不需要工具
  }
}
```

### 10.7 监控和分析

```typescript
class UsageMonitor {
  async logUsage(response: ChatResponse, params: ChatParams) {
    const usage = response.usage;

    logger.info('API Usage', {
      conversationId: params.conversationId,
      model: params.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      // 计算成本（示例）
      estimatedCost: this.calculateCost(usage, params.model)
    });
  }

  calculateCost(usage: UsageStats, model: string): number {
    // 根据模型定价计算
    const pricing = {
      'anthropic/claude-3-7-sonnet-20250219': {
        input: 0.003,  // 每1K tokens
        output: 0.015
      },
      'qwen/qwen-plus': {
        input: 0.0004,
        output: 0.002
      }
    };

    const price = pricing[model];
    return (
      (usage.inputTokens / 1000) * price.input +
      (usage.outputTokens / 1000) * price.output
    );
  }
}
```

---

## 11. 调试技巧

### 11.1 使用 correlationId

```typescript
// 从响应中获取
const correlationId = response.headers.get('X-Correlation-Id');

// 或从响应体获取
const data = await response.json();
const correlationId = data.correlationId;

// 记录到日志
logger.error('API Error', {
  correlationId,  // 提供给技术支持
  error: errorMessage
});
```

### 11.2 配置验证模式

```typescript
// 在实际调用前验证配置
async function validateConfig(params: ChatParams) {
  const validationParams = {
    ...params,
    validateOnly: true  // 关键！
  };

  const response = await fetch(`${API_BASE_URL}/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(validationParams)
  });

  const data = await response.json();

  if (!data.data.valid) {
    console.error('配置错误:', data.data.errors);
    console.error('缺少上下文:', data.data.missingContext);
    console.error('工具问题:', data.data.toolIssues);
    return false;
  }

  return true;
}

// 在生产环境部署前验证
const isValid = await validateConfig(productionConfig);
if (!isValid) {
  throw new Error('配置验证失败');
}
```

### 11.3 响应头分析

```typescript
async function analyzeResponse(response: Response) {
  return {
    correlationId: response.headers.get('X-Correlation-Id'),
    wasPruned: response.headers.get('X-Message-Pruned') === 'true',
    skippedTools: response.headers.get('X-Skipped-Tools')?.split(','),
    processingTime: parseInt(response.headers.get('X-Processing-Time') || '0')
  };
}
```

### 11.4 完整日志记录

```typescript
class AgentLogger {
  async logRequest(params: ChatParams, requestId: string) {
    logger.info('Agent API Request', {
      requestId,
      timestamp: new Date().toISOString(),
      conversationId: params.conversationId,
      model: params.model,
      messageCount: params.messages.length,
      hasTools: !!params.allowedTools?.length,
      prune: params.prune
    });
  }

  async logResponse(
    response: ChatResponse,
    requestId: string,
    duration: number
  ) {
    logger.info('Agent API Response', {
      requestId,
      duration,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      totalTokens: response.usage.totalTokens,
      toolsUsed: response.tools.used,
      toolsSkipped: response.tools.skipped
    });
  }

  async logError(error: any, requestId: string, params: ChatParams) {
    logger.error('Agent API Error', {
      requestId,
      correlationId: error.correlationId,
      statusCode: error.statusCode,
      error: error.message,
      details: error.details,
      params: {
        conversationId: params.conversationId,
        model: params.model
      }
    });
  }
}
```

### 11.5 性能监控脚本

```typescript
class PerformanceMonitor {
  private metrics: {
    requestCount: number;
    errorCount: number;
    totalTokens: number;
    avgResponseTime: number;
  } = {
    requestCount: 0,
    errorCount: 0,
    totalTokens: 0,
    avgResponseTime: 0
  };

  recordRequest(duration: number, tokens: number, success: boolean) {
    this.metrics.requestCount++;

    if (!success) {
      this.metrics.errorCount++;
    }

    this.metrics.totalTokens += tokens;

    // 更新平均响应时间
    this.metrics.avgResponseTime =
      (this.metrics.avgResponseTime * (this.metrics.requestCount - 1) + duration) /
      this.metrics.requestCount;
  }

  getReport() {
    return {
      ...this.metrics,
      errorRate: this.metrics.errorCount / this.metrics.requestCount,
      avgTokensPerRequest: this.metrics.totalTokens / this.metrics.requestCount
    };
  }
}
```

---

## 12. 常见错误码

### 12.1 错误码快速参考

| 状态码 | 错误类型 | 原因 | 解决方案 |
|--------|---------|------|---------|
| 200 | ✅ Success | 请求成功 | - |
| 400 | ❌ Bad Request | 参数错误 | 检查请求参数 |
| 401 | ❌ Unauthorized | 认证失败 | 检查 API Key |
| 403 | ❌ Forbidden | 权限不足 | 检查模型/工具授权 |
| 404 | ❌ Not Found | 资源不存在 | 检查 URL |
| 429 | ❌ Rate Limit | 请求过频 | 实施重试 |
| 500 | ❌ Server Error | 服务器错误 | 稍后重试 |
| 503 | ❌ Unavailable | 服务不可用 | 稍后重试 |

### 12.2 400 错误详细处理

```typescript
function handle400Error(error: ErrorResponse) {
  const { details } = error;

  // 缺少必需参数
  if (details?.missingFields) {
    throw new Error(
      `缺少必需参数: ${details.missingFields.join(', ')}`
    );
  }

  // 缺少上下文
  if (details?.missingContext && details?.tools) {
    throw new Error(
      `工具 ${details.tools.join(', ')} 缺少上下文: ${details.missingContext.join(', ')}`
    );
  }

  // 无效的 promptType
  if (details?.invalidPromptType) {
    console.warn(
      `promptType "${details.invalidPromptType}" 无效，将使用默认提示词`
    );
  }

  // 其他参数错误
  throw new Error(`请求参数错误: ${error.message}`);
}
```

### 12.3 401/403 认证授权问题

```typescript
function handleAuthError(statusCode: number, error: ErrorResponse) {
  if (statusCode === 401) {
    // API Key 问题
    throw new Error(
      'API Key 无效或已过期，请检查:\n' +
      '1. API Key 是否正确\n' +
      '2. 是否已激活\n' +
      '3. Authorization header 格式是否正确'
    );
  }

  if (statusCode === 403) {
    // 权限问题
    if (error.details?.unavailableModel) {
      throw new Error(
        `模型 "${error.details.unavailableModel}" 不在授权列表中\n` +
        '请使用 GET /models 查看可用模型'
      );
    }

    if (error.details?.unavailableTool) {
      throw new Error(
        `工具 "${error.details.unavailableTool}" 不在授权列表中\n` +
        '请使用 GET /tools 查看可用工具'
      );
    }

    throw new Error('权限不足');
  }
}
```

### 12.4 429 频率限制处理

```typescript
async function handleRateLimit(error: ErrorResponse) {
  const retryAfter = error.details?.retryAfter || 60; // 秒

  logger.warn('Rate limit exceeded', {
    retryAfter,
    message: error.message
  });

  // 等待后重试
  await sleep(retryAfter * 1000);

  // 或者抛出错误让上层处理
  throw new Error(
    `请求频率过高，请 ${retryAfter} 秒后重试`
  );
}
```

### 12.5 5xx 服务器错误处理

```typescript
function handle5xxError(statusCode: number, error: ErrorResponse) {
  const shouldRetry = statusCode === 500 || statusCode === 503;

  if (shouldRetry) {
    throw new RetryableError(
      `服务暂时不可用 (${statusCode})，可以重试`,
      error.correlationId
    );
  }

  throw new Error(
    `服务器错误 (${statusCode}): ${error.message}\n` +
    `Correlation ID: ${error.correlationId}`
  );
}
```

---

## 附录 A: 完整请求示例

### 微信群助手（简单对话）

```typescript
const response = await fetch(`${API_BASE_URL}/chat`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'anthropic/claude-3-7-sonnet-20250219',
    systemPrompt: '你是一个微信群助手，保持友好、简洁的态度回答问题。',
    messages: [
      { role: 'user', content: '今天天气怎么样？' }
    ]
  })
});
```

### BOSS直聘招聘助手（工具调用）

```typescript
const response = await fetch(`${API_BASE_URL}/chat`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'anthropic/claude-3-7-sonnet-20250219',
    promptType: 'bossZhipinSystemPrompt',
    messages: [
      { role: 'user', content: '候选人问：你们薪资待遇怎么样？' }
    ],
    allowedTools: ['zhipin_reply_generator'],
    context: {
      preferredBrand: '蜀地源冒菜',
      configData: {
        city: '上海',
        brands: {
          '蜀地源冒菜': {
            templates: {
              salary_inquiry: ['基本工资4000-6000元，另有全勤奖、绩效奖等']
            }
          }
        }
      },
      replyPrompts: {
        salary_inquiry: '用礼貌的语气说明薪资待遇'
      }
    },
    contextStrategy: 'error'
  })
});
```

### 长对话场景（启用剪裁）

```typescript
const response = await fetch(`${API_BASE_URL}/chat`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'qwen/qwen-max',
    systemPrompt: '你是客户服务助手',
    messages: conversationHistory, // 可能很长
    prune: true,
    pruneOptions: {
      targetTokens: 8000,
      preserveRecentMessages: 5
    }
  })
});
```

---

## 附录 B: TypeScript 类型定义

```typescript
// 完整的类型定义，可直接复制到项目中
export interface ChatRequest {
  model: string;
  messages: (SimpleMessage | UIMessage)[];
  stream?: false;
  systemPrompt?: string;
  promptType?: string;
  allowedTools?: string[];
  context?: ChatContext;
  toolContext?: ToolContext;
  contextStrategy?: 'error' | 'skip' | 'report';
  prune?: boolean;
  pruneOptions?: PruneOptions;
  validateOnly?: boolean;
}

export interface SimpleMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface UIMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  parts: MessagePart[];
}

export interface MessagePart {
  type: 'text';
  text: string;
}

export interface ChatContext {
  configData?: any;
  replyPrompts?: Record<string, string>;
  systemPrompts?: Record<string, string>;
  dulidayToken?: string;
  preferredBrand?: string;
  modelConfig?: {
    chatModel?: string;
    classifyModel?: string;
  };
  [key: string]: any;
}

export interface ToolContext {
  [toolName: string]: Record<string, any>;
}

export interface PruneOptions {
  maxOutputTokens?: number;
  targetTokens?: number;
  preserveRecentMessages?: number;
}

export interface ChatResponse {
  messages: UIMessage[];
  usage: UsageStats;
  tools: ToolsInfo;
}

export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
}

export interface ToolsInfo {
  used: string[];
  skipped: string[];
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
  correlationId?: string;
}

export interface ErrorResponse {
  error: string;
  message: string;
  details?: any;
  statusCode: number;
  correlationId?: string;
}
```

---

## 总结

### 核心要点回顾

1. **认证安全**
   - 使用环境变量存储 API Key
   - 仅通过 HTTPS 调用
   - 日志中脱敏处理

2. **模型选择**
   - 根据场景选择合适模型
   - 简单任务用 Qwen Plus
   - 复杂任务用 Claude 3.7 Sonnet

3. **System Prompt**
   - 优先级: systemPrompt > context.systemPrompts[promptType] > 默认
   - 使用 promptType 管理多场景
   - 保持提示词简洁明确

4. **工具调用**
   - 提供完整上下文
   - 选择合适的 contextStrategy
   - 使用 validateOnly 验证配置

5. **性能优化**
   - 启用消息剪裁（节省 50-68% Token）
   - 实施响应缓存
   - 选择性启用工具

6. **错误处理**
   - 实施重试机制
   - 记录 correlationId
   - 分类处理不同错误

7. **调试技巧**
   - 使用 validateOnly 预检
   - 分析响应头
   - 完整日志记录

### 快速检查清单

在部署到生产环境前，检查：

- [ ] API Key 已安全存储
- [ ] 已选择合适的模型
- [ ] System Prompt 已优化
- [ ] 错误处理已实施
- [ ] 已启用消息剪裁（如适用）
- [ ] 日志记录已配置
- [ ] 已测试工具配置（如使用工具）
- [ ] 已实施重试机制
- [ ] 已配置性能监控

---

**文档版本**: v1.0
**最后更新**: 2025-10-15
**基于**: 花卷智能体 API 官方文档 (https://docs.wolian.cc)
