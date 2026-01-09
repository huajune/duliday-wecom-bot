/**
 * 生成 Agent 测试用例并写入飞书测试集表
 *
 * 基于 2025-12-17 Agent 分析报告设计的测试用例
 *
 * 使用方法:
 *   npx ts-node scripts/generate-test-cases.ts
 */

import axios from 'axios';

// 飞书配置
const FEISHU_APP_ID = 'cli_a9ae9bcd92f99cc0';
const FEISHU_APP_SECRET = 'SCcwMAhNyB014U3sBG5BuhhOmfgaDQJg';
const APP_TOKEN = 'WXQgb98iPauYsHsSYzMckqHcnbb';
const TABLE_ID = 'tblCRHFQqqJDJeSx';

// 11 个测试分类（运营友好命名）
const TEST_CATEGORIES = {
  BRAND_MISSING: '1-缺少品牌名',      // 用户没说想找哪个品牌
  BRAND_MAPPING: '2-品牌名识别',      // 品牌别名转换（肯德基→上海肯德基）
  REGION_PARSE: '3-地区识别',         // 地区名能否正确理解
  CONDITION_MISMATCH: '4-条件不符',   // 年龄/工时等硬性条件不满足
  OVER_REACTION: '5-过度反应',        // 用户说"好的/嗯"，不应该乱查岗位
  EMOTION_HANDLE: '6-情绪处理',       // 用户不满、沮丧、想放弃
  CONTEXT_MEMORY: '7-上下文记忆',     // 能否记住之前聊过的内容
  JOB_QUERY: '8-查询岗位',            // 用户问某品牌/地区有没有岗位
  JOB_DETAIL: '9-了解岗位详情',        // 用户问薪资、工作内容、时间
  BOOK_INTERVIEW: '10-预约面试',      // 用户想约面试
  FIRST_CONTACT: '11-首次接触',       // 用户第一次打招呼
};

// 测试用例数据
interface TestCase {
  caseName: string;
  category: string;
  nickname: string; // 候选人微信昵称
  message: string; // 用户消息（最后一条）
  history: string; // 聊天记录（特定格式）
  expectedOutput?: string; // 预期输出描述（放备注）
}

/**
 * 生成聊天记录格式
 * 格式: [日期 时间 用户名] 消息内容
 */
function formatHistory(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  nickname: string,
): string {
  const now = new Date();
  const dateStr = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;

  return messages
    .map((msg, i) => {
      const timeStr = `${String(10 + i).padStart(2, '0')}:${String(i * 5).padStart(2, '0')}`;
      const speaker = msg.role === 'user' ? nickname : '招募经理';
      return `[${dateStr} ${timeStr} ${speaker}] ${msg.content}`;
    })
    .join('\n');
}

