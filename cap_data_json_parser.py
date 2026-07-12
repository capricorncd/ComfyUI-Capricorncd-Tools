from __future__ import annotations
import json
import os

import numpy as np
import torch
from PIL import Image

from .timecode import resolve_media_path


class CAP_DataJsonClipParser:
    """Parse data_json from CAP_AudioTimeline or CAP_TimelineEditor and extract a clip by index."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "data_json": ("STRING", {"default": "", "multiline": True}),
                "index": ("INT", {"default": 0, "min": 0, "max": 9999, "step": 1}),
                "trim_offset": ("INT", {"default": 1, "min": 0, "max": 60, "step": 1,
                                        "tooltip": "音频修剪偏移（秒），结束时间 = clip_end_ms + trim_offset × 1000"}),
            },
        }

    RETURN_TYPES = ("AUDIO", "INT", "IMAGE", "IMAGE", "STRING")
    RETURN_NAMES = ("audio", "frame_count", "first_frame", "last_frame", "prompt")
    FUNCTION = "execute"
    CATEGORY = "Capricorncd"
    DESCRIPTION = (
        "Parse data_json from Audio Timeline or Timeline Editor and extract a clip by index. "
        "Outputs the clip audio segment, frame count, first/last keyframe images, and prompt."
    )

    @classmethod
    def IS_CHANGED(cls, data_json, index, trim_offset):
        return (data_json, index, trim_offset)

    def _load_waveform(self, audio_path: str):
        audio_path = os.path.normpath(str(audio_path or ""))
        from comfy_extras.nodes_audio import load
        try:
            return load(audio_path)
        except Exception:
            import torchaudio
            return torchaudio.load(audio_path)

    def _pack(self, waveform, sample_rate):
        if waveform.dim() == 2:
            waveform = waveform.unsqueeze(0)
        elif waveform.dim() == 3 and waveform.shape[0] != 1:
            waveform = waveform[:1]
        return {"waveform": waveform, "sample_rate": int(sample_rate)}

    def _trim(self, waveform, sample_rate, start_ms: int, end_ms: int):
        n = waveform.shape[-1]
        s = max(0, min(int(round(start_ms / 1000 * sample_rate)), max(0, n - 1)))
        e = max(s + 1, min(int(round(end_ms / 1000 * sample_rate)), n))
        result = waveform[..., s:e]
        if result.shape[-1] == 0:
            shape = list(waveform.shape[:-1]) + [1]
            result = torch.zeros(shape, dtype=waveform.dtype, device=waveform.device)
        return self._pack(result, sample_rate)

    def _resample_waveform(self, waveform, sample_rate, target_sample_rate):
        if sample_rate == target_sample_rate:
            return waveform
        try:
            import torchaudio.functional as AF
            if waveform.dim() == 3:
                return AF.resample(waveform.squeeze(0), sample_rate, target_sample_rate).unsqueeze(0)
            return AF.resample(waveform, sample_rate, target_sample_rate)
        except Exception:
            return waveform

    def _ensure_stereo_batch(self, waveform):
        if waveform.dim() == 2:
            waveform = waveform.unsqueeze(0)
        if waveform.shape[1] == 1:
            return waveform.repeat(1, 2, 1)
        if waveform.shape[1] > 2:
            return waveform[:, :2]
        return waveform

    def _silent_audio(self, sample_rate: int = 44100, duration_ms: int = 1000):
        n = max(1, int(round(duration_ms / 1000 * sample_rate)))
        return self._pack(torch.zeros(1, 2, n), sample_rate)

    def _load_image(self, path: str) -> torch.Tensor | None:
        if not path or not os.path.isfile(path):
            return None
        img = Image.open(path).convert("RGB")
        arr = np.array(img).astype(np.float32) / 255.0
        return torch.from_numpy(arr).unsqueeze(0)

    def _clip_use_global_prompt(self, clip: dict) -> bool:
        if "use_global_prompt" in clip:
            return bool(clip["use_global_prompt"])
        return not bool(self._strip_comment_lines(clip.get("prompt") or "").strip())

    def _strip_comment_lines(self, text: str) -> str:
        return "\n".join(
            line for line in str(text or "").split("\n")
            if not line.startswith("#")
        )

    def _compose_prompt(self, clip: dict, global_prompt: str) -> str:
        clip_prompt = self._strip_comment_lines(clip.get("prompt") or "")
        global_prompt = self._strip_comment_lines(global_prompt)
        if not self._clip_use_global_prompt(clip):
            return clip_prompt
        if global_prompt and clip_prompt:
            return f"{global_prompt}\n{clip_prompt}"
        return global_prompt or clip_prompt

    def _frame_count(self, start_ms: int, end_ms: int, fps: float) -> int:
        duration_ms = max(0, int(end_ms) - int(start_ms))
        if duration_ms <= 0:
            return 1
        return max(1, int(round(duration_ms * fps / 1000)))

    def _resolve_file_path(self, file_ref, location: str = "assets", assets_dir: str = "") -> str:
        return resolve_media_path(str(file_ref or ""), assets_dir=assets_dir, location=location)

    def _uses_master_audio(self, data: dict, clip: dict) -> bool:
        if clip.get("audios") is not None:
            return False
        return bool(str(data.get("audio_path") or "").strip())

    def _clip_audio_from_master(self, data: dict, clip: dict, trim_offset: int):
        trim_start_ms = int(data.get("trim_start_ms", 0))
        audio_path = str(data.get("audio_path", "") or "")
        clip_start_ms = int(clip.get("start_ms", 0))
        clip_end_ms = int(clip.get("end_ms", clip_start_ms))
        abs_start_ms = trim_start_ms + clip_start_ms
        abs_end_ms = trim_start_ms + max(clip_end_ms, clip_start_ms + 1) + int(trim_offset) * 1000
        duration_ms = max(1, clip_end_ms - clip_start_ms + int(trim_offset) * 1000)

        if audio_path and os.path.isfile(audio_path):
            waveform, sample_rate = self._load_waveform(audio_path)
            return self._trim(waveform, sample_rate, abs_start_ms, abs_end_ms)
        return self._silent_audio(44100, duration_ms)

    def _clip_audio_from_audios(self, clip: dict, trim_offset: int, sample_rate: int = 44100):
        clip_start_ms = int(clip.get("start_ms", 0))
        clip_end_ms = int(clip.get("end_ms", clip_start_ms))
        clip_duration_ms = max(1, clip_end_ms - clip_start_ms)
        output_ms = clip_duration_ms + int(trim_offset) * 1000
        n_out = max(1, int(round(output_ms / 1000 * sample_rate)))

        rows = clip.get("audios")
        if not isinstance(rows, list) or not rows:
            return self._silent_audio(sample_rate, output_ms)

        mixed = torch.zeros(1, 2, n_out)
        used = False

        for row in rows:
            if not isinstance(row, dict):
                continue
            path = os.path.normpath(self._resolve_file_path(row.get("file"), str(row.get("location") or "assets")))
            if not path or not os.path.isfile(path):
                continue

            src_start = max(0, int(row.get("source_start_ms", 0) or 0))
            src_end = max(src_start + 1, int(row.get("source_end_ms", src_start) or src_start))
            offset_ms = max(0, int(row.get("clip_offset_ms", 0) or 0))
            slice_ms = src_end - src_start
            if trim_offset and offset_ms + slice_ms >= clip_duration_ms - 1:
                src_end += int(trim_offset) * 1000

            try:
                waveform, sr = self._load_waveform(path)
            except Exception:
                continue
            if sr != sample_rate:
                waveform = self._resample_waveform(waveform, sr, sample_rate)
            seg = self._trim(waveform, sample_rate, src_start, src_end)["waveform"]
            seg = self._ensure_stereo_batch(seg)
            if seg.shape[1] != mixed.shape[1]:
                seg = seg.repeat(1, mixed.shape[1], 1) if seg.shape[1] == 1 else seg[:, :mixed.shape[1]]

            pos = max(0, int(round(offset_ms / 1000 * sample_rate)))
            seg_len = min(seg.shape[-1], n_out - pos)
            if seg_len <= 0:
                continue
            mixed[..., pos:pos + seg_len] += seg[..., :seg_len]
            used = True

        if not used:
            return self._silent_audio(sample_rate, output_ms)
        return self._pack(mixed, sample_rate)

    def execute(self, data_json: str, index: int, trim_offset: int = 1):
        try:
            data = json.loads(data_json or "{}")
        except json.JSONDecodeError:
            data = {}
        if not isinstance(data, dict):
            data = {}

        clips = data.get("clips", [])
        if not isinstance(clips, list):
            clips = []

        fps = max(1.0, float(data.get("fps", 24.0)))
        global_prompt = data.get("global_prompt", "")

        clip = clips[index] if clips and 0 <= index < len(clips) else {}
        if not isinstance(clip, dict):
            clip = {}

        clip_start_ms = int(clip.get("start_ms", 0))
        clip_end_ms = int(clip.get("end_ms", clip_start_ms))
        frame_count = self._frame_count(clip_start_ms, clip_end_ms, fps)
        prompt = self._compose_prompt(clip, global_prompt)

        if self._uses_master_audio(data, clip):
            audio_out = self._clip_audio_from_master(data, clip, trim_offset)
        else:
            audio_out = self._clip_audio_from_audios(clip, trim_offset)

        blank = torch.zeros(1, 64, 64, 3)
        first_path = str(clip.get("start_image") or "")
        last_path = str(clip.get("end_image") or "")
        _fi = self._load_image(first_path)
        _li = self._load_image(last_path)
        first_frame = _fi if _fi is not None else blank
        last_frame = _li if _li is not None else blank

        return (audio_out, frame_count, first_frame, last_frame, prompt)


NODE_CLASS_MAPPINGS = {"CAP_DataJsonClipParser": CAP_DataJsonClipParser}
NODE_DISPLAY_NAME_MAPPINGS = {"CAP_DataJsonClipParser": "Data Json Clip Parser"}
