from __future__ import annotations

import gc
import logging
import os
import re
from pathlib import Path

import numpy as np
import torch
from PIL import Image

import comfy.model_management as model_management

from .timecode import AUDIO_EXTENSIONS, VIDEO_EXTENSIONS, resolve_media_path

MAX_REF_IMAGES = 9
MAX_REF_VIDEOS = 3
MAX_VIDEO_FRAMES = 8
MAX_IMAGE_SIDE = 768
SKILL_URL = "https://github.com/T8mars/minimax-h3-prompt-skill-T8"
OUTPUT_LANGUAGES = ("简体中文", "繁體中文", "English", "日本語")
DEFAULT_OUTPUT_LANGUAGE = "简体中文"

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

_AUDIO_MODE_INSTRUCTIONS = {
    "none": (
        "Audio mode: do not use background / timeline audio. "
        "Do not add <Audio n> tags. Do not describe lip-sync or performing to existing music."
    ),
    "lipsync": (
        "Audio mode: digital-human lip-sync. "
        "The overlapping timeline audio is the driving voice. Characters must lip-sync to it. "
        "Keep every <Audio n> tag. retention_analysis for those tags should be fully_copy or partially_copy. "
        "Match mouth shapes to the speech. Do not invent different dialogue. "
        "Subjects still act naturally, but speech must lock to the audio."
    ),
    "perform": (
        "Audio mode: perform to the background audio, no lip-sync. "
        "Subjects should move, dance, or act in time with the overlapping music or sound. "
        "Do not lip-sync and do not invent spoken dialogue from the audio. "
        "Keep every <Audio n> tag. overall_soundscape / non_diegetic_music should reference that audio."
    ),
    "auto": (
        "Audio mode: interpret the overlapping clip audio freely. "
        "If it is speech, you may lip-sync; if it is music, have subjects perform to the rhythm; "
        "if mixed, combine both. Always keep <Audio n> tags and write overall_soundscape from that audio. "
        "Subjects must react to the background music or sound."
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
    "Set non_diegetic_music to N/A unless tagged timeline audio itself is music that must be referenced. "
    "Do not add generated BGM content anywhere in the prompt."
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

detailed_description: [Shot 1] <style>. <action, camera, identity>. Speakers use (S1) and <d>[Language] exact words</d>. Never put spoken words in quotation marks. Later shots start with At MM:SS.mmm, the camera cuts to...

overall_soundscape: <ambience and physical sounds, or N/A>

non_diegetic_music: <instrumentation and tempo, or N/A>
"""

_H3_ROLE_HINTS = {
    "multi_ref": "Treat stills as identity / scene / prop references. Keep every <Picture n> tag and number. Do not invent extra tags.",
    "first_last": "The first still is the start frame and the last still is the end frame. Describe a continuous motion that begins on the first and lands on the last.",
    "t2v": "This is text-to-video. If no media is attached, invent the full prompt from the user's text. If stills exist they are style or subject hints, not locked start/end frames.",
    "video_ref": "Motion, camera, and identity come from the tagged videos. Keep every <Video n> tag. Stills are supporting references.",
    "video_edit": "Rewrite as an edit of the source video: keep identity and setting unless the user asks to change them. Keep every <Video n> tag.",
    "other": "Follow the user's clip prompt and tagged media. Keep existing <Picture n> / <Video n> / <Audio n> tags.",
}
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


def agent_system_prompt(agent: str, clip_role: str) -> str:
    agent = str(agent or "MiniMaxH3").strip() or "MiniMaxH3"
    role = str(clip_role or "multi_ref").strip() or "multi_ref"
    label = _CLIP_ROLE_LABELS.get(role, role)
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
        "If the clip prompt is empty, infer subjects, action, camera, and sound from the media.\n"
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


def resolve_vl_model_path(model_name: str) -> str:
    import folder_paths
    name = str(model_name or "").strip()
    if not name:
        raise ValueError("未选择多模态模型")
    if os.path.isdir(name) and os.path.isfile(os.path.join(name, "config.json")):
        return os.path.normpath(name)
    root = Path(folder_paths.models_dir)
    for sub in ("prompt_generator", "LLM", "llm"):
        candidate = root / sub / name
        if (candidate / "config.json").is_file():
            return str(candidate)
    raise ValueError(
        f"找不到模型「{name}」。请放到 ComfyUI/models/prompt_generator/ 或 models/LLM/。"
    )


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


class ClipPromptVLEngine:
    def __init__(self):
        self.model = None
        self.processor = None
        self.tokenizer = None
        self.model_name = None
        self.device = None

    def clear(self):
        if self.model is None and self.processor is None and self.tokenizer is None:
            return
        self.model = self.processor = self.tokenizer = None
        self.model_name = None
        self.device = None
        gc.collect()
        model_management.soft_empty_cache(True)
        logging.info("[CAP] Unloaded Qwen3-VL")

    def load(self, model_name: str):
        path = resolve_vl_model_path(model_name)
        if self.model is not None and self.model_name == path:
            return
        self.clear()
        try:
            from transformers import AutoModelForImageTextToText, AutoProcessor, AutoTokenizer
        except ImportError as exc:
            raise RuntimeError("需要 transformers（建议 >= 4.57）才能运行多模态提示词节点") from exc
        device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.float16 if device == "cuda" else torch.float32
        load_kwargs = {
            "torch_dtype": dtype,
            "trust_remote_code": True,
        }
        if device == "cuda":
            load_kwargs["device_map"] = {"": 0}
        else:
            load_kwargs["device_map"] = "cpu"
        self.model = AutoModelForImageTextToText.from_pretrained(path, **load_kwargs).eval()
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
    ) -> str:
        self.load(model_name)
        system_text = str(system_prompt or "").strip()
        skill_text = str(skill or "").strip()
        if skill_text:
            system_text = f"{system_text}\n\nPrompt skill:\n{skill_text}".strip()
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
        }
        with torch.inference_mode():
            outputs = self.model.generate(**model_inputs, **gen_kwargs, use_cache=True)
        input_len = model_inputs["input_ids"].shape[1]
        text = self.tokenizer.decode(outputs[0, input_len:], skip_special_tokens=True)
        if not keep_loaded:
            self.clear()
        return _clean_output(text)


_ENGINE = ClipPromptVLEngine()


def clear_clip_prompt_vl() -> None:
    _ENGINE.clear()


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
    prompt = str((row or {}).get("prompt") or "").strip()
    bits = [tag]
    if name and kind != "audio":
        bits.append(name)
    if meta:
        bits.append(meta)
    line = ": ".join(bits) if len(bits) > 1 else tag
    if prompt:
        return f"{line}\n{prompt}"
    return line


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
    picture_n = video_n = audio_n = 0
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
        else:
            picture_n += 1
            index = picture_n
        media_lines.append(_file_label(index, kind if kind in ("image", "video", "audio") else "image", row))
    if media_lines:
        lines.append("Reference media:")
        lines.extend(media_lines)
        if picture_n:
            lines.append(_REF_SHEET_RULE)
    clip_prompt = str(payload.get("clip_prompt") or "").strip()
    global_prompt = str(payload.get("global_prompt") or "").strip()
    if global_prompt:
        lines.append("Global prompt:")
        lines.append(global_prompt)
    if clip_prompt:
        lines.append("Clip prompt:")
        lines.append(clip_prompt)
    else:
        lines.append(
            "The user did not write a clip prompt. Infer a complete cinematic scene from the "
            "reference media. Do not describe character sheets or turnarounds as on-screen content."
        )
    extra = str(payload.get("user_prompt") or "").strip()
    if extra:
        lines.append(extra)
    audio_mode = normalize_audio_mode(payload.get("audio_mode") or payload.get("ai_audio_mode") or "")
    has_audio = audio_n > 0 and audio_mode != "none"
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


def generate_from_payload(payload: dict) -> str:
    if not isinstance(payload, dict):
        raise ValueError("Invalid payload")
    model_name = str(payload.get("model") or "").strip()
    if not model_name:
        models = list_vl_models()
        if not models:
            raise ValueError("未找到本地 Qwen3-VL 模型，请放到 ComfyUI/models/prompt_generator/")
        model_name = models[0]
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
        keep_loaded=payload.get("keep_loaded", True) is not False,
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
