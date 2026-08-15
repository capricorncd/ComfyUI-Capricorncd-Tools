from __future__ import annotations

import json
import os
from datetime import datetime

_SKIP_KEYS = frozenset({
    "data_json",
    "project_json",
    "clips_json",
    "image_paths",
    "frames_dir",
    "clips_dir",
    "filename_prefix",
    "filename",
})

_MODEL_KEYS = (
    "ckpt_name",
    "unet_name",
    "vae_name",
    "clip_name",
    "clip_name1",
    "clip_name2",
    "clip_name3",
    "lora_name",
    "control_net_name",
    "model_name",
)

_PROMPT_KEYS = (
    "text",
    "prompt",
    "positive",
    "negative",
    "global_prompt",
    "scene_prompt",
    "negative_prompt",
    "text_g",
    "text_l",
)

_SAMPLER_VALUE_KEYS = (
    "seed",
    "noise_seed",
    "steps",
    "cfg",
    "sampler_name",
    "scheduler",
    "denoise",
)

_STRENGTH_KEYS = ("strength_model", "strength_clip", "strength")


def sidecar_path(media_path: str) -> str:
    return os.path.splitext(media_path)[0] + ".json"


def write_sidecar(path: str, payload: dict) -> str:
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as wf:
        json.dump(payload, wf, ensure_ascii=False, indent=2)
        wf.write("\n")
    return path


def build_sidecar_payload(
    file_name: str,
    note: str = "",
    prompt=None,
    extra: dict | None = None,
) -> dict:
    payload: dict = {
        "file": file_name,
        "created": datetime.now().isoformat(timespec="seconds"),
    }
    note_text = str(note or "").strip()
    if note_text:
        payload["note"] = note_text

    extracted = extract_from_prompt(prompt)
    if extracted["prompts"]:
        payload["prompts"] = extracted["prompts"]
    if extracted["models"]:
        payload["models"] = extracted["models"]
    if extracted["samplers"]:
        payload["samplers"] = extracted["samplers"]
    if extra:
        for key, value in extra.items():
            if value is not None:
                payload[key] = value
    return payload


def extract_from_prompt(prompt) -> dict:
    graph = _as_graph(prompt)
    prompts: list[dict] = []
    models: list[dict] = []
    samplers: list[dict] = []
    if not graph:
        return {"prompts": prompts, "models": models, "samplers": samplers}

    for node_id, node in graph.items():
        if not isinstance(node, dict):
            continue
        class_type = str(node.get("class_type") or "")
        inputs = node.get("inputs")
        if not class_type or not isinstance(inputs, dict):
            continue

        if not _is_sampler(class_type, inputs):
            for key in _PROMPT_KEYS:
                if key not in inputs or key in _SKIP_KEYS:
                    continue
                text = _resolve_string(graph, inputs[key])
                if not text:
                    continue
                prompts.append({
                    "node": class_type,
                    "id": str(node_id),
                    "name": key,
                    "text": text,
                })

        for key in _MODEL_KEYS:
            if key not in inputs:
                continue
            file_name = _resolve_string(graph, inputs[key])
            if not file_name:
                continue
            item = {
                "node": class_type,
                "id": str(node_id),
                "name": key,
                "file": file_name,
            }
            for strength_key in _STRENGTH_KEYS:
                if strength_key in inputs and _is_number(inputs[strength_key]):
                    item[strength_key] = inputs[strength_key]
            models.append(item)

        if _is_sampler(class_type, inputs):
            item = {"node": class_type, "id": str(node_id)}
            for key in _SAMPLER_VALUE_KEYS:
                if key not in inputs:
                    continue
                value = inputs[key]
                if _is_link(value):
                    continue
                if isinstance(value, (str, int, float, bool)):
                    item[key] = value
            if len(item) > 2:
                samplers.append(item)

    return {"prompts": prompts, "models": models, "samplers": samplers}


def clip_prompts_from_data_json(data_json: str) -> list[dict]:
    try:
        data = json.loads(data_json or "{}")
    except json.JSONDecodeError:
        return []
    if not isinstance(data, dict):
        return []
    clips = data.get("clips")
    if not isinstance(clips, list):
        return []
    rows: list[dict] = []
    global_prompt = str(data.get("global_prompt") or "").strip()
    for index, clip in enumerate(clips):
        if not isinstance(clip, dict):
            continue
        text = str(clip.get("prompt") or "").strip()
        if not text and not global_prompt:
            continue
        row = {"index": index}
        if text:
            row["prompt"] = text
        if global_prompt:
            row["global_prompt"] = global_prompt
        rows.append(row)
    return rows


def _as_graph(prompt) -> dict:
    if isinstance(prompt, str):
        try:
            prompt = json.loads(prompt)
        except json.JSONDecodeError:
            return {}
    return prompt if isinstance(prompt, dict) else {}


def _is_link(value) -> bool:
    return (
        isinstance(value, (list, tuple))
        and len(value) >= 1
        and isinstance(value[0], (str, int))
    )


def _is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _is_sampler(class_type: str, inputs: dict) -> bool:
    if class_type in ("KSampler", "KSamplerAdvanced", "SamplerCustom", "SamplerCustomAdvanced"):
        return True
    return "Sampler" in class_type and ("seed" in inputs or "steps" in inputs or "noise_seed" in inputs)


def _resolve_string(graph: dict, value, depth: int = 0) -> str | None:
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        if text[0] == "{" and len(text) > 200:
            return None
        return value
    if depth > 6 or not _is_link(value):
        return None
    src = graph.get(str(value[0]))
    if not isinstance(src, dict):
        return None
    inputs = src.get("inputs")
    if not isinstance(inputs, dict):
        return None
    for key in _PROMPT_KEYS:
        if key in inputs:
            found = _resolve_string(graph, inputs[key], depth + 1)
            if found:
                return found
    for key, raw in inputs.items():
        if key in _SKIP_KEYS:
            continue
        if isinstance(raw, str) and raw.strip():
            return raw
        if _is_link(raw):
            found = _resolve_string(graph, raw, depth + 1)
            if found:
                return found
    return None
