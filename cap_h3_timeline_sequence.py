from __future__ import annotations

import json
import math
import re

import torch

import comfy.nested_tensor
import nodes
from comfy_execution.graph_utils import GraphBuilder
from comfy_extras.nodes_minimax_h3 import (
    AUDIO_LATENT_FPS,
    FPS as H3_FPS,
    align_frame_count,
    video_latent_t,
)

from .cap_minimax_h3 import _snap_h3_grid

AUTO_CONTEXT_FRAMES = 39
_TIME_RANGE_RE = re.compile(
    r"(?<!\d)(\d+(?:\.\d+)?)\s*[—–-]\s*(\d+(?:\.\d+)?)\s*(?:秒|s(?:ec(?:onds?)?)?)",
    re.IGNORECASE,
)
_LEADING_TIME_RANGE_RE = re.compile(
    r"^\s*(?:\[Shot[^\]]*\]\s*)?\(?\s*(\d+(?:\.\d+)?)\s*[—–-]\s*"
    r"(\d+(?:\.\d+)?)\s*(?:秒|s(?:ec(?:onds?)?)?)",
    re.IGNORECASE,
)
_DETAILED_DESCRIPTION_RE = re.compile(
    r"^detailed_description\s*:\s*(.*?)(?=^(?:subject_definitions|summary|retention_analysis|overall_soundscape|non_diegetic_music)\s*:|\Z)",
    re.IGNORECASE | re.MULTILINE | re.DOTALL,
)


def _sequence_rows(data_json: str) -> tuple[dict, list[dict], float]:
    try:
        data = json.loads(data_json or "{}")
    except json.JSONDecodeError as exc:
        raise ValueError(f"Timeline Sequence Sampler: invalid data_json: {exc.msg}") from exc
    if not isinstance(data, dict):
        raise ValueError("Timeline Sequence Sampler: data_json must be an object.")
    clips = data.get("clips")
    if not isinstance(clips, list) or not clips:
        raise ValueError("Timeline Sequence Sampler: data_json contains no clips to run.")
    rows = []
    for index, clip in enumerate(clips):
        if not isinstance(clip, dict):
            raise ValueError(f"Timeline Sequence Sampler: clip {index + 1} is invalid.")
        start_ms = int(clip.get("start_ms", 0) or 0)
        end_ms = int(clip.get("end_ms", start_ms) or start_ms)
        if end_ms <= start_ms:
            raise ValueError(f"Timeline Sequence Sampler: clip {index + 1} has no duration.")
        rows.append(clip)
    try:
        fps = max(1.0, float(data.get("fps", H3_FPS) or H3_FPS))
    except (TypeError, ValueError):
        fps = float(H3_FPS)
    return data, rows, fps


def _clip_plan(data: dict, clip: dict, fps: float, first: bool) -> tuple[str, int, int, int]:
    start_ms = int(clip.get("start_ms", 0) or 0)
    end_ms = int(clip.get("end_ms", start_ms) or start_ms)
    frame_count = max(1, int(round((end_ms - start_ms) * fps / 1000)))
    try:
        requested_context = _snap_h3_grid(int(round(float(clip.get("h3_motion_context_length", 0) or 0))))
    except (TypeError, ValueError):
        requested_context = 0
    if first:
        requested_context = 0

    trim_frames = requested_context
    target_frames = align_frame_count(max(5, frame_count + requested_context))

    row = dict(clip)
    row.update({
        "start_ms": 0,
        "end_ms": max(1, int(round(target_frames * 1000 / fps))),
        "fps": fps,
        "h3_motion_context_length": 0,
        "materials": data.get("materials", []),
        "global_prompt": data.get("global_prompt", ""),
        "style_prompt": data.get("style_prompt", ""),
        "non_diegetic_music": data.get("non_diegetic_music", ""),
        "negative_prompt": data.get("negative_prompt", ""),
    })
    if "prepend_prompt" in data or "append_prompt" in data:
        row["prepend_prompt"] = data.get("prepend_prompt", "")
        row["append_prompt"] = data.get("append_prompt", "")
    return json.dumps(row, ensure_ascii=False), frame_count, requested_context, trim_frames


