"""Compose Timeline Editor generated videos (+ unmuted audio) into one MP4."""

from __future__ import annotations

import logging
import os
import re
import shutil
from typing import Any

import folder_paths

from .cap_compose_clip_videos import _probe_has_audio, _run_ffmpeg
from .cap_seq_to_video import _ffmpeg_path
from .cap_timeline_project_io import _safe_name
from .timecode import resolve_media_path

log = logging.getLogger(__name__)


def _as_dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> list:
    return value if isinstance(value, list) else []


def _ms(value: Any, default: int = 0) -> int:
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return default


def _resolve_output_video(rel: str) -> str:
    rel = str(rel or "").strip().replace("\\", "/").lstrip("/")
    if not rel:
        return ""
    root = os.path.abspath(folder_paths.get_output_directory())
    path = os.path.abspath(os.path.join(root, *rel.split("/")))
    if path != root and not path.startswith(root + os.sep):
        raise ValueError(f"生成视频路径非法: {rel}")
    return path if os.path.isfile(path) else ""


def _media_by_id(project: dict) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for row in _as_list(project.get("media")):
        if not isinstance(row, dict):
            continue
        mid = str(row.get("id") or "").strip()
        if mid:
            out[mid] = row
    return out


def _first_enabled_generated(clip: dict) -> dict | None:
    for row in _as_list(clip.get("generated_videos")):
        if not isinstance(row, dict):
            continue
        if row.get("enabled", True) is False:
            continue
        file = str(row.get("file") or "").strip().replace("\\", "/")
        if file:
            return {
                "file": file,
                "muted": row.get("muted") is True,
            }
    return None


def _clip_audio_file(clip: dict, media_map: dict[str, dict]) -> str:
    for mid in _as_list(clip.get("media_ids")):
        row = media_map.get(str(mid or ""))
        if isinstance(row, dict) and str(row.get("kind") or "").lower() == "audio":
            file = str(row.get("file") or "").strip()
            if file:
                return file
    source = _as_dict(clip.get("source"))
    file = str(source.get("file") or clip.get("audio_file") or "").strip()
    return file


def _collect_plan(project: dict, ignore_audio_tracks: bool = False) -> dict:
    settings = _as_dict(project.get("settings"))
    width = max(16, int(settings.get("width") or 1344))
    height = max(16, int(settings.get("height") or 768))
    fps = max(1.0, float(settings.get("fps") or 24.0))
    media_map = _media_by_id(project)

    tracks = [t for t in _as_list(project.get("tracks")) if isinstance(t, dict)]
    tracks.sort(key=lambda t: int(t.get("order", 0) or 0))

    video_segs: list[dict] = []
    audio_segs: list[dict] = []
    end_ms = 0

    for track in tracks:
        track_type = str(track.get("type") or "").lower()
        enabled = track.get("enabled", True) is not False
        if not enabled:
            continue

        if track_type in ("visual", "image", "video", ""):
            if track.get("visible", True) is False:
                continue
            for clip in _as_list(track.get("clips")):
                if not isinstance(clip, dict):
                    continue
                if clip.get("enabled", True) is False:
                    continue
                if clip.get("visible", True) is False:
                    continue
                gen = _first_enabled_generated(clip)
                if not gen:
                    continue
                path = _resolve_output_video(gen["file"])
                if not path:
                    raise ValueError(f"找不到生成视频: {gen['file']}")
                start = _ms(clip.get("start_ms"))
                duration = max(1, _ms(clip.get("duration_ms"), 1))
                end = start + duration
                end_ms = max(end_ms, end)
                video_segs.append({
                    "path": path,
                    # Timeline placement for this clip: [start_sec, end_sec].
                    "start_sec": start / 1000.0,
                    "duration_sec": duration / 1000.0,
                    "end_sec": end / 1000.0,
                    "muted": bool(gen["muted"]),
                })
            continue

        if ignore_audio_tracks or track_type != "audio":
            continue
        if track.get("muted"):
            continue
        for clip in _as_list(track.get("clips")):
            if not isinstance(clip, dict):
                continue
            if clip.get("enabled", True) is False:
                continue
            if clip.get("muted"):
                continue
            file = _clip_audio_file(clip, media_map)
            if not file:
                continue
            path = resolve_media_path(file, location="input")
            if not path or not os.path.isfile(path):
                raise ValueError(f"找不到音频文件: {file}")
            start = _ms(clip.get("start_ms"))
            duration = max(1, _ms(clip.get("duration_ms"), 1))
            source = _as_dict(clip.get("source"))
            source_in = _ms(source.get("in_ms"))
            end = start + duration
            end_ms = max(end_ms, end)
            audio_segs.append({
                "path": path,
                "start_sec": start / 1000.0,
                "duration_sec": duration / 1000.0,
                "source_in_sec": source_in / 1000.0,
            })

    if not video_segs:
        raise ValueError("没有可合成的生成视频（请先为 clip 添加并启用生成视频）")

    return {
        "width": width,
        "height": height,
        "fps": fps,
        "total_sec": max(end_ms / 1000.0, 0.1),
        "video_segs": video_segs,
        "audio_segs": audio_segs,
    }


