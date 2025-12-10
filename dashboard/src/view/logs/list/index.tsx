import { useState, useMemo } from 'react';
import { useMessageProcessingRecords } from '@/hooks/useMonitoring';
import ControlPanel from './components/ControlPanel';
import LogsTable from './components/LogsTable';
import MessageDetailDrawer from './components/MessageDetailDrawer';
import type { MessageRecord } from '@/types/monitoring';

export default function Logs() {
  const [timeRange, setTimeRange] = useState<'today' | 'week' | 'month'>('today');
  const [selectedMessage, setSelectedMessage] = useState<MessageRecord | null>(null);
  const [activeTab, setActiveTab] = useState<'realtime' | 'slowest'>('realtime');

  // 计算时间范围
  const dateRange = useMemo(() => {
    const now = new Date();
    const endDate = now.toISOString().split('T')[0];
    let startDate: string;

    if (timeRange === 'today') {
      startDate = endDate;
    } else if (timeRange === 'week') {
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      startDate = weekAgo.toISOString().split('T')[0];
    } else {
      const monthAgo = new Date(now);
      monthAgo.setDate(monthAgo.getDate() - 30);
      startDate = monthAgo.toISOString().split('T')[0];
    }

    return { startDate, endDate };
  }, [timeRange]);

  // 统一使用持久化数据（数据库）
  const { data: persistedMessages, isLoading } = useMessageProcessingRecords({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    limit: 1000,
  });

  const allMessages = persistedMessages || [];

  // 根据 Tab 类型计算不同的视图
  const messages = useMemo(() => {
    if (activeTab === 'realtime') {
      // 实时：按接收时间倒序（最新的在前）
      return [...allMessages].sort((a, b) => {
        const timeA = new Date(a.receivedAt || 0).getTime();
        const timeB = new Date(b.receivedAt || 0).getTime();
        return timeB - timeA;
      });
    } else {
      // 最慢 Top10：按 AI 处理耗时降序（最慢的在前），取前 10 条
      return [...allMessages]
        .filter((m) => m.aiDuration && m.aiDuration > 0)
        .sort((a, b) => (b.aiDuration || 0) - (a.aiDuration || 0))
        .slice(0, 10);
    }
  }, [allMessages, activeTab]);

  // 计算统计数据（基于所有消息）
  const stats = useMemo(() => {
    return {
      total: allMessages.length,
      success: allMessages.filter((m) => m.status === 'success').length,
      failed: allMessages.filter((m) => m.status === 'failure' || m.status === 'failed').length,
      avgDuration:
        allMessages.length > 0
          ? Math.round(allMessages.reduce((sum, m) => sum + (m.aiDuration || 0), 0) / allMessages.length)
          : 0,
    };
  }, [allMessages]);

  // 计算两个 Tab 的数据量
  const realtimeCount = allMessages.length;
  const slowestCount = allMessages.filter((m) => m.aiDuration && m.aiDuration > 0).length >= 10
    ? 10
    : allMessages.filter((m) => m.aiDuration && m.aiDuration > 0).length;

  return (
    <div id="page-logs" className="page-section active">
      <ControlPanel
        stats={stats}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        realtimeCount={realtimeCount}
        slowestCount={slowestCount}
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
      />

      <LogsTable
        data={messages}
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

