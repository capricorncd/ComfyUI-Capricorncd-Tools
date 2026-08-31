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

下游 [Data Json Clip Parser](data-json-clip-parser.md) 同时支持两种格式。

---

## 编辑器界面

### 素材库（左侧）

- 标签：**图像** / **视频** / **音频**
- 列出已上传到 ComfyUI `input/capricorncd-timeline/` 的文件
- 刷新可重新扫描上传目录
- 拖到时间轴，或右键插入；右键也可 **替换素材**（选文件 → 预览 → 确认替换，时间轴引用同步更新）
- 素材星级与星级筛选
- 点击预览弹窗查看素材
- 通过「添加素材」上传图片 / 视频 / 音频（写入 `input`，不依赖资源目录）

### 预览 / 时间轴（中间）

- **节目预览**：时间轴上方监视器，按节点 `width` × `height` 比例显示当前播放头画面（主轨 + 副轨叠层；图片 cover；有尾帧时在片段中间最多 1s 交叉过渡；视频按裁剪入点取样）；底部分隔条可拖动调整高度
- 多条视觉轨与音频轨；工具栏菜单可添加轨道
- 单轨：锁定、可见性、静音（音频）
- 拖动 / 缩放片段；`Ctrl+点击` 多选
- 音频轨片段：拖动首尾小手柄设置线性**渐入 / 渐出**（斜线区域）；写入 `fade_in_ms` / `fade_out_ms`，预览播放、`clips_audio` 混音与「合成视频」均会应用
- 可在播放头插入 Package / 素材
- 工具栏 **生成预览 / 素材预览**（在「插入 Clip」旁）：一键切换所有已绑定生成视频的 Clip 为生成视频预览或素材预览
- 工具栏 **还原 / 重做**（编辑器内历史）
- 缩放：`Ctrl+滚轮`；平移：`Alt+滚轮`

### 检视面板（右侧）

- 选中片段缩略图（适用时含首 / 尾帧）
- 每片段 **Keyframe Prompt** 与 **Use Global**
- **生成视频**列表（有绑定时）：启用、禁音（图标与轨道禁音相同）、打开预览、删除（需确认）
- 快捷键提示

### 项目栏

- 可编辑项目名称
- **导入** / **导出**：
  - 目录包与 ZIP（含全部素材 + Clip 关联的生成视频写入 `media/generated/` + `project.json`）
  - **合成视频**：弹窗设置 `filename_prefix`（默认 `cap_timeline_compose/`）、文件名 `项目名称_yyyyMMdd_hhmmss.mp4`，以及 **忽略音频轨道**（默认关）。开启后不合并音频轨上的 clip；未禁音的生成视频音轨仍会混入。ffmpeg 写入 ComfyUI `output/`。需要本机 **ffmpeg**。
- 标题栏显示 `时间轴编辑器 | 项目名称`；点击项目名称可聚焦右侧栏名称输入（并取消 clip 选中）。节点宽高与帧率显示在右侧（标题栏右侧 + 项目面板）。
- 全局提示词仅在编辑器右侧栏维护，节点上不再提供该控件。
- 关闭后返回 ComfyUI 画布

### Clip 右键菜单（视觉轨）

- 运行、AI 优化提示词、禁用 / 禁用其他、设置标题、查看素材、添加生成的视频
- 处于**生成视频预览**模式时：对当前生成视频提供 **禁音 / 解除禁音**
- 复制 / 粘贴；**删除**为红色

### AI 优化提示词

- 弹窗：模型、输出语言、Agent 提示词、Prompt Skill、结果
- 已移除：背景音频、生成 BGM、歌词

---

## 生成视频

可为视觉 clip 绑定 ComfyUI `output/` 下的 MP4（右键 **添加生成的视频**，或运行后自动附加）。

| 控件 | 行为 |
|------|------|
| 启用 | 参与预览 / 合成选用 |
| 禁音 | 时间轴播放与合成视频时不使用该文件音轨（默认关闭 = 播放声音） |
| clip 上预览徽章 | 在素材预览与生成视频预览间切换 |
| 删除 | 确认后仅解除 clip 绑定（不删磁盘文件） |

合成视频取每个 clip 第一个**启用**的生成视频，按 clip 的 `start_ms`～`end_ms` 落位（取文件前 `duration` 秒）。

---

## 片段禁用 / 启用

与 Audio Timeline 相同：只重跑某一段，不必重建整条时间轴。

| 快捷键 | 操作 |
|--------|------|
| `Ctrl+B` | 禁用 / 启用选中片段 |
| `Ctrl+G` | 禁用其他所有片段（切换） |

