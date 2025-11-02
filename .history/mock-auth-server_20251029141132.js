/**
 * Mock 鉴权服务
 * 用于本地开发时模拟外部鉴权服务
 *
 * 使用方法：
 * 1. 启动服务：node mock-auth-server.js
 * 2. 在 agent 项目中配置：OPEN_API_AUTH_URL=http://localhost:3001/api/validate-key
 * 3. 使用测试 token：Authorization: Bearer test-token
 */

import express from 'express';
const app = express();
const PORT = 3002;

// 允许的测试 token 列表
const VALID_TOKENS = [
  'test-token',
  'local-dev-key',
  'fabbb5.qX6tsHwJU17JlxQC-yshVA.Du963ozz9cA2L3LZ', // 从 wecom-service .env 中的 token
];

// 请求日志中间件
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  console.log(`  Headers:`, JSON.stringify(req.headers, null, 2));
  next();
});

// Mock 验证接口
app.get('/api/validate-key', (req, res) => {
  const auth = req.headers.authorization;

  console.log(`\n[验证请求] Authorization: ${auth}`);

  // 检查是否提供了 Authorization header
  if (!auth) {
    console.log('[验证失败] 缺少 Authorization header');
    return res.status(401).json({
      isSuccess: false,
      error: 'Missing Authorization header',
    });
  }

  // 检查格式是否正确 (Bearer xxx)
  if (!auth.startsWith('Bearer ')) {
    console.log('[验证失败] Authorization 格式错误');
    return res.status(401).json({
      isSuccess: false,
      error: 'Invalid Authorization format. Expected: Bearer <token>',
    });
  }

  // 提取 token
  const token = auth.substring(7); // 去掉 "Bearer " 前缀

  // 验证 token 是否在白名单中
  if (VALID_TOKENS.includes(token)) {
    console.log(`[验证成功] Token: ${token.substring(0, 20)}...`);
    return res.json({
      isSuccess: true,
      message: 'Token is valid',
      token: token.substring(0, 20) + '...', // 返回部分 token 用于调试
    });
  } else {
    console.log(`[验证失败] 无效的 token: ${token.substring(0, 20)}...`);
    return res.status(401).json({
      isSuccess: false,
      error: 'Invalid or expired token',
    });
  }
});

// 健康检查接口
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'mock-auth-server',
    timestamp: new Date().toISOString(),
  });
});

// 启动服务
app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log(`🚀 Mock 鉴权服务已启动`);
  console.log(`📍 地址: http://localhost:${PORT}`);
  console.log(`🔑 验证端点: http://localhost:${PORT}/api/validate-key`);
  console.log(`❤️  健康检查: http://localhost:${PORT}/health`);
  console.log('='.repeat(60));
  console.log('\n✅ 有效的测试 tokens:');
  VALID_TOKENS.forEach((token, index) => {
    console.log(`   ${index + 1}. ${token.substring(0, 30)}${token.length > 30 ? '...' : ''}`);
  });
  console.log('\n📝 使用示例:');
  console.log('   curl -H "Authorization: Bearer test-token" http://localhost:3000/api/v1/tools');
  console.log('\n等待请求...\n');
});

// 错误处理
app.use((err, req, res, next) => {
  console.error('[服务器错误]', err);
  res.status(500).json({
    isSuccess: false,
    error: 'Internal server error',
  });
});
