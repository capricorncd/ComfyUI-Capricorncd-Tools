import logging
import os
import shutil
import subprocess
import sys

from aiohttp import web

from .cap_i18n import resolve_lang, t
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
from .cap_compose_clip_videos import (
    NODE_CLASS_MAPPINGS as _CCV_CLASS,
    NODE_DISPLAY_NAME_MAPPINGS as _CCV_NAMES,
)
from .cap_timeline_editor import (
    NODE_CLASS_MAPPINGS as _CTE_CLASS,
    NODE_DISPLAY_NAME_MAPPINGS as _CTE_NAMES,
)
from .cap_save_images import (
    NODE_CLASS_MAPPINGS as _CSI_CLASS,
    NODE_DISPLAY_NAME_MAPPINGS as _CSI_NAMES,
)
from .cap_image_batch import (
    NODE_CLASS_MAPPINGS as _CIB_CLASS,
    NODE_DISPLAY_NAME_MAPPINGS as _CIB_NAMES,
)
from .cap_load_images_from_dir import (
    NODE_CLASS_MAPPINGS as _CLD_CLASS,
    NODE_DISPLAY_NAME_MAPPINGS as _CLD_NAMES,
)
from .cap_clear_directory import (
    NODE_CLASS_MAPPINGS as _CCD_CLASS,
    NODE_DISPLAY_NAME_MAPPINGS as _CCD_NAMES,
)
from .cap_size_settings import (
    NODE_CLASS_MAPPINGS as _CSS_CLASS,
    NODE_DISPLAY_NAME_MAPPINGS as _CSS_NAMES,
)
from .cap_format_json import (
    NODE_CLASS_MAPPINGS as _CFJ_CLASS,
    NODE_DISPLAY_NAME_MAPPINGS as _CFJ_NAMES,
)
from .cap_show_anything import CAP_ShowAnything
from .cap_prompt_group import (
    NODE_CLASS_MAPPINGS as _CPG_CLASS,
    NODE_DISPLAY_NAME_MAPPINGS as _CPG_NAMES,
)
from .cap_minimax_h3 import (
    NODE_CLASS_MAPPINGS as _CMH_CLASS,
    NODE_DISPLAY_NAME_MAPPINGS as _CMH_NAMES,
)
from .cap_clip_prompt_vl import (
    NODE_CLASS_MAPPINGS as _CVP_CLASS,
    NODE_DISPLAY_NAME_MAPPINGS as _CVP_NAMES,
    clear_clip_prompt_vl,
)
from .cap_join_strings import CAP_JoinStrings
from .timecode import (
    AUDIO_EXTENSIONS,
    IMAGE_EXTENSIONS,
    VIDEO_EXTENSIONS,
    list_audio_files_ordered,
    list_keyframe_files_ordered,
    list_timeline_uploaded_files,
    list_video_files_ordered,
    resolve_assets_dir,
)

WEB_DIRECTORY = "./js"

