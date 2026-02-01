# OmniParser for Moltbot

基于 [Microsoft OmniParser](https://github.com/microsoft/OmniParser) 修改，用于 Moltbot 的屏幕解析和 GUI 元素识别。

## 修改内容

相比原版 OmniParser，本分支添加了：

- **`omniparser_api.py`** - HTTP API 服务器，供 Moltbot 调用
- 针对本地部署优化的配置

## 系统要求

- Python 3.12+
- CUDA GPU（推荐，CPU 也可运行但较慢）
- 磁盘空间：约 5GB（模型权重）

## 安装步骤

### 1. 创建 Python 环境

```bash
cd OmniParser

# 使用 conda
conda create -n "omni" python==3.12
conda activate omni

# 或使用 venv
python -m venv .venv
source .venv/bin/activate  # Linux/macOS
.venv\Scripts\activate     # Windows
```

### 2. 安装依赖

```bash
pip install -r requirements.txt
```

**Windows 用户注意**：如果遇到 `libpaddle: The specified module could not be found` 错误，需要先安装 [Microsoft Visual C++ Redistributable](https://aka.ms/vs/17/release/vc_redist.x64.exe)。

### 3. 下载模型权重

OmniParser 需要两个模型：
- **icon_detect** - UI 元素检测模型（YOLO，约 50MB）
- **icon_caption** - 图标描述模型（Florence-2，约 1.5GB）

#### 方式一：使用 huggingface-cli（推荐）

```bash
# 安装 huggingface CLI（如果没有）
pip install huggingface_hub

# 下载 V2 模型（最新版本，推荐）
huggingface-cli download microsoft/OmniParser-v2.0 --local-dir weights --repo-type model

# 重命名 caption 文件夹（必须）
mv weights/icon_caption weights/icon_caption_florence
```

#### 方式二：分步下载

```bash
# 下载 icon_detect 模型
huggingface-cli download microsoft/OmniParser-v2.0 icon_detect/model.pt --local-dir weights
huggingface-cli download microsoft/OmniParser-v2.0 icon_detect/model.yaml --local-dir weights
huggingface-cli download microsoft/OmniParser-v2.0 icon_detect/train_args.yaml --local-dir weights

# 下载 icon_caption 模型
huggingface-cli download microsoft/OmniParser-v2.0 icon_caption/config.json --local-dir weights
huggingface-cli download microsoft/OmniParser-v2.0 icon_caption/generation_config.json --local-dir weights
huggingface-cli download microsoft/OmniParser-v2.0 icon_caption/model.safetensors --local-dir weights

# 重命名（必须）
mv weights/icon_caption weights/icon_caption_florence
```

#### 方式三：手动下载

1. 访问 https://huggingface.co/microsoft/OmniParser-v2.0
2. 下载 `icon_detect/` 和 `icon_caption/` 文件夹下的所有文件
3. 放到 `weights/` 目录下
4. 将 `icon_caption` 重命名为 `icon_caption_florence`

### 4. 验证安装

```bash
# 检查文件结构
ls -la weights/

# 应该看到：
# weights/
# ├── icon_detect/
# │   ├── model.pt
# │   ├── model.yaml
# │   └── train_args.yaml
# └── icon_caption_florence/
#     ├── config.json
#     ├── generation_config.json
#     └── model.safetensors
```

## 使用方式

### 1. 启动 API 服务器（Moltbot 集成用）

```bash
python omniparser_api.py --host 127.0.0.1 --port 8765
```

**API 端点：**

| 端点 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/parse` | POST | 解析截图 |

**调用示例：**

```bash
# 健康检查
curl http://127.0.0.1:8765/health

# 解析截图（image_base64 为 base64 编码的图片）
curl -X POST http://127.0.0.1:8765/parse \
  -H "Content-Type: application/json" \
  -d '{"image_base64": "<BASE64_IMAGE_DATA>"}'
```

**返回格式：**

```json
{
  "success": true,
  "image_size": {"width": 1920, "height": 1080},
  "element_count": 42,
  "elements": [
    {
      "id": 0,
      "content": {
        "type": "icon",
        "bbox": [0.1, 0.2, 0.3, 0.4],
        "interactivity": true,
        "content": "Settings button",
        "source": "icon_detect"
      }
    }
  ],
  "labeled_image": "<BASE64_LABELED_IMAGE>"
}
```

### 2. Gradio Demo（交互式测试）

```bash
python gradio_demo.py
# 打开 http://127.0.0.1:7861
```

### 3. Jupyter Notebook

参考 `demo.ipynb` 中的示例代码。

### 4. OmniTool（控制 Windows VM）

参考 `omnitool/readme.md` 了解如何配合 Windows 11 虚拟机使用。

## 性能参考

| GPU | 延迟 |
|-----|------|
| A100 | ~0.6s/帧 |
| RTX 4090 | ~0.8s/帧 |
| CPU | ~5-10s/帧 |

## 常见问题

### Q: CUDA out of memory

尝试降低 `BOX_TRESHOLD` 或使用更小的图片尺寸。

### Q: 模型加载失败

确保：
1. 模型文件完整下载
2. `icon_caption` 文件夹已重命名为 `icon_caption_florence`
3. Python 环境正确激活

### Q: PaddleOCR 相关错误

Windows 用户需要安装 [VC++ Redistributable](https://aka.ms/vs/17/release/vc_redist.x64.exe)。

## 原项目信息

OmniParser 是微软开源的屏幕解析工具，用于将 GUI 截图转换为结构化元素。

- **原项目**: https://github.com/microsoft/OmniParser
- **论文**: https://arxiv.org/abs/2408.00203
- **HuggingFace**: https://huggingface.co/microsoft/OmniParser-v2.0
- **在线 Demo**: https://huggingface.co/spaces/microsoft/OmniParser-v2

## 许可证

- `icon_detect` 模型: AGPL 许可证（继承自 YOLO）
- `icon_caption_florence` 模型: MIT 许可证
- 本修改部分: MIT 许可证

## 引用

```bibtex
@misc{lu2024omniparserpurevisionbased,
      title={OmniParser for Pure Vision Based GUI Agent}, 
      author={Yadong Lu and Jianwei Yang and Yelong Shen and Ahmed Awadallah},
      year={2024},
      eprint={2408.00203},
      archivePrefix={arXiv},
      primaryClass={cs.CV},
      url={https://arxiv.org/abs/2408.00203}, 
}
```
