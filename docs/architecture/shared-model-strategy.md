# 共享模型策略

## 概述

由于前后端都使用 TypeScript 并在 Bun 统一工作流中，我们可以直接共享类型定义，无需额外的代码生成或序列化层。

## 共享位置

所有共享类型定义在 `src/shared` 目录：

```
src/shared/
├── contracts/        # API 契约（请求/响应）
│   ├── CampaignContracts.ts
│   ├── RuntimeContracts.ts
│   └── AIContracts.ts
└── types/           # 领域类型
    ├── Campaign.ts
    ├── Session.ts
    ├── Character.ts
    └── Event.ts
```

## 契约 vs 类型

### 契约（Contracts）

契约定义 API 边界，包括：
- 请求参数类型
- 响应数据类型
- 错误类型
- 事件类型

示例：

```typescript
// src/shared/contracts/CampaignContracts.ts
export interface GetCampaignsRequest {
  status?: CampaignStatus;
  limit?: number;
  offset?: number;
}

export interface GetCampaignsResponse {
  campaigns: Campaign[];
  total: number;
}

export interface CreateCampaignRequest {
  title: string;
  scenarioId?: string;
  groupId: number;
}

export interface CreateCampaignResponse {
  campaign: Campaign;
}
```

### 类型（Types）

类型定义领域模型，包括：
- 实体类型
- 值对象
- 枚举
- 联合类型

示例：

```typescript
// src/shared/types/Campaign.ts
export interface Campaign {
  id: string;
  title: string;
  status: CampaignStatus;
  groupId: number;
  scenarioId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CampaignStatus = 
  | 'planning'
  | 'active'
  | 'paused'
  | 'completed'
  | 'archived';
```

## 使用方式

### 后端使用

```typescript
// src/server/api/CampaignController.ts
import type { GetCampaignsRequest, GetCampaignsResponse } from '@shared/contracts/CampaignContracts';
import type { Campaign } from '@shared/types/Campaign';

export async function getCampaigns(
  req: GetCampaignsRequest
): Promise<GetCampaignsResponse> {
  // 实现
}
```

### 前端使用

```typescript
// src/web/app/routes/campaigns.tsx
import type { Campaign } from '@shared/types/Campaign';
import type { GetCampaignsResponse } from '@shared/contracts/CampaignContracts';

export function CampaignsPage() {
  const [campaigns, setCampaigns] = createSignal<Campaign[]>([]);
  
  async function loadCampaigns() {
    const res = await fetch('/api/campaigns');
    const data: GetCampaignsResponse = await res.json();
    setCampaigns(data.campaigns);
  }
  
  // ...
}
```

## 类型安全

### 编译时检查

TypeScript 编译器确保：
- 前后端使用相同的类型定义
- API 契约匹配
- 类型变更会触发编译错误

### 运行时验证（可选）

对于外部输入（如 API 请求），可以使用运行时验证：

```typescript
import { z } from 'zod';

const CreateCampaignSchema = z.object({
  title: z.string().min(1),
  scenarioId: z.string().optional(),
  groupId: z.number(),
});

export function validateCreateCampaign(
  data: unknown
): CreateCampaignRequest {
  return CreateCampaignSchema.parse(data);
}
```

## 版本管理

### 向后兼容

修改共享类型时保持向后兼容：
- 添加新字段时设为可选
- 不删除现有字段
- 使用联合类型扩展枚举

### 破坏性变更

如需破坏性变更：
1. 创建新版本类型（如 `CampaignV2`）
2. 同时支持旧版本一段时间
3. 逐步迁移
4. 移除旧版本

## 最佳实践

### 1. 明确职责

- **Contracts**：API 边界，可能包含序列化相关的元数据
- **Types**：领域模型，纯 TypeScript 类型

### 2. 避免循环依赖

共享类型不应依赖其他模块的具体实现，只依赖其他共享类型。

### 3. 使用类型工具

利用 TypeScript 工具类型：

```typescript
// 从领域类型生成 API 类型
export type CampaignSummary = Pick<Campaign, 'id' | 'title' | 'status'>;

// 部分更新
export type UpdateCampaignRequest = Partial<Pick<Campaign, 'title' | 'status'>>;
```

### 4. 文档化

为复杂类型添加 JSDoc：

```typescript
/**
 * 跑团活动状态
 * 
 * - planning: 筹备中
 * - active: 进行中
 * - paused: 已暂停
 * - completed: 已完成
 * - archived: 已归档
 */
export type CampaignStatus = 
  | 'planning'
  | 'active'
  | 'paused'
  | 'completed'
  | 'archived';
```

## 常见模式

### DTO 模式

使用 DTO（Data Transfer Object）分离领域模型和 API 模型：

```typescript
// 领域模型（可能包含方法）
export class Campaign {
  // ...
  public canStart(): boolean {
    return this.status === 'planning';
  }
}

// DTO（纯数据）
export interface CampaignDTO {
  id: string;
  title: string;
  status: CampaignStatus;
  // ...
}
```

### 事件类型

定义事件类型用于实时推送：

```typescript
// src/shared/types/Event.ts
export interface CampaignEvent {
  type: 'campaign.created' | 'campaign.updated' | 'campaign.deleted';
  campaignId: string;
  data: Campaign;
  timestamp: Date;
}
```

## 迁移策略

如果未来需要支持其他语言或运行时：

1. 保持 TypeScript 类型定义
2. 添加代码生成工具（如从 TypeScript 生成 JSON Schema）
3. 使用序列化库（如 protobuf）进行跨语言通信

但在当前 Bun + TypeScript 统一工作流中，直接共享类型是最简单高效的方式。
