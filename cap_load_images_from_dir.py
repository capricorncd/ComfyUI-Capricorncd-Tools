from __future__ import annotations

import hashlib
import os

import numpy as np
import torch
from PIL import Image, ImageOps

from .timecode import list_image_files_ordered, resolve_assets_dir


def _load_rgb_image(path: str) -> torch.Tensor:
    img = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    arr = np.array(img).astype(np.float32) / 255.0
    return torch.from_numpy(arr)


class CAP_LoadImagesFromDir:
    """Load images from a directory into an IMAGE batch."""

    DOC_SLUG = "load-images-from-dir"
    OUTPUT_TOOLTIPS = {
        "images": "Loaded IMAGE batch (all frames must share the same size)",
        "directory": "Resolved absolute directory path",
        "total_count": "Total image files found before start_index / max_count slicing",
        "count": "Number of images actually loaded into the batch",
    }

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "directory": ("STRING", {
                    "default": "",
                    "tooltip": "Directory containing images (absolute or under assets)",
                }),
                "deep": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "When enabled, include images from subdirectories",
                }),
                "start_index": ("INT", {
                    "default": 0,
                    "min": 0,
                    "max": 999999,
                    "tooltip": "Zero-based index of the first image to load",
                }),
                "max_count": (
                    "INT",
                    {
                        "default": -1,
                        "min": -1,
                        "max": 999999,
                        "tooltip": "-1 loads all images from start_index onward",
                    },
                ),
            },
        }

    RETURN_TYPES = ("IMAGE", "STRING", "INT", "INT")
    RETURN_NAMES = ("images", "directory", "total_count", "count")
    FUNCTION = "execute"
    CATEGORY = "Capricorncd"
    DESCRIPTION = (
        "Load images from a directory into an IMAGE batch. "
        "When deep is enabled, subdirectories are included. "
        "Use start_index and max_count to limit which files are loaded."
    )

    @classmethod
    def IS_CHANGED(cls, directory, deep, start_index, max_count):
        resolved = resolve_assets_dir(directory)
        if not resolved or not os.path.isdir(resolved):
            return (directory, deep, start_index, max_count)
        rel_files = list_image_files_ordered(directory, recursive=bool(deep))
        digest = hashlib.sha256()
        digest.update(str(directory).encode())
        digest.update(str(bool(deep)).encode())
        digest.update(str(start_index).encode())
        digest.update(str(max_count).encode())
        for rel in rel_files:
            path = os.path.join(resolved, rel.replace("/", os.sep))
            digest.update(rel.encode())
            try:
                digest.update(str(os.path.getmtime(path)).encode())
            except OSError:
                pass
        return digest.hexdigest()

    @classmethod
    def VALIDATE_INPUTS(cls, directory, **_):
        resolved = resolve_assets_dir(directory)
        if not resolved:
            return "Directory path is empty"
        if not os.path.isdir(resolved):
            return f"Directory not found: {directory}"
        return True

    def execute(self, directory, deep, start_index, max_count):
        resolved = resolve_assets_dir(directory)
        rel_files = list_image_files_ordered(directory, recursive=bool(deep))
        if not rel_files:
            raise ValueError(f"No image files found in directory: {directory}")

        total_count = len(rel_files)
        start = max(0, int(start_index))
        if start >= total_count:
            raise ValueError(
                f"start_index {start_index} is out of range (total {total_count})"
            )

        if int(max_count) < 0:
            rel_files = rel_files[start:]
        else:
            rel_files = rel_files[start:start + int(max_count)]

        if not rel_files:
            raise ValueError("No images selected with the given start_index and max_count")

        images = []
        width = height = None
        for rel in rel_files:
            path = os.path.join(resolved, rel.replace("/", os.sep))
            tensor = _load_rgb_image(path)
            h, w = int(tensor.shape[0]), int(tensor.shape[1])
            if width is None:
                width, height = w, h
            elif w != width or h != height:
                raise ValueError(
                    f"Image size mismatch in {rel}: expected {width}x{height}, got {w}x{h}"
                )
            images.append(tensor)

        batch = torch.stack(images, dim=0)
        return (batch, resolved, total_count, int(batch.shape[0]))


NODE_CLASS_MAPPINGS = {"CAP_LoadImagesFromDir": CAP_LoadImagesFromDir}
NODE_DISPLAY_NAME_MAPPINGS = {"CAP_LoadImagesFromDir": "Load Images From Dir"}
