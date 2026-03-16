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
- [x] 支持 `.jrrp [话题]`，把后缀文本作为评语参考主题（带后缀时不进入当天缓存）
- [x] 低分评语整体收口为更偏幽默安慰、少用纯唱衰语气
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
  - [x] 支持 `rules` / `scenario` 两类索引
  - [x] 余弦相似度排序，按类别分别限制返回数量

### 10. AI KP 系统（核心，已完成）

#### 数据库

- [x] `kp_sessions` — 跑团会话表（含 `status`、`scenario_file_path`、`current_segment_id` 字段）
- [x] `kp_events` — 跑团事件流（`seq/id/type/channel_id/visibility/payload_json`）
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
- [x] 事件回放快照（`snapshotFromEvents()`）和 shadow compare
- [x] 场景频道（`SceneChannel`）：焦点频道、玩家归属、频道中断
- [x] 开场导演：`OpeningDirector` 两步生成 opening plan（skeleton + beat 文本），支持分频道、分时段、个人化引子和自然汇合目标
- [x] 推进导演：`SessionDirector` 在连续无进展交互后生成 `DirectorCue`，为 KP 注入低侵入推进方向
- [x] 开场/导演事件：`opening_plan` / `director_marker` / `director_seed_resolved` / `director_cue`
- [x] 分段管理（`saveSegments` / `getSegments` / `getCurrentSegmentId` / `setCurrentSegmentId`）
- [x] 自动场景推进（`advanceSegmentIfTitleMatches`）— KP 回复含下一段标题关键词时自动前进指针

#### 上下文组装（`ContextBuilder`）

7 层结构，全部注入 system prompt：

| 层 | 内容 |
|----|------|
| 1 | KP 人格 + CoC 守秘人原则（场景/NPC/战斗/理智四大原则，铁则） |
| 2 | 当前频道的场景状态、等待骰子、已发现线索 |
| 3 | 当前频道相关玩家角色卡（实时数值，取前 20 技能） |
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
- [x] 草稿生成：`qwen3.5-plus` 流式输出，失败自动重试一次
- [x] 双层守密人过滤：
  - 第一层：AI 内部掌握所有 KP 知识
  - 第二层：`qwen3.5-flash` 二次审查，过滤 `[KP ONLY]` 信息泄露
- [x] 滚动摘要压缩：超过 40 条消息时异步压缩最旧 20 条
- [x] 结构化指令抽取：`[SET_SCENE]` / `[DISCOVER_CLUE]` / `[PRIVATE_TO]`（仅秘密团真正走私聊；公开团会回落为公开叙事）
- [x] 输出合规兜底：去除编号列表，屏蔽直接 `HP/MP/SAN +/-N`
- [x] 每次 KP 回复后自动检测场景推进（`advanceSegmentIfTitleMatches`）
- [x] 并发控制：per-group 锁 + per-channel 队列，非焦点频道消息不会丢失
- [x] 60 秒超时保护 + 双次重试 + 用户可见错误提示
- [x] 非房间成员消息过滤（不触发 AI）

#### Campaign 管理（`CampaignHandler`）

- [x] `.campaign start [模板ID]`
  - 检测是否有暂停中的团（提示先 resume 或 stop）
  - 查询群内所有激活 PC 角色卡
  - AI 生成“开场计划 + beat 文本”式开场，默认按公开团在群里自然推进
- [x] `.campaign pause` — 暂停（状态改为 `paused`，进度全保留）
- [x] `.campaign resume` — 继续暂停的跑团
  - 恢复 SessionState + KPPipeline
  - AI 生成**两段式回顾摘要**，逐条发到群聊：
    1. 上次进度回顾（基于摘要+线索+近期消息，150-250字）
    2. 重返场景（引导玩家继续，80-120字）
- [x] `.campaign stop` — 彻底结束（同时能结束暂停中的 session）

#### 导演与隐私模式（当前默认行为）

- [x] 模组规则包支持 `playPrivacyMode = public | secret`
- [x] 默认公开团：不向玩家显示“镜头/频道”概念，不自动创建分线频道，单人感知也以群内公开叙事表达
- [x] 秘密团例外：允许私聊推进、秘密分线与更严格的个人秘密处理
- [x] `.scene` 降级为高级手动工具，主要用于管理员/KP 显式分线或秘密团
  - 注意：这是纯技术指令；叙事上的"结团"由 AI KP 在故事中自然完成
