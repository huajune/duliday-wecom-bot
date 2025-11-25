import clsx from 'clsx';

interface HealthCardProps {
  icon: string;
  title: string;
  status: string;
  details: string;
  state: 'healthy' | 'degraded' | 'unhealthy' | 'loading';
}

export default function HealthCard({ icon, title, status, details, state }: HealthCardProps) {
  const statusColors = {
    healthy: 'var(--success)',
    degraded: 'var(--warning)',
    unhealthy: 'var(--danger)',
    loading: 'var(--text-muted)',
  };

  return (
    <article className={clsx('health-card', state)}>
      <div className="flex items-start gap-3">
        <div className="text-2xl">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            {title}
          </div>
          <div
            className="text-lg font-semibold"
            style={{ color: statusColors[state] }}
          >
            {status || '-'}
          </div>
          <div
            className="text-xs truncate"
            style={{ color: 'var(--text-muted)' }}
          >
            {details || '检查中...'}
          </div>
        </div>
      </div>
    </article>
  );
}
