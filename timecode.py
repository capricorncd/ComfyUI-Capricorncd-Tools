"""Timecode helpers: mm:ss.ff or hh:mm:ss.ff (frame index at given fps)."""
from __future__ import annotations

import re


def parse_timecode(value: str, fps: int = 24) -> int:
    """Parse timecode string to milliseconds."""
    if value is None:
        return 0
    text = str(value).strip()
    if not text:
        return 0

    fps = max(1, int(fps))
    parts = text.split(":")
    if len(parts) not in (2, 3):
        raise ValueError(f"Invalid timecode: {value}")

    try:
        if len(parts) == 2:
            minutes = int(parts[0])
            sec_part = parts[1]
            hours = 0
        else:
            hours = int(parts[0])
            minutes = int(parts[1])
            sec_part = parts[2]

        if "." in sec_part:
            seconds_str, frame_str = sec_part.split(".", 1)
            seconds = int(seconds_str)
            frames = int(frame_str)
        else:
            seconds = int(sec_part)
            frames = 0

        if frames < 0 or frames >= fps:
            raise ValueError(f"Frame index must be 0..{fps - 1}")

        total_seconds = hours * 3600 + minutes * 60 + seconds + frames / fps
        return max(0, int(round(total_seconds * 1000)))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid timecode: {value}") from exc


def format_timecode(ms: int, fps: int = 24) -> str:
    """Format milliseconds as mm:ss.ff or hh:mm:ss.ff when >= 1 hour."""
    fps = max(1, int(fps))
    ms = max(0, int(ms))
    total_frames = int(round(ms * fps / 1000))
    frames = total_frames % fps
    total_seconds = total_frames // fps
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    seconds = total_seconds % 60
    sec_part = f"{seconds:02d}.{frames:02d}"
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{sec_part}"
    return f"{minutes:02d}:{sec_part}"


def resolve_keyframe_dir(path: str) -> str:
    """Resolve keyframe directory to an absolute path under ComfyUI folders when relative."""
    import folder_paths
    import os

    path = (path or "").strip()
    if not path:
        return ""

    if os.path.isabs(path):
        return os.path.normpath(path)

    for base in (
        folder_paths.get_input_directory(),
        folder_paths.get_output_directory(),
        os.getcwd(),
    ):
        candidate = os.path.normpath(os.path.join(base, path))
        if os.path.isdir(candidate):
            return candidate

    return os.path.normpath(os.path.join(folder_paths.get_input_directory(), path))


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}


def _natural_sort_key(name: str):
    """Sort RB_00001.jpg before RB_00010.jpg; arbitrary names still order stably."""
    parts = re.split(r"(\d+)", name.lower())
    return [int(p) if p.isdigit() else p for p in parts]


def list_keyframe_files_ordered(directory: str) -> list[str]:
    """List image files in directory, ordered for use as keyframe sequence (index 0, 1, 2…)."""
    import os

    directory = resolve_keyframe_dir(directory)
    if not directory or not os.path.isdir(directory):
        return []

    files: list[str] = []
    for name in os.listdir(directory):
        _, ext = os.path.splitext(name)
        if ext.lower() not in IMAGE_EXTENSIONS:
            continue
        files.append(name)

    files.sort(key=_natural_sort_key)
    return files


# Backward-compatible alias
def list_keyframe_images(directory: str) -> dict[int, str]:
    files = list_keyframe_files_ordered(directory)
    return {i: name for i, name in enumerate(files)}


def required_keyframe_image_count(anchor_count: int, one_shot: bool) -> int:
    """Match AudioKeyframeTimelineUI._getRequiredKeyframeImageCount."""
    if anchor_count <= 0:
        return 0
    if one_shot:
        return anchor_count
    user_count = max(0, anchor_count - 2)
    return 2 * user_count + 2


def expand_keyframe_files(source_files: list[str], required_count: int) -> list[str]:
    """Match AudioKeyframeTimelineUI._expandKeyframeFiles (cycle when too few images)."""
    if not source_files or required_count <= 0:
        return []
    if len(source_files) >= required_count:
        return source_files[:required_count]
    return [source_files[i % len(source_files)] for i in range(required_count)]