- [x] `.campaign load <文件名>` — 加载模组全文
  - 读取 `data/knowledge/manifest.json`，按文件名模糊匹配
  - 后台异步切分为 5-15 个场景片段，为每片段生成摘要（`qwen-plus`）
  - 切分完成后启用动态场景窗口（5C 层优先于全文 5A）
- [x] 非命令消息路由到 `handlePlayerMessage()`（AI KP 处理）
  - per-group 并发锁 + 消息合并：AI 思考中新消息排队，完成后 drain loop 合并处理
  - 非房间成员消息完全忽略（`isSessionMember()` 检查）
- [x] 骰子命令结果路由到 `handleDiceResult()`（触发 AI KP 接话）
  - 错误的骰子命令（`CommandResult.error`）不触发 AI
  - 非房间成员骰子结果不触发 AI
- [x] `.kp` 强制 KP 介入：同样检查成员资格
- [x] PC 名称解析：消息记录中显示角色名（`resolvePcName()`）
- [x] `.scene list/focus/join/move/merge/clear`
- [x] 非焦点频道紧急中断提示（建议切换焦点）
- [x] 开团前关系输入：`.room pc` 绑定角色卡，人物关系改在 Web 房间详情页里按当前 PC 卡配置

#### 服务入口（`server/index.ts`）

- [x] 多条消息顺序发送（800ms 间隔，避免 QQ 限速）
- [x] `.campaign` 子命令完整路由
- [x] 开团/继续时先发"⏳ 守秘人正在准备..."提示，再发 AI 内容
- [x] 启动时自动将意外中断（`status='running'`）的 session 标记为 `paused`，保留恢复入口

### 11. Web 控制台

#### 管理端（KP）

- [x] 所有群 session 状态监控（运行中/暂停/无）
- [x] 实时消息流（SSE，`/api/admin/sessions/:groupId/messages/stream`）
- [x] 跑团管理：start/pause/resume/stop
- [x] 手动切换当前场景分段
- [x] 线索列表管理（已发现/未发现，手动标记）
- [x] 向会话临时注入信息
- [x] KP 人格模板管理（KP Studio）：五维模板列表 + CRUD + 滑块编辑

#### 玩家端（PL）

- [x] Token 认证：`.web login` → 带 token 的 24h 有效链接
- [x] PC 列表（姓名/职业/HP/SAN）+ 进行中的团只读
- [x] 新建/编辑 PC 两步向导：
  - Step 1：掷出 4 组属性对比表，玩家选一组（`3d6×5` 核心属性 + `2d6+6×5` 幸运/体型/外貌）
  - Step 2：属性只读显示，选职业，职业点/兴趣点预算实时分配技能，填背景故事
  - 提交自动同步 bot DB，玩家无需发任何 QQ 命令
- [x] 模组浏览：列表 + 时代/职业/属性约束展示
- [x] 房间：创建/加入/选 PC/触发开始/查看成员列表
- [x] 房间即跑团：将旧“我的团”入口并回房间详情，统一在房间内查看消息历史、时间与运行状态
- [x] 操作手册页面（指令列表 + CoC7 规则参考）
- [x] `.web room <id>` — 私聊获取直达链接，token 自动存入

### 12. 模组管理系统

- [x] **DB**：`scenario_modules` 表（id / name / description / era / allowed_occupations / min_stats）
- [x] **DB**：`scenario_module_files` 表（文档+图片，含 import_status / char_count / chunk_count）
- [x] **DB**：`campaign_rooms.module_id` 关联 `scenario_modules`
- [x] 管理端 CRUD 模组（创建/列表/详情/编辑/删除）
- [x] 上传文档（PDF/TXT）→ 后台建索引，状态实时写回 DB
- [x] 上传图片（地图/道具图等）+ 标签说明
- [x] AI 生成图片（调用 DashScope 图像 API，存储在 `data/knowledge/images/modules/{moduleId}/`）
- [x] 图片服务端点：`/api/admin/modules/{moduleId}/images/{fileId}`
- [x] 玩家端浏览模组（含约束预览）
- [x] 创建房间时选择模组，自动继承约束（时代/职业限制/主属性总点要求）
- [x] 模组资产层：`module_entities` / `module_items` / `module_rule_packs`
- [x] 模组自动提取扩展：元数据 / 资产候选 / 规则包候选三路独立执行
- [x] Admin 模组子资源 API：实体 / 物品 / 规则包的列表、详情、更新和审核状态变更
- [x] `ContextBuilder` 注入模组规则包、当前场景实体摘要、关键实体详情、关键物品详情
- [x] 运行时 overlay：`register_entity` / `register_item` / `item_change` 写入 `kp_events`

