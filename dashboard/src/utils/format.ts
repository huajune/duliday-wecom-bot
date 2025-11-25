// 格式化时间（只显示时间）
export function formatTime(timestamp: string | number): string {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// 格式化完整日期时间 (YYYY/MM/DD HH:mm:ss)
export function formatDateTime(timestamp: string | number): string {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
}

// 格式化时长 (毫秒 -> 秒) - 与 monitoring.html 一致
export function formatDuration(ms: number, fractionDigits = 2): string {
  if (ms === undefined || ms === null) return '-';
  if (ms === 0) return '0 秒';
  const seconds = ms / 1000;
  return `${seconds.toFixed(fractionDigits)} 秒`;
}

// 格式化分钟标签
export function formatMinuteLabel(minute: string): string {
  if (!minute) return '';
  // "2025-11-24T09:30:00" -> "09:30"
  const date = new Date(minute);
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

// 格式化日期标签 - 与 monitoring.html 一致
export function formatDayLabel(value: string): string {
  if (!value) return '-';
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}-${day}`;
}

// 格式化数字 (1000 -> 1k)
export function formatNumber(num: number): string {
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}k`;
  }
  return num.toString();
}