def _slice_audio_rows(rows, part_start_ms: int, part_end_ms: int) -> list[dict]:
    result = []
    for value in rows if isinstance(rows, list) else []:
        if not isinstance(value, dict):
            continue
        source_start = max(0, int(value.get("source_start_ms", 0) or 0))
        source_end = max(source_start + 1, int(value.get("source_end_ms", source_start) or source_start))
        row_start = max(0, int(value.get("clip_offset_ms", 0) or 0))
        row_end = row_start + source_end - source_start
        overlap_start = max(part_start_ms, row_start)
        overlap_end = min(part_end_ms, row_end)
        if overlap_end <= overlap_start:
            continue
        row = dict(value)
        source_offset = overlap_start - row_start
        row["source_start_ms"] = source_start + source_offset
        row["source_end_ms"] = row["source_start_ms"] + overlap_end - overlap_start
        row["clip_offset_ms"] = overlap_start - part_start_ms
        row["host_local_start_ms"] = int(value.get("host_local_start_ms", 0) or 0) + source_offset
        result.append(row)
    return result


def _scope_timed_description(text: str, part_start_ms: int, part_end_ms: int) -> str:
    text = str(text or "").strip()
    if not text:
        return ""
    header = ""
    if text.startswith("detailed_description:"):
        header = "detailed_description:"
        text = text[len(header):].lstrip()
    blocks = re.split(r"\n\s*\n", text)
    found_timed_block = False
    kept = []
    for block in blocks:
        ranges = _TIME_RANGE_RE.findall(block)
        if not ranges:
            if part_start_ms > 0 and re.search(r"\[Shot\s+1\]", block, re.IGNORECASE):
                continue
            kept.append(block)
            continue
        found_timed_block = True
        if any(float(end) * 1000 > part_start_ms and float(start) * 1000 < part_end_ms
               for start, end in ranges):
            kept.append(block)
    if not found_timed_block:
        return text
    scope = (
        f"internal_segment_scope: original timeline {part_start_ms / 1000:g}—"
        f"{part_end_ms / 1000:g} seconds. Follow only the timed actions included below; "
        "continue motion from the previous latent without restarting the shot."
    )
    scoped = "\n\n".join((scope, *kept))
    return f"{header}\n\n{scoped}" if header else scoped


def _prompt_detailed_description(prompt: str) -> str:
    match = _DETAILED_DESCRIPTION_RE.search(str(prompt or ""))
    return match.group(1).strip() if match else ""


def _scope_prompt_description(prompt: str, part_start_ms: int, part_end_ms: int) -> str:
    text = str(prompt or "")
    match = _DETAILED_DESCRIPTION_RE.search(text)
    if not match:
        return text.strip()
    scoped = _scope_timed_description(match.group(1), part_start_ms, part_end_ms)
    return f"{text[:match.start(1)]}{scoped}{text[match.end(1):]}".strip()


def _segment_ranges(clip: dict, duration_ms: int, max_segment_ms: int) -> list[tuple[int, int]]:
    boundaries = {0, duration_ms}
    for block in re.split(r"\n\s*\n", _prompt_detailed_description(clip.get("prompt") or "")):
        match = _LEADING_TIME_RANGE_RE.match(block)
        if match is None:
            continue
        start = max(0, min(duration_ms, round(float(match.group(1)) * 1000)))
        end = max(0, min(duration_ms, round(float(match.group(2)) * 1000)))
        if end > start:
            boundaries.update((start, end))

    points = sorted(boundaries)
    authored = len(points) > 2
    ranges = []
    if authored:
        source_ranges = zip(points, points[1:])
    else:
        segment_count = max(1, math.ceil(duration_ms / max_segment_ms))
        source_ranges = [
            (
                round(duration_ms * index / segment_count),
                round(duration_ms * (index + 1) / segment_count),
            )
            for index in range(segment_count)
        ]

    for start, end in source_ranges:
        span = end - start
        count = max(1, math.ceil(span / max_segment_ms))
        ranges.extend(
            (
                start + round(span * index / count),
                start + round(span * (index + 1) / count),
            )
            for index in range(count)
        )
    return ranges


