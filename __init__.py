import logging
import os
import shutil
import subprocess
import sys

from aiohttp import web

from .prompt_input import CAP_PromptInput
from .prompt_input_rich import CAP_RichPromptInput
from .cap_audio_timeline import (
    NODE_CLASS_MAPPINGS as _CAT_CLASS,
    NODE_DISPLAY_NAME_MAPPINGS as _CAT_NAMES,
)
from .cap_data_json_parser import (
    NODE_CLASS_MAPPINGS as _CDP_CLASS,
    NODE_DISPLAY_NAME_MAPPINGS as _CDP_NAMES,
)
from .cap_seq_to_video import (
    NODE_CLASS_MAPPINGS as _STV_CLASS,
    NODE_DISPLAY_NAME_MAPPINGS as _STV_NAMES,
)
from .cap_timeline_editor import (
    NODE_CLASS_MAPPINGS as _CTE_CLASS,
    NODE_DISPLAY_NAME_MAPPINGS as _CTE_NAMES,
)
from .cap_save_images import (
    NODE_CLASS_MAPPINGS as _CSI_CLASS,
    NODE_DISPLAY_NAME_MAPPINGS as _CSI_NAMES,
)
from .timecode import (
    AUDIO_EXTENSIONS,
    IMAGE_EXTENSIONS,
    VIDEO_EXTENSIONS,
    list_audio_files_ordered,
    list_keyframe_files_ordered,
    list_video_files_ordered,
    resolve_assets_dir,
)

WEB_DIRECTORY = "./js"

NODE_CLASS_MAPPINGS = {
    "CAP_PromptInput": CAP_PromptInput,
    "CAP_RichPromptInput": CAP_RichPromptInput,
    **_CAT_CLASS,
    **_CDP_CLASS,
    **_STV_CLASS,
    **_CTE_CLASS,
    **_CSI_CLASS,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CAP_PromptInput": "Prompt Input",
    "CAP_RichPromptInput": "Rich Prompt Input",
    **_CAT_NAMES,
    **_CDP_NAMES,
    **_STV_NAMES,
    **_CTE_NAMES,
    **_CSI_NAMES,
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]


def _safe_join(base: str, rel: str) -> str | None:
    """Resolve `rel` under `base`, allowing subfolders but rejecting anything
    (via `..`, an absolute path, or a symlink) that would escape `base`."""
    rel = (rel or "").strip().replace("\\", "/")
    if not rel or rel.startswith("/") or ".." in rel.split("/"):
        return None
    base_real = os.path.realpath(base)
    candidate_real = os.path.realpath(os.path.join(base_real, rel))
    if candidate_real != base_real and not candidate_real.startswith(base_real + os.sep):
        return None
    return candidate_real


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
        resolved = resolve_assets_dir(directory)
        files = list_keyframe_files_ordered(directory)
        return web.json_response({"files": files, "resolved_dir": resolved, "count": len(files)})

    @routes.get("/audio_keyframe_timeline/keyframe_image")
    async def api_keyframe_image(request: web.Request) -> web.Response:
        directory = request.rel_url.query.get("dir", "")
        name = request.rel_url.query.get("name", "")
        resolved = resolve_assets_dir(directory)
        if not resolved or not name:
            return web.Response(status=400, text="Missing dir or name")
        path = _safe_join(resolved, name)
        if not path:
            return web.Response(status=400, text="Invalid filename")
        _, ext = os.path.splitext(path)
        if ext.lower() not in IMAGE_EXTENSIONS:
            return web.Response(status=400, text="Unsupported file type")
        if not os.path.isfile(path):
            return web.Response(status=404, text="Not found")
        return web.FileResponse(path)

    @routes.get("/audio_keyframe_timeline/videos")
    async def api_list_videos(request: web.Request) -> web.Response:
        directory = request.rel_url.query.get("dir", "")
        resolved = resolve_assets_dir(directory)
        files = list_video_files_ordered(directory)
        return web.json_response({"files": files, "resolved_dir": resolved, "count": len(files)})

    @routes.get("/audio_keyframe_timeline/keyframe_video")
    async def api_keyframe_video(request: web.Request) -> web.Response:
        directory = request.rel_url.query.get("dir", "")
        name = request.rel_url.query.get("name", "")
        resolved = resolve_assets_dir(directory)
        if not resolved or not name:
            return web.Response(status=400, text="Missing dir or name")
        path = _safe_join(resolved, name)
        if not path:
            return web.Response(status=400, text="Invalid filename")
        _, ext = os.path.splitext(path)
        if ext.lower() not in VIDEO_EXTENSIONS:
            return web.Response(status=400, text="Unsupported file type")
        if not os.path.isfile(path):
            return web.Response(status=404, text="Not found")
        return web.FileResponse(path)

    @routes.get("/audio_keyframe_timeline/audios")
    async def api_list_audios(request: web.Request) -> web.Response:
        directory = request.rel_url.query.get("dir", "")
        resolved = resolve_assets_dir(directory)
        files = list_audio_files_ordered(directory)
        return web.json_response({"files": files, "resolved_dir": resolved, "count": len(files)})

    @routes.get("/audio_keyframe_timeline/keyframe_audio")
    async def api_keyframe_audio(request: web.Request) -> web.Response:
        directory = request.rel_url.query.get("dir", "")
        name = request.rel_url.query.get("name", "")
        resolved = resolve_assets_dir(directory)
        if not resolved or not name:
            return web.Response(status=400, text="Missing dir or name")
        path = _safe_join(resolved, name)
        if not path:
            return web.Response(status=400, text="Invalid filename")
        _, ext = os.path.splitext(path)
        if ext.lower() not in AUDIO_EXTENSIONS:
            return web.Response(status=400, text="Unsupported file type")
        if not os.path.isfile(path):
            return web.Response(status=404, text="Not found")
        return web.FileResponse(path)

    @routes.get("/cap/ffmpeg_status")
    async def api_ffmpeg_status(_request: web.Request) -> web.Response:
        path = shutil.which("ffmpeg")
        if not path:
            return web.json_response({"available": False, "version": None, "path": None})
        try:
            kwargs: dict = {"capture_output": True, "text": True, "timeout": 5}
            if sys.platform == "win32":
                kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
            r = subprocess.run(["ffmpeg", "-version"], **kwargs)
            version = r.stdout.splitlines()[0] if r.returncode == 0 else None
        except Exception:
            version = None
        return web.json_response({"available": True, "version": version, "path": path})

    @routes.post("/cap/upload_keyframe")
    async def api_upload_keyframe(request: web.Request) -> web.Response:
        import folder_paths as _fp
        try:
            reader = await request.multipart()
            field = await reader.next()
            if field is None or field.name != "image":
                return web.json_response({"error": "Missing image field"}, status=400)
            filename = os.path.basename(field.filename or "upload.png")
            input_dir = _fp.get_input_directory()
            dest = os.path.join(input_dir, filename)
            # Avoid overwriting: append counter suffix if needed
            if os.path.exists(dest):
                base, ext = os.path.splitext(filename)
                counter = 1
                while os.path.exists(dest):
                    dest = os.path.join(input_dir, f"{base}_{counter}{ext}")
                    counter += 1
            with open(dest, "wb") as f:
                while True:
                    chunk = await field.read_chunk(65536)
                    if not chunk:
                        break
                    f.write(chunk)
            return web.json_response({"path": dest})
        except Exception as exc:
            logging.exception("[CapricorncdTools] upload_keyframe error")
            return web.json_response({"error": str(exc)}, status=500)

    logging.info("[CapricorncdTools] Registered API routes.")


_register_routes()
