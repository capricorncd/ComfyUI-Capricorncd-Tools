from __future__ import annotations

import json
import os

import folder_paths

from .timecode import (
    expand_keyframe_files,
    format_timecode,
    list_keyframe_files_ordered,
    parse_timecode,
    required_keyframe_image_count,
)


def _list_audio_files() -> list[str]:
    input_dir = folder_paths.get_input_directory()
    files = folder_paths.filter_files_content_types(os.listdir(input_dir), ["audio", "video"])
    return sorted(files)


class AudioKeyframeTimeline:
    """Audio waveform timeline with trim range and keyframe markers."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "audio": (_list_audio_files(), {"audio_upload": True}),
                # Must be immediately after `audio` — Comfy AUDIOUPLOAD reads audioUI.element.
                "audioUI": ("AUDIO_UI",),
                "start_time": ("STRING", {"default": "00:00.00"}),
                "end_time": ("STRING", {"default": ""}),
                "fps": ("INT", {"default": 24, "min": 1, "max": 120, "step": 1}),
                "width": ("INT", {"default": 720, "min": 64, "max": 8192, "step": 1}),
                "height": ("INT", {"default": 1280, "min": 64, "max": 8192, "step": 1}),
                "keyframe_dir": ("STRING", {"default": "", "multiline": False}),
                "one_shot": ("BOOLEAN", {"default": False}),
                "keyframes_ms": (
                    "STRING",
                    {
                        "default": "[]",
                        "multiline": True,
                        "tooltip": "JSON array of keyframe timestamps in milliseconds.",
                    },
                ),
            },
        }

    # Slot 0 = AUDIO (same as Load Audio) so workflows can replace Load Audio without rewiring.
    RETURN_TYPES = ("AUDIO", "STRING", "INT", "BOOLEAN", "STRING", "INT", "INT")
    RETURN_NAMES = (
        "audio",
        "timeline_ms",
        "fps",
        "one_shot",
        "keyframe_files",
        "width",
        "height",
    )
    FUNCTION = "execute"
    CATEGORY = "Capricorncd"
    DESCRIPTION = (
        "Load audio, edit trim range and keyframes on an interactive timeline. "
        "Outputs trimmed AUDIO, timeline JSON (ms), fps, one_shot, expanded keyframe "
        "filename list (JSON), width, and height."
    )

    @classmethod
    def IS_CHANGED(cls, audio, start_time, end_time, fps, width, height, keyframe_dir, one_shot, keyframes_ms):
        return (audio, start_time, end_time, fps, width, height, keyframe_dir, one_shot, keyframes_ms)

    @classmethod
    def VALIDATE_INPUTS(cls, audio, start_time, end_time, fps, **kwargs):
        if not audio or not str(audio).strip():
            return "No audio file selected"
        if not folder_paths.exists_annotated_filepath(audio):
            return f"Invalid audio file: {audio}"
        try:
            parse_timecode(start_time, fps)
            if end_time and str(end_time).strip():
                parse_timecode(end_time, fps)
        except ValueError as exc:
            return str(exc)
        keyframes_ms = kwargs.get("keyframes_ms", "[]")
        try:
            data = json.loads(keyframes_ms or "[]")
            if not isinstance(data, list):
                return "keyframes_ms must be a JSON array"
        except json.JSONDecodeError:
            return "keyframes_ms must be valid JSON"
        return True

    def _load_audio(self, audio: str) -> tuple:
        from comfy_extras.nodes_audio import load

        audio_path = folder_paths.get_annotated_filepath(audio)
        waveform, sample_rate = load(audio_path)
        return waveform, sample_rate

    def _waveform_duration_ms(self, waveform, sample_rate: int) -> int:
        samples = waveform.shape[-1]
        return max(1, int(round(samples / sample_rate * 1000)))

    def _pack_audio_like_load_audio(self, waveform, sample_rate: int) -> dict:
        """Match LoadAudio output: {"waveform": [1, channels, samples], "sample_rate": int}."""
        if waveform.dim() == 2:
            waveform = waveform.unsqueeze(0)
        elif waveform.dim() == 3 and waveform.shape[0] != 1:
            waveform = waveform[:1]
        return {"waveform": waveform, "sample_rate": int(sample_rate)}

    def _trim_waveform_dict(self, waveform, sample_rate: int, start_ms: int, end_ms: int) -> dict:
        audio_length = waveform.shape[-1]
        start_frame = int(round(start_ms / 1000.0 * sample_rate))
        end_frame = int(round(end_ms / 1000.0 * sample_rate))
        start_frame = max(0, min(start_frame, max(0, audio_length - 1)))
        end_frame = max(start_frame + 1, min(end_frame, audio_length))
        trimmed = waveform[..., start_frame:end_frame]
        return self._pack_audio_like_load_audio(trimmed, sample_rate)

    def execute(
        self,
        audio: str,
        audioUI,
        start_time: str,
        end_time: str,
        fps: int,
        width: int,
        height: int,
        keyframe_dir: str,
        one_shot: bool,
        keyframes_ms: str,
    ):
        del audioUI  # frontend-only (AUDIO_UI widget)
        fps = max(1, int(fps))
        width = max(1, int(width))
        height = max(1, int(height))
        one_shot = bool(one_shot)

        waveform, sample_rate = self._load_audio(audio)
        duration_ms = self._waveform_duration_ms(waveform, sample_rate)
        start_ms = parse_timecode(start_time, fps)
        end_ms = parse_timecode(end_time, fps) if str(end_time).strip() else duration_ms
        start_ms = max(0, min(start_ms, duration_ms))
        end_ms = max(start_ms, min(end_ms, duration_ms))

        try:
            raw = json.loads(keyframes_ms or "[]")
        except json.JSONDecodeError:
            raw = []

        times: list[int] = []
        for item in raw:
            try:
                times.append(int(item))
            except (TypeError, ValueError):
                continue

        times = sorted(set(times))
        times = [t for t in times if start_ms <= t <= end_ms]
        if start_ms not in times:
            times.insert(0, start_ms)
        if end_ms not in times:
            times.append(end_ms)
        times = sorted(set(times))

        # one_shot: collapse to single boundary pair semantics for downstream consumers
        if one_shot and len(times) >= 2:
            times = [start_ms, end_ms]

        duration_ms_full = self._waveform_duration_ms(waveform, sample_rate)
        if start_ms <= 0 and end_ms >= duration_ms_full:
            audio_out = self._pack_audio_like_load_audio(waveform, sample_rate)
        else:
            audio_out = self._trim_waveform_dict(waveform, sample_rate, start_ms, end_ms)

        source_files = list_keyframe_files_ordered(keyframe_dir)
        needed = required_keyframe_image_count(len(times), one_shot)
        expanded_files = expand_keyframe_files(source_files, needed)
        keyframe_files_json = json.dumps(expanded_files, ensure_ascii=False)

        return (
            audio_out,
            json.dumps(times),
            fps,
            one_shot,
            keyframe_files_json,
            width,
            height,
        )


NODE_CLASS_MAPPINGS = {
    "AudioKeyframeTimeline": AudioKeyframeTimeline,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AudioKeyframeTimeline": "Audio Keyframe Timeline",
}
