/**
 * ChatTester 组件常量
 */

// 错误类型选项（value 直接用中文，提交到飞书时显示中文）
export const ERROR_TYPE_OPTIONS = [
  { value: '', label: '请选择...' },
  { value: '回答错误', label: '回答错误' },
  { value: '回答不完整', label: '回答不完整' },
  { value: '幻觉/编造信息', label: '幻觉/编造信息' },
  { value: '工具调用错误', label: '工具调用错误' },
  { value: '格式问题', label: '格式问题' },
  { value: '语气/态度问题', label: '语气/态度问题' },
  { value: '其他', label: '其他' },
] as const;

// 历史记录示例格式
export const HISTORY_PLACEHOLDER = `粘贴对话记录，格式如：
[12/04 14:23 候选人] 你好
[12/04 14:24 招募经理] 你好，有什么可以帮您？`;

// API 配置
export const CHAT_API_ENDPOINT = '/agent/test/chat/ai-stream';
export const DEFAULT_SCENARIO = 'candidate-consultation';