### 13. 跑团房间系统

- [x] **DB**：`campaign_rooms` + `campaign_room_members` 表
- [x] **DB**：`campaign_room_relationships` 表；`campaign_rooms.director_prefs_json` 仅兼容保留，不再作为产品配置入口
- [x] 创建/加入/删除房间（运行中需 `force:true`）
- [x] 房间成员选择 PC（软验证：不符合约束显示 ⚠️ 但允许强行开始）
- [x] 房间关系预设（无向对）；导演策略已内收为系统全局逻辑，不再按房间配置
- [x] 从 Web 触发 `.campaign start`
- [x] 管理员强制删除任意房间
- [x] 一群只能有一个活跃跑团
- [x] 房间级 KP 人格设定（模板选择 + 自定义提示词），DB 新增 `kp_template_id` / `kp_custom_prompts` 列
- [x] 暂停/恢复/结束同步房间状态（`campaign_rooms.status` 随 `kp_sessions.status` 变化）
- [x] 恢复跑团时读取房间最新 KP 设定（暂停中可改模板/提示词，恢复时生效）
- [x] Admin 房间管理 UI：KP 设定面板（模板选择 + 参数预览 + 自定义提示词），所有状态均可见

### 14. 命令与规则增强

- [x] `.ra` 支持属性检定（力量/体质/敏捷/智力/意志/外貌/体型/教育，中英文均可）
- [x] `.ra` 支持派生值检定（HP/MP/SAN/幸运，中英文均可）
- [x] AI 系统提示词中 `.check` → `.ra` 修正，避免提示错误命令
- [x] AI 系统提示词中 `.san X/Y` → `.sc X/Y` 修正
- [x] 守密人过滤模型切换为 `qwen3.5-flash`（速度更快、能力更好）
- [x] 骰子命令格式错误（如 `.ra` 无参数）不再触发 AI KP 思考（`CommandResult.error` 标记）

### 15. KP 人格模板系统重构

- [x] **五维模型**：11 个参数精简为 5 个正交维度——基调 / 灵活度 / 引导度 / 致命度 / 节奏
- [x] **行为描述表**（`DimensionDescriptors.ts`）：每个维度 5 个档位（1-2 / 3-4 / 5-6 / 7-8 / 9-10），每档含中文标签 + 具体行为指令
- [x] **ContextBuilder 注入方式**：不再将原始数值直接传给 AI，而是查表生成结构化行为风格描述（`【KP 行为风格】`），AI 精确理解每个维度的具体行为要求
- [x] **5 个内置预设**：经典 / 新手友好 / 硬核 / 演绎 / 宇宙恐怖（替代原 10 个含义重叠的预设）
- [x] **自定义模板 CRUD**：通过 Web KP Studio 创建 / 编辑 / 删除自定义模板，存储在 `kp_templates` 表
- [x] **自定义设定语**：每个模板可追加 `customPrompts`（额外 AI 指令，如 NPC 口音、风格要求）
- [x] **Legacy 兼容映射**：旧 ID（`serious` / `old-school` / `babysitter` 等）自动映射到新预设
- [x] **KP Studio UI 重构**：左侧模板列表（内置只读 + 自定义可编辑）+ 右侧详情/编辑面板（5 维滑块 + 自定义设定语文本框），移除无用的 `layerStats` 调试面板
- [x] **房间级 KP 设定联动**：房间管理面板维度展示同步更新为 5 维

### 16. KP Pipeline 健壮性

- [x] **并发控制**：per-group 消息锁 + 消息缓冲，AI 思考中新消息自动排队，完成后合并处理（drain loop）
  - 排队的消息不触发重复"💭 KP 正在思考..."提示
  - 合并格式：`玩家A：xxx\n玩家B：yyy`
- [x] **AI 超时保护**：`DashScopeClient.streamChat()` 加 60 秒 `AbortSignal` 超时
- [x] **自动重试**：`KPPipeline.generateDraft()` 失败后自动重试一次，两次均失败返回 `⚠️ KP 暂时无法回应，请稍后再试`
- [x] **非成员过滤**：`handlePlayerMessage` / `handleForceKP` / `handleDiceResult` 均检查 `isSessionMember()`
  - 有关联房间：仅 `campaign_room_members` 中的成员消息触发 AI
  - 无关联房间（独立 session）：所有人均可参与
