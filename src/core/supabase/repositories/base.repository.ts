import { Logger } from '@nestjs/common';
import { AxiosInstance, AxiosError } from 'axios';
import { SupabaseService } from '../supabase.service';

/**
 * Supabase Repository 基类
 *
 * 设计原则：
 * 1. 统一 HTTP 客户端管理 - 所有 Repository 共享 SupabaseService 的客户端
 * 2. 通用 CRUD 操作封装 - 减少重复代码
 * 3. 错误处理标准化 - 统一的日志和错误格式
 * 4. 类型安全 - 泛型支持强类型操作
 */
export abstract class BaseRepository {
  protected readonly logger: Logger;

  /**
   * 数据库表名（子类必须实现）
   */
  protected abstract readonly tableName: string;

  constructor(protected readonly supabaseService: SupabaseService) {
    this.logger = new Logger(this.constructor.name);
  }

  // ==================== 基础设施方法 ====================

  /**
   * 获取 HTTP 客户端（带初始化检查）
   * @throws Error 如果客户端未初始化
   */
  protected getClient(): AxiosInstance {
    const client = this.supabaseService.getHttpClient();
    if (!client) {
      throw new Error(`Supabase 客户端未初始化，无法访问表 ${this.tableName}`);
    }
    return client;
  }

  /**
   * 检查客户端是否可用
   */
  protected isAvailable(): boolean {
    return this.supabaseService.isClientInitialized();
  }

  // ==================== 通用 CRUD 操作 ====================

  /**
   * 通用 SELECT 查询
   * @param params PostgREST 查询参数
   * @param options 额外配置
   */
  protected async select<T>(
    params?: Record<string, string>,
    options?: { headers?: Record<string, string> },
  ): Promise<T[]> {
    if (!this.isAvailable()) {
      this.logger.warn(`Supabase 未初始化，跳过 ${this.tableName} 查询`);
      return [];
    }

    try {
      const response = await this.getClient().get<T[]>(`/${this.tableName}`, {
        params,
        headers: options?.headers,
      });
      return response.data ?? [];
    } catch (error) {
      this.handleError('SELECT', error);
      return [];
    }
  }

  /**
   * 通用 SELECT 单条记录
   * @param params PostgREST 查询参数
   */
  protected async selectOne<T>(params?: Record<string, string>): Promise<T | null> {
    const results = await this.select<T>({ ...params, limit: '1' });
    return results.length > 0 ? results[0] : null;
  }

  /**
   * 通用 INSERT（支持返回插入的记录）
   * @param data 要插入的数据
   * @param options 额外配置
   */
  protected async insert<T>(
    data: Partial<T>,
    options?: {
      onConflict?: string;
      resolution?: 'merge-duplicates' | 'ignore-duplicates';
      returnMinimal?: boolean;
    },
  ): Promise<T | null> {
    if (!this.isAvailable()) {
      this.logger.warn(`Supabase 未初始化，跳过 ${this.tableName} 插入`);
      return null;
    }

    try {
      const url = options?.onConflict
        ? `/${this.tableName}?on_conflict=${options.onConflict}`
        : `/${this.tableName}`;

      const prefer = options?.returnMinimal
        ? 'return=minimal'
        : options?.resolution
          ? `return=representation,resolution=${options.resolution}`
          : 'return=representation';

      const response = await this.getClient().post<T[]>(url, data, {
        headers: { Prefer: prefer },
      });

      return response.data?.[0] ?? null;
    } catch (error) {
      // 忽略重复键错误（409）
      if (this.isConflictError(error)) {
        this.logger.debug(`${this.tableName} 记录已存在，跳过插入`);
        return null;
      }
      this.handleError('INSERT', error);
      return null;
    }
  }

  /**
   * 通用批量 INSERT
   * @param data 要插入的数据数组
   * @param options 额外配置
   */
  protected async insertBatch<T>(
    data: Partial<T>[],
    options?: {
      onConflict?: string;
      resolution?: 'merge-duplicates' | 'ignore-duplicates';
    },
  ): Promise<number> {
    if (!this.isAvailable() || data.length === 0) {
      return 0;
    }

    try {
      const url = options?.onConflict
        ? `/${this.tableName}?on_conflict=${options.onConflict}`
        : `/${this.tableName}`;

      const prefer = options?.resolution
        ? `return=minimal,resolution=${options.resolution}`
        : 'return=minimal';

      await this.getClient().post(url, data, {
        headers: { Prefer: prefer },
      });

      return data.length;
    } catch (error) {
      // 409 表示有部分重复，但其他记录可能已成功
      if (this.isConflictError(error)) {
        this.logger.debug(`${this.tableName} 批量插入部分记录已存在`);
        return data.length;
      }
      this.handleError('INSERT_BATCH', error);
      return 0;
    }
  }

