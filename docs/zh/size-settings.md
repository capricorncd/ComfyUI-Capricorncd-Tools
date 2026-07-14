# Size Settings（尺寸设置）

**分类：** `Capricorncd`

根据尺寸预设、倍数与方向计算 `width` / `height`，编辑自定义宽高时可锁定比例。同时输出 `count` 与 `fps`。

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

## 说明

- 修改 **尺寸**、**倍数** 或 **方向** 会重新计算宽度 / 高度。
- 开启 **锁定比例** 时，改宽度会按比例更新高度（改高度同理）。
- **纵向** 保持预设宽高；**横向** 交换宽高（1:1 无变化）。
- 可将 `width` / `height` / `fps` 接到 **Timeline Editor**、**Audio Timeline** 或其他需要画布尺寸与帧率的节点。
