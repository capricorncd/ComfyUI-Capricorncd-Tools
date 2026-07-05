"""Fullscreen timeline editor — no node-level audio; audio lives on timeline tracks."""

from __future__ import annotations

import json
import os

import folder_paths
import torch

from .cap_audio_timeline import CAP_AudioTimeline, _clip_use_global_prompt, _strip_comment_lines, _subtract_intervals
from .timecode import resolve_assets_dir


class CAP_TimelineEditor(CAP_AudioTimeline):
    """Timeline edited in fullscreen NLE UI; audio is optional and placed on audio tracks."""

    DESCRIPTION = (
        "Fullscreen timeline editor. Audio is added on audio tracks inside the editor — "
        "no audio widget on the node. Use 「时间轴编辑」 to open."
    )

    RETURN_TYPES = ("FLOAT", "INT", "INT", "STRING", "STRING", "INT", "INT", "AUDIO", "STRING")
    RETURN_NAMES = (
        "fps",
        "width",
        "height",
        "global_prompt",
        "data_json",
        "clips_length",
        "total_frame_count",
        "clips_audio",
        "frame_seq_dir",
    )
    FUNCTION = "execute"
    CATEGORY = "Capricorncd"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "fps": ("FLOAT", {"default": 24.0, "min": 1.0, "max": 240.0, "step": 0.1}),
                "width": ("INT", {"default": 720, "min": 64, "max": 8192, "step": 1}),
                "height": ("INT", {"default": 1280, "min": 64, "max": 8192, "step": 1}),
                "assets_dir": ("STRING", {"default": "", "multiline": False}),
                "global_prompt": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": True,
                        "tooltip": "Default prompt applied to all image clips unless overridden.",
                    },
                ),
                "clips_json": (
                    "STRING",
                    {
                        "default": "[]",
                        "multiline": True,
                        "tooltip": (
                            "JSON clips: image + audio. Fields include clip_type, track, "
                            "start_ms, end_ms, start_image, audio_file, muted, disabled, …"
                        ),
                    },
                ),
                "tracks_json": (
                    "STRING",
                    {
                        "default": "[]",
                        "multiline": True,
                        "tooltip": "JSON track layout: type, locked, visible, muted, trackIndex, …",
                    },
                ),
                "trim_offset": (
                    "INT",
                    {
                        "default": 1,
                        "min": 0,
                        "max": 60,
                        "step": 1,
                        "tooltip": "Reserved; trimmed_audio output removed from this node.",
                    },
                ),
            },
        }

    @classmethod
    def IS_CHANGED(cls, fps, width, height, assets_dir, global_prompt,
                   clips_json, tracks_json, trim_offset, **_):
        return (fps, width, height, assets_dir, global_prompt,
                clips_json, tracks_json, trim_offset)

    @classmethod
    def VALIDATE_INPUTS(cls, **_):
        return True

    def _silent_audio(self, sample_rate: int = 44100, duration_ms: int = 1000):
        n = max(1, int(round(duration_ms / 1000 * sample_rate)))
        wf = torch.zeros(1, 1, n)
        return {"waveform": wf, "sample_rate": sample_rate}

    def _timeline_duration_ms(self, clips: list[dict]) -> int:
        if not clips:
            return 1000
        return max(1, max(int(c.get("end_ms", 0) or 0) for c in clips))

    def _pick_master_audio(self, clips: list[dict]) -> str | None:
        audio_clips = [
            c for c in clips
            if str(c.get("clip_type", "")).lower() == "audio" and c.get("audio_file")
        ]
        if not audio_clips:
            return None
        audio_clips.sort(key=lambda c: int(c.get("start_ms", 0)))
        return str(audio_clips[0]["audio_file"])

    def _track_hidden_or_muted(self, tracks_cfg: list[dict], track_index: int, clip_type: str) -> bool:
        for t in tracks_cfg:
            if int(t.get("trackIndex", -1)) != track_index:
                continue
            if t.get("locked"):
                pass
            if clip_type == "image" and t.get("visible") is False:
                return True
            if clip_type == "audio" and t.get("muted"):
                return True
        return False

    def execute(
        self,
        fps,
        width,
        height,
        assets_dir,
        global_prompt,
        clips_json,
        tracks_json="[]",
        trim_offset=1,
    ):
        fps = max(1.0, float(fps))
        width = max(1, int(width))
        height = max(1, int(height))
        global_prompt = _strip_comment_lines(global_prompt)

        try:
            clips = json.loads(clips_json or "[]")
            if not isinstance(clips, list):
                clips = []
        except json.JSONDecodeError:
            clips = []

        try:
            tracks_cfg = json.loads(tracks_json or "[]")
            if not isinstance(tracks_cfg, list):
                tracks_cfg = []
        except json.JSONDecodeError:
            tracks_cfg = []

        image_clips = [c for c in clips if str(c.get("clip_type", "image")).lower() != "audio"]
        dur_ms = self._timeline_duration_ms(clips)
        start_ms = 0
        end_ms = dur_ms

        master_audio = self._pick_master_audio(clips)
        if master_audio and folder_paths.exists_annotated_filepath(master_audio):
            audio_path = folder_paths.get_annotated_filepath(master_audio)
            waveform, sample_rate = self._load_audio(master_audio)
        else:
            audio_path = ""
            sample_rate = 44100
            waveform = self._silent_audio(sample_rate, dur_ms)["waveform"]

        img_dir = resolve_assets_dir(assets_dir) if assets_dir else ""

        def resolve_img(name: str) -> str:
            if not name:
                return ""
            if img_dir:
                return os.path.join(img_dir, name)
            return name

        def base_clip(c: dict, z_index: int) -> dict:
            return {
                "start_image": resolve_img(c.get("start_image") or ""),
                "end_image": resolve_img(c.get("end_image") or ""),
                "prompt": _strip_comment_lines(c.get("prompt") or ""),
                "use_global_prompt": _clip_use_global_prompt(c),
                "z_index": z_index,
            }

        main_clips = [
            c for c in image_clips
            if int(c.get("track", 0) or 0) != 1
            and not c.get("disabled")
            and not self._track_hidden_or_muted(tracks_cfg, int(c.get("track", 0) or 0), "image")
        ]
        overlay_clips = [
            c for c in image_clips
            if int(c.get("track", 0) or 0) == 1
            and not c.get("disabled")
            and not self._track_hidden_or_muted(tracks_cfg, 1, "image")
        ]

        enabled_overlays = list(overlay_clips)
        overlay_cuts = [(int(c.get("start_ms", 0)), int(c.get("end_ms", 0))) for c in enabled_overlays]

        segments = []
        for c in enabled_overlays:
            seg = base_clip(c, 2)
            seg["start_ms"] = int(c.get("start_ms", 0))
            seg["end_ms"] = int(c.get("end_ms", 0))
            segments.append(seg)

        for c in main_clips:
            s = int(c.get("start_ms", 0))
            e = int(c.get("end_ms", 0))
            for ps, pe in _subtract_intervals(s, e, overlay_cuts):
                if pe <= ps:
                    continue
                seg = base_clip(c, 1)
                seg["start_ms"] = ps
                seg["end_ms"] = pe
                segments.append(seg)

        segments.sort(key=lambda r: (r["start_ms"], r["z_index"]))

        clips_for_json = []
        for r in segments:
            end_image = r.get("end_image") or ""
            clips_for_json.append(
                {
                    "start_ms": r["start_ms"],
                    "end_ms": r["end_ms"],
                    "start_image": r["start_image"],
                    "end_image": end_image,
                    "prompt": r["prompt"],
                    "use_global_prompt": bool(r.get("use_global_prompt", True)),
                    "z_index": r["z_index"],
                }
            )

        clips_length = len(clips_for_json)
        total_frame_count = max(
            1,
            sum(int(round((r["end_ms"] - r["start_ms"]) * fps / 1000)) for r in segments) if segments else 1,
        )

        clips_audio_out = (
            self._concat_clips_audio(waveform, sample_rate, start_ms, segments)
            if segments
            else self._trim(waveform, sample_rate, start_ms, start_ms + 1)
        )

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
                "global_prompt": global_prompt,
                "clips": clips_for_json,
            },
            ensure_ascii=False,
        )

        return (
            fps,
            width,
            height,
            global_prompt,
            data_json,
            clips_length,
            total_frame_count,
            clips_audio_out,
            frame_seq_dir,
        )


NODE_CLASS_MAPPINGS = {"CAP_TimelineEditor": CAP_TimelineEditor}
NODE_DISPLAY_NAME_MAPPINGS = {"CAP_TimelineEditor": "Timeline Editor"}
