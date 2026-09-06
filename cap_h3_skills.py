from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import threading
from pathlib import Path

from .cap_i18n import get_last_known_lang, t

SKILL_REPO_URL = "https://github.com/T8mars/minimax-h3-prompt-skill-T8"
OFFICIAL_SKILL_REPO_URL = "https://github.com/MiniMax-AI/MiniMax-H3"
SKILL_REPOS = {
    "official": {
        "url": OFFICIAL_SKILL_REPO_URL,
        "folder": "MiniMax-H3",
        "sparse": ("skills",),
    },
    "community": {
        "url": SKILL_REPO_URL,
        "folder": "minimax-h3-prompt-skill-T8",
        "sparse": ("skills", "catalog"),
    },
}
_SKILL_ID_RE = re.compile(r"^(?:(official|community)__)?([a-zA-Z0-9][a-zA-Z0-9._-]{0,120})$")
_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n?", re.DOTALL)
_TITLE_RE = re.compile(r"^#\s+(.+)$", re.MULTILINE)
_SYNC_LOCK = threading.Lock()


def skill_repo_root(source: str = "community") -> Path:
    config = SKILL_REPOS.get(source) or SKILL_REPOS["community"]
    return Path(__file__).resolve().parent / "vendor" / str(config["folder"])


def _skills_dir(source: str = "community") -> Path:
    return skill_repo_root(source) / "skills"


def _catalog_dir() -> Path:
    return skill_repo_root() / "catalog"


def _safe_skill_id(value: str) -> str:
    text = str(value or "").strip()
    match = _SKILL_ID_RE.match(text)
    if not match:
        raise ValueError("Invalid skill id")
    source = match.group(1) or "community"
    return f"{source}__{match.group(2)}"


def _skill_parts(value: str) -> tuple[str, str]:
    safe = _safe_skill_id(value)
    return tuple(safe.split("__", 1))


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""


def _parse_frontmatter(text: str) -> tuple[dict, str]:
    match = _FRONTMATTER_RE.match(text or "")
    if not match:
        return {}, text or ""
    meta = {}
    for line in match.group(1).splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        meta[key.strip()] = value.strip().strip('"').strip("'")
    return meta, text[match.end():]


def _load_catalog_cases() -> list[dict]:
    path = _catalog_dir() / "manifest.json"
    try:
        data = json.loads(_read_text(path) or "{}")
    except json.JSONDecodeError:
        return []
    cases = data.get("cases") if isinstance(data, dict) else None
    return [row for row in cases if isinstance(row, dict)] if isinstance(cases, list) else []


def _preview_path_for_skill(skill_id: str, cases_by_slug: dict[str, dict]) -> Path | None:
    case = cases_by_slug.get(skill_id)
    if isinstance(case, dict):
        rel = str((case.get("preview_paths") or {}).get("gif") or "").replace("\\", "/").lstrip("/")
        if rel:
            candidate = _catalog_dir() / rel
            if candidate.is_file():
                return candidate
    for folder in (
        _catalog_dir() / "community-skills" / skill_id / "preview.gif",
        _catalog_dir() / "official-skills" / skill_id / "preview.gif",
        _catalog_dir() / "cases" / skill_id / "preview.gif",
    ):
        if folder.is_file():
            return folder
    return None


def _title_for_skill(skill_id: str, skill_md: str, cases_by_slug: dict[str, dict]) -> str:
    case = cases_by_slug.get(skill_id)
    if isinstance(case, dict):
        title = str(case.get("title") or "").strip()
        if title:
            return title
    heading = _TITLE_RE.search(skill_md or "")
    if heading:
        return heading.group(1).strip()
    meta, _ = _parse_frontmatter(skill_md or "")
    return str(meta.get("name") or skill_id).strip() or skill_id


def _list_repo_skills(source: str) -> list[dict]:
    root = _skills_dir(source)
    if not root.is_dir():
        return []
    cases_by_slug = {}
    if source == "community":
        for row in _load_catalog_cases():
            slug = str(row.get("slug") or "").strip()
            skill_path = str(row.get("skill_path") or "").replace("\\", "/").rstrip("/")
            key = slug or (skill_path.rsplit("/", 1)[-1] if skill_path else "")
            if key:
                cases_by_slug[key] = row
    out = []
    for child in sorted(root.iterdir(), key=lambda p: p.name.lower()):
        if not child.is_dir():
            continue
        skill_md = child / "SKILL.md"
        if not skill_md.is_file():
            continue
        skill_id = child.name
        text = _read_text(skill_md)
        preview = _preview_path_for_skill(skill_id, cases_by_slug) if source == "community" else None
        case = cases_by_slug.get(skill_id) or {}
        out.append({
            "id": f"{source}__{skill_id}",
            "name": skill_id,
            "title": _title_for_skill(skill_id, text, cases_by_slug),
            "summary": str(case.get("summary") or "").strip(),
            "has_preview": bool(preview),
            "source": source,
        })
    return out


