import { useState, useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import {
  useChatSessions,
  useChatSessionMessages,
  type ChatSession,
} from '@/hooks/useMonitoring';

// 组件导入
import HeaderBar from './components/HeaderBar';
import AnalyticsPanel from './components/AnalyticsPanel';
import SessionList from './components/SessionList';
import MessageDetail from './components/MessageDetail';

// 样式导入
import styles from './styles/index.module.scss';

// 注册 Chart.js 组件
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
);

// 会话列表时间范围选项配置
const TIME_RANGE_OPTIONS = [
  { value: 0, label: '今天', days: 0 },
  { value: 1, label: '近 3 天', days: 3 },
  { value: 2, label: '近 7 天', days: 7 },
  { value: 3, label: '近 30 天', days: 30 },
];

// 数据分析月度选项配置
const ANALYTICS_MONTH_OPTIONS = [
  { value: 0, label: '近 1 月', monthOffset: 0 },
  { value: 1, label: '上个月', monthOffset: 1 },
  { value: 2, label: '上上月', monthOffset: 2 },
];

// 获取月度日期范围
function getMonthDateRange(monthOffset: number): { startDate: string; endDate: string } {
  const now = new Date();

  if (monthOffset === 0) {
    // 近1月：过去30天
    const endDate = getDateString(now);
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 29);
    return { startDate: getDateString(startDate), endDate };
  }

  // 上个月、上上月：完整月份
  const targetMonth = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
  const startDate = getDateString(targetMonth);
  const lastDay = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0);
  const endDate = getDateString(lastDay);

  return { startDate, endDate };
}

// 获取日期字符串 (YYYY-MM-DD)
function getDateString(date: Date): string {
  return date.toISOString().split('T')[0];
}

// 计算时间范围
function getDateRange(days: number): { startDate: string; endDate: string } {
  const now = new Date();
  const endDate = getDateString(now);

  if (days === 0) {
    return { startDate: endDate, endDate };
  }

  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - days + 1);
  return { startDate: getDateString(startDate), endDate };
}

