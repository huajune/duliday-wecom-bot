# 📢 告警系统完整指南

## 🌟 系统概述

DuLiDay 告警系统是一个**完整、智能、可扩展**的企业级告警解决方案，提供：

- ✅ **多层次告警**：错误告警 + 业务指标主动告警
- ✅ **智能限流**：自动聚合重复告警，防止告警风暴
- ✅ **严重程度分级**：CRITICAL / ERROR / WARNING / INFO
- ✅ **恢复检测**：自动发送故障恢复通知
- ✅ **静默管理**：支持临时屏蔽告警
- ✅ **配置化**：规则热加载，无需重启服务

---

## 📊 告警架构

```
┌─────────────────────────────────────────────────────────────┐
│                    业务层（触发源）                          │
│  MessageService │ AgentService │ MonitoringService         │
└────────────┬───────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│              告警编排层 (AlertOrchestratorService)           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  1. 判断严重程度 (AlertSeverityService)              │   │
│  │  2. 检查是否静默 (AlertSilenceService)               │   │
│  │  3. 限流聚合检查 (AlertThrottleService)              │   │
│  │  4. 记录恢复状态 (AlertRecoveryService)              │   │
│  │  5. 发送到渠道 (FeiShuAlertService)                 │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│                    配置层 (AlertConfigService)               │
│  - config/alert-rules.json  (规则配置，支持热加载)          │
│  - .env (环境变量覆盖)                                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚨 告警类型

### 1. 错误告警（4种）

| 类型 | 触发场景 | 默认严重程度 |
|------|---------|-------------|
| **agent** | Agent API 调用失败 (401/429/5xx) | CRITICAL / ERROR / WARNING |
| **message** | 消息处理失败（非 Agent 错误）| WARNING |
| **delivery** | 消息发送失败 | WARNING |
| **merge** | 消息聚合处理失败 | WARNING |

### 2. 业务指标告警（4种）

每分钟自动检查，异常时主动告警：

| 指标 | WARNING 阈值 | CRITICAL 阈值 |
|------|-------------|--------------|
| **成功率** | < 90% | < 80% |
| **平均响应时间** | > 5000ms | > 10000ms |
| **队列积压** | > 50 条 | > 100 条 |
| **错误率** | > 10/分钟 | > 20/分钟 |

---

## ⚙️ 配置指南

### 1. 环境变量配置

```bash
# .env

# 启用飞书告警（必须）
ENABLE_FEISHU_ALERT=true
FEISHU_ALERT_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/xxxxx
FEISHU_ALERT_SECRET=your-secret-key

# 告警系统开关
ALERT_ENABLED=true

# 业务指标阈值（可选，覆盖 JSON 配置）
ALERT_SUCCESS_RATE_WARNING=90
ALERT_SUCCESS_RATE_CRITICAL=80

# 限流窗口（默认 5 分钟）
ALERT_THROTTLE_WINDOW_MS=300000
```

### 2. 规则配置文件

编辑 `config/alert-rules.json`：

```json
{
  "enabled": true,
  "rules": [
    {
      "name": "agent-auth-failure",
      "enabled": true,
      "match": {
        "errorType": "agent",
        "errorCode": "401|403"
      },
      "severity": "critical",
      "throttle": {
        "enabled": true,
        "windowMs": 300000,
        "maxOccurrences": 3
      }
    }
  ],
  "metrics": {
    "successRate": {
      "warning": 90,
      "critical": 80
    }
  }
}
```

**配置支持热加载**：修改文件后自动生效，无需重启！

---

## 📋 使用示例

### 1. 业务代码中发送告警

```typescript
// 注入告警编排器
constructor(
  private readonly alertOrchestrator: AlertOrchestratorService,
) {}

// 发送告警
await this.alertOrchestrator.sendAlert({
  errorType: 'agent',
  error: new Error('Agent API timeout'),
  conversationId: 'conv-123',
  userMessage: '用户问题',
  contactName: '张三',
  scenario: 'job_search',
  apiEndpoint: '/api/v1/chat',
  statusCode: 500,
});
```

### 2. 查看监控面板

```bash
# 访问监控大盘（包含告警统计）
open http://localhost:8080/monitoring.html

