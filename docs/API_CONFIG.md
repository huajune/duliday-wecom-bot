# API 配置管理

## 概述

所有外部 API 的基地址和端点现在统一通过 `ApiConfigService` 管理，不再硬编码在各个 service 中。

## 配置文件

在 `.env` 文件中配置：

```bash
# Stride API 基地址
STRIDE_API_BASE_URL=https://stride-bg.dpclouds.com
```

## 使用方法

### 1. 在 Module 中引入

```typescript
import { ApiConfigModule } from '../../core/config';

@Module({
  imports: [HttpModule, ApiConfigModule],
  // ...
})
export class YourModule {}
```

### 2. 在 Service 中使用

```typescript
import { ApiConfigService } from '../../core/config';

@Injectable()
export class YourService {
  constructor(
    private readonly httpService: HttpService,
    private readonly apiConfig: ApiConfigService,
  ) {}

  async someMethod() {
    // 使用预定义的端点
    const url = this.apiConfig.endpoints.chat.list();
    const result = await this.httpService.get(url, params);
    
    // 或者自定义构建 URL
    const customUrl = this.apiConfig.buildApiUrl('/custom/endpoint');
  }
}
```

## 可用端点

### Chat 相关
- `this.apiConfig.endpoints.chat.list()` - 获取会话列表

### Message 相关
- `this.apiConfig.endpoints.message.history()` - 获取消息历史
- `this.apiConfig.endpoints.message.send()` - 发送消息

### Contact 相关
- `this.apiConfig.endpoints.contact.list()` - 获取联系人列表

### Room 相关
- `this.apiConfig.endpoints.room.list()` - 获取群列表
- `this.apiConfig.endpoints.room.simpleList()` - 获取群列表（简单版）
- `this.apiConfig.endpoints.room.addMember()` - 添加群成员
- `this.apiConfig.endpoints.room.addFriendSend()` - 群聊加好友

### User 相关
- `this.apiConfig.endpoints.user.list()` - 获取用户列表

### Bot 相关
- `this.apiConfig.endpoints.bot.list()` - 获取机器人列表

### Customer 相关
- `this.apiConfig.endpoints.customer.list()` - 获取客户列表（使用 v2 API）

## 自定义端点

如果需要添加新的端点，在 `src/core/config/api-config.service.ts` 中的 `endpoints` 对象添加：

```typescript
readonly endpoints = {
  // 现有端点...
  
  // 新增端点
  newModule: {
    list: () => this.buildApiUrl('/new-module/list'),
    create: () => this.buildApiUrl('/new-module/create'),
  },
};
```

## 优势

1. **统一管理**：所有 API 基地址集中在一处
2. **易于维护**：修改 API 地址只需改环境变量
3. **环境切换**：开发/测试/生产环境切换更方便
4. **类型安全**：通过 TypeScript 提供类型提示
5. **代码清晰**：service 代码更简洁，不再有硬编码的 URL