const TEST_CASES: TestCase[] = [
  // ========== 1. 缺少品牌名 ==========
  {
    caseName: '缺少品牌名-未指定品牌查询地区',
    category: TEST_CATEGORIES.BRAND_MISSING,
    nickname: '小明🌟',
    message: '松江区有什么兼职？',
    history: '',
    expectedOutput: '应该主动询问想查哪个品牌，而不是直接调用工具',
  },
  {
    caseName: '缺少品牌名-只说地区不说品牌',
    category: TEST_CATEGORIES.BRAND_MISSING,
    nickname: 'A阿杰',
    message: '杨浦区',
    history: formatHistory(
      [
        { role: 'user', content: '你好，我想找兼职' },
        { role: 'assistant', content: '你好！请问你在哪个区域呀？' },
      ],
      'A阿杰',
    ),
    expectedOutput: '应该继续询问品牌偏好，不应该盲目调用工具',
  },
  {
    caseName: '缺少品牌名-模糊表达找工作',
    category: TEST_CATEGORIES.BRAND_MISSING,
    nickname: '努力搬砖',
    message: '附近有什么工作吗',
    history: '',
    expectedOutput: '应该询问具体位置和品牌偏好',
  },

  // ========== 2. 品牌名识别 ==========
  {
    caseName: '品牌名识别-必胜客无城市前缀',
    category: TEST_CATEGORIES.BRAND_MAPPING,
    nickname: '🌸花花',
    message: '必胜客还招人吗',
    history: formatHistory(
      [
        { role: 'user', content: '我在上海浦东' },
        { role: 'assistant', content: '好的，浦东这边有几个品牌在招，你想看哪个？' },
      ],
      '🌸花花',
    ),
    expectedOutput: '应该根据上下文推断为上海必胜客，或主动确认',
  },
  {
    caseName: '品牌名识别-肯德基无城市前缀',
    category: TEST_CATEGORIES.BRAND_MAPPING,
    nickname: '星星✨',
    message: '肯德基有吗',
    history: formatHistory(
      [
        { role: 'user', content: '我在北京朝阳区' },
        { role: 'assistant', content: '朝阳区这边有在招的，你想看哪个品牌？' },
      ],
      '星星✨',
    ),
    expectedOutput: '应该推断为北京肯德基或主动确认',
  },
  {
    caseName: '品牌名识别-不支持的品牌',
    category: TEST_CATEGORIES.BRAND_MAPPING,
    nickname: '☕爱喝咖啡',
    message: '星巴克招人吗',
    history: '',
    expectedOutput: '应该明确告知该品牌暂不支持，推荐其他品牌',
  },
  {
    caseName: '品牌名识别-山姆需确认门店',
    category: TEST_CATEGORIES.BRAND_MAPPING,
    nickname: 'W.',
    message: '山姆有兼职吗',
    history: formatHistory(
      [
        { role: 'user', content: '我在上海嘉定' },
        { role: 'assistant', content: '嘉定这边有几个品牌在招' },
      ],
      'W.',
    ),
    expectedOutput: '应该确认具体是哪个山姆门店（嘉定山姆等）',
  },

  // ========== 3. 地区识别 ==========
  {
    caseName: '地区识别-本地无岗位不跨城',
    category: TEST_CATEGORIES.REGION_PARSE,
    nickname: '广州妹子💃',
    message: '南沙区有岗位吗',
    history: formatHistory(
      [
        { role: 'user', content: '我在广州' },
        { role: 'assistant', content: '广州这边有肯德基在招' },
      ],
      '广州妹子💃',
    ),
    expectedOutput: '如果南沙没有，应该推荐广州其他区，不应该推荐上海',
  },
  {
    caseName: '地区识别-明确地区偏好',
    category: TEST_CATEGORIES.REGION_PARSE,
    nickname: '热干面🍜',
    message: '只考虑武汉的',
    history: formatHistory(
      [
        { role: 'user', content: '有兼职吗' },
        { role: 'assistant', content: '有的，你在哪个城市？' },
      ],
      '热干面🍜',
    ),
    expectedOutput: '应该只查询武汉地区岗位，不推荐其他城市',
  },
  {
    caseName: '地区识别-地区名称不规范',
    category: TEST_CATEGORIES.REGION_PARSE,
    nickname: '佳佳',
    message: '杨浦有吗',
    history: '',
    expectedOutput: '应该能识别杨浦=杨浦区，正确查询',
  },

  // ========== 4. 条件不符 ==========
  {
    caseName: '条件不符-年龄超限',
    category: TEST_CATEGORIES.CONDITION_MISMATCH,
    nickname: '刘姐❤',
    message: '我43岁可以做吗',
    history: formatHistory(
      [
        { role: 'user', content: '奥乐齐早班兼职还招吗' },
        { role: 'assistant', content: '在招的，奥乐齐早班兼职年龄要求18-40岁' },
      ],
      '刘姐❤',
    ),
    expectedOutput: '应该明确告知年龄不符合要求，不应该约面试',
  },
  {
    caseName: '条件不符-工时不足',
    category: TEST_CATEGORIES.CONDITION_MISMATCH,
    nickname: '小陈🎵',
    message: '我只能周一到周三上午，每天4小时',
    history: formatHistory(
      [
        { role: 'user', content: '奥乐齐在招吗' },
        { role: 'assistant', content: '在招的，这边是做六休一，一天8小时' },
      ],
      '小陈🎵',
    ),
    expectedOutput: '应该告知工时要求不匹配，不应该约面试',
  },
  {
    caseName: '条件不符-条件完全匹配',
    category: TEST_CATEGORIES.CONDITION_MISMATCH,
    nickname: 'lucky🍀',
    message: '我25岁，一周能出5天，每天8小时都行',
    history: formatHistory(
      [
        { role: 'user', content: '大米先生招人吗' },
        { role: 'assistant', content: '招的，年龄要求18-35，一周至少4天' },
      ],
      'lucky🍀',
    ),
    expectedOutput: '应该确认匹配并继续约面流程',
  },

  // ========== 5. 过度反应 ==========
  {
    caseName: '过度反应-好的',
    category: TEST_CATEGORIES.OVER_REACTION,
    nickname: '阳光灿烂☀',
    message: '好的',
    history: formatHistory(
      [
        { role: 'user', content: '肯德基时薪多少' },
        { role: 'assistant', content: '肯德基时薪是24元/小时' },
      ],
      '阳光灿烂☀',
    ),
    expectedOutput: '应该简单回应，不应该触发新的岗位查询',
  },
  {
    caseName: '过度反应-嗯',
    category: TEST_CATEGORIES.OVER_REACTION,
    nickname: '大熊🐻',
    message: '嗯',
    history: formatHistory(
      [
        { role: 'user', content: '地址在哪' },
        { role: 'assistant', content: '在杨浦区五角场万达广场B1层' },
      ],
      '大熊🐻',
    ),
    expectedOutput: '应该询问是否需要进一步帮助，不触发工具调用',
  },
  {
    caseName: '过度反应-OK表情',
    category: TEST_CATEGORIES.OVER_REACTION,
    nickname: '🎀小甜甜',
    message: '[OK]',
    history: formatHistory(
      [
        { role: 'user', content: '面试时间是周四下午吗' },
        { role: 'assistant', content: '是的，周四下午2点' },
      ],
      '🎀小甜甜',
    ),
    expectedOutput: '应该确认收到，不触发额外操作',
  },
  {
    caseName: '过度反应-是的',
    category: TEST_CATEGORIES.OVER_REACTION,
    nickname: '张小凡',
    message: '是的',
    history: formatHistory(
      [
        { role: 'user', content: '你是招聘的吗' },
        { role: 'assistant', content: '是的，我是独立客的招聘经理' },
      ],
      '张小凡',
    ),
    expectedOutput: '应该继续对话，询问求职需求',
  },

  // ========== 6. 情绪处理 ==========
  {
    caseName: '情绪处理-质疑可靠性',
    category: TEST_CATEGORIES.EMOTION_HANDLE,
    nickname: 'xin👑',
    message: '你靠谱不？',
    history: formatHistory(
      [
        { role: 'user', content: '昨天说的那个岗位呢' },
        { role: 'assistant', content: '不好意思，那个岗位已经招满了' },
      ],
      'xin👑',
    ),
    expectedOutput: '应该道歉并提供解决方案，不应该忽略情绪',
  },
  {
    caseName: '情绪处理-表达不满',
    category: TEST_CATEGORIES.EMOTION_HANDLE,
    nickname: '大连小哥🦁',
    message: '有毛病啊',
    history: formatHistory(
      [
        { role: 'user', content: '我说了好几遍在大连了' },
        { role: 'assistant', content: '好的，我帮你看看上海这边的岗位' },
      ],
      '大连小哥🦁',
    ),
    expectedOutput: '应该道歉并纠正错误，重新确认用户位置',
  },
  {
    caseName: '情绪处理-表达沮丧',
    category: TEST_CATEGORIES.EMOTION_HANDLE,
    nickname: '醉离殇',
    message: '找兼职就那么难呀',
    history: formatHistory(
      [
        { role: 'user', content: '年龄超了怎么办' },
        { role: 'assistant', content: '确实这个岗位年龄要求比较严格' },
      ],
      '醉离殇',
    ),
    expectedOutput: '应该安抚情绪，提供其他选择或建议',
  },
  {
    caseName: '情绪处理-放弃表态',
    category: TEST_CATEGORIES.EMOTION_HANDLE,
    nickname: '想静静',
    message: '算了不找了',
    history: formatHistory(
      [
        { role: 'user', content: '有日结的吗' },
        { role: 'assistant', content: '目前这边都是月结的' },
      ],
      '想静静',
    ),
    expectedOutput: '应该挽留并询问其他需求，不应该直接结束',
  },

  // ========== 7. 上下文记忆 ==========
  {
    caseName: '上下文记忆-昵称不是对话内容',
    category: TEST_CATEGORIES.CONTEXT_MEMORY,
    nickname: '减肥中💪',
    message: '我是减肥中',
    history: '',
    expectedOutput: '应该理解为自我介绍昵称，询问求职需求，不应该讨论减肥',
  },
  {
    caseName: '上下文记忆-承接之前话题',
    category: TEST_CATEGORIES.CONTEXT_MEMORY,
    nickname: 'Lily🌷',
    message: '那个店还招吗',
    history: formatHistory(
      [
        { role: 'user', content: '浦东有肯德基吗' },
        { role: 'assistant', content: '有的，浦东新区有3家肯德基在招' },
        { role: 'user', content: '世纪公园附近的呢' },
        { role: 'assistant', content: '世纪公园这边有一家在招，时薪24' },
      ],
      'Lily🌷',
    ),
    expectedOutput: '应该理解"那个店"指世纪公园肯德基',
  },
  {
    caseName: '上下文记忆-多轮追问',
    category: TEST_CATEGORIES.CONTEXT_MEMORY,
    nickname: '好奇宝宝🐣',
    message: '时间呢',
    history: formatHistory(
      [
        { role: 'user', content: '大米先生招人吗' },
        { role: 'assistant', content: '招的，浦东有2家' },
        { role: 'user', content: '薪资多少' },
        { role: 'assistant', content: '时薪22元' },
      ],
      '好奇宝宝🐣',
    ),
    expectedOutput: '应该理解是问工作时间，给出班次信息',
  },

  // ========== 8. 查询岗位 ==========
  {
    caseName: '查询岗位-完整品牌地区',
    category: TEST_CATEGORIES.JOB_QUERY,
    nickname: '小红帽🧢',
    message: '上海浦东肯德基还招人吗',
    history: '',
    expectedOutput: '应该查询并返回浦东肯德基的岗位信息',
  },
  {
    caseName: '查询岗位-只说品牌',
    category: TEST_CATEGORIES.JOB_QUERY,
    nickname: '找工作🔍',
    message: '大米先生招人吗',
    history: formatHistory(
      [
        { role: 'user', content: '我在杨浦区' },
        { role: 'assistant', content: '好的，杨浦区这边有几个品牌在招' },
      ],
      '找工作🔍',
    ),
    expectedOutput: '应该根据上下文查询杨浦区大米先生岗位',
  },

  // ========== 9. 了解岗位详情 ==========
  {
    caseName: '了解岗位详情-问薪资',
    category: TEST_CATEGORIES.JOB_DETAIL,
    nickname: '💰财迷',
    message: '时薪多少钱',
    history: formatHistory(
      [
        { role: 'user', content: '杨浦区大米先生招人吗' },
        { role: 'assistant', content: '招的，杨浦区有2家大米先生在招' },
      ],
      '💰财迷',
    ),
    expectedOutput: '应该返回薪资信息',
  },
  {
    caseName: '了解岗位详情-问工作内容',
    category: TEST_CATEGORIES.JOB_DETAIL,
    nickname: '元气少女🌈',
    message: '主要做什么工作',
    history: formatHistory(
      [
        { role: 'user', content: '奥乐齐招人吗' },
        { role: 'assistant', content: '招的，奥乐齐有早班兼职和晚班补货' },
      ],
      '元气少女🌈',
    ),
    expectedOutput: '应该说明具体工作内容',
  },
  {
    caseName: '了解岗位详情-问工作时间',
    category: TEST_CATEGORIES.JOB_DETAIL,
    nickname: '时间管理⏰',
    message: '上班时间是几点到几点',
    history: formatHistory(
      [
        { role: 'user', content: '肯德基早班怎么样' },
        { role: 'assistant', content: '肯德基早班时薪24，做四休三' },
      ],
      '时间管理⏰',
    ),
    expectedOutput: '应该返回具体工作时间',
  },

  // ========== 10. 预约面试 ==========
  {
    caseName: '预约面试-明确意向',
    category: TEST_CATEGORIES.BOOK_INTERVIEW,
    nickname: '奋斗ing',
    message: '我想去面试',
    history: formatHistory(
      [
        { role: 'user', content: '浦东肯德基招人吗' },
        { role: 'assistant', content: '招的，时薪24，年龄18-45' },
        { role: 'user', content: '我26岁，可以的' },
      ],
      '奋斗ing',
    ),
    expectedOutput: '应该收集必要信息（姓名、电话）并约面试',
  },
  {
    caseName: '预约面试-提供个人信息',
    category: TEST_CATEGORIES.BOOK_INTERVIEW,
    nickname: '积极求职💼',
    message: '我叫张三，电话13812345678',
    history: formatHistory(
      [
        { role: 'user', content: '我想面试大米先生' },
        { role: 'assistant', content: '好的，请问您叫什么名字？电话多少？' },
      ],
      '积极求职💼',
    ),
    expectedOutput: '应该确认信息并完成面试预约',
  },

  // ========== 11. 首次接触 ==========
  {
    caseName: '首次接触-打招呼',
    category: TEST_CATEGORIES.FIRST_CONTACT,
    nickname: 'Amy酱',
    message: '你好',
    history: '',
    expectedOutput: '应该友好问候并询问求职需求',
  },
  {
    caseName: '首次接触-表情问好',
    category: TEST_CATEGORIES.FIRST_CONTACT,
    nickname: '萌新🐱',
    message: '[微笑]',
    history: '',
    expectedOutput: '应该友好回应并引导对话',
  },
];

