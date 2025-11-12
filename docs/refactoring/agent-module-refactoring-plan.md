# Agent 模块分阶段重构计划

**计划日期**: 2025-11-12
**预计总工时**: ~21.5 小时
**目标**: 解决技术债务，优化架构，提升代码质量

---

## 🎯 重构原则

1. **增量重构**: 每个阶段独立完成，可增量发布
2. **测试先行**: 每个阶段必须包含测试
3. **向后兼容**: 重构期间保持 API 兼容
4. **风险可控**: 优先处理低风险、高价值的问题

---

## 📅 阶段划分

| 阶段 | 名称 | 工作量 | 风险 | 优先级 |
|------|------|--------|------|--------|
| **阶段 0** | 准备工作 | 1h | 低 | P0 |
| **阶段 1** | 遗留代码清理 | 0.5h | 低 | P0 |
| **阶段 2** | 解除循环依赖 | 2h | 中 | P0 |
| **阶段 3** | 拆分 AgentConfigService | 8h | 高 | P0 |
| **阶段 4** | 统一工具/模型管理 | 3h | 中 | P1 |
| **阶段 5** | 优化 AgentResult 适配 | 4h | 低 | P2 |
| **阶段 6** | 清理导出和安全性 | 2h | 低 | P2 |
| **阶段 7** | 测试和文档完善 | 1h | 低 | P2 |

---

## 🚀 阶段 0: 准备工作 (1h)

### 目标
- 确保代码可安全重构
- 建立测试基准

### 任务清单

#### 0.1 建立测试基准 (0.5h)
```bash
# 运行现有测试，确保全部通过
pnpm run test

# 记录当前测试覆盖率
pnpm run test:cov

# 生成基准报告
pnpm run test -- --json --outputFile=test-baseline.json
```

**验收标准**:
- ✅ 所有现有测试通过
- ✅ 测试覆盖率报告已生成
- ✅ 基准报告已保存

#### 0.2 创建功能快照 (0.5h)
```bash
# 测试关键 API 端点
curl http://localhost:8080/agent/health
curl http://localhost:8080/agent/models
curl http://localhost:8080/agent/tools
curl -X POST http://localhost:8080/agent/test-chat \
  -H "Content-Type: application/json" \
  -d '{"message":"你好","conversationId":"test"}'

# 保存响应快照
```

**验收标准**:
- ✅ 所有 API 端点正常响应
- ✅ 响应快照已保存
- ✅ 性能基准已记录（响应时间、内存使用）

---

## 🧹 阶段 1: 遗留代码清理 (0.5h)

### 目标
- 删除所有遗留代码
- 清理文档目录

### 任务清单

#### 1.1 删除遗留服务文件 (0.2h)
```bash
# 删除旧版本文件
rm -f src/agent/agent.service.old.ts
rm -f src/agent/agent.service.backup.ts

# 确认没有引用
grep -r "agent.service.old" src/
grep -r "agent.service.backup" src/
```

**验收标准**:
- ✅ 遗留文件已删除
- ✅ 没有代码引用遗留文件
- ✅ 编译成功

#### 1.2 清理文档目录 (0.1h)
```bash
# 检查 docs/refactoring/ 中的文件
ls -la docs/refactoring/

# 保留有价值的文档，删除草稿
# 将本次审查报告和重构计划移到这里
```

**验收标准**:
- ✅ 只保留最新的文档
- ✅ 文档目录结构清晰

#### 1.3 提交代码 (0.2h)
```bash
git add -A
git commit -m "chore: 清理 Agent 模块遗留代码

- 删除 agent.service.old.ts 和 agent.service.backup.ts
- 整理 docs/refactoring/ 目录
- 减少代码库 ~40KB
"
```

**验收标准**:
- ✅ 代码已提交
- ✅ 测试通过
- ✅ CI/CD 通过

---

## 🔧 阶段 2: 解除循环依赖 (2h)

### 目标
- 解除 AgentRegistryService 和 AgentService 的循环依赖
- 优化依赖注入结构

### 当前问题
```typescript
// AgentRegistryService 依赖 AgentService
constructor(
  @Inject(forwardRef(() => AgentService))  // ⚠️ 循环依赖
  private readonly agentService: AgentService,
) {}

// 调用链路
AgentRegistryService.refresh()
  → agentService.getModels()
    → apiClient.getModels()
```

