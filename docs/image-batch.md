# Image Batch Count / Image From Batch Index

**Category:** `Capricorncd`

Small utility nodes for working with `IMAGE` batches.

---

## Image Batch Count

Returns the number of images in a batch.

| Input | Type | Description |
|-------|------|-------------|
| `images` | IMAGE | Input batch |

| Output | Type | Description |
|--------|------|-------------|
| `count` | INT | `images.shape[0]` |

---

## Image From Batch Index

Extracts a single image from a batch by index.

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `images` | IMAGE | — | Input batch |
| `index` | INT | `0` | Batch index. Negative values count from the end (`-1` = last image) |

| Output | Type | Description |
|--------|------|-------------|
| `image` | IMAGE | Single-image batch (`shape[0] == 1`) |
| `index` | INT | Resolved index after negative normalization and clamping |
| `filename` | STRING | Default filename `img_{index:05d}.png` for the resolved index |

---

## Notes

- Out-of-range positive indices are clamped to the last image.
- Negative indices are normalized before clamping, so `-1` always means the last frame.

---

## Example

```
IMAGE batch (48 frames)
  ├── Image Batch Count        → count = 48
  └── Image From Batch Index
        index = -1             → image, index = 47, filename = img_00047.png
```
