# DuLiDay 企业微信服务

基于 NestJS 构建的企业微信智能服务中间层，通过对接企业微信托管平台和 AI Agent 服务，实现智能化的企业微信群运营和消息管理。

## 项目简介

本项目是一个企业微信服务的中间层系统，主要解决以下问题：

- **托管平台集成**：封装企业微信托管平台的 API，提供统一的企业微信操作能力
- **AI 智能回复**：集成 花卷agent AI 服务，实现智能对话和自动回复
- **消息自动化**：接收托管平台消息回调，自动调用 AI 生成回复并发送
- **灵活可扩展**：模块化设计，支持按需启用功能和自定义业务逻辑

## 核心功能

### 1. 企业微信托管平台 API 封装

集成企业微信托管平台的完整能力：

- **消息管理**：发送/接收单聊和群聊消息，支持文本、图片、视频等多种类型
- **会话管理**：获取会话列表、查询聊天历史
- **联系人管理**：添加/删除好友、查询联系人信息
- **群聊管理**：创建群聊、邀请/移除成员、群公告等
- **客户管理**：企业客户信息管理
- **机器人管理**：机器人账号信息查询

### 2. AI 智能回复

- **自动问答**：接收消息后自动调用 AI 生成智能回复
- **上下文记忆**：支持多轮对话，维护用户会话上下文
- **场景识别**：智能识别私聊和群聊场景
- **可配置**：支持切换不同 AI 模型，可开关 AI 回复功能
- **流式响应**：支持流式和非流式两种回复模式

### 3. 消息处理流程

```
企业微信用户
    ↓ (发送消息)
企业微信托管平台
    ↓ (消息回调 POST /message)
本服务
    ├─ 解析消息内容
    ├─ 调用 AI Agent 生成回复
    └─ 通过托管平台发送回复
    ↓
企业微信用户收到 AI 回复
```

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

复制 `.env.example` 创建 `.env` 文件：

```bash
cp .env.example .env
```

编辑 `.env` 配置：

```env
# Agent AI 配置
AGENT_API_KEY=your_api_key                        # 从 https://wolian.cc 获取
AGENT_API_BASE_URL=https://api.wolian.cc/api/v1  # AI API 地址
AGENT_DEFAULT_MODEL=anthropic/claude-3-7-sonnet-20250219
ENABLE_AI_REPLY=true                              # 启用/禁用 AI 自动回复

# 托管平台配置
STRIDE_API_BASE_URL=https://stride-bg.dpclouds.com

# 应用配置
PORT=8080
NODE_ENV=production
```

### 3. 启动服务

```bash
# 开发模式（支持热重载）
pnpm run start:dev

# 生产模式
pnpm run build
pnpm run start:prod
```

### 4. 验证服务

```bash
# 健康检查
curl http://localhost:8080/agent/health

# 查看可用 AI 模型
curl http://localhost:8080/agent/models
```

## 项目架构

### 目录结构

```
duliday-wecom-service/
├── src/
│   ├── agent/                    # AI Agent 服务模块
│   │   ├── agent.service.ts     # AI 对话服务
│   │   ├── agent-config.service.ts # AI 配置管理
│   │   └── dto/                 # 数据传输对象
│   ├── common/
│   │   └── conversation/        # 会话管理（多轮对话上下文）
│   ├── core/
│   │   ├── config/              # 全局配置管理
│   │   └── http/                # 统一 HTTP 客户端
│   ├── modules/
│   │   ├── bot/                 # 机器人管理
│   │   ├── chat/                # 会话列表和聊天历史
│   │   ├── contact/             # 联系人管理
│   │   ├── customer/            # 客户管理
│   │   ├── message/             # 消息接收（回调处理）
│   │   ├── message-sender/      # 消息发送
│   │   ├── room/                # 群聊管理
│   │   └── user/                # 用户管理
│   ├── app.module.ts
│   └── main.ts
├── docs/                        # 文档目录
├── .env.example                 # 环境变量模板
└── package.json
```

