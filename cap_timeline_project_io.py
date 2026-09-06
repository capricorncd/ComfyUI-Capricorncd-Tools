"""Timeline Editor project package export / import (media + project.json)."""

from __future__ import annotations

import hashlib
import io
import json
import os
import re
import zipfile

from .cap_i18n import get_last_known_lang, t as _t
from .timecode import AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, resolve_media_path

PACKAGE_PROJECT_NAME = "project.json"
PACKAGE_MEDIA_ROOT = "media"
PACKAGE_GENERATED_SUBDIR = "generated"
KIND_SUBDIR = {"image": "images", "video": "videos", "audio": "audios"}


def _read_schema_version() -> int:
    path = os.path.join(os.path.dirname(__file__), "pyproject.toml")
    try:
        with open(path, "r", encoding="utf-8") as stream:
            text = stream.read()
    except OSError as exc:
        raise RuntimeError(f"Unable to read timeline schema version from {path}") from exc
    match = re.search(r"(?ms)^\[tool\.capricorncd\]\s*$.*?^schema_version\s*=\s*(\d+)\s*$", text)
    if not match or int(match.group(1)) < 1:
        raise RuntimeError("pyproject.toml must define [tool.capricorncd] schema_version >= 1")
    return int(match.group(1))


# Integer document shape. Independent of the Python package version.
SCHEMA_VERSION = _read_schema_version()


def parse_schema_version(project) -> int:
    raw = project.get("schema_version") if isinstance(project, dict) else None
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return 1
    return n if n >= 1 else 1


def _media_id_for(kind: str, file: str) -> str:
    digest = hashlib.sha1(f"{kind}:{file}".encode("utf-8")).hexdigest()[:10]
    return f"md_{digest}"


def _norm_kind(kind) -> str:
    kind = str(kind or "").lower().strip()
    return kind if kind in KIND_SUBDIR else ""


def _norm_file(file) -> str:
    return str(file or "").strip().replace("\\", "/")


def _norm_generated_file(file) -> str:
    """Normalize a generated-video path to output-relative form.

    Strips absolute/ComfyUI ``.../output/`` prefixes and package paths
    ``media/generated/`` so export arcnames resolve under output/.
    """
    s = _norm_file(file).lstrip("/")
    marker = "/output/"
    idx = s.lower().rfind(marker)
    if idx >= 0:
        s = s[idx + len(marker) :]
    s = s.lstrip("/")
    pkg = f"{PACKAGE_MEDIA_ROOT}/{PACKAGE_GENERATED_SUBDIR}/"
    if s.lower().startswith(pkg):
        s = s[len(pkg) :]
    return s.lstrip("/")


def _resolve_output_file(rel: str) -> str:
    """Resolve an output-relative path under ComfyUI output/. Returns '' if missing."""
    import folder_paths

    rel = _norm_generated_file(rel)
    if not rel or ".." in rel.split("/"):
        return ""
    root = os.path.abspath(folder_paths.get_output_directory())
    path = os.path.abspath(os.path.join(root, *rel.split("/")))
    if path != root and not path.startswith(root + os.sep):
        return ""
    return path if os.path.isfile(path) else ""


def _catalog_map(project: dict) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for row in project.get("media") or []:
        if isinstance(row, dict) and row.get("id"):
            out[str(row["id"])] = row
    return out


def resolve_clip_media(project: dict, clip: dict) -> list[dict]:
    """Return ordered media rows referenced by a clip (schema 2 or legacy)."""
    if not isinstance(clip, dict):
        return []
    catalog = _catalog_map(project if isinstance(project, dict) else {})
    rows: list[dict] = []
    seen: set[str] = set()

    def add_row(row: dict | None) -> None:
        if not isinstance(row, dict):
            return
        kind = _norm_kind(row.get("kind"))
        file = _norm_file(row.get("file"))
        mid = str(row.get("id") or "")
        key = mid or (f"{kind}:{file}" if kind and file else "")
        if not key or key in seen:
            return
        seen.add(key)
        rows.append(row)

    ids = clip.get("media_ids")
    if isinstance(ids, list) and ids:
        for media_id in ids:
            add_row(catalog.get(str(media_id)))
        if rows:
            return rows

    source = clip.get("source") if isinstance(clip.get("source"), dict) else {}
    items = clip.get("items") if isinstance(clip.get("items"), list) else []
    for item in items:
        if not isinstance(item, dict):
            continue
        mid = str(item.get("id") or "")
        if mid and mid in catalog:
            add_row(catalog[mid])
            continue
        kind = _norm_kind(item.get("kind") or "image")
        file = _norm_file(item.get("file") or item.get("src"))
        if kind and file:
            add_row({"id": mid or _media_id_for(kind, file), "kind": kind, "file": file})
    if rows:
        return rows

    kind = _norm_kind(source.get("kind") or clip.get("type") or "image")
    file = _norm_file(source.get("file") or clip.get("start_image") or clip.get("audio_file") or clip.get("src"))
    if kind and file:
        add_row(catalog.get(_media_id_for(kind, file)) or {"kind": kind, "file": file, "id": _media_id_for(kind, file)})
    end_image = _norm_file(clip.get("end_image"))
    if end_image:
        add_row(catalog.get(_media_id_for("image", end_image)) or {
            "kind": "image", "file": end_image, "id": _media_id_for("image", end_image),
        })
    return rows


