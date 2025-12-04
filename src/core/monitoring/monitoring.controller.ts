import {
  Controller,
  Get,
  Post,
  Delete,
  HttpCode,
  Logger,
  Body,
  Inject,
  forwardRef,
  Query,
  Param,
} from '@nestjs/common';
import { MonitoringService } from './monitoring.service';
import { DashboardData, MetricsData, TimeRange } from './interfaces/monitoring.interface';
import { MessageService } from '@wecom/message/message.service';
import { MessageFilterService } from '@wecom/message/services/message-filter.service';
import { MessageProcessor } from '@wecom/message/message.processor';
import { SupabaseService, AgentReplyConfig, DEFAULT_AGENT_REPLY_CONFIG } from '@core/supabase';

/**
 * 监控控制器
 * 提供监控数据查询 API
 */
@Controller('monitoring')
export class MonitoringController {
  private readonly logger = new Logger(MonitoringController.name);

  constructor(
    private readonly monitoringService: MonitoringService,
    @Inject(forwardRef(() => MessageService))
    private readonly messageService: MessageService,
    @Inject(forwardRef(() => MessageFilterService))
    private readonly filterService: MessageFilterService,
    @Inject(forwardRef(() => MessageProcessor))
    private readonly messageProcessor: MessageProcessor,
    private readonly supabaseService: SupabaseService,
  ) {}

  /**
   * 获取仪表盘数据
   * GET /monitoring/dashboard?range=today|week|month
   */
  @Get('dashboard')
  getDashboard(@Query('range') range?: TimeRange): DashboardData {
    const timeRange = range || 'today';
    return this.monitoringService.getDashboardData(timeRange);
  }

  /**
   * 获取详细指标数据
   * GET /monitoring/metrics
   */
  @Get('metrics')
  getMetrics(): MetricsData {
    return this.monitoringService.getMetricsData();
  }

  /**
   * 清空所有监控数据
   * POST /monitoring/clear
   */
  @Post('clear')
  @HttpCode(200)
  clearData(): { message: string } {
    this.logger.log('清空监控数据');
    this.monitoringService.clearAllData();
    return { message: '监控数据已清空' };
  }

  /**
   * 健康检查
   * GET /monitoring/health
   */
  @Get('health')
  health(): { status: string; timestamp: number } {
    return {
      status: 'ok',
      timestamp: Date.now(),
    };
  }

  /**
   * 获取 AI 回复开关状态
   * GET /monitoring/ai-reply-status
   */
  @Get('ai-reply-status')
  getAiReplyStatus(): { enabled: boolean } {
    this.logger.debug('获取 AI 回复开关状态');
    return {
      enabled: this.messageService.getAiReplyStatus(),
    };
  }

  /**
   * 切换 AI 回复开关
   * POST /monitoring/toggle-ai-reply
   */
  @Post('toggle-ai-reply')
  @HttpCode(200)
  async toggleAiReply(
    @Body('enabled') enabled: boolean,
  ): Promise<{ enabled: boolean; message: string }> {
    this.logger.log(`切换 AI 回复开关: ${enabled}`);
    const newStatus = await this.messageService.toggleAiReply(enabled);
    return {
      enabled: newStatus,
      message: `AI 自动回复功能已${newStatus ? '启用' : '禁用'}（已持久化）`,
    };
  }

  /**
   * 暂停用户托管
   * POST /monitoring/users/:userId/pause
   */
  @Post('users/:userId/pause')
  @HttpCode(200)
  async pauseUserHosting(@Param('userId') userId: string): Promise<{
    userId: string;
    isPaused: boolean;
    message: string;
  }> {
    this.logger.log(`暂停用户托管: ${userId}`);
    await this.filterService.pauseUser(userId);
    return {
      userId,
      isPaused: true,
      message: `用户 ${userId} 的托管已暂停（已持久化）`,
    };
  }

  /**
   * 恢复用户托管
   * POST /monitoring/users/:userId/resume
   */
  @Post('users/:userId/resume')
  @HttpCode(200)
  async resumeUserHosting(@Param('userId') userId: string): Promise<{
    userId: string;
    isPaused: boolean;
    message: string;
  }> {
    this.logger.log(`恢复用户托管: ${userId}`);
    await this.filterService.resumeUser(userId);
    return {
      userId,
      isPaused: false,
      message: `用户 ${userId} 的托管已恢复（已持久化）`,
    };
  }

  /**
   * 获取暂停托管的用户列表
   * GET /monitoring/users/paused
   */
  @Get('users/paused')
  async getPausedUsers(): Promise<{ users: { userId: string; pausedAt: number }[] }> {
    this.logger.debug('获取暂停托管用户列表');
    return {
      users: await this.filterService.getPausedUsers(),
    };
  }

