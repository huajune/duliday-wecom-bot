# 开发指南

本文档提供完整的开发流程、最佳实践和团队协作规范。

## 目录

- [开发环境设置](#开发环境设置)
- [开发流程](#开发流程)
- [代码规范](#代码规范)
- [Git 工作流](#git-工作流)
- [测试指南](#测试指南)
- [调试技巧](#调试技巧)
- [常见问题](#常见问题)

---

## 开发环境设置

### 前置要求

- **Node.js**: >= 18.x
- **pnpm**: >= 8.x
- **Git**: >= 2.x

### 安装步骤

```bash
# 1. 克隆项目
git clone <repository-url>
cd duliday-wecom-service

# 2. 安装依赖
pnpm install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env 文件，填入必要配置

# 4. 启动开发服务
pnpm run start:dev
```

### Git Hooks 自动安装

项目使用 **husky** 管理 Git hooks，`pnpm install` 时会自动安装：

- **pre-commit**: 提交前自动运行 lint、format 和 test
- **pre-push**: 禁止直接推送到 master 分支

---

## 开发流程

### 1. 创建功能分支

```bash
# 从 develop 分支创建新分支
git checkout develop
git pull origin develop
git checkout -b feature/your-feature-name
```

分支命名规范：

- `feature/xxx`: 新功能
- `fix/xxx`: Bug 修复
- `docs/xxx`: 文档更新
- `refactor/xxx`: 代码重构
- `test/xxx`: 测试相关

### 2. 开发代码

```bash
# 启动开发服务器（支持热重载）
pnpm run start:dev

# 修改代码...

# 查看实时日志
tail -f logs/combined-$(date +%Y-%m-%d).log
```

### 3. 代码质量检查

项目配置了 **Git hooks**，会在 commit 时自动运行：

```bash
# commit 时自动执行：
# 1. lint-staged: 对暂存文件运行 eslint 和 prettier
# 2. pnpm run test: 运行所有测试

git add .
git commit -m "feat: 添加新功能"
```

如果需要手动运行检查：

```bash
# 代码检查并自动修复
pnpm run lint

# 代码格式化
pnpm run format

# 运行测试
pnpm run test

# 测试覆盖率
pnpm run test:cov
```

### 4. 提交代码

遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

```bash
# 格式：<type>(<scope>): <subject>

# 示例：
git commit -m "feat: 添加候选人咨询场景"          # 新功能（次版本号 +1）
git commit -m "fix: 修复消息发送失败问题"        # Bug 修复（修订号 +1）
git commit -m "docs: 更新 API 文档"              # 文档更新
git commit -m "refactor: 重构 Agent 服务"        # 代码重构
git commit -m "test: 添加消息服务单元测试"       # 测试
git commit -m "chore: 更新依赖版本"              # 构建/工具变更
```

**Commit Type 说明**：

| Type       | 说明                              | 版本号变化 |
| ---------- | --------------------------------- | ---------- |
| `feat`     | 新功能                            | 次版本 +1  |
| `fix`      | Bug 修复                          | 修订号 +1  |
| `docs`     | 文档更新                          | 无         |
| `style`    | 代码格式（不影响代码运行）        | 无         |
| `refactor` | 重构（既不是新增功能也不是修复）  | 无         |
| `perf`     | 性能优化                          | 修订号 +1  |
| `test`     | 添加或修改测试                    | 无         |
| `chore`    | 构建过程或辅助工具的变动          | 无         |

### 5. 推送代码

```bash
# 推送到远程分支
git push origin feature/your-feature-name

# 如果尝试推送 master 分支，Git hook 会阻止
# ❌ git push origin master  # 被禁止
```

### 6. 创建 Pull Request

1. 在 GitHub/GitLab 上创建 Pull Request
2. 目标分支选择 `develop`
3. 填写 PR 描述，说明改动内容
4. 等待代码审查
5. 审查通过后合并到 `develop`

---

## 代码规范

### TypeScript 规范

项目使用 **ESLint** 和 **Prettier** 自动检查和格式化代码。

**配置文件**：

- `.eslintrc.js`: ESLint 规则
- `.prettierrc`: Prettier 格式化规则

**自动格式化**（推荐）：

在 VS Code 中安装插件并配置保存时自动格式化：

```json
// .vscode/settings.json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  }
}
```

### 命名规范

**文件命名**：

- 模块文件：`kebab-case.module.ts`
- 服务文件：`kebab-case.service.ts`
- 控制器：`kebab-case.controller.ts`
- 接口：`kebab-case.interface.ts`

**代码命名**：

- 类名：`PascalCase`
- 接口：`PascalCase`
- 变量/函数：`camelCase`
- 常量：`UPPER_SNAKE_CASE`
- 私有属性：`private readonly`

**示例**：

```typescript
// ✅ 正确
export class MessageService {
  private readonly logger = new Logger(MessageService.name);

  async sendMessage(content: string): Promise<void> {
    // ...
  }
}

// ❌ 错误
export class message_service {
  public Logger = new Logger('MessageService');

  async SendMessage(Content: string): Promise<void> {
    // ...
  }
}
```

### 注释规范

**类和方法注释**：

```typescript
/**
 * 消息发送服务
 *
 * 职责：
 * 1. 通过托管平台发送消息给用户
 * 2. 支持单发和群发
 * 3. 处理消息发送失败重试
 */
@Injectable()
export class MessageSenderService {
  /**
   * 发送消息给指定用户
   *
   * @param token - 小组 token
   * @param content - 消息内容
   * @param toWxid - 目标微信 ID
   * @returns 发送结果
   */
  async sendMessage(token: string, content: string, toWxid: string): Promise<boolean> {
    // ...
  }
}
```

**复杂逻辑注释**：

```typescript
// ❌ 不要写显而易见的注释
const count = messages.length; // 获取消息数量

// ✅ 解释为什么这样做
// 限制最多保留 30 条历史消息，避免上下文过长影响 AI 响应质量
const recentMessages = messages.slice(-30);
```

---

## Git 工作流

### 分支策略

```
master (主分支，生产环境)
  ↑
develop (开发分支)
  ↑
feature/xxx (功能分支)
fix/xxx (修复分支)
```

**分支说明**：

- **master**: 生产环境分支，只接受来自 `develop` 的合并
- **develop**: 开发分支，所有功能分支合并到这里
- **feature/xxx**: 功能开发分支，从 `develop` 创建
- **fix/xxx**: Bug 修复分支，从 `develop` 创建

### 版本发布流程

```bash
# 1. 将 develop 合并到 master
git checkout master
git pull origin master
git merge develop

# 2. 推送到远程（触发 CI/CD）
git push origin master

# 3. GitHub Actions 自动执行：
#    - 分析 commits 更新版本号
#    - 生成 CHANGELOG.md
#    - 创建版本 tag (v1.2.3)
#    - 触发部署流程
```

### Git Hooks

项目使用 **husky** 配置了以下 hooks：

#### pre-commit（提交前检查）

自动运行：

1. **lint-staged**: 对暂存区文件运行 eslint 和 prettier
2. **pnpm run test**: 运行所有测试

```bash
# .husky/pre-commit
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# 对暂存区文件运行 lint 和 format
echo "Running lint-staged..."
pnpm exec lint-staged || exit 1

# 运行测试
echo "Running tests..."
pnpm run test || exit 1

echo "✅ All checks passed!"
```

#### pre-push（推送前检查）

禁止直接推送到 master 分支：

```bash
# .husky/pre-push
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

current_branch=$(git symbolic-ref HEAD | sed -e 's,.*/\(.*\),\1,')

if [ "$current_branch" = "master" ]; then
  echo "❌ ERROR: Direct push to master branch is not allowed!"
  echo "Please create a feature branch and submit a pull request."
  exit 1
fi

echo "✅ Pre-push check passed!"
```

#### 跳过 Hooks（紧急情况）

```bash
# 跳过 pre-commit 检查（不推荐）
git commit --no-verify -m "emergency fix"

# 跳过 pre-push 检查（不推荐）
git push --no-verify origin feature/xxx
```

---

## 测试指南

### 单元测试

```bash
# 运行所有测试
pnpm run test

# 监听模式（开发时推荐）
pnpm run test:watch

# 生成覆盖率报告
pnpm run test:cov
```

### 编写测试

**测试文件命名**：`*.spec.ts`

**示例**：

```typescript
// message-sender.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { MessageSenderService } from './message-sender.service';

describe('MessageSenderService', () => {
  let service: MessageSenderService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MessageSenderService],
    }).compile();

    service = module.get<MessageSenderService>(MessageSenderService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should send message successfully', async () => {
    const result = await service.sendMessage('token', 'content', 'wxid_123');
    expect(result).toBe(true);
  });
});
```

### API 测试

使用 `api-test.http` 文件测试接口（需要 REST Client 插件）：

```http
### 健康检查
GET http://localhost:8080/agent/health

### 测试聊天
POST http://localhost:8080/agent/test-chat
Content-Type: application/json

{
  "message": "你好",
  "conversationId": "test-001"
}
```

---

## 调试技巧

### VS Code 调试

配置 `.vscode/launch.json`：

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug NestJS",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["run", "start:dev"],
      "console": "integratedTerminal"
    }
  ]
}
```

使用方法：

1. 在代码中设置断点（点击行号左侧）
2. 按 `F5` 启动调试
3. 程序会在断点处暂停

### 日志调试

```typescript
// 使用 Logger
import { Logger } from '@nestjs/common';

export class MessageService {
  private readonly logger = new Logger(MessageService.name);

  async handleMessage(message: string) {
    this.logger.log(`收到消息: ${message}`);
    this.logger.debug(`详细信息: ${JSON.stringify(message)}`);
    this.logger.error(`错误信息: ${error.message}`, error.stack);
  }
}
```

查看日志：

```bash
# 查看实时日志
tail -f logs/combined-$(date +%Y-%m-%d).log

# 查看错误日志
tail -f logs/error-$(date +%Y-%m-%d).log

# 过滤特定内容
tail -f logs/combined-*.log | grep "MessageService"
```

---

## 常见问题

### 端口被占用

```bash
# 查找占用端口的进程
lsof -i :8080

# 杀死进程
kill -9 <PID>

# 或修改 .env 中的 PORT
PORT=8081
```

### 依赖安装失败

```bash
# 清理缓存重新安装
pnpm store prune
rm -rf node_modules
pnpm install
```

### 热重载不工作

```bash
# 清理 dist 目录重新启动
rm -rf dist
pnpm run start:dev
```

### Git hooks 不生效

```bash
# 重新安装 husky
rm -rf .husky
pnpm exec husky init
```

### 测试失败

```bash
# 查看详细错误信息
pnpm run test -- --verbose

# 只运行特定测试文件
pnpm run test -- message.service.spec.ts

# 更新快照
pnpm run test -- -u
```

---

## 相关文档

- [README.md](../README.md) - 项目概览和快速开始
- [Agent 服务架构](./agent-service-architecture.md)
- [消息服务架构](./message-service-architecture.md)
- [Agent API 使用指南](./huajune-agent-api-guide.md)
- [自动版本和 Changelog 管理](./auto-version-changelog.md)

---

**祝开发愉快！** 🚀
