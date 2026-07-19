from __future__ import annotations

import os
import zipfile
from datetime import datetime

import folder_paths
import numpy as np
from PIL import Image


class CAP_SaveImages:
    """Save an IMAGE batch to disk (relative under output, or absolute anywhere)."""

    DOC_SLUG = "save-images"
    OUTPUT_TOOLTIPS = {
        "image_dir": "Absolute path of the directory where images were saved",
        "image_paths": "Comma-separated list of saved file paths",
    }

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE", {
                    "tooltip": "Batch of images to save",
                }),
                "filename_prefix": ("STRING", {
                    "default": "temp/cap-save-images/%Y%m%d_%H%M%S/CSI",
                    "tooltip": (
                        "Relative to ComfyUI output: earlier segments are subfolders, "
                        "last segment is the file prefix. "
                        "An absolute path is the save directory anywhere on disk "
                        "(prefix defaults to CSI). Supports strftime."
                    ),
                }),
                "filename": ("STRING", {
                    "default": "{prefix}_{index}.png",
                    "tooltip": "File name template with {prefix} and {index} (zero-padded to 5 digits)",
                }),
                "quality": ("INT", {
                    "default": 80,
                    "min": 1,
                    "max": 100,
                    "step": 1,
                    "tooltip": "JPEG quality (1–100); for PNG mapped to zlib compression",
                }),
                "dpi": ("INT", {
                    "default": 300,
                    "min": 1,
                    "max": 2400,
                    "step": 1,
                    "tooltip": "DPI metadata written to the image file",
                }),
                "save_as_zip": ("BOOLEAN", {
                    "default": False,
                    "label_on": "打包 zip",
                    "label_off": "仅图片",
                    "tooltip": "Also pack saved images into a zip next to the folder",
                }),
            },
            "optional": {
                "metadata": ("STRING", {
                    "default": "",
                    "tooltip": "String written to the file comment metadata field",
                }),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("image_dir", "image_paths")
    FUNCTION = "save_images"
    OUTPUT_NODE = True
    CATEGORY = "Capricorncd"
    DESCRIPTION = (
        "Save a batch of images to disk. "
        "Relative filename_prefix is under ComfyUI output (last segment = file prefix). "
        "Absolute filename_prefix is the save directory anywhere on disk "
        "(file prefix defaults to CSI). Supports strftime. "
        "filename supports {prefix} and {index} (zero-padded to 5 digits). "
        "When save_as_zip is true, also pack the saved images into a zip next to the folder."
    )

    def _resolve_save_dir(self, filename_prefix: str) -> tuple[str, str]:
        output_dir = os.path.abspath(folder_paths.get_output_directory())
        raw = datetime.now().strftime((filename_prefix or "CSI").strip())

        if os.path.isabs(raw):
            # Absolute path = save directory anywhere on disk.
            save_dir = os.path.abspath(os.path.normpath(raw))
            name_prefix = "CSI"
            return save_dir, name_prefix

        resolved = raw
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

        try:
            under_output = os.path.commonpath((output_dir, save_dir)) == output_dir
        except ValueError:
            under_output = False
        if not under_output:
            raise Exception(
                "Relative filename_prefix must resolve under the ComfyUI output folder.\n"
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
            save_dir_stripped = save_dir.rstrip("/\\")
            zip_path = f"{save_dir_stripped}.zip"
            with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
                for path in saved_paths:
                    zf.write(path, arcname=os.path.basename(path))

        return (save_dir, ", ".join(saved_paths))


NODE_CLASS_MAPPINGS = {"CAP_SaveImages": CAP_SaveImages}
NODE_DISPLAY_NAME_MAPPINGS = {"CAP_SaveImages": "Save Images"}
