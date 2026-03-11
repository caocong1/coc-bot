# CoC Bot 开发计划

本文档记录项目已完成功能与待开发项，便于后续按计划推进。

---

## 一、已完成

### 1. 基础设施

- [x] 项目配置：`package.json`、`tsconfig.json`、`.env.example`、`.gitignore`
- [x] 文档：架构、NapCat 对接、快速开始
- [x] 共享类型与契约（Campaign、Session、Character、Runtime、AI）

### 2. NapCat 接入

- [x] WebSocket 连接、心跳、断线重连
- [x] 事件归一化（OneBotEvent → 内部格式）
- [x] HTTP Action 客户端（发消息）
- [x] 消息路由（群聊/私聊、Dice 模式）

### 3. 掷骰与命令系统

- [x] 掷骰引擎：NdM、奖惩骰、取高取低、四则运算
- [x] 命令解析器：`.r` `.ra` `.rc` `.sc` `.st` 等
- [x] 命令注册表与路由
- [x] 完整命令管线：解析 → 路由 → 执行 → 响应发送

### 4. 骰子平台命令

| 命令 | 说明 | 状态 |
|------|------|------|
| `.r` | 掷骰（含多轮、奖惩骰、暗骰） | ✅ |
| `.ra` / `.rc` | CoC7 技能检定 | ✅ |
| `.sc` | 理智检定 | ✅ |
| `.ti` / `.li` | 疯狂症状 | ✅ |
| `.coc` | 人物作成 | ✅ |
| `.st` | 属性录入 | ✅ |
| `.pc` | 多角色卡管理 | ✅ |
| `.en` | 技能成长 | ✅ |
| `.setcoc` | 房规设置 | ✅ |
| `.help` | 帮助 | ✅ |
| `.regen <id>` | 重新生成图片（按 ID）| ✅ |

### 5. 今日人品 `.jrrp`

- [x] 基于「日期 + 用户ID」哈希出当日固定 1–100
- [x] 每人每天最多调用 AI 生成 5 条，超过后从已有 5 条随机返回
- [x] 提示词中传入具体骰值，AI 按分数生成评价
- [x] 兜底文案默认读取项目内 `src/commands/fun/jrrp.fallback.json`
- [x] 12 种风格随机，无 API Key 时使用兜底

### 6. 角色卡

- [x] 角色卡模型与内存存储
- [x] `.pc` 新建/切换/列表/展示/删除/重命名
- [x] `.st` 录入、增减、导出（含技能与 derived 属性）
- [x] 角色卡持久化到 SQLite（自动加载/自动落库）
- [x] `getGroupActiveCharacters(groupId)` — 查询群内所有激活 PC

### 7. 规则与领域

- [x] CoC7 检定解析（CheckResolver）
- [x] 理智检定与房规（SanityResolver）
- [x] 疯狂症状表（临时/总结）

### 8. 持久化

- [x] SQLite 单实例，所有子系统共享（无双连接问题）
- [x] `.jrrp` 每人每天 5 条缓存持久化
- [x] 数据库迁移脚本 `scripts/migrate.ts`

### 9. 知识库系统

- [x] PDF / TXT / MD 文本提取（`scripts/import-pdfs.ts` + `PdfTextExtractor`）
- [x] 智能文本切片（`ChunkPipeline`，导入时生成 chunks）
- [x] 向量索引构建（`scripts/build-indexes.ts` + `KnowledgeIndexer`）
  - [x] 真实语义向量：DashScope `text-embedding-v4`（1024维），`--embed` 开关启用
  - [x] 离线降级：无 `--embed` 时使用哈希伪向量（开发/测试用）
- [x] RAG 检索（`KnowledgeService`）
  - [x] 支持 `rules` / `scenario` / `keeper_secret` 三类索引
  - [x] 余弦相似度排序，按类别分别限制返回数量

### 10. AI KP 系统（核心，已完成）

#### 数据库

- [x] `kp_sessions` — 跑团会话表（含 `status`、`scenario_file_path`、`current_segment_id` 字段）
- [x] `kp_scenes` — 当前场景（每 session 一条）
- [x] `kp_clues` — 线索表（区分 KP 知晓 / 玩家已发现）
- [x] `kp_messages` — 对话消息历史（支持 `is_summarized` 标记）
- [x] `kp_summaries` — 历史对话摘要
- [x] `kp_pending_rolls` — 等待玩家投骰状态
- [x] `kp_session_players` — 参与玩家记录
- [x] `kp_scene_segments` — 模组动态分段（含标题、全文、摘要、seq 序号）

