class CAP_PromptInput:

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompt": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "dynamicPrompts": False,
                    "tooltip": "支持注释：行首 # 为注释行，输出时自动过滤。快捷键 Ctrl+/ 切换注释。",
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
        active = [line for line in lines if not line.startswith("#")]
        if add_blank_line_start:
            active.insert(0, "")
        if add_blank_line_end:
            active.append("")
        return ("\n".join(active),)
