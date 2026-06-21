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
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    FUNCTION = "process"
    CATEGORY = "Capricorncd"

    def process(self, prompt: str):
        lines = prompt.split("\n")
        active_lines = []
        for line in lines:
            if line.startswith("#"):
                continue
            active_lines.append(line)
        return ("\n".join(active_lines),)
