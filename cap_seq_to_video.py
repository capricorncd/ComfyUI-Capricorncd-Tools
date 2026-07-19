from __future__ import annotations
import datetime
import glob
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import wave

import folder_paths

log = logging.getLogger(__name__)

_IMAGE_EXTS = ("jpg", "jpeg", "png", "webp", "bmp")


def _ffmpeg_path(path: str) -> str:
    return os.path.abspath(path).replace("\\", "/")


def _list_frame_files(frames_dir: str) -> list[str]:
    files: list[str] = []
    for ext in _IMAGE_EXTS:
        files.extend(glob.glob(os.path.join(frames_dir, f"*.{ext}")))
        files.extend(glob.glob(os.path.join(frames_dir, f"*.{ext.upper()}")))
    return sorted(set(files))


def _parse_image_paths(text: str) -> list[str]:
    text = str(text or "").strip()
    if not text:
        return []
    paths: list[str] = []
    for part in text.split(","):
        p = part.strip()
        if not p:
            continue
        if (len(p) >= 2 and p[0] == p[-1] and p[0] in "\"'"):
            p = p[1:-1].strip()
        paths.append(os.path.normpath(p))
    return paths


def _resolve_image_list(image_paths: str) -> list[str]:
    files = _parse_image_paths(image_paths)
    if not files:
        return []
    valid: list[str] = []
    for path in files:
        if not os.path.isfile(path):
            raise ValueError(f"图片文件不存在: {path}")
        ext = os.path.splitext(path)[1].lstrip(".").lower()
        if ext not in _IMAGE_EXTS:
            raise ValueError(f"不支持的图片格式: {path}")
        valid.append(path)
    return valid


def _concat_file_line(path: str) -> str:
    escaped = _ffmpeg_path(path).replace("'", r"'\''")
    return f"file '{escaped}'"


def _write_concat_list(files: list[str], fps: float) -> str:
    fd, path = tempfile.mkstemp(suffix=".txt", prefix="cap_stv_concat_")
    os.close(fd)
    duration = 1.0 / float(fps)
    lines: list[str] = []
    for file_path in files:
        lines.append(_concat_file_line(file_path))
        lines.append(f"duration {duration:.9f}")
    if files:
        lines.append(_concat_file_line(files[-1]))
    with open(path, "w", encoding="utf-8", newline="\n") as wf:
        wf.write("\n".join(lines) + "\n")
    return path


def _detect_pattern(frames_dir: str):
    """Return (ffmpeg_pattern, ext, start_num) for the first numeric image sequence found."""
    files = _list_frame_files(frames_dir)

    if not files:
        return None, None, 0

    basename = os.path.basename(files[0])
    m = re.match(r"^(.*?)(\d+)(\.[^.]+)$", basename)
    if not m:
        return None, None, 0

    prefix, num_str, ext = m.group(1), m.group(2), m.group(3)
    start_num = int(num_str)
    pattern = f"{prefix}%0{len(num_str)}d{ext}"
    return os.path.join(frames_dir, pattern), ext.lstrip(".").lower(), start_num


def _write_images_tmp(images) -> tuple[list[str], str]:
    import numpy as np
    from PIL import Image

    tmp_dir = tempfile.mkdtemp(prefix="cap_stv_frames_")
    paths: list[str] = []
    try:
        for i, image in enumerate(images):
            path = os.path.join(tmp_dir, f"frame_{i:05d}.png")
            arr = image.cpu().numpy()
            if arr.dtype != np.uint8:
                arr = (arr * 255.0).clip(0, 255).astype(np.uint8)
            Image.fromarray(arr).save(path)
            paths.append(path)
    except Exception:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise
    if not paths:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise ValueError("images 批次为空")
    return paths, tmp_dir


def _write_audio_tmp(audio: dict) -> str | None:
    """Write ComfyUI AUDIO dict to a 16-bit PCM WAV temp file (no torchaudio)."""
    try:
        import numpy as np
        import torch

        waveform = audio["waveform"]
        sample_rate = audio["sample_rate"]
        if isinstance(sample_rate, torch.Tensor):
            sample_rate = int(sample_rate.item())
        else:
            sample_rate = int(sample_rate)

        if waveform.dim() == 3:
            waveform = waveform[0]
        elif waveform.dim() == 1:
            waveform = waveform.unsqueeze(0)

        wav = waveform.float().cpu().clamp(-1.0, 1.0).numpy()
        if wav.size == 0:
            log.warning("[CAP_SeqToVideo] audio waveform is empty")
            return None

        channels = int(wav.shape[0])
        fd, path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)

        with wave.open(path, "wb") as wf:
            wf.setnchannels(channels)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            pcm = (wav.T.reshape(-1) * 32767.0).astype(np.int16)
            wf.writeframes(pcm.tobytes())

        if os.path.getsize(path) <= 44:
            os.unlink(path)
            log.warning("[CAP_SeqToVideo] audio temp file has no samples")
            return None
        return path
    except Exception as exc:
        log.warning("[CAP_SeqToVideo] failed to write audio temp file: %s", exc)
        return None


