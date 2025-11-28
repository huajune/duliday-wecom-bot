import { Global, Module } from '@nestjs/common';
import { HttpModule } from '@core/client-http';
import { SupabaseService } from './supabase.service';

/**
 * Supabase 模块
 * 全局模块，提供系统配置和用户托管状态管理
 */
@Global()
@Module({
  imports: [HttpModule],
  providers: [SupabaseService],
  exports: [SupabaseService],
})
export class SupabaseModule {}
