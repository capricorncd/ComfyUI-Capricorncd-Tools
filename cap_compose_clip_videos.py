from __future__ import annotations

import datetime
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile

import folder_paths

from .cap_i18n import get_last_known_lang, t as _t
from .cap_data_json_parser import CAP_DataJsonClipParser
from .cap_save_sidecar import build_sidecar_payload, clip_prompts_from_data_json, sidecar_path, write_sidecar
from .cap_seq_to_video import _ffmpeg_path

log = logging.getLogger(__name__)

_VIDEO_EXTS = (".mp4", ".mov", ".webm", ".mkv", ".m4v")


_FFMPEG_ERROR_MARKERS = (
    "Error", "error", "Invalid", "Unable", "No such", "Conversion failed",
    "Cannot", "cannot", "failed", "Failed",
)


def _extract_ffmpeg_error(stderr: str, limit: int = 4000) -> str:
    """Pull the most relevant tail out of ffmpeg's stderr.

    With many -i inputs (several clips + audio tracks + a watermark image),
    ffmpeg's per-input banner text alone can run past a fixed last-N-chars
    window, burying the actual fatal error (which is printed *after* all the
    input banners). Search backwards for the last error-looking line instead
    of blindly slicing the tail.
    """
    stderr = stderr or ""
    lines = stderr.splitlines()
    for i in range(len(lines) - 1, -1, -1):
        if any(marker in lines[i] for marker in _FFMPEG_ERROR_MARKERS):
            snippet = "\n".join(lines[max(0, i - 5):])
            return snippet[-limit:]
    return stderr[-limit:]


def _run_ffmpeg(cmd: list) -> None:
    kwargs: dict = {
        "capture_output": True,
        "text": True,
        # ffmpeg's stderr can contain non-ASCII (Chinese filenames, embedded
        # metadata, etc.) encoded as UTF-8. Without an explicit encoding,
        # Python decodes subprocess output using the OS locale codepage
        # (e.g. cp932 on some Windows setups), which raises inside the
        # internal reader thread on those bytes and leaves stderr truncated
        # or empty — masking the real ffmpeg error.
        "encoding": "utf-8",
        "errors": "replace",
        "timeout": 1800,
    }
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
    result = subprocess.run(cmd, **kwargs)
    if result.returncode != 0:
        raise RuntimeError(_t("ffmpeg_failed", get_last_known_lang(), detail=_extract_ffmpeg_error(result.stderr)))


def _probe_duration_sec(path: str) -> float | None:
    kwargs: dict = {"capture_output": True, "text": True, "encoding": "utf-8", "errors": "replace", "timeout": 30}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                _ffmpeg_path(path),
            ],
            **kwargs,
        )
        if result.returncode != 0:
            return None
        return float(str(result.stdout or "").strip())
    except Exception:
        return None


def _probe_has_audio(path: str) -> bool:
    kwargs: dict = {"capture_output": True, "text": True, "encoding": "utf-8", "errors": "replace", "timeout": 30}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-select_streams", "a:0",
                "-show_entries", "stream=codec_type",
                "-of", "csv=p=0",
                _ffmpeg_path(path),
            ],
            **kwargs,
        )
        return result.returncode == 0 and "audio" in (result.stdout or "").lower()
    except Exception:
        return False


def extract_audio_file(
    src_path: str,
    dest_path: str,
    *,
    trim_in_sec: float = 0.0,
    duration_sec: float | None = None,
) -> None:
    """Demux / re-encode audio from a video into a WAV for the timeline library."""
    if not src_path or not os.path.isfile(src_path):
        raise ValueError(_t("file_not_found", get_last_known_lang()))
    if not shutil.which("ffmpeg"):
        raise RuntimeError(_t("ffmpeg_not_found", get_last_known_lang()))
    if not _probe_has_audio(src_path):
        raise ValueError(_t("video_has_no_audio", get_last_known_lang()))

    tin = max(0.0, float(trim_in_sec or 0.0))
    dur = None
    if duration_sec is not None:
        try:
            d = float(duration_sec)
            if d > 0.01:
                dur = d
        except (TypeError, ValueError):
            dur = None

    os.makedirs(os.path.dirname(dest_path) or ".", exist_ok=True)
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
    if tin > 1e-6:
        cmd.extend(["-ss", f"{tin:.6f}"])
    cmd.extend(["-i", _ffmpeg_path(src_path)])
    if dur is not None:
        cmd.extend(["-t", f"{dur:.6f}"])
    cmd.extend([
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "44100",
        "-ac", "2",
        _ffmpeg_path(dest_path),
    ])
    _run_ffmpeg(cmd)
    if not os.path.isfile(dest_path) or os.path.getsize(dest_path) <= 0:
        raise RuntimeError(_t("ffmpeg_failed", get_last_known_lang(), detail="empty audio output"))