### 核心模块说明

| 模块 | 职责 | 主要功能 |
|------|------|----------|
| **agent** | AI 智能服务 | AI 对话、模型管理、配置管理 |
| **conversation** | 会话管理 | 多轮对话上下文、会话 ID 管理 |
| **http** | HTTP 客户端 | 统一的 HTTP 请求封装和错误处理 |
| **message** | 消息接收 | 处理托管平台消息回调，触发 AI 回复 |
| **message-sender** | 消息发送 | 调用托管平台 API 发送消息 |
| **chat** | 会话查询 | 获取会话列表、聊天历史 |
| **contact** | 联系人管理 | 好友添加/删除、联系人查询 |
| **room** | 群聊管理 | 创建群聊、成员管理、群公告 |
| **customer** | 客户管理 | 企业客户信息管理 |
| **bot** | 机器人管理 | 机器人账号信息查询 |

## API 接口文档

### AI Agent 模块

```bash
# 健康检查
GET /agent/health

# 获取可用 AI 模型列表
GET /agent/models

# 获取可用工具列表
GET /agent/tools

# 测试聊天接口
POST /agent/test-chat
{
  "message": "你好",
  "conversationId": "test-user"
}
```

### 消息回调（核心接口）

```bash
POST /message
{
  "token": "group_token",           # 小组级 token
  "msgId": "msg-123",               # 消息 ID
  "fromUser": "wxid_xxxxx",         # 发送者微信 ID
  "content": "用户发送的消息",         # 消息内容
  "messageType": "text",            # 消息类型
  "timestamp": 1697000000000,       # 时间戳
  "isRoom": false,                  # false=私聊，true=群聊
  "roomId": ""                      # 群聊 ID（群聊时使用）
}
```

**工作流程**：
1. 托管平台收到企业微信消息后回调此接口
2. 服务解析消息并调用 AI Agent 生成回复
3. 自动通过托管平台 API 将回复发送给用户

### 消息发送

```bash
# 发送消息（单聊/群发）
POST /message-sender/send
{
  "token": "group_token",
  "content": "消息内容",
  "toWxid": "wxid_xxxxx",          # 接收者微信 ID
  "msgType": 1                     # 1=文本，3=图片，34=语音，43=视频
}

# 群发消息
POST /message-sender/broadcast
{
  "token": "group_token",
  "content": "群发消息内容",
  "toWxids": ["wxid_1", "wxid_2"], # 接收者列表
  "msgType": 1
}
```

### 会话管理

```bash
# 获取会话列表
GET /chat/list?token={token}&pageSize=20&iterator={cursor}

# 获取聊天历史
GET /chat/history?token={token}&snapshotDay=2025-01-15&pageSize=100&seq={seq}
```

### 联系人管理

```bash
# 添加好友
POST /contact/add
{
  "token": "group_token",
  "wxid": "wxid_xxxxx",           # 目标微信 ID
  "content": "你好，我是..."      # 验证消息
}

# 删除好友
POST /contact/delete
{
  "token": "group_token",
  "wxid": "wxid_xxxxx"
}

# 获取联系人列表
GET /contact/list?token={token}
```

### 群聊管理

```bash
# 创建群聊
POST /room/create
{
  "token": "group_token",
  "wxids": ["wxid_1", "wxid_2"]   # 群成员列表
}

# 邀请入群
POST /room/add-member
{
  "token": "group_token",
  "roomId": "room_xxxxx@chatroom",
  "wxids": ["wxid_3"]
}

# 移除成员
POST /room/remove-member
{
  "token": "group_token",
  "roomId": "room_xxxxx@chatroom",
  "wxid": "wxid_3"
}
```

详细 API 文档请查看：
- [Agent API 使用指南](./docs/huajune-agent-api-guide.md)
- [Agent 服务架构](./docs/agent-service-architecture.md)
- [消息服务架构](./docs/message-service-architecture.md)

## 配置说明

### 多环境配置支持

