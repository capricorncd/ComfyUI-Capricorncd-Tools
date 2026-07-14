# Save Images（保存图像）

**分类：** `Capricorncd`

将一批图像保存到磁盘，并返回保存目录和文件路径列表。

---

<!-- AUTO:API:begin -->
Save a batch of images to disk. Relative filename_prefix is under ComfyUI output (last segment = file prefix). Absolute filename_prefix is the save directory anywhere on disk (file prefix defaults to CSI). Supports strftime. filename supports {prefix} and {index} (zero-padded to 5 digits). When save_as_zip is true, also pack the saved images into a zip next to the folder.

#### Inputs

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `images` | IMAGE | — | Batch of images to save |
| `filename_prefix` | STRING | `temp/cap-save-images/%Y%m%d_%H%M%S/CSI` | Relative to ComfyUI output: earlier segments are subfolders, last segment is the file prefix. An absolute path is the save directory anywhere on disk (prefix defaults to CSI). Supports strftime. |
| `filename` | STRING | `{prefix}_{index}.png` | File name template with {prefix} and {index} (zero-padded to 5 digits) |
| `quality` | INT | `80` | JPEG quality (1–100); for PNG mapped to zlib compression |
| `dpi` | INT | `300` | DPI metadata written to the image file |
| `save_as_zip` | BOOLEAN | false | Also pack saved images into a zip next to the folder |
| `metadata` *(optional)* | STRING | `""` | String written to the file comment metadata field |

#### Outputs

| Name | Type | Description |
|------|------|-------------|
| `image_dir` | STRING | Absolute path of the directory where images were saved |
| `image_paths` | STRING | Comma-separated list of saved file paths |
<!-- AUTO:API:end -->

## 注意事项

- 目标目录不存在时会自动创建。
- 索引从 `00000` 开始递增，直到找到未被占用的文件名，因此不会覆盖已有文件。
- `filename_prefix` 中的 `strftime` 占位符在执行时根据当前系统时间解析，每次运行只解析一次。
- 相对路径：最后一段为文件前缀，前面各段为 ComfyUI `output` 下的子目录（须位于 `output` 内）。
- 绝对路径：整段路径作为保存目录，可为电脑任意位置；文件前缀默认为 `CSI`。
- 开启 `save_as_zip` 时，会在目录旁额外生成包含已保存图片的 zip。
