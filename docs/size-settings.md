# Size Settings

**Category:** `Capricorncd`

Computes `width` / `height` from aspect ratio, resolution tier, and orientation, or from manually edited custom dimensions. Also outputs a reusable `count` integer (e.g. batch size or loop count).

The node UI keeps ratio / resolution / orientation in sync with `custom_width` and `custom_height`. At execution time the node returns the (8-aligned) custom dimensions and `count`.

---

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

## Notes

- Connect `width` / `height` into **Timeline Editor**, **Audio Timeline**, or any node that needs canvas size.
- Changing aspect ratio / resolution / orientation in the UI recalculates the custom size fields; you can still override them manually before queueing.
