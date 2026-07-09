from __future__ import annotations

ASPECT_RATIOS = ("1:1", "2:3", "3:4", "3:5", "4:7", "9:16", "9:21")
RESOLUTIONS = ("480P", "720P", "1K", "2K", "4K", "8K")
ORIENTATIONS = ("竖屏", "横屏")

_RATIO_PARTS = {
    "1:1": (1, 1),
    "2:3": (2, 3),
    "3:4": (3, 4),
    "3:5": (3, 5),
    "4:7": (4, 7),
    "9:16": (9, 16),
    "9:21": (9, 21),
}

_LONG_EDGE = {
    "480P": 854,
    "720P": 1280,
    "1K": 1920,
    "2K": 2560,
    "4K": 3840,
    "8K": 7680,
}

_SQUARE_EDGE = {
    "480P": 512,
    "720P": 720,
    "1K": 1024,
    "2K": 2048,
    "4K": 4096,
    "8K": 8192,
}


def _align8(value: int) -> int:
    return max(8, int(round(value / 8)) * 8)


def _effective_ratio(aspect_ratio: str, orientation: str) -> tuple[int, int]:
    rw, rh = _RATIO_PARTS[aspect_ratio]
    if aspect_ratio == "1:1":
        return 1, 1
    if orientation == "横屏":
        return rh, rw
    return rw, rh


def _size_from_ratio(aspect_ratio: str, resolution: str, orientation: str) -> tuple[int, int]:
    rw, rh = _effective_ratio(aspect_ratio, orientation)
    if rw == rh == 1:
        edge = _align8(_SQUARE_EDGE[resolution])
        return edge, edge

    long_edge = _LONG_EDGE[resolution]
    if rw > rh:
        width = long_edge
        height = _align8(width * rh / rw)
        return _align8(width), height

    height = long_edge
    width = _align8(height * rw / rh)
    return width, _align8(height)


class CAP_SizeSettings:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "aspect_ratio": (ASPECT_RATIOS, {"default": "9:16"}),
                "resolution": (RESOLUTIONS, {"default": "1K"}),
                "orientation": (ORIENTATIONS, {"default": "竖屏"}),
                "custom_width": ("INT", {"default": 1080, "min": 64, "max": 16384, "step": 8}),
                "custom_height": ("INT", {"default": 1920, "min": 64, "max": 16384, "step": 8}),
                "count": ("INT", {"default": 1, "min": 1, "max": 4096, "step": 1}),
            },
        }

    RETURN_TYPES = ("INT", "INT", "INT")
    RETURN_NAMES = ("width", "height", "count")
    FUNCTION = "execute"
    CATEGORY = "Capricorncd"
    DESCRIPTION = (
        "Output width and height from aspect ratio, resolution tier, orientation, "
        "or manually edited custom dimensions."
    )

    def execute(
        self,
        aspect_ratio: str,
        resolution: str,
        orientation: str,
        custom_width: int,
        custom_height: int,
        count: int,
    ):
        del aspect_ratio, resolution, orientation
        return _align8(int(custom_width)), _align8(int(custom_height)), max(1, int(count))


NODE_CLASS_MAPPINGS = {
    "CAP_SizeSettings": CAP_SizeSettings,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CAP_SizeSettings": "Size Settings",
}
