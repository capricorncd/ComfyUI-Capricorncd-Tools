from __future__ import annotations

import base64
import gc
import io
import json
import logging
import os
import re
import subprocess
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

import numpy as np
import torch
from PIL import Image

from .cap_i18n import get_last_known_lang, t as _t
from .timecode import AUDIO_EXTENSIONS, VIDEO_EXTENSIONS, resolve_media_path

# Worker subprocess must not import ComfyUI CUDA/AIMDO while the parent holds the GPU.
if os.environ.get("CAP_CLIP_PROMPT_VL_WORKER") == "1":
    model_management = None
else:
    import comfy.model_management as model_management

MAX_REF_IMAGES = 9
MAX_REF_VIDEOS = 3
MAX_VIDEO_FRAMES = 8
MAX_IMAGE_SIDE = 768
MAX_REF_AUDIOS = 3
MAX_AUDIO_BYTES = 20 * 1024 * 1024
SKILL_URL = "https://github.com/MiniMax-AI/MiniMax-H3/tree/main/skills"
OUTPUT_LANGUAGES = ("简体中文", "繁體中文", "English", "日本語")
DEFAULT_OUTPUT_LANGUAGE = "简体中文"
AGENT_PROVIDERS = ("openai", "gemini")
_AGENT_CONFIG_LOCK = threading.Lock()
_AGENT_ENDPOINTS = {
    "openai": "https://api.openai.com/v1/responses",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
}

_LANGUAGE_INSTRUCTIONS = {
    "简体中文": (
        "Write the entire prompt in Simplified Chinese (简体中文). "
        "Keep structural tags such as <Picture n>, <Video n>, <Audio n>, (S1), and "
        "<d>[Language]...</d> unchanged. Spoken dialogue inside <d> tags stays in the original spoken language."
    ),
    "繁體中文": (
        "Write the entire prompt in Traditional Chinese (繁體中文). "
        "Keep structural tags such as <Picture n>, <Video n>, <Audio n>, (S1), and "
        "<d>[Language]...</d> unchanged. Spoken dialogue inside <d> tags stays in the original spoken language."
    ),
    "English": (
        "Write the entire prompt in English. "
        "Keep structural tags such as <Picture n>, <Video n>, <Audio n>, (S1), and "
        "<d>[Language]...</d> unchanged. Spoken dialogue inside <d> tags stays in the original spoken language."
    ),
    "日本語": (
        "Write the entire prompt in Japanese (日本語). "
        "Keep structural tags such as <Picture n>, <Video n>, <Audio n>, (S1), and "
        "<d>[Language]...</d> unchanged. Spoken dialogue inside <d> tags stays in the original spoken language."
    ),
}
_LANGUAGE_ALIASES = {
    "zh": "简体中文",
    "zh-cn": "简体中文",
    "zh-hans": "简体中文",
    "chinese": "简体中文",
    "简体": "简体中文",
    "zh-tw": "繁體中文",
    "zh-hant": "繁體中文",
    "zh-hk": "繁體中文",
    "繁体": "繁體中文",
    "繁體": "繁體中文",
    "en": "English",
    "english": "English",
    "ja": "日本語",
    "jp": "日本語",
    "japanese": "日本語",
}

_CLIP_ROLE_LABELS = {
    "multi_ref": "多图参考",
    "first_last": "首尾帧",
    "t2v": "文生视频",
    "video_ref": "视频参考",
    "video_edit": "视频编辑",
    "other": "其他",
}

_NO_INVENT_REF_AUDIO = (
    "Do not invent audio prompt text for the tagged timeline audio. "
    "Do not describe the SOUND of wind, rain, guitar, lyrics, or fading music. "
    "overall_soundscape: N/A. non_diegetic_music: N/A unless Generate BGM is yes. "
    "detailed_description must describe only the visible performance synchronized to the existing audio."
)
_NO_INVENT_SPEECH = (
    "Do not invent spoken or sung lines. "
    "Do not write (S1), <d>..., 低语, 吟唱, 台词, or any dialogue the user did not supply. "
    "If the clip prompt has no dialogue, the shot has no speech."
)
_AUDIO_MODE_INSTRUCTIONS = {
    "none": (
        "Audio mode: do not use background / timeline audio. "
        "Do not add <Audio n> tags. Do not describe lip-sync or performing to existing music."
    ),
    "lipsync": (
        "Audio mode: digital-human lip-sync to the tagged timeline audio. "
        "Keep every <Audio n> tag. retention_analysis: fully_copy or partially_copy. "
        "In detailed_description, say characters lip-sync / sing to <Audio n>. "
        "Use (S1) <d> only for lyrics the user provided. Do not invent different words. "
        f"{_NO_INVENT_REF_AUDIO}"
    ),
    "perform": (
        "Audio mode: perform to <Audio n>. No lip-sync. No speech. "
        "Keep every <Audio n> tag. "
        "If a reference shows an instrument, the subject PLAYS it in time with <Audio n> "
        "(hands on strings, strumming, body moving with the beat). "
        "The visible performance synchronized to <Audio n> is the main action of the shot, not an optional detail. "
        "Write only camera, body, and instrument performance. Never call audio <Video n>. "
        f"{_NO_INVENT_SPEECH} "
        f"{_NO_INVENT_REF_AUDIO}"
    ),
    "auto": (
        "Audio mode: speech → lip-sync; music / song / instrumental → perform to the beat, no invented speech. "
        "Keep every <Audio n> tag. "
        "If a reference shows an instrument, play it in time with <Audio n>. "
        "Make the visible synchronization to <Audio n> explicit in detailed_description. Never call audio <Video n>. "
        "Do not invent (S1) / <d> lines for music. "
        f"{_NO_INVENT_SPEECH} "
        f"{_NO_INVENT_REF_AUDIO}"
    ),
}
_NO_TIMELINE_AUDIO = (
    "No overlapping background audio was found on the timeline for this clip. "
    "Do not add <Audio n> tags or invent lip-sync / music performance from audio that is not there."
)
_GENERATE_BGM = (
    "Generate BGM: yes. Write a non_diegetic_music section with newly generated background music "
    "(instrumentation, tempo, mood) that fits the scene. This is generated music, not copied from a tagged audio file."
)
_NO_GENERATE_BGM = (
    "Generate BGM: no. Do not invent or generate background music. "
    "Set non_diegetic_music to N/A. Do not narrate tagged timeline audio as music or ambience. "
    "Do not add generated BGM content anywhere in the prompt."
)
_LYRICS_RULE = (
    "Song lyrics guide mood, imagery, and action only. "
    "In perform or auto-music mode: do not quote, paraphrase, or invent lyrics as (S1) / <d> speech. "
    "In lipsync mode: write only the user-provided lyrics, never new lines. "
    "Do not invent a soundscape of the song."
)


