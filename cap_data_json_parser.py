from __future__ import annotations
import copy
import json
import os

import numpy as np
import torch
from PIL import Image

from .cap_te_notify import EVENT_CLIP_RUNNING, notify_timeline
from .timecode import AUDIO_EXTENSIONS, VIDEO_EXTENSIONS, resolve_media_path


class CAP_DataJsonClipParser:
    """Parse data_json from CAP_AudioTimeline or CAP_TimelineEditor and extract a clip by index."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "data_json": ("STRING", {"default": "", "multiline": True}),
                "index": ("INT", {"default": 0, "min": 0, "max": 9999, "step": 1}),
                "trim_offset": ("INT", {"default": 1, "min": 0, "max": 60, "step": 1,
                                        "tooltip": "Audio trim offset (seconds); end time = clip_end_ms + trim_offset x 1000"}),
                "seq_name_mode": (
                    ["from_start", "index"],
                    {
                        "default": "from_start",
                        "tooltip": "Frame-sequence video filename suffix: from_start = FROM_... label, index = 4-digit index",
                    },
                ),
            },
        }

    RETURN_TYPES = ("AUDIO", "INT", "IMAGE", "IMAGE", "STRING", "STRING", "BOOLEAN", "STRING", "STRING", "STRING", "IMAGE", "STRING", "STRING", "STRING", "STRING", "BOOLEAN", "STRING")
    RETURN_NAMES = (
        "audio",
        "frame_count",
        "first_frame",
        "last_frame",
        "prompt",
        "run_timestamp",
        "generate_preview_video",
        "from_start",
        "from_preview_start",
        "seq_filename_prefix",
        "images",
        "clip_role",
        "agent",
        "ai_prompt",
        "clip_json",
        "second_sample",
        "output_video",
    )
    FUNCTION = "execute"
    CATEGORY = "Capricorncd"
    DESCRIPTION = (
        "Parse data_json from Audio Timeline or Timeline Editor and extract a clip by index. "
        "Outputs the clip audio segment, frame count, first/last keyframe images, prompt, "
        "run_timestamp, generate_preview_video, FROM_ tags, seq_filename_prefix "
        "(run_timestamp/from_start or run_timestamp/index) for Seq To Video, "
        "images (all clip images in editor order as one IMAGE batch), "
        "clip_role, agent, ai_prompt, clip_json (self-contained clip with resolved "
        "image/video file paths and embedded materials), second_sample, and output_video "
        "(CapTimelineEditor-specified save path when enabled)."
    )

    @classmethod
    def IS_CHANGED(cls, data_json, index, trim_offset, seq_name_mode="from_start"):
        return (data_json, index, trim_offset, seq_name_mode)

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
        try:
            img = Image.open(path).convert("RGB")
        except Exception:
            return None
        arr = np.array(img).astype(np.float32) / 255.0
        return torch.from_numpy(arr).unsqueeze(0)

    def _match_image_size(self, image: torch.Tensor, height: int, width: int) -> torch.Tensor:
        if image.shape[1] == height and image.shape[2] == width:
            return image
        nchw = image.permute(0, 3, 1, 2)
        nchw = torch.nn.functional.interpolate(
            nchw, size=(height, width), mode="bilinear", align_corners=False,
        )
        return nchw.permute(0, 2, 3, 1)

    def _load_images_batch(self, refs, materials: dict, blank: torch.Tensor) -> torch.Tensor:
        frames = []
        for ref in refs:
            img = self._load_image(self._ref_file(ref, materials))
            if img is not None:
                frames.append(img)
        if not frames:
            return blank
        height, width = int(frames[0].shape[1]), int(frames[0].shape[2])
        aligned = [self._match_image_size(frame, height, width) for frame in frames]
        return torch.cat(aligned, dim=0)

    def _clip_prompt_includes(self, clip: dict) -> list[str]:
        from .cap_audio_timeline import _clip_prompt_includes
        return _clip_prompt_includes(clip)

    def _clip_use_global_prompt(self, clip: dict) -> bool:
        return "global" in self._clip_prompt_includes(clip)

    def _clip_use_ai_prompt(self, clip: dict) -> bool:
        return "ai" in self._clip_prompt_includes(clip)

    def _strip_comment_lines(self, text: str) -> str:
        return "\n".join(
            line for line in str(text or "").split("\n")
            if not line.startswith("#")
        )

    def _normalize_prompt_concat_order(self, raw) -> list[str]:
        from .cap_audio_timeline import _normalize_prompt_concat_order
        return _normalize_prompt_concat_order(raw)

    def _compose_prompt(self, clip: dict, global_prompt: str, materials: dict | None = None,
                        *, style_prompt: str = "", non_diegetic_music: str = "",
                        negative_prompt: str = "", prompt_concat_order=None) -> str:
        includes = set(self._clip_prompt_includes(clip))
        order = self._normalize_prompt_concat_order(prompt_concat_order)
        texts = {
            "global": self._strip_comment_lines(global_prompt).strip(),
            "style": self._strip_comment_lines(style_prompt).strip(),
            "clip": self._strip_comment_lines(clip.get("prompt") or "").strip(),
            "ai": self._strip_comment_lines(clip.get("ai_prompt") or "").strip(),
            "non_diegetic_music": self._strip_comment_lines(non_diegetic_music).strip(),
            "negative": self._strip_comment_lines(negative_prompt).strip(),
        }
        parts = []
        for key in order:
            if key not in includes:
                continue
            text = texts.get(key) or ""
            if text:
                parts.append(text)
        materials = materials if isinstance(materials, dict) else {}
        for ref in self._ref_list(clip.get("images")):
            if not self._ref_use_media_prompt(ref):
                continue
            mid = self._ref_id(ref)
            row = materials.get(mid) if mid else None
            text = ""
            if isinstance(row, dict):
                text = self._strip_comment_lines(row.get("prompt") or "").strip()
            if text:
                parts.append(text)
        return "\n\n".join(part for part in parts if part)

    def _ref_id(self, ref) -> str:
        if isinstance(ref, dict):
            return str(ref.get("id") or "").strip()
        return str(ref or "").strip()

    def _ref_use_media_prompt(self, ref) -> bool:
        if isinstance(ref, dict):
            return ref.get("use_media_prompt") is not False
        return True

    def _frame_count(self, start_ms: int, end_ms: int, fps: float) -> int:
        duration_ms = max(0, int(end_ms) - int(start_ms))
        if duration_ms <= 0:
            return 1
        return max(1, int(round(duration_ms * fps / 1000)))

    def _from_tag(self, start_ms: int, frame_count: int, fps: float) -> str:
        """Filename tag: FROM_MMSS_ff_frames or FROM_HHMMSS_ff_frames (>=1h).

        Negative start_ms (head-extend before 0) uses FROM_N… .
        """
        fps_i = max(1, int(round(float(fps) or 24)))
        ms = int(start_ms)
        neg = ms < 0
        ms = abs(ms)
        total_frames = int(round(ms * fps_i / 1000))
        frames = total_frames % fps_i
        total_seconds = total_frames // fps_i
        hours = total_seconds // 3600
        minutes = (total_seconds % 3600) // 60
        seconds = total_seconds % 60
        frame_digits = max(2, len(str(fps_i - 1)))
        frame_part = f"{frames:0{frame_digits}d}"
        if hours > 0:
            clock = f"{hours:02d}{minutes:02d}{seconds:02d}"
        else:
            clock = f"{minutes:02d}{seconds:02d}"
        head = "FROM_N" if neg else "FROM_"
        return f"{head}{clock}_{frame_part}_{max(1, int(frame_count))}"

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

    def _clip_audio_from_audios(self, clip: dict, trim_offset: int, sample_rate: int = 44100, materials: dict | None = None):
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
        materials = materials if isinstance(materials, dict) else {}

        for row in rows:
            if not isinstance(row, dict):
                continue
            path = os.path.normpath(self._audio_row_path(row, materials))
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

    def _seq_filename_prefix(self, run_timestamp: str, from_start: str, index: int, mode: str) -> str:
        """Build Seq-To-Video filename_prefix: run_timestamp/from_start or run_timestamp/index."""
        mode = str(mode or "from_start").strip().lower()
        if mode == "index":
            leaf = f"{max(0, int(index)):04d}"
        else:
            leaf = str(from_start or "").strip() or f"{max(0, int(index)):04d}"
        prefix = str(run_timestamp or "").strip().replace("\\", "/").strip("/")
        if prefix:
            return f"{prefix}/{leaf}"
        return leaf

    def _materials_by_id(self, data: dict) -> dict:
        out = {}
        rows = data.get("materials") if isinstance(data, dict) else None
        if not isinstance(rows, list):
            return out
        for row in rows:
            if not isinstance(row, dict):
                continue
            mid = str(row.get("id") or "").strip()
            if mid:
                out[mid] = row
        return out

    def _ref_list(self, value) -> list:
        if value is None or value == "":
            return []
        if isinstance(value, list):
            return value
        return [value]

    def _ref_file(self, ref, materials: dict) -> str:
        if isinstance(ref, dict):
            path = str(ref.get("file") or "").strip()
            mid = str(ref.get("id") or "").strip()
            if not path and mid and mid in materials:
                path = str(materials[mid].get("file") or "").strip()
            return path
        s = str(ref or "").strip()
        if not s:
            return ""
        if s in materials:
            return str(materials[s].get("file") or "").strip()
        return s

    def _audio_row_path(self, row: dict, materials: dict) -> str:
        mid = str(row.get("id") or "").strip()
        mat = materials.get(mid) if mid else None
        location = "input"
        if isinstance(mat, dict):
            path = str(mat.get("file") or "").strip()
            location = str(mat.get("location") or row.get("location") or "input")
            if path:
                return self._resolve_file_path(path, location)
        path = str(row.get("file") or "").strip()
        if path in materials:
            mat = materials[path]
            return self._resolve_file_path(
                str(mat.get("file") or path),
                str(mat.get("location") or row.get("location") or "input"),
            )
        return self._resolve_file_path(path, str(row.get("location") or "assets"))

    def _first_loadable_image(self, refs, materials: dict):
        for ref in refs:
            img = self._load_image(self._ref_file(ref, materials))
            if img is not None:
                return img
        return None

    def _infer_kind(self, path: str, row: dict | None = None) -> str:
        kind = str((row or {}).get("kind") or "").lower()
        if kind in ("image", "video", "audio"):
            return kind
        ext = os.path.splitext(path or "")[1].lower()
        if ext in VIDEO_EXTENSIONS:
            return "video"
        if ext in AUDIO_EXTENSIONS:
            return "audio"
        return "image"

    def _resolved_material_path(self, mid: str, materials: dict, fallback: str = "") -> str:
        mat = materials.get(mid) if mid else None
        path = ""
        location = "input"
        if isinstance(mat, dict):
            path = str(mat.get("file") or "").strip()
            location = str(mat.get("location") or "input")
        if not path:
            path = str(fallback or "").strip()
        if not path:
            return ""
        if os.path.isabs(path) and os.path.isfile(path):
            return os.path.normpath(path)
        resolved = self._resolve_file_path(path, location)
        return os.path.normpath(resolved) if resolved else os.path.normpath(path)

    def _visual_ref_entry(self, ref, materials: dict) -> dict | None:
        mid = self._ref_id(ref)
        mat = materials.get(mid) if mid else None
        if not isinstance(mat, dict):
            mat = {}
        path = self._resolved_material_path(mid, materials, self._ref_file(ref, materials))
        if not path and isinstance(ref, dict):
            path = str(ref.get("file") or "").strip()
        if not path:
            return None
        kind = self._infer_kind(path, mat)
        entry = {
            "id": mid,
            "file": path,
            "kind": kind,
            "use_media_prompt": self._ref_use_media_prompt(ref),
        }
        for key in ("name", "prompt", "media_type", "tags", "location", "stars"):
            if key in mat:
                entry[key] = copy.deepcopy(mat[key])
        return entry

    def _build_clip_json(self, clip: dict, materials: dict, *, fps: float = 24.0,
                         global_prompt: str = "", style_prompt: str = "",
                         non_diegetic_music: str = "", negative_prompt: str = "",
                         prompt_concat_order=None) -> str:
        """Self-contained clip JSON: images/videos with absolute paths + embedded materials."""
        out = copy.deepcopy(clip) if isinstance(clip, dict) else {}
        # Carry project-level fields so clip_json alone is enough for MiniMaxH3 etc.
        out["fps"] = float(fps)
        out["global_prompt"] = global_prompt if isinstance(global_prompt, str) else ""
        out["style_prompt"] = style_prompt if isinstance(style_prompt, str) else ""
        out["non_diegetic_music"] = non_diegetic_music if isinstance(non_diegetic_music, str) else ""
        out["negative_prompt"] = negative_prompt if isinstance(negative_prompt, str) else ""
        out["prompt_concat_order"] = self._normalize_prompt_concat_order(prompt_concat_order)
        out["prompt_includes"] = self._clip_prompt_includes(out)
        images = []
        videos = []
        used_ids: list[str] = []
        seen_ids: set[str] = set()

        def _remember(mid: str):
            mid = str(mid or "").strip()
            if mid and mid not in seen_ids and mid in materials:
                seen_ids.add(mid)
                used_ids.append(mid)

        for ref in self._ref_list(out.get("images")):
            entry = self._visual_ref_entry(ref, materials)
            if entry is None:
                continue
            _remember(entry.get("id"))
            if entry.get("kind") == "video":
                videos.append(entry)
            else:
                images.append(entry)

        # Audio Timeline clips use start_image / end_image absolute paths.
        if not images and not videos:
            for key in ("start_image", "end_image"):
                path = str(out.get(key) or "").strip()
                if not path:
                    continue
                path = os.path.normpath(path)
                images.append({
                    "file": path,
                    "kind": self._infer_kind(path),
                    "use_media_prompt": True,
                })

        out["images"] = images
        out["videos"] = videos

        audio_rows = []
        for row in out.get("audios") if isinstance(out.get("audios"), list) else []:
            if not isinstance(row, dict):
                continue
            item = copy.deepcopy(row)
            mid = str(item.get("id") or "").strip()
            path = self._audio_row_path(item, materials)
            if path:
                item["file"] = os.path.normpath(path)
            _remember(mid)
            audio_rows.append(item)
        if "audios" in out or audio_rows:
            out["audios"] = audio_rows

        materials_out = []
        for mid in used_ids:
            mat = materials.get(mid)
            if not isinstance(mat, dict):
                continue
            row = copy.deepcopy(mat)
            path = self._resolved_material_path(mid, materials, str(row.get("file") or ""))
            if path:
                row["file"] = path
            materials_out.append(row)
        out["materials"] = materials_out
        return json.dumps(out, ensure_ascii=False)

    def execute(self, data_json: str, index: int, trim_offset: int = 1, seq_name_mode: str = "from_start"):
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
        style_prompt = data.get("style_prompt", "")
        non_diegetic_music = data.get("non_diegetic_music", "")
        negative_prompt = data.get("negative_prompt", "")
        prompt_concat_order = data.get("prompt_concat_order")
        run_timestamp = str(data.get("run_timestamp") or data.get("run_prefix") or "").strip()
        materials = self._materials_by_id(data)

        clip = clips[index] if clips and 0 <= index < len(clips) else {}
        if not isinstance(clip, dict):
            clip = {}

        # Prefer source_clip_id (timeline id); runtime rows use id=runtime_XXXX.
        timeline_clip_id = str(
            clip.get("source_clip_id") or clip.get("id") or ""
        ).strip()
        if timeline_clip_id:
            notify_timeline(
                EVENT_CLIP_RUNNING,
                clip_id=timeline_clip_id,
                index=int(index),
            )

        clip_start_ms = int(clip.get("start_ms", 0) or 0)
        clip_end_ms = int(clip.get("end_ms", clip_start_ms) or clip_start_ms)
        frame_count = self._frame_count(clip_start_ms, clip_end_ms, fps)
        prompt = self._compose_prompt(
            clip,
            global_prompt,
            materials,
            style_prompt=style_prompt,
            non_diegetic_music=non_diegetic_music,
            negative_prompt=negative_prompt,
            prompt_concat_order=prompt_concat_order,
        )
        generate_preview_video = bool(clip.get("generate_preview_video", False))
        second_sample = bool(clip.get("second_sample", False))

        preview_start_ms = clip.get("preview_start_ms", None)
        preview_end_ms = clip.get("preview_end_ms", None)
        try:
            preview_start_ms = int(preview_start_ms) if preview_start_ms is not None else clip_start_ms
        except (TypeError, ValueError):
            preview_start_ms = clip_start_ms
        try:
            preview_end_ms = int(preview_end_ms) if preview_end_ms is not None else clip_end_ms
        except (TypeError, ValueError):
            preview_end_ms = clip_end_ms
        preview_frame_count = self._frame_count(preview_start_ms, preview_end_ms, fps)

        from_start = self._from_tag(clip_start_ms, frame_count, fps)
        from_preview_start = self._from_tag(preview_start_ms, preview_frame_count, fps)
        seq_filename_prefix = self._seq_filename_prefix(run_timestamp, from_start, index, seq_name_mode)

        if self._uses_master_audio(data, clip):
            audio_out = self._clip_audio_from_master(data, clip, trim_offset)
        else:
            audio_out = self._clip_audio_from_audios(clip, trim_offset, materials=materials)

        blank = torch.zeros(1, 64, 64, 3)
        refs = self._ref_list(clip.get("images"))
        if not refs:
            refs = self._ref_list(clip.get("start_image")) + self._ref_list(clip.get("end_image"))
        first_frame = self._first_loadable_image(refs, materials)
        last_frame = self._first_loadable_image(list(reversed(refs)), materials)
        if first_frame is None:
            first_frame = blank
        if last_frame is None:
            last_frame = blank
        images = self._load_images_batch(refs, materials, blank)
        clip_role = str(clip.get("clip_role") or "multi_ref").strip() or "multi_ref"
        agent = str(clip.get("agent") or "MiniMaxH3").strip() or "MiniMaxH3"
        ai_prompt = self._strip_comment_lines(clip.get("ai_prompt") or "").strip()
        clip_json = self._build_clip_json(
            clip,
            materials,
            fps=fps,
            global_prompt=global_prompt,
            style_prompt=style_prompt,
            non_diegetic_music=non_diegetic_music,
            negative_prompt=negative_prompt,
            prompt_concat_order=prompt_concat_order,
        )
        output_video = str(clip.get("output_video") or "").strip().replace("\\", "/")

        return (
            audio_out,
            frame_count,
            first_frame,
            last_frame,
            prompt,
            run_timestamp,
            generate_preview_video,
            from_start,
            from_preview_start,
            seq_filename_prefix,
            images,
            clip_role,
            agent,
            ai_prompt,
            clip_json,
            second_sample,
            output_video,
        )


NODE_CLASS_MAPPINGS = {"CAP_DataJsonClipParser": CAP_DataJsonClipParser}
NODE_DISPLAY_NAME_MAPPINGS = {"CAP_DataJsonClipParser": "Data Json Clip Parser"}
