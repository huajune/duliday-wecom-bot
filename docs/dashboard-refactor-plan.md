# Dashboard 重构计划书

> 基于 belink-ai-dashboard 架构风格的重构方案

## 1. 现状分析

### 1.1 代码规模统计

| 分类 | 文件 | 行数 | 问题 |
|------|------|------|------|
| **样式** | `index.css` | 2,671 | 单文件，无模块化 |
| **页面** | `Logs.tsx` | 1,009 | 组件未拆分，内联样式泛滥 |
| | `ChatRecords.tsx` | 856 | 同上 |
| | `Dashboard.tsx` | 717 | 同上 |
| | `System.tsx` | 561 | 同上 |
| | `Config.tsx` | 554 | 同上 |
| | `ConsoleLogs.tsx` | 544 | 同上 |
| | `Hosting.tsx` | 223 | 相对合理 |
| | `Users.tsx` | 110 | 相对合理 |
| **组件** | 6 个通用组件 | 418 | 缺少样式模块化 |
| **总计** | - | **7,663** | - |

### 1.2 核心问题

1. **样式架构缺失**
   - 2,671 行 CSS 堆积在单文件
   - 无 SASS 预处理器支持
   - 无 CSS Modules 隔离
   - 大量内联 `style={{}}` 散落各处

2. **组件未拆分**
   - `Logs.tsx` 内嵌 672 行的 `MessageDetailPanel` 组件
   - 200+ 行 `<style>` 标签内嵌 JSX
   - 页面文件承担过多职责

3. **目录结构扁平**
   - 所有页面平铺在 `pages/` 下
   - 无按功能模块组织
   - 页面专属组件无处安放

4. **缺少工程化规范**
   - 无路由懒加载
   - 无状态管理
   - 无统一的 API 层

---

## 2. 目标架构

### 2.1 目录结构（对标 belink-ai-dashboard）

```
dashboard/src/
├── assets/
│   ├── images/                       # 图片资源
│   └── styles/
│       ├── variables.scss            # SASS 变量系统
│       └── common.scss               # 全局通用样式
│
├── components/                       # 全局通用组件
│   ├── Sidebar/
│   │   ├── index.tsx
│   │   └── index.module.scss
│   ├── Header/
│   │   ├── index.tsx
│   │   └── index.module.scss
│   ├── MetricCard/
│   │   ├── index.tsx
│   │   └── index.module.scss
│   ├── DataTable/
│   │   ├── index.tsx
│   │   └── index.module.scss
│   ├── Drawer/
│   │   ├── index.tsx
│   │   └── index.module.scss
│   └── StatusBadge/
│       └── index.tsx
│
├── view/                             # 页面模块
│   ├── logs/                         # 日志模块
│   │   └── list/
│   │       ├── index.tsx             # 页面入口
│   │       ├── styles/
│   │       │   └── index.module.scss
│   │       └── components/
│   │           ├── ControlPanel.tsx
│   │           ├── LogsTable.tsx
│   │           └── MessageDetailDrawer/
│   │               ├── index.tsx
│   │               ├── index.module.scss
│   │               ├── ChatBubble.tsx
│   │               └── TechnicalStats.tsx
│   │
│   ├── dashboard/                    # 仪表盘模块
│   │   ├── index.tsx
│   │   ├── styles/
│   │   │   └── index.module.scss
│   │   └── components/
│   │       ├── OverviewCards.tsx
│   │       ├── TrendChart.tsx
│   │       └── RecentActivity.tsx
│   │
│   ├── chatRecords/                  # 聊天记录模块
│   │   └── list/
│   │       ├── index.tsx
│   │       ├── styles/
│   │       └── components/
│   │
│   ├── system/                       # 系统模块
│   │   ├── index.tsx
│   │   ├── styles/
│   │   └── components/
│   │
│   ├── config/                       # 配置模块
│   │   └── ...
│   │
│   └── consoleLogs/                  # 控制台日志模块
│       └── ...
│
├── hooks/                            # 自定义 Hooks
│   ├── index.ts
│   ├── useMonitoring.ts
│   └── usePagination.ts
│
├── services/                         # API 服务层
│   ├── monitoring.ts
│   └── types.ts
│
├── utils/                            # 工具函数
│   ├── format.ts
│   └── index.ts
│
├── types/                            # 类型定义
│   └── monitoring.ts
│
├── App.tsx
├── AppRouter.tsx                     # 路由配置
├── main.tsx
└── index.css                         # Tailwind 入口（精简）
```

