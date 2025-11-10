import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FeiShuAlertService } from './feishu-alert.service';
import { AlertController } from './alert.controller';

/**
 * 告警模块
 * 提供飞书告警功能
 *
 * @Global 装饰器使该模块成为全局模块，无需在每个模块中重复导入
 */
@Global()
@Module({
  imports: [ConfigModule],
  controllers: [AlertController],
  providers: [FeiShuAlertService],
  exports: [FeiShuAlertService],
})
export class AlertModule {}
