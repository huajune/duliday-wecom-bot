import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * 智能打字延迟服务
 * 模拟真人打字速度，避免机器人感
 *
 * 核心策略：
 * 1. 根据文字长度动态计算延迟
 * 2. 添加随机波动（±20%），更像真人
 * 3. 第一条消息前可以有额外的"思考时间"
 * 4. 支持通过环境变量调整速度
 */
@Injectable()
export class TypingDelayService {
  private readonly logger = new Logger(TypingDelayService.name);

  // 基础配置
  private readonly baseTypingSpeed: number; // 字符/秒
  private readonly minDelay: number; // 最小延迟（毫秒）
  private readonly maxDelay: number; // 最大延迟（毫秒）
  private readonly randomVariation: number; // 随机波动比例 (0.2 = ±20%)
  private readonly thinkingTimeMin: number; // 思考时间最小值（毫秒）
  private readonly thinkingTimeMax: number; // 思考时间最大值（毫秒）
  private readonly enableThinkingTime: boolean; // 是否启用思考时间

  constructor(private readonly configService: ConfigService) {
    // 从环境变量读取配置，提供合理的默认值
    this.baseTypingSpeed = this.configService.get<number>('TYPING_SPEED_CHARS_PER_SEC', 8); // 8字符/秒 ≈ 480字/分钟（真人：300-600字/分钟）
    this.minDelay = this.configService.get<number>('TYPING_MIN_DELAY_MS', 800); // 最小 800ms
    this.maxDelay = this.configService.get<number>('TYPING_MAX_DELAY_MS', 8000); // 最大 8s
    this.randomVariation = this.configService.get<number>('TYPING_RANDOM_VARIATION', 0.2); // ±20%
    this.thinkingTimeMin = this.configService.get<number>('TYPING_THINKING_TIME_MIN_MS', 1000); // 思考 1-3 秒
    this.thinkingTimeMax = this.configService.get<number>('TYPING_THINKING_TIME_MAX_MS', 3000);
    this.enableThinkingTime =
      this.configService.get<string>('ENABLE_TYPING_THINKING_TIME', 'true') === 'true';

    this.logger.log(`智能打字延迟服务已初始化`);
    this.logger.log(`- 打字速度: ${this.baseTypingSpeed} 字符/秒`);
    this.logger.log(`- 延迟范围: ${this.minDelay}ms ~ ${this.maxDelay}ms`);
    this.logger.log(`- 随机波动: ±${this.randomVariation * 100}%`);
    this.logger.log(
      `- 思考时间: ${this.enableThinkingTime ? `${this.thinkingTimeMin}ms ~ ${this.thinkingTimeMax}ms` : '已禁用'}`,
    );
  }

  /**
   * 计算消息段落之间的延迟时间
   * @param text 消息文本内容
   * @param isFirstSegment 是否是第一个片段
   * @param agentProcessTime Agent 处理耗时（毫秒），用于第一个片段的延迟决策
   * @returns 延迟时间（毫秒）
   */
  calculateDelay(text: string, isFirstSegment: boolean = false, agentProcessTime?: number): number {
    // 1. 计算文本长度（中英文都算 1 个字符）
    const textLength = text.length;

    // 2. 计算基础延迟：文本长度 ÷ 打字速度
    // 例如：40 个字符 ÷ 8 字符/秒 = 5 秒 = 5000ms
    const baseDelay = (textLength / this.baseTypingSpeed) * 1000;

    // 3. 添加随机波动（±20%）
    const variation = 1 + (Math.random() * 2 - 1) * this.randomVariation;
    let delay = baseDelay * variation;

    // 4. 第一个片段的特殊处理：考虑 Agent 处理时间
    if (isFirstSegment && this.enableThinkingTime) {
      // 如果提供了 Agent 处理时间，根据处理时间决定是否添加思考延迟
      if (agentProcessTime !== undefined) {
        const minReasonableWaitTime = 3000; // 用户可接受的最小等待时间（3秒）

        if (agentProcessTime >= minReasonableWaitTime) {
          // Agent 已经花了足够长的时间（≥3秒），用户已经等待了，立即发送
          this.logger.debug(
            `第一条消息，Agent 已处理 ${Math.round(agentProcessTime)}ms，立即发送（无额外延迟）`,
          );
          delay = 0; // 立即发送第一条消息
        } else {
          // Agent 处理很快（<3秒），添加补偿延迟，避免回复太快（显得像机器人）
          const compensationDelay = minReasonableWaitTime - agentProcessTime;
          delay = Math.min(delay, compensationDelay); // 使用较小的延迟

          this.logger.debug(
            `第一条消息，Agent 处理 ${Math.round(agentProcessTime)}ms（较快），补偿延迟 ${Math.round(delay)}ms`,
          );
        }
      } else {
        // 未提供 Agent 处理时间，使用默认的思考时间
        const thinkingTime =
          this.thinkingTimeMin + Math.random() * (this.thinkingTimeMax - this.thinkingTimeMin);
        delay += thinkingTime;
        this.logger.debug(
          `第一条消息，添加思考时间: ${Math.round(thinkingTime)}ms (总延迟: ${Math.round(delay)}ms)`,
        );
      }
    }

    // 5. 限制在合理范围内
    delay = Math.max(this.minDelay, Math.min(this.maxDelay, delay));

    this.logger.debug(
      `计算延迟: 文本长度=${textLength}, 基础延迟=${Math.round(baseDelay)}ms, 实际延迟=${Math.round(delay)}ms`,
    );

    return Math.round(delay);
  }

  /**
   * 计算多个消息段落的延迟数组
   * @param segments 消息段落数组
   * @returns 延迟时间数组（毫秒）
   */
  calculateDelays(segments: string[]): number[] {
    return segments.map((segment, index) => {
      const isFirstSegment = index === 0;
      return this.calculateDelay(segment, isFirstSegment);
    });
  }

  /**
   * 执行延迟
   * @param delayMs 延迟时间（毫秒）
   */
  async delay(delayMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      baseTypingSpeed: this.baseTypingSpeed,
      minDelay: this.minDelay,
      maxDelay: this.maxDelay,
      randomVariation: this.randomVariation,
      thinkingTimeMin: this.thinkingTimeMin,
      thinkingTimeMax: this.thinkingTimeMax,
      enableThinkingTime: this.enableThinkingTime,
    };
  }
}
