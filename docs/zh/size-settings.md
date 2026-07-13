# Size Settings（尺寸设置）

**分类：** `Capricorncd`

根据宽高比、分辨率档位与方向计算 `width` / `height`，也可直接使用手动编辑的自定义尺寸。同时输出可复用的整数 `count`（例如批次大小或循环次数）。

节点 UI 会将比例 / 分辨率 / 方向与 `custom_width`、`custom_height` 保持同步。执行时返回（按 8 对齐的）自定义尺寸和 `count`。

---



## 说明

- 可将 `width` / `height` 接到 **Timeline Editor**、**Audio Timeline** 或其他需要画布尺寸的节点。
- 在 UI 中改比例 / 分辨率 / 方向会重算自定义尺寸字段；排队前仍可手动覆盖。

<!-- AUTO:API:begin -->
Output width and height from aspect ratio, resolution tier, orientation, or manually edited custom dimensions.

#### Inputs

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `aspect_ratio` | ENUM | `9:16` | Aspect ratio preset used by the UI size calculator |
| `resolution` | ENUM | `1K` | Resolution tier (long-edge or square-edge target) |
| `orientation` | ENUM | `竖屏` | Portrait or landscape; swaps non-square ratios |
| `custom_width` | INT | `1080` | Width used at run time (aligned to multiples of 8) |
| `custom_height` | INT | `1920` | Height used at run time (aligned to multiples of 8) |
| `count` | INT | `1` | Reusable integer output (e.g. batch size or loop count) |

#### Outputs

| Name | Type | Description |
|------|------|-------------|
| `width` | INT | Final width aligned to a multiple of 8 |
| `height` | INT | Final height aligned to a multiple of 8 |
| `count` | INT | Pass-through integer (batch size, loop count, etc.) |
<!-- AUTO:API:end -->
