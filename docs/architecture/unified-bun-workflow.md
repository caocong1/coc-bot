# Bun 统一工作流架构

## 为什么统一使用 Bun

本项目采用 Bun 作为统一的工作流核心，包括：

- **后端服务**：HTTP API、WebSocket、SSE 实时推送
- **前端构建**：SolidJS 控制台的依赖管理、开发服务器、构建输出
- **脚本任务**：PDF 导入、索引构建、摘要重建、事件回放
- **运行时**：NapCat 消息处理、AI 调用、状态管理

### 统一工作流的优势

1. **单一工具链**：不需要管理 npm/pnpm/yarn 和 Bun 两套依赖系统
2. **开发效率**：Bun 的快速启动和 TypeScript 原生支持提升开发体验
3. **本地部署简化**：单机本地部署时，统一运行时减少运维复杂度
4. **类型共享**：前后端共享 TypeScript 类型，无需额外工具链

### SolidJS 在 Bun 中的集成

SolidJS 控制台通过 Bun 工作流创建和管理：

```bash
# 创建 SolidJS 应用（在项目根目录）
bun create solid src/web

# 安装依赖
bun install

# 开发模式
bun run dev

# 构建
bun run build
```

SolidJS 应用作为 `src/web` 目录下的子项目，与后端共享：

- `src/shared` 中的类型定义
- Bun 的依赖管理
- 统一的构建和运行脚本

### 工作流示例

#### 开发模式

```bash
# 启动完整平台（后端 + Web 控制台）
bun run dev
```

后端服务在 `src/server/index.ts` 中启动，同时：
- 提供 API 服务
- 托管 SolidJS 构建后的静态资源
- 处理 NapCat WebSocket 连接
- 提供 SSE 实时推送

#### 脚本执行

所有离线任务都是 Bun 脚本：

```bash
# 导入 PDF 规则书
bun run import-pdfs

# 构建向量索引
bun run build-indexes

# 重建摘要
bun run rebuild-summaries

# 回放事件日志
bun run replay-events
```

### 依赖管理

项目使用 Bun 的包管理器，`package.json` 中定义所有依赖：

- 后端依赖：HTTP 框架、数据库驱动、AI 客户端
- 前端依赖：SolidJS、UI 组件库
- 共享依赖：类型定义、工具函数

Bun 会自动处理：
- 依赖解析和安装
- TypeScript 编译
- 模块热更新（开发模式）

### 构建流程

1. **类型检查**：TypeScript 编译器检查所有类型
2. **后端构建**：编译 `src/server` 和相关模块
3. **前端构建**：SolidJS 构建工具生成静态资源
4. **资源整合**：将前端资源复制到后端静态资源目录

### 部署考虑

单机本地部署时：
- 单一进程运行所有服务
- 统一的日志和监控
- 简化的启动和停止流程

未来如需扩展：
- 可以拆分为独立服务，但保持 Bun 运行时
- Web 控制台可以独立部署，但共享类型定义

## 技术决策记录

### 为什么不使用 Node.js

- Bun 的 TypeScript 原生支持更适合本项目
- Bun 的启动速度在开发时更高效
- Bun 的统一工具链简化了项目结构

### 为什么不使用独立的前端工具链

- SolidJS 通过 Bun 创建和管理已经足够
- 统一工具链减少配置复杂度
- 共享类型定义更简单直接

### 为什么不使用 Docker

第一阶段目标是单机本地部署，Docker 会增加不必要的复杂度。未来如需容器化，可以在 Bun 统一工作流基础上添加。
