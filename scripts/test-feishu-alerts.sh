#!/bin/bash

# 飞书告警测试脚本
# 用于测试系统监控是否能正确接收和记录告警数据

BASE_URL="${BASE_URL:-http://localhost:8080}"

echo "=========================================="
echo "飞书告警测试脚本"
echo "BASE_URL: $BASE_URL"
echo "=========================================="

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 辅助函数
print_step() {
    echo -e "\n${YELLOW}>>> $1${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# 检查服务是否运行
print_step "检查服务状态..."
HEALTH_RESPONSE=$(curl -s "$BASE_URL/monitoring/health")
if [[ $HEALTH_RESPONSE == *"ok"* ]]; then
    print_success "服务运行正常"
else
    print_error "服务未运行，请先启动服务: pnpm run start:dev"
    exit 1
fi

# 获取初始监控数据
print_step "获取初始监控数据..."
INITIAL_DATA=$(curl -s "$BASE_URL/monitoring/dashboard")
INITIAL_ALERTS=$(echo $INITIAL_DATA | jq -r '.data.alertsSummary.total // 0')
echo "初始告警数量: $INITIAL_ALERTS"

# ==================== 测试 1: Agent API 超时错误 ====================
print_step "测试 1: 模拟 Agent API 超时错误"

# 模拟一个会触发 Agent 超时的消息
curl -s -X POST "$BASE_URL/alert/test/agent-timeout" \
    -H "Content-Type: application/json" \
    -d '{
        "errorType": "agent",
        "error": "ETIMEDOUT: Agent API 请求超时 (600000ms)",
        "conversationId": "test-conv-001",
        "userMessage": "你好，我想预约面试",
        "apiEndpoint": "/api/v1/chat",
        "scenario": "CANDIDATE_CONSULTATION"
    }' 2>/dev/null || echo '{"note": "需要实现 /alert/test 端点"}'

print_success "Agent 超时告警已发送"

# ==================== 测试 2: 认证失败错误 ====================
print_step "测试 2: 模拟 Agent API 认证失败 (401)"

curl -s -X POST "$BASE_URL/alert/test/auth-error" \
    -H "Content-Type: application/json" \
    -d '{
        "errorType": "agent",
        "error": "401 Unauthorized: Invalid API key",
        "conversationId": "test-conv-002",
        "apiEndpoint": "/api/v1/chat"
    }' 2>/dev/null || echo '{"note": "需要实现 /alert/test 端点"}'

print_success "认证失败告警已发送"

# ==================== 测试 3: 限流错误 ====================
print_step "测试 3: 模拟 Agent API 限流 (429)"

curl -s -X POST "$BASE_URL/alert/test/rate-limit" \
    -H "Content-Type: application/json" \
    -d '{
        "errorType": "agent",
        "error": "429 Too Many Requests: Rate limit exceeded",
        "conversationId": "test-conv-003",
        "apiEndpoint": "/api/v1/chat"
    }' 2>/dev/null || echo '{"note": "需要实现 /alert/test 端点"}'

print_success "限流告警已发送"

# ==================== 测试 4: 消息发送失败 ====================
print_step "测试 4: 模拟消息发送失败"

curl -s -X POST "$BASE_URL/alert/test/delivery-error" \
    -H "Content-Type: application/json" \
    -d '{
        "errorType": "delivery",
        "error": "消息发送失败: 托管平台返回错误码 50001",
        "conversationId": "test-conv-004",
        "fallbackMessage": "抱歉，我现在无法回复，请稍后再试"
    }' 2>/dev/null || echo '{"note": "需要实现 /alert/test 端点"}'

print_success "消息发送失败告警已发送"

# ==================== 测试 5: 系统错误 ====================
print_step "测试 5: 模拟系统错误"

curl -s -X POST "$BASE_URL/alert/test/system-error" \
    -H "Content-Type: application/json" \
    -d '{
        "errorType": "system",
        "error": "Redis 连接失败: ECONNREFUSED",
        "scenario": "MESSAGE_QUEUE"
    }' 2>/dev/null || echo '{"note": "需要实现 /alert/test 端点"}'

print_success "系统错误告警已发送"

# ==================== 查看最终监控数据 ====================
sleep 2  # 等待数据写入

print_step "查看最终监控数据..."
FINAL_DATA=$(curl -s "$BASE_URL/monitoring/dashboard")
FINAL_ALERTS=$(echo $FINAL_DATA | jq -r '.data.alertsSummary.total // 0')
ALERTS_24H=$(echo $FINAL_DATA | jq -r '.data.alertsSummary.last24Hours // 0')

echo ""
echo "=========================================="
echo "测试结果汇总"
echo "=========================================="
echo "初始告警数量: $INITIAL_ALERTS"
echo "最终告警数量: $FINAL_ALERTS"
echo "24小时内告警: $ALERTS_24H"
echo ""

# 显示告警类型分布
print_step "告警类型分布:"
echo $FINAL_DATA | jq -r '.data.alertsSummary.byType // []'

# 显示最近错误
print_step "最近错误日志:"
echo $FINAL_DATA | jq -r '.data.recentErrors[:5] // []'

echo ""
echo "=========================================="
echo "测试完成！"
echo "=========================================="
echo ""
echo "提示："
echo "1. 如果看到 '需要实现 /alert/test 端点'，说明需要添加测试端点"
echo "2. 检查飞书群是否收到告警消息"
echo "3. 打开监控面板查看告警数据: open $BASE_URL/monitoring.html"
