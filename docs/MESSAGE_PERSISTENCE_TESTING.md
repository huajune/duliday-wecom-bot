# 消息处理记录持久化 - 测试指南

## 功能概述

将实时消息页面（`/logs`）的数据从纯内存存储改为持久化到 Supabase 数据库，实现历史数据查看和服务重启后的数据保留。

## 实现的功能

### 1. 数据库表结构
- **表名**: `message_processing_records`
- **存储内容**: 完整的消息处理记录，包括：
  - 基本信息（messageId, chatId, userId, userName, managerName）
  - 消息内容（messagePreview, replyPreview, replySegments）
  - 状态信息（status, error, scenario）
  - 性能指标（totalDuration, queueDuration, aiDuration, sendDuration）
  - Agent 调用详情（agentInvocation - JSONB 格式，存储完整的请求/响应）
  - 工具和资源（tools, tokenUsage, isFallback, fallbackSuccess）

### 2. 后端改动

#### SupabaseService 新增方法
```typescript
// src/core/supabase/supabase.service.ts (Lines 2344-2542)
saveMessageProcessingRecord()      // 保存消息处理记录
getMessageProcessingRecords()      // 查询消息处理记录（支持时间、状态、chatId 筛选）
cleanupMessageProcessingRecords()  // 清理过期记录
```

#### MonitoringService 持久化调用
```typescript
// src/core/monitoring/monitoring.service.ts
recordMessageSuccess()    // Line 265-268: 成功时异步保存
recordMessageFailure()    // Line 346-349: 失败时异步保存
saveMessageProcessingRecordToDatabase()  // Lines 1006-1043: 私有方法
```

#### MonitoringController 新增 API
```typescript
// src/core/monitoring/monitoring.controller.ts (Lines 794-836)
GET /monitoring/message-processing-records
```

### 3. 前端改动

#### Hooks 新增查询方法
```typescript
// dashboard/src/hooks/useMonitoring.ts (Lines 679-703)
useMessageProcessingRecords()  // 查询持久化的消息处理记录
```

#### 实时消息页面重构
```typescript
// dashboard/src/view/logs/list/index.tsx
- 从 useDashboard 改为 useMessageProcessingRecords
- 添加时间范围筛选（今天/近7天/近30天）
- 支持查询历史数据
```

#### ControlPanel 组件增强
```typescript
// dashboard/src/view/logs/list/components/ControlPanel/index.tsx
- 添加 timeRange 和 onTimeRangeChange props
- 添加时间范围选择器 UI（今天/近7天/近30天）
```

## 测试步骤

### 前置条件

1. **数据库表创建**
   ```bash
   # 在 Supabase SQL Editor 中执行
   cat docs/database/migrations/message_processing_records.sql
   ```

2. **启动服务**
   ```bash
   # 后端服务
   pnpm run start:dev

   # 前端 Dashboard
   cd dashboard
   pnpm run dev
   ```

### 测试场景

#### 场景 1: 数据持久化验证

1. **发送测试消息**
   - 通过企业微信发送几条测试消息给托管账号
   - 观察后端日志是否显示 "保存消息处理记录"

2. **检查数据库**
   ```sql
   -- 在 Supabase SQL Editor 中执行
   SELECT
     message_id,
     chat_id,
     user_name,
     status,
     message_preview,
     reply_preview,
     ai_duration,
     token_usage,
     created_at
   FROM message_processing_records
   ORDER BY created_at DESC
   LIMIT 10;
   ```

3. **验证 agentInvocation 字段**
   ```sql
   SELECT
     message_id,
     agent_invocation->'request'->>'messages' as request_messages,
     agent_invocation->'response'->>'content' as response_content,
     agent_invocation->'performance' as performance
   FROM message_processing_records
   WHERE agent_invocation IS NOT NULL
   LIMIT 5;
   ```

#### 场景 2: API 接口测试

1. **测试无参数查询**
   ```bash
   curl http://localhost:8080/monitoring/message-processing-records
   ```

2. **测试时间范围筛选**
   ```bash
   # 查询今天的数据
   curl "http://localhost:8080/monitoring/message-processing-records?startDate=2025-12-10&endDate=2025-12-10"

   # 查询近7天的数据
   curl "http://localhost:8080/monitoring/message-processing-records?startDate=2025-12-03&endDate=2025-12-10"
   ```

3. **测试状态筛选**
   ```bash
   # 只查询成功的记录
   curl "http://localhost:8080/monitoring/message-processing-records?status=success&limit=10"

   # 只查询失败的记录
   curl "http://localhost:8080/monitoring/message-processing-records?status=failure"
   ```

4. **测试 chatId 筛选**
   ```bash
   curl "http://localhost:8080/monitoring/message-processing-records?chatId=YOUR_CHAT_ID"
   ```

#### 场景 3: 前端功能测试