def _probe_video_size(path: str) -> tuple[int, int] | None:
    kwargs: dict = {"capture_output": True, "text": True, "encoding": "utf-8", "errors": "replace", "timeout": 30}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=width,height",
                "-of", "csv=p=0:s=x",
                _ffmpeg_path(path),
            ],
            **kwargs,
        )
        if result.returncode != 0:
            return None
        text = str(result.stdout or "").strip().splitlines()
        if not text:
            return None
        parts = text[0].lower().replace(" ", "").split("x")
        if len(parts) != 2:
            return None
        width = int(float(parts[0]))
        height = int(float(parts[1]))
        if width < 2 or height < 2:
            return None
        return width, height
    except Exception:
        return None


def _safe_under(base: str, candidate: str) -> str:
    base_real = os.path.realpath(base)
    cand_real = os.path.realpath(candidate)
    if cand_real != base_real and not cand_real.startswith(base_real + os.sep):
        raise ValueError(_t("path_escapes_dir", get_last_known_lang(), path=candidate))
    return cand_real


class CAP_ComposeClipVideos:
    """Compose per-clip MP4s (under output/run_timestamp) into one timeline video."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "data_json": ("STRING", {"default": "", "multiline": True}),
                "clips_dir": ("STRING", {
                    "default": "",
                    "tooltip": (
                        "Clip video directory. Leave blank for ComfyUI output/{run_timestamp}; "
                        "a relative path is relative to output; you can also just enter run_timestamp."
                    ),
                }),
                "name_mode": (
                    ["from_start", "index"],
                    {
                        "default": "from_start",
                        "tooltip": "Match clip video filenames by the from_start label or a 4-digit index",
                    },
                ),
                "filename_prefix": ("STRING", {
                    "default": "composed",
                    "tooltip": "Filename prefix for the composed video (may include subfolders, relative to output)",
                }),
                "trim_extends": ("BOOLEAN", {
                    "default": True,
                    "label_on": "Trim extends",
                    "label_off": "No trim",
                    "tooltip": (
                        "When a clip has a start/end extend and the video is the extended duration, "
                        "trim the extend before composing, keeping only the preview-duration range."
                    ),
                }),
                "save_sidecar": ("BOOLEAN", {
                    "default": True,
                    "label_on": "Save JSON",
                    "label_off": "Skip",
                    "tooltip": "Write a same-named JSON next to the composed video recording each clip's prompt, model, etc.",
                }),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("filename",)
    OUTPUT_NODE = True
    FUNCTION = "execute"
    CATEGORY = "Capricorncd"
    DESCRIPTION = (
        "Compose multi-clip videos produced under output/run_timestamp into one MP4. "
        "Optionally trims head/tail extend so the final cut matches preview duration. "
        "When save_sidecar is true, write a same-name JSON next to the video."
    )

    @classmethod
    def IS_CHANGED(cls, **_kwargs):
        return float("nan")

    def _parse_data(self, data_json: str) -> dict:
        try:
            data = json.loads(data_json or "{}")
        except json.JSONDecodeError:
            data = {}
        return data if isinstance(data, dict) else {}

    def _resolve_clips_dir(self, clips_dir: str, run_timestamp: str) -> str:
        output_dir = os.path.abspath(folder_paths.get_output_directory())
        raw = str(clips_dir or "").strip().replace("\\", "/")
        prefix = str(run_timestamp or "").strip().replace("\\", "/").strip("/")

        if not raw:
            if not prefix:
                raise ValueError(_t("clips_dir_empty_no_run_timestamp", get_last_known_lang()))
            path = os.path.join(output_dir, *prefix.split("/"))
            path = _safe_under(output_dir, path)
            if not os.path.isdir(path):
                raise ValueError(_t("clip_dir_not_found", get_last_known_lang(), path=path))
            return path

        if os.path.isabs(raw):
            path = os.path.abspath(raw)
            if not os.path.isdir(path):
                raise ValueError(_t("clip_dir_not_found", get_last_known_lang(), path=path))
            return path

        path = os.path.join(output_dir, *raw.strip("/").split("/"))
        path = _safe_under(output_dir, path)
        if not os.path.isdir(path):
            raise ValueError(_t("clip_dir_not_found", get_last_known_lang(), path=path))
        return path

    def _clip_stem(self, clip: dict, index: int, fps: float, name_mode: str, parser: CAP_DataJsonClipParser) -> str:
        mode = str(name_mode or "from_start").strip().lower()
        if mode == "index":
            return f"{index:04d}"
        start_ms = int(clip.get("start_ms", 0) or 0)
        end_ms = int(clip.get("end_ms", start_ms) or start_ms)
        frame_count = parser._frame_count(start_ms, end_ms, fps)
        return parser._from_tag(start_ms, frame_count, fps)

    def _find_clip_video(self, clips_dir: str, stem: str) -> str | None:
        stem = str(stem or "").strip()
        if not stem:
            return None
        exact = []
        prefixed = []
        try:
            names = os.listdir(clips_dir)
        except OSError:
            return None
        for name in names:
            path = os.path.join(clips_dir, name)
            if not os.path.isfile(path):
                continue
            root, ext = os.path.splitext(name)
            if ext.lower() not in _VIDEO_EXTS:
                continue
            if root == stem:
                exact.append(path)
            elif root.startswith(stem + "_"):
                prefixed.append(path)
        pool = exact or prefixed
        if not pool:
            return None
        pool.sort(key=lambda p: os.path.getmtime(p), reverse=True)
        return pool[0]

    def _trim_plan(self, clip: dict, video_path: str, trim_extends: bool) -> tuple[float | None, float | None]:
        """Return (ss, duration) in seconds, or (None, None) if no trim."""
        if not trim_extends:
            return None, None
        try:
            head = max(0, int(clip.get("head_extend_sec", 0) or 0))
        except (TypeError, ValueError):
            head = 0
        try:
            tail = max(0, int(clip.get("tail_extend_sec", 0) or 0))
        except (TypeError, ValueError):
            tail = 0
        if head <= 0 and tail <= 0:
            return None, None

        # Preview-duration videos already match timeline slot — skip trim.
        if bool(clip.get("generate_preview_video", False)):
            return None, None

        start_ms = int(clip.get("start_ms", 0) or 0)
        end_ms = int(clip.get("end_ms", start_ms) or start_ms)
        preview_start = clip.get("preview_start_ms", None)
        preview_end = clip.get("preview_end_ms", None)
        try:
            preview_start = int(preview_start) if preview_start is not None else start_ms + head * 1000
        except (TypeError, ValueError):
            preview_start = start_ms + head * 1000
        try:
            preview_end = int(preview_end) if preview_end is not None else end_ms - tail * 1000
        except (TypeError, ValueError):
            preview_end = end_ms - tail * 1000

        preview_dur = max(1, preview_end - preview_start) / 1000.0
        ext_dur = max(1, end_ms - start_ms) / 1000.0
        vid_dur = _probe_duration_sec(video_path)

        # Only trim when the file looks like the extended-length render.
        if vid_dur is not None and vid_dur + 0.2 < ext_dur * 0.9:
            return None, None
        if vid_dur is not None and abs(vid_dur - preview_dur) <= 0.2 and head > 0:
            return None, None

        return float(head), float(preview_dur)

    def _normalize_segment(
        self,
        src: str,
        dst: str,
        ss: float | None,
        duration: float | None,
        keep_audio: bool,
    ) -> None:
        cmd = ["ffmpeg", "-y"]
        if ss is not None and ss > 0:
            cmd += ["-ss", f"{ss:.6f}"]
        cmd += ["-i", _ffmpeg_path(src)]
        if duration is not None and duration > 0:
            cmd += ["-t", f"{duration:.6f}"]
        cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p"]
        if keep_audio and _probe_has_audio(src):
            cmd += ["-c:a", "aac", "-b:a", "192k"]
        else:
            cmd += ["-an"]
        cmd.append(_ffmpeg_path(dst))
        log.info("[CAP_ComposeClipVideos] normalize: %s", " ".join(cmd))
        _run_ffmpeg(cmd)

    def _build_output_path(self, filename_prefix: str) -> tuple[str, str, str]:
        output_dir = os.path.abspath(folder_paths.get_output_directory())
        stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        prefix = str(filename_prefix).strip().replace("\\", "/") or "composed"
        subfolder = os.path.dirname(prefix)
        base = os.path.basename(prefix) or "composed"
        base = re.sub(r'[<>:"|?*\x00-\x1f]', "_", base).strip(" .") or "composed"
        output_filename = f"{base}_{stamp}.mp4"
        full_output_folder = os.path.abspath(os.path.join(output_dir, subfolder)) if subfolder else output_dir
        full_output_folder = _safe_under(output_dir, full_output_folder)
        os.makedirs(full_output_folder, exist_ok=True)
        output_path = os.path.join(full_output_folder, output_filename)
        subfolder_ui = subfolder.replace("\\", "/") if subfolder else ""
        return output_filename, subfolder_ui, output_path

    def execute(
        self,
        data_json: str,
        clips_dir: str = "",
        name_mode: str = "from_start",
        filename_prefix: str = "composed",
        trim_extends: bool = True,
        save_sidecar: bool = True,
        prompt=None,
        extra_pnginfo=None,
    ):
        if not shutil.which("ffmpeg"):
            raise RuntimeError(_t("ffmpeg_not_found", get_last_known_lang()))

        data = self._parse_data(data_json)
        clips = data.get("clips", [])
        if not isinstance(clips, list) or not clips:
            raise ValueError(_t("no_clips_in_data_json", get_last_known_lang()))

        fps = max(1.0, float(data.get("fps", 24.0) or 24.0))
        run_timestamp = str(data.get("run_timestamp") or data.get("run_prefix") or "").strip()
        resolved_dir = self._resolve_clips_dir(clips_dir, run_timestamp)
        parser = CAP_DataJsonClipParser()

        sources: list[tuple[dict, int, str]] = []
        for index, clip in enumerate(clips):
            if not isinstance(clip, dict):
                continue
            stem = self._clip_stem(clip, index, fps, name_mode, parser)
            path = self._find_clip_video(resolved_dir, stem)
            if not path:
                raise ValueError(_t("clip_video_not_found", get_last_known_lang(), index=index, stem=repr(stem), dir=resolved_dir))
            sources.append((clip, index, path))

        if not sources:
            raise ValueError(_t("no_clips_to_compose", get_last_known_lang()))

        keep_audio = all(_probe_has_audio(path) for _, _, path in sources)

        output_filename, subfolder, output_path = self._build_output_path(filename_prefix)
        tmp_dir = tempfile.mkdtemp(prefix="cap_compose_clips_")
        concat_list = None
        segment_paths: list[str] = []

        try:
            for order, (clip, index, src) in enumerate(sources):
                ss, dur = self._trim_plan(clip, src, bool(trim_extends))
                dst = os.path.join(tmp_dir, f"seg_{order:04d}.mp4")
                self._normalize_segment(src, dst, ss, dur, keep_audio)
                segment_paths.append(dst)

            fd, concat_list = tempfile.mkstemp(suffix=".txt", prefix="cap_compose_concat_")
            os.close(fd)
            with open(concat_list, "w", encoding="utf-8", newline="\n") as wf:
                for path in segment_paths:
                    escaped = _ffmpeg_path(path).replace("'", r"'\''")
                    wf.write(f"file '{escaped}'\n")

            cmd = [
                "ffmpeg", "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", _ffmpeg_path(concat_list),
                "-c", "copy",
                _ffmpeg_path(output_path),
            ]
            log.info("[CAP_ComposeClipVideos] concat %d clips -> %s", len(segment_paths), output_path)
            _run_ffmpeg(cmd)
        finally:
            if concat_list and os.path.exists(concat_list):
                os.unlink(concat_list)
            shutil.rmtree(tmp_dir, ignore_errors=True)

        if save_sidecar:
            extra = {"clips": len(sources), "clips_dir": resolved_dir}
            clip_rows = clip_prompts_from_data_json(data_json)
            if clip_rows:
                extra["clip_prompts"] = clip_rows
            write_sidecar(
                sidecar_path(output_path),
                build_sidecar_payload(
                    output_filename,
                    prompt=prompt,
                    extra=extra,
                ),
            )

        rel_name = f"{subfolder}/{output_filename}" if subfolder else output_filename
        return {
            "ui": {
                "video": [{
                    "filename": output_filename,
                    "subfolder": subfolder,
                    "type": "output",
                }]
            },
            "result": (rel_name,),
        }


NODE_CLASS_MAPPINGS = {"CAP_ComposeClipVideos": CAP_ComposeClipVideos}
NODE_DISPLAY_NAME_MAPPINGS = {"CAP_ComposeClipVideos": "Compose Clip Videos"}
