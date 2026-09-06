"""Fullscreen timeline editor backed by a track-nested project document."""

from __future__ import annotations

import datetime
import json
import logging
import os
import re

import torch

from .cap_audio_timeline import (
    CAP_AudioTimeline,
    _clip_prompt_includes,
    _normalize_prompt_concat_order,
    _strip_comment_lines,
)
from .cap_clip_prompt_vl import clear_clip_prompt_vl
from .cap_timeline_project_io import SCHEMA_VERSION, _media_id_for, migrate_project, resolve_clip_media
from .timecode import resolve_media_path


def _setting_prompt(settings: dict, key: str) -> str:
    return _strip_comment_lines(settings.get(key) or "").strip()


def _safe_filename_part(value, fallback: str = "Untitled") -> str:
    text = str(value or "").strip()
    out = []
    for ch in text:
        if ch in '<>:"/\\|?*' or ord(ch) < 32:
            out.append("_")
        else:
            out.append(ch)
    text = "".join(out).rstrip(". ").strip() or fallback
    return text[:80] or fallback


def _h3_motion_context_length(clip: dict) -> int:
    try:
        return max(0, int(round(float((clip or {}).get("h3_motion_context_length", 0) or 0))))
    except (TypeError, ValueError):
        return 0


def _is_subtitle_track(track_type) -> bool:
    t = str(track_type or "").lower()
    return t in ("text", "subtitle")


def _is_subtitle_clip(clip: dict, track_type: str = "") -> bool:
    """Subtitle clips are editor preview-only and must not enter data_json."""
    if _is_subtitle_track(track_type):
        return True
    if not isinstance(clip, dict):
        return False
    ct = str(clip.get("type") or "").lower()
    return ct in ("text", "subtitle")


def _media_enabled(flags, index: int) -> bool:
    if not isinstance(flags, list) or index >= len(flags):
        return True
    return flags[index] is not False


def _clip_visual_entries(project: dict, clip: dict) -> list[dict]:
    rows = resolve_clip_media(project, clip)
    visual = [
        row for row in (rows or [])
        if isinstance(row, dict) and str(row.get("kind") or "image").lower() != "audio"
    ]
    enabled_flags = clip.get("media_enabled") if isinstance(clip, dict) else None
    out = []
    for index, row in enumerate(visual):
        out.append({
            "row": row,
            "id": str(row.get("id") or ""),
            "enabled": _media_enabled(enabled_flags, index),
        })
    return out


def _clip_image_refs(entries: list) -> list[dict]:
    out = []
    for entry in entries or []:
        mid = str(entry.get("id") or "").strip()
        if not entry.get("enabled") or not mid:
            continue
        out.append({"id": mid})
    return out


_CLIP_ROLES = ("multi_ref", "first_last", "t2v", "video_ref", "video_edit", "other")
_CLIP_AGENTS = ("MiniMaxH3", "LTX", "Bernini", "Wan", "other")


def _clip_role_fields(clip: dict) -> tuple[str, str]:
    role = str(clip.get("clip_role") or "multi_ref").strip()
    if role not in _CLIP_ROLES:
        role = "multi_ref"
    custom = str(clip.get("clip_role_custom") or "").strip() if role == "other" else ""
    return role, custom


def _clip_agent_fields(clip: dict) -> tuple[str, str]:
    agent = str(clip.get("agent") or "MiniMaxH3").strip()
    if agent not in _CLIP_AGENTS:
        agent = "MiniMaxH3"
    custom = str(clip.get("agent_custom") or "").strip() if agent == "other" else ""
    return agent, custom


