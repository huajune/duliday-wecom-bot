#!/bin/bash

set -e

# AI Code Review Script
# This script calls Anthropic Claude API to review code changes

DIFF_FILE="$1"
OUTPUT_FILE="$2"

# 检查参数
if [ -z "$DIFF_FILE" ] || [ -z "$OUTPUT_FILE" ]; then
  echo "Usage: $0 <diff_file> <output_file>"
  exit 1
fi

# 检查 API Key
if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "⚠️  ANTHROPIC_API_KEY not configured, skipping AI review"
  echo "⚠️ AI review was skipped (ANTHROPIC_API_KEY not configured)" > "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"
  echo "To enable AI code review, please add your Anthropic API key as a repository secret named \`ANTHROPIC_API_KEY\`." >> "$OUTPUT_FILE"
  exit 0
fi

# 读取 diff 内容
DIFF_CONTENT=$(cat "$DIFF_FILE")

# 读取项目规范（如果存在）
PROJECT_RULES=""
if [ -f ".cursorrules" ]; then
  PROJECT_RULES=$(cat .cursorrules | head -c 10000)
fi

# 构建审查提示词（使用jq安全处理）
REVIEW_PROMPT=$(jq -n \
  --arg diff "$DIFF_CONTENT" \
  --arg rules "$PROJECT_RULES" \
  '{
    prompt: "You are an expert code reviewer for a NestJS TypeScript project.\n\nProject Context:\n- Tech Stack: NestJS 10.3, TypeScript 5.3, Node.js 20+\n- Architecture: DDD layered architecture with 4 business domains\n- This is an enterprise WeChat intelligent service middleware\n\nProject Coding Standards:\n\($rules)\n\nPlease review the following code changes and provide:\n1. **Critical Issues** (bugs, security, performance problems)\n2. **Code Quality** (TypeScript best practices, NestJS patterns)\n3. **Architecture Concerns** (violations of DDD principles, wrong layer usage)\n4. **Suggestions** (improvements, optimizations)\n\nFocus on:\n- TypeScript strict typing (no any abuse)\n- NestJS dependency injection patterns\n- Proper error handling\n- Security issues (hardcoded secrets, SQL injection, XSS)\n- Performance issues\n- Code maintainability\n\nCode Changes:\n```diff\n\($diff)\n```\n\nProvide your review in markdown format with clear sections."
  }' | jq -r '.prompt')

# 调用 Anthropic API
RESPONSE=$(curl -s -X POST https://api.anthropic.com/v1/messages \
  -H "content-type: application/json" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -d "$(jq -n \
    --arg prompt "$REVIEW_PROMPT" \
    '{
      "model": "claude-sonnet-4-20250514",
      "max_tokens": 8192,
      "messages": [
        {
          "role": "user",
          "content": $prompt
        }
      ]
    }')")

# 检查API调用是否成功
if [ $? -ne 0 ]; then
  echo "❌ Failed to call Anthropic API" > "$OUTPUT_FILE"
  exit 1
fi

# 提取审查结果
REVIEW_TEXT=$(echo "$RESPONSE" | jq -r '.content[0].text // "AI review failed"')

# 保存审查结果
echo "$REVIEW_TEXT" > "$OUTPUT_FILE"

echo "✅ AI review completed successfully"
