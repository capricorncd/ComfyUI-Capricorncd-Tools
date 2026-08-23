"""Font discovery helpers for the Timeline Editor's compose-video watermark."""

from __future__ import annotations

import os
import re
import sys
from functools import lru_cache

_FONT_EXTS = (".ttf", ".ttc", ".otf")
# Hiragana/Katakana, CJK unified ideographs (+ext A), CJK compatibility
# ideographs, Hangul syllables — enough to detect "this string is actually
# CJK text" without needing a full Unicode script database.
_CJK_RE = re.compile(
    "[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7a3]"
)

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


def _looks_garbled(name: str) -> bool:
    """Some (mostly older CJK) font files only carry a name-table entry in a
    legacy encoding that FreeType/Pillow decodes with the wrong codec —
    instead of raising, it substitutes '?' (or the Unicode replacement
    character) for each byte it can't map, so the family name comes out as
    strings of literal '?'. Real font family names never contain '?', so
    filter those out rather than showing unusable garbage in the picker."""
    return "?" in name or "\ufffd" in name


def _display_name(family: str, path: str) -> str:
    """Prefer the font's own family name, but some (mostly Chinese) font
    files carry only a terse PostScript-style name in their name table
    (e.g. "FZZJ-XTCSJW") while the file itself was given a proper, readable
    name — fall back to the filename (minus extension) whenever it's
    clearly more informative (contains CJK text the internal name lacks)."""
    if _CJK_RE.search(family):
        return family
    base = os.path.splitext(os.path.basename(path))[0].strip()
    if base and _CJK_RE.search(base):
        return base
    return family


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
            if not family or _looks_garbled(family):
                continue
            family = _display_name(family, path)
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