def list_h3_skills() -> list[dict]:
    return [row for source in ("official", "community") for row in _list_repo_skills(source)]


def resolve_skill_preview(skill_id: str) -> Path | None:
    source, skill_id = _skill_parts(skill_id)
    if source != "community":
        return None
    cases_by_slug = {}
    for row in _load_catalog_cases():
        slug = str(row.get("slug") or "").strip()
        skill_path = str(row.get("skill_path") or "").replace("\\", "/").rstrip("/")
        key = slug or (skill_path.rsplit("/", 1)[-1] if skill_path else "")
        if key:
            cases_by_slug[key] = row
    path = _preview_path_for_skill(skill_id, cases_by_slug)
    if path and path.is_file():
        root = os.path.realpath(skill_repo_root(source))
        real = os.path.realpath(path)
        if real == root or real.startswith(root + os.sep):
            return path
    return None


def load_skill_text(skill_id: str) -> str:
    source, skill_id = _skill_parts(skill_id)
    folder = _skills_dir(source) / skill_id
    lang = get_last_known_lang().lower()
    localized = folder / "SKILL.cn.md"
    skill_md = localized if lang.startswith("zh") and localized.is_file() else folder / "SKILL.md"
    if not skill_md.is_file():
        raise FileNotFoundError(f"Skill not found: {skill_id}")
    parts = [_read_text(skill_md).strip()]
    references = folder / "references"
    if references.is_dir():
        for extra in sorted(references.rglob("*")):
            if not extra.is_file() or extra.suffix.lower() not in {".md", ".txt"}:
                continue
            text = _read_text(extra).strip()
            if text:
                parts.append(f"Reference: {extra.relative_to(folder).as_posix()}\n{text}")
    return "\n\n".join(part for part in parts if part).strip()


def _run_git(args: list[str], cwd: Path | None = None, timeout: int = 300) -> str:
    git = shutil.which("git")
    if not git:
        raise RuntimeError(t("git_not_found", get_last_known_lang()))
    kwargs: dict = {"capture_output": True, "text": True, "timeout": timeout}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
    if cwd is not None:
        kwargs["cwd"] = str(cwd)
    result = subprocess.run([git, *args], **kwargs)
    if result.returncode != 0:
        err = (result.stderr or result.stdout or "").strip() or f"git {' '.join(args)} failed"
        raise RuntimeError(err[:800])
    return result.stdout or ""


def sync_skill_repo() -> dict:
    if not _SYNC_LOCK.acquire(blocking=False):
        raise RuntimeError(t("skill_sync_in_progress", get_last_known_lang()))
    try:
        for config in SKILL_REPOS.values():
            root = Path(__file__).resolve().parent / "vendor" / str(config["folder"])
            root.parent.mkdir(parents=True, exist_ok=True)
            repo_url = str(config["url"])
            clone_url = repo_url if repo_url.endswith(".git") else f"{repo_url}.git"
            sparse = [str(value) for value in config["sparse"]]
            if (root / ".git").is_dir():
                _run_git(["remote", "set-url", "origin", clone_url], cwd=root)
                _run_git(["sparse-checkout", "init", "--cone"], cwd=root)
                _run_git(["sparse-checkout", "set", *sparse], cwd=root, timeout=600)
                _run_git(["fetch", "--depth", "1", "origin"], cwd=root, timeout=600)
                _run_git(["checkout", "-B", "main", "FETCH_HEAD"], cwd=root, timeout=600)
            else:
                if root.exists():
                    shutil.rmtree(root)
                _run_git(
                    ["clone", "--depth", "1", "--filter=blob:none", "--sparse", clone_url, str(root)],
                    timeout=600,
                )
                _run_git(["sparse-checkout", "init", "--cone"], cwd=root)
                _run_git(["sparse-checkout", "set", *sparse], cwd=root, timeout=600)
        skills = list_h3_skills()
        return {
            "ok": True,
            "count": len(skills),
            "skills": skills,
            "repo_url": OFFICIAL_SKILL_REPO_URL,
            "repo_urls": {key: value["url"] for key, value in SKILL_REPOS.items()},
        }
    finally:
        _SYNC_LOCK.release()

