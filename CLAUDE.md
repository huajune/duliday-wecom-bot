# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DuLiDay 企业微信智能服务中间层 - NestJS-based middleware connecting WeChat Enterprise hosting platform with AI Agent services.

**Tech Stack**: NestJS 10.3 | TypeScript 5.3 | Node.js 20+ | Bull Queue | Redis (Upstash) | Winston

**Core Purpose**:
- Receive message callbacks from WeChat Enterprise hosting platform
- Invoke AI Agent API for intelligent responses
- Send replies back through hosting platform API

## Development Commands

```bash
# Development (with hot reload)
pnpm run start:dev

# Build
pnpm run build

# Production
pnpm run start:prod

# Code Quality
pnpm run lint          # ESLint check and auto-fix
pnpm run format        # Prettier formatting
pnpm run test          # Run tests
pnpm run test:cov      # Test coverage

# Single test file
pnpm run test -- message.service.spec.ts
```

## Architecture

### DDD Layered Architecture (4 Business Domains)

```
src/
├── core/                           # Infrastructure Layer (Horizontal)
│   ├── client-http/                # HTTP client factory (Bearer Token)
│   ├── config/                     # Config management (env validation)
│   ├── redis/                      # Redis cache (Global module)
│   ├── monitoring/                 # System monitoring & metrics
│   └── server/response/            # Unified response (Interceptor + Filter)
│
├── agent/                          # AI Agent Domain
│   ├── agent.service.ts            # Agent API invocation layer
│   ├── agent-cache.service.ts      # Multi-layer caching
│   ├── agent-registry.service.ts   # Model/tool registry
│   ├── agent-config.service.ts     # Config profile management
│   └── context/                    # Agent context configurations
│
├── wecom/                          # WeChat Enterprise Domain
│   ├── message/                    # Message processing (Core business)
│   │   ├── message.service.ts      # Main coordinator (~300 lines)
│   │   └── services/               # Sub-services (SRP)
│   │       ├── message-deduplication.service.ts
│   │       ├── message-filter.service.ts
│   │       ├── message-history.service.ts
│   │       ├── message-merge.service.ts     # Smart aggregation (Bull Queue)
│   │       └── message-statistics.service.ts
│   ├── message-sender/             # Message sending
│   ├── bot/                        # Bot management
│   ├── chat/                       # Chat session
│   ├── contact/                    # Contact management
│   ├── room/                       # Group chat
│   └── user/                       # User management
│
├── sponge/                         # Sponge System Integration (Skeleton)
│   ├── job/                        # Job management
│   ├── interview/                  # Interview management
│   └── sync/                       # Scheduled sync
│
└── analytics/                      # Analytics Domain (Skeleton)
    ├── metrics/                    # Metrics collection
    ├── report/                     # Report generation
    └── dashboard/                  # Dashboard
```

### Message Processing Flow

```
WeChat User Message
  → Hosting Platform Callback → /wecom/message
  → MessageController.handleCallback()
  → MessageService.handleMessage()
      ├── Deduplication check
      ├── Message filtering
      ├── Save to history
      ├── Smart merge (if enabled, 1s window / max 3 messages)
      └── Return 200 OK immediately
  → [Async Queue Processing]
      ├── Aggregate messages
      ├── Call Agent API (AgentService.chat)
      ├── Split response (MessageSplitter: \n\n + ~)
      └── Send reply (with delay)
```

### Path Aliases (tsconfig.json)

```typescript
import { HttpClientFactory } from '@core/http';
import { AgentService } from '@agent';
import { MessageService } from '@wecom/message';
import { SpongeService } from '@sponge';
import { AnalyticsService } from '@analytics';
```

## Key Design Patterns

### 1. Service Decomposition (MessageService Case)
Refactored from 1099 lines monolith → 5 sub-services (~300 lines main)
- **Deduplication** - MessageDeduplicationService
- **Filtering** - MessageFilterService
- **History** - MessageHistoryService
- **Merging** - MessageMergeService (Queue-driven)
- **Statistics** - MessageStatisticsService

### 2. Multi-layer Caching
- **Memory Cache** - Agent config profiles
- **Redis Cache** - Agent responses, message history
- **Bull Queue** - Message aggregation processing