  /**
   * 检查用户是否被暂停托管
   * GET /monitoring/users/:userId/status
   */
  @Get('users/:userId/status')
  async getUserHostingStatus(
    @Param('userId') userId: string,
  ): Promise<{ userId: string; isPaused: boolean }> {
    return {
      userId,
      isPaused: await this.filterService.isUserPaused(userId),
    };
  }

  /**
   * 生成测试数据（仅用于开发/演示）
   * POST /monitoring/generate-test-data
   */
  @Post('generate-test-data')
  @HttpCode(200)
  generateTestData(@Body('days') days?: number): { message: string; recordsGenerated: number } {
    const targetDays = days || 7;
    this.logger.log(`生成 ${targetDays} 天的测试数据`);
    const count = this.monitoringService.generateTestData(targetDays);
    return {
      message: `已生成 ${targetDays} 天的测试数据`,
      recordsGenerated: count,
    };
  }

  // ==================== Agent 回复策略配置 ====================

  /**
   * 获取 Agent 回复策略配置
   * GET /monitoring/agent-config
   */
  @Get('agent-config')
  async getAgentReplyConfig(): Promise<{
    config: AgentReplyConfig;
    defaults: AgentReplyConfig;
  }> {
    this.logger.debug('获取 Agent 回复策略配置');
    const config = await this.supabaseService.getAgentReplyConfig();
    return {
      config,
      defaults: DEFAULT_AGENT_REPLY_CONFIG,
    };
  }

  /**
   * 更新 Agent 回复策略配置
   * POST /monitoring/agent-config
   */
  @Post('agent-config')
  @HttpCode(200)
  async updateAgentReplyConfig(
    @Body() body: Partial<AgentReplyConfig>,
  ): Promise<{ config: AgentReplyConfig; message: string }> {
    this.logger.log(`更新 Agent 回复策略配置: ${JSON.stringify(body)}`);

    // 验证配置值
    const validatedConfig: Partial<AgentReplyConfig> = {};

    if (body.initialMergeWindowMs !== undefined) {
      const value = Number(body.initialMergeWindowMs);
      if (isNaN(value) || value < 0 || value > 30000) {
        throw new Error('initialMergeWindowMs 必须在 0-30000 之间');
      }
      validatedConfig.initialMergeWindowMs = value;
    }

    if (body.maxMergedMessages !== undefined) {
      const value = Number(body.maxMergedMessages);
      if (isNaN(value) || value < 1 || value > 10) {
        throw new Error('maxMergedMessages 必须在 1-10 之间');
      }
      validatedConfig.maxMergedMessages = value;
    }

    if (body.typingDelayPerCharMs !== undefined) {
      const value = Number(body.typingDelayPerCharMs);
      if (isNaN(value) || value < 0 || value > 500) {
        throw new Error('typingDelayPerCharMs 必须在 0-500 之间');
      }
      validatedConfig.typingDelayPerCharMs = value;
    }

    if (body.paragraphGapMs !== undefined) {
      const value = Number(body.paragraphGapMs);
      if (isNaN(value) || value < 0 || value > 10000) {
        throw new Error('paragraphGapMs 必须在 0-10000 之间');
      }
      validatedConfig.paragraphGapMs = value;
    }

    if (body.alertThrottleWindowMs !== undefined) {
      const value = Number(body.alertThrottleWindowMs);
      if (isNaN(value) || value < 60000 || value > 3600000) {
        throw new Error('alertThrottleWindowMs 必须在 60000-3600000 之间（1分钟-1小时）');
      }
      validatedConfig.alertThrottleWindowMs = value;
    }

    if (body.alertThrottleMaxCount !== undefined) {
      const value = Number(body.alertThrottleMaxCount);
      if (isNaN(value) || value < 1 || value > 100) {
        throw new Error('alertThrottleMaxCount 必须在 1-100 之间');
      }
      validatedConfig.alertThrottleMaxCount = value;
    }

    // 业务指标告警开关（布尔值）
    if (body.businessAlertEnabled !== undefined) {
      validatedConfig.businessAlertEnabled = Boolean(body.businessAlertEnabled);
    }

    // 最小样本量
    if (body.minSamplesForAlert !== undefined) {
      const value = Number(body.minSamplesForAlert);
      if (isNaN(value) || value < 1 || value > 1000) {
        throw new Error('minSamplesForAlert 必须在 1-1000 之间');
      }
      validatedConfig.minSamplesForAlert = value;
    }

    // 同类告警最小间隔（分钟）
    if (body.alertIntervalMinutes !== undefined) {
      const value = Number(body.alertIntervalMinutes);
      if (isNaN(value) || value < 1 || value > 1440) {
        throw new Error('alertIntervalMinutes 必须在 1-1440 之间（1分钟-24小时）');
      }
      validatedConfig.alertIntervalMinutes = value;
    }

    // ===== 告警阈值配置 =====

    // 成功率严重阈值（百分比）
    if (body.successRateCritical !== undefined) {
      const value = Number(body.successRateCritical);
      if (isNaN(value) || value < 0 || value > 100) {
        throw new Error('successRateCritical 必须在 0-100 之间');
      }
      validatedConfig.successRateCritical = value;
    }

    // 响应时间严重阈值（毫秒）
    if (body.avgDurationCritical !== undefined) {
      const value = Number(body.avgDurationCritical);
      if (isNaN(value) || value < 1000 || value > 300000) {
        throw new Error('avgDurationCritical 必须在 1000-300000 之间（1秒-5分钟）');
      }
      validatedConfig.avgDurationCritical = value;
    }

    // 队列深度严重阈值（条数）
    if (body.queueDepthCritical !== undefined) {
      const value = Number(body.queueDepthCritical);
      if (isNaN(value) || value < 1 || value > 1000) {
        throw new Error('queueDepthCritical 必须在 1-1000 之间');
      }
      validatedConfig.queueDepthCritical = value;
    }

    // 错误率严重阈值（每小时次数）
    if (body.errorRateCritical !== undefined) {
      const value = Number(body.errorRateCritical);
      if (isNaN(value) || value < 1 || value > 1000) {
        throw new Error('errorRateCritical 必须在 1-1000 之间');
      }
      validatedConfig.errorRateCritical = value;
    }

    const newConfig = await this.supabaseService.setAgentReplyConfig(validatedConfig);

    // 根据更新内容生成不同的提示信息
    const message = this.getUpdateMessage(body);

    return {
      config: newConfig,
      message,
    };
  }