禁用 / 隐藏 / 静音的片段不会进入运行时 `data_json`。禁用或不可见的轨道整轨跳过。

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
| `width` | INT | 1344 | 输出宽度（写入 `data_json`） |
| `height` | INT | 768 | 输出高度（写入 `data_json`） |
| `swap_wh` | BOOLEAN | false | 切换时交换当前 width / height（如 1280×720 → 720×1280） |
| `project_version` | STRING | 包版本 | 写入项目 / 运行时 JSON |
| `project_json` | STRING | 空项目 | 完整可编辑时间轴文档（轨道、片段、资源、设置） |
| `trim_offset` | INT | 1 | 预留给音频尾部流程；`data_json` 中的运行时时间不会因此延长 |

## 输出参数

| 名称 | 类型 | 说明 |
|------|------|------|
| `fps` | FLOAT | 帧率 |
| `width` | INT | 视频宽度 |
| `height` | INT | 视频高度 |
| `global_prompt` | STRING | 编辑器内全局提示词（`project_json.settings.global_prompt`） |
| `data_json` | STRING | 仅含启用且可见片段的运行时 JSON（见下文） |
| `clips_length` | INT | 运行时片段数量 |
| `total_frame_count` | INT | 按 `fps` 汇总的总帧数 |
| `clips_audio` | AUDIO | 整条时间轴上未静音音频（及带音视频）的混音 |
| `frame_seq_dir` | STRING | 序列帧临时目录（`output/temp/capricorncd-frame-sequences`），首次运行创建，之后每次运行前清空 |

---

## `project_json`（可编辑）

编辑器保存到节点控件的**完整工程文档**。当前文档形状为 **`schema_version: 2`**（整数，与 Python 包版本 `project_version` 无关）。加载时若遇到旧版（schema 1 或顶层 `resources`），会自动迁移到 schema 2。

通常由全屏编辑器读写，一般无需手改；下表与示例对应编辑器 `_buildProject()` 的写出格式。

### 顶层

| 字段 | 类型 | 说明 |
|------|------|------|
| `project_version` | string | 包版本字符串（如 `"0.x.y"`），写入时刷新 |
| `schema_version` | int | 文档形状版本，现为 `2` |
| `name` | string | 项目名称 |
| `media` | array | 素材目录（schema 2）；clip 用 `media_ids` 引用其中的 `id` |
| `settings` | object | 工程设置（含全局提示词、水印、时间轴视图状态等） |
| `tracks` | array | 轨道列表（按 `order` 排列） |

旧字段 `resources` 仅作迁移输入，写出时不再保留。

### `media[]`（素材目录）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 素材 ID（如 `md_…`）；clip 的 `media_ids` 指向它 |
| `kind` | string | `image` / `video` / `audio` |
| `file` | string | 相对 ComfyUI `input/` 的路径（多为 `capricorncd-timeline/…`） |
| `location` | string | 通常为 `"input"` |
| `name` | string | 显示名 |
| `prompt` | string | 素材级提示词 |
| `media_type` | string | 资产类型标签（如 character / scene / prop / other，可空） |
| `tags` | string[] | 标签 |
| `stars` | int? | 1–5；未评分时省略 |

### `settings`

| 字段 | 类型 | 说明 |
|------|------|------|
| `fps` / `width` / `height` | number | 与节点标量同步的缓存副本 |
| `global_prompt` | string | 全局提示词 |
| `timeline_zoom` | number | 时间轴缩放 |
| `current_time` | number | 播放头时间（秒） |
| `timeline_scroll_left` / `timeline_scroll_top` | number | 时间轴滚动位置 |
| `watermark` | object | 合成视频水印（见下） |
| `use_clip_specified_video_filename` | bool | 默认 `true`。开启时运行写入 `output_video` 并按该路径关联生成视频；关闭走旧的自动识别 |
| `runtime_only_clip_ids` | string[]? | 仅单 clip「运行」时临时写入；正常保存通常无无 |
| `gen_video_stamp` | string? | 仅「运行」排队时临时写入（`yyyyMMdd-HHmmss`），供 `output_video` 与前端期望路径对齐 |

#### `settings.watermark`

| 字段 | 说明 |
|------|------|
| `mode` | 派生值：`none` / `text` / `image`（有未禁用图片时优先 image） |
| `text.content` | 水印文字 |
| `text.fontFamily` / `text.fontPath` | 字体名 / 本机字体路径 |
| `text.fontSize` | 字号（约 6–400） |
| `text.letterSpacing` | 字间距（约 -50–200，默认 0） |
| `text.color` | `#RRGGBB` |
| `image.file` | 水印图片路径；空表示无 |
| `image.disabled` | `true` 时忽略图片，回退到文字 |
| `opacity` | 0–100 |
| `scale` | 10–300（百分比） |
| `position` | `top-left` / `top-center` / `top-right` / `bottom-left` / `bottom-center` / `bottom-right` / `center` / `random-interval` / `random-fixed` |
| `margin` | `{ top, right, bottom, left, locked }` 边距（像素）；`locked` 为四边联动 |

