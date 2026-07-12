from __future__ import annotations

import os
import zipfile
from datetime import datetime

import folder_paths
import numpy as np
from PIL import Image


class CAP_SaveImages:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "filename_prefix": ("STRING", {
                    "default": "temp/cap-save-images/%Y%m%d_%H%M%S/CSI",
                }),
                "filename": ("STRING", {"default": "{prefix}_{index}.png"}),
                "quality": ("INT", {"default": 80, "min": 1, "max": 100, "step": 1}),
                "dpi": ("INT", {"default": 300, "min": 1, "max": 2400, "step": 1}),
                "save_as_zip": ("BOOLEAN", {"default": False, "label_on": "打包 zip", "label_off": "仅图片"}),
            },
            "optional": {
                "metadata": ("STRING", {"default": ""}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("image_dir", "image_paths")
    FUNCTION = "save_images"
    OUTPUT_NODE = True
    CATEGORY = "Capricorncd"
    DESCRIPTION = (
        "Save a batch of images under ComfyUI's output directory. "
        "filename_prefix is relative to output and supports strftime "
        "(e.g. temp/cap-save-images/%Y%m%d_%H%M%S/CSI). "
        "The last path segment is the file name prefix; earlier segments are subfolders. "
        "filename supports {prefix} and {index} (zero-padded to 5 digits). "
        "When save_as_zip is true, also pack the saved images into a zip next to the folder."
    )

    def _resolve_save_dir(self, filename_prefix: str) -> tuple[str, str]:
        output_dir = os.path.abspath(folder_paths.get_output_directory())
        resolved = datetime.now().strftime((filename_prefix or "CSI").strip())
        for lead in ("output/", "output\\", "./output/", "./output\\"):
            if resolved.startswith(lead):
                resolved = resolved[len(lead):]
                break

        resolved = os.path.normpath(resolved.replace("\\", "/"))
        if resolved in (".", ""):
            resolved = "CSI"

        subfolder = os.path.dirname(resolved)
        name_prefix = os.path.basename(resolved) or "CSI"
        save_dir = os.path.join(output_dir, subfolder) if subfolder else output_dir
        save_dir = os.path.abspath(save_dir)

        if os.path.commonpath((output_dir, save_dir)) != output_dir:
            raise Exception(
                "Saving image outside the output folder is not allowed.\n"
                f" save_dir: {save_dir}\n"
                f" output_dir: {output_dir}"
            )
        return save_dir, name_prefix

    def save_images(self, images, filename_prefix, filename, quality, dpi, save_as_zip=False, metadata=""):
        save_dir, name_prefix = self._resolve_save_dir(filename_prefix)
        os.makedirs(save_dir, exist_ok=True)

        if not isinstance(metadata, str):
            metadata = str(metadata)

        saved_paths = []
        for image in images:
            img = Image.fromarray((image.cpu().numpy() * 255).astype(np.uint8))

            index = 0
            while True:
                path = os.path.join(
                    save_dir,
                    filename.format(index=f"{index:05d}", prefix=name_prefix),
                )
                if not os.path.exists(path):
                    break
                index += 1

            img.save(path, quality=quality, dpi=(dpi, dpi), comment=metadata)
            del image
            saved_paths.append(path)

        if save_as_zip and saved_paths:
            zip_path = f"{save_dir.rstrip('/\\')}.zip"
            with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
                for path in saved_paths:
                    zf.write(path, arcname=os.path.basename(path))

        return (save_dir, ", ".join(saved_paths))


NODE_CLASS_MAPPINGS = {"CAP_SaveImages": CAP_SaveImages}
NODE_DISPLAY_NAME_MAPPINGS = {"CAP_SaveImages": "Save Images"}
