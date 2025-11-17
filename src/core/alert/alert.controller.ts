import { Controller, Post, Body, Logger, Get, Delete, Param } from '@nestjs/common';
import { FeiShuAlertService } from './feishu-alert.service';
import { AlertSilenceService } from './services/alert-silence.service';
import { AlertOrchestratorService } from './services/alert-orchestrator.service';
import { AlertErrorType } from './types';
import { AlertSeverity } from './interfaces/alert-config.interface';
import { ScenarioType } from '@agent';

/**
 * 告警管理控制器
 * 提供告警测试和静默管理功能
 */
@Controller('alert')
export class AlertController {
  private readonly logger = new Logger(AlertController.name);

  constructor(
    private readonly feiShuAlertService: FeiShuAlertService,
    private readonly alertSilenceService: AlertSilenceService,
    private readonly alertOrchestrator: AlertOrchestratorService,
  ) {}

  /**
   * 测试接口：发送 Agent API 失败告警
   * @description 用于测试飞书告警功能，不触发实际的消息处理
   * @example POST /alert/test-agent-failure
   */
  @Post('test-agent-failure')
  async testAgentFailure(
    @Body()
    body?: {
      errorMessage?: string;
      statusCode?: number;
      conversationId?: string;
      userMessage?: string;
    },
  ) {
    this.logger.log('收到飞书告警测试请求:', body);

    const mockError = {
      message: body?.errorMessage || '模拟 Agent API 调用超时',
      response: {
        status: body?.statusCode || 504,
        data: {
          error: 'Gateway Timeout',
          message: '连接 Agent API 服务超时，请检查网络或服务状态',
          timestamp: new Date().toISOString(),
        },
      },
    };

    const conversationId = body?.conversationId || `test_chat_${Date.now()}`;
    const userMessage = body?.userMessage || '测试用户消息：你好，有什么岗位推荐吗？';

    try {
      await this.feiShuAlertService.sendAgentApiFailureAlert(
        mockError,
        conversationId,
        userMessage,
        '/api/v1/chat',
        { errorType: 'agent', scenario: 'test-alert' },
      );

      return {
        success: true,
        message: '飞书告警已发送',
        data: {
          conversationId,
          errorMessage: mockError.message,
          statusCode: mockError.response.status,
          userMessage,
        },
        note: '请检查飞书群聊是否收到告警消息',
      };
    } catch (error) {
      this.logger.error('发送飞书告警失败:', error);
      return {
        success: false,
        message: '飞书告警发送失败',
        error: error.message,
      };
    }
  }

  /**
   * 测试接口：发送通用告警
   * @description 测试通用告警消息，支持 info/warning/error 级别
   * @example POST /alert/test-generic
   */
  @Post('test-generic')
  async testGeneric(
    @Body()
    body?: {
      title?: string;
      message?: string;
      level?: 'info' | 'warning' | 'error';
    },
  ) {
    this.logger.log('收到通用告警测试请求:', body);

    const title = body?.title || '测试告警';
    const message = body?.message || '这是一条测试告警消息，用于验证飞书集成是否正常工作。';
    const level = body?.level || 'info';

    try {
      await this.feiShuAlertService.sendAlert(title, message, level);

      return {
        success: true,
        message: '飞书告警已发送',
        data: { title, message, level },
        note: '请检查飞书群聊是否收到告警消息',
      };
    } catch (error) {
      this.logger.error('发送飞书告警失败:', error);
      return {
        success: false,
        message: '飞书告警发送失败',
        error: error.message,
      };
    }
  }

  // ========================================
  // 静默管理 API
  // ========================================

