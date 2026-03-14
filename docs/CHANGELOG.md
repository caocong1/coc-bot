# Changelog

All notable changes to this project will be documented in this file.

## [0.5.0] - 2026-03-14

### Added
- **Excel 角色卡导入**：上传 `.xlsx` 文件一键导入角色卡（姓名/职业/属性/技能/武器/物品/背景）
- **武器系统**：角色卡新增「战斗」Tab，从 104 件武器库中选择，自动关联技能成功率（普通/困难/极限）
- **防具/载具**：角色卡新增防具和载具填写区域
- **KP 检定增强**：AI KP 请求检定时自动附带所有 PC 的对应技能/属性值
- **KP Prompt 全面重写**（Claude + GPT-5.4 协同分析）：
  - 新增 PC 自主性边界、优先级链、多人镜头分配、分队行动、守密一致性、异常行为处理
  - SAN 演出改为纯等级通知，不替 PC 描写反应
  - 新增输出格式约束（80-220 字、不用编号列表）
- **5 维度全面重写**：消除与硬约束的冲突（tone/flexibility/guidance/lethality/pacing）
- **Playwright MCP**：配置浏览器截图验证 UI 效果
- **CoC7 参考数据**：武器/防具/载具/职业/技能/疯狂症状/属性说明 JSON 数据

### Changed
- **Tailwind CSS 迁移**：从 CSS Modules 迁移到 Tailwind CSS v4，删除 ~1207 行 CSS
- **Vite 升级**：v5 → v6
- **CharacterForm 重构**：去掉 Step 分离，纯 7-Tab 布局，掷骰整合到属性区域
- **CharacterStore**：修复只加载 3 个字段的瓶颈，现在加载全部扩展字段
- **ContextBuilder**：输出完整角色信息（武器/护甲/载具/资产/背景/伤口/神话接触）
- **.room resume**：增强回顾内容（加日志、强约束、始终附最近对话、短回复保护）

### Fixed
- 武器库数据混入术语解释行（147→104 条）
- Excel 导入职业匹配失败（改用职业序号 + 关键词拆分匹配）
- Tab 高亮样式丢失（Tailwind v4 border 优先级问题）
- 技能表双重滚动条

## [0.4.0] - 2026-03-13

### Added
- **跑团房间系统**：`.room create/join/start/pause/resume/stop` 完整生命周期
- **Web 房间管理**：玩家端创建/加入房间、选择 PC、审卡流程
- **Admin 房间管理**：管理端查看所有房间、KP 设定、强制删除
- **Web 车卡增强**：6-Tab 布局（资产/法术/同伴/经历/神话接触）
- **角色卡类型扩展**：CharacterAssets/InventoryItem/Spell/Companion/Experience/MythosEncounter

## [0.3.0] - 2026-03-12

### Added
- **模组媒体系统**：`.docx` 导入支持、图片库管理、AI 生图（DashScope）
- **`.regen` 命令**：玩家重新生成指定图片
- **KP ONLY 分段**：`=== KP ONLY START/END ===` 标记分离公开/守密内容
- **图片发送**：NapCat CQ 码发送图片到 QQ 群

## [0.2.0] - 2026-03-11

### Added
- **知识库分类**：规则书/模组/守密人专用三种分类
- **模组管理页面**：Admin 端模组 CRUD + 文件上传

## [0.1.0] - 2026-03-10

### Added
- **初始版本**：CoC7 AI KP bot + Web Console
- 骰子命令（`.r` `.ra` `.rc` `.sc` `.ri` `.init`）
- 角色卡系统（`.pc` `.st` `.coc` `.en`）
- AI KP 流水线（DashScope qwen3.5-plus）
- 知识库 RAG（PDF 导入、切片、向量检索）
- SolidJS Web 控制台（管理端 + 玩家端）
- NapCat/OneBot QQ 协议适配
