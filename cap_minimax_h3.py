from __future__ import annotations

import json
import logging
import os
import sys

import torch

import nodes
from comfy_api.latest._input_impl.video_types import VideoFromFile
from comfy_extras.nodes_minimax_h3 import FPS as H3_FPS, MiniMaxH3ReferenceToVideo, align_frame_count

from .cap_data_json_parser import CAP_DataJsonClipParser
from .cap_timeline_project_io import _resolve_output_file
from .timecode import AUDIO_EXTENSIONS, VIDEO_EXTENSIONS

MAX_REF_IMAGES = 9
MAX_REF_VIDEOS = 3
MAX_REF_AUDIOS = 3
REF_VIDEO_FPS = 24
REF_VIDEO_MAX_SEC = 15.0

# Same grid as ComfyUI-H3-Motion-Context: VAE only distinguishes these run lengths.
_VIDEO_RUN_GRID = (124, 107, 90, 73, 56, 39, 22, 5, 1)
_LOG = logging.getLogger("cap_minimax_h3")


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


def _snap_h3_grid(n: int) -> int:
    """Snap down to the H3 VAE run grid; returns 0 when below a usable pin (5)."""
    n = int(n)
    if n < 5:
        return 0
    for g in _VIDEO_RUN_GRID:
        if g <= n and g >= 5:
            return g
    return 0


def _project_frames_to_h3_pin(project_frames: int, project_fps: float) -> int:
    """Convert Timeline fps frame count → H3-native frames, snap to VAE grid."""
    project_frames = max(0, int(project_frames or 0))
    if project_frames <= 0:
        return 0
    fps = max(1.0, float(project_fps) or float(H3_FPS))
    h3_frames = max(0, int(round(project_frames / fps * float(H3_FPS))))
    return _snap_h3_grid(h3_frames)


def _motion_context_cls():
    """Resolve MiniMaxH3MotionContext from the installed H3 Motion Context pack."""
    try:
        from nodes import NODE_CLASS_MAPPINGS as _ncm
        cls = _ncm.get("MiniMaxH3MotionContext")
        if cls is not None:
            return cls
    except Exception:
        pass
    for mod in list(sys.modules.values()):
        if mod is None:
            continue
        cls = getattr(mod, "MiniMaxH3MotionContext", None)
        if isinstance(cls, type) and callable(getattr(cls, "apply", None)):
            return cls
    raise RuntimeError(
        "Cap MiniMaxH3: h3_motion_context_length > 0 requires "
        "ComfyUI-H3-Motion-Context to be installed."
    )


def _context_latent_usable(latent, width: int, height: int) -> bool:
    """True when latent looks like an H3 AV latent at the target resolution."""
    if not isinstance(latent, dict) or latent.get("samples") is None:
        return False
    samples = latent["samples"]
    try:
        if hasattr(samples, "unbind"):
            parts = list(samples.unbind())
        elif isinstance(samples, (tuple, list)):
            parts = list(samples)
        else:
            return False
        if not parts:
            return False
        video = parts[0]
        if video.ndim == 4:
            video = video.unsqueeze(0)
        if video.ndim != 5:
            return False
        src_w = int(video.shape[4]) * 16
        src_h = int(video.shape[3]) * 16
        if src_w != int(width) or src_h != int(height):
            _LOG.warning(
                "Cap MiniMaxH3: context_latent is %dx%d, clip is %dx%d; skipping motion context.",
                src_w, src_h, width, height,
            )
            return False
        return True
    except Exception as exc:
        _LOG.warning("Cap MiniMaxH3: context_latent unusable (%s); skipping motion context.", exc)
        return False


def _prev_clip_output_video_path(data_json: str, index: int) -> str:
    """Resolve previous runtime clip's CapTimelineEditor output_video under output/."""
    try:
        data = json.loads(data_json or "{}")
    except json.JSONDecodeError:
        data = {}
    if not isinstance(data, dict):
        return ""
    clips = data.get("clips")
    if not isinstance(clips, list) or index < 1 or index >= len(clips):
        return ""
    prev = clips[index - 1]
    if not isinstance(prev, dict):
        return ""
    rel = str(prev.get("output_video") or "").strip().replace("\\", "/")
    if not rel:
        return ""
    path = _resolve_output_file(rel)
    if path:
        return path
    # Absolute / already-resolved path.
    if os.path.isfile(rel):
        return os.path.normpath(rel)
    return ""


