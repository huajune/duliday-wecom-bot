-- RPC 函数：获取会话列表
-- 用途：替代应用层聚合，在数据库层面高效聚合聊天会话数据
--
-- 参数：
--   p_start_date: 开始时间（timestamptz）
--   p_end_date: 结束时间（timestamptz）
--
-- 返回：
--   chat_id: 会话ID
--   candidate_name: 候选人姓名（从 role='user' 的消息获取）
--   manager_name: 管理员姓名
--   message_count: 消息数量
--   last_message: 最新消息内容（截取前50字符）
--   last_timestamp: 最新消息时间戳
--   avatar: 头像（从 role='user' 的消息获取）
--   contact_type: 联系人类型（从 role='user' 的消息获取）
--
-- 使用示例：
--   SELECT * FROM get_chat_session_list(
--     '2025-01-01 00:00:00+00'::timestamptz,
--     '2025-12-31 23:59:59+00'::timestamptz
--   );

CREATE OR REPLACE FUNCTION get_chat_session_list(
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
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH user_messages AS (
    -- 提取 role='user' 的消息，用于获取候选人信息
    SELECT DISTINCT ON (cm.chat_id)
      cm.chat_id,
      cm.candidate_name,
      cm.avatar,
      cm.contact_type
    FROM chat_messages cm
    WHERE cm.role = 'user'
      AND cm.timestamp >= p_start_date
      AND cm.timestamp <= p_end_date
    ORDER BY cm.chat_id, cm.timestamp DESC
  ),
  latest_messages AS (
    -- 获取每个会话的最新消息
    SELECT DISTINCT ON (cm.chat_id)
      cm.chat_id,
      cm.content,
      cm.timestamp
    FROM chat_messages cm
    WHERE cm.timestamp >= p_start_date
      AND cm.timestamp <= p_end_date
    ORDER BY cm.chat_id, cm.timestamp DESC
  ),
  aggregated_data AS (
    -- 聚合会话数据
    SELECT
      cm.chat_id,
      MAX(cm.manager_name) as manager_name,
      COUNT(*) as message_count
    FROM chat_messages cm
    WHERE cm.timestamp >= p_start_date
      AND cm.timestamp <= p_end_date
    GROUP BY cm.chat_id
  )
  -- 组合所有数据
  SELECT
    ad.chat_id,
    COALESCE(um.candidate_name, '') as candidate_name,
    COALESCE(ad.manager_name, '') as manager_name,
    ad.message_count,
    -- 截取最新消息内容（前50字符）
    CASE
      WHEN LENGTH(lm.content) > 50
      THEN SUBSTRING(lm.content FROM 1 FOR 50) || '...'
      ELSE COALESCE(lm.content, '')
    END as last_message,
    lm.timestamp as last_timestamp,
    COALESCE(um.avatar, '') as avatar,
    COALESCE(um.contact_type, '') as contact_type
  FROM aggregated_data ad
  LEFT JOIN user_messages um ON ad.chat_id = um.chat_id
  LEFT JOIN latest_messages lm ON ad.chat_id = lm.chat_id
  ORDER BY lm.timestamp DESC;
END;
$$;

-- 添加函数注释
COMMENT ON FUNCTION get_chat_session_list(timestamptz, timestamptz) IS
'获取指定时间范围内的聊天会话列表，按 chat_id 聚合，包含候选人信息、消息统计和最新消息';
