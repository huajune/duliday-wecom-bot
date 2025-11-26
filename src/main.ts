import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { ResponseInterceptor, HttpExceptionFilter } from '@core/server';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { networkInterfaces } from 'os';
import { execSync } from 'child_process';
import * as net from 'net';
import { CustomLoggerService } from '@core/logger';

/**
 * 获取本机局域网 IP 地址
 */
function getLocalIpAddress(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    const netInfo = nets[name];
    if (!netInfo) continue;

    for (const netInterface of netInfo) {
      // 跳过非 IPv4 和内部地址
      if (netInterface.family === 'IPv4' && !netInterface.internal) {
        return netInterface.address;
      }
    }
  }
  return 'localhost';
}

/**
 * 检查端口是否被占用
 */
function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port);
  });
}

/**
 * 清理占用端口的进程
 */
function killProcessOnPort(port: number): boolean {
  try {
    // macOS/Linux: 使用 lsof 找到占用端口的进程并杀死
    const result = execSync(`lsof -ti :${port}`, { encoding: 'utf-8' }).trim();
    if (result) {
      const pids = result.split('\n');
      for (const pid of pids) {
        if (pid) {
          execSync(`kill -9 ${pid}`);
          console.log(`⚠️  已终止占用端口 ${port} 的进程 (PID: ${pid})`);
        }
      }
      return true;
    }
  } catch {
    // 没有找到占用端口的进程，或者 kill 失败
  }
  return false;
}

/**
 * 确保端口可用（如果被占用则清理）
 */
async function ensurePortAvailable(port: number): Promise<void> {
  const inUse = await isPortInUse(port);
  if (inUse) {
    console.log(`⚠️  端口 ${port} 被占用，正在清理...`);
    const killed = killProcessOnPort(port);
    if (killed) {
      // 等待端口释放
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const stillInUse = await isPortInUse(port);
      if (stillInUse) {
        throw new Error(`无法释放端口 ${port}，请手动检查`);
      }
      console.log(`✅ 端口 ${port} 已释放`);
    } else {
      throw new Error(`端口 ${port} 被占用，无法自动清理`);
    }
  }
}

async function bootstrap() {
  // 先从环境变量获取端口，在创建应用前检查端口可用性
  const port = parseInt(process.env.PORT || '8080', 10);

  // 确保端口可用（如果被占用则自动清理）
  await ensurePortAvailable(port);

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true, // 缓冲日志直到 Logger 设置完成
  });

  // 设置自定义 Logger（推送到 Dashboard 控制台）
  // 注意：CustomLoggerService 使用 TRANSIENT 作用域，需要用 resolve() 而非 get()
  const customLogger = await app.resolve(CustomLoggerService);
  app.useLogger(customLogger);

  // 启用 CORS
  app.enableCors();

  // 配置静态文件服务（用于监控页面）
  // 使用 process.cwd() 确保在开发和生产环境都能正确找到 public 目录
  const publicPath = join(process.cwd(), 'public');
  app.useStaticAssets(publicPath);

  // 获取 Reflector 实例（用于读取装饰器元数据）
  const reflector = app.get(Reflector);

  // 全局注册响应拦截器（统一包装所有响应）
  app.useGlobalInterceptors(new ResponseInterceptor(reflector));

  // 全局注册异常过滤器（统一处理所有异常）
  app.useGlobalFilters(new HttpExceptionFilter());

  // 从配置服务获取端口和环境
  const configService = app.get(ConfigService);
  const nodeEnv = configService.get<string>('NODE_ENV')!;

  await app.listen(port);

  const localIp = getLocalIpAddress();

  console.log('========================================');
  console.log(`🚀 服务已启动`);
  console.log(`📍 监听端口: ${port}`);
  console.log(`🌍 运行环境: ${nodeEnv}`);
  console.log(`🔗 本地访问: http://localhost:${port}`);
  console.log(`🌐 局域网访问: http://${localIp}:${port}`);
  console.log(`📊 监控仪表盘: http://${localIp}:${port}/dashboard/`);
  console.log(`📦 API 响应格式: 统一包装（全局生效）`);
  console.log('========================================');
}
bootstrap();
