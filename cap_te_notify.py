"""WebSocket notify helpers for Cap Timeline Editor run progress."""
from __future__ import annotations

import logging
import re

log = logging.getLogger(__name__)

EVENT_CLIP_RUNNING = "cat_te_clip_running"
EVENT_VIDEO_SAVED = "cat_te_video_saved"

# CapTimelineEditor/{project}/{YYYYMMDD-HHMMSS}_{clipId}.mp4
_SPECIFIED_VIDEO_RE = re.compile(
    r"(?:^|/)CapTimelineEditor/[^/]+/(\d{8}-\d{6})_(.+)\.mp4$",
    re.IGNORECASE,
)


def clip_id_from_output_video(path: str) -> str:
    """Extract timeline clip id from a CapTimelineEditor-specified output path."""
    s = str(path or "").strip().replace("\\", "/")
    if not s:
        return ""
    m = _SPECIFIED_VIDEO_RE.search(s)
    return str(m.group(2)).strip() if m else ""


def notify_timeline(event: str, **data) -> None:
    """Send a custom WS event to the active ComfyUI client (best-effort)."""
    try:
        from server import PromptServer
        from comfy_execution.utils import get_executing_context

        payload = {k: v for k, v in data.items() if v is not None}
        ctx = get_executing_context()
        if ctx is not None:
            payload.setdefault("prompt_id", ctx.prompt_id)
            payload.setdefault("node_id", ctx.node_id)
        server = getattr(PromptServer, "instance", None)
        if server is None:
            return
        sid = getattr(server, "client_id", None)
        server.send_sync(event, payload, sid)
    except Exception as exc:
        log.debug("[cap_te_notify] %s failed: %s", event, exc)
