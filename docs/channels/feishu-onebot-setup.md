# 飞书 & QQ (OneBot) 渠道接入指南

本文档介绍如何将 Moltbot 接入飞书和 QQ（通过 OneBot/NapCat），并配置完整的 Agent 能力。

---

## 零、完整配置示例

以下是 `~/.clawdbot/moltbot.json` 的完整配置示例：

```json
{
  "models": {
    "providers": {
      "custom-claude": {
        "baseUrl": "http://你的API地址:端口",
        "apiKey": "你的API密钥",
        "auth": "api-key",
        "api": "anthropic-messages",
        "authHeader": true,
        "models": [
          {
            "id": "claude-haiku-4-5",
            "name": "Claude Haiku 4.5",
            "contextWindow": 200000,
            "maxTokens": 8192
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": { "primary": "custom-claude/claude-haiku-4-5" },
      "workspace": "C:\\Users\\你的用户名\\clawd",
      "maxConcurrent": 4,
      "subagents": { "maxConcurrent": 8 }
    },
    "list": [
      {
        "id": "feishu-agent",
        "workspace": "C:\\Users\\你的用户名\\clawd\\feishu"
      },
      {
        "id": "qq-agent",
        "workspace": "C:\\Users\\你的用户名\\clawd\\qq"
      }
    ]
  },
  "bindings": [
    { "agentId": "feishu-agent", "match": { "channel": "feishu" } },
    { "agentId": "qq-agent", "match": { "channel": "onebot" } }
  ],
  "tools": {
    "profile": "full",
    "exec": {
      "host": "gateway",
      "security": "full",
      "ask": "off",
      "backgroundMs": 30000,
      "timeoutSec": 300
    },
    "elevated": {
      "enabled": true,
      "allowFrom": {
        "telegram": ["*"],
        "feishu": ["*"],
        "onebot": ["*"]
      }
    },
    "web": {
      "search": { "enabled": true },
      "fetch": { "enabled": true, "maxChars": 50000 }
    },
    "media": {
      "image": { "enabled": true },
      "audio": { "enabled": true }
    },
    "message": {
      "crossContext": {
        "allowWithinProvider": true,
        "allowAcrossProviders": true
      }
    }
  },
  "channels": {
    "feishu": {
      "enabled": true,
      "appId": "你的AppId",
      "appSecret": "你的AppSecret",
      "verificationToken": "你的VerificationToken",
      "encryptKey": "你的EncryptKey",
      "dmPolicy": "open",
      "allowFrom": ["*"],
      "groupPolicy": "allowlist",
      "groups": { "*": { "enabled": true, "requireMention": true } }
    },
    "onebot": {
      "enabled": true,
      "httpUrl": "http://127.0.0.1:3000",
      "accessToken": "你的NapCat鉴权Token",
      "dmPolicy": "open",
      "allowFrom": ["*"],
      "groupPolicy": "allowlist",
      "groups": { "*": { "enabled": true, "requireMention": true } }
    }
  },
  "plugins": {
    "load": {
      "paths": [
        "C:/你的路径/moltbot-main/extensions/feishu",
        "C:/你的路径/moltbot-main/extensions/onebot"
      ]
    },
    "entries": {
      "feishu": { "enabled": true },
      "onebot": { "enabled": true }
    }
  }
}
```

---

## 一、飞书接入

### 1.1 前置条件

- 飞书开放平台账号
- 公网可访问的 Webhook URL（可使用 NATAPP 等内网穿透工具）

### 1.2 创建飞书应用