1. **访问实时消息页面**
   ```
   http://localhost:5176/dashboard/logs
   ```

2. **测试时间范围切换**
   - 点击 "今天" 按钮 → 应该显示今天的消息记录
   - 点击 "近7天" 按钮 → 应该显示最近7天的消息记录
   - 点击 "近30天" 按钮 → 应该显示最近30天的消息记录

3. **验证数据显示**
   - 检查消息列表是否正确显示
   - 检查统计数据（总计、成功、失败、首响时间）是否准确
   - 点击消息行，打开抽屉查看详情

4. **验证消息详情抽屉**
   - 点击任意一条消息
   - 检查抽屉中是否显示完整的 Agent 调用信息：
     - 请求内容（messages）
     - 响应内容（content）
     - 使用的工具（tools）
     - Token 消耗
     - 性能指标

#### 场景 4: 服务重启测试

1. **重启前记录数据量**
   ```sql
   SELECT COUNT(*) FROM message_processing_records;
   ```

2. **重启后端服务**
   ```bash
   # 停止服务（Ctrl+C）
   # 重新启动
   pnpm run start:dev
   ```

3. **验证数据仍然存在**
   - 刷新前端页面
   - 检查消息列表是否显示重启前的数据
   - 验证数据量与重启前一致

#### 场景 5: 历史数据查询测试

1. **插入测试历史数据**（可选）
   ```sql
   -- 插入3天前的测试数据
   INSERT INTO message_processing_records (
     message_id, chat_id, user_name, status,
     message_preview, reply_preview, received_at
   ) VALUES (
     'test-msg-001', 'test-chat-001', '测试用户', 'success',
     '测试消息内容', '测试回复内容', NOW() - INTERVAL '3 days'
   );
   ```

2. **前端验证**
   - 切换到 "近7天" 或 "近30天"
   - 确认能看到历史测试数据

### 预期结果

✅ **数据持久化**
- 每条消息处理成功/失败后，都会在数据库中创建/更新记录
- 后端日志显示 "保存消息处理记录" 或警告信息（如果保存失败）

✅ **API 查询**
- 所有查询参数（startDate, endDate, status, chatId, limit, offset）正常工作
- 返回的数据包含完整的消息处理记录

✅ **前端显示**
- 实时消息页面正确显示持久化数据
- 时间范围筛选器工作正常
- 消息详情抽屉显示完整的 agentInvocation 信息

✅ **数据保留**
- 服务重启后，历史数据不丢失
- 可以查询任意时间范围内的数据

### 常见问题排查

#### 问题 1: 数据库表不存在
```
Error: relation "message_processing_records" does not exist
```
**解决**: 执行 SQL 迁移文件创建表
```bash
# 在 Supabase SQL Editor 中执行
cat docs/database/migrations/message_processing_records.sql
```

#### 问题 2: 前端无数据显示
**排查步骤**:
1. 检查后端日志是否有报错
2. 检查浏览器控制台 Network 标签，查看 API 请求是否成功
3. 检查数据库中是否有数据
4. 确认时间范围筛选是否正确

#### 问题 3: 消息详情缺失
**排查步骤**:
1. 检查 `agent_invocation` 字段是否为空
2. 检查 MonitoringService 是否正确保存了 agentInvocation 数据
3. 查看后端日志中的警告信息

#### 问题 4: 保存失败
**后端日志**:
```
[MonitoringService] 保存消息处理记录失败: xxx
```
**排查步骤**:
1. 检查 Supabase 连接是否正常
2. 检查数据库权限配置
3. 检查 SUPABASE_SERVICE_ROLE_KEY 环境变量是否正确

## 数据维护

### 定期清理过期数据

```typescript
// 可以在 MonitoringService 中添加定时任务
// 或手动调用清理方法
await this.supabaseService.cleanupMessageProcessingRecords(30); // 保留30天
```

### SQL 手动清理
```sql
-- 删除30天前的记录
DELETE FROM message_processing_records
WHERE created_at < NOW() - INTERVAL '30 days';

-- 使用内置清理函数
SELECT cleanup_old_message_processing_records(30);
```

## 性能考虑

1. **异步保存**: 数据库保存操作不阻塞主消息处理流程
2. **索引优化**: 在 `received_at`, `status`, `chat_id` 上建立索引
3. **JSONB 查询**: `agent_invocation` 使用 JSONB 类型，支持高效查询
4. **数据分页**: API 支持 limit 和 offset，避免一次返回过多数据

## 后续优化建议

1. **数据统计仪表板**: 基于持久化数据生成长期趋势分析
2. **异常监控**: 基于历史数据识别异常模式
3. **性能分析**: 分析不同时段/场景的性能指标
4. **数据导出**: 支持 CSV/Excel 导出功能
5. **高级筛选**: 添加更多筛选条件（如 token 范围、工具类型等）
