#!/bin/bash

# 自动将修改的文件添加到暂存区
# 这个脚本会在Claude Code修改文件后自动执行

# 只添加已跟踪文件的修改，不添加新文件
git add -u

# 检查是否成功
if [ $? -eq 0 ]; then
  # 获取暂存的文件数
  staged_count=$(git diff --cached --name-only | wc -l | tr -d ' ')
  if [ "$staged_count" -gt 0 ]; then
    echo "✅ 已自动将 ${staged_count} 个修改的文件添加到暂存区"
  fi
else
  echo "❌ 自动暂存失败"
  exit 1
fi
