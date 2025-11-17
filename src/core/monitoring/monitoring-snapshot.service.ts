import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import * as path from 'path';
import { MonitoringSnapshot } from './interfaces/monitoring.interface';

/**
 * 负责将监控数据持久化到本地 JSON 文件
 */
@Injectable()
export class MonitoringSnapshotService {
  private readonly logger = new Logger(MonitoringSnapshotService.name);
  private readonly snapshotPath: string;
  private readonly enabled: boolean;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly configService: ConfigService) {
    const configuredPath = this.configService.get<string>('MONITORING_SNAPSHOT_PATH');
    this.snapshotPath = configuredPath
      ? path.isAbsolute(configuredPath)
        ? configuredPath
        : path.join(process.cwd(), configuredPath)
      : path.join(process.cwd(), 'storage', 'monitoring-data.json');

    const enabledConfig = this.configService.get<string>('MONITORING_SNAPSHOT_ENABLED');
    this.enabled = enabledConfig !== 'false';
  }

  /**
   * 读取快照
   */
  async readSnapshot(): Promise<MonitoringSnapshot | null> {
    if (!this.enabled) {
      return null;
    }

    try {
      const content = await fs.readFile(this.snapshotPath, 'utf8');
      return JSON.parse(content) as MonitoringSnapshot;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        this.logger.warn(`读取监控快照失败: ${error?.message ?? error}`);
      }
      return null;
    }
  }

  /**
   * 保存快照（串行写入，避免竞争）
   */
  saveSnapshot(snapshot: MonitoringSnapshot): void {
    if (!this.enabled) {
      return;
    }

    this.writeQueue = this.writeQueue
      .catch((error) => {
        this.logger.warn(`监控快照写入队列异常: ${error?.message ?? error}`);
      })
      .then(() => this.writeToFile(snapshot));
  }

  private async writeToFile(snapshot: MonitoringSnapshot): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.snapshotPath), { recursive: true });
      await fs.writeFile(this.snapshotPath, JSON.stringify(snapshot, null, 2), 'utf8');
      this.logger.debug(`监控快照已写入: ${this.snapshotPath}`);
    } catch (error: any) {
      this.logger.error(`写入监控快照失败: ${error?.message ?? error}`);
    }
  }
}
