#!/usr/bin/env node

/**
 * 飞书告警测试脚本
 * 用于测试系统监控是否能正确接收和记录告警数据
 *
 * 使用方法:
 *   node scripts/test-feishu-alerts.mjs
 *   node scripts/test-feishu-alerts.mjs --base-url http://localhost:8080
 */

const BASE_URL = process.argv.includes('--base-url')
  ? process.argv[process.argv.indexOf('--base-url') + 1]
  : process.env.BASE_URL || 'http://localhost:8080';

// 颜色输出
const colors = {
  red: (text) => `\x1b[31m${text}\x1b[0m`,
  green: (text) => `\x1b[32m${text}\x1b[0m`,
  yellow: (text) => `\x1b[33m${text}\x1b[0m`,
  cyan: (text) => `\x1b[36m${text}\x1b[0m`,
  bold: (text) => `\x1b[1m${text}\x1b[0m`,
};

const log = {
  step: (msg) => console.log(colors.yellow(`\n>>> ${msg}`)),
  success: (msg) => console.log(colors.green(`  [OK] ${msg}`)),
  error: (msg) => console.log(colors.red(`  [ERROR] ${msg}`)),
  info: (msg) => console.log(colors.cyan(`  ${msg}`)),
};

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  try {
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    return await response.json();
  } catch (error) {
    return { error: error.message };
  }
}

async function checkHealth() {
  log.step('检查服务状态...');
  const result = await request('/monitoring/health');
  if (result.status === 'ok' || result.data?.status === 'ok') {
    log.success('服务运行正常');
    return true;
  } else {
    log.error(`服务未运行: ${JSON.stringify(result)}`);
    log.info('请先启动服务: pnpm run start:dev');
    return false;
  }
}

async function getInitialStats() {
  log.step('获取初始监控数据...');
  const result = await request('/monitoring/dashboard');
  const data = result.data || result;
  const alerts = data.alertsSummary?.total || 0;
  const errors = data.recentErrors?.length || 0;
  log.info(`初始告警数量: ${alerts}`);
  log.info(`初始错误日志: ${errors}`);
  return { alerts, errors };
}

async function testAgentTimeout() {
  log.step('测试 1: 模拟 Agent API 超时错误');
  const result = await request('/alert/test/agent-timeout', { method: 'POST' });
  if (result.success || result.data?.success) {
    log.success('Agent 超时告警已发送');
  } else {
    log.info(`结果: ${JSON.stringify(result)}`);
  }
  return result;
}

async function testAuthError() {
  log.step('测试 2: 模拟 Agent API 认证失败 (401)');
  const result = await request('/alert/test/auth-error', { method: 'POST' });
  if (result.success || result.data?.success) {
    log.success('认证失败告警已发送 (严重级别)');
  } else {
    log.info(`结果: ${JSON.stringify(result)}`);
  }
  return result;
}

async function testRateLimit() {
  log.step('测试 3: 模拟 Agent API 限流 (429)');
  const result = await request('/alert/test/rate-limit', { method: 'POST' });
  if (result.success || result.data?.success) {
    log.success('限流告警已发送 (警告级别)');
  } else {
    log.info(`结果: ${JSON.stringify(result)}`);
  }
  return result;
}

async function testDeliveryError() {
  log.step('测试 4: 模拟消息发送失败');
  const result = await request('/alert/test/delivery-error', { method: 'POST' });
  if (result.success || result.data?.success) {
    log.success('消息发送失败告警已发送');
  } else {
    log.info(`结果: ${JSON.stringify(result)}`);
  }
  return result;
}

async function testSystemError() {
  log.step('测试 5: 模拟系统错误');
  const result = await request('/alert/test/system-error', { method: 'POST' });
  if (result.success || result.data?.success) {
    log.success('系统错误告警已发送');
  } else {
    log.info(`结果: ${JSON.stringify(result)}`);
  }
  return result;
}

async function testBatchAlerts() {
  log.step('测试 6: 批量告警测试 (验证节流功能)');
  const result = await request('/alert/test/batch', {
    method: 'POST',
    body: JSON.stringify({ count: 5, errorType: 'batch-test' }),
  });
  const data = result.data || result;
  log.info(`发送: ${data.sent || 0}, 被节流: ${data.throttled || 0}, 总计: ${data.total || 0}`);
  return result;
}

async function getFinalStats() {
  log.step('获取最终监控数据...');
  await new Promise((resolve) => setTimeout(resolve, 1000)); // 等待数据写入

  const result = await request('/monitoring/dashboard');
  const data = result.data || result;

  return {
    alerts: data.alertsSummary?.total || 0,
    alerts24h: data.alertsSummary?.last24Hours || 0,
    byType: data.alertsSummary?.byType || [],
    recentErrors: data.recentErrors || [],
  };
}

function printSummary(initial, final) {
  console.log('\n' + '='.repeat(50));
  console.log(colors.bold('测试结果汇总'));
  console.log('='.repeat(50));

  console.log(`\n${colors.cyan('告警统计:')}`);
  console.log(`  初始告警数量: ${initial.alerts}`);
  console.log(`  最终告警数量: ${final.alerts}`);
  console.log(`  新增告警数量: ${colors.green(final.alerts - initial.alerts)}`);
  console.log(`  24小时内告警: ${final.alerts24h}`);

  if (final.byType.length > 0) {
    console.log(`\n${colors.cyan('告警类型分布:')}`);
    final.byType.forEach((item) => {
      console.log(`  - ${item.type}: ${item.count} (${item.percentage}%)`);
    });
  }

  if (final.recentErrors.length > 0) {
    console.log(`\n${colors.cyan('最近错误日志 (最多显示5条):')}`);
    final.recentErrors.slice(0, 5).forEach((error, idx) => {
      const time = new Date(error.timestamp).toLocaleTimeString('zh-CN');
      console.log(`  ${idx + 1}. [${time}] ${error.error?.substring(0, 60) || 'Unknown'}...`);
    });
  }

  console.log('\n' + '='.repeat(50));
  console.log(colors.green('测试完成!'));
  console.log('='.repeat(50));

  console.log(`\n${colors.cyan('提示:')}`);
  console.log('  1. 检查飞书群是否收到告警消息');
  console.log('  2. 部分告警可能因节流被跳过（这是正常的）');
  console.log(`  3. 打开监控面板查看详情: ${BASE_URL}/monitoring.html`);
}

async function main() {
  console.log('='.repeat(50));
  console.log(colors.bold('飞书告警测试脚本'));
  console.log(`BASE_URL: ${BASE_URL}`);
  console.log('='.repeat(50));

  // 1. 检查服务状态
  const healthy = await checkHealth();
  if (!healthy) {
    process.exit(1);
  }

  // 2. 获取初始状态
  const initialStats = await getInitialStats();

  // 3. 执行各种告警测试
  await testAgentTimeout();
  await new Promise((r) => setTimeout(r, 500));

  await testAuthError();
  await new Promise((r) => setTimeout(r, 500));

  await testRateLimit();
  await new Promise((r) => setTimeout(r, 500));

  await testDeliveryError();
  await new Promise((r) => setTimeout(r, 500));

  await testSystemError();
  await new Promise((r) => setTimeout(r, 500));

  await testBatchAlerts();

  // 4. 获取最终状态并打印汇总
  const finalStats = await getFinalStats();
  printSummary(initialStats, finalStats);
}

main().catch(console.error);
