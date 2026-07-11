from __future__ import annotations

import json


class CAP_FormatJson:
    """Pretty-print a JSON string for reading in the graph UI."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "json_text": ("STRING", {"default": "", "multiline": True, "forceInput": True}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("formatted_json",)
    FUNCTION = "execute"
    OUTPUT_NODE = True
    CATEGORY = "Capricorncd"
    DESCRIPTION = "Format a JSON string with indentation; shows the result on the node and outputs formatted_json."

    @classmethod
    def IS_CHANGED(cls, json_text):
        return json_text

    def execute(self, json_text: str):
        text = str(json_text or "")
        stripped = text.strip()
        if not stripped:
            formatted = ""
        else:
            try:
                data = json.loads(stripped)
                formatted = json.dumps(data, ensure_ascii=False, indent=2)
            except json.JSONDecodeError as exc:
                formatted = f"/* JSON parse error: {exc} */\n{text}"

        return {"ui": {"text": (formatted,)}, "result": (formatted,)}


NODE_CLASS_MAPPINGS = {"CAP_FormatJson": CAP_FormatJson}
NODE_DISPLAY_NAME_MAPPINGS = {"CAP_FormatJson": "Format JSON"}