项目支持开发、测试、生产三种环境的独立配置：

| 配置文件 | 用途 | 使用命令 |
|---------|------|----------|
| `.env.development` | 开发环境 | `pnpm run start:dev` |
| `.env.production` | 生产环境 | `pnpm run start:prod` |
| `.env.test` | 测试环境 | `pnpm run test` |
| `.env` | 本地覆盖配置（可选） | - |

### 主要环境变量

| 变量 | 说明 | 默认值 | 必填 |
|------|------|--------|------|
| `AGENT_API_KEY` | AI Agent API 密钥 | - | ✅ |
| `AGENT_API_BASE_URL` | AI API 地址 | http://localhost:3000/api/v1 | ✅ |
| `AGENT_DEFAULT_MODEL` | 默认 AI 模型 | anthropic/claude-3-7-sonnet-20250219 | ❌ |
| `AGENT_API_TIMEOUT` | Agent API 超时时间（ms） | 60000 | ❌ |
| `ENABLE_AI_REPLY` | 启用 AI 自动回复 | true | ❌ |
| `STRIDE_API_BASE_URL` | 托管平台 API 地址 | https://stride-bg.dpclouds.com | ✅ |
| `PORT` | 服务端口 | 8080 | ❌ |
| `NODE_ENV` | 运行环境 | development | ❌ |
| `CONVERSATION_MAX_MESSAGES` | 会话最大消息数 | 20 | ❌ |
| `CONVERSATION_TIMEOUT_MS` | 会话超时时间（ms） | 7200000 | ❌ |
| `HTTP_CLIENT_TIMEOUT` | HTTP 请求超时时间（ms） | 10000 | ❌ |

### 快速配置

**1. 初始化配置文件**
```bash
# 复制模板文件（首次使用）
cp .env.example .env

# 编辑配置，填入你的 API Key
vim .env
```

**2. 获取 Agent API Key**
- 访问 https://wolian.cc/platform/clients-management
- 注册并创建 API Key
- 将 Key 填入配置文件的 `AGENT_API_KEY`

**3. 配置托管平台**
- 获取小组级或企业级 Token
- 在托管平台后台配置消息回调地址：`http://your-domain.com/message`
- 确认 `STRIDE_API_BASE_URL` 配置正确

## 测试

### 运行测试

```bash
# 单元测试
pnpm run test

# 端到端测试
pnpm run test:e2e

# AI 集成测试
pnpm run test:ai
```

### 手动测试

**1. 测试 AI 对话**

```bash
curl -X POST http://localhost:8080/agent/test-chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "你好，请介绍一下你自己",
    "conversationId": "test-001"
  }'
```

**2. 模拟消息回调**

```bash
curl -X POST http://localhost:8080/message \
  -H "Content-Type: application/json" \
  -d '{
    "token": "test-token",
    "msgId": "msg-001",
    "fromUser": "wxid_test",
    "content": "你好",
    "messageType": "text",
    "timestamp": 1697000000000,
    "isRoom": false
  }'
```

**3. 测试多轮对话**

```bash
# 第一轮
curl -X POST http://localhost:8080/message \
  -H "Content-Type: application/json" \
  -d '{
    "fromUser": "wxid_test",
    "content": "我叫张三",
    "messageType": "text"
  }'

# 第二轮（测试上下文记忆）
curl -X POST http://localhost:8080/message \
  -H "Content-Type: application/json" \
  -d '{
    "fromUser": "wxid_test",
    "content": "我叫什么名字？",
    "messageType": "text"
  }'
```

## 部署

### 使用 PM2

```bash
pnpm run build
pm2 start dist/main.js --name duliday-wecom-service
pm2 save
```

### 使用 Docker

```bash
# 构建镜像
docker build -t duliday-wecom-service .

# 运行容器
docker run -d \
  -p 8080:8080 \
  --env-file .env \
  --name wecom-service \
  duliday-wecom-service
```

### 使用 Docker Compose

