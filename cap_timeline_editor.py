"""Fullscreen timeline editor backed by a track-nested project document."""

from __future__ import annotations

import json
import os
import re

import torch
import folder_paths

from .cap_audio_timeline import CAP_AudioTimeline, _clip_use_global_prompt, _strip_comment_lines, _subtract_intervals
from .timecode import resolve_assets_dir


def _read_project_version() -> str:
    """Read the package version without requiring Python 3.11's tomllib."""
    path = os.path.join(os.path.dirname(__file__), "pyproject.toml")
    try:
        with open(path, "rb") as stream:
            try:
                import tomllib
                value = tomllib.load(stream).get("project", {}).get("version")
                if value:
                    return str(value)
            except ImportError:
                pass
    except OSError:
        return "0.0.0"

    try:
        with open(path, "r", encoding="utf-8") as stream:
            text = stream.read()
        match = re.search(r'(?ms)^\[project\]\s*$.*?^version\s*=\s*["\']([^"\']+)', text)
        return match.group(1) if match else "0.0.0"
    except OSError:
        return "0.0.0"


PROJECT_VERSION = _read_project_version()


class CAP_TimelineEditor(CAP_AudioTimeline):
    """Edit a project document and derive a compact downstream runtime document."""

    DESCRIPTION = (
        "Fullscreen timeline editor. The editor stores one track-nested project_json; "
        "data_json contains only enabled runtime clips and their intersecting audio slices."
    )

    RETURN_TYPES = ("FLOAT", "INT", "INT", "STRING", "STRING", "INT", "INT", "AUDIO", "STRING")
    RETURN_NAMES = (
        "fps", "width", "height", "global_prompt", "data_json",
        "clips_length", "total_frame_count", "clips_audio", "frame_seq_dir",
    )
    FUNCTION = "execute"
    CATEGORY = "Capricorncd"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "fps": ("FLOAT", {"default": 24.0, "min": 1.0, "max": 240.0, "step": 0.1}),
                "width": ("INT", {"default": 1280, "min": 64, "max": 8192, "step": 1}),
                "height": ("INT", {"default": 720, "min": 64, "max": 8192, "step": 1}),
                "assets_dir": ("STRING", {"default": "", "multiline": False}),
                "global_prompt": ("STRING", {"default": "", "multiline": True}),
                "ignore_occluded": ("BOOLEAN", {"default": True, "label_on": "忽略遮挡", "label_off": "输出全部"}),
                "project_version": ("STRING", {"default": PROJECT_VERSION}),
                "project_json": (
                    "STRING",
                    {
                        "default": json.dumps({
                            "project_version": PROJECT_VERSION,
                            "schema_version": PROJECT_VERSION,
                            "name": "未命名项目",
                            "resources": [],
                            "settings": {},
                            "tracks": [],
                        }, ensure_ascii=False),
                        "multiline": True,
                        "tooltip": "Track-nested editable timeline project (schema version 1).",
                    },
                ),
                "trim_offset": ("INT", {"default": 1, "min": 0, "max": 60, "step": 1}),
            },
        }

    @classmethod
    def IS_CHANGED(cls, fps, width, height, assets_dir, global_prompt,
                   ignore_occluded, project_version, project_json, trim_offset, **_):
        return fps, width, height, assets_dir, global_prompt, ignore_occluded, project_version, project_json, trim_offset

    @classmethod
    def VALIDATE_INPUTS(cls, **_):
        return True

    def _silent_audio(self, sample_rate: int = 44100, duration_ms: int = 1000):
        n = max(1, int(round(duration_ms / 1000 * sample_rate)))
        return {"waveform": torch.zeros(1, 2, n), "sample_rate": sample_rate}

    def _load_audio_path(self, path: str):
        try:
            import torchaudio
            waveform, sample_rate = torchaudio.load(path)
            return waveform, int(sample_rate)
        except Exception:
            from comfy_extras.nodes_audio import load
            return load(path)

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

    @staticmethod
    def _ensure_stereo_batch(waveform):
        if waveform.dim() == 2:
            waveform = waveform.unsqueeze(0)
        if waveform.shape[1] == 1:
            return waveform.repeat(1, 2, 1)
        if waveform.shape[1] > 2:
            return waveform[:, :2]
        return waveform

    def _timeline_duration_ms(self, runtime_clips: list[dict], audio_clips: list[dict]) -> int:
        duration_ms = max((int(c["end_ms"]) for c in runtime_clips), default=0)
        for clip in audio_clips:
            duration_ms = max(duration_ms, self._clip_range(clip)[1])
        return max(duration_ms, 1)

    def _mix_timeline_audio(self, audio_clips: list[dict], duration_ms: int, resolve_media, sample_rate: int = 44100):
        n = max(1, int(round(duration_ms / 1000 * sample_rate)))
        mixed = torch.zeros(1, 2, n)
        used = False

        for clip in audio_clips:
            clip_start, clip_end = self._clip_range(clip)
            if clip_end <= clip_start:
                continue
            source = self._source(clip)
            path = resolve_media(str(source.get("file") or ""), str(source.get("location") or "assets"))
            if not path or not os.path.isfile(path):
                continue
            try:
                waveform, sr = self._load_audio_path(path)
            except Exception:
                continue
            if sr != sample_rate:
                waveform = self._resample_waveform(waveform, sr, sample_rate)

            source_in = max(0, int(source.get("in_ms", 0) or 0))
            source_out = int(source.get("out_ms", 0) or 0)
            if source_out <= source_in:
                source_out = source_in + (clip_end - clip_start)

            seg = self._trim(waveform, sample_rate, source_in, source_out)["waveform"]
            seg = self._ensure_stereo_batch(seg)
            if seg.shape[1] != mixed.shape[1]:
                seg = seg.repeat(1, mixed.shape[1], 1) if seg.shape[1] == 1 else seg[:, :mixed.shape[1]]

            pos = max(0, int(round(clip_start / 1000 * sample_rate)))
            seg_len = min(seg.shape[-1], n - pos)
            if seg_len <= 0:
                continue
            mixed[..., pos:pos + seg_len] += seg[..., :seg_len]
            used = True

        if not used:
            return self._silent_audio(sample_rate, duration_ms)
        return self._pack(mixed, sample_rate)

    @staticmethod
    def _project(raw: str) -> dict:
        try:
            value = json.loads(raw or "{}")
        except (json.JSONDecodeError, TypeError):
            return {"project_version": PROJECT_VERSION, "schema_version": PROJECT_VERSION, "settings": {}, "tracks": []}
        if not isinstance(value, dict):
            return {"project_version": PROJECT_VERSION, "schema_version": PROJECT_VERSION, "settings": {}, "tracks": []}
        value["project_version"] = PROJECT_VERSION
        value["schema_version"] = PROJECT_VERSION
        value.setdefault("settings", {})
        value.setdefault("tracks", [])
        value.setdefault("resources", [])
        value.setdefault("name", "未命名项目")
        if not isinstance(value["settings"], dict):
            value["settings"] = {}
        if not isinstance(value["tracks"], list):
            value["tracks"] = []
        return value

    @staticmethod
    def _clip_range(clip: dict) -> tuple[int, int]:
        start = max(0, int(clip.get("start_ms", 0) or 0))
        if "duration_ms" in clip:
            end = start + max(0, int(clip.get("duration_ms", 0) or 0))
        else:
            end = max(start, int(clip.get("end_ms", start) or start))
        return start, end

    @staticmethod
    def _source(clip: dict) -> dict:
        source = clip.get("source")
        return source if isinstance(source, dict) else {}

    @staticmethod
    def _track_active(track: dict) -> bool:
        return track.get("enabled", True) is not False and track.get("visible", True) is not False

    def _audio_slices(self, start_ms: int, end_ms: int, audio_clips: list[dict], resolve_media) -> list[dict]:
        result = []
        for audio in audio_clips:
            audio_start, audio_end = self._clip_range(audio)
            overlap_start = max(start_ms, audio_start)
            overlap_end = min(end_ms, audio_end)
            if overlap_end <= overlap_start:
                continue
            source = self._source(audio)
            source_in = max(0, int(source.get("in_ms", 0) or 0))
            row = {
                "source_clip_id": str(audio.get("id", "")),
                "source_kind": str(source.get("kind") or "audio"),
                "file": resolve_media(str(source.get("file") or ""), str(source.get("location") or "assets")),
                "location": str(source.get("location") or "assets"),
                "source_start_ms": source_in + overlap_start - audio_start,
                "source_end_ms": source_in + overlap_end - audio_start,
                "clip_offset_ms": overlap_start - start_ms,
            }
            if row["file"]:
                result.append(row)
        return result

    def _visual_segments(self, visual_clips: list[tuple[dict, dict, int]], ignore_occluded: bool) -> list[tuple[dict, int, int, int]]:
        entries: list[tuple[dict, int, int, int, bool]] = []
        for _track, clip, z_index in visual_clips:
            start, end = self._clip_range(clip)
            if end <= start:
                continue
            entries.append((clip, z_index, start, end, clip.get("force_render", False) is True))

        if not ignore_occluded:
            return [(clip, start, end, z_index) for clip, z_index, start, end, _force in entries]

        segments: list[tuple[dict, int, int, int]] = []
        for clip, z_index, start, end, force in entries:
            if force:
                segments.append((clip, start, end, z_index))
                continue
            higher_cuts = [(s, e) for _c, z, s, e, _f in entries if z > z_index]
            for part_start, part_end in _subtract_intervals(start, end, higher_cuts):
                if part_end > part_start:
                    segments.append((clip, part_start, part_end, z_index))
        segments.sort(key=lambda row: (row[1], row[3]))
        return segments

    def execute(self, fps, width, height, assets_dir, global_prompt, ignore_occluded,
                project_version, project_json, trim_offset=1):
        project = self._project(project_json)
        settings = project["settings"]
        fps = max(1.0, float(fps))
        width = max(1, int(width))
        height = max(1, int(height))
        if not str(global_prompt or "").strip():
            global_prompt = _strip_comment_lines(settings.get("global_prompt") or "")
        else:
            global_prompt = _strip_comment_lines(global_prompt)

        visual_clips: list[tuple[dict, dict, int]] = []
        audio_clips: list[dict] = []
        tracks = sorted(
            (t for t in project["tracks"] if isinstance(t, dict)),
            key=lambda t: int(t.get("order", 0) or 0),
        )
        for z_index, track in enumerate(tracks, start=1):
            if not self._track_active(track):
                continue
            track_type = str(track.get("type") or "visual").lower()
            for clip in track.get("clips", []):
                if (
                    not isinstance(clip, dict)
                    or clip.get("enabled", True) is False
                    or clip.get("visible", True) is False
                ):
                    continue
                clip_type = str(clip.get("type") or ("audio" if track_type == "audio" else "image")).lower()
                if clip_type == "audio" or track_type == "audio":
                    if track.get("muted", False) or clip.get("muted", False):
                        continue
                    audio_clips.append(clip)
                else:
                    visual_clips.append((track, clip, z_index))
                    if clip_type == "video" and clip.get("has_audio", False) and not clip.get("muted", False):
                        embedded = dict(clip)
                        embedded["source"] = dict(self._source(clip), kind="video")
                        audio_clips.append(embedded)

        segments = self._visual_segments(visual_clips, ignore_occluded is not False)

        img_dir = resolve_assets_dir(assets_dir) if assets_dir else ""
        def resolve_media(name: str, location: str = "assets") -> str:
            if not name:
                return ""
            if location == "input" and folder_paths.exists_annotated_filepath(name):
                return folder_paths.get_annotated_filepath(name)
            return os.path.join(img_dir, name) if img_dir and location == "assets" else name

        runtime_clips = []
        for index, (clip, start, end, z_index) in enumerate(segments, start=1):
            source = self._source(clip)
            start_image = str(source.get("file") or clip.get("start_image") or "")
            runtime_clips.append({
                "id": f"runtime_{index:04d}",
                "source_clip_id": str(clip.get("id", "")),
                "clip_type": str(clip.get("type") or "image"),
                "start_ms": start,
                "end_ms": end,
                "start_image": resolve_media(start_image, str(source.get("location") or "assets")),
                "end_image": resolve_media(str(clip.get("end_image") or "")),
                "prompt": _strip_comment_lines(clip.get("prompt") or ""),
                "use_global_prompt": _clip_use_global_prompt(clip),
                "z_index": z_index,
                "audios": self._audio_slices(start, end, audio_clips, resolve_media),
            })

        total_frame_count = max(1, sum(
            int(round((clip["end_ms"] - clip["start_ms"]) * fps / 1000))
            for clip in runtime_clips
        ))
        duration_ms = self._timeline_duration_ms(runtime_clips, audio_clips)
        clips_audio_out = self._mix_timeline_audio(audio_clips, duration_ms, resolve_media)
        frame_seq_dir = self._prepare_frame_seq_dir()
        data_json = json.dumps({
            "project_version": PROJECT_VERSION,
            "schema_version": PROJECT_VERSION,
            "fps": fps,
            "width": width,
            "height": height,
            "global_prompt": global_prompt,
            "total_frame_count": total_frame_count,
            "clips": runtime_clips,
        }, ensure_ascii=False)

        return (
            fps, width, height, global_prompt, data_json, len(runtime_clips),
            total_frame_count, clips_audio_out, frame_seq_dir,
        )


NODE_CLASS_MAPPINGS = {"CAP_TimelineEditor": CAP_TimelineEditor}
NODE_DISPLAY_NAME_MAPPINGS = {"CAP_TimelineEditor": "Timeline Editor"}
