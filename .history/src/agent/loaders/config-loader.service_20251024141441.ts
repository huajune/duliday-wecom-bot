import { Injectable, Logger } from '@nestjs/common';
import { AgentProfile, ScenarioType } from '../interfaces/agent-profile.interface';

/**
 * Agent 配置加载器服务
 * 负责从文件系统加载 Agent 配置档案
 */
@Injectable()
export class ConfigLoaderService {
  private readonly logger = new Logger(ConfigLoaderService.name);

  /**
   * 加载所有配置档案
   */
  async loadAllProfiles(): Promise<AgentProfile[]> {
    try {
      // 从 context 目录加载配置
      // 每个场景一个目录，包含 context.json 和 system-prompt.md
      const profiles: AgentProfile[] = [];

      // 加载候选人咨询配置
      const candidateProfile = await this.loadProfileFromContext(
        ScenarioType.CANDIDATE_CONSULTATION,
      );
      if (candidateProfile) {
        profiles.push(candidateProfile);
      }

      return profiles;
    } catch (error) {
      this.logger.error('加载配置档案失败', error);
      return [];
    }
  }

  /**
   * 重新加载指定配置
   */
  async reloadProfile(profileName: string): Promise<AgentProfile | null> {
    try {
      return await this.loadProfileFromContext(profileName);
    } catch (error) {
      this.logger.error(`重新加载配置 ${profileName} 失败`, error);
      return null;
    }
  }

  /**
   * 从 context 目录加载指定场景的配置
   */
  private async loadProfileFromContext(
    scenarioType: string,
  ): Promise<AgentProfile | null> {
    try {
      // 动态导入配置文件
      const contextPath = `../context/${scenarioType}/context.json`;
      const toolContextPath = `../context/${scenarioType}/tool-context.json`;
      const promptPath = `../context/${scenarioType}/system-prompt.md`;

      // 这里可以根据实现添加具体的文件加载逻辑
      // 目前返回 null，表示需要由降级配置处理
      this.logger.debug(`尝试加载配置: ${scenarioType}`);
      return null;
    } catch (error) {
      this.logger.debug(`配置 ${scenarioType} 不存在，将使用降级配置`, error);
      return null;
    }
  }
}