```bash
docker-compose up -d
```

## 开发指南

### 添加新的业务模块

1. 在 `src/modules/` 下创建新模块目录
2. 创建必要的文件：
   ```
   your-module/
   ├── your-module.module.ts
   ├── your-module.service.ts
   ├── your-module.controller.ts
   └── dto/
   ```
3. 在 `app.module.ts` 中导入新模块

### 自定义消息处理逻辑

在 `src/modules/message/message.service.ts` 中扩展：

```typescript
async processMessage(messageData) {
  // 自定义过滤逻辑
  if (this.shouldIgnore(messageData.content)) {
    return { success: false, reason: '忽略此消息' };
  }

  // 调用 AI 生成回复
  const reply = await this.agentService.generateReply(
    messageData.content,
    messageData.fromUser
  );

  // 发送回复
  await this.messageSenderService.sendMessage({
    token: messageData.token,
    content: reply,
    toWxid: messageData.fromUser
  });

  return { success: true };
}
```

### 集成新的 AI 服务

在 `src/agent/agent.service.ts` 中修改 AI 调用逻辑：

```typescript
async generateReply(message: string, userId: string) {
  // 获取或创建会话 ID
  const conversationId = this.conversationService.getOrCreate(userId);

  // 调用 AI API
  const response = await this.httpService.post('/chat', {
    message,
    conversationId,
    model: this.configService.get('AGENT_DEFAULT_MODEL')
  });

  return response.data.reply;
}
```

## 日志

日志文件位于 `logs/` 目录：

- `combined-YYYY-MM-DD.log` - 所有日志
- `error-YYYY-MM-DD.log` - 错误日志

查看实时日志：

```bash
tail -f logs/combined-$(date +%Y-%m-%d).log
```

## 常见问题

### 1. AI 回复不工作

- 检查 `ENABLE_AI_REPLY` 是否为 `true`
- 验证 `AGENT_API_KEY` 是否有效
- 查看日志确认 AI API 调用是否成功

### 2. 托管平台连接失败

- 确认 `STRIDE_API_BASE_URL` 地址正确
- 检查 token 是否有效
- 验证网络连接是否正常

### 3. 消息回调未触发

- 确认托管平台已配置回调 URL
- 检查服务是否正常运行在配置的端口
- 查看托管平台后台的回调日志

## 版本管理

本项目使用 **GitHub Actions 自动化版本管理系统**：

- **自动触发**：推送到 `develop`/`main`/`master` 分支时自动更新版本
- **智能判断**：根据 Conventional Commits 规范自动确定版本号
  - `feat:` → 次版本 +1
  - `fix:` → 修订号 +1
  - `BREAKING CHANGE` → 主版本 +1
- **自动生成**：自动更新 `package.json` 和 `CHANGELOG.md`

详细说明请查看：[自动化版本管理文档](./docs/auto-version-changelog.md)

### 提交规范

请遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

```bash
# 新功能
git commit -m "feat: 添加用户认证功能"

# Bug 修复
git commit -m "fix: 修复消息发送失败问题"

# 文档更新
git commit -m "docs: 更新 API 文档"
```

## 技术栈

- **框架**：NestJS 10.x
- **语言**：TypeScript 5.x
- **HTTP 客户端**：Axios
- **日志**：Winston
- **配置管理**：@nestjs/config
- **文档**：Swagger
- **CI/CD**：GitHub Actions

## 相关资源

- **托管平台 API 文档**
  - [企业级 API](https://s.apifox.cn/34adc635-40ac-4161-8abb-8cd1eea9f445)
  - [小组级 API](https://s.apifox.cn/acec6592-fec1-443b-8563-10c4a10e64c4)
- **Agent API 文档**：https://docs.wolian.cc/
- **NestJS 文档**：https://docs.nestjs.com/

## 许可证

ISC

## 贡献

欢迎提交 Issue 和 Pull Request！

---

**需要帮助？** 查看 [完整文档](./docs/README.md) 或提交 Issue。
