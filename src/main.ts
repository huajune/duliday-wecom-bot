import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { ResponseInterceptor, HttpExceptionFilter } from '@core/server';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // 启用 CORS
  app.enableCors();

  // 配置静态文件服务（用于监控页面）
  app.useStaticAssets(join(__dirname, '..', 'public'));

  // 获取 Reflector 实例（用于读取装饰器元数据）
  const reflector = app.get(Reflector);

  // 全局注册响应拦截器（统一包装所有响应）
  app.useGlobalInterceptors(new ResponseInterceptor(reflector));

  // 全局注册异常过滤器（统一处理所有异常）
  app.useGlobalFilters(new HttpExceptionFilter());

  // 从配置服务获取端口（已在启动时验证，这里可以安全使用）
  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT')!;
  const nodeEnv = configService.get<string>('NODE_ENV')!;

  await app.listen(port);

  console.log('========================================');
  console.log(`🚀 服务已启动`);
  console.log(`📍 监听端口: ${port}`);
  console.log(`🌍 运行环境: ${nodeEnv}`);
  console.log(`🔗 访问地址: http://localhost:${port}`);
  console.log(`📊 监控仪表盘: http://localhost:${port}/monitoring.html`);
  console.log(`📦 API 响应格式: 统一包装（全局生效）`);
  console.log('========================================');
}
bootstrap();