def _load_motion_context_from_video(path: str, pin_frames: int):
    """Load last pin_frames (at H3 fps) + matching audio from a decoded mp4.

    Returns (frames_IMAGE, audio_or_None) or (None, None).
    """
    pin_frames = max(1, int(pin_frames or 0))
    if not path or not os.path.isfile(path):
        return None, None
    # Slightly more than the pin so resampling still has enough samples.
    tail_sec = max(0.5, pin_frames / float(H3_FPS) + 0.35)
    try:
        video = VideoFromFile(path, start_time=-tail_sec, duration=tail_sec)
        components = video.get_components()
    except Exception as exc:
        _LOG.warning("Cap MiniMaxH3: failed reading context video %s (%s)", path, exc)
        return None, None
    frames = components.images
    if frames is None or not isinstance(frames, torch.Tensor) or frames.ndim != 4 or frames.shape[0] < 1:
        return None, None
    src_fps = float(components.frame_rate) if components.frame_rate else float(H3_FPS)
    frames = _frames_at_fps(frames, src_fps, float(H3_FPS))
    if int(frames.shape[0]) < pin_frames:
        _LOG.warning(
            "Cap MiniMaxH3: context video has %d frames after resample, need %d; skipping.",
            int(frames.shape[0]), pin_frames,
        )
        return None, None
    frames = frames[-pin_frames:]
    audio = components.audio
    if not isinstance(audio, dict) or audio.get("waveform") is None:
        audio = None
    elif int(audio["waveform"].shape[-1]) < 1:
        audio = None
    return frames, audio