def _escape_enable(start: float, end: float) -> str:
    return f"between(t\\,{start:.6f}\\,{end:.6f})"


def compose_timeline_project(
    project: dict,
    output_path: str,
    ignore_audio_tracks: bool = False,
) -> dict:
    if not shutil.which("ffmpeg"):
        raise RuntimeError("未找到 ffmpeg，请先安装并加入 PATH")
    if not isinstance(project, dict):
        raise ValueError("无效的项目数据")

    plan = _collect_plan(project, ignore_audio_tracks=bool(ignore_audio_tracks))
    width = plan["width"]
    height = plan["height"]
    fps = plan["fps"]
    total = plan["total_sec"]
    # Bottom→top paint order: earlier tracks first, then later overlays.
    video_segs = list(plan["video_segs"])
    audio_segs = plan["audio_segs"]

    os.makedirs(os.path.dirname(os.path.abspath(output_path)) or ".", exist_ok=True)

    cmd: list[str] = [
        "ffmpeg", "-y",
        "-f", "lavfi",
        "-i", f"color=c=black:s={width}x{height}:d={total:.6f}:r={fps}",
    ]
    for seg in video_segs:
        cmd += ["-i", _ffmpeg_path(seg["path"])]
    audio_input_offset = 1 + len(video_segs)
    for seg in audio_segs:
        cmd += ["-i", _ffmpeg_path(seg["path"])]

    filters: list[str] = []
    for i, seg in enumerate(video_segs):
        idx = i + 1
        start = float(seg["start_sec"])
        dur = float(seg["duration_sec"])
        # Clip window on the timeline: [start, start+dur].
        # Take the first `dur` seconds of the generated video and put that
        # content into the clip's time range (start → end).
        filters.append(
            f"[{idx}:v]trim=0:{dur:.6f},setpts=PTS-STARTPTS+{start:.6f}/TB,"
            f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps},"
            f"format=yuv420p[v{i}]"
        )

    prev = "0:v"
    for i, seg in enumerate(video_segs):
        out = f"ov{i}"
        # Only show this clip between its timeline start and end.
        enable = _escape_enable(seg["start_sec"], seg["end_sec"])
        filters.append(
            f"[{prev}][v{i}]overlay=0:0:eof_action=pass:repeatlast=0:enable='{enable}'[{out}]"
        )
        prev = out
    filters.append(f"[{prev}]format=yuv420p[vout]")

    amix_labels: list[str] = []
    for i, seg in enumerate(video_segs):
        if seg["muted"]:
            continue
        idx = i + 1
        if not _probe_has_audio(seg["path"]):
            continue
        delay_ms = max(0, int(round(seg["start_sec"] * 1000)))
        label = f"ga{i}"
        filters.append(
            f"[{idx}:a]atrim=0:{seg['duration_sec']:.6f},asetpts=PTS-STARTPTS,"
            f"adelay={delay_ms}|{delay_ms}[{label}]"
        )
        amix_labels.append(label)

    for j, seg in enumerate(audio_segs):
        idx = audio_input_offset + j
        delay_ms = max(0, int(round(seg["start_sec"] * 1000)))
        label = f"aa{j}"
        filters.append(
            f"[{idx}:a]atrim=start={seg['source_in_sec']:.6f}:duration={seg['duration_sec']:.6f},"
            f"asetpts=PTS-STARTPTS,adelay={delay_ms}|{delay_ms}[{label}]"
        )
        amix_labels.append(label)

    map_args: list[str] = ["-map", "[vout]"]
    if amix_labels:
        if len(amix_labels) == 1:
            a_map = f"[{amix_labels[0]}]"
        else:
            joined = "".join(f"[{name}]" for name in amix_labels)
            filters.append(
                f"{joined}amix=inputs={len(amix_labels)}:duration=longest:normalize=0[aout]"
            )
            a_map = "[aout]"
        map_args += ["-map", a_map, "-c:a", "aac", "-b:a", "192k"]
    else:
        map_args.append("-an")

    cmd += [
        "-filter_complex", ";".join(filters),
        *map_args,
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-r", str(fps),
        "-t", f"{total:.6f}",
        "-movflags", "+faststart",
        _ffmpeg_path(output_path),
    ]
    log.info(
        "[compose_timeline] %d video + %d audio -> %s",
        len(video_segs),
        len(audio_segs),
        output_path,
    )
    log.debug("[compose_timeline] ffmpeg: %s", " ".join(cmd))
    _run_ffmpeg(cmd)
    return {
        "width": width,
        "height": height,
        "fps": fps,
        "duration_sec": total,
        "video_count": len(video_segs),
        "audio_count": len(audio_segs) + sum(1 for s in video_segs if not s["muted"]),
        "output_path": output_path,
    }