def _material_row(row: dict, resolve_media) -> dict | None:
    if not isinstance(row, dict):
        return None
    file = str(row.get("file") or "").strip()
    if not file:
        return None
    kind = str(row.get("kind") or "image").lower()
    if kind not in ("image", "video", "audio"):
        kind = "image"
    mid = str(row.get("id") or "").strip() or _media_id_for(kind, file)
    tags = row.get("tags") if isinstance(row.get("tags"), list) else []
    out = {
        "id": mid,
        "kind": kind,
        "file": resolve_media(file),
        "name": str(row.get("name") or file.replace("\\", "/").rsplit("/", 1)[-1]),
        "prompt": _strip_comment_lines(row.get("prompt") or ""),
        "generation_prompt": str(row.get("generation_prompt") or ""),
        "setting_description": str(row.get("setting_description") or ""),
        "media_type": str(row.get("media_type") or "").strip(),
        "tags": [str(tag).strip() for tag in tags if str(tag).strip()],
        "location": str(row.get("location") or "input"),
    }
    try:
        stars = int(row.get("stars"))
    except (TypeError, ValueError):
        stars = 0
    if 1 <= stars <= 5:
        out["stars"] = stars
    return out


def _add_material(materials: list, seen: set, row: dict, resolve_media) -> str:
    material = _material_row(row, resolve_media)
    if not material:
        return ""
    if material["id"] not in seen:
        seen.add(material["id"])
        materials.append(material)
    return material["id"]


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
                "fps": (
                    "FLOAT",
                    {"default": 24.0, "min": 1.0, "max": 240.0, "step": 0.1},
                ),
                "width": ("INT", {"default": 1344, "min": 64, "max": 8192, "step": 1}),
                "height": ("INT", {"default": 768, "min": 64, "max": 8192, "step": 1}),
                "swap_wh": (
                    "BOOLEAN",
                    {
                        "default": False,
                        "tooltip": "Swap the current width/height when toggled (e.g. 1280x720 -> 720x1280)",
                    },
                ),
                "project_version": ("STRING", {"default": PROJECT_VERSION}),
                "project_json": (
                    "STRING",
                    {
                        "default": json.dumps(
                            {
                                "project_version": PROJECT_VERSION,
                                "schema_version": SCHEMA_VERSION,
                                "name": "Untitled Project",
                                "media": [],
                                "settings": {},
                                "tracks": [],
                            },
                            ensure_ascii=False,
                        ),
                        "multiline": True,
                        "tooltip": "Track-nested editable timeline project.",
                    },
                ),
                "trim_offset": ("INT", {"default": 1, "min": 0, "max": 60, "step": 1}),
                "schema_version": ("INT", {"default": SCHEMA_VERSION}),
            },
        }

    @classmethod
    def IS_CHANGED(cls, fps, width, height,
                   project_version, project_json, trim_offset, swap_wh=False,
                   schema_version=SCHEMA_VERSION, **_):
        return fps, width, height, project_version, project_json, trim_offset, bool(swap_wh), schema_version

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

    @staticmethod
    def _audio_slice_file(row: dict, materials: dict | None = None) -> str:
        materials = materials if isinstance(materials, dict) else {}
        mid = str(row.get("id") or "").strip()
        if mid and mid in materials:
            path = str(materials[mid].get("file") or "").strip()
            if path:
                return path
        path = str(row.get("file") or "").strip()
        if path and path in materials:
            return str(materials[path].get("file") or path)
        return path

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


    def _apply_fade_envelope(
        self,
        seg,
        sample_rate: int,
        fade_in_ms: int,
        fade_out_ms: int,
        host_duration_ms: int,
        host_local_start_ms: int,
    ):
        """Apply linear fade-in/out relative to the host audio clip timeline."""
        if seg is None or seg.shape[-1] <= 0:
            return seg
        fade_in_ms = max(0, int(fade_in_ms or 0))
        fade_out_ms = max(0, int(fade_out_ms or 0))
        host_duration_ms = max(1, int(host_duration_ms or 1))
        if fade_in_ms <= 0 and fade_out_ms <= 0:
            return seg
        n = int(seg.shape[-1])
        t = torch.arange(n, dtype=torch.float32) * (1000.0 / float(sample_rate)) + float(host_local_start_ms)
        gain = torch.ones(n, dtype=torch.float32)
        if fade_in_ms > 0:
            gain = torch.minimum(gain, (t / float(fade_in_ms)).clamp(0.0, 1.0))
        if fade_out_ms > 0:
            gain = torch.minimum(
                gain,
                ((float(host_duration_ms) - t) / float(fade_out_ms)).clamp(0.0, 1.0),
            )
        return seg * gain.view(1, 1, -1)

    def _mix_audio_rows(
        self,
        rows: list[dict],
        duration_ms: int,
        sample_rate: int = 44100,
        timeline_start_ms: int = 0,
        materials: dict | None = None,
    ):
        n = max(1, int(round(duration_ms / 1000 * sample_rate)))
        mixed = torch.zeros(1, 2, n)
        used = False

        for row in rows:
            if not isinstance(row, dict):
                continue
            mid = str(row.get("id") or "").strip()
            mat = (materials or {}).get(mid) if mid else {}
            if not isinstance(mat, dict):
                mat = {}
            path = self._resolve_audio_file(
                self._audio_slice_file(row, materials),
                str(mat.get("location") or row.get("location") or "input"),
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

            seg = self._apply_fade_envelope(
                seg,
                sample_rate,
                int(row.get("fade_in_ms", 0) or 0),
                int(row.get("fade_out_ms", 0) or 0),
                int(row.get("host_duration_ms", 0) or 0),
                int(row.get("host_local_start_ms", 0) or 0),
            )
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
        materials: list | None = None,
    ):
        """Merge per-visual-segment audio in runtime order (gaps without visuals dropped).

        Matches frame-sequence length: each runtime clip contributes
        (end_ms - start_ms) of audio, using that clip's audios[] slices.
        """
        if not runtime_clips:
            return self._silent_audio(sample_rate, 1000)

        mat_map = {
            str(row["id"]): row
            for row in (materials or [])
            if isinstance(row, dict) and row.get("id")
        }
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
                materials=mat_map,
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
            value = {}
        if not isinstance(value, dict):
            value = {}
        value.setdefault("settings", {})
        value.setdefault("tracks", [])
        value.setdefault("name", "Untitled Project")
        if not isinstance(value["settings"], dict):
            value["settings"] = {}
        if not isinstance(value["tracks"], list):
            value["tracks"] = []
        value = migrate_project(value)
        value["project_version"] = PROJECT_VERSION
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
    def _clip_media_rows(project: dict, clip: dict) -> list[dict]:
        return resolve_clip_media(project, clip)

    @classmethod
    def _clip_media_file(cls, project: dict, clip: dict) -> str:
        rows = cls._clip_media_rows(project, clip)
        if rows:
            return str(rows[0].get("file") or "")
        source = cls._source(clip)
        return str(source.get("file") or clip.get("audio_file") or clip.get("start_image") or "")

    @staticmethod
    def _track_active(track: dict) -> bool:
        return track.get("enabled", True) is not False and track.get("visible", True) is not False

    @staticmethod
    def _audio_track_active(track: dict) -> bool:
        # Match timeline playback: audio export ignores track visibility/eye toggle.
        return track.get("enabled", True) is not False

    def _audio_slices(self, start_ms: int, end_ms: int, audio_clips: list[dict], resolve_media, project: dict, materials: list, seen: set) -> list[dict]:
        result = []
        for audio in audio_clips:
            audio_start, audio_end = self._clip_range(audio)
            overlap_start = max(start_ms, audio_start)
            overlap_end = min(end_ms, audio_end)
            if overlap_end <= overlap_start:
                continue
            source = self._source(audio)
            source_in = max(0, int(source.get("in_ms", 0) or 0))
            media_rows = resolve_clip_media(project, audio)
            media = media_rows[0] if media_rows else None
            if not isinstance(media, dict):
                file_name = self._clip_media_file(project, audio)
                if not file_name:
                    continue
                media = {
                    "kind": str(source.get("kind") or "audio"),
                    "file": file_name,
                    "location": str(source.get("location") or "input"),
                }
            mid = _add_material(materials, seen, media, resolve_media)
            if not mid:
                continue
            host_duration_ms = max(1, audio_end - audio_start)
            fade_in_ms = max(0, int(audio.get("fade_in_ms", 0) or 0))
            fade_out_ms = max(0, int(audio.get("fade_out_ms", 0) or 0))
            if fade_in_ms + fade_out_ms > host_duration_ms:
                scale = host_duration_ms / float(fade_in_ms + fade_out_ms)
                fade_in_ms = int(fade_in_ms * scale)
                fade_out_ms = max(0, host_duration_ms - fade_in_ms)
            result.append({
                "source_clip_id": str(audio.get("id", "")),
                "source_kind": str(source.get("kind") or "audio"),
                "id": mid,
                "source_start_ms": source_in + overlap_start - audio_start,
                "source_end_ms": source_in + overlap_end - audio_start,
                "clip_offset_ms": overlap_start - start_ms,
                "fade_in_ms": fade_in_ms,
                "fade_out_ms": fade_out_ms,
                "host_duration_ms": host_duration_ms,
                "host_local_start_ms": overlap_start - audio_start,
            })
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

    def execute(self, fps, width, height,
                project_version, project_json, trim_offset=1, **_):
        clear_clip_prompt_vl()
        project = self._project(project_json)
        settings = project["settings"]
        fps = max(1.0, float(fps))
        width = max(1, int(width))
        height = max(1, int(height))
        global_prompt = _setting_prompt(settings, "global_prompt")
        style_prompt = _setting_prompt(settings, "style_prompt")
        non_diegetic_music = _setting_prompt(settings, "non_diegetic_music")
        negative_prompt = _setting_prompt(settings, "negative_prompt")
        prompt_concat_order = _normalize_prompt_concat_order(settings.get("prompt_concat_order"))
        use_clip_video_name = settings.get("use_clip_specified_video_filename", True) is not False
        gen_video_stamp = str(settings.get("gen_video_stamp") or "").strip()
        if not gen_video_stamp:
            gen_video_stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        project_name_safe = _safe_filename_part(project.get("name"), "Untitled")
        only_raw = settings.get("runtime_only_clip_ids")
        only_ids = None
        if isinstance(only_raw, list) and only_raw:
            only_ids = {str(x).strip() for x in only_raw if str(x).strip()}
            if not only_ids:
                only_ids = None

        visual_clips: list[tuple[dict, dict, int]] = []
        audio_clips: list[dict] = []
        tracks = sorted(
            (t for t in project["tracks"] if isinstance(t, dict)),
            key=lambda t: int(t.get("order", 0) or 0),
        )
        for z_index, track in enumerate(tracks, start=1):
            track_type = str(track.get("type") or "visual").lower()
            is_audio_track = track_type == "audio"
            # Subtitle / text tracks are editor preview overlays only.
            if _is_subtitle_track(track_type):
                continue
            if track_type == "media":
                continue
            if is_audio_track:
                if not self._audio_track_active(track):
                    continue
            elif not self._track_active(track):
                continue
            for clip in track.get("clips", []):
                if not isinstance(clip, dict) or clip.get("enabled", True) is False:
                    continue
                if _is_subtitle_clip(clip, track_type):
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
                    if only_ids is not None and str(clip.get("id") or "") not in only_ids:
                        continue
                    visual_clips.append((track, clip, z_index))
                    media_rows = resolve_clip_media(project, clip)
                    has_video_item = any(str(row.get("kind") or "").lower() == "video" for row in media_rows)
                    source_kind = str(self._source(clip).get("kind") or clip_type).lower()
                    is_video = clip_type == "video" or source_kind == "video" or has_video_item
                    if is_video and clip.get("has_audio", False) and not clip.get("muted", False):
                        embedded = dict(clip)
                        embedded["source"] = dict(self._source(clip), kind="video")
                        audio_clips.append(embedded)

        segments = self._visual_segments(visual_clips)

        def resolve_media(name: str, location: str = "input") -> str:
            return resolve_media_path(name, assets_dir="", location="input")

        runtime_clips = []
        materials = []
        seen_materials = set()
        for clip, start, end, z_index in segments:
            if _is_subtitle_clip(clip):
                continue
            entries = _clip_visual_entries(project, clip)
            has_media = any(e.get("enabled") and e.get("id") for e in entries)
            has_prompt = bool(
                _strip_comment_lines(clip.get("detailed_description") or clip.get("ai_prompt") or "").strip()
                or _strip_comment_lines(clip.get("prompt") or "").strip()
            )
            # Empty package clips are timeline placeholders (preview only).
            if not has_media and not has_prompt:
                continue
            for entry in entries:
                if not entry.get("enabled"):
                    continue
                _add_material(materials, seen_materials, entry.get("row") or {}, resolve_media)
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
            clip_role, clip_role_custom = _clip_role_fields(clip)
            agent, agent_custom = _clip_agent_fields(clip)
            source_clip_id = str(clip.get("id", ""))
            prompt_includes = _clip_prompt_includes(clip)
            runtime_row = {
                "id": f"runtime_{len(runtime_clips) + 1:04d}",
                "source_clip_id": source_clip_id,
                "clip_type": str(clip.get("type") or "image"),
                "clip_role": clip_role,
                "clip_role_custom": clip_role_custom,
                "agent": agent,
                "agent_custom": agent_custom,
                "start_ms": ext_start,
                "end_ms": ext_end,
                "preview_start_ms": int(start),
                "preview_end_ms": int(end),
                "head_extend_sec": head_sec,
                "tail_extend_sec": tail_sec,
                "generate_preview_video": bool(clip.get("generate_preview_video", False)),
                "second_sample": bool(clip.get("second_sample", False)),
                "h3_motion_context_length": _h3_motion_context_length(clip),
                "save_latent": bool(clip.get("save_latent", False)),
                "images": _clip_image_refs(entries),
                "prompt": _strip_comment_lines(clip.get("prompt") or "").strip(),
                "detailed_description": _strip_comment_lines(
                    clip.get("detailed_description") or clip.get("ai_prompt") or ""
                ).strip(),
                "prompt_includes": prompt_includes,
                "z_index": z_index,
                "audios": self._audio_slices(
                    ext_start, ext_end, audio_clips, resolve_media, project, materials, seen_materials,
                ),
            }
            if use_clip_video_name:
                clip_id_safe = _safe_filename_part(source_clip_id, "clip")
                runtime_row["output_video"] = (
                    f"CapTimelineEditor/{project_name_safe}/{gen_video_stamp}_{clip_id_safe}.mp4"
                )
            runtime_clips.append(runtime_row)

        total_frame_count = max(1, sum(
            int(round((clip["end_ms"] - clip["start_ms"]) * fps / 1000))
            for clip in runtime_clips
        ))
        # Concatenate audio for each visual runtime segment (no gap filler),
        # matching the frame sequence / total_frame_count timeline.
        clips_audio_out = self._concat_runtime_clips_audio(runtime_clips, materials=materials)
        frame_seq_dir = self._prepare_frame_seq_dir()
        # Filesystem-safe stamp shared by this execute; downstream nodes can
        # use it as a unified filename / folder prefix.
        run_timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        data_json = json.dumps({
            "project_version": PROJECT_VERSION,
            "schema_version": SCHEMA_VERSION,
            "fps": fps,
            "width": width,
            "height": height,
            "global_prompt": global_prompt,
            "style_prompt": style_prompt,
            "non_diegetic_music": non_diegetic_music,
            "negative_prompt": negative_prompt,
            "prompt_concat_order": prompt_concat_order,
            "total_frame_count": total_frame_count,
            "run_timestamp": run_timestamp,
            "materials": materials,
            "clips": runtime_clips,
        }, ensure_ascii=False)

        return (
            fps, width, height, global_prompt, data_json, len(runtime_clips),
            total_frame_count, clips_audio_out, frame_seq_dir,
        )


NODE_CLASS_MAPPINGS = {"CAP_TimelineEditor": CAP_TimelineEditor}
NODE_DISPLAY_NAME_MAPPINGS = {"CAP_TimelineEditor": "Timeline Editor"}