class CAP_MiniMaxH3ReferenceToVideo:
    """Parse a Timeline Editor clip from data_json or clip_json and run MiniMax H3 Reference to Video."""

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
            },
            "optional": {
                "clip_json": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "tooltip": "Self-contained clip JSON (e.g. from Data Json Clip Parser). When non-empty, data_json and index are ignored.",
                }),
                "context_latent": ("LATENT", {
                    "tooltip": (
                        "Previous clip's sampler output latent (preferred). "
                        "Used when the clip's h3_motion_context_length > 0. "
                        "If missing/unusable, falls back to the previous clip's "
                        "output_video tail frames + audio (needs clip-specified "
                        "filenames and that file already on disk). "
                        "Pin length snaps down to the H3 VAE grid (5/22/39/56…). "
                        "Wire Decode -> H3 Motion Context Trim with trim_frames."
                    ),
                }),
            },
        }

    RETURN_TYPES = ("CONDITIONING", "LATENT", "INT", "STRING", "IMAGE", "IMAGE", "AUDIO", "STRING", "INT", "BOOLEAN")
    RETURN_NAMES = (
        "positive", "latent", "total_frame_count", "prompt",
        "images", "videos", "audio", "output_video", "trim_frames", "save_latent",
    )
    FUNCTION = "execute"
    CATEGORY = "Capricorncd"
    DESCRIPTION = (
        "MiniMax H3 Reference to Video using a Timeline Editor clip from data_json+index, "
        "or a self-contained clip_json (when set, data_json and index are ignored for the "
        "clip body; data_json+index are still used to find the previous clip's output_video). "
        "Clip images map to ref_image, videos to ref_video (+ soundtrack), "
        "and clip audios to ref_audio. Frame count and prompt come from the clip. "
        "Also outputs clip stills, video frames, mixed clip audio, and output_video "
        "(CapTimelineEditor-specified save path when enabled). "
        "total_frame_count uses clip_json/data_json fps (Timeline Editor fps), "
        "aligned to the H3 17k+5 frame grid — e.g. 7s at 60fps → ~430 frames. "
        "When h3_motion_context_length > 0: prefer context_latent; else pin from the "
        "previous clip's output_video tail (frames+audio). Requires "
        "ComfyUI-H3-Motion-Context. trim_frames feeds H3 Motion Context Trim after decode. "
        "save_latent mirrors the clip flag for gating Save Latent."
    )

    @classmethod
    def IS_CHANGED(cls, clip, vae, audio_vae, width, height, ref_image_size,
                   data_json, index, clip_json="", context_latent=None):
        return (data_json, index, clip_json, width, height, ref_image_size)

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

    def _parse_clip_json(self, clip_json: str):
        try:
            clip = json.loads(clip_json or "{}")
        except json.JSONDecodeError:
            clip = {}
        if not isinstance(clip, dict):
            clip = {}
        parser = CAP_DataJsonClipParser()
        materials = parser._materials_by_id({"materials": clip.get("materials")})
        for ref in (
            parser._ref_list(clip.get("images"))
            + parser._ref_list(clip.get("videos"))
            + (clip.get("audios") if isinstance(clip.get("audios"), list) else [])
        ):
            if not isinstance(ref, dict):
                continue
            mid = str(ref.get("id") or "").strip()
            path = str(ref.get("file") or "").strip()
            if not mid or not path or mid in materials:
                continue
            materials[mid] = ref
        data = {
            "fps": clip.get("fps", 24.0),
            "global_prompt": clip.get("global_prompt", ""),
            "style_prompt": clip.get("style_prompt", ""),
            "non_diegetic_music": clip.get("non_diegetic_music", ""),
            "negative_prompt": clip.get("negative_prompt", ""),
            "prompt_concat_order": clip.get("prompt_concat_order"),
        }
        return data, clip, materials, parser

    def _visual_refs(self, clip: dict, parser: CAP_DataJsonClipParser) -> list:
        images = parser._ref_list(clip.get("images"))
        videos = parser._ref_list(clip.get("videos"))
        if images or videos:
            return images + videos
        return parser._ref_list(clip.get("start_image")) + parser._ref_list(clip.get("end_image"))

    def _material_for_ref(self, ref, materials: dict, parser: CAP_DataJsonClipParser) -> tuple[str, dict]:
        mid = parser._ref_id(ref)
        row = materials.get(mid) if mid else None
        if not isinstance(row, dict):
            row = ref if isinstance(ref, dict) else {}
        path = ""
        if isinstance(ref, dict):
            path = str(ref.get("file") or "").strip()
        if not path:
            path = parser._ref_file(ref, materials)
        location = str(row.get("location") or "input")
        if path and not os.path.isfile(path):
            path = parser._resolve_file_path(path, location)
        return os.path.normpath(path) if path else "", row if isinstance(row, dict) else {}

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
                        media_lines: list[str], *, style_prompt: str = "",
                        non_diegetic_music: str = "", negative_prompt: str = "",
                        prompt_concat_order=None) -> str:
        # Media ref tags stay MiniMax-specific; text parts follow project order.
        base = parser._compose_prompt(
            clip,
            global_prompt,
            materials=None,
            style_prompt=style_prompt,
            non_diegetic_music=non_diegetic_music,
            negative_prompt=negative_prompt,
            prompt_concat_order=prompt_concat_order,
        )
        media = [line for line in (media_lines or []) if line]
        parts = []
        if media:
            parts.append("\n".join(media))
        if base:
            parts.append(base)
        return "\n\n".join(parts)

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

    def _letterbox_frames(self, image: torch.Tensor, height: int, width: int) -> torch.Tensor:
        src_h, src_w = int(image.shape[1]), int(image.shape[2])
        if src_h == height and src_w == width:
            return image
        scale = min(height / src_h, width / src_w)
        nh = min(height, max(1, int(round(src_h * scale))))
        nw = min(width, max(1, int(round(src_w * scale))))
        nchw = image.permute(0, 3, 1, 2)
        if nh != src_h or nw != src_w:
            nchw = torch.nn.functional.interpolate(
                nchw, size=(nh, nw), mode="bilinear", align_corners=False,
            )
        canvas = nchw.new_ones(image.shape[0], nchw.shape[1], height, width)
        top = (height - nh) // 2
        left = (width - nw) // 2
        canvas[:, :, top:top + nh, left:left + nw] = nchw
        return canvas.permute(0, 2, 3, 1)

    def _stack_frames(self, frames: list, blank: torch.Tensor) -> torch.Tensor:
        rows = []
        for frame in frames:
            if not isinstance(frame, torch.Tensor) or frame.ndim != 4 or frame.shape[0] < 1:
                continue
            rows.append(frame)
        if not rows:
            return blank
        height, width = int(rows[0].shape[1]), int(rows[0].shape[2])
        aligned = [self._letterbox_frames(frame, height, width) for frame in rows]
        return torch.cat(aligned, dim=0)

    def execute(self, clip, vae, audio_vae, width, height, ref_image_size,
                data_json, index, clip_json="", context_latent=None):
        if str(clip_json or "").strip():
            data, clip_row, materials, parser = self._parse_clip_json(clip_json)
        else:
            data, clip_row, materials, parser = self._parse_clip(data_json, index)
        start_ms = int(clip_row.get("start_ms", 0) or 0)
        end_ms = int(clip_row.get("end_ms", start_ms) or start_ms)
        clip_duration_ms = max(1, end_ms - start_ms)
        # Prefer Timeline fps from clip_json / data_json (e.g. 60). Fall back to H3's 24.
        try:
            fps = float(data.get("fps", clip_row.get("fps", H3_FPS)))
        except (TypeError, ValueError):
            fps = float(H3_FPS)
        fps = max(1.0, fps)
        clip_frames = align_frame_count(max(5, int(round(clip_duration_ms * fps / 1000))))

        try:
            req_ctx = max(0, int(round(float(clip_row.get("h3_motion_context_length", 0) or 0))))
        except (TypeError, ValueError):
            req_ctx = 0
        pin = _project_frames_to_h3_pin(req_ctx, fps)

        use_context = False
        context_frames = None
        context_audio = None
        use_latent_ctx = False
        mc_cls = None
        if pin > 0:
            mc_cls = _motion_context_cls()
            if context_latent is not None and _context_latent_usable(context_latent, width, height):
                use_context = True
                use_latent_ctx = True
            else:
                prev_path = _prev_clip_output_video_path(data_json, int(index))
                if prev_path:
                    context_frames, context_audio = _load_motion_context_from_video(prev_path, pin)
                    if context_frames is not None:
                        use_context = True
                        _LOG.info(
                            "Cap MiniMaxH3: no usable context_latent; pinning from "
                            "previous output_video %s (pin=%d).",
                            prev_path, pin,
                        )
                if not use_context:
                    _LOG.info(
                        "Cap MiniMaxH3: h3_motion_context_length=%d (pin=%d) but no usable "
                        "context_latent and no previous output_video tail; "
                        "generating without motion context.",
                        req_ctx, pin,
                    )
                    mc_cls = None

        length = align_frame_count(clip_frames + pin) if use_context else clip_frames
        extra_end_ms = max(0, int(round(length * 1000 / fps)) - clip_duration_ms)

        ref_images = {}
        ref_videos = {}
        ref_video_audios = {}
        ref_audios = {}
        picture_lines = []
        video_lines = []
        audio_lines = []
        image_frames = []
        video_frames = []

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
                video_frames.append(frames)
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
            image_frames.append(img)
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
            if not isinstance(mat, dict):
                mat = row
            audio_n += 1
            line = self._material_prompt_line(parser, f"<Audio {audio_n}>", mat)
            if line:
                audio_lines.append(line)

        prompt = self._compose_prompt(
            parser, clip_row, data.get("global_prompt", ""),
            picture_lines + video_lines + audio_lines,
            style_prompt=data.get("style_prompt", ""),
            non_diegetic_music=data.get("non_diegetic_music", ""),
            negative_prompt=data.get("negative_prompt", ""),
            prompt_concat_order=data.get("prompt_concat_order"),
        )

        if parser._uses_master_audio(data, clip_row):
            audio_out = parser._clip_audio_from_master(data, clip_row, 0)
        else:
            audio_out = parser._clip_audio_from_audios(clip_row, 0, materials=materials)
        blank = torch.zeros(1, 64, 64, 3)
        images_out = self._stack_frames(image_frames, blank)
        videos_out = self._stack_frames(video_frames, blank)

        out = MiniMaxH3ReferenceToVideo.execute(
            clip, vae, audio_vae, prompt, width, height, length, ref_image_size,
            ref_images=ref_images or None,
            ref_videos=ref_videos or None,
            ref_video_audios=ref_video_audios or None,
            ref_audios=ref_audios or None,
        )
        positive, latent = out.args
        trim_frames = 0

        if use_context and mc_cls is not None:
            try:
                apply_kw = {
                    "audio_context_length": 0,
                    "audio_vae": audio_vae,
                }
                if use_latent_ctx:
                    apply_kw["context_latent"] = context_latent
                else:
                    apply_kw["context_frames"] = context_frames
                    if context_audio is not None:
                        apply_kw["context_audio"] = context_audio
                positive, trim_frames = mc_cls().apply(
                    positive, vae, latent, pin, **apply_kw,
                )
                trim_frames = int(trim_frames or 0)
            except Exception as exc:
                _LOG.warning(
                    "Cap MiniMaxH3: motion context failed (%s); regenerating without context.",
                    exc,
                )
                length = clip_frames
                out = MiniMaxH3ReferenceToVideo.execute(
                    clip, vae, audio_vae, prompt, width, height, length, ref_image_size,
                    ref_images=ref_images or None,
                    ref_videos=ref_videos or None,
                    ref_video_audios=ref_video_audios or None,
                    ref_audios=ref_audios or None,
                )
                positive, latent = out.args
                trim_frames = 0

        output_video = str(clip_row.get("output_video") or "").strip().replace("\\", "/")
        save_latent = bool(clip_row.get("save_latent", False))
        return (
            positive, latent, length, prompt, images_out, videos_out,
            audio_out, output_video, trim_frames, save_latent,
        )