  /**
   * 根据更新内容生成对应的提示信息
   */
  private getUpdateMessage(body: Partial<AgentReplyConfig>): string {
    // 告警开关
    if (body.businessAlertEnabled !== undefined) {
      return body.businessAlertEnabled
        ? '业务告警已启用（已实时生效）'
        : '业务告警已禁用（已实时生效）';
    }

    // 告警阈值配置
    const thresholdKeys = [
      'successRateCritical',
      'avgDurationCritical',
      'queueDepthCritical',
      'errorRateCritical',
    ];
    if (thresholdKeys.some((key) => body[key as keyof AgentReplyConfig] !== undefined)) {
      return '告警阈值配置已更新（已实时生效）';
    }

    // 告警相关配置
    const alertKeys = ['minSamplesForAlert', 'alertIntervalMinutes'];
    if (alertKeys.some((key) => body[key as keyof AgentReplyConfig] !== undefined)) {
      return '告警配置已更新（已实时生效）';
    }

    // 消息聚合配置
    const mergeKeys = ['initialMergeWindowMs', 'maxMergedMessages'];
    if (mergeKeys.some((key) => body[key as keyof AgentReplyConfig] !== undefined)) {
      return '消息聚合配置已更新（已实时生效）';
    }

    // 其他配置
    return '配置已更新（已实时生效）';
  }

  /**
   * 重置 Agent 回复策略配置为默认值
   * POST /monitoring/agent-config/reset
   */
  @Post('agent-config/reset')
  @HttpCode(200)
  async resetAgentReplyConfig(): Promise<{ config: AgentReplyConfig; message: string }> {
    this.logger.log('重置 Agent 回复策略配置为默认值');
    const newConfig = await this.supabaseService.setAgentReplyConfig(DEFAULT_AGENT_REPLY_CONFIG);
    return {
      config: newConfig,
      message: 'Agent 回复策略配置已重置为默认值',
    };
  }

  // ==================== 账号托管管理（统一黑名单） ====================

  /**
   * 获取黑名单列表（统一接口）
   * GET /monitoring/blacklist
   * @returns 包含 chatIds（用户）和 groupIds（小组）的黑名单列表
   */
  @Get('blacklist')
  async getBlacklist(): Promise<{
    chatIds: string[];
    groupIds: string[];
  }> {
    this.logger.debug('获取黑名单列表');
    const [pausedUsers, groupBlacklist] = await Promise.all([
      this.filterService.getPausedUsers(),
      this.filterService.getGroupBlacklist(),
    ]);

    return {
      chatIds: pausedUsers.map((u) => u.userId),
      groupIds: groupBlacklist.map((g) => g.groupId),
    };
  }

