from __future__ import annotations

import torch

import comfy.nested_tensor
import comfy.sample
import comfy.samplers
import comfy.utils
import latent_preview
import nodes
from comfy_extras.nodes_minimax_h3 import MiniMaxH3SigmaShift
from comfy_extras.nodes_model_advanced import ModelAttentionBackend


def _av_streams(samples):
    if not getattr(samples, "is_nested", False):
        raise ValueError("H3 fast audio refine expects a packed MiniMax H3 video+audio latent.")
    streams = samples.unbind()
    if len(streams) < 2 or streams[0].ndim != 5 or streams[1].ndim != 4:
        raise ValueError("H3 fast audio refine received an invalid MiniMax H3 latent layout.")
    return streams[0], streams[1]


def _noise_mask(video, audio):
    video_mask = torch.zeros((1, 1, video.shape[2], video.shape[3], video.shape[4]), dtype=torch.float32)
    audio_mask = torch.ones((1, 1, audio.shape[2], audio.shape[3]), dtype=torch.float32)
    return comfy.nested_tensor.NestedTensor((video_mask, audio_mask))


def _audio_only_noise(video, audio, seed, batch_index):
    audio_noise = comfy.sample.prepare_noise(audio, seed, batch_index)
    video_noise = torch.zeros(video.shape, dtype=video.dtype, device="cpu")
    return comfy.nested_tensor.NestedTensor((video_noise, audio_noise))


class CAP_H3FastAudioRefineSampler:
    CATEGORY = "Capricorncd"
    FUNCTION = "refine"
    RETURN_TYPES = ("LATENT",)
    RETURN_NAMES = ("latent",)
    DESCRIPTION = (
        "Fast MiniMax H3 audio repair with the video stream frozen. Uses fewer refinement steps, "
        "skips unused video noise generation, and can skip latent previews. Connect H3 Frozen Video "
        "Cache before this node for the largest speedup."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL", {"tooltip": "MiniMax H3 model; a Frozen Video Cache patched model is recommended."}),
                "positive": ("CONDITIONING",),
                "negative": ("CONDITIONING",),
                "latent": ("LATENT", {"tooltip": "A sampled MiniMax H3 packed video+audio latent."}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff, "control_after_generate": True}),
                "steps": ("INT", {
                    "default": 3, "min": 1, "max": 12,
                    "tooltip": "3 is the recommended fast setting. Use 4 for balanced quality or 6 to match the original node.",
                }),
                "cfg": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 100.0, "step": 0.1, "round": 0.01}),
                "sampler_name": (comfy.samplers.KSampler.SAMPLERS, {"default": "euler"}),
                "scheduler": (comfy.samplers.KSampler.SCHEDULERS, {"default": "simple"}),
                "audio_denoise": ("FLOAT", {
                    "default": 0.5, "min": 0.01, "max": 1.0, "step": 0.01,
                    "tooltip": "0.3-0.6 preserves the first-pass audio; 1.0 regenerates it.",
                }),
                "preview": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "Disabled is faster. Enable only when step-by-step latent previews are useful.",
                }),
            },
        }

    def refine(self, model, positive, negative, latent, seed, steps, cfg,
               sampler_name, scheduler, audio_denoise, preview=False):
        samples = latent["samples"]
        video, audio = _av_streams(samples)
        batch_index = latent.get("batch_index")
        noise = _audio_only_noise(video, audio, seed, batch_index)
        noise_mask = _noise_mask(video, audio)
        callback = latent_preview.prepare_callback(model, steps) if preview else None

        refined = comfy.sample.sample(
            model, noise, steps, cfg, sampler_name, scheduler,
            positive, negative, samples,
            denoise=audio_denoise,
            noise_mask=noise_mask,
            callback=callback,
            disable_pbar=not comfy.utils.PROGRESS_BAR_ENABLED,
            seed=seed,
        )

        out = latent.copy()
        out.pop("noise_mask", None)
        out["samples"] = refined
        return (out,)


class CAP_H3FastAudioRepair:
    CATEGORY = "Capricorncd"
    FUNCTION = "repair"
    RETURN_TYPES = ("LATENT",)
    RETURN_NAMES = ("latent",)
    DESCRIPTION = (
        "One-click accelerated MiniMax H3 audio repair. Internally uses Comfy Kitchen attention, "
        "the H3 video/audio sigma shifts, an int4 frozen-video cache, and a 3-step audio-only pass."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL", {"tooltip": "Connect the MiniMax H3 model after its LoRA/patch stack."}),
                "positive": ("CONDITIONING",),
                "latent": ("LATENT", {"tooltip": "The sampled MiniMax H3 packed video+audio latent."}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff, "control_after_generate": True}),
                "steps": ("INT", {
                    "default": 3, "min": 1, "max": 12,
                    "tooltip": "3 is fast, 4 is balanced, and 6 matches the original repair pass.",
                }),
                "audio_denoise": ("FLOAT", {
                    "default": 0.5, "min": 0.01, "max": 1.0, "step": 0.01,
                    "tooltip": "Repair strength. 0.3-0.6 preserves the original audio; 1.0 regenerates it.",
                }),
            },
        }

    @staticmethod
    def _patch_model(model):
        model = ModelAttentionBackend().patch(model, "comfy kitchen attention")[0]
        model = MiniMaxH3SigmaShift.execute(model, 12.0, 3.0)[0]

        cache_cls = nodes.NODE_CLASS_MAPPINGS.get("H3FrozenVideoCache")
        if cache_cls is None:
            raise RuntimeError(
                "H3 加速音频修复需要 ComfyUI-H3-AudioRefine（缺少 H3FrozenVideoCache 节点）。"
            )
        return cache_cls().patch(
            model,
            enabled=True,
            cache_contents="hidden",
            backend="auto",
            precision="int4",
            refresh_interval=0,
            verbose=False,
            allow_disk=False,
            vram_margin_gb=1.0,
        )[0]

    def repair(self, model, positive, latent, seed, steps=3, audio_denoise=0.5):
        model = self._patch_model(model)
        return CAP_H3FastAudioRefineSampler().refine(
            model=model,
            positive=positive,
            negative=positive,
            latent=latent,
            seed=seed,
            steps=steps,
            cfg=1.0,
            sampler_name="euler",
            scheduler="simple",
            audio_denoise=audio_denoise,
            preview=False,
        )


NODE_CLASS_MAPPINGS = {
    "CAP_H3FastAudioRefineSampler": CAP_H3FastAudioRefineSampler,
    "CAP_H3FastAudioRepair": CAP_H3FastAudioRepair,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CAP_H3FastAudioRefineSampler": "H3 加速音频修复",
    "CAP_H3FastAudioRepair": "音频修复（加速）",
}
