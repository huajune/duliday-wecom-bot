-- 消息处理记录表（实时消息详情持久化）
-- 用于存储完整的消息处理过程，包括 Agent 调用、工具使用、性能指标等
-- 对应前端 /logs 页面的消息详情数据

CREATE TABLE IF NOT EXISTS message_processing_records (
  -- 主键和索引
  id BIGSERIAL PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE, -- 消息唯一标识

  -- 基本信息
  chat_id TEXT NOT NULL, -- 会话ID
  user_id TEXT, -- 用户ID
  user_name TEXT, -- 用户名称
  manager_name TEXT, -- 经理名称
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- 消息接收时间

  -- 消息内容
  message_preview TEXT, -- 用户消息预览（前50字符）
  reply_preview TEXT, -- AI回复预览
  reply_segments INTEGER DEFAULT 0, -- 回复分段数

  -- 处理状态
  status TEXT NOT NULL CHECK (status IN ('processing', 'success', 'failure')), -- 处理状态
  error TEXT, -- 错误信息
  scenario TEXT, -- 场景类型

  -- 性能指标（毫秒）
  total_duration INTEGER, -- 总耗时
  queue_duration INTEGER, -- 队列等待时间
  prep_duration INTEGER, -- 准备时间
  ai_start_at BIGINT, -- AI开始时间戳
  ai_end_at BIGINT, -- AI结束时间戳
  ai_duration INTEGER, -- AI处理耗时
  send_duration INTEGER, -- 发送耗时

  -- Agent 相关
  tools TEXT[], -- 使用的工具列表
  token_usage INTEGER, -- Token消耗
  is_fallback BOOLEAN DEFAULT FALSE, -- 是否降级
  fallback_success BOOLEAN, -- 降级是否成功

  -- 完整的 Agent 调用记录（JSONB，包含请求和响应）
  agent_invocation JSONB, -- 结构：{ request: {...}, response: {...}, http: {...}, isFallback: boolean }

  -- 元数据
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 创建索引优化查询
CREATE INDEX IF NOT EXISTS idx_message_processing_chat_id ON message_processing_records(chat_id);
CREATE INDEX IF NOT EXISTS idx_message_processing_received_at ON message_processing_records(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_processing_status ON message_processing_records(status);
CREATE INDEX IF NOT EXISTS idx_message_processing_user_id ON message_processing_records(user_id);
CREATE INDEX IF NOT EXISTS idx_message_processing_scenario ON message_processing_records(scenario);

-- 复合索引：按时间范围查询成功/失败消息
CREATE INDEX IF NOT EXISTS idx_message_processing_received_status ON message_processing_records(received_at DESC, status);

-- GIN 索引：支持 JSONB 查询
CREATE INDEX IF NOT EXISTS idx_message_processing_agent_invocation ON message_processing_records USING GIN(agent_invocation);

-- 更新时间触发器
CREATE OR REPLACE FUNCTION update_message_processing_records_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_message_processing_records_updated_at
  BEFORE UPDATE ON message_processing_records
  FOR EACH ROW
  EXECUTE FUNCTION update_message_processing_records_updated_at();

-- 数据清理函数：删除超过 N 天的记录（默认 30 天）
CREATE OR REPLACE FUNCTION cleanup_message_processing_records(days_to_keep INTEGER DEFAULT 30)
RETURNS TABLE(deleted_count BIGINT) AS $$
DECLARE
  cutoff_date TIMESTAMPTZ;
  result_count BIGINT;
BEGIN
  cutoff_date := NOW() - (days_to_keep || ' days')::INTERVAL;

  DELETE FROM message_processing_records
  WHERE received_at < cutoff_date;

  GET DIAGNOSTICS result_count = ROW_COUNT;

  RETURN QUERY SELECT result_count;
END;
$$ LANGUAGE plpgsql;

-- 添加注释
COMMENT ON TABLE message_processing_records IS '消息处理记录表 - 存储实时消息的完整处理过程，包括 Agent 调用详情、工具使用、性能指标等';
COMMENT ON COLUMN message_processing_records.agent_invocation IS '完整的 Agent 调用记录（JSONB）：request（发送的请求）、response（AI响应）、http（HTTP元信息）';
COMMENT ON COLUMN message_processing_records.total_duration IS '总耗时（毫秒）：从接收消息到发送完成的总时间';
COMMENT ON COLUMN message_processing_records.ai_duration IS 'AI处理耗时（毫秒）：Agent API 实际处理时间';
