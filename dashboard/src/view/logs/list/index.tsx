import { useState } from 'react';
import { useDashboard, useMetrics } from '@/hooks/useMonitoring';
import ControlPanel from './components/ControlPanel';
import LogsTable from './components/LogsTable';
import MessageDetailDrawer from './components/MessageDetailDrawer';
import type { MessageRecord } from '@/types/monitoring';

export default function Logs() {
  const [timeRange] = useState<'today' | 'week' | 'month'>('today');
  const { data: dashboard, isLoading } = useDashboard(timeRange);
  const { data: metrics } = useMetrics();
  const [selectedMessage, setSelectedMessage] = useState<MessageRecord | null>(null);
  const [activeTab, setActiveTab] = useState<'realtime' | 'slowest'>('realtime');

  const messages = dashboard?.recentMessages || [];
  const slowestRecords = metrics?.slowestRecords || [];

  // 计算统计数据
  const stats = {
    total: messages.length,
    success: messages.filter((m) => m.status === 'success').length,
    failed: messages.filter((m) => m.status === 'failure' || m.status === 'failed').length,
    avgDuration:
      messages.length > 0
        ? Math.round(messages.reduce((sum, m) => sum + (m.aiDuration || 0), 0) / messages.length)
        : 0,
  };

  return (
    <div id="page-logs" className="page-section active">
      <ControlPanel
        stats={stats}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        realtimeCount={messages.length}
      />

      <LogsTable
        data={activeTab === 'realtime' ? messages : (slowestRecords as MessageRecord[])}
        loading={isLoading}
        onRowClick={setSelectedMessage}
        variant={activeTab}
      />

      {selectedMessage && (
        <MessageDetailDrawer
          message={selectedMessage}
          onClose={() => setSelectedMessage(null)}
        />
      )}
    </div>
  );
}