### `tracks[]`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 轨道 ID |
| `type` | string | `visual` / `audio` / `subtitle` |
| `role` | string | `main` / `overlay` / `audio` / `subtitle` 等 |
| `name` | string | 显示名 |
| `order` | int | 自上而下顺序（0 起） |
| `enabled` | bool | 禁用则不进运行时 `data_json` |
| `visible` | bool | 不可见则跳过 |
| `muted` | bool | 音频轨 / 带音视频相关 |
| `locked` | bool | 锁定 |
| `color` | string | 轨道颜色 |
| `clips` | array | 片段列表 |

**字幕轨**（`type: "subtitle"`）仅用于节目预览叠字；节点执行时整轨跳过，不进入 `data_json`。

### `tracks[].clips[]`

时间一律用毫秒，且按工程 `fps` 对齐到帧网格：`start_ms` / `duration_ms`。

#### 视觉 clip（`type: "clip"`）

| 字段 | 说明 |
|------|------|
| `id` | clip ID |
| `enabled` / `visible` | 启用 / 可见 |
| `start_ms` / `duration_ms` | 时间轴区间 |
| `media_ids` | 有序引用 `media[].id`（多参考图 / 首尾帧 / 视频等） |
| `source` | 可选；视频等含 `in_ms` / `out_ms` / `duration_ms`（源内裁剪） |
| `name` | 标题 |
| `prompt` / `ai_prompt` | 关键帧提示词 / AI 优化结果 |
| `use_global_prompt` / `use_ai_prompt` | 是否拼全局提示词 / 是否用 AI 结果 |
| `use_media_prompts` | 与 `media_ids` 等长的 bool[]：是否用对应素材 prompt |
| `media_enabled` | 与 `media_ids` 等长的 bool[]：该槽位是否启用 |
| `head_extend_sec` / `tail_extend_sec` | 首 / 尾扩展秒数 |
| `generate_preview_video` / `second_sample` | 生成相关开关 |
| `clip_role` | `multi_ref` / `first_last` / `t2v` / `video_ref` / `video_edit` / `other` |
| `clip_role_custom` | `clip_role === "other"` 时的自定义文案 |
| `agent` | `MiniMaxH3` / `LTX` / `Bernini` / `Wan` / `other` |
| `agent_custom` | `agent === "other"` 时的自定义名 |
| `generated_videos` | 可选；绑定的生成 MP4：`{ id, file, enabled, muted, note }`（`file` 相对 `output/`） |
| `preview_mode` | 可选；`"generated"` 表示默认看生成视频预览 |
| `has_audio` / `muted` | 视频素材带音时可选 |

#### 音频 clip（`type: "audio"`）

| 字段 | 说明 |
|------|------|
| `media_ids` | 通常一个音频素材 ID |
| `source` | `in_ms` / `out_ms` / `duration_ms` |
| `muted` | 是否静音 |
| `fade_in_ms` / `fade_out_ms` | 可选；大于 0 时写出 |

#### 字幕 clip（`type: "subtitle"`）

| 字段 | 说明 |
|------|------|
| `text` | 字幕正文 |
| `font_family` / `font_path` | 字体 |
| `font_size` | 字号 |
| `letter_spacing` | 字间距（默认 0） |
| `color` | `#RRGGBB` |
| `bold` / `italic` | 粗体 / 斜体 |
| `opacity` | 0–1 |
| `stroke_enabled` / `stroke_color` / `stroke_width` | 描边 |
| `shadow_enabled` / `shadow_color` / `shadow_blur` / `shadow_offset_x` / `shadow_offset_y` | 阴影 |
| `align` | `left` / `center` / `right` |
| `v_align` | `top` / `middle` / `bottom` |
| `offset_x` / `offset_y` | 相对画布的百分比偏移 |

### 示例（schema 2，字段示意）