- [x] **PC 名称解析**：消息记录中玩家发言显示角色名（`resolvePcName()` 查 room_members → characters）

### 17. 导入与媒体增强

- [x] 模组文件上传路径按 moduleId 隔离（`data/knowledge/uploads/{moduleId}/`），防止同名文件冲突
- [x] Docx 导入自动生成图片描述（AI 视觉识别辅助 + 剧本文本上下文 → caption）
- [x] 模组文档导入自动为无配图场景 AI 生图（所有格式：docx/pdf/txt/md，调用 DashScope `qwen-image-2.0-pro`）

### 18. CoC7 参考数据系统 + 角色卡增强

#### 参考数据提取

- [x] Excel 数据提取脚本（`scripts/extract-excel-data.ts`）：从 `[充实车卡版本]空白卡.xlsx` 提取 12 个 sheet 的参考数据
- [x] 9 个 JSON 参考数据文件（`data/reference/`）：
  - `weapons.json`（147 件武器）、`armor.json`（85 件防具）、`vehicles.json`（85 辆载具）
  - `phobias.json`（100 条恐惧症 D100）、`manias.json`（100 条狂躁症 D100）
  - `insanity-symptoms.json`（10 条即时症状 + 6 条规则）
  - `occupations.json`（230 个职业，含推荐关系人和职业介绍）
  - `branch-skills.json`（分支技能：艺术与手艺/科学/格斗/射击 + 技能等级说明）
  - `attribute-descriptions.json`（属性值段文字说明）

#### 角色卡数据模型扩展

- [x] `Character` 类型新增 8 个可选字段：`assets` / `inventory` / `spells` / `companions` / `experiences` / `phobiasAndManias` / `woundsAndScars` / `mythosEncounters`
- [x] 6 个新接口：`CharacterAssets`（信用评级/生活水平/现金/资产详情）、`InventoryItem`（随身物品）、`Spell`（法术）、`Companion`（调查员伙伴）、`Experience`（经历记录）、`MythosEncounter`（神话接触）
- [x] 无需 DB 迁移（`characters.payload_json` 自动包含新字段）

#### Web 车卡 Tab 式布局

- [x] `CharacterForm.tsx` Step 2 从单页改为 6-Tab 布局：
  - Tab 1: 基本信息 + 属性（原有）
  - Tab 2: 技能分配（原有）
  - Tab 3: 资产与装备（新增：信用评级/生活水平/现金换算 + 随身物品动态表格）
  - Tab 4: 背景故事（原有）
  - Tab 5: 法术与神话（新增：法术列表 + 神话接触记录 + 恐惧症/狂躁症）
  - Tab 6: 同伴与经历（新增：调查员伙伴 + 经历模组记录）

#### 参考资料页面

- [x] `Reference.tsx` 玩家端参考资料页面（5 个 Tab）：
  - 武器表（可搜索/筛选，含技能/伤害/射程/贯穿/装弹/故障/时代/价格）
  - 防具表（可搜索，含护甲值/MOV惩罚/覆盖位置/时代）
  - 载具表（MOV/体格/乘客护甲/乘客数/时代）
  - 疯狂症状（即时症状 1D10 + 恐惧症/狂躁症 D100 列表 + 理智规则）
  - 参考信息（属性/技能等级说明）
- [x] 公共 API 端点（无需认证）：`GET /player/reference/{weapons|armor|vehicles|insanity|phobias|manias|attributes}`
- [x] 玩家端导航新增「参考资料」入口

#### AI KP 上下文增强

- [x] ContextBuilder Layer 3 扩展：角色卡输出中包含武器、护甲、载具、随身物品、法术（含代价）、精神状态、伤口/疤痕、神话接触、背景故事（外貌/特质/信念）、生活水平/现金
- [x] CharacterStore 从 payload_json 加载全部扩展字段（修复之前只加载 attributes/derived/skills 的瓶颈）
- [x] AI KP 可基于角色完整信息（武器、护甲、生活水平、精神状态、伤口等）进行叙事
- [x] KP 检定请求自动附带所有 PC 的对应技能/属性值（如 `📊 侦查：草从 60 | 爱丽丝 45`）

#### 疯狂命令增强

- [x] `SanityResolver` 从 JSON 参考数据加载症状表（带硬编码回退）
- [x] `.ti`（临时疯狂）掷到恐惧症/狂躁症时额外掷 D100 查具体条目
- [x] `.li`（总结疯狂）同上

### 19. Excel 角色卡导入

