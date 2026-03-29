# OpenLimits 支持计划修订版

## 目的

这份文档用于替换 `docs/plans/openlimits-support.md` 作为实施依据。

原计划的方向是对的，但没有完全对齐当前仓库现状，主要问题是：

1. 当前 AI 路由并不只有 `DashScopeClient`，还存在已经上线的 `HybridAiClient(OpenCode -> DashScope fallback)`。
2. `CampaignHandler` 和 `KPPipeline` 都是长生命周期对象，后台改配置并不会自动影响运行中的 session。
3. `CampaignHandler` 自己也硬编码了 `KP_MODEL`，不只是 `KPPipeline`。
4. 管理端改动不只涉及 `AdminRoutes` 和 `Dashboard`，还必须补 `web/src/api.ts` 的契约层。
5. 计划把 OpenLimits 的能力缺失简单处理成“抛错”，但当前仓库里图片生成功能已经被管理端和命令直接使用，必须明确降级策略。

## 当前代码现状

### 已有 AI 路由

- `src/server/index.ts` 启动时只创建一个全局 `aiClient`
- `src/ai/client/HybridAiClient.ts` 已实现 OpenCode 优先、DashScope 回退
- `src/ai/client/DashScopeClient.ts` 同时承担：
  - chat
  - streamChat
  - embed
  - generateImage
  - optimizeImagePrompt

### 已有硬编码点

- `src/ai/pipeline/KPPipeline.ts`
  - `KP_MODEL = 'qwen3.5-plus'`
  - `GUARDRAIL_MODEL = 'qwen3.5-flash'`
- `src/runtime/CampaignHandler.ts`
  - 也有独立的 `KP_MODEL = 'qwen3.5-plus'`
  - 用于开场文案和 resume recap
- `src/ai/client/DashScopeClient.ts`
  - `optimizeImagePrompt()` 固定走 `qwen3.5-plus`

### 配置生效边界

- `server/index.ts` 启动时构造一次 `aiClient`
- `CampaignHandler` 持有这个 client
- `CampaignHandler` 在开团 / 恢复时构造 `KPPipeline`
- 因此“管理后台保存配置后立即影响所有请求”目前并不成立

建议明确：

- 新配置默认只影响“新启动的 session”
- 已暂停的 session 在 `resume` 时重新读取配置
- 正在运行中的 session 不自动热切换 provider

如果需要热更新，必须单独设计“刷新 AI 配置”的运行时机制，不应在首版一起做。

## 修订后的实现原则

1. 不推翻现有 `DashScope + HybridAiClient` 结构，在其上扩展 provider 配置。
2. 先抽象“AI 能力接口”，再让 `DashScopeClient` / `HybridAiClient` / `OpenLimitsClient` 实现同一接口。
3. 区分“聊天能力配置”和“图片/embedding 能力配置”，不要假设 OpenLimits 覆盖当前全部 AI 能力。
4. 明确配置的生效时机，避免后台保存后行为不一致。
5. 首版优先做到：
   - KP 聊天 provider 可切换
   - chat / guardrail / opening / recap 模型可配置
   - UI 可查看和保存配置

## 修订后的目标范围

### 首版必须支持

- 为 KP 聊天链路增加 `openlimits` provider
- 后台可配置以下字段：
  - `provider`
  - `chatModel`
  - `guardrailModel`
  - `openingModel`
  - `recapModel`
- 默认兼容现有 DashScope 行为
- 保留 `HybridAiClient` 路由能力

### 首版不建议强行一起做

- OpenLimits 下 embedding 支持
- OpenLimits 下图片生成支持
- 运行中的 session 热切换 provider
- 后台自动探测 provider 可用模型列表

## 修订后的架构设计

```text
server/index.ts
  ├─ openDatabase + migrateCoreSchema
  ├─ loadAISettings(db)
  ├─ createAIClients(aiSettings, env)
  │    ├─ primaryChatClient
  │    ├─ assetClient
  │    └─ routing metadata
  ├─ CampaignHandler(db, aiRuntime, ...)
  └─ ApiRouter(db, campaignHandler, aiRuntime, ...)

CampaignHandler
  ├─ startSession() 时读取当前 AI settings
  ├─ resumeSession() 时重新读取当前 AI settings
  ├─ 构造 KPPipeline 时传入模型配置
  └─ 开场/回顾不再写死模型

AdminRoutes
  ├─ GET /ai-config
  └─ PUT /ai-config

web/src/api.ts
  ├─ getAIConfig()
  └─ updateAIConfig()

Dashboard.tsx
  └─ AI 配置区块
```

