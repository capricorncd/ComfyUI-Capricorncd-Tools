# Save Images

**Category:** `Capricorncd`

Saves a batch of images to disk and returns the save directory and a comma-separated list of saved file paths.

---

## Inputs

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `images` | IMAGE | — | Batch of images to save |
| `directory` | STRING | `./output` | Destination directory. Supports [`strftime`](https://strftime.org/) format strings, e.g. `./output/%Y%m%d` resolves to `./output/20250624` |
| `filename` | STRING | `img_{index}.png` | File name template. Must contain `{index}`, which is automatically zero-padded to 5 digits. Supports `.jpg` and `.png` extensions |
| `quality` | INT | `80` | Save quality (1–100). For JPEG this is the JPEG quality level; for PNG it is the zlib compression level (0–9, mapped from 1–100) |
| `dpi` | INT | `300` | DPI metadata written to the image file (1–2400) |
| `metadata` *(optional)* | STRING | `""` | Arbitrary string written to the file's `comment` metadata field |

---

## Outputs

| Name | Type | Description |
|------|------|-------------|
| `image_dir` | STRING | Resolved absolute path of the directory where images were saved |
| `image_paths` | STRING | Comma-separated list of saved file paths (e.g. `./output/img_00000.png, ./output/img_00001.png`) |

---

## Notes

- The save directory is created automatically if it does not exist.
- Index numbering starts at `00000` and increments until a free filename is found, so existing files are never overwritten.
- `strftime` placeholders in `directory` are evaluated once at execution time using the current system date/time.
