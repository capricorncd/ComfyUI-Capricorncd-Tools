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
    """Return (ffmpeg_pattern, ext, start_num) for the first numeric image sequence found."""
    exts = ["jpg", "jpeg", "png", "webp", "bmp"]
    files: list[str] = []
    for ext in exts:
        files.extend(glob.glob(os.path.join(frames_dir, f"*.{ext}")))
        files.extend(glob.glob(os.path.join(frames_dir, f"*.{ext.upper()}")))

    if not files:
        return None, None, 0

    files = sorted(set(files))
    basename = os.path.basename(files[0])
    m = re.match(r"^(.*?)(\d+)(\.[^.]+)$", basename)
    if not m:
        return None, None, 0

    prefix, num_str, ext = m.group(1), m.group(2), m.group(3)
    start_num = int(num_str)
    pattern = f"{prefix}%0{len(num_str)}d{ext}"
    return os.path.join(frames_dir, pattern), ext.lstrip(".").lower(), start_num


def _write_audio_tmp(audio: dict) -> str | None:
    try:
        import torchaudio
        waveform = audio["waveform"]
        sample_rate = int(audio["sample_rate"])
        if waveform.dim() == 3:
            waveform = waveform[0]
        fd, path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        torchaudio.save(path, waveform.cpu(), sample_rate,
                        encoding="PCM_S16", bits_per_sample=16)
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
                "use_seq_duration": ("BOOLEAN", {"default": True}),
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
    def IS_CHANGED(cls, frames_dir, fps, filename_prefix, use_seq_duration=True, audio=None):
        return float("nan")  # always re-run

    def execute(self, frames_dir: str, fps: float, filename_prefix: str,
                use_seq_duration: bool = True, audio=None):
        frames_dir = str(frames_dir).strip()
        if not frames_dir or not os.path.isdir(frames_dir):
            raise ValueError(f"frames_dir 不是有效目录: {frames_dir!r}")

        pattern, _, start_num = _detect_pattern(frames_dir)
        if not pattern:
            raise ValueError(f"在目录中未找到图片序列: {frames_dir}")

        output_dir = folder_paths.get_output_directory()
        stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        prefix = str(filename_prefix).strip() or "STV"
        output_filename = f"{prefix}_{stamp}.mp4"
        output_path = os.path.join(output_dir, output_filename)

        audio_tmp = None
        if audio is not None:
            audio_tmp = _write_audio_tmp(audio)
            if audio_tmp:
                log.info("[CAP_SeqToVideo] audio tmp: %s", audio_tmp)
            else:
                log.warning("[CAP_SeqToVideo] audio 写入失败，将跳过音频轨道")

        cmd = [
            "ffmpeg", "-y",
            "-start_number", str(start_num),
            "-framerate", str(float(fps)),
            "-i", pattern,
        ]

        if audio_tmp:
            cmd += ["-i", audio_tmp]

        cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p"]

        if audio_tmp:
            cmd += ["-c:a", "aac", "-map", "0:v:0", "-map", "1:a:0"]
            if not use_seq_duration:
                cmd.append("-shortest")

        cmd.append(output_path)
        log.info("[CAP_SeqToVideo] cmd: %s", " ".join(cmd))

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
