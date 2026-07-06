from __future__ import annotations


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

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "execute"
    CATEGORY = "Capricorncd"
    DESCRIPTION = "Return a single image from an IMAGE batch by index."

    def execute(self, images, index):
        batch_index = int(index)
        if batch_index < 0:
            batch_index += images.shape[0]
        batch_index = max(0, min(images.shape[0] - 1, batch_index))
        return (images[batch_index:batch_index + 1].clone(),)


NODE_CLASS_MAPPINGS = {
    "CAP_ImageBatchCount": CAP_ImageBatchCount,
    "CAP_ImageFromBatchIndex": CAP_ImageFromBatchIndex,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "CAP_ImageBatchCount": "Image Batch Count",
    "CAP_ImageFromBatchIndex": "Image From Batch Index",
}
