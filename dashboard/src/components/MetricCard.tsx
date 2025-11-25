import clsx from 'clsx';
import { ReactNode } from 'react';

interface MetricCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  delta?: number;
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger';
  icon?: ReactNode;
  badge?: string;
}

export default function MetricCard({
  label,
  value,
  subtitle,
  delta,
  variant = 'default',
  icon,
  badge,
}: MetricCardProps) {
  return (
    <article className={clsx('stat-card', variant)}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div
            className="text-sm font-medium"
            style={{ color: 'var(--text-secondary)' }}
          >
            {label}
            {badge && (
              <span
                className="ml-2 text-xs badge primary"
              >
                {badge}
              </span>
            )}
          </div>
          <div
            className="mt-2 text-3xl font-bold"
            style={{ color: 'var(--text-primary)' }}
          >
            {value}
          </div>
          {subtitle && (
            <div
              className="mt-1 text-sm"
              style={{ color: 'var(--text-muted)' }}
            >
              {subtitle}
            </div>
          )}
          {delta !== undefined && (
            <div
              className={clsx(
                'delta-indicator mt-2',
                delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'neutral'
              )}
            >
              {delta > 0 ? '↑' : delta < 0 ? '↓' : '→'}
              {Math.abs(delta).toFixed(1)}%
            </div>
          )}
        </div>
        {icon && (
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center text-lg"
            style={{
              background: 'var(--primary-soft)',
              color: 'var(--primary)',
            }}
          >
            {icon}
          </div>
        )}
      </div>
    </article>
  );
}
