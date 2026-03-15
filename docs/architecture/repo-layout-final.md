# 实际仓库结构

## 目录树

```
coc-bot/
├── src/
│   ├── server/
│   │   └── index.ts             # 服务入口（HTTP + WebSocket + 命令路由）
│   │
│   ├── api/                     # REST API 路由
│   │   ├── PlayerRoutes.ts      # /api/player/* （玩家端 + token 认证）
│   │   └── AdminRoutes.ts       # /api/admin/* （管理端 + secret 认证）
│   │
│   ├── storage/
│   │   ├── Database.ts          # SQLite schema / 迁移
│   │   └── ModuleAssetStore.ts  # 模组资产与规则包的行映射 / 查询辅助
│   │
│   ├── runtime/                 # 消息路由、模式切换、Campaign 管理
│   │   ├── ModeResolver.ts
│   │   ├── CampaignHandler.ts   # Campaign 模式处理（焦点频道 + per-channel 队列 + 成员过滤）
│   │   ├── SessionState.ts      # 会话状态管理（kp_events 回放 + SceneChannel + 模组资产 overlay）
│   │   ├── MessageRouter.ts
│   │   └── VisibilityPlanner.ts
│   │
│   ├── adapters/                # NapCat/OneBot 适配层
│   │   └── napcat/
│   │       ├── NapCatTransport.ts
│   │       ├── NapCatEventNormalizer.ts
│   │       └── NapCatActionClient.ts
│   │
│   ├── commands/                # 骰子/角色卡命令体系
│   │   ├── CommandRegistry.ts
│   │   ├── CommandParser.ts
│   │   ├── HelpCommand.ts
│   │   ├── dice/               # .r .ri .init 等
│   │   ├── sheet/              # .pc .st .set .nn
│   │   ├── coc7/               # .ra .rc .sc .coc .setcoc .en .ti .li
│   │   ├── fun/                # .jrrp .regen .name .gugu
│   │   ├── room/               # .room（跑团房间生命周期）
│   │   ├── module/             # .mod（模组列表/详情）
│   │   └── web/                # .web（登录/房间链接）
│   │
│   ├── domain/                  # 领域策略
│   │   ├── policy/KPGuardrails.ts
│   │   └── visibility/KnowledgeVisibility.ts
│   │
│   ├── ai/                      # AI 客户端、Prompt、KP 流水线
│   │   ├── client/DashScopeClient.ts
│   │   ├── config/
│   │   │   ├── KPTemplateRegistry.ts    # 内置 + 自定义模板管理（DB 集成）
│   │   │   ├── DimensionDescriptors.ts  # 五维行为描述表（基调/灵活度/引导度/致命度/节奏 × 5 档位）
│   │   │   └── PromptComposer.ts
│   │   ├── context/
│   │   │   └── ContextBuilder.ts        # 7 层上下文组装（含 Layer 1.5 模组规则包 / 结构化资产）
│   │   └── pipeline/
│   │       └── KPPipeline.ts            # AI KP 主流水线（生成 + 指令抽取 + guardrail + overlay）
│   │
│   ├── memory/                  # 事件日志、摘要
│   │   ├── events/
│   │   │   ├── EventLog.ts
│   │   │   └── EventTypes.ts
│   │   └── summaries/SummaryService.ts
│   │
│   ├── knowledge/               # PDF 抽取、切片、索引、RAG
│   │   ├── pdf/PdfTextExtractor.ts
│   │   ├── chunking/ChunkPipeline.ts
│   │   ├── indexing/KnowledgeIndexer.ts
│   │   └── retrieval/           # RAG 检索服务
│   │
│   ├── rules/                   # CoC7 规则解析
│   │   ├── coc7/
│   │   │   ├── CheckResolver.ts
│   │   │   ├── SanityResolver.ts
│   │   │   └── CombatResolver.ts
│   │   └── dice/DiceEngine.ts
│   │
│   ├── storage/
│   │   ├── Database.ts          # SQLite 单实例，含所有表定义和迁移
│   │   ├── TokenStore.ts        # 玩家 Web 登录 token 管理
│   │   └── UserSettingsStore.ts # 用户设置（默认骰/昵称）
│   │
│   ├── import/                    # Excel 导入
│   │   └── ExcelCharacterParser.ts  # Excel 角色卡解析（人物卡 sheet → CharacterPayload）
│   │
│   └── shared/                  # 内部共享类型（非 web 用）
│       ├── contracts/
│       │   ├── AIContracts.ts
│       │   ├── CampaignContracts.ts
│       │   └── RuntimeContracts.ts
│       └── types/
│           ├── Campaign.ts
│           ├── Character.ts
│           └── Session.ts
│
├── web/                         # SolidJS Web 控制台（独立子项目）
│   ├── src/
│   │   ├── pages/
│   │   │   ├── player/          # 玩家端页面
│   │   │   │   ├── Player.tsx
│   │   │   │   ├── Characters.tsx
│   │   │   │   ├── CharacterForm.tsx   # 7-Tab 车卡（基本/技能/资产/战斗/背景/法术/同伴 + 武器库选择器）
│   │   │   │   ├── Reference.tsx       # 参考资料页面（武器/防具/载具/疯狂/属性）
│   │   │   │   ├── Scenarios.tsx
│   │   │   │   ├── Rooms.tsx
│   │   │   │   └── RoomDetail.tsx
│   │   │   └── admin/           # 管理端页面
│   │   │       ├── Admin.tsx
│   │   │       ├── Sessions.tsx
│   │   │       ├── ScenarioManager.tsx
│   │   │       ├── KnowledgeManager.tsx
│   │   │       ├── KPStudio.tsx          # KP 人格模板管理（五维滑块 + CRUD）
│   │   │       └── RoomManager.tsx
│   │   ├── app.css              # Tailwind CSS 入口 + 自定义暗色主题（@theme 12 色）
│   │   ├── api.ts               # 统一 API 客户端（playerApi / adminApi）
│   │   └── index.tsx            # 应用入口 + 路由
│   ├── package.json             # SolidJS + Tailwind CSS v4 + Vite 6
│
├── scripts/                     # 离线 Bun 脚本
│   ├── import-pdfs.ts           # PDF/TXT/DOCX 导入 + 切片
│   ├── extract-excel-data.ts    # Excel → JSON 参考数据提取
│   ├── build-indexes.ts         # 构建向量索引
│   ├── rebuild-summaries.ts
│   └── replay-events.ts
│
├── docs/                        # 文档
│   ├── architecture/
│   ├── ops/
│   ├── web/
│   ├── GETTING_STARTED.md
│   ├── ROADMAP.md
│   └── TEST_LOG.md
│
├── data/                        # 运行时数据（git 忽略）
│   ├── reference/               # CoC7 参考数据 JSON（从 Excel 提取）
│   │   ├── weapons.json         # 武器表（104 件，已过滤术语解释行）
│   │   ├── armor.json           # 防具表（85 件）
│   │   ├── vehicles.json        # 载具表（85 辆）
│   │   ├── phobias.json         # 恐惧症 D100（100 条）
│   │   ├── manias.json          # 狂躁症 D100（100 条）
│   │   ├── insanity-symptoms.json # 疯狂即时/总结症状 + 规则
│   │   ├── occupations.json     # 职业表（230 个）
│   │   ├── branch-skills.json   # 分支技能 + 技能等级说明
│   │   └── attribute-descriptions.json # 属性值段说明
│   ├── knowledge/
│   │   ├── manifest.json        # 文件索引
│   │   ├── raw/                 # 纯文本
│   │   ├── chunks/              # 切片 JSON
│   │   ├── indexes/             # 向量索引（.bin）
│   │   └── images/modules/      # 模组图片
│   └── storage/
│       └── coc-bot.db           # SQLite 数据库
│
├── package.json
├── tsconfig.json
├── .env.example
└── .gitignore
```

