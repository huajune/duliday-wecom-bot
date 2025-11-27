import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import toast from 'react-hot-toast';
import type {
  DashboardData,
  MetricsData,
  HealthStatus,
  BlacklistData,
  UserInfo,
  MessageRecord,
  AgentReplyConfig,
  AgentReplyConfigResponse,
  WorkerStatus,
  WorkerConcurrencyResponse,
} from '@/types/monitoring';

const api = axios.create({
  baseURL: '',
  timeout: 10000,
});

// 解包响应数据
function unwrapResponse<T>(payload: unknown): T {
  let current = payload;
  while (current && typeof current === 'object' && 'data' in current) {
    current = (current as { data: unknown }).data;
  }
  return current as T;
}

// Dashboard 数据
export function useDashboard(timeRange: string, autoRefresh = true) {
  return useQuery({
    queryKey: ['dashboard', timeRange],
    queryFn: async () => {
      const { data } = await api.get(`/monitoring/dashboard?range=${timeRange}`);
      return unwrapResponse<DashboardData>(data);
    },
    refetchInterval: autoRefresh ? 5000 : false,
  });
}

// Metrics 数据
export function useMetrics(autoRefresh = true) {
  return useQuery({
    queryKey: ['metrics'],
    queryFn: async () => {
      const { data } = await api.get('/monitoring/metrics');
      return unwrapResponse<MetricsData>(data);
    },
    refetchInterval: autoRefresh ? 5000 : false,
  });
}

// 健康状态
export function useHealthStatus(autoRefresh = true) {
  return useQuery({
    queryKey: ['health-status'],
    queryFn: async () => {
      const { data } = await api.get('/agent/health');
      return unwrapResponse<HealthStatus>(data);
    },
    refetchInterval: autoRefresh ? 10000 : false,
  });
}

// 可用模型列表
export interface AvailableModelsResponse {
  defaultModel: string;
  availableModels: string[];
  count: number;
  defaultModelAvailable: boolean;
  lastRefreshTime: string;
}

export function useAvailableModels() {
  return useQuery({
    queryKey: ['available-models'],
    queryFn: async () => {
      const { data } = await api.get('/agent/available-models');
      return unwrapResponse<AvailableModelsResponse>(data);
    },
    staleTime: 60000, // 1 分钟内不重新请求
  });
}

// 配置的工具列表
export interface ConfiguredToolsResponse {
  configuredTools: string[];
  count: number;
  allAvailable: boolean;
  lastRefreshTime: string;
}

export function useConfiguredTools() {
  return useQuery({
    queryKey: ['configured-tools'],
    queryFn: async () => {
      const { data } = await api.get('/agent/configured-tools');
      return unwrapResponse<ConfiguredToolsResponse>(data);
    },
    staleTime: 60000, // 1 分钟内不重新请求
  });
}

// 品牌配置状态
export interface BrandConfigStatusResponse {
  available: boolean;
  synced: boolean;
  hasBrandData: boolean;
  hasReplyPrompts: boolean;
  lastRefreshTime: string;
  lastUpdated: string;
}

export function useBrandConfigStatus() {
  return useQuery({
    queryKey: ['brand-config-status'],
    queryFn: async () => {
      const { data } = await api.get('/agent/config/status');
      return unwrapResponse<BrandConfigStatusResponse>(data);
    },
    staleTime: 60000, // 1 分钟内不重新请求
  });
}

// AI 回复状态
export function useAiReplyStatus() {
  return useQuery({
    queryKey: ['ai-reply-status'],
    queryFn: async () => {
      const { data } = await api.get('/monitoring/ai-reply-status');
      return unwrapResponse<{ enabled: boolean }>(data);
    },
  });
}

// 切换 AI 回复 - 使用乐观更新让 UI 立即响应
export function useToggleAiReply() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const { data } = await api.post('/monitoring/toggle-ai-reply', { enabled });
      return unwrapResponse<{ enabled: boolean; message: string }>(data);
    },
    onMutate: async (enabled) => {
      // 取消正在进行的查询
      await queryClient.cancelQueries({ queryKey: ['ai-reply-status'] });
      // 保存之前的状态
      const previousStatus = queryClient.getQueryData<{ enabled: boolean }>(['ai-reply-status']);
      // 乐观更新 - 立即更新 UI
      queryClient.setQueryData(['ai-reply-status'], { enabled });
      return { previousStatus, enabled };
    },
    onSuccess: (_data, enabled) => {
      toast.success(enabled ? '智能回复已启用' : '智能回复已禁用');
    },
    onError: (_err, _enabled, context) => {
      // 出错时回滚到之前的状态
      if (context?.previousStatus) {
        queryClient.setQueryData(['ai-reply-status'], context.previousStatus);
      }
      toast.error('操作失败，请重试');
    },
    onSettled: () => {
      // 无论成功失败，最终都重新获取最新状态
      queryClient.invalidateQueries({ queryKey: ['ai-reply-status'] });
    },
  });
}

