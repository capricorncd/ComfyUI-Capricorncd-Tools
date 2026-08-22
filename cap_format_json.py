from __future__ import annotations

import json


class CAP_FormatJson:
    """Pretty-print a JSON string for reading in the graph UI."""

    DOC_SLUG = "format-json"
    OUTPUT_TOOLTIPS = {
        "formatted_json": "Indented JSON, or an error comment plus the original text",
    }

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "json_text": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "forceInput": True,
                    "tooltip": "JSON string to format (connect from another node)",
                }),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("formatted_json",)
    FUNCTION = "execute"
    OUTPUT_NODE = True
    CATEGORY = "Capricorncd"
    DESCRIPTION = (
        "Format a JSON string with indentation; shows the result on the node "
        "and outputs formatted_json. Last run text is kept in the workflow so it "
        "survives refresh / restart (same idea as Easy-Use Show Any)."
    )

    @classmethod
    def IS_CHANGED(cls, json_text, unique_id=None, extra_pnginfo=None):
        return json_text

    def _persist_preview(self, unique_id, extra_pnginfo, formatted: str):
        """Write preview into workflow widgets_values so reload restores it."""
        if not extra_pnginfo or not isinstance(extra_pnginfo, dict):
            return
        workflow = extra_pnginfo.get("workflow")
        if not isinstance(workflow, dict):
            return
        nodes = workflow.get("nodes")
        if not isinstance(nodes, list):
            return
        uid = unique_id[0] if isinstance(unique_id, list) else unique_id
        if uid is None:
            return
        for node in nodes:
            if not isinstance(node, dict):
                continue
            if str(node.get("id")) != str(uid):
                continue
            node["widgets_values"] = [formatted]
            break

    def execute(self, json_text: str, unique_id=None, extra_pnginfo=None):
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

        self._persist_preview(unique_id, extra_pnginfo, formatted)
        return {"ui": {"text": (formatted,)}, "result": (formatted,)}


NODE_CLASS_MAPPINGS = {"CAP_FormatJson": CAP_FormatJson}
NODE_DISPLAY_NAME_MAPPINGS = {"CAP_FormatJson": "Format JSON"}
