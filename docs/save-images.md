# Save Images

**Category:** `Capricorncd`

Saves a batch of images to disk and returns the save directory and a comma-separated list of saved file paths.

---

<!-- AUTO:API:begin -->
Save a batch of images under ComfyUI's output directory. filename_prefix is relative to output and supports strftime (e.g. temp/cap-save-images/%Y%m%d_%H%M%S/CSI). The last path segment is the file name prefix; earlier segments are subfolders. filename supports {prefix} and {index} (zero-padded to 5 digits). When save_as_zip is true, also pack the saved images into a zip next to the folder.

#### Inputs

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `images` | IMAGE | — | Batch of images to save |
| `filename_prefix` | STRING | `temp/cap-save-images/%Y%m%d_%H%M%S/CSI` | Path relative to ComfyUI output: earlier segments are subfolders, last segment is the file prefix. Supports strftime. |
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

## Notes

- The save directory is created automatically if it does not exist.
- Index numbering starts at `00000` and increments until a free filename is found, so existing files are never overwritten.
- `strftime` placeholders in `filename_prefix` are evaluated once at execution time using the current system date/time.
- Files are always written under ComfyUI's `output` directory; paths outside it are rejected.
- When `save_as_zip` is enabled, a zip of the saved images is written next to the folder.
