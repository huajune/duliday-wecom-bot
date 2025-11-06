/* eslint-disable @typescript-eslint/no-var-requires */
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

// 发送 HTML 响应的辅助函数
function sendHTML(res, statusCode, html) {
  res.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

// 处理根路径 - 显示欢迎页
function handleRoot(req, res) {
  const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mock 鉴权服务</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      max-width: 800px;
      width: 100%;
      padding: 40px;
    }
    h1 {
      color: #667eea;
      font-size: 32px;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .subtitle {
      color: #666;
      margin-bottom: 30px;
      font-size: 14px;
    }
    .status {
      background: #d4edda;
      border: 1px solid #c3e6cb;
      color: #155724;
      padding: 12px 20px;
      border-radius: 6px;
      margin-bottom: 30px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .section {
      margin-bottom: 30px;
    }
    .section h2 {
      color: #333;
      font-size: 20px;
      margin-bottom: 15px;
      border-bottom: 2px solid #667eea;
      padding-bottom: 8px;
    }
    .endpoint {
      background: #f8f9fa;
      border-left: 4px solid #667eea;
      padding: 15px;
      margin-bottom: 10px;
      border-radius: 4px;
    }
    .endpoint-method {
      display: inline-block;
      background: #667eea;
      color: white;
      padding: 4px 12px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: bold;
      margin-right: 10px;
    }
    .endpoint-path {
      color: #333;
      font-family: 'Courier New', monospace;
      font-weight: 600;
    }
    .endpoint-desc {
      color: #666;
      margin-top: 8px;
      font-size: 14px;
    }
    .code {
      background: #282c34;
      color: #abb2bf;
      padding: 15px;
      border-radius: 6px;
      overflow-x: auto;
      font-family: 'Courier New', monospace;
      font-size: 13px;
      line-height: 1.6;
    }
    .code-comment { color: #5c6370; }
    .code-string { color: #98c379; }
    .token-list {
      list-style: none;
      padding: 0;
    }
    .token-list li {
      background: #f8f9fa;
      padding: 10px 15px;
      margin-bottom: 8px;
      border-radius: 4px;
      font-family: 'Courier New', monospace;
      font-size: 13px;
      border-left: 3px solid #28a745;
    }
    .footer {
      text-align: center;
      color: #999;
      font-size: 12px;
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #eee;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔐 Mock 鉴权服务</h1>
    <div class="subtitle">用于本地开发的 API Key 验证模拟服务</div>

    <div class="status">
      <span>✅</span>
      <div>
        <strong>服务运行中</strong><br>
        <small>端口: ${PORT} | 启动时间: ${new Date().toLocaleString('zh-CN')}</small>
      </div>
    </div>

    <div class="section">
      <h2>📍 可用端点</h2>

      <div class="endpoint">
        <span class="endpoint-method">GET</span>
        <span class="endpoint-path">/api/validate-key</span>
        <div class="endpoint-desc">验证 API Key，需要提供 Authorization header</div>
      </div>

      <div class="endpoint">
        <span class="endpoint-method">GET</span>
        <span class="endpoint-path">/health</span>
        <div class="endpoint-desc">健康检查，返回服务状态</div>
      </div>
    </div>

    <div class="section">
      <h2>🔑 有效的测试 Tokens</h2>
      <ul class="token-list">
        ${VALID_TOKENS.map(token => `<li>${token.length > 30 ? token.substring(0, 30) + '...' : token}</li>`).join('')}
      </ul>
    </div>

    <div class="section">
      <h2>📝 使用示例</h2>
      <div class="code"><span class="code-comment"># 测试健康检查</span>
curl http://localhost:${PORT}/health

<span class="code-comment"># 验证 token（成功）</span>
curl -H <span class="code-string">"Authorization: Bearer test-token"</span> \\
     http://localhost:${PORT}/api/validate-key

<span class="code-comment"># 测试 Agent API（完整流程）</span>
curl -H <span class="code-string">"Authorization: Bearer test-token"</span> \\
     http://localhost:3000/api/v1/tools
</div>
    </div>

    <div class="section">
      <h2>⚙️ Agent 配置</h2>
      <div class="endpoint-desc" style="margin-bottom: 10px;">
        在 agent 项目的 <code>.env.local</code> 中配置：
      </div>
      <div class="code">OPEN_API_AUTH_URL=http://localhost:${PORT}/api/validate-key</div>
    </div>

    <div class="footer">
      Mock Auth Server v1.0 | DuLiDay Team
    </div>
  </div>
</body>
</html>
  `;
  sendHTML(res, 200, html);
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
    port: PORT,
  });
}

// 创建 HTTP 服务器
const server = http.createServer((req, res) => {
  const timestamp = new Date().toISOString();
  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;

  // 记录请求日志（排除 favicon.ico）
  if (path !== '/favicon.ico') {
    console.log(`[${timestamp}] ${req.method} ${path}`);
  }

  // 路由处理
  if (path === '/' && req.method === 'GET') {
    handleRoot(req, res);
  } else if (path === '/api/validate-key' && req.method === 'GET') {
    handleValidateKey(req, res);
  } else if (path === '/health' && req.method === 'GET') {
    handleHealth(req, res);
  } else if (path === '/favicon.ico') {
    // 忽略 favicon 请求
    res.writeHead(204);
    res.end();
  } else {
    // 404 Not Found
    sendJSON(res, 404, {
      error: 'Not Found',
      message: `Path ${path} not found`,
      availableEndpoints: [
        'GET /',
        'GET /api/validate-key',
        'GET /health',
      ],
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
  console.log('\n💡 提示：在浏览器访问 http://localhost:' + PORT + ' 查看欢迎页面\n');
  console.log('等待请求...\n');
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
