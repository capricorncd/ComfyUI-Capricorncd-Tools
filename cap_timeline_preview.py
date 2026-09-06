from __future__ import annotations

import base64
import io
import json
import logging
import secrets
from fractions import Fraction

import nodes
import torch
from comfy_api.latest import InputImpl, Types
from comfy_extras.nodes_minimax_h3 import FPS as H3_FPS

from .cap_minimax_h3 import CAP_MiniMaxH3ReferenceToVideo
from .cap_timeline_editor import (
    CAP_TimelineEditor,
    _add_material,
    _clip_visual_entries,
    _timeline_prompt_includes,
)
from .timecode import resolve_media_path


_LOG = logging.getLogger("cap_timeline_preview")


def _node_output(name: str, *args):
    cls = nodes.NODE_CLASS_MAPPINGS.get(name)
    if cls is None:
        raise RuntimeError(f"Generate Timeline Preview requires the {name} node.")
    result = cls.execute(*args)
    values = getattr(result, "args", result)
    return tuple(values) if isinstance(values, (tuple, list)) else (values,)


def _clip_range(clip: dict) -> tuple[int, int]:
    return CAP_TimelineEditor._clip_range(clip)


def _find_clip(project: dict, clip_id: str) -> tuple[dict, dict]:
    requested = str(clip_id or "").strip()
    fallback = None
    for track in project.get("tracks") or []:
        if not isinstance(track, dict) or str(track.get("type") or "visual").lower() in ("audio", "text", "subtitle"):
            continue
        for clip in track.get("clips") or []:
            if not isinstance(clip, dict):
                continue
            if fallback is None and clip.get("enabled", True) is not False:
                fallback = (track, clip)
            if requested and str(clip.get("id") or "") == requested:
                return track, clip
    if requested:
        raise ValueError(f"Timeline clip not found: {requested}")
    if fallback is None:
        raise ValueError("Timeline project has no enabled visual Clip to preview.")
    return fallback


def _preview_data(project_json: str, clip_id: str, width: int, height: int) -> tuple[dict, dict]:
    project = CAP_TimelineEditor._project(project_json)
    _track, clip = _find_clip(project, clip_id)
    settings = project["settings"]
    start_ms, end_ms = _clip_range(clip)
    if end_ms <= start_ms:
        raise ValueError("The selected Clip has no previewable duration.")

    materials = []
    seen = set()

    def resolve_media(file: str) -> str:
        return resolve_media_path(file, assets_dir="", location="input")

    entries = _clip_visual_entries(project, clip)
    image_refs = []
    video_refs = []
    for entry in entries:
        if not entry.get("enabled"):
            continue
        row = entry.get("row") or {}
        mid = _add_material(materials, seen, row, resolve_media)
        if not mid:
            continue
        ref = {"id": mid}
        if str(row.get("kind") or "image").lower() == "video":
            video_refs.append(ref)
        else:
            image_refs.append(ref)

    audio_clips = []
    for track in project.get("tracks") or []:
        if not isinstance(track, dict) or str(track.get("type") or "").lower() != "audio":
            continue
        if track.get("enabled", True) is False or track.get("muted", False):
            continue
        for audio_clip in track.get("clips") or []:
            if isinstance(audio_clip, dict) and audio_clip.get("enabled", True) is not False and not audio_clip.get("muted", False):
                audio_clips.append(audio_clip)

    editor = CAP_TimelineEditor()
    runtime_clip = {
        "id": "preview_clip",
        "source_clip_id": str(clip.get("id") or ""),
        "start_ms": start_ms,
        "end_ms": end_ms,
        "images": image_refs,
        "videos": video_refs,
        "audios": editor._audio_slices(start_ms, end_ms, audio_clips, resolve_media, project, materials, seen),
        "prompt": str(clip.get("prompt") or ""),
        "prompt_includes": _timeline_prompt_includes(clip),
        "use_prepend_prompt": clip.get("use_prepend_prompt", True) is not False,
        "use_append_prompt": clip.get("use_append_prompt", True) is not False,
        "h3_motion_context_length": 0,
        "seed": clip.get("seed", -1),
    }
    data = {
        "schema_version": project.get("schema_version"),
        "fps": float(settings.get("fps") or H3_FPS),
        "width": int(width or settings.get("width") or 1344),
        "height": int(height or settings.get("height") or 768),
        "prepend_prompt": str(settings.get("prepend_prompt") or ""),
        "append_prompt": str(settings.get("append_prompt") or ""),
        "materials": materials,
        "clips": [runtime_clip],
    }
    return data, runtime_clip


def _trim_preview(frames: torch.Tensor, audio: dict, duration_seconds: float) -> tuple[torch.Tensor, dict]:
    frame_count = max(1, int(round(duration_seconds * H3_FPS)))
    frames = frames[:frame_count]
    if not isinstance(audio, dict) or not isinstance(audio.get("waveform"), torch.Tensor):
        return frames, audio
    sample_rate = int(audio.get("sample_rate") or 32000)
    sample_count = max(1, int(round(duration_seconds * sample_rate)))
    out = dict(audio)
    out["waveform"] = audio["waveform"][..., :sample_count]
    return frames, out


