import clsx from 'clsx';

interface StatusBadgeProps {
  status: 'success' | 'warning' | 'danger' | 'info' | 'processing';
  children: React.ReactNode;
}

export default function StatusBadge({ status, children }: StatusBadgeProps) {
  return (
    <span className={clsx('badge', status === 'processing' ? 'info' : status)}>
      {children}
    </span>
  );
}
