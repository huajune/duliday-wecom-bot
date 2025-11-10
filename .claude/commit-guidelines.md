# Git Commit Message Guidelines

## 格式要求

### 标题行（必需）
```
<type>: <简洁描述>
```

- **类型**: feat, fix, refactor, docs, chore, test, style
- **描述**: 10-15字简洁说明

### 正文（可选）
```
变更内容：
- 第一项修改（10-15字）
- 第二项修改（10-15字）
- 第三项修改（10-15字）
```

### 尾注（固定）
```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

## 示例

### ✅ 好的commit
```
fix: 修复版本更新工作流分支保护冲突

变更内容：
- 改为创建PR替代直接push
- 添加PR创建权限配置
- 新建分支chore/update-version
- 使用gh CLI自动创建PR

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

### ✅ 简单commit（无需正文）
```
feat: 新增用户登录功能

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

### ❌ 不好的commit
```
fix: 升级 CI 中的 pnpm 版本到 10

## 问题
CI 安装依赖失败：ERR_PNPM_NO_LOCKFILE - Cannot install with "frozen-lockfile"

## 原因
- 本地使用 pnpm 10.16.1 生成 lockfileVersion 9.0
- CI 使用 pnpm 8，只支持到 lockfileVersion 6.x
...（太长了！）
```

## 类型说明

| 类型 | 说明 | 示例 |
|------|------|------|
| `feat` | 新功能 | feat: 添加消息合并功能 |
| `fix` | 修复bug | fix: 修复依赖安装失败问题 |
| `refactor` | 代码重构 | refactor: 优化消息处理服务 |
| `docs` | 文档更新 | docs: 更新API文档 |
| `chore` | 杂项 | chore: 更新依赖版本 |
| `test` | 测试 | test: 添加消息服务单元测试 |
| `style` | 格式化 | style: 格式化代码 |

## 原则

1. **简洁明了** - 每句10-15字
2. **直击要点** - 说明做了什么，不解释为什么
3. **列表清晰** - 多项修改用列表
4. **避免长篇** - 详细说明放在PR描述

## 何时需要正文

- ✅ 修改超过3个文件
- ✅ 涉及多个功能点
- ✅ 需要列举具体变更
- ❌ 单一简单修改
- ❌ 自解释的标题
