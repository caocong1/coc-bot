# SolidJS 控制台在 Bun 中的引导与集成

## 概述

Web 控制台使用 SolidJS 构建，完全集成在 Bun 工作流中。本文档说明 SolidJS 应用的创建、开发、构建和与后端集成的方式。

## 创建 SolidJS 应用

### 初始化

在项目根目录执行：

```bash
bun create solid src/web
```

这会创建一个基础的 SolidJS 应用结构。

### 项目结构

```
src/web/
├── app/              # SolidJS 应用入口
│   ├── routes/      # 页面路由
│   ├── components/  # 组件
│   └── entry.tsx    # 应用入口
├── public/          # 静态资源
└── package.json     # SolidJS 项目配置
```

### 配置调整

创建后需要调整配置以与后端集成：

1. **修改 `src/web/package.json`**：
   - 确保使用 Bun 作为包管理器
   - 配置代理指向后端 API

2. **配置路由**：
   - 使用文件系统路由或显式路由配置
   - 路由路径与后端 API 路径对应

## 开发模式

### 独立开发（可选）

```bash
cd src/web
bun run dev
```

SolidJS 开发服务器会在独立端口运行（如 3000），通过代理访问后端 API。

### 集成开发（推荐）

后端服务同时托管前端：

```bash
# 在项目根目录
bun run dev
```

后端服务（`src/server/index.ts`）会：
1. 启动 HTTP 服务器
2. 提供 API 路由
3. 在开发模式下代理 SolidJS 开发服务器
4. 在生产模式下提供构建后的静态资源

## 构建流程

### 开发构建

```bash
cd src/web
bun run build
```

生成的文件在 `src/web/dist/` 目录。

### 生产构建

```bash
# 在项目根目录
bun run build
```

这会：
1. 构建 SolidJS 应用
2. 将构建产物复制到后端静态资源目录
3. 构建后端服务

## 与后端集成

### API 调用

前端通过统一的 API 客户端调用后端：

```typescript
// src/web/lib/api.ts
import type { Campaign, Session, PC } from '@shared/contracts';

export async function getCampaigns(): Promise<Campaign[]> {
  const res = await fetch('/api/campaigns');
  return res.json();
}
```

### 共享类型

前端直接导入共享类型：

```typescript
// src/web/components/CampaignList.tsx
import type { Campaign } from '@shared/contracts/CampaignContracts';

export function CampaignList() {
  const [campaigns, setCampaigns] = createSignal<Campaign[]>([]);
  // ...
}
```

### 实时更新

使用 SSE 或 WebSocket 接收实时更新：

```typescript
// src/web/lib/realtime.ts
export function useRealtimeUpdates(campaignId: string) {
  const eventSource = new EventSource(`/api/realtime/${campaignId}`);
  
  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    // 更新状态
  };
}
```

## 页面结构

### 一级页面

- `/overview` - 总览仪表板
- `/campaigns` - 团列表
- `/campaigns/:id` - 团详情
- `/sessions` - Session 列表
- `/sessions/:id` - Session 详情
- `/investigators` - 调查员列表
- `/investigators/:id` - 调查员详情
- `/knowledge` - 知识库
- `/ai-studio` - AI KP 工作室
- `/templates` - 模板库
- `/operations` - 运营管理

### 组件组织

```
src/web/app/components/
├── session/
│   └── TranscriptViewer.tsx
├── pc/
│   └── PCStatePanel.tsx
├── knowledge/
│   ├── CluePanel.tsx
│   └── NPCPanel.tsx
├── ai/
│   ├── KPTemplateSwitcher.tsx
│   └── PromptLayerEditor.tsx
└── live/
    └── RuntimeOverridePanel.tsx
```

## 状态管理

使用 SolidJS 的响应式系统：

```typescript
import { createSignal, createEffect } from 'solid-js';

export function useCampaign(campaignId: string) {
  const [campaign, setCampaign] = createSignal<Campaign | null>(null);
  
  createEffect(async () => {
    const data = await getCampaign(campaignId);
    setCampaign(data);
  });
  
  return campaign;
}
```

## 样式方案

推荐使用：

- **Tailwind CSS**：快速 UI 开发
- **SolidJS 内联样式**：组件级样式
- **CSS Modules**：需要时使用

## 部署

### 开发环境

后端服务同时提供前端资源，访问 `http://localhost:28765` 即可。

### 生产环境

1. 构建 SolidJS 应用
2. 将构建产物复制到后端静态资源目录
3. 后端服务提供静态文件服务

## 常见问题

### Q: 如何调试前端？

A: 使用浏览器开发者工具，SolidJS 提供良好的 DevTools 支持。

### Q: 如何热更新？

A: Bun 开发模式支持热更新，修改代码后自动刷新。

### Q: 如何处理路由？

A: 使用 SolidJS Router，配置与后端 API 路径对应。

### Q: 如何共享类型？

A: 通过 `src/shared` 目录，前后端都导入相同的类型定义。
