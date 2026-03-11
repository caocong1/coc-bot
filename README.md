# AI QQ CoC 跑团平台

基于 Bun + TypeScript + SolidJS 的统一工作流 CoC 跑团平台。

## 项目概述

这是一个完整的克苏鲁的呼唤（Call of Cthulhu）跑团平台，包含：

- **QQ 机器人**：通过 NapCatQQ/OneBot 协议接入，支持普通骰子模式和 AI KP 跑团模式
- **AI KP 系统**：基于阿里云百炼的 AI 守秘人，能够阅读规则书和剧本并主持跑团
- **Web 控制台**：SolidJS 构建的管理界面，查看历史、管理状态、配置 AI KP
- **知识库系统**：PDF 规则书和剧本的 RAG 检索系统
- **长期记忆**：事件日志、摘要、多层级记忆系统

## 技术栈

- **运行时**：Bun + TypeScript
- **前端**：SolidJS（通过 Bun 工作流创建和运行）
- **QQ 网关**：NapCatQQ / OneBot
- **AI**：阿里云百炼 OpenAI-compatible 接口
- **存储**：SQLite + 本地文件索引

## 快速开始

### 前置要求

- Bun >= 1.0.0
- 已安装 NapCatQQ 并登录 QQ

### 第一步：配置 NapCat

在 NapCat 的 WebUI 或配置文件中开启两个服务：

| 服务 | 类型 | 端口 | 说明 |
|------|------|------|------|
| HTTP 服务端 | HTTP Server | `3000` | Bot 用来发送消息 |
| WebSocket 服务端 | WS Server | `3001` | Bot 用来接收消息 |

> 详细步骤见 [NapCat 对接配置文档](docs/ops/napcat-setup.md)

### 第二步：安装依赖

```bash
bun install
```

### 第三步：配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，核心配置项：

```env
# NapCat WebSocket 服务端地址（接收消息）
NAPCAT_WS_URL=ws://127.0.0.1:3001

# NapCat HTTP 服务端地址（发送消息）
NAPCAT_HTTP_URL=http://127.0.0.1:3000

# 阿里云百炼 API Key（AI KP 功能需要）
DASHSCOPE_API_KEY=your_api_key_here
```

### 第四步：启动

```bash
bun run dev
```

看到 `[NapCat] connected` 和 `CoC Bot 就绪` 就表示连接成功。

### 第五步：测试

在 QQ 群或私聊中发送：

```
.help          # 查看命令列表
.r 1d100       # 掷骰
.coc           # 生成角色属性
.ra 侦查 60    # 技能检定
```

## 项目结构

```
coc-bot/
├── src/
│   ├── server/          # Bun HTTP 服务、API、实时推送
│   ├── runtime/         # 群聊/私聊路由、模式切换
│   ├── adapters/        # NapCat/OneBot 适配层
│   ├── commands/        # 骰子命令体系
│   ├── domain/          # CoC 领域模型、边界、策略
│   ├── ai/              # AI 客户端、Prompt、KP 模板
│   ├── memory/          # 事件日志、摘要、记忆层
│   ├── knowledge/       # PDF 抽取、切片、索引、RAG
│   ├── storage/        # SQLite、本地数据访问
│   ├── shared/          # 前后端共享类型、DTO、契约
│   └── web/            # SolidJS 控制台源码
├── scripts/             # Bun 脚本（导入、索引、重建）
├── docs/               # 文档（领域、架构、操作）
└── data/               # 数据目录（数据库、索引、缓存）
```

## 开发指南

详细文档请查看 `docs/` 目录：

- [NapCat 对接配置](docs/ops/napcat-setup.md)
- [架构文档](docs/architecture/)
- [领域文档](docs/domain/)
- [Web 控制台文档](docs/web/)
- [AI 系统文档](docs/ai/)
- [快速开始详细指南](docs/GETTING_STARTED.md)

## 许可证

本项目仅供学习交流使用。
