# Plan: OpenLimits AI Provider 支持与模型可配置化

## 背景

当前 CoC Bot 的 AI 调用硬编码使用阿里云百炼（DashScope），模型名写死在代码里：
- `KPPipeline.ts`: `KP_MODEL = 'qwen3.5-plus'`, `GUARDRAIL_MODEL = 'qwen3.5-flash'`
- `DashScopeClient.ts`: `optimizeImagePrompt()` 固定调用 `qwen3.5-plus`

用户希望：
1. 支持 OpenLimits 作为替代 AI Provider（OpenAI-compatible API，base: `https://openlimits.app/v1`）
2. 模型名称可在管理页面配置切换，不需要改代码

## OpenLimits API 摘要

- **认证**: `Authorization: Bearer <api-key>` 或 `x-api-key: <api-key>`
- **端点**: `POST https://openlimits.app/v1/chat/completions`
- **格式**: OpenAI-compatible，请求/响应格式与 DashScope 兼容模式完全一致
- **模型**: `claude-sonnet-4-6`, `claude-haiku-4-5`, `gpt-5.4` 等（以管理后台实际可用为准）

## 架构设计

```
server/index.ts
  ├─ 启动时从 DB 读取 AI 配置 (provider, model names)
  ├─ createAIClient(provider, config) → UnifiedAIClient
  │     ├─ 'dashscope' → DashScopeAIClient (封装 DashScopeClient)
  │     └─ 'openlimits' → OpenLimitsAIClient (封装 OpenLimitsClient)
  ├─ aiClient 注入 CampaignHandler
  └─ aiClient 注入 KPPipeline (通过 CampaignHandler)

KPPipeline
  ├─ 从构造函数接收模型名称（不再硬编码）
  └─ 生成时用注入的模型名
```

## 详细实现步骤

---

### Step 1: 创建 OpenLimits 客户端

**文件**: `src/ai/client/OpenLimitsClient.ts`

实现与 `DashScopeClient` 相同的方法签名：
- `chat(model, messages)` — 非流式聊天
- `streamChat(modelId, messages, callbacks)` — 流式聊天
- `embed(texts, options)` — 文本向量化（OpenLimits 不支持 embedding，降级为直接抛错）
- `generateImage(prompt, size)` — 图片生成（OpenLimits 不支持，降级为抛错）
- `optimizeImagePrompt(description)` — 提示词优化（复用 chat 方法）

关键点：
- 端点: `https://openlimits.app/v1/chat/completions`
- 认证: `Authorization: Bearer <api-key>`
- 流式响应格式与 DashScope 兼容模式完全一致（SSE 格式）
- `optimizeImagePrompt()` 调用 chat 方法（走 OpenLimits）

---

### Step 2: 创建统一 AI 客户端接口与工厂

**文件**: `src/ai/client/UnifiedAIClient.ts`

定义统一接口：
```typescript
interface AIClient {
  chat(model: string, messages: VisionMessage[]): Promise<string>;
  streamChat(modelId: string, messages: Array<{role: string; content: string}>, callbacks: StreamCallbacks): Promise<void>;
  embed(texts: string[], options?: EmbedOptions): Promise<number[][]>;
  generateImage(prompt: string, size?: string): Promise<string>;
  optimizeImagePrompt(description: string): Promise<string>;
}
```

工厂函数：
```typescript
function createAIClient(
  provider: 'dashscope' | 'openlimits',
  apiKey: string,
): AIClient
```

- `provider === 'dashscope'`: 内部 new 一个 DashScopeClient
- `provider === 'openlimits'`: 内部 new 一个 OpenLimitsClient

**注意**: `HybridAiClient`（OpenCode 代理）逻辑保持不变，它 extends `DashScopeClient`。如果 provider=openlimits 则不使用 HybridAiClient。

---

### Step 3: 数据库配置表

**文件**: `src/storage/Database.ts`

