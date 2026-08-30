"""Compose Timeline Editor generated videos (+ unmuted audio) into one MP4."""

from __future__ import annotations

import logging
import os
import re
import shutil
import tempfile
from typing import Any

import folder_paths

from .cap_i18n import get_last_known_lang, t as _t
from .cap_compose_clip_videos import _probe_has_audio, _probe_video_size, _run_ffmpeg
from .cap_seq_to_video import _ffmpeg_path
from .cap_timeline_project_io import _safe_name
from .cap_watermark import resolve_font_path
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
    from .cap_timeline_project_io import _norm_generated_file

    rel = _norm_generated_file(rel)
    if not rel:
        return ""
    root = os.path.abspath(folder_paths.get_output_directory())
    path = os.path.abspath(os.path.join(root, *rel.split("/")))
    if path != root and not path.startswith(root + os.sep):
        raise ValueError(_t("invalid_generated_video_path", get_last_known_lang(), path=rel))
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


def _even_dim(value: int) -> int:
    value = max(16, int(value))
    return value if value % 2 == 0 else value - 1


def _size_from_generated_videos(video_segs: list[dict], fallback_w: int, fallback_h: int) -> tuple[int, int]:
    """Use the largest probed generated-video frame size (keeps 2nd-sample upscales)."""
    best_w = 0
    best_h = 0
    best_area = 0
    for seg in video_segs:
        path = str(seg.get("path") or "")
        if not path:
            continue
        size = _probe_video_size(path)
        if not size:
            continue
        width, height = size
        area = width * height
        if area > best_area:
            best_w, best_h, best_area = width, height, area
    if best_w >= 16 and best_h >= 16:
        return _even_dim(best_w), _even_dim(best_h)
    return _even_dim(fallback_w), _even_dim(fallback_h)


def _collect_plan(
    project: dict,
    ignore_audio_tracks: bool = False,
    use_generated_video_size: bool = False,
) -> dict:
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
                    raise ValueError(_t("generated_video_not_found", get_last_known_lang(), file=gen['file']))
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
                raise ValueError(_t("audio_file_not_found", get_last_known_lang(), file=file))
            start = _ms(clip.get("start_ms"))
            duration = max(1, _ms(clip.get("duration_ms"), 1))
            source = _as_dict(clip.get("source"))
            source_in = _ms(source.get("in_ms"))
            end = start + duration
            end_ms = max(end_ms, end)
            dur_sec = duration / 1000.0
            fade_in_sec = max(0.0, _ms(clip.get("fade_in_ms")) / 1000.0)
            fade_out_sec = max(0.0, _ms(clip.get("fade_out_ms")) / 1000.0)
            if fade_in_sec + fade_out_sec > dur_sec and (fade_in_sec + fade_out_sec) > 0:
                scale = dur_sec / (fade_in_sec + fade_out_sec)
                fade_in_sec *= scale
                fade_out_sec = max(0.0, dur_sec - fade_in_sec)
            audio_segs.append({
                "path": path,
                "start_sec": start / 1000.0,
                "duration_sec": dur_sec,
                "source_in_sec": source_in / 1000.0,
                "fade_in_sec": fade_in_sec,
                "fade_out_sec": fade_out_sec,
            })

    if not video_segs:
        raise ValueError(_t("no_generated_videos_to_compose", get_last_known_lang()))

    if use_generated_video_size:
        width, height = _size_from_generated_videos(video_segs, width, height)
    else:
        width, height = _even_dim(width), _even_dim(height)

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


_WM_POSITIONS = (
    "top-left", "top-right", "bottom-left", "bottom-right",
    "center", "top-center", "bottom-center",
)


