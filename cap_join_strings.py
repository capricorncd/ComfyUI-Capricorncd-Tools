from __future__ import annotations

import re

from comfy_api.latest import io

_JOIN_SEPS = {
    "newline": "\n",
    "comma": ",",
    "underscore": "_",
    "hyphen": "-",
    "slash": "/",
    "none": "",
}


def _join_sep(join_mode: str, custom_sep: str | None) -> str:
    if custom_sep is not None and custom_sep != "":
        return str(custom_sep)
    return _JOIN_SEPS.get(str(join_mode), ",")


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
                "Join with newline, comma, underscore, hyphen, slash, or none; "
                "custom_sep overrides join_mode when non-empty. "
                "Optional leading/trailing blank lines, prefix and suffix."
            ),
            search_aliases=["concat", "join", "string", "拼接", "字符串"],
            inputs=[
                io.Combo.Input(
                    "join_mode",
                    options=["newline", "comma", "underscore", "hyphen", "slash", "none"],
                    default="newline",
                    tooltip="Join separator: newline, comma, underscore, hyphen, slash, or none (empty). custom_sep takes priority when non-empty.",
                ),
                io.String.Input(
                    "custom_sep",
                    default="",
                    tooltip="Custom separator; takes priority over join_mode when non-empty. Leave blank to use the option above.",
                ),
                io.Boolean.Input(
                    "leading_blank",
                    default=False,
                    label_on="Leading blank",
                    label_off="No leading blank",
                    tooltip="Insert a blank segment before the joined result (a blank line, in newline mode)",
                ),
                io.Boolean.Input(
                    "trailing_blank",
                    default=False,
                    label_on="Trailing blank",
                    label_off="No trailing blank",
                    tooltip="Insert a blank segment after the joined result (a blank line, in newline mode)",
                ),
                io.String.Input("prefix", default="", tooltip="Overall prefix"),
                io.String.Input("suffix", default="", tooltip="Overall suffix"),
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
        custom_sep: str,
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

        body = _join_sep(join_mode, custom_sep).join(parts)
        return io.NodeOutput(f"{prefix or ''}{body}{suffix or ''}")
