# NapCatQQ 对接配置指南

## 通信架构

CoC Bot 通过两个通道与 NapCat 通信：

```
                    ┌──────────────┐
                    │   NapCatQQ   │
                    │  (QQ 协议端)  │
                    └──┬────────┬──┘
          正向 WS      │        │    HTTP API
       (接收事件)      │        │   (发送消息)
                       ▼        ▼
                    ┌──────────────┐
                    │   CoC Bot    │
                    │  (本项目)     │
                    └──────────────┘
```

- **正向 WebSocket**：Bot 主动连接到 NapCat 的 WS 服务端，接收所有消息和事件
- **HTTP API**：Bot 通过 HTTP 调用 NapCat 的 API 来发送消息、查询信息等

## NapCat 侧配置

### 方式一：通过 WebUI 配置（推荐）

1. 启动 NapCat 后，打开 WebUI（默认地址见启动日志，通常是 `http://127.0.0.1:6099/webui?token=xxxxx`）
2. 扫码登录 QQ
3. 进入「网络配置」页面

#### 添加 HTTP 服务端

点击「新建」，选择 **HTTP 服务端**：

| 配置项 | 值 | 说明 |
|-------|------|------|
| 名称 | `CocBotHttp` | 自定义名称 |
| 启用 | ✅ | 打开 |
| 主机 | `0.0.0.0` | 监听地址 |
| 端口 | `3000` | HTTP API 端口 |
| Token | （可选） | 填写后 Bot 侧也要配置相同的 token |
| 消息格式 | `array` | 推荐使用 array 格式 |

#### 添加 WebSocket 服务端

点击「新建」，选择 **WebSocket 服务端**：

| 配置项 | 值 | 说明 |
|-------|------|------|
| 名称 | `CocBotWS` | 自定义名称 |
| 启用 | ✅ | 打开 |
| 主机 | `0.0.0.0` | 监听地址 |
| 端口 | `3001` | WS 端口 |
| Token | （可选） | 填写后 Bot 侧也要配置相同的 token |
| 消息格式 | `array` | 推荐使用 array 格式 |
| 上报自身消息 | ❌ | 一般关闭 |
| 心跳间隔 | `30000` | 默认 30 秒 |

### 方式二：通过配置文件配置

NapCat 的配置文件位于 `./config/onebot11_<QQ号>.json`。

编辑此文件，添加以下配置：

```json
{
  "httpServers": [
    {
      "name": "CocBotHttp",
      "enable": true,
      "host": "0.0.0.0",
      "port": 3000,
      "messagePostFormat": "array",
      "token": ""
    }
  ],
  "websocketServers": [
    {
      "name": "CocBotWS",
      "enable": true,
      "host": "0.0.0.0",
      "port": 3001,
      "messagePostFormat": "array",
      "reportSelfMessage": false,
      "token": "",
      "heartInterval": 30000
    }
  ]
}
```

> 如果已有其他配置，在对应数组中追加即可，不要覆盖已有项。

修改后重启 NapCat 生效。

## Bot 侧配置

在项目根目录创建 `.env` 文件（从 `.env.example` 复制）：

```env
# 正向 WebSocket 地址 —— 对应 NapCat 的 WebSocket 服务端
NAPCAT_WS_URL=ws://127.0.0.1:3001

# HTTP API 地址 —— 对应 NapCat 的 HTTP 服务端
NAPCAT_HTTP_URL=http://127.0.0.1:3000

# Token —— 如果 NapCat 设置了 token，这里填相同的值
NAPCAT_TOKEN=
```

## 端口对应关系

确保两端的端口一一对应：

| 用途 | NapCat 配置的端口 | Bot 的 .env 变量 | 默认值 |
|------|-----------------|-----------------|-------|
| 接收事件（WS） | websocketServers.port | `NAPCAT_WS_URL` | `3001` |
| 发送消息（HTTP） | httpServers.port | `NAPCAT_HTTP_URL` | `3000` |

## Token 鉴权

如果你想启用 token 鉴权（推荐在非本机环境使用）：

1. 在 NapCat 的 HTTP 服务端和 WebSocket 服务端配置中填入相同的 token
2. 在 Bot 的 `.env` 中设置 `NAPCAT_TOKEN=你设置的token`

Bot 会：
- 在 WebSocket 连接时通过 URL 参数 `access_token` 传递 token
- 在 HTTP API 调用时通过 `Authorization: Bearer <token>` 头传递 token

## 验证连接

### 1. 确认 NapCat 正常运行

NapCat 启动后应该能看到类似日志：
```
[WebSocket] Server started on 0.0.0.0:3001
[HTTP] Server started on 0.0.0.0:3000
```

### 2. 启动 Bot

```bash
bun run dev
```

应该能看到：
```
=== CoC Bot 启动 ===
[NapCat] connecting to ws://127.0.0.1:3001 …
[NapCat] connected
[Bot] logged in as 你的QQ昵称 (你的QQ号)
=== CoC Bot 就绪 ===
```

### 3. 在 QQ 中测试

在群里或私聊发送：

```
.help
```

如果机器人回复了命令列表，说明连接成功。

其他测试命令：

```
.r 1d100        # 掷骰
.coc            # 生成角色属性
.ra 侦查 60     # 技能检定
```

## 常见问题

### Q: Bot 启动后一直显示 "reconnect"

检查：
1. NapCat 是否已启动
2. NapCat 的 WebSocket 服务端是否已启用
3. 端口是否匹配
4. 防火墙是否拦截了端口

### Q: 连接成功但发消息没反应

检查：
1. NapCat 的 HTTP 服务端是否已启用
2. HTTP 端口是否匹配
3. 如果设置了 token，两边是否一致

### Q: 能收到消息但无法回复

检查：
1. `NAPCAT_HTTP_URL` 是否正确
2. 尝试手动调用 NapCat API 测试：
```bash
curl -X POST http://127.0.0.1:3000/get_login_info -H "Content-Type: application/json" -d "{}"
```

### Q: NapCat 和 Bot 不在同一台机器上

将 `127.0.0.1` 替换为 NapCat 所在机器的实际 IP 地址，并确保端口未被防火墙拦截。此时建议启用 token 鉴权。