### 任务清单

#### 2.1 修改 AgentRegistryService 依赖 (1h)
**文件**: `src/agent/agent-registry.service.ts`

```typescript
// 修改前
constructor(
  @Inject(forwardRef(() => AgentService))
  private readonly agentService: AgentService,
) {}

async refresh(): Promise<void> {
  const [modelsResponse, toolsResponse] = await Promise.all([
    this.agentService.getModels(),   // ⚠️ 绕了一圈
    this.agentService.getTools(),
  ]);
}

// 修改后
constructor(
  private readonly configService: ConfigService,
  private readonly apiClient: AgentApiClientService,  // ✅ 直接依赖
) {}

async refresh(): Promise<void> {
  const [modelsResponse, toolsResponse] = await Promise.all([
    this.apiClient.getModels(),   // ✅ 直接调用
    this.apiClient.getTools(),
  ]);
}
```

**验收标准**:
- ✅ 移除 `forwardRef`
- ✅ 直接注入 `AgentApiClientService`
- ✅ 测试通过

#### 2.2 更新 AgentModule 依赖关系 (0.5h)
**文件**: `src/agent/agent.module.ts`

```typescript
// 确保正确的依赖顺序
@Module({
  providers: [
    // 1. 无依赖的服务
    AgentApiClientService,
    AgentCacheService,
    AgentFallbackService,
    AgentConfigValidator,
    BrandConfigMonitor,

    // 2. 依赖上述服务的服务
    AgentRegistryService,  // 依赖 AgentApiClientService
    AgentConfigService,

    // 3. 依赖所有服务的服务
    AgentService,
  ],
})
export class AgentModule {}
```

**验收标准**:
- ✅ 依赖关系清晰
- ✅ 没有循环依赖
- ✅ 模块可以正常初始化

#### 2.3 验证和测试 (0.5h)
```bash
# 运行测试
pnpm run test src/agent/agent-registry.service.spec.ts

# 集成测试
pnpm run start:dev
curl http://localhost:8080/agent/health
```

**验收标准**:
- ✅ 单元测试通过
- ✅ 集成测试通过
- ✅ 健康检查正常

#### 2.4 提交代码
```bash
git add -A
git commit -m "refactor(agent): 解除 AgentRegistryService 循环依赖

- AgentRegistryService 直接注入 AgentApiClientService
- 移除 forwardRef 反模式
- 优化依赖注入顺序

Breaking Changes: 无
"
```

---

## 🔨 阶段 3: 拆分 AgentConfigService (8h)

### 目标
- 拆分 AgentConfigService (826行) 为 3 个职责单一的服务
- 解决状态分散问题
- 优化品牌配置刷新逻辑

### 拆分方案

```
AgentConfigService (826行)
  ↓ 拆分为
├── ProfileLoaderService       # Profile 加载和管理
├── BrandConfigService          # 品牌配置管理
└── AgentConfigOrchestratorService  # 合并和编排
```

### 任务清单

#### 3.1 创建 ProfileLoaderService (2h)
**文件**: `src/agent/services/profile-loader.service.ts`

**职责**:
- 从文件系统加载 profile.json、system-prompt.md 等
- 管理 profile 缓存（内存 Map）
- 提供 profile 注册、获取、重载接口

**代码框架**:
```typescript
@Injectable()
export class ProfileLoaderService implements OnModuleInit {
  private readonly logger = new Logger(ProfileLoaderService.name);
  private readonly profiles = new Map<string, AgentProfile>();
  private readonly contextBasePath: string;
  private initialized = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly registryService: AgentRegistryService,
  ) {
    this.contextBasePath = join(__dirname, '..', '..', 'agent', 'context');
  }

  async onModuleInit() {
    await this.loadAllProfiles();
  }

  // 核心方法
  async getProfile(scenario: string): Promise<AgentProfile | null> { }
  async loadAllProfiles(): Promise<void> { }
  async reloadProfile(profileName: string): Promise<boolean> { }
  registerProfile(profile: AgentProfile): void { }
  validateProfile(profile: AgentProfile): { valid: boolean; errors: string[] } { }

  // 私有方法
  private async loadProfileFromFile(profileName: string): Promise<AgentProfile | null> { }
  private async buildProfile(config: ProfileConfig, scenarioDir: string): Promise<AgentProfile> { }
  private parseAllowedTools(toolsStr: string): string[] { }
  private resolveEnvVar(value: string): string { }
  private resolveEnvVarsInObject<T>(obj: T): T { }
}
```