def _clamp_margin(margin: dict, width: int, height: int) -> dict:
    m = _as_dict(margin)

    def clamp(value, limit):
        try:
            value = int(round(float(value)))
        except (TypeError, ValueError):
            value = 0
        return max(0, min(value, limit))

    return {
        "top": clamp(m.get("top", 0), height // 2),
        "bottom": clamp(m.get("bottom", 0), height // 2),
        "left": clamp(m.get("left", 0), width // 2),
        "right": clamp(m.get("right", 0), width // 2),
    }


def _overlay_xy(position: str, margin: dict) -> tuple[str, str]:
    t, r, b, l = margin["top"], margin["right"], margin["bottom"], margin["left"]
    table = {
        "top-left": (f"{l}", f"{t}"),
        "top-right": (f"main_w-overlay_w-{r}", f"{t}"),
        "bottom-left": (f"{l}", f"main_h-overlay_h-{b}"),
        "bottom-right": (f"main_w-overlay_w-{r}", f"main_h-overlay_h-{b}"),
        "center": ("(main_w-overlay_w)/2", "(main_h-overlay_h)/2"),
        "top-center": ("(main_w-overlay_w)/2", f"{t}"),
        "bottom-center": ("(main_w-overlay_w)/2", f"main_h-overlay_h-{b}"),
    }
    return table.get(position, table["bottom-right"])


def _render_text_watermark_png(text_cfg: dict, scale_pct: float) -> str:
    """Render the watermark text to a transparent PNG with Pillow and return
    its temp file path.

    Deliberately not using ffmpeg's own `drawtext` filter: on this class of
    Windows ffmpeg build (fontconfig + freetype + fribidi all compiled in),
    `drawtext` segfaults with a native access violation regardless of
    fontfile/config, which takes the whole compose down with it. Rendering
    the text ourselves and compositing it as a plain image sidesteps that
    entirely and reuses the same overlay path as an image watermark.
    """
    from PIL import Image, ImageDraw, ImageFont

    lines = str(text_cfg.get("content") or "").split("\n") or [""]
    try:
        font_size = max(1, round(float(text_cfg.get("fontSize", 32)) * scale_pct))
    except (TypeError, ValueError):
        font_size = max(1, round(32 * scale_pct))
    try:
        letter_spacing = round(float(
            text_cfg.get("letterSpacing", text_cfg.get("letter_spacing", 0)) or 0
        ) * scale_pct)
    except (TypeError, ValueError):
        letter_spacing = 0
    color = str(text_cfg.get("color") or "#ffffff").strip().lstrip("#") or "ffffff"
    if len(color) != 6:
        color = "ffffff"
    rgb = tuple(int(color[i:i + 2], 16) for i in (0, 2, 4))

    font_path = resolve_font_path(text_cfg.get("fontPath") or "")
    font = ImageFont.truetype(font_path, font_size) if font_path else ImageFont.load_default()

    scratch = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    line_gap = max(2, round(font_size * 0.25))

    def _line_size(line: str) -> tuple[int, int, int, int]:
        sample = line if line else " "
        if not letter_spacing:
            return scratch.textbbox((0, 0), sample, font=font)
        chars = list(sample)
        max_top = 0
        max_bottom = 0
        width = 0
        for i, ch in enumerate(chars):
            box = scratch.textbbox((0, 0), ch, font=font)
            if i == 0:
                max_top = box[1]
                max_bottom = box[3]
            else:
                max_top = min(max_top, box[1])
                max_bottom = max(max_bottom, box[3])
            width += box[2] - box[0]
            if i < len(chars) - 1:
                width += letter_spacing
        return (0, max_top, width, max_bottom)

    boxes = [_line_size(line) for line in lines]
    width = max(1, max(b[2] - b[0] for b in boxes))
    height = max(1, sum(b[3] - b[1] for b in boxes) + line_gap * (len(lines) - 1))

    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    y = 0
    for line, box in zip(lines, boxes):
        sample = line if line else " "
        if not letter_spacing:
            draw.text((-box[0], y - box[1]), sample, font=font, fill=(*rgb, 255))
        else:
            x = 0
            for i, ch in enumerate(list(sample)):
                ch_box = scratch.textbbox((0, 0), ch, font=font)
                draw.text((x - ch_box[0], y - ch_box[1]), ch, font=font, fill=(*rgb, 255))
                x += (ch_box[2] - ch_box[0]) + (letter_spacing if i < len(sample) - 1 else 0)
        y += (box[3] - box[1]) + line_gap

    fd, path = tempfile.mkstemp(suffix=".png", prefix="cap_wm_text_")
    os.close(fd)
    img.save(path)
    return path


def _random_schedule(total_sec: float, rng) -> list[tuple[float, float, str]]:
    segments: list[tuple[float, float, str]] = []
    t = 0.0
    prev = None
    while t < total_sec - 1e-6:
        end = min(total_sec, t + rng.uniform(10.0, 30.0))
        choices = [p for p in _WM_POSITIONS if p != prev] or list(_WM_POSITIONS)
        pos = rng.choice(choices)
        segments.append((t, end, pos))
        prev = pos
        t = end
    return segments or [(0.0, total_sec, rng.choice(_WM_POSITIONS))]


def _resolve_watermark_mode(watermark: dict) -> str:
    image = _as_dict(watermark.get("image"))
    if str(image.get("file") or "").strip() and image.get("disabled") is not True:
        return "image"
    if str(_as_dict(watermark.get("text")).get("content") or "").strip():
        return "text"
    return "none"


def _build_watermark_filters(
    watermark: dict,
    width: int,
    height: int,
    total_sec: float,
    image_input_index: int,
) -> tuple[list[str], list[str], str, str | None]:
    """Return (extra -i args, extra filter_complex fragments, final video
    label, temp-file-to-delete-afterward-or-None).

    The base video stream must already be available as `[vout]`; the returned
    filters consume it (fanning out over one overlay per scheduled position
    segment) and produce a new final label. Both text and image watermarks
    end up as a plain image `overlay` — text is rendered to a transparent
    PNG with Pillow first (see `_render_text_watermark_png` for why).
    """
    import random

    watermark = _as_dict(watermark)
    mode = _resolve_watermark_mode(watermark)
    if mode == "none":
        return [], [], "vout", None

    try:
        opacity = max(0.0, min(100.0, float(watermark.get("opacity", 80)))) / 100.0
    except (TypeError, ValueError):
        opacity = 0.8
    try:
        scale_pct = max(10.0, min(300.0, float(watermark.get("scale", 100)))) / 100.0
    except (TypeError, ValueError):
        scale_pct = 1.0
    margin = _clamp_margin(watermark.get("margin"), width, height)
    position = str(watermark.get("position") or "bottom-right")

    if position == "random-fixed":
        schedule = [(0.0, total_sec, random.choice(_WM_POSITIONS))]
    elif position == "random-interval":
        schedule = _random_schedule(total_sec, random.Random())
    elif position in _WM_POSITIONS:
        schedule = [(0.0, total_sec, position)]
    else:
        schedule = [(0.0, total_sec, "bottom-right")]

    cleanup_path: str | None = None
    if mode == "image":
        file = str(_as_dict(watermark.get("image")).get("file") or "").strip()
        path = resolve_media_path(file, location="input")
        if not path or not os.path.isfile(path):
            raise ValueError(_t("watermark_image_not_found", get_last_known_lang(), file=file))
        pre_scale = f"scale=iw*{scale_pct:.6f}:ih*{scale_pct:.6f},"
    else:
        path = _render_text_watermark_png(_as_dict(watermark.get("text")), scale_pct)
        cleanup_path = path
        pre_scale = ""  # scale is already baked into the rendered font size

    input_args = ["-loop", "1", "-i", _ffmpeg_path(path)]
    filters: list[str] = [
        f"[{image_input_index}:v]{pre_scale}format=rgba,colorchannelmixer=aa={opacity:.6f}[wm]"
    ]
    label = "vout"
    for i, (start, end, pos) in enumerate(schedule):
        x, y = _overlay_xy(pos, margin)
        out = f"vwm{i}"
        filters.append(
            f"[{label}][wm]overlay=x={x}:y={y}:eof_action=pass:enable='{_escape_enable(start, end)}'[{out}]"
        )
        label = out
    return input_args, filters, label, cleanup_path


def compose_timeline_project(
    project: dict,
    output_path: str,
    ignore_audio_tracks: bool = False,
    watermark: dict | None = None,
    use_generated_video_size: bool = False,
) -> dict:
    if not shutil.which("ffmpeg"):
        raise RuntimeError(_t("ffmpeg_not_found", get_last_known_lang()))
    if not isinstance(project, dict):
        raise ValueError(_t("invalid_project", get_last_known_lang()))

    plan = _collect_plan(
        project,
        ignore_audio_tracks=bool(ignore_audio_tracks),
        use_generated_video_size=bool(use_generated_video_size),
    )
    width = plan["width"]
    height = plan["height"]
    fps = plan["fps"]
    total = plan["total_sec"]
    # Bottom→top paint order: earlier tracks first, then later overlays.
    video_segs = list(plan["video_segs"])
    audio_segs = plan["audio_segs"]

    os.makedirs(os.path.dirname(os.path.abspath(output_path)) or ".", exist_ok=True)

    cmd: list[str] = [
        "ffmpeg", "-y", "-hide_banner",
        "-f", "lavfi",
        "-i", f"color=c=black:s={width}x{height}:d={total:.6f}:r={fps}",
    ]
    for seg in video_segs:
        cmd += ["-i", _ffmpeg_path(seg["path"])]
    audio_input_offset = 1 + len(video_segs)
    for seg in audio_segs:
        cmd += ["-i", _ffmpeg_path(seg["path"])]

    watermark_input_index = audio_input_offset + len(audio_segs)
    wm_input_args, wm_filters, video_out_label, wm_cleanup_path = _build_watermark_filters(
        watermark, width, height, total, watermark_input_index,
    )
    cmd += wm_input_args

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
    filters += wm_filters

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
        chain = (
            f"[{idx}:a]atrim=start={seg['source_in_sec']:.6f}:duration={seg['duration_sec']:.6f},"
            f"asetpts=PTS-STARTPTS"
        )
        fade_in = float(seg.get("fade_in_sec") or 0.0)
        fade_out = float(seg.get("fade_out_sec") or 0.0)
        if fade_in > 0:
            chain += f",afade=t=in:st=0:d={fade_in:.6f}"
        if fade_out > 0:
            out_st = max(0.0, float(seg["duration_sec"]) - fade_out)
            chain += f",afade=t=out:st={out_st:.6f}:d={fade_out:.6f}"
        chain += f",adelay={delay_ms}|{delay_ms}[{label}]"
        filters.append(chain)
        amix_labels.append(label)

    map_args: list[str] = ["-map", f"[{video_out_label}]"]
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
    try:
        _run_ffmpeg(cmd)
    finally:
        if wm_cleanup_path and os.path.exists(wm_cleanup_path):
            os.unlink(wm_cleanup_path)
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
    safe = _safe_name(project_name, "Untitled Project")
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
    watermark: dict | None = None,
    use_generated_video_size: bool = False,
) -> dict:
    project_name = _as_dict(project).get("name") or "Untitled Project"
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
        watermark=watermark,
        use_generated_video_size=bool(use_generated_video_size),
    )
    meta["filename"] = leaf
    meta["subfolder"] = subfolder
    meta["output_path"] = output_path
    return meta
