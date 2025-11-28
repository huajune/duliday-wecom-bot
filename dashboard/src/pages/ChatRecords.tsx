import { useState, useMemo } from 'react';
import {
  useChatSessions,
  useChatSessionMessages,
  type ChatSession,
  type ChatMessage,
} from '@/hooks/useMonitoring';
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
import { Line } from 'react-chartjs-2';

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

// 格式化时间戳
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// 格式化日期（用于分组）
function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return '今天';
  } else if (date.toDateString() === yesterday.toDateString()) {
    return '昨天';
  }
  return date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
}

// 客户类型标签映射
const CONTACT_TYPE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  PERSONAL_WECHAT: { label: '个微', color: '#16a34a', bg: 'rgba(22, 163, 74, 0.1)' },
  ENTERPRISE_WECHAT: { label: '企微', color: '#2563eb', bg: 'rgba(37, 99, 235, 0.1)' },
  OFFICIAL_ACCOUNT: { label: '公众号', color: '#9333ea', bg: 'rgba(147, 51, 234, 0.1)' },
  UNKNOWN: { label: '', color: '#6b7280', bg: 'rgba(107, 114, 128, 0.1)' },
};

// 消息类型图标
function getMessageTypeIcon(messageType?: string): string {
  const icons: Record<string, string> = {
    IMAGE: '🖼️',
    VOICE: '🎤',
    VIDEO: '🎬',
    FILE: '📎',
    LINK: '🔗',
    LOCATION: '📍',
    EMOTION: '😊',
    MINI_PROGRAM: '📱',
  };
  return messageType ? icons[messageType] || '' : '';
}

