import { formatDateTime, formatDuration } from '@/utils/format';
import type { MessageRecord } from '@/types/monitoring';

interface LogsTableProps {
  data: MessageRecord[];
  loading?: boolean;
  onRowClick: (message: MessageRecord) => void;
  variant: 'realtime' | 'slowest';
}

export default function LogsTable({ data, loading, onRowClick, variant }: LogsTableProps) {
  if (loading) {
    return (
      <section className="section" style={{ display: variant === 'slowest' ? 'none' : 'block' }}>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>用户</th>
                <th>用户消息</th>
                <th>回复预览</th>
                <th>回复条数</th>
                <th>Token</th>
                <th>{variant === 'slowest' ? '首条响应 ↓' : '首条响应'}</th>
                <th>总耗时</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={9} className="loading">
                  加载中...
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  if (data.length === 0) {
    return (
      <section className="section" style={{ display: variant === 'slowest' ? 'none' : 'block' }}>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>用户</th>
                <th>用户消息</th>
                <th>回复预览</th>
                <th>回复条数</th>
                <th>Token</th>
                <th>{variant === 'slowest' ? '首条响应 ↓' : '首条响应'}</th>
                <th>总耗时</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={9} className="loading">
                  暂无数据
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  return (
    <section className="section" style={{ display: variant === 'slowest' ? 'none' : 'block' }}>
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>用户</th>
              <th>用户消息</th>
              <th>回复预览</th>
              <th>回复条数</th>
              <th>Token</th>
              <th>{variant === 'slowest' ? '首条响应 ↓' : '首条响应'}</th>
              <th>总耗时</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {data.map((record, i) => (
              <tr
                key={record.messageId || i}
                onClick={() => onRowClick(record)}
                style={{ cursor: 'pointer' }}
                className="clickable-row"
              >
                <td>{formatDateTime(record.receivedAt)}</td>
                <td>{record.userName || record.chatId}</td>
                <td
                  style={{
                    maxWidth: '180px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {record.messagePreview || '-'}
                </td>
                <td
                  style={{
                    maxWidth: '200px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {record.replyPreview || '-'}
                </td>
                <td style={{ textAlign: 'center' }}>{record.replySegments ?? '-'}</td>
                <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                  {record.tokenUsage?.toLocaleString() || '-'}
                </td>
                <td style={{ color: variant === 'slowest' ? 'var(--danger)' : undefined, fontWeight: variant === 'slowest' ? 600 : undefined }}>
                  {record.aiDuration !== undefined ? formatDuration(record.aiDuration) : '-'}
                </td>
                <td>{formatDuration(record.totalDuration)}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span
                      className={`status-badge ${
                        record.status === 'success'
                          ? 'success'
                          : record.status === 'failure' || record.status === 'failed'
                          ? 'danger'
                          : 'warning'
                      }`}
                    >
                      {record.status}
                    </span>
                    {record.isFallback && (
                      <span
                        title={record.fallbackSuccess ? '降级成功' : '降级失败'}
                        style={{
                          fontSize: '12px',
                          color: record.fallbackSuccess ? 'var(--warning)' : 'var(--danger)',
                        }}
                      >
                        ⚡
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <style>{`
        .clickable-row:hover {
          background: var(--bg-secondary) !important;
        }
      `}</style>
    </section>
  );
}