def migrate_project(project: dict) -> dict:
    """Normalize a project document to SCHEMA_VERSION, converting legacy shapes."""
    if not isinstance(project, dict):
        return {
            "schema_version": SCHEMA_VERSION,
            "name": "Untitled Project",
            "media": [],
            "settings": {},
            "tracks": [],
        }
    out = json.loads(json.dumps(project, ensure_ascii=False))
    if parse_schema_version(out) < 2:
        _migrate_schema_1_to_2(out)
    if parse_schema_version(out) < 3:
        _migrate_schema_2_to_3(out)
    _migrate_setting_prompts(out)
    _normalize_h3_prompt_fields(out)
    _normalize_timeline_prompt_selection(out)
    _normalize_media_catalog(out)
    _ensure_clip_media_ids(out)
    out["schema_version"] = SCHEMA_VERSION
    return out


def _join_prompt_parts(*values) -> str:
    parts: list[str] = []
    for value in values:
        text = str(value or "").strip()
        if text and text not in parts:
            parts.append(text)
    return "\n\n".join(parts)


def _legacy_setting_prompt(settings: dict, key: str) -> str:
    text = str(settings.get(key) or "").strip()
    prefix = str(settings.get(f"{key}_prefix_line") or "").strip()
    if key == "non_diegetic_music" and prefix == "non_diegetic_music:":
        prefix = ""
    if key == "style_prompt" and prefix in {
        "(填写MiniMax H3规范里的风格提示词英文：)",
        "MiniMax H3规范里的风格提示词英文标题",
    }:
        prefix = "Style opening:"
    if not text or not prefix or text.startswith(prefix):
        return text
    return f"{prefix}\n\n{text}"


def _migrate_setting_prompts(project: dict) -> None:
    settings = project.setdefault("settings", {})
    if not isinstance(settings, dict):
        settings = {}
        project["settings"] = settings
    settings["prepend_prompt"] = _join_prompt_parts(
        settings.get("prepend_prompt"),
        settings.get("prefix_prompt"),
        settings.get("prompt_prefix"),
        _legacy_setting_prompt(settings, "global_prompt"),
        _legacy_setting_prompt(settings, "style_prompt"),
    )
    settings["append_prompt"] = _join_prompt_parts(
        settings.get("append_prompt"),
        settings.get("suffix_prompt"),
        settings.get("prompt_suffix"),
        _legacy_setting_prompt(settings, "non_diegetic_music"),
        _legacy_setting_prompt(settings, "negative_prompt"),
    )
    for key in ("global_prompt", "style_prompt", "non_diegetic_music", "negative_prompt"):
        settings.pop(key, None)
        settings.pop(f"{key}_prefix_line", None)
    for key in ("prefix_prompt", "prompt_prefix", "suffix_prompt", "prompt_suffix"):
        settings.pop(key, None)


def _normalize_timeline_prompt_selection(project: dict) -> None:
    allowed = ("clip", "detailed_description", "media")
    settings = project.get("settings")
    if isinstance(settings, dict):
        raw_order = settings.get("prompt_concat_order")
        order = []
        if isinstance(raw_order, list):
            for value in raw_order:
                key = "detailed_description" if str(value) == "ai" else str(value)
                if key in allowed and key not in order:
                    order.append(key)
        settings["prompt_concat_order"] = order + [key for key in allowed if key not in order]
    for track in project.get("tracks") or []:
        if not isinstance(track, dict):
            continue
        for clip in track.get("clips") or []:
            if not isinstance(clip, dict):
                continue
            raw = clip.get("prompt_includes")
            selected = set()
            if isinstance(raw, list):
                for value in raw:
                    key = "detailed_description" if str(value) == "ai" else str(value)
                    if key in allowed:
                        selected.add(key)
                includes = [key for key in allowed if key in selected]
            else:
                includes = ["clip"]
                if clip.get("use_ai_prompt", True) is not False:
                    includes.append("detailed_description")
            clip["prompt_includes"] = includes
            clip.pop("use_global_prompt", None)
            clip.pop("use_ai_prompt", None)


