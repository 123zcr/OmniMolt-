# Moltbot 飞书插件

飞书 (Feishu/Lark) 机器人渠道插件。

## 配置步骤

### 1. 创建飞书应用

1. 打开 [飞书开放平台](https://open.feishu.cn/)
2. 创建企业自建应用
3. 记录 **App ID** 和 **App Secret**

### 2. 配置应用权限

在应用的「权限管理」中开启以下权限：
- `im:message` - 获取与发送单聊、群组消息
- `im:message:send_as_bot` - 以应用身份发送消息
- `contact:user.base:readonly` - 获取用户基本信息（可选）

### 3. 配置事件订阅

1. 在「事件订阅」中启用事件
2. 设置请求地址为：`https://你的域名/webhook/feishu`
3. 添加事件：`im.message.receive_v1`（接收消息）
4. 记录 **Verification Token**

### 4. 配置 Moltbot

编辑 `~/.clawdbot/moltbot.json`：

```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "appId": "你的 App ID",
      "appSecret": "你的 App Secret",
      "verificationToken": "你的 Verification Token",
      "webhookPort": 3979,
      "dmPolicy": "open",
      "allowFrom": ["*"]
    }
  }
}
```

### 5. 启动并暴露 Webhook

使用 Cloudflare Tunnel 或其他方式暴露 webhook 端口：

```bash
cloudflared tunnel --url http://localhost:3979
```

将获得的 URL 填入飞书事件订阅的请求地址。

### 6. 发布应用

1. 在飞书开放平台发布应用
2. 管理员审核通过后即可使用

## 配置说明

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `enabled` | 是否启用 | `true` |
| `appId` | 飞书应用 App ID | 必填 |
| `appSecret` | 飞书应用 App Secret | 必填 |
| `verificationToken` | 事件订阅验证 Token | 可选 |
| `encryptKey` | 消息加密密钥 | 可选 |
| `webhookPort` | Webhook 监听端口 | `3979` |
| `dmPolicy` | 私聊策略 | `pairing` |
| `allowFrom` | 允许的用户列表 | `[]` |
| `groupPolicy` | 群组策略 | `allowlist` |
| `groupAllowFrom` | 允许的群组列表 | `[]` |

## 使用

配置完成后，在飞书中：
- 私聊机器人直接发送消息
- 在群组中 @机器人 发送消息

## 故障排除

### Webhook 验证失败

确保：
1. Cloudflare Tunnel 正在运行
2. Gateway 正在运行且 Feishu 插件已加载
3. 飞书填入的 URL 正确（包含 `/webhook/feishu` 路径）

### 消息无响应

检查：
1. 应用权限是否开启
2. 事件订阅是否配置正确
3. 查看 Gateway 日志确认是否收到消息
