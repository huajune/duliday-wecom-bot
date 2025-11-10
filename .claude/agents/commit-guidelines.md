# Git Commit Message Guidelines

## Format Requirements

### Title Line (Required)
```
<type>: <concise description in 10-15 characters>
```

- **Type**: feat, fix, refactor, docs, chore, test, style
- **Description**: Brief explanation in 10-15 Chinese characters

### Body (Optional)
```
变更内容：
- First change (10-15 characters)
- Second change (10-15 characters)
- Third change (10-15 characters)
```

### Footer (Fixed)
```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

## Examples

### ✅ Good Commit
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

### ✅ Simple Commit (No Body Needed)
```
feat: 新增用户登录功能

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

### ❌ Bad Commit (Too Verbose)
```
fix: 升级 CI 中的 pnpm 版本到 10

## 问题
CI 安装依赖失败：ERR_PNPM_NO_LOCKFILE - Cannot install with "frozen-lockfile"

## 原因
- 本地使用 pnpm 10.16.1 生成 lockfileVersion 9.0
- CI 使用 pnpm 8，只支持到 lockfileVersion 6.x
...（TOO LONG!）
```

## Commit Types

| Type | Purpose | Example |
|------|---------|---------|
| `feat` | New feature | feat: 添加消息合并功能 |
| `fix` | Bug fix | fix: 修复依赖安装失败问题 |
| `refactor` | Code refactoring | refactor: 优化消息处理服务 |
| `docs` | Documentation | docs: 更新API文档 |
| `chore` | Maintenance | chore: 更新依赖版本 |
| `test` | Testing | test: 添加消息服务单元测试 |
| `style` | Formatting | style: 格式化代码 |

## Principles

1. **Keep it concise** - Each line 10-15 characters
2. **State what was done** - Don't explain why
3. **Use bullet lists** - For multiple changes
4. **Avoid lengthy explanations** - Put details in PR description

## When to Include Body

- ✅ Changes affect 3+ files
- ✅ Multiple functional changes
- ✅ Need to list specific modifications
- ❌ Single simple change
- ❌ Self-explanatory title

## Critical Rules

1. **ALWAYS** keep title under 15 Chinese characters
2. **ALWAYS** use bullet points for body items (10-15 chars each)
3. **NEVER** write long paragraphs explaining reasons
4. **NEVER** include detailed technical explanations in commit
5. **DO** fix problems instead of disabling features
6. **DO** try multiple solutions before giving up
