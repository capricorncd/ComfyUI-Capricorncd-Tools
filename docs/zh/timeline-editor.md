# Timeline Editor（时间轴编辑器）

**分类：** `Capricorncd`

全屏多轨时间轴编辑器，支持图像 / 视频 / 音频工程。与 [Audio Timeline](audio-timeline.md)（单音频 + 连续关键帧片段）不同，Timeline Editor 保存**按轨道嵌套的 `project_json`**，并输出精简的运行时 `data_json`（每个视觉片段带 `audios[]` 切片）。

从节点启动器打开全屏编辑器；编辑内容会写回节点的 `project_json` 控件。

---

## 与 Audio Timeline 的对比

| | Audio Timeline | Timeline Editor |
|--|----------------|-----------------|
| 布局 | 波形 + 单条素材轨 | 多轨视觉轨 + 音频轨 |
| 可编辑文档 | 控件值 + 片段列表 | 按轨道嵌套的 `project_json` |
| 运行时音频 | 从单一 `audio_path` 裁剪 | 将重叠切片混入每个 clip 的 `audios[]` |
| 遮挡 | 片段首尾相接（无叠层） | 上层轨道可遮挡下层（`ignore_occluded`） |

下游 [Data Json Clip Parser](data-json-clip-parser.md) 同时支持两种格式。

---

## 编辑器界面

### 素材库（左侧）

- 标签：**图像** / **视频** / **音频**
- 列出 `assets_dir`（及适用的 ComfyUI input）中的文件
- 刷新可重新扫描目录
- 拖到时间轴，或右键 / 在播放头位置插入
- 素材星级与星级筛选
- 双击 / 预览弹窗查看素材

### 时间轴（中间）

- 多条视觉轨与音频轨；工具栏菜单可添加轨道
- 单轨：锁定、可见性、静音（音频）
- 拖动 / 缩放片段；`Ctrl+点击` 多选
- 可在播放头插入 Package / 素材
- 工具栏 **还原 / 重做**（编辑器内历史）
- 缩放：`Ctrl+滚轮`；平移：`Alt+滚轮`

### 检视面板（右侧）

- 选中片段缩略图（适用时含首 / 尾帧）
- **强制渲染** — 被上层遮挡时仍参与生成
- 每片段 **Keyframe Prompt** 与 **Use Global**
- 快捷键提示

### 项目栏

- 可编辑项目名称
- **导入** / **导出** 项目 JSON
- 关闭后返回 ComfyUI 画布

---

## 片段禁用 / 启用

与 Audio Timeline 相同：只重跑某一段，不必重建整条时间轴。

| 快捷键 | 操作 |
|--------|------|
| `Ctrl+B` | 禁用 / 启用选中片段 |
| `Ctrl+G` | 禁用其他所有片段（切换） |

禁用 / 隐藏 / 静音的片段不会进入运行时 `data_json`。禁用或不可见的轨道整轨跳过。

---

## 遮挡（`ignore_occluded`）

开启 **忽略遮挡**（默认）时，被更高 `z_index` 轨道盖住的视觉片段会被裁切或丢弃，只保留可见时间段作为运行时 clip；若该片段勾选了 **强制渲染**，则仍完整参与。

关闭时，每个启用的视觉片段都会完整输出（允许时间重叠）。

---

## 键盘快捷键

| 按键 | 操作 |
|------|------|
| `Ctrl+点击` | 多选片段 |
| `Delete` / `Backspace` | 删除选中（需确认） |
| `Ctrl+B` | 禁用 / 启用选中片段 |
| `Ctrl+G` | 禁用 / 启用其他片段 |
| `Ctrl+滚轮` | 缩放时间轴 |
| `Alt+滚轮` | 左右滚动时间轴 |

---

## 输入参数