# API 查看告警数据
curl http://localhost:8080/monitoring/dashboard
```

### 3. 静默管理API（计划内维护）

```typescript
// ✅ 已实现 - AlertController 提供完整的静默管理 REST API

// 添加静默规则 - 静默 agent 类型告警 1 小时
POST /alert/silence
{
  "errorType": "agent",
  "durationMs": 3600000,
  "reason": "Agent API 计划内维护"
}

// 添加静默规则 - 静默特定场景的告警
POST /alert/silence
{
  "errorType": "agent",
  "scenario": "candidate_consulting",
  "durationMs": 3600000,
  "reason": "候选人咨询场景维护中"
}

// 查询所有静默规则（包括剩余时间）
GET /alert/silence

// 删除静默规则（通过 key）
DELETE /alert/silence/agent                     // 删除所有 agent 类型告警的静默
DELETE /alert/silence/agent:candidate_consulting  // 删除特定场景的静默
```

---

## 🎯 告警严重程度

| 级别 | 图标 | 颜色 | 使用场景 |
|------|------|------|---------|
| **CRITICAL** | 🔴 | 紫色 | 认证失败、服务不可用 |
| **ERROR** | 🚨 | 红色 | 5xx 错误、Agent 调用失败 |
| **WARNING** | ⚠️ | 橙色 | 限流、消息处理失败 |
| **INFO** | ℹ️ | 蓝色 | 恢复通知、信息提示 |

---

## 🔔 告警卡片示例

### 普通告警
```
🚨 Agent 调用失败告警

告警时间: 2025-01-17 14:32:15
环境: production
会话ID: conv-123-456
错误类型: Agent Invocation Error
严重程度: ERROR
用户昵称: 张三
场景: job_search

─────────────────────────
错误信息: Request timeout after 60000ms
HTTP 状态码: N/A
API 端点: /api/v1/chat

─────────────────────────
用户消息: 请问有哪些UI设计师的职位？

[查看监控大盘] [查看日志]
```

### 聚合告警（限流后）
```
🚨 Agent 调用失败告警（聚合）

⚠️ 5分钟内发生 127 次

时间窗口: 10:00:01 - 10:04:58
影响会话: 45 个
严重程度: ERROR

─────────────────────────
聚合的错误信息:
1. Request timeout after 60000ms (89次)
2. Agent API返回 429 Rate Limit (38次)

─────────────────────────
建议操作:
1. 检查 Agent API 服务状态
2. 查看错误日志分布
3. 考虑增加请求配额

[查看监控大盘] [查看日志]
```

### 恢复通知
```
✅ 告警已恢复 [agent]

恢复时间: 2025-01-17 15:05:30
故障时长: 33 分钟 (1980 秒)
故障期间失败次数: 127
恢复判定: 连续成功 5 次

系统已恢复正常运行 ✨
```

### 业务指标告警
```
🔴 业务指标告警: 成功率严重下降

指标名称: 成功率严重下降
当前值: 67%
阈值: 80%
严重程度: CRITICAL
时间窗口: 当前

─────────────────────────
附加信息:
message: 成功率已降至临界值以下，大量用户受影响
suggestion: 立即检查 Agent API 状态、数据库连接、网络状况

[查看监控大盘] [检查 Agent 健康]
```

---

## 🛠️ 高级功能

### 1. 告警限流聚合

**问题**：Agent API 持续故障导致每秒产生 10+ 条告警，飞书群被刷屏。

**解决**：
- 同类型告警在 5 分钟内只发送**1次**
- 后续告警自动聚合计数
- 窗口期结束后发送**聚合告警**（包含总次数、错误分布）

**效果**：
```
Before: 300 条独立告警（5 分钟）❌
After:  1 条聚合告警 ✅
内容: "5分钟内发生 300 次，聚合错误：超时(189次)、限流(111次)"
```

### 2. 故障恢复检测

**原理**：
- 记录每个告警键的首次故障时间
- 追踪连续成功次数
- 达到阈值（默认 5 次）后认为恢复
- 自动发送恢复通知

**示例**：
```typescript
// 业务代码中记录成功
const recoveryState = this.alertRecovery.recordSuccess({
  errorType: 'agent',
  scenario: 'job_search',
});

