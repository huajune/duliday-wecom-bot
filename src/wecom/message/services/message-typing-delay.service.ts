import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * 智能打字延迟服务
 * 模拟真人打字速度，避免机器人感
 *
 * 核心策略：
 * 1. 打字延迟 = 文本长度 × 每字符延迟
 * 2. 段落间隔 = 固定延迟（模拟发完一段后的停顿）
 */
@Injectable()
export class TypingDelayService {
  private readonly logger = new Logger(TypingDelayService.name);

  // 核心配置（仅2个）
  private readonly typingDelayPerChar: number; // 每字符延迟（毫秒）
  private readonly paragraphGap: number; // 段落间隔（毫秒）

  constructor(private readonly configService: ConfigService) {
    // 从环境变量读取配置（显式转换为数字）
    this.typingDelayPerChar = Number(
      this.configService.get<string>('TYPING_DELAY_PER_CHAR_MS', '100'),
    );
    this.paragraphGap = Number(this.configService.get<string>('PARAGRAPH_GAP_MS', '2000'));

    this.logger.log(`打字延迟服务已初始化`);
    this.logger.log(`- 每字符延迟: ${this.typingDelayPerChar}ms`);
    this.logger.log(`- 段落间隔: ${this.paragraphGap}ms`);
  }

  /**
   * 计算消息段落之间的延迟时间
   * @param text 消息文本内容
   * @param isFirstSegment 是否是第一个片段
   * @returns 延迟时间（毫秒）
   */
  calculateDelay(text: string, isFirstSegment: boolean = false): number {
    // 1. 第一段立即发送（用户已等待Agent处理时间）
    if (isFirstSegment) {
      this.logger.debug(`第一段立即发送（无延迟）`);
      return 0;
    }

    // 2. 后续段落：打字延迟 + 段落间隔
    const typingDelay = text.length * this.typingDelayPerChar;
    const delay = typingDelay + this.paragraphGap;

    this.logger.debug(
      `后续段落延迟: ${delay}ms (打字${typingDelay}ms + 间隔${this.paragraphGap}ms)`,
    );

    return delay;
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
      typingDelayPerChar: this.typingDelayPerChar,
      paragraphGap: this.paragraphGap,
    };
  }
}
