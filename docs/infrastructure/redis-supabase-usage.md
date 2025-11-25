# Redis 与 Supabase 资源使用指南

> 本文档记录项目中 Redis (Upstash) 和 Supabase 的使用情况，用于成本控制和容量规划。

**最后更新**：2025-11-25

---

## 概览

| 服务 | 免费额度 | 当前使用 | 预估使用率 |
|------|---------|---------|-----------|
| **Upstash Redis** | 10,000 命令/天 | ~500-2000 命令/天 | 5-20% |
| **Supabase PostgreSQL** | 500 MB 存储 | < 10 MB | < 2% |
| **Supabase API** | 500,000 请求/月 | ~5,000 请求/月 | < 1% |

---

## Redis (Upstash) 使用详情

### 连接配置

```bash
# REST API（用于应用层缓存）
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=xxx

# TCP 连接（用于 Bull Queue，可选）
UPSTASH_REDIS_TCP_URL=rediss://default:xxx@xxx.upstash.io:6379
```

### Key 命名规范

| 前缀 | 用途 | TTL | 示例 |
|------|------|-----|------|
| `agent:cache:` | Agent 响应缓存 | 1h | `agent:cache:user123:conv456` |
| `message:history:` | 消息历史 | 3d | `message:history:chat789` |
| `supabase:config:` | 系统配置缓存 | 5min | `supabase:config:ai_reply_enabled` |
| `monitoring:` | 监控数据快照 | 1h | `monitoring:snapshot` |
| `dedup:` | 消息去重 | 5min | `dedup:msg123` |

### 使用场景

#### 1. Agent 响应缓存 (`AgentCacheService`)

```typescript
// Key: agent:cache:{userId}:{conversationId}:{messageHash}
// TTL: AGENT_RESPONSE_CACHE_TTL_SECONDS (默认 3600)
// 大小限制: AGENT_RESPONSE_CACHE_MAX_ITEM_SIZE_KB (默认 100KB)
```

**命令估算**：
- 每次 AI 调用：2 次（GET + SET）
- 日均 AI 调用：~100-500 次
- 日均命令：200-1000 次

#### 2. 消息历史 (`MessageHistoryService`)

```typescript
// Key: message:history:{chatId}
// 结构: Redis List
// 最大长度: MAX_HISTORY_PER_CHAT (默认 100)
// TTL: HISTORY_TTL_MS (默认 3 天)
```

**命令估算**：
- 每条消息：3 次（RPUSH + LTRIM + EXPIRE）
- 查询历史：1 次（LRANGE）
- 日均消息：~50-200 条
- 日均命令：200-800 次

#### 3. 系统配置缓存 (`SupabaseService`)

```typescript
// Key: supabase:config:{key}
// TTL: 300 秒
// 用途: AI开关、黑名单等配置
```

**命令估算**：
- 启动时预加载：~5 次
- 运行时读取：每分钟 ~2 次（缓存命中）
- 日均命令：< 100 次

#### 4. 监控数据快照 (`MonitoringSnapshotService`)

```typescript
// Key: monitoring:snapshot
// TTL: 3600 秒
// 大小: ~50-200 KB（压缩后）
// 写入频率: 每次状态变更
```

**命令估算**：
- 写入：每条消息处理完成后
- 读取：服务重启时 1 次
- 日均命令：~100-500 次

### 成本优化建议

1. **缓存命中率监控**：定期检查 Agent 缓存命中率，低于 30% 需优化
2. **TTL 调整**：根据业务特点调整 TTL，避免无效存储
3. **批量操作**：使用 Pipeline 减少网络往返
4. **避免大 Key**：单个 Key 不超过 100KB

---

## Supabase 使用详情

### 数据库表结构

#### 1. `system_config` - 系统配置

```sql
CREATE TABLE system_config (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_system_config_key ON system_config(key);
```

**当前数据**：
| key | 说明 | 更新频率 |
|-----|------|---------|
| `ai_reply_enabled` | AI 回复开关 | 手动操作 |
| `group_blacklist` | 小组黑名单 | 低频 |

**存储估算**：< 1 KB

#### 2. `user_hosting_status` - 用户托管状态

```sql
CREATE TABLE user_hosting_status (
  user_id VARCHAR(100) PRIMARY KEY,
  is_paused BOOLEAN DEFAULT FALSE,
  paused_at TIMESTAMPTZ,
  resumed_at TIMESTAMPTZ,
  pause_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_user_hosting_paused ON user_hosting_status(is_paused) WHERE is_paused = TRUE;
```

**数据量预估**：
- 活跃用户数：~1000
- 单条记录：~200 字节
- 总存储：~200 KB

