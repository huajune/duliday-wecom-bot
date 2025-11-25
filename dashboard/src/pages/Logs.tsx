import { useState } from 'react';
import { useDashboard } from '@/hooks/useMonitoring';
import { formatTime, formatDuration } from '@/utils/format';

export default function Logs() {
  const [timeRange] = useState<'today' | 'week' | 'month'>('today');
  const { data: dashboard, isLoading } = useDashboard(timeRange);

  const messages = dashboard?.recentMessages || [];

  return (
    <div id="page-logs" className="page-section active">
      {/* 实时消息 */}
      <section className="section">
        <div className="section-header">
          <h3>
            实时消息{' '}
            <span style={{ fontSize: '14px', color: 'var(--text-secondary)', fontWeight: 'normal' }}>
              ({messages.length} 条)
            </span>
          </h3>
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>用户</th>
                <th>用户消息</th>
                <th>回复预览</th>
                <th>总耗时</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="loading">
                    加载中
                  </td>
                </tr>
              ) : messages.length === 0 ? (
                <tr>
                  <td colSpan={6} className="loading">
                    暂无数据
                  </td>
                </tr>
              ) : (
                messages.map((msg, i) => (
                  <tr key={i}>
                    <td>{formatTime(msg.receivedAt)}</td>
                    <td>{msg.userName || msg.chatId}</td>
                    <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {msg.messagePreview || '-'}
                    </td>
                    <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {msg.replyPreview || '-'}
                    </td>
                    <td>{formatDuration(msg.totalDuration)}</td>
                    <td>
                      <span className={`status-badge ${msg.status === 'success' ? 'success' : msg.status === 'failure' ? 'danger' : 'warning'}`}>
                        {msg.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
