# Claude Code 安全防护机制

本目录包含保护代码安全的自动化脚本。

## 🛡️ 安全防护措施

### 1. 禁止危险命令

以下命令被完全禁止执行（配置在 `.claude/settings.local.json` 的 `deny` 列表）：

```bash
git restore              # 恢复文件到指定版本（危险：会丢失未提交的修改）
git reset --hard         # 硬重置（危险：会永久删除所有未提交的修改）
git clean                # 清理未跟踪文件（危险：会永久删除文件）
git checkout -- .        # 恢复所有文件（危险：会丢失工作区修改）
git checkout HEAD        # 检出HEAD版本（危险：会丢失修改）
git stash drop           # 删除暂存（危险：无法恢复）
git reflog delete        # 删除引用日志（危险：丢失历史）
rm -rf                   # 递归强制删除（危险：永久删除）
```

### 2. 需要确认的命令

以下命令需要用户明确确认后才能执行（配置在 `ask` 列表）：

```bash
git reset                # 重置（需确认）
git rebase               # 变基操作（需确认）
git push --force         # 强制推送（需确认）
git push -f              # 强制推送简写（需确认）
git stash                # 暂存修改（需确认）
```

### 3. 自动暂存修改

**触发时机**：每次使用 `Write` 或 `Edit` 工具修改文件后

**脚本**：`auto-stage-files.sh`

**功能**：
- 自动将已跟踪文件的修改添加到 Git 暂存区
- 不会自动添加新文件（避免误添加敏感文件）
- 显示暂存文件数量的确认信息

**工作流程**：
```bash
Claude Code 修改文件
  ↓
npm run format (代码格式化)
  ↓
auto-stage-files.sh (自动暂存)
  ↓
显示：✅ 已自动将 X 个修改的文件添加到暂存区
```

### 4. 修改文件数量提醒

**触发时机**：用户每次提交新的prompt时

**脚本**：`check-modified-files.sh`

**功能**：
- 检查当前修改的文件数（暂存区 + 工作区）
- 当修改文件数 > 10 时发出警告
- 提示用户及时提交代码

**警告示例**：
```
⚠️  警告：当前有 15 个文件被修改
建议尽快提交代码，避免丢失工作内容！

执行以下命令提交：
  git add -A
  git commit -m "<commit message>"
```

## 📁 文件说明

- `auto-stage-files.sh` - 自动暂存修改的文件
- `check-modified-files.sh` - 检查并提醒修改文件数
- `README.md` - 本文档

## 🔧 配置文件

主配置文件：`.claude/settings.local.json`

```json
{
  "permissions": {
    "deny": ["Bash(git restore:*)", ...],
    "ask": ["Bash(git reset:*)", ...]
  },
  "hooks": {
    "PostToolUse": [...],
    "UserPromptSubmit": [...]
  }
}
```

## ✅ 测试验证

测试危险命令是否被阻止：
```bash
# 这些命令应该被自动拒绝
git restore .
git reset --hard HEAD
rm -rf test/
```

测试自动暂存功能：
```bash
# 修改一个文件后检查
git status
# 应该看到文件在暂存区
```

测试文件数提醒：
```bash
# 创建10+个修改文件
# 在Claude Code中输入任何prompt
# 应该看到警告信息
```

## 🚨 紧急情况处理

如果需要临时禁用安全防护：

1. **禁用所有hooks**（不推荐）：
   ```json
   "disableAllHooks": true
   ```

2. **临时移除危险命令限制**（强烈不推荐）：
   修改 `.claude/settings.local.json`，从 `deny` 列表中移除对应命令

3. **在终端手动执行**：
   如果确实需要执行危险操作，可以在VSCode终端手动执行，不通过Claude Code

## 📝 维护记录

- 2025-11-05: 初始版本，添加基础安全防护
  - 禁止8个危险命令
  - 需确认5个高风险命令
  - 自动暂存修改文件
  - 10+文件修改提醒

---

**维护者**：DuLiDay Team
**最后更新**：2025-11-05
