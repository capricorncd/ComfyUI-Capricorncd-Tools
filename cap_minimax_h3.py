from __future__ import annotations

import json
import os

import torch

import nodes
from comfy_api.latest._input_impl.video_types import VideoFromFile
from comfy_extras.nodes_minimax_h3 import FPS as H3_FPS, MiniMaxH3ReferenceToVideo, align_frame_count

from .cap_data_json_parser import CAP_DataJsonClipParser
from .timecode import AUDIO_EXTENSIONS, VIDEO_EXTENSIONS

MAX_REF_IMAGES = 9
MAX_REF_VIDEOS = 3
MAX_REF_AUDIOS = 3
REF_VIDEO_FPS = 24
REF_VIDEO_MAX_SEC = 15.0


def _kind_of(row: dict, path: str) -> str:
    kind = str((row or {}).get("kind") or "").lower()
    if kind in ("image", "video", "audio"):
        return kind
    ext = os.path.splitext(path or "")[1].lower()
    if ext in VIDEO_EXTENSIONS:
        return "video"
    if ext in AUDIO_EXTENSIONS:
        return "audio"
    return "image"


def _frames_at_fps(frames: torch.Tensor, src_fps: float, dst_fps: float = REF_VIDEO_FPS) -> torch.Tensor:
    n = int(frames.shape[0])
    if n <= 0:
        return frames
    src_fps = max(1e-6, float(src_fps) or dst_fps)
    duration = min(n / src_fps, REF_VIDEO_MAX_SEC)
    target_n = max(1, int(round(duration * dst_fps)))
    if abs(src_fps - dst_fps) < 0.01 and n <= target_n:
        return frames[:target_n]
    idx = [min(n - 1, int(round(i * src_fps / dst_fps))) for i in range(target_n)]
    return frames[idx]


def _pad_video_frames(frames: torch.Tensor, min_frames: int = 5) -> torch.Tensor:
    n = int(frames.shape[0])
    if n >= min_frames:
        return frames
    return torch.cat([frames, frames[-1:].repeat(min_frames - n, 1, 1, 1)], dim=0)