class CAP_TimelinePreview:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
                "video_vae": ("VAE",),
                "audio_vae": ("VAE",),
                "project_json": ("STRING", {"default": "", "multiline": True}),
                "clip_id": ("STRING", {"default": ""}),
                "width": ("INT", {"default": 0, "min": 0, "max": nodes.MAX_RESOLUTION, "step": 32}),
                "height": ("INT", {"default": 0, "min": 0, "max": nodes.MAX_RESOLUTION, "step": 32}),
                "steps": ("INT", {"default": 4, "min": 1, "max": 1000}),
                "seed": ("INT", {"default": -1, "min": -1, "max": 0xffffffffffffffff}),
                "ref_image_size": (["match", "max"], {"default": "match"}),
            },
            "optional": {
                "shift_video": ("FLOAT", {"default": 12.0, "min": 0.01, "max": 100.0, "step": 0.01}),
                "shift_audio": ("FLOAT", {"default": 3.0, "min": 0.01, "max": 100.0, "step": 0.01}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "prompt_id": "PROMPT_ID",
            },
        }

    RETURN_TYPES = ("VIDEO", "IMAGE", "AUDIO", "STRING", "INT", "STRING")
    RETURN_NAMES = ("preview_video", "frames", "audio", "prompt", "seed", "clip_id")
    FUNCTION = "generate"
    CATEGORY = "Capricorncd/Timeline"
    OUTPUT_NODE = True
    DESCRIPTION = (
        "Generate an in-memory MiniMax H3 preview for one Timeline Editor Clip. "
        "The Prompt Manager injects project_json and clip_id automatically. "
        "Connect the H3 model, text encoder, video VAE, and audio VAE; sampling, "
        "reference loading, decoding, and VIDEO assembly happen inside this node."
    )

    @classmethod
    def IS_CHANGED(cls, model, clip, video_vae, audio_vae, project_json, clip_id, width, height,
                   steps, seed, ref_image_size, shift_video=12.0, shift_audio=3.0,
                   unique_id=None, prompt_id=None):
        return (project_json, clip_id, width, height, steps, seed, ref_image_size, shift_video, shift_audio)

    def generate(self, model, clip, video_vae, audio_vae, project_json, clip_id, width, height,
                 steps, seed, ref_image_size, shift_video=12.0, shift_audio=3.0,
                 unique_id=None, prompt_id=None):
        data, clip_row = _preview_data(project_json, clip_id, width, height)
        selected_id = str(clip_row.get("source_clip_id") or clip_id or "")
        resolved_seed = int(seed)
        if resolved_seed < 0:
            try:
                resolved_seed = int(clip_row.get("seed", -1))
            except (TypeError, ValueError):
                resolved_seed = -1
        if resolved_seed < 0:
            resolved_seed = secrets.randbelow(0x10000000000000000)

        prepared = CAP_MiniMaxH3ReferenceToVideo().execute(
            clip,
            video_vae,
            audio_vae,
            int(data["width"]),
            int(data["height"]),
            ref_image_size,
            json.dumps(data, ensure_ascii=False),
            0,
        )
        positive, latent, _length, prompt = prepared[:4]
        patched_model, sampler, sigmas = _node_output(
            "MiniMaxH3DualClockSamplerT8",
            model,
            latent,
            int(steps),
            float(shift_video),
            float(shift_audio),
            "dual_clock_euler",
            "native_flow",
        )
        guider, = _node_output("BasicGuider", patched_model, positive)
        noise, = _node_output("RandomNoise", resolved_seed)
        sampled, _denoised = _node_output("SamplerCustomAdvanced", noise, guider, sampler, sigmas, latent)
        frames, generated_audio, _video_latent, _audio_latent = _node_output(
            "MiniMaxH3AVDecodeT8", sampled, video_vae, audio_vae,
        )

        start_ms = int(clip_row.get("start_ms", 0) or 0)
        end_ms = int(clip_row.get("end_ms", start_ms) or start_ms)
        duration_seconds = max(1, end_ms - start_ms) / 1000.0
        frames, generated_audio = _trim_preview(frames, generated_audio, duration_seconds)
        video = InputImpl.VideoFromComponents(
            Types.VideoComponents(
                images=frames,
                audio=generated_audio,
                frame_rate=Fraction(H3_FPS),
            )
        )

        try:
            from server import PromptServer

            buffer = io.BytesIO()
            video.save_to(
                buffer,
                format=Types.VideoContainer.MP4,
                codec=Types.VideoCodec.H264,
                crf=23,
            )
            PromptServer.instance.send_sync(
                "cap_timeline_preview",
                {
                    "prompt_id": str(prompt_id or ""),
                    "node_id": str(unique_id or ""),
                    "clip_id": selected_id,
                    "mime": "video/mp4",
                    "video": base64.b64encode(buffer.getvalue()).decode("ascii"),
                    "seed": resolved_seed,
                },
                PromptServer.instance.client_id,
            )
        except Exception as exc:
            _LOG.warning("Unable to send Timeline preview to the editor: %s", exc)

        return video, frames, generated_audio, prompt, resolved_seed, selected_id


NODE_CLASS_MAPPINGS = {"CAP_TimelinePreview": CAP_TimelinePreview}
NODE_DISPLAY_NAME_MAPPINGS = {"CAP_TimelinePreview": "Generate Timeline Preview"}