def normalize_audio_mode(value: str) -> str:
    text = str(value or "").strip().lower()
    aliases = {
        "none": "none",
        "off": "none",
        "disable": "none",
        "lipsync": "lipsync",
        "lip-sync": "lipsync",
        "lip_sync": "lipsync",
        "perform": "perform",
        "performance": "perform",
        "auto": "auto",
        "other": "auto",
        "free": "auto",
    }
    return aliases.get(text, "none") if text else "none"

_H3_FORMAT = """Output only the MiniMax H3 prompt. No preface, no markdown fences.

Required sections in this order:

subject_definitions:
<summary of each tagged reference, or N/A if none>

summary: [reference generation] <one paragraph of the shot>

retention_analysis:
<Picture n>: fully_preserved | partially_preserved | attribute_transfer | weak_reference
<Video n>: same
<Audio n>: fully_copy | partially_copy | reference | weak_reference
(omit tags that do not exist)

detailed_description: [Shot 1] <style>. <action, camera, identity>. Add (S1) <d>[Language] words</d> only when the user supplied dialogue or audio mode is lipsync with provided lyrics. Otherwise write no speech and do not invent 台词. Never put spoken words in quotation marks. Later shots start with At MM:SS.mmm, the camera cuts to...

overall_soundscape: <ambience and physical sounds, or N/A>

non_diegetic_music: <instrumentation and tempo, or N/A>

Use one complete shot unless the user explicitly requests multiple shots. Never end with a placeholder such as "At MM:00.000, the camera cuts to...". Keep the whole prompt concise enough to finish.
"""

_H3_ROLE_HINTS = {
    "multi_ref": "Treat stills as identity / scene / prop references. Keep every <Picture n> tag and number. Do not invent extra tags.",
    "first_last": "The first still is the start frame and the last still is the end frame. Describe a continuous motion that begins on the first and lands on the last.",
    "t2v": "This is text-to-video. If no media is attached, invent the full prompt from the user's text. If stills exist they are style or subject hints, not locked start/end frames.",
    "video_ref": "Motion, camera, and identity come from the tagged videos. Keep every <Video n> tag. Stills are supporting references.",
    "video_edit": "Rewrite as an edit of the source video: keep identity and setting unless the user asks to change them. Keep every <Video n> tag.",
    "other": "Follow the user's clip prompt and tagged media. Keep existing <Picture n> / <Video n> / <Audio n> tags.",
}
_LTX_FORMAT = (
    "Output only one production-ready LTX video prompt as natural-language prose. "
    "Do not use MiniMax H3 section headings, retention_analysis, or XML-style media tags. "
    "Describe subject, action, environment, lighting, camera movement, timing, and the intended final state. "
    "Keep it concise and directly usable by LTX."
)
_REF_SHEET_RULE = (
    "Character sheets, turnarounds, four-view 人设图, orthographic lineups, and reference boards "
    "are identity sources only. Never write that the camera shows those layouts, multiple views "
    "of the same character, or a model sheet. Put appearance (face, hair, body, outfit, colors) "
    "in subject_definitions. detailed_description must be a real cinematic scene: camera, action, "
    "environment — not a description of the reference image."
)


def normalize_output_language(value: str) -> str:
    text = str(value or "").strip()
    if text in _LANGUAGE_INSTRUCTIONS:
        return text
    return _LANGUAGE_ALIASES.get(text.lower(), DEFAULT_OUTPUT_LANGUAGE)


def with_output_language(system_prompt: str, language: str) -> str:
    instruction = _LANGUAGE_INSTRUCTIONS[normalize_output_language(language)]
    base = str(system_prompt or "").strip()
    return f"{base}\n\n{instruction}".strip() if base else instruction


def with_prompt_skill(system_prompt: str, skill: str) -> str:
    skill = str(skill or "").strip()
    if not skill:
        return str(system_prompt or "").strip()
    return (
        f"{str(system_prompt or '').strip()}\n\n"
        "Selected Prompt Skill (authoritative):\n"
        "Follow this Skill in full. If its output structure conflicts with the generic format above, "
        "the selected Skill's structure takes precedence.\n"
        f"{skill}"
    ).strip()


