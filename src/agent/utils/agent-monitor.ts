import { Injectable, Logger } from '@nestjs/common';
import { FeiShuAlertService } from '@/core/alert/feishu-alert.service';
import { BrandConfigValidation } from './agent-validator';

/**
 * 品牌配置监控服务
 * 负责监控品牌配置的可用性并发送告警
 *
 * 职责：
 * 1. 监控品牌配置状态
 * 2. 发送飞书告警（异步）
 * 3. 记录配置问题日志
 */
@Injectable()
export class BrandConfigMonitor {
  private readonly logger = new Logger(BrandConfigMonitor.name);

  constructor(private readonly feiShuAlertService: FeiShuAlertService) {}

  /**
   * 处理品牌配置不可用情况
   * @param conversationId 会话ID
   * @param validation 验证结果
   * @param isFirstLoad 是否首次加载
   */
  async handleBrandConfigUnavailable(
    conversationId: string,
    validation: BrandConfigValidation,
    isFirstLoad = false,
  ): Promise<void> {
    this.logger.warn(
      `⚠️ 品牌配置不可用或为空，会话: ${conversationId}, 缺失字段: ${validation.missingFields.join(', ')}`,
    );

    // 发送飞书告警（异步，不阻塞响应）
    this.sendAlertAsync(validation, isFirstLoad);
  }

  /**
   * 异步发送飞书告警
   * @param validation 验证结果
   * @param isFirstLoad 是否首次加载
   */
  private async sendAlertAsync(
    validation: BrandConfigValidation,
    isFirstLoad: boolean,
  ): Promise<void> {
    try {
      const error = new Error(`品牌配置不完整: 缺失字段 ${validation.missingFields.join(', ')}`);

      await this.feiShuAlertService.sendBrandConfigUnavailableAlert(error, isFirstLoad);

      this.logger.debug('品牌配置不可用告警已发送');
    } catch (error) {
      this.logger.error('发送品牌配置不可用告警失败:', error.message);
    }
  }

  /**
   * 记录配置恢复日志
   * @param conversationId 会话ID
   */
  logConfigRestored(conversationId: string): void {
    this.logger.log(`✅ 品牌配置已恢复，会话: ${conversationId}`);
  }
}