### 2.2 文件命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 组件目录 | PascalCase | `MessageDetailDrawer/` |
| 组件文件 | PascalCase.tsx | `ChatBubble.tsx` |
| 样式文件 | index.module.scss | `index.module.scss` |
| 页面入口 | index.tsx | `view/logs/list/index.tsx` |
| hooks | camelCase | `useMonitoring.ts` |
| 工具函数 | camelCase | `format.ts` |

---

## 3. 样式重构方案

### 3.1 SASS 变量系统

```scss
// assets/styles/variables.scss

// ========== 颜色系统 ==========
$primary: #6366f1;
$primary-dark: #4f46e5;
$primary-light: #818cf8;
$primary-soft: rgba(99, 102, 241, 0.1);

$accent: #8b5cf6;
$success: #10b981;
$warning: #f59e0b;
$danger: #ef4444;
$info: #06b6d4;

// 文字颜色
$text-primary: #1f2937;
$text-secondary: #6b7280;
$text-muted: #9ca3af;
$text-on-primary: #ffffff;

// 背景颜色
$bg-page: #f3f4f6;
$bg-card: #ffffff;
$bg-secondary: #f9fafb;
$bg-sidebar: #ffffff;

// 边框
$border: #e5e7eb;
$border-hover: #d1d5db;

// ========== 间距系统 ==========
$spacing-unit: 1rem;
$spacing-xs: $spacing-unit * 0.25;  // 4px
$spacing-sm: $spacing-unit * 0.5;   // 8px
$spacing-md: $spacing-unit;         // 16px
$spacing-lg: $spacing-unit * 1.5;   // 24px
$spacing-xl: $spacing-unit * 2;     // 32px

// ========== 断点系统 ==========
$breakpoint-sm: 640px;
$breakpoint-md: 768px;
$breakpoint-lg: 1024px;
$breakpoint-xl: 1280px;

// ========== 圆角 ==========
$radius-sm: 4px;
$radius-md: 8px;
$radius-lg: 12px;
$radius-xl: 16px;

// ========== 阴影 ==========
$shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
$shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
$shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
$shadow-glow: 0 0 20px rgba(99, 102, 241, 0.15);

// ========== 响应式 Mixin ==========
@mixin respond-to($breakpoint) {
  @if $breakpoint == sm {
    @media (max-width: $breakpoint-sm) { @content; }
  } @else if $breakpoint == md {
    @media (max-width: $breakpoint-md) { @content; }
  } @else if $breakpoint == lg {
    @media (max-width: $breakpoint-lg) { @content; }
  } @else if $breakpoint == xl {
    @media (max-width: $breakpoint-xl) { @content; }
  }
}

// ========== 通用 Mixin ==========
@mixin card {
  background: $bg-card;
  border-radius: $radius-lg;
  box-shadow: $shadow-md;
}

@mixin flex-center {
  display: flex;
  align-items: center;
  justify-content: center;
}

@mixin text-ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

### 3.2 CSS Modules 使用规范

```tsx
// 组件中使用
import styles from './index.module.scss';

// 单一类名
<div className={styles.container}>

// 多个类名
<div className={`${styles.card} ${styles.active}`}>