  /**
   * 添加静默规则
   * @description 临时屏蔽指定类型的告警，用于维护窗口或已知问题
   * @example POST /alert/silence
   * @body {
   *   "errorType": "agent",
   *   "scenario": "candidate_consulting",
   *   "durationMs": 3600000,
   *   "reason": "Agent API 维护中"
   * }
   */
  @Post('silence')
  async addSilence(
    @Body()
    body: {
      errorType: AlertErrorType;
      scenario?: string;
      durationMs: number;
      reason: string;
    },
  ) {
    this.logger.log(`添加静默规则: ${JSON.stringify(body)}`);

    try {
      const rule = this.alertSilenceService.addSilence(body);

      return {
        success: true,
        message: '静默规则已添加',
        data: {
          key: `${body.errorType}${body.scenario ? `:${body.scenario}` : ''}`,
          errorType: body.errorType,
          scenario: body.scenario,
          until: new Date(rule.until).toLocaleString('zh-CN'),
          reason: rule.reason,
          expiresIn: `${Math.floor(body.durationMs / 1000 / 60)} 分钟`,
        },
      };
    } catch (error) {
      this.logger.error(`添加静默规则失败: ${error.message}`);
      return {
        success: false,
        message: '添加静默规则失败',
        error: error.message,
      };
    }
  }

  /**
   * 查询所有静默规则
   * @description 获取当前生效的所有静默规则
   * @example GET /alert/silence
   */
  @Get('silence')
  async listSilence() {
    this.logger.log('查询所有静默规则');

    try {
      const rules = this.alertSilenceService.listSilenceRules();

      return {
        success: true,
        message: '查询成功',
        data: {
          count: rules.length,
          rules: rules.map((rule) => ({
            key: rule.key,
            errorType: rule.errorType,
            scenario: rule.scenario,
            until: new Date(rule.until).toLocaleString('zh-CN'),
            reason: rule.reason,
            remainingMs: rule.until - Date.now(),
            remainingMinutes: Math.floor((rule.until - Date.now()) / 1000 / 60),
          })),
        },
      };
    } catch (error) {
      this.logger.error(`查询静默规则失败: ${error.message}`);
      return {
        success: false,
        message: '查询静默规则失败',
        error: error.message,
      };
    }
  }

  /**
   * 删除静默规则
   * @description 提前结束静默，恢复告警
   * @example DELETE /alert/silence/agent:candidate_consulting
   * @param key 静默键（格式: errorType 或 errorType:scenario）
   */
  @Delete('silence/:key')
  async removeSilence(@Param('key') key: string) {
    this.logger.log(`删除静默规则: ${key}`);

    try {
      const removed = this.alertSilenceService.removeSilence(key);

      if (removed) {
        return {
          success: true,
          message: '静默规则已删除',
          data: { key },
        };
      } else {
        return {
          success: false,
          message: '静默规则不存在',
          data: { key },
        };
      }
    } catch (error) {
      this.logger.error(`删除静默规则失败: ${error.message}`);
      return {
        success: false,
        message: '删除静默规则失败',
        error: error.message,
      };
    }
  }

  // ========================================
  // 告警系统完整测试套件
  // ========================================

