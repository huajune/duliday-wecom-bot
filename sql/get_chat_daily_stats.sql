-- 获取聊天数据的每日统计
-- 用于消息趋势图表展示
-- 参数：
--   p_start_date: 开始日期（UTC时区）
--   p_end_date: 结束日期（UTC时区）
-- 返回：每日消息数、活跃会话数
CREATE OR REPLACE FUNCTION get_chat_daily_stats(
  p_start_date timestamptz,
  p_end_date timestamptz
)
RETURNS TABLE (
  date date,
  message_count bigint,
  session_count bigint
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    DATE(timestamp) as date,
    COUNT(*) as message_count,
    COUNT(DISTINCT chat_id) as session_count
  FROM chat_messages
  WHERE timestamp >= p_start_date
    AND timestamp <= p_end_date
  GROUP BY DATE(timestamp)
  ORDER BY date ASC;
END;
$$;

-- 添加函数注释
COMMENT ON FUNCTION get_chat_daily_stats(timestamptz, timestamptz) IS '获取指定时间范围内的每日聊天统计数据（消息数、活跃会话数）';
