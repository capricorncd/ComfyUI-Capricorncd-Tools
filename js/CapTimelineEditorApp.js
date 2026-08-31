import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { Timeline, ICONS } from "./timeline/index.js";
import { parseTimecode, formatTimecode, frameIndexFromSecs, encodeClipTimingMs, decodeClipTimingSecs } from "./timecode.js";
import { attachRichPromptHandler, setRichPromptValue, toggleComment, resolvePromptTextarea, updateRichPromptMirror } from "./rich_prompt.js";
import { loadExtensionCss } from "./cap_ui.js";
import { iconHtml } from "./cap_icons.js";
import { t as T } from "./i18n/timeline_editor.js";

/** Right-side empty margin as a fraction of the timeline viewport width. */
const TIMELINE_RIGHT_VIEWPORT_FRAC = 0.3;
/** All tracks (main/overlay/audio) share one row height; subtitle tracks are half. */
const TRACK_HEIGHT = 78;
const SUBTITLE_TRACK_HEIGHT = TRACK_HEIGHT / 2;
const STORAGE_MEDIA_STARS = "capricorncd.timeline.media_stars";
const MEDIA_STARS_BUCKET = "comfyui-input";
const STORAGE_AUTOSAVE_INTERVAL = "cat-te-autosave-interval-sec";
const STORAGE_MEDIA_PANEL_W = "cat-te-media-panel-w";
const MIN_MEDIA_PANEL_W = 220;
const DEFAULT_MEDIA_PANEL_W = MIN_MEDIA_PANEL_W;
const MAX_MEDIA_PANEL_FRAC = 0.55;
const STORAGE_SIDEBAR_PANEL_W = "cat-te-sidebar-panel-w";
const MIN_SIDEBAR_PANEL_W = 220;
const DEFAULT_SIDEBAR_PANEL_W = 260;
const MAX_SIDEBAR_PANEL_FRAC = 0.45;
const STORAGE_PROGRAM_PANEL_H = "cat-te-program-panel-h";
const MIN_PROGRAM_PANEL_H = 120;
const DEFAULT_PROGRAM_PANEL_H = 240;
const MAX_PROGRAM_PANEL_FRAC = 0.7;
const STORAGE_MEDIA_LIST_VIEW = "cat-te-media-list-view";
/** Per-node timeline viewport (scroll) when project settings lack it. */
const STORAGE_AI_PROMPT_MODEL = "cat-te-ai-prompt-model";
const STORAGE_AI_PROMPT_SKILL = "cat-te-ai-prompt-skill";
const STORAGE_AI_PROMPT_LANG = "cat-te-ai-prompt-lang";
const AI_PROMPT_LANGUAGES = ["简体中文", "繁體中文", "English", "日本語"];
const AGENT_DEFAULT_MODELS = { openai: "gpt-5.4", gemini: "gemini-3.7-flash" };
const SKILL_URL_DEFAULT = "https://github.com/T8mars/minimax-h3-prompt-skill-T8";
const DEFAULT_AUTOSAVE_INTERVAL_SEC = 5;
const MIN_AUTOSAVE_INTERVAL_SEC = 1;
const MAX_AUTOSAVE_INTERVAL_SEC = 300;
/** Must match CAP_TimelineEditor INPUT_TYPES defaults. */
const PY_SCALAR_DEFAULTS = { fps: 24, width: 1344, height: 768, global_prompt: "" };
const WATERMARK_FIXED_POSITIONS = [
    "top-left", "top-center", "top-right",
    "bottom-left", "bottom-center", "bottom-right",
    "center",
];
const WATERMARK_POSITIONS = new Set([...WATERMARK_FIXED_POSITIONS, "random-interval", "random-fixed"]);
const WATERMARK_POSITION_LABELS = {
    get "top-left"() { return T("wm_pos_top_left"); },
    get "top-center"() { return T("wm_pos_top_center"); },
    get "top-right"() { return T("wm_pos_top_right"); },
    get "bottom-left"() { return T("wm_pos_bottom_left"); },
    get "bottom-center"() { return T("wm_pos_bottom_center"); },
    get "bottom-right"() { return T("wm_pos_bottom_right"); },
    get "center"() { return T("wm_pos_center"); },
    get "random-interval"() { return T("wm_pos_random_interval"); },
    get "random-fixed"() { return T("wm_pos_random_fixed"); },
};
const OUTPUT_VIDEOS_TIME_RANGES = [
    { id: "1h", get label() { return T("time_range_1h"); }, hours: 1 },
    { id: "4h", get label() { return T("time_range_4h"); }, hours: 4 },
    { id: "1d", get label() { return T("time_range_1d"); }, hours: 24 },
    { id: "all", get label() { return T("time_range_all"); }, hours: null },
];
const MEDIA_KIND_FILTERS = [
    { id: "image", get label() { return T("media_kind_image"); } },
    { id: "video", get label() { return T("media_kind_video"); } },
    { id: "audio", get label() { return T("media_kind_audio"); } },
    { id: "text", get label() { return T("media_kind_text"); } },
    { id: "other", get label() { return T("media_kind_other"); } },
];
const MEDIA_KIND_CORE = new Set(["image", "video", "audio", "text"]);
const CLIP_ROLES = [
    { id: "multi_ref", get label() { return T("clip_role_multi_ref"); } },
    { id: "first_last", get label() { return T("clip_role_first_last"); } },
    { id: "t2v", get label() { return T("clip_role_t2v"); } },
    { id: "video_ref", get label() { return T("clip_role_video_ref"); } },
    { id: "video_edit", get label() { return T("clip_role_video_edit"); } },
    { id: "other", get label() { return T("clip_role_other"); } },
];
const CLIP_AGENTS = [
    { id: "MiniMaxH3", label: "MiniMaxH3" },
    { id: "LTX", label: "LTX" },
    { id: "Bernini", label: "Bernini" },
    { id: "Wan", label: "Wan" },
    { id: "other", get label() { return T("clip_role_other"); } },
];
const MEDIA_ASSET_TYPES = [
    { id: "character", get label() { return T("asset_type_character"); } },
    { id: "scene", get label() { return T("asset_type_scene"); } },
    { id: "prop", get label() { return T("asset_type_prop"); } },
    { id: "other", get label() { return T("asset_type_other"); } },
];
const DEFAULT_CLIP_NAME = "Clip";
const LEGACY_CLIP_NAMES = new Set(["Clip", "Package", "clip", "package"]);
/** Integer project document shape. Independent of the Python package version. */
const SCHEMA_VERSION = 2;

function parseSchemaVersion(project) {
    const n = Number(project?.schema_version);
    return Number.isInteger(n) && n >= 1 ? n : 1;
}

function genVideoUid() {
    return `gv_${Math.random().toString(36).slice(2, 11)}`;
}

function normalizeGeneratedVideo(row) {
    if (typeof row === "string") {
        const raw = row.trim().replace(/\\/g, "/");
        const file = normalizeOutputVideoPath(raw) || raw;
        return file ? { id: genVideoUid(), file, enabled: true, muted: false, note: "" } : null;
    }
    if (!row || typeof row !== "object") return null;
    const raw = String(row.file || row.src || "").trim().replace(/\\/g, "/");
    if (!raw) return null;
    const file = normalizeOutputVideoPath(raw) || raw;
    return {
        id: String(row.id || "").trim() || genVideoUid(),
        file,
        enabled: row.enabled !== false,
        muted: row.muted === true,
        note: String(row.note || row.remark || ""),
    };
}

const OUTPUT_VIDEO_EXT = /\.(mp4|webm|mov|mkv|avi|m4v)$/i;

function normalizeOutputVideoPath(value) {
    let s = String(value || "").trim().replace(/\\/g, "/");
    if (!s || !OUTPUT_VIDEO_EXT.test(s)) return null;
    const marker = "/output/";
    const idx = s.toLowerCase().lastIndexOf(marker);
    if (idx >= 0) s = s.slice(idx + marker.length);
    s = s.replace(/^\/+/, "");
    // Export packages store generated videos under media/generated/; map back to output/.
    const pkg = "media/generated/";
    if (s.toLowerCase().startsWith(pkg)) s = s.slice(pkg.length);
    return s || null;
}

function loadEditorCss() {
    loadExtensionCss("cap_timeline_editor.css", "cat-te-styles");
    loadExtensionCss("timeline/timeline.css", "cat-te-tl-styles");
}

function uid() {
    return `cl_${Math.random().toString(36).slice(2, 9)}`;
}

function mediaUid() {
    return `md_${Math.random().toString(36).slice(2, 11)}`;
}

function defaultImageMeta(trackIndex = 0) {
    return {
        clipType: "image",
        mediaKind: "clip",
        prompt: "",
        aiPrompt: "",
        endImage: null,
        useGlobalPrompt: true,
        disabled: false,
        visible: true,
        muted: false,
        headExtendSec: 0,
        tailExtendSec: 0,
        generatePreviewVideo: false,
        secondSample: false,
        trackIndex,
        clipRole: "multi_ref",
        clipRoleCustom: "",
        agent: "MiniMaxH3",
        agentCustom: "",
        items: [],
        generatedVideos: [],
        previewMode: "media",
        useAiPrompt: true,
    };
}

function normalizeClipItem(item) {
    if (!item) return null;
    if (typeof item === "string") {
        const file = item.trim();
        return file ? { id: "", kind: "image", file, useMediaPrompt: true, enabled: true } : null;
    }
    if (typeof item !== "object") return null;
    const file = String(item.file || item.src || "").trim();
    const id = String(item.id || "").trim();
    if (!file && !id) return null;
    const kind = item.kind === "video" ? "video" : item.kind === "audio" ? "audio" : "image";
    return {
        id,
        kind,
        file,
        useMediaPrompt: item.useMediaPrompt !== false,
        enabled: item.enabled !== false,
    };
}

function mediaFlagAt(flags, index) {
    if (!Array.isArray(flags) || index >= flags.length) return true;
    return flags[index] !== false;
}

function clipItemsFromLegacy(src, endImage, mediaKind) {
    const items = [];
    const start = String(src || "").trim();
    if (start) items.push({ kind: mediaKind === "video" ? "video" : "image", file: start });
    const end = String(endImage || "").trim();
    if (end && end !== start) items.push({ kind: "image", file: end });
    return items;
}

function isVisualGroupClip(meta) {
    const kind = meta?.mediaKind;
    return kind === "clip" || kind === "package" || kind === "image" || kind === "video" || !kind;
}

function isDefaultClipName(name) {
    return !name || LEGACY_CLIP_NAMES.has(String(name).trim());
}

function defaultAudioMeta(trackIndex = 2) {
    return {
        clipType: "audio",
        muted: false,
        visible: true,
        sourceDuration: 0,
        trimIn: 0,
        fadeInMs: 0,
        fadeOutMs: 0,
        trackIndex,
    };
}

function defaultSubtitleMeta(trackIndex = 0) {
    return {
        clipType: "subtitle",
        text: "",
        fontFamily: "",
        fontPath: "",
        fontSize: 48,
        letterSpacing: 0,
        color: "#ffffff",
        bold: false,
        italic: false,
        opacity: 1,
        strokeEnabled: true,
        strokeColor: "#000000",
        strokeWidth: 3,
        shadowEnabled: true,
        shadowColor: "rgba(0,0,0,0.75)",
        shadowBlur: 4,
        shadowOffsetX: 2,
        shadowOffsetY: 2,
        align: "center",
        vAlign: "bottom",
        offsetX: 0,
        offsetY: 8,
        disabled: false,
        visible: true,
        trackIndex,
    };
}

const SUBTITLE_STYLE_KEYS = [
    "fontFamily", "fontPath", "fontSize", "letterSpacing", "color", "bold", "italic", "opacity",
    "strokeEnabled", "strokeColor", "strokeWidth",
    "shadowEnabled", "shadowColor", "shadowBlur", "shadowOffsetX", "shadowOffsetY",
    "align", "vAlign", "offsetX", "offsetY",
];

function pickSubtitleStyle(meta) {
    const src = meta && typeof meta === "object" ? meta : {};
    const out = {};
    for (const key of SUBTITLE_STYLE_KEYS) {
        if (src[key] !== undefined) out[key] = src[key];
    }
    return out;
}

function isSubtitleTrackType(type) {
    const t = String(type || "").toLowerCase();
    return t === "text" || t === "subtitle";
}

function trackHeightFor(type) {
    return isSubtitleTrackType(type) ? SUBTITLE_TRACK_HEIGHT : TRACK_HEIGHT;
}

function isSubtitleClipMeta(meta, track) {
    if (isSubtitleTrackType(track?.type)) return true;
    return String(meta?.clipType || "").toLowerCase() === "subtitle";
}

const BODY_UI_CLASSES = [
    "cat-te-noscroll",
    "cat-te-col-resize",
    "cat-te-row-resize",
    "cat-te-media-dnd",
    "cat-te-media-dnd-over-tl",
];

/** @timeline/editor fullscreen shell bound to a ComfyUI node. */
export class CapTimelineEditorApp {
    static _open = null;
    /** @type {Set<CapTimelineEditorApp>} */
    static _instances = new Set();
    /** Session clipboard for timeline clips (survives editor close/reopen). */
    static _clipClipboard = null;

    /** Drop body-level classes / orphaned DOM left by a killed editor. */
    static scrubGlobalUi() {
        document.body.classList.remove(...BODY_UI_CLASSES);
        document.querySelectorAll(".cat-te-media-drag-ghost, .cat-te-ctx-menu")
            .forEach((el) => el.remove());
        // Drop overlays that no longer belong to a live instance (or whose
        // instance was destroyed mid-teardown without removing the node).
        const live = new Set(
            [...CapTimelineEditorApp._instances]
                .filter((te) => !te._destroyed && te._overlay)
                .map((te) => te._overlay),
        );
        document.querySelectorAll(".cat-te-overlay").forEach((el) => {
            if (!live.has(el)) el.remove();
        });
        for (const te of CapTimelineEditorApp._instances) {
            if (te._overlay && !te._overlay.isConnected) te._overlay = null;
        }
        CapTimelineEditorApp._open = null;
    }

    /** Walk to the outermost graph (root) for a LiteGraph graph / subgraph. */
    static _graphRoot(graph) {
        if (!graph) return null;
        let cur = graph;
        const seen = new Set();
        while (cur && !seen.has(cur)) {
            seen.add(cur);
            const parent = cur.parent_graph ?? cur.parent ?? null;
            if (!parent) return cur;
            cur = parent;
        }
        return graph;
    }

    /**
     * Persist open editors into node widgets (for serialize / tab switch).
     * When `forGraph` is set, only flush editors whose node still belongs to
     * that graph tree — avoids writing timeline state into the wrong workflow
     * if a serialize runs while another graph is active.
     */
    static flushOpenEditors(forGraph = null) {
        const root = forGraph ? CapTimelineEditorApp._graphRoot(forGraph) : null;
        for (const te of CapTimelineEditorApp._instances) {
            if (te._destroyed || !te._overlay?.classList.contains("open") || !te._timeline) continue;
            if (!te.node?.graph) continue;
            if (root && CapTimelineEditorApp._graphRoot(te.node.graph) !== root) continue;
            try { te._saveToWidgets(); } catch { /* node may be mid-teardown */ }
        }
    }

    /** Close the fullscreen shell without destroying node-bound instances. */
    static closeOpenEditor() {
        const open = CapTimelineEditorApp._open;
        if (open && !open._destroyed) {
            try { open.close(); } catch { /* ignore */ }
        }
        document.body.classList.remove(...BODY_UI_CLASSES);
        document.querySelectorAll(".cat-te-media-drag-ghost, .cat-te-ctx-menu")
            .forEach((el) => el.remove());
        CapTimelineEditorApp._open = null;
    }

    /** Close every live editor and scrub global UI leftovers. */
    static forceCloseAll() {
        for (const te of [...CapTimelineEditorApp._instances]) {
            try { te.destroy(); } catch { /* continue scrubbing */ }
        }
        CapTimelineEditorApp.scrubGlobalUi();
    }

    constructor(node) {
        this.node = node;
        this._destroyed = false;
        this._meta = new Map();
        this._trackInfo = new Map();
        this._imgFiles = [];
        this._videoFiles = [];
        this._audioFiles = [];
        this._mediaStatus = new Map();
        this._projectResources = [];
        this._videoThumbCache = new Map();
        this._mediaStarFilter = "all";
        this._mediaKindFilters = new Set();
        this._mediaTypeFilters = new Set();
        this._mediaTagFilters = new Set();
        this._mediaFilterOpen = false;
        this._mediaStarsByDir = {};
        this._mediaBatchMode = false;
        this._mediaBatchSelected = new Set();
        this._mediaListView = localStorage.getItem(STORAGE_MEDIA_LIST_VIEW) === "1";
        this._mediaPreviewState = null;
        this._clipPreviewIndex = new Map();
        this._overlay = null;
        this._timeline = null;
        this._mainTrack = null;
        this._overlayTrack = null;
        this._audioTrack = null;
        this._selClip = null;
        this._selClips = [];
        this._undoStack = [];
        this._redoStack = [];
        this._historyReady = false;
        this._restoringHistory = false;
        this._playbackCtx = null;
        this._activeAudioSources = [];
        this._autoSaveTimer = null;
        /** In-flight media-library HTML5 drag payload (same-document DnD). */
        this._dndMedia = null;
        this._dndHoverClip = null;
        this._abortMediaDrag = null;
        /** Guard against overlapping OS file drops / uploads. */
        this._fileDropBusy = false;
        this._previewImages = new Map();
        this._previewVideos = new Map();
        this._programPreviewRaf = 0;
        this._programStageObserver = null;
        this._programHadFrame = false;
        this._programCanvasKey = "";
        this._programOffscreen = null;
        this._onProgramVisChange = null;
        this._pendingGeneratedJobs = [];
        this._deferredGeneratedJobs = [];
        this._genVideoState = null;
        this._outputVideosClipId = null;
        this._outputVideosCache = [];
        this._outputVideosTimeRange = OUTPUT_VIDEOS_TIME_RANGES[0].id;
        this._outputVideosThumbIo = null;
        this._outputVideoHoverEl = null;
        this._outputVideoHoverVideo = null;
        this._outputVideoHoverFile = null;
        this._outputVideoHoverHideTimer = 0;
        this._outputVideoHoverAnchor = null;
        this._composeBusy = false;
        this._watermark = this._defaultWatermark();
        /** When true, Run associates CapTimelineEditor/..._{clipId}.mp4 by specified name. */
        this._useClipSpecifiedVideoFilename = true;
        /** Temporary stamp written into project settings for one queuePrompt. */
        this._genVideoStamp = null;
        this._systemFonts = null;
        this._systemFontsPromise = null;
        /** When set, next queued project_json asks Python to emit only these clip ids. */
        this._runtimeOnlyClipIds = null;
        this._composePreviewRaf = 0;
        this._videoThumbActive = 0;
        this._videoThumbWaiters = [];
        this._timelineReady = false;
        this._loadSeq = 0;
        this._openGen = 0;
        this._bindExecutionWatch();
        CapTimelineEditorApp._instances.add(this);
        loadEditorCss();
        this._buildLauncher();
    }

    _w(name) { return this.node.widgets?.find(w => w.name === name); }
    _currentVersion() { return String(this._w("project_version")?.value || "0.0.0"); }
    _currentSchemaVersion() { return SCHEMA_VERSION; }
    getFps() { return Math.max(1, parseInt(this._w("fps")?.value ?? 24, 10) || 24); }
    getPreviewSize() {
        const w = Math.max(1, Math.round(Number(this._w("width")?.value ?? PY_SCALAR_DEFAULTS.width) || PY_SCALAR_DEFAULTS.width));
        const h = Math.max(1, Math.round(Number(this._w("height")?.value ?? PY_SCALAR_DEFAULTS.height) || PY_SCALAR_DEFAULTS.height));
        return { w, h };
    }

    _buildLauncher() {
        const root = document.createElement("div");
        root.className = "cat-te-launcher";
        root.innerHTML = `
          <button type="button" class="cat-te-open-btn">${T("launcher_open_btn")}</button>
          <div class="cat-te-launcher-hint">${T("launcher_hint")}</div>
        `;
        const btn = root.querySelector(".cat-te-open-btn");
        // Stop LiteGraph/ComfyUI from treating launcher clicks as node selection
        // (which opens the properties panel and can swallow the button action).
        const blockNodeSelect = (e) => {
            e.stopPropagation();
        };
        for (const type of ["pointerdown", "mousedown", "mouseup", "click", "dblclick"]) {
            root.addEventListener(type, blockNodeSelect);
        }
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.open();
        });
        const w = this.node.addDOMWidget("te_launcher", "timeline_editor", root, {
            getMinHeight: () => 72,
            getHeight: () => 72,
        });
        w.serialize = false;
        // DomWidgets: size = (widget.width ?? node.width) - margin*2.
        // Keep width unset so a stale widget.width cannot outgrow the node.
        Object.defineProperty(w, "width", {
            get() { return undefined; },
            set() {},
            enumerable: true,
            configurable: true,
        });
        this.launcherWidget = w;
        this.node.setSize([360, 280]);
    }

    open() {
        // Already visible for this node — ignore duplicate opens.
        if (CapTimelineEditorApp._open === this && this._overlay?.classList.contains("open")) {
            return;
        }
        // Stale flag: marked open but overlay is hidden (close aborted mid-way).
        if (CapTimelineEditorApp._open === this) {
            CapTimelineEditorApp._open = null;
        } else if (CapTimelineEditorApp._open) {
            CapTimelineEditorApp._open.close();
        }
        this._ensureOverlay();
        this._overlay.classList.add("open");
        document.body.classList.add("cat-te-noscroll");
        CapTimelineEditorApp._open = this;
        this._overlay.focus();
        void this._ensureFontList();
        const gen = ++this._openGen;
        void this._openEditor(gen);
    }

    /** Selected clip on the timeline, or null. */
    getSelectedClip() {
        return this._timeline?._selected ?? this._selClip ?? null;
    }

    _fieldHasTextSelection(el) {
        if (!el) return false;
        const tag = el.tagName;
        if (tag === "TEXTAREA" || (tag === "INPUT" && /^(text|search|url|tel|password|number|email)$/i.test(el.type || "text"))) {
            try {
                return el.selectionStart !== el.selectionEnd;
            } catch {
                return false;
            }
        }
        if (el.isContentEditable || el.getAttribute?.("contenteditable") === "true") {
            const sel = window.getSelection?.();
            return !!(sel && !sel.isCollapsed && el.contains(sel.anchorNode));
        }
        return false;
    }

    _shortcutModKey(e) {
        const code = e.code || "";
        if (code.startsWith("Key") && code.length === 4) return code.slice(3).toLowerCase();
        const key = String(e.key || "").toLowerCase();
        if (key.length === 1) return key;
        return key;
    }

    /**
     * Editor shortcuts when fullscreen is open.
     * Ctrl/Cmd+Z/Y are always swallowed so ComfyUI graph-undo cannot close
     * the editor; outside text fields they drive the timeline undo/redo stack.
     * Ctrl+C/V copy/paste clips when clips are selected (even if focus is in a
     * prompt field), unless that field has a text selection — then native wins.
     * @returns {boolean} true if the event was handled
     */
    handleShortcutKey(e) {
        if (!this._overlay?.classList.contains("open")) return false;
        if (e.repeat) return false;
        const mod = e.ctrlKey || e.metaKey;
        if (!mod || e.altKey) return false;

        const key = this._shortcutModKey(e);
        const inField = !!e.target?.closest?.("input, textarea, select, [contenteditable='true']");

        // Block ComfyUI undo/redo from tearing down the fullscreen shell.
        if (key === "z" || key === "y") {
            e.stopPropagation();
            e.stopImmediatePropagation?.();
            if (inField) {
                // Native text undo/redo — do not preventDefault.
                return true;
            }
            e.preventDefault();
            if (key === "y" || (key === "z" && e.shiftKey)) void this.redo();
            else void this.undo();
            return true;
        }

        if (e.shiftKey) return false;

        if (key === "c") {
            // Let native copy win when the user highlighted text in an input.
            if (inField && this._fieldHasTextSelection(e.target?.closest?.("input, textarea, select, [contenteditable='true']") || e.target)) {
                return false;
            }
            if (!this._copySelectedClips()) return false;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();
            this._overlay?.focus?.();
            return true;
        }
        if (key === "v") {
            // Never hijack paste inside text fields.
            if (inField) return false;
            if (!this._pasteClips()) return false;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();
            this._overlay?.focus?.();
            return true;
        }
        if (inField) return false;
        if (key !== "b" && key !== "g") return false;
        const clip = this.getSelectedClip();
        if (!clip) return false;
        if (clip.track?.type === "audio") return false;
        if (key === "b") this._toggleDisableClip(clip);
        else this._disableOthers(clip);
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        return true;
    }

    /**
     * Arrow keys — browse media preview when the modal is open.
     * @returns {boolean} true if the event was handled
     */
    handleMediaPreviewKey(e) {
        if (!this._overlay?.classList.contains("open")) return false;
        if (this.mediaPreviewModal?.hidden) return false;
        if (this._mediaPreviewState?.browse === false) return false;
        if (e.target?.closest?.("input, textarea, select")) return false;
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return false;
        this._stepMediaPreview(e.key === "ArrowRight" ? 1 : -1);
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        return true;
    }

    /**
     * Arrow keys — switch clip while AI Optimize modal is open.
     * @returns {boolean} true if the event was handled
     */
    handleAiOptimizeKey(e) {
        if (!this._overlay?.classList.contains("open")) return false;
        if (!this.aiOptimizeModal || this.aiOptimizeModal.hidden) return false;
        if (e.target?.closest?.("input, textarea, select, [contenteditable='true']")) return false;
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return false;
        void this._stepAiOptimizeClip(e.key === "ArrowRight" ? 1 : -1);
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        return true;
    }

    async _openEditor(gen = this._openGen) {
        this._historyReady = false;
        this._openedWidgetValues = Object.fromEntries(
            ["fps", "width", "height"].map(name => [name, this._w(name)?.value]),
        );
        // Re-apply panel layout each open (window size / localStorage may have changed).
        this._applySavedMediaPanelWidth();
        this._applySavedSidebarPanelWidth();
        this._applySavedProgramPanelHeight();
        // Bind (or re-bind) OS file drops — overlay may predate this feature.
        this._bindExternalFileDrop();
        try {
            await this._initTimelineFromWidgets();
        } catch (error) {
            this._discardTimeline();
            alert(T("load_timeline_failed", { msg: error instanceof Error ? error.message : String(error) }));
            return;
        }
        if (gen !== this._openGen || CapTimelineEditorApp._open !== this || !this._overlay?.classList.contains("open")) {
            if (CapTimelineEditorApp._open !== this || !this._overlay?.classList.contains("open")) {
                this._discardTimeline();
            }
            return;
        }
        await this._reloadMediaLibrary();
        if (gen !== this._openGen || CapTimelineEditorApp._open !== this || !this._overlay?.classList.contains("open")) {
            if (CapTimelineEditorApp._open !== this || !this._overlay?.classList.contains("open")) {
                this._discardTimeline();
            }
            return;
        }
        this._refreshTimelineDuration();
        this._applyDeferredGeneratedVideos();
        const viewSettings = this._readViewSettingsFromProjectWidget();
        requestAnimationFrame(() => {
            if (gen !== this._openGen) return;
            this._timeline?._refresh();
            // Scroll needs laid-out viewport; restore again after paint.
            this._applyTimelineViewFromSettings(viewSettings, { applyZoom: false });
        });
        this._undoStack = [];
        this._redoStack = [];
        this._historyReady = true;
        this._openedProjectJson = JSON.stringify(this._buildProject());
        this._updateHistoryButtons();
        this._selClip = null;
        this._selClips = [];
        this._updatePromptPanel();
        this._startAutoSave();
        this._scheduleProgramPreview();
    }

    _getAutosaveIntervalSec() {
        const n = parseInt(localStorage.getItem(STORAGE_AUTOSAVE_INTERVAL) ?? String(DEFAULT_AUTOSAVE_INTERVAL_SEC), 10);
        if (!Number.isFinite(n)) return DEFAULT_AUTOSAVE_INTERVAL_SEC;
        return Math.min(MAX_AUTOSAVE_INTERVAL_SEC, Math.max(MIN_AUTOSAVE_INTERVAL_SEC, n));
    }

    _startAutoSave() {
        this._stopAutoSave();
        const tick = () => {
            if (this._overlay?.classList.contains("open")) this._autoSaveIfDirty();
            this._autoSaveTimer = setTimeout(tick, this._getAutosaveIntervalSec() * 1000);
        };
        this._autoSaveTimer = setTimeout(tick, this._getAutosaveIntervalSec() * 1000);
    }

    _stopAutoSave() {
        if (this._autoSaveTimer) {
            clearTimeout(this._autoSaveTimer);
            this._autoSaveTimer = null;
        }
    }

    _autoSaveIfDirty() {
        if (!this._timeline || !this._historyReady) return;
        if (!this._hasUnsavedChanges()) return;
        this._saveToWidgets();
        this._openedProjectJson = JSON.stringify(this._buildProject());
    }

    _hasUnsavedChanges() {
        if (!this._timeline) return false;
        return JSON.stringify(this._buildProject()) !== this._openedProjectJson;
    }

    close() {
        if (!this._overlay) return;
        this._closeInternal(true);
    }

    _closeInternal(save) {
        // Invalidate any in-flight _openEditor so it won't rebuild after close.
        this._openGen += 1;
        this._historyReady = false;
        try {
            this._abortMediaDrag?.();
            this._abortMediaDrag = null;
            this._stopAutoSave();
            this._stopAudioPlayback();
            try { this._closeMediaPreview(); } catch { /* ignore */ }
            try { this._closeGenVideoModal(); } catch { /* ignore */ }
            try { this._closeOutputVideosPicker(); } catch { /* ignore */ }
            try { this._closeComposeModal(true); } catch { /* ignore */ }
            try { this._closeAddMaterial(); } catch { /* ignore */ }
            try { this._closeSettings(); } catch { /* ignore */ }
            this._removeCtxMenu();
            try { this._persistPanelLayout(); } catch { /* ignore */ }
            try { this._persistViewToLocalCache(); } catch { /* ignore */ }
            if (save) {
                try { this._saveToWidgets(); } catch { /* node may already be removed */ }
            } else if (this._openedWidgetValues) {
                for (const [name, value] of Object.entries(this._openedWidgetValues)) {
                    const widget = this._w(name);
                    if (!widget || value === undefined) continue;
                    widget.value = value;
                }
            }
            this._discardTimeline();
            this._mainTrack = null;
            this._overlayTrack = null;
            this._selClip = null;
            this._mediaBatchMode = false;
            this._mediaBatchSelected.clear();
            this._mediaListResizeObserver?.disconnect();
            this._mediaListResizeObserver = null;
            try { this._clearClipInfoPanel(); } catch { /* overlay may be gone */ }
        } finally {
            this._overlay?.classList.remove("open");
            document.body.classList.remove(...BODY_UI_CLASSES);
            if (CapTimelineEditorApp._open === this) CapTimelineEditorApp._open = null;
        }
    }

    _discardTimeline() {
        this._timelineReady = false;
        this._historyReady = false;
        this._disposeProgramPreview();
        try { this._timeline?.destroy(); } catch { /* ignore */ }
        this._timeline = null;
        this._mainTrack = null;
        this._overlayTrack = null;
        this._audioTrack = null;
        this._selClip = null;
        this._selClips = [];
    }

    _parseProjectWidgetValue() {
        const raw = this._w("project_json")?.value;
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
            return { project: raw, error: null };
        }
        const text = String(raw ?? "").trim();
        if (!text) return { project: null, error: null };
        try {
            const project = JSON.parse(text);
            if (!project || typeof project !== "object" || Array.isArray(project)) {
                return { project: null, error: new Error(T("project_json_root_invalid")) };
            }
            return { project, error: null };
        } catch (error) {
            return { project: null, error: error instanceof Error ? error : new Error(String(error)) };
        }
    }

    _openSettings() {
        if (!this.settingsModal) return;
        this.autosaveIntervalInput.value = String(this._getAutosaveIntervalSec());
        if (this.useClipVideoFilenameCb) {
            this.useClipVideoFilenameCb.checked = this._useClipSpecifiedVideoFilename !== false;
        }
        this.settingsModal.hidden = false;
        void this._loadAgentConfigs();
    }

    _closeSettings() {
        if (this.settingsModal) this.settingsModal.hidden = true;
        this._cancelAgentEdit();
    }

    async _loadAgentConfigs() {
        if (!this.agentList) return;
        this.agentList.textContent = T("loading_ellipsis");
        try {
            const response = await fetch(api.apiURL("/audio_keyframe_timeline/agents"));
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            this._agentConfigs = Array.isArray(data.agents) ? data.agents : [];
            this._renderAgentConfigs();
        } catch (error) {
            this.agentList.textContent = T("load_failed", { msg: error instanceof Error ? error.message : String(error) });
        }
    }

    _renderAgentConfigs() {
        if (!this.agentList) return;
        this.agentList.replaceChildren();
        if (!this._agentConfigs?.length) {
            const empty = document.createElement("div");
            empty.className = "cat-te-agent-empty";
            empty.textContent = T("no_agents_yet");
            this.agentList.appendChild(empty);
            return;
        }
        for (const config of this._agentConfigs) {
            const row = document.createElement("div");
            row.className = "cat-te-agent-row";
            const text = document.createElement("div");
            text.className = "cat-te-agent-row-text";
            const title = document.createElement("strong");
            title.textContent = config.label || T("unnamed");
            const detail = document.createElement("span");
            detail.textContent = `${config.provider === "gemini" ? "Gemini" : "OpenAI"} · ${config.model}${config.enabled ? "" : T("agent_disabled_suffix")}`;
            text.append(title, detail);
            const edit = document.createElement("button");
            edit.type = "button";
            edit.className = "cat-te-btn";
            edit.textContent = T("edit_btn");
            edit.addEventListener("click", () => this._editAgentConfig(config));
            row.append(text, edit);
            this.agentList.appendChild(row);
        }
    }

    _editAgentConfig(config = null) {
        if (!this.agentForm) return;
        this._editingAgentId = config?.id || "";
        this.agentLabelInput.value = config?.label || "";
        this.agentProviderSelect.value = config?.provider || "openai";
        this.agentModelInput.value = config?.model || AGENT_DEFAULT_MODELS[this.agentProviderSelect.value] || "";
        this.agentKeyInput.value = "";
        this.agentKeyInput.placeholder = config?.has_key ? T("leave_blank_keep_key") : T("enter_api_key");
        this.agentEnabledCb.checked = config?.enabled !== false;
        this.agentDeleteBtn.hidden = !config;
        this.agentForm.hidden = false;
        this.agentLabelInput.focus();
    }

    _cancelAgentEdit() {
        this._editingAgentId = "";
        if (this.agentForm) this.agentForm.hidden = true;
        if (this.agentKeyInput) this.agentKeyInput.value = "";
    }

    async _saveAgentConfig() {
        const payload = {
            id: this._editingAgentId || undefined,
            label: this.agentLabelInput?.value.trim() || "",
            provider: this.agentProviderSelect?.value || "openai",
            model: this.agentModelInput?.value.trim() || "",
            api_key: this.agentKeyInput?.value.trim() || "",
            enabled: !!this.agentEnabledCb?.checked,
        };
        try {
            const response = await fetch(api.apiURL("/audio_keyframe_timeline/agents"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            this._cancelAgentEdit();
            await this._loadAgentConfigs();
        } catch (error) {
            alert(T("save_agent_failed", { msg: error instanceof Error ? error.message : String(error) }));
        }
    }

    async _deleteAgentConfig() {
        if (!this._editingAgentId || !confirm(T("confirm_delete_agent"))) return;
        try {
            const response = await fetch(api.apiURL(`/audio_keyframe_timeline/agents/${encodeURIComponent(this._editingAgentId)}`), { method: "DELETE" });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            this._cancelAgentEdit();
            await this._loadAgentConfigs();
        } catch (error) {
            alert(T("delete_agent_failed", { msg: error instanceof Error ? error.message : String(error) }));
        }
    }

    _confirmOverwriteImport() {
        return !(this._hasUnsavedChanges() && !confirm(T("confirm_overwrite_import")));
    }

    _showImportMenu(e) {
        const r = e.currentTarget.getBoundingClientRect();
        this._buildCtxMenu([
            { label: T("import_from_directory"), fn: () => void this._importFromDirectory() },
            { label: T("import_from_zip"), fn: () => this._chooseZipImport() },
        ], r.left, r.bottom + 4);
    }

    _showExportMenu(e) {
        const r = e.currentTarget.getBoundingClientRect();
        this._buildCtxMenu([
            { label: T("export_to_directory"), fn: () => void this._exportToDirectory() },
            { label: T("export_as_zip"), fn: () => void this._exportAsZip() },
            { label: T("compose_video_menu"), fn: () => void this._composeGeneratedVideosExport() },
        ], r.left, r.bottom + 4);
    }

    _showRunMenu(e) {
        const r = e.currentTarget.getBoundingClientRect();
        this._buildCtxMenu([
            { label: T("run_all_clips_menu"), fn: () => void this._runAllActiveClipsDownstream() },
            { label: T("run_workflow_menu"), fn: () => void this._runWorkflow() },
        ], r.left, r.bottom + 4);
    }

    _showAddTrackMenu(e) {
        const r = e.currentTarget.getBoundingClientRect();
        this._buildCtxMenu([
            { label: T("media_track_menu"), fn: () => this._addUserTrack("image") },
            { label: T("audio_track_menu"), fn: () => this._addUserTrack("audio") },
            { label: T("subtitle_track_menu"), fn: () => this._addUserTrack("text") },
        ], r.left, r.bottom + 4);
    }

    _addUserTrack(type) {
        if (!this._timeline) return;
        const name = type === "audio"
            ? T("audio_track_name")
            : isSubtitleTrackType(type)
                ? T("subtitle_track_name")
                : T("overlay_track_name");
        const track = this._timeline.addTrack({
            type,
            name,
            height: trackHeightFor(type),
            isMain: false,
        });
        this._trackInfo.set(track.id, {
            trackIndex: this._nextTrackIndex(),
            enabled: true,
            role: type === "audio" ? "audio" : isSubtitleTrackType(type) ? "subtitle" : "overlay",
        });
        this._setupTrackControls(track);
        this._saveToWidgets();
        return track;
    }

    /** Visual clips that are not disabled (and whose track is enabled). */
    _listActiveVisualClips() {
        const out = [];
        for (const track of this._allImageTracks()) {
            const info = this._trackInfo.get(track.id) || {};
            if (info.enabled === false) continue;
            for (const clip of track.clips) {
                const meta = this._meta.get(clip.id) ?? defaultImageMeta();
                if (meta.disabled || meta.clipType === "audio" || meta.clipType === "subtitle") continue;
                if (isSubtitleClipMeta(meta, track)) continue;
                // Empty package clips have nothing to generate.
                if (this._isEmptyGroupClip(meta)) continue;
                out.push(clip);
            }
        }
        out.sort((a, b) => {
            const dt = (a.startTime || 0) - (b.startTime || 0);
            if (dt !== 0) return dt;
            return String(a.id).localeCompare(String(b.id));
        });
        return out;
    }

    async _runWorkflow() {
        if (typeof app?.queuePrompt !== "function") {
            alert(T("queue_prompt_not_found"));
            return;
        }
        try {
            this._saveToWidgets();
            await app.queuePrompt(0);
        } catch (error) {
            alert(T("run_failed", { msg: error instanceof Error ? error.message : String(error) }));
        }
    }

    async _runAllActiveClipsDownstream() {
        const clips = this._listActiveVisualClips();
        if (!clips.length) {
            alert(T("no_active_clips_to_run"));
            return;
        }
        if (typeof app?.queuePrompt !== "function") {
            alert(T("queue_prompt_not_found"));
            return;
        }
        if (this._runAllClipsBusy) return;
        this._runAllClipsBusy = true;
        try {
            for (const clip of clips) {
                if (this._destroyed || !this._timeline) break;
                await this._runClipDownstream(clip);
            }
        } finally {
            this._runAllClipsBusy = false;
        }
    }

    _safeProjectFilename(fallback = T("untitled_project")) {
        const projectName = String(this.projectNameInput?.value || fallback).trim() || fallback;
        return projectName
            .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
            .replace(/[. ]+$/g, "")
            .slice(0, 80) || fallback;
    }

    _makeGenVideoStamp() {
        const d = new Date();
        const p = (n) => String(n).padStart(2, "0");
        return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    }

    _clipSpecifiedVideoPath(clipId, stamp = this._genVideoStamp) {
        const name = this._safeProjectFilename();
        const id = String(clipId || "clip").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 80) || "clip";
        const st = String(stamp || this._makeGenVideoStamp());
        return `CapTimelineEditor/${name}/${st}_${id}.mp4`;
    }

    async _pickDirectory(mode = "readwrite") {
        if (typeof window.showDirectoryPicker !== "function") {
            throw new Error(T("directory_picker_unsupported"));
        }
        return window.showDirectoryPicker({ mode });
    }

    async _writeRelativeFile(root, relPath, data) {
        const parts = String(relPath || "").replace(/\\/g, "/").split("/").filter(Boolean);
        if (!parts.length) throw new Error(T("invalid_export_path"));
        let dir = root;
        for (let i = 0; i < parts.length - 1; i++) {
            dir = await dir.getDirectoryHandle(parts[i], { create: true });
        }
        const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
        const writable = await fh.createWritable();
        await writable.write(data);
        await writable.close();
    }

    async _readRelativeFile(root, relPath) {
        const parts = String(relPath || "").replace(/\\/g, "/").split("/").filter(Boolean);
        if (!parts.length) throw new Error(T("invalid_import_path"));
        let dir = root;
        for (let i = 0; i < parts.length - 1; i++) {
            dir = await dir.getDirectoryHandle(parts[i]);
        }
        const fh = await dir.getFileHandle(parts[parts.length - 1]);
        return fh.getFile();
    }

    async _readImportMediaFile(root, kind, file) {
        const rel = String(file || "").replace(/\\/g, "/");
        const base = rel.split("/").filter(Boolean).pop() || "";
        const kindDir = kind === "audio" ? "audios" : kind === "video" ? "videos" : "images";
        const candidates = [...new Set([
            rel,
            base ? `media/${kindDir}/${base}` : "",
            base ? `${kindDir}/${base}` : "",
            base,
        ].filter(Boolean))];
        let lastError = null;
        for (const path of candidates) {
            try {
                return await this._readRelativeFile(root, path);
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError || new Error(T("missing_asset_file", { file }));
    }

    _downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    _validateImportedProject(project) {
        if (!project || typeof project !== "object" || Array.isArray(project)) {
            throw new Error(T("project_root_must_be_object"));
        }
        if (!Array.isArray(project.tracks) && !Array.isArray(project.media) && !Array.isArray(project.resources)) {
            throw new Error(T("project_missing_tracks_media"));
        }
        if (!Array.isArray(project.tracks)) project.tracks = [];
        return this._migrateProjectDocument(project);
    }

    async _applyImportedProject(project, warnings = []) {
        project = this._validateImportedProject(project);
        this._historyReady = false;
        this._stopAudioPlayback();
        this._timeline?.destroy();
        this._timeline = null;
        await this._initTimelineFromWidgets(project, { applySettingsFromProject: true });
        await this._reloadMediaLibrary();
        this._undoStack = [];
        this._redoStack = [];
        this._historyReady = true;
        this._updateHistoryButtons();
        requestAnimationFrame(() => this._timeline?._refresh());
        if (warnings?.length) {
            alert(T("import_complete_with_warnings", { n: warnings.length, list: warnings.slice(0, 8).join("\n") + (warnings.length > 8 ? "\n…" : "") }));
        }
    }

    _iterProjectMedia(project) {
        const doc = this._migrateProjectDocument(project);
        const seen = new Set();
        const rows = [];
        const add = (kind, file, location = "input") => {
            kind = String(kind || "").toLowerCase();
            file = String(file || "").trim().replace(/\\/g, "/");
            if (!kind || !file || !["image", "video", "audio"].includes(kind)) return;
            const key = `${kind}|${file}`;
            if (seen.has(key)) return;
            seen.add(key);
            rows.push({ kind, file, location: String(location || "input") });
        };
        for (const resource of doc.media || []) {
            if (resource && typeof resource === "object") {
                add(resource.kind, resource.file, resource.location);
            }
        }
        return rows;
    }

    _remapProjectFiles(project, mapping) {
        const out = this._migrateProjectDocument(project);
        const mapFile = (kind, file) => {
            file = String(file || "").trim().replace(/\\/g, "/");
            if (!file) return file;
            return mapping.get(`${kind}|${file}`) || file;
        };
        out.media = (out.media || []).filter((r) => r && typeof r === "object").map((resource) => {
            const kind = String(resource.kind || "").toLowerCase();
            return { ...resource, file: mapFile(kind, resource.file), location: "input" };
        });
        delete out.resources;
        const catalog = new Set((out.media || []).map((row) => String(row.id || "")));
        for (const track of out.tracks || []) {
            if (!track || typeof track !== "object") continue;
            for (const clip of track.clips || []) {
                if (!clip || typeof clip !== "object") continue;
                const ids = Array.isArray(clip.media_ids) ? clip.media_ids : [];
                const valid = ids.map((id) => String(id)).filter((id) => catalog.has(id));
                if (valid.length) {
                    clip.media_ids = valid;
                    if (clip.source && typeof clip.source === "object") {
                        const source = {};
                        if (clip.source.in_ms != null) source.in_ms = clip.source.in_ms;
                        if (clip.source.out_ms != null) source.out_ms = clip.source.out_ms;
                        if (clip.source.duration_ms != null) source.duration_ms = clip.source.duration_ms;
                        if (Object.keys(source).length) clip.source = source;
                        else delete clip.source;
                    }
                    delete clip.items;
                    delete clip.end_image;
                    delete clip.start_image;
                    delete clip.audio_file;
                }
            }
        }
        return out;
    }

    async _uploadImportBlob(kind, filename, blob) {
        const form = new FormData();
        form.append("kind", kind);
        form.append("file", blob, filename || `file.${kind === "audio" ? "wav" : kind === "video" ? "mp4" : "png"}`);
        const response = await fetch(api.apiURL("/audio_keyframe_timeline/import_asset"), {
            method: "POST",
            body: form,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || T("upload_asset_failed", { filename }));
        return data;
    }

    async _exportToDirectory() {
        try {
            const dir = await this._pickDirectory("readwrite");
            const response = await fetch(api.apiURL("/audio_keyframe_timeline/export_prepare"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(this._buildProject()),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || T("export_prepare_failed"));
            const missing = [...(data.missing || [])];
            await this._writeRelativeFile(
                dir,
                "project.json",
                new Blob([JSON.stringify(data.project, null, 2)], { type: "application/json;charset=utf-8" }),
            );
            for (const entry of data.files || []) {
                const location = entry.location === "output" ? "output" : "input";
                const url = location === "output"
                    ? this._outputVideoUrl(entry.file)
                    : this._assetFileUrl(entry.file, entry.kind, "input");
                const fileRes = await fetch(url);
                if (!fileRes.ok) {
                    missing.push(entry.file);
                    continue;
                }
                await this._writeRelativeFile(dir, entry.arcname, await fileRes.blob());
            }
            if (missing.length) {
                alert(T("export_to_dir_missing", { n: missing.length, list: missing.slice(0, 8).join("\n") + (missing.length > 8 ? "\n…" : "") }));
            } else {
                alert(T("exported_to_directory"));
            }
        } catch (error) {
            if (error?.name === "AbortError") return;
            alert(T("export_failed", { msg: error instanceof Error ? error.message : String(error) }));
        }
    }

    _composeGeneratedVideosExport() {
        this._openComposeModal();
    }

    _composeDefaultFilename() {
        const stamp = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        const tag = `${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}`
            + `_${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`;
        return `${this._safeProjectFilename()}_${tag}.mp4`;
    }

    _openComposeModal() {
        if (!this.composeModal) return;
        if (this.composePrefixInput && !String(this.composePrefixInput.value || "").trim()) {
            this.composePrefixInput.value = "cap_timeline_compose/";
        }
        if (this.composeFilenameInput) this.composeFilenameInput.value = this._composeDefaultFilename();
        if (this.composeIgnoreAudioCb) this.composeIgnoreAudioCb.checked = false;
        if (this.composeUseGenSizeCb) this.composeUseGenSizeCb.checked = true;
        if (this.composeStatus) {
            this.composeStatus.hidden = true;
            this.composeStatus.textContent = "";
            this.composeStatus.classList.remove("is-error", "is-ok");
        }
        this._composeDone = false;
        this._lastComposeOutput = null;
        if (this.composeRunBtn) {
            this.composeRunBtn.disabled = false;
            this.composeRunBtn.textContent = T("compose_start_btn");
        }
        this._clampWatermarkMargin();
        this._wmActiveTab = this._watermark.image.file ? "image" : "text";
        this._syncWatermarkUiFromState();
        void this._ensureFontList();
        this.composeModal.hidden = false;
        this._scheduleComposePreview();
    }

    _closeComposeModal(force = false) {
        if (this._composeBusy && !force) return;
        this._composeBusy = false;
        if (this.composeRunBtn) this.composeRunBtn.disabled = false;
        if (this.composeModal) this.composeModal.hidden = true;
    }

    _setComposeStatus(text, { error = false, ok = false } = {}) {
        if (!this.composeStatus) return;
        this.composeStatus.hidden = !text;
        this.composeStatus.textContent = text || "";
        this.composeStatus.classList.toggle("is-error", !!error);
        this.composeStatus.classList.toggle("is-ok", !!ok);
    }

    async _runComposeVideoExport() {
        if (this._composeBusy || !this.composeModal) return;
        let filenamePrefix = String(this.composePrefixInput?.value || "").trim() || "cap_timeline_compose/";
        filenamePrefix = filenamePrefix.replace(/\\/g, "/");
        if (this.composePrefixInput) this.composePrefixInput.value = filenamePrefix;

        let filename = String(this.composeFilenameInput?.value || "").trim();
        if (!filename) filename = this._composeDefaultFilename();
        if (!filename.toLowerCase().endsWith(".mp4")) filename += ".mp4";
        filename = filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/g, "");
        if (!filename.toLowerCase().endsWith(".mp4")) filename += ".mp4";
        if (this.composeFilenameInput) this.composeFilenameInput.value = filename;

        this._saveToWidgets();
        const project = this._buildProject();
        this._composeBusy = true;
        if (this.composeRunBtn) this.composeRunBtn.disabled = true;
        this._setComposeStatus(T("composing_please_wait"));
        try {
            const response = await fetch(api.apiURL("/audio_keyframe_timeline/compose_video"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    project,
                    filename_prefix: filenamePrefix,
                    filename,
                    ignore_audio_tracks: !!this.composeIgnoreAudioCb?.checked,
                    use_generated_video_size: this.composeUseGenSizeCb
                        ? !!this.composeUseGenSizeCb.checked
                        : true,
                    watermark: this._watermark,
                }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || T("compose_failed_http", { status: response.status }));

            const outName = data.filename || filename;
            const sub = String(data.subfolder || "").replace(/^\/+|\/+$/g, "");
            const rel = sub ? `${sub}/${outName}` : outName;
            this._lastComposeOutput = { filename: outName, subfolder: sub };
            this._composeDone = true;
            if (this.composeRunBtn) this.composeRunBtn.textContent = T("open_folder_btn");
            this._setComposeStatus(T("saved_to_output", { rel }), { ok: true });
        } catch (error) {
            if (error?.name === "AbortError") {
                this._setComposeStatus("");
                return;
            }
            this._setComposeStatus(error instanceof Error ? error.message : String(error), { error: true });
        } finally {
            this._composeBusy = false;
            if (this.composeRunBtn) this.composeRunBtn.disabled = false;
        }
    }

    async _revealComposeOutput() {
        if (!this._lastComposeOutput) return;
        try {
            const response = await fetch(api.apiURL("/audio_keyframe_timeline/reveal_output"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(this._lastComposeOutput),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || T("open_folder_prepare_failed"));
        } catch (error) {
            alert(T("open_folder_failed", { msg: error instanceof Error ? error.message : String(error) }));
        }
    }

    // ─── Watermark (compose modal) ─────────────────────────────────────────

    _defaultWatermark() {
        return {
            mode: "none",
            text: { content: "", fontFamily: "", fontPath: "", fontSize: 32, letterSpacing: 0, color: "#ffffff" },
            image: { file: "", disabled: false },
            opacity: 80,
            scale: 100,
            position: "bottom-right",
            margin: { top: 24, right: 24, bottom: 24, left: 24, locked: true },
        };
    }

    _normalizeWatermark(raw) {
        const d = this._defaultWatermark();
        const r = raw && typeof raw === "object" ? raw : {};
        const text = r.text && typeof r.text === "object" ? r.text : {};
        const image = r.image && typeof r.image === "object" ? r.image : {};
        const margin = r.margin && typeof r.margin === "object" ? r.margin : {};
        const num = (v, min, max, def) => {
            const n = Number(v);
            return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def;
        };
        const out = {
            text: {
                content: String(text.content ?? d.text.content),
                fontFamily: String(text.fontFamily ?? d.text.fontFamily),
                fontPath: String(text.fontPath ?? d.text.fontPath),
                fontSize: num(text.fontSize, 6, 400, d.text.fontSize),
                letterSpacing: num(text.letterSpacing ?? text.letter_spacing, -50, 200, d.text.letterSpacing),
                color: /^#[0-9a-fA-F]{6}$/.test(text.color || "") ? text.color : d.text.color,
            },
            image: {
                file: String(image.file ?? d.image.file),
                disabled: image.disabled === true,
            },
            opacity: num(r.opacity, 0, 100, d.opacity),
            scale: num(r.scale, 10, 300, d.scale),
            position: WATERMARK_POSITIONS.has(r.position) ? r.position : d.position,
            margin: {
                top: num(margin.top, 0, 100000, d.margin.top),
                right: num(margin.right, 0, 100000, d.margin.right),
                bottom: num(margin.bottom, 0, 100000, d.margin.bottom),
                left: num(margin.left, 0, 100000, d.margin.left),
                locked: margin.locked !== false,
            },
        };
        out.mode = (out.image.file && !out.image.disabled) ? "image" : (out.text.content.trim() ? "text" : "none");
        return out;
    }

    _clampWatermarkMargin() {
        const { w, h } = this.getPreviewSize();
        const maxX = Math.floor(w / 2);
        const maxY = Math.floor(h / 2);
        const m = this._watermark.margin;
        m.top = Math.min(m.top, maxY);
        m.bottom = Math.min(m.bottom, maxY);
        m.left = Math.min(m.left, maxX);
        m.right = Math.min(m.right, maxX);
    }

    _deriveWatermarkMode() {
        const wm = this._watermark;
        const useImage = wm.image.file && !wm.image.disabled;
        wm.mode = useImage ? "image" : (String(wm.text.content || "").trim() ? "text" : "none");
    }

    async _ensureFontList() {
        if (this._systemFonts) return this._systemFonts;
        if (this._systemFontsPromise) return this._systemFontsPromise;
        this._systemFontsPromise = fetch(api.apiURL("/audio_keyframe_timeline/system_fonts"))
            .then((r) => r.json())
            .then((data) => {
                this._systemFonts = Array.isArray(data?.fonts) ? data.fonts : [];
                this._populateFontSelect();
                this._scheduleComposePreview();
                return this._systemFonts;
            })
            .catch(() => {
                this._systemFonts = [];
                this._populateFontSelect();
                return this._systemFonts;
            });
        return this._systemFontsPromise;
    }

    /** Fill a <select> with system fonts; keep `preferred` if present (or as custom option). */
    _fillSystemFontSelect(select, preferred, { autoPickFirst = false } = {}) {
        if (!select) return;
        const fonts = this._systemFonts || [];
        const prev = String(preferred || "").trim();
        select.innerHTML = "";
        if (!fonts.length) {
            const opt = document.createElement("option");
            opt.value = prev;
            opt.textContent = this._systemFonts ? T("font_not_found") : T("font_loading");
            select.appendChild(opt);
            return;
        }
        for (const f of fonts) {
            const opt = document.createElement("option");
            opt.value = f.family;
            opt.dataset.path = f.path || "";
            opt.textContent = f.family;
            select.appendChild(opt);
        }
        if (prev && fonts.some((f) => f.family === prev)) {
            select.value = prev;
        } else if (prev) {
            const opt = document.createElement("option");
            opt.value = prev;
            opt.textContent = prev;
            select.appendChild(opt);
            select.value = prev;
        } else if (autoPickFirst) {
            select.value = fonts[0].family;
        } else {
            select.value = fonts[0].family;
        }
    }

    _populateFontSelect() {
        const fonts = this._systemFonts || [];
        const wmSelect = this.wmFontFamily;
        if (wmSelect) {
            const current = this._watermark.text.fontFamily;
            this._fillSystemFontSelect(wmSelect, current, { autoPickFirst: true });
            if (fonts.length) {
                if (current && fonts.some((f) => f.family === current)) {
                    wmSelect.value = current;
                } else {
                    wmSelect.value = fonts[0].family;
                    this._watermark.text.fontFamily = fonts[0].family;
                    this._watermark.text.fontPath = fonts[0].path;
                }
            }
        }
        const subSelect = this.subFontSelect;
        if (subSelect) {
            let preferred = subSelect.value;
            const clip = this._selClip;
            if (clip && isSubtitleTrackType(clip.track?.type)) {
                preferred = this._meta.get(clip.id)?.fontFamily || preferred;
            }
            this._fillSystemFontSelect(subSelect, preferred, { autoPickFirst: !preferred });
        }
    }

    async _onWatermarkImagePicked(event) {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        try {
            const uploaded = await this._uploadImportBlob("image", file.name, file);
            this._watermark.image.file = uploaded.file;
            this._watermark.image.disabled = false;
            this._deriveWatermarkMode();
            this._wmActiveTab = "image";
            this._syncWatermarkUiFromState();
            this._scheduleComposePreview();
        } catch (error) {
            alert(T("upload_watermark_image_failed", { msg: error instanceof Error ? error.message : String(error) }));
        }
    }

    _removeWatermarkImage() {
        this._watermark.image.file = "";
        this._watermark.image.disabled = false;
        this._deriveWatermarkMode();
        this._wmActiveTab = "text";
        this._syncWatermarkUiFromState();
        this._scheduleComposePreview();
    }

    _bindWatermarkUi() {
        this.wmTabs?.forEach((btn) => {
            btn.addEventListener("click", () => {
                this._wmActiveTab = btn.dataset.mode;
                this._syncWatermarkUiFromState();
            });
        });
        this.wmTextContent?.addEventListener("input", () => {
            this._watermark.text.content = this.wmTextContent.value;
            this._deriveWatermarkMode();
            this._scheduleComposePreview();
        });
        this.wmFontFamily?.addEventListener("change", () => {
            const opt = this.wmFontFamily.selectedOptions?.[0];
            this._watermark.text.fontFamily = this.wmFontFamily.value;
            this._watermark.text.fontPath = opt?.dataset.path || "";
            this._scheduleComposePreview();
        });
        this.wmFontSize?.addEventListener("input", () => {
            this._watermark.text.fontSize = Math.max(6, Math.min(400, Number(this.wmFontSize.value) || 32));
            this._scheduleComposePreview();
        });
        this.wmLetterSpacing?.addEventListener("input", () => {
            this._watermark.text.letterSpacing = Math.max(-50, Math.min(200, Number(this.wmLetterSpacing.value) || 0));
            this._scheduleComposePreview();
        });
        this.wmFontColor?.addEventListener("input", () => {
            this._watermark.text.color = this.wmFontColor.value;
            this._scheduleComposePreview();
        });
        this.wmImageUploadBtn?.addEventListener("click", () => this.wmImageFileInput?.click());
        this.wmImageFileInput?.addEventListener("change", (e) => void this._onWatermarkImagePicked(e));
        this.wmImageDeleteBtn?.addEventListener("click", () => this._removeWatermarkImage());
        this.wmImageDisabledCb?.addEventListener("change", () => {
            this._watermark.image.disabled = !!this.wmImageDisabledCb.checked;
            this._deriveWatermarkMode();
            this._scheduleComposePreview();
        });
        this.wmOpacity?.addEventListener("input", () => {
            this._watermark.opacity = Number(this.wmOpacity.value) || 0;
            if (this.wmOpacityReadout) this.wmOpacityReadout.textContent = `${this._watermark.opacity}%`;
            this._scheduleComposePreview();
        });
        this.wmScale?.addEventListener("input", () => {
            this._watermark.scale = Number(this.wmScale.value) || 100;
            if (this.wmScaleReadout) this.wmScaleReadout.textContent = `${this._watermark.scale}%`;
            this._scheduleComposePreview();
        });
        this.wmPosButtons?.forEach((btn) => {
            btn.addEventListener("click", () => {
                this._watermark.position = btn.dataset.pos;
                this._syncWatermarkPositionUi();
                this._scheduleComposePreview();
            });
        });
        const marginInputs = [
            [this.wmMarginTop, "top"], [this.wmMarginRight, "right"],
            [this.wmMarginBottom, "bottom"], [this.wmMarginLeft, "left"],
        ];
        marginInputs.forEach(([input, key]) => {
            if (!input) return;
            input.addEventListener("input", () => {
                const { w, h } = this.getPreviewSize();
                const limit = (key === "top" || key === "bottom") ? Math.floor(h / 2) : Math.floor(w / 2);
                const v = Math.max(0, Math.min(limit, Math.round(Number(input.value) || 0)));
                input.value = String(v);
                if (this._watermark.margin.locked) {
                    this._watermark.margin.top = v;
                    this._watermark.margin.right = v;
                    this._watermark.margin.bottom = v;
                    this._watermark.margin.left = v;
                    if (this.wmMarginTop) this.wmMarginTop.value = String(v);
                    if (this.wmMarginRight) this.wmMarginRight.value = String(v);
                    if (this.wmMarginBottom) this.wmMarginBottom.value = String(v);
                    if (this.wmMarginLeft) this.wmMarginLeft.value = String(v);
                } else {
                    this._watermark.margin[key] = v;
                }
                this._scheduleComposePreview();
            });
        });
        this.wmMarginLockBtn?.addEventListener("click", () => {
            this._watermark.margin.locked = !this._watermark.margin.locked;
            if (this._watermark.margin.locked) {
                const v = this._watermark.margin.top;
                this._watermark.margin.right = v;
                this._watermark.margin.bottom = v;
                this._watermark.margin.left = v;
                if (this.wmMarginRight) this.wmMarginRight.value = String(v);
                if (this.wmMarginBottom) this.wmMarginBottom.value = String(v);
                if (this.wmMarginLeft) this.wmMarginLeft.value = String(v);
                this._scheduleComposePreview();
            }
            this._syncWatermarkMarginLockUi();
        });
    }

    _syncWatermarkMarginLockUi() {
        const locked = this._watermark.margin.locked;
        if (this.wmMarginLockBtn) {
            this.wmMarginLockBtn.innerHTML = iconHtml(locked ? "lock" : "lockOpen", 14);
            this.wmMarginLockBtn.classList.toggle("is-active", locked);
            this.wmMarginLockBtn.title = locked ? T("watermark_lock_locked_title") : T("watermark_lock_unlocked_title");
        }
    }

    _syncWatermarkPositionUi() {
        const pos = this._watermark.position;
        this.wmPosButtons?.forEach((btn) => btn.classList.toggle("is-active", btn.dataset.pos === pos));
    }

    _syncWatermarkUiFromState() {
        const wm = this._watermark;
        if (this.wmTextContent) this.wmTextContent.value = wm.text.content;
        if (this.wmFontSize) this.wmFontSize.value = String(wm.text.fontSize);
        if (this.wmLetterSpacing) this.wmLetterSpacing.value = String(wm.text.letterSpacing ?? 0);
        if (this.wmFontColor) this.wmFontColor.value = wm.text.color;
        if (this.wmOpacity) this.wmOpacity.value = String(wm.opacity);
        if (this.wmOpacityReadout) this.wmOpacityReadout.textContent = `${wm.opacity}%`;
        if (this.wmScale) this.wmScale.value = String(wm.scale);
        if (this.wmScaleReadout) this.wmScaleReadout.textContent = `${wm.scale}%`;
        if (this.wmMarginTop) this.wmMarginTop.value = String(wm.margin.top);
        if (this.wmMarginRight) this.wmMarginRight.value = String(wm.margin.right);
        if (this.wmMarginBottom) this.wmMarginBottom.value = String(wm.margin.bottom);
        if (this.wmMarginLeft) this.wmMarginLeft.value = String(wm.margin.left);
        this._syncWatermarkMarginLockUi();
        this._syncWatermarkPositionUi();
        if (this.wmImagePreview) {
            if (wm.image.file) {
                this.wmImagePreview.src = this._imgUrl(wm.image.file);
                this.wmImagePreview.hidden = false;
            } else {
                this.wmImagePreview.hidden = true;
                this.wmImagePreview.removeAttribute("src");
            }
        }
        if (this.wmImageDeleteBtn) this.wmImageDeleteBtn.hidden = !wm.image.file;
        if (this.wmImageDisabledRow) this.wmImageDisabledRow.hidden = !wm.image.file;
        if (this.wmImageDisabledCb) this.wmImageDisabledCb.checked = !!wm.image.disabled;
        const tab = this._wmActiveTab || (wm.image.file ? "image" : "text");
        this.wmTabs?.forEach((btn) => btn.classList.toggle("is-active", btn.dataset.mode === tab));
        if (this.wmPanelText) this.wmPanelText.hidden = tab !== "text";
        if (this.wmPanelImage) this.wmPanelImage.hidden = tab !== "image";
        this._populateFontSelect();
    }

    _scheduleComposePreview() {
        if (!this.composePreviewCanvas) return;
        if (this._composePreviewRaf) return;
        this._composePreviewRaf = requestAnimationFrame(() => {
            this._composePreviewRaf = 0;
            this._renderComposePreview();
        });
    }

    _layoutComposePreviewCanvas() {
        const stage = this.composePreviewStage;
        const canvas = this.composePreviewCanvas;
        if (!stage || !canvas) return null;
        const { w, h } = this.getPreviewSize();
        const sw = stage.clientWidth;
        const sh = stage.clientHeight;
        if (sw < 2 || sh < 2) return null;
        const scale = Math.min(sw / w, sh / h);
        const cssW = Math.max(1, Math.floor(w * scale));
        const cssH = Math.max(1, Math.floor(h * scale));
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const pw = Math.max(1, Math.round(cssW * dpr));
        const ph = Math.max(1, Math.round(cssH * dpr));
        if (canvas.width !== pw) canvas.width = pw;
        if (canvas.height !== ph) canvas.height = ph;
        return { canvasW: pw, canvasH: ph };
    }

    _watermarkXY(position, margin, cw, ch, ow, oh) {
        switch (position) {
            case "top-left": return { x: margin.left, y: margin.top };
            case "top-right": return { x: cw - ow - margin.right, y: margin.top };
            case "bottom-left": return { x: margin.left, y: ch - oh - margin.bottom };
            case "bottom-right": return { x: cw - ow - margin.right, y: ch - oh - margin.bottom };
            case "top-center": return { x: (cw - ow) / 2, y: margin.top };
            case "bottom-center": return { x: (cw - ow) / 2, y: ch - oh - margin.bottom };
            case "center":
            default: return { x: (cw - ow) / 2, y: (ch - oh) / 2 };
        }
    }

    _measureTextWithLetterSpacing(ctx, text, letterSpacing) {
        const s = String(text ?? "");
        if (!s) return 0;
        const spacing = Number(letterSpacing) || 0;
        if (!spacing) return ctx.measureText(s).width;
        const chars = Array.from(s);
        let w = 0;
        for (let i = 0; i < chars.length; i++) {
            w += ctx.measureText(chars[i]).width;
            if (i < chars.length - 1) w += spacing;
        }
        return w;
    }

    _drawTextWithLetterSpacing(ctx, text, x, y, letterSpacing, mode = "fill") {
        const s = String(text ?? "");
        if (!s) return;
        const spacing = Number(letterSpacing) || 0;
        if (!spacing) {
            if (mode === "stroke") ctx.strokeText(s, x, y);
            else ctx.fillText(s, x, y);
            return;
        }
        const chars = Array.from(s);
        const totalW = this._measureTextWithLetterSpacing(ctx, s, spacing);
        const align = ctx.textAlign || "left";
        let startX = x;
        if (align === "center") startX = x - totalW / 2;
        else if (align === "right" || align === "end") startX = x - totalW;
        const prevAlign = ctx.textAlign;
        ctx.textAlign = "left";
        let cx = startX;
        for (let i = 0; i < chars.length; i++) {
            if (mode === "stroke") ctx.strokeText(chars[i], cx, y);
            else ctx.fillText(chars[i], cx, y);
            cx += ctx.measureText(chars[i]).width + (i < chars.length - 1 ? spacing : 0);
        }
        ctx.textAlign = prevAlign;
    }

    _drawWatermarkOnCanvas(ctx, cw, ch) {
        const wm = this._watermark;
        if (!wm || wm.mode === "none") return;
        const previewPos = (wm.position === "random-interval" || wm.position === "random-fixed")
            ? "bottom-right" : wm.position;
        const { w: baseW } = this.getPreviewSize();
        const scaleFactor = cw / baseW;
        const margin = {
            top: wm.margin.top * scaleFactor,
            right: wm.margin.right * scaleFactor,
            bottom: wm.margin.bottom * scaleFactor,
            left: wm.margin.left * scaleFactor,
        };
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, (wm.opacity ?? 80) / 100));
        if (wm.mode === "image" && wm.image.file) {
            const entry = this._ensurePreviewImage(this._imgUrl(wm.image.file));
            if (entry?.ready) {
                const iw = entry.el.naturalWidth * scaleFactor * (wm.scale / 100);
                const ih = entry.el.naturalHeight * scaleFactor * (wm.scale / 100);
                const { x, y } = this._watermarkXY(previewPos, margin, cw, ch, iw, ih);
                ctx.drawImage(entry.el, x, y, iw, ih);
            }
        } else if (wm.mode === "text" && wm.text.content) {
            const fontSize = Math.max(1, wm.text.fontSize * scaleFactor * (wm.scale / 100));
            const letterSpacing = (Number(wm.text.letterSpacing) || 0) * scaleFactor * (wm.scale / 100);
            const family = wm.text.fontFamily ? `"${wm.text.fontFamily}", sans-serif` : "sans-serif";
            ctx.font = `${fontSize}px ${family}`;
            ctx.fillStyle = wm.text.color || "#ffffff";
            ctx.textBaseline = "top";
            ctx.textAlign = "left";
            const lines = String(wm.text.content).split("\n");
            const lineHeight = fontSize * 1.25;
            const textW = Math.max(0, ...lines.map((l) => this._measureTextWithLetterSpacing(ctx, l, letterSpacing)));
            const textH = lineHeight * lines.length;
            const { x, y } = this._watermarkXY(previewPos, margin, cw, ch, textW, textH);
            lines.forEach((line, i) => {
                this._drawTextWithLetterSpacing(ctx, line, x, y + i * lineHeight, letterSpacing, "fill");
            });
        }
        ctx.restore();
    }

    _renderComposePreview() {
        const layout = this._layoutComposePreviewCanvas();
        const canvas = this.composePreviewCanvas;
        if (!layout || !canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const { canvasW: cw, canvasH: ch } = layout;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, cw, ch);
        const t = this._timeline?.currentTime ?? 0;
        this._drawPreviewLayersOnce(ctx, cw, ch, t);
        this._drawSubtitleOverlays(ctx, cw, ch, t);
        this._drawWatermarkOnCanvas(ctx, cw, ch);
    }

    async _exportAsZip() {
        try {
            const response = await fetch(api.apiURL("/audio_keyframe_timeline/export_zip"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(this._buildProject()),
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || T("export_zip_failed"));
            }
            const blob = await response.blob();
            const headerName = response.headers.get("X-Export-Filename");
            const filename = headerName || `${this._safeProjectFilename()}.zip`;
            const missingHeader = response.headers.get("X-Export-Missing") || "";
            const missing = missingHeader ? missingHeader.split(",").filter(Boolean) : [];

            try {
                const dir = await this._pickDirectory("readwrite");
                await this._writeRelativeFile(dir, filename, blob);
            } catch (pickerError) {
                if (pickerError?.name === "AbortError") return;
                if (typeof window.showDirectoryPicker !== "function") {
                    this._downloadBlob(blob, filename);
                } else {
                    throw pickerError;
                }
            }
            if (missing.length) {
                alert(T("export_zip_missing", { n: missing.length, list: missing.slice(0, 8).join("\n") + (missing.length > 8 ? "\n…" : "") }));
            }
        } catch (error) {
            if (error?.name === "AbortError") return;
            alert(T("export_failed", { msg: error instanceof Error ? error.message : String(error) }));
        }
    }

    _chooseZipImport() {
        if (!this._confirmOverwriteImport()) return;
        this.importZipInput.value = "";
        this.importZipInput.click();
    }

    async _importFromDirectory() {
        if (!this._confirmOverwriteImport()) return;
        try {
            const dir = await this._pickDirectory("read");
            const projectFile = await this._readRelativeFile(dir, "project.json");
            const project = this._validateImportedProject(JSON.parse(await projectFile.text()));
            const mapping = new Map();
            const warnings = [];
            for (const row of this._iterProjectMedia(project)) {
                let fileObj;
                try {
                    fileObj = await this._readImportMediaFile(dir, row.kind, row.file);
                } catch {
                    warnings.push(T("missing_asset_file", { file: row.file }));
                    continue;
                }
                const uploaded = await this._uploadImportBlob(row.kind, fileObj.name || row.file.split("/").pop(), fileObj);
                mapping.set(`${row.kind}|${row.file}`, uploaded.file);
            }
            const remapped = this._remapProjectFiles(project, mapping);
            const clipCount = (remapped.tracks || []).reduce(
                (n, track) => n + (Array.isArray(track?.clips) ? track.clips.length : 0),
                0,
            );
            if (!clipCount) {
                alert(T("import_no_clips"));
            }
            await this._applyImportedProject(remapped, warnings);
        } catch (error) {
            if (error?.name === "AbortError") return;
            alert(T("import_failed", { msg: error instanceof Error ? error.message : String(error) }));
        }
    }

    async _importProjectZip(event) {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        try {
            const form = new FormData();
            form.append("file", file, file.name || "project.zip");
            const response = await fetch(api.apiURL("/audio_keyframe_timeline/import_project_zip"), {
                method: "POST",
                body: form,
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || T("import_zip_failed"));
            await this._applyImportedProject(data.project, data.warnings || []);
        } catch (error) {
            alert(T("import_failed", { msg: error instanceof Error ? error.message : String(error) }));
        }
    }

    destroy() {
        if (this._destroyed) return;
        // Save BEFORE marking destroyed — `_saveToWidgets` bails on `_destroyed`,
        // and tab-switch teardown (beforeConfigureGraph) used to skip the flush.
        try { this._closeInternal(true); } catch { /* continue teardown */ }
        this._destroyed = true;
        if (this._onDocClick) {
            document.removeEventListener("click", this._onDocClick);
            this._onDocClick = null;
        }
        if (this._onWinResize) {
            window.removeEventListener("resize", this._onWinResize);
            this._onWinResize = null;
        }
        if (this._onMediaPanelWinResize) {
            window.removeEventListener("resize", this._onMediaPanelWinResize);
            this._onMediaPanelWinResize = null;
        }
        if (this._onProgramPanelWinResize) {
            window.removeEventListener("resize", this._onProgramPanelWinResize);
            this._onProgramPanelWinResize = null;
        }
        if (this._playbackCtx) {
            this._playbackCtx.close().catch(() => {});
            this._playbackCtx = null;
        }
        this._overlay?.remove();
        this._overlay = null;
        CapTimelineEditorApp._instances.delete(this);
        if (CapTimelineEditorApp._open === this) CapTimelineEditorApp._open = null;
        this._unbindExecutionWatch();
        document.body.classList.remove(...BODY_UI_CLASSES);
    }

    _ensureOverlay() {
        if (this._overlay) {
            this._syncClipSettingRefs();
            return;
        }
        const el = document.createElement("div");
        el.className = "cat-te-overlay";
        el.tabIndex = -1;
        el.innerHTML = `
          <header class="cat-te-header">
            <div class="cat-te-brand">
              ${iconHtml("rabbit", 22)}
              <span class="cat-te-brand-name">${T("header_brand_name")}</span>
              <span class="cat-te-brand-sep"> | </span>
              <button type="button" class="cat-te-brand-project" title="${T("edit_project_name_title")}">${T("untitled_project")}</button>
            </div>
            <div class="cat-te-header-spacer"></div>
            <div class="cat-te-header-scalars" title="${T("node_size_fps_title")}"></div>
            <button type="button" class="cat-te-btn cat-te-import">${T("import_btn_caret")}</button>
            <button type="button" class="cat-te-btn cat-te-export">${T("export_btn_caret")}</button>
            <button type="button" class="cat-te-btn cat-te-settings">${T("settings_btn")}</button>
            <button type="button" class="cat-te-btn cat-te-header-close" title="${T("close_title")}">${iconHtml("close", 16)}</button>
            <input class="cat-te-import-zip" type="file" accept=".zip,application/zip" hidden />
          </header>
          <div class="cat-te-main">
            <aside class="cat-te-media">
              <div class="cat-te-media-header">
                <div class="cat-te-media-title">${T("media_title")}</div>
                <div class="cat-te-media-header-actions"></div>
              </div>
              <div class="cat-te-media-grid"></div>
            </aside>
            <div class="cat-te-media-split" role="separator" aria-orientation="vertical" aria-label="${T("media_split_aria")}" title="${T("media_split_title")}"></div>
            <div class="cat-te-center">
              <div class="cat-te-program">
                <div class="cat-te-program-stage">
                  <canvas class="cat-te-program-canvas" aria-label="${T("program_preview_aria")}"></canvas>
                  <div class="cat-te-program-empty" hidden>${T("no_frame")}</div>
                </div>
                <div class="cat-te-program-meta"></div>
              </div>
              <div class="cat-te-program-split" role="separator" aria-orientation="horizontal" aria-label="${T("program_split_aria")}" title="${T("program_split_title")}"></div>
              <div class="cat-te-timeline-host"></div>
            </div>
            <div class="cat-te-sidebar-split" role="separator" aria-orientation="vertical" aria-label="${T("sidebar_split_aria")}" title="${T("sidebar_split_title")}"></div>
            <aside class="cat-te-sidebar">
              <div class="cat-te-panel-title cat-te-sidebar-title">${T("project_settings_title")}</div>
              <div class="cat-te-project-panel">
                <div class="cat-te-project-body">
                  <label class="cat-te-project-name-row">
                    <span>${T("project_name_label")}</span>
                    <input class="cat-te-title" type="text" value="${T("untitled_project")}" aria-label="${T("project_name_label")}" />
                  </label>
                  <div class="cat-te-project-scalars" aria-label="${T("scalars_aria")}"></div>
                  <div class="cat-te-prompt-wrap cat-te-global-prompt-wrap">
                    <div class="cat-te-prompt-label-row">
                      <div class="cat-te-prompt-label">${T("global_prompt_label")}</div>
                      <button type="button" class="cat-te-prompt-comment-btn cat-te-global-prompt-comment-btn" title="${T("comment_toggle_title")}">${iconHtml("comment", 12)}</button>
                    </div>
                    <div class="cat-te-prompt-input-wrap">
                      <textarea class="cat-te-global-prompt-input" placeholder="${T("global_prompt_placeholder")}"></textarea>
                    </div>
                  </div>
                </div>
              </div>
              <div class="cat-te-clip-panel" hidden>
              <div class="cat-te-clip-info">
                <div class="cat-te-clip-info-body">
                  <div class="cat-te-clip-info-detail" hidden>
                    <div class="cat-te-clip-swiper">
                      <button type="button" class="cat-te-clip-swiper-nav prev" title="${T("prev_material")}" hidden>‹</button>
                      <div class="cat-te-clip-thumb-wrap">
                        <img class="cat-te-clip-thumb" alt="" />
                        <video class="cat-te-clip-thumb-video" muted playsinline hidden></video>
                        <div class="cat-te-clip-thumb-empty" hidden>${T("empty_clip")}</div>
                        <div class="cat-te-clip-thumb-subtitle" hidden>T</div>
                        <button type="button" class="cat-te-clip-thumb-sort" title="${T("view_material_title")}" hidden>${iconHtml("squareArrowOutUpRight", 12)}</button>
                        <button type="button" class="cat-te-clip-thumb-delete" title="${T("remove_from_clip_title")}" hidden>${iconHtml("trash", 12)}</button>
                      </div>
                      <button type="button" class="cat-te-clip-swiper-nav next" title="${T("next_material")}" hidden>›</button>
                      <span class="cat-te-clip-item-index"></span>
                    </div>
                    <div class="cat-te-clip-meta">
                      <div class="cat-te-clip-name-row">
                        <div class="cat-te-clip-name"></div>
                      </div>
                      <div class="cat-te-clip-id" hidden></div>

                      <div class="cat-te-clip-times">
                        <span class="cat-te-clip-start"></span>
                        <span class="cat-te-clip-sep">→</span>
                        <span class="cat-te-clip-end"></span>
                      </div>
                      <div class="cat-te-clip-source-trim" hidden>
                        <span class="cat-te-clip-source-trim-label"></span>
                        <span class="cat-te-clip-source-in"></span>
                        <span class="cat-te-clip-sep">→</span>
                        <span class="cat-te-clip-source-out"></span>
                      </div>
                      <div class="cat-te-clip-source-dur" hidden></div>
                      <div class="cat-te-clip-dur"></div>
                      <label class="cat-te-clip-setting-check cat-te-use-media-prompt">
                        <input class="cat-te-use-media-prompt-cb" type="checkbox" checked disabled />
                        <span>${T("use_media_prompt_label")}</span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
              <div class="cat-te-visual-clip-body">
              <div class="cat-te-clip-settings">
                <label class="cat-te-clip-setting-row">
                  <span>${T("type_label")}</span>
                  <select class="cat-te-clip-role" disabled>
                    <option value="multi_ref">${T("clip_role_multi_ref")}</option>
                    <option value="first_last">${T("clip_role_first_last")}</option>
                    <option value="t2v">${T("clip_role_t2v")}</option>
                    <option value="video_ref">${T("clip_role_video_ref")}</option>
                    <option value="video_edit">${T("clip_role_video_edit")}</option>
                    <option value="other">${T("clip_role_other")}</option>
                  </select>
                </label>
                <label class="cat-te-clip-setting-row cat-te-clip-role-custom-row" hidden>
                  <span>${T("custom_type_label")}</span>
                  <input class="cat-te-clip-role-custom" type="text" placeholder="${T("enter_type_placeholder")}" disabled />
                </label>
                <label class="cat-te-clip-setting-row">
                  <span>Agent</span>
                  <select class="cat-te-clip-agent" disabled>
                    <option value="MiniMaxH3">MiniMaxH3</option>
                    <option value="LTX">LTX</option>
                    <option value="Bernini">Bernini</option>
                    <option value="Wan">Wan</option>
                    <option value="other">${T("clip_role_other")}</option>
                  </select>
                </label>
                <label class="cat-te-clip-setting-row cat-te-clip-agent-custom-row" hidden>
                  <span>${T("custom_agent_label")}</span>
                  <input class="cat-te-clip-agent-custom" type="text" placeholder="${T("enter_model_name_placeholder")}" disabled />
                </label>
                <label class="cat-te-clip-setting-row">
                  <span>${T("head_extend_label")}</span>
                  <input class="cat-te-head-extend" type="number" min="0" max="600" step="1" value="0" disabled />
                </label>
                <label class="cat-te-clip-setting-row">
                  <span>${T("tail_extend_label")}</span>
                  <input class="cat-te-tail-extend" type="number" min="0" max="600" step="1" value="0" disabled />
                </label>
                <label class="cat-te-clip-setting-check">
                  <input class="cat-te-gen-preview-video" type="checkbox" disabled />
                  <span>${T("gen_preview_video_label")}</span>
                </label>
                <label class="cat-te-clip-setting-check">
                  <input class="cat-te-second-sample" type="checkbox" disabled />
                  <span>${T("second_sample_label")}</span>
                </label>
                <label class="cat-te-clip-setting-check cat-te-use-global">
                  <input class="cat-te-use-global-cb" type="checkbox" checked disabled />
                  <span>${T("use_global_prompt_label")}</span>
                </label>
              </div>
              <div class="cat-te-prompt-wrap">
                <div class="cat-te-prompt-label-row">
                  <div class="cat-te-prompt-tabs">
                    <button type="button" class="cat-te-prompt-tab is-active" data-tab="clip">Clip Prompt</button>
                    <button type="button" class="cat-te-prompt-tab" data-tab="ai">AI Prompt</button>
                  </div>
                  <button type="button" class="cat-te-ai-optimize-btn" title="${T("ai_optimize_prompt_title")}" disabled>${iconHtml("sparkles", 12)}<span>${T("ai_optimize_short")}</span></button>
                </div>
                <div class="cat-te-prompt-input-wrap" data-prompt-tab="clip">
                  <textarea class="cat-te-prompt-input" placeholder="${T("clip_prompt_placeholder")}" disabled></textarea>
                </div>
                <div class="cat-te-prompt-input-wrap" data-prompt-tab="ai" hidden>
                  <textarea class="cat-te-ai-prompt-input" placeholder="${T("ai_prompt_placeholder")}" disabled></textarea>
                </div>
              </div>
              <label class="cat-te-clip-setting-check cat-te-use-ai-prompt">
                <input class="cat-te-use-ai-prompt-cb" type="checkbox" checked disabled />
                <span>${T("use_ai_prompt_label")}</span>
              </label>
              <div class="cat-te-clip-videos" hidden>
                <div class="cat-te-clip-videos-header">
                  <span>${T("gen_video_label")}</span>
                  <button type="button" class="cat-te-clip-videos-open" title="${T("preview_manage_title")}">${iconHtml("squareArrowOutUpRight", 12)}</button>
                </div>
                <div class="cat-te-clip-videos-list"></div>
              </div>
              </div>
              <div class="cat-te-subtitle-panel" hidden>
                <label class="cat-te-clip-setting-row cat-te-sub-text-row">
                  <span>${T("subtitle_text_label")}</span>
                  <textarea class="cat-te-sub-text" rows="3" placeholder="${T("subtitle_default_text")}"></textarea>
                </label>
                <label class="cat-te-clip-setting-row">
                  <span>${T("subtitle_font_label")}</span>
                  <select class="cat-te-sub-font"></select>
                </label>
                <label class="cat-te-clip-setting-row">
                  <span>${T("subtitle_size_label")}</span>
                  <input class="cat-te-sub-size" type="number" min="8" max="400" step="1" value="48" />
                </label>
                <label class="cat-te-clip-setting-row">
                  <span>${T("letter_spacing_label")}</span>
                  <input class="cat-te-sub-letter-spacing" type="number" min="-50" max="200" step="1" value="0" />
                </label>
                <label class="cat-te-clip-setting-row">
                  <span>${T("subtitle_color_label")}</span>
                  <input class="cat-te-sub-color" type="color" value="#ffffff" />
                </label>
                <div class="cat-te-sub-check-row">
                  <label class="cat-te-clip-setting-check"><input class="cat-te-sub-bold" type="checkbox" /><span>${T("subtitle_bold_label")}</span></label>
                  <label class="cat-te-clip-setting-check"><input class="cat-te-sub-italic" type="checkbox" /><span>${T("subtitle_italic_label")}</span></label>
                </div>
                <label class="cat-te-clip-setting-row">
                  <span>${T("subtitle_opacity_label")}</span>
                  <input class="cat-te-sub-opacity" type="range" min="0" max="100" step="1" value="100" />
                  <span class="cat-te-sub-opacity-val">100%</span>
                </label>
                <label class="cat-te-clip-setting-check"><input class="cat-te-sub-stroke" type="checkbox" checked /><span>${T("subtitle_stroke_label")}</span></label>
                <label class="cat-te-clip-setting-row">
                  <span>${T("subtitle_stroke_color_label")}</span>
                  <input class="cat-te-sub-stroke-color" type="color" value="#000000" />
                </label>
                <label class="cat-te-clip-setting-row">
                  <span>${T("subtitle_stroke_width_label")}</span>
                  <input class="cat-te-sub-stroke-width" type="number" min="0" max="40" step="0.5" value="3" />
                </label>
                <label class="cat-te-clip-setting-check"><input class="cat-te-sub-shadow" type="checkbox" checked /><span>${T("subtitle_shadow_label")}</span></label>
                <label class="cat-te-clip-setting-row">
                  <span>${T("subtitle_shadow_color_label")}</span>
                  <input class="cat-te-sub-shadow-color" type="color" value="#000000" />
                </label>
                <label class="cat-te-clip-setting-row">
                  <span>${T("subtitle_shadow_blur_label")}</span>
                  <input class="cat-te-sub-shadow-blur" type="number" min="0" max="64" step="1" value="4" />
                </label>
                <label class="cat-te-clip-setting-row">
                  <span>${T("subtitle_shadow_x_label")}</span>
                  <input class="cat-te-sub-shadow-x" type="number" min="-64" max="64" step="1" value="2" />
                </label>
                <label class="cat-te-clip-setting-row">
                  <span>${T("subtitle_shadow_y_label")}</span>
                  <input class="cat-te-sub-shadow-y" type="number" min="-64" max="64" step="1" value="2" />
                </label>
                <label class="cat-te-clip-setting-row">
                  <span>${T("subtitle_align_label")}</span>
                  <select class="cat-te-sub-align">
                    <option value="left">${T("subtitle_align_left")}</option>
                    <option value="center" selected>${T("subtitle_align_center")}</option>
                    <option value="right">${T("subtitle_align_right")}</option>
                  </select>
                </label>
                <label class="cat-te-clip-setting-row">
                  <span>${T("subtitle_valign_label")}</span>
                  <select class="cat-te-sub-valign">
                    <option value="top">${T("subtitle_valign_top")}</option>
                    <option value="middle">${T("subtitle_valign_middle")}</option>
                    <option value="bottom" selected>${T("subtitle_valign_bottom")}</option>
                  </select>
                </label>
                <label class="cat-te-clip-setting-row">
                  <span>${T("subtitle_offset_x_label")}</span>
                  <input class="cat-te-sub-offset-x" type="number" min="-50" max="50" step="1" value="0" />
                </label>
                <label class="cat-te-clip-setting-row">
                  <span>${T("subtitle_offset_y_label")}</span>
                  <input class="cat-te-sub-offset-y" type="number" min="-50" max="50" step="1" value="8" />
                </label>
                <div class="cat-te-sub-apply-row">
                  <button type="button" class="cat-te-btn cat-te-sub-apply-track">${T("subtitle_apply_track_btn")}</button>
                  <button type="button" class="cat-te-btn cat-te-sub-apply-all">${T("subtitle_apply_all_btn")}</button>
                </div>
              </div>
              </div>
              <div class="cat-te-shortcuts">
                ${T("shortcuts_html")}
              </div>
            </aside>
          </div>
          <footer class="cat-te-footer">
            <div class="cat-te-footer-center"></div>
            <input class="cat-te-add-material-file" type="file" accept="image/*,video/*,audio/*" multiple hidden />
          </footer>
          <div class="cat-te-frame-preview"></div>
          <div class="cat-te-modal-backdrop cat-te-media-preview-modal" hidden>
            <div class="cat-te-modal cat-te-media-preview-dialog">
              <div class="cat-te-modal-header cat-te-media-preview-header">
                <span class="cat-te-media-preview-title">${T("media_preview_title")}</span>
                <div class="cat-te-media-preview-stars"></div>
                <button type="button" class="cat-te-modal-close cat-te-media-preview-close" title="${T("close_title")}">${iconHtml("close", 16)}</button>
              </div>
              <div class="cat-te-media-preview-body">
                <button type="button" class="cat-te-media-preview-nav prev" title="${T("prev_image_title")}" aria-label="${T("prev_image_aria")}">‹</button>
                <div class="cat-te-media-preview-stage"></div>
                <button type="button" class="cat-te-media-preview-nav next" title="${T("next_image_title")}" aria-label="${T("next_image_aria")}">›</button>
              </div>
              <div class="cat-te-media-preview-meta">
                <div class="cat-te-media-preview-meta-row cat-te-media-preview-desc-row">
                  <span class="cat-te-media-preview-desc-label">${T("desc_prompt_label")}</span>
                  <div class="cat-te-media-preview-desc-wrap">
                    <textarea class="cat-te-media-preview-desc" rows="3" placeholder="${T("asset_desc_placeholder")}"></textarea>
                  </div>
                </div>
                <div class="cat-te-media-preview-meta-grid">
                  <label class="cat-te-media-preview-meta-row">
                    <span>${T("type_label")}</span>
                    <select class="cat-te-media-preview-type">
                      <option value="">${T("not_set_option")}</option>
                      <option value="character">${T("asset_type_character")}</option>
                      <option value="scene">${T("asset_type_scene")}</option>
                      <option value="prop">${T("asset_type_prop")}</option>
                      <option value="other">${T("asset_type_other")}</option>
                    </select>
                  </label>
                  <label class="cat-te-media-preview-meta-row cat-te-media-preview-type-custom-row" hidden>
                    <span>${T("custom_type_label")}</span>
                    <input class="cat-te-media-preview-type-custom" type="text" placeholder="${T("enter_type_placeholder")}" />
                  </label>
                  <label class="cat-te-media-preview-meta-row cat-te-media-preview-tags-row">
                    <span>${T("tags_label")}</span>
                    <input class="cat-te-media-preview-tags" type="text" placeholder="${T("tags_placeholder")}" />
                  </label>
                </div>
              </div>
              <div class="cat-te-media-preview-footer">
                <span class="cat-te-media-preview-hint">${T("media_preview_hint")}</span>
                <div class="cat-te-media-preview-actions">
                  <button type="button" class="cat-te-btn cat-te-btn-primary cat-te-media-preview-insert">${T("insert_at_position_btn")}</button>
                </div>
              </div>
            </div>
          </div>
          <div class="cat-te-modal-backdrop cat-te-clip-items-modal" hidden>
            <div class="cat-te-modal cat-te-clip-items-dialog">
              <div class="cat-te-modal-header">
                <span class="cat-te-clip-items-title">${T("clip_items_title")}</span>
                <button type="button" class="cat-te-modal-close cat-te-clip-items-close" title="${T("close_title")}">${iconHtml("close", 16)}</button>
              </div>
              <div class="cat-te-clip-items-body"></div>
            </div>
          </div>
          <div class="cat-te-modal-backdrop cat-te-gen-video-modal" hidden>
            <div class="cat-te-modal cat-te-media-preview-dialog">
              <div class="cat-te-modal-header cat-te-media-preview-header">
                <span class="cat-te-gen-video-title">${T("gen_video_label")}</span>
                <button type="button" class="cat-te-modal-close cat-te-gen-video-close" title="${T("close_title")}">${iconHtml("close", 16)}</button>
              </div>
              <div class="cat-te-media-preview-body cat-te-gen-video-body">
                <button type="button" class="cat-te-media-preview-nav prev cat-te-gen-video-prev" title="${T("prev_short")}" aria-label="${T("prev_short")}">‹</button>
                <div class="cat-te-media-preview-stage cat-te-gen-video-stage"></div>
                <button type="button" class="cat-te-media-preview-nav next cat-te-gen-video-next" title="${T("next_short")}" aria-label="${T("next_short")}">›</button>
              </div>
              <div class="cat-te-media-preview-meta cat-te-gen-video-meta">
                <label class="cat-te-clip-setting-check">
                  <input class="cat-te-gen-video-enabled" type="checkbox" checked />
                  <span>${T("enabled_label")}</span>
                </label>
                <label class="cat-te-clip-setting-check">
                  <input class="cat-te-gen-video-muted" type="checkbox" />
                  <span>${T("muted_label")}</span>
                </label>
                <label class="cat-te-media-preview-meta-row">
                  <span>${T("note_label")}</span>
                  <textarea class="cat-te-gen-video-note" rows="3" placeholder="${T("video_note_placeholder")}"></textarea>
                </label>
                <button type="button" class="cat-te-btn cat-te-gen-video-delete">${T("delete_btn")}</button>
              </div>
            </div>
          </div>
          <div class="cat-te-floating-panel cat-te-output-videos-modal" hidden>
            <div class="cat-te-modal cat-te-output-videos-dialog">
              <div class="cat-te-modal-header cat-te-output-videos-drag">
                <span class="cat-te-output-videos-title">${T("linked_generated_videos_title")}</span>
                <button type="button" class="cat-te-modal-close cat-te-output-videos-close" title="${T("close_title")}">${iconHtml("close", 16)}</button>
              </div>
              <div class="cat-te-output-videos-toolbar">
                <input class="cat-te-output-videos-filter" type="search" placeholder="${T("filter_filename_placeholder")}" />
                <div class="cat-te-output-videos-time-filter">
                  ${OUTPUT_VIDEOS_TIME_RANGES.map((r) => `
                    <button type="button" class="cat-te-output-videos-time-btn${r.id === "1h" ? " is-active" : ""}" data-range="${r.id}">${r.label}</button>
                  `).join("")}
                </div>
              </div>
              <div class="cat-te-output-videos-body"></div>
            </div>
          </div>
          <div class="cat-te-modal-backdrop cat-te-compose-modal" hidden>
            <div class="cat-te-modal cat-te-compose-dialog">
              <div class="cat-te-modal-header">
                <span>${T("compose_video_title")}</span>
                <button type="button" class="cat-te-modal-close cat-te-compose-close" title="${T("close_title")}">${iconHtml("close", 16)}</button>
              </div>
              <div class="cat-te-compose-body">
                <div class="cat-te-compose-preview">
                  <div class="cat-te-compose-preview-stage">
                    <canvas class="cat-te-compose-preview-canvas"></canvas>
                  </div>
                </div>
                <div class="cat-te-compose-settings">
                  <div class="cat-te-compose-field">
                    <span class="cat-te-ai-field-label">
                      ${T("filename_prefix_label")}
                      <span class="cat-te-info-tip" tabindex="0" aria-label="${T("filename_prefix_info_aria")}">
                        ${iconHtml("info", 12)}
                        <span class="cat-te-info-tip-pop">
                          ${T("filename_prefix_info_html")}
                        </span>
                      </span>
                    </span>
                    <input class="cat-te-compose-prefix" type="text" value="cap_timeline_compose/" />
                  </div>
                  <label class="cat-te-compose-field">
                    <span>${T("filename_label")}</span>
                    <input class="cat-te-compose-filename" type="text" />
                  </label>
                  <div class="cat-te-compose-check-row">
                    <label class="cat-te-compose-check">
                      <input class="cat-te-compose-use-gen-size" type="checkbox" checked />
                      <span>${T("use_generated_video_size_label")}</span>
                    </label>
                    <span class="cat-te-info-tip" tabindex="0" aria-label="${T("use_generated_video_size_info_aria")}">
                      ${iconHtml("info", 12)}
                      <span class="cat-te-info-tip-pop">
                        ${T("use_generated_video_size_info_text")}
                      </span>
                    </span>
                  </div>
                  <div class="cat-te-compose-check-row">
                    <label class="cat-te-compose-check">
                      <input class="cat-te-compose-ignore-audio" type="checkbox" />
                      <span>${T("ignore_audio_track_label")}</span>
                    </label>
                    <span class="cat-te-info-tip" tabindex="0" aria-label="${T("ignore_audio_track_info_aria")}">
                      ${iconHtml("info", 12)}
                      <span class="cat-te-info-tip-pop">
                        ${T("ignore_audio_track_info_text")}
                      </span>
                    </span>
                  </div>

                  <div class="cat-te-wm-section">
                    <div class="cat-te-wm-heading">${T("watermark_heading")}</div>
                    <div class="cat-te-wm-tabs">
                      <button type="button" class="cat-te-wm-tab cat-te-wm-tab-text" data-mode="text">${iconHtml("text", 12)}<span>${T("text_watermark_label")}</span></button>
                      <button type="button" class="cat-te-wm-tab cat-te-wm-tab-image" data-mode="image">${iconHtml("image", 12)}<span>${T("image_watermark_label")}</span></button>
                    </div>

                    <div class="cat-te-wm-panel cat-te-wm-panel-text">
                      <label class="cat-te-compose-field">
                        <span>${T("text_content_label")}</span>
                        <textarea class="cat-te-wm-text-content" rows="2" placeholder="${T("watermark_text_placeholder")}"></textarea>
                      </label>
                      <div class="cat-te-wm-row cat-te-wm-text-style-row">
                        <label class="cat-te-compose-field">
                          <span>${T("font_label")}</span>
                          <select class="cat-te-wm-font-family"></select>
                        </label>
                        <label class="cat-te-compose-field cat-te-wm-narrow">
                          <span>${T("font_size_label")}</span>
                          <input class="cat-te-wm-font-size" type="number" min="6" max="400" step="1" />
                        </label>
                        <label class="cat-te-compose-field cat-te-wm-narrow">
                          <span>${T("letter_spacing_label")}</span>
                          <input class="cat-te-wm-letter-spacing" type="number" min="-50" max="200" step="1" />
                        </label>
                        <label class="cat-te-compose-field cat-te-wm-narrow">
                          <span>${T("color_label")}</span>
                          <input class="cat-te-wm-font-color" type="color" />
                        </label>
                      </div>
                    </div>

                    <div class="cat-te-wm-panel cat-te-wm-panel-image" hidden>
                      <div class="cat-te-wm-image-row">
                        <div class="cat-te-wm-image-thumb"><img class="cat-te-wm-image-preview" alt="" hidden /></div>
                        <div class="cat-te-wm-image-actions">
                          <button type="button" class="cat-te-btn cat-te-wm-image-upload">${T("upload_image_btn")}</button>
                          <button type="button" class="cat-te-btn cat-te-wm-image-delete" hidden>${iconHtml("trash", 12)}<span>${T("delete_btn")}</span></button>
                          <input class="cat-te-wm-image-file" type="file" accept="image/*" hidden />
                        </div>
                      </div>
                      <label class="cat-te-compose-check cat-te-wm-image-disable-row" hidden>
                        <input class="cat-te-wm-image-disabled" type="checkbox" />
                        <span>${T("not_used_label")}</span>
                      </label>
                    </div>

                    <div class="cat-te-wm-row">
                      <label class="cat-te-compose-field">
                        <span>${T("opacity_label")}<span class="cat-te-wm-readout cat-te-wm-opacity-readout"></span></span>
                        <input class="cat-te-wm-opacity" type="range" min="0" max="100" step="1" />
                      </label>
                      <label class="cat-te-compose-field">
                        <span>${T("scale_label")}<span class="cat-te-wm-readout cat-te-wm-scale-readout"></span></span>
                        <input class="cat-te-wm-scale" type="range" min="10" max="300" step="1" />
                      </label>
                    </div>

                    <div class="cat-te-compose-field">
                      <span>${T("position_label")}</span>
                      <div class="cat-te-wm-pos-row">
                        <div class="cat-te-wm-pos-grid">
                          <button type="button" class="cat-te-wm-pos" data-pos="top-left" title="${T("wm_pos_top_left")}"></button>
                          <button type="button" class="cat-te-wm-pos" data-pos="top-center" title="${T("wm_pos_top_center")}"></button>
                          <button type="button" class="cat-te-wm-pos" data-pos="top-right" title="${T("wm_pos_top_right")}"></button>
                          <button type="button" class="cat-te-wm-pos" data-pos="center" title="${T("wm_pos_center")}"></button>
                          <button type="button" class="cat-te-wm-pos" data-pos="bottom-left" title="${T("wm_pos_bottom_left")}"></button>
                          <button type="button" class="cat-te-wm-pos" data-pos="bottom-center" title="${T("wm_pos_bottom_center")}"></button>
                          <button type="button" class="cat-te-wm-pos" data-pos="bottom-right" title="${T("wm_pos_bottom_right")}"></button>
                        </div>
                        <div class="cat-te-wm-pos-random">
                          <button type="button" class="cat-te-wm-pos-chip" data-pos="random-interval">${T("wm_pos_random_interval")}</button>
                          <button type="button" class="cat-te-wm-pos-chip" data-pos="random-fixed">${T("wm_pos_random_fixed")}</button>
                        </div>
                      </div>
                    </div>

                    <div class="cat-te-compose-field">
                      <span>${T("margin_label")}</span>
                      <div class="cat-te-wm-margin-box">
                        <input class="cat-te-wm-margin cat-te-wm-margin-top" type="number" min="0" step="1" title="${T("margin_top_title")}" />
                        <input class="cat-te-wm-margin cat-te-wm-margin-right" type="number" min="0" step="1" title="${T("margin_right_title")}" />
                        <input class="cat-te-wm-margin cat-te-wm-margin-bottom" type="number" min="0" step="1" title="${T("margin_bottom_title")}" />
                        <input class="cat-te-wm-margin cat-te-wm-margin-left" type="number" min="0" step="1" title="${T("margin_left_title")}" />
                        <button type="button" class="cat-te-wm-margin-lock" title="${T("lock_margin_title")}">${iconHtml("lock", 14)}</button>
                      </div>
                    </div>
                  </div>

                  <div class="cat-te-compose-status" hidden></div>
                </div>
              </div>
              <div class="cat-te-compose-actions">
                <button type="button" class="cat-te-btn cat-te-compose-cancel">${T("cancel_btn")}</button>
                <button type="button" class="cat-te-btn cat-te-btn-primary cat-te-compose-run">${T("compose_start_btn")}</button>
              </div>
            </div>
          </div>
          <div class="cat-te-modal-backdrop cat-te-add-material-modal" hidden>
            <div class="cat-te-modal cat-te-add-material-dialog">
              <div class="cat-te-modal-header">
                <span class="cat-te-add-material-title">${T("add_material_title")}</span>
                <button type="button" class="cat-te-modal-close cat-te-add-material-close" title="${T("close_title")}">${iconHtml("close", 16)}</button>
              </div>
              <div class="cat-te-add-material-preview"></div>
              <div class="cat-te-add-material-options">
                <label><input class="cat-te-insert-after-add" type="checkbox" /> ${T("insert_to_timeline_label")}</label>
              </div>
              <div class="cat-te-add-material-actions">
                <button type="button" class="cat-te-btn cat-te-btn-primary cat-te-add-material-confirm">${T("confirm_btn")}</button>
              </div>
            </div>
          </div>
          <div class="cat-te-modal-backdrop cat-te-ai-optimize-modal" hidden>
            <div class="cat-te-ai-optimize-shell">
              <button type="button" class="cat-te-ai-optimize-nav prev" title="${T("ai_optimize_prev_clip_title")}" aria-label="${T("ai_optimize_prev_clip_title")}" disabled>${iconHtml("chevronLeft", 20)}</button>
              <div class="cat-te-modal cat-te-ai-optimize-dialog">
              <div class="cat-te-modal-header">
                <span class="cat-te-ai-optimize-title">${T("ai_optimize_prompt_title")}</span>
                <button type="button" class="cat-te-modal-close cat-te-ai-optimize-close" title="${T("close_title")}">${iconHtml("close", 16)}</button>
              </div>
              <div class="cat-te-ai-optimize-body">
                <div class="cat-te-ai-optimize-left">
                  <div class="cat-te-ai-optimize-tabs">
                    <button type="button" class="cat-te-ai-src-tab" data-src="media">${T("media_prompt_tab")}</button>
                    <button type="button" class="cat-te-ai-src-tab is-active" data-src="clip">Clip Prompt</button>
                    <button type="button" class="cat-te-ai-src-tab" data-src="global">${T("global_prompt_tab")}</button>
                  </div>
                  <textarea class="cat-te-ai-src-text" readonly></textarea>
                </div>
                <div class="cat-te-ai-optimize-right">
                  <div class="cat-te-ai-field-row">
                    <div class="cat-te-ai-field">
                      <span class="cat-te-ai-field-label">
                        ${T("model_label")}
                        <span class="cat-te-info-tip" tabindex="0" aria-label="${T("model_info_aria")}">
                          ${iconHtml("info", 12)}
                          <span class="cat-te-info-tip-pop">
                            ${T("model_info_html")}
                          </span>
                        </span>
                      </span>
                      <select class="cat-te-ai-model"></select>
                    </div>
                    <label class="cat-te-ai-field">
                      <span>${T("output_language_label")}</span>
                      <select class="cat-te-ai-lang">
                        <option value="简体中文" selected>简体中文</option>
                        <option value="繁體中文">繁體中文</option>
                        <option value="English">English</option>
                        <option value="日本語">日本語</option>
                      </select>
                    </label>
                  </div>
                  <label class="cat-te-ai-field">
                    <span>${T("agent_prompt_label")}</span>
                    <textarea class="cat-te-ai-system" rows="6"></textarea>
                  </label>
                  <div class="cat-te-ai-skill-head">
                    <span>Prompt Skill</span>
                    <div class="cat-te-ai-skill-actions">
                      <button type="button" class="cat-te-btn cat-te-skill-pick-btn">${T("select_btn")}</button>
                      <button type="button" class="cat-te-btn cat-te-skill-sync-btn" title="${T("sync_latest_skill_title")}">${iconHtml("refresh", 12)}<span>${T("update_btn")}</span></button>
                    </div>
                  </div>
                  <textarea class="cat-te-ai-skill" rows="3" placeholder="${T("skill_placeholder")}"></textarea>
                  <label class="cat-te-ai-field cat-te-ai-result-field">
                    <span>${T("generated_prompt_label")}</span>
                    <textarea class="cat-te-ai-result" rows="8" placeholder="${T("generated_prompt_placeholder")}"></textarea>
                  </label>
                  <div class="cat-te-ai-optimize-actions">
                    <button type="button" class="cat-te-btn cat-te-btn-primary cat-te-ai-generate">${iconHtml("sparkles", 12)}<span>${T("generate_btn")}</span></button>
                  </div>
                </div>
              </div>
              </div>
              <button type="button" class="cat-te-ai-optimize-nav next" title="${T("ai_optimize_next_clip_title")}" aria-label="${T("ai_optimize_next_clip_title")}" disabled>${iconHtml("chevronLeft", 20)}</button>
            </div>
          </div>
          <div class="cat-te-modal-backdrop cat-te-skill-picker-modal" hidden>
            <div class="cat-te-modal cat-te-skill-picker-dialog">
              <div class="cat-te-modal-header">
                <span>${T("select_prompt_skill_title")}</span>
                <input class="cat-te-skill-picker-filter" type="search" placeholder="${T("search_name_placeholder")}" />
                <button type="button" class="cat-te-modal-close cat-te-skill-picker-close" title="${T("close_title")}">${iconHtml("close", 16)}</button>
              </div>
              <div class="cat-te-skill-picker-body"></div>
            </div>
          </div>
          <div class="cat-te-modal-backdrop cat-te-settings-modal" hidden>
            <div class="cat-te-modal cat-te-settings-dialog">
              <div class="cat-te-modal-header">
                <span>${T("settings_title")}</span>
                <button type="button" class="cat-te-modal-close" title="${T("close_title")}">${iconHtml("close", 16)}</button>
              </div>
              <div class="cat-te-modal-body">
                <label class="cat-te-modal-row">
                  <span>${T("autosave_interval_label")}</span>
                  <input class="cat-te-autosave-interval" type="number" min="1" max="300" step="1" />
                </label>
                <label class="cat-te-modal-check-row">
                  <input class="cat-te-use-clip-video-filename" type="checkbox" checked />
                  <span>${T("use_clip_specified_video_filename_label")}</span>
                  <span class="cat-te-info-tip" tabindex="0" aria-label="${T("use_clip_specified_video_filename_info_aria")}">
                    ${iconHtml("info", 12)}
                    <span class="cat-te-info-tip-pop">${T("use_clip_specified_video_filename_info_text")}</span>
                  </span>
                </label>
                <div class="cat-te-agent-settings">
                  <div class="cat-te-agent-heading">
                    <span>AI Agent</span>
                    <button type="button" class="cat-te-btn cat-te-agent-add">${T("add_btn")}</button>
                  </div>
                  <div class="cat-te-agent-list"></div>
                  <div class="cat-te-agent-form" hidden>
                    <label><span>${T("name_label")}</span><input class="cat-te-agent-label" type="text" maxlength="80" placeholder="${T("eg_chatgpt_placeholder")}" /></label>
                    <label><span>${T("provider_label")}</span><select class="cat-te-agent-provider"><option value="openai">OpenAI</option><option value="gemini">Gemini</option></select></label>
                    <label><span>${T("model_label")}</span><input class="cat-te-agent-model" type="text" maxlength="120" placeholder="${T("eg_model_placeholder")}" /></label>
                    <label><span>API Key</span><input class="cat-te-agent-key" type="password" autocomplete="new-password" placeholder="${T("enter_api_key")}" /></label>
                    <label class="cat-te-agent-enabled"><input type="checkbox" checked /><span>${T("enable_show_in_ai_optimize_label")}</span></label>
                    <div class="cat-te-agent-form-actions">
                      <button type="button" class="cat-te-btn cat-te-agent-delete" hidden>${T("delete_btn")}</button>
                      <span></span>
                      <button type="button" class="cat-te-btn cat-te-agent-cancel">${T("cancel_btn")}</button>
                      <button type="button" class="cat-te-btn cat-te-btn-primary cat-te-agent-save">${T("save_btn")}</button>
                    </div>
                  </div>
                  <div class="cat-te-agent-note">${T("agent_note")}</div>
                </div>
              </div>
            </div>
          </div>
        `;
        document.body.appendChild(el);
        this._overlay = el;
        this.projectNameInput = el.querySelector(".cat-te-title");
        this.brandProjectBtn = el.querySelector(".cat-te-brand-project");
        this.headerScalarsEl = el.querySelector(".cat-te-header-scalars");
        this.projectScalarsEl = el.querySelector(".cat-te-project-scalars");
        this.sidebarTitle = el.querySelector(".cat-te-sidebar-title");
        this.projectPanel = el.querySelector(".cat-te-project-panel");
        this.clipPanel = el.querySelector(".cat-te-clip-panel");
        this.visualClipBody = el.querySelector(".cat-te-visual-clip-body");
        this.subtitlePanel = el.querySelector(".cat-te-subtitle-panel");
        this.globalPromptInput = el.querySelector(".cat-te-global-prompt-input");
        this.globalPromptCommentBtn = el.querySelector(".cat-te-global-prompt-comment-btn");
        this.mediaStarFilterHost = el.querySelector(".cat-te-media-header-actions");
        this.mediaGrid = el.querySelector(".cat-te-media-grid");
        this.mediaPanel = el.querySelector(".cat-te-media");
        this.mediaPanelSplit = el.querySelector(".cat-te-media-split");
        this.sidebarPanel = el.querySelector(".cat-te-sidebar");
        this.sidebarPanelSplit = el.querySelector(".cat-te-sidebar-split");
        this.tlHost = el.querySelector(".cat-te-timeline-host");
        this.programRoot = el.querySelector(".cat-te-program");
        this.programSplit = el.querySelector(".cat-te-program-split");
        this.programStage = el.querySelector(".cat-te-program-stage");
        this.programCanvas = el.querySelector(".cat-te-program-canvas");
        this.programEmpty = el.querySelector(".cat-te-program-empty");
        this.programMeta = el.querySelector(".cat-te-program-meta");
        this.promptInput = el.querySelector(".cat-te-clip-panel .cat-te-prompt-input");
        attachRichPromptHandler(this.promptInput, { mode: "widget" });
        this.aiPromptInput = el.querySelector(".cat-te-clip-panel .cat-te-ai-prompt-input");
        attachRichPromptHandler(this.aiPromptInput, { mode: "widget" });
        this.aiOptimizeBtn = el.querySelector(".cat-te-ai-optimize-btn");
        this.clipPromptTabs = el.querySelectorAll(".cat-te-clip-panel .cat-te-prompt-tab");
        attachRichPromptHandler(this.globalPromptInput, { mode: "widget" });
        this.useGlobalCb = el.querySelector(".cat-te-use-global-cb");
        this.useAiPromptCb = el.querySelector(".cat-te-use-ai-prompt-cb");
        this.useMediaPromptCb = el.querySelector(".cat-te-use-media-prompt-cb");
        this.headExtendInput = el.querySelector(".cat-te-head-extend");
        this.tailExtendInput = el.querySelector(".cat-te-tail-extend");
        this.genPreviewVideoCb = el.querySelector(".cat-te-gen-preview-video");
        this.secondSampleCb = el.querySelector(".cat-te-second-sample");
        this.clipRoleSelect = el.querySelector(".cat-te-clip-role");
        this.clipRoleCustomInput = el.querySelector(".cat-te-clip-role-custom");
        this.clipRoleCustomRow = el.querySelector(".cat-te-clip-role-custom-row");
        this.clipAgentSelect = el.querySelector(".cat-te-clip-agent");
        this.clipAgentCustomInput = el.querySelector(".cat-te-clip-agent-custom");
        this.clipAgentCustomRow = el.querySelector(".cat-te-clip-agent-custom-row");
        this.subTextInput = el.querySelector(".cat-te-sub-text");
        this.subFontSelect = el.querySelector(".cat-te-sub-font");
        this.subSizeInput = el.querySelector(".cat-te-sub-size");
        this.subLetterSpacingInput = el.querySelector(".cat-te-sub-letter-spacing");
        this.subColorInput = el.querySelector(".cat-te-sub-color");
        this.subBoldCb = el.querySelector(".cat-te-sub-bold");
        this.subItalicCb = el.querySelector(".cat-te-sub-italic");
        this.subOpacityInput = el.querySelector(".cat-te-sub-opacity");
        this.subOpacityVal = el.querySelector(".cat-te-sub-opacity-val");
        this.subStrokeCb = el.querySelector(".cat-te-sub-stroke");
        this.subStrokeColorInput = el.querySelector(".cat-te-sub-stroke-color");
        this.subStrokeWidthInput = el.querySelector(".cat-te-sub-stroke-width");
        this.subShadowCb = el.querySelector(".cat-te-sub-shadow");
        this.subShadowColorInput = el.querySelector(".cat-te-sub-shadow-color");
        this.subShadowBlurInput = el.querySelector(".cat-te-sub-shadow-blur");
        this.subShadowXInput = el.querySelector(".cat-te-sub-shadow-x");
        this.subShadowYInput = el.querySelector(".cat-te-sub-shadow-y");
        this.subAlignSelect = el.querySelector(".cat-te-sub-align");
        this.subVAlignSelect = el.querySelector(".cat-te-sub-valign");
        this.subOffsetXInput = el.querySelector(".cat-te-sub-offset-x");
        this.subOffsetYInput = el.querySelector(".cat-te-sub-offset-y");
        this.subApplyTrackBtn = el.querySelector(".cat-te-sub-apply-track");
        this.subApplyAllBtn = el.querySelector(".cat-te-sub-apply-all");
        this.clipInfoDetail = el.querySelector(".cat-te-clip-info-detail");
        this.clipSwiper = el.querySelector(".cat-te-clip-swiper");
        this.clipSwiperPrev = el.querySelector(".cat-te-clip-swiper-nav.prev");
        this.clipSwiperNext = el.querySelector(".cat-te-clip-swiper-nav.next");
        this.clipThumbWrap = el.querySelector(".cat-te-clip-thumb-wrap");
        this.clipThumb = el.querySelector(".cat-te-clip-thumb");
        this.clipThumbVideo = el.querySelector(".cat-te-clip-thumb-video");
        this.clipThumbEmpty = el.querySelector(".cat-te-clip-thumb-empty");
        this.clipThumbSubtitle = el.querySelector(".cat-te-clip-thumb-subtitle");
        this.clipThumbSortBtn = el.querySelector(".cat-te-clip-thumb-sort");
        this.clipThumbDeleteBtn = el.querySelector(".cat-te-clip-thumb-delete");
        this.clipVideosHost = el.querySelector(".cat-te-clip-videos");
        this.clipVideosList = el.querySelector(".cat-te-clip-videos-list");
        this.clipVideosOpenBtn = el.querySelector(".cat-te-clip-videos-open");
        this.clipNameEl = el.querySelector(".cat-te-clip-name");
        this.clipIdEl = el.querySelector(".cat-te-clip-id");
        this.clipStartEl = el.querySelector(".cat-te-clip-start");
        this.clipEndEl = el.querySelector(".cat-te-clip-end");
        this.clipSourceTrimEl = el.querySelector(".cat-te-clip-source-trim");
        this.clipSourceTrimLabelEl = el.querySelector(".cat-te-clip-source-trim-label");
        this.clipSourceInEl = el.querySelector(".cat-te-clip-source-in");
        this.clipSourceOutEl = el.querySelector(".cat-te-clip-source-out");
        this.clipSourceDurEl = el.querySelector(".cat-te-clip-source-dur");
        this.clipDurEl = el.querySelector(".cat-te-clip-dur");
        this.clipItemIndexEl = el.querySelector(".cat-te-clip-item-index");
        this.framePreview = el.querySelector(".cat-te-frame-preview");
        this.footerPlayback = el.querySelector(".cat-te-footer-center");
        this.addMaterialInput = el.querySelector(".cat-te-add-material-file");
        this.mediaPreviewModal = el.querySelector(".cat-te-media-preview-modal");
        this.mediaPreviewTitle = el.querySelector(".cat-te-media-preview-title");
        this.mediaPreviewStars = el.querySelector(".cat-te-media-preview-stars");
        this.mediaPreviewBody = el.querySelector(".cat-te-media-preview-body");
        this.mediaPreviewStage = el.querySelector(".cat-te-media-preview-stage");
        this.mediaPreviewPrevBtn = el.querySelector(".cat-te-media-preview-nav.prev");
        this.mediaPreviewNextBtn = el.querySelector(".cat-te-media-preview-nav.next");
        this.mediaPreviewInsertBtn = el.querySelector(".cat-te-media-preview-insert");
        this.mediaPreviewFooter = el.querySelector(".cat-te-media-preview-footer");
        this.mediaPreviewHint = el.querySelector(".cat-te-media-preview-hint");
        this.mediaPreviewDesc = el.querySelector(".cat-te-media-preview-desc");
        attachRichPromptHandler(this.mediaPreviewDesc, { mode: "widget" });
        this.mediaPreviewType = el.querySelector(".cat-te-media-preview-type");
        this.mediaPreviewTypeCustom = el.querySelector(".cat-te-media-preview-type-custom");
        this.mediaPreviewTypeCustomRow = el.querySelector(".cat-te-media-preview-type-custom-row");
        this.mediaPreviewTags = el.querySelector(".cat-te-media-preview-tags");
        this.clipItemsModal = el.querySelector(".cat-te-clip-items-modal");
        this.clipItemsTitle = el.querySelector(".cat-te-clip-items-title");
        this.clipItemsBody = el.querySelector(".cat-te-clip-items-body");
        this.addMaterialModal = el.querySelector(".cat-te-add-material-modal");
        this.addMaterialPreview = el.querySelector(".cat-te-add-material-preview");
        this.addMaterialTitle = el.querySelector(".cat-te-add-material-title");
        this.addMaterialConfirmBtn = el.querySelector(".cat-te-add-material-confirm");
        this.insertAfterAddCb = el.querySelector(".cat-te-insert-after-add");
        this.genVideoModal = el.querySelector(".cat-te-gen-video-modal");
        this.genVideoTitle = el.querySelector(".cat-te-gen-video-title");
        this.genVideoStage = el.querySelector(".cat-te-gen-video-stage");
        this.genVideoPrevBtn = el.querySelector(".cat-te-gen-video-prev");
        this.genVideoNextBtn = el.querySelector(".cat-te-gen-video-next");
        this.genVideoEnabledCb = el.querySelector(".cat-te-gen-video-enabled");
        this.genVideoMutedCb = el.querySelector(".cat-te-gen-video-muted");
        this.genVideoNote = el.querySelector(".cat-te-gen-video-note");
        this.genVideoDeleteBtn = el.querySelector(".cat-te-gen-video-delete");
        this.outputVideosModal = el.querySelector(".cat-te-output-videos-modal");
        this.outputVideosBody = el.querySelector(".cat-te-output-videos-body");
        this.outputVideosFilter = el.querySelector(".cat-te-output-videos-filter");
        this.outputVideosTimeButtons = el.querySelectorAll(".cat-te-output-videos-time-btn");
        this.outputVideosTitle = el.querySelector(".cat-te-output-videos-title");
        this.outputVideosDragHandle = el.querySelector(".cat-te-output-videos-drag");
        this.composeModal = el.querySelector(".cat-te-compose-modal");
        this.composePrefixInput = el.querySelector(".cat-te-compose-prefix");
        this.composeFilenameInput = el.querySelector(".cat-te-compose-filename");
        this.composeIgnoreAudioCb = el.querySelector(".cat-te-compose-ignore-audio");
        this.composeUseGenSizeCb = el.querySelector(".cat-te-compose-use-gen-size");
        this.composeStatus = el.querySelector(".cat-te-compose-status");
        this.composeRunBtn = el.querySelector(".cat-te-compose-run");
        this.composePreviewCanvas = el.querySelector(".cat-te-compose-preview-canvas");
        this.composePreviewStage = el.querySelector(".cat-te-compose-preview-stage");
        this.wmTabs = el.querySelectorAll(".cat-te-wm-tab");
        this.wmPanelText = el.querySelector(".cat-te-wm-panel-text");
        this.wmPanelImage = el.querySelector(".cat-te-wm-panel-image");
        this.wmTextContent = el.querySelector(".cat-te-wm-text-content");
        this.wmFontFamily = el.querySelector(".cat-te-wm-font-family");
        this.wmFontSize = el.querySelector(".cat-te-wm-font-size");
        this.wmLetterSpacing = el.querySelector(".cat-te-wm-letter-spacing");
        this.wmFontColor = el.querySelector(".cat-te-wm-font-color");
        this.wmImagePreview = el.querySelector(".cat-te-wm-image-preview");
        this.wmImageUploadBtn = el.querySelector(".cat-te-wm-image-upload");
        this.wmImageDeleteBtn = el.querySelector(".cat-te-wm-image-delete");
        this.wmImageFileInput = el.querySelector(".cat-te-wm-image-file");
        this.wmImageDisabledRow = el.querySelector(".cat-te-wm-image-disable-row");
        this.wmImageDisabledCb = el.querySelector(".cat-te-wm-image-disabled");
        this.wmOpacity = el.querySelector(".cat-te-wm-opacity");
        this.wmOpacityReadout = el.querySelector(".cat-te-wm-opacity-readout");
        this.wmScale = el.querySelector(".cat-te-wm-scale");
        this.wmScaleReadout = el.querySelector(".cat-te-wm-scale-readout");
        this.wmPosButtons = el.querySelectorAll(".cat-te-wm-pos, .cat-te-wm-pos-chip");
        this.wmMarginTop = el.querySelector(".cat-te-wm-margin-top");
        this.wmMarginRight = el.querySelector(".cat-te-wm-margin-right");
        this.wmMarginBottom = el.querySelector(".cat-te-wm-margin-bottom");
        this.wmMarginLeft = el.querySelector(".cat-te-wm-margin-left");
        this.wmMarginLockBtn = el.querySelector(".cat-te-wm-margin-lock");
        this.aiOptimizeModal = el.querySelector(".cat-te-ai-optimize-modal");
        this.aiOptimizeTitle = el.querySelector(".cat-te-ai-optimize-title");
        this.aiOptimizePrevBtn = el.querySelector(".cat-te-ai-optimize-nav.prev");
        this.aiOptimizeNextBtn = el.querySelector(".cat-te-ai-optimize-nav.next");
        this.aiModelSelect = el.querySelector(".cat-te-ai-model");
        this.aiLangSelect = el.querySelector(".cat-te-ai-lang");
        this.aiSystemInput = el.querySelector(".cat-te-ai-system");
        this.aiSkillInput = el.querySelector(".cat-te-ai-skill");
        this.skillPickBtn = el.querySelector(".cat-te-skill-pick-btn");
        this.skillSyncBtn = el.querySelector(".cat-te-skill-sync-btn");
        this.skillPickerModal = el.querySelector(".cat-te-skill-picker-modal");
        this.skillPickerBody = el.querySelector(".cat-te-skill-picker-body");
        this.skillPickerFilter = el.querySelector(".cat-te-skill-picker-filter");
        this.aiResultInput = el.querySelector(".cat-te-ai-result");
        this.aiGenerateBtn = el.querySelector(".cat-te-ai-generate");
        this.aiSrcText = el.querySelector(".cat-te-ai-src-text");
        this.aiSrcTabs = el.querySelectorAll(".cat-te-ai-src-tab");

        this.settingsModal = el.querySelector(".cat-te-settings-modal");
        this.autosaveIntervalInput = el.querySelector(".cat-te-autosave-interval");
        this.useClipVideoFilenameCb = el.querySelector(".cat-te-use-clip-video-filename");
        this.agentList = el.querySelector(".cat-te-agent-list");
        this.agentForm = el.querySelector(".cat-te-agent-form");
        this.agentLabelInput = el.querySelector(".cat-te-agent-label");
        this.agentProviderSelect = el.querySelector(".cat-te-agent-provider");
        this.agentModelInput = el.querySelector(".cat-te-agent-model");
        this.agentKeyInput = el.querySelector(".cat-te-agent-key");
        this.agentEnabledCb = el.querySelector(".cat-te-agent-enabled input");
        this.agentDeleteBtn = el.querySelector(".cat-te-agent-delete");
        this.importZipInput = el.querySelector(".cat-te-import-zip");
        el.querySelector(".cat-te-import").addEventListener("click", (e) => this._showImportMenu(e));
        el.querySelector(".cat-te-export").addEventListener("click", (e) => this._showExportMenu(e));
        this.importZipInput.addEventListener("change", (e) => void this._importProjectZip(e));
        el.querySelector(".cat-te-header-close").addEventListener("click", () => this.close());
        this.addMaterialInput.addEventListener("change", (e) => this._previewSelectedMaterial(e));
        el.querySelector(".cat-te-add-material-close").addEventListener("click", () => this._closeAddMaterial());
        el.querySelector(".cat-te-add-material-confirm").addEventListener("click", () => void this._confirmAddMaterial());

        el.querySelector(".cat-te-media-preview-close").addEventListener("click", () => this._closeMediaPreview());
        this.mediaPreviewPrevBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            this._stepMediaPreview(-1);
        });
        this.mediaPreviewNextBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            this._stepMediaPreview(1);
        });
        this.mediaPreviewInsertBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            void this._insertMediaPreviewAtSeek();
        });
        this.mediaPreviewBody?.addEventListener("mousedown", (e) => {
            if (this.mediaPreviewModal.hidden) return;
            if (this._mediaPreviewState?.browse === false) return;
            if (e.button !== 0) return;
            if (e.target.closest(".cat-te-media-preview-stars, .cat-te-media-preview-nav, .cat-te-modal-close, .cat-te-media-preview-actions")) return;
            if (e.target.closest("video, audio")) return;
            e.preventDefault();
            this._stepMediaPreview(1);
        });
        this.mediaPreviewBody?.addEventListener("contextmenu", (e) => {
            if (this.mediaPreviewModal.hidden) return;
            if (this._mediaPreviewState?.browse === false) return;
            if (e.target.closest(".cat-te-media-preview-stars, .cat-te-media-preview-nav, .cat-te-modal-close, .cat-te-media-preview-actions")) return;
            e.preventDefault();
            e.stopPropagation();
            this._stepMediaPreview(-1);
        });
        this.projectNameInput.addEventListener("focus", () => { this._projectNameUndoArmed = false; });
        this.projectNameInput.addEventListener("beforeinput", () => {
            if (!this._projectNameUndoArmed) {
                this._recordUndo();
                this._projectNameUndoArmed = true;
            }
        });
        this.projectNameInput.addEventListener("input", () => this._syncBrandProjectName());
        this.projectNameInput.addEventListener("blur", () => {
            this.projectNameInput.value = this.projectNameInput.value.trim() || T("untitled_project");
            this._projectNameUndoArmed = false;
            this._syncBrandProjectName();
        });
        this.brandProjectBtn?.addEventListener("click", () => this._focusProjectNameFromBrand());
        this.globalPromptInput?.addEventListener("focus", () => { this._globalPromptUndoArmed = true; });
        this.globalPromptInput?.addEventListener("blur", () => { this._globalPromptUndoArmed = false; });
        this.globalPromptInput?.addEventListener("input", () => this._onGlobalPromptInput());
        this.globalPromptCommentBtn?.addEventListener("click", () => {
            if (!this.globalPromptInput) return;
            this.globalPromptInput.focus();
            toggleComment(this.globalPromptInput);
            this._onGlobalPromptInput();
        });
        el.querySelector(".cat-te-settings").addEventListener("click", () => this._openSettings());
        this.settingsModal.querySelector(".cat-te-modal-close").addEventListener("click", () => this._closeSettings());
        el.querySelector(".cat-te-agent-add")?.addEventListener("click", () => this._editAgentConfig());
        el.querySelector(".cat-te-agent-cancel")?.addEventListener("click", () => this._cancelAgentEdit());
        el.querySelector(".cat-te-agent-save")?.addEventListener("click", () => void this._saveAgentConfig());
        this.agentDeleteBtn?.addEventListener("click", () => void this._deleteAgentConfig());
        this.agentProviderSelect?.addEventListener("change", () => {
            if (Object.values(AGENT_DEFAULT_MODELS).includes(this.agentModelInput.value) || !this.agentModelInput.value.trim()) {
                this.agentModelInput.value = AGENT_DEFAULT_MODELS[this.agentProviderSelect.value] || "";
            }
        });
        this.autosaveIntervalInput.addEventListener("change", () => {
            const n = parseInt(this.autosaveIntervalInput.value, 10);
            if (!Number.isFinite(n)) {
                this.autosaveIntervalInput.value = String(this._getAutosaveIntervalSec());
                return;
            }
            const clamped = Math.min(MAX_AUTOSAVE_INTERVAL_SEC, Math.max(MIN_AUTOSAVE_INTERVAL_SEC, n));
            localStorage.setItem(STORAGE_AUTOSAVE_INTERVAL, String(clamped));
            this.autosaveIntervalInput.value = String(clamped);
            if (this._overlay?.classList.contains("open")) this._startAutoSave();
        });
        this.useClipVideoFilenameCb?.addEventListener("change", () => {
            this._useClipSpecifiedVideoFilename = !!this.useClipVideoFilenameCb.checked;
            this._saveToWidgets();
        });

        this.promptInput.addEventListener("focus", () => { this._promptUndoArmed = true; });
        this.promptInput.addEventListener("blur", () => { this._promptUndoArmed = false; });
        this.promptInput.addEventListener("input", () => this._onPromptInput());
        this.aiPromptInput?.addEventListener("focus", () => { this._aiPromptUndoArmed = true; });
        this.aiPromptInput?.addEventListener("blur", () => { this._aiPromptUndoArmed = false; });
        this.aiPromptInput?.addEventListener("input", () => this._onAiPromptInput());
        this.clipPromptTabs?.forEach((tab) => {
            tab.addEventListener("click", () => this._setClipPromptTab(tab.dataset.tab));
        });
        this.aiOptimizeBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            if (this._aiOptimizeBusy) this._cancelAiOptimize();
            else void this._openAiOptimizeModal();
        });
        this.useGlobalCb.addEventListener("change", () => this._onUseGlobalChange());
        this.useAiPromptCb?.addEventListener("change", () => this._onUseAiPromptChange());
        this.useMediaPromptCb?.addEventListener("change", () => this._onUseMediaPromptChange());
        if (this.headExtendInput && !this.headExtendInput._catTeBound) {
            this.headExtendInput._catTeBound = true;
            this.headExtendInput.addEventListener("change", () => this._onHeadExtendChange());
            this.tailExtendInput?.addEventListener("change", () => this._onTailExtendChange());
            this.genPreviewVideoCb?.addEventListener("change", () => this._onGenPreviewVideoChange());
            this.secondSampleCb?.addEventListener("change", () => this._onSecondSampleChange());
        }
        this.clipRoleSelect?.addEventListener("change", () => this._onClipRoleChange());
        this.clipRoleCustomInput?.addEventListener("change", () => this._onClipRoleCustomChange());
        this.clipAgentSelect?.addEventListener("change", () => this._onClipAgentChange());
        this.clipAgentCustomInput?.addEventListener("change", () => this._onClipAgentCustomChange());
        this._bindSubtitlePanelEvents();
        this.clipSwiperPrev?.addEventListener("click", (e) => {
            e.stopPropagation();
            this._stepClipPreview(-1);
        });
        this.clipSwiperNext?.addEventListener("click", (e) => {
            e.stopPropagation();
            this._stepClipPreview(1);
        });
        this.clipThumbWrap?.addEventListener("click", () => {
            const clip = this._selClip;
            if (clip) this._openClipMediaPreview(clip);
        });
        this.clipThumbSortBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            const clip = this._selClip;
            if (clip) this._openClipItemsModal(clip);
        });
        this.clipThumbDeleteBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            this._removeCurrentClipItem();
        });
        this.clipVideosOpenBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            const clip = this._selClip;
            if (clip) this._openGenVideoModal(clip, 0);
        });
        el.querySelector(".cat-te-gen-video-close")?.addEventListener("click", () => this._closeGenVideoModal());
        this.genVideoPrevBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            this._stepGenVideoPreview(-1);
        });
        this.genVideoNextBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            this._stepGenVideoPreview(1);
        });
        this.genVideoEnabledCb?.addEventListener("change", () => this._onGenVideoEnabledChange());
        this.genVideoMutedCb?.addEventListener("change", () => this._onGenVideoMutedChange());
        this.genVideoNote?.addEventListener("change", () => this._onGenVideoNoteChange());
        this.genVideoNote?.addEventListener("blur", () => this._onGenVideoNoteChange());
        this.genVideoDeleteBtn?.addEventListener("click", () => this._deleteCurrentGenVideo());
        el.querySelector(".cat-te-output-videos-close")?.addEventListener("click", () => this._closeOutputVideosPicker());
        this.outputVideosFilter?.addEventListener("input", () => this._renderOutputVideosPicker());
        this.outputVideosTimeButtons?.forEach((btn) => {
            btn.addEventListener("click", () => {
                this._outputVideosTimeRange = btn.dataset.range;
                this.outputVideosTimeButtons.forEach((b) => b.classList.toggle("is-active", b === btn));
                this._renderOutputVideosPicker();
            });
        });
        this.outputVideosBody?.addEventListener("scroll", () => this._hideOutputVideoHoverPreview(), { passive: true });
        this._bindOutputVideosPanelDrag();
        el.querySelector(".cat-te-compose-close")?.addEventListener("click", () => this._closeComposeModal());
        el.querySelector(".cat-te-compose-cancel")?.addEventListener("click", () => this._closeComposeModal());
        this.composeRunBtn?.addEventListener("click", () => {
            if (this._composeDone) { void this._revealComposeOutput(); return; }
            void this._runComposeVideoExport();
        });
        this._bindWatermarkUi();
        this.mediaPreviewDesc?.addEventListener("input", () => this._saveMediaPreviewMeta());
        this.mediaPreviewDesc?.addEventListener("change", () => this._saveMediaPreviewMeta());
        this.mediaPreviewDesc?.addEventListener("blur", () => this._saveMediaPreviewMeta());
        this.mediaPreviewType?.addEventListener("change", () => this._onMediaPreviewTypeChange());
        this.mediaPreviewTypeCustom?.addEventListener("change", () => this._saveMediaPreviewMeta());
        this.mediaPreviewTypeCustom?.addEventListener("blur", () => this._saveMediaPreviewMeta());
        this.mediaPreviewTags?.addEventListener("change", () => this._saveMediaPreviewMeta());
        this.mediaPreviewTags?.addEventListener("blur", () => this._saveMediaPreviewMeta());
        el.querySelector(".cat-te-clip-items-close")?.addEventListener("click", () => this._closeClipItemsModal());
        el.querySelector(".cat-te-ai-optimize-close")?.addEventListener("click", () => this._closeAiOptimizeModal());
        this.aiOptimizePrevBtn?.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            void this._stepAiOptimizeClip(-1);
        });
        this.aiOptimizeNextBtn?.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            void this._stepAiOptimizeClip(1);
        });
        this.aiSrcTabs?.forEach((tab) => {
            tab.addEventListener("click", () => this._setAiOptimizeSrcTab(tab.dataset.src));
        });
        this.aiGenerateBtn?.addEventListener("click", () => {
            if (this._aiOptimizeBusy) this._cancelAiOptimize();
            else void this._runAiOptimize();
        });
        this.aiResultInput?.addEventListener("input", () => this._onAiResultInput());
        this.aiLangSelect?.addEventListener("change", () => {
            const lang = this._aiOutputLanguage();
            localStorage.setItem(STORAGE_AI_PROMPT_LANG, lang);
        });
        this.skillPickBtn?.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            void this._openSkillPicker();
        });
        this.skillSyncBtn?.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            void this._syncH3Skills();
        });
        el.querySelector(".cat-te-skill-picker-close")?.addEventListener("click", () => this._closeSkillPicker());
        this.skillPickerFilter?.addEventListener("input", () => this._renderSkillPicker());
        this.skillPickerBody?.addEventListener("click", (e) => {
            const btn = e.target.closest?.(".cat-te-skill-apply");
            if (!btn) return;
            e.preventDefault();
            void this._applyH3Skill(btn.dataset.skillId);
        });

        el.addEventListener("keydown", e => {
            const typing = !!e.target?.closest?.("input, textarea, select, [contenteditable='true']");
            if (!this.mediaPreviewModal.hidden && this._mediaPreviewState?.browse !== false
                && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !typing) {
                this._stepMediaPreview(e.key === "ArrowRight" ? 1 : -1);
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            if (!this.genVideoModal?.hidden && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !typing) {
                this._stepGenVideoPreview(e.key === "ArrowRight" ? 1 : -1);
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            if (this.aiOptimizeModal && !this.aiOptimizeModal.hidden
                && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !typing) {
                void this._stepAiOptimizeClip(e.key === "ArrowRight" ? 1 : -1);
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            if (e.key === "Escape") {
                if (this.outputVideosModal && !this.outputVideosModal.hidden) {
                    this._closeOutputVideosPicker();
                    e.stopPropagation();
                    return;
                }
                if (this._modalsBlockFileDrop()) { e.stopPropagation(); return; }
                if (this._removeCtxMenu()) { e.stopPropagation(); return; }
                if (this._closeMediaFilterPanel()) { e.stopPropagation(); return; }
                e.stopPropagation();
                this.close();
            }
        });

        document.addEventListener("click", this._onDocClick = (e) => {
            if (this._ignoreCtxCloseOnce) {
                this._ignoreCtxCloseOnce = false;
                return;
            }
            this._removeCtxMenu();
            if (!e.target.closest?.(".cat-te-media-filter-wrap")) this._closeMediaFilterPanel();
        });

        this._applySavedMediaPanelWidth();
        this._bindMediaPanelResize();
        this._applySavedSidebarPanelWidth();
        this._bindSidebarPanelResize();
        this._applySavedProgramPanelHeight();
        this._bindProgramPanelResize();
        this._bindExternalFileDrop();
        this._renderMediaStarFilter();
    }

    _mediaPanelMaxWidth() {
        const main = this._overlay?.querySelector(".cat-te-main");
        const mainW = main?.clientWidth ?? 0;
        if (mainW <= 0) return MIN_MEDIA_PANEL_W + 400;
        return Math.max(MIN_MEDIA_PANEL_W, Math.floor(mainW * MAX_MEDIA_PANEL_FRAC));
    }

    _setMediaPanelWidth(w) {
        const clamped = Math.min(this._mediaPanelMaxWidth(), Math.max(MIN_MEDIA_PANEL_W, Math.round(w)));
        this._overlay?.style.setProperty("--cat-te-media-w", `${clamped}px`);
        return clamped;
    }

    _applySavedMediaPanelWidth() {
        const saved = parseInt(localStorage.getItem(STORAGE_MEDIA_PANEL_W), 10);
        if (Number.isFinite(saved) && saved >= MIN_MEDIA_PANEL_W) {
            this._setMediaPanelWidth(saved);
        } else {
            this._setMediaPanelWidth(DEFAULT_MEDIA_PANEL_W);
        }
    }

    _bindMediaPanelResize() {
        const split = this.mediaPanelSplit;
        const panel = this.mediaPanel;
        if (!split || !panel) return;

        split.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            const startX = e.clientX;
            const startW = panel.offsetWidth;
            split.classList.add("dragging");
            document.body.classList.add("cat-te-col-resize");

            const onMove = (ev) => {
                this._setMediaPanelWidth(startW + (ev.clientX - startX));
            };
            const onUp = () => {
                split.classList.remove("dragging");
                document.body.classList.remove("cat-te-col-resize");
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
                localStorage.setItem(STORAGE_MEDIA_PANEL_W, String(panel.offsetWidth));
                this._refreshTimelineDuration();
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        });

        if (!this._onMediaPanelWinResize) {
            this._onMediaPanelWinResize = () => {
                if (!this._overlay?.classList.contains("open")) return;
                const w = this._setMediaPanelWidth(panel.offsetWidth);
                localStorage.setItem(STORAGE_MEDIA_PANEL_W, String(w));
                this._setSidebarPanelWidth(this.sidebarPanel?.offsetWidth ?? DEFAULT_SIDEBAR_PANEL_W);
            };
            window.addEventListener("resize", this._onMediaPanelWinResize);
        }
    }

    _sidebarPanelMaxWidth() {
        const main = this._overlay?.querySelector(".cat-te-main");
        const mainW = main?.clientWidth ?? 0;
        if (mainW <= 0) return DEFAULT_SIDEBAR_PANEL_W + 200;
        return Math.max(MIN_SIDEBAR_PANEL_W, Math.floor(mainW * MAX_SIDEBAR_PANEL_FRAC));
    }

    _setSidebarPanelWidth(w) {
        const clamped = Math.min(this._sidebarPanelMaxWidth(), Math.max(MIN_SIDEBAR_PANEL_W, Math.round(w)));
        this._overlay?.style.setProperty("--cat-te-sidebar-w", `${clamped}px`);
        return clamped;
    }

    _applySavedSidebarPanelWidth() {
        const saved = parseInt(localStorage.getItem(STORAGE_SIDEBAR_PANEL_W), 10);
        if (Number.isFinite(saved) && saved >= MIN_SIDEBAR_PANEL_W) {
            this._setSidebarPanelWidth(saved);
        } else {
            this._setSidebarPanelWidth(DEFAULT_SIDEBAR_PANEL_W);
        }
    }

    _bindSidebarPanelResize() {
        const split = this.sidebarPanelSplit;
        const panel = this.sidebarPanel;
        if (!split || !panel) return;

        split.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            const startX = e.clientX;
            const startW = panel.offsetWidth;
            split.classList.add("dragging");
            document.body.classList.add("cat-te-col-resize");

            const onMove = (ev) => {
                // Dragging the left edge of the right panel: move left → wider.
                this._setSidebarPanelWidth(startW - (ev.clientX - startX));
            };
            const onUp = () => {
                split.classList.remove("dragging");
                document.body.classList.remove("cat-te-col-resize");
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
                localStorage.setItem(STORAGE_SIDEBAR_PANEL_W, String(panel.offsetWidth));
                this._refreshTimelineDuration();
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        });

        if (!this._onSidebarPanelWinResize) {
            this._onSidebarPanelWinResize = () => {
                if (!this._overlay?.classList.contains("open")) return;
                const w = this._setSidebarPanelWidth(panel.offsetWidth);
                localStorage.setItem(STORAGE_SIDEBAR_PANEL_W, String(w));
            };
            window.addEventListener("resize", this._onSidebarPanelWinResize);
        }
    }

    _programPanelMaxHeight() {
        const center = this._overlay?.querySelector(".cat-te-center");
        const ch = center?.clientHeight ?? 0;
        if (ch <= 0) return DEFAULT_PROGRAM_PANEL_H + 200;
        return Math.max(MIN_PROGRAM_PANEL_H, Math.floor(ch * MAX_PROGRAM_PANEL_FRAC));
    }

    _setProgramPanelHeight(h) {
        const clamped = Math.min(this._programPanelMaxHeight(), Math.max(MIN_PROGRAM_PANEL_H, Math.round(h)));
        this._overlay?.style.setProperty("--cat-te-program-h", `${clamped}px`);
        return clamped;
    }

    _applySavedProgramPanelHeight() {
        const saved = parseInt(localStorage.getItem(STORAGE_PROGRAM_PANEL_H), 10);
        if (Number.isFinite(saved) && saved >= MIN_PROGRAM_PANEL_H) {
            this._setProgramPanelHeight(saved);
        } else {
            this._setProgramPanelHeight(DEFAULT_PROGRAM_PANEL_H);
        }
    }

    _bindProgramPanelResize() {
        const split = this.programSplit;
        const panel = this.programRoot;
        if (!split || !panel) return;

        split.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            const startY = e.clientY;
            const startH = panel.offsetHeight;
            split.classList.add("dragging");
            document.body.classList.add("cat-te-row-resize");

            const onMove = (ev) => {
                this._setProgramPanelHeight(startH + (ev.clientY - startY));
                this._scheduleProgramPreview();
            };
            const onUp = () => {
                split.classList.remove("dragging");
                document.body.classList.remove("cat-te-row-resize");
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
                const h = this._setProgramPanelHeight(panel.offsetHeight);
                localStorage.setItem(STORAGE_PROGRAM_PANEL_H, String(h));
                this._refreshTimelineDuration();
                this._scheduleProgramPreview();
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        });

        if (!this._onProgramPanelWinResize) {
            this._onProgramPanelWinResize = () => {
                if (!this._overlay?.classList.contains("open")) return;
                const h = this._setProgramPanelHeight(panel.offsetHeight);
                localStorage.setItem(STORAGE_PROGRAM_PANEL_H, String(h));
                this._scheduleProgramPreview();
            };
            window.addEventListener("resize", this._onProgramPanelWinResize);
        }
    }

    _viewportRightPaddingSec() {
        const tl = this._timeline;
        if (!tl?.scrollEl) return 0;
        const vw = tl.scrollEl.clientWidth || 0;
        if (vw <= 0) return 0;
        return (vw * TIMELINE_RIGHT_VIEWPORT_FRAC) / Math.max(1e-6, tl.pixelsPerSecond);
    }

    /**
     * Zoom level (relative to the current one) at which the furthest clip
     * end exactly fills 70% of the viewport width, leaving 30% blank margin
     * visible with no scrolling. Returns null when there's no content or the
     * viewport hasn't been laid out yet.
     */
    _computeFitZoom() {
        const tl = this._timeline;
        if (!tl?.scrollEl) return null;
        const vw = tl.scrollEl.clientWidth || 0;
        if (vw <= 0) return null;

        let maxEnd = 0;
        for (const track of tl.tracks) {
            for (const clip of track.clips) {
                maxEnd = Math.max(maxEnd, clip.endTime);
            }
        }
        if (maxEnd <= 0) return null;

        const pps = tl.pixelsPerSecond;
        const desiredPps = (vw * (1 - TIMELINE_RIGHT_VIEWPORT_FRAC)) / maxEnd;
        return tl._zoom * (desiredPps / pps);
    }

    /**
     * Zoom out (never in) just enough that the furthest clip end still fits
     * within 70% of the viewport width, leaving the reserved 30% margin
     * actually visible on screen instead of requiring a scroll.
     */
    _autoFitZoom() {
        const tl = this._timeline;
        const fitZoom = this._computeFitZoom();
        if (fitZoom == null || fitZoom >= tl._zoom) return; // content already fits within the 70% zone

        tl.setZoom(fitZoom);
        tl.scrollEl.scrollLeft = 0;
    }

    /**
     * Pin the "zoomed all the way out" floor to the same 70/30 fit point, so
     * manually zooming out (Ctrl+wheel, slider, − button) can't go past a
     * state that still requires scrolling to see the reserved margin.
     */
    _syncMinZoom() {
        const tl = this._timeline;
        if (!tl) return;
        const fitZoom = this._computeFitZoom();
        const absoluteFloor = 0.02;
        tl.minZoom = fitZoom != null
            ? Math.min(Math.max(fitZoom, absoluteFloor), tl.maxZoom)
            : absoluteFloor;
    }

    _readTimelineZoom(settings) {
        const z = Number(settings?.timeline_zoom);
        return Number.isFinite(z) && z > 0 ? z : null;
    }

    _applyTimelineZoomFromSettings(settings, { autoFitIfMissing = true } = {}) {
        const tl = this._timeline;
        if (!tl) return;
        const saved = this._readTimelineZoom(settings);
        if (saved != null) {
            tl.setZoom(saved);
        } else if (autoFitIfMissing) {
            this._autoFitZoom();
        }
    }

    _viewCacheKey() {
        const id = this.node?.id;
        return `${STORAGE_VIEW_PREFIX}${id != null ? id : "default"}`;
    }

    _readViewFromLocalCache() {
        try {
            const raw = localStorage.getItem(this._viewCacheKey());
            if (!raw) return null;
            const data = JSON.parse(raw);
            return data && typeof data === "object" ? data : null;
        } catch {
            return null;
        }
    }

    _persistViewToLocalCache() {
        const tl = this._timeline;
        if (!tl) return;
        const payload = {
            current_time: Number(tl.currentTime) || 0,
            timeline_zoom: Number(tl.getZoom?.() ?? tl._zoom) || 1.2,
            timeline_scroll_left: Number(tl.scrollEl?.scrollLeft) || 0,
            timeline_scroll_top: Number(tl.scrollEl?.scrollTop) || 0,
        };
        try {
            localStorage.setItem(this._viewCacheKey(), JSON.stringify(payload));
        } catch { /* quota / private mode */ }
    }

    _persistPanelLayout() {
        const mediaW = this.mediaPanel?.offsetWidth;
        const sidebarW = this.sidebarPanel?.offsetWidth;
        const programH = this.programRoot?.offsetHeight;
        if (Number.isFinite(mediaW) && mediaW >= MIN_MEDIA_PANEL_W) {
            localStorage.setItem(STORAGE_MEDIA_PANEL_W, String(Math.round(mediaW)));
        }
        if (Number.isFinite(sidebarW) && sidebarW >= MIN_SIDEBAR_PANEL_W) {
            localStorage.setItem(STORAGE_SIDEBAR_PANEL_W, String(Math.round(sidebarW)));
        }
        if (Number.isFinite(programH) && programH >= MIN_PROGRAM_PANEL_H) {
            localStorage.setItem(STORAGE_PROGRAM_PANEL_H, String(Math.round(programH)));
        }
    }

    _readViewSettingsFromProjectWidget() {
        const parsed = this._parseProjectWidgetValue();
        const settings = parsed.project?.settings && typeof parsed.project.settings === "object"
            ? parsed.project.settings
            : {};
        return { ...this._readViewFromLocalCache(), ...settings };
    }

    /**
     * Restore playhead + scroll (and optionally zoom) from project settings /
     * local cache. Zoom should already be applied when applyZoom is false.
     */
    _applyTimelineViewFromSettings(settings, { applyZoom = false, autoFitIfMissing = false } = {}) {
        const tl = this._timeline;
        if (!tl) return;
        if (applyZoom) {
            this._applyTimelineZoomFromSettings(settings, { autoFitIfMissing });
        }
        const t = Number(settings?.current_time);
        if (Number.isFinite(t) && t >= 0) {
            tl.setCurrentTime(t, { userSeek: false });
        }
        const scrollEl = tl.scrollEl;
        if (!scrollEl) return;
        const sl = Number(settings?.timeline_scroll_left);
        const st = Number(settings?.timeline_scroll_top);
        if (Number.isFinite(sl) && sl >= 0) scrollEl.scrollLeft = sl;
        if (Number.isFinite(st) && st >= 0) scrollEl.scrollTop = st;
    }

    _computeTimelineDuration() {
        let maxEnd = 0;
        for (const track of this._timeline?.tracks ?? []) {
            for (const clip of track.clips) {
                maxEnd = Math.max(maxEnd, clip.endTime);
            }
        }
        const fps = this.getFps();
        const step = 1 / fps;
        const pad = this._viewportRightPaddingSec();
        if (maxEnd <= 0) {
            return Math.max(60, this._timeline?.duration ?? 60);
        }
        return Math.ceil((maxEnd + pad) / step) * step;
    }

    _ensureTimelineLength(minEndSec) {
        if (!this._timeline) return;
        const pad = this._viewportRightPaddingSec();
        const need = Math.max(minEndSec + pad, 60);
        if (need <= this._timeline.duration) return;
        this._timeline.duration = need;
        if (this._timeline._durEl) {
            this._timeline._durEl.textContent = `/ ${this._timeline.formatTime(need)}`;
        }
        this._timeline._refresh();
    }

    _refreshTimelineDuration() {
        if (!this._timeline) return;
        const dur = this._computeTimelineDuration();
        this._timeline.duration = dur;
        this._syncMinZoom();
        if (this._timeline._durEl) {
            this._timeline._durEl.textContent = `/ ${this._timeline.formatTime(dur)}`;
        }
        this._timeline._refresh();
    }

    _allImageTracks() {
        return (this._timeline?.tracks ?? []).filter(t => t.type === "image");
    }

    _allAudioTracks() {
        return (this._timeline?.tracks ?? []).filter(t => t.type === "audio");
    }

    _allTextTracks() {
        return (this._timeline?.tracks ?? []).filter(t => isSubtitleTrackType(t.type));
    }

    _trackIndex(track) {
        return this._trackInfo.get(track.id)?.trackIndex ?? 0;
    }

    _nextTrackIndex() {
        let max = -1;
        for (const v of this._trackInfo.values()) {
            max = Math.max(max, v.trackIndex ?? 0);
        }
        return max + 1;
    }

    /** Icon-only slot shared by every track row. `null` renders an empty,
     * non-interactive placeholder so the same-function icon in other rows
     * (lock/eye/mute) always lines up in the same column. */
    _makeTrackSlot(track, kind) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cat-te-track-btn";
        if (kind === null) {
            btn.classList.add("placeholder");
            btn.disabled = true;
            btn.tabIndex = -1;
            return btn;
        }
        if (kind === "lock") {
            const render = () => {
                btn.innerHTML = track.locked ? ICONS.lock : ICONS.lockOpen;
                btn.classList.toggle("active", track.locked);
                btn.title = track.locked ? T("unlock_track_title") : T("lock_track_title");
            };
            btn.addEventListener("click", e => {
                e.stopPropagation();
                this._recordUndo();
                track.setLocked(!track.locked);
                render();
            });
            render();
        } else if (kind === "visible") {
            const render = () => {
                btn.innerHTML = track.visible ? ICONS.eye : ICONS.eyeOff;
                btn.classList.toggle("active", !track.visible);
            };
            btn.title = T("track_visibility_title");
            btn.addEventListener("click", e => {
                e.stopPropagation();
                this._recordUndo();
                track.setVisible(!track.visible);
                render();
                this._decorateAllClips();
                this._scheduleProgramPreview();
            });
            render();
        } else if (kind === "mute") {
            const render = () => {
                btn.innerHTML = track.muted ? ICONS.volumeOff : ICONS.volume;
                btn.classList.toggle("active", track.muted);
                const off = T("unmute_label");
                const on = T("mute_label");
                btn.title = track.muted ? off : on;
            };
            btn.addEventListener("click", e => {
                e.stopPropagation();
                this._recordUndo();
                track.setMuted(!track.muted);
                render();
                this._decorateAllClips();
                if (this._timeline?._playing) this._startAudioPlayback();
            });
            render();
        }
        return btn;
    }

    _setupTrackControls(track) {
        const actions = track.actionsEl;
        if (!actions || actions.dataset.catTeBound) return;
        actions.dataset.catTeBound = "1";
        actions.replaceChildren();

        // Fixed column order for every track type: lock, visibility, mute.
        // A track that doesn't support a slot gets a blank placeholder
        // instead of skipping it, so the icons that DO apply still align
        // vertically with the same column in other rows.
        actions.appendChild(this._makeTrackSlot(track, "lock"));
        actions.appendChild(this._makeTrackSlot(
            track,
            (track.type === "image" || isSubtitleTrackType(track.type)) ? "visible" : null,
        ));
        // Audio slot: real mute for media/audio; disabled placeholder for subtitle tracks.
        actions.appendChild(this._makeTrackSlot(
            track,
            (track.type === "audio" || track.type === "image" || track.type === "video") ? "mute" : null,
        ));
    }

    /** User-added tracks (not the default main/overlay/audio ones) disappear
     * on their own once emptied — there's no manual delete button. */
    _pruneEmptyTrack(track) {
        if (!track) return;
        if (track === this._mainTrack || track === this._overlayTrack || track === this._audioTrack) return;
        if (track.clips.length > 0) return;
        this._timeline?.removeTrack(track.id);
    }

    handleDeleteKey(e) {
        if (!this._overlay?.classList.contains("open")) return false;
        if (e.target?.closest?.("input, textarea, select")) return false;
        if (e.key !== "Delete" && e.key !== "Backspace") return false;
        const clips = this._timeline?.getSelectedClips() ?? [];
        if (!clips.length) return false;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        const n = clips.length;
        const msg = n === 1
            ? T("confirm_delete_named_clip", { name: clips[0].name })
            : T("confirm_delete_selected_n_clips", { n });
        if (!confirm(msg)) return true;
        this._recordUndo();
        for (const clip of clips) {
            this._meta.delete(clip.id);
            this._timeline.removeClip(clip.track.id, clip.id);
        }
        if (!this._timeline.getSelectedClips().length) {
            this._timeline.selectClip(null);
        }
        this._updatePromptPanel();
        this._refreshTimelineDuration();
        return true;
    }

    _imgUrl(file) {
        return this._assetFileUrl(file, "image", "input");
    }

    _videoUrl(file) {
        return this._assetFileUrl(file, "video", "input");
    }

    _outputVideoUrl(file) {
        const rel = normalizeOutputVideoPath(file)
            || String(file || "").replace(/\\/g, "/").replace(/^\/+/, "");
        if (!rel) return "";
        const slash = rel.lastIndexOf("/");
        const filename = slash >= 0 ? rel.slice(slash + 1) : rel;
        const subfolder = slash >= 0 ? rel.slice(0, slash) : "";
        return api.apiURL(
            `/view?filename=${encodeURIComponent(filename)}`
            + `&type=output&subfolder=${encodeURIComponent(subfolder)}`,
        );
    }

    _getOutputVideoThumbnail(file) {
        const key = `output:${file}`;
        if (this._videoThumbCache.has(key)) return this._videoThumbCache.get(key);
        const p = this._grabVideoThumbnail(this._outputVideoUrl(file)).catch(() => null);
        this._videoThumbCache.set(key, p);
        return p;
    }

    _audioUrl(filename) {
        if (!filename) return null;
        return this._assetFileUrl(filename, "audio", "input");
    }

    /** Rebuild media lists from this project's resources + timeline refs only.
     * Do not scan the whole ComfyUI input folder — a new empty node stays empty. */
    async _reloadMediaLibrary() {
        this._mediaReloading = true;
        this._overlay?.querySelector(".cat-te-media-refresh")?.classList.add("spinning");
        this._videoThumbCache.clear();
        this._loadMediaStarsForDir();
        try {
            this._imgFiles = [];
            this._videoFiles = [];
            this._audioFiles = [];
            this._mediaStatus.clear();
            await this._syncProjectMedia();
            this._renderMediaGrid();
        } finally {
            this._mediaReloading = false;
            this._overlay?.querySelector(".cat-te-media-refresh")?.classList.remove("spinning");
        }
    }

    /** Re-check project media status (missing / present), then redraw. */
    async _refreshMediaLists() {
        await this._reloadMediaLibrary();
    }

    _mediaStarsId(kind, file) {
        return `${kind}:${file}`;
    }

    _findMediaById(id) {
        const key = String(id || "");
        if (!key) return null;
        return this._projectResources.find((row) => row?.id === key) || null;
    }

    _findMedia(kind, file) {
        kind = String(kind || "").toLowerCase();
        file = String(file || "").trim();
        if (!kind || !file) return null;
        return this._projectResources.find((row) => row.kind === kind && row.file === file) || null;
    }

    _ensureMedia(kind, file, extras = {}) {
        kind = String(kind || "").toLowerCase();
        file = String(file || "").trim();
        if (!kind || !file || !["image", "video", "audio"].includes(kind)) return null;
        let row = this._findMedia(kind, file);
        if (!row) {
            const local = this._parseMediaMeta(this._mediaStarsByDir?.[this._mediaStarsId(kind, file)]);
            row = {
                id: mediaUid(),
                kind,
                file,
                location: "input",
                name: file.split(/[\\/]/).pop() || file,
                prompt: local.prompt || "",
                media_type: local.mediaType || "",
                tags: Array.isArray(local.tags) ? [...local.tags] : [],
            };
            if (local.stars) row.stars = local.stars;
            this._projectResources.push(row);
        }
        if (!row.id) row.id = mediaUid();
        row.location = "input";
        if (extras && typeof extras === "object") Object.assign(row, extras);
        const list = kind === "audio" ? this._audioFiles : kind === "video" ? this._videoFiles : this._imgFiles;
        if (!list.includes(file)) list.push(file);
        this._mediaStatus.set(`${kind}:${file}`, { location: "input" });
        return row;
    }

    _serializeMediaCatalog() {
        const seen = new Set();
        const out = [];
        for (const row of this._projectResources) {
            if (!row?.kind || !row?.file) continue;
            const key = `${row.kind}:${row.file}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const entry = {
                id: row.id || mediaUid(),
                kind: row.kind,
                file: row.file,
                location: "input",
                name: row.name || String(row.file).split(/[\\/]/).pop(),
                prompt: String(row.prompt || ""),
                media_type: String(row.media_type || "").trim(),
                tags: Array.isArray(row.tags) ? row.tags.map((t) => String(t || "").trim()).filter(Boolean) : [],
            };
            const stars = Number(row.stars);
            if (Number.isFinite(stars) && stars >= 1 && stars <= 5) entry.stars = stars;
            if (!row.id) row.id = entry.id;
            out.push(entry);
        }
        return out;
    }

    _migrateProjectDocument(project) {
        const src = project && typeof project === "object" && !Array.isArray(project)
            ? JSON.parse(JSON.stringify(project))
            : {};
        if (!Array.isArray(src.tracks)) src.tracks = [];
        if (!src.settings || typeof src.settings !== "object") src.settings = {};
        src.name = String(src.name || T("untitled_project")).trim() || T("untitled_project");
        this._loadMediaStarsForDir();
        if (parseSchemaVersion(src) < 2) this._migrateProjectSchema1To2(src);
        else this._hydrateMediaCatalog(src);
        src.schema_version = SCHEMA_VERSION;
        src.project_version = this._currentVersion();
        return src;
    }

    _hydrateMediaCatalog(project) {
        const media = [];
        const seenKey = new Set();
        const seenId = new Set();
        for (const row of project.media || project.resources || []) {
            if (!row || typeof row !== "object") continue;
            const kind = String(row.kind || "").toLowerCase();
            const file = String(row.file || "").trim();
            if (!kind || !file || !["image", "video", "audio"].includes(kind)) continue;
            const key = `${kind}:${file}`;
            if (seenKey.has(key)) continue;
            seenKey.add(key);
            let id = String(row.id || "").trim() || mediaUid();
            if (seenId.has(id)) id = mediaUid();
            seenId.add(id);
            const local = this._parseMediaMeta(this._mediaStarsByDir?.[this._mediaStarsId(kind, file)]);
            const tags = Array.isArray(row.tags) ? row.tags : (local.tags || []);
            const entry = {
                id,
                kind,
                file,
                location: "input",
                name: row.name || file.split(/[\\/]/).pop() || file,
                prompt: String(row.prompt || local.prompt || ""),
                media_type: String(row.media_type || row.mediaType || local.mediaType || "").trim(),
                tags: tags.map((t) => String(t || "").trim()).filter(Boolean),
            };
            const stars = Number(row.stars ?? local.stars);
            if (Number.isFinite(stars) && stars >= 1 && stars <= 5) entry.stars = stars;
            media.push(entry);
        }
        project.media = media;
        delete project.resources;
        const catalog = new Map(media.map((row) => [row.id, row]));
        for (const track of project.tracks || []) {
            if (!track || typeof track !== "object") continue;
            for (const clip of track.clips || []) {
                if (!clip || typeof clip !== "object") continue;
                const ids = Array.isArray(clip.media_ids) ? clip.media_ids.map((id) => String(id)) : [];
                const valid = ids.filter((id) => catalog.has(id));
                if (valid.length) {
                    clip.media_ids = valid;
                    this._stripLegacyClipFiles(clip);
                    continue;
                }
                const refs = this._legacyClipMediaRefs(clip, track);
                clip.media_ids = refs.map((row) => {
                    let found = media.find((m) => m.kind === row.kind && m.file === row.file);
                    if (!found) {
                        found = {
                            id: mediaUid(),
                            kind: row.kind,
                            file: row.file,
                            location: "input",
                            name: row.file.split(/[\\/]/).pop() || row.file,
                            prompt: "",
                            media_type: "",
                            tags: [],
                        };
                        media.push(found);
                        catalog.set(found.id, found);
                    }
                    return found.id;
                });
                this._stripLegacyClipFiles(clip);
            }
        }
    }

    _legacyClipMediaRefs(clip, track) {
        const trackType = String(track?.type || "visual").toLowerCase();
        const clipType = String(clip.type || (trackType === "audio" ? "audio" : "image")).toLowerCase();
        const isAudio = clipType === "audio" || trackType === "audio";
        const refs = [];
        const add = (kind, file) => {
            kind = String(kind || "").toLowerCase();
            file = String(file || "").trim();
            if (!kind || !file) return;
            if (refs.some((r) => r.kind === kind && r.file === file)) return;
            refs.push({ kind, file });
        };
        if (Array.isArray(clip.items)) {
            for (const item of clip.items) {
                if (typeof item === "string") add("image", item);
                else if (item && typeof item === "object") {
                    add(item.kind || "image", item.file || item.src);
                }
            }
        }
        if (!refs.length) {
            const source = clip.source && typeof clip.source === "object" ? clip.source : {};
            const kind = isAudio ? "audio" : (clipType === "video" || source.kind === "video" ? "video" : "image");
            add(kind, source.file || clip.start_image || clip.audio_file || clip.src);
        }
        if (!isAudio) add("image", clip.end_image);
        return refs;
    }

    _stripLegacyClipFiles(clip) {
        if (clip.source && typeof clip.source === "object") {
            const source = {};
            if (clip.source.in_ms != null) source.in_ms = clip.source.in_ms;
            if (clip.source.out_ms != null) source.out_ms = clip.source.out_ms;
            if (clip.source.duration_ms != null) source.duration_ms = clip.source.duration_ms;
            if (Object.keys(source).length) clip.source = source;
            else delete clip.source;
        }
        delete clip.items;
        delete clip.end_image;
        delete clip.start_image;
        delete clip.audio_file;
        if (clip.type !== "audio") clip.type = "clip";
    }

    _migrateProjectSchema1To2(project) {
        this._hydrateMediaCatalog(project);
    }

    _applyMediaCatalogFromProject(project) {
        this._projectResources = Array.isArray(project?.media)
            ? project.media.filter((row) => row && row.file && row.kind).map((row) => ({ ...row }))
            : [];
        this._imgFiles = [];
        this._videoFiles = [];
        this._audioFiles = [];
        for (const resource of this._projectResources) {
            const kind = String(resource.kind || "").toLowerCase();
            const file = String(resource.file || "").trim();
            if (!kind || !file) continue;
            const list = kind === "audio" ? this._audioFiles : kind === "video" ? this._videoFiles : this._imgFiles;
            if (!list.includes(file)) list.push(file);
            if (resource.location) this._mediaStatus.set(`${kind}:${file}`, { location: resource.location });
        }
    }

    _jsonClipMediaRows(clip) {
        const ids = Array.isArray(clip?.media_ids) ? clip.media_ids : [];
        const fromIds = ids.map((id) => this._findMediaById(id)).filter(Boolean);
        if (fromIds.length) return fromIds;
        const items = Array.isArray(clip?.items) ? clip.items.map(normalizeClipItem).filter(Boolean) : [];
        const rows = [];
        for (const item of items) {
            const media = (item.id && this._findMediaById(item.id))
                || this._ensureMedia(item.kind, item.file);
            if (media) rows.push(media);
        }
        if (rows.length) return rows;
        const fallback = String(clip?.start_image || clip?.src || clip?.audio_file || "").trim();
        if (fallback) {
            const kind = clip?.clip_type === "audio" || clip?.type === "audio"
                ? "audio"
                : (clip?.clip_type === "video" || clip?.type === "video" ? "video" : "image");
            const media = this._ensureMedia(kind, fallback);
            if (media) rows.push(media);
        }
        const endImage = String(clip?.end_image || "").trim();
        if (endImage && endImage !== fallback) {
            const media = this._ensureMedia("image", endImage);
            if (media) rows.push(media);
        }
        return rows;
    }

    _clipsFromProjectTracks(project, fps) {
        const clips = [];
        const projectTracks = Array.isArray(project?.tracks) ? project.tracks : [];
        projectTracks.forEach((track, trackIndex) => {
            const trackType = String(track?.type || "visual").toLowerCase();
            for (const clip of Array.isArray(track.clips) ? track.clips : []) {
                if (!clip || typeof clip !== "object") continue;
                const source = clip.source && typeof clip.source === "object" ? clip.source : {};
                const mediaRows = this._jsonClipMediaRows(clip);
                const isAudio = clip.type === "audio" || trackType === "audio";
                const isSubtitle = !isAudio && (
                    clip.type === "subtitle"
                    || trackType === "subtitle"
                    || trackType === "text"
                );
                const first = mediaRows[0];
                const startMs = Number(clip.start_ms) || 0;
                const durationMs = Number(clip.duration_ms);
                const legacyEndMs = Number(clip.end_ms);
                const { startTime, duration } = decodeClipTimingSecs(
                    startMs,
                    durationMs,
                    Number.isFinite(legacyEndMs) ? legacyEndMs : null,
                    fps,
                );
                const startMsOut = Math.round(startTime * 1000);
                const durationMsOut = Math.max(1, Math.round(duration * 1000));
                clips.push({
                    ...clip,
                    clip_type: isAudio ? "audio" : isSubtitle ? "subtitle" : "clip",
                    track: trackIndex,
                    start_ms: startMsOut,
                    duration_ms: durationMsOut,
                    end_ms: startMsOut + durationMsOut,
                    items: isAudio || isSubtitle
                        ? []
                        : mediaRows
                            .filter((row) => row.kind !== "audio")
                            .map((row) => ({ id: row.id, kind: row.kind, file: row.file })),
                    start_image: isAudio || isSubtitle ? null : (first?.file || null),
                    audio_file: isAudio ? (first?.file || null) : null,
                    text: isSubtitle ? String(clip.text ?? clip.name ?? "") : undefined,
                    source_duration: (
                        Number(source.duration_ms) > 0
                            ? Number(source.duration_ms)
                            : Math.max(durationMsOut, Number(source.out_ms) - Number(source.in_ms) || 0)
                    ) / 1000,
                    trim_in: Math.max(0, Number(source.in_ms) || 0) / 1000,
                    disabled: clip.enabled === false,
                });
            }
        });
        return clips;
    }

    _clipMediaIds(meta, clip) {
        if (Array.isArray(meta?.mediaIds) && meta.mediaIds.length) return meta.mediaIds.map(String);
        return this._clipItems(meta).map((item) => item.id).filter(Boolean);
    }

    _loadMediaStarsForDir() {
        try {
            const all = JSON.parse(localStorage.getItem(STORAGE_MEDIA_STARS) || "{}");
            const bucket = all[MEDIA_STARS_BUCKET];
            this._mediaStarsByDir = bucket && typeof bucket === "object" ? { ...bucket } : {};
        } catch {
            this._mediaStarsByDir = {};
        }
    }

    _saveMediaStarsForDir() {
        try {
            const all = JSON.parse(localStorage.getItem(STORAGE_MEDIA_STARS) || "{}");
            if (!Object.keys(this._mediaStarsByDir).length) delete all[MEDIA_STARS_BUCKET];
            else all[MEDIA_STARS_BUCKET] = this._mediaStarsByDir;
            localStorage.setItem(STORAGE_MEDIA_STARS, JSON.stringify(all));
        } catch { /* ignore */ }
    }

    _getMediaStars(kind, file) {
        const meta = this._getMediaMeta(kind, file);
        return meta.stars;
    }

    _setMediaStars(kind, file, stars) {
        const meta = this._getMediaMeta(kind, file);
        const n = Number(stars);
        if (Number.isFinite(n) && n >= 1 && n <= 5) meta.stars = n;
        else delete meta.stars;
        this._writeMediaMeta(kind, file, meta);
    }

    _parseMediaMeta(raw) {
        if (typeof raw === "number") {
            return Number.isFinite(raw) && raw >= 1 && raw <= 5 ? { stars: raw } : {};
        }
        if (!raw || typeof raw !== "object") return {};
        const out = {};
        const stars = Number(raw.stars);
        if (Number.isFinite(stars) && stars >= 1 && stars <= 5) out.stars = stars;
        if (typeof raw.prompt === "string") out.prompt = raw.prompt;
        if (typeof raw.mediaType === "string") out.mediaType = raw.mediaType.trim();
        if (typeof raw.mediaTypeCustom === "string") out.mediaTypeCustom = raw.mediaTypeCustom;
        if (Array.isArray(raw.tags)) {
            out.tags = raw.tags.map((t) => String(t || "").trim()).filter(Boolean);
        }
        return out;
    }

    _getMediaMeta(kind, file) {
        const row = this._findMedia(kind, file);
        if (row) {
            return {
                stars: Number.isFinite(Number(row.stars)) ? Number(row.stars) : undefined,
                prompt: String(row.prompt || ""),
                mediaType: String(row.media_type || "").trim(),
                tags: Array.isArray(row.tags) ? [...row.tags] : [],
            };
        }
        return this._parseMediaMeta(this._mediaStarsByDir?.[this._mediaStarsId(kind, file)]);
    }

    _writeMediaMeta(kind, file, meta) {
        const next = this._parseMediaMeta(meta);
        const row = this._ensureMedia(kind, file);
        if (row) {
            row.prompt = next.prompt || "";
            row.media_type = next.mediaType || "";
            row.tags = Array.isArray(next.tags) ? [...next.tags] : [];
            if (next.stars) row.stars = next.stars;
            else delete row.stars;
        }
        const id = this._mediaStarsId(kind, file);
        if (!next.stars && !next.prompt && !next.mediaType && !(next.tags?.length)) {
            delete this._mediaStarsByDir[id];
        } else {
            this._mediaStarsByDir[id] = next;
        }
        this._saveMediaStarsForDir();
    }

    _parseTagList(text) {
        return String(text || "")
            .split(/[,，;；]/)
            .map((t) => t.trim())
            .filter(Boolean);
    }

    _mediaTypeLabel(id) {
        return MEDIA_ASSET_TYPES.find((t) => t.id === id)?.label || id || "";
    }

    _clipRoleLabel(id, custom = "") {
        if (id === "other") return String(custom || "").trim() || T("clip_role_other");
        return CLIP_ROLES.find((r) => r.id === id)?.label || T("clip_role_multi_ref");
    }

    _knownClipRole(id) {
        return CLIP_ROLES.some((r) => r.id === id) ? id : "multi_ref";
    }

    _knownClipAgent(id) {
        return CLIP_AGENTS.some((a) => a.id === id) ? id : "MiniMaxH3";
    }

    _clipItems(meta) {
        const raw = Array.isArray(meta?.items)
            ? meta.items
            : (Array.isArray(meta?.mediaIds) ? meta.mediaIds : []);
        return raw.map((item) => {
            if (typeof item === "string") {
                const media = this._findMediaById(item);
                return media
                    ? { id: media.id, kind: media.kind, file: media.file, useMediaPrompt: true, enabled: true }
                    : null;
            }
            const parsed = normalizeClipItem(item);
            if (!parsed) return null;
            const media = (parsed.id && this._findMediaById(parsed.id))
                || this._findMedia(parsed.kind, parsed.file);
            const useMediaPrompt = parsed.useMediaPrompt !== false;
            const enabled = parsed.enabled !== false;
            if (media) return { id: media.id, kind: media.kind, file: media.file, useMediaPrompt, enabled };
            if (!parsed.file) return null;
            const created = this._ensureMedia(parsed.kind, parsed.file);
            return created
                ? { id: created.id, kind: created.kind, file: created.file, useMediaPrompt, enabled }
                : { ...parsed, useMediaPrompt, enabled };
        }).filter(Boolean);
    }

    _enabledClipItems(meta) {
        return this._clipItems(meta).filter((item) => item.enabled !== false);
    }

    _clipGeneratedVideos(meta) {
        const raw = Array.isArray(meta?.generatedVideos) ? meta.generatedVideos : [];
        return raw.map(normalizeGeneratedVideo).filter(Boolean);
    }

    _firstEnabledGeneratedVideo(meta) {
        return this._clipGeneratedVideos(meta).find((row) => row.enabled) || null;
    }

    _clipUsesGeneratedPreview(meta) {
        return meta?.previewMode === "generated" && !!this._firstEnabledGeneratedVideo(meta);
    }

    _generatedVideosFromJson(clip) {
        const raw = Array.isArray(clip?.generated_videos) ? clip.generated_videos : [];
        return raw.map(normalizeGeneratedVideo).filter(Boolean);
    }

    _previewModeFromJson(clip) {
        return clip?.preview_mode === "generated" ? "generated" : "media";
    }

    _bindExecutionWatch() {
        if (this._execWatchBound || !api?.addEventListener) return;
        this._execWatchBound = true;
        this._onExecuted = (e) => this._onPromptExecuted(e);
        this._onExecSuccess = (e) => this._flushPendingGeneratedVideos(e);
        this._onExecAbort = (e) => this._abortPendingGeneratedJob(e);
        api.addEventListener("executed", this._onExecuted);
        api.addEventListener("execution_success", this._onExecSuccess);
        api.addEventListener("execution_error", this._onExecAbort);
        api.addEventListener("execution_interrupted", this._onExecAbort);
    }

    _unbindExecutionWatch() {
        if (!this._execWatchBound) return;
        this._execWatchBound = false;
        api.removeEventListener?.("executed", this._onExecuted);
        api.removeEventListener?.("execution_success", this._onExecSuccess);
        api.removeEventListener?.("execution_error", this._onExecAbort);
        api.removeEventListener?.("execution_interrupted", this._onExecAbort);
        this._onExecuted = null;
        this._onExecSuccess = null;
        this._onExecAbort = null;
    }

    _promptIdFromQueueResult(result) {
        if (!result || typeof result !== "object") return null;
        const id = result.prompt_id ?? result.promptId;
        const s = String(id || "").trim();
        return s || null;
    }

    _promptIdFromEvent(e) {
        const detail = e?.detail;
        if (!detail || typeof detail !== "object") return null;
        const id = detail.prompt_id ?? detail.promptId;
        const s = String(id || "").trim();
        return s || null;
    }

    _findPendingGeneratedJob(promptId) {
        const jobs = this._pendingGeneratedJobs;
        if (!jobs?.length) return null;
        if (promptId) {
            const hit = jobs.find((j) => j.promptId === promptId);
            if (hit) return hit;
        }
        // FIFO fallback when prompt_id is missing from the frontend/event.
        return jobs.find((j) => !j.promptId) || jobs[0] || null;
    }

    _takePendingGeneratedJob(promptId) {
        const jobs = this._pendingGeneratedJobs;
        if (!jobs?.length) return null;
        let idx = -1;
        if (promptId) idx = jobs.findIndex((j) => j.promptId === promptId);
        if (idx < 0) {
            idx = jobs.findIndex((j) => !j.promptId);
            if (idx < 0) idx = 0;
        }
        return jobs.splice(idx, 1)[0] || null;
    }

    _abortPendingGeneratedJob(e) {
        const promptId = this._promptIdFromEvent(e);
        if (promptId) {
            this._pendingGeneratedJobs = this._pendingGeneratedJobs.filter(
                (j) => j.promptId !== promptId,
            );
            return;
        }
        // Interrupt / error without id: drop the oldest unmatched job only.
        const idx = this._pendingGeneratedJobs.findIndex((j) => !j.promptId);
        if (idx >= 0) this._pendingGeneratedJobs.splice(idx, 1);
    }

    _collectExecutedOutputVideos(detail) {
        const out = [];
        const seen = new Set();
        const add = (file) => {
            const n = normalizeOutputVideoPath(file);
            if (!n || seen.has(n)) return;
            seen.add(n);
            out.push(n);
        };
        const walk = (value, depth = 0) => {
            if (value == null || depth > 6) return;
            if (typeof value === "string") {
                add(value);
                return;
            }
            if (Array.isArray(value)) {
                for (const item of value) walk(item, depth + 1);
                return;
            }
            if (typeof value !== "object") return;
            const type = String(value.type || value.location || "output").toLowerCase();
            const name = value.filename || value.file;
            if (name) {
                if (type === "output" || type === "") {
                    const sub = String(value.subfolder || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
                    add(sub ? `${sub}/${name}` : name);
                }
                return;
            }
            for (const child of Object.values(value)) walk(child, depth + 1);
        };
        walk(detail?.output);
        return out;
    }

    _onPromptExecuted(e) {
        if (this._destroyed || !this._isNodeOnLiveGraph()) return;
        const files = this._collectExecutedOutputVideos(e?.detail);
        if (!files.length) return;
        const job = this._findPendingGeneratedJob(this._promptIdFromEvent(e));
        if (!job) return;
        job.files.push(...files);
    }

    _flushPendingGeneratedVideos(e) {
        if (this._destroyed || !this._isNodeOnLiveGraph()) return;
        const job = this._takePendingGeneratedJob(this._promptIdFromEvent(e));
        if (!job) return;
        let files = [...new Set(job.files || [])];
        if (this._useClipSpecifiedVideoFilename !== false && job.expectedFile) {
            files = [normalizeOutputVideoPath(job.expectedFile)].filter(Boolean);
        }
        if (!files.length) return;
        // Always write into project_json immediately so close/reopen keeps
        // auto-linked videos even if the timeline UI is closed or mid-rebuild.
        this._persistGeneratedVideosToProjectJson(job.clipId || null, files);
        if (!this._timeline || !this._timelineReady) {
            this._deferredGeneratedJobs.push({
                clipId: job.clipId || null,
                files,
            });
            return;
        }
        this._attachGeneratedVideos(job.clipId, files);
    }

    _applyDeferredGeneratedVideos() {
        const jobs = this._deferredGeneratedJobs || [];
        this._deferredGeneratedJobs = [];
        if (!this._timeline || !jobs.length) return;
        for (const job of jobs) {
            if (job?.files?.length) this._attachGeneratedVideos(job.clipId, job.files);
        }
    }

    _attachGeneratedVideos(clipId, files) {
        let clip = this._findClipById(clipId);
        if (!clip) {
            const enabled = [];
            for (const track of this._allImageTracks()) {
                if (track.visible === false) continue;
                const info = this._trackInfo.get(track.id) || {};
                if (info.enabled === false) continue;
                for (const c of track.clips) {
                    const m = this._meta.get(c.id) ?? defaultImageMeta();
                    if (m.disabled || m.visible === false) continue;
                    enabled.push(c);
                }
            }
            if (enabled.length === 1) clip = enabled[0];
        }
        if (!clip) {
            this._deferredGeneratedJobs.push({
                clipId: clipId || null,
                files: [...(files || [])],
            });
            return;
        }
        this._addGeneratedVideosToClip(clip, files);
    }

    _addGeneratedVideosToClip(clip, files) {
        if (!clip || clip.track?.type === "audio") return false;
        const m = this._ensureClipMeta(clip);
        const rows = this._clipGeneratedVideos(m);
        const have = new Set(rows.map((row) => row.file));
        const added = [];
        for (const file of files || []) {
            const n = normalizeOutputVideoPath(file);
            if (!n || have.has(n)) continue;
            have.add(n);
            added.push({ id: genVideoUid(), file: n, enabled: true, muted: false, note: "" });
        }
        if (!added.length) return false;
        this._recordUndo();
        m.generatedVideos = [...added, ...rows];
        this._meta.set(clip.id, m);
        this._decorateClip(clip);
        if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
        if (this._genVideoState?.clipId === clip.id) this._showGenVideoAt(this._genVideoState.index || 0);
        if (this._timeline && this._timelineReady) {
            this._saveToWidgets();
            if (this._historyReady) {
                this._openedProjectJson = JSON.stringify(this._buildProject());
            }
        } else {
            this._persistGeneratedVideosToProjectJson(clip.id, added.map((row) => row.file));
        }
        this._updateAllGeneratedPreviewButton();
        return true;
    }

    _toggleClipGeneratedPreview(clip) {
        if (!clip || clip.track?.type === "audio") return;
        const m = this._ensureClipMeta(clip);
        if (!this._firstEnabledGeneratedVideo(m)) {
            if (m.previewMode === "generated") {
                m.previewMode = "media";
                this._meta.set(clip.id, m);
            }
            this._decorateClip(clip);
            this._syncClipPrimaryAppearance(clip);
            this._scheduleProgramPreview();
            this._updateAllGeneratedPreviewButton();
            return;
        }
        m.previewMode = this._clipUsesGeneratedPreview(m) ? "media" : "generated";
        this._meta.set(clip.id, m);
        this._decorateClip(clip);
        this._syncClipPrimaryAppearance(clip);
        this._scheduleProgramPreview();
        if (this._timeline?._playing) this._startAudioPlayback();
        this._saveToWidgets();
        this._updateAllGeneratedPreviewButton();
    }

    /** Visual clips that have at least one enabled generated video. */
    _clipsWithEnabledGeneratedVideo() {
        const out = [];
        for (const track of this._timeline?.tracks ?? []) {
            if (track.type === "audio") continue;
            for (const clip of track.clips) {
                const meta = this._meta.get(clip.id) ?? defaultImageMeta();
                if (!this._firstEnabledGeneratedVideo(meta)) continue;
                out.push({ clip, meta });
            }
        }
        return out;
    }

    _allGeneratedPreviewActive() {
        const rows = this._clipsWithEnabledGeneratedVideo();
        return rows.length > 0 && rows.every(({ meta }) => this._clipUsesGeneratedPreview(meta));
    }

    /** Toggle every clip that has generated video between gen / asset preview. */
    _toggleAllGeneratedPreview() {
        const rows = this._clipsWithEnabledGeneratedVideo();
        if (!rows.length) return;
        this._recordUndo();
        const next = this._allGeneratedPreviewActive() ? "media" : "generated";
        for (const { clip, meta } of rows) {
            meta.previewMode = next;
            this._meta.set(clip.id, meta);
            this._decorateClip(clip);
            this._syncClipPrimaryAppearance(clip);
        }
        this._updateAllGeneratedPreviewButton();
        this._scheduleProgramPreview();
        if (this._timeline?._playing) this._startAudioPlayback();
        this._saveToWidgets();
    }

    _updateAllGeneratedPreviewButton() {
        const btn = this.allGenPreviewBtn;
        if (!btn) return;
        const rows = this._clipsWithEnabledGeneratedVideo();
        const active = this._allGeneratedPreviewActive();
        btn.disabled = !rows.length;
        btn.classList.toggle("is-active", active);
        btn.innerHTML = `${iconHtml(active ? "camera" : "video", 14)}<span>${
            active ? T("toggle_all_asset_preview_btn") : T("toggle_all_generated_preview_btn")
        }</span>`;
        btn.title = active
            ? T("toggle_all_asset_preview_title")
            : T("toggle_all_generated_preview_title");
    }

    _renderClipGeneratedVideosList(clip, meta, isAudio) {
        const rows = isAudio ? [] : this._clipGeneratedVideos(meta);
        if (this.clipVideosHost) this.clipVideosHost.hidden = !rows.length;
        if (!this.clipVideosList) return;
        this.clipVideosList.replaceChildren();
        for (const [index, row] of rows.entries()) {
            const item = document.createElement("div");
            item.className = "cat-te-clip-video-row";
            if (!row.enabled) item.classList.add("is-disabled");

            const enable = document.createElement("input");
            enable.type = "checkbox";
            enable.className = "cat-te-clip-video-enabled";
            enable.checked = row.enabled !== false;
            enable.title = row.enabled ? T("disable_label") : T("enable_label");
            enable.addEventListener("click", (e) => e.stopPropagation());
            enable.addEventListener("change", () => {
                this._setGeneratedVideoEnabled(clip, row.id, !!enable.checked);
            });

            const thumb = document.createElement("img");
            thumb.className = "cat-te-clip-video-thumb";
            thumb.alt = "";

            const name = document.createElement("button");
            name.type = "button";
            name.className = "cat-te-clip-video-name";
            name.textContent = String(row.file || "").split(/[\\/]/).pop() || T("asset_fallback_name");
            name.title = row.file || "";
            name.addEventListener("click", () => this._openGenVideoModal(clip, index));

            const mute = document.createElement("button");
            mute.type = "button";
            mute.className = "cat-te-clip-video-mute";
            const muted = row.muted === true;
            mute.innerHTML = muted ? ICONS.volumeOff : ICONS.volume;
            mute.classList.toggle("active", muted);
            mute.title = muted ? T("unmute_label") : T("mute_label");
            mute.addEventListener("click", (e) => {
                e.stopPropagation();
                this._setGeneratedVideoMuted(clip, row.id, !muted);
            });

            const del = document.createElement("button");
            del.type = "button";
            del.className = "cat-te-clip-video-del";
            del.title = T("delete_btn");
            del.textContent = "×";
            del.addEventListener("click", (e) => {
                e.stopPropagation();
                this._deleteGeneratedVideo(clip, row.id);
            });

            item.append(enable, thumb, name, mute, del);
            this.clipVideosList.appendChild(item);
            void this._getOutputVideoThumbnail(row.file).then((url) => {
                if (url && thumb.isConnected) thumb.src = url;
            });
        }
    }

    _setGeneratedVideoEnabled(clip, videoId, enabled) {
        if (!clip) return;
        const m = this._ensureClipMeta(clip);
        m.generatedVideos = this._clipGeneratedVideos(m);
        const row = m.generatedVideos.find((item) => item.id === videoId);
        if (!row || row.enabled === enabled) return;
        this._recordUndo();
        row.enabled = enabled;
        if (!this._firstEnabledGeneratedVideo(m) && m.previewMode === "generated") {
            m.previewMode = "media";
        }
        this._meta.set(clip.id, m);
        this._decorateClip(clip);
        this._syncClipPrimaryAppearance(clip);
        this._scheduleProgramPreview();
        if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
        if (this._genVideoState?.clipId === clip.id) this._showGenVideoAt(this._genVideoState.index || 0);
        this._saveToWidgets();
        this._updateAllGeneratedPreviewButton();
    }

    _setGeneratedVideoMuted(clip, videoId, muted) {
        if (!clip) return;
        const m = this._ensureClipMeta(clip);
        m.generatedVideos = this._clipGeneratedVideos(m);
        const row = m.generatedVideos.find((item) => item.id === videoId);
        if (!row || row.muted === muted) return;
        this._recordUndo();
        row.muted = muted === true;
        this._meta.set(clip.id, m);
        this._scheduleProgramPreview();
        if (this._timeline?._playing) this._startAudioPlayback();
        if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
        if (this._genVideoState?.clipId === clip.id) {
            const cur = this._currentGenVideo();
            if (cur?.row?.id === videoId && this.genVideoMutedCb) {
                this.genVideoMutedCb.checked = row.muted === true;
            }
        }
        this._saveToWidgets();
    }

    _deleteGeneratedVideo(clip, videoId) {
        if (!clip) return;
        const m = this._ensureClipMeta(clip);
        const rows = this._clipGeneratedVideos(m);
        const row = rows.find((item) => item.id === videoId);
        if (!row) return;
        const name = row.file.split(/[\\/]/).pop();
        if (!confirm(T("confirm_remove_from_clip", { name }))) return;
        this._recordUndo();
        m.generatedVideos = rows.filter((item) => item.id !== videoId);
        if (!this._firstEnabledGeneratedVideo(m) && m.previewMode === "generated") {
            m.previewMode = "media";
        }
        this._meta.set(clip.id, m);
        this._decorateClip(clip);
        this._syncClipPrimaryAppearance(clip);
        this._scheduleProgramPreview();
        if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
        this._saveToWidgets();
        this._updateAllGeneratedPreviewButton();
        if (this._genVideoState?.clipId === clip.id) {
            if (!m.generatedVideos.length) this._closeGenVideoModal();
            else this._showGenVideoAt(Math.min(this._genVideoState.index || 0, m.generatedVideos.length - 1));
        }
    }

    _openGenVideoModal(clip, index = 0) {
        if (!this.genVideoModal || !clip || clip.track?.type === "audio") return;
        const rows = this._clipGeneratedVideos(this._ensureClipMeta(clip));
        if (!rows.length) return;
        this._genVideoState = { clipId: clip.id, index: 0 };
        this.genVideoModal.hidden = false;
        this._showGenVideoAt(index);
    }

    _closeGenVideoModal() {
        if (this.genVideoStage) {
            for (const media of this.genVideoStage.querySelectorAll("video")) {
                media.pause();
                media.removeAttribute("src");
                media.load();
            }
            this.genVideoStage.replaceChildren();
        }
        this._genVideoState = null;
        if (this.genVideoModal) this.genVideoModal.hidden = true;
    }

    _currentGenVideo() {
        const clip = this._findClipById(this._genVideoState?.clipId);
        if (!clip) return null;
        const rows = this._clipGeneratedVideos(this._ensureClipMeta(clip));
        if (!rows.length) return null;
        const n = rows.length;
        const index = ((Number(this._genVideoState.index) % n) + n) % n;
        return { clip, rows, index, row: rows[index] };
    }

    _showGenVideoAt(index) {
        const clip = this._findClipById(this._genVideoState?.clipId);
        if (!clip || !this.genVideoStage) {
            this._closeGenVideoModal();
            return;
        }
        const rows = this._clipGeneratedVideos(this._ensureClipMeta(clip));
        if (!rows.length) {
            this._closeGenVideoModal();
            return;
        }
        const n = rows.length;
        index = ((index % n) + n) % n;
        this._genVideoState = { clipId: clip.id, index };
        const row = rows[index];
        const name = row.file.split(/[\\/]/).pop() || T("gen_video_label");
        if (this.genVideoTitle) this.genVideoTitle.textContent = n > 1 ? `${index + 1} / ${n}  ${name}` : name;
        if (this.genVideoEnabledCb) this.genVideoEnabledCb.checked = row.enabled !== false;
        if (this.genVideoMutedCb) this.genVideoMutedCb.checked = row.muted === true;
        if (this.genVideoNote) this.genVideoNote.value = row.note || "";
        if (this.genVideoPrevBtn) this.genVideoPrevBtn.disabled = n <= 1;
        if (this.genVideoNextBtn) this.genVideoNextBtn.disabled = n <= 1;
        for (const media of this.genVideoStage.querySelectorAll("video")) {
            media.pause();
            media.removeAttribute("src");
            media.load();
        }
        this.genVideoStage.replaceChildren();
        const video = document.createElement("video");
        video.className = "cat-te-media-preview-content cat-te-media-preview-video";
        video.src = this._outputVideoUrl(row.file);
        video.controls = true;
        video.preload = "metadata";
        this.genVideoStage.appendChild(video);
        this.genVideoModal.hidden = false;
    }

    _stepGenVideoPreview(delta) {
        const cur = this._currentGenVideo();
        if (!cur || cur.rows.length <= 1) return;
        this._showGenVideoAt(cur.index + delta);
    }

    _onGenVideoEnabledChange() {
        const cur = this._currentGenVideo();
        if (!cur || !this.genVideoEnabledCb) return;
        this._setGeneratedVideoEnabled(cur.clip, cur.row.id, !!this.genVideoEnabledCb.checked);
    }

    _onGenVideoMutedChange() {
        const cur = this._currentGenVideo();
        if (!cur || !this.genVideoMutedCb) return;
        this._setGeneratedVideoMuted(cur.clip, cur.row.id, !!this.genVideoMutedCb.checked);
    }

    _onGenVideoNoteChange() {
        const cur = this._currentGenVideo();
        if (!cur || !this.genVideoNote) return;
        const note = String(this.genVideoNote.value || "");
        const m = this._ensureClipMeta(cur.clip);
        m.generatedVideos = this._clipGeneratedVideos(m);
        const row = m.generatedVideos.find((item) => item.id === cur.row.id) || m.generatedVideos[cur.index];
        if (!row || row.note === note) return;
        this._recordUndo();
        row.note = note;
        this._meta.set(cur.clip.id, m);
        this._saveToWidgets();
    }

    _deleteCurrentGenVideo() {
        const cur = this._currentGenVideo();
        if (!cur) return;
        this._deleteGeneratedVideo(cur.clip, cur.row.id);
    }

    async _openOutputVideosPicker(clip) {
        if (!this.outputVideosModal || !clip || clip.track?.type === "audio") return;
        const alreadyOpen = !this.outputVideosModal.hidden;
        this._outputVideosClipId = clip.id;
        this._syncOutputVideosPickerTitle(clip);
        if (!alreadyOpen) {
            this._ensureOutputVideosPanelPos();
            this.outputVideosModal.hidden = false;
            if (this.outputVideosFilter) this.outputVideosFilter.value = "";
            this._outputVideosTimeRange = OUTPUT_VIDEOS_TIME_RANGES[0].id;
            this.outputVideosTimeButtons?.forEach((b) => b.classList.toggle("is-active", b.dataset.range === this._outputVideosTimeRange));
            if (this.outputVideosBody) this.outputVideosBody.textContent = T("loading_ellipsis");
            try {
                const response = await fetch(api.apiURL("/audio_keyframe_timeline/output_videos"));
                const data = await response.json();
                this._outputVideosCache = Array.isArray(data.files) ? data.files : [];
            } catch {
                this._outputVideosCache = [];
            }
        }
        // Drop stale target if the open request finished after a newer selection.
        if (this._outputVideosClipId !== clip.id) return;
        this._renderOutputVideosPicker();
    }

    _retargetOutputVideosPickerFromSelection() {
        if (!this.outputVideosModal || this.outputVideosModal.hidden) return;
        const clip = this._selClip;
        if (!clip || clip.track?.type === "audio") return;
        if (this._outputVideosClipId === clip.id) {
            this._syncOutputVideosPickerTitle(clip);
            return;
        }
        this._outputVideosClipId = clip.id;
        this._syncOutputVideosPickerTitle(clip);
        this._renderOutputVideosPicker();
    }

    _syncOutputVideosPickerTitle(clip = null) {
        if (!this.outputVideosTitle) return;
        const target = clip || this._findClipById(this._outputVideosClipId);
        const name = String(target?.name || "").trim();
        this.outputVideosTitle.textContent = name
            ? `${T("linked_generated_videos_title")} · ${name}`
            : T("linked_generated_videos_title");
    }

    _ensureOutputVideosPanelPos() {
        const panel = this.outputVideosModal;
        if (!panel || panel.style.left || panel.style.top) return;
        const width = Math.min(560, Math.max(280, window.innerWidth - 48));
        const left = Math.max(16, window.innerWidth - width - 24);
        const top = Math.max(16, Math.min(120, window.innerHeight - 200));
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
    }

    _bindOutputVideosPanelDrag() {
        const panel = this.outputVideosModal;
        const handle = this.outputVideosDragHandle;
        if (!panel || !handle || handle._catTeDragBound) return;
        handle._catTeDragBound = true;
        handle.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return;
            if (e.target.closest?.("button, input, select, textarea, a")) return;
            e.preventDefault();
            const rect = panel.getBoundingClientRect();
            const ox = e.clientX - rect.left;
            const oy = e.clientY - rect.top;
            panel.classList.add("is-dragging");
            const onMove = (ev) => {
                const left = Math.min(window.innerWidth - 48, Math.max(8, ev.clientX - ox));
                const top = Math.min(window.innerHeight - 48, Math.max(8, ev.clientY - oy));
                panel.style.left = `${left}px`;
                panel.style.top = `${top}px`;
            };
            const onUp = () => {
                panel.classList.remove("is-dragging");
                window.removeEventListener("mousemove", onMove, true);
                window.removeEventListener("mouseup", onUp, true);
            };
            window.addEventListener("mousemove", onMove, true);
            window.addEventListener("mouseup", onUp, true);
        });
    }

    _closeOutputVideosPicker() {
        this._hideOutputVideoHoverPreview();
        this._outputVideosClipId = null;
        this._outputVideosThumbIo?.disconnect();
        this._outputVideosThumbIo = null;
        if (this.outputVideosModal) this.outputVideosModal.hidden = true;
        this.outputVideosBody?.replaceChildren();
        this._syncOutputVideosPickerTitle(null);
    }

    _cancelOutputVideoHoverHide() {
        if (this._outputVideoHoverHideTimer) {
            clearTimeout(this._outputVideoHoverHideTimer);
            this._outputVideoHoverHideTimer = 0;
        }
    }

    _scheduleOutputVideoHoverHide() {
        this._cancelOutputVideoHoverHide();
        this._outputVideoHoverHideTimer = setTimeout(() => {
            this._outputVideoHoverHideTimer = 0;
            this._hideOutputVideoHoverPreview();
        }, 160);
    }

    _ensureOutputVideoHoverPreview() {
        if (this._outputVideoHoverEl?.isConnected) return this._outputVideoHoverEl;
        this._outputVideoHoverEl = null;
        this._outputVideoHoverVideo = null;
        const host = this._overlay || document.body;
        const el = document.createElement("div");
        el.className = "cat-te-output-video-hover-preview";
        el.hidden = true;
        const video = document.createElement("video");
        video.className = "cat-te-output-video-hover-video";
        video.controls = true;
        video.playsInline = true;
        video.preload = "metadata";
        video.muted = false;
        video.setAttribute("controlsList", "nodownload");
        el.appendChild(video);
        el.addEventListener("mouseenter", () => this._cancelOutputVideoHoverHide());
        el.addEventListener("mouseleave", () => this._scheduleOutputVideoHoverHide());
        // Keep list-row click from firing when interacting with the popup.
        el.addEventListener("mousedown", (e) => e.stopPropagation());
        el.addEventListener("click", (e) => e.stopPropagation());
        host.appendChild(el);
        this._outputVideoHoverEl = el;
        this._outputVideoHoverVideo = video;
        return el;
    }

    _positionOutputVideoHoverPreview(anchorEl) {
        const el = this._outputVideoHoverEl;
        const video = this._outputVideoHoverVideo;
        if (!el || el.hidden || !anchorEl?.isConnected) return;
        const rect = anchorEl.getBoundingClientRect();
        const vh = 200;
        const vw = video?.videoWidth && video?.videoHeight
            ? Math.max(120, Math.round(vh * (video.videoWidth / video.videoHeight)))
            : Math.round(vh * 16 / 9);
        const gap = 28;
        const margin = 8;
        // Keep the whole preview clear of the floating picker (usually docked right).
        const panel = this.outputVideosModal?.getBoundingClientRect?.();
        const preferLeft = (panel && Number.isFinite(panel.left) ? panel.left : rect.left) - vw - gap;
        const preferRight = (panel && Number.isFinite(panel.right) ? panel.right : rect.right) + gap;
        let left;
        if (preferLeft >= margin) left = preferLeft;
        else if (preferRight + vw <= window.innerWidth - margin) left = preferRight;
        else left = margin;
        left = Math.min(left, window.innerWidth - vw - margin);
        left = Math.max(margin, left);
        let top = rect.top + (rect.height - vh) / 2;
        top = Math.min(Math.max(margin, top), window.innerHeight - vh - margin);
        el.style.left = `${Math.round(left)}px`;
        el.style.top = `${Math.round(top)}px`;
        if (video) {
            video.style.height = `${vh}px`;
            video.style.width = `${vw}px`;
        }
    }

    _hideOutputVideoHoverPreview() {
        this._cancelOutputVideoHoverHide();
        this._outputVideoHoverFile = null;
        this._outputVideoHoverAnchor = null;
        const video = this._outputVideoHoverVideo;
        if (video) {
            try { video.pause(); } catch { /* ignore */ }
            video.removeAttribute("src");
            video.load();
        }
        if (this._outputVideoHoverEl) this._outputVideoHoverEl.hidden = true;
    }

    _showOutputVideoHoverPreview(anchorEl, file) {
        if (!anchorEl || !file) return;
        this._cancelOutputVideoHoverHide();
        if (this._outputVideoHoverFile === file && this._outputVideoHoverEl && !this._outputVideoHoverEl.hidden) {
            this._outputVideoHoverAnchor = anchorEl;
            this._positionOutputVideoHoverPreview(anchorEl);
            return;
        }
        const el = this._ensureOutputVideoHoverPreview();
        const video = this._outputVideoHoverVideo;
        const url = this._outputVideoUrl(file);
        if (!url || !video) return;
        this._outputVideoHoverFile = file;
        this._outputVideoHoverAnchor = anchorEl;
        try { video.pause(); } catch { /* ignore */ }
        video.onloadedmetadata = () => {
            if (this._outputVideoHoverFile !== file) return;
            this._positionOutputVideoHoverPreview(this._outputVideoHoverAnchor || anchorEl);
        };
        video.src = url;
        video.muted = false;
        video.volume = 1;
        video.currentTime = 0;
        el.hidden = false;
        this._positionOutputVideoHoverPreview(anchorEl);
        void video.play().catch(() => {
            // Some browsers require a muted start; retry muted then unmute.
            video.muted = true;
            void video.play().then(() => {
                video.muted = false;
            }).catch(() => { /* ignore */ });
        });
    }

    _renderOutputVideosPicker() {
        if (!this.outputVideosBody) return;
        this._hideOutputVideoHoverPreview();
        this._outputVideosThumbIo?.disconnect();
        this._outputVideosThumbIo = null;
        const clip = this._findClipById(this._outputVideosClipId);
        this._syncOutputVideosPickerTitle(clip);
        const have = new Set(
            this._clipGeneratedVideos(clip ? this._ensureClipMeta(clip) : null)
                .map((row) => normalizeOutputVideoPath(row.file) || row.file),
        );
        const q = String(this.outputVideosFilter?.value || "").trim().toLowerCase();
        const range = OUTPUT_VIDEOS_TIME_RANGES.find((r) => r.id === this._outputVideosTimeRange) || OUTPUT_VIDEOS_TIME_RANGES[0];
        const cutoff = range.hours != null ? (Date.now() / 1000 - range.hours * 3600) : null;
        const rows = this._outputVideosCache.filter((row) => {
            if (cutoff != null && Number(row?.mtime) < cutoff) return false;
            return !q || String(row?.file || "").toLowerCase().includes(q);
        });
        this.outputVideosBody.replaceChildren();
        if (!rows.length) {
            const empty = document.createElement("div");
            empty.className = "cat-te-output-videos-empty";
            empty.textContent = this._outputVideosCache.length ? T("no_matching_videos") : T("no_videos_in_output_dir");
            this.outputVideosBody.appendChild(empty);
            return;
        }
        const io = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const thumb = entry.target;
                const file = thumb.dataset?.file;
                io.unobserve(thumb);
                if (!file) continue;
                void this._getOutputVideoThumbnail(file).then((url) => {
                    if (url && thumb.isConnected) thumb.src = url;
                });
            }
        }, { root: this.outputVideosBody, rootMargin: "120px 0px" });
        this._outputVideosThumbIo = io;
        for (const row of rows) {
            const file = row.file;
            const key = normalizeOutputVideoPath(file) || file;
            const item = document.createElement("div");
            item.className = "cat-te-output-video-row";
            const added = have.has(key);
            if (added) item.classList.add("is-added");
            const thumbWrap = document.createElement("span");
            thumbWrap.className = "cat-te-output-video-thumb-wrap";
            const thumb = document.createElement("img");
            thumb.className = "cat-te-output-video-thumb";
            thumb.alt = "";
            thumb.dataset.file = file;
            const playHint = document.createElement("span");
            playHint.className = "cat-te-output-video-thumb-play";
            playHint.innerHTML = iconHtml("play", 12);
            playHint.setAttribute("aria-hidden", "true");
            thumbWrap.append(thumb, playHint);
            thumbWrap.title = T("hover_preview_video_title");
            thumbWrap.addEventListener("mouseenter", () => this._showOutputVideoHoverPreview(thumbWrap, file));
            thumbWrap.addEventListener("mouseleave", () => this._scheduleOutputVideoHoverHide());
            const name = document.createElement("button");
            name.type = "button";
            name.className = "cat-te-output-video-name";
            name.textContent = file;
            name.title = file;
            name.disabled = added;
            const tag = document.createElement("span");
            tag.className = "cat-te-output-video-tag";
            tag.textContent = added ? T("added_tag") : T("add_btn");
            item.append(thumbWrap, name, tag);
            if (!added) {
                const add = () => {
                    const target = this._findClipById(this._outputVideosClipId);
                    if (!target || target.track?.type === "audio") return;
                    if (!this._addGeneratedVideosToClip(target, [file])) return;
                    item.classList.add("is-added");
                    name.disabled = true;
                    tag.textContent = T("added_tag");
                };
                name.addEventListener("click", add);
                tag.addEventListener("click", add);
            }
            this.outputVideosBody.appendChild(item);
            io.observe(thumb);
        }
    }

    _isEmptyGroupClip(meta) {
        return this._clipItems(meta).length === 0;
    }

    _clipPreviewItemIndex(clip, meta) {
        const items = this._clipItems(meta);
        if (!items.length) return 0;
        const raw = Number(this._clipPreviewIndex.get(clip.id));
        if (!Number.isFinite(raw)) return 0;
        return Math.max(0, Math.min(items.length - 1, raw));
    }

    _setClipPreviewItemIndex(clip, index) {
        const items = this._clipItems(this._meta.get(clip.id));
        if (!items.length) {
            this._clipPreviewIndex.delete(clip.id);
            return 0;
        }
        const next = ((index % items.length) + items.length) % items.length;
        this._clipPreviewIndex.set(clip.id, next);
        return next;
    }

    _normalizeVisualMeta(clip, meta, { seedFromClip = true } = {}) {
        if (!clip || !meta || clip.track?.type === "audio") return meta;
        const oldKind = meta.mediaKind;
        let items = this._clipItems(meta);
        if (!items.length && seedFromClip) {
            items = clipItemsFromLegacy(clip.src, meta.endImage, oldKind);
        }
        meta.items = items.map((item) => {
            const media = (item.id && this._findMediaById(item.id))
                || this._ensureMedia(item.kind, item.file);
            const useMediaPrompt = item.useMediaPrompt !== false;
            const enabled = item.enabled !== false;
            return media
                ? { id: media.id, kind: media.kind, file: media.file, useMediaPrompt, enabled }
                : { ...item, useMediaPrompt, enabled };
        });
        meta.mediaIds = meta.items.map((item) => item.id).filter(Boolean);
        const first = items.find((it) => it.enabled !== false) || items[0] || null;
        const images = items.filter((it) => it.kind === "image");
        clip.src = first?.file || "";
        meta.endImage = images.length >= 2 ? images[images.length - 1].file : null;
        meta.mediaKind = "clip";
        meta.clipRole = meta.clipRole === "other"
            ? "other"
            : this._knownClipRole(meta.clipRole);
        if (meta.clipRole !== "other") meta.clipRoleCustom = "";
        else meta.clipRoleCustom = String(meta.clipRoleCustom || "").trim();
        meta.agent = meta.agent === "other" ? "other" : this._knownClipAgent(meta.agent);
        if (meta.agent !== "other") meta.agentCustom = "";
        else meta.agentCustom = String(meta.agentCustom || "").trim();
        if (!items.length) {
            clip.thumbnail = null;
            clip.hasAudio = false;
            clip.waveformPeaks = null;
            clip._audioBuffer = null;
        }
        return meta;
    }

    _syncClipPrimaryAppearance(clip, { refreshVideo = true } = {}) {
        const m = this._ensureClipMeta(clip);
        this._normalizeVisualMeta(clip, m);
        const items = this._clipItems(m);
        const first = items.find((it) => it.enabled !== false) || items[0];
        const gen = this._clipUsesGeneratedPreview(m) ? this._firstEnabledGeneratedVideo(m) : null;
        if (isDefaultClipName(clip.name)) {
            clip.name = first?.file?.split(/[\\/]/).pop()
                || gen?.file?.split(/[\\/]/).pop()
                || DEFAULT_CLIP_NAME;
        }
        if (gen) {
            if (refreshVideo) {
                const url = this._outputVideoUrl(gen.file);
                void this._grabVideoThumbnail(url).then((thumb) => {
                    clip.thumbnail = thumb;
                    this._refreshClipAppearance(clip);
                    if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
                }).catch(() => this._refreshClipAppearance(clip));
            }
            if (!first) {
                clip.hasAudio = false;
                clip.waveformPeaks = null;
                clip._audioBuffer = null;
            }
            this._refreshClipAppearance(clip);
            if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
            return;
        }
        if (!first) {
            clip.thumbnail = null;
            clip.hasAudio = false;
            clip.waveformPeaks = null;
            clip._audioBuffer = null;
            this._refreshClipAppearance(clip);
            return;
        }
        if (first.kind === "video") {
            if (refreshVideo) {
                const url = this._videoUrl(first.file);
                void this._grabVideoThumbnail(url).then((thumb) => {
                    clip.thumbnail = thumb;
                    this._refreshClipAppearance(clip);
                    if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
                }).catch(() => this._refreshClipAppearance(clip));
                void this._fetchPeaks(url).then((r) => {
                    clip.waveformPeaks = r.peaks[0];
                    clip.hasAudio = true;
                    clip._audioBuffer = r.buffer;
                    this._refreshClipAppearance(clip);
                }).catch(() => {
                    clip.hasAudio = false;
                    this._refreshClipAppearance(clip);
                });
            }
        } else {
            clip.thumbnail = this._imgUrl(first.file);
            clip.hasAudio = false;
            clip.waveformPeaks = null;
            clip._audioBuffer = null;
        }
        this._refreshClipAppearance(clip);
        if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
    }

    _insertItemIntoClip(clip, file, kind) {
        if (!clip || !file || clip.track?.type === "audio") return;
        this._recordUndo();
        const m = this._ensureClipMeta(clip);
        this._normalizeVisualMeta(clip, m);
        const media = this._ensureMedia(kind === "video" ? "video" : "image", file);
        const item = media
            ? { id: media.id, kind: media.kind, file: media.file, useMediaPrompt: true, enabled: true }
            : normalizeClipItem({ kind, file });
        if (!item) return;
        m.items.push(item);
        this._meta.set(clip.id, m);
        this._setClipPreviewItemIndex(clip, m.items.length - 1);
        this._syncClipPrimaryAppearance(clip);
        this._renderMediaGrid();
        this._saveToWidgets();
        if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
        if (this._clipItemsModalClipId === clip.id) this._renderClipItemsModal(clip);
    }

    _applyClipItemOrder(clip, orderedItems) {
        if (!clip || !Array.isArray(orderedItems)) return false;
        const m = this._ensureClipMeta(clip);
        this._normalizeVisualMeta(clip, m, { seedFromClip: false });
        const itemKey = (item) => item?.id || `${item?.kind}:${item?.file}`;
        const same = orderedItems.length === m.items.length
            && orderedItems.every((item, i) => itemKey(item) === itemKey(m.items[i]));
        if (same) return false;
        this._recordUndo();
        m.items = orderedItems.map((item) => ({
            id: item.id,
            kind: item.kind,
            file: item.file,
            useMediaPrompt: item.useMediaPrompt !== false,
            enabled: item.enabled !== false,
        }));
        m.mediaIds = m.items.map((item) => item.id).filter(Boolean);
        this._normalizeVisualMeta(clip, m, { seedFromClip: false });
        this._meta.set(clip.id, m);
        this._syncClipPrimaryAppearance(clip);
        this._scheduleProgramPreview();
        this._saveToWidgets();
        return true;
    }

    _removeClipItem(clip, index) {
        if (!clip || clip.track?.type === "audio") return;
        const m = this._ensureClipMeta(clip);
        this._normalizeVisualMeta(clip, m, { seedFromClip: false });
        const items = this._clipItems(m);
        const current = items[index];
        if (!current) return;
        const name = current.file.split(/[\\/]/).pop() || current.file;
        if (!confirm(T("confirm_remove_from_clip", { name }))) return;
        this._recordUndo();
        m.items = items.filter((_, i) => i !== index).map((item) => ({
            id: item.id,
            kind: item.kind,
            file: item.file,
            useMediaPrompt: item.useMediaPrompt !== false,
            enabled: item.enabled !== false,
        }));
        m.mediaIds = m.items.map((item) => item.id).filter(Boolean);
        this._normalizeVisualMeta(clip, m, { seedFromClip: false });
        this._meta.set(clip.id, m);
        this._setClipPreviewItemIndex(clip, Math.min(index, Math.max(0, m.items.length - 1)));
        this._syncClipPrimaryAppearance(clip);
        this._scheduleProgramPreview();
        this._saveToWidgets();
        if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
        if (this._clipItemsModalClipId === clip.id) this._renderClipItemsModal(clip);
    }

    _removeCurrentClipItem() {
        const clip = this._selClip;
        if (!clip || clip.track?.type === "audio") return;
        const m = this._ensureClipMeta(clip);
        this._normalizeVisualMeta(clip, m, { seedFromClip: false });
        this._removeClipItem(clip, this._clipPreviewItemIndex(clip, m));
    }

    _activeMediaFilterCount() {
        let n = 0;
        if (this._mediaStarFilter && this._mediaStarFilter !== "all") n += 1;
        n += this._mediaKindFilters.size;
        n += this._mediaTypeFilters.size;
        n += this._mediaTagFilters.size;
        return n;
    }

    _clearMediaFilters() {
        this._mediaStarFilter = "all";
        this._mediaKindFilters.clear();
        this._mediaTypeFilters.clear();
        this._mediaTagFilters.clear();
        this._renderMediaGrid();
    }

    _closeMediaFilterPanel() {
        if (!this._mediaFilterOpen) return false;
        this._mediaFilterOpen = false;
        this._overlay?.querySelector(".cat-te-media-filter-panel")?.remove();
        this._overlay?.querySelector(".cat-te-media-filter-btn")?.classList.remove("active");
        return true;
    }

    _matchesKindFilter(kind) {
        const sel = this._mediaKindFilters;
        if (!sel.size) return true;
        if (sel.has(kind)) return true;
        return sel.has("other") && !MEDIA_KIND_CORE.has(kind);
    }

    _libraryMediaEntries() {
        const out = [];
        for (const file of this._imgFiles) out.push({ file, kind: "image" });
        for (const file of this._videoFiles) out.push({ file, kind: "video" });
        for (const file of this._audioFiles) out.push({ file, kind: "audio" });
        return out;
    }

    _visibleMediaEntries() {
        const out = [];
        const groups = [
            ["image", this._imgFiles],
            ["video", this._videoFiles],
            ["audio", this._audioFiles],
        ];
        for (const [kind, files] of groups) {
            for (const file of this._filterMediaFiles(files, kind)) out.push({ file, kind });
        }
        return out;
    }

    _collectMediaFilterOptions() {
        const types = new Set();
        const tags = new Set();
        for (const { file, kind } of this._libraryMediaEntries()) {
            if (!this._matchesKindFilter(kind)) continue;
            const meta = this._getMediaMeta(kind, file);
            if (meta.mediaType) types.add(meta.mediaType);
            for (const tag of meta.tags || []) tags.add(tag);
        }
        return { types: [...types].sort(), tags: [...tags].sort() };
    }

    _filterMediaFiles(files, kind) {
        if (!this._matchesKindFilter(kind)) return [];
        const star = this._mediaStarFilter && this._mediaStarFilter !== "all"
            ? parseInt(this._mediaStarFilter, 10)
            : null;
        const types = this._mediaTypeFilters;
        const tags = this._mediaTagFilters;
        if (!(Number.isFinite(star) || types.size || tags.size)) return files;
        return files.filter((file) => {
            if (this._mediaStatus.get(`${kind}:${file}`)?.location === "missing") return true;
            const meta = this._getMediaMeta(kind, file);
            if (Number.isFinite(star) && meta.stars !== star) return false;
            if (types.size) {
                const t = meta.mediaType || "";
                const known = MEDIA_ASSET_TYPES.some((x) => x.id === t);
                const matchKnown = types.has(t);
                const matchOther = types.has("other") && (t === "other" || (t && !known));
                if (!matchKnown && !matchOther) return false;
            }
            if (tags.size) {
                const have = new Set(meta.tags || []);
                for (const tag of tags) {
                    if (!have.has(tag)) return false;
                }
            }
            return true;
        });
    }

    _mediaBatchKey(kind, file) {
        return `${kind}:${file}`;
    }

    _applyMediaGridView() {
        this.mediaGrid?.classList.toggle("cat-te-media-grid-list", !!this._mediaListView);
        this.mediaPanel?.classList.toggle("cat-te-media-batch", !!this._mediaBatchMode);
        this._ensureMediaListStyle();
        this._relayoutMediaListThumbs();
        this._observeMediaListResize();
    }

    /** Inject high-priority list-view rules (avoids stale/cached extension CSS). */
    _ensureMediaListStyle() {
        let style = document.getElementById("cat-te-media-list-style");
        if (!style) {
            style = document.createElement("style");
            style.id = "cat-te-media-list-style";
            document.head.appendChild(style);
        }
        style.textContent = `
.cat-te-media-grid.cat-te-media-grid-list{
  display:flex !important;
  flex-direction:column !important;
  grid-template-columns:none !important;
  grid-auto-rows:auto !important;
  gap:6px !important;
  align-content:stretch !important;
}
.cat-te-media-grid.cat-te-media-grid-list>.cat-te-media-item{
  width:100% !important;
  height:auto !important;
  min-height:0 !important;
  max-height:none !important;
  flex:0 0 auto !important;
  align-self:stretch !important;
}
.cat-te-media-grid.cat-te-media-grid-list>.cat-te-media-item>img{
  width:100% !important;
  height:auto !important;
  min-height:0 !important;
  max-height:none !important;
  object-fit:contain !important;
  display:block !important;
}
.cat-te-media-grid.cat-te-media-grid-list>.cat-te-media-item>.cat-te-video-icon,
.cat-te-media-grid.cat-te-media-grid-list>.cat-te-media-item>.cat-te-audio-icon,
.cat-te-media-grid.cat-te-media-grid-list>.cat-te-media-item>.cat-te-missing-icon{
  width:100% !important;
  min-height:120px !important;
  aspect-ratio:16/9 !important;
}
`;
    }

    /** Force list-view thumbs to keep intrinsic aspect ratio via explicit pixel height. */
    _bindMediaThumbAspect(img) {
        if (!img) return;
        const apply = () => {
            if (!img.isConnected) return;
            const item = img.parentElement;
            if (!this._mediaListView) {
                img.style.removeProperty("width");
                img.style.removeProperty("height");
                img.style.removeProperty("max-height");
                img.style.removeProperty("min-height");
                img.style.removeProperty("object-fit");
                img.style.removeProperty("aspect-ratio");
                item?.style.removeProperty("height");
                item?.style.removeProperty("min-height");
                return;
            }
            const nw = img.naturalWidth || 0;
            const nh = img.naturalHeight || 0;
            const cw = item?.clientWidth || img.clientWidth || 0;
            if (nw <= 0 || nh <= 0 || cw <= 0) return;
            const ph = Math.max(1, Math.round((cw * nh) / nw));
            img.style.setProperty("width", "100%", "important");
            img.style.setProperty("height", `${ph}px`, "important");
            img.style.setProperty("max-height", "none", "important");
            img.style.setProperty("min-height", "0", "important");
            img.style.setProperty("object-fit", "fill", "important");
            item?.style.setProperty("height", "auto", "important");
            item?.style.setProperty("min-height", "0", "important");
        };
        img._catTeAspectApply = apply;
        if (img.complete && img.naturalWidth > 0) apply();
        else img.addEventListener("load", apply);
    }

    _relayoutMediaListThumbs() {
        if (!this.mediaGrid) return;
        for (const img of this.mediaGrid.querySelectorAll(".cat-te-media-item > img")) {
            if (typeof img._catTeAspectApply === "function") img._catTeAspectApply();
            else this._bindMediaThumbAspect(img);
        }
    }

    _observeMediaListResize() {
        if (!this.mediaGrid) return;
        if (this._mediaListResizeObserver) return;
        this._mediaListResizeObserver = new ResizeObserver(() => {
            if (!this._mediaListView) return;
            this._relayoutMediaListThumbs();
        });
        this._mediaListResizeObserver.observe(this.mediaGrid);
    }

    _toggleMediaBatchMode() {
        this._mediaBatchMode = !this._mediaBatchMode;
        if (!this._mediaBatchMode) this._mediaBatchSelected.clear();
        this._renderMediaGrid();
    }

    _toggleMediaListView() {
        this._mediaListView = !this._mediaListView;
        try {
            localStorage.setItem(STORAGE_MEDIA_LIST_VIEW, this._mediaListView ? "1" : "0");
        } catch { /* ignore */ }
        this._applyMediaGridView();
        this._renderMediaStarFilter();
        requestAnimationFrame(() => {
            this._relayoutMediaListThumbs();
            requestAnimationFrame(() => this._relayoutMediaListThumbs());
        });
    }

    _toggleMediaBatchSelect(kind, file, itemEl = null) {
        const key = this._mediaBatchKey(kind, file);
        if (this._mediaBatchSelected.has(key)) this._mediaBatchSelected.delete(key);
        else this._mediaBatchSelected.add(key);
        itemEl?.classList.toggle("cat-te-media-selected", this._mediaBatchSelected.has(key));
        this._renderMediaStarFilter();
    }

    _renderMediaStarFilter() {
        if (!this.mediaStarFilterHost) return;
        this.mediaStarFilterHost.replaceChildren();

        const refreshBtn = document.createElement("button");
        refreshBtn.type = "button";
        refreshBtn.className = "cat-te-media-tool-btn cat-te-media-refresh";
        refreshBtn.innerHTML = iconHtml("refresh", 12);
        refreshBtn.title = T("refresh_media_list_title");
        if (this._mediaReloading) refreshBtn.classList.add("spinning");
        refreshBtn.addEventListener("click", () => this._refreshMediaLists());
        this.mediaStarFilterHost.appendChild(refreshBtn);

        const batchBtn = document.createElement("button");
        batchBtn.type = "button";
        batchBtn.className = "cat-te-media-tool-btn";
        batchBtn.classList.toggle("active", this._mediaBatchMode);
        batchBtn.innerHTML = iconHtml("check", 12);
        batchBtn.title = this._mediaBatchMode ? T("exit_batch_select_title") : T("batch_select_delete_title");
        batchBtn.addEventListener("click", () => this._toggleMediaBatchMode());
        this.mediaStarFilterHost.appendChild(batchBtn);

        if (this._mediaBatchMode) {
            const selectedCount = this._mediaBatchSelected.size;
            const delBtn = document.createElement("button");
            delBtn.type = "button";
            delBtn.className = "cat-te-media-tool-btn danger";
            delBtn.innerHTML = iconHtml("trash", 12);
            delBtn.title = selectedCount ? T("delete_selected_n_assets_title", { n: selectedCount }) : T("select_asset_first_title");
            delBtn.disabled = selectedCount === 0;
            if (selectedCount) {
                const badge = document.createElement("span");
                badge.className = "cat-te-media-tool-badge";
                badge.textContent = String(selectedCount);
                delBtn.appendChild(badge);
            }
            delBtn.addEventListener("click", () => void this._deleteSelectedLibraryMedia());
            this.mediaStarFilterHost.appendChild(delBtn);
        }

        const viewBtn = document.createElement("button");
        viewBtn.type = "button";
        viewBtn.className = "cat-te-media-tool-btn";
        viewBtn.classList.toggle("active", this._mediaListView);
        viewBtn.innerHTML = iconHtml(this._mediaListView ? "grid" : "list", 12);
        viewBtn.title = this._mediaListView ? T("switch_to_grid_view_title") : T("switch_to_list_view_title");
        viewBtn.addEventListener("click", () => this._toggleMediaListView());
        this.mediaStarFilterHost.appendChild(viewBtn);

        const filterWrap = document.createElement("div");
        filterWrap.className = "cat-te-media-filter-wrap";
        const filterBtn = document.createElement("button");
        filterBtn.type = "button";
        filterBtn.className = "cat-te-media-tool-btn cat-te-media-filter-btn";
        filterBtn.innerHTML = iconHtml("filter", 12);
        filterBtn.title = T("filter_assets_title");
        filterBtn.classList.toggle("active", this._mediaFilterOpen || this._activeMediaFilterCount() > 0);
        const count = this._activeMediaFilterCount();
        if (count) {
            const badge = document.createElement("span");
            badge.className = "cat-te-media-tool-badge";
            badge.textContent = String(count);
            filterBtn.appendChild(badge);
        }
        filterBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (this._mediaFilterOpen) this._closeMediaFilterPanel();
            else this._openMediaFilterPanel(filterWrap);
        });
        filterWrap.appendChild(filterBtn);
        this.mediaStarFilterHost.appendChild(filterWrap);

        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "cat-te-btn cat-te-media-add-btn";
        addBtn.textContent = T("add_material_title");
        addBtn.title = T("add_material_multi_select_title");
        addBtn.addEventListener("click", () => this._chooseMaterialFile());
        this.mediaStarFilterHost.appendChild(addBtn);

        if (this._mediaFilterOpen) this._openMediaFilterPanel(filterWrap);
    }

    _openMediaFilterPanel(host) {
        this._mediaFilterOpen = true;
        host.querySelector(".cat-te-media-filter-panel")?.remove();
        host.querySelector(".cat-te-media-filter-btn")?.classList.add("active");
        const panel = document.createElement("div");
        panel.className = "cat-te-media-filter-panel";
        panel.addEventListener("click", (e) => e.stopPropagation());

        const kindRow = document.createElement("div");
        kindRow.className = "cat-te-media-filter-section";
        const kindTitle = document.createElement("div");
        kindTitle.className = "cat-te-media-filter-label";
        kindTitle.textContent = T("category_label");
        const kindGroup = document.createElement("div");
        kindGroup.className = "cat-te-media-filter-chips";
        for (const opt of MEDIA_KIND_FILTERS) {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "cat-te-media-filter-chip";
            chip.textContent = opt.label;
            chip.classList.toggle("active", this._mediaKindFilters.has(opt.id));
            chip.addEventListener("click", () => {
                if (this._mediaKindFilters.has(opt.id)) this._mediaKindFilters.delete(opt.id);
                else this._mediaKindFilters.add(opt.id);
                this._renderMediaGrid();
            });
            kindGroup.appendChild(chip);
        }
        kindRow.append(kindTitle, kindGroup);
        panel.appendChild(kindRow);

        const starRow = document.createElement("div");
        starRow.className = "cat-te-media-filter-section";
        const starTitle = document.createElement("div");
        starTitle.className = "cat-te-media-filter-label";
        starTitle.textContent = T("star_rating_label");
        const starGroup = document.createElement("div");
        starGroup.className = "cat-te-media-star-filter-group";
        const activeStars = this._mediaStarFilter === "all" ? 0 : parseInt(this._mediaStarFilter, 10) || 0;
        for (let i = 1; i <= 5; i++) {
            const starBtn = document.createElement("button");
            starBtn.type = "button";
            starBtn.className = "cat-te-media-star-filter-star";
            starBtn.innerHTML = iconHtml("star", 12);
            starBtn.title = T("filter_n_star_assets_title", { n: i });
            if (i <= activeStars) starBtn.classList.add("on");
            if (String(i) === this._mediaStarFilter) starBtn.classList.add("active");
            starBtn.addEventListener("click", () => {
                this._mediaStarFilter = String(i) === this._mediaStarFilter ? "all" : String(i);
                this._renderMediaGrid();
            });
            starGroup.appendChild(starBtn);
        }
        starRow.append(starTitle, starGroup);
        panel.appendChild(starRow);

        const typeRow = document.createElement("div");
        typeRow.className = "cat-te-media-filter-section";
        const typeTitle = document.createElement("div");
        typeTitle.className = "cat-te-media-filter-label";
        typeTitle.textContent = T("type_label");
        const typeGroup = document.createElement("div");
        typeGroup.className = "cat-te-media-filter-chips";
        const extra = this._collectMediaFilterOptions();
        const typeOptions = [
            ...MEDIA_ASSET_TYPES,
            ...extra.types
                .filter((id) => !MEDIA_ASSET_TYPES.some((t) => t.id === id))
                .map((id) => ({ id, label: id })),
        ];
        for (const opt of typeOptions) {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "cat-te-media-filter-chip";
            chip.textContent = opt.label;
            chip.classList.toggle("active", this._mediaTypeFilters.has(opt.id));
            chip.addEventListener("click", () => {
                if (this._mediaTypeFilters.has(opt.id)) this._mediaTypeFilters.delete(opt.id);
                else this._mediaTypeFilters.add(opt.id);
                this._renderMediaGrid();
            });
            typeGroup.appendChild(chip);
        }
        if (!typeOptions.length) {
            const empty = document.createElement("div");
            empty.className = "cat-te-media-filter-empty";
            empty.textContent = T("no_types_yet");
            typeGroup.appendChild(empty);
        }
        typeRow.append(typeTitle, typeGroup);
        panel.appendChild(typeRow);

        const tagRow = document.createElement("div");
        tagRow.className = "cat-te-media-filter-section";
        const tagTitle = document.createElement("div");
        tagTitle.className = "cat-te-media-filter-label";
        tagTitle.textContent = T("tags_label");
        const tagGroup = document.createElement("div");
        tagGroup.className = "cat-te-media-filter-chips";
        if (!extra.tags.length) {
            const empty = document.createElement("div");
            empty.className = "cat-te-media-filter-empty";
            empty.textContent = T("no_tags_yet");
            tagGroup.appendChild(empty);
        } else {
            for (const tag of extra.tags) {
                const chip = document.createElement("button");
                chip.type = "button";
                chip.className = "cat-te-media-filter-chip";
                chip.textContent = tag;
                chip.classList.toggle("active", this._mediaTagFilters.has(tag));
                chip.addEventListener("click", () => {
                    if (this._mediaTagFilters.has(tag)) this._mediaTagFilters.delete(tag);
                    else this._mediaTagFilters.add(tag);
                    this._renderMediaGrid();
                });
                tagGroup.appendChild(chip);
            }
        }
        tagRow.append(tagTitle, tagGroup);
        panel.appendChild(tagRow);

        const clearBtn = document.createElement("button");
        clearBtn.type = "button";
        clearBtn.className = "cat-te-btn cat-te-media-filter-clear";
        clearBtn.textContent = T("clear_all_filters_btn");
        clearBtn.disabled = this._activeMediaFilterCount() === 0;
        clearBtn.addEventListener("click", () => this._clearMediaFilters());
        panel.appendChild(clearBtn);

        host.appendChild(panel);
    }

    _renderMediaGrid() {
        this._renderMediaStarFilter();
        this.mediaGrid.replaceChildren();
        this._applyMediaGridView();
        const library = this._libraryMediaEntries();
        if (!library.length) {
            const msg = document.createElement("div");
            msg.className = "cat-te-media-empty";
            msg.textContent = T("no_assets_drag_or_add_hint");
            this.mediaGrid.appendChild(msg);
            return;
        }
        const files = this._visibleMediaEntries();
        if (!files.length) {
            const msg = document.createElement("div");
            msg.className = "cat-te-media-empty";
            msg.textContent = T("no_assets_match_filter");
            this.mediaGrid.appendChild(msg);
            return;
        }
        for (const { file, kind } of files) {
            this.mediaGrid.appendChild(this._makeMediaItem(file, kind));
        }
        requestAnimationFrame(() => this._relayoutMediaListThumbs());
    }

    /** Whether `file` is already used by a clip on the timeline. */
    _isMediaOnTimeline(file, kind) {
        if (!this._timeline) return false;
        const media = this._findMedia(kind, file);
        const mediaId = media?.id;
        if (kind === "audio") {
            return this._allAudioTracks().some((t) => t.clips.some((c) => {
                const meta = this._meta.get(c.id);
                return (mediaId && meta?.mediaId === mediaId) || c.src === file;
            }));
        }
        return this._allImageTracks().some((t) => t.clips.some((c) => {
            const meta = this._meta.get(c.id);
            return this._clipItems(meta).some((item) => (mediaId && item.id === mediaId) || item.file === file);
        }));
    }

    _makeMediaItem(file, kind) {
        const item = document.createElement("div");
        const status = this._mediaStatus.get(`${kind}:${file}`) || { location: "input" };
        const batchKey = this._mediaBatchKey(kind, file);
        item.className = `cat-te-media-item cat-te-media-${kind}`;
        item.dataset.mediaKey = batchKey;
        item.classList.toggle("cat-te-media-missing", status.location === "missing");
        item.classList.toggle("cat-te-media-selected", this._mediaBatchSelected.has(batchKey));
        item.title = this._mediaBatchMode
            ? T("media_item_title_batch", { file })
            : T("media_item_title_normal", { file });
        // Native HTML5 DnD is unreliable in Tauri/WebView2 (no drag ghost /
        // drop disabled). Use pointer-driven drag instead; keep the attribute
        // off so the webview doesn't swallow the gesture.
        item.draggable = false;

        const check = document.createElement("div");
        check.className = "cat-te-media-check";
        check.innerHTML = iconHtml("check", 12);
        item.appendChild(check);

        if (this._isMediaOnTimeline(file, kind)) {
            const addedTag = document.createElement("div");
            addedTag.className = "cat-te-media-added-tag";
            addedTag.textContent = T("added_tag");
            item.appendChild(addedTag);
        }
        if (status.location === "missing") {
            const icon = document.createElement("div");
            icon.className = "cat-te-missing-icon";
            icon.textContent = "!";
            item.appendChild(icon);
        } else if (kind === "image") {
            const img = document.createElement("img");
            img.src = this._imgUrl(file);
            img.alt = "";
            img.draggable = false;
            item.appendChild(img);
            this._bindMediaThumbAspect(img);
        } else if (kind === "video") {
            const icon = document.createElement("div");
            icon.className = "cat-te-video-icon";
            icon.textContent = "▶";
            item.appendChild(icon);
            this._getVideoThumbnail(file).then(dataUrl => {
                if (!dataUrl || !item.isConnected) return;
                const img = document.createElement("img");
                img.src = dataUrl;
                img.alt = "";
                img.draggable = false;
                icon.replaceWith(img);
                this._bindMediaThumbAspect(img);
            }).catch(() => { /* keep the icon placeholder */ });
        } else {
            const icon = document.createElement("div");
            icon.className = "cat-te-audio-icon";
            icon.textContent = "♫";
            item.appendChild(icon);
        }
        const nm = document.createElement("div");
        nm.className = "cat-te-media-name";
        nm.textContent = file.split(/[\\/]/).pop();
        const dragHint = document.createElement("div");
        dragHint.className = "cat-te-media-drag-hint";
        dragHint.textContent = "⋮⋮";
        item.append(nm, dragHint);
        item.addEventListener("click", () => {
            if (item._catTeSuppressClick) {
                item._catTeSuppressClick = false;
                return;
            }
            if (this._mediaBatchMode) {
                this._toggleMediaBatchSelect(kind, file, item);
                return;
            }
            if (status.location === "missing") alert(T("asset_missing_relink_hint"));
            else this._openMediaPreview(file, kind);
        });
        item.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this._mediaBatchMode) return;
            const items = [];
            if (status.location !== "missing") items.push({
                label: T("insert_to_timeline_ctx"),
                fn: () => {
                    if (kind === "audio") void this._addAudioAtPlayhead(file);
                    else if (kind === "video") void this._addVideoAtPlayhead(file);
                    else void this._addMediaAtPlayhead(file);
                },
            });
            if (status.location !== "missing") items.push({
                label: T("replace_material_label"),
                fn: () => this._chooseMaterialFile({ file, kind }),
            });
            if (status.location === "missing") items.push({
                label: T("relink_file_menu"),
                fn: () => this._chooseMaterialFile({ file, kind }),
            });
            items.push({
                label: T("delete_btn"),
                fn: () => void this._deleteLibraryMedia(file, kind),
                danger: true,
            });
            this._buildCtxMenu(items, e.clientX, e.clientY);
        });
        if (status.location !== "missing" && !this._mediaBatchMode) {
            this._bindMediaPointerDrag(item, kind, file);
        }
        return item;
    }

    /**
     * Pointer-based media drag (Tauri/WebView2-safe). Native HTML5 DnD often
     * never starts a drag gesture inside the launcher webview.
     */
    _bindMediaPointerDrag(item, kind, file) {
        const THRESHOLD = 6;
        const GHOST_W = 88;
        const GHOST_H = 64;
        item.addEventListener("pointerdown", (e) => {
            if (e.button !== 0) return;
            if (e.target.closest("button")) return;

            const startX = e.clientX;
            const startY = e.clientY;
            // Keep the grab point under the cursor (map item → ghost size).
            const rect = item.getBoundingClientRect();
            const grabX = Math.min(
                GHOST_W - 1,
                Math.max(0, (e.clientX - rect.left) * (GHOST_W / Math.max(1, rect.width))),
            );
            const grabY = Math.min(
                GHOST_H - 1,
                Math.max(0, (e.clientY - rect.top) * (GHOST_H / Math.max(1, rect.height))),
            );
            let started = false;
            let ghost = null;
            const pointerId = e.pointerId;
            try { item.setPointerCapture(pointerId); } catch { /* ignore */ }

            const placeGhost = (clientX, clientY) => {
                if (!ghost) return;
                ghost.style.transform = `translate(${clientX - grabX}px, ${clientY - grabY}px)`;
            };

            const onMove = (ev) => {
                if (ev.pointerId !== pointerId) return;
                const dx = ev.clientX - startX;
                const dy = ev.clientY - startY;
                if (!started) {
                    if (dx * dx + dy * dy < THRESHOLD * THRESHOLD) return;
                    started = true;
                    item._catTeSuppressClick = true;
                    this._dndMedia = { kind, file };
                    item.classList.add("dragging");
                    ghost = this._makeMediaDragGhost(item, file);
                    document.body.appendChild(ghost);
                    document.body.classList.add("cat-te-media-dnd");
                    placeGhost(ev.clientX, ev.clientY);
                }
                ev.preventDefault();
                placeGhost(ev.clientX, ev.clientY);
                this._updateMediaDragHover(ev.clientX, ev.clientY);
            };

            const onUp = (ev) => {
                if (ev.pointerId !== pointerId) return;
                window.removeEventListener("pointermove", onMove, true);
                window.removeEventListener("pointerup", onUp, true);
                window.removeEventListener("pointercancel", onUp, true);
                if (this._abortMediaDrag === abortDrag) this._abortMediaDrag = null;
                try { item.releasePointerCapture(pointerId); } catch { /* ignore */ }

                const media = started ? this._dndMedia : null;
                const dropX = ev.clientX;
                const dropY = ev.clientY;
                this._clearMediaDragVisuals(item, ghost);
                this._dndMedia = null;
                if (!started || !media?.file) return;
                this._commitMediaDrop(media, dropX, dropY);
            };

            const abortDrag = () => {
                window.removeEventListener("pointermove", onMove, true);
                window.removeEventListener("pointerup", onUp, true);
                window.removeEventListener("pointercancel", onUp, true);
                try { item.releasePointerCapture(pointerId); } catch { /* ignore */ }
                this._clearMediaDragVisuals(item, ghost);
                this._dndMedia = null;
                this._dndHoverClip = null;
            };
            this._abortMediaDrag = abortDrag;

            window.addEventListener("pointermove", onMove, true);
            window.addEventListener("pointerup", onUp, true);
            window.addEventListener("pointercancel", onUp, true);
        });
    }

    _makeMediaDragGhost(item, file) {
        const ghost = document.createElement("div");
        ghost.className = "cat-te-media-drag-ghost";
        ghost.textContent = file.split(/[\\/]/).pop() || T("asset_fallback_name");
        const thumb = item.querySelector("img");
        if (thumb?.src) ghost.style.backgroundImage = `url(${thumb.src})`;
        return ghost;
    }

    _updateMediaDragHover(clientX, clientY) {
        const host = this.tlHost;
        const scroll = this._timeline?.scrollEl;
        if (!host && !scroll) return;
        const r = (host || scroll).getBoundingClientRect();
        const over = clientX >= r.left && clientX <= r.right
            && clientY >= r.top && clientY <= r.bottom;
        host?.classList.toggle("cat-te-file-drop-over", over);
        scroll?.classList.toggle("cat-te-drop-active", over);
        document.body.classList.toggle("cat-te-media-dnd-over-tl", over);

        const prev = this._dndHoverClip;
        const next = over ? (this._findClipAtGeometry(clientX, clientY) ?? null) : null;
        if (prev?.id !== next?.id) {
            prev?.el?.classList.remove("cat-te-drop-target");
            next?.el?.classList.add("cat-te-drop-target");
            this._dndHoverClip = next;
        }
    }

    _clearMediaDragVisuals(item, ghost) {
        item?.classList.remove("dragging");
        ghost?.remove();
        document.body.classList.remove("cat-te-media-dnd", "cat-te-media-dnd-over-tl");
        this.tlHost?.classList.remove("cat-te-file-drop-over");
        this._timeline?.scrollEl?.classList.remove("cat-te-drop-active");
        this._dndHoverClip?.el?.classList.remove("cat-te-drop-target");
        // Keep _dndHoverClip until _commitMediaDrop reads it.
    }

    _commitMediaDrop(media, clientX, clientY) {
        const tl = this._timeline;
        if (!tl || !media?.file) return;
        // Hit-test the whole timeline host (not only scrollEl) so drops on
        // track headers / padding still count.
        const host = this.tlHost || tl.scrollEl;
        if (!host) return;
        const r = host.getBoundingClientRect();
        if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return;

        const { kind, file } = media;
        const targetClip = this._dndHoverClip
            || this._findClipAt(clientX, clientY)
            || this._findClipAtGeometry(clientX, clientY);
        this._dndHoverClip = null;

        if (targetClip && (kind === "image" || kind === "video") && targetClip.track.type === "image") {
            this._timeline.selectClip(targetClip);
            this._insertItemIntoClip(targetClip, file, kind);
            return;
        }
        const t = tl.currentTime;
        if (kind === "audio") void this._addAudioAtTime(file, t, clientY);
        else if (kind === "video") void this._addVideoAtTime(file, t, clientY);
        else void this._addImageAtTime(file, t, clientY);
    }

    _trackHasRoom(track, atSec, duration) {
        if (!track || track.locked) return false;
        const next = [...track.clips].sort((a, b) => a.startTime - b.startTime)
            .find(clip => clip.endTime > atSec);
        if (!next) return true;
        if (next.startTime < atSec + duration) return false;
        return true;
    }

    _createInsertTrack(kind) {
        const type = kind === "audio" ? "audio" : "image";
        const track = this._timeline.addTrack({
            type,
            name: type === "audio" ? T("media_kind_audio") : T("overlay_track_name"),
            height: TRACK_HEIGHT,
        });
        this._trackInfo.set(track.id, {
            trackIndex: this._nextTrackIndex(), enabled: true,
            role: type === "audio" ? "audio" : "overlay",
        });
        this._setupTrackControls(track);
        return track;
    }

    _pickInsertImageTrack(atSec, duration = 0.05) {
        const tracks = this._allImageTracks().filter(t => !t.locked && t.visible !== false);
        for (const track of tracks) {
            if (this._trackHasRoom(track, atSec, duration)) return track;
        }
        return this._createInsertTrack("image");
    }

    _pickAudioTrack(clientY, atSec = 0, duration = 0.05) {
        const hovered = this._timeline?._findTrackAtY(clientY, "audio");
        if (hovered && this._trackHasRoom(hovered, atSec, duration)) return hovered;
        return this._allAudioTracks().find(t => this._trackHasRoom(t, atSec, duration))
            ?? this._createInsertTrack("audio");
    }

    _addMediaAtPlayhead(filename) {
        if (!this._timeline) return;
        this._addImageAtTime(filename, this._timeline.currentTime, null);
    }

    _addAudioAtPlayhead(filename) {
        if (!this._timeline) return;
        this._addAudioAtTime(filename, this._timeline.currentTime, null);
    }

    _addVideoAtPlayhead(filename) {
        if (!this._timeline) return;
        this._addVideoAtTime(filename, this._timeline.currentTime, null);
    }

    _showInsertClipMenu(e) {
        const r = e.currentTarget.getBoundingClientRect();
        this._buildCtxMenu([
            { label: T("insert_media_clip_menu"), fn: () => this._insertPackageAtTime(this._timeline?.currentTime ?? 0) },
            { label: T("insert_subtitle_clip_menu"), fn: () => this._insertSubtitleAtTime(this._timeline?.currentTime ?? 0) },
        ], r.left, r.bottom + 4);
    }

    /**
     * Empty Clip containers on image/video tracks — used for 文生视频
     * or as a group that later holds multiple stills / videos.
     */
    _insertPackageAtPlayhead() {
        if (!this._timeline) return;
        this._insertPackageAtTime(this._timeline.currentTime);
    }

    _insertSubtitleAtTime(atSec, preferredTrack = null) {
        if (!this._timeline) return;
        let track = preferredTrack && isSubtitleTrackType(preferredTrack.type) ? preferredTrack : null;
        if (track?.locked) track = null;
        if (!track) {
            track = this._allTextTracks().find((t) => !t.locked && this._trackHasRoom(t, atSec, 0.05));
        }
        this._recordUndo();
        if (!track) {
            track = this._addUserTrack("text");
        }
        if (!track || track.locked) return;
        const dur = Math.min(2, this._timeline.duration / 4) || 1;
        const text = T("subtitle_default_text");
        const clip = this._timeline.addClip(track.id, {
            name: text,
            startTime: atSec,
            duration: dur,
            color: track.color || "#ff9e4a",
        });
        this._meta.set(clip.id, {
            ...defaultSubtitleMeta(this._trackIndex(track)),
            text,
        });
        this._timeline.selectClip(clip);
        this._timeline.setCurrentTime(atSec);
        this._decorateClip(clip);
        this._refreshTimelineDuration();
        this._scheduleProgramPreview();
    }

    _insertPackageAtTime(atSec) {
        if (!this._timeline) return;
        const track = this._pickInsertImageTrack(atSec);
        if (!track) {
            alert(T("no_insertable_track"));
            return;
        }
        const dur = Math.min(2, this._timeline.duration / 4) || 0.1;
        this._recordUndo();
        const clip = this._timeline.addClip(track.id, {
            name: DEFAULT_CLIP_NAME,
            startTime: atSec,
            duration: dur,
            color: "#d9a441",
        });
        const ti = this._trackIndex(track);
        this._meta.set(clip.id, {
            ...defaultImageMeta(ti),
            mediaKind: "clip",
            clipRole: "t2v",
            items: [],
        });
        this._timeline.selectClip(clip);
        this._timeline.setCurrentTime(atSec);
        this._decorateClip(clip);
        this._refreshTimelineDuration();
    }

    async _addImageAtTime(filename, atSec, clientY) {
        if (!this._timeline) return;
        const dur = Math.min(2, this._timeline.duration / 4) || 0.1;
        this._recordUndo();
        let track = clientY != null
            ? this._timeline._findTrackAtY(clientY, "image")
            : null;
        if (track?.visible === false || !this._trackHasRoom(track, atSec, dur)) track = null;
        if (!track) track = this._pickInsertImageTrack(atSec, dur);
        const media = this._ensureMedia("image", filename);
        const item = media
            ? { id: media.id, kind: media.kind, file: media.file, useMediaPrompt: true, enabled: true }
            : { kind: "image", file: filename, useMediaPrompt: true, enabled: true };
        const clip = this._timeline.addClip(track.id, {
            name: filename.split(/[\\/]/).pop(),
            startTime: atSec,
            duration: dur,
            thumbnail: this._imgUrl(filename),
            src: filename,
            color: track.color,
        });
        const ti = this._trackIndex(track);
        this._meta.set(clip.id, {
            ...defaultImageMeta(ti),
            mediaKind: "clip",
            clipRole: "multi_ref",
            items: [item],
            mediaIds: item.id ? [item.id] : [],
        });
        this._timeline.selectClip(clip);
        this._timeline.setCurrentTime(atSec);
        this._decorateClip(clip);
        this._refreshTimelineDuration();
    }

    async _addAudioAtTime(filename, atSec, clientY) {
        if (!this._timeline) return;
        const url = this._audioUrl(filename);
        let peaks = null;
        let sourceDur = 30;
        let buffer = null;
        try {
            const r = await this._fetchPeaks(url);
            peaks = r.peaks[0];
            sourceDur = r.duration;
            buffer = r.buffer;
        } catch {
            try {
                sourceDur = await this._probeAudioDuration(url);
            } catch { /* keep default */ }
        }
        const dur = Math.max(0.05, sourceDur);
        this._ensureTimelineLength(atSec + dur);
        this._recordUndo();
        const media = this._ensureMedia("audio", filename);
        const track = this._pickAudioTrack(clientY ?? 0, atSec, dur);
        const clip = this._timeline.addClip(track.id, {
            name: filename.split(/[\\/]/).pop(),
            startTime: atSec,
            duration: dur,
            sourceDuration: sourceDur,
            sourceOffset: 0,
            src: filename,
            waveformPeaks: peaks,
            color: track.color,
        });
        clip._audioBuffer = buffer;
        const ti = this._trackIndex(track);
        this._meta.set(clip.id, {
            ...defaultAudioMeta(ti),
            sourceDuration: sourceDur,
            trimIn: 0,
            mediaId: media?.id || "",
        });
        this._timeline.selectClip(clip);
        this._timeline.setCurrentTime(atSec);
        this._decorateClip(clip);
        this._refreshTimelineDuration();
    }

    /** Video clips go on image tracks, trimmed to the source's own length
     * just like audio; row 3 of the clip shows a waveform only if the
     * file actually has an audio stream. */
    async _addVideoAtTime(filename, atSec, clientY) {
        if (!this._timeline) return;
        const url = this._videoUrl(filename);
        let videoDur = 2;
        try {
            videoDur = await this._probeVideoDuration(url);
        } catch { /* keep default */ }
        const dur = Math.max(0.05, videoDur);

        let thumbnail = null;
        try {
            thumbnail = await this._grabVideoThumbnail(url);
        } catch { /* no preview available */ }

        let peaks = null;
        let hasAudio = false;
        let buffer = null;
        try {
            const r = await this._fetchPeaks(url);
            peaks = r.peaks[0];
            hasAudio = true;
            buffer = r.buffer;
        } catch { hasAudio = false; }

        this._ensureTimelineLength(atSec + dur);
        this._recordUndo();
        const media = this._ensureMedia("video", filename);
        const item = media
            ? { id: media.id, kind: media.kind, file: media.file, useMediaPrompt: true, enabled: true }
            : { kind: "video", file: filename, useMediaPrompt: true, enabled: true };
        let track = clientY != null
            ? this._timeline._findTrackAtY(clientY, "image")
            : null;
        if (track?.visible === false || !this._trackHasRoom(track, atSec, dur)) track = null;
        if (!track) track = this._pickInsertImageTrack(atSec, dur);
        const clip = this._timeline.addClip(track.id, {
            name: filename.split(/[\\/]/).pop(),
            startTime: atSec,
            duration: dur,
            sourceDuration: dur,
            sourceOffset: 0,
            thumbnail,
            src: filename,
            waveformPeaks: peaks,
            hasAudio,
            color: track.color,
        });
        clip._audioBuffer = buffer;
        const ti = this._trackIndex(track);
        this._meta.set(clip.id, {
            ...defaultImageMeta(ti),
            mediaKind: "clip",
            clipRole: "video_ref",
            sourceDuration: dur,
            items: [item],
            mediaIds: item.id ? [item.id] : [],
        });
        this._timeline.selectClip(clip);
        this._timeline.setCurrentTime(atSec);
        this._decorateClip(clip);
        this._refreshTimelineDuration();
    }

    async _probeVideoDuration(url) {
        return new Promise((resolve, reject) => {
            const v = document.createElement("video");
            v.preload = "metadata";
            v.muted = true;
            v.addEventListener("loadedmetadata", () => {
                if (Number.isFinite(v.duration) && v.duration > 0) resolve(v.duration);
                else reject(new Error("invalid duration"));
            });
            v.addEventListener("error", () => reject(new Error("load failed")));
            v.src = url;
        });
    }

    _runVideoThumbJob(fn) {
        return new Promise((resolve, reject) => {
            this._videoThumbWaiters.push({ fn, resolve, reject });
            this._pumpVideoThumbQueue();
        });
    }

    _pumpVideoThumbQueue() {
        const max = 2;
        while (this._videoThumbActive < max && this._videoThumbWaiters.length) {
            const job = this._videoThumbWaiters.shift();
            this._videoThumbActive += 1;
            Promise.resolve()
                .then(() => job.fn())
                .then(job.resolve, job.reject)
                .finally(() => {
                    this._videoThumbActive = Math.max(0, this._videoThumbActive - 1);
                    this._pumpVideoThumbQueue();
                });
        }
    }

    async _grabVideoThumbnail(url, atSec = 0.15) {
        return this._runVideoThumbJob(() => this._grabVideoThumbnailOnce(url, atSec));
    }

    _grabVideoThumbnailOnce(url, atSec = 0.15) {
        return new Promise((resolve, reject) => {
            const v = document.createElement("video");
            v.preload = "metadata";
            v.muted = true;
            v.playsInline = true;
            let done = false;
            const finish = (fn, value) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                try {
                    v.removeAttribute("src");
                    v.load();
                } catch { /* ignore */ }
                fn(value);
            };
            const timer = setTimeout(() => finish(reject, new Error("thumb timeout")), 8000);
            const draw = () => {
                try {
                    const srcW = Math.max(1, v.videoWidth || 160);
                    const srcH = Math.max(1, v.videoHeight || 90);
                    const maxSide = 160;
                    const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
                    const canvas = document.createElement("canvas");
                    canvas.width = Math.max(1, Math.round(srcW * scale));
                    canvas.height = Math.max(1, Math.round(srcH * scale));
                    canvas.getContext("2d").drawImage(v, 0, 0, canvas.width, canvas.height);
                    finish(resolve, canvas.toDataURL("image/jpeg", 0.72));
                } catch (err) {
                    finish(reject, err);
                }
            };
            v.addEventListener("loadedmetadata", () => {
                const dur = Number.isFinite(v.duration) ? v.duration : 0;
                const t = dur > 0
                    ? Math.min(Math.max(0, atSec), Math.max(0, dur - 0.05))
                    : 0;
                const seek = () => {
                    try {
                        v.currentTime = t;
                    } catch {
                        draw();
                    }
                };
                // Some files already sit at the target time and never fire `seeked`.
                if (Math.abs((v.currentTime || 0) - t) < 0.001) {
                    if (v.readyState >= 2) draw();
                    else v.addEventListener("loadeddata", draw, { once: true });
                    return;
                }
                v.addEventListener("seeked", draw, { once: true });
                seek();
            });
            v.addEventListener("error", () => finish(reject, new Error("load failed")));
            v.src = url;
        });
    }

    /** Cached (and de-duped) thumbnail lookup for the video media grid —
     * each file is only decoded/seeked once per editor session. */
    _getVideoThumbnail(file) {
        if (this._videoThumbCache.has(file)) return this._videoThumbCache.get(file);
        const p = this._grabVideoThumbnail(this._videoUrl(file)).catch(() => null);
        this._videoThumbCache.set(file, p);
        return p;
    }

    _audioBufferToPeaks(buf, max = 8000) {
        const ch = Math.min(2, buf.numberOfChannels || 1);
        const peaks = [];
        for (let c = 0; c < ch; c++) {
            const d = buf.getChannelData(c);
            const chunk = Math.max(1, Math.floor(d.length / max));
            const list = [];
            for (let i = 0; i < max; i++) {
                const s = i * chunk;
                const end = Math.min(s + chunk, d.length);
                let m = 0;
                for (let j = s; j < end; j++) {
                    const v = Math.abs(d[j]);
                    if (v > m) m = v;
                }
                list.push(m);
            }
            peaks.push(list);
        }
        if (peaks.length === 1) peaks.push(peaks[0].slice());
        return peaks;
    }

    async _probeAudioDuration(url) {
        return new Promise((resolve, reject) => {
            const a = new Audio();
            a.preload = "metadata";
            const done = (v) => { a.src = ""; resolve(v); };
            a.addEventListener("loadedmetadata", () => {
                if (Number.isFinite(a.duration) && a.duration > 0) done(a.duration);
                else reject(new Error("invalid duration"));
            });
            a.addEventListener("error", () => reject(new Error("load failed")));
            a.src = url;
        });
    }

    /** Restore full media length when project JSON only stored the trimmed window. */
    async _reconcileClipSourceDurations() {
        const tl = this._timeline;
        if (!tl) return;
        const tasks = [];
        for (const track of tl.tracks) {
            for (const clip of track.clips) {
                if (!clip.src) continue;
                const isAudio = track.type === "audio";
                const m = this._meta.get(clip.id);
                const isVideo = m?.mediaKind === "video";
                if (!isAudio && !isVideo) continue;
                const cur = Number(clip.sourceDuration);
                if (Number.isFinite(cur) && cur > clip.duration + 0.01) continue;
                const url = isAudio ? this._audioUrl(clip.src) : this._videoUrl(clip.src);
                if (!url) continue;
                tasks.push((async () => {
                    try {
                        const probed = isAudio
                            ? await this._probeAudioDuration(url)
                            : await this._probeVideoDuration(url);
                        if (!Number.isFinite(probed) || probed <= clip.duration + 0.01) return;
                        clip.sourceDuration = probed;
                        const meta = this._meta.get(clip.id)
                            ?? (isAudio ? defaultAudioMeta() : defaultImageMeta());
                        meta.sourceDuration = probed;
                        this._meta.set(clip.id, meta);
                    } catch { /* keep existing */ }
                })());
            }
        }
        await Promise.all(tasks);
    }

    async _fetchPeaks(url) {
        const r = await fetch(url, { credentials: "same-origin" });
        if (!r.ok) throw new Error(T("audio_load_failed_status", { status: r.status }));
        const ab = await r.arrayBuffer();
        const ctx = new AudioContext();
        try {
            const buf = await ctx.decodeAudioData(ab.slice(0));
            // `buf` stays valid after this context closes — AudioBuffers aren't
            // tied to the context that decoded them, so it's cached on the
            // clip for playback instead of being re-fetched/re-decoded later.
            return { peaks: this._audioBufferToPeaks(buf), duration: buf.duration, buffer: buf };
        } finally {
            await ctx.close();
        }
    }

    async _syncProjectMedia() {
        if (!this._timeline) return;
        const wanted = new Map();
        const add = (kind, file) => {
            kind = String(kind || "").toLowerCase();
            file = String(file || "").trim();
            if (!kind || !file || !["image", "video", "audio"].includes(kind)) return;
            wanted.set(`${kind}:${file}`, { kind, file });
            this._ensureMedia(kind, file);
        };
        for (const resource of this._projectResources) {
            add(resource.kind, resource.file);
        }
        for (const track of this._timeline.tracks) {
            for (const clip of track.clips) {
                const meta = this._meta.get(clip.id);
                if (track.type === "audio") add("audio", clip.src);
                else {
                    for (const item of this._clipItems(meta)) add(item.kind, item.file);
                }
            }
        }
        for (const { kind, file } of wanted.values()) {
            const list = kind === "audio" ? this._audioFiles : kind === "video" ? this._videoFiles : this._imgFiles;
            let status = { location: "missing" };
            try {
                const url = api.apiURL(
                    `/audio_keyframe_timeline/asset_status?dir=&name=${encodeURIComponent(file)}&kind=${kind}`,
                );
                const response = await fetch(url);
                const data = await response.json();
                if (data.input_exists) status = { location: "input" };
            } catch { /* retain missing status */ }
            this._mediaStatus.set(`${kind}:${file}`, status);
            if (!list.includes(file)) list.push(file);
        }
    }

    _assetFileUrl(file, kind, location = "input") {
        return api.apiURL(
            `/audio_keyframe_timeline/asset_file?dir=`
            + `&name=${encodeURIComponent(file)}&kind=${encodeURIComponent(kind)}`
            + `&location=${encodeURIComponent(location || "input")}`
        );
    }

    // ─── Audio playback ─────────────────────────────────────────────────
    //
    // At any seek position there can be several simultaneous audio-bearing
    // sources: one clip per audio track (a track can't have overlapping
    // clips, but there can be several audio tracks), plus a video-with-audio
    // clip on the main track and/or the overlay track. Rather than mixing
    // these down into one buffer ourselves, each audible clip gets its own
    // AudioBufferSourceNode connected to the same AudioContext destination —
    // the Web Audio API mixes any number of simultaneous sources for free.

    _ensurePlaybackContext() {
        if (!this._playbackCtx) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            this._playbackCtx = new Ctx();
        }
        if (this._playbackCtx.state === "suspended") this._playbackCtx.resume();
        return this._playbackCtx;
    }

    /** Clips that should actually be heard: not muted, not hidden, not
     * disabled — mirrors what `_decorateClip` already treats as "excluded
     * from the render" for image/video tracks. */
    _collectAudibleClips() {
        const out = [];
        for (const track of this._timeline?.tracks ?? []) {
            for (const clip of track.clips) {
                if (!clip._audioBuffer) continue;
                const m = this._meta.get(clip.id);
                if (track.type === "audio") {
                    if (track.muted || m?.muted) continue;
                } else {
                    if (!clip.hasAudio) continue;
                    if (track.visible === false || m?.disabled) continue;
                    if (track.muted) continue;
                    // Generated-video preview owns its own HTML5 audio path.
                    if (this._clipUsesGeneratedPreview(m)) continue;
                }
                out.push(clip);
            }
        }
        return out;
    }

    /** Linear fade envelope for Web Audio playback of an audio-track clip. */
    _scheduleAudioFadeGain(gainNode, when, localStart, playDur, fadeIn, fadeOut, clipDur) {
        const clamp01 = (v) => Math.max(0, Math.min(1, v));
        const gAt = (t) => {
            let g = 1;
            if (fadeIn > 0 && t < fadeIn) g = Math.min(g, t / fadeIn);
            if (fadeOut > 0 && t > clipDur - fadeOut) {
                g = Math.min(g, Math.max(0, (clipDur - t) / fadeOut));
            }
            return clamp01(g);
        };
        const localEnd = localStart + playDur;
        const pts = [localStart, localEnd];
        if (fadeIn > 0 && fadeIn > localStart && fadeIn < localEnd) pts.push(fadeIn);
        const fadeOutStart = clipDur - fadeOut;
        if (fadeOut > 0 && fadeOutStart > localStart && fadeOutStart < localEnd) {
            pts.push(fadeOutStart);
        }
        pts.sort((a, b) => a - b);
        const uniq = [];
        for (const p of pts) {
            const r = Math.round(p * 1e6) / 1e6;
            if (!uniq.length || Math.abs(uniq[uniq.length - 1] - r) > 1e-6) uniq.push(r);
        }
        gainNode.gain.cancelScheduledValues(when);
        for (let i = 0; i < uniq.length; i++) {
            const localT = uniq[i];
            const t = when + (localT - localStart);
            const g = gAt(localT);
            if (i === 0) gainNode.gain.setValueAtTime(g, Math.max(when, t));
            else gainNode.gain.linearRampToValueAtTime(g, Math.max(when, t));
        }
    }

    _startAudioPlayback() {
        this._stopAudioPlayback();
        const tl = this._timeline;
        if (!tl) return;
        const ctx = this._ensurePlaybackContext();
        const startCtxTime = ctx.currentTime + 0.03; // small lead-in so scheduling never lands in the past
        const startPlayhead = tl.currentTime;
        const sources = [];

        for (const clip of this._collectAudibleClips()) {
            if (clip.endTime <= startPlayhead) continue; // already fully played past

            const src = ctx.createBufferSource();
            src.buffer = clip._audioBuffer;
            const gain = ctx.createGain();
            src.connect(gain);
            gain.connect(ctx.destination);

            let when, offset, dur, localStart;
            if (clip.startTime <= startPlayhead) {
                when = startCtxTime;
                localStart = startPlayhead - clip.startTime;
                offset = clip.sourceOffset + localStart;
                dur = clip.endTime - startPlayhead;
            } else {
                when = startCtxTime + (clip.startTime - startPlayhead);
                localStart = 0;
                offset = clip.sourceOffset;
                dur = clip.duration;
            }
            const fadeIn = clip.track?.type === "audio" ? Math.max(0, clip.fadeIn || 0) : 0;
            const fadeOut = clip.track?.type === "audio" ? Math.max(0, clip.fadeOut || 0) : 0;
            if (fadeIn > 0 || fadeOut > 0) {
                this._scheduleAudioFadeGain(gain, when, localStart, dur, fadeIn, fadeOut, clip.duration);
            } else {
                gain.gain.setValueAtTime(1, when);
            }
            try {
                src.start(when, Math.max(0, offset), Math.max(0.001, dur));
                sources.push({ src, gain });
            } catch { /* clip's buffer/offset out of range — skip it */ }
        }
        this._activeAudioSources = sources;
    }

    _stopAudioPlayback() {
        if (this._seekAudioRaf) {
            cancelAnimationFrame(this._seekAudioRaf);
            this._seekAudioRaf = null;
        }
        for (const row of this._activeAudioSources) {
            const src = row?.src ?? row;
            const gain = row?.gain;
            try { src.stop(); } catch { /* already stopped */ }
            try { src.disconnect(); } catch { /* already disconnected */ }
            if (gain) {
                try { gain.disconnect(); } catch { /* already disconnected */ }
            }
        }
        this._activeAudioSources = [];
    }

    _initTimelineFromWidgets(projectOverride = null, options = {}) {
        return this._initTimelineFromWidgetsAsync(projectOverride, options);
    }

    _resolvedScalar(widgetVal, settingsVal, defaultVal) {
        const w = widgetVal ?? defaultVal;
        if (settingsVal == null) return w;
        if (w !== settingsVal) return w;
        return settingsVal;
    }

    _setWidgetText(widget, text) {
        if (!widget) return;
        const next = String(text ?? "");
        if (widget.value !== next) widget.value = next;
        const ta = resolvePromptTextarea(widget);
        if (ta && ta.value !== next) {
            ta.value = next;
            updateRichPromptMirror(ta);
        }
    }

    _applyScalarSettings(settings, { applySettingsFromProject = false } = {}) {
        for (const name of ["fps", "width", "height"]) {
            const widget = this._w(name);
            if (!widget) continue;
            const sVal = settings[name];
            const next = applySettingsFromProject
                ? (sVal != null ? sVal : widget.value)
                : this._resolvedScalar(widget.value, sVal, PY_SCALAR_DEFAULTS[name]);
            widget.value = next;
        }
        this._syncProjectScalarDisplay();
    }

    /** Keep project_json.settings aligned with node scalar widgets. */
    _syncScalarsToProjectJson() {
        const projectW = this._w("project_json");
        if (!projectW) return;
        const parsed = this._parseProjectWidgetValue();
        if (parsed.error || !parsed.project) return;
        const project = parsed.project;
        if (!project.settings || typeof project.settings !== "object") project.settings = {};
        project.settings.fps = Number(this._w("fps")?.value ?? PY_SCALAR_DEFAULTS.fps);
        project.settings.width = Number(this._w("width")?.value ?? PY_SCALAR_DEFAULTS.width);
        project.settings.height = Number(this._w("height")?.value ?? PY_SCALAR_DEFAULTS.height);
        project.settings.global_prompt = this._readGlobalPrompt();
        delete project.settings.ignore_occluded;
        this._writeProjectJson(JSON.stringify(project));
        this._syncProjectScalarDisplay();
    }

    async _initTimelineFromWidgetsAsync(projectOverride = null, { applySettingsFromProject = false } = {}) {
        const loadSeq = ++this._loadSeq;
        this._timelineReady = false;
        this._meta.clear();
        this._trackInfo.clear();
        if (loadSeq !== this._loadSeq) return;
        this.tlHost.replaceChildren();

        const fps = this.getFps();
        this._timeline = new Timeline(this.tlHost, {
            duration: 60,
            fps,
            timeFormat: "frames",
            zoom: 1.2,
            addTrackTypes: ["image", "audio", "text"],
        });

        let project = projectOverride;
        if (!project) {
            const parsed = this._parseProjectWidgetValue();
            if (parsed.error) throw parsed.error;
            project = parsed.project || {
                project_version: this._currentVersion(),
                schema_version: SCHEMA_VERSION,
                media: [],
                settings: {},
                tracks: [],
            };
        }
        project = this._migrateProjectDocument(project);
        this._applyMediaCatalogFromProject(project);
        this.projectNameInput.value = String(project.name || T("untitled_project")).trim() || T("untitled_project");
        this._syncBrandProjectName();

        const settings = project.settings && typeof project.settings === "object" ? project.settings : {};
        this._applyScalarSettings(settings, { applySettingsFromProject });
        this._watermark = this._normalizeWatermark(settings.watermark);
        this._useClipSpecifiedVideoFilename = settings.use_clip_specified_video_filename !== false;
        project.settings = {
            ...settings,
            fps: Number(this._w("fps")?.value ?? PY_SCALAR_DEFAULTS.fps),
            width: Number(this._w("width")?.value ?? PY_SCALAR_DEFAULTS.width),
            height: Number(this._w("height")?.value ?? PY_SCALAR_DEFAULTS.height),
            global_prompt: String(settings.global_prompt ?? this._readGlobalPrompt() ?? ""),
            use_clip_specified_video_filename: this._useClipSpecifiedVideoFilename !== false,
        };
        if (settings.global_prompt != null) {
            this._writeGlobalPrompt(settings.global_prompt);
        } else {
            this._syncGlobalPromptInput();
        }
        this._syncProjectScalarDisplay();
        this._timeline.fps = this.getFps();

        const projectTracks = Array.isArray(project.tracks) ? project.tracks : [];
        const tracksCfg = projectTracks.map((track, order) => {
            const rawType = String(track.type || "visual").toLowerCase();
            const type = rawType === "audio"
                ? "audio"
                : (rawType === "subtitle" || rawType === "text")
                    ? "text"
                    : "image";
            return {
                ...track,
                type,
                trackIndex: order,
                isMain: track.role === "main",
            };
        });

        if (!tracksCfg.length) {
            this._createDefaultTracks();
        } else {
            this._loadTracksFromJson(tracksCfg);
        }

        const clips = this._clipsFromProjectTracks(project, this.getFps());
        if (loadSeq !== this._loadSeq) return;
        await Promise.all(clips.map((c) => this._addClipFromJson(c).catch(() => null)));
        if (loadSeq !== this._loadSeq) return;
        await this._reconcileClipSourceDurations();
        if (loadSeq !== this._loadSeq) return;

        this._refreshTimelineDuration();
        this._applyTimelineZoomFromSettings(settings);
        // Merge local cache under project settings so project wins when present.
        const viewSettings = { ...this._readViewFromLocalCache(), ...settings };
        this._applyTimelineViewFromSettings(viewSettings, { applyZoom: false });
        this._decorateAllClips();
        this._bindTimelineEvents();
        this._configureTimelineUi();
        if (loadSeq !== this._loadSeq) return;
        this._timelineReady = true;
        this._saveToWidgets();
        this._ensureProgramPreviewObserver();
        this._scheduleProgramPreview();
    }

    _createDefaultTracks() {
        const tl = this._timeline;
        this._mainTrack = tl.addTrack({
            type: "image", name: T("main_track_name"), isMain: true, height: TRACK_HEIGHT, color: "#3d6ec4",
        });
        this._overlayTrack = tl.addTrack({
            type: "image", name: T("overlay_track_name"), height: TRACK_HEIGHT, color: "#8b4ec8",
        });
        this._audioTrack = tl.addTrack({
            type: "audio", name: T("audio_track_name"), height: TRACK_HEIGHT, color: "#3dd68c",
        });
        this._trackInfo.set(this._mainTrack.id, { trackIndex: 0, enabled: true, role: "main" });
        this._trackInfo.set(this._overlayTrack.id, { trackIndex: 1, enabled: true, role: "overlay" });
        this._trackInfo.set(this._audioTrack.id, { trackIndex: 2, enabled: true, role: "audio" });
        for (const t of [this._mainTrack, this._overlayTrack, this._audioTrack]) {
            this._setupTrackControls(t);
        }
    }

    _loadTracksFromJson(rows) {
        const tl = this._timeline;
        const ordered = [...rows].sort((a, b) => (a.trackIndex ?? 0) - (b.trackIndex ?? 0));

        ordered.forEach((row, index) => {
            const isMain = !!row.isMain;
            const track = tl.addTrackAt({
                id: row.id,
                type: row.type || "image",
                name: row.name || (
                    row.type === "audio"
                        ? T("audio_track_name")
                        : isSubtitleTrackType(row.type)
                            ? T("subtitle_track_name")
                            : T("generic_track_name")
                ),
                isMain,
                height: trackHeightFor(row.type),
                color: row.color,
                locked: !!row.locked,
                visible: row.visible !== false,
                muted: !!row.muted,
            }, index);
            track.setLocked(!!row.locked);
            track.setVisible(row.visible !== false);
            track.setMuted(!!row.muted);
            this._trackInfo.set(track.id, {
                trackIndex: row.trackIndex ?? index,
                enabled: row.enabled !== false,
                role: row.role || (
                    isMain
                        ? "main"
                        : row.type === "audio"
                            ? "audio"
                            : isSubtitleTrackType(row.type)
                                ? "subtitle"
                                : "overlay"
                ),
            });
            this._setupTrackControls(track);
        });
        this._syncTrackRoleRefs();
    }

    /** Re-bind main / overlay / audio track refs after rebuild from JSON. */
    _syncTrackRoleRefs() {
        this._mainTrack = null;
        this._overlayTrack = null;
        this._audioTrack = null;
        for (const track of this._timeline?.tracks ?? []) {
            const role = this._trackInfo.get(track.id)?.role;
            if (track.type === "audio") {
                if (!this._audioTrack) this._audioTrack = track;
                continue;
            }
            if (track.isMain || role === "main") {
                this._mainTrack = track;
                continue;
            }
            if (!this._overlayTrack && track.type === "image") {
                this._overlayTrack = track;
            }
        }
        if (!this._mainTrack) {
            this._mainTrack = this._allImageTracks().find(t => t.isMain) ?? this._allImageTracks().at(-1) ?? null;
        }
    }

    _resolveTrackForClip(trackIdx, clipType) {
        const direct = this._trackByIndex(trackIdx);
        if (direct) return direct;
        if (clipType === "audio") return this._audioTrack;
        if (trackIdx === 1) return this._overlayTrack ?? this._mainTrack;
        return this._mainTrack;
    }

    _trackByIndex(idx) {
        for (const track of this._timeline?.tracks ?? []) {
            if (this._trackIndex(track) === idx) return track;
        }
        return null;
    }

    async _addClipFromJson(c) {
        let clipType = String(c.clip_type || "").toLowerCase();
        const trackIdx = Number(c.track ?? 0);
        if (!clipType) {
            clipType = c.audio_file ? "audio" : "image";
        }
        const track = this._resolveTrackForClip(trackIdx, clipType);
        if (!track) return;

        const startMs = Number(c.start_ms) || 0;
        const endMs = Number(c.end_ms) || startMs + 1000;
        const fps = this.getFps();
        const decoded = decodeClipTimingSecs(startMs, endMs - startMs, endMs, fps);
        const startTime = decoded.startTime;
        const dur = Math.max(1 / fps, decoded.duration);

        if (clipType === "audio") {
            const mediaRows = this._jsonClipMediaRows(c);
            const audioRow = mediaRows.find((row) => row.kind === "audio") || mediaRows[0];
            const af = audioRow?.file || c.audio_file || c.src || "";
            const audioMedia = audioRow || this._ensureMedia("audio", af);
            const sourceDur = Number(c.source_duration) || dur;
            const trimIn = Math.max(0, Number(c.trim_in) || 0);
            let peaks = null;
            let buffer = null;
            if (af) {
                try {
                    const r = await this._fetchPeaks(this._audioUrl(af));
                    peaks = r.peaks[0];
                    buffer = r.buffer;
                } catch { /* placeholder */ }
            }
            const clip = this._timeline.addClip(track.id, {
                id: c.id || uid(),
                name: af.split(/[\\/]/).pop() || T("media_kind_audio"),
                startTime,
                duration: dur,
                sourceDuration: sourceDur,
                sourceOffset: trimIn,
                src: af,
                waveformPeaks: peaks,
                color: track.color,
            });
            clip._audioBuffer = buffer;
            const fadeInMs = Math.max(0, Number(c.fade_in_ms) || 0);
            const fadeOutMs = Math.max(0, Number(c.fade_out_ms) || 0);
            clip.fadeIn = fadeInMs / 1000;
            clip.fadeOut = fadeOutMs / 1000;
            clip._clampFades?.();
            clip._updateFadeUI?.();
            this._meta.set(clip.id, {
                ...defaultAudioMeta(trackIdx),
                muted: !!c.muted,
                visible: c.visible !== false,
                sourceDuration: sourceDur,
                trimIn,
                fadeInMs,
                fadeOutMs,
                mediaId: audioMedia?.id || "",
            });
            this._decorateClip(clip);
            return;
        }

        if (clipType === "subtitle" || clipType === "text" || isSubtitleTrackType(track.type)) {
            const text = String(c.text ?? c.name ?? T("subtitle_default_text"));
            const clip = this._timeline.addClip(track.id, {
                id: c.id || uid(),
                name: text.slice(0, 40) || T("subtitle_default_text"),
                startTime,
                duration: dur,
                color: track.color || "#ff9e4a",
            });
            const style = c.style && typeof c.style === "object" ? c.style : c;
            this._meta.set(clip.id, {
                ...defaultSubtitleMeta(trackIdx),
                ...pickSubtitleStyle({
                    text,
                    fontFamily: style.font_family ?? style.fontFamily,
                    fontPath: style.font_path ?? style.fontPath,
                    fontSize: style.font_size ?? style.fontSize,
                    letterSpacing: style.letter_spacing ?? style.letterSpacing,
                    color: style.color,
                    bold: style.bold,
                    italic: style.italic,
                    opacity: style.opacity,
                    strokeEnabled: style.stroke_enabled ?? style.strokeEnabled,
                    strokeColor: style.stroke_color ?? style.strokeColor,
                    strokeWidth: style.stroke_width ?? style.strokeWidth,
                    shadowEnabled: style.shadow_enabled ?? style.shadowEnabled,
                    shadowColor: style.shadow_color ?? style.shadowColor,
                    shadowBlur: style.shadow_blur ?? style.shadowBlur,
                    shadowOffsetX: style.shadow_offset_x ?? style.shadowOffsetX,
                    shadowOffsetY: style.shadow_offset_y ?? style.shadowOffsetY,
                    align: style.align,
                    vAlign: style.v_align ?? style.vAlign,
                    offsetX: style.offset_x ?? style.offsetX,
                    offsetY: style.offset_y ?? style.offsetY,
                }),
                text,
                disabled: !!c.disabled,
                visible: c.visible !== false,
                trackIndex: trackIdx,
            });
            this._decorateClip(clip);
            return;
        }

        if (clipType === "package" || clipType === "clip" || clipType === "image" || clipType === "video") {
            const mediaRows = this._jsonClipMediaRows(c);
            const flags = Array.isArray(c.use_media_prompts) ? c.use_media_prompts : [];
            const enabledFlags = Array.isArray(c.media_enabled) ? c.media_enabled : [];
            const items = (mediaRows.length
                ? mediaRows
                    .filter((row) => row.kind !== "audio")
                    .map((row) => ({ id: row.id, kind: row.kind, file: row.file }))
                : (Array.isArray(c.items) && c.items.length
                    ? c.items.map(normalizeClipItem).filter(Boolean)
                    : clipItemsFromLegacy(c.start_image || c.src, c.end_image, c.clip_type))
            ).map((item, i) => ({
                ...item,
                useMediaPrompt: mediaFlagAt(flags, i),
                enabled: mediaFlagAt(enabledFlags, i),
            }));
            const first = items[0];
            const sourceDur = Number(c.source_duration) || dur;
            const trimIn = Math.max(0, Number(c.trim_in) || 0);
            const clip = this._timeline.addClip(track.id, {
                id: c.id || uid(),
                name: c.name || first?.file?.split(/[\\/]/).pop() || DEFAULT_CLIP_NAME,
                startTime,
                duration: dur,
                sourceDuration: first?.kind === "video" ? sourceDur : Infinity,
                sourceOffset: first?.kind === "video" ? trimIn : 0,
                src: first?.file || "",
                thumbnail: first?.kind === "image" && first.file ? this._imgUrl(first.file) : null,
                color: items.length ? track.color : "#d9a441",
            });
            const meta = {
                ...defaultImageMeta(trackIdx),
                mediaKind: "clip",
                prompt: c.prompt ?? "",
                aiPrompt: c.ai_prompt ?? "",
                useGlobalPrompt: c.use_global_prompt !== false,
                useAiPrompt: c.use_ai_prompt !== false,
                disabled: !!c.disabled,
                visible: c.visible !== false,
                items,
                mediaIds: items.map((item) => item.id).filter(Boolean),
                clipRole: c.clip_role || (items.length ? "multi_ref" : "t2v"),
                clipRoleCustom: c.clip_role_custom ?? "",
                agent: c.agent || "MiniMaxH3",
                agentCustom: c.agent_custom ?? "",
                headExtendSec: Math.max(0, Math.round(Number(c.head_extend_sec) || 0)),
                tailExtendSec: Math.max(0, Math.round(Number(c.tail_extend_sec) || 0)),
                generatePreviewVideo: !!c.generate_preview_video,
                secondSample: !!c.second_sample,
                generatedVideos: this._generatedVideosFromJson(c),
                previewMode: this._previewModeFromJson(c),
            };
            if (first?.kind === "video") {
                meta.sourceDuration = sourceDur;
                meta.muted = !!c.muted;
            }
            this._normalizeVisualMeta(clip, meta, { seedFromClip: false });
            this._meta.set(clip.id, meta);
            this._decorateClip(clip);
            // Always refresh thumb (incl. generated-video preview mode).
            this._syncClipPrimaryAppearance(clip);
            return;
        }

        if (clipType === "video") {
            const vf = c.start_image ?? c.src ?? "";
            const fname = vf.split(/[\\/]/).pop() || T("media_kind_video");
            const sourceDur = Number(c.source_duration) || dur;
            const trimIn = Math.max(0, Number(c.trim_in) || 0);
            const url = vf ? this._videoUrl(vf) : null;
            let thumbnail = null;
            let peaks = null;
            let hasAudio = false;
            let buffer = null;
            if (url) {
                try { thumbnail = await this._grabVideoThumbnail(url); } catch { /* no preview */ }
                try {
                    const r = await this._fetchPeaks(url);
                    peaks = r.peaks[0];
                    hasAudio = true;
                    buffer = r.buffer;
                } catch { hasAudio = false; }
            }
            const clip = this._timeline.addClip(track.id, {
                id: c.id || uid(),
                name: fname,
                startTime,
                duration: dur,
                sourceDuration: sourceDur,
                sourceOffset: trimIn,
                src: vf,
                thumbnail,
                waveformPeaks: peaks,
                hasAudio,
                color: track.color,
            });
            clip._audioBuffer = buffer;
            this._meta.set(clip.id, {
                ...defaultImageMeta(trackIdx),
                mediaKind: "clip",
                clipRole: c.clip_role || "video_ref",
                clipRoleCustom: c.clip_role_custom ?? "",
                agent: c.agent || "MiniMaxH3",
                agentCustom: c.agent_custom ?? "",
                prompt: c.prompt ?? "",
                aiPrompt: c.ai_prompt ?? "",
                endImage: c.end_image ?? null,
                useGlobalPrompt: c.use_global_prompt !== false,
                useAiPrompt: c.use_ai_prompt !== false,
                disabled: !!c.disabled,
                visible: c.visible !== false,
                sourceDuration: sourceDur,
                muted: !!c.muted,
                headExtendSec: Math.max(0, Math.round(Number(c.head_extend_sec) || 0)),
                tailExtendSec: Math.max(0, Math.round(Number(c.tail_extend_sec) || 0)),
                generatePreviewVideo: !!c.generate_preview_video,
                secondSample: !!c.second_sample,
            items: (Array.isArray(c.items) && c.items.length
                ? c.items.map(normalizeClipItem).filter(Boolean)
                : clipItemsFromLegacy(vf, c.end_image, "video")
            ).map((item, i) => ({
                ...item,
                useMediaPrompt: mediaFlagAt(c.use_media_prompts, i),
                enabled: mediaFlagAt(c.media_enabled, i),
            })),
                generatedVideos: this._generatedVideosFromJson(c),
                previewMode: this._previewModeFromJson(c),
            });
            this._normalizeVisualMeta(clip, this._meta.get(clip.id), { seedFromClip: false });
            this._decorateClip(clip);
            this._syncClipPrimaryAppearance(clip);
            return;
        }

        const img = c.start_image ?? "";
        const fname = img.split(/[\\/]/).pop() || T("asset_fallback_name");
        const clip = this._timeline.addClip(track.id, {
            id: c.id || uid(),
            name: fname,
            startTime,
            duration: dur,
            src: img,
            thumbnail: img ? this._imgUrl(img) : null,
            color: track.color,
        });
        this._meta.set(clip.id, {
            ...defaultImageMeta(trackIdx),
            mediaKind: "clip",
            clipRole: c.clip_role || (c.end_image ? "first_last" : "multi_ref"),
            clipRoleCustom: c.clip_role_custom ?? "",
            agent: c.agent || "MiniMaxH3",
            agentCustom: c.agent_custom ?? "",
            prompt: c.prompt ?? "",
            aiPrompt: c.ai_prompt ?? "",
            endImage: c.end_image ?? null,
            useGlobalPrompt: c.use_global_prompt !== false,
            useAiPrompt: c.use_ai_prompt !== false,
            disabled: !!c.disabled,
            visible: c.visible !== false,
            headExtendSec: Math.max(0, Math.round(Number(c.head_extend_sec) || 0)),
            tailExtendSec: Math.max(0, Math.round(Number(c.tail_extend_sec) || 0)),
            generatePreviewVideo: !!c.generate_preview_video,
                secondSample: !!c.second_sample,
            items: (Array.isArray(c.items) && c.items.length
                ? c.items.map(normalizeClipItem).filter(Boolean)
                : clipItemsFromLegacy(img, c.end_image, "image")
            ).map((item, i) => ({
                ...item,
                useMediaPrompt: mediaFlagAt(c.use_media_prompts, i),
                enabled: mediaFlagAt(c.media_enabled, i),
            })),
            generatedVideos: this._generatedVideosFromJson(c),
            previewMode: this._previewModeFromJson(c),
        });
        this._normalizeVisualMeta(clip, this._meta.get(clip.id), { seedFromClip: false });
        this._decorateClip(clip);
        this._syncClipPrimaryAppearance(clip);
    }

    _decorateAllClips() {
        for (const track of this._timeline?.tracks ?? []) {
            for (const clip of track.clips) this._decorateClip(clip);
        }
        this._updateAllGeneratedPreviewButton();
    }

    _findClipById(id) {
        for (const track of this._timeline?.tracks ?? []) {
            const c = track.clips.find(c => c.id === id);
            if (c) return c;
        }
        return null;
    }

    /** Keep app selection aligned with the timeline after clip removal. */
    _syncSelectedClip() {
        const tl = this._timeline;
        if (!tl) {
            this._selClip = null;
            this._selClips = [];
            return null;
        }
        this._selClips = tl.getSelectedClips();
        const primary = tl._selected ?? null;
        if (primary && this._findClipById(primary.id)) {
            this._selClip = primary;
            return this._selClip;
        }
        const fallback = this._selClips.at(-1) ?? null;
        this._selClip = fallback && this._findClipById(fallback.id) ? fallback : null;
        return this._selClip;
    }

    _findClipAt(clientX, clientY) {
        // DOM hit-test first; fall back to geometry — pointer-capture / Tauri
        // WebView2 often returns the drag source from elementFromPoint on up.
        const el = document.elementFromPoint(clientX, clientY)?.closest?.(".tl-clip");
        if (el?.dataset?.clipId) {
            const hit = this._findClipById(el.dataset.clipId);
            if (hit) return hit;
        }
        return this._findClipAtGeometry(clientX, clientY);
    }

    /** Resolve clip under a point via track bounds + timeline time. */
    _findClipAtGeometry(clientX, clientY) {
        const tl = this._timeline;
        if (!tl?.scrollEl) return null;
        const track = tl._findTrackAtY(clientY, "image")
            || tl._findTrackAtY(clientY, "text")
            || tl._findTrackAtY(clientY, "audio")
            || tl._findTrackAtY(clientY, "video");
        if (!track) return null;
        const rect = tl.scrollEl.getBoundingClientRect();
        const x = clientX - rect.left + tl.scrollEl.scrollLeft;
        const t = Math.max(0, x / Math.max(1e-6, tl.pixelsPerSecond));
        return track.clips.find(c => t >= c.startTime - 1e-6 && t < c.endTime + 1e-6) ?? null;
    }

    _decorateClip(clip) {
        if (!clip?.el) return;
        const m = this._ensureClipMeta(clip);
        const track = clip.track;
        const trackHidden = (track.type === "image" || isSubtitleTrackType(track.type)) && track.visible === false;
        const trackMuted = track.type === "audio" && track.muted;
        const isAudio = m.clipType === "audio" || track.type === "audio";
        const isSubtitle = isSubtitleClipMeta(m, track);
        const disabled = !isAudio && (!!m.disabled || trackHidden);
        clip.el.classList.toggle("cat-te-clip-disabled", disabled);
        clip.el.classList.toggle("cat-te-clip-muted", isAudio && (!!m.muted || trackMuted));
        clip.el.classList.toggle("cat-te-clip-package", !isAudio && !isSubtitle && this._isEmptyGroupClip(m));
        if (isSubtitle) {
            const label = (m.text || clip.name || T("subtitle_default_text")).trim() || T("subtitle_default_text");
            clip.name = label.slice(0, 40);
            const labelEl = clip.el.querySelector(".tl-clip-label");
            if (labelEl) labelEl.textContent = clip.name;
        }

        let muteBadge = clip.el.querySelector(".cat-te-mute-badge");
        if (isAudio) {
            if (!muteBadge) {
                muteBadge = document.createElement("button");
                muteBadge.type = "button";
                muteBadge.className = "cat-te-mute-badge";
                muteBadge.textContent = "🔇";
                muteBadge.addEventListener("click", e => {
                    e.stopPropagation();
                    if (track.locked) return;
                    this._recordUndo();
                    const meta = this._ensureClipMeta(clip);
                    meta.muted = !meta.muted;
                    this._decorateClip(clip);
                });
                clip.el.appendChild(muteBadge);
            }
            muteBadge.textContent = (m.muted || trackMuted) ? "🔇" : "🔊";
            muteBadge.title = m.muted ? T("unmute_label") : T("mute_label");
        } else if (muteBadge) {
            muteBadge.remove();
        }

        let badge = clip.el.querySelector(".cat-te-end-badge");
        if (badge && !badge.classList.contains("cat-te-clip-preview-badge")) badge.remove();
        let previewBadge = clip.el.querySelector(".cat-te-clip-preview-badge");
        const enabledGen = !isAudio && track.type === "image" ? this._firstEnabledGeneratedVideo(m) : null;
        if (enabledGen) {
            if (!previewBadge) {
                previewBadge = document.createElement("button");
                previewBadge.type = "button";
                previewBadge.className = "cat-te-end-badge cat-te-clip-preview-badge";
                previewBadge.addEventListener("click", (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    this._toggleClipGeneratedPreview(clip);
                });
                clip.el.appendChild(previewBadge);
            }
            const genMode = this._clipUsesGeneratedPreview(m);
            previewBadge.innerHTML = iconHtml(genMode ? "camera" : "video", 12);
            previewBadge.title = genMode ? T("switch_to_asset_preview_title") : T("switch_to_generated_preview_title");
        } else if (previewBadge) {
            previewBadge.remove();
            if (m.previewMode === "generated") {
                m.previewMode = "media";
                this._meta.set(clip.id, m);
            }
        }

        clip.el.querySelector(".cat-te-force-badge")?.remove();
    }

    _refreshClipAppearance(clip) {
        if (!clip?.el) return;
        const label = clip.el.querySelector(".tl-clip-label");
        if (label) label.textContent = clip.name || T("asset_fallback_name");
        if (clip._thumbRow) {
            clip._applyThumbnail();
        } else {
            const body = clip.el.querySelector(".tl-clip-body");
            if (body) {
                if (clip.thumbnail) {
                    const src = String(clip.thumbnail).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
                    body.style.backgroundImage = `url("${src}")`;
                } else {
                    body.style.backgroundImage = "";
                }
            }
        }
        if (typeof clip._refreshWaveRow === "function") clip._refreshWaveRow();
        this._decorateClip(clip);
    }

    _startFramePreviewSrc(clip, meta) {
        if (clip.thumbnail) return clip.thumbnail;
        if (!clip.src) return "";
        return meta?.mediaKind === "video" ? this._videoUrl(clip.src) : this._imgUrl(clip.src);
    }

    _showStartEndPreview(clip, anchor) {
        if (!this.framePreview || !anchor || !clip) return;
        const m = this._meta.get(clip.id) ?? defaultImageMeta();
        const startSrc = this._startFramePreviewSrc(clip, m);
        if (!startSrc && !m.endImage) return;

        this.framePreview.replaceChildren();

        const row = document.createElement("div");
        row.className = "cat-te-frame-preview-row";

        for (const [label, src] of [[T("frame_first"), startSrc], [T("frame_last"), m.endImage ? this._imgUrl(m.endImage) : ""]]) {
            if (!src) continue;
            const item = document.createElement("div");
            item.className = "cat-te-frame-preview-item";
            const cap = document.createElement("span");
            cap.className = "cat-te-frame-preview-label";
            cap.textContent = label;
            const img = document.createElement("img");
            img.src = src;
            img.alt = label;
            item.appendChild(cap);
            item.appendChild(img);
            row.appendChild(item);
        }

        this.framePreview.appendChild(row);
        this.framePreview.style.display = "block";

        const r = anchor.getBoundingClientRect();
        const pr = this.framePreview.getBoundingClientRect();
        let left = r.left + r.width / 2 - pr.width / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - pr.width - 8));
        this.framePreview.style.left = `${left}px`;
        this.framePreview.style.top = `${r.bottom + 8}px`;
    }

    _hideImagePreview() {
        if (!this.framePreview) return;
        this.framePreview.style.display = "none";
    }

    _mediaPreviewCount() {
        const s = this._mediaPreviewState;
        return s?.items?.length || s?.files?.length || 0;
    }

    _mediaPreviewItem() {
        const s = this._mediaPreviewState;
        if (!s) return null;
        if (s.items?.length) return s.items[s.index] || null;
        if (s.files?.length) return { file: s.files[s.index], kind: s.kind };
        return null;
    }

    _renderMediaPreviewStars(kind, file) {
        if (!this.mediaPreviewStars) return;
        this.mediaPreviewStars.replaceChildren();
        const current = this._getMediaStars(kind, file) ?? 0;
        for (let i = 1; i <= 5; i++) {
            const starBtn = document.createElement("button");
            starBtn.type = "button";
            starBtn.className = "cat-te-media-preview-star-btn";
            starBtn.innerHTML = iconHtml("star", 14);
            starBtn.title = T("star_n_title", { n: i });
            if (i <= current) starBtn.classList.add("on");
            starBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                const cur = this._getMediaStars(kind, file) ?? 0;
                this._setMediaStars(kind, file, cur === i ? undefined : i);
                this._saveToWidgets();
                this._renderMediaPreviewStars(kind, file);
                this._renderMediaGrid();
                if (this._mediaPreviewState?.source === "clip") return;
                if (this._mediaPreviewState?.browse === false) return;
                if (this._mediaPreviewState) {
                    const items = this._visibleMediaEntries();
                    const still = items.findIndex((e) => e.kind === kind && e.file === file);
                    if (still < 0 && items.length) {
                        const idx = Math.min(this._mediaPreviewState.index, items.length - 1);
                        this._mediaPreviewState.items = items;
                        delete this._mediaPreviewState.files;
                        this._showMediaPreviewAt(idx);
                    } else {
                        this._mediaPreviewState.items = items.length ? items : [{ file, kind }];
                        delete this._mediaPreviewState.files;
                        this._mediaPreviewState.index = still < 0 ? 0 : still;
                    }
                }
            });
            this.mediaPreviewStars.appendChild(starBtn);
        }
    }

    _updateMediaPreviewNav() {
        this._applyMediaPreviewChrome();
    }

    _mediaPreviewIsClipSource() {
        return this._mediaPreviewState?.source === "clip";
    }

    _applyMediaPreviewChrome() {
        const state = this._mediaPreviewState;
        const clipSource = this._mediaPreviewIsClipSource();
        const browse = state?.browse !== false;
        const multi = browse && this._mediaPreviewCount() > 1;
        const libraryBrowse = browse && !clipSource;

        this.mediaPreviewModal?.classList.toggle("cat-te-media-preview-solo", !multi);

        if (this.mediaPreviewPrevBtn) {
            this.mediaPreviewPrevBtn.hidden = !multi;
            this.mediaPreviewPrevBtn.disabled = !multi;
        }
        if (this.mediaPreviewNextBtn) {
            this.mediaPreviewNextBtn.hidden = !multi;
            this.mediaPreviewNextBtn.disabled = !multi;
        }
        if (this.mediaPreviewFooter) this.mediaPreviewFooter.hidden = !libraryBrowse;
        if (this.mediaPreviewHint) this.mediaPreviewHint.hidden = !libraryBrowse;
        if (this.mediaPreviewInsertBtn) this.mediaPreviewInsertBtn.hidden = !libraryBrowse;

        if (libraryBrowse) {
            this._updateMediaPreviewInsertBtn();
        }
    }

    _updateMediaPreviewInsertBtn() {
        const btn = this.mediaPreviewInsertBtn;
        const state = this._mediaPreviewState;
        if (!btn || state?.browse === false) return;
        const item = this._mediaPreviewItem();
        if (!item || !this._timeline) {
            btn.disabled = true;
            btn.title = "";
            return;
        }
        const { file, kind } = item;
        const status = this._mediaStatus.get(`${kind}:${file}`);
        const missing = status?.location === "missing";
        btn.disabled = missing;
        const t = this._timeline.formatTime(this._timeline.currentTime);
        btn.title = missing ? T("asset_missing_cannot_insert") : T("insert_at_seek_position", { time: t });
    }

    _insertMediaPreviewAtSeek() {
        const item = this._mediaPreviewItem();
        if (!item || !this._timeline) return;
        const { file, kind } = item;
        const status = this._mediaStatus.get(`${kind}:${file}`);
        if (status?.location === "missing") {
            alert(T("asset_missing_cannot_insert"));
            return;
        }
        if (kind === "audio") void this._addAudioAtPlayhead(file);
        else if (kind === "video") void this._addVideoAtPlayhead(file);
        else void this._addMediaAtPlayhead(file);
    }

    _showMediaPreviewAt(index) {
        const state = this._mediaPreviewState;
        const n = this._mediaPreviewCount();
        if (!n || !this.mediaPreviewModal || !this.mediaPreviewStage) return;

        index = ((index % n) + n) % n;
        state.index = index;
        const item = this._mediaPreviewItem();
        if (!item) return;
        const { file, kind } = item;

        for (const media of this.mediaPreviewStage.querySelectorAll("audio, video")) {
            media.pause();
            media.removeAttribute("src");
            media.load();
        }
        this.mediaPreviewStage.replaceChildren();

        const name = file.split(/[\\/]/).pop() || T("asset_preview_fallback_name");
        this.mediaPreviewTitle.textContent = n > 1 ? `${index + 1} / ${n}  ${name}` : name;
        this._renderMediaPreviewStars(kind, file);
        this._fillMediaPreviewMeta(kind, file);
        this._updateMediaPreviewNav();
        this._syncClipPanelFromMediaPreview(index);

        let media;
        if (kind === "image") {
            media = document.createElement("img");
            media.src = this._imgUrl(file);
            media.alt = this.mediaPreviewTitle.textContent;
            media.draggable = false;
        } else if (kind === "video") {
            media = document.createElement("video");
            media.src = this._videoUrl(file);
            media.controls = true;
            media.preload = "metadata";
        } else {
            media = document.createElement("audio");
            media.src = this._audioUrl(file);
            media.controls = true;
            media.preload = "metadata";
        }
        media.className = `cat-te-media-preview-content cat-te-media-preview-${kind}`;
        this.mediaPreviewStage.appendChild(media);
        this.mediaPreviewModal.hidden = false;
    }

    _stepMediaPreview(delta) {
        const state = this._mediaPreviewState;
        if (state?.browse === false && !this._mediaPreviewIsClipSource()) return;
        if (this._mediaPreviewCount() <= 1) return;
        this._saveMediaPreviewMeta();
        this._showMediaPreviewAt(state.index + delta);
    }

    _syncClipPanelFromMediaPreview(index) {
        const state = this._mediaPreviewState;
        if (state?.source !== "clip" || !state.clipId) return;
        const clip = this._findClipById(state.clipId);
        if (!clip) return;
        this._setClipPreviewItemIndex(clip, index);
        if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
    }

    _clipPreviewMediaEntries(clip) {
        if (!clip) return [];
        const m = this._ensureClipMeta(clip);
        if (clip.track?.type === "audio" || m?.clipType === "audio") {
            const file = String(clip.src || "").trim();
            return file ? [{ file, kind: "audio" }] : [];
        }
        return this._clipItems(m)
            .filter((it) => it?.file)
            .map((it) => ({ file: it.file, kind: it.kind, id: it.id }));
    }

    _openMediaPreview(file, kind) {
        const items = this._visibleMediaEntries();
        let index = file ? items.findIndex((e) => e.file === file && e.kind === kind) : -1;
        if (index < 0 && file) {
            this._mediaPreviewState = { items: [{ file, kind }], index: 0, browse: true, source: "library" };
            this._showMediaPreviewAt(0);
            return;
        }
        if (!items.length) return;
        if (index < 0) index = 0;
        this._mediaPreviewState = { items, index, browse: true, source: "library" };
        this._showMediaPreviewAt(index);
    }

    _clipMediaKind(clip) {
        const m = this._meta.get(clip.id);
        if (clip.track?.type === "audio" || m?.clipType === "audio") return "audio";
        const items = this._clipItems(m);
        const idx = this._clipPreviewItemIndex(clip, m);
        return items[idx]?.kind || items[0]?.kind || null;
    }

    _openClipMediaPreview(clip) {
        const items = this._clipPreviewMediaEntries(clip);
        if (!items.length) return;
        const m = this._ensureClipMeta(clip);
        let index = this._clipPreviewItemIndex(clip, m);
        if (index < 0 || index >= items.length) index = 0;
        const current = items[index];
        const status = this._mediaStatus.get(`${current.kind}:${current.file}`);
        if (status?.location === "missing") {
            alert(T("asset_missing_cannot_preview"));
            return;
        }
        this._mediaPreviewState = {
            items,
            index,
            browse: true,
            source: "clip",
            clipId: clip.id,
        };
        this._showMediaPreviewAt(index);
    }

    _closeMediaPreview() {
        if (!this.mediaPreviewModal || !this.mediaPreviewStage) return;
        this._saveMediaPreviewMeta();
        for (const media of this.mediaPreviewStage.querySelectorAll("audio, video")) {
            media.pause();
            media.removeAttribute("src");
            media.load();
        }
        this.mediaPreviewStage.replaceChildren();
        this.mediaPreviewStars?.replaceChildren();
        this.mediaPreviewModal.hidden = true;
        this._mediaPreviewState = null;
        this._applyMediaPreviewChrome();
    }

    _fillMediaPreviewMeta(kind, file) {
        const meta = this._getMediaMeta(kind, file);
        const known = MEDIA_ASSET_TYPES.some((t) => t.id === meta.mediaType);
        if (this.mediaPreviewDesc) setRichPromptValue(this.mediaPreviewDesc, meta.prompt || "", true);
        if (this.mediaPreviewType) {
            this.mediaPreviewType.value = !meta.mediaType ? "" : (known ? meta.mediaType : "other");
        }
        if (this.mediaPreviewTypeCustom) {
            this.mediaPreviewTypeCustom.value = known ? "" : (meta.mediaType || "");
        }
        if (this.mediaPreviewTypeCustomRow) {
            this.mediaPreviewTypeCustomRow.hidden = this.mediaPreviewType?.value !== "other";
        }
        if (this.mediaPreviewTags) this.mediaPreviewTags.value = (meta.tags || []).join(", ");
    }

    _onMediaPreviewTypeChange() {
        if (this.mediaPreviewTypeCustomRow) {
            this.mediaPreviewTypeCustomRow.hidden = this.mediaPreviewType?.value !== "other";
        }
        this._saveMediaPreviewMeta();
    }

    _saveMediaPreviewMeta() {
        const item = this._mediaPreviewItem();
        if (!item) return;
        const { file, kind } = item;
        const prev = this._getMediaMeta(kind, file);
        let mediaType = String(this.mediaPreviewType?.value || "").trim();
        if (mediaType === "other") {
            mediaType = String(this.mediaPreviewTypeCustom?.value || "").trim() || "other";
        }
        this._writeMediaMeta(kind, file, {
            ...prev,
            prompt: String(this.mediaPreviewDesc?.value || ""),
            mediaType,
            tags: this._parseTagList(this.mediaPreviewTags?.value),
        });
        this._saveToWidgets();
    }

    _chooseMaterialFile(relink = null) {
        this._pendingRelink = relink;
        this.addMaterialInput.value = "";
        // Replace mode is always single-file; add mode supports multi-select.
        this.addMaterialInput.multiple = !relink;
        if (relink?.kind === "image") this.addMaterialInput.accept = "image/*";
        else if (relink?.kind === "video") this.addMaterialInput.accept = "video/*";
        else if (relink?.kind === "audio") this.addMaterialInput.accept = "audio/*";
        else this.addMaterialInput.accept = "image/*,video/*,audio/*";
        this.addMaterialInput.click();
    }

    _materialKind(file) {
        const type = String(file?.type || "").toLowerCase();
        const ext = String(file?.name || "").split(".").pop().toLowerCase();
        if (type.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif", "bmp"].includes(ext)) return "image";
        if (type.startsWith("video/") || ["mp4", "webm", "mov", "mkv", "avi", "m4v"].includes(ext)) return "video";
        if (type.startsWith("audio/") || ["wav", "mp3", "flac", "ogg", "m4a", "aac"].includes(ext)) return "audio";
        return null;
    }

    _materialItemsFromFiles(fileList, { withObjectUrl = false } = {}) {
        const items = [];
        const unsupported = [];
        for (const file of fileList || []) {
            const kind = this._materialKind(file);
            if (!kind) {
                unsupported.push(file?.name || T("unknown_file"));
                continue;
            }
            const item = { file, kind };
            if (withObjectUrl) item.objectUrl = URL.createObjectURL(file);
            items.push(item);
        }
        return { items, unsupported };
    }

    _isExternalFileDrag(event) {
        const dt = event?.dataTransfer;
        if (!dt) return false;
        // On drop, files is populated; during dragover it is often empty.
        if (dt.files && dt.files.length > 0) return true;
        if (dt.items && dt.items.length) {
            for (let i = 0; i < dt.items.length; i++) {
                if (dt.items[i]?.kind === "file") return true;
            }
        }
        const types = dt.types;
        if (!types) return false;
        for (let i = 0; i < types.length; i++) {
            const t = String(types[i] || "").toLowerCase();
            if (t === "files" || t.includes("filename") || t.includes("file")) return true;
        }
        return false;
    }

    _filesFromDataTransfer(dt) {
        if (!dt) return [];
        if (dt.files?.length) return Array.from(dt.files);
        const out = [];
        if (dt.items) {
            for (let i = 0; i < dt.items.length; i++) {
                const item = dt.items[i];
                if (item?.kind !== "file") continue;
                const file = item.getAsFile?.();
                if (file) out.push(file);
            }
        }
        return out;
    }

    _fileDropModeAt(clientX, clientY) {
        const el = document.elementFromPoint(clientX, clientY);
        if (!el || !this._overlay?.contains(el)) return null;
        if (el.closest(".cat-te-media")) return "library";
        if (el.closest(".cat-te-timeline-host, .tl-root, .tl-scroll, .tl-main, .cat-te-center")) {
            return "timeline";
        }
        return "library";
    }

    _setFileDropHighlight(mode) {
        this.mediaPanel?.classList.toggle("cat-te-file-drop-over", mode === "library");
        this.tlHost?.classList.toggle("cat-te-file-drop-over", mode === "timeline");
        this._timeline?.scrollEl?.classList.toggle("cat-te-drop-active", mode === "timeline");
        document.body.classList.toggle("cat-te-media-dnd-over-tl", mode === "timeline");
    }

    _showFileDropStatus(text) {
        let bar = this._overlay?.querySelector(".cat-te-file-drop-status");
        if (!bar && this._overlay) {
            bar = document.createElement("div");
            bar.className = "cat-te-file-drop-status";
            this._overlay.appendChild(bar);
        }
        if (!bar) return;
        bar.textContent = text || "";
        bar.hidden = !text;
    }

    /**
     * Accept OS file drops on the media library and timeline.
     * Uses capture on the fullscreen overlay so nested timeline widgets
     * cannot swallow dragover (which would block drop entirely).
     */
    _bindExternalFileDrop() {
        const overlay = this._overlay;
        if (!overlay) return;
        if (this.mediaPanel) {
            this.mediaPanel.title = T("media_panel_drop_hint_title");
        }
        if (overlay._catTeFileDropBound) return;
        overlay._catTeFileDropBound = true;

        const onDragEnterOrOver = (e) => {
            if (!overlay.classList.contains("open")) return;
            if (!this._isExternalFileDrag(e)) return;
            // Required: without preventDefault the browser never fires drop.
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
            if (this._modalsBlockFileDrop()) {
                this._setFileDropHighlight(null);
                return;
            }
            this._setFileDropHighlight(this._fileDropModeAt(e.clientX, e.clientY));
        };

        const onDragLeave = (e) => {
            if (!overlay.classList.contains("open")) return;
            const next = e.relatedTarget;
            if (next && overlay.contains(next)) return;
            this._setFileDropHighlight(null);
        };

        const onDrop = (e) => {
            if (!overlay.classList.contains("open")) return;
            const files = this._filesFromDataTransfer(e.dataTransfer);
            if (!files.length && !this._isExternalFileDrag(e)) return;
            e.preventDefault();
            e.stopPropagation();
            const mode = this._fileDropModeAt(e.clientX, e.clientY) || "library";
            this._setFileDropHighlight(null);
            void this._onExternalFilesDropped(files, mode, e.clientY, e.clientX);
        };

        overlay.addEventListener("dragenter", onDragEnterOrOver, true);
        overlay.addEventListener("dragover", onDragEnterOrOver, true);
        overlay.addEventListener("dragleave", onDragLeave, true);
        overlay.addEventListener("drop", onDrop, true);

        // Some hosts only deliver drag events on window; keep drop alive while open.
        const onWinDragOver = (e) => {
            if (!overlay.classList.contains("open")) return;
            if (!this._isExternalFileDrag(e)) return;
            e.preventDefault();
        };
        const onWinDrop = (e) => {
            if (!overlay.classList.contains("open")) return;
            const files = this._filesFromDataTransfer(e.dataTransfer);
            if (!files.length) return;
            // Only claim drops that land inside the editor.
            if (!overlay.contains(e.target) && this._fileDropModeAt(e.clientX, e.clientY) == null) return;
            e.preventDefault();
            e.stopPropagation();
            const mode = this._fileDropModeAt(e.clientX, e.clientY) || "library";
            this._setFileDropHighlight(null);
            void this._onExternalFilesDropped(files, mode, e.clientY, e.clientX);
        };
        window.addEventListener("dragover", onWinDragOver, true);
        window.addEventListener("drop", onWinDrop, true);
        overlay._catTeFileDropWinCleanup = () => {
            window.removeEventListener("dragover", onWinDragOver, true);
            window.removeEventListener("drop", onWinDrop, true);
        };
    }

    _modalsBlockFileDrop() {
        return Boolean(
            (this.addMaterialModal && !this.addMaterialModal.hidden)
            || (this.mediaPreviewModal && !this.mediaPreviewModal.hidden)
            || (this.clipItemsModal && !this.clipItemsModal.hidden)
            || (this.genVideoModal && !this.genVideoModal.hidden)
            || (this.settingsModal && !this.settingsModal.hidden)
            || (this.aiOptimizeModal && !this.aiOptimizeModal.hidden)
            || (this.skillPickerModal && !this.skillPickerModal.hidden),
        );
    }

    async _onExternalFilesDropped(fileList, mode, clientY = null, clientX = null) {
        if (!this._overlay?.classList.contains("open") || this._modalsBlockFileDrop()) return;
        if (this._fileDropBusy) return;

        const { items, unsupported } = this._materialItemsFromFiles(fileList || []);
        if (!items.length) {
            alert(unsupported.length
                ? T("unsupported_asset_format_list", { list: unsupported.slice(0, 8).join("\n") })
                : T("no_importable_files_detected"));
            return;
        }
        if (unsupported.length) {
            alert(T("ignored_unsupported_files", { n: unsupported.length, list: unsupported.slice(0, 8).join("\n") }));
        }

        let targetClip = null;
        if (mode === "timeline" && Number.isFinite(clientX) && Number.isFinite(clientY)) {
            targetClip = this._findClipAt(clientX, clientY) || this._findClipAtGeometry(clientX, clientY);
            if (targetClip?.track?.type !== "image") targetClip = null;
        }

        this._fileDropBusy = true;
        this._showFileDropStatus(
            targetClip
                ? T("importing_into_clip_status", { n: items.length })
                : mode === "timeline"
                    ? T("importing_insert_status", { n: items.length })
                    : T("importing_status", { n: items.length }),
        );
        try {
            await this._importMaterialItems(items, {
                insertToTimeline: mode === "timeline" && !targetClip,
                clientY,
                targetClip,
            });
            this._showFileDropStatus(
                mode === "timeline"
                    ? T("inserted_n_assets", { n: items.length })
                    : T("added_n_assets", { n: items.length }),
            );
            setTimeout(() => {
                if (!this._fileDropBusy) this._showFileDropStatus("");
            }, 1600);
        } catch (error) {
            this._showFileDropStatus("");
            alert(T("import_asset_failed", { msg: error instanceof Error ? error.message : String(error) }));
        } finally {
            this._fileDropBusy = false;
        }
    }

    _setAddMaterialMode(isReplace, count = 1) {
        if (this.addMaterialTitle) {
            if (isReplace) this.addMaterialTitle.textContent = T("replace_material_label");
            else this.addMaterialTitle.textContent = count > 1 ? T("add_material_with_count", { count }) : T("add_material_title");
        }
        if (this.addMaterialConfirmBtn) {
            this.addMaterialConfirmBtn.textContent = isReplace ? T("confirm_replace_btn") : T("confirm_btn");
        }
    }

    _renderAddMaterialPreview(items) {
        this.addMaterialPreview.replaceChildren();
        const list = document.createElement("div");
        list.className = "cat-te-add-material-list";
        for (const item of items) {
            const cell = document.createElement("div");
            cell.className = "cat-te-add-material-item";
            const media = document.createElement(item.kind === "image" ? "img" : item.kind);
            media.src = item.objectUrl;
            media.className = "cat-te-add-material-thumb";
            if (item.kind !== "image") media.controls = true;
            const name = document.createElement("div");
            name.className = "cat-te-add-material-item-name";
            name.textContent = item.file.name;
            name.title = item.file.name;
            cell.append(media, name);
            list.appendChild(cell);
        }
        this.addMaterialPreview.appendChild(list);
    }

    _previewSelectedMaterial(event) {
        const fileList = Array.from(event.target.files || []);
        event.target.value = "";
        const relink = this._pendingRelink;
        this._pendingRelink = null;
        if (!fileList.length) return;

        if (relink && fileList.length > 1) {
            alert(T("replace_material_single_file_only"));
            return;
        }

        const { items, unsupported } = this._materialItemsFromFiles(fileList, { withObjectUrl: true });
        if (relink && items.length) {
            if (items[0].kind !== relink.kind) {
                for (const item of items) {
                    if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
                }
                const expect = relink.kind === "image" ? T("media_kind_image")
                    : relink.kind === "video" ? T("media_kind_video") : T("media_kind_audio");
                alert(T("select_same_type_file", { expect }));
                return;
            }
        }
        if (!items.length) {
            alert(unsupported.length ? T("unsupported_asset_format_list", { list: unsupported.slice(0, 8).join("\n") }) : T("unsupported_asset_format_generic"));
            return;
        }
        if (unsupported.length) {
            alert(T("ignored_unsupported_files", { n: unsupported.length, list: unsupported.slice(0, 8).join("\n") }));
        }

        this._pendingMaterial = { items, relink };
        this._renderAddMaterialPreview(items);
        this.insertAfterAddCb.checked = false;
        this.insertAfterAddCb.closest("label").hidden = !!relink;
        this._setAddMaterialMode(!!relink, items.length);
        this.addMaterialModal.hidden = false;
    }

    _closeAddMaterial() {
        if (!this.addMaterialModal) return;
        for (const media of this.addMaterialPreview.querySelectorAll("audio, video")) media.pause();
        for (const item of this._pendingMaterial?.items || []) {
            if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
        }
        this._pendingMaterial = null;
        this._pendingRelink = null;
        this.addMaterialPreview.replaceChildren();
        this._setAddMaterialMode(false);
        this.addMaterialInput.accept = "image/*,video/*,audio/*";
        this.addMaterialInput.multiple = true;
        this.addMaterialModal.hidden = true;
    }

    async _uploadMaterialItem(item) {
        const form = new FormData();
        form.append("kind", item.kind);
        form.append("to_assets", "false");
        form.append("file", item.file, item.file.name);
        const response = await fetch(api.apiURL("/audio_keyframe_timeline/import_asset"), { method: "POST", body: form });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
        return { file: result.file, kind: item.kind, location: result.location };
    }

    async _importMaterialItems(items, { insertToTimeline = false, clientY = null, targetClip = null } = {}) {
        if (!items.length) return [];
        const uploaded = [];
        for (const item of items) {
            uploaded.push(await this._uploadMaterialItem(item));
        }
        for (const u of uploaded) this._registerMediaFile(u.file, u.kind, u.location);
        this._renderMediaGrid();
        const visual = uploaded.filter((u) => u.kind === "image" || u.kind === "video");
        if (targetClip && visual.length) {
            this._timeline?.selectClip(targetClip);
            for (const u of visual) this._insertItemIntoClip(targetClip, u.file, u.kind);
        } else if (insertToTimeline && this._timeline) {
            let at = this._timeline.currentTime;
            for (const u of uploaded) {
                if (u.kind === "audio") await this._addAudioAtTime(u.file, at, clientY);
                else if (u.kind === "video") await this._addVideoAtTime(u.file, at, clientY);
                else await this._addImageAtTime(u.file, at, clientY);
                const clip = this.getSelectedClip();
                if (clip) at = clip.endTime;
            }
        }
        this._saveToWidgets();
        return uploaded;
    }

    async _confirmAddMaterial() {
        const pending = this._pendingMaterial;
        const items = pending?.items || [];
        if (!items.length) return;
        const relink = pending.relink;
        if (relink) {
            const oldName = String(relink.file || "").split(/[\\/]/).pop() || relink.file;
            const newName = items[0].file?.name || T("new_asset_fallback_name");
            if (!confirm(T("confirm_replace_asset", { newName, oldName }))) {
                return;
            }
        }
        const shouldInsert = this.insertAfterAddCb.checked && !relink;
        const confirmBtn = this.addMaterialConfirmBtn;
        if (confirmBtn) confirmBtn.disabled = true;
        try {
            if (relink) {
                const uploaded = await this._uploadMaterialItem(items[0]);
                this._closeAddMaterial();
                this._replaceMediaReference(relink.file, uploaded.file, uploaded.kind);
                this._saveToWidgets();
                this._renderMediaGrid();
            } else {
                const uploaded = await this._importMaterialItems(items, { insertToTimeline: shouldInsert });
                this._closeAddMaterial();
                if (!uploaded.length) return;
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            alert(relink ? T("replace_asset_failed", { msg }) : T("add_asset_failed", { msg }));
        } finally {
            if (confirmBtn) confirmBtn.disabled = false;
        }
    }

    _registerMediaFile(file, kind, _location) {
        this._ensureMedia(kind, file);
    }

    /** Swap `oldFile` → `newFile` in the media library list, keeping position. */
    _swapMediaListEntry(oldFile, newFile, kind) {
        const list = kind === "audio" ? this._audioFiles : kind === "video" ? this._videoFiles : this._imgFiles;
        const next = [];
        let placed = false;
        for (const name of list) {
            if (name === oldFile || name === newFile) {
                if (!placed) {
                    next.push(newFile);
                    placed = true;
                }
                continue;
            }
            next.push(name);
        }
        if (!placed) next.push(newFile);
        list.length = 0;
        list.push(...next);

        this._mediaStatus.delete(`${kind}:${oldFile}`);
        this._mediaStatus.set(`${kind}:${newFile}`, { location: "input" });

        const oldStarKey = this._mediaStarsId(kind, oldFile);
        const newStarKey = this._mediaStarsId(kind, newFile);
        if (oldFile !== newFile && Object.prototype.hasOwnProperty.call(this._mediaStarsByDir, oldStarKey)) {
            if (!Object.prototype.hasOwnProperty.call(this._mediaStarsByDir, newStarKey)) {
                this._mediaStarsByDir[newStarKey] = this._mediaStarsByDir[oldStarKey];
            }
            delete this._mediaStarsByDir[oldStarKey];
            this._saveMediaStarsForDir();
        }
    }

    _replaceMediaReference(oldFile, newFile, kind, recordUndo = true) {
        if (!oldFile || !newFile || !kind) return;
        if (recordUndo) this._recordUndo();
        const row = this._findMedia(kind, oldFile);
        const dup = oldFile !== newFile ? this._findMedia(kind, newFile) : null;
        if (row) {
            row.file = newFile;
            row.name = newFile.split(/[\\/]/).pop() || row.name;
            row.location = "input";
            if (dup && dup !== row) {
                for (const track of this._timeline?.tracks ?? []) {
                    for (const clip of track.clips) {
                        const meta = this._meta.get(clip.id);
                        if (!meta) continue;
                        if (meta.mediaId === dup.id) meta.mediaId = row.id;
                        if (Array.isArray(meta.mediaIds)) {
                            meta.mediaIds = meta.mediaIds.map((id) => id === dup.id ? row.id : id);
                        }
                        if (Array.isArray(meta.items)) {
                            for (const item of meta.items) {
                                if (item?.id === dup.id) {
                                    item.id = row.id;
                                    item.file = newFile;
                                    item.kind = kind;
                                }
                            }
                        }
                    }
                }
                this._projectResources = this._projectResources.filter((resource) => resource !== dup);
            }
        } else {
            this._ensureMedia(kind, newFile);
        }
        const mediaId = (row || this._findMedia(kind, newFile))?.id;
        for (const track of this._timeline?.tracks ?? []) {
            for (const clip of track.clips) {
                const meta = this._meta.get(clip.id);
                const uses = track.type === "audio" || kind === "audio"
                    ? ((mediaId && meta?.mediaId === mediaId) || clip.src === oldFile)
                    : this._clipItems(meta).some((item) => (mediaId && item.id === mediaId) || item.file === oldFile);
                if (!uses) continue;
                if (track.type === "audio" || kind === "audio") {
                    clip.src = newFile;
                    clip.name = newFile.split(/[\\/]/).pop() || clip.name;
                    clip._audioBuffer = null;
                    if (mediaId && meta) meta.mediaId = mediaId;
                    void this._fetchPeaks(this._audioUrl(newFile)).then((r) => {
                        clip.waveformPeaks = r.peaks[0];
                        clip._audioBuffer = r.buffer;
                        clip.sourceDuration = r.duration;
                        if (meta) {
                            meta.sourceDuration = r.duration;
                            this._meta.set(clip.id, meta);
                        }
                        this._refreshClipAppearance(clip);
                    }).catch(() => this._refreshClipAppearance(clip));
                    this._refreshClipAppearance(clip);
                } else {
                    this._normalizeVisualMeta(clip, meta, { seedFromClip: false });
                    this._syncClipPrimaryAppearance(clip);
                    const first = this._clipItems(meta)[0];
                    if (first?.kind === "video") {
                        const url = this._videoUrl(first.file);
                        void this._probeVideoDuration(url).then((d) => {
                            if (!Number.isFinite(d) || d <= 0) return;
                            clip.sourceDuration = d;
                            if (clip.duration > d) clip.duration = d;
                            clip.sourceOffset = Math.min(clip.sourceOffset || 0, Math.max(0, d - clip.duration));
                            if (meta) {
                                meta.sourceDuration = d;
                                this._meta.set(clip.id, meta);
                            }
                            clip._applyPosition();
                            this._refreshTimelineDuration();
                        }).catch(() => { /* keep */ });
                    }
                }
                if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
            }
        }
        this._swapMediaListEntry(oldFile, newFile, kind);
    }

    /** Remove one library media from project/timeline lists. Returns whether disk delete is needed. */
    _removeLibraryMediaEntry(file, kind) {
        const status = this._mediaStatus.get(`${kind}:${file}`) || { location: "input" };
        const missing = status.location === "missing";
        const media = this._findMedia(kind, file);
        const mediaId = media?.id;
        const removedClipIds = new Set();
        for (const track of this._timeline?.tracks ?? []) {
            for (const clip of [...track.clips]) {
                const meta = this._meta.get(clip.id);
                if (track.type === "audio") {
                    if (kind !== "audio") continue;
                    if ((mediaId && meta?.mediaId === mediaId) || clip.src === file) {
                        removedClipIds.add(clip.id);
                        this._meta.delete(clip.id);
                        this._timeline.removeClip(track.id, clip.id);
                        this._pruneEmptyTrack(track);
                    }
                    continue;
                }
                const items = this._clipItems(meta);
                const next = items.filter((item) => !(mediaId && item.id === mediaId) && !(item.kind === kind && item.file === file));
                if (next.length === items.length) continue;
                if (!meta) continue;
                meta.items = next;
                meta.mediaIds = next.map((item) => item.id).filter(Boolean);
                this._meta.set(clip.id, meta);
                this._normalizeVisualMeta(clip, meta, { seedFromClip: false });
                this._syncClipPrimaryAppearance(clip);
            }
        }
        if (this._selClip && removedClipIds.has(this._selClip.id)) {
            this._selClip = null;
            this._selClips = [];
            this._timeline.clearSelection();
        }
        const list = kind === "audio" ? this._audioFiles : kind === "video" ? this._videoFiles : this._imgFiles;
        const index = list.indexOf(file);
        if (index >= 0) list.splice(index, 1);
        this._mediaStatus.delete(`${kind}:${file}`);
        delete this._mediaStarsByDir[this._mediaStarsId(kind, file)];
        this._saveMediaStarsForDir();
        this._projectResources = this._projectResources.filter(
            (resource) => resource.id !== mediaId && !(resource.kind === kind && resource.file === file),
        );
        if (kind === "video") this._videoThumbCache.delete(file);
        this._mediaBatchSelected.delete(this._mediaBatchKey(kind, file));
        return { needDisk: !missing, removedClipIds };
    }

    async _deleteDiskAsset(file, kind) {
        const response = await fetch(api.apiURL("/audio_keyframe_timeline/delete_asset"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: file, kind }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || T("delete_file_failed"));
    }

    async _deleteLibraryMedia(file, kind) {
        const label = file.split(/[\\/]/).pop() || file;
        const onTimeline = this._isMediaOnTimeline(file, kind);
        const status = this._mediaStatus.get(`${kind}:${file}`) || { location: "input" };
        const missing = status.location === "missing";
        const msg = missing
            ? T("confirm_delete_orphan_asset", { label })
            : onTimeline
                ? T("confirm_delete_asset_on_timeline", { label })
                : T("confirm_delete_asset", { label });
        if (!confirm(msg)) return;

        this._recordUndo();
        const { needDisk } = this._removeLibraryMediaEntry(file, kind);
        this._syncSelectedClip();
        this._updatePromptPanel();
        if (needDisk) {
            try {
                await this._deleteDiskAsset(file, kind);
            } catch (error) {
                alert(T("asset_removed_disk_delete_failed", { msg: error instanceof Error ? error.message : String(error) }));
            }
        }
        this._renderMediaGrid();
        this._refreshTimelineDuration();
        this._scheduleProgramPreview();
    }

    async _deleteSelectedLibraryMedia() {
        const entries = [...this._mediaBatchSelected].map((key) => {
            const i = key.indexOf(":");
            return { kind: key.slice(0, i), file: key.slice(i + 1) };
        }).filter((row) => row.kind && row.file);
        if (!entries.length) return;
        const onTimeline = entries.some(({ file, kind }) => this._isMediaOnTimeline(file, kind));
        const msg = onTimeline
            ? T("confirm_delete_selected_n_on_timeline", { n: entries.length })
            : T("confirm_delete_selected_n", { n: entries.length });
        if (!confirm(msg)) return;

        this._recordUndo();
        const diskJobs = [];
        for (const { file, kind } of entries) {
            const { needDisk } = this._removeLibraryMediaEntry(file, kind);
            if (needDisk) diskJobs.push(this._deleteDiskAsset(file, kind).catch((err) => err));
        }
        this._syncSelectedClip();
        this._updatePromptPanel();
        const results = await Promise.all(diskJobs);
        const failed = results.filter((r) => r instanceof Error);
        this._mediaBatchSelected.clear();
        this._mediaBatchMode = false;
        this._renderMediaGrid();
        this._refreshTimelineDuration();
        this._scheduleProgramPreview();
        if (failed.length) {
            alert(T("removed_with_n_disk_delete_failures", { n: failed.length }));
        }
    }

    _removeCtxMenu() {
        const m = document.querySelector(".cat-te-ctx-menu");
        if (m) { m.remove(); return true; }
        return false;
    }

    _buildCtxMenu(items, x, y) {
        this._removeCtxMenu();
        if (!items?.length) return;
        const menu = document.createElement("div");
        menu.className = "cat-te-ctx-menu";
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        for (const { label, fn, danger, strike } of items) {
            const div = document.createElement("div");
            div.className = `cat-te-ctx-item${danger ? " danger" : ""}${strike ? " strike" : ""}`;
            div.textContent = label;
            div.addEventListener("click", (e) => {
                e.stopPropagation();
                fn();
                this._removeCtxMenu();
            });
            menu.appendChild(div);
        }
        // Prefer overlay so stacking stays above the editor chrome.
        (this._overlay || document.body).appendChild(menu);
        this._ignoreCtxCloseOnce = true;
        const r = menu.getBoundingClientRect();
        if (r.right > window.innerWidth) menu.style.left = `${window.innerWidth - r.width - 8}px`;
        if (r.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - r.height - 8}px`;
    }

    _showClipCtxMenu(clip, e) {
        const selected = this._timeline.getSelectedClips();
        if (!selected.some(c => c.id === clip.id)) {
            this._timeline.selectClip(clip);
        }
        const m = this._meta.get(clip.id)
            ?? (clip.track.type === "audio"
                ? defaultAudioMeta()
                : isSubtitleTrackType(clip.track.type)
                    ? defaultSubtitleMeta()
                    : defaultImageMeta());
        const isAudio = clip.track.type === "audio" || m.clipType === "audio";
        const isSubtitle = isSubtitleClipMeta(m, clip.track);
        const t = this._timeline.currentTime;
        const canSplit = t > clip.startTime && t < clip.endTime;
        const items = [
            ...(canSplit ? [{ label: T("menu_split"), fn: () => this._splitClip(clip) }] : []),
        ];
        if (isAudio) {
            items.push({
                label: m.muted ? T("unmute_label") : T("mute_label"),
                fn: () => {
                    m.muted = !m.muted;
                    this._meta.set(clip.id, m);
                    this._decorateClip(clip);
                },
            });
        } else if (isSubtitle) {
            items.push(
                { label: m.disabled ? T("menu_enable_shortcut") : T("menu_disable_shortcut"), strike: !!m.disabled, fn: () => this._toggleDisableClip(clip) },
                { label: T("menu_set_title"), fn: () => this._renameClip(clip) },
            );
        } else {
            items.push(
                { label: T("menu_run"), fn: () => void this._runClipDownstream(clip) },
                { label: T("menu_ai_optimize_prompt"), fn: () => void this._openAiOptimizeModal() },
                { label: m.disabled ? T("menu_enable_shortcut") : T("menu_disable_shortcut"), strike: !!m.disabled, fn: () => this._toggleDisableClip(clip) },
                { label: T("menu_disable_others_assets_shortcut"), fn: () => this._disableOthers(clip) },
                { label: T("menu_set_title"), fn: () => this._renameClip(clip) },
                { label: T("view_material_title"), fn: () => this._openClipItemsModal(clip) },
                { label: T("linked_generated_videos_title"), fn: () => void this._openOutputVideosPicker(clip) },
            );
            if (this._clipUsesGeneratedPreview(m)) {
                const gen = this._firstEnabledGeneratedVideo(m);
                if (gen) {
                    const muted = gen.muted === true;
                    items.push({
                        label: muted ? T("unmute_label") : T("mute_label"),
                        fn: () => this._setGeneratedVideoMuted(clip, gen.id, !muted),
                    });
                }
            }
        }
        items.push(
            { label: T("menu_copy_shortcut"), fn: () => this._copySelectedClips() },
            { label: T("menu_paste_shortcut"), fn: () => this._pasteClips() },
            { label: T("delete_btn"), fn: () => this._deleteClip(clip), danger: true },
        );
        this._buildCtxMenu(items, e.clientX, e.clientY);
    }

    _cloneClipMeta(meta) {
        const m = { ...(meta || {}) };
        if (Array.isArray(meta?.items)) {
            m.items = meta.items.map((item) => (
                item && typeof item === "object" ? { ...item } : item
            ));
        }
        if (Array.isArray(meta?.generatedVideos)) {
            m.generatedVideos = meta.generatedVideos.map((row) => (
                row && typeof row === "object" ? { ...row } : row
            ));
        }
        return m;
    }

    _snapshotClip(clip) {
        const isAudio = clip.track?.type === "audio";
        const isSubtitle = isSubtitleTrackType(clip.track?.type);
        const meta = this._meta.get(clip.id)
            ?? (isAudio
                ? defaultAudioMeta()
                : isSubtitle
                    ? defaultSubtitleMeta()
                    : defaultImageMeta());
        return {
            trackId: clip.track.id,
            trackType: isAudio ? "audio" : isSubtitle ? "text" : "image",
            startTime: clip.startTime,
            duration: clip.duration,
            name: clip.name,
            src: clip.src,
            thumbnail: clip.thumbnail,
            color: clip.color,
            sourceDuration: clip.sourceDuration,
            sourceOffset: clip.sourceOffset || 0,
            fadeIn: isAudio ? Math.max(0, clip.fadeIn || 0) : 0,
            fadeOut: isAudio ? Math.max(0, clip.fadeOut || 0) : 0,
            hasAudio: !!clip.hasAudio,
            waveformPeaks: clip._waveform?.length ? clip._waveform.slice() : null,
            audioBuffer: clip._audioBuffer ?? null,
            meta: this._cloneClipMeta(meta),
        };
    }

    /** @returns {boolean} true if anything was copied */
    _copySelectedClips() {
        let clips = this._timeline?.getSelectedClips() ?? [];
        if (!clips.length) {
            const one = this.getSelectedClip();
            if (one) clips = [one];
        }
        if (!clips.length) return false;
        const ordered = [...clips].sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
        CapTimelineEditorApp._clipClipboard = ordered.map(c => this._snapshotClip(c));
        return true;
    }

    _resolvePasteTrack(snap) {
        const tl = this._timeline;
        if (!tl || !snap) return null;
        const wantAudio = snap.trackType === "audio";
        const wantSub = isSubtitleTrackType(snap.trackType);
        const orig = tl.getTrack(snap.trackId);
        if (orig && !orig.locked && orig.visible !== false) {
            const ok = wantAudio
                ? orig.type === "audio"
                : wantSub
                    ? isSubtitleTrackType(orig.type)
                    : (orig.type === "image" || orig.type === "video");
            if (ok) return orig;
        }
        if (wantAudio) {
            return this._allAudioTracks().find(t => !t.locked && t.visible !== false)
                ?? this._createInsertTrack("audio");
        }
        if (wantSub) {
            return this._allTextTracks().find(t => !t.locked && t.visible !== false)
                ?? this._addUserTrack("text");
        }
        return this._allImageTracks().find(t => !t.locked && t.visible !== false)
            ?? this._createInsertTrack("image");
    }

    /** Earliest start on `track` at/after `desired` that fits `duration`. */
    _findFreeStart(track, desired, duration) {
        if (!track) return desired;
        const dur = Math.max(0.05, duration);
        const eps = 0.5 / Math.max(1, this.getFps());
        if (this._trackHasRoom(track, desired, dur)) return desired;
        const sorted = [...track.clips].sort((a, b) => a.startTime - b.startTime);
        let t = Math.max(0, desired);
        for (const c of sorted) {
            if (c.endTime <= t + eps) {
                t = Math.max(t, c.endTime);
                continue;
            }
            if (t + dur <= c.startTime + eps) return t;
            t = c.endTime;
        }
        return t;
    }

    /** True if every snapshot fits on its paste track when the group starts at `base`. */
    _pasteGroupFitsAt(snaps, tracks, minStart, base) {
        for (let i = 0; i < snaps.length; i++) {
            const start = base + (snaps[i].startTime - minStart);
            if (!this._trackHasRoom(tracks[i], start, snaps[i].duration)) return false;
        }
        return true;
    }

    /** Latest clip end among the paste target tracks. */
    _pasteTracksEndTime(tracks) {
        let end = 0;
        for (const track of tracks) {
            for (const c of track.clips) end = Math.max(end, c.endTime);
        }
        return end;
    }

    /**
     * Paste clipboard clips keeping relative offsets within the copied group.
     * Prefer the seek (playhead) when the whole group fits there; otherwise
     * append after the last clip on the target tracks.
     * @returns {boolean} true if anything was pasted
     */
    _pasteClips() {
        const snaps = CapTimelineEditorApp._clipClipboard;
        const tl = this._timeline;
        if (!snaps?.length || !tl) return false;

        const minStart = Math.min(...snaps.map(s => s.startTime));
        const tracks = snaps.map(s => this._resolvePasteTrack(s));
        if (tracks.some(t => !t)) return false;

        this._recordUndo();

        const seek = typeof tl._snapTime === "function"
            ? tl._snapTime(tl.currentTime)
            : Math.max(0, tl.currentTime);
        let pasteBase;
        if (this._pasteGroupFitsAt(snaps, tracks, minStart, seek)) {
            pasteBase = seek;
        } else {
            pasteBase = this._pasteTracksEndTime(tracks);
            // Safety: nudge forward if the group still collides (e.g. same-track overlaps).
            for (let guard = 0; guard < 64; guard++) {
                if (this._pasteGroupFitsAt(snaps, tracks, minStart, pasteBase)) break;
                let bump = null;
                for (let i = 0; i < snaps.length; i++) {
                    const start = pasteBase + (snaps[i].startTime - minStart);
                    if (!this._trackHasRoom(tracks[i], start, snaps[i].duration)) {
                        const free = this._findFreeStart(tracks[i], start, snaps[i].duration);
                        const need = free - (snaps[i].startTime - minStart);
                        bump = bump == null ? need : Math.max(bump, need);
                    }
                }
                if (bump == null) break;
                pasteBase = Math.max(pasteBase, bump);
            }
        }

        const created = [];
        for (let i = 0; i < snaps.length; i++) {
            const snap = snaps[i];
            const track = tracks[i];
            const start = pasteBase + (snap.startTime - minStart);
            this._ensureTimelineLength(start + snap.duration);
            const clip = tl.addClip(track.id, {
                name: snap.name,
                startTime: start,
                duration: snap.duration,
                src: snap.src,
                thumbnail: snap.thumbnail,
                color: snap.color ?? track.color,
                sourceDuration: snap.sourceDuration,
                sourceOffset: snap.sourceOffset || 0,
                fadeIn: track.type === "audio" ? Math.max(0, snap.fadeIn || 0) : 0,
                fadeOut: track.type === "audio" ? Math.max(0, snap.fadeOut || 0) : 0,
                hasAudio: !!snap.hasAudio,
                waveformPeaks: snap.waveformPeaks || undefined,
            });
            if (!clip) continue;
            clip._audioBuffer = snap.audioBuffer ?? null;
            const meta = this._cloneClipMeta(snap.meta);
            meta.trackIndex = this._trackIndex(track);
            if (track.type === "audio") {
                meta.fadeInMs = Math.round((clip.fadeIn || 0) * 1000);
                meta.fadeOutMs = Math.round((clip.fadeOut || 0) * 1000);
            }
            this._meta.set(clip.id, meta);
            this._decorateClip(clip);
            created.push(clip);
        }
        if (!created.length) return false;

        tl.selectClip(created[0]);
        for (let i = 1; i < created.length; i++) {
            tl.selectClip(created[i], { additive: true });
        }
        this._updatePromptPanel();
        this._refreshTimelineDuration();
        this._scheduleProgramPreview();
        this._saveToWidgets();
        return true;
    }

    /**
     * Queue the workflow so Timeline Editor emits data_json / clips_audio for
     * only this visual clip. Uses settings.runtime_only_clip_ids (not temporary
     * disable flags) so the filter survives queuePrompt flush / restore races.
     */
    async _runClipDownstream(clip) {
        if (!clip || !this.node) return;
        const m = this._meta.get(clip.id) ?? defaultImageMeta();
        if (clip.track?.type === "audio" || m.clipType === "audio") {
            alert(T("audio_clip_not_in_data_json"));
            return;
        }
        if (isSubtitleTrackType(clip.track?.type) || isSubtitleClipMeta(m, clip.track)) {
            return;
        }
        if (this._isEmptyGroupClip(m)) return;
        if (typeof app?.queuePrompt !== "function") {
            alert(T("queue_prompt_not_found"));
            return;
        }

        this._runtimeOnlyClipIds = [String(clip.id)];
        let expectedFile = null;
        if (this._useClipSpecifiedVideoFilename !== false) {
            this._genVideoStamp = this._makeGenVideoStamp();
            expectedFile = this._clipSpecifiedVideoPath(clip.id, this._genVideoStamp);
        } else {
            this._genVideoStamp = null;
        }
        try {
            this._saveToWidgets();
            this._openedProjectJson = JSON.stringify(this._buildProject());
            const result = await app.queuePrompt(0);
            this._pendingGeneratedJobs.push({
                clipId: clip.id,
                promptId: this._promptIdFromQueueResult(result),
                files: [],
                expectedFile,
            });
        } catch (error) {
            alert(T("run_failed", { msg: error instanceof Error ? error.message : String(error) }));
        } finally {
            this._runtimeOnlyClipIds = null;
            this._genVideoStamp = null;
            this._saveToWidgets();
            this._openedProjectJson = JSON.stringify(this._buildProject());
        }
    }

    _toggleDisableClip(clip) {
        this._recordUndo();
        const m = this._meta.get(clip.id) ?? defaultImageMeta();
        m.disabled = !m.disabled;
        this._meta.set(clip.id, m);
        this._decorateClip(clip);
        if (this._selClip?.id === clip.id) this._updatePromptPanel();
    }

    _disableOthers(clip) {
        const all = [];
        for (const track of this._allImageTracks()) {
            for (const c of track.clips) {
                if (c.id !== clip.id) all.push(c);
            }
        }
        if (!all.length) return;
        this._recordUndo();
        const target = all.every(c => (this._meta.get(c.id) ?? defaultImageMeta()).disabled) ? false : true;
        for (const c of all) {
            const m = this._meta.get(c.id) ?? defaultImageMeta();
            if (m.disabled !== target) {
                m.disabled = target;
                this._meta.set(c.id, m);
                this._decorateClip(c);
            }
        }
        const self = this._meta.get(clip.id) ?? defaultImageMeta();
        if (self.disabled) {
            self.disabled = false;
            this._meta.set(clip.id, self);
            this._decorateClip(clip);
            if (this._selClip?.id === clip.id) this._updatePromptPanel();
        }
    }

    _mediaKindForFile(file) {
        if (!file) return "image";
        return this._videoFiles.includes(file) ? "video" : "image";
    }

    _swapStartEndFrames(clip) {
        this._recordUndo();
        const m = this._meta.get(clip.id) ?? defaultImageMeta();
        if (!m.endImage || !clip.src) return;

        const prevStart = clip.src;
        clip.src = m.endImage;
        m.endImage = prevStart;
        clip.name = clip.src.split(/[\\/]/).pop() || clip.name;
        m.mediaKind = this._mediaKindForFile(clip.src);

        if (m.mediaKind === "video") {
            clip.hasAudio = false;
            clip._audioBuffer = null;
            clip.waveformPeaks = null;
            const url = this._videoUrl(clip.src);
            void this._grabVideoThumbnail(url).then(thumb => {
                clip.thumbnail = thumb;
                this._refreshClipAppearance(clip);
            }).catch(() => this._refreshClipAppearance(clip));
            void this._fetchPeaks(url).then(r => {
                clip.waveformPeaks = r.peaks[0];
                clip.hasAudio = true;
                clip._audioBuffer = r.buffer;
                this._refreshClipAppearance(clip);
            }).catch(() => this._refreshClipAppearance(clip));
        } else {
            clip.thumbnail = this._imgUrl(clip.src);
            clip.hasAudio = false;
            clip._audioBuffer = null;
            clip.waveformPeaks = null;
        }

        this._meta.set(clip.id, m);
        this._refreshClipAppearance(clip);
        if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
    }

    _renameClip(clip) {
        if (!clip) return;
        const next = prompt(T("clip_title_prompt"), clip.name || DEFAULT_CLIP_NAME);
        if (next == null) return;
        const name = String(next).trim();
        if (!name || name === clip.name) return;
        this._recordUndo();
        clip.name = name;
        this._refreshClipAppearance(clip);
        if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
        this._saveToWidgets();
    }

    _closeClipItemsModal() {
        if (!this.clipItemsModal) return;
        this.clipItemsModal.hidden = true;
        this._clipItemsModalClipId = null;
        this.clipItemsBody?.replaceChildren();
    }

    _openClipItemsModal(clip) {
        if (!this.clipItemsModal || !clip || clip.track?.type === "audio") return;
        const m = this._ensureClipMeta(clip);
        this._normalizeVisualMeta(clip, m);
        this._clipItemsModalClipId = clip.id;
        this.clipItemsModal.hidden = false;
        if (this.clipItemsTitle) this.clipItemsTitle.textContent = T("clip_items_title_dynamic", { name: clip.name || DEFAULT_CLIP_NAME });
        this._renderClipItemsModal(clip);
    }

    _renderClipItemsModal(clip) {
        if (!this.clipItemsBody) return;
        const m = this._ensureClipMeta(clip);
        const items = this._clipItems(m);
        this.clipItemsBody.replaceChildren();
        if (!items.length) {
            const empty = document.createElement("div");
            empty.className = "cat-te-clip-items-empty";
            empty.textContent = T("empty_clip_drag_hint");
            this.clipItemsBody.appendChild(empty);
            return;
        }
        items.forEach((item, index) => {
            const row = document.createElement("div");
            row.className = "cat-te-clip-item-row";
            row.dataset.index = String(index);

            const move = document.createElement("div");
            move.className = "cat-te-clip-item-move";
            const up = document.createElement("button");
            up.type = "button";
            up.className = "cat-te-clip-item-move-btn";
            up.title = T("move_up_title");
            up.innerHTML = iconHtml("arrowUp", 12);
            up.disabled = index === 0;
            up.addEventListener("click", (e) => {
                e.stopPropagation();
                this._moveClipItem(clip, index, -1);
            });
            const down = document.createElement("button");
            down.type = "button";
            down.className = "cat-te-clip-item-move-btn";
            down.title = T("move_down_title");
            down.innerHTML = iconHtml("arrowDown", 12);
            down.disabled = index === items.length - 1;
            down.addEventListener("click", (e) => {
                e.stopPropagation();
                this._moveClipItem(clip, index, 1);
            });
            move.append(up, down);

            const thumb = document.createElement(item.kind === "video" ? "video" : "img");
            thumb.className = "cat-te-clip-item-thumb";
            thumb.src = item.kind === "video" ? this._videoUrl(item.file) : this._imgUrl(item.file);
            if (item.kind === "video") {
                thumb.muted = true;
                thumb.playsInline = true;
            }

            const name = document.createElement("div");
            name.className = "cat-te-clip-item-name";
            name.textContent = item.file.split(/[\\/]/).pop();
            name.title = item.file;

            const kind = document.createElement("span");
            kind.className = "cat-te-clip-item-kind";
            kind.textContent = item.kind === "video" ? T("media_kind_video") : T("media_kind_image");

            const enable = document.createElement("label");
            enable.className = "cat-te-clip-item-enable";
            const enableCb = document.createElement("input");
            enableCb.type = "checkbox";
            enableCb.checked = item.enabled !== false;
            enableCb.title = item.enabled !== false ? T("disable_label") : T("enable_label");
            enableCb.addEventListener("click", (e) => e.stopPropagation());
            enableCb.addEventListener("change", () => {
                this._setClipItemEnabled(clip, index, !!enableCb.checked);
            });
            const enableText = document.createElement("span");
            enableText.textContent = T("enable_label");
            enable.append(enableCb, enableText);

            const del = document.createElement("button");
            del.type = "button";
            del.className = "cat-te-clip-item-delete";
            del.title = T("delete_asset_title");
            del.innerHTML = iconHtml("trash", 12);
            del.addEventListener("click", (e) => {
                e.stopPropagation();
                this._removeClipItem(clip, index);
            });

            if (item.enabled === false) row.classList.add("is-disabled");
            row.append(move, thumb, name, kind, enable, del);
            this.clipItemsBody.appendChild(row);
        });
    }

    _setClipItemEnabled(clip, index, enabled) {
        if (!clip || clip.track?.type === "audio") return;
        const m = this._ensureClipMeta(clip);
        this._normalizeVisualMeta(clip, m, { seedFromClip: false });
        if (!m.items[index]) return;
        const next = !!enabled;
        if ((m.items[index].enabled !== false) === next) return;
        this._recordUndo();
        m.items[index].enabled = next;
        this._meta.set(clip.id, m);
        this._syncClipPrimaryAppearance(clip);
        this._scheduleProgramPreview();
        this._saveToWidgets();
        if (this._clipItemsModalClipId === clip.id) this._renderClipItemsModal(clip);
        if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
    }

    _moveClipItem(clip, index, delta) {
        if (!clip || clip.track?.type === "audio" || !delta) return;
        const m = this._ensureClipMeta(clip);
        this._normalizeVisualMeta(clip, m, { seedFromClip: false });
        const items = this._clipItems(m);
        const nextIndex = index + delta;
        if (nextIndex < 0 || nextIndex >= items.length) return;
        const next = items.slice();
        const [moved] = next.splice(index, 1);
        next.splice(nextIndex, 0, moved);
        if (!this._applyClipItemOrder(clip, next)) return;
        this._setClipPreviewItemIndex(clip, nextIndex);
        this._renderClipItemsModal(clip);
        if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
    }

    _deleteClip(clip) {
        this._recordUndo();
        this._meta.delete(clip.id);
        this._timeline.removeClip(clip.track.id, clip.id);
        if (!this._timeline.getSelectedClips().length) {
            this._timeline.selectClip(null);
        }
        this._updatePromptPanel();
    }

    _splitClip(clip) {
        const tl = this._timeline;
        const t = tl.currentTime;
        if (t <= clip.startTime || t >= clip.endTime) return;
        const track = clip.track;
        const frameMin = 1 / Math.max(1, this.getFps());
        const leftDur = t - clip.startTime;
        const rightDur = clip.endTime - t;
        if (leftDur < frameMin || rightDur < frameMin) return;

        this._recordUndo();
        const isAudio = track.type === "audio";
        const baseMeta = this._meta.get(clip.id)
            ?? (isAudio ? defaultAudioMeta() : defaultImageMeta());
        const cloneMeta = () => {
            const m = { ...baseMeta };
            if (Array.isArray(baseMeta.items)) {
                m.items = baseMeta.items.map((item) => (
                    item && typeof item === "object" ? { ...item } : item
                ));
            }
            return m;
        };
        const clipId = clip.id;
        const clipStart = clip.startTime;
        const sourceOffset = clip.sourceOffset || 0;
        const fadeIn = isAudio ? Math.max(0, clip.fadeIn || 0) : 0;
        const fadeOut = isAudio ? Math.max(0, clip.fadeOut || 0) : 0;
        const shared = {
            name: clip.name,
            src: clip.src,
            thumbnail: clip.thumbnail,
            color: clip.color,
            sourceDuration: clip.sourceDuration,
            hasAudio: !!clip.hasAudio,
            waveformPeaks: clip._waveform?.length ? clip._waveform : undefined,
        };
        const audioBuffer = clip._audioBuffer;

        tl.removeClip(track.id, clipId);
        this._meta.delete(clipId);

        const left = tl.addClip(track.id, {
            ...shared,
            startTime: clipStart,
            duration: leftDur,
            sourceOffset,
            fadeIn: Math.min(fadeIn, leftDur),
            fadeOut: 0,
        });
        left._audioBuffer = audioBuffer;
        {
            const lm = cloneMeta();
            if (isAudio) {
                lm.fadeInMs = Math.round((left.fadeIn || 0) * 1000);
                lm.fadeOutMs = 0;
            }
            this._meta.set(left.id, lm);
        }

        const right = tl.addClip(track.id, {
            ...shared,
            startTime: t,
            duration: rightDur,
            // Keep media in sync: right half continues from the split point.
            sourceOffset: sourceOffset + leftDur,
            fadeIn: 0,
            fadeOut: Math.min(fadeOut, rightDur),
        });
        right._audioBuffer = audioBuffer;
        {
            const rm = cloneMeta();
            if (isAudio) {
                rm.fadeInMs = 0;
                rm.fadeOutMs = Math.round((right.fadeOut || 0) * 1000);
            }
            this._meta.set(right.id, rm);
        }

        this._decorateClip(left);
        this._decorateClip(right);
        tl.selectClip(left);
        this._updatePromptPanel();
        this._scheduleProgramPreview();
    }

    _addMediaAtTime(filename, atSec, clientY) {
        return this._addImageAtTime(filename, atSec, clientY);
    }

    // ─── Program monitor (preview above timeline) ────────────────────────

    _ensureProgramPreviewObserver() {
        if (!this.programStage || this._programStageObserver) return;
        this._programStageObserver = new ResizeObserver(() => this._scheduleProgramPreview());
        this._programStageObserver.observe(this.programStage);
        this._bindProgramPreviewVisibility();
    }

    _bindProgramPreviewVisibility() {
        if (this._onProgramVisChange) return;
        this._onProgramVisChange = () => {
            if (document.hidden) return;
            if (!this._overlay?.classList.contains("open")) return;
            this._recoverProgramPreviewVideos();
        };
        document.addEventListener("visibilitychange", this._onProgramVisChange);
        window.addEventListener("focus", this._onProgramVisChange);
        window.addEventListener("pageshow", this._onProgramVisChange);
    }

    _unbindProgramPreviewVisibility() {
        if (!this._onProgramVisChange) return;
        document.removeEventListener("visibilitychange", this._onProgramVisChange);
        window.removeEventListener("focus", this._onProgramVisChange);
        window.removeEventListener("pageshow", this._onProgramVisChange);
        this._onProgramVisChange = null;
    }

    _clearPreviewSeekWatch(entry) {
        if (!entry?._seekTimer) return;
        clearTimeout(entry._seekTimer);
        entry._seekTimer = 0;
    }

    /** Unstick seeks that never fire "seeked" (tab switch / decoder busy). */
    _armPreviewSeekWatch(entry) {
        this._clearPreviewSeekWatch(entry);
        if (!entry) return;
        entry._seekTimer = setTimeout(() => {
            entry._seekTimer = 0;
            if (!entry.seeking) return;
            entry.seeking = false;
            const v = entry.el;
            const want = entry.wantTime || 0;
            if (v && Math.abs((v.currentTime || 0) - want) > 0.08) {
                try {
                    entry.seeking = true;
                    v.currentTime = want;
                    this._armPreviewSeekWatch(entry);
                } catch {
                    entry.seeking = false;
                }
            }
            this._scheduleProgramPreview();
        }, 450);
    }

    _recoverProgramPreviewVideos() {
        for (const entry of this._previewVideos.values()) {
            const v = entry?.el;
            if (!v) continue;
            this._clearPreviewSeekWatch(entry);
            entry.seeking = false;
            if (v.readyState >= 2) entry.ready = true;
            const want = Math.max(0, Number(entry.wantTime) || 0);
            try {
                // Nudge the decoder after background/GPU contention drops frames.
                entry.seeking = true;
                v.currentTime = want;
                this._armPreviewSeekWatch(entry);
            } catch {
                entry.seeking = false;
            }
            if (this._timeline?._playing && v.paused) {
                void v.play().catch(() => {});
            }
        }
        this._scheduleProgramPreview();
    }

    _disposeProgramPreview() {
        if (this._programPreviewRaf) {
            cancelAnimationFrame(this._programPreviewRaf);
            this._programPreviewRaf = 0;
        }
        this._programStageObserver?.disconnect();
        this._programStageObserver = null;
        this._unbindProgramPreviewVisibility();
        for (const entry of this._previewVideos.values()) {
            this._clearPreviewSeekWatch(entry);
            try {
                entry.el.pause();
                entry.el.removeAttribute("src");
                entry.el.load();
            } catch { /* ignore */ }
        }
        this._previewVideos.clear();
        this._previewImages.clear();
        this._programHadFrame = false;
        this._programCanvasKey = "";
        this._programOffscreen = null;
    }

    _scheduleProgramPreview() {
        if (!this.programCanvas || !this._overlay?.classList.contains("open")) return;
        if (this._programPreviewRaf) return;
        this._programPreviewRaf = requestAnimationFrame(() => {
            this._programPreviewRaf = 0;
            void this._renderProgramPreview();
        });
    }

    _layoutProgramCanvas() {
        const stage = this.programStage;
        const canvas = this.programCanvas;
        if (!stage || !canvas) return null;
        const { w, h } = this.getPreviewSize();
        const sw = stage.clientWidth;
        const sh = stage.clientHeight;
        if (sw < 2 || sh < 2) return null;
        const scale = Math.min(sw / w, sh / h);
        const cssW = Math.max(1, Math.floor(w * scale));
        const cssH = Math.max(1, Math.floor(h * scale));
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const pw = Math.max(1, Math.round(cssW * dpr));
        const ph = Math.max(1, Math.round(cssH * dpr));
        if (canvas.width !== pw) canvas.width = pw;
        if (canvas.height !== ph) canvas.height = ph;
        if (this.programMeta) this.programMeta.textContent = `${w} × ${h}`;
        return { canvasW: pw, canvasH: ph, logicalW: w, logicalH: h };
    }

    _ensurePreviewImage(url) {
        if (!url) return null;
        let entry = this._previewImages.get(url);
        if (entry) return entry;
        const img = new Image();
        img.decoding = "async";
        entry = { el: img, ready: false };
        img.onload = () => {
            entry.ready = true;
            const t = this._timeline?.currentTime ?? 0;
            if (this._collectPreviewLayers(t).some((layer) => layer.kind === "image")) {
                this._scheduleProgramPreview();
            }
        };
        img.onerror = () => { entry.ready = false; };
        img.src = url;
        this._previewImages.set(url, entry);
        return entry;
    }

    _ensurePreviewVideo(file, location = "input") {
        if (!file) return null;
        const key = `${location}:${file}`;
        let entry = this._previewVideos.get(key);
        if (entry) return entry;
        const v = document.createElement("video");
        v.muted = true;
        v.playsInline = true;
        v.preload = "auto";
        entry = { el: v, ready: false, seeking: false, wantTime: 0, _seekTimer: 0 };
        const kick = () => {
            entry.ready = v.readyState >= 2;
            this._scheduleProgramPreview();
        };
        v.addEventListener("loadeddata", kick);
        v.addEventListener("canplay", kick);
        v.addEventListener("playing", () => this._scheduleProgramPreview());
        v.addEventListener("seeked", () => {
            this._clearPreviewSeekWatch(entry);
            entry.seeking = false;
            entry.ready = v.readyState >= 2;
            const playing = !!this._timeline?._playing;
            const drift = Math.abs((entry.wantTime || 0) - v.currentTime);
            if (!playing && drift > 0.05) {
                this._seekPreviewVideo(entry, entry.wantTime);
            } else {
                this._scheduleProgramPreview();
            }
        });
        v.addEventListener("error", () => { entry.ready = false; });
        v.addEventListener("stalled", () => this._scheduleProgramPreview());
        v.addEventListener("suspend", () => {
            // Decoder may drop frames under GPU load — retry shortly.
            setTimeout(() => this._scheduleProgramPreview(), 200);
        });
        v.src = location === "output" ? this._outputVideoUrl(file) : this._videoUrl(file);
        this._previewVideos.set(key, entry);
        return entry;
    }

    _seekPreviewVideo(entry, mediaTime) {
        if (!entry?.el) return;
        const v = entry.el;
        const t = Math.max(0, Number(mediaTime) || 0);
        const dur = Number.isFinite(v.duration) ? v.duration : null;
        const clamped = dur != null && dur > 0 ? Math.min(t, Math.max(0, dur - 0.001)) : t;
        entry.wantTime = clamped;
        if (!entry.ready && v.readyState < 1) return;
        if (entry.seeking) return;
        const eps = this._timeline?._playing ? 0.25 : 0.04;
        if (Math.abs((v.currentTime || 0) - clamped) <= eps) return;
        entry.seeking = true;
        this._armPreviewSeekWatch(entry);
        try {
            v.currentTime = clamped;
        } catch {
            entry.seeking = false;
            this._clearPreviewSeekWatch(entry);
        }
    }

    _syncPreviewVideo(entry, mediaTime, { audible = false } = {}) {
        if (!entry?.el) return;
        const v = entry.el;
        const t = Math.max(0, Number(mediaTime) || 0);
        const dur = Number.isFinite(v.duration) ? v.duration : null;
        const clamped = dur != null && dur > 0 ? Math.min(t, Math.max(0, dur - 0.001)) : t;
        entry.wantTime = clamped;
        const playing = !!this._timeline?._playing;
        // Only unmute during timeline play when this layer should be heard.
        v.muted = !(playing && audible);
        if (playing) {
            const drift = Math.abs((v.currentTime || 0) - clamped);
            if (drift > 0.25) this._seekPreviewVideo(entry, clamped);
            if (v.paused && (entry.ready || v.readyState >= 2)) {
                void v.play().catch(() => {});
            }
            return;
        }
        if (!v.paused) v.pause();
        this._seekPreviewVideo(entry, clamped);
    }

    _previewVideoCanDraw(entry) {
        const v = entry?.el;
        // While a seek is pending, skip drawing rather than paint a stale
        // pre-seek frame — the canvas keeps the previous good frame instead
        // of clearing to black. "seeked" / seek-watch already reschedule.
        return !!(
            v
            && !entry.seeking
            && v.readyState >= 2
            && v.videoWidth > 0
            && v.videoHeight > 0
        );
    }

    _pauseUnusedPreviewVideos(usedKeys) {
        for (const [key, entry] of this._previewVideos) {
            if (usedKeys.has(key)) continue;
            if (!entry.el.paused) entry.el.pause();
            entry.el.muted = true;
        }
    }

    _drawCover(ctx, media, cw, ch) {
        const mw = media.videoWidth || media.naturalWidth || media.width || 0;
        const mh = media.videoHeight || media.naturalHeight || media.height || 0;
        if (!mw || !mh) return false;
        const scale = Math.max(cw / mw, ch / mh);
        const dw = mw * scale;
        const dh = mh * scale;
        try {
            ctx.drawImage(media, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
        } catch {
            return false;
        }
        return true;
    }

    _clipPreviewItemAtTime(clip, items, t) {
        if (!items?.length) return null;
        if (items.length === 1) return { item: items[0], index: 0 };
        const dur = Math.max(1e-6, clip.duration);
        const localT = Math.max(0, Math.min(dur - 1e-9, t - clip.startTime));
        const index = Math.min(items.length - 1, Math.floor((localT / dur) * items.length));
        return { item: items[index], index };
    }

    _collectPreviewLayers(t) {
        const layers = [];
        // tracks[] has overlays first (top), then main — paint bottom→top via reverse.
        for (const track of [...this._allImageTracks()].reverse()) {
            if (track.visible === false) continue;
            const info = this._trackInfo.get(track.id) || {};
            if (info.enabled === false) continue;
            for (const clip of track.clips) {
                if (!(t >= clip.startTime - 1e-6 && t < clip.endTime - 1e-9)) continue;
                const m = this._meta.get(clip.id) ?? defaultImageMeta();
                if (m.disabled || m.visible === false) continue;
                const gen = this._clipUsesGeneratedPreview(m) ? this._firstEnabledGeneratedVideo(m) : null;
                if (gen) {
                    layers.push({
                        kind: "generated",
                        clip,
                        meta: m,
                        file: gen.file,
                        muted: gen.muted === true,
                    });
                    continue;
                }
                const items = this._enabledClipItems(m);
                if (!items.length) {
                    layers.push({ kind: "package", clip, meta: m });
                    continue;
                }
                const at = this._clipPreviewItemAtTime(clip, items, t);
                const item = at?.item || items[0];
                layers.push({
                    kind: item.kind === "video" ? "video" : "image",
                    clip,
                    meta: m,
                    item,
                    itemIndex: at?.index ?? 0,
                    items,
                });
            }
        }
        if (layers.some((layer) => layer.kind === "generated")) {
            return layers.filter((layer) => layer.kind !== "image" && layer.kind !== "package");
        }
        return layers;
    }

    /** Draw the timeline's layers (generated/video/image/package) at time `t`
     * into any canvas context — shared by the main program monitor and the
     * compose modal's watermark preview. Does not touch video pause/resume
     * bookkeeping; pass `onVideoUsed` to track that in the caller. */
    _drawPreviewLayersOnce(ctx, cw, ch, t, { onVideoUsed } = {}) {
        const layers = this._collectPreviewLayers(t);
        const generatedActive = layers.some((layer) => layer.kind === "generated");
        let drew = false;

        for (const layer of layers) {
            if (generatedActive && (layer.kind === "image" || layer.kind === "package")) continue;
            if (layer.kind === "package") {
                ctx.fillStyle = "#1a1a28";
                ctx.fillRect(0, 0, cw, ch);
                ctx.fillStyle = "#8a8ab0";
                ctx.font = `${Math.max(12, Math.round(ch * 0.06))}px sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(layer.clip.name || DEFAULT_CLIP_NAME, cw / 2, ch / 2);
                drew = true;
                continue;
            }
            if (layer.kind === "generated" || layer.kind === "video") {
                const file = layer.kind === "generated" ? layer.file : (layer.item?.file || layer.clip.src);
                const location = layer.kind === "generated" ? "output" : "input";
                const entry = this._ensurePreviewVideo(file, location);
                if (!entry) continue;
                onVideoUsed?.(`${location}:${file}`);
                const items = layer.items || [];
                let mediaTime = (layer.clip.sourceOffset || 0) + (t - layer.clip.startTime);
                if (layer.kind === "generated") mediaTime = t - layer.clip.startTime;
                else if (items.length > 1) {
                    const slice = layer.clip.duration / items.length;
                    mediaTime = Math.max(0, (t - layer.clip.startTime) - (layer.itemIndex || 0) * slice);
                }
                this._syncPreviewVideo(entry, mediaTime, {
                    audible: layer.kind === "generated" && layer.muted !== true,
                });
                if (this._previewVideoCanDraw(entry) && this._drawCover(ctx, entry.el, cw, ch)) {
                    drew = true;
                }
                continue;
            }
            const items = layer.items || [];
            for (const item of items) {
                if (item.kind !== "video") this._ensurePreviewImage(this._imgUrl(item.file));
            }
            const file = layer.item?.file || layer.clip.src;
            const startEntry = this._ensurePreviewImage(file ? this._imgUrl(file) : "");
            if (startEntry?.ready) {
                if (this._drawCover(ctx, startEntry.el, cw, ch)) drew = true;
            }
        }
        return drew;
    }

    _hasVisibleSubtitleAt(t) {
        for (const track of this._allTextTracks()) {
            if (track.visible === false) continue;
            const info = this._trackInfo.get(track.id) || {};
            if (info.enabled === false) continue;
            for (const clip of track.clips) {
                if (!(t >= clip.startTime - 1e-6 && t < clip.endTime - 1e-9)) continue;
                const m = this._meta.get(clip.id) ?? defaultSubtitleMeta();
                if (m.disabled || m.visible === false) continue;
                if (String(m.text || "").trim()) return true;
            }
        }
        return false;
    }

    async _renderProgramPreview() {
        const layout = this._layoutProgramCanvas();
        const canvas = this.programCanvas;
        if (!layout || !canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const { canvasW: cw, canvasH: ch } = layout;
        const sizeKey = `${cw}x${ch}`;
        const sizeChanged = this._programCanvasKey !== sizeKey;
        this._programCanvasKey = sizeKey;

        const t = this._timeline?.currentTime ?? 0;
        const layers = this._collectPreviewLayers(t);
        const hasSub = this._hasVisibleSubtitleAt(t);
        const usedVideoKeys = new Set();

        if (!layers.length && !hasSub) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, cw, ch);
            this._pauseUnusedPreviewVideos(usedVideoKeys);
            this._programHadFrame = false;
            if (this.programEmpty) this.programEmpty.hidden = false;
            return;
        }

        // Draw offscreen first. If video is mid-seek / decoder busy, keep the
        // previous on-screen frame instead of flashing black.
        let off = this._programOffscreen;
        if (!off || off.width !== cw || off.height !== ch) {
            off = document.createElement("canvas");
            off.width = cw;
            off.height = ch;
            this._programOffscreen = off;
        }
        const octx = off.getContext("2d");
        if (!octx) return;
        octx.setTransform(1, 0, 0, 1, 0, 0);
        octx.fillStyle = "#000";
        octx.fillRect(0, 0, cw, ch);
        const drewVisual = this._drawPreviewLayersOnce(octx, cw, ch, t, {
            onVideoUsed: (key) => usedVideoKeys.add(key),
        });
        this._drawSubtitleOverlays(octx, cw, ch, t);
        const drew = drewVisual || hasSub;
        this._pauseUnusedPreviewVideos(usedVideoKeys);

        if (drew || sizeChanged || !this._programHadFrame) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            if (drew) {
                ctx.drawImage(off, 0, 0);
                this._programHadFrame = true;
            } else {
                ctx.fillStyle = "#000";
                ctx.fillRect(0, 0, cw, ch);
                this._programHadFrame = false;
            }
        }
        if (this.programEmpty) this.programEmpty.hidden = this._programHadFrame;
    }

    _configureTimelineUi() {
        const tl = this._timeline;
        if (!tl) return;
        this.footerPlayback.replaceChildren(tl.playbackControlsEl);

        const packageBtn = document.createElement("button");
        packageBtn.type = "button";
        packageBtn.className = "tl-btn tl-btn-add-package";
        packageBtn.title = T("insert_empty_clip_title");
        packageBtn.textContent = T("insert_clip_btn");
        packageBtn.addEventListener("click", (e) => this._showInsertClipMenu(e));
        tl.toolbarEl.appendChild(packageBtn);

        this.allGenPreviewBtn = document.createElement("button");
        this.allGenPreviewBtn.type = "button";
        this.allGenPreviewBtn.className = "tl-btn tl-btn-all-gen-preview";
        this.allGenPreviewBtn.addEventListener("click", () => this._toggleAllGeneratedPreview());
        tl.toolbarEl.appendChild(this.allGenPreviewBtn);
        this._updateAllGeneratedPreviewButton();

        this.runMenuBtn = document.createElement("button");
        this.runMenuBtn.type = "button";
        this.runMenuBtn.className = "tl-btn tl-btn-run-menu";
        this.runMenuBtn.textContent = T("run_btn_caret");
        this.runMenuBtn.title = T("run_menu_title");
        this.runMenuBtn.addEventListener("click", (e) => this._showRunMenu(e));
        tl.toolbarEl.appendChild(this.runMenuBtn);

        // Timeline undo/redo: Ctrl/Cmd+Z/Y are intercepted in handleShortcutKey
        // (capture on window) so ComfyUI graph-undo cannot close this editor.
        this.undoBtn = document.createElement("button");
        this.undoBtn.type = "button";
        this.undoBtn.className = "tl-btn tl-btn-history";
        this.undoBtn.title = T("undo_title");
        this.undoBtn.textContent = T("undo_btn_label");
        this.undoBtn.addEventListener("click", () => this.undo());

        this.redoBtn = document.createElement("button");
        this.redoBtn.type = "button";
        this.redoBtn.className = "tl-btn tl-btn-history";
        this.redoBtn.title = T("redo_title");
        this.redoBtn.textContent = T("redo_btn_label");
        this.redoBtn.addEventListener("click", () => this.redo());
        tl.toolbarEl.prepend(this.undoBtn, this.redoBtn);

        this._updateHistoryButtons();

        // Replace Timeline's built-in add-track menu with the same ctx popup as Run.
        const addTrackBtn = tl.toolbarEl.querySelector(".tl-btn-add-track");
        if (addTrackBtn) {
            const neu = addTrackBtn.cloneNode(true);
            addTrackBtn.replaceWith(neu);
            neu.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._recordUndo();
                this._showAddTrackMenu(e);
            });
        }

        tl._tracksEl?.addEventListener("dblclick", (e) => {
            if (e.target.closest?.(".tl-clip")) return;
            const trackEl = e.target.closest?.(".tl-track");
            if (!trackEl) return;
            const track = tl.tracks.find((row) => row.el === trackEl);
            if (!isSubtitleTrackType(track?.type) || track.locked) return;
            const rect = tl.scrollEl.getBoundingClientRect();
            const x = e.clientX - rect.left + tl.scrollEl.scrollLeft;
            const at = Math.max(0, x / Math.max(1e-6, tl.pixelsPerSecond));
            this._insertSubtitleAtTime(at, track);
        });

        const scroll = tl.scrollEl;
        scroll.addEventListener("dragover", (e) => {
            if (!this._dndMedia?.file) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            scroll.classList.add("cat-te-drop-active");
        });
        scroll.addEventListener("dragleave", (e) => {
            if (!scroll.contains(e.relatedTarget)) scroll.classList.remove("cat-te-drop-active");
        });
        scroll.addEventListener("drop", (e) => {
            scroll.classList.remove("cat-te-drop-active");
            const media = this._dndMedia;
            this._dndMedia = null;
            if (!media?.file) return;
            e.preventDefault();
            this._commitMediaDrop(media, e.clientX, e.clientY);
        });
        scroll.addEventListener("contextmenu", (e) => {
            const clipEl = e.target.closest?.(".tl-clip");
            if (!clipEl) {
                if (!CapTimelineEditorApp._clipClipboard?.length) return;
                e.preventDefault();
                this._buildCtxMenu(
                    [{ label: T("menu_paste_shortcut"), fn: () => this._pasteClips() }],
                    e.clientX,
                    e.clientY,
                );
                return;
            }
            e.preventDefault();
            const clip = this._findClipById(clipEl.dataset.clipId);
            if (clip) this._showClipCtxMenu(clip, e);
        });
    }

    _bindTimelineEvents() {
        const tl = this._timeline;
        tl.on("clip:select", ({ selected }) => {
            this._selClips = selected ?? tl.getSelectedClips();
            this._syncSelectedClip();
            // Do not focus the overlay here: focus during clip mousedown aborts
            // the mouse sequence and can leave drag listeners stuck, which then
            // eat sidebar clicks (settings look dead, drag feels broken).
            try {
                this._updatePromptPanel();
                this._retargetOutputVideosPickerFromSelection();
            } catch (err) {
                console.error("[CapTE] clip settings panel sync failed", err);
            }
        });
        tl.on("clip:add", ({ clip }) => {
            this._decorateClip(clip);
            this._renderMediaGrid();
            this._scheduleProgramPreview();
        });
        tl.on("clip:deselect", () => {
            this._selClip = null;
            this._selClips = [];
            this._updatePromptPanel();
        });
        tl.on("clip:remove", ({ clipId, trackId }) => {
            this._meta.delete(clipId);
            this._syncSelectedClip();
            this._updatePromptPanel();
            this._refreshTimelineDuration();
            this._pruneEmptyTrack(tl.getTrack(trackId));
            this._renderMediaGrid();
            this._scheduleProgramPreview();
        });
        tl.on("clip:trackchange", ({ clip, from, to }) => {
            const m = this._meta.get(clip.id)
                ?? (to.type === "audio"
                    ? defaultAudioMeta()
                    : isSubtitleTrackType(to.type)
                        ? defaultSubtitleMeta()
                        : defaultImageMeta());
            m.trackIndex = this._trackIndex(to);
            if (to.type === "audio") m.clipType = "audio";
            else if (isSubtitleTrackType(to.type)) m.clipType = "subtitle";
            else m.clipType = "image";
            this._meta.set(clip.id, m);
            this._updateClipInfoPanel(clip);
            this._pruneEmptyTrack(from);
            this._scheduleProgramPreview();
        });
        tl.on("track:remove", ({ trackId }) => {
            this._trackInfo.delete(trackId);
            this._scheduleProgramPreview();
        });
        // Per-frame move/resize: only refresh the info readout. Duration /
        // program preview run on gesture end - refreshing duration every
        // frame can clamp the live drag against a shrinking timeline.
        tl.on("clip:move", ({ clip }) => {
            if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
        });
        tl.on("clip:resize", ({ clip }) => {
            if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
        });
        // A drag (move/trim) fires many per-frame events; only the gesture
        // as a whole should become one undo step, and only if it actually
        // changed anything.
        tl.on("clip:movestart", () => this._beginPendingUndo());
        tl.on("clip:moveend", ({ moved }) => {
            this._commitPendingUndo(moved);
            this._refreshTimelineDuration();
            this._scheduleProgramPreview();
        });
        tl.on("clip:resizestart", () => this._beginPendingUndo());
        tl.on("clip:resizeend", ({ clip, moved }) => {
            this._syncAudioFadeMeta(clip);
            this._commitPendingUndo(moved);
            this._refreshTimelineDuration();
            this._scheduleProgramPreview();
        });
        tl.on("clip:fadestart", () => this._beginPendingUndo());
        tl.on("clip:fadeend", ({ clip, moved }) => {
            this._syncAudioFadeMeta(clip);
            this._commitPendingUndo(moved);
        });
        tl.on("clip:fade", ({ clip }) => {
            if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
            if (this._timeline?._playing) this._startAudioPlayback();
        });
        tl.on("track:add", ({ track }) => {
            if (!this._trackInfo.has(track.id)) {
                this._trackInfo.set(track.id, { trackIndex: this._nextTrackIndex() });
            }
            const h = trackHeightFor(track.type);
            track.height = h;
            track.el.style.height = `${h}px`;
            track.headerEl.style.height = `${h}px`;
            this._setupTrackControls(track);
        });
        tl.on("zoomchange", () => this._refreshTimelineDuration());
        tl.on("play", () => {
            this._startAudioPlayback();
            this._scheduleProgramPreview();
        });
        tl.on("pause", () => {
            this._stopAudioPlayback();
            this._pauseUnusedPreviewVideos(new Set());
            this._scheduleProgramPreview();
        });
        tl.on("timechange", () => this._scheduleProgramPreview());
        tl.on("seek", () => {
            this._updateMediaPreviewInsertBtn();
            this._scheduleProgramPreview();
            if (!tl._playing) return;
            if (this._seekAudioRaf) cancelAnimationFrame(this._seekAudioRaf);
            this._seekAudioRaf = requestAnimationFrame(() => {
                this._seekAudioRaf = null;
                this._startAudioPlayback();
            });
        });
        if (!this._onWinResize) {
            this._onWinResize = () => {
                if (this._overlay?.classList.contains("open") && this._timeline) {
                    this._refreshTimelineDuration();
                    this._scheduleProgramPreview();
                }
            };
            window.addEventListener("resize", this._onWinResize);
        }
    }

    _clearClipInfoPanel() {
        if (this.clipInfoDetail) this.clipInfoDetail.hidden = true;
        if (this.clipThumb) {
            this.clipThumb.removeAttribute("src");
            this.clipThumb.style.display = "";
            this.clipThumb.parentElement?.classList.remove("cat-te-clip-thumb-audio");
        }
        this.clipThumbWrap?.classList.remove("cat-te-clip-thumb-clickable", "cat-te-clip-thumb-audio");
        this.clipThumbWrap?.removeAttribute("title");
        if (this.clipNameEl) this.clipNameEl.textContent = "";
        if (this.clipIdEl) {
            this.clipIdEl.hidden = true;
            this.clipIdEl.textContent = "";
        }
        if (this.clipStartEl) this.clipStartEl.textContent = "";
        if (this.clipEndEl) this.clipEndEl.textContent = "";
        if (this.clipSourceTrimEl) this.clipSourceTrimEl.hidden = true;
        if (this.clipSourceInEl) this.clipSourceInEl.textContent = "";
        if (this.clipSourceOutEl) this.clipSourceOutEl.textContent = "";
        if (this.clipSourceDurEl) {
            this.clipSourceDurEl.hidden = true;
            this.clipSourceDurEl.textContent = "";
        }
        if (this.clipDurEl) this.clipDurEl.textContent = "";
        if (this.clipItemIndexEl) this.clipItemIndexEl.textContent = "";
        if (this.clipThumbVideo) {
            this.clipThumbVideo.pause();
            this.clipThumbVideo.removeAttribute("src");
            this.clipThumbVideo.hidden = true;
        }
        if (this.clipThumbEmpty) this.clipThumbEmpty.hidden = true;
        if (this.clipThumbSubtitle) this.clipThumbSubtitle.hidden = true;
        if (this.clipSwiperPrev) this.clipSwiperPrev.hidden = true;
        if (this.clipSwiperNext) this.clipSwiperNext.hidden = true;
        if (this.clipThumbSortBtn) this.clipThumbSortBtn.hidden = true;
        if (this.clipThumbDeleteBtn) this.clipThumbDeleteBtn.hidden = true;
        if (this.clipVideosHost) this.clipVideosHost.hidden = true;
        this.clipVideosList?.replaceChildren();
        this._syncCurrentMediaPromptUi(null, false);
    }
    _stepClipPreview(delta) {
        const clip = this._selClip;
        if (!clip) return;
        const m = this._ensureClipMeta(clip);
        const items = this._clipItems(m);
        if (items.length <= 1) return;
        this._setClipPreviewItemIndex(clip, this._clipPreviewItemIndex(clip, m) + delta);
        this._updateClipInfoPanel(clip);
    }

    _updateClipInfoPanel(clip) {
        if (!clip) {
            this._clearClipInfoPanel();
            return;
        }
        const tl = this._timeline;
        const track = clip.track;
        const isAudio = track.type === "audio";
        const isSubtitle = isSubtitleTrackType(track.type);
        // Reset thumb overlays before any meta work that might throw.
        if (this.clipThumbVideo) {
            this.clipThumbVideo.pause();
            this.clipThumbVideo.hidden = true;
        }
        if (this.clipThumbEmpty) this.clipThumbEmpty.hidden = true;
        if (this.clipThumbSubtitle) this.clipThumbSubtitle.hidden = true;
        this.clipThumbWrap?.classList.remove("cat-te-clip-thumb-audio");
        if (this.clipThumb) {
            this.clipThumb.style.display = "";
            this.clipThumb.parentElement?.classList.remove("cat-te-clip-thumb-audio");
        }

        const m = this._ensureClipMeta(clip);
        const items = (isAudio || isSubtitle) ? [] : this._clipItems(m);
        const idx = this._clipPreviewItemIndex(clip, m);
        const current = items[idx] || null;
        if (this.clipInfoDetail) this.clipInfoDetail.hidden = false;

        if (isAudio) {
            if (this.clipThumb) {
                this.clipThumb.removeAttribute("src");
                this.clipThumb.style.display = "none";
                this.clipThumb.parentElement?.classList.add("cat-te-clip-thumb-audio");
            }
            this.clipThumbWrap?.classList.add("cat-te-clip-thumb-audio");
        } else if (isSubtitle) {
            if (this.clipThumb) {
                this.clipThumb.removeAttribute("src");
                this.clipThumb.style.display = "none";
            }
            if (this.clipThumbSubtitle) this.clipThumbSubtitle.hidden = false;
        } else if (!current) {
            if (this.clipThumb) {
                this.clipThumb.removeAttribute("src");
                this.clipThumb.style.display = "none";
            }
            if (this.clipThumbEmpty) this.clipThumbEmpty.hidden = false;
        } else if (current.kind === "video") {
            if (this.clipThumb) {
                this.clipThumb.removeAttribute("src");
                this.clipThumb.style.display = "none";
            }
            if (this.clipThumbVideo) {
                this.clipThumbVideo.hidden = false;
                const url = this._videoUrl(current.file);
                if (this.clipThumbVideo.src !== url) this.clipThumbVideo.src = url;
            }
        } else if (this.clipThumb) {
            this.clipThumb.style.display = "";
            this.clipThumb.src = this._imgUrl(current.file);
        }

        const canPreview = isAudio ? !!clip.src : isSubtitle ? false : !!current;
        if (this.clipThumbWrap) {
            this.clipThumbWrap.classList.toggle("cat-te-clip-thumb-clickable", canPreview);
            this.clipThumbWrap.title = canPreview ? T("click_to_preview_asset_title") : "";
        }
        if (this.clipNameEl) {
            this.clipNameEl.textContent = isSubtitle
                ? ((m.text || clip.name || T("subtitle_default_text")).trim() || T("subtitle_default_text"))
                : (current?.file?.split(/[\\/]/).pop() || clip.name || DEFAULT_CLIP_NAME);
        }
        if (this.clipIdEl) {
            const id = String(clip.id || "").trim();
            this.clipIdEl.hidden = !id;
            this.clipIdEl.textContent = id ? T("clip_id_label", { id }) : "";
        }
        if (this.clipStartEl) this.clipStartEl.textContent = tl.formatTime(clip.startTime);
        if (this.clipEndEl) this.clipEndEl.textContent = tl.formatTime(clip.endTime);
        const fps = this.getFps();
        const totalFrames = Math.max(0, frameIndexFromSecs(clip.endTime, fps) - frameIndexFromSecs(clip.startTime, fps));
        if (this.clipDurEl) {
            this.clipDurEl.textContent = T("clip_duration_frames", { duration: tl.formatTime(clip.duration), frames: totalFrames });
        }
        if (isAudio) {
            const srcIn = Math.max(0, Number(clip.sourceOffset) || Number(m.trimIn) || 0);
            const srcOut = srcIn + Math.max(0, Number(clip.duration) || 0);
            const srcDur = Math.max(0, Number(clip.sourceDuration ?? m.sourceDuration) || 0);
            if (this.clipSourceTrimLabelEl) this.clipSourceTrimLabelEl.textContent = T("clip_source_trim_label");
            if (this.clipSourceInEl) this.clipSourceInEl.textContent = tl.formatTime(srcIn);
            if (this.clipSourceOutEl) this.clipSourceOutEl.textContent = tl.formatTime(srcOut);
            if (this.clipSourceTrimEl) this.clipSourceTrimEl.hidden = false;
            if (this.clipSourceDurEl) {
                if (srcDur > 0) {
                    this.clipSourceDurEl.hidden = false;
                    this.clipSourceDurEl.textContent = T("clip_source_duration", { duration: tl.formatTime(srcDur) });
                } else {
                    this.clipSourceDurEl.hidden = true;
                    this.clipSourceDurEl.textContent = "";
                }
            }
        } else {
            if (this.clipSourceTrimEl) this.clipSourceTrimEl.hidden = true;
            if (this.clipSourceDurEl) {
                this.clipSourceDurEl.hidden = true;
                this.clipSourceDurEl.textContent = "";
            }
        }
        if (this.clipItemIndexEl) {
            this.clipItemIndexEl.textContent = current ? `${idx + 1}/${items.length}` : "";
        }
        const multi = items.length > 1;
        if (this.clipSwiperPrev) this.clipSwiperPrev.hidden = !multi;
        if (this.clipSwiperNext) this.clipSwiperNext.hidden = !multi;
        if (this.clipThumbSortBtn) this.clipThumbSortBtn.hidden = isAudio || isSubtitle;
        if (this.clipThumbDeleteBtn) this.clipThumbDeleteBtn.hidden = isAudio || isSubtitle || !current;
        this._renderClipGeneratedVideosList(clip, m, isAudio || isSubtitle);
        this._syncCurrentMediaPromptUi(current, !isAudio && !isSubtitle);
    }

    _syncCurrentMediaPromptUi(current, enabled) {
        const hasItem = !!(enabled && current);
        const row = this.useMediaPromptCb?.closest(".cat-te-use-media-prompt");
        if (row) row.hidden = !hasItem;
        if (this.useMediaPromptCb) {
            this.useMediaPromptCb.disabled = !hasItem;
            this.useMediaPromptCb.checked = hasItem && current.useMediaPrompt !== false;
        }
    }

    _onUseMediaPromptChange() {
        const clip = this._selClip;
        if (!clip || clip.track?.type === "audio" || !this.useMediaPromptCb) return;
        const m = this._ensureClipMeta(clip);
        this._normalizeVisualMeta(clip, m, { seedFromClip: false });
        const idx = this._clipPreviewItemIndex(clip, m);
        if (!m.items[idx]) return;
        this._recordUndo();
        m.items[idx].useMediaPrompt = !!this.useMediaPromptCb.checked;
        this._meta.set(clip.id, m);
        this._saveToWidgets();
    }

    /** Ensure `_meta` has an entry for `clip` (create defaults if missing). */
    _ensureClipMeta(clip) {
        if (!clip) return null;
        let m = this._meta.get(clip.id);
        if (!m) {
            const ti = this._trackIndex(clip.track);
            if (clip.track?.type === "audio") m = defaultAudioMeta(ti);
            else if (isSubtitleTrackType(clip.track?.type)) m = defaultSubtitleMeta(ti);
            else m = defaultImageMeta(ti);
            this._meta.set(clip.id, m);
        }
        if (clip.track?.type !== "audio" && !isSubtitleClipMeta(m, clip.track)) {
            this._normalizeVisualMeta(clip, m);
        }
        return m;
    }

    /** Re-resolve right-panel setting controls if refs are stale/missing. */
    _syncClipSettingRefs() {
        const el = this._overlay;
        if (!el) return;
        const head = el.querySelector(".cat-te-head-extend");
        const tail = el.querySelector(".cat-te-tail-extend");
        const gen = el.querySelector(".cat-te-gen-preview-video");
        const secondSample = el.querySelector(".cat-te-second-sample");
        const role = el.querySelector(".cat-te-clip-role");
        const agent = el.querySelector(".cat-te-clip-agent");
        if (!head) return;
        this.headExtendInput = head;
        this.tailExtendInput = tail;
        this.genPreviewVideoCb = gen;
        this.secondSampleCb = secondSample;
        this.clipRoleSelect = role;
        this.clipRoleCustomInput = el.querySelector(".cat-te-clip-role-custom");
        this.clipRoleCustomRow = el.querySelector(".cat-te-clip-role-custom-row");
        this.clipAgentSelect = agent;
        this.clipAgentCustomInput = el.querySelector(".cat-te-clip-agent-custom");
        this.clipAgentCustomRow = el.querySelector(".cat-te-clip-agent-custom-row");
        if (!head._catTeBound) {
            head._catTeBound = true;
            head.addEventListener("change", () => this._onHeadExtendChange());
            tail?.addEventListener("change", () => this._onTailExtendChange());
            gen?.addEventListener("change", () => this._onGenPreviewVideoChange());
            secondSample?.addEventListener("change", () => this._onSecondSampleChange());
        }
    }

    _setVisualSettingsEnabled(enabled, m = null) {
        const disabled = !enabled;
        if (this.headExtendInput) {
            this.headExtendInput.disabled = disabled;
            this.headExtendInput.value = enabled
                ? String(Math.max(0, Math.round(Number(m?.headExtendSec) || 0)))
                : "0";
        }
        if (this.tailExtendInput) {
            this.tailExtendInput.disabled = disabled;
            this.tailExtendInput.value = enabled
                ? String(Math.max(0, Math.round(Number(m?.tailExtendSec) || 0)))
                : "0";
        }
        if (this.genPreviewVideoCb) {
            this.genPreviewVideoCb.disabled = disabled;
            this.genPreviewVideoCb.checked = enabled && !!m?.generatePreviewVideo;
        }
        if (this.secondSampleCb) {
            this.secondSampleCb.disabled = disabled;
            this.secondSampleCb.checked = enabled && !!m?.secondSample;
        }
        if (this.clipRoleSelect) {
            this.clipRoleSelect.disabled = disabled;
            this.clipRoleSelect.value = enabled ? this._knownClipRole(m?.clipRole) : "multi_ref";
        }
        if (this.clipAgentSelect) {
            this.clipAgentSelect.disabled = disabled;
            this.clipAgentSelect.value = enabled
                ? (m?.agent === "other" ? "other" : this._knownClipAgent(m?.agent))
                : "MiniMaxH3";
        }
        if (this.clipRoleCustomInput) {
            this.clipRoleCustomInput.disabled = disabled || m?.clipRole !== "other";
            this.clipRoleCustomInput.value = enabled ? (m?.clipRoleCustom || "") : "";
        }
        if (this.clipAgentCustomInput) {
            this.clipAgentCustomInput.disabled = disabled || m?.agent !== "other";
            this.clipAgentCustomInput.value = enabled ? (m?.agentCustom || "") : "";
        }
        this.clipRoleCustomRow && (this.clipRoleCustomRow.hidden = !enabled || m?.clipRole !== "other");
        this.clipAgentCustomRow && (this.clipAgentCustomRow.hidden = !enabled || m?.agent !== "other");
        if (this.aiOptimizeBtn) this.aiOptimizeBtn.disabled = !enabled;
    }

    _disableVisualPromptControls() {
        this._setVisualSettingsEnabled(false);
        if (this.promptInput) this.promptInput.disabled = true;
        if (this.aiPromptInput) this.aiPromptInput.disabled = true;
        if (this.useGlobalCb) this.useGlobalCb.disabled = true;
        if (this.useAiPromptCb) this.useAiPromptCb.disabled = true;
        if (this.useMediaPromptCb) {
            this.useMediaPromptCb.disabled = true;
            this.useMediaPromptCb.checked = true;
        }
        try {
            setRichPromptValue(this.promptInput, "", false);
            setRichPromptValue(this.aiPromptInput, "", false);
        } catch (err) {
            console.error("[CapTE] clear prompt failed", err);
        }
    }

    _updatePromptPanel() {
        const clip = this._syncSelectedClip();
        this._syncClipSettingRefs();
        this._syncSidebarMode(!!clip);
        const isAudio = clip?.track?.type === "audio";
        const isSubtitle = isSubtitleTrackType(clip?.track?.type);
        const isVisual = !!clip && !isAudio && !isSubtitle;
        // Unlock / show panels before any meta / info work. Controls ship as
        // HTML `disabled`; a throw in _ensureClipMeta or info view used to
        // leave the sidebar looking interactive but dead.
        if (this.visualClipBody) this.visualClipBody.hidden = !isVisual;
        if (this.subtitlePanel) this.subtitlePanel.hidden = !clip || !isSubtitle;
        if (!clip || isAudio || isSubtitle) {
            this._disableVisualPromptControls();
            if (!clip) {
                if (this.useAiPromptCb) this.useAiPromptCb.checked = true;
                this._setClipPromptTab("clip");
            }
        } else {
            // Enable immediately with whatever meta we already have (or defaults).
            // Full normalize can throw on corrupt media rows — do that after unlock.
            let m = this._meta.get(clip.id) || defaultImageMeta(this._trackIndex(clip.track));
            this._setVisualSettingsEnabled(true, m);
            if (this.promptInput) this.promptInput.disabled = false;
            if (this.aiPromptInput) this.aiPromptInput.disabled = false;
            if (this.useGlobalCb) {
                this.useGlobalCb.disabled = false;
                this.useGlobalCb.checked = m.useGlobalPrompt !== false;
            }
            if (this.useAiPromptCb) {
                this.useAiPromptCb.disabled = false;
                this.useAiPromptCb.checked = m.useAiPrompt !== false;
            }
            try {
                m = this._ensureClipMeta(clip) || m;
                this._setVisualSettingsEnabled(true, m);
                if (this.useGlobalCb) this.useGlobalCb.checked = m.useGlobalPrompt !== false;
                if (this.useAiPromptCb) this.useAiPromptCb.checked = m.useAiPrompt !== false;
                setRichPromptValue(this.promptInput, m.prompt ?? "", true);
                setRichPromptValue(this.aiPromptInput, m.aiPrompt ?? "", true);
            } catch (err) {
                console.error("[CapTE] clip meta / prompt fill failed", err);
                try {
                    setRichPromptValue(this.promptInput, m.prompt ?? "", true);
                    setRichPromptValue(this.aiPromptInput, m.aiPrompt ?? "", true);
                } catch { /* keep controls enabled */ }
            }
        }
        if (isSubtitle) {
            try {
                this._fillSubtitlePanel(this._ensureClipMeta(clip));
            } catch (err) {
                console.error("[CapTE] subtitle panel fill failed", err);
            }
        }
        try {
            this._updateClipInfoPanel(clip);
        } catch (err) {
            console.error("[CapTE] clip info view failed", err);
        }
    }


    _bindSubtitlePanelEvents() {
        const bind = (el, ev, fn) => el?.addEventListener(ev, fn);
        bind(this.subTextInput, "focus", () => { this._subUndoArmed = true; });
        bind(this.subTextInput, "blur", () => { this._subUndoArmed = false; });
        bind(this.subTextInput, "input", () => this._onSubtitleFieldChange({ text: true }));
        for (const [el, key, cast] of [
            [this.subFontSelect, "fontFamily", "str"],
            [this.subSizeInput, "fontSize", "num"],
            [this.subLetterSpacingInput, "letterSpacing", "num"],
            [this.subColorInput, "color", "str"],
            [this.subBoldCb, "bold", "bool"],
            [this.subItalicCb, "italic", "bool"],
            [this.subOpacityInput, "opacity", "opacity"],
            [this.subStrokeCb, "strokeEnabled", "bool"],
            [this.subStrokeColorInput, "strokeColor", "str"],
            [this.subStrokeWidthInput, "strokeWidth", "num"],
            [this.subShadowCb, "shadowEnabled", "bool"],
            [this.subShadowColorInput, "shadowColor", "str"],
            [this.subShadowBlurInput, "shadowBlur", "num"],
            [this.subShadowXInput, "shadowOffsetX", "num"],
            [this.subShadowYInput, "shadowOffsetY", "num"],
            [this.subAlignSelect, "align", "str"],
            [this.subVAlignSelect, "vAlign", "str"],
            [this.subOffsetXInput, "offsetX", "num"],
            [this.subOffsetYInput, "offsetY", "num"],
        ]) {
            const ev = el?.type === "checkbox" || el?.type === "range" || el?.tagName === "SELECT" || el?.type === "color"
                ? "input"
                : "change";
            bind(el, ev === "input" ? "input" : "change", () => this._onSubtitleFieldChange({ [key]: cast }));
            if (ev === "input" && (el?.type === "number")) {
                bind(el, "change", () => this._onSubtitleFieldChange({ [key]: cast }));
            }
        }
        bind(this.subApplyTrackBtn, "click", () => this._applySubtitleStyleToTrack());
        bind(this.subApplyAllBtn, "click", () => this._applySubtitleStyleToAllUnlocked());
    }

    _fillSubtitlePanel(m) {
        if (!m) return;
        this._subPanelFilling = true;
        try {
            if (this.subTextInput) this.subTextInput.value = m.text ?? "";
            if (this.subFontSelect) {
                let font = String(m.fontFamily || "").trim();
                if (!font && this._systemFonts?.length) {
                    font = this._systemFonts[0].family;
                    m.fontFamily = font;
                    m.fontPath = this._systemFonts[0].path || "";
                }
                this._fillSystemFontSelect(this.subFontSelect, font || "sans-serif", { autoPickFirst: true });
                if (!m.fontPath) {
                    m.fontPath = this.subFontSelect.selectedOptions?.[0]?.dataset?.path || "";
                }
                void this._ensureFontList();
            }
            if (this.subSizeInput) this.subSizeInput.value = String(Math.max(8, Math.round(Number(m.fontSize) || 48)));
            if (this.subLetterSpacingInput) {
                this.subLetterSpacingInput.value = String(Math.max(-50, Math.min(200, Math.round(Number(m.letterSpacing) || 0))));
            }
            if (this.subColorInput) this.subColorInput.value = /^#[0-9a-fA-F]{6}$/.test(m.color) ? m.color : "#ffffff";
            if (this.subBoldCb) this.subBoldCb.checked = !!m.bold;
            if (this.subItalicCb) this.subItalicCb.checked = !!m.italic;
            const opacityPct = Math.round(Math.max(0, Math.min(1, Number(m.opacity) || 1)) * 100);
            if (this.subOpacityInput) this.subOpacityInput.value = String(opacityPct);
            if (this.subOpacityVal) this.subOpacityVal.textContent = `${opacityPct}%`;
            if (this.subStrokeCb) this.subStrokeCb.checked = m.strokeEnabled !== false;
            if (this.subStrokeColorInput) {
                this.subStrokeColorInput.value = /^#[0-9a-fA-F]{6}$/.test(m.strokeColor) ? m.strokeColor : "#000000";
            }
            if (this.subStrokeWidthInput) this.subStrokeWidthInput.value = String(Number(m.strokeWidth) || 0);
            if (this.subShadowCb) this.subShadowCb.checked = m.shadowEnabled !== false;
            const shadowHex = String(m.shadowColor || "#000000");
            if (this.subShadowColorInput) {
                this.subShadowColorInput.value = /^#[0-9a-fA-F]{6}$/.test(shadowHex) ? shadowHex : "#000000";
            }
            if (this.subShadowBlurInput) this.subShadowBlurInput.value = String(Number(m.shadowBlur) || 0);
            if (this.subShadowXInput) this.subShadowXInput.value = String(Number(m.shadowOffsetX) || 0);
            if (this.subShadowYInput) this.subShadowYInput.value = String(Number(m.shadowOffsetY) || 0);
            if (this.subAlignSelect) this.subAlignSelect.value = ["left", "center", "right"].includes(m.align) ? m.align : "center";
            if (this.subVAlignSelect) this.subVAlignSelect.value = ["top", "middle", "bottom"].includes(m.vAlign) ? m.vAlign : "bottom";
            if (this.subOffsetXInput) this.subOffsetXInput.value = String(Number(m.offsetX) || 0);
            if (this.subOffsetYInput) this.subOffsetYInput.value = String(Number(m.offsetY) || 0);
        } finally {
            this._subPanelFilling = false;
        }
    }

    _readSubtitlePanelInto(meta) {
        if (!meta) return meta;
        meta.text = String(this.subTextInput?.value ?? meta.text ?? "");
        meta.fontFamily = String(this.subFontSelect?.value || meta.fontFamily || "sans-serif");
        meta.fontPath = String(
            this.subFontSelect?.selectedOptions?.[0]?.dataset?.path
            || meta.fontPath
            || "",
        );
        meta.fontSize = Math.max(8, Math.round(Number(this.subSizeInput?.value) || meta.fontSize || 48));
        meta.letterSpacing = Math.max(-50, Math.min(200, Math.round(Number(this.subLetterSpacingInput?.value) || 0)));
        meta.color = String(this.subColorInput?.value || meta.color || "#ffffff");
        meta.bold = !!this.subBoldCb?.checked;
        meta.italic = !!this.subItalicCb?.checked;
        const opacityPct = Math.max(0, Math.min(100, Number(this.subOpacityInput?.value) || 100));
        meta.opacity = opacityPct / 100;
        if (this.subOpacityVal) this.subOpacityVal.textContent = `${Math.round(opacityPct)}%`;
        meta.strokeEnabled = !!this.subStrokeCb?.checked;
        meta.strokeColor = String(this.subStrokeColorInput?.value || meta.strokeColor || "#000000");
        meta.strokeWidth = Math.max(0, Number(this.subStrokeWidthInput?.value) || 0);
        meta.shadowEnabled = !!this.subShadowCb?.checked;
        meta.shadowColor = String(this.subShadowColorInput?.value || meta.shadowColor || "#000000");
        meta.shadowBlur = Math.max(0, Number(this.subShadowBlurInput?.value) || 0);
        meta.shadowOffsetX = Number(this.subShadowXInput?.value) || 0;
        meta.shadowOffsetY = Number(this.subShadowYInput?.value) || 0;
        meta.align = String(this.subAlignSelect?.value || "center");
        meta.vAlign = String(this.subVAlignSelect?.value || "bottom");
        meta.offsetX = Number(this.subOffsetXInput?.value) || 0;
        meta.offsetY = Number(this.subOffsetYInput?.value) || 0;
        return meta;
    }

    _onSubtitleFieldChange() {
        if (this._subPanelFilling) return;
        const clip = this._selClip;
        if (!clip || !isSubtitleTrackType(clip.track?.type)) return;
        if (this._subUndoArmed) {
            this._recordUndo();
            this._subUndoArmed = false;
        } else if (!this._subStyleUndoArmed) {
            this._recordUndo();
            this._subStyleUndoArmed = true;
            clearTimeout(this._subStyleUndoTimer);
            this._subStyleUndoTimer = setTimeout(() => { this._subStyleUndoArmed = false; }, 600);
        }
        const m = this._ensureClipMeta(clip);
        this._readSubtitlePanelInto(m);
        const label = (m.text || T("subtitle_default_text")).trim() || T("subtitle_default_text");
        clip.name = label.slice(0, 40);
        const labelEl = clip.el?.querySelector?.(".tl-clip-label");
        if (labelEl) labelEl.textContent = clip.name;
        this._meta.set(clip.id, m);
        if (this.clipNameEl) this.clipNameEl.textContent = clip.name;
        this._decorateClip(clip);
        this._saveToWidgets();
        this._scheduleProgramPreview();
    }

    _applySubtitleStyleToTrack() {
        const clip = this._selClip;
        if (!clip || !isSubtitleTrackType(clip.track?.type)) return;
        const style = pickSubtitleStyle(this._ensureClipMeta(clip));
        this._recordUndo();
        for (const other of clip.track.clips) {
            if (other.id === clip.id) continue;
            const m = this._ensureClipMeta(other);
            Object.assign(m, style);
            const label = (m.text || T("subtitle_default_text")).trim() || T("subtitle_default_text");
            other.name = label.slice(0, 40);
            const labelEl = other.el?.querySelector?.(".tl-clip-label");
            if (labelEl) labelEl.textContent = other.name;
            this._meta.set(other.id, m);
            this._decorateClip(other);
        }
        this._saveToWidgets();
        this._scheduleProgramPreview();
    }

    _applySubtitleStyleToAllUnlocked() {
        const clip = this._selClip;
        if (!clip || !isSubtitleTrackType(clip.track?.type)) return;
        const style = pickSubtitleStyle(this._ensureClipMeta(clip));
        this._recordUndo();
        for (const track of this._allTextTracks()) {
            if (track.locked) continue;
            for (const other of track.clips) {
                const m = this._ensureClipMeta(other);
                Object.assign(m, style);
                const label = (m.text || T("subtitle_default_text")).trim() || T("subtitle_default_text");
                other.name = label.slice(0, 40);
                const labelEl = other.el?.querySelector?.(".tl-clip-label");
                if (labelEl) labelEl.textContent = other.name;
                this._meta.set(other.id, m);
                this._decorateClip(other);
            }
        }
        this._saveToWidgets();
        this._scheduleProgramPreview();
    }

    _drawSubtitleOverlays(ctx, cw, ch, t) {
        const tracks = [...this._allTextTracks()].reverse();
        for (const track of tracks) {
            if (track.visible === false) continue;
            const info = this._trackInfo.get(track.id) || {};
            if (info.enabled === false) continue;
            for (const clip of track.clips) {
                if (!(t >= clip.startTime - 1e-6 && t < clip.endTime - 1e-9)) continue;
                const m = this._meta.get(clip.id) ?? defaultSubtitleMeta();
                if (m.disabled || m.visible === false) continue;
                this._paintSubtitle(ctx, cw, ch, m);
            }
        }
    }

    _paintSubtitle(ctx, cw, ch, m) {
        const text = String(m.text || "").trim();
        if (!text) return;
        const scale = ch / Math.max(1, Number(this._w("height")?.value) || ch);
        const fontSize = Math.max(8, Number(m.fontSize) || 48) * scale;
        const letterSpacing = (Number(m.letterSpacing) || 0) * scale;
        const weight = m.bold ? "700" : "400";
        const style = m.italic ? "italic" : "normal";
        const family = m.fontFamily ? `"${String(m.fontFamily).replace(/"/g, "")}", sans-serif` : "sans-serif";
        ctx.save();
        ctx.font = `${style} ${weight} ${fontSize}px ${family}`;
        ctx.textAlign = m.align === "left" || m.align === "right" ? m.align : "center";
        ctx.textBaseline = "middle";
        ctx.globalAlpha = Math.max(0, Math.min(1, Number(m.opacity) || 1));

        const lines = text.split(/\r?\n/);
        const lineHeight = fontSize * 1.25;
        const blockH = lineHeight * lines.length;
        const padX = cw * 0.04;
        let x = cw / 2;
        if (m.align === "left") x = padX;
        else if (m.align === "right") x = cw - padX;
        x += (Number(m.offsetX) || 0) / 100 * cw;

        let y;
        const oy = (Number(m.offsetY) || 0) / 100 * ch;
        if (m.vAlign === "top") y = padX + blockH / 2 + oy;
        else if (m.vAlign === "middle") y = ch / 2 + oy;
        else y = ch - padX - blockH / 2 - oy;

        if (m.shadowEnabled !== false) {
            ctx.shadowColor = m.shadowColor || "rgba(0,0,0,0.75)";
            ctx.shadowBlur = Math.max(0, Number(m.shadowBlur) || 0);
            ctx.shadowOffsetX = Number(m.shadowOffsetX) || 0;
            ctx.shadowOffsetY = Number(m.shadowOffsetY) || 0;
        } else {
            ctx.shadowColor = "transparent";
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
        }

        const startY = y - (blockH - lineHeight) / 2;
        for (let i = 0; i < lines.length; i++) {
            const ly = startY + i * lineHeight;
            if (m.strokeEnabled !== false && Number(m.strokeWidth) > 0) {
                ctx.lineWidth = Number(m.strokeWidth) || 1;
                ctx.strokeStyle = m.strokeColor || "#000";
                ctx.lineJoin = "round";
                this._drawTextWithLetterSpacing(ctx, lines[i], x, ly, letterSpacing, "stroke");
            }
            ctx.fillStyle = m.color || "#fff";
            this._drawTextWithLetterSpacing(ctx, lines[i], x, ly, letterSpacing, "fill");
        }
        ctx.restore();
    }

    _syncSidebarMode(hasClip) {
        if (this.sidebarTitle) this.sidebarTitle.textContent = hasClip ? T("clip_settings_title") : T("project_settings_title");
        if (this.projectPanel) this.projectPanel.hidden = !!hasClip;
        if (this.clipPanel) this.clipPanel.hidden = !hasClip;
        if (hasClip) {
            if (document.activeElement === this.projectNameInput) this.projectNameInput.blur();
        } else {
            this._syncGlobalPromptInput();
            this._syncProjectScalarDisplay();
        }
    }

    _syncBrandProjectName() {
        const name = String(this.projectNameInput?.value || T("untitled_project")).trim() || T("untitled_project");
        if (this.brandProjectBtn) this.brandProjectBtn.textContent = name;
    }

    _focusProjectNameFromBrand() {
        this._timeline?.clearSelection?.();
        this._selClip = null;
        this._selClips = [];
        this._updatePromptPanel();
        requestAnimationFrame(() => {
            this.projectNameInput?.focus();
            this.projectNameInput?.select?.();
        });
    }

    _syncProjectScalarDisplay() {
        const fps = Number(this._w("fps")?.value ?? PY_SCALAR_DEFAULTS.fps);
        const width = Math.round(Number(this._w("width")?.value ?? PY_SCALAR_DEFAULTS.width) || PY_SCALAR_DEFAULTS.width);
        const height = Math.round(Number(this._w("height")?.value ?? PY_SCALAR_DEFAULTS.height) || PY_SCALAR_DEFAULTS.height);
        const fpsText = Number.isFinite(fps) ? (Number.isInteger(fps) ? String(fps) : fps.toFixed(1)) : "24";
        const sizeText = `${width} × ${height}`;
        const fpsLabel = `${fpsText} fps`;
        if (this.headerScalarsEl) this.headerScalarsEl.textContent = `${sizeText} · ${fpsLabel}`;
        if (this.projectScalarsEl) this.projectScalarsEl.textContent = `${sizeText} · ${fpsLabel}`;
    }

    _readGlobalPrompt() {
        if (this.globalPromptInput && (document.activeElement === this.globalPromptInput || typeof this.globalPromptInput.value === "string")) {
            return String(this.globalPromptInput.value ?? "");
        }
        const parsed = this._parseProjectWidgetValue();
        const settings = parsed?.project?.settings;
        if (settings && typeof settings === "object" && settings.global_prompt != null) {
            return String(settings.global_prompt);
        }
        return "";
    }

    _writeGlobalPrompt(text) {
        const next = String(text ?? "");
        this._globalPromptSyncing = true;
        try {
            if (this.globalPromptInput) setRichPromptValue(this.globalPromptInput, next, true);
            this._syncScalarsToProjectJson();
            this.node.setDirtyCanvas?.(true, true);
        } finally {
            this._globalPromptSyncing = false;
        }
    }

    _syncGlobalPromptInput() {
        if (!this.globalPromptInput || this._globalPromptSyncing) return;
        if (document.activeElement === this.globalPromptInput) return;
        const value = this._readGlobalPrompt();
        if (this.globalPromptInput.value === value) {
            updateRichPromptMirror(this.globalPromptInput);
            return;
        }
        setRichPromptValue(this.globalPromptInput, value, true);
    }

    _onGlobalPromptInput() {
        if (this._globalPromptUndoArmed) {
            this._recordUndo();
            this._globalPromptUndoArmed = false;
        }
        this._writeGlobalPrompt(this.globalPromptInput?.value ?? "");
    }

    _parseExtendSec(input) {
        const n = Math.round(Number(input?.value));
        if (!Number.isFinite(n) || n < 0) return 0;
        return Math.min(600, n);
    }

    _onPromptInput() {
        if (!this._selClip) return;
        if (this._promptUndoArmed) {
            this._recordUndo();
            this._promptUndoArmed = false;
        }
        const m = this._meta.get(this._selClip.id) ?? defaultImageMeta();
        m.prompt = this.promptInput.value;
        this._meta.set(this._selClip.id, m);
    }

    _onAiPromptInput() {
        if (!this._selClip) return;
        if (this._aiPromptUndoArmed) {
            this._recordUndo();
            this._aiPromptUndoArmed = false;
        }
        const m = this._meta.get(this._selClip.id) ?? defaultImageMeta();
        m.aiPrompt = this.aiPromptInput?.value ?? "";
        this._meta.set(this._selClip.id, m);
    }

    _setClipPromptTab(tab) {
        const next = tab === "ai" ? "ai" : "clip";
        this.clipPromptTabs?.forEach((btn) => {
            btn.classList.toggle("is-active", btn.dataset.tab === next);
        });
        this.clipPanel?.querySelectorAll("[data-prompt-tab]").forEach((wrap) => {
            wrap.hidden = wrap.dataset.promptTab !== next;
        });
    }

    _mediaPromptBlock(clip) {
        const m = this._ensureClipMeta(clip);
        const items = this._clipItems(m);
        const lines = [];
        items.forEach((item, index) => {
            if (item.enabled === false) return;
            const media = (item.id && this._findMediaById(item.id)) || this._findMedia(item.kind, item.file);
            const name = (item.file || "").split(/[\\/]/).pop() || item.file || T("asset_index_fallback", { index: index + 1 });
            const kind = item.kind === "video" ? T("media_kind_video") : T("media_kind_image");
            const type = media?.media_type || "";
            const tags = Array.isArray(media?.tags) ? media.tags.filter(Boolean).join(", ") : "";
            const prompt = item.useMediaPrompt === false ? "" : String(media?.prompt || "");
            const meta = [kind, type, tags].filter(Boolean).join(" · ");
            lines.push(`${index + 1}. ${name}${meta ? `（${meta}）` : ""}`);
            if (item.useMediaPrompt === false) lines.push(T("media_prompt_not_used_note"));
            else lines.push(prompt || T("empty_paren"));
            lines.push("");
        });
        return lines.join("\n").trim() || T("no_media_prompt_for_clip");
    }

    _clipAiOptimizeFiles(clip) {
        const m = this._ensureClipMeta(clip);
        return this._clipItems(m)
            .filter((item) => item.enabled !== false)
            .map((item) => {
            const media = (item.id && this._findMediaById(item.id)) || this._findMedia(item.kind, item.file);
            const status = this._mediaStatus.get(`${item.kind}:${item.file}`);
            return {
                kind: item.kind,
                file: item.file,
                location: status?.location || media?.location || "input",
                prompt: item.useMediaPrompt === false ? "" : String(media?.prompt || ""),
                media_type: String(media?.media_type || ""),
                tags: Array.isArray(media?.tags) ? media.tags : [],
                use_prompt: item.useMediaPrompt !== false,
            };
        });
    }

    _setAiOptimizeSrcTab(tab) {
        const next = tab === "clip" || tab === "global" ? tab : "media";
        this._aiOptimizeSrc = next;
        this.aiSrcTabs?.forEach((btn) => {
            btn.classList.toggle("is-active", btn.dataset.src === next);
        });
        const globalTab = this.aiOptimizeModal?.querySelector('.cat-te-ai-src-tab[data-src="global"]');
        if (globalTab) {
            const clip = this._findClipById(this._aiOptimizeClipId);
            const meta = clip ? this._ensureClipMeta(clip) : null;
            globalTab.hidden = !clip || meta?.useGlobalPrompt === false;
            if (globalTab.hidden && next === "global") {
                this._aiOptimizeSrc = "media";
                this.aiSrcTabs?.forEach((btn) => {
                    btn.classList.toggle("is-active", btn.dataset.src === "media");
                });
            }
        }
        this._fillAiOptimizeSrc();
    }

    _fillAiOptimizeSrc() {
        if (!this.aiSrcText) return;
        const clip = this._findClipById(this._aiOptimizeClipId);
        if (!clip) {
            this.aiSrcText.value = "";
            return;
        }
        const meta = this._ensureClipMeta(clip);
        const tab = this._aiOptimizeSrc || "clip";
        if (tab === "clip") this.aiSrcText.value = String(meta.prompt || "") || T("empty_paren");
        else if (tab === "global") this.aiSrcText.value = this._readGlobalPrompt() || T("empty_paren");
        else this.aiSrcText.value = this._mediaPromptBlock(clip);
    }

    _restoreAiOutputLanguage() {
        if (!this.aiLangSelect) return;
        const saved = localStorage.getItem(STORAGE_AI_PROMPT_LANG) || "简体中文";
        this.aiLangSelect.value = AI_PROMPT_LANGUAGES.includes(saved) ? saved : "简体中文";
    }

    _aiOutputLanguage() {
        const value = String(this.aiLangSelect?.value || "").trim();
        return AI_PROMPT_LANGUAGES.includes(value) ? value : "简体中文";
    }

    async _openAiOptimizeModal() {
        const clip = this._selClip;
        if (!clip || clip.track?.type === "audio" || isSubtitleTrackType(clip.track?.type) || !this.aiOptimizeModal) return;
        this.aiOptimizeModal.hidden = false;
        this._aiOptimizeSrc = "clip";
        await this._bindAiOptimizeToClip(clip, { reloadModels: true });
    }

    _closeAiOptimizeModal() {
        this._cancelAiOptimize();
        if (!this.aiOptimizeModal) return;
        this.aiOptimizeModal.hidden = true;
        this._aiOptimizeClipId = null;
        this._syncAiOptimizeNavButtons();
    }

    _aiOptimizeEligibleClips() {
        const out = [];
        for (const track of this._timeline?.tracks ?? []) {
            if (track.type === "audio" || isSubtitleTrackType(track.type)) continue;
            const clips = [...track.clips].sort((a, b) => a.startTime - b.startTime || String(a.id).localeCompare(String(b.id)));
            out.push(...clips);
        }
        return out;
    }

    _syncAiOptimizeNavButtons() {
        const open = !!(this.aiOptimizeModal && !this.aiOptimizeModal.hidden);
        const clips = open ? this._aiOptimizeEligibleClips() : [];
        const multi = clips.length > 1;
        if (this.aiOptimizePrevBtn) this.aiOptimizePrevBtn.disabled = !multi;
        if (this.aiOptimizeNextBtn) this.aiOptimizeNextBtn.disabled = !multi;
    }

    async _bindAiOptimizeToClip(clip, { reloadModels = false } = {}) {
        if (!clip || !this.aiOptimizeModal) return;
        this._cancelAiOptimize();
        const meta = this._ensureClipMeta(clip);
        this._aiOptimizeClipId = clip.id;
        if (this.aiOptimizeTitle) {
            this.aiOptimizeTitle.textContent = T("ai_optimize_title_dynamic", { name: clip.name || DEFAULT_CLIP_NAME });
        }
        if (this.aiResultInput) this.aiResultInput.value = String(meta.aiPrompt || "");
        if (this.aiSkillInput && !String(this.aiSkillInput.value || "").trim()) {
            this.aiSkillInput.value = localStorage.getItem(STORAGE_AI_PROMPT_SKILL) || "";
        }
        this._restoreAiOutputLanguage();
        this._setAiOptimizeSrcTab(this._aiOptimizeSrc || "clip");
        if (reloadModels) await this._loadAiOptimizeModels();
        await this._loadAiAgentPrompt(meta.agent || "MiniMaxH3", meta.clipRole || "multi_ref");
        this._syncAiOptimizeNavButtons();
    }

    async _stepAiOptimizeClip(delta) {
        if (!this.aiOptimizeModal || this.aiOptimizeModal.hidden) return;
        const clips = this._aiOptimizeEligibleClips();
        if (clips.length < 2) return;
        let idx = clips.findIndex((c) => c.id === this._aiOptimizeClipId);
        if (idx < 0) idx = 0;
        const next = clips[(idx + delta + clips.length * 10) % clips.length];
        if (!next || next.id === this._aiOptimizeClipId) return;
        this._timeline?.selectClip(next);
        await this._bindAiOptimizeToClip(next, { reloadModels: false });
    }

    _cancelAiOptimize() {
        this._aiOptimizeAbort?.abort();
    }

    async _loadAiOptimizeModels() {
        if (!this.aiModelSelect) return;
        try {
            const response = await fetch(api.apiURL("/audio_keyframe_timeline/vl_models"));
            const data = await response.json();
            const models = Array.isArray(data.models) ? data.models : [];
            const agents = Array.isArray(data.agents) ? data.agents : [];
            if (data.skill_url && this.aiSkillLink) this.aiSkillLink.href = data.skill_url;
            const saved = localStorage.getItem(STORAGE_AI_PROMPT_MODEL) || "";
            this.aiModelSelect.replaceChildren();
            if (!models.length && !agents.length) {
                const opt = document.createElement("option");
                opt.value = "";
                opt.textContent = T("no_model_or_agent_found");
                this.aiModelSelect.appendChild(opt);
                this.aiModelSelect.disabled = true;
                return;
            }
            this.aiModelSelect.disabled = false;
            if (agents.length) {
                const group = document.createElement("optgroup");
                group.label = T("configured_agents_group_label");
                for (const agent of agents) {
                    const opt = document.createElement("option");
                    opt.value = `agent:${agent.id}`;
                    opt.textContent = `${agent.label} · ${agent.model}`;
                    group.appendChild(opt);
                }
                this.aiModelSelect.appendChild(group);
            }
            if (models.length) {
                const group = document.createElement("optgroup");
                group.label = T("local_qwen_group_label");
                for (const name of models) {
                    const opt = document.createElement("option");
                    opt.value = `local:${name}`;
                    opt.textContent = name;
                    group.appendChild(opt);
                }
                this.aiModelSelect.appendChild(group);
            }
            const values = [...this.aiModelSelect.options].map((option) => option.value);
            const normalizedSaved = saved && !saved.includes(":") ? `local:${saved}` : saved;
            this.aiModelSelect.value = values.includes(normalizedSaved) ? normalizedSaved : values[0];
        } catch {
            this.aiModelSelect.replaceChildren();
            const opt = document.createElement("option");
            opt.value = "";
            opt.textContent = T("model_list_load_failed");
            this.aiModelSelect.appendChild(opt);
            this.aiModelSelect.disabled = true;
        }
    }

    async _loadAiAgentPrompt(agent, clipRole) {
        if (!this.aiSystemInput) return;
        try {
            const query = `agent=${encodeURIComponent(agent || "MiniMaxH3")}&clip_role=${encodeURIComponent(clipRole || "multi_ref")}`;
            const response = await fetch(api.apiURL(`/audio_keyframe_timeline/clip_prompt_agent?${query}`));
            const data = await response.json();
            this.aiSystemInput.value = String(data.system_prompt || "");
            if (data.skill_url && this.aiSkillLink) this.aiSkillLink.href = data.skill_url;
        } catch {
            this.aiSystemInput.value = "";
        }
    }

    _setAiOptimizeBusy(busy) {
        this._aiOptimizeBusy = !!busy;
        if (this.aiOptimizeBtn) {
            const audio = this._selClip?.track?.type === "audio";
            this.aiOptimizeBtn.disabled = !busy && (!this._selClip || audio);
            this.aiOptimizeBtn.classList.toggle("is-loading", false);
            this.aiOptimizeBtn.classList.toggle("is-cancel", busy);
            const span = this.aiOptimizeBtn.querySelector("span");
            if (span) span.textContent = busy ? T("terminate_label") : T("ai_optimize_short");
        }
        if (this.aiGenerateBtn) {
            this.aiGenerateBtn.disabled = false;
            this.aiGenerateBtn.classList.toggle("is-loading", false);
            this.aiGenerateBtn.classList.toggle("is-cancel", busy);
            this.aiGenerateBtn.innerHTML = busy
                ? `${iconHtml("sparkles", 12)}<span>${T("terminate_label")}</span>`
                : `${iconHtml("sparkles", 12)}<span>${T("generate_btn")}</span>`;
        }
    }

    _onAiResultInput() {
        const clip = this._findClipById(this._aiOptimizeClipId) || this._selClip;
        if (!clip) return;
        const meta = this._ensureClipMeta(clip);
        meta.aiPrompt = this.aiResultInput?.value ?? "";
        this._meta.set(clip.id, meta);
        if (this._selClip?.id === clip.id) {
            setRichPromptValue(this.aiPromptInput, meta.aiPrompt, true);
        }
    }

    async _runAiOptimize() {
        const clip = this._findClipById(this._aiOptimizeClipId) || this._selClip;
        if (!clip || clip.track?.type === "audio" || this._aiOptimizeBusy) return;
        const meta = this._ensureClipMeta(clip);
        const modelChoice = String(this.aiModelSelect?.value || "").trim();
        if (!modelChoice) {
            alert(T("no_available_model_or_agent_alert"));
            return;
        }
        localStorage.setItem(STORAGE_AI_PROMPT_MODEL, modelChoice);
        const isAgent = modelChoice.startsWith("agent:");
        const model = modelChoice.startsWith("local:") ? modelChoice.slice(6) : "";
        const agentId = isAgent ? modelChoice.slice(6) : "";
        const skill = String(this.aiSkillInput?.value || "");
        localStorage.setItem(STORAGE_AI_PROMPT_SKILL, skill);
        const outputLanguage = this._aiOutputLanguage();
        localStorage.setItem(STORAGE_AI_PROMPT_LANG, outputLanguage);
        const ac = new AbortController();
        this._aiOptimizeAbort = ac;
        this._setAiOptimizeBusy(true);
        try {
            const payload = {
                model,
                agent_id: agentId,
                system_prompt: String(this.aiSystemInput?.value || ""),
                skill,
                output_language: outputLanguage,
                agent: meta.agent || "MiniMaxH3",
                clip_role: meta.clipRole || "multi_ref",
                audio_mode: "none",
                generate_bgm: false,
                lyrics: "",
                duration_sec: Number(clip.duration) || 0,
                clip_prompt: String(meta.prompt || ""),
                global_prompt: meta.useGlobalPrompt === false ? "" : this._readGlobalPrompt(),
                files: this._clipAiOptimizeFiles(clip),
                keep_loaded: false,
            };
            const response = await fetch(api.apiURL("/audio_keyframe_timeline/optimize_clip_prompt"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                signal: ac.signal,
            });
            const data = await response.json().catch(() => ({}));
            if (ac.signal.aborted || data.cancelled || response.status === 499) return;
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            const text = String(data.prompt || "").trim();
            if (!text) throw new Error(T("model_no_prompt_returned"));
            this._recordUndo();
            meta.aiPrompt = text;
            this._meta.set(clip.id, meta);
            if (this.aiResultInput) this.aiResultInput.value = text;
            if (this._selClip?.id === clip.id) {
                setRichPromptValue(this.aiPromptInput, text, true);
                this._setClipPromptTab("ai");
            }
            this._saveToWidgets();
        } catch (error) {
            if (ac.signal.aborted || error?.name === "AbortError") return;
            alert(T("ai_optimize_failed", { msg: error instanceof Error ? error.message : String(error) }));
        } finally {
            if (this._aiOptimizeAbort === ac) this._aiOptimizeAbort = null;
            this._setAiOptimizeBusy(false);
        }
    }

    _closeSkillPicker() {
        if (this.skillPickerModal) this.skillPickerModal.hidden = true;
    }

    _setSkillSyncBusy(busy) {
        this._skillSyncBusy = !!busy;
        if (!this.skillSyncBtn) return;
        this.skillSyncBtn.disabled = !!busy;
        this.skillSyncBtn.classList.toggle("is-loading", !!busy);
        const span = this.skillSyncBtn.querySelector("span");
        if (span) span.textContent = busy ? T("syncing_ellipsis") : T("update_btn");
    }

    async _syncH3Skills() {
        if (this._skillSyncBusy) return;
        this._setSkillSyncBusy(true);
        try {
            const response = await fetch(api.apiURL("/audio_keyframe_timeline/h3_skills_sync"), { method: "POST" });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            this._h3Skills = Array.isArray(data.skills) ? data.skills : [];
            if (!this.skillPickerModal?.hidden) this._renderSkillPicker();
            alert(T("synced_n_skills", { n: this._h3Skills.length }));
        } catch (error) {
            alert(T("sync_failed", { msg: error instanceof Error ? error.message : String(error) }));
        } finally {
            this._setSkillSyncBusy(false);
        }
    }

    async _openSkillPicker() {
        if (!this.skillPickerModal) return;
        this.skillPickerModal.hidden = false;
        if (this.skillPickerFilter) this.skillPickerFilter.value = "";
        this.skillPickerBody && (this.skillPickerBody.textContent = T("loading_ellipsis"));
        try {
            const response = await fetch(api.apiURL("/audio_keyframe_timeline/h3_skills"));
            const data = await response.json().catch(() => ({}));
            this._h3Skills = Array.isArray(data.skills) ? data.skills : [];
            this._renderSkillPicker();
        } catch (error) {
            if (this.skillPickerBody) {
                this.skillPickerBody.textContent = T("load_failed", { msg: error instanceof Error ? error.message : String(error) });
            }
        }
    }

    _renderSkillPicker() {
        const body = this.skillPickerBody;
        if (!body) return;
        const query = String(this.skillPickerFilter?.value || "").trim().toLowerCase();
        const rows = (this._h3Skills || []).filter((row) => {
            if (!query) return true;
            const title = String(row.title || "").toLowerCase();
            const name = String(row.name || row.id || "").toLowerCase();
            return title.includes(query) || name.includes(query);
        });
        body.replaceChildren();
        if (!rows.length) {
            const empty = document.createElement("div");
            empty.className = "cat-te-skill-picker-empty";
            empty.textContent = (this._h3Skills || []).length
                ? T("no_matching_skill")
                : T("no_local_skills_hint");
            body.appendChild(empty);
            return;
        }
        const grid = document.createElement("div");
        grid.className = "cat-te-skill-picker-grid";
        for (const row of rows) {
            const card = document.createElement("div");
            card.className = "cat-te-skill-card";
            const img = document.createElement("img");
            img.alt = "";
            img.loading = "lazy";
            if (row.has_preview) {
                img.src = api.apiURL(`/audio_keyframe_timeline/h3_skill_preview?id=${encodeURIComponent(row.id)}`);
            }
            const name = document.createElement("div");
            name.className = "cat-te-skill-card-name";
            name.textContent = row.title || row.name || row.id;
            name.title = row.summary || name.textContent;
            const apply = document.createElement("button");
            apply.type = "button";
            apply.className = "cat-te-btn cat-te-btn-primary cat-te-skill-apply";
            apply.dataset.skillId = row.id;
            apply.textContent = T("apply_btn");
            card.append(img, name, apply);
            grid.appendChild(card);
        }
        body.appendChild(grid);
    }

    async _applyH3Skill(skillId) {
        const id = String(skillId || "").trim();
        if (!id) return;
        try {
            const response = await fetch(api.apiURL(`/audio_keyframe_timeline/h3_skill?id=${encodeURIComponent(id)}`));
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            const text = String(data.text || "");
            if (this.aiSkillInput) this.aiSkillInput.value = text;
            localStorage.setItem(STORAGE_AI_PROMPT_SKILL, text);
            this._closeSkillPicker();
        } catch (error) {
            alert(T("apply_skill_failed", { msg: error instanceof Error ? error.message : String(error) }));
        }
    }

    _onUseGlobalChange() {
        if (!this._selClip) return;
        this._recordUndo();
        const m = this._meta.get(this._selClip.id) ?? defaultImageMeta();
        m.useGlobalPrompt = !!this.useGlobalCb.checked;
        this._meta.set(this._selClip.id, m);
    }

    _onUseAiPromptChange() {
        if (!this._selClip) return;
        this._recordUndo();
        const m = this._meta.get(this._selClip.id) ?? defaultImageMeta();
        m.useAiPrompt = !!this.useAiPromptCb?.checked;
        this._meta.set(this._selClip.id, m);
    }

    _onClipRoleChange() {
        if (!this._selClip || this.clipRoleSelect?.disabled) return;
        this._recordUndo();
        const m = this._ensureClipMeta(this._selClip);
        m.clipRole = this._knownClipRole(this.clipRoleSelect.value);
        if (m.clipRole !== "other") m.clipRoleCustom = "";
        this._meta.set(this._selClip.id, m);
        this._updatePromptPanel();
    }

    _onClipRoleCustomChange() {
        if (!this._selClip || this.clipRoleCustomInput?.disabled) return;
        this._recordUndo();
        const m = this._ensureClipMeta(this._selClip);
        m.clipRoleCustom = String(this.clipRoleCustomInput.value || "").trim();
        this.clipRoleCustomInput.value = m.clipRoleCustom;
        this._meta.set(this._selClip.id, m);
    }

    _onClipAgentChange() {
        if (!this._selClip || this.clipAgentSelect?.disabled) return;
        this._recordUndo();
        const m = this._ensureClipMeta(this._selClip);
        const value = String(this.clipAgentSelect.value || "");
        m.agent = value === "other" ? "other" : this._knownClipAgent(value);
        if (m.agent !== "other") m.agentCustom = "";
        this._meta.set(this._selClip.id, m);
        this._updatePromptPanel();
    }

    _onClipAgentCustomChange() {
        if (!this._selClip || this.clipAgentCustomInput?.disabled) return;
        this._recordUndo();
        const m = this._ensureClipMeta(this._selClip);
        m.agentCustom = String(this.clipAgentCustomInput.value || "").trim();
        this.clipAgentCustomInput.value = m.agentCustom;
        this._meta.set(this._selClip.id, m);
    }

    _onHeadExtendChange() {
        if (!this._selClip || this.headExtendInput?.disabled) return;
        this._recordUndo();
        const m = this._meta.get(this._selClip.id) ?? defaultImageMeta();
        m.headExtendSec = this._parseExtendSec(this.headExtendInput);
        this.headExtendInput.value = String(m.headExtendSec);
        this._meta.set(this._selClip.id, m);
    }

    _onTailExtendChange() {
        if (!this._selClip || this.tailExtendInput?.disabled) return;
        this._recordUndo();
        const m = this._meta.get(this._selClip.id) ?? defaultImageMeta();
        m.tailExtendSec = this._parseExtendSec(this.tailExtendInput);
        this.tailExtendInput.value = String(m.tailExtendSec);
        this._meta.set(this._selClip.id, m);
    }

    _onGenPreviewVideoChange() {
        if (!this._selClip || this.genPreviewVideoCb?.disabled) return;
        this._recordUndo();
        const m = this._meta.get(this._selClip.id) ?? defaultImageMeta();
        m.generatePreviewVideo = !!this.genPreviewVideoCb.checked;
        this._meta.set(this._selClip.id, m);
    }

    _onSecondSampleChange() {
        if (!this._selClip || this.secondSampleCb?.disabled) return;
        this._recordUndo();
        const m = this._meta.get(this._selClip.id) ?? defaultImageMeta();
        m.secondSample = !!this.secondSampleCb.checked;
        this._meta.set(this._selClip.id, m);
    }

    /** Persist audio fade seconds from the Clip onto clip meta (ms). */
    _syncAudioFadeMeta(clip) {
        if (!clip || clip.track?.type !== "audio") return;
        clip._clampFades?.();
        const m = this._meta.get(clip.id) ?? defaultAudioMeta(this._trackIndex(clip.track));
        m.fadeInMs = Math.round((clip.fadeIn || 0) * 1000);
        m.fadeOutMs = Math.round((clip.fadeOut || 0) * 1000);
        this._meta.set(clip.id, m);
    }

    /** Build the complete, editable and lossless project document. */
    _buildProject() {
        const fps = this.getFps();
        const tracks = (this._timeline?.tracks ?? []).map((track, order) => {
            const ti = this._trackIndex(track);
            const isSubTrack = isSubtitleTrackType(track.type);
            const clips = track.clips.map(clip => {
                const m = this._meta.get(clip.id)
                    ?? (track.type === "audio"
                        ? defaultAudioMeta(ti)
                        : isSubTrack
                            ? defaultSubtitleMeta(ti)
                            : defaultImageMeta(ti));
                if (track.type !== "audio" && !isSubTrack) this._normalizeVisualMeta(clip, m);
                // Frame-grid ms so abutting clips share boundaries on reload.
                const { startMs, durationMs } = encodeClipTimingMs(clip.startTime, clip.duration, fps);
                if (isSubTrack) {
                    const style = pickSubtitleStyle(m);
                    return {
                        id: clip.id,
                        type: "subtitle",
                        enabled: !m.disabled,
                        visible: m.visible !== false,
                        start_ms: startMs,
                        duration_ms: durationMs,
                        name: clip.name || T("subtitle_default_text"),
                        text: m.text ?? "",
                        font_family: style.fontFamily,
                        font_path: style.fontPath || "",
                        font_size: style.fontSize,
                        letter_spacing: style.letterSpacing ?? 0,
                        color: style.color,
                        bold: !!style.bold,
                        italic: !!style.italic,
                        opacity: style.opacity,
                        stroke_enabled: style.strokeEnabled !== false,
                        stroke_color: style.strokeColor,
                        stroke_width: style.strokeWidth,
                        shadow_enabled: style.shadowEnabled !== false,
                        shadow_color: style.shadowColor,
                        shadow_blur: style.shadowBlur,
                        shadow_offset_x: style.shadowOffsetX,
                        shadow_offset_y: style.shadowOffsetY,
                        align: style.align,
                        v_align: style.vAlign,
                        offset_x: style.offsetX,
                        offset_y: style.offsetY,
                    };
                }
                const sourceInFrames = Math.max(0, Math.round((clip.sourceOffset || 0) * fps));
                const sourceInMs = Math.round((sourceInFrames * 1000) / fps);
                const items = track.type === "audio" ? [] : this._clipItems(m);
                const firstItem = items[0] || null;
                const firstKind = track.type === "audio"
                    ? "audio"
                    : (firstItem?.kind || "image");
                const audioMedia = track.type === "audio"
                    ? ((m.mediaId && this._findMediaById(m.mediaId)) || this._ensureMedia("audio", clip.src))
                    : null;
                const mediaIds = track.type === "audio"
                    ? (audioMedia?.id ? [audioMedia.id] : [])
                    : items.map((item) => item.id).filter(Boolean);
                const source = {};
                if (track.type === "audio" || firstKind === "video") {
                    source.in_ms = sourceInMs;
                    source.out_ms = sourceInMs + durationMs;
                    const fullSec = clip.sourceDuration ?? m.sourceDuration ?? clip.duration;
                    const fullFrames = Math.max(
                        sourceInFrames + Math.max(1, Math.round(clip.duration * fps)),
                        Number.isFinite(fullSec) ? Math.round(Math.max(0, fullSec) * fps) : 0,
                    );
                    source.duration_ms = Math.max(
                        source.out_ms,
                        Math.round((fullFrames * 1000) / fps),
                    );
                }
                const row = {
                    id: clip.id,
                    type: track.type === "audio" ? "audio" : "clip",
                    enabled: !m.disabled,
                    visible: m.visible !== false,
                    start_ms: startMs,
                    duration_ms: durationMs,
                    media_ids: mediaIds,
                };
                if (Object.keys(source).length) row.source = source;
                if (track.type === "audio") {
                    row.muted = !!m.muted;
                    const fadeInMs = Math.max(0, Math.round((clip.fadeIn || 0) * 1000));
                    const fadeOutMs = Math.max(0, Math.round((clip.fadeOut || 0) * 1000));
                    if (fadeInMs > 0) row.fade_in_ms = fadeInMs;
                    if (fadeOutMs > 0) row.fade_out_ms = fadeOutMs;
                    m.fadeInMs = fadeInMs;
                    m.fadeOutMs = fadeOutMs;
                } else {
                    row.name = clip.name || DEFAULT_CLIP_NAME;
                    row.prompt = m.prompt ?? "";
                    row.ai_prompt = m.aiPrompt ?? "";
                    row.use_global_prompt = m.useGlobalPrompt !== false;
                    row.use_ai_prompt = m.useAiPrompt !== false;
                    row.use_media_prompts = items.map((item) => item.useMediaPrompt !== false);
                    row.media_enabled = items.map((item) => item.enabled !== false);
                    row.head_extend_sec = Math.max(0, Math.round(Number(m.headExtendSec) || 0));
                    row.tail_extend_sec = Math.max(0, Math.round(Number(m.tailExtendSec) || 0));
                    row.generate_preview_video = !!m.generatePreviewVideo;
                    row.second_sample = !!m.secondSample;
                    row.clip_role = m.clipRole || "multi_ref";
                    row.clip_role_custom = m.clipRole === "other" ? (m.clipRoleCustom || "") : "";
                    row.agent = m.agent || "MiniMaxH3";
                    row.agent_custom = m.agent === "other" ? (m.agentCustom || "") : "";
                    const generated = this._clipGeneratedVideos(m);
                    if (generated.length) {
                        row.generated_videos = generated.map((v) => ({
                            id: v.id,
                            file: v.file,
                            enabled: v.enabled !== false,
                            muted: v.muted === true,
                            note: v.note || "",
                        }));
                    }
                    if (m.previewMode === "generated") row.preview_mode = "generated";
                    if (firstKind === "video") {
                        row.has_audio = !!clip.hasAudio;
                        row.muted = !!m.muted;
                    }
                }
                return row;
            });
            const trackInfo = this._trackInfo.get(track.id) || {};
            return {
                id: track.id,
                type: track.type === "audio"
                    ? "audio"
                    : isSubTrack
                        ? "subtitle"
                        : "visual",
                role: track.isMain
                    ? "main"
                    : (trackInfo.role || (track.type === "audio" ? "audio" : isSubTrack ? "subtitle" : "overlay")),
                name: track.name,
                order,
                enabled: trackInfo.enabled !== false,
                visible: track.visible !== false,
                muted: !!track.muted,
                locked: !!track.locked,
                color: track.color,
                clips,
            };
        });
        return {
            project_version: this._currentVersion(),
            schema_version: SCHEMA_VERSION,
            name: String(this.projectNameInput?.value || T("untitled_project")).trim() || T("untitled_project"),
            media: this._serializeMediaCatalog(),
            settings: {
                fps: Number(this._w("fps")?.value ?? 24),
                width: Number(this._w("width")?.value ?? PY_SCALAR_DEFAULTS.width),
                height: Number(this._w("height")?.value ?? PY_SCALAR_DEFAULTS.height),
                global_prompt: this._readGlobalPrompt(),
                timeline_zoom: Number(this._timeline?.getZoom() ?? 1.2),
                current_time: Number(this._timeline?.currentTime ?? 0) || 0,
                timeline_scroll_left: Number(this._timeline?.scrollEl?.scrollLeft ?? 0) || 0,
                timeline_scroll_top: Number(this._timeline?.scrollEl?.scrollTop ?? 0) || 0,
                watermark: this._watermark,
                use_clip_specified_video_filename: this._useClipSpecifiedVideoFilename !== false,
                ...(this._genVideoStamp
                    ? { gen_video_stamp: String(this._genVideoStamp) }
                    : {}),
                ...(Array.isArray(this._runtimeOnlyClipIds) && this._runtimeOnlyClipIds.length
                    ? { runtime_only_clip_ids: this._runtimeOnlyClipIds.map(String) }
                    : {}),
            },
            tracks,
        };
    }

    /** True when this editor's node still belongs to the live root graph. */
    _isNodeOnLiveGraph() {
        if (this._destroyed || !this.node?.graph) return false;
        const live = app.rootGraph ?? app.graph;
        if (!live) return false;
        return CapTimelineEditorApp._graphRoot(this.node.graph)
            === CapTimelineEditorApp._graphRoot(live);
    }

    _saveToWidgets() {
        if (this._destroyed) return;
        if (!this._isNodeOnLiveGraph()) return;
        if (!this._timeline || !this._timelineReady) return;
        this._writeProjectJson(JSON.stringify(this._buildProject()));
        try { this._persistViewToLocalCache(); } catch { /* ignore */ }
        try { this._persistPanelLayout(); } catch { /* ignore */ }
    }

    /** Write project_json to the widget and keep workflow restore mirrors in sync. */
    _writeProjectJson(json) {
        if (this._destroyed) return;
        const node = this.node;
        // Detached / other-tab nodes must not receive writes (dual Timeline Editor
        // workflows share one rootGraph object across tab switches).
        if (!this._isNodeOnLiveGraph()) return;

        const projectW = this._w("project_json");
        if (projectW) projectW.value = json;

        if (Array.isArray(node.widgets)) {
            const values = [];
            for (const w of node.widgets) {
                if (w.serialize === false) continue;
                values.push(w.name === "project_json" ? json : w.value);
            }
            node.widgets_values = values;

            if (!node.properties) node.properties = {};
            const named = { ...(node.properties.cat_named || {}) };
            for (const w of node.widgets) {
                if (!w?.name || w.serialize === false) continue;
                named[w.name] = w.name === "project_json" ? json : w.value;
            }
            node.properties.cat_named = named;
        }

        node.setDirtyCanvas?.(true, true);
    }

    /**
     * Persist generated-video links into project_json even when the fullscreen
     * timeline is closed / not ready (auto-associate after queue must survive
     * close → reopen).
     */
    _persistGeneratedVideosToProjectJson(clipId, files) {
        if (this._destroyed) return false;
        const normalized = [];
        const seen = new Set();
        for (const file of files || []) {
            const n = normalizeOutputVideoPath(file);
            if (!n || seen.has(n)) continue;
            seen.add(n);
            normalized.push(n);
        }
        if (!normalized.length) return false;

        const parsed = this._parseProjectWidgetValue();
        const project = parsed.project && typeof parsed.project === "object"
            ? parsed.project
            : null;
        if (!project || !Array.isArray(project.tracks)) return false;

        let target = null;
        if (clipId) {
            for (const track of project.tracks) {
                for (const clip of track.clips || []) {
                    if (clip && String(clip.id) === String(clipId)) {
                        target = clip;
                        break;
                    }
                }
                if (target) break;
            }
        }
        if (!target) {
            const enabled = [];
            for (const track of project.tracks) {
                if (String(track?.type || "").toLowerCase() === "audio") continue;
                if (track?.enabled === false) continue;
                for (const clip of track.clips || []) {
                    if (!clip || clip.enabled === false) continue;
                    if (String(clip.type || "").toLowerCase() === "audio") continue;
                    enabled.push(clip);
                }
            }
            if (enabled.length === 1) target = enabled[0];
        }
        if (!target) return false;

        const existing = Array.isArray(target.generated_videos)
            ? target.generated_videos.map(normalizeGeneratedVideo).filter(Boolean)
            : [];
        const have = new Set(existing.map((row) => row.file));
        const added = [];
        for (const file of normalized) {
            if (have.has(file)) continue;
            have.add(file);
            added.push({ id: genVideoUid(), file, enabled: true, muted: false, note: "" });
        }
        if (!added.length) return false;

        target.generated_videos = [...added, ...existing].map((v) => ({
            id: v.id,
            file: v.file,
            enabled: v.enabled !== false,
            muted: v.muted === true,
            note: v.note || "",
        }));
        this._writeProjectJson(JSON.stringify(project));
        return true;
    }

    // ─── Undo / redo ─────────────────────────────────────────────────────

    _captureSnapshot() {
        return {
            project: this._buildProject(),
            currentTime: this._timeline?.currentTime ?? 0,
        };
    }

    /** Reflect stack state on the toolbar's 还原/重做 buttons. */
    _updateHistoryButtons() {
        if (this.undoBtn) this.undoBtn.disabled = this._undoStack.length === 0;
        if (this.redoBtn) this.redoBtn.disabled = this._redoStack.length === 0;
    }

    /** Call right before a discrete, user-initiated mutation (add/remove/
     * toggle/etc.) so it becomes exactly one undo step. */
    _recordUndo() {
        if (!this._historyReady || this._restoringHistory || !this._timeline) return;
        this._undoStack.push(this._captureSnapshot());
        if (this._undoStack.length > 100) this._undoStack.shift();
        this._redoStack = [];
        this._updateHistoryButtons();
    }

    /** Drag gestures (move/trim) span many frames — stash the pre-drag
     * snapshot at the start and only commit it once, at the end, and only
     * if the gesture actually changed something. */
    _beginPendingUndo() {
        if (!this._historyReady || this._restoringHistory || !this._timeline) return;
        this._pendingUndoSnapshot = this._captureSnapshot();
    }

    _commitPendingUndo(moved) {
        const snapshot = this._pendingUndoSnapshot;
        this._pendingUndoSnapshot = null;
        if (!snapshot || !moved || !this._historyReady || this._restoringHistory) return;
        this._undoStack.push(snapshot);
        if (this._undoStack.length > 100) this._undoStack.shift();
        this._redoStack = [];
        this._updateHistoryButtons();
    }

    async _restoreSnapshot(snapshot) {
        if (!snapshot || !this._timeline) return;
        this._restoringHistory = true;
        try {
            this._timeline.selectClip(null);
            this._selClip = null;
            this._selClips = [];
            this._meta.clear();
            this._trackInfo.clear();
            this._mainTrack = null;
            this._overlayTrack = null;
            this._audioTrack = null;

            const project = this._migrateProjectDocument(snapshot.project || {});
            this._applyMediaCatalogFromProject(project);
            this.projectNameInput.value = String(project.name || T("untitled_project")).trim() || T("untitled_project");
            this._syncBrandProjectName();
            const snapSettings = snapshot.project?.settings ?? {};
            if (snapSettings.global_prompt != null) {
                this._writeGlobalPrompt(snapSettings.global_prompt);
            } else {
                this._syncGlobalPromptInput();
            }
            this._syncProjectScalarDisplay();
            const projectTracks = Array.isArray(project.tracks) ? project.tracks : [];
            const tracks = projectTracks.map((track, order) => {
                const rawType = String(track.type || "visual").toLowerCase();
                const type = rawType === "audio"
                    ? "audio"
                    : (rawType === "subtitle" || rawType === "text")
                        ? "text"
                        : "image";
                return {
                    ...track,
                    type,
                    trackIndex: order,
                    isMain: track.role === "main",
                };
            });
            this._timeline.clearTracks();
            if (tracks.length) {
                this._loadTracksFromJson(tracks);
            } else {
                this._createDefaultTracks();
            }
            const clips = this._clipsFromProjectTracks(project, this.getFps());
            await Promise.all(clips.map(c => this._addClipFromJson(c)));

            this._decorateAllClips();
            this._refreshTimelineDuration();
            this._applyTimelineZoomFromSettings(snapSettings, { autoFitIfMissing: false });
            this._applyTimelineViewFromSettings(
                { ...snapSettings, current_time: snapshot.currentTime || 0 },
                { applyZoom: false },
            );
            this._updatePromptPanel();
            this._renderMediaGrid();
        } finally {
            this._restoringHistory = false;
        }
    }

    async undo() {
        if (!this._undoStack.length || this._restoringHistory) return;
        const current = this._captureSnapshot();
        const prev = this._undoStack.pop();
        this._redoStack.push(current);
        await this._restoreSnapshot(prev);
        this._updateHistoryButtons();
    }

    async redo() {
        if (!this._redoStack.length || this._restoringHistory) return;
        const current = this._captureSnapshot();
        const next = this._redoStack.pop();
        this._undoStack.push(current);
        await this._restoreSnapshot(next);
        this._updateHistoryButtons();
    }
}