  /**
   * 通用 UPDATE（使用 PATCH）
   * @param filter 筛选条件（PostgREST 格式）
   * @param data 要更新的数据
   */
  protected async update<T>(filter: Record<string, string>, data: Partial<T>): Promise<T[]> {
    if (!this.isAvailable()) {
      this.logger.warn(`Supabase 未初始化，跳过 ${this.tableName} 更新`);
      return [];
    }

    try {
      const response = await this.getClient().patch<T[]>(`/${this.tableName}`, data, {
        params: filter,
        headers: { Prefer: 'return=representation' },
      });
      return response.data ?? [];
    } catch (error) {
      this.handleError('UPDATE', error);
      return [];
    }
  }

  /**
   * 通用 UPSERT（INSERT + UPDATE）
   * @param data 要插入/更新的数据
   * @param conflictColumn 冲突检测列
   */
  protected async upsert<T>(data: Partial<T>, conflictColumn?: string): Promise<T | null> {
    return this.insert(data, {
      onConflict: conflictColumn,
      resolution: 'merge-duplicates',
    });
  }

  /**
   * 通用 DELETE
   * @param filter 筛选条件（PostgREST 格式）
   * @param returnDeleted 是否返回删除的记录
   */
  protected async delete<T = unknown>(
    filter: Record<string, string>,
    returnDeleted: boolean = false,
  ): Promise<T[]> {
    if (!this.isAvailable()) {
      this.logger.warn(`Supabase 未初始化，跳过 ${this.tableName} 删除`);
      return [];
    }

    try {
      const response = await this.getClient().delete<T[]>(`/${this.tableName}`, {
        params: filter,
        headers: {
          Prefer: returnDeleted ? 'return=representation' : 'return=minimal',
        },
      });
      return response.data ?? [];
    } catch (error) {
      this.handleError('DELETE', error);
      return [];
    }
  }

  /**
   * 调用 RPC 函数
   * @param functionName 函数名
   * @param params 函数参数
   */
  protected async rpc<T>(functionName: string, params?: unknown): Promise<T | null> {
    if (!this.isAvailable()) {
      this.logger.warn(`Supabase 未初始化，跳过 RPC 调用 ${functionName}`);
      return null;
    }

    try {
      const response = await this.getClient().post<T>(`/rpc/${functionName}`, params);
      return response.data;
    } catch (error) {
      // 检查是否为函数不存在错误
      if (this.isNotFoundError(error)) {
        this.logger.warn(`RPC 函数 ${functionName} 不存在，请检查数据库迁移`);
        return null;
      }
      this.handleError(`RPC:${functionName}`, error);
      return null;
    }
  }

  /**
   * 获取记录数量（使用 HEAD 请求优化）
   * @param filter 筛选条件
   */
  protected async count(filter?: Record<string, string>): Promise<number> {
    if (!this.isAvailable()) {
      return 0;
    }

    try {
      const response = await this.getClient().get(`/${this.tableName}`, {
        params: { ...filter, select: 'id' },
        headers: {
          Prefer: 'count=exact',
          'Range-Unit': 'items',
          Range: '0-0',
        },
      });

      const contentRange = response.headers['content-range'];
      if (contentRange) {
        const total = contentRange.split('/')[1];
        return parseInt(total, 10) || 0;
      }
      return 0;
    } catch (error) {
      this.handleError('COUNT', error);
      return 0;
    }
  }

  // ==================== 错误处理 ====================

  /**
   * 统一错误处理
   */
  protected handleError(operation: string, error: unknown): void {
    const axiosError = error as AxiosError;
    const status = axiosError.response?.status;
    const message = axiosError.message || String(error);

    this.logger.error(`[${this.tableName}] ${operation} 失败 (${status || 'unknown'}): ${message}`);
  }

  /**
   * 检查是否为冲突错误（409）
   */
  protected isConflictError(error: unknown): boolean {
    return (error as AxiosError).response?.status === 409;
  }

  /**
   * 检查是否为未找到错误（404）
   */
  protected isNotFoundError(error: unknown): boolean {
    return (error as AxiosError).response?.status === 404;
  }
}
