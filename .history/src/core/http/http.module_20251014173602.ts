import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpService } from './http.service';
import { HttpController } from './http.controller';

/**
 * HTTP 客户端模块
 * 提供通用的 HTTP 请求能力
 */
@Module({
  imports: [ConfigModule],
  controllers: [HttpController],
  providers: [HttpService],
  exports: [HttpService],
})
export class HttpModule {}