class CAP_SeqToVideo:
    """Compose image sequence + audio into MP4 via ffmpeg."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "frames_dir": ("STRING", {"default": ""}),
                "fps": ("FLOAT", {"default": 24.0, "min": 1.0, "max": 240.0, "step": 0.1}),
                "filename_prefix": ("STRING", {"default": "STV"}),
            },
            "optional": {
                "images": ("IMAGE",),
                "audio": ("AUDIO",),
                "image_paths": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "tooltip": "逗号分隔的图片路径列表；优先级低于 images，高于序列帧目录。",
                }),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("filename",)
    OUTPUT_NODE = True
    FUNCTION = "execute"
    CATEGORY = "Capricorncd"
    DESCRIPTION = "Compose image sequence and optional audio into MP4 using ffmpeg."

    @classmethod
    def IS_CHANGED(cls, frames_dir, fps, filename_prefix, images=None, audio=None, image_paths=""):
        return float("nan")  # always re-run

    def _build_output_path(self, filename_prefix: str) -> tuple[str, str, str]:
        """Return (filename, subfolder, full_path) for ComfyUI /view API.

        filename_prefix may include subfolders (e.g. ``video/nsfw-audio/STV``).
        Those must go into ``subfolder``, not ``filename``, otherwise the
        browser preview URL cannot resolve the file.
        """
        output_dir = os.path.abspath(folder_paths.get_output_directory())
        stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        prefix = str(filename_prefix).strip().replace("\\", "/") or "STV"
        subfolder = os.path.dirname(prefix)
        base = os.path.basename(prefix) or "STV"
        output_filename = f"{base}_{stamp}.mp4"

        full_output_folder = os.path.abspath(os.path.join(output_dir, subfolder)) if subfolder else output_dir
        if os.path.commonpath((output_dir, full_output_folder)) != output_dir:
            raise ValueError("Saving video outside the output folder is not allowed.")
        os.makedirs(full_output_folder, exist_ok=True)

        output_path = os.path.join(full_output_folder, output_filename)
        subfolder_ui = subfolder.replace("\\", "/") if subfolder else ""
        return output_filename, subfolder_ui, output_path

    def _append_encode_args(self, cmd: list, audio_tmp: str | None, video_duration: float) -> list:
        if audio_tmp:
            cmd += [
                "-i", _ffmpeg_path(audio_tmp),
                "-map", "0:v:0",
                "-map", "1:a:0",
                "-c:v", "libx264",
                "-pix_fmt", "yuv420p",
                "-c:a", "aac",
                "-b:a", "192k",
                "-t", f"{video_duration:.6f}",
            ]
        else:
            cmd += [
                "-c:v", "libx264",
                "-pix_fmt", "yuv420p",
                "-t", f"{video_duration:.6f}",
            ]
        return cmd

    def _run_ffmpeg(self, cmd: list) -> None:
        kwargs: dict = {"capture_output": True, "text": True, "timeout": 600}
        if sys.platform == "win32":
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
        result = subprocess.run(cmd, **kwargs)
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg 执行失败:\n{result.stderr[-2000:]}")

    def execute(self, frames_dir: str, fps: float, filename_prefix: str, images=None, audio=None, image_paths=""):
        output_filename, subfolder, output_path = self._build_output_path(filename_prefix)
        fps = float(fps)

        audio_tmp = None
        if audio is not None:
            audio_tmp = _write_audio_tmp(audio)
            if audio_tmp:
                log.info("[CAP_SeqToVideo] audio tmp: %s", audio_tmp)
            else:
                log.warning("[CAP_SeqToVideo] audio 写入失败，将跳过音频轨道")

        concat_tmp = None
        frames_tmp_dir = None
        list_files: list[str] = []

        if images is not None:
            list_files, frames_tmp_dir = _write_images_tmp(images)
            mode = "images"
        else:
            list_files = _resolve_image_list(image_paths)
            if list_files:
                mode = "list"
            else:
                mode = "dir"

        if mode in ("images", "list"):
            frame_count = len(list_files)
            video_duration = frame_count / fps
            concat_tmp = _write_concat_list(list_files, fps)
            cmd = [
                "ffmpeg", "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", _ffmpeg_path(concat_tmp),
            ]
            log.info("[CAP_SeqToVideo] mode=%s frames=%d", mode, frame_count)
        else:
            frames_dir = str(frames_dir).strip()
            if not frames_dir or not os.path.isdir(frames_dir):
                raise ValueError(f"frames_dir 不是有效目录: {frames_dir!r}")

            pattern, _, start_num = _detect_pattern(frames_dir)
            if not pattern:
                raise ValueError(f"在目录中未找到图片序列: {frames_dir}")

            frame_count = len(_list_frame_files(frames_dir))
            video_duration = frame_count / fps
            cmd = [
                "ffmpeg", "-y",
                "-start_number", str(start_num),
                "-framerate", str(fps),
                "-i", _ffmpeg_path(pattern),
            ]
            log.info("[CAP_SeqToVideo] mode=dir frames=%d dir=%s", frame_count, frames_dir)

        cmd = self._append_encode_args(cmd, audio_tmp, video_duration)
        cmd.append(_ffmpeg_path(output_path))
        log.info(
            "[CAP_SeqToVideo] frames=%d duration=%.3fs",
            frame_count, video_duration,
        )
        log.info("[CAP_SeqToVideo] cmd: %s", " ".join(cmd))

        try:
            self._run_ffmpeg(cmd)
        finally:
            if audio_tmp and os.path.exists(audio_tmp):
                os.unlink(audio_tmp)
            if concat_tmp and os.path.exists(concat_tmp):
                os.unlink(concat_tmp)
            if frames_tmp_dir and os.path.isdir(frames_tmp_dir):
                shutil.rmtree(frames_tmp_dir, ignore_errors=True)

        log.info("[CAP_SeqToVideo] 输出: %s", output_path)
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


NODE_CLASS_MAPPINGS = {"CAP_SeqToVideo": CAP_SeqToVideo}
NODE_DISPLAY_NAME_MAPPINGS = {"CAP_SeqToVideo": "Seq To Video"}