// 条件类名（配合 clsx）
import clsx from 'clsx';
<div className={clsx(styles.badge, {
  [styles.success]: status === 'success',
  [styles.danger]: status === 'failed',
})}>
```

### 3.3 样式文件拆分计划

| 原文件 | 行数 | 拆分目标 |
|--------|------|----------|
| `index.css` | 2,671 | → 拆分为 15+ 个 `.module.scss` 文件 |
| 内联 `<style>` | ~400 | → 迁移到对应组件的 `.module.scss` |
| 内联 `style={{}}` | ~300处 | → 迁移到 SCSS 类或 Tailwind |

---

## 4. 组件拆分方案

### 4.1 Logs.tsx 拆分（示例）

**Before (1,009 行单文件):**
```
Logs.tsx
├── MessageDetailPanel (内部组件, 672 行)
│   ├── 内嵌 <style> 标签 (200 行)
│   └── 大量内联样式
└── Logs (页面组件, 337 行)
```

**After (7 个文件):**
```
view/logs/list/
├── index.tsx                        (~100 行) 页面容器
├── styles/
│   └── index.module.scss            (~50 行)  页面样式
└── components/
    ├── ControlPanel.tsx             (~80 行)  控制面板
    ├── LogsTable.tsx                (~120 行) 表格组件
    └── MessageDetailDrawer/
        ├── index.tsx                (~150 行) 抽屉容器
        ├── index.module.scss        (~200 行) 抽屉样式
        ├── ChatBubble.tsx           (~60 行)  聊天气泡
        └── TechnicalStats.tsx       (~100 行) 技术指标
```

### 4.2 各页面拆分优先级

| 页面 | 行数 | 复杂度 | 优先级 | 预计拆分组件数 |
|------|------|--------|--------|----------------|
| `Logs.tsx` | 1,009 | 高 | P0 | 7 |
| `ChatRecords.tsx` | 856 | 高 | P1 | 5 |
| `Dashboard.tsx` | 717 | 中 | P1 | 4 |
| `System.tsx` | 561 | 中 | P2 | 3 |
| `Config.tsx` | 554 | 中 | P2 | 3 |
| `ConsoleLogs.tsx` | 544 | 中 | P2 | 3 |
| `Hosting.tsx` | 223 | 低 | P3 | 2 |
| `Users.tsx` | 110 | 低 | P3 | 1 |

---

## 5. 实施阶段

### Phase 1: 基础设施搭建

**目标**: 建立 SASS 体系和目录结构

**任务清单**:
1. 安装依赖: `pnpm add -D sass`
2. 创建 `assets/styles/variables.scss`
3. 创建 `assets/styles/common.scss`
4. 创建 `view/` 目录结构
5. 配置路径别名 `@/assets`, `@/view`

**产出物**:
- SASS 变量系统
- 基础目录结构
- 构建配置更新

**验证标准**:
- `pnpm run build` 成功
- SASS 文件正常编译

---

### Phase 2: Logs 页面重构（样板工程）

**目标**: 完成 Logs 页面的完整重构，作为其他页面的参考模板

**任务清单**:
1. 创建 `view/logs/list/` 目录结构
2. 提取 `MessageDetailDrawer` 组件
3. 提取 `ControlPanel` 组件
4. 提取 `LogsTable` 组件
5. 迁移内联样式到 `.module.scss`
6. 删除内嵌 `<style>` 标签
7. 更新路由配置

**产出物**:
```
view/logs/list/
├── index.tsx
├── styles/index.module.scss
└── components/
    ├── ControlPanel.tsx
    ├── LogsTable.tsx
    └── MessageDetailDrawer/
        ├── index.tsx
        ├── index.module.scss
        ├── ChatBubble.tsx
        └── TechnicalStats.tsx
```

**验证标准**:
- 页面功能完全一致
- 无视觉回归
- 单文件行数 ≤ 200

---

### Phase 3: 全局组件迁移

**目标**: 将现有通用组件迁移到新结构

**任务清单**:
1. 迁移 `Sidebar` → `components/Sidebar/`
2. 迁移 `MetricCard` → `components/MetricCard/`
3. 迁移 `Card` → `components/Card/`
4. 迁移 `StatusBadge` → `components/StatusBadge/`
5. 迁移 `Layout` → `components/Layout/`
6. 为每个组件创建 `.module.scss`
7. 从 `index.css` 提取对应样式

**产出物**:
```
components/
├── Sidebar/
│   ├── index.tsx
│   └── index.module.scss
├── MetricCard/
│   ├── index.tsx
│   └── index.module.scss
└── ...
```

---

### Phase 4: 其他页面重构

**目标**: 按优先级重构剩余页面

**4.1 ChatRecords 页面**
```
view/chatRecords/list/
├── index.tsx
├── styles/
└── components/
    ├── FilterPanel.tsx
    ├── RecordTable.tsx
    └── ChatDetailDrawer/