#### 3. `monitoring_hourly` - 监控聚合数据（新增）

```sql
CREATE TABLE monitoring_hourly (
  id BIGSERIAL PRIMARY KEY,
  hour TIMESTAMPTZ NOT NULL,

  -- 消息统计
  message_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,

  -- 耗时统计 (毫秒)
  avg_duration DECIMAL(10,2) DEFAULT 0,
  p95_duration DECIMAL(10,2) DEFAULT 0,

  -- 活跃度
  active_users INTEGER DEFAULT 0,
  active_chats INTEGER DEFAULT 0,

  -- Token 使用
  total_tokens INTEGER DEFAULT 0,

  -- 元数据
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(hour)
);

-- 索引：按时间查询
CREATE INDEX idx_monitoring_hourly_hour ON monitoring_hourly(hour DESC);

-- 自动清理：保留 30 天数据
-- 通过定时任务 daily_cleanup() 执行
```

**数据量预估**：
- 每小时 1 条记录
- 保留 30 天：720 条
- 单条记录：~150 字节
- 总存储：~100 KB

### API 请求估算

| 操作 | 频率 | 请求数/天 |
|------|------|----------|
| 启动时加载配置 | 每次重启 | ~5 |
| AI 开关检查 | 缓存命中 | ~10 |
| 用户暂停/恢复 | 用户触发 | ~20 |
| 小组黑名单 | 手动操作 | < 5 |
| 监控数据同步 | 每小时 | 24 |
| **日均总计** | - | **< 100** |

### 成本优化策略

1. **多层缓存**
   ```
   内存缓存 (ms) → Redis 缓存 (5min) → Supabase (持久)
   ```

2. **批量写入**
   - 监控数据每小时聚合后写入
   - 避免实时写入数据库

3. **定期清理**
   - 30 天数据轮转
   - 使用 `daily_cleanup()` 存储过程

4. **索引优化**
   - 只在查询字段建索引
   - 使用部分索引减少存储

---

## 容量规划

### 当前状态 (2025-11)

```
┌─────────────────────────────────────────────────────────────┐
│  Upstash Redis                   Supabase                   │
│  ┌───────────────────────┐      ┌───────────────────────┐   │
│  │ 使用: ~1500 命令/天    │      │ 存储: < 5 MB          │   │
│  │ 额度: 10000 命令/天    │      │ 额度: 500 MB          │   │
│  │ 使用率: 15%           │      │ 使用率: < 1%          │   │
│  └───────────────────────┘      └───────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 扩容阈值

| 指标 | 当前值 | 警告阈值 | 行动 |
|------|-------|---------|------|
| Redis 命令/天 | ~1500 | > 7000 | 考虑升级计划 |
| Supabase 存储 | < 5 MB | > 400 MB | 清理历史数据 |
| Supabase API | < 100/天 | > 10000/天 | 增加缓存层 |

### 业务增长预估

| 场景 | 日均消息量 | Redis 命令 | Supabase 存储 |
|------|-----------|-----------|--------------|
| 当前 | 100-200 | ~1500 | < 5 MB |
| 3x 增长 | 300-600 | ~4500 | < 10 MB |
| 10x 增长 | 1000-2000 | ~15000 | < 30 MB |

**结论**：在 10x 业务增长前，免费额度足够使用。

---

## 监控与告警

### Redis 监控

```bash
# 查看当前使用量（Upstash Console）
# https://console.upstash.com/redis

# 本地检查连接
curl http://localhost:8080/agent/health
```

### Supabase 监控

```bash
# 查看存储使用（Supabase Dashboard）
# Project Settings -> Database -> Database Usage

# 查看 API 使用
# Project Settings -> API -> Usage
```

### 告警设置建议

1. **Redis 命令数**：> 8000/天 发送告警
2. **Supabase 存储**：> 400 MB 发送告警
3. **API 错误率**：> 5% 发送告警

---

## 故障排查

### Redis 连接失败

```bash
# 检查环境变量
echo $UPSTASH_REDIS_REST_URL

# 测试连接
curl -X POST "$UPSTASH_REDIS_REST_URL/ping" \
  -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN"
```

### Supabase 连接失败

```bash
# 检查环境变量
echo $NEXT_PUBLIC_SUPABASE_URL

# 测试连接
curl "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/system_config?select=key" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY"
```

---

## 参考资料

- [Upstash Redis 文档](https://docs.upstash.com/redis)
- [Supabase 文档](https://supabase.com/docs)
- [项目 CLAUDE.md](../../CLAUDE.md)

---

**维护者**：DuLiDay Team