def _split_h3_prompt(value: str) -> tuple[str, str, str] | None:
    text = str(value or "").strip()
    matches = list(re.finditer(
        r"^(subject_definitions|summary|retention_analysis|detailed_description|overall_soundscape|non_diegetic_music)\s*:\s*",
        text,
        re.IGNORECASE | re.MULTILINE,
    ))
    sections: dict[str, str] = {}
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        sections[match.group(1).lower()] = text[match.end():end].strip()
    clip_keys = ("subject_definitions", "summary", "retention_analysis")
    if not all(sections.get(key) for key in clip_keys) or not sections.get("detailed_description"):
        return None
    prompt = "\n\n".join(f"{key}:\n{sections[key]}" for key in clip_keys)
    sound = "\n\n".join(
        f"{key}:\n{sections[key]}"
        for key in ("overall_soundscape", "non_diegetic_music")
        if sections.get(key)
    )
    return prompt, sections["detailed_description"], sound


def _normalize_h3_prompt_fields(project: dict) -> None:
    settings = project.setdefault("settings", {})
    for track in project.get("tracks") or []:
        if not isinstance(track, dict):
            continue
        for clip in track.get("clips") or []:
            if not isinstance(clip, dict):
                continue
            split = _split_h3_prompt(clip.get("detailed_description") or "")
            if not split:
                continue
            h3_prompt, detailed_description, sound = split
            current_prompt = str(clip.get("prompt") or "").strip()
            if not current_prompt:
                clip["prompt"] = h3_prompt
            elif h3_prompt not in current_prompt:
                clip["prompt"] = f"{h3_prompt}\n\n{current_prompt}"
            clip["detailed_description"] = detailed_description
            includes = clip.get("prompt_includes")
            if isinstance(includes, list):
                for key in ("clip", "detailed_description"):
                    if key not in includes:
                        includes.append(key)
            current_sound = str(settings.get("append_prompt") or "").strip()
            if sound and not current_sound:
                settings["append_prompt"] = sound
            elif sound and sound not in current_sound:
                settings["append_prompt"] = f"{sound}\n\n{current_sound}"


def _migrate_schema_2_to_3(project: dict) -> None:
    for track in project.get("tracks") or []:
        if not isinstance(track, dict):
            continue
        for clip in track.get("clips") or []:
            if not isinstance(clip, dict):
                continue
            if "detailed_description" not in clip and "ai_prompt" in clip:
                legacy_prompt = clip.get("ai_prompt") or ""
                split = _split_h3_prompt(legacy_prompt)
                if split:
                    h3_prompt, detailed_description, sound = split
                    current_prompt = str(clip.get("prompt") or "").strip()
                    clip["prompt"] = h3_prompt if not current_prompt else f"{h3_prompt}\n\n{current_prompt}"
                    clip["detailed_description"] = detailed_description
                    settings = project.setdefault("settings", {})
                    current_sound = str(settings.get("append_prompt") or "").strip()
                    if sound and not current_sound:
                        settings["append_prompt"] = sound
                    elif sound and sound not in current_sound:
                        settings["append_prompt"] = f"{sound}\n\n{current_sound}"
                else:
                    clip["detailed_description"] = legacy_prompt
            clip.pop("ai_prompt", None)
            includes = clip.get("prompt_includes")
            if isinstance(includes, list):
                clip["prompt_includes"] = [
                    "detailed_description" if str(value) == "ai" else value
                    for value in includes
                ]


