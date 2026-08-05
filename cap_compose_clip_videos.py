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

from .cap_data_json_parser import CAP_DataJsonClipParser
from .cap_seq_to_video import _ffmpeg_path

log = logging.getLogger(__name__)

_VIDEO_EXTS = (".mp4", ".mov", ".webm", ".mkv", ".m4v")


def _run_ffmpeg(cmd: list) -> None:
    kwargs: dict = {"capture_output": True, "text": True, "timeout": 1800}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
    result = subprocess.run(cmd, **kwargs)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg 执行失败:\n{(result.stderr or '')[-2000:]}")


def _probe_duration_sec(path: str) -> float | None:
    kwargs: dict = {"capture_output": True, "text": True, "timeout": 30}
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
    kwargs: dict = {"capture_output": True, "text": True, "timeout": 30}
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


def _safe_under(base: str, candidate: str) -> str:
    base_real = os.path.realpath(base)
    cand_real = os.path.realpath(candidate)
    if cand_real != base_real and not cand_real.startswith(base_real + os.sep):
        raise ValueError(f"路径不允许跳出目录: {candidate}")
    return cand_real


class CAP_ComposeClipVideos:
    """Compose per-clip MP4s (under output/run_prefix) into one timeline video."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "data_json": ("STRING", {"default": "", "multiline": True}),
                "clips_dir": ("STRING", {
                    "default": "",
                    "tooltip": (
                        "片段视频目录。留空=ComfyUI output/{run_prefix}；"
                        "相对路径相对 output；也可直接填 run_prefix。"
                    ),
                }),
                "name_mode": (
                    ["from_start", "index"],
                    {
                        "default": "from_start",
                        "tooltip": "按 from_start 标签或四位索引匹配片段视频文件名",
                    },
                ),
                "filename_prefix": ("STRING", {
                    "default": "composed",
                    "tooltip": "合成后视频的文件名前缀（可含子目录，相对 output）",
                }),
                "trim_extends": ("BOOLEAN", {
                    "default": True,
                    "label_on": "裁剪首尾扩展",
                    "label_off": "不裁剪",
                    "tooltip": (
                        "当 clip 设置了首/尾扩展且视频为扩展时长时，"
                        "合成前裁掉扩展，只保留预览时长区间。"
                    ),
                }),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("filename",)
    OUTPUT_NODE = True
    FUNCTION = "execute"
    CATEGORY = "Capricorncd"
    DESCRIPTION = (
        "Compose multi-clip videos produced under output/run_prefix into one MP4. "
        "Optionally trims head/tail extend so the final cut matches preview duration."
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

    def _resolve_clips_dir(self, clips_dir: str, run_prefix: str) -> str:
        output_dir = os.path.abspath(folder_paths.get_output_directory())
        raw = str(clips_dir or "").strip().replace("\\", "/")
        prefix = str(run_prefix or "").strip().replace("\\", "/").strip("/")

        if not raw:
            if not prefix:
                raise ValueError("clips_dir 为空且 data_json 中没有 run_prefix")
            path = os.path.join(output_dir, *prefix.split("/"))
            path = _safe_under(output_dir, path)
            if not os.path.isdir(path):
                raise ValueError(f"片段目录不存在: {path}")
            return path

        if os.path.isabs(raw):
            path = os.path.abspath(raw)
            if not os.path.isdir(path):
                raise ValueError(f"片段目录不存在: {path}")
            return path

        path = os.path.join(output_dir, *raw.strip("/").split("/"))
        path = _safe_under(output_dir, path)
        if not os.path.isdir(path):
            raise ValueError(f"片段目录不存在: {path}")
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
    ):
        if not shutil.which("ffmpeg"):
            raise RuntimeError("未找到 ffmpeg，请先安装并加入 PATH")

        data = self._parse_data(data_json)
        clips = data.get("clips", [])
        if not isinstance(clips, list) or not clips:
            raise ValueError("data_json 中没有可用 clips")

        fps = max(1.0, float(data.get("fps", 24.0) or 24.0))
        run_prefix = str(data.get("run_prefix") or "").strip()
        resolved_dir = self._resolve_clips_dir(clips_dir, run_prefix)
        parser = CAP_DataJsonClipParser()

        sources: list[tuple[dict, int, str]] = []
        for index, clip in enumerate(clips):
            if not isinstance(clip, dict):
                continue
            stem = self._clip_stem(clip, index, fps, name_mode, parser)
            path = self._find_clip_video(resolved_dir, stem)
            if not path:
                raise ValueError(f"未找到第 {index} 段视频（stem={stem!r}）于 {resolved_dir}")
            sources.append((clip, index, path))

        if not sources:
            raise ValueError("没有可合成的片段视频")

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
