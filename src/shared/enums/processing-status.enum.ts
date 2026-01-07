/**
 * 消息处理状态枚举
 * 统一定义消息处理的状态，用于监控、统计等模块
 */
export enum ProcessingStatus {
  /** 处理中 */
  PROCESSING = 'processing',
  /** 处理成功 */
  SUCCESS = 'success',
  /** 处理失败 */
  FAILURE = 'failure',
}
