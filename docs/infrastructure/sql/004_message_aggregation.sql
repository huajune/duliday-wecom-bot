-- ============================================
-- 消息聚合关系
-- 用于支持多条消息聚合处理的数据库结构
-- ============================================

-- 添加聚合关系字段
ALTER TABLE message_processing_records
ADD COLUMN IF NOT EXISTS batch_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT false;

-- 索引：按 batch_id 查询聚合消息组
CREATE INDEX IF NOT EXISTS idx_message_batch_id
  ON message_processing_records(batch_id)
  WHERE batch_id IS NOT NULL;

-- 索引：快速查询主消息（前端展示用）
CREATE INDEX IF NOT EXISTS idx_message_is_primary
  ON message_processing_records(is_primary)
  WHERE is_primary = true;

-- 复合索引：按 batch_id + is_primary 查询
CREATE INDEX IF NOT EXISTS idx_message_batch_primary
  ON message_processing_records(batch_id, is_primary)
  WHERE batch_id IS NOT NULL;

-- 注释
COMMENT ON COLUMN message_processing_records.batch_id IS '聚合批次ID，标识同一批聚合处理的消息';
COMMENT ON COLUMN message_processing_records.is_primary IS '是否为主消息（调用 Agent 的那条消息）';

-- ============================================
-- 使用说明
-- ============================================
--
-- 聚合逻辑:
-- 1. 当用户连续发送多条消息时（2s 窗口内，最多 5 条）
-- 2. SimpleMergeService 生成 batch_id = `batch_${chatId}_${timestamp}`
-- 3. 只有最后一条消息 (is_primary = true) 调用 Agent API
-- 4. 所有消息共享相同的 batch_id 和 AI 响应元数据
--
-- 查询策略:
-- - Dashboard 查询: WHERE is_primary = true（只展示主消息）
-- - 详情页查询: WHERE batch_id = ? ORDER BY received_at（展示完整聚合组）
-- - 统计查询: 不受影响（所有消息都计入统计）
--
-- 数据示例:
-- | message_id | batch_id           | is_primary | status  | reply_preview |
-- |------------|-------------------|------------|---------|---------------|
-- | msg_001    | batch_chat1_12345 | false      | success | AI 回复...    |
-- | msg_002    | batch_chat1_12345 | false      | success | AI 回复...    |
-- | msg_003    | batch_chat1_12345 | true       | success | AI 回复...    |
--
-- ============================================