## 数据模型修订

### 1. 新增 bot_settings 表

文件：`src/storage/Database.ts`

```sql
CREATE TABLE IF NOT EXISTS bot_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 2. 新增配置读写层

文件：`src/storage/BotSettingsStore.ts`

建议提供：

```ts
export type AIProvider = 'dashscope' | 'openlimits';

export interface AISettings {
  provider: AIProvider;
  chatModel: string;
  guardrailModel: string;
  openingModel: string;
  recapModel: string;
  imagePromptModel: string;
  embedModel: string;
}

export function getBotSetting(db: Database, key: string): string | null;
export function setBotSetting(db: Database, key: string, value: string): void;
export function getAISettings(db: Database): AISettings;
export function updateAISettings(db: Database, patch: Partial<AISettings>): AISettings;
```

注意：

- `apiKey` 不属于 DB 配置，不要放进 `AISettings`
- key 仍从 env 读取
- DB 中仅保存“行为配置”，不保存凭证

### 3. 默认值建议

```ts
const DEFAULT_AI_SETTINGS: AISettings = {
  provider: 'dashscope',
  chatModel: 'qwen3.5-plus',
  guardrailModel: 'qwen3.5-flash',
  openingModel: 'qwen3.5-plus',
  recapModel: 'qwen3.5-plus',
  imagePromptModel: 'qwen3.5-plus',
  embedModel: 'text-embedding-v4',
};
```

原因：

- 当前开场、主流程、回顾实际都各自有调用点
- 如果只保留 `chatModel` / `guardrailModel`，会漏掉 `CampaignHandler` 内的开场和 recap

## AI 客户端设计修订

### 1. 先提取接口，不要继续把类型绑死到 DashScopeClient

文件建议：`src/ai/client/AIClient.ts`

```ts
import type { EmbedOptions, StreamCallbacks, VisionMessage } from './DashScopeClient';

