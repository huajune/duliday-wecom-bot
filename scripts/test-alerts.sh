#!/bin/bash

# 告警系统测试脚本
# 使用方法：./scripts/test-alerts.sh [测试类型]
# 测试类型：severity | throttling | error-types | silence | metrics | full-suite | all

set -e

# 配置
BASE_URL="${BASE_URL:-http://localhost:8080}"
API_PREFIX="/alert"

# 颜色输出
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# 分隔线
separator() {
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
}

# 测试函数
test_severity_levels() {
    separator
    log_info "测试 1/6: 严重级别告警"
    separator

    curl -X POST "${BASE_URL}${API_PREFIX}/test/severity-levels" \
        -H "Content-Type: application/json" \
        -s | jq '.'

    log_success "严重级别测试完成"
    log_warning "📱 请在飞书群聊中查看 4 条告警卡片（CRITICAL/ERROR/WARNING x2）"
}

test_throttling() {
    separator
    log_info "测试 2/6: 告警聚合（限流）"
    separator

    curl -X POST "${BASE_URL}${API_PREFIX}/test/throttling" \
        -H "Content-Type: application/json" \
        -s | jq '.'

    log_success "告警聚合测试完成"
    log_warning "📱 预期：飞书群只收到 1 条告警，显示「聚合告警数: 5 次相同错误」"
}

test_error_types() {
    separator
    log_info "测试 3/6: 错误类型"
    separator

    curl -X POST "${BASE_URL}${API_PREFIX}/test/error-types" \
        -H "Content-Type: application/json" \
        -s | jq '.'

    log_success "错误类型测试完成"
    log_warning "📱 请在飞书群聊中查看 4 条告警（agent/message/delivery/merge）"
}

test_silence() {
    separator
    log_info "测试 4/6: 静默功能"
    separator

    curl -X POST "${BASE_URL}${API_PREFIX}/test/silence" \
        -H "Content-Type: application/json" \
        -s | jq '.'

    log_success "静默功能测试完成"
    log_warning "📱 预期：飞书群只收到 2 条告警（静默前 1 条 + 静默后 1 条）"
}

test_metrics() {
    separator
    log_info "测试 5/6: 业务指标告警"
    separator

    curl -X POST "${BASE_URL}${API_PREFIX}/test/metrics" \
        -H "Content-Type: application/json" \
        -s | jq '.'

    log_success "业务指标测试完成"
    log_warning "📱 请在飞书群聊中查看 4 条业务指标告警"
}

test_fallback() {
    separator
    log_info "测试 6/6: 消息降级场景"
    separator

    curl -X POST "${BASE_URL}${API_PREFIX}/test/fallback" \
        -H "Content-Type: application/json" \
        -s | jq '.'

    log_success "消息降级测试完成"
    log_warning "📱 请在飞书群聊中查看 2 条告警（降级成功 vs 降级失败）"
}

test_full_suite() {
    separator
    log_info "🧪 执行完整测试套件（包含所有测试）"
    log_info "总共约需要 1-2 分钟"
    separator

    curl -X POST "${BASE_URL}${API_PREFIX}/test/full-suite" \
        -H "Content-Type: application/json" \
        -d '{"delayMs": 3000}' \
        -s | jq '.'

    separator
    log_success "✅ 完整测试套件执行完成！"
    log_warning "📱 预期收到约 17 条飞书告警，请检查飞书群聊验收"
    separator
}

# 静默管理测试
test_silence_api() {
    separator
    log_info "测试静默管理 API"
    separator

    # 1. 添加静默规则
    log_info "1️⃣ 添加静默规则（静默 agent 类型告警 5 分钟）"
    curl -X POST "${BASE_URL}${API_PREFIX}/silence" \
        -H "Content-Type: application/json" \
        -d '{
            "errorType": "agent",
            "durationMs": 300000,
            "reason": "API测试 - 临时静默"
        }' \
        -s | jq '.'

    echo ""

    # 2. 查询静默规则
    log_info "2️⃣ 查询所有静默规则"
    curl -X GET "${BASE_URL}${API_PREFIX}/silence" \
        -H "Content-Type: application/json" \
        -s | jq '.'

    echo ""

    # 3. 删除静默规则
    log_info "3️⃣ 删除静默规则"
    curl -X DELETE "${BASE_URL}${API_PREFIX}/silence/agent" \
        -H "Content-Type: application/json" \
        -s | jq '.'

    log_success "静默管理 API 测试完成"
}

# 显示帮助信息
show_help() {
    cat << EOF

📢 告警系统测试脚本

用法：
    ./scripts/test-alerts.sh [测试类型]

测试类型：
    severity        测试严重级别（CRITICAL/ERROR/WARNING）
    throttling      测试告警聚合（限流）
    error-types     测试错误类型（agent/message/delivery/merge）
    silence         测试静默功能
    metrics         测试业务指标告警
    fallback        测试消息降级场景
    full-suite      运行完整测试套件（推荐）
    silence-api     测试静默管理 API
    all             依次运行所有单项测试

示例：
    # 运行完整测试套件（推荐，一次性测试所有功能）
    ./scripts/test-alerts.sh full-suite

    # 只测试严重级别
    ./scripts/test-alerts.sh severity

    # 测试消息降级场景
    ./scripts/test-alerts.sh fallback

    # 测试静默管理 API
    ./scripts/test-alerts.sh silence-api

    # 自定义服务器地址
    BASE_URL=https://your-server.com ./scripts/test-alerts.sh full-suite

验收检查清单：
    ✅ 1. 严重级别图标正确（🚨 CRITICAL, ❌ ERROR, ⚠️ WARNING）
    ✅ 2. 聚合告警显示聚合次数和时间窗口
    ✅ 3. 错误类型标签清晰可见
    ✅ 4. 静默期间告警被正确屏蔽
    ✅ 5. 业务指标显示当前值和阈值
    ✅ 6. 消息降级告警显示用户影响评估（✅ 已降级 vs ❌ 降级失败）
    ✅ 7. P0 改进：用户消息完整、请求耗时、智能日志链接
    ✅ 8. 飞书卡片格式美观易读

EOF
}

# 主函数
main() {
    local test_type="${1:-help}"

    # 检查服务是否运行
    if ! curl -s "${BASE_URL}/agent/health" > /dev/null 2>&1; then
        log_error "服务未运行或无法访问: ${BASE_URL}"
        log_info "请先启动服务: pnpm run start:dev"
        exit 1
    fi

    log_success "服务运行正常: ${BASE_URL}"

    case "$test_type" in
        severity)
            test_severity_levels
            ;;
        throttling)
            test_throttling
            ;;
        error-types)
            test_error_types
            ;;
        silence)
            test_silence
            ;;
        metrics)
            test_metrics
            ;;
        fallback)
            test_fallback
            ;;
        full-suite)
            test_full_suite
            ;;
        silence-api)
            test_silence_api
            ;;
        all)
            test_severity_levels
            sleep 3
            test_throttling
            sleep 3
            test_error_types
            sleep 3
            test_silence
            sleep 3
            test_metrics
            sleep 3
            test_fallback
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            log_error "未知的测试类型: $test_type"
            show_help
            exit 1
            ;;
    esac
}

# 执行主函数
main "$@"
