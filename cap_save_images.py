from __future__ import annotations
import os
import numpy as np
from PIL import Image
from datetime import datetime


class CAP_SaveImages:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images":    ("IMAGE",),
                "directory": ("STRING", {"default": "./output"}),
                "filename":  ("STRING", {"default": "img_{index}.png"}),
                "quality":   ("INT",    {"default": 80,  "min": 1, "max": 100,  "step": 1}),
                "dpi":       ("INT",    {"default": 300, "min": 1, "max": 2400, "step": 1}),
            },
            "optional": {
                "metadata": ("STRING", {"default": ""}),
            },
        }

    RETURN_TYPES  = ("STRING", "STRING")
    RETURN_NAMES  = ("image_dir", "image_paths")
    FUNCTION      = "save_images"
    OUTPUT_NODE   = True
    CATEGORY      = "Capricorncd"
    DESCRIPTION   = (
        "Save a batch of images to disk. "
        "directory supports strftime format strings (e.g. ./output/%Y%m%d). "
        "filename must contain {index} as a placeholder (zero-padded to 5 digits). "
        "Returns the resolved save directory and a comma-separated list of saved paths."
    )

    def save_images(self, images, directory, filename, quality, dpi, metadata=""):
        save_dir = datetime.now().strftime(directory)
        os.makedirs(save_dir, exist_ok=True)

        if not isinstance(metadata, str):
            metadata = str(metadata)

        saved_paths = []
        for image in images:
            img = Image.fromarray((image.cpu().numpy() * 255).astype(np.uint8))

            # Find the next available index so we never overwrite an existing file.
            index = 0
            while True:
                path = os.path.join(save_dir, filename.format(index=f"{index:05d}"))
                if not os.path.exists(path):
                    break
                index += 1

            img.save(path, quality=quality, dpi=(dpi, dpi), comment=metadata)
            del image
            saved_paths.append(path)

        return (save_dir, ", ".join(saved_paths))


NODE_CLASS_MAPPINGS       = {"CAP_SaveImages": CAP_SaveImages}
NODE_DISPLAY_NAME_MAPPINGS = {"CAP_SaveImages": "Save Images"}
