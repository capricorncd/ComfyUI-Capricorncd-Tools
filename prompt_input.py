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
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    FUNCTION = "process"
    CATEGORY = "Capricorncd"

    def process(self, prompt: str):
        lines = prompt.split("\n")
        active = [line for line in lines if not line.startswith("#")]
        return ("\n".join(active),)