  /**
   * 添加到黑名单（统一接口）
   * POST /monitoring/blacklist
   * @body { id: string, type: 'chatId' | 'groupId', reason?: string }
   */
  @Post('blacklist')
  @HttpCode(200)
  async addToBlacklist(
    @Body() body: { id: string; type: 'chatId' | 'groupId'; reason?: string },
  ): Promise<{ message: string }> {
    const { id, type, reason } = body;

    if (!id || !type) {
      throw new Error('id 和 type 参数必填');
    }

    if (type === 'chatId') {
      this.logger.log(`添加用户到黑名单: ${id}`);
      await this.filterService.pauseUser(id);
      return { message: `用户 ${id} 已添加到黑名单（托管已暂停）` };
    } else if (type === 'groupId') {
      this.logger.log(`添加小组到黑名单: ${id}, reason=${reason}`);
      await this.filterService.addGroupToBlacklist(id, reason);
      return { message: `小组 ${id} 已添加到黑名单` };
    } else {
      throw new Error('type 必须是 chatId 或 groupId');
    }
  }

  /**
   * 从黑名单移除（统一接口）
   * DELETE /monitoring/blacklist
   * @body { id: string, type: 'chatId' | 'groupId' }
   */
  @Delete('blacklist')
  async removeFromBlacklist(
    @Body() body: { id: string; type: 'chatId' | 'groupId' },
  ): Promise<{ message: string }> {
    const { id, type } = body;

    if (!id || !type) {
      throw new Error('id 和 type 参数必填');
    }

    if (type === 'chatId') {
      this.logger.log(`从黑名单移除用户: ${id}`);
      await this.filterService.resumeUser(id);
      return { message: `用户 ${id} 已从黑名单移除（托管已恢复）` };
    } else if (type === 'groupId') {
      this.logger.log(`从黑名单移除小组: ${id}`);
      const removed = await this.filterService.removeGroupFromBlacklist(id);
      if (removed) {
        return { message: `小组 ${id} 已从黑名单移除` };
      } else {
        return { message: `小组 ${id} 不在黑名单中` };
      }
    } else {
      throw new Error('type 必须是 chatId 或 groupId');
    }
  }

  /**
   * 切换用户托管状态
   * POST /monitoring/users/:chatId/hosting
   * @body { enabled: boolean }
   */
  @Post('users/:chatId/hosting')
  @HttpCode(200)
  async toggleUserHosting(
    @Param('chatId') chatId: string,
    @Body('enabled') enabled: boolean,
  ): Promise<{ chatId: string; hostingEnabled: boolean; message: string }> {
    this.logger.log(`切换用户托管状态: ${chatId}, enabled=${enabled}`);

    if (enabled) {
      await this.filterService.resumeUser(chatId);
      return {
        chatId,
        hostingEnabled: true,
        message: `用户 ${chatId} 的托管已启用`,
      };
    } else {
      await this.filterService.pauseUser(chatId);
      return {
        chatId,
        hostingEnabled: false,
        message: `用户 ${chatId} 的托管已暂停`,
      };
    }
  }

  /**
   * 获取用户列表（含托管状态）
   * GET /monitoring/users
   */
  @Get('users')
  async getUsers(): Promise<
    {
      chatId: string;
      userName?: string;
      messageCount: number;
      tokenUsage: number;
      lastActiveAt?: string;
      hostingEnabled: boolean;
    }[]
  > {
    this.logger.debug('获取用户列表');
    const users = this.monitoringService.getTodayUsers();
    const pausedUsers = await this.filterService.getPausedUsers();
    const pausedSet = new Set(pausedUsers.map((u) => u.userId));

    return users.map((user) => ({
      chatId: user.chatId,
      userName: user.odName || user.chatId,
      messageCount: user.messageCount,
      tokenUsage: user.tokenUsage,
      lastActiveAt: user.lastActiveAt ? new Date(user.lastActiveAt).toISOString() : undefined,
      hostingEnabled: !pausedSet.has(user.chatId),
    }));
  }

  // ==================== Worker 并发管理 ====================

  /**
   * 获取 Worker 状态
   * GET /monitoring/worker-status
   */
  @Get('worker-status')
  getWorkerStatus(): {
    concurrency: number;
    activeJobs: number;
    minConcurrency: number;
    maxConcurrency: number;
  } {
    this.logger.debug('获取 Worker 状态');
    return this.messageProcessor.getWorkerStatus();
  }

