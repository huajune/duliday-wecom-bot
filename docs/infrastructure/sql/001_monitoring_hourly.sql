-- ============================================
-- 监控小时聚合数据表
-- 用于存储每小时的监控统计数据
-- ============================================

-- 创建表
CREATE TABLE IF NOT EXISTS monitoring_hourly (
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

  -- 唯一约束：每小时只有一条记录
  UNIQUE(hour)
);

-- 索引：按时间查询（降序，最新的在前）
CREATE INDEX IF NOT EXISTS idx_monitoring_hourly_hour
  ON monitoring_hourly(hour DESC);

-- 注释
COMMENT ON TABLE monitoring_hourly IS '监控小时聚合数据，保留 30 天';
COMMENT ON COLUMN monitoring_hourly.hour IS '小时整点时间 (UTC)';
COMMENT ON COLUMN monitoring_hourly.message_count IS '消息总数';
COMMENT ON COLUMN monitoring_hourly.success_count IS '处理成功数';
COMMENT ON COLUMN monitoring_hourly.failure_count IS '处理失败数';
COMMENT ON COLUMN monitoring_hourly.avg_duration IS '平均响应时间 (毫秒)';
COMMENT ON COLUMN monitoring_hourly.p95_duration IS 'P95 响应时间 (毫秒)';
COMMENT ON COLUMN monitoring_hourly.active_users IS '活跃用户数';
COMMENT ON COLUMN monitoring_hourly.active_chats IS '活跃会话数';
COMMENT ON COLUMN monitoring_hourly.total_tokens IS 'Token 消耗总量';

-- ============================================
-- RLS 策略 (Row Level Security)
-- ============================================

-- 启用 RLS
ALTER TABLE monitoring_hourly ENABLE ROW LEVEL SECURITY;

-- 允许服务端读写（使用 service_role key）
CREATE POLICY "Allow service role full access" ON monitoring_hourly
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 允许匿名用户只读（用于 Dashboard 展示）
CREATE POLICY "Allow anonymous read access" ON monitoring_hourly
  FOR SELECT
  USING (true);

-- ============================================
-- 数据清理函数
-- ============================================

-- 清理 30 天前的数据
CREATE OR REPLACE FUNCTION cleanup_monitoring_hourly()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM monitoring_hourly
  WHERE hour < NOW() - INTERVAL '30 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION cleanup_monitoring_hourly IS '清理 30 天前的监控数据';

-- ============================================
-- 使用说明
-- ============================================
--
-- 1. 在 Supabase Dashboard -> SQL Editor 中执行此脚本
-- 2. 服务端使用 service_role key 进行写入
-- 3. Dashboard 使用 anon key 进行读取
-- 4. 每天凌晨 3 点自动清理过期数据（由应用层处理）
--
-- 预估存储:
-- - 每小时 1 条记录，约 150 字节
-- - 30 天保留：720 条，约 100 KB
-- ============================================
