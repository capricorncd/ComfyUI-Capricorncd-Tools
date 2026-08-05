"""Fullscreen timeline editor backed by a track-nested project document."""

from __future__ import annotations

import json
import logging
import os
import re

import torch

from .cap_audio_timeline import CAP_AudioTimeline, _clip_use_global_prompt, _strip_comment_lines
from .timecode import resolve_media_path


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
                "global_prompt": ("STRING", {"default": "", "multiline": True}),
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
    def IS_CHANGED(cls, fps, width, height, global_prompt,
                   project_version, project_json, trim_offset, **_):
        return fps, width, height, global_prompt, project_version, project_json, trim_offset

    @classmethod
    def VALIDATE_INPUTS(cls, **_):
        return True

    def _silent_audio(self, sample_rate: int = 44100, duration_ms: int = 1000):
        n = max(1, int(round(duration_ms / 1000 * sample_rate)))
        return {"waveform": torch.zeros(1, 2, n), "sample_rate": sample_rate}

    def _load_audio_path(self, path: str):
        path = os.path.normpath(str(path or ""))
        from comfy_extras.nodes_audio import load
        try:
            return load(path)
        except Exception:
            import torchaudio
            waveform, sample_rate = torchaudio.load(path)
            return waveform, int(sample_rate)

    def _resolve_audio_file(self, file_ref, location: str = "input") -> str:
        """Resolve an audio path under ComfyUI input (uploaded timeline media)."""
        raw = str(file_ref or "").strip()
        if not raw:
            return ""
        path = os.path.normpath(raw)
        if os.path.isfile(path):
            return path
        resolved = resolve_media_path(raw, assets_dir="", location="input")
        if resolved and os.path.isfile(resolved):
            return os.path.normpath(resolved)
        base = os.path.basename(raw.replace("\\", "/"))
        if base and base != raw:
            again = resolve_media_path(base, assets_dir="", location="input")
            if again and os.path.isfile(again):
                return os.path.normpath(again)
        return os.path.normpath(resolved or path)

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
        if waveform.dim() == 1:
            waveform = waveform.unsqueeze(0).unsqueeze(0)
        elif waveform.dim() == 2:
            waveform = waveform.unsqueeze(0)
        if waveform.shape[1] == 1:
            return waveform.repeat(1, 2, 1)
        if waveform.shape[1] > 2:
            return waveform[:, :2]
        return waveform

    def _mix_audio_rows(
        self,
        rows: list[dict],
        duration_ms: int,
        sample_rate: int = 44100,
        timeline_start_ms: int = 0,
    ):
        n = max(1, int(round(duration_ms / 1000 * sample_rate)))
        mixed = torch.zeros(1, 2, n)
        used = False

        for row in rows:
            if not isinstance(row, dict):
                continue
            path = self._resolve_audio_file(
                row.get("file"),
                str(row.get("location") or "input"),
            )
            if not path:
                continue
            try:
                waveform, sr = self._load_audio_path(path)
            except Exception as exc:
                logging.warning("[CAP_TimelineEditor] failed to load %s: %s", path, exc)
                continue
            if sr <= 0:
                continue
            file_rate = sr
            if sr != sample_rate:
                before = waveform.shape[-1]
                waveform = self._resample_waveform(waveform, sr, sample_rate)
                if waveform.shape[-1] != before:
                    file_rate = sample_rate
            if waveform.shape[-1] == 0:
                continue

            src_start = max(0, int(row.get("source_start_ms", 0) or 0))
            src_end_raw = row.get("source_end_ms", None)
            try:
                src_end = int(src_end_raw) if src_end_raw is not None else src_start + 1
            except (TypeError, ValueError):
                src_end = src_start + 1
            src_end = max(src_start + 1, src_end)
            file_dur_ms = max(1, int(round(waveform.shape[-1] / file_rate * 1000)))
            if src_start >= file_dur_ms:
                logging.warning(
                    "[CAP_TimelineEditor] audio slice past EOF (%s): start=%sms file=%sms",
                    path, src_start, file_dur_ms,
                )
                continue
            src_end = min(src_end, file_dur_ms)

            offset_ms = max(0, int(row.get("clip_offset_ms", 0) or 0))
            if offset_ms >= duration_ms:
                offset_ms = 0
            timeline_ms = timeline_start_ms + offset_ms

            seg = self._trim(waveform, file_rate, src_start, src_end)["waveform"]
            # Place into the output clock (sample_rate). If native-rate trim was
            # used after a failed resample, resample the segment to match.
            if file_rate != sample_rate:
                seg_wave = seg if seg.dim() == 2 else seg.squeeze(0)
                seg_wave = self._resample_waveform(seg_wave, file_rate, sample_rate)
                seg = self._pack(seg_wave, sample_rate)["waveform"]
            seg = self._ensure_stereo_batch(seg)
            if seg.shape[1] != mixed.shape[1]:
                seg = seg.repeat(1, mixed.shape[1], 1) if seg.shape[1] == 1 else seg[:, :mixed.shape[1]]

            pos = max(0, int(round(timeline_ms / 1000 * sample_rate)))
            seg_len = min(seg.shape[-1], n - pos)
            if seg_len <= 0:
                continue
            mixed[..., pos:pos + seg_len] += seg[..., :seg_len]
            used = True

        if not used:
            return None
        return self._pack(mixed, sample_rate)

    def _concat_runtime_clips_audio(
        self,
        runtime_clips: list[dict],
        sample_rate: int = 44100,
    ):
        """Merge per-visual-segment audio in runtime order (gaps without visuals dropped).

        Matches frame-sequence length: each runtime clip contributes
        (end_ms - start_ms) of audio, using that clip's audios[] slices.
        """
        if not runtime_clips:
            return self._silent_audio(sample_rate, 1000)

        pieces = []
        for clip in runtime_clips:
            start = int(clip.get("start_ms", 0) or 0)
            end = int(clip.get("end_ms", start) or start)
            dur_ms = max(1, end - start)
            rows = []
            for row in clip.get("audios") or []:
                if not isinstance(row, dict):
                    continue
                r = dict(row)
                off = max(0, int(r.get("clip_offset_ms", 0) or 0))
                # audios[].clip_offset_ms is segment-relative. If a row still
                # carries an absolute timeline offset (e.g. 21000 while the
                # segment is 21000..55000), convert it so mix lands at 0.
                if start > 0 and off >= start and off < end:
                    off = off - start
                if off >= dur_ms:
                    off = 0
                r["clip_offset_ms"] = off
                rows.append(r)
            mixed = self._mix_audio_rows(
                rows,
                dur_ms,
                sample_rate,
                timeline_start_ms=0,
            )
            if mixed is None:
                if rows:
                    logging.warning(
                        "[CAP_TimelineEditor] clips_audio silent for %s..%sms (%s audio row(s))",
                        start, end, len(rows),
                    )
                n = max(1, int(round(dur_ms / 1000 * sample_rate)))
                pieces.append(torch.zeros(1, 2, n))
            else:
                pieces.append(self._ensure_stereo_batch(mixed["waveform"]))

        waveform = torch.cat(pieces, dim=-1)
        return self._pack(waveform, sample_rate)

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
        duration = clip.get("duration_ms", None)
        if duration is not None and duration != "":
            try:
                dur = int(duration)
            except (TypeError, ValueError):
                dur = 0
            if dur > 0:
                return start, start + dur
        end = max(start, int(clip.get("end_ms", start) or start))
        return start, end

    @staticmethod
    def _source(clip: dict) -> dict:
        source = clip.get("source")
        return source if isinstance(source, dict) else {}

    @staticmethod
    def _track_active(track: dict) -> bool:
        return track.get("enabled", True) is not False and track.get("visible", True) is not False

    @staticmethod
    def _audio_track_active(track: dict) -> bool:
        # Match timeline playback: audio export ignores track visibility/eye toggle.
        return track.get("enabled", True) is not False

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
            file_name = str(
                source.get("file")
                or audio.get("audio_file")
                or audio.get("start_image")
                or ""
            )
            row = {
                "source_clip_id": str(audio.get("id", "")),
                "source_kind": str(source.get("kind") or "audio"),
                "file": resolve_media(file_name, str(source.get("location") or "input")),
                "location": "input",
                "source_start_ms": source_in + overlap_start - audio_start,
                "source_end_ms": source_in + overlap_end - audio_start,
                "clip_offset_ms": overlap_start - start_ms,
            }
            if row["file"]:
                result.append(row)
        return result

    def _visual_segments(self, visual_clips: list[tuple[dict, dict, int]]) -> list[tuple[dict, int, int, int]]:
        segments: list[tuple[dict, int, int, int]] = []
        for _track, clip, z_index in visual_clips:
            start, end = self._clip_range(clip)
            if end <= start:
                continue
            segments.append((clip, start, end, z_index))
        segments.sort(key=lambda row: (row[1], row[3]))
        return segments

    def execute(self, fps, width, height, global_prompt,
                project_version, project_json, trim_offset=1, **_):
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
            track_type = str(track.get("type") or "visual").lower()
            is_audio_track = track_type == "audio"
            if is_audio_track:
                if not self._audio_track_active(track):
                    continue
            elif not self._track_active(track):
                continue
            for clip in track.get("clips", []):
                if not isinstance(clip, dict) or clip.get("enabled", True) is False:
                    continue
                clip_type = str(clip.get("type") or ("audio" if is_audio_track else "image")).lower()
                is_audio_clip = clip_type == "audio" or is_audio_track
                # Audio follows mute only (same as editor playback). Visuals also
                # respect clip/track visibility.
                if is_audio_clip:
                    if track.get("muted", False) or clip.get("muted", False):
                        continue
                    audio_clips.append(clip)
                else:
                    if clip.get("visible", True) is False:
                        continue
                    visual_clips.append((track, clip, z_index))
                    if clip_type == "video" and clip.get("has_audio", False) and not clip.get("muted", False):
                        embedded = dict(clip)
                        embedded["source"] = dict(self._source(clip), kind="video")
                        audio_clips.append(embedded)

        segments = self._visual_segments(visual_clips)

        def resolve_media(name: str, location: str = "input") -> str:
            return resolve_media_path(name, assets_dir="", location="input")

        runtime_clips = []
        for index, (clip, start, end, z_index) in enumerate(segments, start=1):
            source = self._source(clip)
            start_image = str(source.get("file") or clip.get("start_image") or "")
            end_image = str(clip.get("end_image") or "")
            try:
                head_sec = max(0, int(clip.get("head_extend_sec", 0) or 0))
            except (TypeError, ValueError):
                head_sec = 0
            try:
                tail_sec = max(0, int(clip.get("tail_extend_sec", 0) or 0))
            except (TypeError, ValueError):
                tail_sec = 0
            head_ms = int(round(head_sec * 1000))
            tail_ms = int(round(tail_sec * 1000))
            # Extended range may start before 0 (negative start_ms). Audio mix
            # pads leading silence for that overhang; timeline geometry is unchanged.
            ext_start = int(start) - head_ms
            ext_end = int(end) + tail_ms
            if ext_end <= ext_start:
                ext_end = ext_start + 1
            runtime_clips.append({
                "id": f"runtime_{index:04d}",
                "source_clip_id": str(clip.get("id", "")),
                "clip_type": str(clip.get("type") or "image"),
                "start_ms": ext_start,
                "end_ms": ext_end,
                "preview_start_ms": int(start),
                "preview_end_ms": int(end),
                "head_extend_sec": head_sec,
                "tail_extend_sec": tail_sec,
                "generate_preview_video": bool(clip.get("generate_preview_video", False)),
                "start_image": resolve_media(start_image),
                "end_image": resolve_media(end_image) if end_image else "",
                "prompt": _strip_comment_lines(clip.get("prompt") or ""),
                "use_global_prompt": _clip_use_global_prompt(clip),
                "z_index": z_index,
                "audios": self._audio_slices(ext_start, ext_end, audio_clips, resolve_media),
            })

        total_frame_count = max(1, sum(
            int(round((clip["end_ms"] - clip["start_ms"]) * fps / 1000))
            for clip in runtime_clips
        ))
        # Concatenate audio for each visual runtime segment (no gap filler),
        # matching the frame sequence / total_frame_count timeline.
        clips_audio_out = self._concat_runtime_clips_audio(runtime_clips)
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