def _segment_seed(seed: int, index: int) -> int:
    if index == 0:
        return int(seed)
    return (int(seed) + index * 0x9E3779B97F4A7C15) & 0xFFFFFFFFFFFFFFFF


def _split_long_clips(clips: list[dict], max_segment_ms: int) -> list[tuple[int, int, int, dict]]:
    segments = []
    for clip_index, clip in enumerate(clips):
        start_ms = int(clip.get("start_ms", 0) or 0)
        end_ms = int(clip.get("end_ms", start_ms) or start_ms)
        duration_ms = end_ms - start_ms
        ranges = _segment_ranges(clip, duration_ms, max_segment_ms)
        count = len(ranges)
        for part_index, (local_start, local_end) in enumerate(ranges):
            row = dict(clip)
            row["start_ms"] = start_ms + local_start
            row["end_ms"] = start_ms + local_end
            row["audios"] = _slice_audio_rows(clip.get("audios"), local_start, local_end)
            segment_scope = (
                f"internal_segment_scope: part {part_index + 1}/{count}, original timeline "
                f"{local_start / 1000:g}—{local_end / 1000:g} seconds. Do not restart or summarize "
                "the full clip; render only this interval and continue the same take."
            )
            row["prompt"] = "\n\n".join(
                value for value in (
                    _scope_prompt_description(clip.get("prompt") or "", local_start, local_end),
                    segment_scope,
                ) if value
            )
            if part_index > 0:
                row["h3_motion_context_length"] = AUTO_CONTEXT_FRAMES
            segments.append((clip_index, part_index, count, row))
    return segments


def _av_streams(latent: dict, label: str) -> tuple[torch.Tensor, torch.Tensor]:
    if not isinstance(latent, dict):
        raise ValueError(f"Timeline Sequence Sampler: {label} is not a latent.")
    samples = latent.get("samples")
    if samples is None or not getattr(samples, "is_nested", False):
        raise ValueError(f"Timeline Sequence Sampler: {label} is not a MiniMax H3 AV latent.")
    streams = list(samples.unbind())
    if len(streams) < 2 or streams[0].ndim != 5 or streams[1].ndim != 4:
        raise ValueError(f"Timeline Sequence Sampler: {label} has an unexpected AV layout.")
    return streams[0], streams[1]