#### 会话状态（`SessionState`）

- [x] 场景管理（`setScene`）
- [x] 线索管理（`addClue` / `discoverClue` / `getDiscoveredClues`）
- [x] 等待骰子管理（`addPendingRoll` / `clearPendingRoll`）
- [x] 消息历史（`addMessage` / `getRecentMessages` / `markSummarized`）
- [x] 摘要（`addSummary` / `getSummaries`）
- [x] 玩家追踪（`trackPlayer` / `getPlayerIds`）
- [x] 模组全文（`setScenario` / `getScenarioText`）— 进程重启自动恢复
- [x] 快照接口（`snapshot()`）供 ContextBuilder 读取
- [x] 分段管理（`saveSegments` / `getSegments` / `getCurrentSegmentId` / `setCurrentSegmentId`）
- [x] 自动场景推进（`advanceSegmentIfTitleMatches`）— KP 回复含下一段标题关键词时自动前进指针

#### 上下文组装（`ContextBuilder`）

7 层结构，全部注入 system prompt：

| 层 | 内容 |
|----|------|
| 1 | KP 人格 + CoC 守秘人原则（场景/NPC/战斗/理智四大原则，铁则） |
| 2 | 当前场景状态、等待骰子、已发现线索 |
| 3 | 所有玩家角色卡（实时数值，取前 20 技能） |
| 4 | RAG：规则库检索结果 |
| 5C | 动态场景分段窗口（优先）：当前段完整原文 + 相邻段摘要 + 远端段仅标题 |
| 5A | 模组全文注入（有全文且无分段时使用，适配 qwen3.5-plus 1M 上下文） |
| 5B | 模组 RAG（降级备用） |
| 6 | 历史对话摘要（滚动压缩后的旧消息） |
| 7 | 近期原文对话（最近 30 条，作为 messages[] 返回） |

#### AI KP 流水线（`KPPipeline`）

- [x] 介入判断（`decideIntervention`）：
  - 骰子结果、系统事件 → 必须回应
  - OOC 消息（`(...)` / `OOC:` 开头）→ 跳出叙事答疑
  - 直接问 KP（`KP,` / `守秘人,` 开头）→ 回应
  - 玩家描述行动（含「我想/我要/我试...」等关键词）→ 判断是否需要检定
  - 玩家对 NPC 说话（引号/「对XXX说」）→ 以 NPC 身份回应
  - 超过沉默阈值（默认 5 条）→ 插入一句氛围描写
  - 纯玩家互 RP → 静默观察
- [x] 并行 RAG 检索（规则库 + 模组）
- [x] 草稿生成：`qwen3.5-plus` 流式输出
- [x] 双层守密人过滤：
  - 第一层：AI 内部掌握所有 KP 知识
  - 第二层：`qwen-plus` 二次审查，过滤 `[KP ONLY]` 信息泄露
- [x] 滚动摘要压缩：超过 40 条消息时异步压缩最旧 20 条
- [x] 每次 KP 回复后自动检测场景推进（`advanceSegmentIfTitleMatches`）

#### Campaign 管理（`CampaignHandler`）

- [x] `.campaign start [模板ID]`
  - 检测是否有暂停中的团（提示先 resume 或 stop）
  - 查询群内所有激活 PC 角色卡
  - AI 生成**三段式沉浸开场白**，逐条发到群聊：
    1. 时代背景与场景导入（100-150字）
    2. 调查员登场（根据角色卡，每人 50-80字）
    3. 事件导火索/钩子（80-120字，以`……`结尾）
- [x] `.campaign pause` — 暂停（状态改为 `paused`，进度全保留）
- [x] `.campaign resume` — 继续暂停的跑团
  - 恢复 SessionState + KPPipeline
  - AI 生成**两段式回顾摘要**，逐条发到群聊：
    1. 上次进度回顾（基于摘要+线索+近期消息，150-250字）
    2. 重返场景（引导玩家继续，80-120字）
- [x] `.campaign stop` — 彻底结束（同时能结束暂停中的 session）
  - 注意：这是纯技术指令；叙事上的"结团"由 AI KP 在故事中自然完成
- [x] `.campaign load <文件名>` — 加载模组全文
  - 读取 `data/knowledge/manifest.json`，按文件名模糊匹配
  - 后台异步切分为 5-15 个场景片段，为每片段生成摘要（`qwen-plus`）
  - 切分完成后启用动态场景窗口（5C 层优先于全文 5A）
