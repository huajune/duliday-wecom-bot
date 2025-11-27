-- ============================================
-- 聊天消息表
-- 用于存储用户与 Bot 的聊天记录
-- ============================================

-- 创建表
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 核心字段
  chat_id TEXT NOT NULL,                    -- 会话ID
  message_id TEXT NOT NULL,                 -- 消息ID（用于去重）
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),  -- 角色
  content TEXT NOT NULL,                    -- 消息内容
  timestamp TIMESTAMPTZ NOT NULL,           -- 消息时间

  -- 元数据
  candidate_name TEXT,                      -- 候选人昵称
  manager_name TEXT,                        -- 招募经理昵称
  org_id TEXT,                              -- 企业ID
  bot_id TEXT,                              -- Bot ID

  -- 消息分类字段（v1.2 改为英文枚举字符串）
  message_type TEXT DEFAULT 'TEXT' CHECK (message_type IN (
    'UNKNOWN', 'FILE', 'VOICE', 'CONTACT_CARD', 'CHAT_HISTORY', 'EMOTION',
    'IMAGE', 'TEXT', 'LOCATION', 'MINI_PROGRAM', 'MONEY', 'REVOKE',
    'LINK', 'VIDEO', 'CHANNELS', 'CALL_RECORD', 'GROUP_SOLITAIRE',
    'ROOM_INVITE', 'SYSTEM', 'WECOM_SYSTEM'
  )),
  source TEXT DEFAULT 'MOBILE_PUSH' CHECK (source IN (
    'MOBILE_PUSH', 'AGGREGATED_CHAT_MANUAL', 'ADVANCED_GROUP_SEND_SOP',
    'AUTO_REPLY', 'CREATE_GROUP', 'OTHER_BOT_REPLY', 'API_SEND',
    'NEW_CUSTOMER_ANSWER_SOP', 'API_GROUP_SEND', 'TAG_SOP',
    'MULTI_GROUP_FORWARD', 'MULTI_GROUP_REPLAY', 'AUTO_END_CONVERSATION',
    'SCHEDULED_MESSAGE', 'AI_REPLY', 'UNKNOWN'
  )),
  is_room BOOLEAN DEFAULT FALSE,            -- 是否群聊：false=私聊, true=群聊（注：群聊消息不存储）

  -- v1.3 新增字段：完整回调数据
  im_bot_id TEXT,                           -- 托管账号的系统 wxid
  im_contact_id TEXT,                       -- 联系人系统ID（私聊时有值）
  contact_type TEXT DEFAULT 'UNKNOWN' CHECK (contact_type IN (
    'UNKNOWN', 'PERSONAL_WECHAT', 'OFFICIAL_ACCOUNT', 'ENTERPRISE_WECHAT'
  )),                                       -- 客户类型
  is_self BOOLEAN DEFAULT FALSE,            -- 是否托管账号自己发送
  payload JSONB,                            -- 原始消息内容（保留完整 payload）
  avatar TEXT,                              -- 用户头像URL
  external_user_id TEXT,                    -- 企微外部用户ID

  -- 系统字段
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- 唯一约束：防止重复写入
  UNIQUE(message_id)
);

-- 索引：按时间查询（仪表盘、飞书同步）
CREATE INDEX IF NOT EXISTS idx_chat_messages_timestamp
  ON chat_messages(timestamp DESC);

-- 索引：按会话查询（AI 上下文）
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id
  ON chat_messages(chat_id, timestamp DESC);

-- 索引：按日期查询（优化按天筛选）
CREATE INDEX IF NOT EXISTS idx_chat_messages_date
  ON chat_messages(DATE(timestamp) DESC);

