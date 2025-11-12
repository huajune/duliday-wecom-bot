import { Injectable, Logger } from '@nestjs/common';
import { AgentProfile, ScenarioType } from './interfaces/agent-profile.interface';
import { ProfileLoaderService } from './services/profile-loader.service';
import { BrandConfigService, BrandConfig } from './services/brand-config.service';
import { AgentConfigValidator } from './validators/agent-config.validator';
import { BrandConfigMonitor } from './monitors/brand-config.monitor';

/**
 * Agent 配置编排服务
 * 负责协调 ProfileLoaderService 和 BrandConfigService
 *
 * 职责：
 * 1. 合并 profile 和品牌配置
 * 2. 提供统一的配置获取接口
 * 3. 执行品牌配置验证和告警
 * 4. 代理 ProfileLoaderService 和 BrandConfigService 的方法
 */
@Injectable()
export class AgentConfigService {
  private readonly logger = new Logger(AgentConfigService.name);

  constructor(
    private readonly profileLoader: ProfileLoaderService,
    private readonly brandConfig: BrandConfigService,
    private readonly configValidator: AgentConfigValidator,
    private readonly brandMonitor: BrandConfigMonitor,
  ) {}

  /**
   * 获取配置（合并 profile + 品牌配置）
   * 每次调用都返回最新的合并结果
   */
  async getProfile(scenario: ScenarioType | string): Promise<AgentProfile | null> {
    // 1. 获取基础 profile
    const profile = this.profileLoader.getProfile(scenario);
    if (!profile) return null;

    // 2. 获取品牌配置
    const brandConfigData = await this.brandConfig.getBrandConfig();

    // 3. 合并
    const merged = this.mergeProfileWithBrandConfig(profile, brandConfigData);

    // 4. 验证并告警（在配置层处理）
    await this.validateAndAlert(merged);

    return merged;
  }

  /**
   * 获取所有 profiles
   */
  getAllProfiles(): AgentProfile[] {
    return this.profileLoader.getAllProfiles();
  }

  /**
   * 重新加载 profile
   */
  async reloadProfile(profileName: string): Promise<boolean> {
    return this.profileLoader.reloadProfile(profileName);
  }

  /**
   * 重新加载所有 profiles
   */
  async reloadAllProfiles(): Promise<void> {
    return this.profileLoader.reloadAllProfiles();
  }

  /**
   * 检查 profile 是否存在
   */
  hasProfile(profileName: string): boolean {
    return this.profileLoader.hasProfile(profileName);
  }

  /**
   * 删除 profile
   */
  removeProfile(profileName: string): boolean {
    return this.profileLoader.removeProfile(profileName);
  }

  /**
   * 验证 profile
   */
  validateProfile(profile: AgentProfile) {
    return this.profileLoader.validateProfile(profile);
  }

  /**
   * 刷新品牌配置
   */
  async refreshBrandConfig(): Promise<void> {
    return this.brandConfig.refreshBrandConfig();
  }

  /**
   * 获取品牌配置
   */
  async getBrandConfig(): Promise<BrandConfig | null> {
    return this.brandConfig.getBrandConfig();
  }

  /**
   * 获取品牌配置状态
   */
  async getBrandConfigStatus() {
    return this.brandConfig.getBrandConfigStatus();
  }

  /**
   * 检查品牌配置是否可用
   */
  isBrandConfigAvailable(): boolean {
    return this.brandConfig.isBrandConfigAvailable();
  }

  // ==================== 私有方法 ====================

  /**
   * 合并 profile 和品牌配置
   */
  private mergeProfileWithBrandConfig(
    profile: AgentProfile,
    brandConfigData: BrandConfig | null,
  ): AgentProfile {
    if (!brandConfigData) {
      return {
        ...profile,
        context: {
          ...profile.context,
          configSynced: false,
        },
      };
    }

    return {
      ...profile,
      context: {
        ...profile.context,
        brandData: brandConfigData.brandData,
        replyPrompts: brandConfigData.replyPrompts,
        configSynced: brandConfigData.synced,
      },
    };
  }

  /**
   * 验证并告警
   */
  private async validateAndAlert(profile: AgentProfile): Promise<void> {
    const validation = this.configValidator.validateBrandConfig(profile);

    if (!validation.isValid) {
      this.logger.warn(`品牌配置不完整: ${validation.missingFields.join(', ')}`);

      // 发送告警（不阻塞）
      await this.brandMonitor.handleBrandConfigUnavailable('system', validation, false);
    }
  }
}

// 导出 BrandConfig 类型以保持向后兼容
export { BrandConfig } from './services/brand-config.service';
