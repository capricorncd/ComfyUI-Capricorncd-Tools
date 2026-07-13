# 从目录加载图像（Load Images From Dir）

**分类：** `Capricorncd`

从目录读取图片文件并输出为 `IMAGE` 批次。文件按自然序排列（例如 `img_00001.png` 排在 `img_00010.png` 之前）。

---



## 支持格式

`.png` `.jpg` `.jpeg` `.webp` `.gif` `.bmp`

---

## 说明

- 所有图片必须尺寸一致，否则会报错。
- 加载前会应用 EXIF 方向校正。
- `start_index` 越界或筛选结果为空时会报错。
- `IS_CHANGED` 会跟踪文件修改时间，目录内容变化时节点会重新执行。

---

<!-- AUTO:API:begin -->
Load images from a directory into an IMAGE batch. When deep is enabled, subdirectories are included. Use start_index and max_count to limit which files are loaded.

#### Inputs

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `directory` | STRING | `""` | Directory containing images (absolute or under assets) |
| `deep` | BOOLEAN | false | When enabled, include images from subdirectories |
| `start_index` | INT | `0` | Zero-based index of the first image to load |
| `max_count` | INT | `-1` | -1 loads all images from start_index onward |

#### Outputs

| Name | Type | Description |
|------|------|-------------|
| `images` | IMAGE | Loaded IMAGE batch (all frames must share the same size) |
| `directory` | STRING | Resolved absolute directory path |
| `total_count` | INT | Total image files found before start_index / max_count slicing |
| `count` | INT | Number of images actually loaded into the batch |
<!-- AUTO:API:end -->

## 示例

从序列帧目录加载前 24 帧：

```
directory   = ./output/temp/capricorncd-frame-sequences
deep        = false
start_index = 0
max_count   = 24
```