def _migrate_schema_1_to_2(project: dict) -> None:
    by_key: dict[str, dict] = {}
    media: list[dict] = []

    def add(kind, file, location="input") -> dict | None:
        kind = _norm_kind(kind)
        file = _norm_file(file)
        if not kind or not file:
            return None
        key = f"{kind}:{file}"
        if key in by_key:
            return by_key[key]
        row = {
            "id": _media_id_for(kind, file),
            "kind": kind,
            "file": file,
            "location": "input",
            "name": os.path.basename(file),
            "prompt": "",
            "generation_prompt": "",
            "setting_description": "",
            "media_type": "",
            "tags": [],
        }
        loc = str(location or "input")
        if loc:
            row["location"] = loc
        by_key[key] = row
        media.append(row)
        return row

    for resource in list(project.get("media") or []) + list(project.get("resources") or []):
        if isinstance(resource, dict):
            add(resource.get("kind"), resource.get("file"), resource.get("location"))
            prompt = resource.get("prompt")
            generation_prompt = resource.get("generation_prompt") or resource.get("generationPrompt")
            setting_description = resource.get("setting_description") or resource.get("settingDescription")
            media_type = resource.get("media_type") or resource.get("mediaType")
            tags = resource.get("tags")
            stars = resource.get("stars")
            row = by_key.get(f"{_norm_kind(resource.get('kind'))}:{_norm_file(resource.get('file'))}")
            if row:
                if isinstance(prompt, str):
                    row["prompt"] = prompt
                if isinstance(generation_prompt, str):
                    row["generation_prompt"] = generation_prompt
                if isinstance(setting_description, str):
                    row["setting_description"] = setting_description
                if isinstance(media_type, str):
                    row["media_type"] = media_type.strip()
                if isinstance(tags, list):
                    row["tags"] = [str(t).strip() for t in tags if str(t).strip()]
                try:
                    n = int(stars)
                    if 1 <= n <= 5:
                        row["stars"] = n
                except (TypeError, ValueError):
                    pass

    for track in project.get("tracks") or []:
        if not isinstance(track, dict):
            continue
        track_type = str(track.get("type") or "visual").lower()
        for clip in track.get("clips") or []:
            if not isinstance(clip, dict):
                continue
            source = clip.get("source") if isinstance(clip.get("source"), dict) else {}
            clip_type = str(clip.get("type") or ("audio" if track_type == "audio" else "image")).lower()
            is_audio = clip_type == "audio" or track_type == "audio"
            refs: list[dict] = []
            items = clip.get("items") if isinstance(clip.get("items"), list) else []
            for item in items:
                if isinstance(item, dict):
                    row = add(item.get("kind") or "image", item.get("file") or item.get("src"))
                elif isinstance(item, str):
                    row = add("image", item)
                else:
                    row = None
                if row:
                    refs.append(row)
            if not refs:
                kind = "audio" if is_audio else ("video" if clip_type == "video" else "image")
                row = add(kind, source.get("file") or clip.get("start_image") or clip.get("audio_file") or clip.get("src"), source.get("location"))
                if row:
                    refs.append(row)
                if not is_audio:
                    end_row = add("image", clip.get("end_image"))
                    if end_row and end_row not in refs:
                        refs.append(end_row)
            clip["media_ids"] = [row["id"] for row in refs]
            _strip_legacy_clip_files(clip)
            if not is_audio:
                clip["type"] = "clip"

    project["media"] = media
    project.pop("resources", None)


def _normalize_media_catalog(project: dict) -> None:
    media: list[dict] = []
    seen_id: set[str] = set()
    seen_key: set[str] = set()
    for row in project.get("media") or []:
        if not isinstance(row, dict):
            continue
        kind = _norm_kind(row.get("kind"))
        file = _norm_file(row.get("file"))
        if not kind or not file:
            continue
        key = f"{kind}:{file}"
        if key in seen_key:
            continue
        seen_key.add(key)
        mid = str(row.get("id") or "").strip() or _media_id_for(kind, file)
        if mid in seen_id:
            mid = _media_id_for(kind, f"{file}:{len(media)}")
        seen_id.add(mid)
        tags = row.get("tags") if isinstance(row.get("tags"), list) else []
        entry = {
            "id": mid,
            "kind": kind,
            "file": file,
            "location": "input",
            "name": str(row.get("name") or os.path.basename(file)),
            "prompt": str(row.get("prompt") or ""),
            "generation_prompt": str(row.get("generation_prompt") or row.get("generationPrompt") or ""),
            "setting_description": str(row.get("setting_description") or row.get("settingDescription") or ""),
            "media_type": str(row.get("media_type") or row.get("mediaType") or "").strip(),
            "tags": [str(t).strip() for t in tags if str(t).strip()],
        }
        try:
            stars = int(row.get("stars"))
            if 1 <= stars <= 5:
                entry["stars"] = stars
        except (TypeError, ValueError):
            pass
        media.append(entry)
    project["media"] = media
    project.pop("resources", None)