def agent_system_prompt(agent: str, clip_role: str) -> str:
    agent = str(agent or "MiniMaxH3").strip() or "MiniMaxH3"
    role = str(clip_role or "multi_ref").strip() or "multi_ref"
    label = _CLIP_ROLE_LABELS.get(role, role)
    if agent == "LTX":
        role_hint = {
            "first_last": (
                "The first attached image is the start frame and the second is the end frame. "
                "Describe one continuous transition that begins exactly at the first frame and lands naturally on the last frame."
            ),
            "multi_ref": "Use the attached images as subject, scene, and style references without describing a reference-board layout.",
            "video_ref": "Use the source video for motion and camera guidance while describing the desired generated shot.",
            "video_edit": "Describe only the requested edit while preserving unmentioned identity, motion, and environment details.",
            "t2v": "Write a complete text-to-video shot from the user's request.",
            "other": "Follow the user's requested video-generation mode.",
        }.get(role, "Follow the user's requested video-generation mode.")
        return f"You are an LTX video prompt writer. Clip type: {label} ({role}). {role_hint}\n\n{_LTX_FORMAT}"
    if agent != "MiniMaxH3":
        return (
            f"You write video-generation prompts for {agent}. "
            f"Clip type: {label} ({role}). "
            "Look at any attached images/videos. If the user left the clip prompt empty, "
            "invent a complete prompt from the media. Output only the prompt."
        )
    hint = _H3_ROLE_HINTS.get(role, _H3_ROLE_HINTS["other"])
    return (
        "You are a MiniMax H3 prompt writer. Look at the attached reference media "
        "and the user's notes, then write one MiniMax H3 reference-to-video prompt.\n"
        f"Clip type: {label} ({role}). {hint}\n"
        f"{_REF_SHEET_RULE}\n"
        "Keep the user's subjects, actions, language, and dialogue. "
        "Do not invent spoken lines, whispers, or sung lyrics. "
        "If the clip prompt is empty, infer subjects, action, and camera from the media — not dialogue.\n"
        "Keep every <Picture n>, <Video n>, and <Audio n> tag and number. Do not add new tags.\n\n"
        f"{_H3_FORMAT}"
    )


def list_vl_models() -> list[str]:
    try:
        import folder_paths
    except Exception:
        return []
    names = []
    seen = set()
    root = Path(folder_paths.models_dir)
    for sub in ("prompt_generator", "LLM", "llm"):
        folder = root / sub
        if not folder.is_dir():
            continue
        for child in sorted(folder.iterdir()):
            if not child.is_dir() or not (child / "config.json").is_file():
                continue
            if child.name in seen:
                continue
            seen.add(child.name)
            names.append(child.name)
    return names


def _agent_config_path() -> Path:
    import folder_paths
    return Path(folder_paths.get_user_directory()) / "capricorncd" / "timeline_agents.json"