_EMPTY_CONTEXT_LATENT = {"samples": None}


class CAP_H3MotionContextLoadLatentOptional:
    """Load H3 Motion Context latent only when `load` is True.

    Wire Data Parser `load_context` into `load`. When False (or file missing)
    returns an empty LATENT — Cap MiniMaxH3 then falls back to previous
    output_video or skips pinning. No If false-branch needed.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "load": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "From Data Json Clip Parser load_context "
                               "(h3_motion_context_length > 5). False skips "
                               "disk load without error.",
                }),
                "latent_path": ("STRING", {
                    "default": "h3_context",
                    "tooltip": "Same as H3 Motion Context Load Latent: file "
                               "or folder under ComfyUI output/.",
                }),
                "clip_index": ("INT", {
                    "default": 0, "min": 0, "max": 9999,
                    "tooltip": "Clip slot to continue FROM (previous clip). "
                               "0 = newest file (not retry-safe).",
                }),
            },
        }

    RETURN_TYPES = ("LATENT",)
    RETURN_NAMES = ("context_latent",)
    FUNCTION = "load_latent"
    CATEGORY = "Capricorncd"
    DESCRIPTION = (
        "Optional H3 Motion Context Load Latent. Loads only when load=True; "
        "otherwise (or if the file is missing) outputs an empty LATENT so Cap "
        "MiniMaxH3 can fall back to the previous clip's output_video."
    )

    @classmethod
    def IS_CHANGED(cls, load, latent_path, clip_index=0):
        if not load:
            return "skip"
        try:
            from nodes import NODE_CLASS_MAPPINGS as _ncm
            loader = _ncm.get("MiniMaxH3MotionContextLoadLatent")
            if loader is not None and hasattr(loader, "IS_CHANGED"):
                return loader.IS_CHANGED(latent_path, clip_index)
        except Exception:
            pass
        return f"{load}:{latent_path}:{clip_index}"

    def load_latent(self, load, latent_path, clip_index=0):
        if not load:
            _LOG.info("Cap H3 optional load: load=False; skipped.")
            return (_EMPTY_CONTEXT_LATENT,)
        try:
            from nodes import NODE_CLASS_MAPPINGS as _ncm
            loader_cls = _ncm.get("MiniMaxH3MotionContextLoadLatent")
            if loader_cls is None:
                _LOG.warning(
                    "Cap H3 optional load: MiniMaxH3MotionContextLoadLatent "
                    "not installed; skipping."
                )
                return (_EMPTY_CONTEXT_LATENT,)
            out = loader_cls().load(latent_path, clip_index)
            if isinstance(out, tuple):
                return out
            return (out,)
        except Exception as exc:
            _LOG.info(
                "Cap H3 optional load: skipped (%s); Cap MiniMaxH3 will try "
                "output_video fallback or generate without context.",
                exc,
            )
            return (_EMPTY_CONTEXT_LATENT,)


class CAP_H3MotionContextSaveLatentOptional:
    """Save H3 Motion Context latent only when `save` is True.

    Wire Cap MiniMaxH3 / Data Parser `save_latent` into `save`. When False the
    node is a no-op (returns empty path) so no If false-branch is needed.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "save": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "From Cap MiniMaxH3 or Data Json Clip Parser "
                               "save_latent. False skips writing to disk.",
                }),
                "latent": ("LATENT", {
                    "tooltip": "Sampler output latent (same as stock H3 "
                               "Motion Context Save Latent).",
                }),
                "filename_prefix": ("STRING", {
                    "default": "h3_context/clip",
                    "tooltip": "Under ComfyUI output/. Same as stock Save Latent.",
                }),
                "clip_index": ("INT", {
                    "default": 0, "min": 0, "max": 9999,
                    "tooltip": "This clip's slot (overwrite on re-roll). "
                               "0 = auto-numbered run files.",
                }),
            },
        }

    RETURN_TYPES = ("STRING", "LATENT")
    RETURN_NAMES = ("latent_path", "latent")
    FUNCTION = "save"
    OUTPUT_NODE = True
    CATEGORY = "Capricorncd"
    DESCRIPTION = (
        "Optional H3 Motion Context Save Latent. Saves only when save=True; "
        "otherwise returns an empty path and passes the latent through. "
        "Requires ComfyUI-H3-Motion-Context."
    )

    @classmethod
    def IS_CHANGED(cls, save, latent, filename_prefix, clip_index=0):
        if not save:
            return "skip"
        return f"{save}:{filename_prefix}:{clip_index}"

    def save(self, save, latent, filename_prefix, clip_index=0):
        if not save:
            _LOG.info("Cap H3 optional save: save=False; skipped.")
            return ("", latent)
        try:
            from nodes import NODE_CLASS_MAPPINGS as _ncm
            saver_cls = _ncm.get("MiniMaxH3MotionContextSaveLatent")
            if saver_cls is None:
                raise RuntimeError(
                    "Cap H3 optional save: MiniMaxH3MotionContextSaveLatent "
                    "not installed (need ComfyUI-H3-Motion-Context)."
                )
            out = saver_cls().save(latent, filename_prefix, clip_index)
            path = out[0] if isinstance(out, tuple) else out
            return (str(path or ""), latent)
        except Exception as exc:
            _LOG.warning("Cap H3 optional save failed: %s", exc)
            raise


NODE_CLASS_MAPPINGS = {
    "CAP_MiniMaxH3ReferenceToVideo": CAP_MiniMaxH3ReferenceToVideo,
    "CAP_H3MotionContextLoadLatentOptional": CAP_H3MotionContextLoadLatentOptional,
    "CAP_H3MotionContextSaveLatentOptional": CAP_H3MotionContextSaveLatentOptional,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "CAP_MiniMaxH3ReferenceToVideo": "MiniMaxH3",
    "CAP_H3MotionContextLoadLatentOptional": "H3 Motion Context Load Latent (Optional)",
    "CAP_H3MotionContextSaveLatentOptional": "H3 Motion Context Save Latent (Optional)",
}