def _strip_legacy_clip_files(clip: dict) -> None:
    source = clip.get("source") if isinstance(clip.get("source"), dict) else None
    if source:
        clip["source"] = {
            key: source[key]
            for key in ("in_ms", "out_ms", "duration_ms")
            if key in source
        }
        if not clip["source"]:
            clip.pop("source", None)
    clip.pop("items", None)
    clip.pop("end_image", None)
    clip.pop("start_image", None)
    clip.pop("audio_file", None)


def _ensure_clip_media_ids(project: dict) -> None:
    """Fill media_ids from leftover clip file fields; strip legacy file copies."""
    media = project.get("media") if isinstance(project.get("media"), list) else []
    by_id: dict[str, dict] = {}
    by_key: dict[str, dict] = {}
    for row in media:
        if not isinstance(row, dict):
            continue
        mid = str(row.get("id") or "")
        if mid:
            by_id[mid] = row
        kind = _norm_kind(row.get("kind"))
        file = _norm_file(row.get("file"))
        if kind and file:
            by_key[f"{kind}:{file}"] = row

    def add(kind, file) -> dict | None:
        kind = _norm_kind(kind)
        file = _norm_file(file)
        if not kind or not file:
            return None
        key = f"{kind}:{file}"
        if key in by_key:
            return by_key[key]
        row = {
            "id": _media_id_for(kind, file),
            "kind": kind,
            "file": file,
            "location": "input",
            "name": os.path.basename(file),
            "prompt": "",
            "generation_prompt": "",
            "setting_description": "",
            "media_type": "",
            "tags": [],
        }
        if row["id"] in by_id:
            row["id"] = _media_id_for(kind, f"{file}:{len(media)}")
        media.append(row)
        by_key[key] = row
        by_id[row["id"]] = row
        return row

    for track in project.get("tracks") or []:
        if not isinstance(track, dict):
            continue
        track_type = str(track.get("type") or "visual").lower()
        for clip in track.get("clips") or []:
            if not isinstance(clip, dict):
                continue
            ids = clip.get("media_ids") if isinstance(clip.get("media_ids"), list) else []
            valid_ids = [str(i) for i in ids if str(i) in by_id]
            if valid_ids:
                clip["media_ids"] = valid_ids
                _strip_legacy_clip_files(clip)
                if str(clip.get("type") or "").lower() != "audio" and track_type != "audio":
                    clip["type"] = "clip"
                continue
            source = clip.get("source") if isinstance(clip.get("source"), dict) else {}
            clip_type = str(clip.get("type") or ("audio" if track_type == "audio" else "image")).lower()
            is_audio = clip_type == "audio" or track_type == "audio"
            refs: list[dict] = []
            items = clip.get("items") if isinstance(clip.get("items"), list) else []
            for item in items:
                if isinstance(item, dict):
                    row = add(item.get("kind") or "image", item.get("file") or item.get("src"))
                elif isinstance(item, str):
                    row = add("image", item)
                else:
                    row = None
                if row and row not in refs:
                    refs.append(row)
            if not refs:
                kind = "audio" if is_audio else ("video" if clip_type == "video" else "image")
                row = add(
                    kind,
                    source.get("file") or clip.get("start_image") or clip.get("audio_file") or clip.get("src"),
                )
                if row:
                    refs.append(row)
                if not is_audio:
                    end_row = add("image", clip.get("end_image"))
                    if end_row and end_row not in refs:
                        refs.append(end_row)
            clip["media_ids"] = [row["id"] for row in refs]
            _strip_legacy_clip_files(clip)
            if not is_audio:
                clip["type"] = "clip"

    project["media"] = media
    project.pop("resources", None)


def _safe_name(name: str, fallback: str = "Untitled Project") -> str:
    text = str(name or "").strip() or fallback
    text = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", text)
    text = re.sub(r"[. ]+$", "", text).strip() or fallback
    return text[:80]


def _ext_ok(kind: str, filename: str) -> bool:
    ext = os.path.splitext(filename)[1].lower()
    table = {
        "image": IMAGE_EXTENSIONS,
        "video": VIDEO_EXTENSIONS,
        "audio": AUDIO_EXTENSIONS,
    }
    return ext in table.get(kind, set())


