/**
 * 飞书相关常量配置
 * 硬编码配置作为默认值，支持环境变量覆盖
 */

/**
 * 飞书 Webhook 配置
 */
export const FEISHU_WEBHOOKS = {
  // 系统告警群
  ALERT: {
    URL: 'https://open.feishu.cn/open-apis/bot/v2/hook/c3e291d6-74bd-4a7c-b983-7a9d10e5f031',
    SECRET: 'HqZxSdbyK0P6X3thQFdbHb',
  },
  // 面试预约通知群（与告警群相同，使用同一个群）
  INTERVIEW_BOOKING: {
    URL: 'https://open.feishu.cn/open-apis/bot/v2/hook/c3e291d6-74bd-4a7c-b983-7a9d10e5f031',
    SECRET: 'HqZxSdbyK0P6X3thQFdbHb',
  },
} as const;

/**
 * 飞书多维表格配置
 */
export const FEISHU_BITABLE = {
  APP_ID: 'RypLwXb1yiKdRpkFN4bcvWnmnsf',
  TABLE_ID: 'tblKNwN8aquh2JAy',
} as const;

/**
 * 告警节流配置
 */
export const ALERT_THROTTLE = {
  WINDOW_MS: 5 * 60 * 1000, // 5 分钟节流窗口
  MAX_COUNT: 3, // 窗口内最大告警次数
} as const;