// 黑名单列表
export function useBlacklist() {
  return useQuery({
    queryKey: ['blacklist'],
    queryFn: async () => {
      const { data } = await api.get('/monitoring/blacklist');
      return unwrapResponse<BlacklistData>(data);
    },
  });
}

// 添加黑名单
export function useAddToBlacklist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { id: string; type: 'chatId' | 'groupId' }) => {
      const { data } = await api.post('/monitoring/blacklist', params);
      return unwrapResponse(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blacklist'] });
      toast.success('已添加到黑名单');
    },
    onError: () => {
      toast.error('添加失败，请重试');
    },
  });
}

// 删除黑名单
export function useRemoveFromBlacklist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { id: string; type: 'chatId' | 'groupId' }) => {
      const { data } = await api.delete('/monitoring/blacklist', { data: params });
      return unwrapResponse(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blacklist'] });
      toast.success('已从黑名单移除');
    },
    onError: () => {
      toast.error('移除失败，请重试');
    },
  });
}

// 用户列表
export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const { data } = await api.get('/monitoring/users');
      return unwrapResponse<UserInfo[]>(data);
    },
    refetchInterval: 10000,
  });
}

// 最近消息
export function useRecentMessages() {
  return useQuery({
    queryKey: ['recent-messages'],
    queryFn: async () => {
      const { data } = await api.get('/monitoring/recent-messages');
      return unwrapResponse<MessageRecord[]>(data);
    },
    refetchInterval: 5000,
  });
}

// 清除缓存
export function useClearCache() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (type: 'metrics' | 'history' | 'agent' | 'all') => {
      const { data } = await api.post(`/monitoring/cache/clear?type=${type}`);
      return unwrapResponse(data);
    },
    onSuccess: (_data, type) => {
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['metrics'] });
      const typeLabels: Record<string, string> = {
        metrics: '指标缓存',
        history: '历史缓存',
        agent: 'Agent 缓存',
        all: '所有缓存',
      };
      toast.success(`${typeLabels[type] || type} 已清除`);
    },
    onError: () => {
      toast.error('清除缓存失败');
    },
  });
}

// 用户托管控制 - 使用乐观更新让 UI 立即响应
export function useToggleUserHosting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ chatId, enabled }: { chatId: string; enabled: boolean }) => {
      const { data } = await api.post(`/monitoring/users/${encodeURIComponent(chatId)}/hosting`, {
        enabled,
      });
      return unwrapResponse(data);
    },
    onMutate: async ({ chatId, enabled }) => {
      // 取消正在进行的查询
      await queryClient.cancelQueries({ queryKey: ['users'] });
      // 保存之前的状态
      const previousUsers = queryClient.getQueryData<UserInfo[]>(['users']);
      // 乐观更新 - 立即更新 UI
      if (previousUsers) {
        queryClient.setQueryData<UserInfo[]>(['users'],
          previousUsers.map(user =>
            user.chatId === chatId ? { ...user, hostingEnabled: enabled } : user
          )
        );
      }
      return { previousUsers };
    },
    onSuccess: (_data, { enabled }) => {
      toast.success(enabled ? '已启用托管' : '已暂停托管');
    },
    onError: (_err, _vars, context) => {
      // 出错时回滚到之前的状态
      if (context?.previousUsers) {
        queryClient.setQueryData(['users'], context.previousUsers);
      }
      toast.error('操作失败，请重试');
    },
    onSettled: () => {
      // 无论成功失败，最终都重新获取最新状态
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

// 清空监控数据
export function useClearData() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/monitoring/clear');
      return unwrapResponse(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['metrics'] });
      toast.success('监控数据已清空');
    },
    onError: () => {
      toast.error('清空数据失败');
    },
  });
}

// 系统信息
export function useSystemInfo() {
  return useQuery({
    queryKey: ['systemInfo'],
    queryFn: async () => {
      const { data } = await api.get('/monitoring/system');
      return unwrapResponse(data) as import('@/types/monitoring').SystemInfo;
    },
    refetchInterval: 30000, // 每 30 秒刷新
  });
}

// ==================== Agent 回复策略配置 ====================

// 获取 Agent 回复策略配置
export function useAgentReplyConfig() {
  return useQuery({
    queryKey: ['agent-reply-config'],
    queryFn: async () => {
      const { data } = await api.get('/monitoring/agent-config');
      return unwrapResponse<AgentReplyConfigResponse>(data);
    },
  });
}

// 更新 Agent 回复策略配置
export function useUpdateAgentReplyConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (config: Partial<AgentReplyConfig>) => {
      const { data } = await api.post('/monitoring/agent-config', config);
      return unwrapResponse<{ config: AgentReplyConfig; message: string }>(data);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['agent-reply-config'] });
      toast.success(data.message || '配置已更新');
    },
    onError: (error: Error) => {
      toast.error(error.message || '更新配置失败');
    },
  });
}

