# Save Images（保存图像）

**分类：** `Capricorncd`

将一批图像保存到磁盘，并返回保存目录和文件路径列表。

---

## 输入参数

| 名称 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `images` | IMAGE | — | 要保存的图像批次 |
| `filename_prefix` | STRING | `temp/cap-save-images/%Y%m%d_%H%M%S/CSI` | 相对 ComfyUI `output` 的文件名前缀；前段为子目录，末段为文件前缀。支持 [`strftime`](https://strftime.org/) |
| `filename` | STRING | `{prefix}_{index}.png` | 文件名模板，支持 `{prefix}` 与 `{index}`（补零至 5 位）。支持 `.jpg` 和 `.png` 扩展名 |
| `quality` | INT | `80` | 保存质量（1–100）。JPEG 表示压缩质量；PNG 表示 zlib 压缩级别（0–9，由 1–100 映射） |
| `dpi` | INT | `300` | 写入图像文件的 DPI 元数据（1–2400） |
| `metadata` *（可选）* | STRING | `""` | 写入文件 `comment` 元数据字段的任意字符串 |

---

## 输出参数

| 名称 | 类型 | 说明 |
|------|------|------|
| `image_dir` | STRING | 图像实际保存目录的绝对路径 |
| `image_paths` | STRING | 已保存文件路径的逗号分隔列表 |

---

## 注意事项

- 目标目录不存在时会自动创建。
- 索引从 `00000` 开始递增，直到找到未被占用的文件名，因此不会覆盖已有文件。
- `filename_prefix` 中的 `strftime` 占位符在执行时根据当前系统时间解析，每次运行只解析一次。
- 文件始终保存在 ComfyUI 的 `output` 目录下，不允许写到该目录之外。
