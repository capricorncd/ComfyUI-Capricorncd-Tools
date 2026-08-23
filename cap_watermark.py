"""Font discovery helpers for the Timeline Editor's compose-video watermark."""

from __future__ import annotations

import os
import sys
from functools import lru_cache

_FONT_EXTS = (".ttf", ".ttc", ".otf")

_STYLE_RANK = {"regular": 0, "normal": 0, "book": 1}


def _font_search_dirs() -> list[str]:
    dirs: list[str] = []
    if sys.platform == "win32":
        windir = os.environ.get("WINDIR", "C:\\Windows")
        dirs.append(os.path.join(windir, "Fonts"))
        local_appdata = os.environ.get("LOCALAPPDATA")
        if local_appdata:
            dirs.append(os.path.join(local_appdata, "Microsoft", "Windows", "Fonts"))
    elif sys.platform == "darwin":
        dirs += [
            "/System/Library/Fonts",
            "/Library/Fonts",
            os.path.expanduser("~/Library/Fonts"),
        ]
    else:
        dirs += [
            "/usr/share/fonts",
            "/usr/local/share/fonts",
            os.path.expanduser("~/.fonts"),
            os.path.expanduser("~/.local/share/fonts"),
        ]
    return [d for d in dirs if d and os.path.isdir(d)]


def _walk_font_files(root: str):
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            if os.path.splitext(name)[1].lower() in _FONT_EXTS:
                yield os.path.join(dirpath, name)


def _style_rank(style: str) -> int:
    return _STYLE_RANK.get((style or "").strip().lower(), 5)


@lru_cache(maxsize=1)
def list_system_fonts() -> tuple[dict, ...]:
    """Scan OS font directories once per process and return one entry per
    family (preferring the Regular/Normal style when a family has several)."""
    from PIL import ImageFont

    by_family: dict[str, tuple[int, dict]] = {}
    for root in _font_search_dirs():
        for path in _walk_font_files(root):
            try:
                font = ImageFont.truetype(path, 10)
                family, style = font.getname()
            except Exception:
                continue
            family = (family or "").strip()
            if not family:
                continue
            rank = _style_rank(style)
            existing = by_family.get(family)
            if existing is None or rank < existing[0]:
                by_family[family] = (rank, {"family": family, "path": path.replace("\\", "/")})
    return tuple(sorted((v[1] for v in by_family.values()), key=lambda x: x["family"].lower()))


_FALLBACK_CANDIDATES: dict[str, list[str]] = {
    "win32": [
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arial.ttf",
    ],
    "darwin": [
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/Helvetica.ttc",
    ],
}
_DEFAULT_FALLBACKS = [
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
]


def resolve_font_path(candidate: str) -> str:
    """Validate a client-supplied font path, falling back to a known system
    font (or the first discovered one) if it's missing or empty."""
    candidate = str(candidate or "").strip()
    if candidate and os.path.isfile(candidate):
        return candidate
    for path in _FALLBACK_CANDIDATES.get(sys.platform, []) + _DEFAULT_FALLBACKS:
        if os.path.isfile(path):
            return path
    fonts = list_system_fonts()
    if fonts:
        return fonts[0]["path"]
    return ""
