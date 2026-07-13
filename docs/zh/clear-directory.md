# 清空目录（Clear Directory）

**分类：** `Capricorncd`

删除目录中的图片、视频和/或音频文件。其他类型文件（如 `.json`、`.txt`）以及子目录本身不会被删除。

禁止对文件系统根目录（如 `C:\`、`D:\`、`/`）执行清空，否则会抛出异常。

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

<!-- AUTO:API:begin -->
Delete image, video, and/or audio files in a directory. Filesystem root directories are blocked. On Windows, deleted files can be sent to the Recycle Bin.

#### Inputs

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `directory` | STRING | `""` | Target directory (filesystem roots are blocked) |
| `delete_subdirs` | BOOLEAN | false | When enabled, also delete matching files in subdirectories |
| `delete_images` | BOOLEAN | true | Delete image files |
| `delete_videos` | BOOLEAN | true | Delete video files |
| `delete_audio` | BOOLEAN | true | Delete audio files |
| `to_recycle_bin` | BOOLEAN | true | On Windows, send files to Recycle Bin; otherwise permanent delete |

#### Outputs

| Name | Type | Description |
|------|------|-------------|
| `directory` | STRING | Resolved absolute directory path that was cleaned |
| `deleted_count` | INT | Number of files deleted (or moved to Recycle Bin) |
<!-- AUTO:API:end -->

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
