from __future__ import annotations

import re

from comfy_api.latest import io


def _stringify(value) -> str | None:
    """Convert connected values to string; skip unconnected/None."""
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float, str)):
        return str(value)
    return str(value)


def _slot_sort_key(name: str):
    m = re.search(r"(\d+)$", name)
    return (0, int(m.group(1))) if m else (1, name)


class CAP_JoinStrings(io.ComfyNode):
    """Join a dynamic number of STRING/INT/FLOAT inputs into one string."""

    @classmethod
    def define_schema(cls) -> io.Schema:
        autogrow = io.Autogrow.TemplatePrefix(
            input=io.MultiType.Input("text", [io.String, io.Int, io.Float], optional=True),
            prefix="text_",
            min=0,
            max=32,
        )
        return io.Schema(
            node_id="CAP_JoinStrings",
            display_name="Join Strings",
            category="Capricorncd",
            description=(
                "Join a variable number of string/int/float inputs. "
                "Slots auto-grow like Math Expression. "
                "Join with newline or comma; optional leading/trailing blank lines, prefix and suffix."
            ),
            search_aliases=["concat", "join", "string", "拼接", "字符串"],
            inputs=[
                io.Combo.Input(
                    "join_mode",
                    options=["newline", "comma"],
                    default="newline",
                    tooltip="拼接分隔：换行 或 半角逗号",
                ),
                io.Boolean.Input(
                    "leading_blank",
                    default=False,
                    label_on="插入开始空行",
                    label_off="无开始空行",
                    tooltip="在拼接结果最前插入一个空段（换行模式下即空行）",
                ),
                io.Boolean.Input(
                    "trailing_blank",
                    default=False,
                    label_on="插入结尾空行",
                    label_off="无结尾空行",
                    tooltip="在拼接结果最后插入一个空段（换行模式下即空行）",
                ),
                io.String.Input("prefix", default="", tooltip="整体前缀"),
                io.String.Input("suffix", default="", tooltip="整体后缀"),
                io.Autogrow.Input("texts", template=autogrow),
            ],
            outputs=[
                io.String.Output(display_name="STRING"),
            ],
        )

    @classmethod
    def execute(
        cls,
        join_mode: str,
        leading_blank: bool,
        trailing_blank: bool,
        prefix: str,
        suffix: str,
        texts: io.Autogrow.Type,
    ) -> io.NodeOutput:
        parts: list[str] = []
        for name in sorted((texts or {}).keys(), key=_slot_sort_key):
            s = _stringify(texts.get(name))
            if s is None:
                continue
            parts.append(s)

        if leading_blank:
            parts.insert(0, "")
        if trailing_blank:
            parts.append("")

        sep = "\n" if str(join_mode) == "newline" else ","
        body = sep.join(parts)
        return io.NodeOutput(f"{prefix or ''}{body}{suffix or ''}")