- [x] 非命令消息路由到 `handlePlayerMessage()`（AI KP 处理）
- [x] 骰子命令结果路由到 `handleDiceResult()`（触发 AI KP 接话）

#### 服务入口（`server/index.ts`）

- [x] 多条消息顺序发送（800ms 间隔，避免 QQ 限速）
- [x] `.campaign` 子命令完整路由
- [x] 开团/继续时先发"⏳ 守秘人正在准备..."提示，再发 AI 内容
- [x] 启动时自动将意外中断（`status='running'`）的 session 标记为 `paused`，保留恢复入口

---

## 二、待开发

### 1. Web 控制台

#### 管理端（KP）

- [ ] 监控：所有群 session 状态（运行中/暂停/无）
- [ ] 实时消息流（SSE）
- [ ] AI 调用日志（token/延迟/guardrail 过滤次数）
- [ ] 跑团管理：start/pause/resume/stop（代替群里发命令）
- [ ] 手动切换当前场景分段
- [ ] 线索列表管理（已发现/未发现，手动标记）
- [ ] 向会话临时注入信息（让 KP 知道某隐藏内容）
- [ ] 模组/知识库：上传 PDF/TXT 触发导入+向量化
- [ ] 已导入文件列表、chunk 数量、分段预览
- [ ] KP Studio：实时调整 KP 人格参数 + layerStats 调试

#### 玩家端（PL）

- [ ] Token 认证：`.web login` → 带 token 的 24h 有效链接（nginx 反代出去）
- [ ] PC 列表（姓名/职业/HP/SAN/参与团）+ 权限控制（进行中的团→只读）
- [ ] 新建/编辑 PC 表单（完整还原 Excel 车卡逻辑）：
  - 时代 + 货币单位
  - 8 大属性输入 → 派生属性自动计算（HP/SAN/MP/MOV/伤害加值/体格）
  - 职业选择（231 个），技能点公式 + 核心技能自动标注
  - 技能表：职业点/兴趣点预算实时倒计时
  - 子技能指定（技艺/科学/格斗/射击/外语/驾驶/生存）
  - 背景故事 8 字段
  - 资产：信用评级 + 生活水平换算
  - 一键生成 `.st` 指令（同步给骰子机器人）
- [ ] 模组浏览：列表 + 简介（无剧情详情，无 KP ONLY 内容）
- [ ] 我的团：参与过的/进行中的团列表 + 团详情（玩家视角：场景名/已发现线索/参与玩家/消息历史只读）
- [ ] 操作手册：指令列表 + CoC7 快速规则参考 + FAQ

### 2. 模组媒体系统（图片 & Word 文档）✅ 已实现

#### 背景与场景

实际跑团模组通常以 `.docx` Word 文档提供，且文档中混合了：
- **模组正文**：场景描述、NPC 介绍、公开线索（可被 AI KP 参考）
- **守密人专用内容**：幕后真相、隐藏触发条件（`[KP ONLY]` 标记，AI 知晓但不直接说）
- **内嵌图片**：地图、室内结构图、道具图、NPC 肖像等
  - 这些图片在适当时机可以「发给玩家」在 QQ 群展示
- **纯文字场景描述**：可由 AI 基于描述生成氛围图

#### 阶段一：Word 文档解析（`.docx` 支持）

**目标**：`scripts/import-pdfs.ts` 扩展支持 `.docx` 格式

**实现方案**：

```
bun add mammoth          # Word → HTML/Markdown 转换
bun add sharp            # 图片后处理（压缩、格式转换）
```

解析流程：
1. 用 `mammoth` 将 `.docx` 转为 HTML，同时提取所有内嵌图片（base64 → Buffer）
2. 文字部分送入现有 `ChunkPipeline` 切片
3. 图片部分逐一保存到 `data/knowledge/images/<docId>/img-001.jpg` 等
4. 在 manifest 中记录每张图片的来源文档、位置顺序、原始文件名（如果有）

**关键数据结构扩展**（manifest.json）：

```jsonc
{
  "files": [
    {
      "id": "file-abc123",
      "name": "与苏珊共进晚餐.docx",
      "category": "scenario",           // 主体文字的类别
      "importedAt": "2026-03-12T...",
      "charCount": 45000,
      "chunkCount": 32,
      "images": [                       // 新增：内嵌图片列表
        {
          "id": "img-001",
          "path": "data/knowledge/images/file-abc123/img-001.jpg",
          "mimeType": "image/jpeg",
          "caption": "",                // 人工或 AI 生成的说明
          "playerVisible": false        // KP 决定是否可发给玩家
        }
      ]
    }
  ]
}
```