  /**
   * 测试不同严重级别的告警
   * @description 发送 CRITICAL/ERROR/WARNING/INFO 四种级别的告警，验证飞书卡片显示
   * @example POST /alert/test/severity-levels
   */
  @Post('test/severity-levels')
  async testSeverityLevels() {
    this.logger.log('🧪 测试告警严重级别');

    const results = [];

    // 1. CRITICAL - 认证失败（401）
    const critical401Error = {
      message: 'Authentication failed',
      response: {
        status: 401,
        data: {
          error: 'Unauthorized',
          message: 'Invalid API key or token expired',
        },
      },
    };

    await this.alertOrchestrator.sendAlert({
      errorType: 'agent',
      error: critical401Error,
      conversationId: `test-critical-${Date.now()}`,
      userMessage: '【测试】触发 CRITICAL 级别告警（401认证失败）',
      apiEndpoint: '/api/v1/chat',
      scenario: 'test_severity' as ScenarioType,
      contactName: '测试用户-CRITICAL',
    });
    results.push({ severity: 'CRITICAL', errorCode: 401, sent: true });

    // 等待 1 秒，避免告警聚合
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 2. ERROR - 服务器错误（500）
    const error500 = {
      message: 'Internal Server Error',
      response: {
        status: 500,
        data: {
          error: 'Internal Server Error',
          message: 'Agent service encountered an unexpected error',
        },
      },
    };

    await this.alertOrchestrator.sendAlert({
      errorType: 'agent',
      error: error500,
      conversationId: `test-error-${Date.now()}`,
      userMessage: '【测试】触发 ERROR 级别告警（500服务器错误）',
      apiEndpoint: '/api/v1/chat',
      scenario: 'test_severity' as ScenarioType,
      contactName: '测试用户-ERROR',
    });
    results.push({ severity: 'ERROR', errorCode: 500, sent: true });

    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 3. WARNING - 限流（429）
    const warning429 = {
      message: 'Rate limit exceeded',
      response: {
        status: 429,
        data: {
          error: 'Too Many Requests',
          message: 'Rate limit exceeded. Please try again later.',
        },
      },
    };

    await this.alertOrchestrator.sendAlert({
      errorType: 'agent',
      error: warning429,
      conversationId: `test-warning-${Date.now()}`,
      userMessage: '【测试】触发 WARNING 级别告警（429限流）',
      apiEndpoint: '/api/v1/chat',
      scenario: 'test_severity' as ScenarioType,
      contactName: '测试用户-WARNING',
    });
    results.push({ severity: 'WARNING', errorCode: 429, sent: true });

    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 4. WARNING - 消息处理错误
    const messageError = {
      message: 'Message processing failed',
      stack: 'Error: Invalid message format...',
    };

    await this.alertOrchestrator.sendAlert({
      errorType: 'message',
      error: messageError,
      conversationId: `test-message-${Date.now()}`,
      userMessage: '【测试】触发消息处理告警',
      apiEndpoint: '/wecom/message',
      scenario: 'test_severity' as ScenarioType,
      contactName: '测试用户-MESSAGE',
    });
    results.push({ severity: 'WARNING', errorType: 'message', sent: true });

    return {
      success: true,
      message: '严重级别测试完成，请检查飞书群聊',
      data: {
        testCount: 4,
        results,
        expectedCards: [
          '🚨 CRITICAL - 401 认证失败',
          '❌ ERROR - 500 服务器错误',
          '⚠️ WARNING - 429 限流',
          '⚠️ WARNING - message 类型',
        ],
      },
      note: '请在飞书群聊中查看 4 条告警卡片，验证严重程度图标和颜色',
    };
  }