// 重置 Agent 回复策略配置为默认值
export function useResetAgentReplyConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/monitoring/agent-config/reset');
      return unwrapResponse<{ config: AgentReplyConfig; message: string }>(data);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['agent-reply-config'] });
      toast.success(data.message || '配置已重置');
    },
    onError: () => {
      toast.error('重置配置失败');
    },
  });
}

// ==================== Worker 并发管理 ====================

// 获取 Worker 状态
export function useWorkerStatus(autoRefresh = true) {
  return useQuery({
    queryKey: ['worker-status'],
    queryFn: async () => {
      const { data } = await api.get('/monitoring/worker-status');
      return unwrapResponse<WorkerStatus>(data);
    },
    refetchInterval: autoRefresh ? 5000 : false,
  });
}

// 获取小组列表
export function useGroupList() {
  return useQuery({
    queryKey: ['group-list'],
    queryFn: async () => {
      // 使用企业级 token 获取小组列表
      const token = import.meta.env.VITE_ENTERPRISE_TOKEN || '9eaebbf614104879b81c2da7c41819bd';
      const { data } = await api.get(`/group/list?token=${token}`);
      // unwrapResponse 会递归解包所有 data 字段，直接返回数组
      const groups = unwrapResponse<Array<{ id: string; name: string; description: string }>>(data);
      return groups || [];
    },
    staleTime: 60000, // 1 分钟内不重新请求
  });
}

// 设置 Worker 并发数
export function useSetWorkerConcurrency() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (concurrency: number) => {
      const { data } = await api.post('/monitoring/worker-concurrency', { concurrency });
      return unwrapResponse<WorkerConcurrencyResponse>(data);
    },
    onMutate: async (concurrency) => {
      // 取消正在进行的查询
      await queryClient.cancelQueries({ queryKey: ['worker-status'] });
      // 保存之前的状态
      const previousStatus = queryClient.getQueryData<WorkerStatus>(['worker-status']);
      // 乐观更新 - 立即更新 UI
      if (previousStatus) {
        queryClient.setQueryData<WorkerStatus>(['worker-status'], {
          ...previousStatus,
          concurrency,
        });
      }
      return { previousStatus };
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.message || '并发数已更新');
      } else {
        toast.error(data.message || '更新失败');
      }
    },
    onError: (_err, _concurrency, context) => {
      // 出错时回滚到之前的状态
      if (context?.previousStatus) {
        queryClient.setQueryData(['worker-status'], context.previousStatus);
      }
      toast.error('设置并发数失败');
    },
    onSettled: () => {
      // 无论成功失败，最终都重新获取最新状态
      queryClient.invalidateQueries({ queryKey: ['worker-status'] });
    },
  });
}

// ==================== 聊天记录查询 ====================

// 聊天消息类型
// v1.3: 新增 messageType, source, contactType, isSelf, avatar, externalUserId 字段
export interface ChatMessage {
  id: string;
  chatId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  candidateName?: string;
  managerName?: string;
  // v1.3 新增字段
  messageType?: string; // 消息类型：TEXT, IMAGE, VOICE, FILE 等
  source?: string; // 消息来源：MOBILE_PUSH, AI_REPLY 等
  contactType?: string; // 客户类型：PERSONAL_WECHAT, ENTERPRISE_WECHAT 等
  isSelf?: boolean; // 是否托管账号自己发送
  avatar?: string; // 用户头像URL
  externalUserId?: string; // 企微外部用户ID
}

// 聊天消息响应
export interface ChatMessagesResponse {
  messages: ChatMessage[];
  total: number;
  page: number;
  pageSize: number;
}

// 会话信息
// v1.3: 新增 avatar, contactType 字段
export interface ChatSession {
  chatId: string;
  candidateName?: string;
  managerName?: string;
  messageCount: number;
  lastMessage?: string;
  lastTimestamp?: number;
  // v1.3 新增字段
  avatar?: string; // 用户头像URL
  contactType?: string; // 客户类型
}

// 获取聊天消息列表
export function useChatMessages(date?: string, page = 1, pageSize = 50) {
  return useQuery({
    queryKey: ['chat-messages', date, page, pageSize],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (date) params.set('date', date);
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      const { data } = await api.get(`/monitoring/chat-messages?${params.toString()}`);
      return unwrapResponse<ChatMessagesResponse>(data);
    },
  });
}

// 获取会话列表
export function useChatSessions(days: number = 1) {
  return useQuery({
    queryKey: ['chat-sessions', days],
    queryFn: async () => {
      const { data } = await api.get(`/monitoring/chat-sessions?days=${days}`);
      return unwrapResponse<{ sessions: ChatSession[] }>(data);
    },
  });
}

// 获取指定会话的消息
export function useChatSessionMessages(chatId: string | null) {
  return useQuery({
    queryKey: ['chat-session-messages', chatId],
    queryFn: async () => {
      if (!chatId) return { chatId: '', messages: [] };
      const { data } = await api.get(`/monitoring/chat-sessions/${encodeURIComponent(chatId)}/messages`);
      return unwrapResponse<{ chatId: string; messages: ChatMessage[] }>(data);
    },
    enabled: !!chatId,
  });
}