#### 阶段二：混合文档拆分（scenario + keeper_secret 同文档）

**问题**：一个 `.docx` 文件里 KP 内容和公开内容混排，不能整个文档都标为 `scenario` 或 `keeper_secret`。

**方案：约定标记语法**

在 Word 文档中，用特殊标注划分区域：

```
=== KP ONLY START ===
这段是守密人专用内容……
=== KP ONLY END ===
```

解析器在切片前先做预处理：
1. 扫描 `=== KP ONLY START ===` / `=== KP ONLY END ===` 标记
2. 标记区域内的文本块打上 `keeper_secret` 标签，其余打 `scenario` 标签
3. 两类文本块分别生成各自的 chunks，索引到对应的向量库
4. 对外 manifest 里该文件记录为 `category: "mixed"` 并携带 `hasKeeperContent: true`

**替代方案（更简单）**：KP 在上传时手动上传两次，一次选「模组正文」一次选「守密人专用」，无需解析标记。两种方案都支持，标记语法作为高级功能。

#### 阶段三：图片管理 — KP 端（Admin UI）

**新页面：模组管理 → 图片标注**

- 上传完成后，图片列表展示在对应模组卡片下
- 每张图片可以：
  - 预览（缩略图）
  - 编辑说明文字（`caption`）
  - 切换「可见给玩家」开关（`playerVisible`）
  - 手动「发给当前团」按钮（立即通过 NapCat 发到群）
- KP Studio 可见「图片队列」：在叙事推进中，KP 可手动选一张图发给玩家

**AI 自动 Caption 生成**（图片识别）：

图片导入时，可调用 `qwen3.5-plus`（视觉模型）对图片内容进行识别，自动生成说明文字：

```typescript
// 调用 DashScope 视觉 API，传入图片 base64
const caption = await dashScope.chat({
  model: 'qwen3.5-plus',
  messages: [{
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
      { type: 'text', text: '这是一张克苏鲁跑团模组中的图片，请简洁描述其内容（地图/室内/NPC/道具等），中文，不超过50字。' },
    ],
  }],
});
```

生成的 caption 作为 AI KP 叙事时「图片队列说明」的初始值，KP 可手动修改。

**API**：

```
GET  /admin/knowledge/:fileId/images          — 列出图片
PATCH /admin/knowledge/:fileId/images/:imgId  — 更新 caption/playerVisible
POST  /admin/knowledge/:fileId/images/:imgId/send
      body: { sessionId, groupId }            — 发图到 QQ 群
```

**NapCat 图片发送**（已有 `NapCatActionClient`，扩展）：

