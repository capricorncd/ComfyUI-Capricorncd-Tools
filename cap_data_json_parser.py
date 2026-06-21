from __future__ import annotations
import json
import os

import numpy as np
import torch
from PIL import Image


class CAP_DataJsonClipParser:
    """Parse data_json from CAP_AudioTimeline and extract a clip by index."""

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
        "Parse data_json output from Audio Timeline and extract a specific clip by index. "
        "Outputs the trimmed audio segment, frame count, first/last keyframe images, and prompt."
    )

    @classmethod
    def IS_CHANGED(cls, data_json, index, trim_offset):
        return (data_json, index, trim_offset)

    def _load_waveform(self, audio_path: str):
        # Use torchaudio directly for absolute paths; fall back to comfy's loader for
        # video containers or ComfyUI-annotated paths.
        try:
            import torchaudio
            return torchaudio.load(audio_path)
        except Exception:
            from comfy_extras.nodes_audio import load
            return load(audio_path)

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
        # Guard: empty waveform (n=0) or slice beyond range → pad with silence
        if result.shape[-1] == 0:
            shape = list(waveform.shape[:-1]) + [1]
            result = torch.zeros(shape, dtype=waveform.dtype, device=waveform.device)
        return self._pack(result, sample_rate)

    def _load_image(self, path: str) -> torch.Tensor | None:
        if not path or not os.path.isfile(path):
            return None
        img = Image.open(path).convert("RGB")
        arr = np.array(img).astype(np.float32) / 255.0
        return torch.from_numpy(arr).unsqueeze(0)  # [1, H, W, 3]

    def execute(self, data_json: str, index: int, trim_offset: int = 1):
        try:
            data = json.loads(data_json or "{}")
        except json.JSONDecodeError:
            data = {}

        clips = data.get("clips", [])
        fps = max(1.0, float(data.get("fps", 24.0)))
        trim_start_ms = int(data.get("trim_start_ms", 0))
        audio_path = data.get("audio_path", "")
        global_prompt = data.get("global_prompt", "")

        clip = clips[index] if clips and 0 <= index < len(clips) else {}

        clip_start_ms = int(clip.get("start_ms", 0))
        clip_end_ms = int(clip.get("end_ms", clip_start_ms))
        # Ensure at least 1 sample of separation for audio trim, but use the real
        # end_ms for frame_count so that a 0-duration placeholder doesn't produce 1.
        abs_start_ms = trim_start_ms + clip_start_ms
        abs_end_ms = trim_start_ms + max(clip_end_ms, clip_start_ms + 1) + int(trim_offset) * 1000

        duration_ms = clip_end_ms - clip_start_ms
        seconds = duration_ms // 1000
        ms_rem = duration_ms % 1000
        frame_count = max(1, int(seconds * fps) + round(ms_rem * fps / 1000))
        prompt = clip.get("prompt") or global_prompt

        # Trimmed audio for this clip
        if audio_path and os.path.isfile(audio_path):
            waveform, sample_rate = self._load_waveform(audio_path)
            audio_out = self._trim(waveform, sample_rate, abs_start_ms, abs_end_ms)
        else:
            # 1 second of stereo silence — 1 sample would resample to 0 at 16kHz
            audio_out = {"waveform": torch.zeros(1, 2, 44100), "sample_rate": 44100}

        blank = torch.zeros(1, 64, 64, 3)
        _fi = self._load_image(clip.get("start_image", ""))
        _li = self._load_image(clip.get("end_image", ""))
        first_frame = _fi if _fi is not None else blank
        last_frame = _li if _li is not None else blank

        return (audio_out, frame_count, first_frame, last_frame, prompt)


NODE_CLASS_MAPPINGS = {"CAP_DataJsonClipParser": CAP_DataJsonClipParser}
NODE_DISPLAY_NAME_MAPPINGS = {"CAP_DataJsonClipParser": "Data Json Clip Parser"}
