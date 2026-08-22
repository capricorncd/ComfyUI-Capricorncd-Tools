# MiniMaxH3

**分类：** `Capricorncd`

从 Timeline Editor / Audio Timeline 的 `data_json` 中取单个片段，直接调用 ComfyUI 内置的 **MiniMax H3 Reference to Video**。片段媒体映射为 H3 参考槽；帧数与提示词来自该片段。

通用「先解析再接任意生成节点」仍用 [Data Json Clip Parser](data-json-clip-parser.md)；本节点是面向 H3 的一体化路径。

---

## 工作原理

1. 解析 `data_json`，按 `index` 取片段  
2. 收集视觉参考（`images`，或回退到 `start_image` / `end_image`）与 `audios[]`  
3. 映射到 H3 参考（见下表上限），并组装提示词  
4. 用 CLIP、VAE、Audio VAE、`width` / `height` 与对齐后的帧数调用 `MiniMaxH3ReferenceToVideo`  
5. 同时输出堆叠后的静帧、视频帧与混合音频，便于检查或下游使用  

| 类型 | H3 槽位 | 上限 | 说明 |
|------|---------|------|------|
| 图片 | `ref_image_1…` | 9 | 静帧参考 |
| 视频 | `ref_video_1…`（音轨 → `ref_video_audio_n`） | 3 | 重采样到 24 fps，最长 15 秒，不足 5 帧会垫齐 |
| 音频 | `ref_audio_1…` | 3 | 来自片段 `audios[]`；末端可能略延长以对齐 H3 帧数 |

---

## 提示词

| 优先级 | 来源 |
|--------|------|
| 1 | 片段启用 AI 提示词时使用 AI 提示词 |
| 2 | 否则：启用的媒体提示词行（`<Picture n>` / `<Video n>` / `<Audio n>`），再接全局提示词（若 Use Global），再接片段关键帧提示词 |

---

## 输入参数

| 名称 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `clip` | CLIP | — | H3 文本编码器 |
| `vae` | VAE | — | 图像 / 视频 VAE |
| `audio_vae` | VAE | — | 音频 VAE |
| `width` | INT | 1344 | 生成宽度 |
| `height` | INT | 768 | 生成高度 |
| `ref_image_size` | `match` / `max` | `match` | `match` 按生成像素面积缩放参考图；`max` 短边 2048 |
| `data_json` | STRING | — | Timeline Editor / Audio Timeline 运行时 JSON |
| `index` | INT | 0 | 从 0 开始的片段索引 |

## 输出参数

| 名称 | 类型 | 说明 |
|------|------|------|
| `positive` | CONDITIONING | H3 正向 conditioning |
| `latent` | LATENT | 供采样的 H3 latent |
| `total_frame_count` | INT | 该片段对齐后的总帧数 |
| `prompt` | STRING | 实际送入 H3 的提示词 |
| `images` | IMAGE | 堆叠静帧参考（letterbox）；无则为 64×64 空白 |
| `videos` | IMAGE | 堆叠视频参考帧（letterbox）；无则为空白 |
| `audio` | AUDIO | 片段混合音频（主轨裁剪或 `audios[]`） |

将 `positive` / `latent` 接到与官方 Reference to Video 相同的 MiniMax H3 采样 / 解码链路即可。

---

## 典型工作流

```
Timeline Editor
  └── data_json      ──► MiniMaxH3（index = 循环计数）
  └── clips_length   ──► 循环上限
  └── width / height ──► MiniMaxH3
                             ├── positive、latent ──► H3 采样 / 解码 ──► 保存 / Seq To Video
                             └── prompt、images、videos、audio ──► 可选检查 / 旁路
```

`data_json` 已排除禁用 / 隐藏片段，选择性重跑仍沿用时间轴的禁用 / 启用流程。