def _read_agent_configs() -> list[dict]:
    path = _agent_config_path()
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logging.warning("[CAP] Failed to read timeline agents: %s", exc)
        return []
    return [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []


def public_agent_configs(enabled_only: bool = False) -> list[dict]:
    rows = []
    with _AGENT_CONFIG_LOCK:
        configs = _read_agent_configs()
    for row in configs:
        enabled = row.get("enabled") is not False
        if enabled_only and (not enabled or not row.get("api_key")):
            continue
        rows.append({
            "id": str(row.get("id") or ""),
            "label": str(row.get("label") or ""),
            "provider": str(row.get("provider") or ""),
            "model": str(row.get("model") or ""),
            "enabled": enabled,
            "has_key": bool(row.get("api_key")),
        })
    return rows


def save_agent_config(payload: dict) -> dict:
    provider = str(payload.get("provider") or "").strip().lower()
    label = str(payload.get("label") or "").strip()
    model = str(payload.get("model") or "").strip()
    api_key = str(payload.get("api_key") or "").strip()
    agent_id = str(payload.get("id") or "").strip()
    if provider not in AGENT_PROVIDERS:
        raise ValueError(_t("provider_must_be_openai_gemini", get_last_known_lang()))
    if not label or len(label) > 80:
        raise ValueError(_t("agent_name_required", get_last_known_lang()))
    if not model or len(model) > 120:
        raise ValueError(_t("model_name_required", get_last_known_lang()))
    with _AGENT_CONFIG_LOCK:
        configs = _read_agent_configs()
        existing = next((row for row in configs if str(row.get("id")) == agent_id), None)
        if existing is None:
            if not api_key:
                raise ValueError(_t("api_key_required_new_agent", get_last_known_lang()))
            existing = {"id": uuid.uuid4().hex}
            configs.append(existing)
        elif not api_key:
            api_key = str(existing.get("api_key") or "")
        existing.update({
            "label": label,
            "provider": provider,
            "model": model,
            "api_key": api_key,
            "enabled": payload.get("enabled") is not False,
        })
        path = _agent_config_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_suffix(".tmp")
        temp.write_text(json.dumps(configs, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temp, path)
    return next(row for row in public_agent_configs() if row["id"] == existing["id"])


def delete_agent_config(agent_id: str) -> bool:
    agent_id = str(agent_id or "").strip()
    with _AGENT_CONFIG_LOCK:
        configs = _read_agent_configs()
        kept = [row for row in configs if str(row.get("id")) != agent_id]
        if len(kept) == len(configs):
            return False
        path = _agent_config_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_suffix(".tmp")
        temp.write_text(json.dumps(kept, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temp, path)
    return True


def resolve_vl_model_path(model_name: str) -> str:
    import folder_paths
    name = str(model_name or "").strip()
    if not name:
        raise ValueError(_t("no_multimodal_model_selected", get_last_known_lang()))
    if os.path.isdir(name) and os.path.isfile(os.path.join(name, "config.json")):
        return os.path.normpath(name)
    root = Path(folder_paths.models_dir)
    for sub in ("prompt_generator", "LLM", "llm"):
        candidate = root / sub / name
        if (candidate / "config.json").is_file():
            return str(candidate)
    raise ValueError(_t("model_not_found", get_last_known_lang(), name=name))


def _to_pil(image, max_side: int = MAX_IMAGE_SIDE) -> Image.Image:
    if isinstance(image, Image.Image):
        img = image.convert("RGB")
    elif torch.is_tensor(image):
        tensor = image.detach().cpu()
        if tensor.ndim == 4:
            tensor = tensor[0]
        arr = (tensor.numpy() * 255).clip(0, 255).astype(np.uint8)
        img = Image.fromarray(arr)
    elif isinstance(image, np.ndarray):
        arr = image
        if arr.dtype != np.uint8:
            arr = (np.clip(arr, 0.0, 1.0) * 255).astype(np.uint8)
        img = Image.fromarray(arr)
    else:
        raise TypeError(f"Unsupported image type: {type(image)}")
    if max_side and max(img.size) > max_side:
        resample = getattr(Image, "Resampling", Image).LANCZOS
        img.thumbnail((max_side, max_side), resample)
    return img.convert("RGB")


def _images_from_tensor(images) -> list[Image.Image]:
    if images is None:
        return []
    if torch.is_tensor(images):
        if images.ndim == 3:
            images = images.unsqueeze(0)
        return [_to_pil(frame) for frame in images[:MAX_REF_IMAGES]]
    if isinstance(images, (list, tuple)):
        out = []
        for item in images:
            out.extend(_images_from_tensor(item))
            if len(out) >= MAX_REF_IMAGES:
                break
        return out[:MAX_REF_IMAGES]
    return [_to_pil(images)]


def _load_still(path: str) -> Image.Image | None:
    if not path or not os.path.isfile(path):
        return None
    try:
        with Image.open(path) as im:
            return _to_pil(im)
    except Exception:
        return None


def _load_video_frames(path: str, max_frames: int = MAX_VIDEO_FRAMES) -> list[Image.Image]:
    if not path or not os.path.isfile(path):
        return []
    try:
        from comfy_api.latest._input_impl.video_types import VideoFromFile
        video = VideoFromFile(path, start_time=0, duration=15.0)
        components = video.get_components()
        frames = components.images
    except Exception:
        return []
    if frames is None or not torch.is_tensor(frames) or frames.ndim != 4 or frames.shape[0] < 1:
        return []
    n = int(frames.shape[0])
    count = min(max_frames, n)
    if count <= 1:
        idxs = [0]
    else:
        idxs = [min(n - 1, int(round(i * (n - 1) / (count - 1)))) for i in range(count)]
    out = [_to_pil(frames[i]) for i in idxs]
    if len(out) == 1:
        out.append(out[0])
    return out


def _clean_output(text: str) -> str:
    out = str(text or "").strip()
    out = re.sub(r"<think>.*?</think>", "", out, flags=re.DOTALL)
    if "</think>" in out:
        out = out.rsplit("</think>", 1)[-1]
    out = re.sub(r"^```[a-zA-Z]*\n?", "", out.strip())
    out = re.sub(r"\n?```$", "", out).strip()
    return out


class ClipPromptCancelled(Exception):
    pass


class ClipPromptVLEngine:
    def __init__(self):
        self.model = None
        self.processor = None
        self.tokenizer = None
        self.model_name = None
        self.device = None
        self._lock = threading.Lock()
        self._cancel = threading.Event()

    def request_cancel(self):
        self._cancel.set()

    def reset_cancel(self):
        self._cancel.clear()

    def clear(self):
        with self._lock:
            self._clear_locked()

    def _clear_locked(self):
        if self.model is None and self.processor is None and self.tokenizer is None:
            return
        model = self.model
        self.model = self.processor = self.tokenizer = None
        self.model_name = None
        self.device = None
        if model is not None:
            del model
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        if model_management is not None:
            model_management.soft_empty_cache(True)
        logging.info("[CAP] Unloaded Qwen3-VL")

    def load(self, model_name: str):
        path = resolve_vl_model_path(model_name)
        device = "cuda" if torch.cuda.is_available() else "cpu"
        if self.model is not None and self.model_name == path:
            self.device = device
            self.model.to(device)
            return
        self._clear_locked()
        try:
            from transformers import AutoModelForImageTextToText, AutoProcessor, AutoTokenizer
        except ImportError as exc:
            raise RuntimeError(_t("transformers_required", get_last_known_lang())) from exc
        dtype = torch.float16 if device == "cuda" else torch.float32
        self.model = AutoModelForImageTextToText.from_pretrained(
            path, dtype=dtype, trust_remote_code=True,
        ).to(device).eval()
        self.processor = AutoProcessor.from_pretrained(path, trust_remote_code=True)
        self.tokenizer = AutoTokenizer.from_pretrained(path, trust_remote_code=True)
        self.model_name = path
        self.device = device

    def generate(
        self,
        *,
        model_name: str,
        system_prompt: str,
        user_prompt: str,
        skill: str = "",
        images: list[Image.Image] | None = None,
        videos: list[list[Image.Image]] | None = None,
        max_new_tokens: int = 2048,
        keep_loaded: bool = True,
        reset_cancel: bool = True,
    ) -> str:
        with self._lock:
            if reset_cancel:
                self._cancel.clear()
            try:
                return self._generate_locked(
                    model_name=model_name,
                    system_prompt=system_prompt,
                    user_prompt=user_prompt,
                    skill=skill,
                    images=images,
                    videos=videos,
                    max_new_tokens=max_new_tokens,
                    keep_loaded=keep_loaded,
                )
            except Exception:
                if not keep_loaded:
                    self._clear_locked()
                raise

    def _generate_locked(
        self,
        *,
        model_name: str,
        system_prompt: str,
        user_prompt: str,
        skill: str = "",
        images: list[Image.Image] | None = None,
        videos: list[list[Image.Image]] | None = None,
        max_new_tokens: int = 2048,
        keep_loaded: bool = True,
    ) -> str:
        if self._cancel.is_set():
            raise ClipPromptCancelled()
        self.load(model_name)
        if self._cancel.is_set():
            raise ClipPromptCancelled()
        system_text = with_prompt_skill(system_prompt, skill)
        user_text = str(user_prompt or "").strip() or "Infer a complete video prompt from the attached media."
        conversation = []
        if system_text:
            conversation.append({
                "role": "system",
                "content": [{"type": "text", "text": system_text}],
            })
        content = []
        for image in (images or [])[:MAX_REF_IMAGES]:
            content.append({"type": "image", "image": image})
        for frames in (videos or [])[:MAX_REF_VIDEOS]:
            if not frames:
                continue
            sampled = list(frames[:MAX_VIDEO_FRAMES])
            if len(sampled) == 1:
                sampled.append(sampled[0])
            content.append({"type": "video", "video": sampled})
        content.append({"type": "text", "text": user_text})
        conversation.append({"role": "user", "content": content})
        text_prompt = self.processor.apply_chat_template(
            conversation, tokenize=False, add_generation_prompt=True,
        )
        pil_images = [item["image"] for item in content if item["type"] == "image"]
        video_frames = [
            frame
            for item in content if item["type"] == "video"
            for frame in item["video"]
        ]
        inputs = self.processor(
            text=text_prompt,
            images=pil_images or None,
            videos=[video_frames] if video_frames else None,
            return_tensors="pt",
        )
        model_inputs = {
            key: value.to(self.device)
            for key, value in inputs.items()
            if torch.is_tensor(value)
        }
        stop_tokens = [self.tokenizer.eos_token_id]
        gen_kwargs = {
            "max_new_tokens": max(64, int(max_new_tokens or 2048)),
            "do_sample": True,
            "temperature": 0.7,
            "top_p": 0.9,
            "eos_token_id": stop_tokens,
            "pad_token_id": self.tokenizer.pad_token_id,
            "stopping_criteria": _cancel_stopping_criteria(self._cancel),
        }
        with torch.inference_mode():
            outputs = self.model.generate(**model_inputs, **gen_kwargs, use_cache=True)
        if self._cancel.is_set():
            del outputs, model_inputs
            self._clear_locked()
            raise ClipPromptCancelled()
        input_len = model_inputs["input_ids"].shape[1]
        text = self.tokenizer.decode(outputs[0, input_len:], skip_special_tokens=True)
        del outputs, model_inputs
        if not keep_loaded:
            self._clear_locked()
        return _clean_output(text)


_ENGINE = ClipPromptVLEngine()
_WORKER_LOCK = threading.Lock()
_WORKER_PROCESS = None
_WORKER_JOB = 0
_WORKER_CANCELLED = threading.Event()

_WORKER_CODE = r"""
import importlib.util
import json
import os
import pathlib
import sys
import types

def _emit(result):
    sys.stdout.write("__CAP_CLIP_PROMPT_RESULT__" + json.dumps(result, ensure_ascii=False) + "\n")
    sys.stdout.flush()
    os._exit(0)

try:
    module_path = pathlib.Path(os.environ["CAP_CLIP_PROMPT_VL_MODULE"])
    package_name = "_cap_clip_prompt_vl_worker"
    package = types.ModuleType(package_name)
    package.__path__ = [str(module_path.parent)]
    sys.modules[package_name] = package
    spec = importlib.util.spec_from_file_location(f"{package_name}.cap_clip_prompt_vl", module_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    payload = json.loads(sys.stdin.read())
    try:
        result = {"prompt": module.generate_from_payload(payload)}
    except BaseException as error:
        result = {"error": f"{type(error).__name__}: {error}"}
    _emit(result)
except BaseException as error:
    try:
        _emit({"error": f"{type(error).__name__}: {error}"})
    except Exception:
        os._exit(1)
"""


def _cancel_stopping_criteria(flag: threading.Event):
    from transformers import StoppingCriteria, StoppingCriteriaList

    class CancelStop(StoppingCriteria):
        def __call__(self, input_ids, scores, **kwargs):
            return flag.is_set()

    return StoppingCriteriaList([CancelStop()])


def clear_clip_prompt_vl() -> None:
    _ENGINE.clear()


_RESULT_MARKER = "__CAP_CLIP_PROMPT_RESULT__"


def _stop_process(process):
    if process is None:
        return
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                pass
    for stream in (process.stdin, process.stdout, process.stderr):
        if stream is None:
            continue
        try:
            stream.close()
        except OSError:
            pass


def _parse_worker_result(stdout: str):
    if _RESULT_MARKER not in (stdout or ""):
        return None
    raw = stdout.rsplit(_RESULT_MARKER, 1)[-1].strip()
    if not raw:
        return None
    line = raw.split("\n", 1)[0].strip()
    for text in (line, raw):
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict):
            return data
    return None


def begin_clip_prompt_job() -> int:
    global _WORKER_JOB
    with _WORKER_LOCK:
        _WORKER_JOB += 1
        return _WORKER_JOB


def request_cancel_clip_prompt_vl(job: int | None = None) -> None:
    _ENGINE.request_cancel()
    with _WORKER_LOCK:
        if job is not None and job != _WORKER_JOB:
            return
        _WORKER_CANCELLED.set()
        process = _WORKER_PROCESS
    _stop_process(process)


def _generate_from_payload_isolated(payload: dict) -> str:
    global _WORKER_PROCESS, _WORKER_JOB
    with _WORKER_LOCK:
        if _WORKER_JOB == 0:
            _WORKER_JOB += 1
        job = _WORKER_JOB
        _WORKER_CANCELLED.clear()
        old = _WORKER_PROCESS
        _WORKER_PROCESS = None
    _stop_process(old)
    env = os.environ.copy()
    env["CAP_CLIP_PROMPT_VL_MODULE"] = str(Path(__file__).resolve())
    env["CAP_CLIP_PROMPT_VL_WORKER"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    creationflags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    process = subprocess.Popen(
        [sys.executable, "-s", "-c", _WORKER_CODE],
        cwd=str(Path(__file__).resolve().parents[2]),
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
        creationflags=creationflags,
    )
    with _WORKER_LOCK:
        _WORKER_PROCESS = process
    logging.info("[CAP] Qwen3-VL worker started pid=%s", process.pid)
    stdout_chunks = []
    stderr_chunks = []
    done = threading.Event()

    def _read_stdout():
        try:
            while True:
                chunk = process.stdout.read(4096)
                if not chunk:
                    break
                stdout_chunks.append(chunk)
                if _parse_worker_result("".join(stdout_chunks)) is not None:
                    break
        except OSError:
            pass
        finally:
            done.set()

    def _read_stderr():
        try:
            while True:
                chunk = process.stderr.read(4096)
                if not chunk:
                    break
                stderr_chunks.append(chunk)
                if len(stderr_chunks) > 80:
                    del stderr_chunks[:-40]
        except OSError:
            pass

    try:
        process.stdin.write(json.dumps(payload, ensure_ascii=False))
        process.stdin.close()
        threading.Thread(target=_read_stdout, daemon=True).start()
        threading.Thread(target=_read_stderr, daemon=True).start()
        while not done.wait(0.15):
            if _WORKER_CANCELLED.is_set():
                break
            if process.poll() is not None:
                done.wait(1.0)
                break
    except OSError:
        pass
    result = _parse_worker_result("".join(stdout_chunks))
    _stop_process(process)
    with _WORKER_LOCK:
        if _WORKER_PROCESS is process:
            _WORKER_PROCESS = None
    if _WORKER_CANCELLED.is_set() or job != _WORKER_JOB:
        raise ClipPromptCancelled()
    stderr = "".join(stderr_chunks).strip()
    if result is None:
        detail = stderr.rsplit("\n", 1)[-1] if stderr else f"exit code {process.returncode}"
        raise RuntimeError(_t("qwen_subprocess_failed", get_last_known_lang(), detail=detail))
    if result.get("error"):
        raise RuntimeError(result["error"])
    logging.info("[CAP] Qwen3-VL worker finished pid=%s", process.pid)
    return str(result.get("prompt") or "").strip()


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


def _file_label(index: int, kind: str, row: dict) -> str:
    name = str((row or {}).get("name") or (row or {}).get("file") or "").replace("\\", "/").rsplit("/", 1)[-1]
    if kind == "video":
        tag = f"<Video {index}>"
    elif kind == "audio":
        tag = f"<Audio {index}>"
    else:
        tag = f"<Picture {index}>"
    media_type = str((row or {}).get("media_type") or "").strip()
    tags = (row or {}).get("tags") if isinstance((row or {}).get("tags"), list) else []
    tags = [str(tag).strip() for tag in tags if str(tag).strip()]
    meta = ", ".join(part for part in [media_type, *tags] if part)
    include_description = (row or {}).get("include_description") is not False
    include_prompt = (row or {}).get("include_prompt") is not False
    description = str((row or {}).get("setting_description") or "").strip() if include_description else ""
    prompts = []
    if include_prompt:
        for key in ("prompt", "generation_prompt"):
            text = str((row or {}).get(key) or "").strip()
            if text and text not in prompts:
                prompts.append(text)
    bits = [tag]
    if name:
        bits.append(name)
    if meta:
        bits.append(meta)
    overlap = (row or {}).get("timeline_overlap_sec")
    if isinstance(overlap, (list, tuple)) and len(overlap) == 2:
        try:
            bits.append(f"timeline overlap {float(overlap[0]):.3f}s-{float(overlap[1]):.3f}s")
        except (TypeError, ValueError):
            pass
    line = ": ".join(bits) if len(bits) > 1 else tag
    details = []
    if description:
        details.append(f"Resource description: {description}")
    if prompts:
        details.append(f"Resource prompt: {' '.join(prompts)}")
    return "\n".join((line, *details))


def build_user_prompt(payload: dict) -> str:
    role = str(payload.get("clip_role") or "multi_ref")
    agent = str(payload.get("agent") or "MiniMaxH3")
    duration = payload.get("duration_sec")
    lines = [
        f"Agent: {agent}",
        f"Clip type: {_CLIP_ROLE_LABELS.get(role, role)} ({role})",
    ]
    try:
        dur = float(duration)
        if dur > 0:
            lines.append(f"Duration: {dur:.3f}s")
    except (TypeError, ValueError):
        pass
    files = payload.get("files") if isinstance(payload.get("files"), list) else []
    media_lines = []
    picture_n = video_n = audio_n = audio_data_n = 0
    for row in files:
        if not isinstance(row, dict):
            continue
        kind = str(row.get("kind") or "image").lower()
        if row.get("use_prompt") is False and not row.get("file"):
            continue
        if kind == "video":
            video_n += 1
            index = video_n
        elif kind == "audio":
            audio_n += 1
            index = audio_n
            if row.get("include_data") is not False:
                audio_data_n += 1
        else:
            picture_n += 1
            index = picture_n
        media_lines.append(_file_label(index, kind if kind in ("image", "video", "audio") else "image", row))
    if media_lines:
        lines.append("Reference media:")
        lines.extend(media_lines)
        allowed_tags = [
            *(f"<Picture {index}>" for index in range(1, picture_n + 1)),
            *(f"<Video {index}>" for index in range(1, video_n + 1)),
            *(f"<Audio {index}>" for index in range(1, audio_n + 1)),
        ]
        lines.append(f"Exact allowed media tags: {', '.join(allowed_tags)}.")
        lines.append(
            "Use each listed tag for its declared media type only. Do not create, rename, substitute, "
            "or renumber tags. In particular, pictures are never <Video n> and audio is never <Video n>."
        )
        if picture_n:
            lines.append(_REF_SHEET_RULE)
    clip_prompt = str(payload.get("clip_prompt") or "").strip()
    global_prompt = str(payload.get("global_prompt") or "").strip()
    lyrics = str(payload.get("lyrics") or payload.get("song_lyrics") or "").strip()
    if global_prompt:
        lines.append("Global prompt:")
        lines.append(global_prompt)
    if lyrics:
        lines.append("Song lyrics:")
        lines.append(lyrics)
        lines.append(_LYRICS_RULE)
    if clip_prompt:
        lines.append("Clip prompt:")
        lines.append(clip_prompt)
        if lyrics:
            lines.append(
                "Combine the user's clip prompt with the song lyrics for mood and action. "
                "The shot must stay related to the music. Do not turn lyrics into invented 台词."
            )
    elif lyrics:
        lines.append(
            "The user did not write a clip prompt. Write the shot from the reference images; "
            "use the lyrics only for mood and action, not as spoken dialogue. "
            "Do not describe character sheets or turnarounds as on-screen content."
        )
    else:
        lines.append(
            "The user did not write a clip prompt. Infer a complete cinematic scene from the "
            "reference media. Do not describe character sheets or turnarounds as on-screen content."
        )
    extra = str(payload.get("user_prompt") or "").strip()
    if extra:
        lines.append(extra)
    audio_mode = normalize_audio_mode(payload.get("audio_mode") or payload.get("ai_audio_mode") or "")
    has_audio = audio_data_n > 0 and audio_mode != "none"
    if audio_mode == "none" or not has_audio:
        lines.append(_AUDIO_MODE_INSTRUCTIONS["none"] if audio_mode == "none" else _NO_TIMELINE_AUDIO)
    else:
        lines.append(_AUDIO_MODE_INSTRUCTIONS.get(audio_mode, _AUDIO_MODE_INSTRUCTIONS["auto"]))
    generate_bgm = payload.get("generate_bgm")
    if generate_bgm is None:
        generate_bgm = audio_mode == "none" or not has_audio
    else:
        generate_bgm = generate_bgm is not False
    lines.append(_GENERATE_BGM if generate_bgm else _NO_GENERATE_BGM)
    return "\n".join(lines)


def media_from_payload(payload: dict) -> tuple[list[Image.Image], list[list[Image.Image]]]:
    images = []
    videos = []
    files = payload.get("files") if isinstance(payload.get("files"), list) else []
    for row in files:
        if not isinstance(row, dict):
            continue
        if row.get("include_data") is False:
            continue
        path = resolve_media_path(
            str(row.get("file") or ""),
            location=str(row.get("location") or "input"),
        )
        kind = _kind_of(row, path)
        if kind == "video":
            if len(videos) >= MAX_REF_VIDEOS:
                continue
            frames = _load_video_frames(path)
            if frames:
                videos.append(frames)
            continue
        if kind != "image" or len(images) >= MAX_REF_IMAGES:
            continue
        still = _load_still(path)
        if still is not None:
            images.append(still)
    return images, videos


def audio_from_payload(payload: dict) -> list[tuple[str, str, str]]:
    result = []
    files = payload.get("files") if isinstance(payload.get("files"), list) else []
    for row in files:
        if not isinstance(row, dict) or row.get("include_data") is False:
            continue
        path = resolve_media_path(
            str(row.get("file") or ""),
            location=str(row.get("location") or "input"),
        )
        if _kind_of(row, path) != "audio":
            continue
        ext = os.path.splitext(path)[1].lower()
        if ext not in {".mp3", ".wav"}:
            raise ValueError(f"Agent audio input supports MP3 or WAV files, got: {ext or 'unknown'}")
        size = os.path.getsize(path)
        if size > MAX_AUDIO_BYTES:
            raise ValueError(f"Agent audio input exceeds {MAX_AUDIO_BYTES // (1024 * 1024)} MB: {os.path.basename(path)}")
        mime = "audio/mpeg" if ext == ".mp3" else "audio/wav"
        data = base64.b64encode(Path(path).read_bytes()).decode("ascii")
        result.append((mime, ext[1:], data))
        if len(result) >= MAX_REF_AUDIOS:
            break
    return result


def _agent_config(agent_id: str) -> dict:
    with _AGENT_CONFIG_LOCK:
        config = next((row for row in _read_agent_configs() if str(row.get("id")) == agent_id), None)
    if config is None:
        raise ValueError(_t("agent_not_found_reconfigure", get_last_known_lang()))
    if config.get("enabled") is False:
        raise ValueError(_t("agent_disabled", get_last_known_lang()))
    if not str(config.get("api_key") or "").strip():
        raise ValueError(_t("agent_missing_api_key", get_last_known_lang()))
    return config


def _image_data(image: Image.Image) -> tuple[str, str]:
    output = io.BytesIO()
    _to_pil(image).save(output, format="JPEG", quality=90)
    return "image/jpeg", base64.b64encode(output.getvalue()).decode("ascii")


def _remote_images(images: list[Image.Image], videos: list[list[Image.Image]]) -> list[tuple[str, str]]:
    media = [*images]
    for frames in videos:
        media.extend(frames)
    return [_image_data(image) for image in media[:24]]


def _post_agent_json(url: str, api_key: str, payload: dict, provider: str) -> dict:
    headers = {"Content-Type": "application/json"}
    if provider == "openai":
        headers["Authorization"] = f"Bearer {api_key}"
    else:
        headers["x-goog-api-key"] = api_key
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:1000]
        try:
            body = json.loads(detail)
            detail = str(body.get("error", {}).get("message") or body.get("error") or detail)
        except (json.JSONDecodeError, AttributeError):
            pass
        raise RuntimeError(_t("provider_api_request_failed", get_last_known_lang(), provider=provider, code=exc.code, detail=detail)) from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(_t("provider_api_connection_failed", get_last_known_lang(), provider=provider, reason=exc.reason)) from exc


def _generate_with_agent(payload: dict, agent_id: str) -> str:
    config = _agent_config(agent_id)
    provider = str(config.get("provider") or "")
    system_prompt = str(payload.get("system_prompt") or "").strip()
    if not system_prompt:
        system_prompt = agent_system_prompt(
            str(payload.get("agent") or "MiniMaxH3"),
            str(payload.get("clip_role") or "multi_ref"),
        )
    system_prompt = with_output_language(
        system_prompt,
        payload.get("output_language") or payload.get("language") or DEFAULT_OUTPUT_LANGUAGE,
    )
    system_prompt = with_prompt_skill(system_prompt, payload.get("skill") or "")
    images, videos = media_from_payload(payload)
    encoded_images = _remote_images(images, videos)
    encoded_audio = audio_from_payload(payload)
    user_prompt = build_user_prompt(payload)
    max_tokens = min(8192, max(256, int(payload.get("max_new_tokens") or 2048)))
    if provider == "openai":
        content = [
            {"type": "input_image", "image_url": f"data:{mime};base64,{data}"}
            for mime, data in encoded_images
        ]
        content.extend({
            "type": "input_audio",
            "input_audio": {"data": data, "format": fmt},
        } for _mime, fmt, data in encoded_audio)
        content.append({"type": "input_text", "text": user_prompt})
        body = {
            "model": str(config["model"]),
            "instructions": system_prompt,
            "input": [{"role": "user", "content": content}],
            "max_output_tokens": max_tokens,
            "store": False,
        }
        result = _post_agent_json(_AGENT_ENDPOINTS[provider], str(config["api_key"]), body, provider)
        text = str(result.get("output_text") or "").strip()
        if not text:
            parts = []
            for output in result.get("output", []):
                for part in output.get("content", []):
                    if part.get("type") == "output_text" and part.get("text"):
                        parts.append(str(part["text"]))
            text = "\n".join(parts).strip()
    elif provider == "gemini":
        parts = [
            {"inlineData": {"mimeType": mime, "data": data}}
            for mime, data in encoded_images
        ]
        parts.extend({"inlineData": {"mimeType": mime, "data": data}} for mime, _fmt, data in encoded_audio)
        parts.append({"text": user_prompt})
        body = {
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.7, "topP": 0.9},
        }
        model = urllib.parse.quote(str(config["model"]), safe="")
        url = _AGENT_ENDPOINTS[provider].format(model=model)
        result = _post_agent_json(url, str(config["api_key"]), body, provider)
        candidates = result.get("candidates") or []
        response_parts = candidates[0].get("content", {}).get("parts", []) if candidates else []
        text = "\n".join(str(part.get("text") or "") for part in response_parts).strip()
    else:
        raise ValueError(_t("unsupported_agent_provider", get_last_known_lang()))
    if not text:
        raise RuntimeError(_t("provider_api_no_text", get_last_known_lang(), provider=provider))
    return text


def generate_from_payload(payload: dict) -> str:
    if not isinstance(payload, dict):
        raise ValueError(_t("invalid_payload", get_last_known_lang()))
    agent_id = str(payload.get("agent_id") or "").strip()
    if agent_id:
        return _generate_with_agent(payload, agent_id)
    if os.environ.get("CAP_CLIP_PROMPT_VL_WORKER") != "1":
        return _generate_from_payload_isolated(payload)
    model_name = str(payload.get("model") or "").strip()
    if not model_name:
        models = list_vl_models()
        if not models:
            raise ValueError(_t("local_qwen_model_not_found", get_last_known_lang()))
        model_name = models[0]
    files = payload.get("files") if isinstance(payload.get("files"), list) else []
    if any(
        isinstance(row, dict)
        and str(row.get("kind") or "").lower() == "audio"
        and row.get("include_data") is not False
        for row in files
    ):
        raise ValueError("The local Qwen3-VL prompt model does not support audio input. Use a configured ChatGPT or Gemini Agent, or disable audio data.")
    system_prompt = str(payload.get("system_prompt") or "").strip()
    if not system_prompt:
        system_prompt = agent_system_prompt(
            str(payload.get("agent") or "MiniMaxH3"),
            str(payload.get("clip_role") or "multi_ref"),
        )
    system_prompt = with_output_language(
        system_prompt,
        payload.get("output_language") or payload.get("language") or DEFAULT_OUTPUT_LANGUAGE,
    )
    _ENGINE.reset_cancel()
    images, videos = media_from_payload(payload)
    user_prompt = build_user_prompt(payload)
    return _ENGINE.generate(
        model_name=model_name,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        skill=str(payload.get("skill") or ""),
        images=images,
        videos=videos,
        max_new_tokens=int(payload.get("max_new_tokens") or 2048),
        keep_loaded=False,
        reset_cancel=False,
    )


class CAP_ClipPromptVL:
    """Multimodal clip-prompt writer. Looks at stills/video and writes an agent prompt."""

    @classmethod
    def INPUT_TYPES(cls):
        models = list_vl_models() or ["(no local VL model)"]
        return {
            "required": {
                "model": (models, {"default": models[0]}),
                "output_language": (list(OUTPUT_LANGUAGES), {"default": DEFAULT_OUTPUT_LANGUAGE}),
                "system_prompt": ("STRING", {
                    "default": agent_system_prompt("MiniMaxH3", "multi_ref"),
                    "multiline": True,
                    "dynamicPrompts": False,
                }),
                "skill": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "tooltip": f"Optional prompt skill. Default empty. {SKILL_URL}",
                }),
                "user_prompt": ("STRING", {"default": "", "multiline": True, "dynamicPrompts": False}),
                "keep_model_loaded": ("BOOLEAN", {"default": True}),
                "max_new_tokens": ("INT", {"default": 2048, "min": 64, "max": 8192, "step": 64}),
            },
            "optional": {
                "images": ("IMAGE",),
                "video": ("IMAGE",),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    FUNCTION = "execute"
    CATEGORY = "Capricorncd"
    DESCRIPTION = (
        "Multimodal prompt writer (Qwen3-VL style). Attach clip stills/video plus user notes. "
        "system_prompt is fine-tuned per clip type / agent in the Timeline Editor. "
        f"skill is optional ({SKILL_URL})."
    )

    def execute(self, model, system_prompt, skill, user_prompt, keep_model_loaded=True,
                max_new_tokens=2048, output_language=DEFAULT_OUTPUT_LANGUAGE, images=None, video=None):
        stills = _images_from_tensor(images)
        videos = []
        video_frames = _images_from_tensor(video)
        if video_frames:
            if len(video_frames) == 1:
                video_frames.append(video_frames[0])
            videos.append(video_frames[:MAX_VIDEO_FRAMES])
        text = _ENGINE.generate(
            model_name=model,
            system_prompt=with_output_language(system_prompt, output_language),
            user_prompt=user_prompt,
            skill=skill,
            images=stills,
            videos=videos,
            max_new_tokens=max_new_tokens,
            keep_loaded=keep_model_loaded,
        )
        return (text,)


NODE_CLASS_MAPPINGS = {"CAP_ClipPromptVL": CAP_ClipPromptVL}
NODE_DISPLAY_NAME_MAPPINGS = {"CAP_ClipPromptVL": "Clip Prompt VL"}
