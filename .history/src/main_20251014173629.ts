import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 启用 CORS
  app.enableCors();

  // 从配置服务获取端口
  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 8080);
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');

  await app.listen(port);

  console.log('========================================');
  console.log(`🚀 服务已启动`);
  console.log(`📍 监听端口: ${port}`);
  console.log(`🌍 运行环境: ${nodeEnv}`);
  console.log(`🔗 访问地址: http://localhost:${port}`);
  console.log('========================================');
}
bootstrap();
