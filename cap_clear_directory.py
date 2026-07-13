from __future__ import annotations

import ctypes
import logging
import os
import sys
from .timecode import (
    AUDIO_EXTENSIONS,
    IMAGE_EXTENSIONS,
    VIDEO_EXTENSIONS,
    resolve_assets_dir,
)

log = logging.getLogger(__name__)


def _is_filesystem_root(path: str) -> bool:
    path = os.path.abspath(os.path.normpath(path))
    if os.name == "nt":
        drive, tail = os.path.splitdrive(path)
        if not drive:
            return False
        return tail.rstrip("\\/") == ""
    return path == os.path.abspath(os.sep)


def _resolve_directory(directory: str) -> str:
    resolved = resolve_assets_dir(directory)
    if not resolved:
        raise ValueError("目录路径为空")
    real = os.path.realpath(resolved)
    if not os.path.isdir(real):
        raise ValueError(f"目录不存在: {directory}")
    if _is_filesystem_root(real):
        raise ValueError(f"禁止清空根目录: {real}")
    return real


def _allowed_extensions(delete_images: bool, delete_videos: bool, delete_audio: bool) -> set[str]:
    exts: set[str] = set()
    if delete_images:
        exts |= IMAGE_EXTENSIONS
    if delete_videos:
        exts |= VIDEO_EXTENSIONS
    if delete_audio:
        exts |= AUDIO_EXTENSIONS
    return exts


def _win_send_to_recycle_bin(path: str) -> None:
    from ctypes import wintypes

    FO_DELETE = 0x0003
    FOF_ALLOWUNDO = 0x0040
    FOF_NOCONFIRMATION = 0x0010
    FOF_SILENT = 0x0004

    class SHFILEOPSTRUCTW(ctypes.Structure):
        _fields_ = [
            ("hwnd", wintypes.HWND),
            ("wFunc", wintypes.UINT),
            ("pFrom", wintypes.LPCWSTR),
            ("pTo", wintypes.LPCWSTR),
            ("fFlags", wintypes.WORD),
            ("fAnyOperationsAborted", wintypes.BOOL),
            ("hNameMappings", wintypes.LPVOID),
            ("lpszProgressTitle", wintypes.LPCWSTR),
        ]

    op = SHFILEOPSTRUCTW()
    op.wFunc = FO_DELETE
    op.pFrom = os.path.abspath(path) + "\0\0"
    op.fFlags = FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT
    rc = ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op))
    if rc != 0:
        raise OSError(f"无法移入回收站 (code {rc}): {path}")
    if op.fAnyOperationsAborted:
        raise OSError(f"移入回收站已取消: {path}")


def _delete_file(path: str, *, to_recycle_bin: bool) -> None:
    if to_recycle_bin:
        if sys.platform == "win32":
            _win_send_to_recycle_bin(path)
            return
        log.warning(
            "[CAP_ClearDirectory] 当前系统不支持回收站，将永久删除: %s",
            path,
        )
    os.unlink(path)


class CAP_ClearDirectory:
    """Delete selected media files in a directory."""

    DOC_SLUG = "clear-directory"
    OUTPUT_TOOLTIPS = {
        "directory": "Resolved absolute directory path that was cleaned",
        "deleted_count": "Number of files deleted (or moved to Recycle Bin)",
    }

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "directory": ("STRING", {
                    "default": "",
                    "tooltip": "Target directory (filesystem roots are blocked)",
                }),
                "delete_subdirs": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "When enabled, also delete matching files in subdirectories",
                }),
                "delete_images": ("BOOLEAN", {
                    "default": True,
                    "tooltip": "Delete image files",
                }),
                "delete_videos": ("BOOLEAN", {
                    "default": True,
                    "tooltip": "Delete video files",
                }),
                "delete_audio": ("BOOLEAN", {
                    "default": True,
                    "tooltip": "Delete audio files",
                }),
                "to_recycle_bin": ("BOOLEAN", {
                    "default": True,
                    "tooltip": "On Windows, send files to Recycle Bin; otherwise permanent delete",
                }),
            },
        }

    RETURN_TYPES = ("STRING", "INT")
    RETURN_NAMES = ("directory", "deleted_count")
    FUNCTION = "execute"
    CATEGORY = "Capricorncd"
    DESCRIPTION = (
        "Delete image, video, and/or audio files in a directory. "
        "Filesystem root directories are blocked. "
        "On Windows, deleted files can be sent to the Recycle Bin."
    )

    @classmethod
    def IS_CHANGED(cls, directory, delete_subdirs, delete_images, delete_videos, delete_audio, to_recycle_bin):
        return float("nan")

    def execute(
        self,
        directory: str,
        delete_subdirs: bool,
        delete_images: bool,
        delete_videos: bool,
        delete_audio: bool,
        to_recycle_bin: bool,
    ):
        resolved = _resolve_directory(directory)
        exts = _allowed_extensions(delete_images, delete_videos, delete_audio)
        deleted = 0

        if not exts:
            log.info("[CAP_ClearDirectory] no file types selected, skipped: %s", resolved)
            return (resolved, deleted)

        if delete_subdirs:
            for root, _dirs, names in os.walk(resolved):
                for name in names:
                    path = os.path.join(root, name)
                    if not os.path.isfile(path):
                        continue
                    if os.path.splitext(name)[1].lower() not in exts:
                        continue
                    _delete_file(path, to_recycle_bin=to_recycle_bin)
                    deleted += 1
        else:
            for name in os.listdir(resolved):
                path = os.path.join(resolved, name)
                if not os.path.isfile(path):
                    continue
                if os.path.splitext(name)[1].lower() not in exts:
                    continue
                _delete_file(path, to_recycle_bin=to_recycle_bin)
                deleted += 1

        mode = "recycle" if to_recycle_bin and sys.platform == "win32" else "permanent"
        log.info("[CAP_ClearDirectory] %s deleted %d files in %s", mode, deleted, resolved)
        return (resolved, deleted)


NODE_CLASS_MAPPINGS = {"CAP_ClearDirectory": CAP_ClearDirectory}
NODE_DISPLAY_NAME_MAPPINGS = {"CAP_ClearDirectory": "Clear Directory"}