def build_compose_filename(project_name: str, stamp: str | None = None) -> str:
    import datetime
    safe = _safe_name(project_name, "未命名项目")
    safe = re.sub(r"\s+", "_", safe)
    if not stamp:
        stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    stamp = re.sub(r"[^0-9_]", "", str(stamp)) or datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"{safe}_{stamp}.mp4"


DEFAULT_COMPOSE_PREFIX = "cap_timeline_compose/"


def _safe_under_output(candidate: str) -> str:
    from .cap_compose_clip_videos import _safe_under
    root = os.path.abspath(folder_paths.get_output_directory())
    return _safe_under(root, candidate)


def resolve_compose_output_path(
    filename_prefix: str,
    project_name: str,
    filename: str | None = None,
) -> tuple[str, str, str]:
    """Return (output_filename, subfolder_ui, absolute_path) under ComfyUI output."""
    output_dir = os.path.abspath(folder_paths.get_output_directory())
    raw = str(filename_prefix or "").strip().replace("\\", "/") or DEFAULT_COMPOSE_PREFIX
    # Prefix is relative to output (folder path). Trailing slash optional.
    subfolder = raw.strip("/")

    leaf = str(filename or "").strip().replace("\\", "/")
    leaf = os.path.basename(leaf)
    if leaf:
        if not leaf.lower().endswith(".mp4"):
            leaf += ".mp4"
        leaf = re.sub(r'[<>:"|?*\x00-\x1f]', "_", leaf).strip(" .")
    if not leaf:
        leaf = build_compose_filename(project_name)

    full_folder = output_dir if not subfolder else os.path.join(output_dir, *subfolder.split("/"))
    full_folder = _safe_under_output(full_folder)
    os.makedirs(full_folder, exist_ok=True)
    output_path = os.path.join(full_folder, leaf)
    output_path = _safe_under_output(output_path)
    subfolder_ui = subfolder.replace("\\", "/") if subfolder else ""
    return leaf, subfolder_ui, output_path


def compose_to_output(
    project: dict,
    filename_prefix: str | None = None,
    filename: str | None = None,
    ignore_audio_tracks: bool = False,
) -> dict:
    project_name = _as_dict(project).get("name") or "未命名项目"
    leaf, subfolder, output_path = resolve_compose_output_path(
        filename_prefix or DEFAULT_COMPOSE_PREFIX,
        project_name,
        filename,
    )
    # ffmpeg writes straight to the final path under ComfyUI output.
    meta = compose_timeline_project(
        project,
        output_path,
        ignore_audio_tracks=bool(ignore_audio_tracks),
    )
    meta["filename"] = leaf
    meta["subfolder"] = subfolder
    meta["output_path"] = output_path
    return meta
