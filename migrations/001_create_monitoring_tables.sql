-- =============================================
-- 监控系统数据库表结构
-- =============================================
-- 创建时间: 2025-12-12
-- 目的: 将监控数据从内存迁移到 Supabase 持久化存储
-- =============================================

-- 1. 小时级聚合统计表
-- 用于存储每小时的性能指标、成功率等聚合数据
CREATE TABLE IF NOT EXISTS monitoring_hourly_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hour TIMESTAMPTZ NOT NULL,                -- 小时时间戳（UTC）
  message_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  success_rate NUMERIC(5,2) DEFAULT 0,      -- 成功率（百分比）
  avg_duration INTEGER DEFAULT 0,           -- 平均耗时（ms）
  min_duration INTEGER DEFAULT 0,
  max_duration INTEGER DEFAULT 0,
  p50_duration INTEGER DEFAULT 0,           -- P50 百分位
  p95_duration INTEGER DEFAULT 0,           -- P95 百分位
  p99_duration INTEGER DEFAULT 0,           -- P99 百分位
  avg_ai_duration INTEGER DEFAULT 0,        -- 平均 AI 处理耗时
  avg_send_duration INTEGER DEFAULT 0,      -- 平均发送耗时
  active_users INTEGER DEFAULT 0,           -- 活跃用户数
  active_chats INTEGER DEFAULT 0,           -- 活跃会话数
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (hour)                             -- 防止重复聚合
);

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_hourly_stats_hour ON monitoring_hourly_stats(hour DESC);
CREATE INDEX IF NOT EXISTS idx_hourly_stats_created_at ON monitoring_hourly_stats(created_at DESC);

-- 触发器：自动更新 updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_monitoring_hourly_stats_updated_at
  BEFORE UPDATE ON monitoring_hourly_stats
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================

-- 2. 错误日志表
-- 用于存储消息处理过程中的错误信息
CREATE TABLE IF NOT EXISTS monitoring_error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id TEXT NOT NULL,                 -- 消息 ID
  timestamp BIGINT NOT NULL,                -- Unix 时间戳（ms）
  error TEXT NOT NULL,                      -- 错误信息
  alert_type TEXT,                          -- 告警类型: agent, message, delivery, system, merge, unknown
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_error_logs_timestamp ON monitoring_error_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_message_id ON monitoring_error_logs(message_id);
CREATE INDEX IF NOT EXISTS idx_error_logs_alert_type ON monitoring_error_logs(alert_type);
CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON monitoring_error_logs(created_at DESC);

-- =============================================

-- 3. 每日统计表
-- 用于存储每日汇总数据，支持长期趋势分析
CREATE TABLE IF NOT EXISTS monitoring_daily_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,                       -- 日期（YYYY-MM-DD）
  token_usage INTEGER NOT NULL DEFAULT 0,   -- 当日 Token 消耗
  unique_users INTEGER NOT NULL DEFAULT 0,  -- 当日咨询人头数（去重）
  message_count INTEGER NOT NULL DEFAULT 0, -- 消息总数
  success_count INTEGER NOT NULL DEFAULT 0, -- 成功数
  avg_duration INTEGER DEFAULT 0,           -- 平均响应时间
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (date)                             -- 每天只有一条记录
);

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON monitoring_daily_stats(date DESC);

-- 触发器：自动更新 updated_at
CREATE TRIGGER update_monitoring_daily_stats_updated_at
  BEFORE UPDATE ON monitoring_daily_stats
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================

-- 说明：message_processing_records 表已存在，无需创建
-- 该表用于存储详细的消息处理记录

-- =============================================
-- 数据清理策略（可选）
-- =============================================

-- 定期清理超过 90 天的小时统计数据（可通过定时任务执行）
-- DELETE FROM monitoring_hourly_stats WHERE hour < NOW() - INTERVAL '90 days';

-- 定期清理超过 30 天的错误日志（可通过定时任务执行）
-- DELETE FROM monitoring_error_logs WHERE timestamp < EXTRACT(EPOCH FROM (NOW() - INTERVAL '30 days')) * 1000;

-- 每日统计数据保留时间更长，建议至少 1 年
-- DELETE FROM monitoring_daily_stats WHERE date < NOW()::DATE - INTERVAL '1 year';

-- =============================================
-- 注释说明
-- =============================================

COMMENT ON TABLE monitoring_hourly_stats IS '小时级聚合统计表，用于存储每小时的性能指标';
COMMENT ON TABLE monitoring_error_logs IS '错误日志表，记录消息处理过程中的错误信息';
COMMENT ON TABLE monitoring_daily_stats IS '每日统计表，用于长期趋势分析';

COMMENT ON COLUMN monitoring_hourly_stats.hour IS '小时时间戳（UTC），精确到小时';
COMMENT ON COLUMN monitoring_hourly_stats.success_rate IS '成功率，范围 0-100';
COMMENT ON COLUMN monitoring_hourly_stats.p50_duration IS 'P50 百分位耗时（中位数）';
COMMENT ON COLUMN monitoring_hourly_stats.p95_duration IS 'P95 百分位耗时';
COMMENT ON COLUMN monitoring_hourly_stats.p99_duration IS 'P99 百分位耗时';

COMMENT ON COLUMN monitoring_error_logs.timestamp IS 'Unix 时间戳（毫秒）';
COMMENT ON COLUMN monitoring_error_logs.alert_type IS '告警类型：agent, message, delivery, system, merge, unknown';

COMMENT ON COLUMN monitoring_daily_stats.date IS '统计日期（YYYY-MM-DD）';
COMMENT ON COLUMN monitoring_daily_stats.unique_users IS '去重后的用户数（按 userId）';
