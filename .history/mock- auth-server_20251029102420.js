/**
 * Mock 鉴权服务器
 * 用于本地开发测试 Open API 鉴权功能
 *
 * 使用方法:
 * 1. 启动服务: node mock-auth-server.js
 * 2. 在 花卷agent 项目设置: OPEN_API_AUTH_URL=http://localhost:3001/api/validate-key
 * 3. 调用 API 时使用 token: Bearer test-token
 */

import express from 'express';
const app = express();

// 测试用的有效 token 列表
const VALID_TOKENS = [
  'test-token', // 基础测试 token
  'dev-token', // 开发用 token
  'demo-token', // 演示用 token
];

app.get('/api/validate-key', (req, res) => {
  const auth = req.headers.authorization;

  console.log(`[Mock Auth] Received request with Authorization: ${auth || '(missing)'}`);

  // 检查是否有 Authorization header
  if (!auth) {
    console.log('[Mock Auth] ❌ Missing authorization header');
    return res.status(401).json({
      isSuccess: false,
      message: 'Missing authorization header',
    });
  }

  // 检查格式是否为 "Bearer <token>"
  if (!auth.startsWith('Bearer ')) {
    console.log('[Mock Auth] ❌ Invalid authorization format');
    return res.status(401).json({
      isSuccess: false,
      message: 'Invalid authorization format. Use: Bearer <token>',
    });
  }

  // 提取 token
  const token = auth.substring(7); // 移除 "Bearer " 前缀

  // 验证 token
  if (VALID_TOKENS.includes(token)) {
    console.log(`[Mock Auth] ✅ Token validated: ${token}`);
    res.json({
      isSuccess: true,
      token: token,
      message: 'Token is valid',
    });
  } else {
    console.log(`[Mock Auth] ❌ Invalid token: ${token}`);
    res.status(401).json({
      isSuccess: false,
      message: 'Invalid or expired token',
    });
  }
});

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'mock-auth-server' });
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log(`🚀 Mock Auth Server is running on http://localhost:${PORT}`);
  console.log('='.repeat(60));
  console.log('\n📋 Valid test tokens:');
  VALID_TOKENS.forEach((token) => {
    console.log(`   - Bearer ${token}`);
  });
  console.log('\n📝 Example curl command:');
  console.log(`   curl -H "Authorization: Bearer test-token" \\`);
  console.log(`        http://localhost:3000/api/v1/tools`);
  console.log('\n💡 Remember to set in 花卷agent .env:');
  console.log(`   OPEN_API_AUTH_URL=http://localhost:3001/api/validate-key`);
  console.log('='.repeat(60));
});
