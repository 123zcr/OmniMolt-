# OmniParser 模型权重

此目录存放 OmniParser 所需的模型文件。

## 下载模型

### 快速下载（推荐）

```bash
# 在 OmniParser 目录下执行
cd OmniParser

# 下载所有 V2 模型
huggingface-cli download microsoft/OmniParser-v2.0 --local-dir weights --repo-type model

# 重命名（必须！）
mv weights/icon_caption weights/icon_caption_florence
```

### 手动下载

访问 https://huggingface.co/microsoft/OmniParser-v2.0/tree/main 下载文件。

## 目录结构

下载完成后，目录结构应为：

```
weights/
├── icon_detect/
│   ├── model.pt          (~50MB)  - YOLO 检测模型
│   ├── model.yaml                 - 模型配置
│   └── train_args.yaml            - 训练参数
├── icon_caption_florence/         - ⚠️ 必须是这个名字！
│   ├── config.json
│   ├── generation_config.json
│   └── model.safetensors (~1.5GB) - Florence-2 模型
└── README.md
```

## 模型说明

| 模型 | 用途 | 大小 | 许可证 |
|------|------|------|--------|
| icon_detect | 检测 UI 可交互区域 | ~50MB | AGPL (YOLO) |
| icon_caption_florence | 生成图标功能描述 | ~1.5GB | MIT |

## 注意事项

1. **必须重命名**：`icon_caption` → `icon_caption_florence`
2. 模型文件较大，请确保网络稳定
3. 如果使用代理，设置 `HF_ENDPOINT` 环境变量

## 验证下载

```python
import os

weights_dir = "weights"
required_files = [
    "icon_detect/model.pt",
    "icon_caption_florence/model.safetensors",
]

for f in required_files:
    path = os.path.join(weights_dir, f)
    if os.path.exists(path):
        size_mb = os.path.getsize(path) / (1024 * 1024)
        print(f"✓ {f} ({size_mb:.1f} MB)")
    else:
        print(f"✗ {f} - 缺失！")
```

## 更多信息

- HuggingFace: https://huggingface.co/microsoft/OmniParser-v2.0
- 论文: https://arxiv.org/abs/2408.00203
