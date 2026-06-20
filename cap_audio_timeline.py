from __future__ import annotations
import json
import os
import folder_paths
from .timecode import parse_timecode, resolve_keyframe_dir


def _list_audio_files():
    input_dir = folder_paths.get_input_directory()
    files = folder_paths.filter_files_content_types(os.listdir(input_dir), ["audio", "video"])
    return sorted(files)


class CAP_AudioTimeline:
    """Audio waveform trim + image keyframe timeline with per-clip prompts."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "audio": (_list_audio_files(), {"audio_upload": True}),
                "audioUI": ("AUDIO_UI",),
                "start_time": ("STRING", {"default": "00:00.00"}),
                "end_time": ("STRING", {"default": ""}),
                "fps": ("INT", {"default": 24, "min": 1, "max": 120, "step": 1}),
                "width": ("INT", {"default": 720, "min": 64, "max": 8192, "step": 1}),
                "height": ("INT", {"default": 1280, "min": 64, "max": 8192, "step": 1}),
                "keyframe_dir": ("STRING", {"default": "", "multiline": False}),
                "one_shot": ("BOOLEAN", {"default": True}),
                "global_prompt": (
                    "STRING",
                    {"default": "", "multiline": True, "tooltip": "Default prompt applied to all clips unless overridden."},
                ),
                "clips_json": (
                    "STRING",
                    {
                        "default": "[]",
                        "multiline": True,
                        "tooltip": "JSON: [{start_ms, end_ms, start_image, end_image, prompt}, ...] Times are relative to trimmed audio start.",
                    },
                ),
            },
        }

    RETURN_TYPES = ("AUDIO", "INT", "BOOLEAN", "INT", "INT", "STRING", "STRING")
    RETURN_NAMES = ("audio", "fps", "one_shot", "width", "height", "global_prompt", "data_json")
    FUNCTION = "execute"
    CATEGORY = "Capricorncd"
    DESCRIPTION = (
        "Audio timeline with waveform trim, image keyframe editor, "
        "and per-clip / global prompts."
    )

    @classmethod
    def IS_CHANGED(cls, audio, start_time, end_time, fps, width, height,
                   keyframe_dir, one_shot, global_prompt, clips_json, **_):
        return (audio, start_time, end_time, fps, width, height,
                keyframe_dir, one_shot, global_prompt, clips_json)

    @classmethod
    def VALIDATE_INPUTS(cls, audio, **_):
        if not audio or not str(audio).strip():
            return "No audio file selected"
        if not folder_paths.exists_annotated_filepath(audio):
            return f"Invalid audio file: {audio}"
        return True

    def _load_audio(self, audio):
        from comfy_extras.nodes_audio import load
        return load(folder_paths.get_annotated_filepath(audio))

    def _duration_ms(self, waveform, sample_rate):
        return max(1, int(round(waveform.shape[-1] / sample_rate * 1000)))

    def _pack(self, waveform, sample_rate):
        if waveform.dim() == 2:
            waveform = waveform.unsqueeze(0)
        elif waveform.dim() == 3 and waveform.shape[0] != 1:
            waveform = waveform[:1]
        return {"waveform": waveform, "sample_rate": int(sample_rate)}

    def _trim(self, waveform, sample_rate, start_ms, end_ms):
        n = waveform.shape[-1]
        s = max(0, min(int(round(start_ms / 1000 * sample_rate)), max(0, n - 1)))
        e = max(s + 1, min(int(round(end_ms / 1000 * sample_rate)), n))
        return self._pack(waveform[..., s:e], sample_rate)

    def execute(self, audio, audioUI, start_time, end_time, fps, width, height,
                keyframe_dir, one_shot, global_prompt, clips_json):
        del audioUI
        fps = max(1, int(fps))
        width = max(1, int(width))
        height = max(1, int(height))
        one_shot = bool(one_shot)
        global_prompt = str(global_prompt or "")

        audio_path = folder_paths.get_annotated_filepath(audio)
        waveform, sample_rate = self._load_audio(audio)
        dur = self._duration_ms(waveform, sample_rate)
        start_ms = parse_timecode(start_time, fps)
        end_ms = parse_timecode(end_time, fps) if str(end_time).strip() else dur
        start_ms = max(0, min(start_ms, dur))
        end_ms = max(start_ms + 1, min(end_ms, dur))

        # Always output the trimmed audio segment
        audio_out = self._trim(waveform, sample_rate, start_ms, end_ms)

        try:
            clips = json.loads(clips_json or "[]")
            if not isinstance(clips, list):
                clips = []
        except json.JSONDecodeError:
            clips = []

        # Fill missing per-clip prompts with global_prompt
        for c in clips:
            if not c.get("prompt"):
                c["prompt"] = global_prompt

        # Resolve image paths to absolute paths for data_json
        img_dir = resolve_keyframe_dir(keyframe_dir) if keyframe_dir else ""

        def resolve_img(name: str) -> str:
            if not name:
                return ""
            if img_dir:
                return os.path.join(img_dir, name)
            return name

        clips_for_json = [
            {
                "start_ms": c.get("start_ms", 0),
                "end_ms": c.get("end_ms", 0),
                "start_image": resolve_img(c.get("start_image") or ""),
                "end_image": resolve_img(c.get("end_image") or ""),
                "prompt": c.get("prompt", ""),
            }
            for c in clips
        ]

        data_json = json.dumps(
            {
                "audio_path": audio_path,
                "trim_start_ms": start_ms,
                "trim_end_ms": end_ms,
                "fps": fps,
                "width": width,
                "height": height,
                "one_shot": one_shot,
                "global_prompt": global_prompt,
                "clips": clips_for_json,
            },
            ensure_ascii=False,
        )

        return (
            audio_out,
            fps,
            one_shot,
            width,
            height,
            global_prompt,
            data_json,
        )


NODE_CLASS_MAPPINGS = {"CAP_AudioTimeline": CAP_AudioTimeline}
NODE_DISPLAY_NAME_MAPPINGS = {"CAP_AudioTimeline": "Audio Timeline"}
