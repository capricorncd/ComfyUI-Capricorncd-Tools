# Load Images From Dir

**Category:** `Capricorncd`

Loads image files from a directory into an `IMAGE` batch. Files are ordered naturally (for example `img_00001.png` before `img_00010.png`).

---

## Inputs

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `directory` | STRING | `""` | Directory to scan. Relative paths are resolved under ComfyUI `input`, `output`, or cwd |
| `deep` | BOOLEAN | `false` | Include images in subdirectories when enabled |
| `start_index` | INT | `0` | Zero-based index of the first file to load |
| `max_count` | INT | `-1` | Maximum number of images to load. `-1` loads all files from `start_index` onward |

---

## Outputs

| Name | Type | Description |
|------|------|-------------|
| `images` | IMAGE | Loaded image batch |
| `directory` | STRING | Resolved absolute directory path |
| `total_count` | INT | Total number of matching images found in the directory |
| `count` | INT | Number of images actually returned after `start_index` / `max_count` |

---

## Supported formats

`.png` `.jpg` `.jpeg` `.webp` `.gif` `.bmp`

---

## Notes

- All loaded images must share the same width and height; otherwise the node raises an error.
- EXIF orientation is applied before loading.
- If `start_index` is out of range or the slice is empty, the node raises an error.
- `IS_CHANGED` tracks file modification times so the node re-runs when directory contents change.

---

## Example

Load the first 24 frames from a sequence directory:

```
directory   = ./output/temp/capricorncd-frame-sequences
deep        = false
start_index = 0
max_count   = 24
```