  /**
   * 设置 Worker 并发数
   * POST /monitoring/worker-concurrency
   * @body { concurrency: number }
   */
  @Post('worker-concurrency')
  @HttpCode(200)
  async setWorkerConcurrency(@Body('concurrency') concurrency: number): Promise<{
    success: boolean;
    message: string;
    previousConcurrency: number;
    currentConcurrency: number;
  }> {
    this.logger.log(`设置 Worker 并发数: ${concurrency}`);

    if (concurrency === undefined || concurrency === null) {
      return {
        success: false,
        message: 'concurrency 参数必填',
        previousConcurrency: this.messageProcessor.getWorkerStatus().concurrency,
        currentConcurrency: this.messageProcessor.getWorkerStatus().concurrency,
      };
    }

    return this.messageProcessor.setConcurrency(concurrency);
  }

  // ==================== 聊天记录查询 ====================

  /**
   * 获取聊天记录（支持日期筛选）
   * GET /monitoring/chat-messages?page=1&pageSize=50&date=2024-01-15
   */
  @Get('chat-messages')
  async getChatMessages(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('date') date?: string,
  ): Promise<{
    messages: Array<{
      id: string;
      chatId: string;
      role: 'user' | 'assistant';
      content: string;
      timestamp: number;
      candidateName?: string;
      managerName?: string;
    }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    const pageNum = parseInt(page || '1', 10);
    const pageSizeNum = parseInt(pageSize || '50', 10);
    const targetDate = date ? new Date(date) : new Date();

    this.logger.debug(
      `获取聊天记录: date=${targetDate.toISOString().split('T')[0]}, page=${pageNum}, pageSize=${pageSizeNum}`,
    );

    return this.supabaseService.getTodayChatMessages(targetDate, pageNum, pageSizeNum);
  }

  /**
   * 获取所有会话列表
   * GET /monitoring/chat-sessions?days=7
   * GET /monitoring/chat-sessions?startDate=2024-01-01&endDate=2024-01-31
   * v1.3: 新增 avatar, contactType 字段
   * v1.4: 支持精确的 startDate/endDate 时间范围筛选
   */
  @Get('chat-sessions')
  async getChatSessions(
    @Query('days') days?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<{
    sessions: Array<{
      chatId: string;
      candidateName?: string;
      managerName?: string;
      messageCount: number;
      lastMessage?: string;
      lastTimestamp?: number;
      // v1.3 新增字段
      avatar?: string;
      contactType?: string;
    }>;
  }> {
    // 优先使用精确时间范围
    if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = endDate ? new Date(endDate) : new Date();
      end.setHours(23, 59, 59, 999);
      this.logger.debug(`获取会话列表: ${start.toISOString()} ~ ${end.toISOString()}`);
      const sessions = await this.supabaseService.getChatSessionListByDateRange(start, end);
      return { sessions };
    }

    // 兼容旧的 days 参数
    const daysNum = parseInt(days || '1', 10);
    this.logger.debug(`获取会话列表: 最近 ${daysNum} 天`);
    const sessions = await this.supabaseService.getChatSessionList(daysNum);
    return { sessions };
  }

  /**
   * 获取聊天趋势数据
   * GET /monitoring/chat-trend?days=7
   */
  @Get('chat-trend')
  async getChatTrend(@Query('days') days?: string): Promise<
    Array<{
      hour: string;
      message_count: number;
      active_users: number;
      active_chats: number;
    }>
  > {
    const daysNum = parseInt(days || '7', 10);
    this.logger.debug(`获取聊天趋势: 最近 ${daysNum} 天`);
    const history = await this.supabaseService.getMonitoringHourlyHistory(daysNum);
    return history.map((item) => ({
      hour: item.hour,
      message_count: item.message_count,
      active_users: item.active_users,
      active_chats: item.active_chats,
    }));
  }

  /**
   * 获取指定会话的聊天记录
   * GET /monitoring/chat-sessions/:chatId/messages
   * v1.3: 新增 messageType, source, contactType, isSelf, avatar, externalUserId 字段
   */
  @Get('chat-sessions/:chatId/messages')
  async getChatSessionMessages(@Param('chatId') chatId: string): Promise<{
    chatId: string;
    messages: Array<{
      messageId: string;
      role: 'user' | 'assistant';
      content: string;
      timestamp: number;
      candidateName?: string;
      managerName?: string;
      // v1.3 新增字段
      messageType?: string;
      source?: string;
      contactType?: string;
      isSelf?: boolean;
      avatar?: string;
      externalUserId?: string;
    }>;
  }> {
    this.logger.debug(`获取会话消息: chatId=${chatId}`);
    const messages = await this.supabaseService.getChatHistoryDetail(chatId);
    return { chatId, messages };
  }
}
