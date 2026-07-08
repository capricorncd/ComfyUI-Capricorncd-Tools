from __future__ import annotations


def _resolve_batch_index(batch_size: int, index: int) -> int:
    batch_index = int(index)
    if batch_index < 0:
        batch_index += batch_size
    return max(0, min(batch_size - 1, batch_index))


class CAP_ImageBatchCount:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
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
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "index": ("INT", {"default": 0, "min": -4096, "max": 4096}),
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
