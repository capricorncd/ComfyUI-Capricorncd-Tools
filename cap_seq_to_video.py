from __future__ import annotations
import datetime
import glob
import logging
import os
import re
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

        pattern, _, start_num = _detect_pattern(frames_dir)
        if not pattern:
            raise ValueError(f"在目录中未找到图片序列: {frames_dir}")

        frame_count = len(_list_frame_files(frames_dir))
        video_duration = frame_count / float(fps)

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
            "-i", _ffmpeg_path(pattern),
        ]

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

        cmd.append(_ffmpeg_path(output_path))
        log.info(
            "[CAP_SeqToVideo] frames=%d duration=%.3fs",
            frame_count, video_duration,
        )
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
