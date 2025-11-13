#!/bin/bash

# Session Start Hook - 显示项目开发规范提醒
# 在每次 Claude Code 会话开始时自动执行

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 项目开发规范提醒"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📌 Commit 规范 (.claude/agents/commit-guidelines.md)："
echo "  • 标题：10-15 中文字符"
echo "  • 正文：每行 10-15 字符"
echo "  • 禁止：冗长技术解释"
echo ""
echo "📌 代码标准 (.claude/agents/code-standards.md)："
echo "  • 严格类型检查（禁用 any）"
echo "  • 依赖注入（禁止 new Service()）"
echo "  • 单一职责（<500 行/服务）"
echo ""
echo "💡 快速查看完整规范："
echo "  cat .claude/agents/commit-guidelines.md"
echo "  cat .claude/agents/code-standards.md"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