## 模块职责

### src/server + src/api

Bun HTTP 服务层，负责：
- HTTP API 路由（`PlayerRoutes.ts` / `AdminRoutes.ts`）
- WebSocket 连接 NapCat
- SSE 实时消息推送
- 静态资源托管（`web/dist/` 构建产物）

### src/runtime

运行时路由层，负责：
- 消息路由（群聊/私聊）
- Dice Mode / Campaign Mode 切换
- 可见性规划

### src/adapters

外部系统适配层，负责：
- NapCat/OneBot 协议适配
- 事件归一化
- 发消息/发图片（`NapCatActionClient`）

### src/commands

命令处理层，负责：
- 命令注册和解析（`.r` `.ra` `.sc` `.st` `.pc` 等）
- CoC7 规则命令、趣味命令

### src/ai

AI 系统层，负责：
- DashScope 客户端封装（chat / 图像生成 / 60s 超时保护）
- KP 人格模板注册（5 个内置 + 自定义 CRUD，五维行为描述表：基调/灵活度/引导度/致命度/节奏）
- 7 层上下文组装（ContextBuilder）— 含 PC 自主性边界、维度优先级、多人镜头分配、守密一致性等硬约束
- KP Pipeline：介入判断 → RAG 检索 → 草稿生成（含重试）→ 守密过滤 → 检定增强（自动附 PC 技能值）→ 图片解析

### src/storage / Database.ts

存储层，单文件管理所有 SQLite 表定义和内联迁移：
- `characters` / `active_cards` — 角色卡
- `kp_sessions` / `kp_events` — AI KP canonical state
- `kp_scenes` / `kp_clues` / `kp_messages` / `kp_summaries` / `kp_pending_rolls` — legacy compatibility + cache
- `kp_templates` — 自定义 KP 人格模板
- `scenario_modules` / `scenario_module_files` — 模组管理
- `module_entities` / `module_items` / `module_rule_packs` — 模组资产层（关键 NPC/怪物、关键物品、模组规则包）
- `campaign_rooms` / `campaign_room_members` — 跑团房间
- `player_tokens` — 玩家 Web 登录
- `user_settings` — 用户设置（默认骰/昵称）

### web/

SolidJS + Tailwind CSS v4 Web 控制台（独立子项目），负责：
- 玩家端：7-Tab 车卡（含武器库选择器）、模组浏览、跑团房间、参考资料（武器/防具/载具/疯狂/属性）
- 管理端：会话监控、模组管理、知识库
- 样式：Tailwind CSS v4 内联类，自定义暗色主题（`app.css`），无 CSS Modules

## 数据流

1. **QQ 消息流**：NapCat → adapters → server/index → commands/ai → storage
2. **Web API 流**：HTTP → api/PlayerRoutes|AdminRoutes → storage → JSON 响应
3. **实时流**（SSE）：kp_messages → `/admin/sessions/:groupId/messages/stream`
4. **AI KP 流**：消息 → KP判断 → RAG检索 + 上下文组装 → DashScope → 过滤 → 回复