- [x] Excel 解析模块 `src/import/ExcelCharacterParser.ts`：解析标准中文 CoC7 角色卡 Excel
  - 基本信息（姓名/职业/年龄/时代/性别）
  - 职业序号（G5）→ 从"职业列表" sheet 查标准职业名
  - 八大属性 + 派生值（HP/SAN/MP/MOV/MOV调整值/DB/Build）
  - 技能表（双列布局，含职业点/兴趣点分配）
  - 武器表（行 52-58，含类型/技能/伤害/射程/穿刺等）
  - 背景故事、资产详情、随身物品、恐惧症/狂躁症
- [x] API 端点 `POST /player/characters/import-excel`（FormData 上传 .xlsx → 返回解析后的 JSON）
- [x] 前端导入流程：角色卡列表页「导入 Excel」按钮 → 上传 → 解析 → sessionStorage 暂存 → queueMicrotask 预填充 → 玩家确认/修改后保存
- [x] 职业匹配改进：精确匹配 → 关键词拆分匹配（如 Excel "程序员、电子工程师" → 匹配"计算机程序员/黑客"）

### 20. Web UI Tailwind CSS 迁移

- [x] 引入 Tailwind CSS v4（`@tailwindcss/vite` 插件）+ Vite 升级到 v6
- [x] 自定义暗色主题（`web/src/app.css` 定义 12 色 + 字体 + 全局基础样式）
- [x] 15 个组件从 CSS Modules 迁移到 Tailwind 内联类
- [x] 删除 4 个 `.module.css` 文件（App/Layout/Admin/Player，共 ~1207 行）
- [x] 视觉增强：统一过渡动画（`transition-all duration-200`）、卡片阴影、按钮点击反馈（`active:scale-95`）、hover 微位移
- [x] 统一滚动条、focus ring、输入框样式
- [x] 配置 Playwright MCP（`@playwright/mcp`）用于截图验证 UI 效果

### 21. 角色卡全面增强

- [x] 去掉 Step 1/2 分离，改为纯 Tab 布局（掷骰整合到基本信息 tab 可折叠面板）
- [x] Tab 从 6 个增加到 7 个：基本信息 | 技能 | 资产装备 | **战斗** | 背景 | 法术 | 同伴
- [x] 去掉所有冗余 h2 标题（tab 名已足够）
- [x] 保存/取消按钮移到 Tab 栏右侧（无需滚到底部）
- [x] 技能表去掉内部 max-height 滚动（解决双重滚动条）
- [x] 表单 max-width 去掉，内容自然撑满
- [x] 新增武器表：
  - 默认肉搏行（只读不可删除）
  - 「从武器库选择」弹窗（104 件武器，可搜索，点击添加）
  - 武器属性从库中带入（只读）：武器类型/使用技能/伤害/射程/穿刺/射速/装弹/故障值
  - 成功率自动关联角色技能值，显示普通/困难/极限三列
  - 自定义名称列可编辑
- [x] 新增防具/载具填写区域
- [x] Character 类型新增 `CharacterWeapon`/`CharacterArmor`/`CharacterVehicle` 接口
- [x] ContextBuilder 输出武器信息给 AI KP
- [x] 武器库数据清理（147→104 条，过滤掉术语解释/受伤程度等混入行）

### 22. KP Prompt 全面重写（Claude + GPT-5.4 协同分析）

- [x] 系统提示词结构重排：`身份与目标 → 硬约束 → 叙事与裁定 → 介入与场景管理 → 维度边界 + 维度注入 → 输出格式`
- [x] 新增【PC 自主性边界】：用"外部可观察事实 vs 主观/意图/主动动作"作为判定标准
- [x] 新增【优先级与维度生效边界】：维度只调风格不覆盖硬约束，明确优先级链
- [x] 新增【多人场景与镜头分配】：沉默玩家拉回、同时行动拆分结算
- [x] 新增【分队与单人行动】：短镜头切换、私密信息不全队共享
- [x] 新增【守密与一致性】：不代掷/不预结算/不改谜底/不篡改时间线
- [x] 新增【异常行为处理】：确认意图再结算、偏离主线不强拉
- [x] 新增【输出格式】：80-220 字、不用编号列表、检定独立成行
- [x] SAN 演出改为纯等级通知："这是一次轻微/明显/严重理智冲击，请自行描述角色表现"
- [x] 5 个维度全面重写（DimensionDescriptors.ts）：
  - tone: "轻松搞笑"→"轻松调剂"（不写段子不出戏玩梗）
  - flexibility: "完全自由"→"高弹性"（保留检定接口和成败边界）
  - guidance: "手把手"→"强引导"（只展示世界里有什么，不写行动菜单）
  - lethality: "极致残酷"→"极高致命"（遵守因果和预兆，非任意处决）
  - pacing: "快节奏"→"紧迫推进"（保留确认、检定和玩家决策空间）