def iter_project_media(project: dict) -> list[dict]:
    """Unique media refs from the catalog, plus any leftover clip file fields."""
    if not isinstance(project, dict):
        return []
    project = migrate_project(project)
    seen: set[tuple[str, str]] = set()
    rows: list[dict] = []

    def add(kind: str, file: str, location: str = "input") -> None:
        kind = _norm_kind(kind)
        file = _norm_file(file)
        if not kind or not file:
            return
        key = (kind, file)
        if key in seen:
            return
        seen.add(key)
        rows.append({
            "kind": kind,
            "file": file,
            "location": str(location or "input"),
        })

    for resource in project.get("media") or []:
        if isinstance(resource, dict):
            add(resource.get("kind"), resource.get("file"), resource.get("location"))

    for track in project.get("tracks") or []:
        if not isinstance(track, dict):
            continue
        for clip in track.get("clips") or []:
            if not isinstance(clip, dict):
                continue
            for row in resolve_clip_media(project, clip):
                add(row.get("kind"), row.get("file"), row.get("location"))
    return rows


def iter_project_generated_videos(project: dict) -> list[str]:
    """Unique generated-video paths (output-relative) linked on visual clips."""
    if not isinstance(project, dict):
        return []
    project = migrate_project(project)
    seen: set[str] = set()
    out: list[str] = []
    for track in project.get("tracks") or []:
        if not isinstance(track, dict):
            continue
        if str(track.get("type") or "").lower() == "audio":
            continue
        for clip in track.get("clips") or []:
            if not isinstance(clip, dict):
                continue
            rows = clip.get("generated_videos")
            if not isinstance(rows, list):
                continue
            for row in rows:
                if not isinstance(row, dict):
                    continue
                file = _norm_generated_file(row.get("file"))
                if not file or file in seen:
                    continue
                if not _ext_ok("video", file):
                    continue
                seen.add(file)
                out.append(file)
    return out


def _unique_generated_arcname(used: set[str], file: str) -> str:
    """Package path under media/generated/, preserving relative folders when possible."""
    rel = _norm_generated_file(file)
    base = rel if "/" in rel else (os.path.basename(rel) or "video.mp4")
    candidate = f"{PACKAGE_MEDIA_ROOT}/{PACKAGE_GENERATED_SUBDIR}/{base}"
    if candidate not in used:
        used.add(candidate)
        return candidate
    stem, ext = os.path.splitext(base)
    n = 1
    while True:
        candidate = f"{PACKAGE_MEDIA_ROOT}/{PACKAGE_GENERATED_SUBDIR}/{stem}_{n}{ext}"
        if candidate not in used:
            used.add(candidate)
            return candidate
        n += 1


def _unique_arcname(used: set[str], kind: str, src_name: str) -> str:
    sub = KIND_SUBDIR[kind]
    base = os.path.basename(str(src_name).replace("\\", "/")) or f"file{os.path.splitext(src_name)[1]}"
    candidate = f"{PACKAGE_MEDIA_ROOT}/{sub}/{base}"
    if candidate not in used:
        used.add(candidate)
        return candidate
    stem, ext = os.path.splitext(base)
    n = 1
    while True:
        candidate = f"{PACKAGE_MEDIA_ROOT}/{sub}/{stem}_{n}{ext}"
        if candidate not in used:
            used.add(candidate)
            return candidate
        n += 1


def _remap_project_files(
    project: dict,
    mapping: dict[tuple[str, str], str],
    generated_mapping: dict[str, str] | None = None,
) -> dict:
    """Rewrite media + generated-video paths.

    mapping[(kind, old_file)] -> new_rel_path for catalog media.
    generated_mapping[old_file] -> new_rel_path for clip.generated_videos[].file.
    """
    out = migrate_project(project)
    generated_mapping = {
        _norm_file(k): v
        for k, v in (generated_mapping or {}).items()
        if _norm_file(k) and v
    }

    def map_file(kind: str, file: str) -> str:
        file = _norm_file(file)
        if not file:
            return file
        kind = _norm_kind(kind)
        return mapping.get((kind, file), file)

    media = []
    for resource in out.get("media") or []:
        if not isinstance(resource, dict):
            continue
        kind = _norm_kind(resource.get("kind"))
        file = map_file(kind, resource.get("file"))
        media.append({**resource, "file": file, "location": "input"})
    out["media"] = media
    out.pop("resources", None)

    catalog = {str(row.get("id")): row for row in media if row.get("id")}
    for track in out.get("tracks") or []:
        if not isinstance(track, dict):
            continue
        for clip in track.get("clips") or []:
            if not isinstance(clip, dict):
                continue
            ids = clip.get("media_ids") if isinstance(clip.get("media_ids"), list) else []
            clip["media_ids"] = [str(i) for i in ids if str(i) in catalog]
            source = clip.get("source") if isinstance(clip.get("source"), dict) else None
            if source:
                clip["source"] = {
                    key: source[key]
                    for key in ("in_ms", "out_ms", "duration_ms")
                    if key in source
                }
                if not clip["source"]:
                    clip.pop("source", None)
            clip.pop("items", None)
            clip.pop("end_image", None)
            clip.pop("start_image", None)
            clip.pop("audio_file", None)
            gens = clip.get("generated_videos")
            if isinstance(gens, list) and generated_mapping:
                for row in gens:
                    if not isinstance(row, dict):
                        continue
                    old = _norm_file(row.get("file"))
                    if not old:
                        continue
                    new = generated_mapping.get(old) or generated_mapping.get(_norm_generated_file(old))
                    if new:
                        row["file"] = new
    return out


