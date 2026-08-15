# Compose Clip Videos（多段视频合成）

**分类：** `Capricorncd`

用 **ffmpeg** 将 `output/{run_prefix}` 下各片段 MP4 合成为一条时间轴视频。可按预览时长裁掉首/尾扩展。

> **需要** 系统 `PATH` 中有 ffmpeg。

---

## 片段匹配

片段列表来自 `data_json`。每个片段在 `clips_dir` 中按文件名匹配：

| `name_mode` | 文件名主干 |
|-------------|------------|
| `from_start` | `FROM_…` 标签（与 Data Json Clip Parser 给 Seq To Video 的前缀一致） |
| `index` | 四位索引（`0000`、`0001`、…） |

`clips_dir` 为空时使用 `data_json` 中的 `output/{run_prefix}`。相对路径相对 ComfyUI `output`；绝对路径按原样使用。

---

## 输入参数

| 名称 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `data_json` | STRING | `""` | 时间轴 / 音频时间轴的片段列表 |
| `clips_dir` | STRING | `""` | 片段视频目录；留空 = `output/{run_prefix}` |
| `name_mode` | ENUM | `from_start` | 如何匹配片段视频文件名 |
| `filename_prefix` | STRING | `composed` | 输出前缀；可含子目录（相对 `output`） |
| `trim_extends` | BOOLEAN | true | 文件为扩展时长渲染时，合成前裁掉首/尾扩展 |
| `save_sidecar` | BOOLEAN | true | 在合成 MP4 旁写入同名 JSON |

## 输出参数

| 名称 | 类型 | 说明 |
|------|------|------|
| `filename` | STRING | 相对于 ComfyUI output 目录的输出路径 |

---

## 同名 JSON

开启 `save_sidecar` 时，`{name}.mp4` 旁会写入 `{name}.json`，记录工作流中的提示词 / 模型 / 采样参数，以及 `data_json` 里各片段的提示词。
