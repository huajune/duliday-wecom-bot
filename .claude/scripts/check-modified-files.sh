#!/bin/bash

# 检查修改的文件数量并提醒用户提交

# 获取所有修改的文件数（包括暂存区和工作区）
modified_count=$(git status --short | wc -l | tr -d ' ')

if [ "$modified_count" -gt 10 ]; then
  echo ""
  echo "⚠️  警告：当前有 ${modified_count} 个文件被修改"
  echo "建议尽快提交代码，避免丢失工作内容！"
  echo ""
  echo "执行以下命令提交："
  echo "  git add -A"
  echo "  git commit -m \"<commit message>\""
  echo ""
fi
