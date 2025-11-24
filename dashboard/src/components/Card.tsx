import { ReactNode } from 'react';
import clsx from 'clsx';

interface CardProps {
  children: ReactNode;
  className?: string;
  title?: string;
  action?: ReactNode;
}

export default function Card({ children, className, title, action }: CardProps) {
  return (
    <div className={clsx('card', className)}>
      {(title || action) && (
        <div className="flex items-center justify-between mb-4">
          {title && <h3 className="font-semibold text-gray-900">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  trend?: {
    value: number;
    label: string;
  };
  icon?: ReactNode;
  className?: string;
}

export function StatCard({ label, value, trend, icon, className }: StatCardProps) {
  return (
    <div className={clsx('stat-card', className)}>
      <div className="flex items-start justify-between">
        <div>
          <div className="stat-value">{value}</div>
          <div className="stat-label">{label}</div>
        </div>
        {icon && (
          <div className="w-10 h-10 rounded-lg bg-primary-soft flex items-center justify-center text-primary">
            {icon}
          </div>
        )}
      </div>
      {trend && (
        <div className={clsx('stat-trend', trend.value >= 0 ? 'up' : 'down')}>
          <span>{trend.value >= 0 ? '↑' : '↓'}</span>
          <span>{Math.abs(trend.value)}%</span>
          <span className="text-gray-400 ml-1">{trend.label}</span>
        </div>
      )}
    </div>
  );
}