class CAP_H3SequenceContinuation:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "latent": ("LATENT",),
                "previous_latent": ("LATENT",),
                "sigmas": ("SIGMAS",),
                "context_frames": ("INT", {"default": 39, "min": 5, "max": 3600}),
                "drift_strength": ("FLOAT", {"default": 0.35, "min": 0.0, "max": 1.0, "step": 0.01}),
                "continue_audio": ("BOOLEAN", {"default": True}),
            },
        }

    RETURN_TYPES = ("MODEL", "LATENT")
    RETURN_NAMES = ("model", "latent")
    FUNCTION = "apply"
    CATEGORY = "Capricorncd/internal"

    def apply(self, model, latent, previous_latent, sigmas, context_frames, drift_strength, continue_audio):
        context_frames = _snap_h3_grid(context_frames)
        if context_frames <= 0:
            return (model, latent)

        target_video, target_audio = _av_streams(latent, "target latent")
        prior_video, prior_audio = _av_streams(previous_latent, "previous latent")
        if target_video.shape[0] != prior_video.shape[0] or target_video.shape[3:] != prior_video.shape[3:]:
            raise ValueError("Timeline Sequence Sampler: adjacent clips use different batch or video sizes.")

        video_tokens = min(video_latent_t(context_frames), target_video.shape[2], prior_video.shape[2])
        video = target_video.clone()
        video[:, :, :video_tokens] = prior_video[:, :, -video_tokens:].to(video)
        video_mask = video.new_ones((video.shape[0], 1, video.shape[2], video.shape[3], video.shape[4]))
        ramp = torch.linspace(float(drift_strength), 0.0, video_tokens, device=video.device, dtype=video.dtype)
        video_mask[:, :, :video_tokens] = ramp.view(1, 1, -1, 1, 1)

        audio = target_audio.clone()
        audio_mask = audio.new_ones((audio.shape[0], 1, audio.shape[2], audio.shape[3]))
        if continue_audio:
            if target_audio.shape[:3] != prior_audio.shape[:3]:
                raise ValueError("Timeline Sequence Sampler: adjacent clips use different audio latent layouts.")
            audio_tokens = min(
                round(context_frames * AUDIO_LATENT_FPS / H3_FPS),
                target_audio.shape[-1],
                prior_audio.shape[-1],
            )
            audio[..., :audio_tokens] = prior_audio[..., -audio_tokens:].to(audio)
            audio_mask[..., :audio_tokens] = 0

        out = latent.copy()
        out["samples"] = comfy.nested_tensor.NestedTensor((video, audio))
        out["noise_mask"] = comfy.nested_tensor.NestedTensor((video_mask, audio_mask))

        patched = model.clone()
        max_sigma = float(sigmas.max().item()) if len(sigmas) else 1.0
        max_sigma = max(max_sigma, 1e-8)

        def scheduled_mask(sigma, denoise_mask, extra_options=None):
            phase = (sigma / max_sigma).clamp(0.0, 1.0)
            while phase.ndim < denoise_mask.ndim:
                phase = phase.unsqueeze(-1)
            return torch.where(denoise_mask < 1.0, denoise_mask * phase, denoise_mask)

        patched.set_model_denoise_mask_function(scheduled_mask)
        return (patched, out)


class CAP_H3SequenceTrimVideo:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "trim_frames": ("INT", {"default": 0, "min": 0, "max": 3600}),
                "keep_frames": ("INT", {"default": 124, "min": 1, "max": 3600}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "trim"
    CATEGORY = "Capricorncd/internal"

    def trim(self, images, trim_frames, keep_frames):
        start = min(max(0, int(trim_frames)), int(images.shape[0]))
        end = min(int(images.shape[0]), start + max(1, int(keep_frames)))
        return (images[start:end].clone(),)


class CAP_H3SequenceAudioJoin:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "audio1": ("AUDIO",),
                "audio2": ("AUDIO",),
                "overlap_frames": ("INT", {"default": 0, "min": 0, "max": 3600}),
                "keep_frames": ("INT", {"default": 124, "min": 1, "max": 3600}),
            },
        }

    RETURN_TYPES = ("AUDIO",)
    FUNCTION = "join"
    CATEGORY = "Capricorncd/internal"

    def join(self, audio1, audio2, overlap_frames, keep_frames):
        rate1 = int(audio1["sample_rate"])
        rate2 = int(audio2["sample_rate"])
        if rate1 != rate2:
            raise ValueError("Timeline Sequence Sampler: decoded segment sample rates do not match.")
        left = audio1["waveform"]
        right = audio2["waveform"].to(left)
        if left.shape[0] != right.shape[0]:
            raise ValueError("Timeline Sequence Sampler: decoded audio batch sizes do not match.")
        if left.shape[1] != right.shape[1]:
            if left.shape[1] == 1:
                left = left.repeat(1, right.shape[1], 1)
            elif right.shape[1] == 1:
                right = right.repeat(1, left.shape[1], 1)
            else:
                raise ValueError("Timeline Sequence Sampler: decoded audio channel counts do not match.")

        wanted = round((max(0, int(overlap_frames)) + max(1, int(keep_frames))) * rate1 / H3_FPS)
        right = right[..., :wanted]

        overlap = min(
            round(max(0, int(overlap_frames)) * rate1 / H3_FPS),
            left.shape[-1],
            right.shape[-1],
        )
        if overlap <= 0:
            waveform = torch.cat((left, right), dim=-1)
        else:
            angle = torch.linspace(0.0, math.pi / 2, overlap, device=left.device, dtype=left.dtype)
            fade_out = torch.cos(angle).view(1, 1, -1)
            fade_in = torch.sin(angle).view(1, 1, -1)
            mixed = left[..., -overlap:] * fade_out + right[..., :overlap] * fade_in
            waveform = torch.cat((left[..., :-overlap], mixed, right[..., overlap:]), dim=-1)
        return ({"waveform": waveform, "sample_rate": rate1},)


