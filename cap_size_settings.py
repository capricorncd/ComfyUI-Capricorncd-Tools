from __future__ import annotations

SIZE_PRESETS = (
    "704x1280 (11:20)",
    "720x1280 (9:16)",
    "768x1024 (3:4)",
    "768x1280 (3:5)",
    "768x1344 (4:7)",
    "1024x1024 (1:1)",
    "1080x2560 (9:21)",
)

ORIENTATIONS = ("纵向", "横向")

# Portrait (纵向) base sizes for each preset label.
_SIZE_BASE = {
    "704x1280 (11:20)": (704, 1280),
    "720x1280 (9:16)": (720, 1280),
    "768x1024 (3:4)": (768, 1024),
    "768x1280 (3:5)": (768, 1280),
    "768x1344 (4:7)": (768, 1344),
    "1024x1024 (1:1)": (1024, 1024),
    "1080x2560 (9:21)": (1080, 2560),
}

DEFAULT_SIZE = "720x1280 (9:16)"


def _align8(value: int) -> int:
    return max(8, int(round(value / 8)) * 8)


def size_from_preset(size: str, scale: float, orientation: str) -> tuple[int, int]:
    width, height = _SIZE_BASE.get(size, _SIZE_BASE[DEFAULT_SIZE])
    if orientation == "横向" and width != height:
        width, height = height, width
    scale = max(0.01, float(scale))
    return _align8(width * scale), _align8(height * scale)


class CAP_SizeSettings:
    """Output canvas size, count, and fps from size presets and custom dimensions."""

    DOC_SLUG = "size-settings"
    OUTPUT_TOOLTIPS = {
        "width": "Final width aligned to a multiple of 8",
        "height": "Final height aligned to a multiple of 8",
        "count": "Pass-through integer (batch size, loop count, etc.)",
        "fps": "Frames per second (float)",
        "fps_int": "Frames per second rounded to int",
    }

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "size": (SIZE_PRESETS, {
                    "default": "720x1280 (9:16)",
                    "tooltip": "Base canvas size preset (portrait dimensions shown)",
                }),
                "scale": ("FLOAT", {
                    "default": 1.0,
                    "min": 0.01,
                    "max": 8.0,
                    "step": 0.01,
                    "tooltip": "Multiplier applied to the size preset",
                }),
                "lock_aspect": ("BOOLEAN", {
                    "default": True,
                    "label_on": "锁定",
                    "label_off": "自由",
                    "tooltip": "When locked, editing width updates height (and vice versa) to keep the aspect ratio",
                }),
                "orientation": (ORIENTATIONS, {
                    "default": "纵向",
                    "tooltip": "纵向 keeps preset WxH; 横向 swaps width and height",
                }),
                "custom_width": ("INT", {
                    "default": 720,
                    "min": 64,
                    "max": 16384,
                    "step": 8,
                    "tooltip": "Width used at run time (aligned to multiples of 8)",
                }),
                "custom_height": ("INT", {
                    "default": 1280,
                    "min": 64,
                    "max": 16384,
                    "step": 8,
                    "tooltip": "Height used at run time (aligned to multiples of 8)",
                }),
                "fps": ("FLOAT", {
                    "default": 24.0,
                    "min": 1.0,
                    "max": 240.0,
                    "step": 0.01,
                    "tooltip": "Frames per second",
                }),
                "count": ("INT", {
                    "default": 1,
                    "min": 1,
                    "max": 4096,
                    "step": 1,
                    "tooltip": "Reusable integer output (e.g. batch size or loop count)",
                }),
            },
        }

    RETURN_TYPES = ("INT", "INT", "INT", "FLOAT", "INT")
    RETURN_NAMES = ("width", "height", "count", "fps", "fps_int")
    FUNCTION = "execute"
    CATEGORY = "Capricorncd"
    DESCRIPTION = (
        "Output width, height, count, and fps (float + int) from size presets, "
        "scale, orientation, and optionally locked custom dimensions."
    )

    def execute(
        self,
        size: str,
        scale: float,
        lock_aspect: bool,
        orientation: str,
        custom_width: int,
        custom_height: int,
        fps: float,
        count: int,
    ):
        del size, scale, lock_aspect, orientation
        fps_f = max(1.0, float(fps))
        return (
            _align8(int(custom_width)),
            _align8(int(custom_height)),
            max(1, int(count)),
            fps_f,
            max(1, int(round(fps_f))),
        )


NODE_CLASS_MAPPINGS = {
    "CAP_SizeSettings": CAP_SizeSettings,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CAP_SizeSettings": "Size Settings",
}
