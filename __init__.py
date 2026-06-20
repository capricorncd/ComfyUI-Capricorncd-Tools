import logging
import os

from aiohttp import web

from .prompt_input import CAP_PromptInput
from .prompt_input_rich import CAP_RichPromptInput
from .audio_keyframe_timeline import (
    NODE_CLASS_MAPPINGS as _AKTL_CLASS,
    NODE_DISPLAY_NAME_MAPPINGS as _AKTL_NAMES,
)
from .cap_audio_timeline import (
    NODE_CLASS_MAPPINGS as _CAT_CLASS,
    NODE_DISPLAY_NAME_MAPPINGS as _CAT_NAMES,
)
from .timecode import (
    IMAGE_EXTENSIONS,
    list_keyframe_files_ordered,
    resolve_keyframe_dir,
)

WEB_DIRECTORY = "./js"

NODE_CLASS_MAPPINGS = {
    "CAP_PromptInput": CAP_PromptInput,
    "CAP_RichPromptInput": CAP_RichPromptInput,
    **_AKTL_CLASS,
    **_CAT_CLASS,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CAP_PromptInput": "Prompt Input",
    "CAP_RichPromptInput": "Rich Prompt Input",
    **_AKTL_NAMES,
    **_CAT_NAMES,
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]


def _register_routes():
    try:
        from server import PromptServer
    except Exception:
        logging.warning("[CapricorncdTools] PromptServer not available; API routes skipped.")
        return

    routes = PromptServer.instance.routes

    @routes.get("/audio_keyframe_timeline/keyframes")
    async def api_list_keyframes(request: web.Request) -> web.Response:
        directory = request.rel_url.query.get("dir", "")
        resolved = resolve_keyframe_dir(directory)
        files = list_keyframe_files_ordered(directory)
        return web.json_response({"files": files, "resolved_dir": resolved, "count": len(files)})

    @routes.get("/audio_keyframe_timeline/keyframe_image")
    async def api_keyframe_image(request: web.Request) -> web.Response:
        directory = request.rel_url.query.get("dir", "")
        name = request.rel_url.query.get("name", "")
        resolved = resolve_keyframe_dir(directory)
        if not resolved or not name:
            return web.Response(status=400, text="Missing dir or name")
        safe_name = os.path.basename(name)
        if safe_name != name:
            return web.Response(status=400, text="Invalid filename")
        _, ext = os.path.splitext(safe_name)
        if ext.lower() not in IMAGE_EXTENSIONS:
            return web.Response(status=400, text="Unsupported file type")
        path = os.path.join(resolved, safe_name)
        if not os.path.isfile(path):
            return web.Response(status=404, text="Not found")
        return web.FileResponse(path)

    logging.info("[CapricorncdTools] Registered API routes.")


_register_routes()