def build_export_entries(project: dict) -> tuple[dict, list[dict], list[str]]:
    """Build remapped project + copy entries for packaging.

    Returns (exported_project, entries, missing_files).
    each entry: {kind, file, arcname, src_path, location}
      file = original path (for asset_file / view fetch)
      arcname = package-relative path written into the export
      location = "input" for library media, "output" for linked generated videos
    """
    used: set[str] = set()
    mapping: dict[tuple[str, str], str] = {}
    generated_mapping: dict[str, str] = {}
    entries: list[dict] = []
    missing: list[str] = []

    for row in iter_project_media(project):
        kind, file, location = row["kind"], row["file"], row["location"]
        src = resolve_media_path(file, assets_dir="", location="input")
        if not src or not os.path.isfile(src):
            src = resolve_media_path(file, assets_dir="", location=location or "assets")
        if not src or not os.path.isfile(src):
            missing.append(file)
            continue
        if not _ext_ok(kind, src):
            missing.append(file)
            continue
        arcname = _unique_arcname(used, kind, file)
        mapping[(kind, file)] = arcname
        entries.append({
            "kind": kind,
            "file": file,
            "arcname": arcname,
            "src_path": src,
            "location": "input",
        })

    for file in iter_project_generated_videos(project):
        src = _resolve_output_file(file)
        if not src:
            missing.append(file)
            continue
        arcname = _unique_generated_arcname(used, file)
        generated_mapping[file] = arcname
        entries.append({
            "kind": "video",
            "file": file,
            "arcname": arcname,
            "src_path": src,
            "location": "output",
        })

    exported = _remap_project_files(project, mapping, generated_mapping)
    return exported, entries, missing


def build_export_zip_bytes(project: dict) -> tuple[bytes, str, list[str]]:
    """Return (zip_bytes, filename, missing_files)."""
    exported, entries, missing = build_export_entries(project)
    name = _safe_name(exported.get("name"), "timeline-project")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            PACKAGE_PROJECT_NAME,
            json.dumps(exported, ensure_ascii=False, indent=2),
        )
        for entry in entries:
            zf.write(entry["src_path"], arcname=entry["arcname"])
    return buf.getvalue(), f"{name}.zip", missing


def _import_media_bytes(kind: str, filename: str, data: bytes) -> str:
    """Write media into ComfyUI input timeline uploads. Returns relative input path."""
    import folder_paths

    sub = KIND_SUBDIR[kind]
    root = folder_paths.get_input_directory()
    dest_dir = os.path.join(root, "capricorncd-timeline", sub)
    os.makedirs(dest_dir, exist_ok=True)
    filename = os.path.basename(filename) or f"file{os.path.splitext(filename)[1]}"
    destination = os.path.join(dest_dir, filename)
    base, ext = os.path.splitext(filename)
    counter = 1
    while os.path.exists(destination):
        destination = os.path.join(dest_dir, f"{base}_{counter}{ext}")
        counter += 1
    with open(destination, "wb") as dst:
        dst.write(data)
    return os.path.relpath(destination, root).replace(os.sep, "/")


