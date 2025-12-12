# MonitoringService 重写计划

## 目标
将 MonitoringService 从内存存储架构迁移到 Supabase + Redis 持久化架构

## 必须保留的公共接口

### 1. 消息处理记录方法
- `recordMessageReceived(messageId, chatId, userId, userName, messageContent, metadata, managerName)`
- `recordWorkerStart(messageId)`
- `recordAiStart(messageId)`
- `recordAiEnd(messageId)`
- `recordSendStart(messageId)`
- `recordSendEnd(messageId)`
- `recordSuccess(messageId, metadata)`
- `recordFailure(messageId, error, metadata)`

### 2. Dashboard 数据查询方法
- `getDashboardData(timeRange: TimeRange): DashboardData`
- `getDashboardDataAsync(timeRange: TimeRange): Promise<DashboardData>`
- `getMetricsData(): MetricsData`
- `getTodayUsers(): Promise<TodayUser[]>`
- `getUsersByDate(date: string): Promise<TodayUser[]>`
- `getUserTrend(): Promise<...>`

## 重写策略

### 阶段 1: 修改数据写入逻辑
- 移除内存存储变量 (`detailRecords`, `hourlyStatsMap`, `globalCounters`, `errorLogs`)
- `recordMessageReceived` → 创建临时记录对象（暂存，等完成后再写入）
- `recordSuccess`/`recordFailure` → 调用 `databaseService.saveDetailRecord()` + `cacheService.incrementCounters()`
- 移除 `addRecord()`, `persistSnapshot()` 等内存操作方法

### 阶段 2: 修改数据读取逻辑
- `getDashboardData` → 从 `databaseService.getDetailRecordsByTimeRange()` 读取数据
- `getMetricsData` → 从 Supabase + Redis 读取
- 保留所有计算逻辑（业务指标、趋势图等）

### 阶段 3: 清理废弃代码
- 删除 `cleanupExpiredData()`（不再需要内存清理）
- 删除 `restoreFromSnapshot()`, `persistSnapshot()`, `buildSnapshotPayload()`
- 删除 `MonitoringSnapshotService` 依赖

### 阶段 4: 添加迁移逻辑
- 在 `onModuleInit()` 中调用 `MonitoringMigrationService.migrateSnapshotToNewArchitecture()`
- 仅在首次启动时执行迁移

## 临时记录存储策略

为了避免每次状态更新都写数据库，采用以下策略：
1. 消息接收时创建临时记录对象（存在内存 Map 中）
2. 各个状态更新（`recordAiStart`, `recordAiEnd` 等）更新临时对象
3. **仅在 `recordSuccess` 或 `recordFailure` 时写入数据库**
4. 临时对象保留 1 小时后自动清理（防止内存泄漏）

```typescript
// 临时记录 Map（仅保留未完成的消息）
private pendingRecords = new Map<string, MessageProcessingRecord>();

// 定期清理超过 1 小时的临时记录
private cleanupPendingRecords() {
  const oneHourAgo = Date.now() - 3600000;
  for (const [id, record] of this.pendingRecords.entries()) {
    if (record.receivedAt < oneHourAgo) {
      this.pendingRecords.delete(id);
    }
  }
}
```

## 预期文件大小

重写后预计文件从 1944 行 → 约 1200 行（减少 38%）
- 移除内存管理代码：~300 行
- 移除快照相关代码：~200 行
- 简化数据查询逻辑：~200 行
- 新增数据库/缓存调用：~50 行

## 风险点

1. **性能影响**：每次写入 Supabase 延迟 ~150ms（可通过异步批量写入优化）
2. **数据一致性**：服务崩溃时可能丢失 `pendingRecords` 中未保存的数据（可接受，因为消息仍在数据库中）
3. **接口兼容性**：必须确保所有公共方法签名不变

## 测试计划

1. 单元测试：Mock `databaseService` 和 `cacheService`，验证调用正确性
2. 集成测试：发送测试消息，验证数据库中的记录完整性
3. 性能测试：压测 100 条/秒，验证响应时间 <500ms
4. 迁移测试：模拟有快照数据的场景，验证迁移成功
