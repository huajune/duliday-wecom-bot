-- ============================================
-- 用户活跃记录表
-- 用于存储每日咨询用户的活跃数据（替代内存存储）
-- ============================================

-- 创建表
CREATE TABLE IF NOT EXISTS user_activity (
  id BIGSERIAL PRIMARY KEY,

  -- 用户标识
  chat_id TEXT NOT NULL,                      -- 会话ID（用户唯一标识）
  od_id TEXT,                                 -- 用户 ID
  od_name TEXT,                               -- 用户昵称

  -- 小组信息
  group_id TEXT,                              -- 小组 ID
  group_name TEXT,                            -- 小组名称

  -- 活跃数据（每日聚合）
  activity_date DATE NOT NULL,                -- 活跃日期
  message_count INTEGER DEFAULT 0,            -- 当日消息数
  token_usage INTEGER DEFAULT 0,              -- 当日 Token 消耗
  first_active_at TIMESTAMPTZ NOT NULL,       -- 首次活跃时间
  last_active_at TIMESTAMPTZ NOT NULL,        -- 最后活跃时间

  -- 系统字段
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- 唯一约束：每个用户每天只有一条记录
  UNIQUE(chat_id, activity_date)
);

-- 索引：按日期查询（Dashboard 展示）
CREATE INDEX IF NOT EXISTS idx_user_activity_date
  ON user_activity(activity_date DESC);

-- 索引：按用户查询历史
CREATE INDEX IF NOT EXISTS idx_user_activity_chat_id
  ON user_activity(chat_id, activity_date DESC);

-- 索引：复合索引（按日期+最后活跃时间排序）
CREATE INDEX IF NOT EXISTS idx_user_activity_date_last_active
  ON user_activity(activity_date DESC, last_active_at DESC);

-- 注释
COMMENT ON TABLE user_activity IS '用户活跃记录（按日聚合），永久保留';
COMMENT ON COLUMN user_activity.chat_id IS '会话ID，用户唯一标识';
COMMENT ON COLUMN user_activity.od_id IS '用户 OD ID';
COMMENT ON COLUMN user_activity.od_name IS '用户昵称';
COMMENT ON COLUMN user_activity.group_id IS '所属小组 ID';
COMMENT ON COLUMN user_activity.group_name IS '所属小组名称';
COMMENT ON COLUMN user_activity.activity_date IS '活跃日期（按天聚合）';
COMMENT ON COLUMN user_activity.message_count IS '当日消息数量';
COMMENT ON COLUMN user_activity.token_usage IS '当日 Token 消耗';
COMMENT ON COLUMN user_activity.first_active_at IS '当日首次活跃时间';
COMMENT ON COLUMN user_activity.last_active_at IS '当日最后活跃时间';

-- ============================================
-- RLS 策略 (Row Level Security)
-- ============================================

-- 启用 RLS
ALTER TABLE user_activity ENABLE ROW LEVEL SECURITY;

-- 允许服务端读写（使用 service_role key）
CREATE POLICY "Allow service role full access" ON user_activity
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 允许匿名用户只读（用于 Dashboard 展示）
CREATE POLICY "Allow anonymous read access" ON user_activity
  FOR SELECT
  USING (true);

-- ============================================
-- 更新用户活跃记录函数（Upsert）
-- ============================================