**测试**:
```typescript
// profile-loader.service.spec.ts
describe('ProfileLoaderService', () => {
  it('should load profiles from file system', async () => { });
  it('should resolve environment variables', () => { });
  it('should validate profile', () => { });
  it('should reload profile', async () => { });
});
```

**验收标准**:
- ✅ 服务创建完成
- ✅ 单元测试覆盖率 >80%
- ✅ 集成测试通过

#### 3.2 创建 BrandConfigService (3h)
**文件**: `src/agent/services/brand-config.service.ts`

**职责**:
- 管理品牌配置的获取、刷新、缓存
- Supabase HTTP 客户端管理
- 定时刷新机制
- 提供品牌配置状态查询

**代码框架**:
```typescript
@Injectable()
export class BrandConfigService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BrandConfigService.name);

  // 缓存管理
  private readonly BRAND_CONFIG_CACHE_KEY = 'agent:brand-config';
  private readonly BRAND_CONFIG_REFRESH_INTERVAL = 5 * 60 * 1000;
  private readonly BRAND_CONFIG_RETRY_INTERVAL = 1 * 60 * 1000;

  // 状态管理
  private supabaseHttpClient: AxiosInstance;
  private brandConfigRefreshTimer: NodeJS.Timeout | null = null;
  private brandConfigRetryTimer: NodeJS.Timeout | null = null;
  private brandConfigAvailable = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly httpClientFactory: HttpClientFactory,
    private readonly feiShuAlertService: FeiShuAlertService,
  ) {
    this.initSupabaseClient();
  }

  async onModuleInit() {
    await this.refreshBrandConfig();
    this.startAutoRefresh();
  }

  onModuleDestroy() {
    this.stopTimers();
  }

  // 核心方法
  async getBrandConfig(): Promise<BrandConfig | null> { }
  async refreshBrandConfig(): Promise<void> { }
  isBrandConfigAvailable(): boolean { }
  async getBrandConfigStatus(): Promise<BrandConfigStatus> { }

  // 私有方法
  private initSupabaseClient(): void { }
  private startAutoRefresh(): void { }
  private startRetry(): void { }
  private stopTimers(): void { }
}
```

**测试**:
```typescript
// brand-config.service.spec.ts
describe('BrandConfigService', () => {
  it('should fetch brand config from Supabase', async () => { });
  it('should cache brand config in Redis', async () => { });
  it('should auto refresh', async () => { });
  it('should retry on failure', async () => { });
  it('should send alert on failure', async () => { });
});
```

**验收标准**:
- ✅ 服务创建完成
- ✅ 单元测试覆盖率 >80%
- ✅ 集成测试通过
- ✅ 定时刷新机制正常

#### 3.3 创建 AgentConfigOrchestratorService (2h)
**文件**: `src/agent/agent-config.service.ts` (重构现有文件)

**职责**:
- 编排 ProfileLoaderService 和 BrandConfigService
- 合并 profile 和品牌配置
- 提供统一的配置获取接口
- 执行品牌配置验证和告警

