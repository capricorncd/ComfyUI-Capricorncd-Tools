from __future__ import annotations

import json
from typing import Any

from comfy_api.latest import io


def _unwrap(value: Any) -> Any:
    if isinstance(value, list) and len(value) == 1:
        return value[0]
    return value


def _to_display(val: Any, format_json: bool) -> str:
    if isinstance(val, str):
        if format_json:
            stripped = val.strip()
            if stripped:
                try:
                    return json.dumps(json.loads(stripped), ensure_ascii=False, indent=2)
                except json.JSONDecodeError:
                    pass
        return val
    if isinstance(val, (int, float, bool)):
        return str(val)
    if val is None:
        return ""
    try:
        text = json.dumps(val, ensure_ascii=False, indent=2 if format_json else None)
        if isinstance(text, str):
            return text
    except Exception:
        pass
    try:
        return str(val)
    except Exception as exc:
        raise RuntimeError("source exists, but could not be serialized.") from exc


class CAP_ShowAnything(io.ComfyNode):
    """Show any connected value on the node; persist last text across reload."""

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="CAP_ShowAnything",
            display_name="Show Anything",
            category="Capricorncd",
            description=(
                "Display any connected value on the node (like Easy-Use Show Any). "
                "Last shown text is stored in the workflow widgets_values so it survives "
                "refresh / restart. Optional format_json pretty-prints JSON strings."
            ),
            search_aliases=["show", "preview", "debug", "展示", "任何", "json"],
            is_input_list=True,
            is_output_node=True,
            inputs=[
                io.AnyType.Input("anything", optional=True, tooltip="Any type of input; may be left unconnected"),
                io.Boolean.Input(
                    "format_json",
                    default=True,
                    label_on="Format JSON",
                    label_off="Raw text",
                    tooltip="When on, try to parse string / object values as JSON and indent them",
                ),
            ],
            outputs=[
                io.AnyType.Output(display_name="output"),
            ],
            hidden=[io.Hidden.unique_id, io.Hidden.extra_pnginfo],
        )

    @classmethod
    def execute(cls, format_json=True, **kwargs) -> io.NodeOutput:
        unique_id = cls.hidden.unique_id
        extra_pnginfo = cls.hidden.extra_pnginfo
        format_json = bool(_unwrap(format_json))

        raw_items: list[Any] = []
        display: list[str] = []
        has_input = False

        if "anything" in kwargs:
            items = kwargs["anything"]
            if not isinstance(items, list):
                items = [items]
            for val in items:
                if val is None:
                    continue
                has_input = True
                if isinstance(val, list) and len(val) <= 30 and not isinstance(val, str):
                    # Small lists: show one widget per element (Easy-Use style)
                    raw_items = list(val)
                    display = [_to_display(x, format_json) for x in val]
                    break
                raw_items.append(val)
                display.append(_to_display(val, format_json))

        # No connected value this run: keep previous widgets_values / UI text.
        if not has_input:
            return io.NodeOutput(None)

        if extra_pnginfo and isinstance(extra_pnginfo, dict) and "workflow" in extra_pnginfo:
            uid = unique_id[0] if isinstance(unique_id, list) else unique_id
            nodes = extra_pnginfo["workflow"].get("nodes") if isinstance(extra_pnginfo["workflow"], dict) else None
            if isinstance(nodes, list) and uid is not None:
                for node in nodes:
                    if not isinstance(node, dict):
                        continue
                    if str(node.get("id")) != str(uid):
                        continue
                    # format_json widget first, then one text widget value per display line
                    node["widgets_values"] = [format_json, *display]
                    break

        out = raw_items[0] if len(raw_items) == 1 else raw_items
        return io.NodeOutput(out, ui={"text": display})
