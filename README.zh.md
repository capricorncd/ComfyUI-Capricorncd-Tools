# ComfyUI-Capricorncd-Tools

![ComfyUI-Capricorncd-Tools](./docs/ComfyUI-Capricorncd-Tools.png)

一套面向 [ComfyUI](https://github.com/comfyanonymous/ComfyUI) 的自定义节点集合，专注于提示词编辑、音频/图像关键帧时间轴编辑、图像批处理、目录清理与视频合成。

![Audio Timeline/ComfyUI-Capricorncd-Tools](docs/audio-timeline-00.jpg)

---

## 节点一览

| 节点 | 说明 | 文档 |
|------|------|------|
| **Rich Prompt Input** | 带实时语法高亮、`#` 注释与历史/预设的提示词编辑器 | [→](docs/zh/prompt-input.md) |
| **Audio Timeline** | 波形修剪 + 图像关键帧时间轴 + 每片段提示词 | [→](docs/zh/audio-timeline.md) |
| **Timeline Editor** | 全屏多轨时间轴编辑器；输出 `data_json` 与 `frame_seq_dir` | [→](docs/zh/timeline-editor.md) |
| **Data Json Clip Parser** | 从 Audio Timeline / Timeline Editor 的 `data_json` 中提取单个片段 | [→](docs/zh/data-json-clip-parser.md) |
| **Save Images** | 将一批图像保存到指定目录，返回目录路径和文件路径列表 | [→](docs/zh/save-images.md) |
| **Load Images From Dir** | 从目录加载图像为 `IMAGE` 批次 | [→](docs/zh/load-images-from-dir.md) |
| **Image Batch Count** | 返回批次中的图像数量 | [→](docs/zh/image-batch.md) |
| **Image From Batch Index** | 按索引从批次中提取单张图像 | [→](docs/zh/image-batch.md) |
| **Seq To Video** | 通过 ffmpeg 将图像序列和音频合成为 MP4 | [→](docs/zh/seq-to-video.md) |
| **Clear Directory** | 删除目录中选定类型的媒体文件；Windows 支持回收站 | [→](docs/zh/clear-directory.md) |
| **Size Settings** | 宽高比 / 分辨率 / 方向 → `width`、`height`、`count` | [→](docs/zh/size-settings.md) |
| **Format JSON** | 在画布上格式化显示 JSON 字符串 | [→](docs/zh/format-json.md) |

---

## 典型工作流

```
Timeline Editor / Audio Timeline
  ├── trimmed_audio / clips_audio ──► （音频处理）
  ├── frame_seq_dir               ──► Save Images（序列帧输出目录）
  ├── data_json                   ──► Data Json Clip Parser（循环逐片段处理）
  │                                     ├── audio、frame_count、first_frame、last_frame、prompt
  │                                     └── ──► 生成节点 ──► Save Images
  │                                               ├── image_paths ──► Seq To Video
  │                                               └── image_dir   ──► Clear Directory（清理）
  └── clips_length                ──► 循环上限
```

**禁用 / 启用** 可只重跑某一段而不改动其余时间轴。详见 [Audio Timeline](docs/zh/audio-timeline.md#片段禁用--启用) 与 [Timeline Editor](docs/zh/timeline-editor.md#片段禁用--启用)。

---

## 安装

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/capricorncd/ComfyUI-Capricorncd-Tools
```

重启 ComfyUI。除标准 ComfyUI 安装外，无需额外 Python 依赖。

> **Seq To Video** 额外需要安装 [ffmpeg](https://ffmpeg.org/download.html) 并将其加入系统 `PATH`。

---

## 文档

教程与 UI 说明写在 `docs/zh/`。带 `<!-- AUTO:API -->` 标记的输入/输出表可由节点元数据重新生成：

```bash
python scripts/gen_node_docs.py
```

节点接口字段定义在代码中（`DESCRIPTION`、输入 `tooltip`、`OUTPUT_TOOLTIPS`），便于画布提示与文档保持一致。

---

## 国际化（i18n）

节点显示名称和输入/输出标签通过 ComfyUI 内置 i18n 系统本地化，语言文件位于 `locales/`：

```
locales/
├── en/nodeDefs.json
└── zh/nodeDefs.json
```

| 语言 | 代码 |
|------|------|
| English | `en` |
| 简体中文 | `zh` |

---

## 许可证

MIT
