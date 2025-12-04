import { formatDuration } from '@/utils/format';

interface Stats {
  total: number;
  success: number;
  failed: number;
  avgDuration: number;
}

interface ControlPanelProps {
  stats: Stats;
  activeTab: 'realtime' | 'slowest';
  onTabChange: (tab: 'realtime' | 'slowest') => void;
  realtimeCount: number;
  slowestCount: number;
}

export default function ControlPanel({
  stats,
  activeTab,
  onTabChange,
  realtimeCount,
  slowestCount,
}: ControlPanelProps) {
  return (
    <section
      className="control-panel"
      style={{
        marginBottom: '20px',
        padding: '16px 20px',
      }}
    >
      {/* 单行布局：标题 + 统计 + Tab切换 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '24px',
        }}
      >
        {/* 左侧：标题 */}
        <h3
          style={{
            margin: 0,
            fontSize: '15px',
            fontWeight: 600,
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ fontSize: '16px' }}>💬</span>
          消息记录
        </h3>

        {/* 分隔线 */}
        <div style={{ width: '1px', height: '24px', background: 'var(--border)' }} />

        {/* 统计数据 - 紧凑横向排列 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>总计</span>
            <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--primary)' }}>
              {stats.total}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>成功</span>
            <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--success)' }}>
              {stats.success}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>失败</span>
            <span
              style={{
                fontSize: '15px',
                fontWeight: 700,
                color: stats.failed > 0 ? 'var(--danger)' : 'var(--text-muted)',
              }}
            >
              {stats.failed}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>首响</span>
            <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--warning)' }}>
              {formatDuration(stats.avgDuration)}
            </span>
          </div>
        </div>

        {/* 弹性空间 */}
        <div style={{ flex: 1 }} />

        {/* Tab 切换 - 简洁样式 */}
        <div
          style={{
            display: 'flex',
            background: 'var(--bg-secondary)',
            borderRadius: '8px',
            padding: '3px',
          }}
        >
          <button
            onClick={() => onTabChange('realtime')}
            style={{
              padding: '6px 14px',
              background: activeTab === 'realtime' ? '#fff' : 'transparent',
              border: 'none',
              borderRadius: '6px',
              color: activeTab === 'realtime' ? 'var(--primary)' : 'var(--text-muted)',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              boxShadow: activeTab === 'realtime' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}
          >
            实时 {realtimeCount}
          </button>
          <button
            onClick={() => onTabChange('slowest')}
            style={{
              padding: '6px 14px',
              background: activeTab === 'slowest' ? '#fff' : 'transparent',
              border: 'none',
              borderRadius: '6px',
              color: activeTab === 'slowest' ? 'var(--danger)' : 'var(--text-muted)',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              boxShadow: activeTab === 'slowest' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}
          >
            最慢 Top{slowestCount}
          </button>
        </div>
      </div>
    </section>
  );
}
