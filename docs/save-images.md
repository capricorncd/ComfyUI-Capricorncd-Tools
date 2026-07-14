# Save Images

**Category:** `Capricorncd`

Saves a batch of images to disk and returns the save directory and a comma-separated list of saved file paths.

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

## Notes

- The save directory is created automatically if it does not exist.
- Index numbering starts at `00000` and increments until a free filename is found, so existing files are never overwritten.
- `strftime` placeholders in `filename_prefix` are evaluated once at execution time using the current system date/time.
- Relative `filename_prefix`: last segment is the file prefix; earlier segments are subfolders under ComfyUI `output` (must stay under `output`).
- Absolute `filename_prefix`: the whole path is the save directory anywhere on disk; file prefix defaults to `CSI`.
- When `save_as_zip` is enabled, a zip of the saved images is written next to the folder.
