# 花卷 Agent API 使用指南

> 基于花卷智能体 API 文档整理的核心使用指南

---

## 📖 相关文档

本文档说明**如何调用花卷智能体 API**（Huajune Agent）。

配合阅读：
- [Agent 服务架构](agent-service-architecture.md) - 了解我们的服务如何封装和使用这些 API

**阅读顺序建议**:
1. 先读本文档 - 理解花卷 Agent API 的使用方法
2. 再读服务架构文档 - 了解我们的封装实现

---

## 目录

- [1. 快速开始](#1-快速开始)
- [2. 认证与安全](#2-认证与安全)
- [3. 模型选择](#3-模型选择)
- [4. System Prompt](#4-system-prompt)
- [5. 消息格式](#5-消息格式)
- [6. 工具系统](#6-工具系统)
- [7. 上下文管理](#7-上下文管理)
- [8. 消息剪裁](#8-消息剪裁)
- [9. 错误处理](#9-错误处理)

---

## 1. 快速开始

### 1.1 基本配置

```typescript
const API_BASE_URL = 'https://huajune.duliday.com/api/v1';
const API_KEY = process.env.AGENT_API_KEY;

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

---

## 2. 认证与安全

### 2.1 API Key 获取

1. 访问 [Wolian AI 平台](https://wolian.cc/platform/clients-management)
2. 创建客户端密钥并激活
3. **立即复制保存**（仅显示一次）

### 2.2 安全最佳实践

```typescript
// ✅ 推荐：使用环境变量
const apiKey = process.env.AGENT_API_KEY;

// ❌ 避免：硬编码在代码中
// const apiKey = '31ad14.**********';

// ✅ 推荐：请求日志脱敏
logger.log('API Request', {
  apiKey: apiKey.substring(0, 6) + '****'
});
```

---

## 3. 模型选择

### 3.1 可用模型对比

| 模型 | 适用场景 | 推荐度 |
|------|---------|--------|
| **Claude 3.7 Sonnet** | 通用对话、代码生成、复杂推理 | ⭐⭐⭐⭐⭐ |
| **GPT-4o** | 多模态任务、视觉理解 | ⭐⭐⭐⭐ |
| **Qwen Max** | 中文场景、成本敏感 | ⭐⭐⭐⭐ |
| **Qwen Plus** | 高频调用、开发测试 | ⭐⭐⭐ |

### 3.2 动态获取可用模型

```typescript
async getAvailableModels() {
  const response = await fetch(`${API_BASE_URL}/models`, { headers });
  const data = await response.json();
  return data.data.models;
}
```

---

## 4. System Prompt

### 4.1 配置优先级（从高到低）

```
1️⃣ systemPrompt（直接指定）
    ↓
2️⃣ context.systemPrompts[promptType]（动态查找）
    ↓
3️⃣ 默认值: "You are a helpful AI assistant"
```

### 4.2 三种配置方式

#### 方式 1: 直接指定（简单场景）

```typescript
{
  "systemPrompt": "你是一个微信群助手，负责回答群成员的问题。",
  "messages": [...]
}
```

#### 方式 2: 使用 promptType + context（多场景）

```typescript
{
  "promptType": "wechatGroupAssistant",
  "context": {
    "systemPrompts": {
      "wechatGroupAssistant": "你是一个微信群助手...",
      "customerService": "你是一个客户服务助手..."
    }
  },
  "messages": [...]
}
```

#### 方式 3: 仅使用 promptType（启用工具）

```typescript
{
  "promptType": "bossZhipinSystemPrompt", // 自动启用招聘工具
  "messages": [...]
}
```

### 4.3 编写最佳实践

```typescript
const goodPrompt = `你是一个微信群助手，负责以下职责：
1. 回答群成员的问题
2. 活跃群氛围
3. 引导话题讨论

回复风格：
- 保持友好、热情、简洁
- 适合微信群聊天场景
- 单次回复不超过200字

限制：
- 不回答与群主题无关的问题
- 不参与争论或敏感话题`;
```

**编写清单**：
- ✅ 明确定义角色和职责
- ✅ 设定具体的行为规范
- ✅ 指定输出格式
- ✅ 说明限制和边界

---

## 5. 消息格式

### 5.1 两种格式

#### 简化格式（推荐）

```typescript
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
    { "type": "text", "text": "你好，请介绍一下你自己" }
  ]
}
```

### 5.2 角色说明

| 角色 | 用途 |
|------|------|
| `user` | 用户提问/命令 |
| `assistant` | AI 回复 |
| `system` | 系统级指令（罕用） |

### 5.3 多轮对话管理

```typescript
class ConversationManager {
  private conversations = new Map<string, Message[]>();

  addMessage(conversationId: string, message: Message) {
    const history = this.conversations.get(conversationId) || [];
    history.push(message);

    // 限制历史长度（避免过长）
    if (history.length > 20) {
      history.shift();
    }

    this.conversations.set(conversationId, history);
  }

  getHistory(conversationId: string): Message[] {
    return this.conversations.get(conversationId) || [];
  }
}
```

---

## 6. 工具系统

### 6.1 可用工具

| 工具名称 | 功能 | 需要上下文 |
|---------|------|-----------|
| `bash` | 执行系统命令 | E2B Sandbox |
| `zhipin_reply_generator` | 生成招聘回复 | configData, replyPrompts |
| `duliday_job_list` | 获取岗位列表 | dulidayToken |
| `duliday_job_details` | 获取岗位详情 | dulidayToken |

### 6.2 工具调用配置

```typescript
{
  "allowedTools": ["duliday_job_list"],
  "context": {
    "dulidayToken": "your-api-token"
  }
}
```

### 6.3 上下文策略（contextStrategy）

| 策略 | 行为 | 使用场景 |
|------|------|---------|
| `error` | 缺少上下文时返回 400 错误 | 严格模式（默认） |
| `skip` | 跳过无法实例化的工具 | 微信群场景（推荐） |
| `report` | 只返回验证报告，不执行 | 配置验证 |

```typescript
{
  "contextStrategy": "skip", // 推荐用于微信群
  "allowedTools": ["duliday_job_list"]
}
```

### 6.4 工具调用限制

- 最多执行 **30 步**
- 超时时间 **2 分钟**
- 超出后自动中止

---

## 7. 上下文管理

### 7.1 上下文结构

```typescript
interface ChatContext {
  // API Token
  dulidayToken?: string;

  // System Prompt 映射表
  systemPrompts?: {
    [promptType: string]: string;
  };

  // 回复提示词
  replyPrompts?: {
    general_chat: string;
    salary_inquiry: string;
  };

  // 业务配置数据
  configData?: {
    city: string;
    brands: Record<string, BrandConfig>;
  };

  // 首选品牌
  preferredBrand?: string;
}
```

### 7.2 工具级上下文（toolContext）

```typescript
// toolContext 优先级更高，会覆盖全局 context
{
  "context": {
    "replyPrompts": { "general_chat": "全局提示词" }
  },
  "toolContext": {
    "zhipin_reply_generator": {
      "replyPrompts": { "general_chat": "工具专用提示词（优先使用）" }
    }
  }
}
```

### 7.3 分层管理（推荐）

```typescript
class ContextManager {
  // 基础配置（所有场景共享）
  getBaseContext() {
    return {
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
          systemPrompts: { wechatGroupAssistant: '...' }
        };
      case 'boss-zhipin':
        return {
          ...base,
          replyPrompts: { general_chat: '...' }
        };
      default:
        return base;
    }
  }
}
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

**始终保留**:
- System Prompt
- 最近 N 条消息（由 `preserveRecentMessages` 控制）

**优先删除**:
- 时间较早的消息
- 保持用户-助手消息对完整性

### 8.4 场景推荐配置

```typescript
// 场景 1: 活跃微信群（推荐）
{
  "prune": true,
  "pruneOptions": {
    "targetTokens": 8000,
    "preserveRecentMessages": 10
  }
}

// 场景 2: 长时间招聘对话
{
  "prune": true,
  "pruneOptions": {
    "targetTokens": 12000,
    "preserveRecentMessages": 3
  }
}

// 场景 3: 客服对话（不建议剪裁）
{
  "prune": false // 需要完整历史记录
}
```

---

## 9. 错误处理

### 9.1 常见错误码

| 错误码 | 说明 | 处理方式 |
|--------|------|---------|
| `400` | 请求参数错误 | 检查请求体格式 |
| `401` | 未授权 | 检查 API Key 是否有效 |
| `429` | 请求频率过高 | 实现指数退避重试 |
| `500` | 服务器错误 | 重试请求 |
| `CONTEXT_MISSING` | 缺少必需的上下文 | 提供工具所需的上下文 |

### 9.2 重试策略

```typescript
async function chatWithRetry(params, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify(params)
      });

      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After') || 1;
        await sleep(retryAfter * 1000);
        continue;
      }

      if (response.status >= 500) {
        await sleep(Math.pow(2, i) * 1000); // 指数退避
        continue;
      }

      return await response.json();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await sleep(Math.pow(2, i) * 1000);
    }
  }
}
```

### 9.3 错误响应格式

```typescript
{
  "success": false,
  "error": {
    "code": "CONTEXT_MISSING",
    "message": "工具 duliday_job_list 缺少必需的上下文",
    "details": {
      "missingContext": ["dulidayToken"],
      "tools": ["duliday_job_list"]
    }
  }
}
```

### 9.4 验证上下文

```typescript
// 使用 validateOnly 验证配置
const validation = await fetch(`${API_BASE_URL}/chat`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    ...params,
    validateOnly: true // 不执行请求，只验证
  })
});

const result = await validation.json();
if (!result.data.valid) {
  console.error('配置错误:', result.data.errors);
}
```

---

## 10. 核心设计模式

### 10.1 配置档案模式（推荐）

将场景配置封装为可复用的档案：

```typescript
interface AgentProfile {
  name: string;
  model: string;
  systemPrompt: string;
  allowedTools: string[];
  context: ChatContext;
  prune: boolean;
  pruneOptions: {
    targetTokens: number;
    preserveRecentMessages: number;
  };
}

// 使用档案
const candidateConsultation: AgentProfile = {
  name: 'candidate-consultation',
  model: 'anthropic/claude-3-7-sonnet-20250219',
  systemPrompt: '你是候选人咨询助手...',
  allowedTools: ['duliday_job_list', 'duliday_job_details'],
  context: { dulidayToken: process.env.DULIDAY_TOKEN },
  prune: true,
  pruneOptions: { targetTokens: 8000, preserveRecentMessages: 5 }
};
```

### 10.2 历史管理模式

```typescript
class MessageHistory {
  private history = new Map<string, Message[]>();
  private readonly maxHistory = 20;

  add(conversationId: string, message: Message) {
    const messages = this.history.get(conversationId) || [];
    messages.push(message);

    if (messages.length > this.maxHistory) {
      messages.shift();
    }

    this.history.set(conversationId, messages);
  }

  get(conversationId: string): Message[] {
    return this.history.get(conversationId) || [];
  }

  clear(conversationId: string) {
    this.history.delete(conversationId);
  }
}
```

---

**最后更新**: 2025-11-04
**官方文档**: https://docs.wolian.cc/
