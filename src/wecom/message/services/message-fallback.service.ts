import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FallbackMessageOptions } from '../types';

/**
 * 集中管理用户侧降级话术
 * 目前先使用本地默认配置，未来可扩展为远程配置/品牌自定义
 */
@Injectable()
export class FallbackMessageService {
  private readonly defaultFallbackMessages: string[] = [
    '收到，我需要跟同事同步一下再回复您～',
    '抱歉稍等，我需要跟同事确认一下再回复您～',
    '您先别急，我这边马上去核实一下信息～',
    '我这边先去对下数据，请稍等哈～',
    '稍等片刻，我跟负责的同事了解下最新的信息～',
  ];

  constructor(private readonly configService: ConfigService) {}

  getMessage(options?: FallbackMessageOptions): string {
    if (options?.customMessage) {
      return options.customMessage;
    }

    const envMessage = this.configService.get<string>('AGENT_FALLBACK_MESSAGE', '');
    if (envMessage) {
      return envMessage;
    }

    if (options?.random === false) {
      return this.defaultFallbackMessages[0];
    }

    return this.pickRandomMessage();
  }

  private pickRandomMessage(): string {
    const index = Math.floor(Math.random() * this.defaultFallbackMessages.length);
    return this.defaultFallbackMessages[index];
  }
}
