# 消息处理流程架构文档

## 目录
- [1. 架构概述](#1-架构概述)
- [2. 核心服务](#2-核心服务)
- [3. 消息处理流程](#3-消息处理流程)
- [4. 智能消息聚合](#4-智能消息聚合)
- [5. 消息去重机制](#5-消息去重机制)
- [6. 消息历史管理](#6-消息历史管理)
- [7. 消息发送](#7-消息发送)
- [8. 性能优化](#8-性能优化)
- [9. 监控与调试](#9-监控与调试)
- [10. 扩展指南](#10-扩展指南)

---

## 1. 架构概述

### 1.1 设计理念

消息处理服务采用**三层架构**和**服务化拆分**设计，实现了从企业微信消息接收到 AI 回复的完整链路：

```
┌──────────────────────────────────────────────────────────────┐
│                    企业微信服务器                              │
│         (回调通知: 用户发送消息)                                │
└──────────────────────────────────────────────────────────────┘
                            ↓ HTTP POST
┌──────────────────────────────────────────────────────────────┐
│              应用层 (Application Layer)                       │
│  ┌────────────────────────────────────────────────────────┐  │
│  │         MessageController (HTTP 接收层)                 │  │
│  │  - POST /message/callback (企微回调)                    │  │
│  │  - GET  /message/service/status (服务状态)              │  │
│  │  - GET  /message/cache/stats (缓存统计)                 │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│           业务逻辑层 (Business Logic Layer)                   │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              MessageService (协调器)                    │  │
│  │  - 消息流程编排                                          │  │
│  │  - 服务调用协调                                          │  │
│  │  - 异常处理                                              │  │
│  └────────────────────────────────────────────────────────┘  │
│                            ↓                                  │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┐   │
│  │ Message  │ Message  │ Message  │ Message  │ Message  │   │
│  │ Filter   │ Dedupe   │ History  │ Merge    │ Stats    │   │
│  │ Service  │ Service  │ Service  │ Service  │ Service  │   │
│  │(过滤验证) │ (去重)    │ (历史)    │ (聚合)    │ (统计)    │   │
│  └──────────┴──────────┴──────────┴──────────┴──────────┘   │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│          基础设施层 (Infrastructure Layer)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │  AgentModule │  │ MessageSender│  │ Bull Queue   │       │
│  │  (AI调用)     │  │ (消息发送)    │  │ (异步队列)    │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
└──────────────────────────────────────────────────────────────┘
```

### 1.2 技术栈

| 技术 | 用途 | 版本要求 |
|------|------|---------|
| **NestJS** | 模块化框架 | ^10.0.0 |
| **Bull** | 消息队列（可选） | ^4.0.0 |
| **Redis** | 缓存 + 队列后端 | - |
| **企业微信 SDK** | 消息发送 | - |
| **Agent Module** | AI 回复生成 | - |

### 1.3 文件结构

```
src/wecom/message/
├── message.module.ts                    # 模块定义（117行）
├── message.controller.ts                # HTTP 控制器（172行）
├── message.service.ts                   # 核心协调服务（643行）
├── message.processor.ts                 # Bull 队列处理器
├── services/                            # 子服务（服务化拆分）
│   ├── message-filter.service.ts        # 消息过滤验证（129行）
│   ├── message-deduplication.service.ts # 消息去重（108行）
│   ├── message-history.service.ts       # 消息历史管理（234行）
│   ├── message-merge.service.ts         # 智能消息聚合（516行）★★★
│   └── message-statistics.service.ts    # 统计监控（待实现）
├── dto/                                 # 数据传输对象
│   └── message-callback.dto.ts          # 企微回调数据结构
├── interfaces/                          # TypeScript 接口
│   └── message-merge.interface.ts       # 聚合相关接口
└── utils/                               # 工具函数
    └── message-parser.util.ts           # 消息解析工具
```

---

## 2. 核心服务

### 2.1 MessageService (协调器)

**位置**: [src/wecom/message/message.service.ts](../src/wecom/message/message.service.ts)
**代码量**: 643 行
**角色**: 核心协调者

#### 核心职责

1. **流程编排** - 协调 5 个子服务的调用顺序
2. **异常处理** - 捕获并处理各环节的异常
3. **日志记录** - 记录完整的消息处理链路
4. **异步控制** - 确保企微回调快速返回（< 100ms）

#### 关键方法

```typescript
/**
 * 处理企微消息回调
 * @param messageData 企微回调数据
 * @returns Promise<void> (异步非阻塞)
 */
async handleMessage(
  messageData: EnterpriseMessageCallbackDto
): Promise<void>

/**
 * 处理聚合后的消息列表
 * @param messages 聚合后的消息数组
 * @param chatId 会话ID
 */
private async processMessages(
  messages: EnterpriseMessageCallbackDto[],
  chatId: string
): Promise<void>
```

---

### 2.2 MessageFilterService (过滤验证)

**位置**: [src/wecom/message/services/message-filter.service.ts](../src/wecom/message/services/message-filter.service.ts)
**代码量**: 129 行

#### 核心职责

1. **消息类型过滤** - 只处理文本消息
2. **发送者过滤** - 忽略机器人自己发送的消息
3. **群聊过滤** - 支持白名单和黑名单机制
4. **关键词过滤** - 检测触发词（如 "@AI助手"）

#### 过滤规则（5级）

| 级别 | 规则 | 原因 | 示例 |
|------|------|------|------|
| **Level 1** | 非文本消息 | 暂不支持图片/文件 | 图片、视频、文件 |
| **Level 2** | 机器人自己发送 | 避免循环回复 | `senderId === botId` |
| **Level 3** | 黑名单群聊 | 未授权的群聊 | 配置在环境变量 |
| **Level 4** | 未在白名单 | 仅处理特定群聊 | 配置在环境变量 |
| **Level 5** | 缺少触发词 | 群聊中需要 @机器人 | "@AI助手" |

#### 配置示例

```bash
# 环境变量
MESSAGE_FILTER_ENABLED=true
BOT_USER_ID=bot-123
GROUP_CHAT_WHITELIST=group-1,group-2
GROUP_CHAT_BLACKLIST=group-spam
TRIGGER_KEYWORD=@AI助手
```

---

### 2.3 MessageDeduplicationService (去重)

**位置**: [src/wecom/message/services/message-deduplication.service.ts](../src/wecom/message/services/message-deduplication.service.ts)
**代码量**: 108 行

#### 核心职责

1. **消息去重** - 防止重复处理同一条消息
2. **内存管理** - LRU 策略，防止内存溢出
3. **自动清理** - 定期清理过期记录

#### 去重策略

```typescript
// 数据结构
private readonly messageCache = new Map<string, number>();

// 去重逻辑
isDuplicate(messageId: string): boolean {
  const now = Date.now();
  const existingTimestamp = this.messageCache.get(messageId);

  // 检查是否在 TTL 内重复
  if (existingTimestamp && (now - existingTimestamp) < this.ttl) {
    return true; // 重复消息
  }

  // 记录新消息
  this.messageCache.set(messageId, now);
  return false;
}
```

#### 配置参数

| 参数 | 环境变量 | 默认值 | 说明 |
|------|---------|--------|------|
| **TTL** | `DEDUP_TTL_MS` | `300000` | 5分钟内重复视为去重 |
| **最大容量** | `DEDUP_MAX_SIZE` | `10000` | LRU 缓存容量 |
| **清理间隔** | `DEDUP_CLEANUP_INTERVAL` | `60000` | 1分钟清理一次 |

#### 性能指标

- **内存占用**: 约 10KB (10,000 条消息)
- **查询时间**: O(1)
- **清理时间**: O(n)，但每次只清理过期记录

---

### 2.4 MessageHistoryService (历史管理)

**位置**: [src/wecom/message/services/message-history.service.ts](../src/wecom/message/services/message-history.service.ts)
**代码量**: 234 行

#### 核心职责

1. **历史存储** - 按 chatId 分组存储消息历史
2. **自动裁剪** - 只保留最近 N 条消息
3. **格式转换** - 将企微消息转换为 Agent API 格式
4. **AI 标记** - 标记哪些回复是 AI 生成的

#### 数据结构

```typescript
// 内存存储
private readonly conversationHistory = new Map<string, Message[]>();

// 消息格式
interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  messageId: string;
  isAiGenerated?: boolean; // AI 生成标记
}
```

#### 配置参数

| 参数 | 环境变量 | 默认值 | 说明 |
|------|---------|--------|------|
| **最大历史数** | `MAX_HISTORY_PER_CHAT` | `20` | 每个会话保留的消息数 |
| **历史 TTL** | `HISTORY_TTL_MS` | `7200000` | 2小时未活动清理 |

#### 关键方法

```typescript
/**
 * 添加用户消息到历史
 */
addUserMessage(chatId: string, message: Message): void

/**
 * 添加 AI 回复到历史
 */
addAssistantMessage(chatId: string, content: string): void

/**
 * 获取会话历史（用于传递给 Agent API）
 */
getHistory(chatId: string): Message[]

/**
 * 获取格式化的历史（用于显示）
 */
getFormattedHistory(chatId: string): string
```

---

### 2.5 MessageMergeService (智能聚合) ★★★

**位置**: [src/wecom/message/services/message-merge.service.ts](../src/wecom/message/services/message-merge.service.ts)
**代码量**: 516 行
**重要性**: ⭐⭐⭐⭐⭐ (最核心)

#### 核心职责

1. **消息聚合** - 智能合并用户快速连发的消息
2. **状态机管理** - 三阶段状态转换 (IDLE → WAITING → PROCESSING)
3. **异步收集** - 在 Agent 处理期间继续收集新消息
4. **智能重试** - Agent 响应后检查是否有新消息需要重新处理

#### 聚合策略（三阶段）

```
Phase 1: WAITING (首次聚合)
┌─────────────────────────────────────────────────────────────┐
│ 收到第一条消息                                                │
│   ↓                                                          │
│ 启动定时器（1秒）                                             │
│   ↓                                                          │
│ 收集快速连发的消息（最多3条）                                  │
│   ↓                                                          │
│ 定时器到期 或 达到最大数量 → 触发 Phase 2                     │
└─────────────────────────────────────────────────────────────┘

Phase 2: PROCESSING (Agent 处理中)
┌─────────────────────────────────────────────────────────────┐
│ 调用 Agent API                                               │
│   ↓                                                          │
│ 在等待 Agent 响应期间（~5秒）                                 │
│   ↓                                                          │
│ 被动收集新消息到待处理队列                                     │
│   ↓                                                          │
│ Agent 响应完成 → 触发 Phase 3                                │
└─────────────────────────────────────────────────────────────┘

Phase 3: 响应后检查
┌─────────────────────────────────────────────────────────────┐
│ 检查待处理队列                                                │
│   ↓                              ↓                           │
│ 有新消息（且有效）              无新消息                       │
│   ↓                              ↓                           │
│ 重新请求 Agent（最多1次）       直接发送回复                   │
│   ↓                              ↓                           │
│ 重新进入 Phase 2                结束，回到 IDLE                │
└─────────────────────────────────────────────────────────────┘
```

#### 状态转换图

```
     ┌──────┐
     │ IDLE │ (空闲)
     └───┬──┘
         │ 收到消息
         ↓
   ┌──────────┐
   │ WAITING  │ (等待聚合，1秒窗口)
   └────┬─────┘
        │ 定时器到期 或 达到3条
        ↓
 ┌─────────────┐
 │ PROCESSING  │ (Agent处理中，~5秒)
 └──────┬──────┘
        │ Agent响应完成
        ↓
    ┌───────┐
    │ 检查  │ 有新消息？
    └───┬───┘
        │
   ┌────┴────┐
   │         │
  是        否
   │         │
   ↓         ↓
 重试 →  发送回复 → IDLE
(最多1次)
```

#### 配置参数

| 参数 | 环境变量 | 默认值 | 说明 |
|------|---------|--------|------|
| **首次等待时间** | `INITIAL_MERGE_WINDOW_MS` | `1000` | 首次聚合窗口（毫秒） |
| **最大聚合数** | `MAX_MERGED_MESSAGES` | `3` | 最多聚合的消息数 |
| **最大重试次数** | `MAX_RETRY_COUNT` | `1` | Agent 响应后最多重试次数 |
| **最小消息长度** | `MIN_MESSAGE_LENGTH_TO_RETRY` | `2` | 触发重试的最小消息长度 |
| **处理期间收集** | `COLLECT_MESSAGES_DURING_PROCESSING` | `true` | 是否在处理期间收集新消息 |
| **溢出策略** | `OVERFLOW_STRATEGY` | `take-latest` | 溢出时的处理策略 |

#### 溢出策略

| 策略 | 说明 | 示例 |
|------|------|------|
| `take-latest` | 只取最新的 N 条消息 | 收到 5 条 → 处理最新 3 条 |
| `take-all` | 全部处理（不推荐） | 收到 5 条 → 处理全部 5 条 |

#### 性能优化

| 优化点 | 说明 | 收益 |
|--------|------|------|
| **智能聚合** | 避免频繁调用 Agent API | 节省 API 成本 + 降低延迟 |
| **异步收集** | 充分利用 Agent 处理时间 | 提高响应质量 |
| **有限重试** | 最多重试 1 次，避免无限循环 | 控制响应时间 |
| **消息过滤** | 过滤长度不足的消息 | 避免无效重试 |

#### 时间线示例

```
时间轴 (单条消息场景)
────────────────────────────────────────────────────────────
0s      用户发送消息 "你好"
0s      进入 WAITING 状态，启动 1 秒定时器
1s      定时器到期，聚合完成 (1 条消息)
1s      进入 PROCESSING 状态，调用 Agent API
6s      Agent 响应完成（耗时 5 秒）
6s      检查待处理队列 → 无新消息
6s      发送回复，回到 IDLE 状态
────────────────────────────────────────────────────────────
总耗时: 6 秒 ✅ 体验良好

时间轴 (多条消息场景 - 有重试)
────────────────────────────────────────────────────────────
0s      用户发送消息 "有什么"
0s      进入 WAITING 状态，启动 1 秒定时器
0.5s    用户补充 "岗位"
1s      定时器到期，聚合完成 (2 条消息: "有什么" + "岗位")
1s      进入 PROCESSING 状态，调用 Agent API
3s      用户补充 "推荐吗？" (Agent 处理中收集)
6s      Agent 响应完成（耗时 5 秒）
6s      检查待处理队列 → 有 1 条新消息 ("推荐吗？")
6s      重新请求 Agent (重试 1/1，消息: "有什么" + "岗位" + "推荐吗？")
11s     Agent 响应完成（耗时 5 秒）
11s     检查待处理队列 → 无新消息（已达重试上限）
11s     发送回复，回到 IDLE 状态
────────────────────────────────────────────────────────────
总耗时: 11 秒 ✅ 仍在可接受范围
```

---

### 2.6 MessageStatisticsService (统计监控)

**位置**: [src/wecom/message/services/message-statistics.service.ts](../src/wecom/message/services/message-statistics.service.ts)
**状态**: 待实现

#### 计划功能

- 消息处理成功率统计
- 平均响应时间监控
- 各服务性能指标
- 异常告警

---

## 3. 消息处理流程

### 3.1 完整处理链路

```
┌──────────────────────────────────────────────────────────────┐
│ 1. 接收企微回调                                                │
│    POST /message/callback                                    │
│    Body: EnterpriseMessageCallbackDto                        │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ 2. AI 回复检查 (MessageService)                               │
│    - 检查是否启用 AI 自动回复                                  │
│    - 未启用 → 直接返回 200 OK                                 │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ 3. 消息过滤 (MessageFilterService)                            │
│    Level 1: 非文本消息 → 忽略                                 │
│    Level 2: 机器人自己发送 → 忽略                             │
│    Level 3: 黑名单群聊 → 忽略                                 │
│    Level 4: 未在白名单 → 忽略                                 │
│    Level 5: 缺少触发词 → 忽略                                 │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ 4. 消息去重 (MessageDeduplicationService)                     │
│    - 检查 messageId 是否在 5 分钟内重复                        │
│    - 重复 → 忽略                                              │
│    - 新消息 → 记录到缓存                                       │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ 5. 消息聚合 (MessageMergeService)                             │
│    - 根据当前状态处理消息（详见 4. 智能消息聚合）               │
│    - IDLE → 启动聚合                                          │
│    - WAITING → 加入队列                                       │
│    - PROCESSING → 被动收集                                    │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ 6. 异步处理 (MessageService.processMessages)                  │
│    - 合并消息内容                                              │
│    - 获取会话历史                                              │
│    - 调用 Agent API                                           │
│    - 更新历史记录                                              │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ 7. 响应后检查 (MessageMergeService)                           │
│    - Agent 响应完成后回调                                      │
│    - 检查是否有新消息                                          │
│    - 有新消息 + 未达重试上限 → 重新处理（回到步骤 6）           │
│    - 否则 → 发送回复                                          │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ 8. 发送回复 (MessageSenderService)                            │
│    - 调用企微 API 发送消息                                     │
│    - 记录发送结果                                              │
│    - 更新历史记录（标记 AI 生成）                              │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ 9. 清理状态 (MessageMergeService)                             │
│    - 重置会话状态为 IDLE                                       │
│    - 清空待处理队列                                            │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 异步处理保证

#### 企微回调快速返回

```typescript
// MessageController.ts
@Post('callback')
async handleCallback(@Body() dto: EnterpriseMessageCallbackDto) {
  // 异步处理，不阻塞响应
  this.messageService.handleMessage(dto).catch((error) => {
    this.logger.error('消息处理异步失败:', error);
  });

  // 立即返回 200 OK（< 100ms）
  return { success: true };
}
```

#### 内部异步编排

```typescript
// MessageService.ts
async handleMessage(messageData: EnterpriseMessageCallbackDto) {
  // 1. 过滤（同步，< 1ms）
  if (!this.filterService.shouldProcess(messageData)) {
    return;
  }

  // 2. 去重（同步，< 1ms）
  if (this.deduplicationService.isDuplicate(messageData.messageId)) {
    return;
  }

  // 3. 聚合（异步调度，立即返回）
  await this.mergeService.handleMessage(
    messageData,
    async (messages) => {
      // 这个回调函数会在聚合完成后异步执行
      await this.processMessages(messages, chatId);
    }
  );
}
```

---

## 4. 智能消息聚合

### 4.1 为什么需要聚合？

#### 问题场景

```
用户快速连发 3 条消息：
0.0s: "有什么"
0.5s: "岗位"
1.0s: "推荐吗？"

❌ 不聚合（旧方案）：
- 0.0s: Agent 处理 "有什么" → 回复 "请问您想了解什么？"
- 0.5s: Agent 处理 "岗位" → 回复 "我们有多个岗位..."
- 1.0s: Agent 处理 "推荐吗？" → 回复 "可以推荐..."
结果：3 次 API 调用，3 条回复，体验差

✅ 聚合（新方案）：
- 0.0s: 收到 "有什么"，启动 1 秒聚合窗口
- 0.5s: 收到 "岗位"，加入队列
- 1.0s: 定时器到期，聚合为 "有什么岗位推荐吗？"
- 1.0s: Agent 处理完整问题 → 回复一次
结果：1 次 API 调用，1 条回复，体验好
```

### 4.2 聚合算法详解

#### 核心数据结构

```typescript
// 会话状态
interface ConversationState {
  chatId: string;
  status: ConversationStatus; // IDLE | WAITING | PROCESSING
  firstMessageTime: number;
  pendingMessages: PendingMessage[];
  currentRequest?: {
    startTime: number;
    retryCount: number;
    messageCount: number;
  };
  initialTimer?: NodeJS.Timeout;
  lastUpdateTime: number;
}

// 待处理消息
interface PendingMessage {
  messageData: EnterpriseMessageCallbackDto;
  receivedAt: number;
}
```

#### 状态转换逻辑

```typescript
// 处理新消息的主入口
async handleMessage(
  messageData: EnterpriseMessageCallbackDto,
  processor: MessageProcessor
): Promise<void> {
  const state = this.conversations.get(chatId) || this.createState(chatId);

  switch (state.status) {
    case ConversationStatus.IDLE:
      // 空闲 → 启动聚合
      await this.handleIdleState(state, messageData, processor);
      break;

    case ConversationStatus.WAITING:
      // 等待中 → 加入队列
      this.handleWaitingState(state, messageData, processor);
      break;

    case ConversationStatus.PROCESSING:
      // 处理中 → 被动收集
      this.handleProcessingState(state, messageData);
      break;
  }
}
```

#### 关键时机

| 时机 | 触发条件 | 行为 |
|------|---------|------|
| **启动聚合** | IDLE 状态收到消息 | 启动 1 秒定时器，进入 WAITING |
| **立即处理** | 队列达到 3 条消息 | 清除定时器，立即进入 PROCESSING |
| **定时触发** | 1 秒定时器到期 | 进入 PROCESSING，调用 Agent |
| **响应后检查** | Agent 响应完成 | 检查待处理队列，决定是否重试 |

### 4.3 重试策略

#### 重试条件

```typescript
// Agent 响应完成后回调
async onAgentResponseReceived(chatId: string, processor: MessageProcessor): Promise<boolean> {
  const state = this.conversations.get(chatId);

  // 1. 检查是否有新消息
  if (state.pendingMessages.length === 0) {
    return false; // 不需要重试
  }

  // 2. 检查是否可以重试
  if (state.currentRequest.retryCount >= this.maxRetryCount) {
    return false; // 达到重试上限
  }

  // 3. 检查新消息是否有效（长度 >= 2）
  const validMessages = state.pendingMessages.filter(
    (pm) => MessageParser.extractContent(pm.messageData).length >= 2
  );

  if (validMessages.length === 0) {
    return false; // 无有效消息
  }

  // 4. 重新处理
  await this.processMessages(state, processor);
  return true; // 需要重试
}
```

#### 重试限制

| 限制项 | 值 | 原因 |
|--------|---|------|
| **最大重试次数** | 1 | 避免无限循环，控制响应时间 |
| **最小消息长度** | 2 字符 | 过滤 "嗯"、"好" 等无意义消息 |
| **超时时间** | 无 | 依赖 Agent API 超时 |

---

## 5. 消息去重机制

### 5.1 去重策略

#### LRU 缓存 + TTL

```typescript
// 数据结构
private readonly messageCache = new Map<string, number>();
// messageId → timestamp

// 容量限制
private readonly maxSize = 10000;
private readonly ttl = 300000; // 5 分钟
```

#### 去重逻辑

```
┌─────────────────────────────────────────────────────────────┐
│ 收到消息 (messageId: msg-123)                                │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 查询缓存: messageCache.get('msg-123')                        │
└─────────────────────────────────────────────────────────────┘
                ↓                           ↓
        ┌───────────┐              ┌──────────────┐
        │ 找到记录   │              │ 未找到记录    │
        └─────┬─────┘              └──────┬───────┘
              ↓                            ↓
     ┌────────────────┐            ┌──────────────┐
     │ 检查时间差     │            │ 记录新消息    │
     └────┬───────────┘            │ set(id, now) │
          ↓                        └──────┬───────┘
   ┌──────────────┐                       ↓
   │ < 5 分钟？   │                ┌──────────────┐
   └──┬───────────┘                │ 返回 false   │
      │                            │ (不是重复)    │
  是  ↓      否                    └──────────────┘
┌──────────┐  ↓
│ 返回 true│ 更新时间戳
│ (重复)   │ set(id, now)
└──────────┘  ↓
         返回 false
```

### 5.2 内存管理

#### LRU 淘汰策略

```typescript
// 添加新消息时检查容量
private checkAndEvict(): void {
  if (this.messageCache.size >= this.maxSize) {
    // 找到最老的记录（Map 保持插入顺序）
    const firstKey = this.messageCache.keys().next().value;
    this.messageCache.delete(firstKey);
    this.logger.debug('缓存已满，淘汰最老记录');
  }
}
```

#### 定期清理

```typescript
// 每 1 分钟清理过期记录
private startCleanupInterval(): void {
  setInterval(() => {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, timestamp] of this.messageCache.entries()) {
      if (now - timestamp > this.ttl) {
        this.messageCache.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(`清理了 ${cleaned} 条过期记录`);
    }
  }, 60000); // 1 分钟
}
```

---

## 6. 消息历史管理

### 6.1 存储结构

```typescript
// 内存存储
private readonly conversationHistory = new Map<string, Message[]>();
// chatId → Message[]

// 消息格式
interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  messageId: string;
  isAiGenerated?: boolean;
}
```

### 6.2 裁剪策略

#### 滑动窗口

```typescript
addMessage(chatId: string, message: Message): void {
  let history = this.conversationHistory.get(chatId) || [];

  // 添加新消息
  history.push(message);

  // 保持最多 20 条
  if (history.length > this.maxHistoryPerChat) {
    history = history.slice(-this.maxHistoryPerChat);
  }

  this.conversationHistory.set(chatId, history);
  this.updateLastActiveTime(chatId);
}
```

#### 自动清理

```typescript
// 每 10 分钟清理 2 小时未活动的会话
private startCleanupInterval(): void {
  setInterval(() => {
    const now = Date.now();
    let cleaned = 0;

    for (const [chatId, lastActive] of this.lastActiveTime.entries()) {
      if (now - lastActive > this.historyTtl) {
        this.conversationHistory.delete(chatId);
        this.lastActiveTime.delete(chatId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.log(`清理了 ${cleaned} 个过期会话`);
    }
  }, 600000); // 10 分钟
}
```

### 6.3 格式转换

#### 企微格式 → Agent API 格式

```typescript
// 企微消息
{
  "messageId": "msg-123",
  "senderId": "user-456",
  "content": "你好",
  "timestamp": 1234567890
}

// 转换为 Agent API 格式
{
  "role": "user",
  "content": "你好"
}
```

#### 历史传递

```typescript
// 调用 Agent API 时传递历史
await this.agentService.chat({
  conversationId: chatId,
  userMessage: currentMessage,
  historyMessages: this.historyService.getHistory(chatId), // 传递历史
  model: 'claude-3-5-sonnet-20241022',
  allowedTools: ['duliday_job_list']
});
```

---

## 7. 消息发送

### 7.1 发送流程

```
┌──────────────────────────────────────────────────────────────┐
│ MessageService.processMessages()                             │
│ - 调用 Agent API 获取回复                                     │
│ - 提取回复内容                                                │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ 响应后检查 (MessageMergeService.onAgentResponseReceived)     │
│ - 检查是否有新消息                                            │
│ - 决定是否重试                                                │
└──────────────────────────────────────────────────────────────┘
                            ↓
                   ┌────────────────┐
                   │ 需要重试？      │
                   └────┬───────────┘
                        │
                   是   ↓      否
            ┌────────────────┐  ↓
            │ 重新调用 Agent  │  ↓
            └────────────────┘  ↓
                                ↓
┌──────────────────────────────────────────────────────────────┐
│ MessageSenderService.sendMessage()                           │
│ - 调用企微 API 发送消息                                        │
│ - 处理发送错误                                                │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ 更新历史 (MessageHistoryService.addAssistantMessage)         │
│ - 记录 AI 回复到历史                                          │
│ - 标记 isAiGenerated = true                                  │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ 清理状态 (MessageMergeService.resetToIdle)                   │
│ - 重置会话状态为 IDLE                                         │
│ - 清空待处理队列                                              │
└──────────────────────────────────────────────────────────────┘
```

### 7.2 错误处理

| 错误类型 | 处理方式 | 示例 |
|---------|---------|------|
| **网络错误** | 重试 3 次 | 企微 API 超时 |
| **权限错误** | 记录日志，不重试 | 未授权的群聊 |
| **参数错误** | 记录日志，不重试 | 消息格式错误 |

---

## 8. 性能优化

### 8.1 关键指标

| 指标 | 目标值 | 当前值 | 说明 |
|------|--------|--------|------|
| **HTTP 响应时间** | < 100ms | ~50ms | 企微回调返回速度 |
| **单条消息处理** | < 10s | ~6s | 1s 等待 + 5s Agent |
| **多条消息处理** | < 15s | ~11s | 可能包含 1 次重试 |
| **去重查询时间** | < 1ms | O(1) | Map 查找 |
| **历史查询时间** | < 1ms | O(1) | Map 查找 |

### 8.2 优化策略

#### 1. 异步非阻塞

```typescript
// ✅ 正确：立即返回 HTTP 响应
@Post('callback')
async handleCallback(@Body() dto: EnterpriseMessageCallbackDto) {
  this.messageService.handleMessage(dto).catch(error => {
    this.logger.error('异步处理失败:', error);
  });
  return { success: true }; // 立即返回
}

// ❌ 错误：等待处理完成
@Post('callback')
async handleCallback(@Body() dto: EnterpriseMessageCallbackDto) {
  await this.messageService.handleMessage(dto); // 阻塞 5-10 秒
  return { success: true };
}
```

#### 2. 智能聚合

```typescript
// ✅ 正确：聚合后只调用 1 次 Agent API
// 用户: "有什么" + "岗位" + "推荐吗？"
// → 聚合为 "有什么岗位推荐吗？"
// → 1 次 API 调用

// ❌ 错误：每条消息调用 1 次
// → 3 次 API 调用，3 条回复
```

#### 3. 缓存优化

| 缓存类型 | 数据结构 | 容量 | TTL |
|---------|---------|------|-----|
| **去重缓存** | `Map<messageId, timestamp>` | 10K | 5分钟 |
| **历史缓存** | `Map<chatId, Message[]>` | 20条/会话 | 2小时 |
| **聚合状态** | `Map<chatId, ConversationState>` | - | 会话结束清理 |

---

## 9. 监控与调试

### 9.1 监控接口

| 端点 | 方法 | 说明 | 返回数据 |
|------|------|------|---------|
| `/message/service/status` | GET | 服务状态 | 各服务健康状态 |
| `/message/cache/stats` | GET | 缓存统计 | 去重/历史/聚合缓存统计 |
| `/message/history/all` | GET | 所有会话历史 | 调试用 |
| `/message/cache/clear` | POST | 清理缓存 | 手动清理 |

### 9.2 日志级别

| 级别 | 使用场景 | 示例 |
|------|---------|------|
| **DEBUG** | 详细流程日志 | 消息加入队列、状态转换 |
| **LOG** | 关键步骤日志 | 聚合完成、Agent 调用 |
| **WARN** | 异常情况警告 | 重试、溢出、降级 |
| **ERROR** | 错误日志 | API 调用失败、异常 |

### 9.3 调试技巧

#### 查看会话状态

```bash
# 获取所有会话历史
GET /message/history/all

# 响应示例
{
  "chat-123": [
    { "role": "user", "content": "你好", "timestamp": 1234567890 },
    { "role": "assistant", "content": "您好！", "isAiGenerated": true }
  ]
}
```

#### 查看聚合状态

```bash
# 获取缓存统计
GET /message/cache/stats

# 响应示例
{
  "deduplication": {
    "size": 123,
    "maxSize": 10000,
    "ttl": 300000
  },
  "history": {
    "conversations": 5,
    "totalMessages": 87
  },
  "merge": {
    "totalConversations": 3,
    "byStatus": {
      "idle": 2,
      "waiting": 0,
      "processing": 1
    },
    "totalPendingMessages": 2
  }
}
```

---

## 10. 扩展指南

### 10.1 添加新的过滤规则

```typescript
// MessageFilterService.ts

shouldProcess(message: EnterpriseMessageCallbackDto): boolean {
  // 现有规则...

  // 新增规则：过滤敏感词
  if (this.containsSensitiveWords(message.content)) {
    this.logger.warn(`消息包含敏感词，忽略处理`);
    return false;
  }

  return true;
}

private containsSensitiveWords(content: string): boolean {
  const sensitiveWords = ['广告', '推广'];
  return sensitiveWords.some(word => content.includes(word));
}
```

### 10.2 自定义聚合策略

```typescript
// MessageMergeService.ts

// 示例：根据消息内容动态调整聚合窗口
private getDynamicMergeWindow(content: string): number {
  // 短消息（<5 字符）→ 等待 2 秒
  if (content.length < 5) {
    return 2000;
  }

  // 长消息（>20 字符）→ 等待 0.5 秒
  if (content.length > 20) {
    return 500;
  }

  // 默认 1 秒
  return this.initialMergeWindow;
}
```

### 10.3 添加性能监控

```typescript
// MessageService.ts

async processMessages(messages: EnterpriseMessageCallbackDto[], chatId: string) {
  const startTime = Date.now();

  try {
    // 处理逻辑...
  } finally {
    const duration = Date.now() - startTime;

    // 上报指标
    this.metricsService.recordProcessingTime({
      chatId,
      messageCount: messages.length,
      duration,
      success: true
    });

    // 慢查询告警
    if (duration > 10000) {
      this.logger.warn(`处理耗时过长: ${duration}ms, chatId: ${chatId}`);
    }
  }
}
```

---

## 11. 最佳实践

### 11.1 配置建议

✅ **DO**
- 启用消息过滤，减少无效处理
- 设置合理的聚合窗口（1-2 秒）
- 启用去重，防止重复处理
- 定期清理缓存，避免内存泄漏

❌ **DON'T**
- 设置过长的聚合窗口（> 3 秒）
- 禁用去重（会导致重复回复）
- 关闭日志（难以排查问题）
- 忽略异常监控

### 11.2 性能调优

| 场景 | 建议 | 参数 |
|------|------|------|
| **高频消息** | 增加聚合窗口 | `INITIAL_MERGE_WINDOW_MS=2000` |
| **低频消息** | 减少聚合窗口 | `INITIAL_MERGE_WINDOW_MS=500` |
| **群聊场景** | 增加最大聚合数 | `MAX_MERGED_MESSAGES=5` |
| **私聊场景** | 减少最大聚合数 | `MAX_MERGED_MESSAGES=2` |

---

## 12. 总结

消息处理服务通过**服务化拆分**和**智能聚合**实现了高效、可靠的企微消息处理：

| 服务 | 代码量 | 核心职责 |
|------|--------|---------|
| `MessageService` | 643 行 | 流程协调、异常处理 |
| `MessageFilterService` | 129 行 | 5 级过滤规则 |
| `MessageDeduplicationService` | 108 行 | LRU 去重 |
| `MessageHistoryService` | 234 行 | 历史管理、格式转换 |
| **MessageMergeService** | **516 行** | **智能聚合** ⭐⭐⭐ |

总计约 **1,600 行**核心业务代码，实现：
- ✅ 异步非阻塞处理（< 100ms HTTP 响应）
- ✅ 智能消息聚合（节省 API 成本）
- ✅ 完整的去重和历史管理
- ✅ 三阶段状态机（IDLE → WAITING → PROCESSING）
- ✅ 响应后检查和智能重试

该架构确保了用户体验和系统性能的平衡，为企业微信机器人提供了生产级的消息处理能力。
