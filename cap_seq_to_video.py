from __future__ import annotations
import datetime
import glob
import logging
import os
import re
import subprocess
import sys
import tempfile

import folder_paths

log = logging.getLogger(__name__)


def _detect_pattern(frames_dir: str):
    """Return (ffmpeg_pattern, ext) for the first numeric-named image sequence found."""
    exts = ["jpg", "jpeg", "png", "webp", "bmp"]
    files: list[str] = []
    for ext in exts:
        files.extend(glob.glob(os.path.join(frames_dir, f"*.{ext}")))
        files.extend(glob.glob(os.path.join(frames_dir, f"*.{ext.upper()}")))

    if not files:
        return None, None

    files = sorted(set(files))
    basename = os.path.basename(files[0])
    m = re.match(r"^(.*?)(\d+)(\.[^.]+)$", basename)
    if not m:
        return None, None

    prefix, num_str, ext = m.group(1), m.group(2), m.group(3)
    pattern = f"{prefix}%0{len(num_str)}d{ext}"
    return os.path.join(frames_dir, pattern), ext.lstrip(".").lower()


def _write_audio_tmp(audio: dict) -> str | None:
    try:
        import torchaudio
        waveform = audio["waveform"]
        sample_rate = int(audio["sample_rate"])
        if waveform.dim() == 3:
            waveform = waveform[0]
        fd, path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        torchaudio.save(path, waveform, sample_rate)
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
                "audio": ("AUDIO",),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("filename",)
    OUTPUT_NODE = True
    FUNCTION = "execute"
    CATEGORY = "Capricorncd"
    DESCRIPTION = "Compose image sequence and optional audio into MP4 using ffmpeg."

    @classmethod
    def IS_CHANGED(cls, frames_dir, fps, filename_prefix, audio=None):
        return float("nan")  # always re-run

    def execute(self, frames_dir: str, fps: float, filename_prefix: str, audio=None):
        frames_dir = str(frames_dir).strip()
        if not frames_dir or not os.path.isdir(frames_dir):
            raise ValueError(f"frames_dir 不是有效目录: {frames_dir!r}")

        pattern, _ = _detect_pattern(frames_dir)
        if not pattern:
            raise ValueError(f"在目录中未找到图片序列: {frames_dir}")

        output_dir = folder_paths.get_output_directory()
        stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        prefix = str(filename_prefix).strip() or "STV"
        output_filename = f"{prefix}_{stamp}.mp4"
        output_path = os.path.join(output_dir, output_filename)

        cmd = [
            "ffmpeg", "-y",
            "-framerate", str(float(fps)),
            "-i", pattern,
        ]

        audio_tmp = None
        if audio is not None:
            audio_tmp = _write_audio_tmp(audio)
            if audio_tmp:
                cmd += ["-i", audio_tmp]

        cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p"]

        if audio_tmp:
            cmd += ["-c:a", "aac", "-shortest"]

        cmd.append(output_path)

        kwargs: dict = {"capture_output": True, "text": True, "timeout": 600}
        if sys.platform == "win32":
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW

        try:
            result = subprocess.run(cmd, **kwargs)
            if result.returncode != 0:
                raise RuntimeError(f"ffmpeg 执行失败:\n{result.stderr[-2000:]}")
        finally:
            if audio_tmp and os.path.exists(audio_tmp):
                os.unlink(audio_tmp)

        log.info("[CAP_SeqToVideo] 输出: %s", output_path)

        return {
            "ui": {
                "video": [{"filename": output_filename, "subfolder": "", "type": "output"}]
            },
            "result": (output_filename,),
        }


NODE_CLASS_MAPPINGS = {"CAP_SeqToVideo": CAP_SeqToVideo}
NODE_DISPLAY_NAME_MAPPINGS = {"CAP_SeqToVideo": "Seq To Video"}
