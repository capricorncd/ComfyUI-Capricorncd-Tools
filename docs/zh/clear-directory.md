# 清空目录（Clear Directory）

**分类：** `Capricorncd`

删除目录中的图片、视频和/或音频文件。其他类型文件（如 `.json`、`.txt`）以及子目录本身不会被删除。

禁止对文件系统根目录（如 `C:\`、`D:\`、`/`）执行清空，否则会抛出异常。

---

## 输入参数

| 名称 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `directory` | STRING | `""` | 目标目录。相对路径的解析方式与其他 Capricorncd 节点一致（依次尝试 `input`、`output`、当前工作目录） |
| `delete_subdirs` | BOOLEAN | `false` | 开启后，会递归删除子目录中的匹配文件 |
| `delete_images` | BOOLEAN | `true` | 删除图片文件 |
| `delete_videos` | BOOLEAN | `true` | 删除视频文件 |
| `delete_audio` | BOOLEAN | `true` | 删除音频文件 |
| `to_recycle_bin` | BOOLEAN | `true` | Windows 下将文件移入回收站，而非永久删除 |

---

## 输出参数

| 名称 | 类型 | 说明 |
|------|------|------|
| `directory` | STRING | 解析后的绝对目录路径 |
| `deleted_count` | INT | 实际删除的文件数量 |

---

## 支持的扩展名

| 类型 | 扩展名 |
|------|--------|
| 图片 | `.png` `.jpg` `.jpeg` `.webp` `.gif` `.bmp` |
| 视频 | `.mp4` `.webm` `.mov` `.mkv` `.avi` `.m4v` |
| 音频 | `.wav` `.mp3` `.flac` `.ogg` `.m4a` `.aac` |

---

## 说明

- 若图片、视频、音频三个开关全部关闭，节点不执行删除，返回 `deleted_count = 0`。
- `delete_subdirs = false` 时，只处理目标目录顶层的文件。
- 非 Windows 系统开启「放入回收站」时，会记录警告并回退为永久删除。
- `to_recycle_bin = false` 时，通过 `os.unlink` 永久删除。

---

## 示例

重新渲染前清理临时序列帧目录：

```
directory      = ./output/temp/capricorncd-frame-sequences
delete_subdirs = false
delete_images  = true
delete_videos  = false
delete_audio   = false
to_recycle_bin = true
```