| 名称 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `fps` | FLOAT | 24.0 | 帧率 |
| `width` | INT | 1280 | 输出宽度（写入 `data_json`） |
| `height` | INT | 720 | 输出高度（写入 `data_json`） |
| `assets_dir` | STRING | — | 解析相对 `source.file` 路径的素材根目录 |
| `global_prompt` | STRING | — | 片段使用全局提示词时的默认内容 |
| `ignore_occluded` | BOOLEAN | true | 折叠被遮挡的时间范围（见上文） |
| `project_version` | STRING | 包版本 | 写入项目 / 运行时 JSON |
| `project_json` | STRING | 空项目 | 完整可编辑时间轴文档（轨道、片段、资源、设置） |
| `trim_offset` | INT | 1 | 预留给音频尾部流程；`data_json` 中的运行时时间不会因此延长 |

## 输出参数

| 名称 | 类型 | 说明 |
|------|------|------|
| `fps` | FLOAT | 帧率 |
| `width` | INT | 视频宽度 |
| `height` | INT | 视频高度 |
| `global_prompt` | STRING | 有效的全局提示词 |
| `data_json` | STRING | 仅含启用且可见片段的运行时 JSON（见下文） |
| `clips_length` | INT | 运行时片段数量 |
| `total_frame_count` | INT | 按 `fps` 汇总的总帧数 |
| `clips_audio` | AUDIO | 整条时间轴上未静音音频（及带音视频）的混音 |
| `frame_seq_dir` | STRING | 序列帧临时目录（`output/temp/capricorncd-frame-sequences`），首次运行创建，之后每次运行前清空 |

---

## `project_json`（可编辑）

大致结构：

```json
{
  "project_version": "x.y.z",
  "schema_version": "x.y.z",
  "name": "未命名项目",
  "resources": [],
  "settings": {
    "global_prompt": "",
    "ignore_occluded": true
  },
  "tracks": [
    {
      "id": "track_1",
      "type": "visual",
      "order": 0,
      "enabled": true,
      "visible": true,
      "clips": []
    }
  ]
}
```

通常由全屏编辑器维护，无需手改。

---

## `data_json` 数据结构（运行时）

```json
{
  "project_version": "x.y.z",
  "schema_version": "x.y.z",
  "fps": 24.0,
  "width": 1280,
  "height": 720,
  "global_prompt": "cinematic",
  "total_frame_count": 120,
  "clips": [
    {
      "id": "runtime_0001",
      "source_clip_id": "clip_abc",
      "clip_type": "image",
      "start_ms": 0,
      "end_ms": 5000,
      "start_image": "/absolute/path/to/start.jpg",
      "end_image": "/absolute/path/to/end.jpg",
      "prompt": "close up",
      "use_global_prompt": true,
      "z_index": 1,
      "audios": [
        {
          "source_clip_id": "audio_1",
          "source_kind": "audio",
          "file": "/absolute/path/to/voice.wav",
          "location": "assets",
          "source_start_ms": 1000,
          "source_end_ms": 6000,
          "clip_offset_ms": 0
        }
      ]
    }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `start_ms` / `end_ms` | 遮挡处理后的可见运行时区间（毫秒） |
| `start_image` / `end_image` | 经 `assets_dir` 解析后的绝对路径 |
| `audios[]` | 与该视觉区间重叠的音/视频切片；由 [Data Json Clip Parser](data-json-clip-parser.md) 混音 |
| `z_index` | 构建片段时使用的轨道叠放顺序 |

没有顶层 `audio_path`（该字段仅属于 Audio Timeline）。

---

## 典型工作流

```
Timeline Editor
  ├── data_json      ──► Data Json Clip Parser（循环逐片段）
  ├── clips_length   ──► 循环上限
  ├── clips_audio    ──► 可选音频处理 / Seq To Video
  └── frame_seq_dir  ──► Save Images 的序列帧输出目录
```

完整生成 → Seq To Video 流程见 [中文 README](../README.zh.md#典型工作流)。