export default function ChatRecords() {
  // 状态
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [timeRangeIndex, setTimeRangeIndex] = useState<number>(0);
  const [analyticsMonthIndex, setAnalyticsMonthIndex] = useState<number>(0);

  // 根据时间范围获取会话列表数据
  const currentRange = TIME_RANGE_OPTIONS[timeRangeIndex];
  const { startDate, endDate } = getDateRange(currentRange.days);
  const apiDays = currentRange.days === 0 ? 1 : currentRange.days;

  // 根据月度选项获取数据分析数据
  const currentMonthOption = ANALYTICS_MONTH_OPTIONS[analyticsMonthIndex];
  const { startDate: analyticsStartDate, endDate: analyticsEndDate } = getMonthDateRange(
    currentMonthOption.monthOffset,
  );

  // API 请求 - 会话列表
  const { data: sessionsData, isLoading: sessionsLoading } = useChatSessions(
    apiDays,
    startDate,
    endDate,
  );

  // API 请求 - 数据分析（独立的月度数据）
  const { data: analyticsSessionsData, isLoading: analyticsLoading } = useChatSessions(
    30,
    analyticsStartDate,
    analyticsEndDate,
  );
  const { data: messagesData, isLoading: messagesLoading } = useChatSessionMessages(selectedChatId);

  const sessions = sessionsData?.sessions || [];
  const analyticsSessions = analyticsSessionsData?.sessions || [];
  const messages = messagesData?.messages || [];

  // 获取当前选中的会话详情
  const currentSession = useMemo(
    () => sessions.find((s) => s.chatId === selectedChatId),
    [sessions, selectedChatId],
  );

  // 计算会话列表统计数据
  const sessionStats = useMemo(() => {
    return {
      totalSessions: sessions.length,
      totalMessages: sessions.reduce((acc: number, s: ChatSession) => acc + s.messageCount, 0),
      activeSessions: sessions.filter((s: ChatSession) => {
        const lastTime = s.lastTimestamp || 0;
        const hourAgo = Date.now() - 60 * 60 * 1000;
        return lastTime > hourAgo;
      }).length,
    };
  }, [sessions]);

  // 计算数据分析统计数据
  const analyticsStats = useMemo(() => {
    return {
      totalSessions: analyticsSessions.length,
      totalMessages: analyticsSessions.reduce(
        (acc: number, s: ChatSession) => acc + s.messageCount,
        0,
      ),
    };
  }, [analyticsSessions]);

  // 基于分析数据计算按天的趋势图数据
  const dailyTrendData = useMemo(() => {
    if (analyticsSessions.length === 0) return null;

    // 按日期分组汇总
    const dailyMap = new Map<string, { messages: number; sessions: number }>();

    analyticsSessions.forEach((session: ChatSession) => {
      if (!session.lastTimestamp) return;
      const date = new Date(session.lastTimestamp);
      const dateKey = date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
      if (!dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, { messages: 0, sessions: 0 });
      }
      const day = dailyMap.get(dateKey)!;
      day.messages += session.messageCount;
      day.sessions += 1;
    });

    // 按日期排序
    const dailyArray = Array.from(dailyMap.entries())
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => {
        const [aMonth, aDay] = a.date.split('/').map(Number);
        const [bMonth, bDay] = b.date.split('/').map(Number);
        if (aMonth !== bMonth) return aMonth - bMonth;
        return aDay - bDay;
      });

    if (dailyArray.length === 0) return null;

    return {
      labels: dailyArray.map((d) => d.date),
      datasets: [
        {
          label: '消息数',
          data: dailyArray.map((d) => d.messages),
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99, 102, 241, 0.1)',
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#6366f1',
        },
        {
          label: '活跃会话',
          data: dailyArray.map((d) => d.sessions),
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#10b981',
        },
      ],
    };
  }, [analyticsSessions]);

  // Chart.js 配置
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        mode: 'index' as const,
        intersect: false,
        backgroundColor: 'rgba(255, 255, 255, 0.98)',
        titleColor: '#1f2937',
        bodyColor: '#4b5563',
        borderColor: '#e5e7eb',
        borderWidth: 1,
        padding: 12,
        boxPadding: 6,
        cornerRadius: 8,
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { font: { size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
      },
      y: {
        grid: { color: 'rgba(0,0,0,0.04)' },
        beginAtZero: true,
        ticks: { font: { size: 11 } },
      },
    },
    interaction: {
      mode: 'nearest' as const,
      axis: 'x' as const,
      intersect: false,
    },
  };

  const handleTimeRangeChange = (index: number) => {
    setTimeRangeIndex(index);
    setSelectedChatId(null);
  };

  return (
    <div className={styles.page}>
      {/* 统一操作栏 */}
      <HeaderBar
        timeRangeOptions={TIME_RANGE_OPTIONS}
        timeRangeIndex={timeRangeIndex}
        onTimeRangeChange={handleTimeRangeChange}
        sessionStats={sessionStats}
        showAnalytics={showAnalytics}
        onToggleAnalytics={() => setShowAnalytics(!showAnalytics)}
      />

      {/* 可展开的数据分析面板 */}
      <AnalyticsPanel
        show={showAnalytics}
        monthOptions={ANALYTICS_MONTH_OPTIONS}
        monthIndex={analyticsMonthIndex}
        onMonthChange={setAnalyticsMonthIndex}
        stats={analyticsStats}
        chartData={dailyTrendData}
        chartOptions={chartOptions}
        isLoading={analyticsLoading}
      />

      {/* 会话列表主体 */}
      <div className={styles.chatLayout}>
        {/* 左侧会话列表 */}
        <SessionList
          sessions={sessions}
          selectedChatId={selectedChatId}
          onSelectChat={setSelectedChatId}
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          isLoading={sessionsLoading}
          timeRangeLabel={currentRange.label}
        />

        {/* 右侧消息详情 */}
        <MessageDetail
          selectedChatId={selectedChatId}
          messages={messages}
          currentSession={currentSession}
          isLoading={messagesLoading}
        />
      </div>
    </div>
  );
}
