import {
  useBlacklist,
  useAddToBlacklist,
  useRemoveFromBlacklist,
  useAiReplyStatus,
  useToggleAiReply,
  useGroupList,
} from '@/hooks/useMonitoring';

export default function Hosting() {
  // 数据 hooks
  const { data: blacklist, isLoading: isLoadingBlacklist } = useBlacklist();
  const { data: groupList, isLoading: isLoadingGroups } = useGroupList();
  const addToBlacklist = useAddToBlacklist();
  const removeFromBlacklist = useRemoveFromBlacklist();
  const { data: aiStatus } = useAiReplyStatus();
  const toggleAiReply = useToggleAiReply();

  // 计算小组状态（是否在黑名单中）
  const groupsWithStatus = (groupList || []).map((group) => ({
    ...group,
    isBlacklisted: (blacklist?.groupIds || []).includes(group.id),
  }));

  return (
    <div id="page-hosting" className="page-section active">
      {/* 页面标题 */}
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ margin: 0, color: 'var(--text-primary)' }}>账号托管管理</h2>
        <p style={{ margin: '8px 0 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
          管理 Bot 的账号托管配置，控制 AI 自动回复的全局开关和小组级别过滤
        </p>
      </div>

      {/* 全局 AI 开关 */}
      <section className="section" style={{ marginBottom: '24px' }}>
        <div className="section-header">
          <h3 style={{ margin: 0 }}>全局 AI 托管开关</h3>
          <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
            控制 Bot 是否响应所有用户消息，关闭后所有消息都不会触发 AI 回复
          </p>
        </div>
        <div
          style={{
            marginTop: '16px',
            padding: '16px',
            background: 'var(--bg-secondary)',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                background: aiStatus?.enabled ? 'var(--success-soft)' : 'var(--danger-soft)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '20px',
              }}
            >
              {aiStatus?.enabled ? '🤖' : '🔇'}
            </div>
            <div>
              <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                智能回复 {aiStatus?.enabled ? '已启用' : '已禁用'}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                {aiStatus?.enabled
                  ? '所有用户消息将触发 AI 自动回复'
                  : '所有用户消息将被忽略，不触发 AI 回复'}
              </div>
            </div>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={aiStatus?.enabled ?? false}
              onChange={(e) => toggleAiReply.mutate(e.target.checked)}
              disabled={toggleAiReply.isPending}
            />
            <span className={`status-text ${aiStatus?.enabled ? 'enabled' : 'disabled'}`}>
              {aiStatus?.enabled ? '开启' : '关闭'}
            </span>
          </label>
        </div>
      </section>

      {/* 小组托管管理 */}
      <section className="section">
        <div className="section-header">
          <h3 style={{ margin: 0 }}>
            小组托管状态{' '}
            <span style={{ fontSize: '14px', color: 'var(--text-secondary)', fontWeight: 'normal' }}>
              ({groupsWithStatus.length} 个小组，{blacklist?.groupIds?.length || 0} 个已屏蔽)
            </span>
          </h3>
          <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
            关闭托管后，该小组的消息不会触发 AI 回复，但仍会记录聊天历史
          </p>
        </div>

        <div className="table-wrapper" style={{ marginTop: '16px' }}>
          <table>
            <thead>
              <tr>
                <th>小组名称</th>
                <th>描述</th>
                <th>托管状态</th>
              </tr>
            </thead>
            <tbody>
              {isLoadingGroups || isLoadingBlacklist ? (
                <tr>
                  <td colSpan={3} className="loading">
                    加载中...
                  </td>
                </tr>
              ) : groupsWithStatus.length === 0 ? (
                <tr>
                  <td colSpan={3} className="loading">
                    暂无小组数据
                  </td>
                </tr>
              ) : (
                groupsWithStatus.map((group) => (
                  <tr key={group.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{group.name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                        {group.id}
                      </div>
                    </td>
                    <td style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {group.description || '-'}
                    </td>
                    <td>
                      <label className="toggle-switch" style={{ margin: 0 }}>
                        <input
                          type="checkbox"
                          checked={!group.isBlacklisted}
                          onChange={(e) => {
                            if (e.target.checked) {
                              // 启用托管 = 从黑名单移除
                              removeFromBlacklist.mutate({ id: group.id, type: 'groupId' });
                            } else {
                              // 禁用托管 = 添加到黑名单
                              addToBlacklist.mutate({ id: group.id, type: 'groupId' });
                            }
                          }}
                          disabled={addToBlacklist.isPending || removeFromBlacklist.isPending}
                        />
                        <span
                          className={`status-text ${!group.isBlacklisted ? 'enabled' : 'disabled'}`}
                          style={{ fontSize: '11px' }}
                        >
                          {group.isBlacklisted ? '已屏蔽' : '托管中'}
                        </span>
                      </label>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 说明卡片 */}
      <section className="section" style={{ marginTop: '24px' }}>
        <div
          style={{
            padding: '16px',
            background: 'var(--bg-secondary)',
            borderRadius: '8px',
            border: '1px solid var(--border)',
          }}
        >
          <h4 style={{ margin: '0 0 12px 0', color: 'var(--text-primary)', fontSize: '14px' }}>
            托管配置层级说明
          </h4>
          <ul
            style={{
              margin: 0,
              paddingLeft: '20px',
              fontSize: '12px',
              color: 'var(--text-secondary)',
              lineHeight: 1.8,
            }}
          >
            <li>
              <strong>全局级别</strong>（本页面）：全局 AI 开关控制整个 Bot 的托管状态，关闭后所有消息都不会触发回复
            </li>
            <li>
              <strong>小组级别</strong>（本页面）：小组黑名单控制特定小组的托管状态，黑名单中的小组消息不触发回复
            </li>
            <li>
              <strong>用户级别</strong>（今日咨询页面）：可在「今日咨询」页面暂停单个用户的托管，精细控制个别用户
            </li>
          </ul>
          <div
            style={{
              marginTop: '12px',
              padding: '10px 12px',
              background: 'var(--primary-soft)',
              borderRadius: '6px',
              fontSize: '12px',
              color: 'var(--primary)',
            }}
          >
            💡 优先级：全局开关 &gt; 小组黑名单 &gt; 用户托管状态
          </div>
        </div>
      </section>
    </div>
  );
}
