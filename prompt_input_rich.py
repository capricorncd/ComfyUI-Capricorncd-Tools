class CAP_RichPromptInput:

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompt": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "dynamicPrompts": False,
                    "tooltip": "富文本提示词输入：Ctrl+/ 注释切换，粘贴时仅保留纯文本。输出会过滤注释行。",
                }),
                "add_blank_line_start": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "在输出字符串开头插入一个空行。",
                }),
                "add_blank_line_end": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "在输出字符串末尾插入一个空行。",
                }),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    FUNCTION = "process"
    CATEGORY = "Capricorncd"

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
