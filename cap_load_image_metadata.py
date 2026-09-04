import asyncio
import base64
import json
import os
import subprocess
from datetime import datetime, timezone

from aiohttp import web
from PIL import Image, ExifTags

import folder_paths
from nodes import LoadImage
from .timecode import AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, _safe_join, resolve_assets_dir


def _json_value(value):
    if isinstance(value, bytes):
        return {"encoding": "base64", "data": base64.b64encode(value).decode("ascii")}
    if isinstance(value, dict):
        return {str(key): _json_value(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [_json_value(item) for item in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def _text(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return json.dumps(_json_value(value), ensure_ascii=False, indent=2)


def read_image_metadata(path):
    with Image.open(path) as image:
        # PNG iTXt may follow IDAT. Image.open().info alone misses those fields.
        image.load()
        info = dict(image.info)
        exif = image.getexif()
        exif_values = {str(key): {"name": ExifTags.TAGS.get(key, str(key)), "value": _json_value(value)}
                       for key, value in exif.items()}
        for tag in (34665, 34853):  # EXIF and GPS sub-IFDs; original EXIF bytes remain in info.
            if tag in exif:
                exif_values[str(tag)]["entries"] = _json_value(exif.get_ifd(tag))
        raw = {"format": image.format, "size": list(image.size), "mode": image.mode,
               "info": _json_value(info), "exif": exif_values}

    record = info.get("ImageAssetMetadata", {})
    if isinstance(record, str):
        try:
            record = json.loads(record)
        except (ValueError, RecursionError):
            record = {}
    if not isinstance(record, dict):
        record = {}

    # Canonical fields are authoritative, including explicit null (unknown prompt).
    prompt = record.get("generation_prompt") if "generation_prompt" in record else next(
        (info[key] for key in ("GenerationPrompt", "generation_prompt", "parameters", "prompt") if info.get(key)), "")
    description = record.get("setting_description") if "setting_description" in record else next(
        (info[key] for key in ("Description", "description", "ImageDescription") if info.get(key)),
        exif.get(270, ""))
    return {"prompt": _text(prompt), "description": _text(description),
            "raw": json.dumps(raw, ensure_ascii=False, indent=2)}


class CAP_LoadImageMetadata(LoadImage):
    CATEGORY = "Capricorncd"
    RETURN_TYPES = ("IMAGE", "MASK", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("image", "mask", "prompt", "description", "raw")
    OUTPUT_NODE = True
    DESCRIPTION = "加载图像并读取提示词、设定描述及全部元数据；缺失文字输出为空。"
    SEARCH_ALIASES = ["加载图像", "提示词", "描述", "metadata", "load image"]

    def load_image(self, image):
        path = folder_paths.get_annotated_filepath(image)
        pixels, mask = super().load_image(image)
        metadata = read_image_metadata(path)
        return {"ui": {"prompt": [metadata["prompt"]], "description": [metadata["description"]]},
                "result": (pixels, mask, metadata["prompt"], metadata["description"], metadata["raw"])}


def read_asset_metadata(path, kind):
    stat = os.stat(path)
    created = getattr(stat, "st_birthtime", stat.st_ctime if os.name == "nt" else None)
    result = {
        "path": path, "size_bytes": stat.st_size,
        "created_at": datetime.fromtimestamp(created, timezone.utc).isoformat() if created is not None else None,
        "modified_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
        "prompt": "", "description": "", "raw": "",
    }
    try:
        if kind == "image":
            result.update(read_image_metadata(path))
        else:
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe", "-show_format", "-show_streams", "-of", "json", path],
                capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
            if probe.returncode:
                raise ValueError(probe.stderr.strip() or "ffprobe failed")
            raw = json.loads(probe.stdout)
            tags = {key.lower(): value for key, value in raw.get("format", {}).get("tags", {}).items()}
            result.update(prompt=_text(tags.get("generationprompt", tags.get("prompt", ""))),
                          description=_text(tags.get("description", tags.get("comment", ""))),
                          raw=json.dumps(raw, ensure_ascii=False, indent=2))
    except (OSError, ValueError, subprocess.TimeoutExpired, Image.DecompressionBombError) as error:
        result["metadata_error"] = str(error)
    return result


def register_metadata_routes(routes):
    @routes.get("/audio_keyframe_timeline/asset_metadata")
    async def asset_metadata(request):
        kind = request.query.get("kind", "")
        name = request.query.get("name", "")
        location = request.query.get("location", "input")
        extensions = {"image": IMAGE_EXTENSIONS, "video": VIDEO_EXTENSIONS, "audio": AUDIO_EXTENSIONS}
        if kind not in extensions or os.path.splitext(name)[1].lower() not in extensions[kind] or location not in ("input", "assets"):
            return web.json_response({"error": "Invalid asset"}, status=400)
        base = folder_paths.get_input_directory() if location == "input" else resolve_assets_dir(request.query.get("dir", ""))
        path = _safe_join(base, name) if base else None
        if not path or not os.path.isfile(path):
            return web.json_response({"error": "File not found"}, status=404)
        try:
            metadata = await asyncio.to_thread(read_asset_metadata, path, kind)
        except OSError as error:
            return web.json_response({"error": str(error)}, status=400)
        if request.query.get("raw") != "1":
            metadata.pop("raw")
        return web.json_response(metadata)

    @routes.get("/cap/image_metadata")
    async def image_metadata(request):
        try:
            path = folder_paths.get_annotated_filepath(request.query.get("image", ""))
            metadata = await asyncio.to_thread(read_image_metadata, path)
            return web.json_response({"prompt": metadata["prompt"], "description": metadata["description"]})
        except (OSError, ValueError, Image.DecompressionBombError):
            return web.json_response({"error": "无法读取图片元数据，请检查所选图片。"}, status=400)


NODE_CLASS_MAPPINGS = {"CAP_LoadImageMetadata": CAP_LoadImageMetadata}
NODE_DISPLAY_NAME_MAPPINGS = {"CAP_LoadImageMetadata": "加载图像（提示词 / 描述） · Cap"}
