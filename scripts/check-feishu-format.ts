import axios from 'axios';

const FEISHU_APP_ID = 'cli_a9ae9bcd92f99cc0';
const FEISHU_APP_SECRET = 'SCcwMAhNyB014U3sBG5BuhhOmfgaDQJg';
const APP_TOKEN = 'WXQgb98iPauYsHsSYzMckqHcnbb';
const TABLE_ID = 'tblCRHFQqqJDJeSx';

async function main() {
  // 获取 token
  const tokenRes = await axios.post(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    { app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET }
  );
  const token = tokenRes.data.tenant_access_token;

  // 获取现有记录（只看最早的那条，应该是原有格式）
  const recordsRes = await axios.get(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records`,
    { headers: { Authorization: `Bearer ${token}` }, params: { page_size: 50 } }
  );

  console.log('所有记录字段格式:\n');
  const items = recordsRes.data.data?.items || [];

  // 找到有完整数据的记录
  for (const item of items) {
    const fields = item.fields;
    // 检查是否有聊天记录字段有内容
    if (fields['聊天记录'] || fields['fldzdpXEEH']) {
      console.log('=== 有聊天记录的记录示例 ===');
      console.log('record_id:', item.record_id);
      console.log(JSON.stringify(fields, null, 2));
      break;
    }
  }

  console.log('\n\n=== 第一条记录（可能是原始数据）===');
  if (items.length > 0) {
    console.log('record_id:', items[0].record_id);
    console.log(JSON.stringify(items[0].fields, null, 2));
  }
}

main().catch(console.error);