export default function ChatRecords() {
  // 数据分析面板展开状态
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
    30, // 默认30天
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

  // 过滤会话（搜索）
  const filteredSessions = sessions.filter((session: ChatSession) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      session.chatId.toLowerCase().includes(term) ||
      session.candidateName?.toLowerCase().includes(term) ||
      session.managerName?.toLowerCase().includes(term)
    );
  });

  // 按日期分组消息
  const groupedMessages: { date: string; messages: ChatMessage[] }[] = [];
  let currentDate = '';
  messages.forEach((msg: ChatMessage) => {
    const msgDate = formatDate(msg.timestamp);
    if (msgDate !== currentDate) {
      currentDate = msgDate;
      groupedMessages.push({ date: msgDate, messages: [] });
    }
    groupedMessages[groupedMessages.length - 1].messages.push(msg);
  });

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

  // Chart.js 配置 - 隐藏自带图例
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false, // 关闭 Chart.js 自带图例
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

  return (
    <div className="page-section active" style={{ paddingBottom: '40px' }}>
      {/* 统一操作栏：时间筛选 + 统计 + 数据分析按钮 */}
      <div
        className="glass-panel chat-header-bar"
        style={{
          padding: '18px 28px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(249,250,251,0.9) 100%)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* 装饰性背景 */}
        <div
          style={{
            position: 'absolute',
            top: '-50%',
            right: '-5%',
            width: '300px',
            height: '300px',
            background: 'radial-gradient(circle, rgba(99, 102, 241, 0.06) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />

        {/* 左侧：标题 + 时间筛选 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px', position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>
              聊天记录
            </h2>
          </div>

          <div
            style={{
              width: '1px',
              height: '28px',
              background: 'linear-gradient(180deg, transparent, var(--border), transparent)',
            }}
          />

          <div className="filters" style={{ gap: '6px' }}>
            {TIME_RANGE_OPTIONS.map((option, index) => (
              <button
                key={option.value}
                className={timeRangeIndex === index ? 'active' : ''}
                onClick={() => {
                  setTimeRangeIndex(index);
                  setSelectedChatId(null);
                }}
                style={{
                  padding: '8px 16px',
                  fontSize: '13px',
                  fontWeight: timeRangeIndex === index ? 600 : 500,
                  letterSpacing: '0.02em',
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* 右侧：统计卡片 + 数据分析按钮 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px', position: 'relative', zIndex: 1 }}>
          {/* 统计卡片组 - 精致卡片风格 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '10px 16px',
              background: 'rgba(255, 255, 255, 0.7)',
              borderRadius: '14px',
              border: '1px solid rgba(0, 0, 0, 0.04)',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.02)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 12px',
                background: 'rgba(99, 102, 241, 0.06)',
                borderRadius: '10px',
              }}
            >
              <span style={{ fontSize: '16px' }}>💭</span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>会话</span>
              <span
                style={{
                  fontSize: '16px',
                  fontWeight: 800,
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                {sessionStats.totalSessions}
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 12px',
                background: 'rgba(16, 185, 129, 0.06)',
                borderRadius: '10px',
              }}
            >
              <span style={{ fontSize: '16px' }}>✉️</span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>消息</span>
              <span style={{ fontSize: '16px', fontWeight: 800, color: 'var(--success)' }}>
                {sessionStats.totalMessages}
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 12px',
                background: 'rgba(245, 158, 11, 0.06)',
                borderRadius: '10px',
              }}
            >
              <span style={{ fontSize: '16px' }}>🔥</span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>活跃</span>
              <span style={{ fontSize: '16px', fontWeight: 800, color: 'var(--warning)' }}>
                {sessionStats.activeSessions}
              </span>
            </div>
          </div>

          {/* 数据分析按钮 - 更精致的样式 */}
          <button
            onClick={() => setShowAnalytics(!showAnalytics)}
            style={{
              padding: '10px 18px',
              fontSize: '13px',
              fontWeight: 600,
              color: showAnalytics ? '#fff' : 'var(--primary)',
              background: showAnalytics
                ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'
                : 'linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(139, 92, 246, 0.1) 100%)',
              border: showAnalytics ? 'none' : '1px solid rgba(99, 102, 241, 0.2)',
              borderRadius: '12px',
              cursor: 'pointer',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: showAnalytics
                ? '0 6px 20px rgba(99, 102, 241, 0.35)'
                : '0 2px 8px rgba(99, 102, 241, 0.08)',
              letterSpacing: '0.02em',
            }}
            onMouseEnter={(e) => {
              if (!showAnalytics) {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(139, 92, 246, 0.15) 100%)';
                e.currentTarget.style.transform = 'translateY(-1px)';
              }
            }}
            onMouseLeave={(e) => {
              if (!showAnalytics) {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(139, 92, 246, 0.1) 100%)';
                e.currentTarget.style.transform = 'translateY(0)';
              }
            }}
          >
            消息趋势
            <span
              style={{
                fontSize: '10px',
                transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                transform: showAnalytics ? 'rotate(180deg)' : 'rotate(0deg)',
                opacity: 0.7,
              }}
            >
              ▼
            </span>
          </button>
        </div>
      </div>

      {/* 可展开的数据分析面板 */}
      <div
        style={{
          maxHeight: showAnalytics ? '600px' : '0',
          overflow: 'hidden',
          transition: 'all 0.4s ease-in-out',
          marginBottom: showAnalytics ? '20px' : '0',
        }}
      >
        <div className="glass-panel" style={{ padding: '20px 24px' }}>
          {/* 分析面板头部 */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '20px',
            }}
          >
            {/* 左侧：月度选择器 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                消息趋势
              </span>
              <div className="filters">
                {ANALYTICS_MONTH_OPTIONS.map((option, index) => (
                  <button
                    key={option.value}
                    className={analyticsMonthIndex === index ? 'active' : ''}
                    onClick={() => setAnalyticsMonthIndex(index)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 右侧：统计 + 图例 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '13px' }}>
                <span>
                  <span style={{ color: 'var(--text-muted)' }}>会话 </span>
                  <span style={{ fontWeight: 700, color: 'var(--primary)' }}>
                    {analyticsStats.totalSessions}
                  </span>
                </span>
                <span>
                  <span style={{ color: 'var(--text-muted)' }}>消息 </span>
                  <span style={{ fontWeight: 700, color: 'var(--success)' }}>
                    {analyticsStats.totalMessages}
                  </span>
                </span>
              </div>
              <div style={{ width: '1px', height: '20px', background: 'var(--border)' }} />
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  fontSize: '12px',
                  color: 'var(--text-muted)',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: '#6366f1',
                    }}
                  />
                  消息数
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: '#10b981',
                    }}
                  />
                  活跃会话
                </span>
              </div>
            </div>
          </div>

          {/* 图表 */}
          <div style={{ height: '320px' }}>
            {dailyTrendData ? (
              <Line data={dailyTrendData} options={chartOptions} />
            ) : (
              <div
                style={{
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)',
                }}
              >
                {analyticsLoading ? <div className="loading-spinner"></div> : '暂无趋势数据'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 会话列表主体 */}
      <div className="chat-layout">
        {/* 左侧会话列表 */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="chat-panel-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h3 className="panel-title">会话列表</h3>
              <span
                style={{
                  fontSize: '12px',
                  color: 'var(--text-muted)',
                  background: 'rgba(0,0,0,0.04)',
                  padding: '2px 8px',
                  borderRadius: '10px',
                }}
              >
                {filteredSessions.length}
              </span>
            </div>

            <div className="header-controls-row">
              <div className="search-box-wrapper" style={{ flex: 1 }}>
                <span className="search-box-icon">🔍</span>
                <input
                  className="search-input-refined"
                  type="text"
                  placeholder="搜索候选人..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {sessionsLoading ? (
              <div className="state-container">
                <div className="loading-spinner"></div>
                加载中...
              </div>
            ) : filteredSessions.length === 0 ? (
              <div className="state-container">
                <div style={{ fontSize: '48px', opacity: 0.3, marginBottom: '12px' }}>📭</div>
                <div>{currentRange.label}暂无会话记录</div>
              </div>
            ) : (
              filteredSessions.map((session: ChatSession) => {
                const contactTypeInfo = CONTACT_TYPE_LABELS[session.contactType || 'UNKNOWN'];
                const avatarChar = (session.candidateName || session.chatId || '?')
                  .charAt(0)
                  .toUpperCase();

                return (
                  <div
                    key={session.chatId}
                    className={`session-item-refined ${selectedChatId === session.chatId ? 'active' : ''}`}
                    onClick={() => setSelectedChatId(session.chatId)}
                  >
                    {session.avatar ? (
                      <img
                        src={session.avatar}
                        alt={session.candidateName || '头像'}
                        className="chat-avatar"
                        style={{ objectFit: 'cover' }}
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.style.display = 'none';
                          target.nextElementSibling?.classList.remove('hidden');
                        }}
                      />
                    ) : null}
                    <div
                      className={`chat-avatar ${session.avatar ? 'hidden' : ''}`}
                      style={{ display: session.avatar ? 'none' : 'flex' }}
                    >
                      {avatarChar}
                    </div>

                    <div className="session-content">
                      <div className="session-top-row">
                        <div className="session-name-wrapper">
                          <span
                            className="candidate-name"
                            title={session.candidateName || '未知候选人'}
                          >
                            {session.candidateName || '未知候选人'}
                          </span>
                          {contactTypeInfo.label && (
                            <span
                              className="contact-type-badge"
                              style={{
                                color: contactTypeInfo.color,
                                background: contactTypeInfo.bg,
                              }}
                            >
                              {contactTypeInfo.label}
                            </span>
                          )}
                          {session.managerName && (
                            <span className="manager-badge">@{session.managerName}</span>
                          )}
                        </div>
                        <span className="session-time">
                          {session.lastTimestamp
                            ? formatTime(session.lastTimestamp).split(' ')[1]
                            : '-'}
                        </span>
                      </div>

                      <div className="session-bottom-row">
                        <span className="session-preview">{session.lastMessage || '暂无消息'}</span>
                        {session.messageCount > 0 && (
                          <span className="msg-count-badge">{session.messageCount}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* 右侧消息详情 */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column' }}>
          {!selectedChatId ? (
            <div className="state-container">
              <div className="state-icon-large">💬</div>
              <div>选择一个会话查看消息</div>
            </div>
          ) : messagesLoading ? (
            <div className="state-container">
              <div className="loading-spinner"></div>
              加载消息中...
            </div>
          ) : messages.length === 0 ? (
            <div className="state-container">
              <div className="state-icon-large">📭</div>
              <div>该会话暂无消息</div>
            </div>
          ) : (
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
              {groupedMessages.map((group) => (
                <div key={group.date} className="message-group">
                  <div className="message-date-divider">
                    <span className="message-date-badge">{group.date}</span>
                  </div>
                  {group.messages.map((msg: ChatMessage) => {
                    const isAssistant = msg.role === 'assistant';
                    const displayName = isAssistant
                      ? msg.managerName || currentSession?.managerName || '招募经理'
                      : msg.candidateName || currentSession?.candidateName || '候选人';
                    const avatarChar = displayName.charAt(0).toUpperCase();
                    const avatarUrl = !isAssistant
                      ? msg.avatar || currentSession?.avatar
                      : undefined;
                    const messageTypeIcon = getMessageTypeIcon(msg.messageType);

                    return (
                      <div key={msg.id} className={`message-row ${isAssistant ? 'assistant' : ''}`}>
                        {avatarUrl ? (
                          <img
                            src={avatarUrl}
                            alt={displayName}
                            className="chat-avatar"
                            style={{
                              width: '36px',
                              height: '36px',
                              objectFit: 'cover',
                              boxShadow: '0 4px 10px rgba(59, 130, 246, 0.2)',
                            }}
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.style.display = 'none';
                              target.nextElementSibling?.removeAttribute('style');
                            }}
                          />
                        ) : null}
                        <div
                          className="chat-avatar"
                          style={{
                            display: avatarUrl ? 'none' : 'flex',
                            width: '36px',
                            height: '36px',
                            fontSize: '14px',
                            background: isAssistant
                              ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                              : 'linear-gradient(135deg, #60a5fa, #3b82f6)',
                            boxShadow: isAssistant
                              ? '0 4px 10px rgba(245, 158, 11, 0.2)'
                              : '0 4px 10px rgba(59, 130, 246, 0.2)',
                          }}
                        >
                          {avatarChar}
                        </div>
                        <div style={{ maxWidth: '70%' }}>
                          <div className={`message-meta ${isAssistant ? 'assistant' : ''}`}>
                            <span className="message-sender">{displayName}</span>
                            <span className="message-time">{formatTime(msg.timestamp)}</span>
                          </div>
                          <div
                            className={`chat-message-bubble ${isAssistant ? 'assistant' : 'user'}`}
                            style={
                              isAssistant
                                ? {
                                  background:
                                    'linear-gradient(135deg, rgba(254, 243, 199, 0.5), rgba(253, 230, 138, 0.3))',
                                  border: '1px solid rgba(251, 191, 36, 0.2)',
                                  color: '#92400e',
                                }
                                : undefined
                            }
                          >
                            {messageTypeIcon && (
                              <span style={{ marginRight: '4px' }}>{messageTypeIcon}</span>
                            )}
                            {msg.content}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
