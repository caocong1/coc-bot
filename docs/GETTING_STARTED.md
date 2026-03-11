# 快速开始指南

## 环境要求

- [Bun](https://bun.sh) >= 1.1
- NapCatQQ（已启动，配置 WebSocket + HTTP）
- 阿里云百炼 API Key（DashScope）

---

## 1. 安装依赖

```bash
bun install
```

---

## 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`：

```env
DASHSCOPE_API_KEY=sk-xxxx        # 阿里云百炼 API Key（AI KP 必须）
NAPCAT_WS_URL=ws://127.0.0.1:3003
NAPCAT_HTTP_URL=http://127.0.0.1:3002
NAPCAT_TOKEN=                    # NapCat 鉴权 Token（可留空）
SERVER_PORT=28765                # HTTP 管理接口端口
DATABASE_PATH=./data/storage/coc-bot.db  # SQLite 路径（可选）
```

---

## 3. 导入知识库（可选，AI KP 需要）

将 CoC7 规则书 PDF、模组 PDF 放到项目根目录，然后：

```bash
# 提取文字并切片
bun run import-pdfs

# 构建向量索引（推荐加 --embed 使用真实语义向量）
bun run build-indexes:rules    # 规则书索引
bun run build-indexes:scenario # 模组索引

# 或一键全部构建
bun run build-indexes:all
```

> **注意**：`--embed` 需要 `DASHSCOPE_API_KEY`。不加则使用哈希伪向量（检索精度低，适合测试）。

---

## 4. 启动 Bot

```bash
bun run dev
```

成功后控制台会显示：

```
=== CoC Bot 启动 ===
[Bot] logged in as <昵称> (<QQ号>)
[Server] HTTP on http://localhost:28765
=== CoC Bot 就绪 ===
```

---

## 5. 骰子模式命令（随时可用）

| 命令 | 示例 | 说明 |
|------|------|------|
| `.r` | `.r 3d6+2` | 掷骰 |
| `.r#N` | `.r#3 1d100` | 多轮掷骰 |
| `.rb` / `.rp` | `.rb 1d100` | 奖励骰 / 惩罚骰 |
| `.ra` | `.ra 侦查` | 技能检定（自动读卡） |
| `.rc` | `.rc 60` | 直接指定技能值检定 |
| `.sc` | `.sc 1d6/1d10` | 理智检定 |
| `.ti` / `.li` | `.ti` | 临时/总结疯狂症状 |
| `.coc` | `.coc` | 随机生成人物属性 |
| `.st` | `.st 力量:60 侦查:70` | 录入角色属性/技能 |
| `.pc new 李明` | `.pc new 李明` | 新建角色卡 |
| `.pc show` | `.pc show` | 查看当前角色卡 |
| `.pc list` | `.pc list` | 列出所有角色卡 |
| `.en 侦查` | `.en 侦查` | 技能成长 |
| `.setcoc` | `.setcoc 1` | 设置房规 |
| `.jrrp` | `.jrrp` | 今日人品 |
| `.help` | `.help` | 查看所有命令 |

---

## 6. AI KP 跑团模式

### 典型流程

```
# 玩家先录入角色卡
.pc new 陈博士
.st 力量:50 侦查:70 图书馆使用:80 san:65 hp:10

# KP 加载模组（可选，大幅提升 AI 质量）
.campaign load 调查员手册

# 开团（AI 生成三段式沉浸开场白）
.campaign start serious

# 正常跑团... 玩家发言，AI KP 自动判断是否接话
# 需要投骰时玩家自行 .ra 或 .r，KP AI 自动接话

# 中途需要暂停（保存所有进度）
.campaign pause

# 下次继续（AI 生成回顾摘要）
.campaign resume

# 彻底结束
.campaign stop
```

### 命令详解

| 命令 | 说明 |
|------|------|
| `.campaign start [模板]` | 开始新跑团，AI 生成三段式开场白 |
| `.campaign pause` | 暂停跑团，保存所有对话/线索/场景进度 |
| `.campaign resume` | 继续最近暂停的跑团，AI 生成回顾摘要 |
| `.campaign stop` | 彻底结束跑团（同时能结束暂停中的） |
| `.campaign load <文件名>` | 加载模组全文，支持模糊匹配文件名 |

### KP 人格模板

| 模板 ID | 风格 |
|---------|------|
| `serious` | 严肃经典（默认） |
| `humorous` | 幽默轻松 |
| `creative` | 创意叙事 |
| `freeform` | 自由即兴 |
| `strict` | 严格规则 |
| `old-school` | 老派经典 |

### AI KP 介入逻辑

| 触发条件 | KP 行为 |
|----------|---------|
| 骰子结果出现 | 立即基于结果叙述后果 |
| `(...)` / `OOC:` 开头 | 跳出叙事直接答疑 |
| `KP,` / `守秘人,` 开头 | 直接回应 |
| 玩家描述行动（「我想/我要/我试...」） | 判断是否需要检定，告知技能名 |
| 玩家对 NPC 说话 | 以 NPC 身份回应 |
| 玩家互 RP 超过 5 条 | 插入一句氛围描写 |
| 纯玩家互 RP | 静默观察 |

---

## 7. 数据存储

所有数据存储在 `data/storage/coc-bot.db`（SQLite）：

- `characters` — 角色卡
- `active_cards` — 激活绑定（userId:groupId → characterId）
- `kp_sessions` — 跑团会话（status: running / paused / ended）
- `kp_scenes` — 当前场景
- `kp_clues` — 线索
- `kp_messages` — 对话历史（含摘要压缩标记）
- `kp_summaries` — 历史摘要
- `kp_pending_rolls` — 等待玩家投骰

知识库存储在 `data/knowledge/`：

```
data/knowledge/
├── manifest.json       # 文件索引
├── raw/                # 提取的纯文本
├── chunks/             # 切片 JSON
└── indexes/            # 向量索引（.bin）
```

---

## 8. 常见问题

### Q: AI KP 没有回复？

检查：
1. `DASHSCOPE_API_KEY` 是否已配置
2. 是否已使用 `.campaign start` 开团
3. 消息是否触发了介入逻辑（见上表）

### Q: 如何加载模组？

```bash
# 先导入 PDF
bun run import-pdfs

# 然后在群聊中
.campaign load <PDF文件名关键字>
```

### Q: 多次跑团如何区分？

每次 `.campaign start` 创建新 session，数据独立。`.campaign pause` 后 `.campaign resume` 会自动恢复最近一次暂停的 session。

### Q: 如何添加新命令？

在 `src/commands` 下创建命令处理器，实现 `CommandHandler` 接口，然后在 `src/server/index.ts` 的 `registry.register(...)` 中注册。

---

## 参考文档

- [开发计划（已完成 / 待办）](ROADMAP.md)
- [架构文档](architecture/)
- [NapCat 配置](ops/napcat-setup.md)