**代码框架**:
```typescript
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
    const profile = await this.profileLoader.getProfile(scenario);
    if (!profile) return null;

    // 2. 获取品牌配置
    const brandConfigData = await this.brandConfig.getBrandConfig();

    // 3. 合并
    const merged = this.mergeProfileWithBrandConfig(profile, brandConfigData);

    // 4. 验证并告警（✅ 在配置层处理）
    await this.validateAndAlert(merged);

    return merged;
  }

  // 代理方法
  getAllProfiles(): AgentProfile[] {
    return this.profileLoader.getAllProfiles();
  }

  async reloadProfile(profileName: string): Promise<boolean> {
    return this.profileLoader.reloadProfile(profileName);
  }

  async refreshBrandConfig(): Promise<void> {
    return this.brandConfig.refreshBrandConfig();
  }

  async getBrandConfigStatus() {
    return this.brandConfig.getBrandConfigStatus();
  }

  validateProfile(profile: AgentProfile) {
    return this.profileLoader.validateProfile(profile);
  }

  // 私有方法
  private mergeProfileWithBrandConfig(
    profile: AgentProfile,
    brandConfig: BrandConfig | null,
  ): AgentProfile {
    if (!brandConfig) {
      return {
        ...profile,
        context: { ...profile.context, configSynced: false },
      };
    }

    return {
      ...profile,
      context: {
        ...profile.context,
        brandData: brandConfig.brandData,
        replyPrompts: brandConfig.replyPrompts,
        configSynced: brandConfig.synced,
      },
    };
  }

  private async validateAndAlert(profile: AgentProfile): Promise<void> {
    const validation = this.configValidator.validateBrandConfig(profile);

    if (!validation.isValid) {
      this.logger.warn(
        `品牌配置不完整: ${validation.missingFields.join(', ')}`,
      );
      // 发送告警（不阻塞）
      await this.brandMonitor.handleBrandConfigUnavailable(
        'system',
        validation,
        false,
      );
    }
  }
}
```

**测试**:
```typescript
// agent-config.service.spec.ts
describe('AgentConfigService', () => {
  it('should merge profile with brand config', async () => { });
  it('should validate and alert on missing config', async () => { });
  it('should return profile with configSynced=false when brand config unavailable', async () => { });
});
```

**验收标准**:
- ✅ 服务重构完成
- ✅ 单元测试覆盖率 >80%
- ✅ 集成测试通过
- ✅ 向后兼容（外部 API 不变）

#### 3.4 更新 AgentModule (0.5h)
**文件**: `src/agent/agent.module.ts`

```typescript
@Module({
  providers: [
    // 基础服务
    AgentApiClientService,
    AgentCacheService,
    AgentFallbackService,
    AgentConfigValidator,
    BrandConfigMonitor,

    // Registry
    AgentRegistryService,

    // 配置服务（新拆分）
    ProfileLoaderService,       // ✅ 新增
    BrandConfigService,          // ✅ 新增
    AgentConfigService,          // ✅ 重构为 Orchestrator

    // 主服务
    AgentService,
  ],
  exports: [
    AgentService,
    AgentConfigService,  // 保持向后兼容
  ],
})
export class AgentModule {}
```

**验收标准**:
- ✅ 模块依赖正确
- ✅ 服务可以正常初始化
- ✅ 导出接口向后兼容

#### 3.5 移除 AgentService 中的品牌配置验证 (0.5h)
**文件**: `src/agent/agent.service.ts`

```typescript
// 修改前
async chatWithProfile(...) {
  const sanitized = ProfileSanitizer.merge(profile, overrides);

  // ⚠️ 删除这部分逻辑
  const validation = this.configValidator.validateBrandConfig(sanitized);
  if (!validation.isValid) {
    await this.brandMonitor.handleBrandConfigUnavailable(...);
    if (!validation.hasBrandData && !validation.hasReplyPrompts) {
      sanitized.context = undefined;
    }
  }

  return this.chat({ ... });
}

// 修改后
async chatWithProfile(...) {
  const sanitized = ProfileSanitizer.merge(profile, overrides);

  // ✅ 验证已在 AgentConfigService.getProfile() 中完成
  return this.chat({ ... });
}

// 同时移除依赖
constructor(
  private readonly configService: ConfigService,
  private readonly apiClient: AgentApiClientService,
  private readonly cacheService: AgentCacheService,
  private readonly registryService: AgentRegistryService,
  private readonly fallbackService: AgentFallbackService,
  // ❌ 移除这两个依赖
  // private readonly configValidator: AgentConfigValidator,
  // private readonly brandMonitor: BrandConfigMonitor,
) {}
```

**验收标准**:
- ✅ AgentService 不再依赖 AgentConfigValidator 和 BrandConfigMonitor
- ✅ 测试通过
- ✅ 行为保持一致

#### 3.6 提交代码
```bash
git add -A
git commit -m "refactor(agent): 拆分 AgentConfigService 为三个职责单一的服务

- 创建 ProfileLoaderService 负责 profile 加载
- 创建 BrandConfigService 负责品牌配置管理
- 重构 AgentConfigService 为 Orchestrator
- 移除 AgentService 中的品牌配置验证逻辑
- 优化依赖注入结构

Breaking Changes: 无（保持向后兼容）

减少单文件行数: 826 → ~150 (Orchestrator)
新增服务: ProfileLoaderService (300行), BrandConfigService (400行)
"
```