export interface AIClient {
  chat(model: string, messages: VisionMessage[]): Promise<string>;
  streamChat(
    modelId: string,
    messages: Array<{ role: string; content: string }>,
    callbacks: StreamCallbacks,
  ): Promise<void>;
  embed(texts: string[], options?: EmbedOptions): Promise<number[][]>;
  generateImage(prompt: string, size?: string): Promise<string>;
  optimizeImagePrompt(description: string, model?: string): Promise<string>;
}
```

然后调整：

- `DashScopeClient implements AIClient`
- `HybridAiClient extends DashScopeClient` 保持不变，但类型上也满足 `AIClient`
- `OpenLimitsClient implements AIClient`

同时把以下类型引用从 `DashScopeClient` 改成 `AIClient`：

- `KPPipeline`
- `CampaignHandler`
- `AdminRoutes`
- 命令层中依赖 AI client 的位置

### 2. OpenLimitsClient 的能力策略

文件：`src/ai/client/OpenLimitsClient.ts`

建议实现：

- `chat()`：支持
- `streamChat()`：支持
- `optimizeImagePrompt()`：支持，内部走 `chat(model, ...)`
- `embed()`：抛出明确错误
- `generateImage()`：抛出明确错误

错误信息必须可被上层识别，建议统一成：

```ts
throw new Error('Current AI provider does not support embedding');
throw new Error('Current AI provider does not support image generation');
```

### 3. 工厂层不要丢掉 HybridAiClient

文件建议：`src/ai/client/createAIClients.ts`

不要只做一个 `createAIClient(provider, apiKey)`，而是改成“运行时组装”：

```ts
interface AIRuntime {
  chatClient: AIClient;
  assetClient: AIClient;
  settings: AISettings;
}
```

建议规则：

- `provider=dashscope`
  - `chatClient`: `HybridAiClient` 或 `DashScopeClient`
  - `assetClient`: `DashScopeClient`
- `provider=openlimits`
  - `chatClient`: `OpenLimitsClient`
  - `assetClient`: `DashScopeClient | null`

这样可以避免两个问题：

1. 你失去现有 OpenCode fallback 能力
2. 管理端图片生成在 OpenLimits 模式下直接整体报废

如果首版不想保留 OpenLimits 下的图片生成能力，也必须在计划里明确：

- 管理端图片生成接口返回 409/400，并给出可理解错误
- `.regen` 等命令在该模式下也要给出一致提示

否则只是“底层抛错”，前台体验会很差。

## 流程改造修订

### Step 1: 新增 `AIClient` 接口文件

新增：

- `src/ai/client/AIClient.ts`

目的：

- 解除 `CampaignHandler` / `AdminRoutes` / `KPPipeline` 对 `DashScopeClient` 具体类的耦合

### Step 2: 新增 `OpenLimitsClient`

新增：

- `src/ai/client/OpenLimitsClient.ts`

要求：

- 对齐 `AIClient`
- SSE 流解析按 OpenAI-compatible 格式实现
- 对 4xx/5xx 保留状态码和响应体

### Step 3: 新增 AI 运行时组装器

新增：

- `src/ai/client/createAIRuntime.ts`

输入：

- DB settings
- env

输出：

- `chatClient`
- `assetClient`
- `settings`

### Step 4: 新增 `BotSettingsStore`

新增：

- `src/storage/BotSettingsStore.ts`

修改：

- `src/storage/Database.ts`

### Step 5: 修改 `KPPipeline`

修改：

- `src/ai/pipeline/KPPipeline.ts`

新增配置项：

```ts
export interface KPPipelineOptions {
  templateId?: string;
  customPrompts?: string;
  silenceThreshold?: number;
  enableGuardrail?: boolean;
  summaryTriggerCount?: number;
  roomId?: string;
  db?: Database;
  chatModel?: string;
  guardrailModel?: string;
}
```

并替换内部硬编码：

- `generateDraft()` 使用 `this.chatModel`
- `applyGuardrail()` 使用 `this.guardrailModel`
- `generateSummary()` 也需要明确用哪个模型

建议：

- `generateSummary()` 先复用 `guardrailModel`
- 后续如有需要再拆 `summaryModel`

### Step 6: 修改 `CampaignHandler`

修改：

- `src/runtime/CampaignHandler.ts`

这里不能只“传模型名给 KPPipeline”，还必须处理自身的硬编码调用：

- 开场生成
- `resume` recap

建议新增：

```ts
interface CampaignAIConfig {
  chatModel: string;
  guardrailModel: string;
  openingModel: string;
  recapModel: string;
}
```

在 `startSession()` 和 `resumeSession()` 时读取最新配置，然后：

- 构造 `KPPipeline(..., { chatModel, guardrailModel })`
- 开场用 `openingModel`
- recap 用 `recapModel`

### Step 7: 修改 `server/index.ts`

修改：

- `src/server/index.ts`

不要继续直接 new `DashScopeClient` / `HybridAiClient`，改成：

1. 启动后先初始化 DB
2. 从 DB 读取 AI settings
3. 调用 `createAIRuntime(...)`
4. 将 runtime 注入 `CampaignHandler` / `ApiRouter`

同时日志要打印：

- 当前 provider
- 当前聊天模型
- 当前是否启用 OpenCode fallback
- 当前图片能力是否可用

### Step 8: 修改 `AdminRoutes`

修改：

- `src/api/AdminRoutes.ts`

新增端点建议使用：

- `GET /ai-config`
- `PUT /ai-config`

比 `/model-config` 更准确，因为这里不只是模型名，还有 provider。

返回结构建议：

```json
{
  "provider": "dashscope",
  "chatModel": "qwen3.5-plus",
  "guardrailModel": "qwen3.5-flash",
  "openingModel": "qwen3.5-plus",
  "recapModel": "qwen3.5-plus",
  "imagePromptModel": "qwen3.5-plus",
  "embedModel": "text-embedding-v4",
  "capabilities": {
    "imageGeneration": true,
    "embedding": true
  }
}
```

`PUT` 时需要做输入校验：

- provider 必须在允许枚举内
- 所有模型名 `trim()` 后不能为空

### Step 9: 修改前端 API 封装

修改：

- `web/src/api.ts`

必须补充：

- `getAIConfig()`
- `updateAIConfig()`
- `AIConfig` 类型定义

原计划漏了这一层，实际实施时一定会卡在这里。

### Step 10: 修改 Dashboard

修改：

- `web/src/pages/admin/Dashboard.tsx`

新增 AI 配置区块即可，但要注意两点：

1. 保存后只更新配置展示，不要假装正在运行中的 session 已自动切换
2. UI 上明确写出：
   - 新配置影响新会话
   - 已运行会话需暂停并恢复，或重启 bot 后完全生效

如果 `capabilities.imageGeneration === false`：

- 图片生成相关按钮显示提示
- 或在相关页面禁用并解释原因

## API Key 与环境变量修订

### 保留现有环境变量

- `DASHSCOPE_API_KEY`
- `OPENCODE_SERVER_URL`
- `OPENCODE_SERVER_USERNAME`
- `OPENCODE_SERVER_PASSWORD`

### 新增

- `OPENLIMITS_API_KEY`

### 不建议新增

- `AI_PROVIDER`

原因：

- provider 已计划存 DB
- 同一个配置来源即可，避免 env 与 DB 冲突

如果一定要保留 env 回退，规则必须写清楚：

1. DB 有值时以 DB 为准
2. DB 没值时回退 env
3. 后台保存后写入 DB，后续不再看 `AI_PROVIDER`

否则会出现“后台改了但实际没生效”的混乱行为。

## 能力降级策略

这是原计划最需要补的一块。

### 方案 A：推荐

- 聊天 provider 可切到 OpenLimits
- 图片生成和 embedding 仍固定走 DashScope
- UI 显示“聊天 provider”和“资源能力 provider”的区别

优点：

- 不破坏现有图片工作流
- 风险最低

缺点：

- 配置概念稍复杂

### 方案 B：可接受但不推荐

- OpenLimits 模式下禁用图片生成和 embedding

如果选这个方案，必须在计划里补：

- `AdminRoutes.generateImage()` 的明确错误处理
- 模组图片生成/重生成的错误处理
- `.regen` 命令的错误处理
- UI 禁用提示

## 配置生效规则

建议明确写进文档和 UI：

1. 保存 AI 配置后，新的 KP 会话立即使用新配置
2. 已暂停会话在恢复时会读取新配置
3. 正在运行中的会话继续使用创建时的配置
4. 管理端图片生成功能按当前 `assetClient` 能力执行

这样实现成本和用户认知都最稳定。

## 测试计划修订

至少验证以下场景：

1. 默认配置下启动 bot，确认仍是 DashScope 或 HybridAiClient 路由
2. `GET /api/admin/ai-config` 返回默认值
3. `PUT /api/admin/ai-config` 后重新 `GET`，确认持久化成功
4. 新开 KP session，确认 `KPPipeline` 使用新 `chatModel`
5. `resume` 已暂停 session，确认使用新的 `recapModel` / `chatModel`
6. OpenLimits 模式下进行一轮 KP 对话，确认主链路可用
7. OpenLimits 模式下验证图片生成行为符合设计：
   - 如果走 DashScope asset fallback，则应成功
   - 如果禁用，则应返回明确错误
8. 执行 `bun tsc --noEmit`

## 需要修改的文件清单

### 新增

- `src/ai/client/AIClient.ts`
- `src/ai/client/OpenLimitsClient.ts`
- `src/ai/client/createAIRuntime.ts`
- `src/storage/BotSettingsStore.ts`

### 修改

- `src/ai/client/DashScopeClient.ts`
- `src/ai/client/HybridAiClient.ts`
- `src/ai/pipeline/KPPipeline.ts`
- `src/runtime/CampaignHandler.ts`
- `src/server/index.ts`
- `src/api/AdminRoutes.ts`
- `src/storage/Database.ts`
- `web/src/api.ts`
- `web/src/pages/admin/Dashboard.tsx`
- `.env.example`
- `docs/CHANGELOG.md`
- `docs/TEST_LOG.md`
- 视情况更新 `docs/architecture/repo-layout-final.md`

## 对 Claude Code 的直接执行建议

如果让 Claude Code 按这个计划落地，建议顺序是：

1. 先做 `AIClient` + `OpenLimitsClient` + `BotSettingsStore`
2. 再改 `KPPipeline` 和 `CampaignHandler` 去掉硬编码模型
3. 再改 `server/index.ts` / `AdminRoutes.ts`
4. 最后补 `web/src/api.ts` 和 `Dashboard.tsx`
5. 完成后跑 `bun tsc --noEmit`

不要先做 UI，再补后端；否则会反复返工。