- [x] .room resume 回顾增强：加日志、增强 prompt 约束、始终附上最近对话、短回复保护

---

## 二、待开发

### 1. Web 控制台（待完善）

#### 管理端

- [x] **Admin 房间管理 UI**：`/admin/rooms` 页面（查看所有房间 + KP 设定 + 强制删除）
- [ ] AI 调用日志（token/延迟/guardrail 过滤次数）
- [ ] 已导入文件 chunk 预览 / 分段预览

#### 玩家端

- [x] 我的团详情（`CampaignDetail.tsx` 已实现：场景名/发现线索/参与玩家/消息历史只读）
- [x] 操作手册（`Manual.tsx` 已实现）
- [x] 完整的 PC 表单：子技能指定 ✅ / 信用评级范围提示+超限警告 ✅ / 资产换算（生活水平/消费/现金） ✅
- [x] 参考资料页面（武器/防具/载具/疯狂症状/属性说明）
- [x] 角色卡 7-Tab 布局（基本信息/技能/资产装备/战斗/背景/法术/同伴）
- [x] 武器/防具/载具管理（武器库选择 + 技能关联成功率）
- [x] Tailwind CSS 迁移（去掉全部 CSS Modules）

### 3. 模组媒体系统（高级功能）

> 基础模组管理（上传/图片/AI生图）已在第12项实现。Docx 图片自动描述和 AI 补图已在第15项实现。以下为文档参考和尚未实现的高级功能。

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

#### 实施顺序与状态

```
阶段一（docx 解析）     → ✅ 已实现（mammoth 提取 + 图片保存 + KP ONLY 标记）
阶段二（混合内容拆分）   → ✅ 已实现（=== KP ONLY START/END === 标记）
阶段三（KP 图片管理）   → ✅ 部分实现（API 已有，Admin UI 待完善）
阶段四（AI 自动触发）   → ✅ 已实现（[SHOW_IMAGE:id] 标记，ContextBuilder 注入图片列表）
阶段五（AI 图片生成）   → ✅ 部分实现（导入时自动生成 + KP Studio 手动生成；AI KP [GEN_IMAGE:] 待实现）
  - ✅ 导入时自动生成：分析剧本文本，为无配图场景调用 qwen-image-2.0-pro 生图
  - ✅ KP Studio 手动生成：管理员输入描述 → AI 生图
  - 🔲 AI KP 叙事中 [GEN_IMAGE:] 标记 → 异步生图（高级，默认关闭）
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

### 3. 已实现的模组图片系统关键文件

| 文件 | 说明 |
|------|------|
| `src/api/AdminRoutes.ts` | 模组文件上传/删除、AI 生图接口（`/admin/modules/:id/images/generate`）、图片服务端点 |
| `src/ai/client/DashScopeClient.ts` | `generateImage()` 调用 DashScope 图像 API |
| `web/src/pages/admin/ScenarioManager.tsx` | 模组管理 UI：文档列表+上传+状态、图片缩略图+AI生成弹窗 |
| `web/src/api.ts` | `adminApi.uploadModuleFile` / `generateModuleImage` / `moduleImageUrl` |
| `data/knowledge/images/modules/` | 模组图片存储目录（运行时，git忽略）|

### 4. 可选增强

- [ ] `.bot on/off` — 群内启用/禁用机器人响应
- [ ] 战斗轮追踪（CombatResolver 已有基础，暴露为命令）
- [ ] `.jrrp` CoC 风格长文案第二套
- [ ] Admin UI 图片列表预览（ScenarioManager 展示提取的图片，支持标注 caption 和 playerVisible）
- [ ] AI KP 叙事中 `[GEN_IMAGE: 场景描述]` 标记 → 异步生图（默认关闭，防滥用）

---

## 三、参考

- 快速开始：[GETTING_STARTED.md](GETTING_STARTED.md)
- NapCat 配置：[ops/napcat-setup.md](ops/napcat-setup.md)
- 架构文档：[architecture/](architecture/)

---

*最后更新：2026-03-14（KP Prompt 全面重写、AI 上下文完整角色注入、角色卡 7-Tab+武器系统、Tailwind CSS 迁移）*