NODE_CLASS_MAPPINGS = {
    "CAP_RichPromptInput": CAP_RichPromptInput,
    **_CAT_CLASS,
    **_CDP_CLASS,
    **_STV_CLASS,
    **_CCV_CLASS,
    **_CTE_CLASS,
    **_CSI_CLASS,
    **_CIB_CLASS,
    **_CLD_CLASS,
    **_CCD_CLASS,
    **_CSS_CLASS,
    **_CFJ_CLASS,
    "CAP_ShowAnything": CAP_ShowAnything,
    **_CPG_CLASS,
    **_CMH_CLASS,
    **_CVP_CLASS,
    "CAP_JoinStrings": CAP_JoinStrings,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CAP_RichPromptInput": "Rich Prompt Input",
    **_CAT_NAMES,
    **_CDP_NAMES,
    **_STV_NAMES,
    **_CCV_NAMES,
    **_CTE_NAMES,
    **_CSI_NAMES,
    **_CIB_NAMES,
    **_CLD_NAMES,
    **_CCD_NAMES,
    **_CSS_NAMES,
    **_CFJ_NAMES,
    "CAP_ShowAnything": "Show Anything",
    **_CPG_NAMES,
    **_CMH_NAMES,
    **_CVP_NAMES,
    "CAP_JoinStrings": "Join Strings",
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
        server = getattr(PromptServer, "instance", None)
        routes = server.routes
    except Exception:
        logging.warning("[CapricorncdTools] PromptServer not available; API routes skipped.")
        return

    @routes.get("/audio_keyframe_timeline/uploaded")
    async def api_list_uploaded(request: web.Request) -> web.Response:
        kind = request.rel_url.query.get("kind", "image")
        files = list_timeline_uploaded_files(kind)
        return web.json_response({"files": files, "count": len(files)})

    @routes.get("/audio_keyframe_timeline/keyframes")
    async def api_list_keyframes(request: web.Request) -> web.Response:
        directory = request.rel_url.query.get("dir", "")
        resolved = resolve_assets_dir(directory)
        files = list_keyframe_files_ordered(directory)
        return web.json_response({"files": files, "resolved_dir": resolved, "count": len(files)})

    @routes.get("/audio_keyframe_timeline/keyframe_image")
    async def api_keyframe_image(request: web.Request) -> web.Response:
        lang = resolve_lang(request)
        directory = request.rel_url.query.get("dir", "")
        name = request.rel_url.query.get("name", "")
        resolved = resolve_assets_dir(directory)
        if not resolved or not name:
            return web.Response(status=400, text=t("missing_dir_or_name", lang))
        path = _safe_join(resolved, name)
        if not path:
            return web.Response(status=400, text=t("invalid_filename", lang))
        _, ext = os.path.splitext(path)
        if ext.lower() not in IMAGE_EXTENSIONS:
            return web.Response(status=400, text=t("unsupported_file_type", lang))
        if not os.path.isfile(path):
            return web.Response(status=404, text=t("not_found", lang))
        return web.FileResponse(path)

    @routes.get("/audio_keyframe_timeline/videos")
    async def api_list_videos(request: web.Request) -> web.Response:
        directory = request.rel_url.query.get("dir", "")
        resolved = resolve_assets_dir(directory)
        files = list_video_files_ordered(directory)
        return web.json_response({"files": files, "resolved_dir": resolved, "count": len(files)})

    @routes.get("/audio_keyframe_timeline/keyframe_video")
    async def api_keyframe_video(request: web.Request) -> web.Response:
        lang = resolve_lang(request)
        directory = request.rel_url.query.get("dir", "")
        name = request.rel_url.query.get("name", "")
        resolved = resolve_assets_dir(directory)
        if not resolved or not name:
            return web.Response(status=400, text=t("missing_dir_or_name", lang))
        path = _safe_join(resolved, name)
        if not path:
            return web.Response(status=400, text=t("invalid_filename", lang))
        _, ext = os.path.splitext(path)
        if ext.lower() not in VIDEO_EXTENSIONS:
            return web.Response(status=400, text=t("unsupported_file_type", lang))
        if not os.path.isfile(path):
            return web.Response(status=404, text=t("not_found", lang))
        return web.FileResponse(path)

    @routes.get("/audio_keyframe_timeline/audios")
    async def api_list_audios(request: web.Request) -> web.Response:
        directory = request.rel_url.query.get("dir", "")
        resolved = resolve_assets_dir(directory)
        files = list_audio_files_ordered(directory)
        return web.json_response({"files": files, "resolved_dir": resolved, "count": len(files)})

    @routes.get("/audio_keyframe_timeline/keyframe_audio")
    async def api_keyframe_audio(request: web.Request) -> web.Response:
        lang = resolve_lang(request)
        directory = request.rel_url.query.get("dir", "")
        name = request.rel_url.query.get("name", "")
        resolved = resolve_assets_dir(directory)
        if not resolved or not name:
            return web.Response(status=400, text=t("missing_dir_or_name", lang))
        path = _safe_join(resolved, name)
        if not path:
            return web.Response(status=400, text=t("invalid_filename", lang))
        _, ext = os.path.splitext(path)
        if ext.lower() not in AUDIO_EXTENSIONS:
            return web.Response(status=400, text=t("unsupported_file_type", lang))
        if not os.path.isfile(path):
            return web.Response(status=404, text=t("not_found", lang))
        return web.FileResponse(path)

    def _asset_kind(kind: str):
        table = {
            "image": ("images", IMAGE_EXTENSIONS),
            "video": ("videos", VIDEO_EXTENSIONS),
            "audio": ("audios", AUDIO_EXTENSIONS),
        }
        return table.get(kind)

    def _unique_destination(directory: str, filename: str) -> str:
        os.makedirs(directory, exist_ok=True)
        filename = os.path.basename(filename)
        destination = os.path.join(directory, filename)
        base, ext = os.path.splitext(filename)
        counter = 1
        while os.path.exists(destination):
            destination = os.path.join(directory, f"{base}_{counter}{ext}")
            counter += 1
        return destination

    @routes.get("/audio_keyframe_timeline/asset_status")
    async def api_asset_status(request: web.Request) -> web.Response:
        import folder_paths as _fp
        lang = resolve_lang(request)
        directory = request.rel_url.query.get("dir", "")
        name = request.rel_url.query.get("name", "")
        kind = request.rel_url.query.get("kind", "")
        spec = _asset_kind(kind)
        if not name or not spec or os.path.splitext(name)[1].lower() not in spec[1]:
            return web.json_response({"error": t("invalid_asset", lang)}, status=400)
        assets_path = _safe_join(resolve_assets_dir(directory), name) if directory else None
        input_path = _safe_join(_fp.get_input_directory(), name)
        return web.json_response({
            "assets_exists": bool(assets_path and os.path.isfile(assets_path)),
            "input_exists": bool(input_path and os.path.isfile(input_path)),
        })

    @routes.get("/audio_keyframe_timeline/asset_file")
    async def api_asset_file(request: web.Request) -> web.Response:
        import folder_paths as _fp
        lang = resolve_lang(request)
        directory = request.rel_url.query.get("dir", "")
        name = request.rel_url.query.get("name", "")
        kind = request.rel_url.query.get("kind", "")
        location = request.rel_url.query.get("location", "assets")
        spec = _asset_kind(kind)
        if not name or not spec or os.path.splitext(name)[1].lower() not in spec[1]:
            return web.Response(status=400, text=t("invalid_asset", lang))
        base = _fp.get_input_directory() if location == "input" else resolve_assets_dir(directory)
        path = _safe_join(base, name) if base else None
        if not path or not os.path.isfile(path):
            return web.Response(status=404, text=t("not_found", lang))
        return web.FileResponse(path)

    @routes.post("/audio_keyframe_timeline/import_asset")
    async def api_import_asset(request: web.Request) -> web.Response:
        import folder_paths as _fp
        lang = resolve_lang(request)
        try:
            reader = await request.multipart()
            values = {}
            upload = None
            while field := await reader.next():
                if field.name == "file":
                    upload = field
                    break
                values[field.name] = await field.text()
            kind = values.get("kind", "")
            spec = _asset_kind(kind)
            filename = os.path.basename(upload.filename or "") if upload else ""
            if not upload or not spec or os.path.splitext(filename)[1].lower() not in spec[1]:
                return web.json_response({"error": t("unsupported_or_missing_file", lang)}, status=400)
            to_assets = values.get("to_assets") == "true"
            if to_assets:
                root = resolve_assets_dir(values.get("dir", ""))
                if not root:
                    return web.json_response({"error": t("assets_dir_not_configured", lang)}, status=400)
                subdir = spec[0]
                destination = _unique_destination(os.path.join(root, subdir), filename)
                location = "assets"
                result_name = os.path.relpath(destination, root).replace(os.sep, "/")
            else:
                root = _fp.get_input_directory()
                subdir = f"capricorncd-timeline/{spec[0]}"
                destination = _unique_destination(os.path.join(root, subdir), filename)
                location = "input"
                result_name = os.path.relpath(destination, root).replace(os.sep, "/")
            with open(destination, "wb") as stream:
                while chunk := await upload.read_chunk(65536):
                    stream.write(chunk)
            return web.json_response({"file": result_name, "kind": kind, "location": location})
        except Exception as exc:
            logging.exception("[CapricorncdTools] import_asset error")
            return web.json_response({"error": str(exc)}, status=500)

    @routes.post("/audio_keyframe_timeline/delete_asset")
    async def api_delete_asset(request: web.Request) -> web.Response:
        import folder_paths as _fp
        lang = resolve_lang(request)
        try:
            data = await request.json()
            name = str(data.get("name", "")).strip().replace("\\", "/")
            kind = str(data.get("kind", ""))
            spec = _asset_kind(kind)
            if not name or not spec or os.path.splitext(name)[1].lower() not in spec[1]:
                return web.json_response({"error": t("invalid_asset", lang)}, status=400)
            # Only allow deleting Timeline Editor uploads under input/capricorncd-timeline/
            if not name.startswith("capricorncd-timeline/"):
                return web.json_response({"error": t("only_timeline_uploads_deletable", lang)}, status=400)
            path = _safe_join(_fp.get_input_directory(), name)
            if not path or not os.path.isfile(path):
                return web.json_response({"ok": True, "deleted": False, "missing": True})
            os.remove(path)
            return web.json_response({"ok": True, "deleted": True})
        except Exception as exc:
            logging.exception("[CapricorncdTools] delete_asset error")
            return web.json_response({"error": str(exc)}, status=500)

    @routes.post("/audio_keyframe_timeline/move_asset")
    async def api_move_asset(request: web.Request) -> web.Response:
        import folder_paths as _fp
        lang = resolve_lang(request)
        try:
            data = await request.json()
            name, kind = str(data.get("name", "")), str(data.get("kind", ""))
            spec = _asset_kind(kind)
            root = resolve_assets_dir(str(data.get("dir", "")))
            source = _safe_join(_fp.get_input_directory(), name)
            if not spec or not root or not source or not os.path.isfile(source):
                return web.json_response({"error": t("input_asset_not_found", lang)}, status=404)
            destination = _unique_destination(os.path.join(root, spec[0]), os.path.basename(name))
            shutil.move(source, destination)
            result_name = os.path.relpath(destination, root).replace(os.sep, "/")
            return web.json_response({"file": result_name, "kind": kind, "location": "assets"})
        except Exception as exc:
            logging.exception("[CapricorncdTools] move_asset error")
            return web.json_response({"error": str(exc)}, status=500)

    @routes.post("/audio_keyframe_timeline/export_prepare")
    async def api_export_prepare(request: web.Request) -> web.Response:
        from .cap_timeline_project_io import build_export_entries
        lang = resolve_lang(request)
        try:
            project = await request.json()
            if not isinstance(project, dict):
                return web.json_response({"error": t("invalid_project", lang)}, status=400)
            exported, entries, missing = build_export_entries(project)
            return web.json_response({
                "project": exported,
                "files": [
                    {
                        "kind": e["kind"],
                        "file": e["file"],
                        "arcname": e["arcname"],
                        "location": e.get("location") or "input",
                    }
                    for e in entries
                ],
                "missing": missing,
            })
        except Exception as exc:
            logging.exception("[CapricorncdTools] export_prepare error")
            return web.json_response({"error": str(exc)}, status=500)

    @routes.post("/audio_keyframe_timeline/export_zip")
    async def api_export_zip(request: web.Request) -> web.Response:
        from .cap_timeline_project_io import build_export_zip_bytes
        lang = resolve_lang(request)
        try:
            project = await request.json()
            if not isinstance(project, dict):
                return web.json_response({"error": t("invalid_project", lang)}, status=400)
            data, filename, missing = build_export_zip_bytes(project)
            headers = {
                "Content-Disposition": 'attachment; filename="timeline-project.zip"',
                "X-Export-Missing": ",".join(missing) if missing else "",
                "X-Export-Filename": filename,
            }
            return web.Response(body=data, headers=headers, content_type="application/zip")
        except Exception as exc:
            logging.exception("[CapricorncdTools] export_zip error")
            return web.json_response({"error": str(exc)}, status=500)

    @routes.post("/audio_keyframe_timeline/compose_video")
    async def api_compose_timeline_video(request: web.Request) -> web.Response:
        from .cap_compose_timeline_export import (
            DEFAULT_COMPOSE_PREFIX,
            build_compose_filename,
            compose_to_output,
        )
        lang = resolve_lang(request)
        try:
            payload = await request.json()
            if not isinstance(payload, dict):
                return web.json_response({"error": t("invalid_payload", lang)}, status=400)
            project = payload.get("project")
            if not isinstance(project, dict):
                return web.json_response({"error": t("invalid_project", lang)}, status=400)
            filename_prefix = str(payload.get("filename_prefix") or DEFAULT_COMPOSE_PREFIX).strip()
            filename = str(payload.get("filename") or "").strip()
            if not filename:
                filename = build_compose_filename(project.get("name") or t("untitled_project", lang))
            ignore_audio_tracks = bool(payload.get("ignore_audio_tracks"))
            # Default true: keep 2nd-sample / upscaled generated frame size.
            use_generated_video_size = payload.get("use_generated_video_size")
            if use_generated_video_size is None:
                use_generated_video_size = True
            else:
                use_generated_video_size = bool(use_generated_video_size)
            watermark = payload.get("watermark")
            meta = compose_to_output(
                project,
                filename_prefix=filename_prefix,
                filename=filename,
                ignore_audio_tracks=ignore_audio_tracks,
                watermark=watermark if isinstance(watermark, dict) else None,
                use_generated_video_size=use_generated_video_size,
            )
            return web.json_response({
                "ok": True,
                "filename": meta["filename"],
                "subfolder": meta.get("subfolder") or "",
                "duration_sec": meta.get("duration_sec"),
                "video_count": meta.get("video_count"),
                "audio_count": meta.get("audio_count"),
                "width": meta.get("width"),
                "height": meta.get("height"),
                "fps": meta.get("fps"),
            })
        except ValueError as exc:
            return web.json_response({"error": str(exc)}, status=400)
        except RuntimeError as exc:
            return web.json_response({"error": str(exc)}, status=500)
        except Exception as exc:
            logging.exception("[CapricorncdTools] compose_video error")
            return web.json_response({"error": str(exc)}, status=500)

    @routes.post("/audio_keyframe_timeline/reveal_output")
    async def api_reveal_output(request: web.Request) -> web.Response:
        import folder_paths as _fp
        lang = resolve_lang(request)
        try:
            data = await request.json()
            filename = str(data.get("filename", "")).strip()
            subfolder = str(data.get("subfolder", "")).strip().strip("/")
            if not filename:
                return web.json_response({"error": t("missing_filename", lang)}, status=400)
            rel = f"{subfolder}/{filename}" if subfolder else filename
            path = _safe_join(_fp.get_output_directory(), rel)
            if not path or not os.path.isfile(path):
                return web.json_response({"error": t("file_not_found", lang)}, status=404)
            # Local desktop use only: reveals the file on the machine running
            # this ComfyUI backend, which is the same machine as the browser
            # for the standard local install this extension targets.
            if sys.platform == "win32":
                subprocess.Popen(["explorer", f"/select,{path}"])
            elif sys.platform == "darwin":
                subprocess.Popen(["open", "-R", path])
            else:
                subprocess.Popen(["xdg-open", os.path.dirname(path)])
            return web.json_response({"ok": True})
        except Exception as exc:
            logging.exception("[CapricorncdTools] reveal_output error")
            return web.json_response({"error": str(exc)}, status=500)

    @routes.post("/audio_keyframe_timeline/import_project_zip")
    async def api_import_project_zip(request: web.Request) -> web.Response:
        from .cap_timeline_project_io import import_project_from_zip_bytes
        lang = resolve_lang(request)
        try:
            reader = await request.multipart()
            upload = None
            while field := await reader.next():
                if field.name == "file":
                    upload = field
                    break
            if not upload:
                return web.json_response({"error": t("missing_file", lang)}, status=400)
            data = await upload.read()
            if not data:
                return web.json_response({"error": t("empty_zip", lang)}, status=400)
            project, warnings = import_project_from_zip_bytes(data)
            return web.json_response({"project": project, "warnings": warnings})
        except ValueError as exc:
            return web.json_response({"error": str(exc)}, status=400)
        except Exception as exc:
            logging.exception("[CapricorncdTools] import_project_zip error")
            return web.json_response({"error": str(exc)}, status=500)

    def _list_output_media(extensions: set[str], limit: int = 400) -> list[dict]:
        import folder_paths as _fp
        root = os.path.abspath(_fp.get_output_directory())
        rows = []
        try:
            for dirpath, dirnames, filenames in os.walk(root):
                dirnames[:] = [d for d in dirnames if d not in {".git", "__pycache__", "temp"}]
                for name in filenames:
                    if os.path.splitext(name)[1].lower() not in extensions:
                        continue
                    full = os.path.join(dirpath, name)
                    try:
                        mtime = os.path.getmtime(full)
                    except OSError:
                        continue
                    rel = os.path.relpath(full, root).replace("\\", "/")
                    if not rel or rel.startswith(".."):
                        continue
                    rows.append((mtime, rel))
        except OSError:
            rows = []
        rows.sort(key=lambda item: item[0], reverse=True)
        return [{"file": rel, "mtime": mtime} for mtime, rel in rows[:limit]]

    @routes.get("/audio_keyframe_timeline/output_videos")
    async def api_list_output_videos(_request: web.Request) -> web.Response:
        files = _list_output_media(VIDEO_EXTENSIONS)
        return web.json_response({"files": files, "count": len(files)})

    @routes.get("/audio_keyframe_timeline/output_audios")
    async def api_list_output_audios(_request: web.Request) -> web.Response:
        files = _list_output_media(AUDIO_EXTENSIONS)
        return web.json_response({"files": files, "count": len(files)})

    @routes.get("/audio_keyframe_timeline/vl_models")
    async def api_vl_models(_request: web.Request) -> web.Response:
        from .cap_clip_prompt_vl import SKILL_URL, list_vl_models, public_agent_configs
        models = list_vl_models()
        return web.json_response({
            "models": models,
            "agents": public_agent_configs(enabled_only=True),
            "skill_url": SKILL_URL,
        })

    @routes.get("/audio_keyframe_timeline/agents")
    async def api_timeline_agents(_request: web.Request) -> web.Response:
        from .cap_clip_prompt_vl import public_agent_configs
        return web.json_response({"agents": public_agent_configs()})

    @routes.post("/audio_keyframe_timeline/agents")
    async def api_save_timeline_agent(request: web.Request) -> web.Response:
        from .cap_clip_prompt_vl import save_agent_config
        try:
            payload = await request.json()
            if not isinstance(payload, dict):
                return web.json_response({"error": t("invalid_payload", resolve_lang(request))}, status=400)
            return web.json_response({"agent": save_agent_config(payload)})
        except ValueError as exc:
            return web.json_response({"error": str(exc)}, status=400)

    @routes.delete("/audio_keyframe_timeline/agents/{agent_id}")
    async def api_delete_timeline_agent(request: web.Request) -> web.Response:
        from .cap_clip_prompt_vl import delete_agent_config
        if not delete_agent_config(request.match_info.get("agent_id", "")):
            return web.json_response({"error": t("agent_not_found", resolve_lang(request))}, status=404)
        return web.json_response({"ok": True})

    @routes.get("/audio_keyframe_timeline/clip_prompt_agent")
    async def api_clip_prompt_agent(request: web.Request) -> web.Response:
        from .cap_clip_prompt_vl import SKILL_URL, agent_system_prompt
        agent = request.rel_url.query.get("agent", "MiniMaxH3")
        clip_role = request.rel_url.query.get("clip_role", "multi_ref")
        return web.json_response({
            "system_prompt": agent_system_prompt(agent, clip_role),
            "skill_url": SKILL_URL,
        })

    @routes.post("/audio_keyframe_timeline/optimize_clip_prompt")
    async def api_optimize_clip_prompt(request: web.Request) -> web.Response:
        import asyncio
        from .cap_clip_prompt_vl import (
            ClipPromptCancelled,
            begin_clip_prompt_job,
            generate_from_payload,
            request_cancel_clip_prompt_vl,
        )
        try:
            payload = await request.json()
            if not isinstance(payload, dict):
                return web.json_response({"error": t("invalid_payload", resolve_lang(request))}, status=400)

            job = begin_clip_prompt_job()

            async def watch_disconnect():
                try:
                    await asyncio.sleep(1.0)
                    while True:
                        transport = request.transport
                        if transport is not None and transport.is_closing():
                            request_cancel_clip_prompt_vl(job)
                            return
                        await asyncio.sleep(0.25)
                except asyncio.CancelledError:
                    return

            watcher = asyncio.create_task(watch_disconnect())
            try:
                text = await asyncio.to_thread(generate_from_payload, payload)
                return web.json_response({"prompt": text})
            except ClipPromptCancelled:
                return web.json_response({"cancelled": True}, status=499)
            except asyncio.CancelledError:
                request_cancel_clip_prompt_vl(job)
                raise
            finally:
                watcher.cancel()
        except ClipPromptCancelled:
            return web.json_response({"cancelled": True}, status=499)
        except Exception as exc:
            logging.exception("[CapricorncdTools] optimize_clip_prompt error")
            return web.json_response({"error": str(exc)}, status=500)

    @routes.get("/audio_keyframe_timeline/h3_skills")
    async def api_h3_skills(_request: web.Request) -> web.Response:
        from .cap_h3_skills import SKILL_REPO_URL, list_h3_skills, skill_repo_root
        skills = list_h3_skills()
        return web.json_response({
            "skills": skills,
            "repo_url": SKILL_REPO_URL,
            "available": skill_repo_root().is_dir() and bool(skills),
        })

    @routes.get("/audio_keyframe_timeline/h3_skill")
    async def api_h3_skill(request: web.Request) -> web.Response:
        from .cap_h3_skills import load_skill_text
        lang = resolve_lang(request)
        skill_id = request.rel_url.query.get("id", "")
        try:
            text = load_skill_text(skill_id)
        except ValueError:
            return web.json_response({"error": t("invalid_skill", lang)}, status=400)
        except FileNotFoundError:
            return web.json_response({"error": t("skill_not_found", lang)}, status=404)
        return web.json_response({"id": skill_id, "text": text})

    @routes.get("/audio_keyframe_timeline/h3_skill_preview")
    async def api_h3_skill_preview(request: web.Request) -> web.Response:
        from .cap_h3_skills import resolve_skill_preview
        lang = resolve_lang(request)
        skill_id = request.rel_url.query.get("id", "")
        try:
            path = resolve_skill_preview(skill_id)
        except ValueError:
            return web.Response(status=400, text=t("invalid_skill", lang))
        if not path:
            return web.Response(status=404, text=t("not_found", lang))
        return web.FileResponse(path)

    @routes.post("/audio_keyframe_timeline/h3_skills_sync")
    async def api_h3_skills_sync(_request: web.Request) -> web.Response:
        import asyncio
        from .cap_h3_skills import sync_skill_repo
        resolve_lang(_request)  # keeps get_last_known_lang() fresh for errors raised inside sync_skill_repo()
        try:
            data = await asyncio.to_thread(sync_skill_repo)
            return web.json_response(data)
        except Exception as exc:
            logging.exception("[CapricorncdTools] h3_skills_sync error")
            return web.json_response({"error": str(exc)}, status=500)

    @routes.get("/audio_keyframe_timeline/system_fonts")
    async def api_system_fonts(_request: web.Request) -> web.Response:
        import asyncio
        from .cap_watermark import list_system_fonts
        try:
            fonts = await asyncio.to_thread(list_system_fonts)
            return web.json_response({"fonts": list(fonts)})
        except Exception as exc:
            logging.exception("[CapricorncdTools] system_fonts error")
            return web.json_response({"error": str(exc)}, status=500)

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
                return web.json_response({"error": t("missing_image_field", resolve_lang(request))}, status=400)
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

    def _unload_vl_before_prompt(json_data):
        clear_clip_prompt_vl()
        return json_data

    server.add_on_prompt_handler(_unload_vl_before_prompt)
    logging.info("[CapricorncdTools] Registered API routes.")


try:
    _register_routes()
except Exception:
    logging.exception("[CapricorncdTools] API route registration failed")
