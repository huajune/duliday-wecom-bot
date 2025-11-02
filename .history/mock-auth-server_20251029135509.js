/**
 * Mock 鉴权服务（原生 Node.js 版本，无需额外依赖）
 * 用于本地开发时模拟外部鉴权服务
 *
 * 使用方法：
 * 1. 启动服务：node mock-auth-server.js
 * 2. 在 agent 项目中配置：OPEN_API_AUTH_URL=http://localhost:3001/api/validate-key
 * 3. 使用测试 token：Authorization: Bearer test-token
 */

const http = require('http');
const url = require('url');

const PORT = 3001;

// 允许的测试 token 列表
const VALID_TOKENS = [
  'test-token',
  'local-dev-key',
  'fabbb5.qX6tsHwJU17JlxQC-yshVA.Du963ozz9cA2L3LZ', // 从 wecom-service .env 中的 token
];

// 发送 JSON 响应的辅助函数
function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

// 处理 /api/validate-key 请求
function handleValidateKey(req, res) {
  const auth = req.headers.authorization;

  console.log(`\n[验证请求] Authorization: ${auth}`);

  // 检查是否提供了 Authorization header
  if (!auth) {
    console.log('[验证失败] 缺少 Authorization header');
    return sendJSON(res, 401, {
      isSuccess: false,
      error: 'Missing Authorization header',
    });
  }

  // 检查格式是否正确 (Bearer xxx)
  if (!auth.startsWith('Bearer ')) {
    console.log('[验证失败] Authorization 格式错误');
    return sendJSON(res, 401, {
      isSuccess: false,
      error: 'Invalid Authorization format. Expected: Bearer <token>',
    });
  }

  // 提取 token
  const token = auth.substring(7); // 去掉 "Bearer " 前缀

  // 验证 token 是否在白名单中
  if (VALID_TOKENS.includes(token)) {
    console.log(`[验证成功] Token: ${token.substring(0, 20)}...`);
    return sendJSON(res, 200, {
      isSuccess: true,
      message: 'Token is valid',
      token: token.substring(0, 20) + '...', // 返回部分 token 用于调试
    });
  } else {
    console.log(`[验证失败] 无效的 token: ${token.substring(0, 20)}...`);
    return sendJSON(res, 401, {
      isSuccess: false,
      error: 'Invalid or expired token',
    });
  }
}

// 处理 /health 请求
function handleHealth(req, res) {
  sendJSON(res, 200, {
    status: 'ok',
    service: 'mock-auth-server',
    timestamp: new Date().toISOString(),
  });
}

// 创建 HTTP 服务器
const server = http.createServer((req, res) => {
  const timestamp = new Date().toISOString();
  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;

  // 记录请求日志
  console.log(`[${timestamp}] ${req.method} ${path}`);

  // 路由处理
  if (path === '/api/validate-key' && req.method === 'GET') {
    handleValidateKey(req, res);
  } else if (path === '/health' && req.method === 'GET') {
    handleHealth(req, res);
  } else {
    // 404 Not Found
    sendJSON(res, 404, {
      error: 'Not Found',
      message: `Path ${path} not found`,
    });
  }
});

// 启动服务
server.listen(PORT, () => {
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
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ 错误：端口 ${PORT} 已被占用`);
    console.error('请运行以下命令释放端口：');
    console.error(`   lsof -ti:${PORT} | xargs kill -9\n`);
  } else {
    console.error('\n❌ 服务器错误:', err);
  }
  process.exit(1);
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n\n👋 正在关闭 Mock 鉴权服务...');
  server.close(() => {
    console.log('✓ 服务已关闭');
    process.exit(0);
  });
});
