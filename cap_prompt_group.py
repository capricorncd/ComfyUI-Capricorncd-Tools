from __future__ import annotations

import re


def effective_prompt_lines(scene_prompt: str) -> list[str]:
    """Non-empty lines in scene_prompt (whitespace-only lines ignored)."""
    return [line for line in (scene_prompt or "").splitlines() if line.strip()]


def count_effective_prompts(scene_prompt: str) -> int:
    return len(effective_prompt_lines(scene_prompt))


def parse_output_scenes(spec: str) -> list[int] | None:
    """Parse 1-based scene numbers separated by spaces or commas.

    Returns None when spec is empty (no filtering). Invalid tokens are skipped.
    """
    text = (spec or "").strip()
    if not text:
        return None
    indices: list[int] = []
    for token in re.split(r"[\s,]+", text):
        if not token:
            continue
        try:
            indices.append(int(token))
        except ValueError:
            continue
    return indices


def select_scene_lines(scene_prompt: str, output_scenes: str) -> tuple[str, int]:
    """Return (scene text, effective length) after optional scene filtering.

    When output_scenes is empty, pass scene_prompt through and count all
    effective lines. When set, keep only the listed 1-based effective lines
    (joined by newlines) and set length to how many were actually selected.
    """
    lines = effective_prompt_lines(scene_prompt)
    indices = parse_output_scenes(output_scenes)
    if indices is None:
        return scene_prompt or "", len(lines)
    selected = []
    for n in indices:
        if 1 <= n <= len(lines):
            selected.append(lines[n - 1])
    return "\n".join(selected), len(selected)


def slice_scene_prompts(scene_prompt: str, index: int, length: int) -> list[str]:
    lines = effective_prompt_lines(scene_prompt)
    if not lines:
        return []
    start = int(index)
    if start < 0:
        start += len(lines)
    start = max(0, min(len(lines), start))
    count = max(0, int(length))
    return lines[start:start + count]


def merge_prompts(global_prompt: str, scene_lines: list[str], merge_global: bool) -> str:
    scenes = "\n".join(scene_lines)
    if not merge_global:
        return scenes
    global_text = global_prompt or ""
    if not global_text.strip():
        return scenes
    if not scenes:
        return global_text
    return f"{global_text.rstrip()}\n{scenes}"


class CAP_PromptGroup:
    """Global / scene / negative prompt inputs; count effective scene prompt lines."""

    DOC_SLUG = "prompt-group"
    OUTPUT_TOOLTIPS = {
        "global_prompt": "Pass-through global prompt text",
        "negative_prompt": "Pass-through negative prompt text",
        "scene_prompt": "Scene prompt text (filtered when output_scenes is set)",
        "effective_length": "Number of scene lines actually output",
    }

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "global_prompt": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "dynamicPrompts": False,
                    "tooltip": "Global prompt applied across all scenes",
                }),
                "scene_prompt": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "dynamicPrompts": False,
                    "tooltip": "One scene prompt per non-empty line; empty lines are ignored for the count",
                }),
                "negative_prompt": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "dynamicPrompts": False,
                    "tooltip": "Negative prompt text",
                }),
                "output_scenes": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "dynamicPrompts": False,
                    "tooltip": "Optional 1-based scene numbers to keep, separated by spaces or commas (e.g. 1 2 3 or 1,3,5). Empty = all scenes.",
                }),
            },
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING", "INT")
    RETURN_NAMES = ("global_prompt", "negative_prompt", "scene_prompt", "effective_length")
    FUNCTION = "execute"
    CATEGORY = "Capricorncd"
    DESCRIPTION = (
        "Collect global, scene, and negative prompts. "
        "Optional output_scenes filters effective scene lines (1-based); "
        "effective_length is the number of lines actually output."
    )

    def execute(
        self,
        global_prompt: str,
        scene_prompt: str,
        negative_prompt: str,
        output_scenes: str = "",
    ):
        out_scene, length = select_scene_lines(scene_prompt, output_scenes)
        return (
            global_prompt or "",
            negative_prompt or "",
            out_scene,
            length,
        )


class CAP_PromptFromBatch:
    """Slice scene prompts by batch index/length; optionally prepend global prompt."""

    DOC_SLUG = "prompt-from-batch"
    OUTPUT_TOOLTIPS = {
        "prompt": "Selected scene lines, optionally prepended with global_prompt",
    }

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "global_prompt": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "forceInput": True,
                    "tooltip": "Global prompt; prepended when merge_global is true",
                }),
                "scene_prompt": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "forceInput": True,
                    "tooltip": "Scene prompts, one per non-empty line",
                }),
                "batch_index": ("INT", {
                    "default": 0,
                    "min": -4096,
                    "max": 4096,
                    "tooltip": "Start index into effective scene lines; negative counts from the end",
                }),
                "batch_length": ("INT", {
                    "default": 1,
                    "min": 0,
                    "max": 4096,
                    "tooltip": "How many effective scene lines to take from batch_index",
                }),
                "merge_global": ("BOOLEAN", {
                    "default": True,
                    "label_on": "合并",
                    "label_off": "不合并",
                    "tooltip": "When true, prepend global_prompt to the selected scene lines",
                }),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    FUNCTION = "execute"
    CATEGORY = "Capricorncd"
    DESCRIPTION = (
        "Take batch_length effective scene prompt lines starting at batch_index. "
        "When merge_global is true, prepend global_prompt."
    )

    def execute(
        self,
        global_prompt: str,
        scene_prompt: str,
        batch_index: int,
        batch_length: int,
        merge_global: bool,
    ):
        lines = slice_scene_prompts(scene_prompt, batch_index, batch_length)
        return (merge_prompts(global_prompt, lines, merge_global),)


NODE_CLASS_MAPPINGS = {
    "CAP_PromptGroup": CAP_PromptGroup,
    "CAP_PromptFromBatch": CAP_PromptFromBatch,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CAP_PromptGroup": "Prompt Group",
    "CAP_PromptFromBatch": "Prompt From Batch",
}
