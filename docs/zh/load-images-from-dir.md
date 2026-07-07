# 从目录加载图像（Load Images From Dir）

**分类：** `Capricorncd`

从目录读取图片文件并输出为 `IMAGE` 批次。文件按自然序排列（例如 `img_00001.png` 排在 `img_00010.png` 之前）。

---

## 输入参数

| 名称 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `directory` | STRING | `""` | 要扫描的目录。相对路径会依次在 ComfyUI `input`、`output`、当前工作目录下解析 |
| `deep` | BOOLEAN | `false` | 开启后包含子目录中的图片 |
| `start_index` | INT | `0` | 起始文件索引（从 0 开始） |
| `max_count` | INT | `-1` | 最多加载的图片数量。`-1` 表示从 `start_index` 起加载全部 |

---

## 输出参数

| 名称 | 类型 | 说明 |
|------|------|------|
| `images` | IMAGE | 加载后的图像批次 |
| `directory` | STRING | 解析后的绝对目录路径 |
| `total_count` | INT | 目录中匹配图片的总数 |
| `count` | INT | 经 `start_index` / `max_count` 筛选后实际输出的数量 |

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

## 示例

从序列帧目录加载前 24 帧：

```
directory   = ./output/temp/capricorncd-frame-sequences
deep        = false
start_index = 0
max_count   = 24
```