class CAP_H3SequenceTrimAudio:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "audio": ("AUDIO",),
                "trim_frames": ("INT", {"default": 0, "min": 0, "max": 3600}),
                "keep_frames": ("INT", {"default": 124, "min": 1, "max": 3600}),
            },
        }

    RETURN_TYPES = ("AUDIO",)
    FUNCTION = "trim"
    CATEGORY = "Capricorncd/internal"

    def trim(self, audio, trim_frames, keep_frames):
        rate = int(audio["sample_rate"])
        waveform = audio["waveform"]
        start = min(waveform.shape[-1], round(max(0, int(trim_frames)) * rate / H3_FPS))
        end = min(waveform.shape[-1], start + round(max(1, int(keep_frames)) * rate / H3_FPS))
        return ({"waveform": waveform[..., start:end].clone(), "sample_rate": rate},)


class CAP_H3TimelineSequenceSampler:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
                "vae": ("VAE",),
                "audio_vae": ("VAE",),
                "data_json": ("STRING", {"default": "", "multiline": True}),
                "sampler": ("SAMPLER",),
                "sigmas": ("SIGMAS",),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFFFFFFFFFF}),
                "width": ("INT", {"default": 1344, "min": 32, "max": nodes.MAX_RESOLUTION, "step": 32}),
                "height": ("INT", {"default": 768, "min": 32, "max": nodes.MAX_RESOLUTION, "step": 32}),
                "ref_image_size": (["match", "max"], {"default": "match"}),
                "max_segment_seconds": ("FLOAT", {
                    "default": 10.0,
                    "min": 5.0,
                    "max": 15.0,
                    "step": 0.5,
                    "tooltip": "H3-only automatic split threshold. Longer Timeline clips are divided evenly.",
                }),
                "drift_strength": ("FLOAT", {"default": 0.35, "min": 0.0, "max": 1.0, "step": 0.01}),
                "continue_audio": ("BOOLEAN", {"default": True}),
            },
        }

    RETURN_TYPES = ("LATENT", "IMAGE", "AUDIO", "STRING")
    RETURN_NAMES = ("last_segment_latent (continuation only)", "images", "audio", "sequence_info")
    FUNCTION = "expand_sequence"
    CATEGORY = "Capricorncd"
    DESCRIPTION = (
        "Expands the runnable clips in Timeline Editor data_json into one finite MiniMax H3 sampling graph. "
        "Timeline clips follow authored time ranges when present; remaining long spans are divided by max_segment_seconds. "
        "Each later segment pins the previous sampled AV latent through H3 Motion Context, removes the "
        "pinned head, and joins decoded video and audio. The first segment ignores motion context. "
        "Connect images and audio directly to the video output node. Decoding last_segment_latent only "
        "produces the final internal segment."
    )

    @classmethod
    def IS_CHANGED(cls, model, clip, vae, audio_vae, data_json, sampler, sigmas, seed,
                   width, height, ref_image_size, max_segment_seconds, drift_strength, continue_audio):
        return (
            data_json, seed, width, height, ref_image_size,
            max_segment_seconds, drift_strength, continue_audio,
        )

    def expand_sequence(self, model, clip, vae, audio_vae, data_json, sampler, sigmas, seed,
                        width, height, ref_image_size, max_segment_seconds, drift_strength, continue_audio):
        data, clips, fps = _sequence_rows(data_json)
        max_segment_ms = max(1, round(float(max_segment_seconds) * 1000))
        segments = _split_long_clips(clips, max_segment_ms)
        graph = GraphBuilder()
        previous_latent = None
        merged_images = None
        merged_audio = None
        plan = []

        for index, (clip_index, part_index, part_count, row) in enumerate(segments):
            clip_json, keep_frames, context_frames, trim_frames = _clip_plan(data, row, fps, index == 0)
            encoded = graph.node(
                "CAP_MiniMaxH3ReferenceToVideo",
                clip=clip,
                vae=vae,
                audio_vae=audio_vae,
                width=width,
                height=height,
                ref_image_size=ref_image_size,
                data_json="",
                index=0,
                clip_json=clip_json,
            )
            segment_conditioning = encoded.out(0)
            segment_latent = encoded.out(1)
            trim_input = trim_frames
            if previous_latent is not None and context_frames > 0:
                continued = graph.node(
                    "MiniMaxH3MotionContext",
                    conditioning=segment_conditioning,
                    vae=vae,
                    latent=segment_latent,
                    context_length=str(context_frames),
                    audio_context_length=0,
                    context_latent=previous_latent,
                )
                segment_conditioning = continued.out(0)
                trim_input = continued.out(1)

            segment_seed = _segment_seed(seed, index)
            noise = graph.node("RandomNoise", noise_seed=segment_seed)
            guider = graph.node("BasicGuider", model=model, conditioning=segment_conditioning)
            sampled = graph.node(
                "SamplerCustomAdvanced",
                noise=noise.out(0),
                guider=guider.out(0),
                sampler=sampler,
                sigmas=sigmas,
                latent_image=segment_latent,
            )
            previous_latent = sampled.out(0)
            decoded = graph.node("VAEDecode", samples=previous_latent, vae=vae)
            decoded_audio = graph.node("VAEDecodeAudio", samples=previous_latent, vae=audio_vae)
            trimmed = graph.node(
                "CAP_H3SequenceTrimVideo",
                images=decoded.out(0),
                trim_frames=trim_input,
                keep_frames=keep_frames,
            )

            if merged_images is None:
                merged_images = trimmed.out(0)
                trimmed_audio = graph.node(
                    "CAP_H3SequenceTrimAudio",
                    audio=decoded_audio.out(0),
                    trim_frames=trim_input,
                    keep_frames=keep_frames,
                )
                merged_audio = trimmed_audio.out(0)
            else:
                image_batch = graph.node("ImageBatch", image1=merged_images, image2=trimmed.out(0))
                merged_images = image_batch.out(0)
                audio_join = graph.node(
                    "CAP_H3SequenceAudioJoin",
                    audio1=merged_audio,
                    audio2=decoded_audio.out(0),
                    overlap_frames=trim_input,
                    keep_frames=keep_frames,
                )
                merged_audio = audio_join.out(0)

            plan.append({
                "index": index,
                "clip_id": str(row.get("id") or ""),
                "source_clip_index": clip_index,
                "part": part_index + 1,
                "part_count": part_count,
                "frames": keep_frames,
                "context_frames": context_frames,
                "trim_frames": trim_frames,
                "seed": segment_seed,
            })

        info = json.dumps({"clips": plan, "fps": fps, "seed": seed}, ensure_ascii=False)
        return {
            "result": (previous_latent, merged_images, merged_audio, info),
            "expand": graph.finalize(),
        }


NODE_CLASS_MAPPINGS = {
    "CAP_H3TimelineSequenceSampler": CAP_H3TimelineSequenceSampler,
    "CAP_H3SequenceContinuation": CAP_H3SequenceContinuation,
    "CAP_H3SequenceTrimVideo": CAP_H3SequenceTrimVideo,
    "CAP_H3SequenceAudioJoin": CAP_H3SequenceAudioJoin,
    "CAP_H3SequenceTrimAudio": CAP_H3SequenceTrimAudio,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CAP_H3TimelineSequenceSampler": "Timeline Sequence Sampler",
    "CAP_H3SequenceContinuation": "H3 Sequence Continuation",
    "CAP_H3SequenceTrimVideo": "H3 Sequence Trim Video",
    "CAP_H3SequenceAudioJoin": "H3 Sequence Audio Join",
}