CREATE OR REPLACE FUNCTION upsert_user_activity(
  p_chat_id TEXT,
  p_od_id TEXT,
  p_od_name TEXT,
  p_group_id TEXT,
  p_group_name TEXT,
  p_message_count INTEGER,
  p_token_usage INTEGER,
  p_active_at TIMESTAMPTZ
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_activity_date DATE := DATE(p_active_at AT TIME ZONE 'Asia/Shanghai');
BEGIN
  INSERT INTO user_activity (
    chat_id, od_id, od_name, group_id, group_name,
    activity_date, message_count, token_usage,
    first_active_at, last_active_at
  ) VALUES (
    p_chat_id, p_od_id, p_od_name, p_group_id, p_group_name,
    v_activity_date, p_message_count, p_token_usage,
    p_active_at, p_active_at
  )
  ON CONFLICT (chat_id, activity_date) DO UPDATE SET
    od_name = COALESCE(EXCLUDED.od_name, user_activity.od_name),
    group_id = COALESCE(EXCLUDED.group_id, user_activity.group_id),
    group_name = COALESCE(EXCLUDED.group_name, user_activity.group_name),
    message_count = user_activity.message_count + EXCLUDED.message_count,
    token_usage = user_activity.token_usage + EXCLUDED.token_usage,
    last_active_at = GREATEST(user_activity.last_active_at, EXCLUDED.last_active_at),
    updated_at = NOW();
END;
$$;

COMMENT ON FUNCTION upsert_user_activity IS '更新或插入用户活跃记录（自动按中国时区计算日期）';

-- ============================================
-- 获取今日活跃用户
-- ============================================

CREATE OR REPLACE FUNCTION get_today_users()
RETURNS TABLE(
  chat_id TEXT,
  od_id TEXT,
  od_name TEXT,
  group_id TEXT,
  group_name TEXT,
  message_count INTEGER,
  token_usage INTEGER,
  first_active_at TIMESTAMPTZ,
  last_active_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    ua.chat_id,
    ua.od_id,
    ua.od_name,
    ua.group_id,
    ua.group_name,
    ua.message_count,
    ua.token_usage,
    ua.first_active_at,
    ua.last_active_at
  FROM user_activity ua
  WHERE ua.activity_date = DATE(NOW() AT TIME ZONE 'Asia/Shanghai')
  ORDER BY ua.last_active_at DESC;
$$;

COMMENT ON FUNCTION get_today_users IS '获取今日活跃用户列表（中国时区）';

-- ============================================
-- 获取指定日期范围内的活跃用户
-- ============================================

CREATE OR REPLACE FUNCTION get_users_by_date_range(
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE(
  chat_id TEXT,
  od_id TEXT,
  od_name TEXT,
  group_id TEXT,
  group_name TEXT,
  total_message_count BIGINT,
  total_token_usage BIGINT,
  first_active_at TIMESTAMPTZ,
  last_active_at TIMESTAMPTZ,
  active_days BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    ua.chat_id,
    MAX(ua.od_id) as od_id,
    MAX(ua.od_name) as od_name,
    MAX(ua.group_id) as group_id,
    MAX(ua.group_name) as group_name,
    SUM(ua.message_count) as total_message_count,
    SUM(ua.token_usage) as total_token_usage,
    MIN(ua.first_active_at) as first_active_at,
    MAX(ua.last_active_at) as last_active_at,
    COUNT(DISTINCT ua.activity_date) as active_days
  FROM user_activity ua
  WHERE ua.activity_date BETWEEN p_start_date AND p_end_date
  GROUP BY ua.chat_id
  ORDER BY MAX(ua.last_active_at) DESC;
$$;

COMMENT ON FUNCTION get_users_by_date_range IS '获取指定日期范围内的活跃用户聚合数据';

-- ============================================
-- 数据清理函数
-- ============================================

CREATE OR REPLACE FUNCTION cleanup_user_activity(retention_days INTEGER DEFAULT 14)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM user_activity
  WHERE activity_date < (NOW() AT TIME ZONE 'Asia/Shanghai')::DATE - retention_days;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION cleanup_user_activity IS '清理指定天数前的用户活跃记录，默认保留 14 天';

-- ============================================
-- 使用说明
-- ============================================
--
-- 1. 在 Supabase Dashboard -> SQL Editor 中执行此脚本
-- 2. 服务端使用 service_role key 进行写入
-- 3. Dashboard 使用 anon key 进行读取
--
-- 数据写入方式:
-- SELECT upsert_user_activity(
--   'chat_123',           -- chat_id
--   'od_456',             -- od_id
--   '张三',               -- od_name
--   'group_789',          -- group_id
--   '销售一组',           -- group_name
--   1,                    -- message_count (每条消息 +1)
--   100,                  -- token_usage
--   NOW()                 -- active_at
-- );
--
-- 查询今日用户:
-- SELECT * FROM get_today_users();
--
-- 查询本周用户:
-- SELECT * FROM get_users_by_date_range(
--   DATE(NOW() AT TIME ZONE 'Asia/Shanghai') - 7,
--   DATE(NOW() AT TIME ZONE 'Asia/Shanghai')
-- );
--
-- 预估存储:
-- - 每条记录约 200 字节
-- - 100 用户/天，30 天保留：3000 条，约 600 KB
-- - 1000 用户/天，30 天保留：30000 条，约 6 MB
-- ============================================