```json
{
  "project_version": "0.x.y",
  "schema_version": 2,
  "name": "未命名项目",
  "media": [
    {
      "id": "md_abc123",
      "kind": "image",
      "file": "capricorncd-timeline/shot01.png",
      "location": "input",
      "name": "shot01.png",
      "prompt": "",
      "media_type": "character",
      "tags": [],
      "stars": 3
    }
  ],
  "settings": {
    "fps": 24,
    "width": 1344,
    "height": 768,
    "global_prompt": "cinematic lighting",
    "timeline_zoom": 1.2,
    "current_time": 0,
    "timeline_scroll_left": 0,
    "timeline_scroll_top": 0,
    "watermark": {
      "mode": "text",
      "text": {
        "content": "Cap",
        "fontFamily": "Microsoft YaHei",
        "fontPath": "C:/Windows/Fonts/msyh.ttc",
        "fontSize": 32,
        "letterSpacing": 2,
        "color": "#ffffff"
      },
      "image": { "file": "", "disabled": false },
      "opacity": 80,
      "scale": 100,
      "position": "bottom-right",
      "margin": { "top": 24, "right": 24, "bottom": 24, "left": 24, "locked": true }
    }
  },
  "tracks": [
    {
      "id": "track_main",
      "type": "visual",
      "role": "main",
      "name": "主轨",
      "order": 0,
      "enabled": true,
      "visible": true,
      "muted": false,
      "locked": false,
      "color": "#4ea1ff",
      "clips": [
        {
          "id": "clip_1",
          "type": "clip",
          "enabled": true,
          "visible": true,
          "start_ms": 0,
          "duration_ms": 5000,
          "media_ids": ["md_abc123"],
          "name": "Clip",
          "prompt": "close up",
          "ai_prompt": "",
          "use_global_prompt": true,
          "use_ai_prompt": true,
          "use_media_prompts": [true],
          "media_enabled": [true],
          "head_extend_sec": 0,
          "tail_extend_sec": 0,
          "generate_preview_video": false,
          "second_sample": false,
          "clip_role": "multi_ref",
          "clip_role_custom": "",
          "agent": "MiniMaxH3",
          "agent_custom": "",
          "generated_videos": [
            {
              "id": "gv_1",
              "file": "MiniMax_H3/clip_1.mp4",
              "enabled": true,
              "muted": false,
              "note": ""
            }
          ]
        }
      ]
    },
    {
      "id": "track_sub",
      "type": "subtitle",
      "role": "subtitle",
      "name": "字幕",
      "order": 1,
      "enabled": true,
      "visible": true,
      "muted": false,
      "locked": false,
      "color": "#ff9e4a",
      "clips": [
        {
          "id": "sub_1",
          "type": "subtitle",
          "enabled": true,
          "visible": true,
          "start_ms": 0,
          "duration_ms": 3000,
          "name": "你好",
          "text": "你好",
          "font_family": "Microsoft YaHei",
          "font_path": "",
          "font_size": 48,
          "letter_spacing": 0,
          "color": "#ffffff",
          "bold": false,
          "italic": false,
          "opacity": 1,
          "stroke_enabled": true,
          "stroke_color": "#000000",
          "stroke_width": 3,
          "shadow_enabled": true,
          "shadow_color": "#000000",
          "shadow_blur": 4,
          "shadow_offset_x": 2,
          "shadow_offset_y": 2,
          "align": "center",
          "v_align": "bottom",
          "offset_x": 0,
          "offset_y": 8
        }
      ]
    }
  ]
}
```

---

## `data_json` 数据结构（运行时）

```json
{
  "project_version": "x.y.z",
  "schema_version": "x.y.z",
  "fps": 24.0,
  "width": 1344,
  "height": 768,
  "global_prompt": "cinematic",
  "total_frame_count": 120,
  "run_prefix": "20260805_224215",
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
          "location": "input",
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
| `run_prefix` | 本次执行生成的时间戳字符串（`YYYYMMDD_HHMMSS`），可直接用作统一文件名前缀 |
| `start_ms` / `end_ms` | 运行时片段时间区间（毫秒） |
| `start_image` / `end_image` | 经 ComfyUI `input` 解析后的绝对路径 |
| `audios[]` | 与该视觉区间重叠的音/视频切片；由 [Data Json Clip Parser](data-json-clip-parser.md) 混音。非音频轨无素材的时间段内，音频不导出 |
| `z_index` | 构建片段时使用的轨道叠放顺序 |
| `output_video` | 可选；开启「生成视频使用Clip指定文件名」时写入，形如 `CapTimelineEditor/[项目名]/yyyyMMdd-HHmmss_[clip_id].mp4`（相对 `output/`） |

没有顶层 `audio_path`（该字段仅属于 Audio Timeline）。

整轨输出 `clips_audio`：按运行时视觉片段顺序，将各段对应音频混音后**首尾拼接**（视觉空档丢弃），时长与 `total_frame_count` / 序列帧对齐。

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