-- 注释
COMMENT ON TABLE chat_messages IS '聊天消息记录，支持 AI 上下文、仪表盘展示、飞书同步';
COMMENT ON COLUMN chat_messages.chat_id IS '会话ID，通常为 recipientId';
COMMENT ON COLUMN chat_messages.message_id IS '消息唯一ID，用于去重';
COMMENT ON COLUMN chat_messages.role IS '消息角色：user=用户消息，assistant=AI回复';
COMMENT ON COLUMN chat_messages.content IS '消息内容';
COMMENT ON COLUMN chat_messages.timestamp IS '消息发送时间';
COMMENT ON COLUMN chat_messages.candidate_name IS '候选人微信昵称';
COMMENT ON COLUMN chat_messages.manager_name IS '招募经理姓名';
COMMENT ON COLUMN chat_messages.org_id IS '企业ID';
COMMENT ON COLUMN chat_messages.bot_id IS 'Bot ID';
COMMENT ON COLUMN chat_messages.message_type IS '消息类型枚举: TEXT=文本, IMAGE=图片, VOICE=语音, FILE=文件, VIDEO=视频, LINK=链接等';
COMMENT ON COLUMN chat_messages.source IS '消息来源枚举: MOBILE_PUSH=手机推送, API_SEND=API发送, AI_REPLY=AI回复等';
COMMENT ON COLUMN chat_messages.is_room IS '是否群聊：false=私聊, true=群聊（注：群聊消息不存储）';
COMMENT ON COLUMN chat_messages.im_bot_id IS '托管账号的系统 wxid';
COMMENT ON COLUMN chat_messages.im_contact_id IS '联系人系统ID（私聊时有值）';
COMMENT ON COLUMN chat_messages.contact_type IS '客户类型枚举: UNKNOWN=未知, PERSONAL_WECHAT=个人微信, OFFICIAL_ACCOUNT=公众号, ENTERPRISE_WECHAT=企业微信';
COMMENT ON COLUMN chat_messages.is_self IS '是否托管账号自己发送的消息';
COMMENT ON COLUMN chat_messages.payload IS '原始消息内容 (JSONB)，保留完整的 payload 结构';
COMMENT ON COLUMN chat_messages.avatar IS '用户头像URL';
COMMENT ON COLUMN chat_messages.external_user_id IS '企微外部用户ID';

-- ============================================
-- RLS 策略 (Row Level Security)
-- ============================================

-- 启用 RLS
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- 允许服务端读写（使用 service_role key）
CREATE POLICY "Allow service role full access" ON chat_messages
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 允许匿名用户只读（用于 Dashboard 展示）
CREATE POLICY "Allow anonymous read access" ON chat_messages
  FOR SELECT
  USING (true);

-- ============================================
-- 数据清理函数（可选，如需定期清理）
-- ============================================

-- 清理 N 天前的数据
CREATE OR REPLACE FUNCTION cleanup_chat_messages(retention_days INTEGER DEFAULT 90)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM chat_messages
  WHERE timestamp < NOW() - (retention_days || ' days')::INTERVAL;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION cleanup_chat_messages IS '清理指定天数前的聊天记录，默认保留 90 天';

-- ============================================
-- 优化函数（v1.2 新增）
-- ============================================

-- 获取所有唯一的 chat_id（使用 DISTINCT，比全表扫描高效）
CREATE OR REPLACE FUNCTION get_distinct_chat_ids()
RETURNS TABLE(chat_id TEXT)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT cm.chat_id
  FROM chat_messages cm
  ORDER BY cm.chat_id ASC;
$$;

COMMENT ON FUNCTION get_distinct_chat_ids IS '获取所有唯一的会话ID，使用 DISTINCT 避免全表扫描';

