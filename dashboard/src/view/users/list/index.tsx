import { useState } from 'react';
import { useDashboard, useToggleUserHosting } from '@/hooks/useMonitoring';

// 组件导入
import UserTable from './components/UserTable';

// 样式导入
import styles from './styles/index.module.scss';

export default function Users() {
  const [timeRange] = useState<'today' | 'week' | 'month'>('today');
  const { data: dashboard, isLoading } = useDashboard(timeRange);
  const toggleHosting = useToggleUserHosting();

  const users = dashboard?.todayUsers || [];

  const handleToggleHosting = (chatId: string, enabled: boolean) => {
    toggleHosting.mutate({ chatId, enabled });
  };

  return (
    <div className={styles.page}>
      <UserTable
        users={users}
        isLoading={isLoading}
        onToggleHosting={handleToggleHosting}
      />
    </div>
  );
}
