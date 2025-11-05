#!/bin/bash

# Auto-stage modified files to Git staging area
# This script is automatically executed after Claude Code modifies files

# Only stage tracked files, do not add new files
git add -u

# Check if successful
if [ $? -eq 0 ]; then
  # Get count of staged files
  staged_count=$(git diff --cached --name-only | wc -l | tr -d ' ')
  if [ "$staged_count" -gt 0 ]; then
    echo "✅ Auto-staged ${staged_count} modified file(s)"
  fi
else
  echo "❌ Auto-staging failed"
  exit 1
fi
