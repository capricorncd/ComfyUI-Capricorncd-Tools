# Size Settings

**Category:** `Capricorncd`

Computes `width` / `height` from a size preset, scale multiplier, and orientation, with optional aspect-ratio lock while editing custom dimensions. Also outputs `count` and `fps`.

---

<!-- AUTO:API:begin -->
Output width, height, count, and fps (float + int) from size presets, scale, orientation, and optionally locked custom dimensions.

#### Inputs

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `size` | ENUM | `720x1280 (9:16)` | Base canvas size preset (portrait dimensions shown) |
| `scale` | FLOAT | `1.0` | Multiplier applied to the size preset |
| `lock_aspect` | BOOLEAN | true | When locked, editing width updates height (and vice versa) to keep the aspect ratio |
| `orientation` | ENUM | `纵向` | 纵向 keeps preset WxH; 横向 swaps width and height |
| `custom_width` | INT | `720` | Width used at run time (aligned to multiples of 8) |
| `custom_height` | INT | `1280` | Height used at run time (aligned to multiples of 8) |
| `fps` | FLOAT | `24.0` | Frames per second |
| `count` | INT | `1` | Reusable integer output (e.g. batch size or loop count) |

#### Outputs

| Name | Type | Description |
|------|------|-------------|
| `width` | INT | Final width aligned to a multiple of 8 |
| `height` | INT | Final height aligned to a multiple of 8 |
| `count` | INT | Pass-through integer (batch size, loop count, etc.) |
| `fps` | FLOAT | Frames per second (float) |
| `fps_int` | INT | Frames per second rounded to int |
<!-- AUTO:API:end -->

## Notes

- Changing **Size**, **Scale**, or **Orientation** recalculates Width / Height.
- With **Lock Aspect** on, editing Width updates Height (and vice versa) to keep the current ratio.
- Orientation **纵向** keeps the preset as shown; **横向** swaps width and height (no-op for 1:1).
- Connect `width` / `height` / `fps` into **Timeline Editor**, **Audio Timeline**, or any node that needs canvas size and frame rate.
