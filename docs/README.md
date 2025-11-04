# 文档中心

> DuLiDay 企业微信服务 - 技术文档导航

**最后更新**：2025-11-04

---

## 📚 技术文档

### Agent 相关文档

💡 **阅读建议**: 先理解花卷 API（使用指南），再学习服务封装（服务架构）

- **[花卷 Agent API 使用指南](huajune-agent-api-guide.md)** (569 行)
  - 花卷智能体 API 完整使用指南
  - 认证与安全、模型选择
  - System Prompt 配置、工具系统
  - 上下文管理、消息剪裁
  - 错误处理、性能优化
  - **更新日期**：2025-11-04

- **[Agent 服务架构](agent-service-architecture.md)** (426 行)
  - Agent 服务封装实现
  - 4 个核心服务：AgentService、AgentConfigService、AgentRegistryService、AgentCacheService
  - 17 个 HTTP API 端点
  - 缓存策略、配置管理、错误处理
  - **更新日期**：2025-11-04

### 消息服务架构

- **[消息服务架构](message-service-architecture.md)** (376 行)
  - 消息处理服务的重构架构
  - 从 1099 行巨石服务 → 5 个专职子服务
  - Bull Queue 智能消息聚合
  - 去重机制、历史管理、消息发送
  - **更新日期**：2025-11-04

---

## 📋 产品文档

- **[产品定义](product/product-definition.md)** (205 行)
  - 产品定位和核心价值
  - 用户角色和应用场景
  - 核心功能列表和指标
  - **更新日期**：2025-11-04

- **[业务流程详细说明](product/business-flows.md)** (497 行)
  - 候选人招聘全流程（8个阶段）
  - 私聊对话场景（欢迎语、岗位咨询、面试安排、提醒、跟进）
  - 群聊管理场景（兼职群、店长群）
  - 店长报缺流程和数据报告
  - **更新日期**：2025-11-04

- **[产品规划路线图](product/product-roadmap.md)** (148 行)
  - 版本规划（MVP/V1.0、V1.1、V2.0）
  - 功能优先级和实施计划
  - 技术风险与应对策略
  - 成功标准和业务目标
  - **更新日期**：2025-11-04

---

## 📝 开发指南

### 版本管理

- **[自动化版本管理文档](auto-version-changelog.md)** (365 行)
  - GitHub Actions 自动化版本更新系统
  - Conventional Commits 规范和版本号规则
  - 完整使用示例和工作流程
  - 本地测试和故障排查
  - **更新日期**：2025-11-04

**系统特性**：
- ✅ 推送到 develop/main/master 自动触发
- ✅ 根据 commits 智能判断版本类型
- ✅ 自动更新 package.json 和 CHANGELOG.md
- ✅ 支持 Conventional Commits 规范

**提交规范示例**：
```bash
feat: 添加新功能        # 次版本 +1
fix: 修复 bug         # 修订号 +1
docs: 更新文档        # 修订号 +1
```

### 代码审查指南

- **[Codex 审查指南](codex-review-guidelines.md)** (完整版)
  - Cursor Codex 插件工作说明
  - 代码审查流程和标准
  - 常见问题与建议模板
  - 沟通风格和最佳实践
  - **更新日期**：2025-11-04

**快速参考**：项目根目录 [.codex.md](../.codex.md)（精简版）

---

## 🗂️ 文档命名规范

所有文档文件必须遵循 **kebab-case** 命名规范：

### ✅ 正确示例
```
agent-service-architecture.md
huajune-agent-api-guide.md
message-service-architecture.md
product-definition.md
business-flows.md
```

### ❌ 错误示例
```
ARCHITECTURE.md          # 全大写
API_CONFIG.md            # SNAKE_CASE
ChatAgentGuide.md        # PascalCase
productDefinition.md     # camelCase
```

### 命名规则

1. **全小写字母**
2. **单词间用连字符 `-` 分隔**
3. **使用描述性名称**（能清楚表达文档内容）
4. **避免缩写**（除非是广泛认可的缩写，如 api、http）

---

## 📝 贡献指南

### 添加新文档

1. **确定文档类型**
   - 技术文档 → 放在 `docs/` 根目录
   - 产品文档 → 放在 `docs/product/`

2. **命名文件**
   - 使用 kebab-case 格式
   - 文件名要描述性强

3. **更新本 README**
   - 在对应分类下添加文档链接
   - 包含行数、简介、更新日期

4. **文档内容要求**
   - 添加标题和目录
   - 注明最后更新日期
   - 使用清晰的章节结构

### 更新现有文档

1. **修改文档内容**后，更新文档内的"最后更新"日期
2. 如果是重大更新，在本 README 中更新描述
3. 保持文档目录（TOC）与内容同步

---

## 🔗 相关资源

- **代码规范**：[../.cursorrules](../.cursorrules)
- **Agent 配置**：[../.claude/agents/](../.claude/agents/)
- **架构原则**：[../.claude/agents/architecture-principles.md](../.claude/agents/architecture-principles.md)
- **代码标准**：[../.claude/agents/code-standards.md](../.claude/agents/code-standards.md)

---

**维护者**：DuLiDay Team
