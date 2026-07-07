# Seq To Video（序列帧合成视频）

**分类：** `Capricorncd`

使用 **ffmpeg** 将图像帧和可选音频合成为 MP4 文件，输出至 ComfyUI 的 `output` 目录。节点底部内嵌视频播放器，每次成功渲染后自动播放。

> **需要安装 ffmpeg** 并将其加入系统 `PATH`。若未找到 ffmpeg，节点内部将显示红色错误提示。

---

## 帧来源（优先级）

每次运行只使用一种来源，按以下顺序判断：

| 优先级 | 输入 | 模式 | 说明 |
|--------|------|------|------|
| 1 | `images` | `images` | 将 `IMAGE` 批次写入临时 PNG 后编码 |
| 2 | `image_paths` | `list` | 逗号分隔的文件路径（与 [Save Images](save-images.md) 的 `image_paths` 输出格式一致） |
| 3 | `frames_dir` | `dir` | 扫描目录并自动识别数字序列帧 |

---

## 目录模式（`frames_dir`）

节点扫描 `frames_dir` 中的图片文件（`jpg`、`jpeg`、`png`、`webp`、`bmp`），并从第一个文件名自动推断 ffmpeg glob 模式。例如 `MV_00001.jpg` → `MV_%05d.jpg`。起始帧编号也会自动检测，因此不从 `0` 或 `1` 开始的序列同样可以正确处理。

---

## 列表模式（`image_paths`）

接受逗号分隔的路径列表，例如：

```
D:\ComfyUI\output\temp\img_00000.png, D:\ComfyUI\output\temp\img_00001.png
```

路径可加引号。文件按列表顺序通过 ffmpeg concat demuxer 编码。

---

## 输出文件名

```
{filename_prefix}_{yyyyMMdd_HHmmss}.mp4
```

每次运行生成唯一文件，不覆盖历史渲染结果。

---

## 内嵌播放器

- 内嵌于节点内部，渲染完成后自动播放
- 持续循环播放，不显示进度条
- **默认静音**——鼠标悬停到视频上可取消静音并听到音轨
- 重新加载浏览器或重启 ComfyUI 后，上一次渲染的视频会自动恢复

---

## 视频时长

输出时长始终以帧数为准：`frame_count / fps`。若音频轨道比视频长，则截断至与视频等长。

---

## 输入参数

| 名称 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `frames_dir` | STRING | `""` | 目录模式使用的路径（`images` 与 `image_paths` 均为空时生效） |
| `fps` | FLOAT | 24.0 | 输出视频的帧率 |
| `filename_prefix` | STRING | `STV` | 输出文件名前缀 |
| `images` | IMAGE | *（可选）* | 最高优先级的帧来源 |
| `image_paths` | STRING | `""` | 逗号分隔的图片文件路径 |
| `audio` | AUDIO | *（可选）* | 混入视频的音频；省略则输出纯视频 |

## 输出参数

| 名称 | 类型 | 说明 |
|------|------|------|
| `filename` | STRING | 相对于 ComfyUI output 目录的输出文件名 |

---

## 接线示例

```
Save Images.image_paths ──► Seq To Video.image_paths
Save Images.image_dir    ──► Clear Directory.directory   （下次渲染前清理）
IMAGE 批次               ──► Seq To Video.images         （直接编码）
```