// 获取飞书 tenant_access_token
async function getTenantAccessToken(): Promise<string> {
  const response = await axios.post(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    {
      app_id: FEISHU_APP_ID,
      app_secret: FEISHU_APP_SECRET,
    },
  );

  if (response.data.code !== 0) {
    throw new Error(`获取 token 失败: ${response.data.msg}`);
  }

  return response.data.tenant_access_token;
}

// 获取表格字段
async function getTableFields(token: string): Promise<any[]> {
  const response = await axios.get(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/fields`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (response.data.code !== 0) {
    throw new Error(`获取字段失败: ${response.data.msg}`);
  }

  return response.data.data.items;
}

// 获取现有记录
async function getExistingRecords(token: string): Promise<any[]> {
  const response = await axios.get(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records`,
    {
      headers: { Authorization: `Bearer ${token}` },
      params: { page_size: 500 },
    },
  );

  if (response.data.code !== 0) {
    throw new Error(`获取记录失败: ${response.data.msg}`);
  }

  return response.data.data?.items || [];
}

// 删除记录
async function deleteRecords(token: string, recordIds: string[]): Promise<void> {
  if (recordIds.length === 0) return;

  const response = await axios.post(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/batch_delete`,
    { records: recordIds },
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (response.data.code !== 0) {
    throw new Error(`批量删除失败: ${response.data.msg}`);
  }

  console.log(`   ✅ 成功删除 ${recordIds.length} 条记录`);
}

// 批量创建记录
async function batchCreateRecords(token: string, records: any[]): Promise<void> {
  const response = await axios.post(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/batch_create`,
    { records },
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (response.data.code !== 0) {
    throw new Error(`批量创建失败: ${response.data.msg}`);
  }

  console.log(`   ✅ 成功创建 ${records.length} 条记录`);
}

// 主函数
async function main() {
  const args = process.argv.slice(2);
  const shouldCleanOld = args.includes('--clean');

  console.log('🚀 开始生成测试用例...\n');

  // 1. 获取 token
  console.log('1️⃣ 获取飞书 Token...');
  const token = await getTenantAccessToken();
  console.log('   ✅ Token 获取成功\n');

  // 2. 获取表格字段
  console.log('2️⃣ 获取表格字段结构...');
  const fields = await getTableFields(token);
  console.log('   字段列表:');
  fields.forEach((f: any) => {
    console.log(`   - ${f.field_name} (${f.field_id})`);
  });
  console.log('');

  // 3. 获取现有记录
  console.log('3️⃣ 获取现有记录...');
  const existingRecords = await getExistingRecords(token);
  console.log(`   现有 ${existingRecords.length} 条记录\n`);

  // 4. 如果指定了 --clean，删除所有旧数据
  if (shouldCleanOld && existingRecords.length > 0) {
    console.log('4️⃣ 清理所有旧数据（统一分类）...');
    const toDelete = existingRecords.map((r: any) => r.record_id);
    await deleteRecords(token, toDelete);
    console.log('');
  }

  // 5. 准备新记录
  console.log('5️⃣ 准备测试用例数据...');
  console.log(`   共 ${TEST_CASES.length} 条测试用例\n`);

  // 按分类统计
  const categoryCount: Record<string, number> = {};
  TEST_CASES.forEach((tc) => {
    categoryCount[tc.category] = (categoryCount[tc.category] || 0) + 1;
  });
  console.log('   分类统计:');
  Object.entries(categoryCount).forEach(([cat, count]) => {
    console.log(`   - ${cat}: ${count} 条`);
  });
  console.log('');

  // 构建记录（使用正确的字段格式）
  const now = Date.now();
  const records = TEST_CASES.map((tc) => ({
    fields: {
      候选人微信昵称: tc.nickname,
      用例名称: tc.caseName,
      分类: tc.category,
      用户消息: tc.message,
      聊天记录: tc.history || '',
      咨询时间: now,
      招募经理姓名: 'AI测试',
      备注: tc.expectedOutput || '',
    },
  }));

  // 6. 写入飞书
  console.log('6️⃣ 写入飞书测试集表...');
  await batchCreateRecords(token, records);

  console.log('\n🎉 完成！测试用例已写入飞书测试集表');
  console.log(`   表格链接: https://duliday.feishu.cn/base/${APP_TOKEN}?table=${TABLE_ID}`);
}

main().catch((err) => {
  console.error('❌ 错误:', err.message);
  process.exit(1);
});
