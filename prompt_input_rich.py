class CAP_RichPromptInput:
    """Prompt editor with # comments, history/presets, and live highlighting."""

    DOC_SLUG = "prompt-input"
    OUTPUT_TOOLTIPS = {
        "prompt": "Active lines with # comment markers removed",
    }

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompt": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "dynamicPrompts": False,
                    "tooltip": "Rich prompt input: Ctrl+/ toggles a # comment, paste keeps plain text only. Commented lines are filtered from the output.",
                }),
                "add_blank_line_start": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "Insert a blank line at the start of the output string.",
                }),
                "add_blank_line_end": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "Insert a blank line at the end of the output string.",
                }),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    FUNCTION = "process"
    CATEGORY = "Capricorncd"
    DESCRIPTION = (
        "Rich prompt editor with # line comments (stripped from output), "
        "Ctrl+/ toggle, plain-text paste, and history/preset library."
    )

    def process(self, prompt: str, add_blank_line_start: bool = False, add_blank_line_end: bool = False):
        lines = prompt.split("\n")
        active_lines = []
        for line in lines:
            if line.startswith("#"):
                continue
            active_lines.append(line)
        if add_blank_line_start:
            active_lines.insert(0, "")
        if add_blank_line_end:
            active_lines.append("")
        return ("\n".join(active_lines),)