### 3. Factory Pattern
```typescript
// HttpClientFactory - Create clients with Bearer Token
const client = this.httpClientFactory.createWithBearerAuth(config, token);
```

### 4. Unified Response Handling
- **ResponseInterceptor** - Auto-wrap successful responses
- **HttpExceptionFilter** - Centralized error handling
- **@RawResponse** - Bypass wrapper (for 3rd party callbacks)

Response format:
- Success: `{ success: true, data: {...}, timestamp: '...' }`
- Error: `{ success: false, error: { code, message }, timestamp: '...' }`

## Code Standards

### TypeScript Strict Mode

```typescript
// ❌ Forbidden
function process(data: any): any { }

// ✅ Required
function process(data: ProcessData): Result { }

// ✅ When uncertain, use unknown
function process(data: unknown): string {
  if (typeof data === 'object' && data !== null) {
    return (data as ProcessData).value;
  }
}
```

### NestJS Service Structure

```typescript
@Injectable()
export class ExampleService {
  // 1. Logger (must be first)
  private readonly logger = new Logger(ExampleService.name);

  // 2. Config properties
  private readonly apiUrl: string;

  // 3. Constructor (DI)
  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.apiUrl = this.configService.get('API_URL');
  }

  // 4. Public methods
  async publicMethod(): Promise<Result> {
    try {
      // Business logic
    } catch (error) {
      this.logger.error('Error:', error);
      throw new HttpException('Failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // 5. Private helpers
  private privateHelper(): void { }
}
```

### Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| **Files** | kebab-case | `agent-api.service.ts`, `message-sender.controller.ts` |
| **Classes/Interfaces** | PascalCase | `AgentService`, `IAgentProfile` |
| **Variables/Functions** | camelCase | `sendMessage`, `apiKey` |
| **Constants** | UPPER_SNAKE_CASE | `API_TIMEOUT`, `MAX_RETRY_COUNT` |

### Forbidden Practices

```typescript
// ❌ Absolutely Forbidden
const apiKey = 'sk-xxx';              // Hardcoded secrets
console.log('debug');                 // Using console
private service = new Service();      // Manual instantiation
function test(data: any): any { }     // Using any

// ✅ Must Use
const apiKey = this.configService.get('API_KEY');
this.logger.log('debug');
constructor(private readonly service: Service) {}
function test(data: Data): Result { }
```

## Environment Configuration

### Required Variables

```bash
# Application
PORT=8080
NODE_ENV=development

# Agent API (Required)
AGENT_API_KEY=your-api-key-here
AGENT_API_BASE_URL=http://localhost:3000/api/v1
AGENT_DEFAULT_MODEL=anthropic/claude-3-5-haiku-latest
AGENT_CHAT_MODEL=anthropic/claude-sonnet-4-5-20250929
AGENT_CLASSIFY_MODEL=openai/gpt-4o
AGENT_REPLY_MODEL=openai/gpt-5-chat-latest
AGENT_ALLOWED_TOOLS=duliday_job_list,duliday_job_details,duliday_interview_booking

# Redis Cache (Required - Upstash)
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token-here

# DuLiDay API (Required)
DULIDAY_API_TOKEN=your-duliday-token-here

# Hosting Platform (Required)
STRIDE_API_BASE_URL=https://stride-bg.dpclouds.com
STRIDE_ENTERPRISE_API_BASE_URL=https://stride-bg.dpclouds.com/hub-api
```

### Feature Flags

```bash
# Message Processing
ENABLE_AI_REPLY=true                  # Enable AI auto-reply
ENABLE_MESSAGE_SPLIT_SEND=true        # Enable message splitting
ENABLE_MESSAGE_MERGE=true             # Enable message aggregation
MESSAGE_SEND_DELAY=1500               # Send delay (ms)
INITIAL_MERGE_WINDOW_MS=1000          # Merge window (ms)
MAX_MERGED_MESSAGES=3                 # Max messages to merge

# Bull Queue (Optional for dev)
ENABLE_BULL_QUEUE=false               # Disable in local dev
REDIS_HOST=localhost
REDIS_PORT=6379
```

See `.env.example` for complete configuration.

