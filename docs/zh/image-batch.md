# 图像批次计数 / 按索引取图（Image Batch Count / Image From Batch Index）

**分类：** `Capricorncd`

用于处理 `IMAGE` 批次的辅助节点。

---

<!-- AUTO:API:begin -->
### Image Batch Count

Return the number of images in an IMAGE batch.

#### Inputs

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `images` | IMAGE | — | Input IMAGE batch |

#### Outputs

| Name | Type | Description |
|------|------|-------------|
| `count` | INT | Number of images in the batch (images.shape[0]) |

### Image From Batch Index

Return a single image from an IMAGE batch by index, along with the resolved index and default filename img_{index:05d}.png.

#### Inputs

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `images` | IMAGE | — | Input IMAGE batch |
| `index` | INT | `0` | Batch index; negative values count from the end (-1 = last) |

#### Outputs

| Name | Type | Description |
|------|------|-------------|
| `image` | IMAGE | Single-image batch (shape[0] == 1) |
| `index` | INT | Resolved index after negative normalization and clamping |
| `filename` | STRING | Default filename img_{index:05d}.png for the resolved index |
<!-- AUTO:API:end -->

## 说明

- 正索引越界时会被钳制到最后一张。
- 负索引会先换算再钳制，因此 `-1` 始终表示最后一帧。

---

## 示例

```
IMAGE 批次（48 帧）
  ├── 图像批次计数    → count = 48
  └── 按索引取图
        index = -1   → image、index = 47、filename = img_00047.png
```