def _import_generated_bytes(rel_path: str, data: bytes) -> str:
    """Write a generated video into ComfyUI output/. Returns output-relative path."""
    import folder_paths

    rel_path = _norm_generated_file(rel_path)
    if not rel_path:
        rel_path = "imported.mp4"
    parts = [p for p in rel_path.split("/") if p and p not in (".", "..")]
    if not parts:
        parts = ["imported.mp4"]
    root = os.path.abspath(folder_paths.get_output_directory())
    dest_dir = os.path.join(root, *parts[:-1]) if len(parts) > 1 else root
    os.makedirs(dest_dir, exist_ok=True)
    filename = parts[-1]
    destination = os.path.join(dest_dir, filename)
    base, ext = os.path.splitext(filename)
    counter = 1
    while os.path.exists(destination):
        destination = os.path.join(dest_dir, f"{base}_{counter}{ext}")
        counter += 1
    with open(destination, "wb") as dst:
        dst.write(data)
    return os.path.relpath(destination, root).replace(os.sep, "/")


def import_project_from_zip_bytes(data: bytes) -> tuple[dict, list[str]]:
    """Extract ZIP package into input uploads and return remapped project + warnings."""
    warnings: list[str] = []
    with zipfile.ZipFile(io.BytesIO(data), "r") as zf:
        names = [n.replace("\\", "/") for n in zf.namelist()]
        project_name = next(
            (n for n in names if n.rstrip("/").endswith(PACKAGE_PROJECT_NAME) and not n.endswith("/")),
            None,
        )
        if not project_name:
            raise ValueError(_t("zip_missing_project_json", get_last_known_lang()))
        project = json.loads(zf.read(project_name).decode("utf-8"))
        if not isinstance(project, dict):
            raise ValueError(_t("invalid_project_json_format", get_last_known_lang()))

        mapping: dict[tuple[str, str], str] = {}
        generated_mapping: dict[str, str] = {}
        gen_prefix = f"{PACKAGE_MEDIA_ROOT}/{PACKAGE_GENERATED_SUBDIR}/"
        for info in zf.infolist():
            name = info.filename.replace("\\", "/")
            if info.is_dir() or name.rstrip("/").endswith(PACKAGE_PROJECT_NAME):
                continue
            if not name.startswith(f"{PACKAGE_MEDIA_ROOT}/"):
                continue
            parts = name.split("/")
            if len(parts) < 3:
                continue
            sub = parts[1]
            if sub == PACKAGE_GENERATED_SUBDIR:
                if not _ext_ok("video", name):
                    continue
                under = name[len(gen_prefix) :] if name.startswith(gen_prefix) else os.path.basename(name)
                under = _norm_generated_file(under) or os.path.basename(name)
                if _resolve_output_file(under):
                    new_rel = under
                else:
                    new_rel = _import_generated_bytes(under, zf.read(info))
                generated_mapping[name] = new_rel
                generated_mapping[under] = new_rel
                generated_mapping[os.path.basename(name)] = new_rel
                continue
            kind = next((k for k, v in KIND_SUBDIR.items() if v == sub), None)
            if not kind or not _ext_ok(kind, name):
                continue
            new_rel = _import_media_bytes(kind, os.path.basename(name), zf.read(info))
            mapping[(kind, name)] = new_rel
            mapping[(kind, os.path.basename(name))] = new_rel

        for row in iter_project_media(project):
            kind, file = row["kind"], row["file"]
            if (kind, file) in mapping:
                continue
            base = os.path.basename(file)
            if (kind, base) in mapping:
                mapping[(kind, file)] = mapping[(kind, base)]
            else:
                warnings.append(_t("missing_asset", get_last_known_lang(), file=file))

        # Prefer local output/ hits for package paths (media/generated/...) before warning.
        for track in project.get("tracks") or []:
            if not isinstance(track, dict) or str(track.get("type") or "").lower() == "audio":
                continue
            for clip in track.get("clips") or []:
                if not isinstance(clip, dict):
                    continue
                rows = clip.get("generated_videos")
                if not isinstance(rows, list):
                    continue
                for row in rows:
                    if not isinstance(row, dict):
                        continue
                    raw = _norm_file(row.get("file"))
                    if not raw:
                        continue
                    norm = _norm_generated_file(raw)
                    if raw in generated_mapping or norm in generated_mapping:
                        if raw not in generated_mapping and norm in generated_mapping:
                            generated_mapping[raw] = generated_mapping[norm]
                        continue
                    base = os.path.basename(norm or raw)
                    if base in generated_mapping:
                        generated_mapping[raw] = generated_mapping[base]
                        if norm:
                            generated_mapping[norm] = generated_mapping[base]
                        continue
                    if norm and _resolve_output_file(norm):
                        generated_mapping[raw] = norm
                        generated_mapping[norm] = norm
                        continue
                    warnings.append(_t("missing_asset", get_last_known_lang(), file=raw))

        return _remap_project_files(project, mapping, generated_mapping), warnings
