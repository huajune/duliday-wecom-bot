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
HTTP_CODE=$(curl -s -w "%{http_code}" -o /tmp/api-response.json -X POST https://api.anthropic.com/v1/messages \
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

# 检查 HTTP 状态码
if [ "$HTTP_CODE" -ne 200 ]; then
  ERROR_TYPE=$(jq -r '.error.type // "unknown_error"' /tmp/api-response.json 2>/dev/null || echo "unknown_error")
  ERROR_MESSAGE=$(jq -r '.error.message // "API request failed"' /tmp/api-response.json 2>/dev/null || echo "API request failed")

  echo "❌ API Request Failed (HTTP $HTTP_CODE)" > "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"
  echo "**Error Type:** $ERROR_TYPE" >> "$OUTPUT_FILE"
  echo "**Error Message:** $ERROR_MESSAGE" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  # 针对常见错误提供建议
  case "$HTTP_CODE" in
    401)
      echo "💡 **Suggestion:** Please verify your ANTHROPIC_API_KEY is correct and has not expired." >> "$OUTPUT_FILE"
      ;;
    429)
      echo "💡 **Suggestion:** Rate limit exceeded. Please try again later or upgrade your API plan." >> "$OUTPUT_FILE"
      ;;
    500|502|503)
      echo "💡 **Suggestion:** Anthropic API is temporarily unavailable. Please retry in a few moments." >> "$OUTPUT_FILE"
      ;;
    *)
      echo "💡 **Suggestion:** Check the error message above and review Anthropic API documentation." >> "$OUTPUT_FILE"
      ;;
  esac

  rm -f /tmp/api-response.json
  exit 1
fi

# 读取响应
RESPONSE=$(cat /tmp/api-response.json)
rm -f /tmp/api-response.json

# 检查响应是否包含错误
ERROR_CHECK=$(echo "$RESPONSE" | jq -r '.error // empty')
if [ -n "$ERROR_CHECK" ]; then
  ERROR_TYPE=$(echo "$RESPONSE" | jq -r '.error.type')
  ERROR_MESSAGE=$(echo "$RESPONSE" | jq -r '.error.message')

  echo "❌ AI Review Failed" > "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"
  echo "**Error:** $ERROR_TYPE" >> "$OUTPUT_FILE"
  echo "**Message:** $ERROR_MESSAGE" >> "$OUTPUT_FILE"

  exit 1
fi

# 提取审查结果
REVIEW_TEXT=$(echo "$RESPONSE" | jq -r '.content[0].text // empty')

# 验证审查结果不为空
if [ -z "$REVIEW_TEXT" ]; then
  echo "❌ AI review returned empty response" > "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"
  echo "Please check the API response format or contact support." >> "$OUTPUT_FILE"
  exit 1
fi

# 保存审查结果
echo "$REVIEW_TEXT" > "$OUTPUT_FILE"

echo "✅ AI review completed successfully"