  /**
   * 测试告警聚合功能
   * @description 连续发送 5 次相同错误，验证限流聚合（应该只收到 1 条聚合告警）
   * @example POST /alert/test/throttling
   */
  @Post('test/throttling')
  async testThrottling() {
    this.logger.log('🧪 测试告警限流聚合');

    const sameError = {
      message: '【聚合测试】Agent API timeout',
      response: {
        status: 504,
        data: {
          error: 'Gateway Timeout',
          message: 'Connection to Agent API timed out',
        },
      },
    };

    // 连续发送 5 次相同错误
    const promises = [];
    for (let i = 1; i <= 5; i++) {
      promises.push(
        this.alertOrchestrator.sendAlert({
          errorType: 'agent',
          error: sameError,
          conversationId: 'test-throttle-same-conv',
          userMessage: `【聚合测试】第 ${i} 次相同错误`,
          apiEndpoint: '/api/v1/chat',
          scenario: 'test_throttle' as ScenarioType,
          contactName: `测试用户-聚合${i}`,
        }),
      );

      // 间隔 200ms 发送
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    await Promise.all(promises);

    return {
      success: true,
      message: '聚合测试完成',
      data: {
        sentCount: 5,
        expectedAlertCount: 1,
        expectedFields: {
          aggregatedCount: 5,
          aggregatedTimeWindow: '包含开始和结束时间',
        },
      },
      note: '✅ 预期结果：飞书群只收到 1 条告警卡片，显示 "聚合告警数: 5 次相同错误"',
    };
  }

  /**
   * 测试不同错误类型
   * @description 测试 agent/message/delivery/merge 四种错误类型
   * @example POST /alert/test/error-types
   */
  @Post('test/error-types')
  async testErrorTypes() {
    this.logger.log('🧪 测试不同错误类型');

    const results = [];

    // 1. agent 类型
    await this.alertOrchestrator.sendAlert({
      errorType: 'agent',
      error: new Error('Agent API调用失败'),
      conversationId: `test-agent-${Date.now()}`,
      userMessage: '【测试】Agent 类型告警',
      apiEndpoint: '/api/v1/chat',
      scenario: 'test_types' as ScenarioType,
    });
    results.push({ type: 'agent', sent: true });

    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 2. message 类型
    await this.alertOrchestrator.sendAlert({
      errorType: 'message',
      error: new Error('消息处理失败'),
      conversationId: `test-message-${Date.now()}`,
      userMessage: '【测试】Message 类型告警',
      apiEndpoint: '/wecom/message',
      scenario: 'test_types' as ScenarioType,
    });
    results.push({ type: 'message', sent: true });

    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 3. delivery 类型
    await this.alertOrchestrator.sendAlert({
      errorType: 'delivery',
      error: new Error('消息发送失败'),
      conversationId: `test-delivery-${Date.now()}`,
      userMessage: '【测试】Delivery 类型告警',
      apiEndpoint: '/message-sender/send',
      scenario: 'test_types' as ScenarioType,
    });
    results.push({ type: 'delivery', sent: true });

    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 4. merge 类型
    await this.alertOrchestrator.sendAlert({
      errorType: 'merge',
      error: new Error('消息聚合失败'),
      conversationId: `test-merge-${Date.now()}`,
      userMessage: '【测试】Merge 类型告警',
      apiEndpoint: '/message/merge',
      scenario: 'test_types' as ScenarioType,
    });
    results.push({ type: 'merge', sent: true });

    return {
      success: true,
      message: '错误类型测试完成',
      data: {
        testCount: 4,
        results,
        types: ['agent', 'message', 'delivery', 'merge'],
      },
      note: '请在飞书群聊中查看 4 条告警，验证错误类型标签',
    };
  }

  /**
   * 测试静默功能
   * @description 添加静默规则后发送告警，验证告警被屏蔽
   * @example POST /alert/test/silence
   */
  @Post('test/silence')
  async testSilence() {
    this.logger.log('🧪 测试静默功能');

    const testKey = 'test_silence';

    // 1. 先发送一条正常告警
    await this.alertOrchestrator.sendAlert({
      errorType: 'agent',
      error: new Error('【静默测试】正常告警 - 应该收到'),
      conversationId: `test-before-silence-${Date.now()}`,
      userMessage: '这条告警应该正常发送',
      apiEndpoint: '/api/v1/chat',
      scenario: testKey as ScenarioType,
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));

    // 2. 添加静默规则（静默 2 分钟）
    this.alertSilenceService.addSilence({
      errorType: 'agent',
      scenario: testKey,
      durationMs: 120000, // 2 分钟
      reason: '【测试】验证静默功能',
    });

    // 3. 发送被静默的告警（不应该收到）
    const result1 = await this.alertOrchestrator.sendAlert({
      errorType: 'agent',
      error: new Error('【静默测试】被静默的告警 - 不应该收到'),
      conversationId: `test-silenced-${Date.now()}`,
      userMessage: '这条告警应该被静默',
      apiEndpoint: '/api/v1/chat',
      scenario: testKey as ScenarioType,
    });

    // 4. 移除静默规则
    this.alertSilenceService.removeSilence('agent:test_silence');

    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 5. 再发送一条告警（应该收到）
    await this.alertOrchestrator.sendAlert({
      errorType: 'agent',
      error: new Error('【静默测试】静默解除后的告警 - 应该收到'),
      conversationId: `test-after-silence-${Date.now()}`,
      userMessage: '这条告警应该正常发送',
      apiEndpoint: '/api/v1/chat',
      scenario: testKey as ScenarioType,
    });

    return {
      success: true,
      message: '静默功能测试完成',
      data: {
        step1: '发送正常告警 ✅ 应该收到',
        step2: '添加静默规则',
        step3: `发送被静默告警 ❌ 不应该收到 (skipped: ${result1.skipped})`,
        step4: '移除静默规则',
        step5: '发送正常告警 ✅ 应该收到',
      },
      note: '✅ 预期结果：飞书群只收到 2 条告警（步骤1和步骤5），步骤3的告警被静默',
    };
  }

  /**
   * 测试业务指标告警
   * @description 手动触发业务指标告警（成功率/响应时间/队列深度/错误率）
   * @example POST /alert/test/metrics
   */
  @Post('test/metrics')
  async testMetrics() {
    this.logger.log('🧪 测试业务指标告警');

    const results = [];

    // 1. 成功率告警（CRITICAL）
    await this.alertOrchestrator.sendMetricAlert({
      metricName: '成功率',
      currentValue: 75,
      threshold: 80,
      severity: AlertSeverity.CRITICAL,
      timeWindow: '最近 1 分钟',
    });
    results.push({ metric: '成功率', level: 'CRITICAL', value: '75%', threshold: '80%' });

    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 2. 响应时间告警（WARNING）
    await this.alertOrchestrator.sendMetricAlert({
      metricName: '平均响应时间',
      currentValue: 6500,
      threshold: 5000,
      severity: AlertSeverity.WARNING,
      timeWindow: '最近 1 分钟',
    });
    results.push({ metric: '响应时间', level: 'WARNING', value: '6500ms', threshold: '5000ms' });

    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 3. 队列深度告警（CRITICAL）
    await this.alertOrchestrator.sendMetricAlert({
      metricName: '队列积压深度',
      currentValue: 120,
      threshold: 100,
      severity: AlertSeverity.CRITICAL,
      timeWindow: '当前',
    });
    results.push({ metric: '队列深度', level: 'CRITICAL', value: '120条', threshold: '100条' });

    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 4. 错误率告警（WARNING）
    await this.alertOrchestrator.sendMetricAlert({
      metricName: '错误率',
      currentValue: 15,
      threshold: 10,
      severity: AlertSeverity.WARNING,
      timeWindow: '最近 1 小时',
    });
    results.push({
      metric: '错误率',
      level: 'WARNING',
      value: '15次/小时',
      threshold: '10次/小时',
    });

    return {
      success: true,
      message: '业务指标告警测试完成',
      data: {
        testCount: 4,
        results,
      },
      note: '请在飞书群聊中查看 4 条业务指标告警，验证指标名称和阈值显示',
    };
  }

  /**
   * 测试 6：消息降级场景
   * @description 测试 Agent 调用失败时的降级话术告警
   * @example POST /alert/test/fallback
   */
  @Post('test/fallback')
  async testFallback() {
    this.logger.log('🧪 测试消息降级场景');

    const results = [];

    // 场景 1：降级成功（用户无感知）
    await this.alertOrchestrator.sendAlert({
      errorType: 'agent',
      error: new Error('Agent API 超时'),
      conversationId: 'test-fallback-001',
      userMessage: '请帮我查询一下北京的 Java 开发岗位，要求 3-5 年经验，薪资 20-30k',
      channel: 'wecom',
      contactName: '测试用户-张三',
      apiEndpoint: '/api/v1/chat',
      statusCode: 504,
      duration: 15000, // 15秒超时
      fallbackMessage: '抱歉，系统繁忙，请稍后再试。您可以直接访问官网查看职位信息。',
      fallbackSuccess: true, // ✅ 降级成功
    });

    results.push({
      scenario: '降级成功',
      userImpact: '用户无感知',
      severity: 'WARNING',
    });

    // 场景 2：降级失败（用户可见错误）
    await this.alertOrchestrator.sendAlert({
      errorType: 'agent',
      error: new Error('Agent API 返回 500，且消息发送失败'),
      conversationId: 'test-fallback-002',
      userMessage: '帮我预约明天下午 3 点的面试',
      channel: 'wecom',
      contactName: '测试用户-李四',
      apiEndpoint: '/api/v1/chat',
      statusCode: 500,
      duration: 8000,
      fallbackMessage: '系统错误，请联系管理员',
      fallbackSuccess: false, // ❌ 降级失败
    });

    results.push({
      scenario: '降级失败',
      userImpact: '用户看到错误',
      severity: 'CRITICAL',
    });

    return {
      success: true,
      message: '消息降级场景测试完成',
      data: {
        testCount: 2,
        results,
      },
      note: '请在飞书群聊中查看 2 条告警，验证用户影响评估显示是否正确（✅ 已降级 vs ❌ 降级失败）',
    };
  }

  /**
   * 完整测试套件（一键运行所有测试）
   * @description 依次执行所有测试场景，全面验收告警系统
   * @example POST /alert/test/full-suite
   */
  @Post('test/full-suite')
  async testFullSuite(@Body() body?: { delayMs?: number }) {
    this.logger.log('🧪🧪🧪 开始完整测试套件');

    const delayMs = body?.delayMs || 3000; // 默认每个测试间隔 3 秒
    const results = [];

    // 1. 严重级别测试
    this.logger.log('▶️ 测试 1/6: 严重级别');
    const r1 = await this.testSeverityLevels();
    results.push({ test: '严重级别', result: r1 });
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    // 2. 聚合测试
    this.logger.log('▶️ 测试 2/6: 告警聚合');
    const r2 = await this.testThrottling();
    results.push({ test: '告警聚合', result: r2 });
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    // 3. 错误类型测试
    this.logger.log('▶️ 测试 3/6: 错误类型');
    const r3 = await this.testErrorTypes();
    results.push({ test: '错误类型', result: r3 });
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    // 4. 静默测试
    this.logger.log('▶️ 测试 4/6: 静默功能');
    const r4 = await this.testSilence();
    results.push({ test: '静默功能', result: r4 });
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    // 5. 业务指标测试
    this.logger.log('▶️ 测试 5/6: 业务指标');
    const r5 = await this.testMetrics();
    results.push({ test: '业务指标', result: r5 });
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    // 6. 消息降级测试
    this.logger.log('▶️ 测试 6/6: 消息降级');
    const r6 = await this.testFallback();
    results.push({ test: '消息降级', result: r6 });

    this.logger.log('✅ 完整测试套件执行完成');

    return {
      success: true,
      message: '✅ 完整测试套件执行完成',
      data: {
        totalTests: 6,
        results,
        summary: {
          test1: '严重级别 - 4 条告警（CRITICAL/ERROR/WARNING x2）',
          test2: '告警聚合 - 1 条告警（聚合 5 次）',
          test3: '错误类型 - 4 条告警（agent/message/delivery/merge）',
          test4: '静默功能 - 2 条告警（静默前后各 1 条）',
          test5: '业务指标 - 4 条告警（成功率/响应时间/队列/错误率）',
          test6: '消息降级 - 2 条告警（降级成功/失败）',
          expectedTotalAlerts: '预计收到 17 条飞书告警',
        },
      },
      note: [
        '📱 请在飞书群聊中验收以下内容：',
        '1. 严重级别图标和颜色正确（🚨🔴❌⚠️ℹ️）',
        '2. 聚合告警显示聚合次数和时间窗口',
        '3. 错误类型标签清晰',
        '4. 静默期间告警被正确屏蔽',
        '5. 业务指标告警显示当前值和阈值',
        '6. 消息降级告警显示用户影响评估（✅ 已降级 vs ❌ 降级失败）',
        '7. P0 改进：用户消息完整显示、请求耗时、智能日志链接',
      ],
    };
  }
}
