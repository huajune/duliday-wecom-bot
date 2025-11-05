# 自动化版本管理和 CHANGELOG 系统

本文档说明项目的自动化版本管理和 CHANGELOG 更新系统。

## 📋 目录

- [工作原理](#工作原理)
- [触发机制](#触发机制)
- [版本号规则](#版本号规则)
- [提交信息规范](#提交信息规范)
- [使用示例](#使用示例)
- [本地测试](#本地测试)
- [注意事项](#注意事项)

---

## 🔄 工作原理

当 `develop` 分支合并到 `main`/`master` 分支时，GitHub Actions 会自动：

1. **分析提交历史** - 检查从上次版本 tag 以来的所有 commits
2. **判断版本类型** - 根据 Conventional Commits 规范确定版本更新级别
3. **更新版本号** - 自动修改 [package.json](../package.json) 中的 `version` 字段
4. **生成 CHANGELOG** - 在 [CHANGELOG.md](../CHANGELOG.md) 中添加新版本记录
5. **自动提交** - 将更新提交并推送回远程仓库
6. **创建 Git Tag** - 自动创建版本 tag（如 v1.2.3）并推送

**文件结构：**
```
.github/
└── workflows/
    └── version-changelog.yml    # GitHub Actions 工作流配置

scripts/
└── update-version-changelog.js  # 版本和 CHANGELOG 更新脚本
```

---

## 🎯 触发机制

### 自动触发条件

GitHub Actions 只在 **`main`/`master` 分支**接收到推送时自动运行：

```yaml
on:
  push:
    branches:
      - main        # 推送到 main 分支
      - master      # 推送到 master 分支
```

### 典型场景

**推荐流程**：develop → master

1. **在 develop 分支开发**
   ```bash
   git checkout develop
   git add .
   git commit -m "feat: 添加新功能"
   git push origin develop
   ```

2. **合并到 master 触发版本更新**
   ```bash
   # 方式 1: 通过 Pull Request（推荐）
   # 在 GitHub 上创建 develop → master 的 PR 并合并
   # → 自动触发版本更新、生成 CHANGELOG、创建 Tag

   # 方式 2: 本地合并
   git checkout master
   git pull origin master
   git merge develop
   git push origin master
   # → 自动触发版本更新、生成 CHANGELOG、创建 Tag
   ```

---

## 📦 版本号规则

项目遵循 **[语义化版本](https://semver.org/lang/zh-CN/)** (Semantic Versioning)：

### 版本格式

```
主版本号.次版本号.修订号
  MAJOR . MINOR . PATCH
```

### 更新规则

| 提交类型 | 版本影响 | 示例 | 说明 |
|---------|---------|------|------|
| `BREAKING CHANGE` | 主版本 +1 | `1.2.3` → `2.0.0` | 不兼容的 API 变更 |
| `feat:` | 次版本 +1 | `1.2.3` → `1.3.0` | 新增功能（向下兼容） |
| `fix:` | 修订号 +1 | `1.2.3` → `1.2.4` | Bug 修复 |
| 其他类型 | 修订号 +1 | `1.2.3` → `1.2.4` | 其他更新 |

### 版本示例

**场景 1：新增功能**
```bash
# 提交信息
feat: 添加消息批量发送功能

# 当前版本: 1.2.3
# 新版本: 1.3.0
```

**场景 2：修复 Bug**
```bash
# 提交信息
fix: 修复消息发送失败的问题

# 当前版本: 1.2.3
# 新版本: 1.2.4
```

**场景 3：破坏性变更**
```bash
# 提交信息
feat: 重构 API 接口

BREAKING CHANGE: 移除了旧的 /api/v1 接口

# 当前版本: 1.2.3
# 新版本: 2.0.0
```

---

## 📝 提交信息规范

### Conventional Commits 格式

```
<类型>[可选范围]: <描述>

[可选正文]

[可选脚注]
```

### 提交类型

| 类型 | 说明 | CHANGELOG 分组 | 图标 |
|------|------|---------------|------|
| `feat` | 新功能 | ✨ 新功能 | ✨ |
| `fix` | Bug 修复 | 🐛 Bug 修复 | 🐛 |
| `perf` | 性能优化 | ⚡ 性能优化 | ⚡ |
| `refactor` | 代码重构 | 🔧 重构 | 🔧 |
| `docs` | 文档更新 | 📝 文档 | 📝 |
| `style` | 代码格式 | 🔨 其他更新 | 🎨 |
| `test` | 测试相关 | ✅ 测试 | ✅ |
| `chore` | 构建/工具 | 🔨 其他更新 | 🔨 |

### 提交示例

#### ✅ 好的提交

```bash
# 新功能
git commit -m "feat: 添加用户认证功能"
git commit -m "feat(auth): 支持 OAuth2 登录"

# Bug 修复
git commit -m "fix: 修复消息发送失败问题"
git commit -m "fix(agent): 解决 Agent 超时错误"

# 破坏性变更
git commit -m "feat: 重构 API 接口

BREAKING CHANGE: 移除了 /api/v1 端点，请使用 /api/v2"
```

#### ❌ 不好的提交

```bash
# 太简略
git commit -m "update"
git commit -m "fix bug"
git commit -m "改了一些东西"

# 没有遵循规范
git commit -m "添加新功能"     # 应该是 "feat: 添加新功能"
git commit -m "修复问题"       # 应该是 "fix: 修复XXX问题"
```

---

## 💡 使用示例

### 完整开发流程

#### 1. 创建功能分支

```bash
git checkout -b feature/new-feature
```

#### 2. 开发并提交（遵循规范）

```bash
# 添加新功能
git add .
git commit -m "feat: 添加消息去重功能"

# 修复 Bug
git add .
git commit -m "fix: 修复消息重复发送问题"
```

#### 3. 推送并创建 PR

```bash
git push origin feature/new-feature
# 在 GitHub 上创建 Pull Request
```

#### 4. 合并到 develop

```bash
# 在 GitHub 上合并 PR
# 或者本地合并：
git checkout develop
git pull origin develop
git merge feature/new-feature
git push origin develop
```

#### 5. 合并到 master 发布版本

```bash
# 方式 1: GitHub PR（推荐）
# 在 GitHub 创建 develop → master 的 PR 并合并

# 方式 2: 本地合并
git checkout master
git pull origin master
git merge develop
git push origin master
```

#### 6. 自动化流程开始 🚀

一旦代码推送到 `master` 分支：

1. GitHub Actions 自动触发
2. 分析所有新的 commits
3. 更新版本号（如 `1.2.3` → `1.3.0`）
4. 更新 CHANGELOG.md
5. 自动提交：`chore: update version and changelog [skip ci]`
6. 推送回 master 分支
7. 创建并推送 Git Tag：`v1.3.0`

---

## 🧪 本地测试

在推送到远程之前，可以在本地测试脚本：

### 安装依赖

```bash
pnpm install
```

### 运行脚本

```bash
node scripts/update-version-changelog.js
```

### 查看生成的内容

```bash
# 查看版本号
cat package.json | grep version

# 查看 CHANGELOG
cat CHANGELOG.md
```

### 还原更改（如果需要）

```bash
git restore package.json CHANGELOG.md
```

---

## ⚠️ 注意事项

### 1. 提交信息格式

**必须遵循 Conventional Commits 规范**，否则版本判断可能不准确。

```bash
# ✅ 正确
git commit -m "feat: 添加新功能"

# ❌ 错误（不会被识别为 feat）
git commit -m "添加新功能"
```

### 2. 避免无限循环

GitHub Actions 自动提交时会添加 `[skip ci]` 标记：

```bash
chore: update version and changelog [skip ci]
```

这样可以防止再次触发 Actions，避免无限循环。

### 3. 分支保护

如果启用了分支保护规则，需要确保：

- GitHub Actions 有 `contents: write` 权限
- 或者在分支保护设置中允许 bot 直接推送

### 4. 版本发布

对于正式版本发布，**必须合并到 master 分支**：

```bash
# 合并 develop 到 master
git checkout master
git merge develop
git push origin master

# GitHub Actions 会自动：
# 1. 更新版本号
# 2. 生成 CHANGELOG
# 3. 创建 Git Tag（如 v1.3.0）
```

### 5. Git Tags

系统会**自动创建 Git Tag**：

- ✅ 每次版本更新时自动创建 Tag
- ✅ Tag 格式：`v{version}`（如 `v1.3.0`）
- ✅ Tag 会自动推送到远程仓库
- ✅ 可在 GitHub Releases 页面查看所有版本

**查看 Tags**：
```bash
# 查看所有 tags
git tag

# 查看最新 tag
git describe --tags --abbrev=0

# 拉取远程 tags
git fetch --tags
```

---

## 📁 相关文件

- [.github/workflows/version-changelog.yml](../.github/workflows/version-changelog.yml) - GitHub Actions 工作流
- [scripts/update-version-changelog.js](../scripts/update-version-changelog.js) - 更新脚本
- [package.json](../package.json) - 版本号存储
- [CHANGELOG.md](../CHANGELOG.md) - 版本更新记录

---

## 🔧 故障排查

### 问题 1: Actions 没有触发

**检查：**
- 确认推送到了 `main` 或 `master` 分支（不是 develop）
- 检查 `.github/workflows/version-changelog.yml` 文件是否存在
- 查看 GitHub Actions 页面是否有错误日志
- 确认是从 develop 合并到 master，而不是直接推送

### 问题 2: 版本号没有更新

**检查：**
- 确认提交信息遵循 Conventional Commits 规范
- 查看 Actions 日志中的脚本输出
- 确认是否有新的 commits（不包括 bot 提交）

### 问题 3: 权限错误

**错误信息：**
```
Permission denied (publickey)
或
refusing to allow a GitHub App to create or update workflow
```

**解决方案：**
- 确认 `permissions.contents: write` 已设置
- 检查仓库的 Actions 权限设置（Settings → Actions → General）

---

## 📚 扩展阅读

- [Conventional Commits](https://www.conventionalcommits.org/)
- [Semantic Versioning](https://semver.org/lang/zh-CN/)
- [GitHub Actions 文档](https://docs.github.com/en/actions)

---

**配置日期**: 2025-11-04
**维护者**: DuLiDay 开发团队
**状态**: ✅ 生产就绪