---

## 🔧 阶段 4: 统一工具/模型管理 (3h)

### 目标
- 统一工具和模型的配置来源
- 建立单一事实来源 (SSOT)

### 任务清单

#### 4.1 集中工具管理到 AgentRegistryService (1.5h)
**文件**: `src/agent/agent-registry.service.ts`

```typescript
@Injectable()
export class AgentRegistryService {
  // 唯一的工具管理来源 ✅ SSOT
  private availableTools = new Map<string, ToolInfo>();
  private configuredTools: string[];

  /**
   * 获取配置的工具列表（唯一来源）
   */
  getConfiguredTools(): string[] {
    return [...this.configuredTools];
  }

  /**
   * 验证工具列表（唯一验证逻辑）
   */
  validateTools(requestedTools?: string[]): string[] {
    if (!requestedTools || requestedTools.length === 0) {
      return this.getConfiguredTools();
    }

    return requestedTools.filter(tool => this.availableTools.has(tool));
  }

  /**
   * 检查工具是否可用
   */
  isToolAvailable(toolName: string): boolean {
    return this.availableTools.has(toolName);
  }
}
```

**验收标准**:
- ✅ AgentRegistryService 是工具管理的唯一来源
- ✅ 其他服务通过依赖注入获取工具列表
- ✅ 测试通过

#### 4.2 移除重复的工具管理逻辑 (1h)
**修改文件**:
- `src/agent/agent.service.ts` - 移除 `configuredTools`
- `src/agent/agent-config.service.ts` - 移除工具解析逻辑

```typescript
// AgentService - 修改前
constructor(private readonly configService: ConfigService, ...) {
  const toolsString = this.configService.get<string>('AGENT_ALLOWED_TOOLS', '');
  this.configuredTools = parseToolsFromEnv(toolsString);  // ❌ 重复
}

// AgentService - 修改后
constructor(
  private readonly configService: ConfigService,
  private readonly registryService: AgentRegistryService,  // ✅ 依赖注入
  ...
) {
  // 不再缓存工具列表，直接从 registryService 获取
}

// 使用时
const tools = this.registryService.getConfiguredTools();  // ✅ 单一来源
```

**验收标准**:
- ✅ 工具列表只在 AgentRegistryService 中维护
- ✅ 其他服务通过 `registryService.getConfiguredTools()` 获取
- ✅ 测试通过

#### 4.3 统一模型管理 (0.5h)
**文件**: `src/agent/agent-registry.service.ts`

```typescript
@Injectable()
export class AgentRegistryService {
  // 模型配置（唯一来源）
  private readonly defaultModel: string;
  private readonly chatModel: string;
  private readonly classifyModel: string;
  private readonly replyModel: string;

  // 获取默认模型
  getDefaultModel(): string {
    return this.defaultModel;
  }

  // 获取场景专用模型
  getChatModel(): string {
    return this.chatModel;
  }

  getClassifyModel(): string {
    return this.classifyModel;
  }

  getReplyModel(): string {
    return this.replyModel;
  }
}
```

**验收标准**:
- ✅ 模型配置统一管理
- ✅ 其他服务通过 AgentRegistryService 获取模型
- ✅ 测试通过

#### 4.4 提交代码
```bash
git add -A
git commit -m "refactor(agent): 统一工具和模型管理到 AgentRegistryService

- 建立工具和模型的单一事实来源 (SSOT)
- 移除 AgentService 和 AgentConfigService 中的重复逻辑
- 所有服务通过 AgentRegistryService 获取工具/模型配置

Breaking Changes: 无
"
```

---

## ✨ 阶段 5: 优化 AgentResult 适配 (4h)

### 目标
- 优化 AgentResult 的使用方式
- 减少调用方的适配代码

### 任务清单

#### 5.1 优化 Controller 返回格式 (2h)
**文件**: `src/agent/agent.controller.ts`

