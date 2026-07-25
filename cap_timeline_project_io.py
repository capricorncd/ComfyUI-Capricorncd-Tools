"""Timeline Editor project package export / import (media + project.json)."""

from __future__ import annotations

import io
import json
import os
import re
import zipfile

from .timecode import AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, resolve_media_path

PACKAGE_PROJECT_NAME = "project.json"
PACKAGE_MEDIA_ROOT = "media"
KIND_SUBDIR = {"image": "images", "video": "videos", "audio": "audios"}


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
    """Unique media refs from resources, clip sources, and end frames."""
    if not isinstance(project, dict):
        return []
    seen: set[tuple[str, str]] = set()
    rows: list[dict] = []

    def add(kind: str, file: str, location: str = "input") -> None:
        kind = str(kind or "").lower()
        file = str(file or "").strip().replace("\\", "/")
        if not kind or not file or kind not in KIND_SUBDIR:
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

    for resource in project.get("resources") or []:
        if isinstance(resource, dict):
            add(resource.get("kind"), resource.get("file"), resource.get("location"))

    for track in project.get("tracks") or []:
        if not isinstance(track, dict):
            continue
        track_type = str(track.get("type") or "visual").lower()
        for clip in track.get("clips") or []:
            if not isinstance(clip, dict):
                continue
            source = clip.get("source") if isinstance(clip.get("source"), dict) else {}
            clip_type = str(clip.get("type") or ("audio" if track_type == "audio" else "image")).lower()
            kind = "audio" if (clip_type == "audio" or track_type == "audio") else (
                "video" if clip_type == "video" else "image"
            )
            add(kind, source.get("file") or clip.get("start_image"), source.get("location"))
            end_image = clip.get("end_image")
            if end_image:
                add("image", end_image, "input")
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
    out = json.loads(json.dumps(project, ensure_ascii=False))

    def map_file(kind: str, file: str) -> str:
        file = str(file or "").strip().replace("\\", "/")
        if not file:
            return file
        return mapping.get((kind, file), file)

    resources = []
    for resource in out.get("resources") or []:
        if not isinstance(resource, dict):
            continue
        kind = str(resource.get("kind") or "").lower()
        file = map_file(kind, resource.get("file"))
        resources.append({**resource, "file": file, "location": "input"})
    out["resources"] = resources

    for track in out.get("tracks") or []:
        if not isinstance(track, dict):
            continue
        track_type = str(track.get("type") or "visual").lower()
        for clip in track.get("clips") or []:
            if not isinstance(clip, dict):
                continue
            source = clip.get("source") if isinstance(clip.get("source"), dict) else {}
            clip_type = str(clip.get("type") or ("audio" if track_type == "audio" else "image")).lower()
            kind = "audio" if (clip_type == "audio" or track_type == "audio") else (
                "video" if clip_type == "video" else "image"
            )
            if source:
                old = str(source.get("file") or "").strip()
                source = {**source, "file": map_file(kind, old), "location": "input"}
                clip["source"] = source
            if clip.get("end_image"):
                clip["end_image"] = map_file("image", clip.get("end_image"))
            if clip.get("start_image"):
                clip["start_image"] = map_file(kind, clip.get("start_image"))
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
