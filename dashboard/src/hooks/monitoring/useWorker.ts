/**
 * Worker 并发管理相关 Hooks
 *
 * 包含 Worker 状态、小组列表、并发数设置等功能
 * 从 useMonitoring.ts 拆分而来（2025-12-16）
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import type { WorkerStatus } from '@/types/monitoring';
import { api, unwrapResponse } from './shared';

// ==================== 类型定义 ====================

// Worker 并发数响应
export interface WorkerConcurrencyResponse {
  success: boolean;
  message: string;
  concurrency: number;
}

// 小组信息
export interface GroupInfo {
  id: string;
  name: string;
  description: string;
}

// ==================== Query Hooks ====================

/**
 * 获取 Worker 状态
 */
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

/**
 * 获取小组列表
 */
export function useGroupList() {
  return useQuery({
    queryKey: ['group-list'],
    queryFn: async () => {
      // 使用企业级 token 获取小组列表
      const token = import.meta.env.VITE_ENTERPRISE_TOKEN || '9eaebbf614104879b81c2da7c41819bd';
      const { data } = await api.get(`/group/list?token=${token}`);
      // unwrapResponse 会递归解包所有 data 字段，直接返回数组
      const groups = unwrapResponse<GroupInfo[]>(data);
      return groups || [];
    },
    staleTime: 60000, // 1 分钟内不重新请求
  });
}

// ==================== Mutation Hooks ====================

/**
 * 设置 Worker 并发数
 */
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
