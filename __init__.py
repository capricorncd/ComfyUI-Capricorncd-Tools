from .prompt_input import CAP_PromptInput

WEB_DIRECTORY = "./js"

NODE_CLASS_MAPPINGS = {
    "CAP_PromptInput": CAP_PromptInput,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CAP_PromptInput": "Prompt Input",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
