from __future__ import annotations


def _resolve_batch_index(batch_size: int, index: int) -> int:
    batch_index = int(index)
    if batch_index < 0:
        batch_index += batch_size
    return max(0, min(batch_size - 1, batch_index))


class CAP_ImageBatchCount:
    """Return how many images are in an IMAGE batch."""

    DOC_SLUG = "image-batch"
    DOC_SECTION = "Image Batch Count"
    OUTPUT_TOOLTIPS = {
        "count": "Number of images in the batch (images.shape[0])",
    }

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE", {
                    "tooltip": "Input IMAGE batch",
                }),
            },
        }

    RETURN_TYPES = ("INT",)
    RETURN_NAMES = ("count",)
    FUNCTION = "execute"
    CATEGORY = "Capricorncd"
    DESCRIPTION = "Return the number of images in an IMAGE batch."

    def execute(self, images):
        return (int(images.shape[0]),)


class CAP_ImageFromBatchIndex:
    """Extract one image from an IMAGE batch by index."""

    DOC_SLUG = "image-batch"
    DOC_SECTION = "Image From Batch Index"
    OUTPUT_TOOLTIPS = {
        "image": "Single-image batch (shape[0] == 1)",
        "index": "Resolved index after negative normalization and clamping",
        "filename": "Default filename img_{index:05d}.png for the resolved index",
    }

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE", {
                    "tooltip": "Input IMAGE batch",
                }),
                "index": ("INT", {
                    "default": 0,
                    "min": -4096,
                    "max": 4096,
                    "tooltip": "Batch index; negative values count from the end (-1 = last)",
                }),
            },
        }

    RETURN_TYPES = ("IMAGE", "INT", "STRING")
    RETURN_NAMES = ("image", "index", "filename")
    FUNCTION = "execute"
    CATEGORY = "Capricorncd"
    DESCRIPTION = (
        "Return a single image from an IMAGE batch by index, "
        "along with the resolved index and default filename img_{index:05d}.png."
    )

    def execute(self, images, index):
        batch_index = _resolve_batch_index(images.shape[0], index)
        filename = f"img_{batch_index:05d}.png"
        return (images[batch_index:batch_index + 1].clone(), batch_index, filename)


NODE_CLASS_MAPPINGS = {
    "CAP_ImageBatchCount": CAP_ImageBatchCount,
    "CAP_ImageFromBatchIndex": CAP_ImageFromBatchIndex,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "CAP_ImageBatchCount": "Image Batch Count",
    "CAP_ImageFromBatchIndex": "Image From Batch Index",
}
