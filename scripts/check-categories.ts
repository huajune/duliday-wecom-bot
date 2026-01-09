import axios from 'axios';

const FEISHU_APP_ID = 'cli_a9ae9bcd92f99cc0';
const FEISHU_APP_SECRET = 'SCcwMAhNyB014U3sBG5BuhhOmfgaDQJg';
const APP_TOKEN = 'WXQgb98iPauYsHsSYzMckqHcnbb';
const TABLE_ID = 'tblCRHFQqqJDJeSx';

async function main() {
  const tokenRes = await axios.post(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    { app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET }
  );
  const token = tokenRes.data.tenant_access_token;

  // 获取所有记录
  const recordsRes = await axios.get(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records`,
    { headers: { Authorization: `Bearer ${token}` }, params: { page_size: 200 } }
  );

  const items = recordsRes.data.data?.items || [];
  
  // 统计分类
  const categories = new Map<string, number>();
  const nicknames = new Set<string>();
  
  for (const item of items) {
    const cat = item.fields['分类'];
    const nickname = item.fields['候选人微信昵称'];
    
    if (cat) {
      categories.set(cat, (categories.get(cat) || 0) + 1);
    }
    if (nickname) {
      nicknames.add(nickname);
    }
  }

  console.log('=== 现有分类统计 ===');
  for (const [cat, count] of [...categories.entries()].sort()) {
    console.log(`  ${cat}: ${count} 条`);
  }
  
  console.log('\n=== 现有昵称 ===');
  console.log([...nicknames].join(', '));
  
  console.log(`\n总记录数: ${items.length}`);
}

main().catch(console.error);