```

**4.2 Dashboard 页面**
```
view/dashboard/
├── index.tsx
├── styles/
└── components/
    ├── OverviewCards.tsx
    ├── TrendChart.tsx
    └── RecentActivity.tsx
```

**4.3 其他页面** (System, Config, ConsoleLogs, Hosting, Users)

---

### Phase 5: 清理与优化

**目标**: 清理遗留代码，优化构建

**任务清单**:
1. 删除旧 `pages/` 目录
2. 精简 `index.css`（仅保留 Tailwind 指令和必要全局样式）
3. 清理未使用的样式
4. 更新所有 import 路径
5. 添加路由懒加载

**验证标准**:
- 无未使用的 CSS
- `index.css` ≤ 200 行
- 构建产物体积减小

---

## 6. 风险与缓解

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| 视觉回归 | 中 | 高 | 每阶段完成后视觉对比测试 |
| 功能遗漏 | 低 | 高 | 保持功能测试用例 |
| 样式冲突 | 中 | 中 | CSS Modules 天然隔离 |
| 构建失败 | 低 | 中 | 每步验证构建 |
| 团队不适应 | 低 | 中 | 文档和代码示例 |

---

## 7. 预期收益

### 7.1 代码质量

| 指标 | 当前 | 目标 |
|------|------|------|
| 最大文件行数 | 1,009 | ≤ 200 |
| CSS 单文件行数 | 2,671 | ≤ 100 |
| 内联样式处数 | ~300 | 0 |
| 组件平均行数 | ~400 | ~100 |

### 7.2 可维护性

- **样式隔离**: CSS Modules 避免全局污染
- **职责单一**: 每个组件只做一件事
- **易于定位**: 按功能模块组织，快速找到代码
- **复用性**: 通用组件可跨页面复用

### 7.3 开发体验

- **SASS 嵌套**: 减少重复选择器
- **变量系统**: 统一修改主题色
- **模块热更新**: 样式修改即时生效
- **IDE 支持**: 更好的代码导航

---

## 8. 时间估算

| Phase | 内容 | 预计工作量 |
|-------|------|------------|
| Phase 1 | 基础设施 | 0.5 天 |
| Phase 2 | Logs 页面重构 | 1 天 |
| Phase 3 | 全局组件迁移 | 0.5 天 |
| Phase 4 | 其他页面重构 | 2 天 |
| Phase 5 | 清理优化 | 0.5 天 |
| **总计** | | **4.5 天** |

---

## 9. 验收标准

### 功能验收
- [ ] 所有页面功能正常
- [ ] 路由跳转正常
- [ ] 数据加载和展示正常
- [ ] 交互行为一致

### 代码验收
- [ ] 无 TypeScript 错误
- [ ] ESLint 检查通过
- [ ] 构建成功
- [ ] 无控制台错误

### 样式验收
- [ ] 视觉效果与重构前一致
- [ ] 响应式布局正常
- [ ] 无样式冲突

### 架构验收
- [ ] 目录结构符合规范
- [ ] 文件命名符合规范
- [ ] 单文件行数 ≤ 200
- [ ] 无内联 `style={{}}` 和 `<style>` 标签

---

## 10. 附录

### A. 新增依赖

```bash
pnpm add -D sass
```

### B. tsconfig 路径别名

```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"],
      "@/assets/*": ["./src/assets/*"],
      "@/components/*": ["./src/components/*"],
      "@/view/*": ["./src/view/*"],
      "@/hooks/*": ["./src/hooks/*"],
      "@/utils/*": ["./src/utils/*"],
      "@/types/*": ["./src/types/*"]
    }
  }
}
```

### C. vite.config.ts 更新

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `@import "@/assets/styles/variables.scss";`,
      },
    },
  },
});
```

---

**文档版本**: v1.0
**创建日期**: 2025-12-03
**作者**: Claude Code