```typescript
// 修改前
@Post('test-chat')
async testChat(...) {
  return await this.agentService.chatWithProfile(...);  // 返回 AgentResult
}

// 响应格式（嵌套）
{
  "success": true,
  "data": {
    "data": { ... },     // ⚠️ 嵌套的 data
    "status": "success"
  }
}

// 修改后
@Post('test-chat')
async testChat(...) {
  const result = await this.agentService.chatWithProfile(...);

  // 基于状态返回不同响应
  if (result.status === 'error') {
    throw new HttpException(
      result.error.message,
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  // 直接返回 ChatResponse
  return {
    response: result.data || result.fallback,  // ✅ 扁平结构
    metadata: {
      status: result.status,
      fromCache: result.fromCache,
      correlationId: result.correlationId,
      ...(result.fallbackInfo && { fallbackInfo: result.fallbackInfo }),
    },
  };
}

// 响应格式（优化后）
{
  "success": true,
  "data": {
    "response": { ... },   // ✅ 直接的 ChatResponse
    "metadata": {
      "status": "success",
      "fromCache": false
    }
  }
}
```

**验收标准**:
- ✅ Controller 返回格式清晰
- ✅ 不再嵌套 data
- ✅ 错误时返回正确的 HTTP 状态码
- ✅ 测试通过

#### 5.2 优化 MessageService 适配 (1.5h)
**文件**: `src/wecom/message/message.service.ts`

```typescript
// 修改前
import { AgentResultHelper } from '@agent/utils/agent-result-helper';

const agentResult = await this.agentService.chatWithProfile(...);
const chatResponse = AgentResultHelper.extractResponse(agentResult);  // ⚠️ 额外适配

// 修改后
const agentResult = await this.agentService.chatWithProfile(...);

// 使用辅助方法（更清晰）
if (AgentResultHelper.isError(agentResult)) {
  this.logger.error('Agent 调用失败:', agentResult.error);
  // 处理错误
}

const chatResponse = agentResult.data || agentResult.fallback;  // ✅ 直接访问

// 或者使用新的辅助方法
const chatResponse = AgentResultHelper.getResponse(agentResult);  // ✅ 统一方法
```

**验收标准**:
- ✅ MessageService 使用更清晰的 API
- ✅ 错误处理更明确
- ✅ 测试通过

#### 5.3 增强 AgentResultHelper (0.5h)
**文件**: `src/agent/utils/agent-result-helper.ts`

```typescript
export class AgentResultHelper {
  /**
   * 获取响应（优先返回 data，否则返回 fallback）
   */
  static getResponse(result: AgentResult): ChatResponse {
    return result.data || result.fallback;
  }

  /**
   * 获取响应文本
   */
  static getResponseText(result: AgentResult): string {
    const response = this.getResponse(result);
    return response.messages[0]?.parts[0]?.text || '';
  }

  /**
   * 检查是否成功（包括降级成功）
   */
  static isSuccessOrFallback(result: AgentResult): boolean {
    return result.status === 'success' || result.status === 'fallback';
  }

  // 保留原有方法以兼容
  static extractResponse(result: AgentResult): ChatResponse {
    return this.getResponse(result);  // 委托给新方法
  }
}
```

**验收标准**:
- ✅ 辅助方法更丰富
- ✅ 向后兼容
- ✅ 测试覆盖率 >90%

#### 5.4 提交代码
```bash
git add -A
git commit -m "refactor(agent): 优化 AgentResult 适配和使用方式

- 优化 Controller 返回格式（不再嵌套 data）
- 增强 AgentResultHelper 辅助方法
- 简化 MessageService 适配逻辑
- 错误时返回正确的 HTTP 状态码

Breaking Changes: Controller 响应格式调整（需更新前端）
"
```

---

## 🔒 阶段 6: 清理导出和安全性 (2h)

### 目标
- 整理模块导出接口
- 修复健康检查安全问题

### 任务清单

#### 6.1 整理 src/agent/index.ts (0.5h)
**文件**: `src/agent/index.ts`