```typescript
// NapCatActionClient.ts 新增
async sendGroupImage(groupId: string, imagePath: string): Promise<void> {
  await this.call('send_group_msg', {
    group_id: groupId,
    message: [{ type: 'image', data: { file: `file://${imagePath}` } }],
  });
}
```

#### 阶段四：AI KP 自动触发图片展示

**场景**：AI KP 在叙事中认为应该展示一张图时（比如「玩家进入地图室」），可以自动发图。

**实现**：

1. KP system prompt 中注入当前模组可用图片列表（id + caption）
2. AI 回复中可以包含特殊标记：`[SHOW_IMAGE:img-001]`
3. `KPPipeline` 解析回复时检测此标记，提取图片 id，调用 `sendGroupImage()`
4. 过滤后发给玩家的文字中移除该标记（不暴露内部格式）

**Context 注入**（第 2 层扩展）：

```
可用图片：
- [img-001] 酒店平面图（一楼）
- [img-002] 苏珊·怀特肖像
如需向玩家展示，在回复中加入 [SHOW_IMAGE:img-xxx]
```

#### 阶段五：AI 图片生成

**场景**：模组中没有配图，但 KP 或 AI 想根据文字描述生成一张氛围图/NPC 肖像。

**技术选型**：

| 方案 | 优点 | 缺点 |
|------|------|------|
| DashScope `qwen-image-2.0-pro` | 已有 DashScope Key，中文提示词友好，质量高 | — |
| Stable Diffusion（本地） | 免费、高质量 | 需 GPU，部署复杂 |
| DALL-E 3 | 高质量 | 需 OpenAI Key |

**推荐**：使用 DashScope `qwen-image-2.0-pro`（与现有 AI 体系一致，复用 Key，质量优于旧版 wanx）

**KP Studio 触发方式**（Admin UI）：

```
[生成图片] 输入框：「1920年代波士顿大学图书馆，阴沉，蜡烛，CoC风格」
→ 调用 DashScope qwen-image-2.0-pro API
→ 结果图保存到 data/knowledge/images/generated/gen-xxx.jpg
→ 显示预览，可选「发给当前团」或「保存到模组」
```

**AI KP 自动生成**（可选，高级）：
- AI KP 叙事时携带 `[GEN_IMAGE: 场景描述]` 标记
- Pipeline 检测并异步生成图片（30-60 秒）
- 生成完成后发到 QQ 群（带说明文字）
- 开关控制（默认关闭，防止 AI KP 滥用）

#### 实施顺序

```
阶段一（docx 解析）     → 解锁 Word 文档导入
阶段三（KP 图片管理）   → KP 手动发图给玩家
阶段二（混合内容拆分）   → 精细化 KP/公开内容分离
阶段四（AI 自动触发）   → AI KP 智能展示图片
阶段五（AI 图片生成）   → 氛围图自动生成
```

#### 受影响的文件

| 文件 | 变更 |
|------|------|
| `scripts/import-pdfs.ts` | 新增 `.docx` 解析分支、图片提取、KP ONLY 标记处理 |
| `src/knowledge/pdf/PdfTextExtractor.ts` | 新增 `DocxExtractor`（或独立文件） |
| `src/knowledge/chunking/ChunkPipeline.ts` | 支持带 `category` 标签的 chunk |
| `src/api/AdminRoutes.ts` | 新增图片列表/更新/发送 API |
| `src/adapters/napcat/NapCatActionClient.ts` | 新增 `sendGroupImage` |
| `src/ai/kp/KPPipeline.ts` | 解析 `[SHOW_IMAGE:]` / `[GEN_IMAGE:]` 标记 |
| `src/ai/kp/ContextBuilder.ts` | 第 2 层注入可用图片列表 |
| `web/src/pages/admin/ScenarioManager.tsx` | 图片列表、标注、发图 UI |
| `web/src/pages/admin/KPStudio.tsx` | 图片队列 + AI 生成触发 |
| `web/src/api.ts` | 新增图片相关 API 方法 |
| `data/knowledge/images/` | 新运行时目录（git 忽略） |

### 3. 已实现的图片系统关键文件

| 文件 | 说明 |
|------|------|
| `src/knowledge/images/ImageLibrary.ts` | 图片库服务（持久化 library.json）|
| `src/adapters/napcat/NapCatActionClient.ts` | 新增 `sendGroupImage()`（CQ码发本地文件）|
| `src/ai/client/DashScopeClient.ts` | 新增 `chat()`、`optimizeImagePrompt()`、`generateImage()` |
| `src/runtime/SessionState.ts` | 新增 `ScenarioImage` + `setScenarioImages()`、`resolveImage()` |
| `src/ai/context/ContextBuilder.ts` | 层 2 注入可用图片列表 |
| `src/ai/pipeline/KPPipeline.ts` | 解析 `[SHOW_IMAGE:id]` 标记，`KPOutput` 携带 `images[]` |
| `src/runtime/CampaignHandler.ts` | 加载模组时同步图片，`handlePlayerMessage` 返回 `CampaignOutput` |
| `src/commands/fun/RegenCommand.ts` | `.regen <imgId>` 命令重新生成图片 |
| `src/api/AdminRoutes.ts` | 图片列表/更新/发图 + `/images/generate` AI 生成接口 |
| `scripts/import-pdfs.ts` | 支持 `.docx`，提取图片存图片库，解析 KP ONLY 标记 |
| `data/knowledge/images/library.json` | 图片库（运行时，git忽略）|

### 4. 可选增强

- [ ] `.bot on/off` — 群内启用/禁用机器人响应
- [ ] 战斗轮追踪（CombatResolver 已有基础，暴露为命令）
- [ ] `.jrrp` CoC 风格长文案第二套
- [ ] Admin UI 图片列表预览（ScenarioManager 展示提取的图片，支持标注 caption 和 playerVisible）

---

## 三、参考

- 快速开始：[GETTING_STARTED.md](GETTING_STARTED.md)
- NapCat 配置：[ops/napcat-setup.md](ops/napcat-setup.md)
- 架构文档：[architecture/](architecture/)

---

*最后更新：2026-03-12（模组媒体系统 + .docx + 图片库 + AI 生图全部实现）*