-- ============================================
-- 迁移脚本（从 INTEGER 迁移到 TEXT）
-- ============================================
-- 如果已有数据，执行以下迁移脚本:
--
-- 1. 添加新的临时列
-- ALTER TABLE chat_messages ADD COLUMN message_type_new TEXT;
-- ALTER TABLE chat_messages ADD COLUMN source_new TEXT;
--
-- 2. 数据转换
-- UPDATE chat_messages SET message_type_new = CASE message_type
--   WHEN 0 THEN 'UNKNOWN' WHEN 1 THEN 'FILE' WHEN 2 THEN 'VOICE'
--   WHEN 3 THEN 'CONTACT_CARD' WHEN 4 THEN 'CHAT_HISTORY' WHEN 5 THEN 'EMOTION'
--   WHEN 6 THEN 'IMAGE' WHEN 7 THEN 'TEXT' WHEN 8 THEN 'LOCATION'
--   WHEN 9 THEN 'MINI_PROGRAM' WHEN 10 THEN 'MONEY' WHEN 11 THEN 'REVOKE'
--   WHEN 12 THEN 'LINK' WHEN 13 THEN 'VIDEO' WHEN 14 THEN 'CHANNELS'
--   WHEN 15 THEN 'CALL_RECORD' WHEN 16 THEN 'GROUP_SOLITAIRE'
--   WHEN 9999 THEN 'ROOM_INVITE' WHEN 10000 THEN 'SYSTEM' WHEN 10001 THEN 'WECOM_SYSTEM'
--   ELSE 'UNKNOWN'
-- END;
--
-- UPDATE chat_messages SET source_new = CASE source
--   WHEN 0 THEN 'MOBILE_PUSH' WHEN 1 THEN 'AGGREGATED_CHAT_MANUAL'
--   WHEN 2 THEN 'ADVANCED_GROUP_SEND_SOP' WHEN 3 THEN 'AUTO_REPLY'
--   WHEN 4 THEN 'CREATE_GROUP' WHEN 5 THEN 'OTHER_BOT_REPLY'
--   WHEN 6 THEN 'API_SEND' WHEN 7 THEN 'NEW_CUSTOMER_ANSWER_SOP'
--   WHEN 8 THEN 'API_GROUP_SEND' WHEN 9 THEN 'TAG_SOP'
--   WHEN 11 THEN 'MULTI_GROUP_FORWARD' WHEN 12 THEN 'MULTI_GROUP_REPLAY'
--   WHEN 13 THEN 'AUTO_END_CONVERSATION' WHEN 14 THEN 'SCHEDULED_MESSAGE'
--   WHEN 15 THEN 'AI_REPLY'
--   ELSE 'UNKNOWN'
-- END;
--
-- 3. 删除旧列，重命名新列
-- ALTER TABLE chat_messages DROP COLUMN message_type;
-- ALTER TABLE chat_messages DROP COLUMN source;
-- ALTER TABLE chat_messages RENAME COLUMN message_type_new TO message_type;
-- ALTER TABLE chat_messages RENAME COLUMN source_new TO source;
--
-- 4. 添加 CHECK 约束
-- ALTER TABLE chat_messages ADD CONSTRAINT check_message_type CHECK (...);
-- ALTER TABLE chat_messages ADD CONSTRAINT check_source CHECK (...);

-- ============================================
-- 使用说明
-- ============================================
--
-- 1. 在 Supabase Dashboard -> SQL Editor 中执行此脚本
-- 2. 服务端使用 service_role key 进行读写
-- 3. Dashboard 使用 anon key 进行读取
--
-- 存储容量预估（字符串枚举约增加 15 bytes/row，~204 bytes/row）:
-- +------------+----------+----------+-----------+
-- | 每日消息量  | 30天存储  | 60天存储  | 占用比例   |
-- +------------+----------+----------+-----------+
-- | 500 条     | 6 MB     | 12 MB    | 2%        |
-- | 5,000 条   | 61 MB    | 122 MB   | 24%       |
-- | 10,000 条  | 122 MB   | 245 MB   | 49%       |
-- | 15,000 条  | 184 MB   | 367 MB   | 73%       |
-- | 20,000 条  | 245 MB   | 490 MB   | 98%       |
-- +------------+----------+----------+-----------+
--
-- QPS 限制（免费版）:
-- - 读取: ~1,200 次/秒
-- - 写入: ~1,000 次/秒
-- - 10,000 条/天平均 QPS ≈ 0.12 次/秒，完全安全
--
-- 自动清理策略:
-- - 定时任务: 每天凌晨 3 点执行 cleanup_chat_messages(60)
-- - 清理范围: 60 天前的消息
-- - 执行方式: NestJS @Cron 调用 SupabaseService.cleanupChatMessages()
--
-- 手动清理（如需调整保留天数）:
-- SELECT cleanup_chat_messages(30);  -- 保留 30 天（紧急释放空间）
-- ============================================
