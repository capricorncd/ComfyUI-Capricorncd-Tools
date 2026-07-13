# Load Images From Dir

**Category:** `Capricorncd`

Loads image files from a directory into an `IMAGE` batch. Files are ordered naturally (for example `img_00001.png` before `img_00010.png`).

---



## Supported formats

`.png` `.jpg` `.jpeg` `.webp` `.gif` `.bmp`

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
