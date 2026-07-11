# Data Json Clip Parser（数据解析·片段）

**分类：** `Capricorncd`

解析 **Audio Timeline** 或 **Timeline Editor** 的 `data_json` 输出，通过索引提取单个片段。配合计数器或批次索引节点在循环中使用，可逐片段驱动生成流程。

---

## 工作原理

`data_json` 包含一组运行时片段：图片绝对路径、毫秒级时间戳和提示词。本节点通过 `index` 取出指定片段，并输出该区间生成所需的全部内容：

- 该片段对应的音频
- 按时间轴帧率计算的帧数
- 首帧和尾帧图片
- 有效提示词（优先使用每片段提示词，无则回退到全局提示词）

节点会自动识别上游 JSON 格式：

| 来源 | 音频处理方式 |
|------|-------------|
| **Audio Timeline** | 从单一 `audio_path` 按 `trim_start_ms` + 片段偏移裁剪 |
| **Timeline Editor** | 加载并混音 clip 内 `audios[]` 中的各条音频切片 |

两种格式在图片、时间轴与提示词上共用相同 clip 字段（`start_ms`、`end_ms`、`start_image`、`end_image`、`prompt`、`use_global_prompt`）。

---

## 支持的 `data_json` 格式

### Audio Timeline

顶层包含 `audio_path`、`trim_start_ms`、`trim_end_ms` 等字段，每个 clip 为扁平关键帧片段。详见 [Audio Timeline — `data_json` 数据结构](audio-timeline.md#data_json-数据结构)。

### Timeline Editor

顶层包含 `project_version`、`schema_version`，**无** `audio_path`。每个运行时 clip 可带 `audios` 数组，描述与该视觉片段重叠的音频切片：

```json
{
  "fps": 24.0,
  "width": 1344,
  "height": 768,
  "global_prompt": "cinematic",
  "clips": [
    {
      "id": "runtime_0001",
      "start_ms": 0,
      "end_ms": 5000,
      "start_image": "/absolute/path/to/start.jpg",
      "end_image": "/absolute/path/to/end.jpg",
      "prompt": "close up",
      "use_global_prompt": true,
      "audios": [
        {
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

| `audios[]` 字段 | 说明 |
|-----------------|------|
| `file` | 源音频/视频文件的绝对路径 |
| `source_start_ms` / `source_end_ms` | 使用的源文件时间范围 |
| `clip_offset_ms` | 该切片在视觉 clip 时间轴内的起始偏移 |

多条重叠切片会叠加混音。无 `audios` 或列表为空时，输出与 clip 等长的静音。

---

## `trim_offset`

为片段音频的结束时间额外追加若干秒，适用于生成流程需要稍长的音频尾部用于淡出或叠化的场景。**不影响 `frame_count`**，仅延长 `audio` 输出的时长。

- **Audio Timeline：** 向主 `audio_path` 的裁剪末尾延伸
- **Timeline Editor：** 延伸触及 clip 末尾的切片；无后续源时尾部为静音

---

## 输入参数

| 名称 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `data_json` | STRING | — | 来自 **Audio Timeline** 或 **Timeline Editor** 的 `data_json` JSON 字符串 |
| `index` | INT | 0 | 要提取的片段的从零开始的索引 |
| `trim_offset` | INT | 1 | 追加到片段音频结束时间的秒数；**不影响** `frame_count` |

## 输出参数

| 名称 | 类型 | 说明 |
|------|------|------|
| `audio` | AUDIO | 该片段的音频（末尾延伸 `trim_offset` 秒） |
| `frame_count` | INT | 该片段在时间轴帧率下的帧数 |
| `first_frame` | IMAGE | 首帧关键帧图片；未分配时输出 64×64 空白图 |
| `last_frame` | IMAGE | 尾帧关键帧图片；未分配时输出 64×64 空白图 |
| `prompt` | STRING | 每片段提示词；无则使用 `global_prompt` |

---

## 典型工作流

```
Timeline Editor / Audio Timeline
  └── data_json     ──►  Data Json Clip Parser（index = 循环计数器）
  └── clips_length  ──►  循环上限
                             ├── audio       ──► 生成节点
                             ├── frame_count ──► 生成节点
                             ├── first_frame ──► 生成节点
                             ├── last_frame  ──► 生成节点
                             └── prompt      ──► 生成节点
```

两种上游节点都会将禁用 / 被遮挡的片段排除在 `data_json` 之外，因此可在编辑器中禁用其余片段来只重新生成某一段——下游索引连线无需改动。
