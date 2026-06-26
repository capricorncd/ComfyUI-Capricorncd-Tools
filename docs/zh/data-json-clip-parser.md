# Data Json Clip Parser（数据解析·片段）

**分类：** `Capricorncd`

解析 **Audio Timeline** 的 `data_json` 输出，通过索引提取单个片段。配合计数器或批次索引节点在循环中使用，可逐片段驱动生成流程。

---

## 工作原理

`data_json` 包含一组片段信息：图片绝对路径、毫秒级时间戳和提示词。本节点通过 `index` 取出指定片段，并输出该区间生成所需的全部内容：

- 对应的音频切片（根据原始音频文件的 `trim_start_ms` 与片段偏移量修剪）
- 按时间轴帧率计算的帧数
- 首帧和尾帧图片
- 有效提示词（优先使用每片段提示词，无则回退到全局提示词）

---

## `trim_offset`

为音频片段的结束时间额外追加若干秒，适用于生成流程需要稍长的音频尾部用于淡出或叠化的场景。**不影响 `frame_count`**，仅延长 `audio` 输出的时长。

---

## 输入参数

| 名称 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `data_json` | STRING | — | 来自 Audio Timeline `data_json` 输出的 JSON 字符串 |
| `index` | INT | 0 | 要提取的片段的从零开始的索引 |
| `trim_offset` | INT | 1 | 追加到片段音频结束时间的秒数；**不影响** `frame_count` |

## 输出参数

| 名称 | 类型 | 说明 |
|------|------|------|
| `audio` | AUDIO | 该片段的修剪音频（末尾延伸 `trim_offset` 秒） |
| `frame_count` | INT | 该片段在时间轴帧率下的帧数 |
| `first_frame` | IMAGE | 首帧关键帧图片；未分配时输出 64×64 空白图 |
| `last_frame` | IMAGE | 尾帧关键帧图片；未分配时输出 64×64 空白图 |
| `prompt` | STRING | 每片段提示词；无则使用 `global_prompt` |

---

## 典型工作流

```
Audio Timeline
  └── data_json    ──►  Data Json Clip Parser（index = 循环计数器）
  └── clips_length ──►  循环上限
                            ├── audio       ──► 生成节点
                            ├── frame_count ──► 生成节点
                            ├── first_frame ──► 生成节点
                            ├── last_frame  ──► 生成节点
                            └── prompt      ──► 生成节点
```

由于 **Audio Timeline** 会将禁用的片段从 `data_json` 中排除，你可以通过在时间轴中禁用其他所有片段来只重新生成某一个区间——下游的索引连线无需任何改动。