```typescript
// 修改前 - 暴露所有内部服务
export * from './agent.module';
export * from './agent.service';
export * from './agent-fallback.service';  // ⚠️ 内部服务
export * from './interfaces';
export * from './dto/chat-request.dto';
export * from './exceptions/agent.exception';
export { AgentConfigService, BrandConfig } from './agent-config.service';  // ⚠️

// 修改后 - 只导出公共接口
export * from './agent.module';
export * from './agent.service';           // 主要入口
export * from './dto/chat-request.dto';    // 公共 DTO
export * from './exceptions/agent.exception';
export * from './interfaces';
export * from './models/agent-result.model';  // 公共模型

// 内部服务通过 AgentModule 依赖注入，不对外暴露
// - AgentFallbackService
// - AgentConfigService
// - AgentRegistryService
// - AgentCacheService
// - ProfileLoaderService
// - BrandConfigService
```

**验收标准**:
- ✅ 只导出公共接口
- ✅ 内部服务不对外暴露
- ✅ 编译通过
- ✅ 外部模块可以正常导入

#### 6.2 修复健康检查安全问题 (1h)
**文件**: `src/agent/agent.controller.ts`

```typescript
// 修改前 - 暴露完整品牌配置
@Get('health')
async healthCheck() {
  const brandConfigData = await this.agentConfigService.getBrandConfig();

  return {
    success: true,
    data: {
      brandConfig: {
        ...brandConfigStatus,
        data: brandConfigData,  // ⚠️ 暴露敏感数据
      },
    },
  };
}

// 修改后 - 只返回状态
@Get('health')
async healthCheck() {
  const healthStatus = this.registryService.getHealthStatus();
  const brandConfigStatus = await this.agentConfigService.getBrandConfigStatus();

  const isHealthy = /* ... */;

  return {
    success: true,
    data: {
      status: isHealthy ? 'healthy' : 'degraded',
      message: isHealthy ? 'Agent 服务正常' : '⚠️ Agent 服务运行中（部分功能降级）',
      ...healthStatus,
      brandConfig: {
        available: brandConfigStatus.available,
        synced: brandConfigStatus.synced,
        lastRefreshTime: brandConfigStatus.lastRefreshTime,
        // ❌ 不返回完整数据
      },
    },
  };
}

// 新增受保护的接口（可选）
@Get('config/full')
@UseGuards(AdminGuard)  // 需要管理员权限
async getFullBrandConfig() {
  return await this.agentConfigService.getBrandConfig();
}
```

**验收标准**:
- ✅ 健康检查不暴露敏感数据
- ✅ 受保护的接口需要鉴权
- ✅ 测试通过

#### 6.3 添加 API 文档 (0.5h)
**文件**: `src/agent/agent.controller.ts`

```typescript
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('Agent')
@Controller('agent')
export class AgentController {
  @ApiOperation({ summary: '健康检查' })
  @ApiResponse({ status: 200, description: 'Agent 服务状态' })
  @Get('health')
  async healthCheck() { }

  @ApiOperation({ summary: '测试聊天接口' })
  @ApiResponse({ status: 200, description: '聊天响应' })
  @Post('test-chat')
  async testChat() { }
}
```

**验收标准**:
- ✅ API 文档完整
- ✅ Swagger UI 可访问
- ✅ 所有接口有描述

#### 6.4 提交代码
```bash
git add -A
git commit -m "refactor(agent): 清理导出接口和修复安全问题

- 整理 src/agent/index.ts，只导出公共接口
- 修复健康检查暴露敏感数据的问题
- 添加 Swagger API 文档

Breaking Changes: index.ts 导出变更（内部服务不再导出）
"
```

---

## 📝 阶段 7: 测试和文档完善 (1h)

### 目标
- 完善单元测试和集成测试
- 更新文档

### 任务清单

#### 7.1 完善单元测试 (0.5h)
```bash
# 运行测试并生成覆盖率报告
pnpm run test:cov

# 目标：覆盖率 >80%
# 重点测试：
# - ProfileLoaderService
# - BrandConfigService
# - AgentConfigService (Orchestrator)
# - AgentRegistryService
```

**验收标准**:
- ✅ 所有新服务有单元测试
- ✅ 测试覆盖率 >80%
- ✅ 关键路径覆盖率 >90%

#### 7.2 更新文档 (0.5h)
**文件**: `CLAUDE.md`

```markdown
## Agent 模块架构（重构后）

### 核心服务

- **AgentService** - 主入口，负责请求协调、缓存、降级
- **AgentConfigService** - 配置编排服务（Orchestrator）
  - ProfileLoaderService - Profile 加载
  - BrandConfigService - 品牌配置管理
- **AgentRegistryService** - 模型/工具注册表
- **AgentApiClientService** - API 客户端
- **AgentCacheService** - 响应缓存

### 服务依赖关系

```
Controller
  ↓
