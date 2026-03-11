# 最终仓库结构

## 目录树

```
coc-bot/
├── src/
│   ├── server/              # Bun HTTP 服务、API、实时推送
│   │   ├── index.ts        # 服务入口
│   │   ├── api/            # REST API 路由
│   │   ├── realtime/       # SSE/WebSocket 实时推送
│   │   └── middleware/     # 中间件
│   │
│   ├── runtime/            # 群聊/私聊路由、模式切换
│   │   ├── ModeResolver.ts
│   │   ├── MessageRouter.ts
│   │   ├── VisibilityPlanner.ts
│   │   └── PermissionChecker.ts
│   │
│   ├── adapters/           # NapCat/OneBot 适配层
│   │   └── napcat/
│   │       ├── NapCatTransport.ts
│   │       ├── NapCatEventNormalizer.ts
│   │       ├── NapCatActionClient.ts
│   │       └── MessageCodec.ts
│   │
│   ├── commands/           # 骰子命令体系
│   │   ├── CommandRegistry.ts
│   │   ├── CommandParser.ts
│   │   ├── dice/          # 掷骰命令
│   │   ├── sheet/         # 角色卡命令
│   │   ├── coc7/          # CoC7 规则命令
│   │   └── group/         # 群管理命令
│   │
│   ├── domain/            # CoC 领域模型、边界、策略
│   │   ├── campaign/      # 团务模型
│   │   ├── character/     # 角色模型
│   │   ├── player/        # 玩家模型
│   │   ├── knowledge/     # 线索模型
│   │   ├── scene/         # 场景模型
│   │   ├── sanity/        # 理智模型
│   │   ├── policy/        # 边界策略
│   │   └── visibility/    # 可见性模型
│   │
│   ├── ai/                # AI 客户端、Prompt、KP 模板
│   │   ├── client/        # DashScope 客户端
│   │   │   ├── DashScopeClient.ts
│   │   │   └── StreamChat.ts
│   │   ├── config/        # Prompt 配置
│   │   │   ├── PromptComposer.ts
│   │   │   ├── KPTemplateRegistry.ts
│   │   │   └── PromptExecutionSnapshot.ts
│   │   ├── templates/     # KP 模板
│   │   └── pipeline/      # AI 流水线
│   │
│   ├── memory/            # 事件日志、摘要、记忆层
│   │   ├── events/        # 事件日志
│   │   │   ├── EventLog.ts
│   │   │   ├── EventTypes.ts
│   │   │   └── EventReplayer.ts
│   │   ├── summaries/     # 摘要系统
│   │   └── tiers/         # 记忆分层
│   │
│   ├── knowledge/         # PDF 抽取、切片、索引、RAG
│   │   ├── pdf/           # PDF 处理
│   │   │   └── PdfTextExtractor.ts
│   │   ├── chunking/      # 文本切片
│   │   │   └── ChunkPipeline.ts
│   │   ├── indexing/      # 索引构建
│   │   │   └── KnowledgeIndexer.ts
│   │   └── retrieval/     # RAG 检索
│   │       └── RuleRetrievalService.ts
│   │
│   ├── storage/           # SQLite、本地数据访问
│   │   ├── Database.ts
│   │   ├── repositories/  # 数据仓库
│   │   └── migrations/   # 数据库迁移
│   │
│   ├── shared/            # 前后端共享类型、DTO、契约
│   │   ├── contracts/     # 契约定义
│   │   │   ├── CampaignContracts.ts
│   │   │   ├── RuntimeContracts.ts
│   │   │   └── AIContracts.ts
│   │   └── types/         # 共享类型
│   │
│   └── web/               # SolidJS 控制台源码
│       ├── app/           # SolidJS 应用
│       │   ├── routes/    # 页面路由
│       │   ├── components/# 组件
│       │   └── entry.tsx  # 应用入口
│       └── public/        # 静态资源
│
├── scripts/               # Bun 脚本
│   ├── import-pdfs.ts
│   ├── build-indexes.ts
│   ├── rebuild-summaries.ts
│   └── replay-events.ts
│
├── docs/                  # 文档
│   ├── architecture/      # 架构文档
│   ├── domain/           # 领域文档
│   ├── web/              # Web 文档
│   ├── ai/               # AI 文档
│   └── runtime/          # 运行时文档
│
├── data/                  # 数据目录
│   ├── knowledge/         # 知识库数据
│   │   ├── indexes/      # 向量索引
│   │   └── manifest.json
│   ├── storage/          # 数据库文件
│   └── cache/            # 缓存
│
├── package.json
├── tsconfig.json
├── .gitignore
└── README.md
```

## 模块职责

### src/server

Bun HTTP 服务层，负责：
- HTTP API 路由
- WebSocket/SSE 实时推送
- 静态资源托管（SolidJS 构建产物）
- 请求中间件和日志

### src/runtime

运行时路由层，负责：
- 消息路由（群聊/私聊）
- Dice Mode / Campaign Mode 切换
- 可见性规划（VisibilityEnvelope）
- 权限检查

### src/adapters

外部系统适配层，负责：
- NapCat/OneBot 协议适配
- 事件归一化
- 消息编码解码

### src/commands

命令处理层，负责：
- 命令注册和解析
- 骰子、角色卡、CoC7 规则命令
- 群管理命令

### src/domain

领域模型层，负责：
- CoC 核心概念建模
- KP/PL/PC 边界定义
- 业务规则和策略

### src/ai

AI 系统层，负责：
- DashScope 客户端封装
- Prompt 组合和模板管理
- AI 流水线编排

### src/memory

记忆系统层，负责：
- 事件日志记录和回放
- 多层级摘要生成
- 长期记忆管理

### src/knowledge

知识库层，负责：
- PDF 文本抽取
- 文档切片和索引
- RAG 检索

### src/storage

存储层，负责：
- SQLite 数据库访问
- 数据仓库模式
- 数据库迁移

### src/shared

共享层，负责：
- 前后端共享类型定义
- API 契约定义
- DTO 结构

### src/web

Web 控制台，负责：
- SolidJS 前端应用
- 用户界面和交互
- 实时数据展示

## 依赖关系

```
src/web -> src/shared
src/server -> src/runtime -> src/adapters
src/server -> src/commands -> src/domain
src/server -> src/ai -> src/memory
src/server -> src/knowledge
src/server -> src/storage
src/runtime -> src/domain
src/ai -> src/knowledge
src/ai -> src/memory
src/memory -> src/storage
```

## 数据流

1. **消息流**：NapCat -> adapters -> runtime -> commands/ai -> storage
2. **API 流**：HTTP -> server -> domain/storage -> shared contracts -> web
3. **实时流**：events -> memory -> realtime -> web
4. **AI 流**：user input -> ai pipeline -> knowledge/memory -> response

## 扩展点

- **新命令**：在 `src/commands` 中添加
- **新领域模型**：在 `src/domain` 中添加
- **新 AI 能力**：在 `src/ai` 中添加
- **新存储后端**：在 `src/storage` 中添加适配器
- **新页面**：在 `src/web/app/routes` 中添加
