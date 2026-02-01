# Moltbot（修改版）

基于 [Moltbot](https://github.com/moltbot/moltbot) 的个人 AI 助手，添加了额外功能和集成。

## 特色功能

相比原版 Moltbot，本版本添加/修改了：

- **OmniParser 集成** - 屏幕解析和 GUI 元素识别（基于微软 OmniParser V2）
- **OneBot 协议支持** - 连接 QQ 机器人（通过 OneBot 11 协议）
- **中文优化** - 部分文档和配置支持中文

## 系统要求

- **Node.js**: 22+
- **Python**: 3.12+（OmniParser 需要）
- **GPU**: CUDA 支持（OmniParser 推荐，CPU 也可运行）

## 快速开始

### 1. 安装依赖

```bash
# 克隆项目
git clone https://github.com/123zcr/OmniMolt-.git
cd OmniMolt-

# 安装 Node 依赖
pnpm install

# 构建
pnpm build
```

### 2. 配置

复制配置模板并编辑：

```bash
cp .env.example .env
# 编辑 .env 填入你的 API 密钥
```

配置文件位置：`~/.clawdbot/moltbot.json`

```json5
{
  "agent": {
    "model": "anthropic/claude-opus-4-5"
  },
  "channels": {
    "telegram": {
      "botToken": "YOUR_BOT_TOKEN"
    }
  }
}
```

### 3. 启动

```bash
# 启动 Gateway
pnpm moltbot gateway --port 18789 --verbose

# 或使用 onboard 向导
pnpm moltbot onboard --install-daemon
```

## 项目结构

```
moltbot/
├── src/                    # 核心源码
├── extensions/             # 扩展插件
│   ├── onebot/            # QQ 机器人（OneBot 协议）
│   ├── telegram/          # Telegram
│   ├── discord/           # Discord
│   └── ...
├── OmniParser/            # 屏幕解析（需单独下载模型）
├── apps/                  # 客户端应用
│   ├── macos/            # macOS 菜单栏应用
│   ├── ios/              # iOS 应用
│   └── android/          # Android 应用
├── docs/                  # 文档
└── ui/                    # Web UI
```

## OmniParser 配置

OmniParser 需要单独下载模型权重（约 2GB）：

```bash
cd OmniParser

# 创建 Python 环境
conda create -n "omni" python==3.12
conda activate omni
pip install -r requirements.txt

# 下载模型
huggingface-cli download microsoft/OmniParser-v2.0 --local-dir weights
mv weights/icon_caption weights/icon_caption_florence

# 启动 API 服务
python omniparser_api.py --port 8765
```

详见 [OmniParser/README.md](OmniParser/README.md)

## 支持的消息渠道

| 渠道 | 状态 | 说明 |
|------|------|------|
| Telegram | ✅ | 官方支持 |
| Discord | ✅ | 官方支持 |
| WhatsApp | ✅ | 通过 Baileys |
| Slack | ✅ | 通过 Bolt |
| OneBot/QQ | ✅ | 扩展插件 |
| 微信 | ❌ | 暂不支持 |
| Signal | ✅ | 需要 signal-cli |
| iMessage | ✅ | 仅 macOS |
| Matrix | ✅ | 扩展插件 |
| WebChat | ✅ | 内置 Web 界面 |

## 开发

```bash
# 安装依赖
pnpm install

# 开发模式（自动重载）
pnpm gateway:watch

# 构建
pnpm build

# 测试
pnpm test

# 代码检查
pnpm lint
```

## 常见问题

### Q: Telegram 网络错误

如果看到 `Network request for 'getUpdates' failed` 错误，可能是网络问题。在某些地区需要配置代理才能访问 Telegram API。

### Q: OmniParser 模型加载失败

确保：
1. 模型权重已完整下载
2. `icon_caption` 文件夹已重命名为 `icon_caption_florence`
3. Python 环境正确激活

### Q: OneBot 连接失败

检查：
1. QQ 机器人框架（如 go-cqhttp）是否正常运行
2. OneBot WebSocket 端口是否正确
3. 防火墙是否允许连接

## 相关链接

- **原版 Moltbot**: https://github.com/moltbot/moltbot
- **原版文档**: https://docs.molt.bot
- **OmniParser**: https://github.com/microsoft/OmniParser

## 许可证

MIT License - 详见 [LICENSE](LICENSE)

---

基于 [Moltbot](https://github.com/moltbot/moltbot) by Peter Steinberger 和社区贡献者。