AgentService (Orchestrator)
  ├→ AgentApiClientService
  ├→ AgentCacheService
  ├→ AgentRegistryService
  └→ AgentFallbackService

AgentConfigService (Orchestrator)
  ├→ ProfileLoaderService
  └→ BrandConfigService
```

### 配置管理

- Profile 从文件系统加载（ProfileLoaderService）
- 品牌配置从 Supabase 获取（BrandConfigService）
- 自动合并和验证（AgentConfigService）
```

**验收标准**:
- ✅ CLAUDE.md 更新
- ✅ 架构图清晰
- ✅ 使用示例完整

#### 7.3 提交代码
```bash
git add -A
git commit -m "docs: 完善 Agent 模块测试和文档

- 增加单元测试覆盖率到 >80%
- 更新 CLAUDE.md 架构说明
- 添加使用示例和最佳实践

Test Coverage: 80%+
"
```

---

## 🎉 重构完成验收

### 验收清单

#### 代码质量
- [ ] 所有阶段的代码已提交
- [ ] 所有测试通过
- [ ] 测试覆盖率 >80%
- [ ] ESLint 无错误
- [ ] 编译无警告

#### 架构改进
- [ ] AgentConfigService 从 826 行拆分为 3 个服务
- [ ] 循环依赖已解除
- [ ] 工具/模型管理统一到 AgentRegistryService
- [ ] AgentResult 适配优化
- [ ] 导出接口整理完成

#### 功能验证
- [ ] 所有 API 端点正常工作
- [ ] 健康检查正常
- [ ] 品牌配置刷新正常
- [ ] Profile 加载正常
- [ ] 消息处理正常

#### 性能验证
- [ ] 响应时间无明显变化
- [ ] 内存使用无明显增加
- [ ] 缓存命中率保持稳定

#### 文档完整性
- [ ] CLAUDE.md 已更新
- [ ] API 文档完整
- [ ] 重构报告已归档

---

## 📊 重构效果预期

### 代码质量提升
- 单文件最大行数：826 → 400 (-52%)
- 循环依赖：1 → 0
- 服务职责：混乱 → 清晰
- 测试覆盖率：~60% → >80%

### 可维护性提升
- 职责单一：每个服务只负责一件事
- 依赖清晰：无循环依赖
- 配置统一：单一事实来源 (SSOT)
- 测试简单：易于 mock 和测试

### 性能影响
- 响应时间：无明显变化（±5%）
- 内存使用：略微增加（多个服务实例）
- 缓存命中率：保持稳定

---

## 🚨 风险和缓解措施

### 风险 1: 品牌配置刷新逻辑变更
**影响**: 可能影响现有业务
**缓解措施**:
- 充分测试刷新逻辑
- 保持向后兼容
- 监控刷新成功率

### 风险 2: 依赖关系变更
**影响**: 可能导致初始化失败
**缓解措施**:
- 仔细检查依赖顺序
- 编写集成测试
- 逐步重构，避免大爆炸

### 风险 3: API 响应格式变更
**影响**: 可能影响前端
**缓解措施**:
- 提前与前端团队沟通
- 提供兼容层
- 分阶段发布

---

## 📅 时间表

| 阶段 | 预计开始 | 预计完成 | 实际完成 | 状态 |
|------|---------|---------|---------|------|
| 阶段 0 | Day 1 AM | Day 1 AM | | ⏳ |
| 阶段 1 | Day 1 AM | Day 1 PM | | ⏳ |
| 阶段 2 | Day 1 PM | Day 1 PM | | ⏳ |
| 阶段 3 | Day 2 | Day 3 | | ⏳ |
| 阶段 4 | Day 3 PM | Day 4 AM | | ⏳ |
| 阶段 5 | Day 4 AM | Day 4 PM | | ⏳ |
| 阶段 6 | Day 5 AM | Day 5 AM | | ⏳ |
| 阶段 7 | Day 5 PM | Day 5 PM | | ⏳ |

**总工期**: ~5 天

---

**下一步**: 开始执行 [阶段 0: 准备工作](#-阶段-0-准备工作-1h)