新建表：
```sql
CREATE TABLE IF NOT EXISTS bot_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**文件**: `src/storage/BotSettingsStore.ts` (新建)

```typescript
export function getBotSetting(db: Database, key: string): string | null;
export function setBotSetting(db: Database, key: string, value: string): void;
export function getAIConfig(db: Database): AIConfig;
export function setAIConfig(db: Database, config: Partial<AIConfig>): void;
```

`AIConfig` 类型：
```typescript
interface AIConfig {
  provider: 'dashscope' | 'openlimits';
  chatModel: string;      // KP 主模型，如 'qwen3.5-plus' 或 'gpt-5.4'
  guardrailModel: string; // 守密人过滤模型，如 'qwen3.5-flash' 或 'gpt-5.4-flash'
  embedModel: string;     // 向量化模型，如 'text-embedding-v4'（仅 DashScope 需要）
  apiKey: string;         // API Key（可选，不存 DB，从 env 读取）
}
```

默认值（当 DB 中没有配置时）：
```typescript
const DEFAULT_AI_CONFIG: AIConfig = {
  provider: 'dashscope',
  chatModel: 'qwen3.5-plus',
  guardrailModel: 'qwen3.5-flash',
  embedModel: 'text-embedding-v4',
  apiKey: '', // 从 process.env 读取
};
```

---

### Step 4: 修改 KPPipeline 支持注入模型名

**文件**: `src/ai/pipeline/KPPipeline.ts`

修改 `KPPipelineOptions` 接口：
```typescript
export interface KPPipelineOptions {
  // ... 现有字段 ...
  /** KP 主模型，默认 'qwen3.5-plus' */
  chatModel?: string;
  /** 守密人过滤模型，默认 'qwen3.5-flash' */
  guardrailModel?: string;
}
```

修改 `KPPipeline` 类：
- 构造函数增加 `chatModel` 和 `guardrailModel` 参数
- `generateDraft()` 调用 `this.chatModel` 而非硬编码字符串
- `applyGuardrail()` 调用 `this.guardrailModel` 而非硬编码字符串

---

### Step 5: 修改 CampaignHandler 传递模型配置

**文件**: `src/runtime/CampaignHandler.ts`

在创建 `KPPipeline` 时，从 `AIConfig` 读取模型名称并传入。

---

### Step 6: 修改服务器入口，按 Provider 初始化

**文件**: `src/server/index.ts`

```typescript
// 读取 AI 配置（DB + env 回退）
const aiConfig = getAIConfig(db);

// 根据 provider 选择 API Key
const apiKey = aiConfig.provider === 'openlimits'
  ? (process.env.OPENLIMITS_API_KEY ?? process.env.DASHSCOPE_API_KEY ?? '')
  : (process.env.DASHSCOPE_API_KEY ?? '');

// 创建 AI Client
const aiClient = apiKey
  ? createAIClient(aiConfig.provider, apiKey)
  : null;

// 日志输出 provider 信息
console.log(`[Bot] AI Provider: ${aiConfig.provider}, Chat模型: ${aiConfig.chatModel}`);
```

---

### Step 7: 管理 API 端点

**文件**: `src/api/AdminRoutes.ts`

新增两个端点：

```
GET /model-config
  → 返回 { provider, chatModel, guardrailModel, embedModel }
  → 不返回 apiKey

PUT /model-config
  → Body: { provider, chatModel, guardrailModel, embedModel }
  → 写入 bot_settings 表
  → 返回更新后的配置
```

认证: `Authorization: Bearer <ADMIN_SECRET>`

---

### Step 8: 管理后台页面

**文件**: `web/src/pages/admin/Dashboard.tsx`

在 Dashboard 页面添加 AI 模型配置区块：
- Provider 选择: DashScope / OpenLimits（下拉）
- Chat 模型: 文本输入
- Guardrail 模型: 文本输入
- 保存按钮 → PUT /model-config

可选: 如果 OpenLimits 不支持 embedding 和 image generation，UI 上相应功能加提示/禁用。

---

### Step 9: 环境变量

**文件**: `.env.example`

新增：
```bash
# ── AI Provider ──
# 可选值: dashscope (默认), openlimits
AI_PROVIDER=dashscope

# OpenLimits API Key（当 AI_PROVIDER=openlimits 时使用）
OPENLIMITS_API_KEY=your_openlimits_api_key_here
```

---

### Step 10: 文档更新

**文件**: `docs/CHANGELOG.md` — 添加本次变更记录

**文件**: `docs/ROADMAP.md` — 标记已完成

---

## 迁移注意事项

1. **向后兼容**: 默认行为不变（provider=dashscope），现有部署无需修改
2. **API Key 来源**:
   - DashScope: 始终从 `DASHSCOPE_API_KEY` env 读取
   - OpenLimits: 从 `OPENLIMITS_API_KEY` env 读取
3. **embed / image generation**: OpenLimits 不支持，调用时抛明确错误，UI 上引导用户了解限制
4. **HybridAiClient (OpenCode)**: 仅在 provider=dashscope 时可用，保持原有逻辑

## 测试计划

1. 启动 bot，验证默认 DashScope 配置正常
2. 通过 Admin API 切换到 OpenLimits + gpt-5.4
3. 跑一个 KP session，验证 AI 回复正常
4. 切回 DashScope，验证回复正常
5. 管理后台 UI 测试保存/读取配置

## 文件清单

| 操作 | 文件 |
|------|------|
| 新建 | `src/ai/client/OpenLimitsClient.ts` |
| 新建 | `src/ai/client/UnifiedAIClient.ts` |
| 新建 | `src/storage/BotSettingsStore.ts` |
| 修改 | `src/storage/Database.ts` — 添加 bot_settings 表 |
| 修改 | `src/ai/pipeline/KPPipeline.ts` — 支持注入模型名 |
| 修改 | `src/runtime/CampaignHandler.ts` — 传递模型配置 |
| 修改 | `src/server/index.ts` — Provider 初始化逻辑 |
| 修改 | `src/api/AdminRoutes.ts` — 添加 model-config 端点 |
| 修改 | `web/src/pages/admin/Dashboard.tsx` — 管理 UI |
| 修改 | `.env.example` — 新增环境变量 |
| 修改 | `docs/CHANGELOG.md` |
