# SQL Functions

本目录包含 Supabase 数据库的 RPC 函数定义。

## get_chat_session_list

获取聊天会话列表的高性能聚合函数。

### 功能说明

替代应用层聚合逻辑，在数据库层面高效聚合聊天会话数据，减少网络传输和内存占用。

### 函数签名

```sql
get_chat_session_list(
  p_start_date timestamptz,
  p_end_date timestamptz
)
RETURNS TABLE (
  chat_id text,
  candidate_name text,
  manager_name text,
  message_count bigint,
  last_message text,
  last_timestamp timestamptz,
  avatar text,
  contact_type text
)
```

### 返回字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `chat_id` | text | 会话唯一标识 |
| `candidate_name` | text | 候选人姓名（从 role='user' 的消息获取） |
| `manager_name` | text | 管理员姓名 |
| `message_count` | bigint | 该会话的消息总数 |
| `last_message` | text | 最新消息内容（超过50字符会截断并添加 '...'） |
| `last_timestamp` | timestamptz | 最新消息的时间戳 |
| `avatar` | text | 用户头像URL（从 role='user' 的消息获取） |
| `contact_type` | text | 联系人类型（从 role='user' 的消息获取） |

### 使用示例

#### 1. 查询最近30天的会话

```sql
SELECT * FROM get_chat_session_list(
  NOW() - INTERVAL '30 days',
  NOW()
);
```

#### 2. 查询特定日期范围

```sql
SELECT * FROM get_chat_session_list(
  '2025-12-01 00:00:00+08'::timestamptz,
  '2025-12-16 23:59:59+08'::timestamptz
);
```

#### 3. 查询今天的会话

```sql
SELECT * FROM get_chat_session_list(
  DATE_TRUNC('day', NOW()),
  NOW()
);
```

#### 4. 分页查询（使用 LIMIT 和 OFFSET）

```sql
-- 第1页，每页20条
SELECT * FROM get_chat_session_list(
  NOW() - INTERVAL '7 days',
  NOW()
)
LIMIT 20 OFFSET 0;

-- 第2页
SELECT * FROM get_chat_session_list(
  NOW() - INTERVAL '7 days',
  NOW()
)
LIMIT 20 OFFSET 20;
```

#### 5. 筛选活跃会话（消息数 > 10）

```sql
SELECT *
FROM get_chat_session_list(
  NOW() - INTERVAL '30 days',
  NOW()
)
WHERE message_count > 10;
```

### 性能优化

函数内部使用了以下优化技术：

1. **CTE（Common Table Expressions）** - 将查询分解为逻辑清晰的步骤
2. **DISTINCT ON** - 高效获取每个 chat_id 的第一条记录
3. **窗口函数** - 减少子查询，提升性能
4. **LEFT JOIN** - 确保所有会话都能返回，即使缺少用户消息
5. **索引建议** - 为了最佳性能，建议在以下字段创建索引：
   - `chat_messages(timestamp)` - 时间范围过滤
   - `chat_messages(chat_id, timestamp DESC)` - 排序优化
   - `chat_messages(role, chat_id)` - 用户消息查询

### 数据规则

- **候选人信息优先级**：`candidate_name`、`avatar`、`contact_type` 只从 `role='user'` 的消息中获取，确保数据一致性
- **管理员信息**：使用 `MAX()` 聚合，取任意一条消息的 `manager_name`
- **消息截断**：`last_message` 超过50字符自动截断并添加 `'...'`
- **排序规则**：按 `last_timestamp` 降序排序，最新的会话排在前面
- **空值处理**：所有文本字段使用 `COALESCE` 确保不返回 NULL

### 应用场景

1. **会话列表展示** - 在管理后台展示所有聊天会话
2. **活跃度分析** - 统计消息数量，分析用户活跃度
3. **数据导出** - 批量导出会话摘要数据
4. **监控告警** - 监控消息量异常的会话

### 部署说明

使用 MCP Supabase 工具应用迁移：

```bash
# 函数定义文件
sql/get_chat_session_list.sql

# 迁移名称
create_get_chat_session_list_function
```

### 测试验证

```sql
-- 验证函数存在
SELECT
  p.proname as function_name,
  pg_get_function_result(p.oid) as return_type,
  pg_get_function_arguments(p.oid) as arguments
FROM pg_proc p
WHERE p.proname = 'get_chat_session_list';

-- 测试消息截断
SELECT
  chat_id,
  LENGTH(last_message) as message_length,
  last_message
FROM get_chat_session_list(NOW() - INTERVAL '7 days', NOW())
WHERE LENGTH(last_message) >= 50
LIMIT 5;
```

### 更新历史

- **2025-12-16**: 初始版本，支持基本会话列表聚合功能