if (recoveryState) {
  // 发送恢复通知
  await this.alertOrchestrator.sendRecoveryNotification('agent:job_search');
}
```

### 3. 静默管理

**使用场景**：
- Agent API 计划内维护（已知停机）
- 非紧急问题修复中（避免重复打扰）
- 测试环境临时关闭告警

**API**：
```typescript
// 静默 agent 告警 1 小时
this.alertSilence.addSilence({
  errorType: 'agent',
  durationMs: 3600000,
  reason: 'Agent API 升级维护',
  createdBy: 'admin',
});

// 检查是否静默
const isSilenced = this.alertSilence.isSilenced('agent');
```

---

## 📈 监控与统计

### 监控大盘
访问 `http://localhost:8080/monitoring.html` 查看：

- 实时成功率、响应时间、队列积压
- 告警趋势图（最近 12 小时）
- 告警类型分布饼图
- 最近 20 条错误日志

### API 接口
```bash
# 获取仪表盘数据
GET /monitoring/dashboard

# 获取详细指标
GET /monitoring/metrics

# 清空监控数据
DELETE /monitoring/clear
```

---

## 🔍 故障排查

### 告警没有发送？

1. **检查全局开关**
   ```bash
   echo $ALERT_ENABLED  # 应为 true
   echo $ENABLE_FEISHU_ALERT  # 应为 true
   ```

2. **检查配置文件**
   ```bash
   cat config/alert-rules.json | jq '.enabled'  # 应为 true
   ```

3. **查看日志**
   ```bash
   tail -f logs/combined-$(date +%Y-%m-%d).log | grep Alert
   ```

4. **检查是否被静默**
   ```bash
   curl http://localhost:8080/alert/silence
   ```

### 告警太频繁？

调整限流窗口：
```bash
# .env
ALERT_THROTTLE_WINDOW_MS=600000  # 改为 10 分钟
```

或修改 `config/alert-rules.json` 中特定规则的 `throttle.windowMs`。

---

## 📚 技术实现

### 核心服务

| 服务 | 职责 |
|------|------|
| `AlertOrchestratorService` | 告警编排中枢，协调所有子服务 |
| `AlertConfigService` | 配置管理，支持文件热加载 |
| `AlertSeverityService` | 严重程度判断（错误码 → 级别） |
| `AlertThrottleService` | 限流聚合，防止告警风暴 |
| `AlertRecoveryService` | 恢复检测，追踪故障状态 |
| `AlertSilenceService` | 静默管理，临时屏蔽告警 |
| `MonitoringAlertService` | 业务指标主动告警（定时任务） |
| `FeiShuAlertService` | 飞书渠道发送 |

### 数据流

```
1. 错误发生
   ↓
2. AlertOrchestratorService.sendAlert(context)
   ↓
3. 判断严重程度 → 检查静默 → 检查限流 → 记录恢复状态
   ↓
4. FeiShuAlertService 发送（异步，不阻塞业务）
   ↓
5. MonitoringService 记录（用于统计分析）
```

---

## 🎉 总结

✅ **已实现的P0功能**：
- 消息发送失败告警（delivery 类型）
- 告警限流聚合（防止告警风暴）
- 业务指标主动告警（成功率、响应时间、队列积压、错误率）

✅ **已实现的P1功能**：
- 告警严重程度分级（CRITICAL / ERROR / WARNING / INFO）
- 故障恢复检测和通知
- 配置文件热加载

✅ **已实现的P2功能**：
- 告警静默管理
- 限流状态可视化（监控大盘）

---

## 📞 联系支持

遇到问题？查看 [CLAUDE.md](../CLAUDE.md) 或提交 Issue。