class CAP_MiniMaxH3ReferenceToVideo:
    """Parse a Timeline Editor clip from data_json and run MiniMax H3 Reference to Video."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "clip": ("CLIP",),
                "vae": ("VAE",),
                "audio_vae": ("VAE",),
                "width": ("INT", {"default": 1344, "min": 32, "max": nodes.MAX_RESOLUTION, "step": 32}),
                "height": ("INT", {"default": 768, "min": 32, "max": nodes.MAX_RESOLUTION, "step": 32}),
                "ref_image_size": (["match", "max"], {
                    "default": "match",
                    "tooltip": "Reference image sizing. 'match' scales each ref to the generation's pixel area; 'max' uses 2048px short edge.",
                }),
                "data_json": ("STRING", {"default": "", "multiline": True}),
                "index": ("INT", {"default": 0, "min": 0, "max": 9999, "step": 1}),
                "optimize_prompt": ("BOOLEAN", {
                    "default": True,
                    "tooltip": "Use the clip's AI-optimized prompt when present. Off uses the composed clip / media / global prompt.",
                }),
            },
        }

    RETURN_TYPES = ("CONDITIONING", "LATENT", "INT", "STRING")
    RETURN_NAMES = ("positive", "latent", "total_frame_count", "prompt")
    FUNCTION = "execute"
    CATEGORY = "Capricorncd"
    DESCRIPTION = (
        "MiniMax H3 Reference to Video using a Timeline Editor clip from data_json. "
        "Clip images map to ref_image, videos to ref_video (+ soundtrack), "
        "and clip audios to ref_audio. Frame count and prompt come from the clip."
    )

    @classmethod
    def IS_CHANGED(cls, clip, vae, audio_vae, width, height, ref_image_size,
                   data_json, index, optimize_prompt=True):
        return (data_json, index, width, height, ref_image_size, optimize_prompt)

    def _parse_clip(self, data_json: str, index: int):
        try:
            data = json.loads(data_json or "{}")
        except json.JSONDecodeError:
            data = {}
        if not isinstance(data, dict):
            data = {}
        clips = data.get("clips", [])
        if not isinstance(clips, list):
            clips = []
        clip = clips[index] if clips and 0 <= index < len(clips) else {}
        if not isinstance(clip, dict):
            clip = {}
        parser = CAP_DataJsonClipParser()
        materials = parser._materials_by_id(data)
        return data, clip, materials, parser

    def _visual_refs(self, clip: dict, parser: CAP_DataJsonClipParser) -> list:
        refs = parser._ref_list(clip.get("images"))
        if not refs:
            refs = parser._ref_list(clip.get("start_image")) + parser._ref_list(clip.get("end_image"))
        return refs

    def _material_for_ref(self, ref, materials: dict, parser: CAP_DataJsonClipParser) -> tuple[str, dict]:
        mid = parser._ref_id(ref)
        row = materials.get(mid) if mid else None
        if not isinstance(row, dict):
            row = {}
        path = parser._ref_file(ref, materials)
        location = str(row.get("location") or "input")
        if path and not os.path.isfile(path):
            path = parser._resolve_file_path(path, location)
        return os.path.normpath(path) if path else "", row

    def _material_prompt_line(self, parser: CAP_DataJsonClipParser, label: str, row: dict) -> str:
        text = parser._strip_comment_lines((row or {}).get("prompt") or "").strip()
        media_type = str((row or {}).get("media_type") or "").strip()
        tags = (row or {}).get("tags") if isinstance((row or {}).get("tags"), list) else []
        tags = [str(tag).strip() for tag in tags if str(tag).strip()]
        meta = ", ".join(part for part in [media_type, *tags] if part)
        body = ". ".join(part for part in [meta, text] if part)
        if not body:
            return ""
        return f"{label}: {body}"

    def _compose_prompt(self, parser: CAP_DataJsonClipParser, clip: dict, global_prompt: str,
                        media_lines: list[str], use_optimized: bool = True) -> str:
        if use_optimized:
            ai_prompt = parser._strip_comment_lines(clip.get("ai_prompt") or "").strip()
            if ai_prompt:
                return ai_prompt
        parts = [line for line in (media_lines or []) if line]
        if parser._clip_use_global_prompt(clip):
            text = parser._strip_comment_lines(global_prompt or "").strip()
            if text:
                parts.append(text)
        clip_prompt = parser._strip_comment_lines(clip.get("prompt") or "").strip()
        if clip_prompt:
            parts.append(clip_prompt)
        return "\n".join(parts)

    def _load_video_ref(self, path: str):
        try:
            video = VideoFromFile(path, start_time=0, duration=REF_VIDEO_MAX_SEC)
            components = video.get_components()
        except Exception:
            return None, None
        frames = components.images
        if frames is None or not isinstance(frames, torch.Tensor) or frames.ndim != 4 or frames.shape[0] < 1:
            return None, None
        src_fps = float(components.frame_rate) if components.frame_rate else REF_VIDEO_FPS
        frames = _pad_video_frames(_frames_at_fps(frames, src_fps))
        audio = components.audio
        if not isinstance(audio, dict) or audio.get("waveform") is None:
            audio = None
        elif int(audio["waveform"].shape[-1]) < 1:
            audio = None
        return frames, audio

    def _load_audio_ref(self, row: dict, materials: dict, parser: CAP_DataJsonClipParser,
                        extra_end_ms: int = 0, clip_duration_ms: int = 0):
        path = os.path.normpath(parser._audio_row_path(row, materials))
        if not path or not os.path.isfile(path):
            return None
        src_start = max(0, int(row.get("source_start_ms", 0) or 0))
        src_end = max(src_start + 1, int(row.get("source_end_ms", src_start) or src_start))
        offset_ms = max(0, int(row.get("clip_offset_ms", 0) or 0))
        slice_ms = src_end - src_start
        if extra_end_ms > 0 and (clip_duration_ms <= 0 or offset_ms + slice_ms >= clip_duration_ms - 1):
            src_end += extra_end_ms
        try:
            waveform, sample_rate = parser._load_waveform(path)
        except Exception:
            return None
        return parser._trim(waveform, sample_rate, src_start, src_end)

    def execute(self, clip, vae, audio_vae, width, height, ref_image_size,
                data_json, index, optimize_prompt=True):
        data, clip_row, materials, parser = self._parse_clip(data_json, index)
        fps = max(1.0, float(data.get("fps", 24.0)))
        start_ms = int(clip_row.get("start_ms", 0) or 0)
        end_ms = int(clip_row.get("end_ms", start_ms) or start_ms)
        length = align_frame_count(max(5, parser._frame_count(start_ms, end_ms, fps)))
        clip_duration_ms = max(1, end_ms - start_ms)
        extra_end_ms = max(0, int(round(length * 1000 / H3_FPS)) - clip_duration_ms)

        ref_images = {}
        ref_videos = {}
        ref_video_audios = {}
        ref_audios = {}
        picture_lines = []
        video_lines = []
        audio_lines = []

        for ref in self._visual_refs(clip_row, parser):
            path, row = self._material_for_ref(ref, materials, parser)
            if not path or not os.path.isfile(path):
                continue
            kind = _kind_of(row, path)
            use_prompt = parser._ref_use_media_prompt(ref)
            if kind == "video":
                if len(ref_videos) >= MAX_REF_VIDEOS:
                    continue
                frames, soundtrack = self._load_video_ref(path)
                if frames is None:
                    continue
                n = len(ref_videos) + 1
                ref_videos[f"ref_video_{n}"] = frames
                if soundtrack is not None:
                    ref_video_audios[f"ref_video_audio_{n}"] = soundtrack
                if use_prompt:
                    line = self._material_prompt_line(parser, f"<Video {n}>", row)
                    if line:
                        video_lines.append(line)
                continue
            if kind != "image" or len(ref_images) >= MAX_REF_IMAGES:
                continue
            img = parser._load_image(path)
            if img is None:
                continue
            n = len(ref_images) + 1
            ref_images[f"ref_image_{n}"] = img
            if use_prompt:
                line = self._material_prompt_line(parser, f"<Picture {n}>", row)
                if line:
                    picture_lines.append(line)

        audio_n = len(ref_video_audios)
        for row in clip_row.get("audios") if isinstance(clip_row.get("audios"), list) else []:
            if len(ref_audios) >= MAX_REF_AUDIOS:
                break
            if not isinstance(row, dict):
                continue
            audio = self._load_audio_ref(
                row, materials, parser,
                extra_end_ms=extra_end_ms, clip_duration_ms=clip_duration_ms,
            )
            if audio is None:
                continue
            n = len(ref_audios) + 1
            ref_audios[f"ref_audio_{n}"] = audio
            mid = str(row.get("id") or "").strip()
            mat = materials.get(mid) if mid else None
            if isinstance(mat, dict):
                audio_n += 1
                line = self._material_prompt_line(parser, f"<Audio {audio_n}>", mat)
                if line:
                    audio_lines.append(line)

        prompt = self._compose_prompt(
            parser, clip_row, data.get("global_prompt", ""),
            picture_lines + video_lines + audio_lines,
            use_optimized=optimize_prompt,
        )

        out = MiniMaxH3ReferenceToVideo.execute(
            clip, vae, audio_vae, prompt, width, height, length, ref_image_size,
            ref_images=ref_images or None,
            ref_videos=ref_videos or None,
            ref_video_audios=ref_video_audios or None,
            ref_audios=ref_audios or None,
        )
        return (*out.args, length, prompt)


NODE_CLASS_MAPPINGS = {"CAP_MiniMaxH3ReferenceToVideo": CAP_MiniMaxH3ReferenceToVideo}
NODE_DISPLAY_NAME_MAPPINGS = {"CAP_MiniMaxH3ReferenceToVideo": "MiniMaxH3"}