## Git Commit Convention

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```bash
git commit -m "feat: add broadcast messaging"        # New feature (minor +1)
git commit -m "fix: resolve session timeout issue"   # Bug fix (patch +1)
git commit -m "refactor: simplify message handler"   # Refactoring
git commit -m "docs: update API documentation"       # Documentation
git commit -m "chore: update dependencies"           # Maintenance
```

Auto-versioning: When `develop` merges to `master`, GitHub Actions automatically:
- Analyzes commits and updates version
- Generates CHANGELOG.md
- Creates version tag (e.g., v1.2.3)

## Key APIs

### 1. Hosting Platform API
- **Enterprise-level**: https://s.apifox.cn/34adc635-40ac-4161-8abb-8cd1eea9f445
- **Group-level**: https://s.apifox.cn/acec6592-fec1-443b-8563-10c4a10e64c4

Key endpoints:
- `GET /stream-api/chat/list` - Chat list
- `GET /stream-api/message/history` - Message history
- `POST /stream-api/message/send` - Send message

### 2. Agent API (花卷)
- **Official Docs**: https://docs.wolian.cc/

Key endpoints:
- `POST /api/v1/chat` - Chat with AI
- `GET /api/v1/models` - Available models
- `GET /api/v1/tools` - Available tools

## Testing and Debugging

```bash
# Health check
curl http://localhost:8080/agent/health

# View available models
curl http://localhost:8080/agent/models

# Test chat
curl -X POST http://localhost:8080/agent/test-chat \
  -H "Content-Type: application/json" \
  -d '{"message":"你好","conversationId":"test-001"}'

# View logs
tail -f logs/combined-$(date +%Y-%m-%d).log

# Monitoring dashboard
open http://localhost:8080/monitoring.html
```

## Troubleshooting

### Agent API Connection Failed
```bash
# Check config
echo $AGENT_API_KEY
curl -H "Authorization: Bearer $AGENT_API_KEY" \
  $AGENT_API_BASE_URL/models

# Health check
curl http://localhost:8080/agent/health
```

### Port Already in Use
```bash
lsof -i :8080
kill -9 <PID>
# Or change PORT in .env
```

### Message Merge Not Working
- Verify `ENABLE_MESSAGE_MERGE=true`
- Check Redis connection
- Verify Bull Queue status
- In dev mode: set `ENABLE_BULL_QUEUE=false` if no Redis

### Dependencies Installation Failed
```bash
pnpm store prune
rm -rf node_modules
pnpm install
```

## Advanced Documentation

For detailed guidelines on specific topics, see the **Claude Code Agents Documentation System**:

📚 **[.claude/agents/README.md](./.claude/agents/README.md)** - Modular documentation hub

**Specialized guides:**
- **[Code Standards](./.claude/agents/code-standards.md)** - In-depth TypeScript & NestJS conventions
- **[Architecture Principles](./.claude/agents/architecture-principles.md)** - SOLID, design patterns, DDD
- **[Development Workflow](./.claude/agents/development-workflow.md)** - Git flow, testing, CI/CD
- **[Performance Optimization](./.claude/agents/performance-optimization.md)** - Caching, monitoring, tuning
- **[Code Quality Guardian](./.claude/agents/code-quality-guardian.md)** - Automated quality checks

**When to use:**
- This file (CLAUDE.md) provides quick overview and essential information
- Agents docs provide deep dives into specific areas
- Use agents docs for complex tasks requiring detailed guidance

## Important References

- **NestJS Docs**: https://docs.nestjs.com/
- **Conventional Commits**: https://www.conventionalcommits.org/
- **Development Guide**: docs/DEVELOPMENT_GUIDE.md (if exists)
- **Cursor Rules**: .cursorrules (comprehensive development standards)

## Best Practices Summary

✅ **Must Follow**:
- Strict type checking (no `any`)
- Dependency injection (no `new Service()`)
- Use Logger (no `console.log`)
- Environment variables (no hardcoding)
- Single responsibility (<500 lines per service)
- Complete error handling (try-catch)
- Comprehensive Swagger docs

❌ **Absolutely Forbidden**:
- Hardcoded secrets or credentials
- Using `console.log`
- Manual service instantiation
- Abusing `any` type
- Unhandled exceptions
- Ignoring TypeScript errors
