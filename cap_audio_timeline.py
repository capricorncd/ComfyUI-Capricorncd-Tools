from __future__ import annotations
import json
import os
import folder_paths
from .timecode import parse_timecode, resolve_keyframe_dir


def _strip_comment_lines(text: str) -> str:
    return "\n".join(
        line for line in str(text or "").split("\n")
        if not line.startswith("#")
    )


def _clip_use_global_prompt(clip: dict) -> bool:
    if "use_global_prompt" in clip:
        return bool(clip["use_global_prompt"])
    return not bool(_strip_comment_lines(clip.get("prompt") or "").strip())


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
                "fps": ("FLOAT", {"default": 24.0, "min": 1.0, "max": 240.0, "step": 0.1}),
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
                        "tooltip": "JSON: [{start_ms, end_ms, start_image, end_image, prompt, use_global_prompt}, ...] Times are relative to trimmed audio start.",
                    },
                ),
                "trim_offset": ("INT", {"default": 1, "min": 0, "max": 60, "step": 1,
                                        "tooltip": "音频修剪时长偏移（秒），trimmed_audio 的结束时间 = end_ms + trim_offset × 1000，不影响 data_json 时间轴与 clips_audio。"}),
            },
        }

    RETURN_TYPES = ("AUDIO", "FLOAT", "BOOLEAN", "INT", "INT", "STRING", "STRING", "INT", "INT", "AUDIO", "STRING")
    RETURN_NAMES = (
        "trimmed_audio", "fps", "one_shot", "width", "height",
        "global_prompt", "data_json", "clips_length", "total_frame_count", "clips_audio",
        "frame_seq_dir",
    )
    FUNCTION = "execute"
    CATEGORY = "Capricorncd"
    DESCRIPTION = (
        "Audio timeline with waveform trim, image keyframe editor, "
        "and per-clip / global prompts. "
        "trimmed_audio: full trim range (+trim_offset); "
        "clips_audio: concatenated audio from enabled clips only; "
        "frame_seq_dir: temp directory for frame sequences (created/cleared on each run)."
    )

    @classmethod
    def IS_CHANGED(cls, audio, start_time, end_time, fps, width, height,
                   keyframe_dir, one_shot, global_prompt, clips_json, trim_offset, **_):
        return (audio, start_time, end_time, fps, width, height,
                keyframe_dir, one_shot, global_prompt, clips_json, trim_offset)

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

    def _prepare_frame_seq_dir(self) -> str:
        import shutil
        seq_dir = os.path.join(folder_paths.get_output_directory(), "temp", "capricorncd-frame-sequences")
        if os.path.exists(seq_dir):
            for name in os.listdir(seq_dir):
                item = os.path.join(seq_dir, name)
                shutil.rmtree(item) if os.path.isdir(item) else os.remove(item)
        else:
            os.makedirs(seq_dir)
        return seq_dir

    def _concat_clips_audio(self, waveform, sample_rate, trim_start_ms, clips: list[dict]):
        import torch

        ordered = sorted(clips, key=lambda c: int(c.get("start_ms", 0)))
        segments = []
        for clip in ordered:
            abs_start = trim_start_ms + int(clip.get("start_ms", 0))
            abs_end = trim_start_ms + int(clip.get("end_ms", abs_start))
            seg = self._trim(waveform, sample_rate, abs_start, abs_end)
            segments.append(seg["waveform"])

        if not segments:
            return self._trim(waveform, sample_rate, trim_start_ms, trim_start_ms + 1)
        return self._pack(torch.cat(segments, dim=-1), sample_rate)

    def execute(self, audio, audioUI, start_time, end_time, fps, width, height,
                keyframe_dir, one_shot, global_prompt, clips_json, trim_offset=1):
        del audioUI
        fps = max(1.0, float(fps))
        width = max(1, int(width))
        height = max(1, int(height))
        one_shot = bool(one_shot)
        global_prompt = _strip_comment_lines(global_prompt)

        audio_path = folder_paths.get_annotated_filepath(audio)
        waveform, sample_rate = self._load_audio(audio)
        dur = self._duration_ms(waveform, sample_rate)
        start_ms = parse_timecode(start_time, fps)
        end_ms = parse_timecode(end_time, fps) if str(end_time).strip() else dur
        start_ms = max(0, min(start_ms, dur))
        end_ms = max(start_ms + 1, min(end_ms, dur))

        # Always output the trimmed audio segment (end extended by trim_offset seconds)
        trimmed_audio_out = self._trim(waveform, sample_rate, start_ms, end_ms + int(trim_offset) * 1000)

        try:
            clips = json.loads(clips_json or "[]")
            if not isinstance(clips, list):
                clips = []
        except json.JSONDecodeError:
            clips = []

        # Resolve image paths to absolute paths for data_json
        img_dir = resolve_keyframe_dir(keyframe_dir) if keyframe_dir else ""

        def resolve_img(name: str) -> str:
            if not name:
                return ""
            if img_dir:
                return os.path.join(img_dir, name)
            return name

        # Build resolved clips with start/end images before applying end_image rules
        # Skip disabled clips entirely
        resolved = [
            {
                "start_ms": c.get("start_ms", 0),
                "end_ms": c.get("end_ms", 0),
                "start_image": resolve_img(c.get("start_image") or ""),
                "end_image": resolve_img(c.get("end_image") or ""),
                "prompt": _strip_comment_lines(c.get("prompt") or ""),
                "use_global_prompt": _clip_use_global_prompt(c),
            }
            for c in clips
            if not c.get("disabled", False)
        ]

        # Apply end_image rules per one_shot mode
        clips_for_json = []
        last_idx = len(resolved) - 1
        for i, r in enumerate(resolved):
            if one_shot and i < last_idx:
                # One-shot: non-last clip's end frame = next clip's start frame
                end_image = resolved[i + 1]["start_image"]
            else:
                # one_shot last clip, or one_shot=False: use configured end_image,
                # fall back to this clip's start_image when not set
                end_image = r["end_image"] or r["start_image"]
            clips_for_json.append(
                {
                    "start_ms": r["start_ms"],
                    "end_ms": r["end_ms"],
                    "start_image": r["start_image"],
                    "end_image": end_image,
                    "prompt": r["prompt"],
                    "use_global_prompt": bool(r.get("use_global_prompt", True)),
                }
            )

        clips_length = len(clips_for_json)
        total_frame_count = max(1, sum(
            int(round((r["end_ms"] - r["start_ms"]) * fps / 1000))
            for r in resolved
        ) if resolved else 1)

        clips_audio_out = self._concat_clips_audio(waveform, sample_rate, start_ms, resolved)
        frame_seq_dir = self._prepare_frame_seq_dir()

        data_json = json.dumps(
            {
                "audio_path": audio_path,
                "trim_start_ms": start_ms,
                "trim_end_ms": end_ms,
                "total_frame_count": total_frame_count,
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
            trimmed_audio_out,
            fps,
            one_shot,
            width,
            height,
            global_prompt,
            data_json,
            clips_length,
            total_frame_count,
            clips_audio_out,
            frame_seq_dir,
        )


NODE_CLASS_MAPPINGS = {"CAP_AudioTimeline": CAP_AudioTimeline}
NODE_DISPLAY_NAME_MAPPINGS = {"CAP_AudioTimeline": "Audio Timeline"}
