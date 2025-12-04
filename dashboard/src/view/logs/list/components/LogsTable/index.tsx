import { formatDateTime, formatDuration } from '@/utils/format';
import type { MessageRecord } from '@/types/monitoring';
import styles from './index.module.scss';

interface LogsTableProps {
  data: MessageRecord[];
  loading?: boolean;
  onRowClick: (message: MessageRecord) => void;
  variant: 'realtime' | 'slowest';
}

export default function LogsTable({ data, loading, onRowClick, variant }: LogsTableProps) {
  const tableHeaders = (
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
  );

  if (loading) {
    return (
      <section className="section">
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>{tableHeaders}</thead>
            <tbody>
              <tr>
                <td colSpan={9} className={styles.loading}>
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
      <section className="section">
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>{tableHeaders}</thead>
            <tbody>
              <tr>
                <td colSpan={9} className={styles.loading}>
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
    <section className="section">
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>{tableHeaders}</thead>
          <tbody>
            {data.map((record, i) => (
              <tr
                key={record.messageId || i}
                onClick={() => onRowClick(record)}
                className={styles.clickableRow}
              >
                <td>{formatDateTime(record.receivedAt)}</td>
                <td>{record.userName || record.chatId}</td>
                <td className={styles.cellTruncate}>
                  {record.messagePreview || '-'}
                </td>
                <td className={styles.cellTruncateLarge}>
                  {record.replyPreview || '-'}
                </td>
                <td className={styles.cellCenter}>{record.replySegments ?? '-'}</td>
                <td className={styles.cellMono}>
                  {record.tokenUsage?.toLocaleString() || '-'}
                </td>
                <td className={variant === 'slowest' ? styles.cellHighlight : undefined}>
                  {record.aiDuration !== undefined ? formatDuration(record.aiDuration) : '-'}
                </td>
                <td>{formatDuration(record.totalDuration)}</td>
                <td>
                  <div className={styles.statusCell}>
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
                        className={`${styles.fallbackIcon} ${record.fallbackSuccess ? styles.success : styles.failed}`}
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
    </section>
  );
}