1. 访问 [飞书开放平台](https://open.feishu.cn/app)
2. 点击「创建企业自建应用」
3. 填写应用名称和描述，创建应用

### 1.3 获取应用凭证

在应用的「凭证与基础信息」页面获取：

| 字段 | 说明 |
|------|------|
| App ID | 应用唯一标识 |
| App Secret | 应用密钥 |

### 1.4 配置事件订阅

1. 进入「事件与回调」→「事件配置」
2. 配置请求地址（Webhook URL）：
   ```
   https://你的公网域名/webhook/feishu
   ```
3. 获取以下信息：
   - **Verification Token**：用于验证请求来源
   - **Encrypt Key**：用于解密加密的事件数据（可选但推荐）

4. 添加事件订阅：
   - `im.message.receive_v1`（接收消息）

### 1.5 配置权限

在「权限管理」中申请以下权限：

- `im:message` - 获取与发送单聊、群组消息
- `im:message:send_as_bot` - 以应用身份发送消息
- `im:chat:readonly` - 获取群组信息

### 1.6 发布应用

1. 进入「版本管理与发布」
2. 创建版本并提交审核
3. 审核通过后发布

### 1.7 Moltbot 配置

编辑 `~/.clawdbot/moltbot.json`，在 `channels` 中添加：

```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "appId": "cli_xxxxxxxxxxxxxxxx",
      "appSecret": "你的AppSecret",
      "verificationToken": "你的VerificationToken",
      "encryptKey": "你的EncryptKey",
      "dmPolicy": "open",
      "allowFrom": ["*"]
    }
  }
}
```

### 1.8 内网穿透配置（NATAPP）

由于飞书需要公网可访问的 Webhook，国内环境推荐使用 NATAPP：

1. 访问 [natapp.cn](https://natapp.cn/) 注册账号
2. 购买/使用免费隧道，配置本地端口为 `18789`
3. 启动 NATAPP：
   ```bash
   natapp -authtoken=你的authtoken
   ```
4. 将获得的公网域名配置到飞书事件订阅中

---

## 二、QQ 接入（通过 OneBot/NapCat）

### 2.1 架构说明

```
┌─────────────┐     HTTP POST      ┌──────────────────┐     HTTP API      ┌─────────┐
│   QQ 消息   │  ───────────────>  │     NapCat       │  <─────────────>  │ Moltbot │
│  (腾讯服务器) │                    │  (OneBot v11)    │                    │ Gateway │
└─────────────┘                    │   localhost:3000 │                    │  :18789 │
                                   │   localhost:6099 │                    └─────────┘
                                   └──────────────────┘
                                         ↑
                                    QQ 客户端协议
```

- **NapCat**：QQ 机器人框架，实现 OneBot v11 协议
- **双向通信**：
  - NapCat → Moltbot：HTTP POST 上报消息到 `/webhook/onebot`
  - Moltbot → NapCat：调用 NapCat HTTP API 发送回复

### 2.2 安装 NapCat

1. 下载 NapCat：[GitHub Releases](https://github.com/NapNeko/NapCatQQ/releases)
2. 解压到**无空格路径**（如 `C:\NapCat`）
3. 运行 `napcat.bat` 或 `napcat.ps1`
4. 扫码登录 QQ 小号

### 2.3 配置 NapCat

访问 NapCat WebUI：`http://127.0.0.1:6099`

#### 2.3.1 HTTP 服务器配置（Moltbot 调用 NapCat）

| 配置项 | 值 |
|--------|-----|
| 启用 | ✓ |
| 主机 | `127.0.0.1` |
| 端口 | `3000` |
| 鉴权 Token | 自定义密码（如 `a7DVg$h>jO2R&HU9`） |

#### 2.3.2 HTTP 上报配置（NapCat 推送消息到 Moltbot）

| 配置项 | 值 |
|--------|-----|
| 启用 | ✓ |
| 上报地址 | `http://127.0.0.1:18789/webhook/onebot` |
| Token | **留空**（重要！） |

### 2.4 Moltbot 配置

编辑 `~/.clawdbot/moltbot.json`：

```json
{
  "channels": {
    "onebot": {
      "enabled": true,
      "httpUrl": "http://127.0.0.1:3000",
      "accessToken": "你在NapCat设置的鉴权Token",
      "dmPolicy": "open",
      "allowFrom": ["*"],
      "groupPolicy": "allowlist",
      "groups": {
        "*": {
          "enabled": true,
          "requireMention": true
        }
      }
    }
  },
  "plugins": {
    "load": {
      "paths": [
        "C:/Users/Administrator/Desktop/moltbot-main/extensions/onebot"
      ]
    },
    "entries": {
      "onebot": {
        "enabled": true
      }
    }
  }
}
```

### 2.5 配置说明

| 字段 | 说明 |
|------|------|
| `httpUrl` | NapCat HTTP 服务器地址 |
| `accessToken` | NapCat 鉴权 Token（与 NapCat 配置一致） |
| `dmPolicy` | 私聊策略：`open`（开放）/ `allowlist`（白名单） |
| `groupPolicy` | 群聊策略：`disabled` / `allowlist` / `open` |
| `groups.*` | 通配符匹配所有群 |
| `requireMention` | 群聊中是否需要 @ 机器人才响应 |

---

## 三、重启 Gateway

配置完成后重启 Moltbot Gateway：

```bash
pnpm moltbot gateway restart
```

或使用 CLI：

```bash
moltbot gateway restart
```

---

## 四、测试验证

### 飞书测试

1. 在飞书中找到你的机器人应用
2. 发送私聊消息
3. 确认收到 AI 回复

### QQ 测试

1. 用另一个 QQ 号给机器人小号发私聊消息
2. 群聊中 @ 机器人发送消息
3. 确认收到 AI 回复

---

## 五、故障排查

### 5.1 查看 Gateway 日志

```bash
# Windows
type %TEMP%\moltbot\moltbot-*.log

# 或查看实时日志
tail -f /tmp/moltbot/moltbot-*.log
```

### 5.2 常见问题

| 问题 | 解决方案 |
|------|----------|
| 飞书 Webhook 验证失败 | 检查 Verification Token 和 Encrypt Key |
| 飞书 `app secret invalid` | 重新获取 App Secret |
| NapCat 401 错误 | 确保 HTTP 上报的 Token 字段**为空** |
| QQ 无响应 | 检查 NapCat 是否在线，HTTP 服务是否启动 |

---

## 六、渠道能力对比

### 6.1 Telegram vs QQ (OneBot) 能力对比

| 功能 | Telegram | QQ (OneBot) | 说明 |
|------|:--------:|:-----------:|------|
| **基础能力** | | | |
| 私聊消息 | ✅ | ✅ | 都支持 |
| 群聊消息 | ✅ | ✅ | 都支持 |
| 频道消息 | ✅ | ❌ | QQ 没有频道概念 |
| 话题/线程 | ✅ | ❌ | QQ 没有话题功能 |
| **媒体能力** | | | |
| 发送图片 | ✅ | ✅ | 都支持 |
| 发送语音 | ✅ | ✅ | 都支持 |
| 发送视频 | ✅ | ✅ | 都支持 |
| 发送文件 | ✅ | ✅ | 都支持 |
| **交互能力** | | | |
| 表情回应 (reactions) | ✅ | ❌ | OneBot v11 不支持 |
| 内联按钮 (inline buttons) | ✅ | ❌ | QQ 协议限制 |
| 投票 (polls) | ✅ | ❌ | QQ 协议限制 |
| 原生命令 | ✅ | ✅ | 都支持 |
| **高级功能** | | | |
| 消息回复引用 | ✅ | ✅ | 都支持 |
| 消息撤回 | ✅ | ✅ | 都支持 |
| 获取联系人目录 | ✅ | ✅ | 都支持 |
| 获取群组列表 | ✅ | ✅ | 都支持 |
| 状态探测 | ✅ | ✅ | 都支持 |
| 流式输出 | ✅ | ✅ | 都支持（block streaming） |
| **Agent 能力** | | | |
| 子 Agent 生成 | ✅ | ✅ | 都支持 |
| 跨 Session 通信 | ✅ | ✅ | 都支持 |
| 后台任务隔离 | ✅ | ✅ | 都支持 |
| 工具调用 (tool use) | ✅ | ✅ | 都支持 |
| 执行命令 (exec) | ✅ | ✅ | 都支持 |
| 网页搜索/抓取 | ✅ | ✅ | 都支持 |

### 6.2 QQ 独有限制

由于 OneBot v11 协议和 QQ 平台的限制，以下功能在 QQ 端不可用：

1. **表情回应 (Reactions)**
   - Telegram 支持对消息添加表情回应
   - QQ 的"回应"功能需要 OneBot v12 或其他扩展协议

2. **内联按钮 (Inline Buttons)**
   - Telegram 支持在消息下方显示可点击按钮
   - QQ 没有原生支持此功能

3. **话题/线程 (Threads)**
   - Telegram 群组支持话题功能
   - QQ 群没有原生话题功能

4. **"正在输入"状态**
   - Telegram 支持机器人发送 typing 状态
   - QQ 机器人无法模拟输入状态

### 6.3 OneBot 插件支持的 API

```typescript
// 消息发送
sendPrivateMsg(userId, message)     // 发送私聊消息
sendGroupMsg(groupId, message)      // 发送群消息
sendImage(params)                   // 发送图片
sendRecord(params)                  // 发送语音

// 信息获取
getLoginInfo()                      // 获取机器人信息
getFriendList()                     // 获取好友列表
getGroupList()                      // 获取群列表
getGroupMemberList(groupId)         // 获取群成员列表
getGroupInfo(groupId)               // 获取群信息
getGroupMemberInfo(groupId, userId) // 获取群成员信息
getMsg(messageId)                   // 获取消息详情

// 消息操作
deleteMsg(messageId)                // 撤回消息

// 状态探测
probeOneBot(config, timeoutMs)      // 检查服务状态
```

### 6.4 群组工具策略配置

可以为不同群组配置不同的工具权限：

```json
{
  "channels": {
    "onebot": {
      "groups": {
        "*": {
          "enabled": true,
          "requireMention": true,
          "tools": {
            "allow": ["*"],
            "deny": ["exec"]
          }
        },
        "123456789": {
          "requireMention": false,
          "tools": {
            "allow": ["read", "write", "web_search"]
          }
        }
      }
    }
  }
}
```

| 字段 | 说明 |
|------|------|
| `*` | 通配符，匹配所有群 |
| `123456789` | 特定群号的配置（覆盖通配符） |
| `requireMention` | 是否需要 @ 机器人才响应 |
| `tools.allow` | 允许的工具列表 |
| `tools.deny` | 禁止的工具列表 |

---

## 七、插件文件结构

### 7.1 飞书插件

```
extensions/feishu/
├── index.ts          # 插件入口，注册 channel 和 webhook 路由
├── package.json      # 插件元数据
├── tsconfig.json
└── src/
    ├── api.ts        # 飞书 API 封装（获取 token、发消息、解密）
    ├── channel.ts    # ChannelPlugin 实现
    ├── runtime.ts    # 运行时状态
    └── types.ts      # 类型定义
```

### 7.2 OneBot 插件

```
extensions/onebot/
├── index.ts          # 插件入口，注册 channel 和 webhook 路由
├── package.json      # 插件元数据（含 moltbot 字段）
├── tsconfig.json
└── src/
    ├── api.ts        # OneBot v11 API 封装（消息、群组、状态等）
    ├── channel.ts    # ChannelPlugin 实现（完整能力配置）
    ├── runtime.ts    # 运行时状态
    └── types.ts      # 类型定义（消息段、事件、配置等）
```

---

## 八、关键代码说明

### 8.1 Webhook 处理流程

```typescript
// 1. 接收 HTTP POST 请求
api.registerHttpRoute({
  path: "/webhook/feishu",  // 或 /webhook/onebot
  handler: async (req, res) => { ... }
});

// 2. 解析消息内容
const message = parseIncomingMessage(body);

// 3. 立即返回 200（避免平台超时）
res.end(JSON.stringify({ code: 0 }));

// 4. 异步处理消息，调用 AI Agent
await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
  ctx: ctxPayload,
  cfg: config,
  dispatcherOptions: {
    deliver: async (payload) => {
      // 发送回复到对应平台
      await sendReply(payload.text);
    }
  }
});
```

### 8.2 插件注册方式

在 `package.json` 中添加 `moltbot` 字段：

```json
{
  "moltbot": {
    "extensions": ["./index.ts"],
    "channel": {
      "id": "onebot",
      "label": "OneBot (QQ)"
    }
  }
}
```

在 `moltbot.json` 中指定插件路径：

```json
{
  "plugins": {
    "load": {
      "paths": ["./extensions/onebot"]
    }
  }
}
```
