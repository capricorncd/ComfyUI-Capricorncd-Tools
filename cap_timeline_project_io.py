"""Timeline Editor project package export / import (media + project.json)."""

from __future__ import annotations

import hashlib
import io
import json
import os
import re
import zipfile

from .timecode import AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, resolve_media_path

PACKAGE_PROJECT_NAME = "project.json"
PACKAGE_MEDIA_ROOT = "media"
KIND_SUBDIR = {"image": "images", "video": "videos", "audio": "audios"}
# Integer document shape. Independent of the Python package version.
SCHEMA_VERSION = 2


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
            "name": "未命名项目",
            "media": [],
            "settings": {},
            "tracks": [],
        }
    out = json.loads(json.dumps(project, ensure_ascii=False))
    if parse_schema_version(out) < 2:
        _migrate_schema_1_to_2(out)
    _normalize_media_catalog(out)
    _ensure_clip_media_ids(out)
    out["schema_version"] = SCHEMA_VERSION
    return out


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
            media_type = resource.get("media_type") or resource.get("mediaType")
            tags = resource.get("tags")
            stars = resource.get("stars")
            row = by_key.get(f"{_norm_kind(resource.get('kind'))}:{_norm_file(resource.get('file'))}")
            if row:
                if isinstance(prompt, str):
                    row["prompt"] = prompt
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


def _safe_name(name: str, fallback: str = "未命名项目") -> str:
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


def _remap_project_files(project: dict, mapping: dict[tuple[str, str], str]) -> dict:
    """Rewrite media paths using mapping[(kind, old_file)] -> new_rel_path."""
    out = migrate_project(project)

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
    return out


def build_export_entries(project: dict) -> tuple[dict, list[dict], list[str]]:
    """Build remapped project + copy entries for packaging.

    Returns (exported_project, entries, missing_files).
    each entry: {kind, file, arcname, src_path}
      file = original path (for asset_file fetch)
      arcname = package-relative path written into the export
    """
    used: set[str] = set()
    mapping: dict[tuple[str, str], str] = {}
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
        entries.append({"kind": kind, "file": file, "arcname": arcname, "src_path": src})

    exported = _remap_project_files(project, mapping)
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
            raise ValueError("ZIP 中缺少 project.json")
        project = json.loads(zf.read(project_name).decode("utf-8"))
        if not isinstance(project, dict):
            raise ValueError("project.json 格式无效")

        mapping: dict[tuple[str, str], str] = {}
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
                warnings.append(f"缺少素材：{file}")

        return _remap_project_files(project, mapping), warnings
