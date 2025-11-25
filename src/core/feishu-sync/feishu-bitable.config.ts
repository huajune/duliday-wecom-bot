/**
 * 飞书多维表格配置（支持多表）
 * 目前仅配置聊天记录表，如需扩展可在 tables 下新增。
 */
export interface FeishuBitableTableConfig {
  appToken: string;
  tableId: string;
}

export interface FeishuBitableConfig {
  appId: string;
  appSecret: string;
  tables: {
    chat: FeishuBitableTableConfig;
    // second?: FeishuBitableTableConfig; // 预留第二张表
  };
}

export const feishuBitableConfig: FeishuBitableConfig = {
  // 飞书开放平台应用凭证
  appId: 'cli_a9ae9bcd92f99cc0',
  appSecret: 'SCcwMAhNyB014U3sBG5BuhhOmfgaDQJg',
  tables: {
    chat: {
      // 聊天记录表
      appToken: 'WXQgb98iPauYsHsSYzMckqHcnbb', // 从 wiki 节点转换得到的实际 bitable token
      tableId: 'tblKNwN8aquh2JAy',
    },
  },
};
