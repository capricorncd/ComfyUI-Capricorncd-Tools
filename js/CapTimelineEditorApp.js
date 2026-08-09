import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { Timeline, ICONS } from "./timeline/index.js";
import { parseTimecode, formatTimecode, frameIndexFromSecs, encodeClipTimingMs, decodeClipTimingSecs } from "./timecode.js";
import { attachRichPromptHandler, setRichPromptValue } from "./rich_prompt.js";
import { loadExtensionCss } from "./cap_ui.js";
import { iconHtml } from "./cap_icons.js";

/** Right-side empty margin as a fraction of the timeline viewport width. */
const TIMELINE_RIGHT_VIEWPORT_FRAC = 0.3;
/** All tracks (main/overlay/audio) share one row height. */
const TRACK_HEIGHT = 78;
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
const STORAGE_VIEW_PREFIX = "cat-te-view:";
const DEFAULT_AUTOSAVE_INTERVAL_SEC = 5;
const MIN_AUTOSAVE_INTERVAL_SEC = 1;
const MAX_AUTOSAVE_INTERVAL_SEC = 300;
/** Must match CAP_TimelineEditor INPUT_TYPES defaults. */
const PY_SCALAR_DEFAULTS = { fps: 24, width: 1280, height: 720, global_prompt: "" };
const MEDIA_TAB_ICONS = { image: "image", video: "video", audio: "audio" };
const MEDIA_TAB_TITLES = { image: "图片", video: "视频", audio: "音频" };

function loadEditorCss() {
    loadExtensionCss("cap_timeline_editor.css", "cat-te-styles");
    loadExtensionCss("timeline/timeline.css", "cat-te-tl-styles");
}

function uid() {
    return `cl_${Math.random().toString(36).slice(2, 9)}`;
}

function defaultImageMeta(trackIndex = 0) {
    return {
        clipType: "image",
        mediaKind: "image",
        prompt: "",
        endImage: null,
        useGlobalPrompt: true,
        disabled: false,
        visible: true,
        muted: false,
        headExtendSec: 0,
        tailExtendSec: 0,
        generatePreviewVideo: false,
        trackIndex,
    };
}

function defaultAudioMeta(trackIndex = 2) {
    return {
        clipType: "audio",
        muted: false,
        visible: true,
        sourceDuration: 0,
        trimIn: 0,
        trackIndex,
    };
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

    /** Persist any open editor into its node widgets (for serialize / tab switch). */
    static flushOpenEditors() {
        for (const te of CapTimelineEditorApp._instances) {
            if (te._destroyed || !te._overlay?.classList.contains("open") || !te._timeline) continue;
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
        this._mediaTab = "image";
        this._mediaStarFilter = "all";
        this._mediaStarsByDir = {};
        this._mediaBatchMode = false;
        this._mediaBatchSelected = new Set();
        this._mediaListView = localStorage.getItem(STORAGE_MEDIA_LIST_VIEW) === "1";
        this._mediaPreviewState = null;
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
        this._previewImages = new Map();
        this._previewVideos = new Map();
        this._programPreviewRaf = 0;
        this._programStageObserver = null;
        this._openGen = 0;
        CapTimelineEditorApp._instances.add(this);
        loadEditorCss();
        this._buildLauncher();
    }

    _w(name) { return this.node.widgets?.find(w => w.name === name); }
    _currentVersion() { return String(this._w("project_version")?.value || "0.0.0"); }
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
          <button type="button" class="cat-te-open-btn">⛶ 编辑时间轴</button>
          <div class="cat-te-launcher-hint">全屏编辑 · 拖入素材 · Ctrl+B/G · Alt+滚轮平移</div>
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
        const gen = ++this._openGen;
        void this._openEditor(gen);
    }

    /** Selected clip on the timeline, or null. */
    getSelectedClip() {
        return this._timeline?._selected ?? this._selClip ?? null;
    }

    /**
     * Ctrl+C / Ctrl+V / Ctrl+B / Ctrl+G — when the fullscreen editor is open.
     * @returns {boolean} true if the event was handled
     */
    handleShortcutKey(e) {
        if (!this._overlay?.classList.contains("open")) return false;
        if (e.repeat) return false;
        if (e.target?.closest?.("input, textarea, select")) return false;
        if (!e.ctrlKey || e.shiftKey || e.altKey) return false;
        const key = e.key?.toLowerCase();
        if (key === "c") {
            if (!this._copySelectedClips()) return false;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();
            return true;
        }
        if (key === "v") {
            if (!this._pasteClips()) return false;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();
            return true;
        }
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

    async _openEditor(gen = this._openGen) {
        this._historyReady = false;
        this._openedWidgetValues = Object.fromEntries(
            ["fps", "width", "height", "global_prompt"].map(name => [name, this._w(name)?.value]),
        );
        // Re-apply panel layout each open (window size / localStorage may have changed).
        this._applySavedMediaPanelWidth();
        this._applySavedSidebarPanelWidth();
        this._applySavedProgramPanelHeight();
        await this._initTimelineFromWidgets();
        if (gen !== this._openGen || CapTimelineEditorApp._open !== this || !this._overlay?.classList.contains("open")) {
            this._timeline?.destroy();
            this._timeline = null;
            return;
        }
        await this._reloadMediaLibrary();
        if (gen !== this._openGen || CapTimelineEditorApp._open !== this || !this._overlay?.classList.contains("open")) {
            this._timeline?.destroy();
            this._timeline = null;
            return;
        }
        this._refreshTimelineDuration();
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
                    if (widget && value !== undefined) widget.value = value;
                }
            }
            this._disposeProgramPreview();
            try { this._timeline?.destroy(); } catch { /* ignore */ }
            this._timeline = null;
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

    /** Settings dialog — language is the first setting; more will land here
     * later. Selection is only persisted for now, not yet wired to i18n. */
    _openSettings() {
        if (!this.settingsModal) return;
        this.langSelect.value = localStorage.getItem("cat-te-lang") || "zh";
        this.autosaveIntervalInput.value = String(this._getAutosaveIntervalSec());
        this.settingsModal.hidden = false;
    }

    _closeSettings() {
        if (this.settingsModal) this.settingsModal.hidden = true;
    }

    _confirmOverwriteImport() {
        return !(this._hasUnsavedChanges() && !confirm("当前时间轴已有未保存的更改，是否用导入的项目覆盖？"));
    }

    _showImportMenu(e) {
        const r = e.currentTarget.getBoundingClientRect();
        this._buildCtxMenu([
            { label: "从目录导入", fn: () => void this._importFromDirectory() },
            { label: "从ZIP导入", fn: () => this._chooseZipImport() },
        ], r.left, r.bottom + 4);
    }

    _showExportMenu(e) {
        const r = e.currentTarget.getBoundingClientRect();
        this._buildCtxMenu([
            { label: "导出到目录", fn: () => void this._exportToDirectory() },
            { label: "导出为ZIP", fn: () => void this._exportAsZip() },
        ], r.left, r.bottom + 4);
    }

    _safeProjectFilename(fallback = "未命名项目") {
        const projectName = String(this.projectNameInput?.value || fallback).trim() || fallback;
        return projectName
            .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
            .replace(/[. ]+$/g, "")
            .slice(0, 80) || fallback;
    }

    async _pickDirectory(mode = "readwrite") {
        if (typeof window.showDirectoryPicker !== "function") {
            throw new Error("当前环境不支持目录选择（请使用 Chrome / Edge，或改用 ZIP）");
        }
        return window.showDirectoryPicker({ mode });
    }

    async _writeRelativeFile(root, relPath, data) {
        const parts = String(relPath || "").replace(/\\/g, "/").split("/").filter(Boolean);
        if (!parts.length) throw new Error("无效的导出路径");
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
        if (!parts.length) throw new Error("无效的导入路径");
        let dir = root;
        for (let i = 0; i < parts.length - 1; i++) {
            dir = await dir.getDirectoryHandle(parts[i]);
        }
        const fh = await dir.getFileHandle(parts[parts.length - 1]);
        return fh.getFile();
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
            throw new Error("项目根节点必须是对象");
        }
        const currentVersion = this._currentVersion();
        if (String(project.schema_version ?? "") !== currentVersion) {
            throw new Error(`不支持的 schema_version：${project.schema_version ?? "缺失"}（当前 ${currentVersion}）`);
        }
        if (String(project.project_version ?? "") !== currentVersion) {
            throw new Error(`不支持的 project_version：${project.project_version ?? "缺失"}（当前 ${currentVersion}）`);
        }
        if (!Array.isArray(project.tracks)) {
            throw new Error("项目缺少 tracks 数组");
        }
        return project;
    }

    async _applyImportedProject(project, warnings = []) {
        this._validateImportedProject(project);
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
            alert(`导入完成，但有 ${warnings.length} 项警告：\n${warnings.slice(0, 8).join("\n")}${warnings.length > 8 ? "\n…" : ""}`);
        }
    }

    _iterProjectMedia(project) {
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
        for (const resource of project.resources || []) {
            if (resource && typeof resource === "object") {
                add(resource.kind, resource.file, resource.location);
            }
        }
        for (const track of project.tracks || []) {
            if (!track || typeof track !== "object") continue;
            const trackType = String(track.type || "visual").toLowerCase();
            for (const clip of track.clips || []) {
                if (!clip || typeof clip !== "object") continue;
                const source = clip.source && typeof clip.source === "object" ? clip.source : {};
                const clipType = String(clip.type || (trackType === "audio" ? "audio" : "image")).toLowerCase();
                const kind = (clipType === "audio" || trackType === "audio")
                    ? "audio"
                    : (clipType === "video" ? "video" : "image");
                add(kind, source.file || clip.start_image, source.location);
                if (clip.end_image) add("image", clip.end_image, "input");
            }
        }
        return rows;
    }

    _remapProjectFiles(project, mapping) {
        const out = JSON.parse(JSON.stringify(project));
        const mapFile = (kind, file) => {
            file = String(file || "").trim().replace(/\\/g, "/");
            if (!file) return file;
            return mapping.get(`${kind}|${file}`) || file;
        };
        out.resources = (out.resources || []).filter((r) => r && typeof r === "object").map((resource) => {
            const kind = String(resource.kind || "").toLowerCase();
            return { ...resource, file: mapFile(kind, resource.file), location: "input" };
        });
        for (const track of out.tracks || []) {
            if (!track || typeof track !== "object") continue;
            const trackType = String(track.type || "visual").toLowerCase();
            for (const clip of track.clips || []) {
                if (!clip || typeof clip !== "object") continue;
                const source = clip.source && typeof clip.source === "object" ? clip.source : null;
                const clipType = String(clip.type || (trackType === "audio" ? "audio" : "image")).toLowerCase();
                const kind = (clipType === "audio" || trackType === "audio")
                    ? "audio"
                    : (clipType === "video" ? "video" : "image");
                if (source) {
                    clip.source = {
                        ...source,
                        file: mapFile(kind, source.file),
                        location: "input",
                    };
                }
                if (clip.end_image) clip.end_image = mapFile("image", clip.end_image);
                if (clip.start_image) clip.start_image = mapFile(kind, clip.start_image);
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
        if (!response.ok) throw new Error(data.error || `上传素材失败：${filename}`);
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
            if (!response.ok) throw new Error(data.error || "准备导出失败");
            const missing = [...(data.missing || [])];
            await this._writeRelativeFile(
                dir,
                "project.json",
                new Blob([JSON.stringify(data.project, null, 2)], { type: "application/json;charset=utf-8" }),
            );
            for (const entry of data.files || []) {
                const url = this._assetFileUrl(entry.file, entry.kind, "input");
                const fileRes = await fetch(url);
                if (!fileRes.ok) {
                    missing.push(entry.file);
                    continue;
                }
                await this._writeRelativeFile(dir, entry.arcname, await fileRes.blob());
            }
            if (missing.length) {
                alert(`已导出到目录，但有 ${missing.length} 个素材缺失：\n${missing.slice(0, 8).join("\n")}${missing.length > 8 ? "\n…" : ""}`);
            } else {
                alert("已导出到目录");
            }
        } catch (error) {
            if (error?.name === "AbortError") return;
            alert(`导出失败：${error instanceof Error ? error.message : String(error)}`);
        }
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
                throw new Error(data.error || "导出 ZIP 失败");
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
                alert(`已导出 ZIP，但有 ${missing.length} 个素材缺失：\n${missing.slice(0, 8).join("\n")}${missing.length > 8 ? "\n…" : ""}`);
            }
        } catch (error) {
            if (error?.name === "AbortError") return;
            alert(`导出失败：${error instanceof Error ? error.message : String(error)}`);
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
                    fileObj = await this._readRelativeFile(dir, row.file);
                } catch {
                    warnings.push(`缺少素材：${row.file}`);
                    continue;
                }
                const uploaded = await this._uploadImportBlob(row.kind, fileObj.name || row.file.split("/").pop(), fileObj);
                mapping.set(`${row.kind}|${row.file}`, uploaded.file);
            }
            const remapped = this._remapProjectFiles(project, mapping);
            await this._applyImportedProject(remapped, warnings);
        } catch (error) {
            if (error?.name === "AbortError") return;
            alert(`导入失败：${error instanceof Error ? error.message : String(error)}`);
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
            if (!response.ok) throw new Error(data.error || "导入 ZIP 失败");
            await this._applyImportedProject(data.project, data.warnings || []);
        } catch (error) {
            alert(`导入失败：${error instanceof Error ? error.message : String(error)}`);
        }
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        this._closeInternal(true);
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
            <input class="cat-te-title" type="text" value="未命名项目" aria-label="项目名称" />
            <div class="cat-te-header-spacer"></div>
            <button type="button" class="cat-te-btn cat-te-import">导入 ▾</button>
            <button type="button" class="cat-te-btn cat-te-export">导出 ▾</button>
            <button type="button" class="cat-te-btn cat-te-settings">⚙ 设置</button>
            <button type="button" class="cat-te-btn cat-te-header-close" title="关闭">${iconHtml("close", 16)}</button>
            <input class="cat-te-import-zip" type="file" accept=".zip,application/zip" hidden />
          </header>
          <div class="cat-te-main">
            <aside class="cat-te-media">
              <div class="cat-te-media-tabs">
                <button type="button" class="cat-te-tab active" data-tab="image" title="图片"></button>
                <button type="button" class="cat-te-tab" data-tab="video" title="视频"></button>
                <button type="button" class="cat-te-tab" data-tab="audio" title="音频"></button>
                <button type="button" class="cat-te-media-refresh" title="刷新素材列表"></button>
              </div>
              <div class="cat-te-media-filters"></div>
              <div class="cat-te-media-grid"></div>
            </aside>
            <div class="cat-te-media-split" role="separator" aria-orientation="vertical" aria-label="调整素材栏宽度" title="拖动调整素材栏宽度"></div>
            <div class="cat-te-center">
              <div class="cat-te-program">
                <div class="cat-te-program-stage">
                  <canvas class="cat-te-program-canvas" aria-label="时间轴预览"></canvas>
                  <div class="cat-te-program-empty" hidden>无画面</div>
                </div>
                <div class="cat-te-program-meta"></div>
              </div>
              <div class="cat-te-program-split" role="separator" aria-orientation="horizontal" aria-label="调整预览区高度" title="拖动调整预览区高度"></div>
              <div class="cat-te-timeline-host"></div>
            </div>
            <div class="cat-te-sidebar-split" role="separator" aria-orientation="vertical" aria-label="调整右侧栏宽度" title="拖动调整右侧栏宽度"></div>
            <aside class="cat-te-sidebar">
              <div class="cat-te-clip-info">
                <div class="cat-te-panel-title">选中素材</div>
                <div class="cat-te-clip-info-body">
                  <div class="cat-te-clip-info-detail" hidden>
                    <div class="cat-te-clip-thumb-wrap">
                      <img class="cat-te-clip-thumb" alt="" />
                    </div>
                    <div class="cat-te-clip-meta">
                      <div class="cat-te-clip-name"></div>
                      <div class="cat-te-clip-times">
                        <span class="cat-te-clip-start"></span>
                        <span class="cat-te-clip-sep">→</span>
                        <span class="cat-te-clip-end"></span>
                      </div>
                      <div class="cat-te-clip-dur"></div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="cat-te-clip-settings">
                <label class="cat-te-clip-setting-row">
                  <span>首扩展时长（秒）</span>
                  <input class="cat-te-head-extend" type="number" min="0" max="600" step="1" value="0" disabled />
                </label>
                <label class="cat-te-clip-setting-row">
                  <span>尾扩展时长（秒）</span>
                  <input class="cat-te-tail-extend" type="number" min="0" max="600" step="1" value="0" disabled />
                </label>
                <label class="cat-te-clip-setting-check">
                  <input class="cat-te-gen-preview-video" type="checkbox" disabled />
                  <span>生成预览时长视频</span>
                </label>
                <label class="cat-te-clip-setting-check cat-te-use-global">
                  <input class="cat-te-use-global-cb" type="checkbox" checked disabled />
                  <span>Use Global</span>
                </label>
              </div>
              <div class="cat-te-prompt-wrap">
                <div class="cat-te-prompt-label">Keyframe Prompt</div>
                <div class="cat-te-prompt-input-wrap">
                  <textarea class="cat-te-prompt-input" placeholder="选中素材后编辑提示词…" disabled></textarea>
                </div>
              </div>
              <div class="cat-te-shortcuts">
                Ctrl+点击 多选 · Del 删除（确认）<br>
                Ctrl+C 复制 · Ctrl+V 粘贴<br>
                选中素材时 Ctrl+B 禁用 · Ctrl+G 禁用其他<br>
                Ctrl+滚轮 缩放 · Alt+滚轮 左右滚动
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
                <span class="cat-te-media-preview-title">素材预览</span>
                <div class="cat-te-media-preview-stars"></div>
                <button type="button" class="cat-te-modal-close cat-te-media-preview-close" title="关闭">${iconHtml("close", 16)}</button>
              </div>
              <div class="cat-te-media-preview-body">
                <button type="button" class="cat-te-media-preview-nav prev" title="上一张（右键）" aria-label="上一张">‹</button>
                <div class="cat-te-media-preview-stage"></div>
                <button type="button" class="cat-te-media-preview-nav next" title="下一张（左键）" aria-label="下一张">›</button>
              </div>
              <div class="cat-te-media-preview-footer">
                <span class="cat-te-media-preview-hint">← → 切换 · 左键下一张 · 右键上一张 · 点击星星设置评级</span>
                <div class="cat-te-media-preview-actions">
                  <button type="button" class="cat-te-btn cat-te-media-preview-replace" hidden>替换</button>
                  <button type="button" class="cat-te-btn cat-te-media-preview-end-frame" hidden>设为尾帧</button>
                  <button type="button" class="cat-te-btn cat-te-btn-primary cat-te-media-preview-insert">插入到当前位置</button>
                </div>
              </div>
            </div>
          </div>
          <div class="cat-te-modal-backdrop cat-te-add-material-modal" hidden>
            <div class="cat-te-modal cat-te-add-material-dialog">
              <div class="cat-te-modal-header">
                <span class="cat-te-add-material-title">添加素材</span>
                <button type="button" class="cat-te-modal-close cat-te-add-material-close" title="取消">${iconHtml("close", 16)}</button>
              </div>
              <div class="cat-te-add-material-preview"></div>
              <div class="cat-te-add-material-options">
                <label><input class="cat-te-insert-after-add" type="checkbox" /> 插入到时间轴</label>
              </div>
              <div class="cat-te-add-material-actions">
                <button type="button" class="cat-te-btn cat-te-add-material-cancel">取消</button>
                <button type="button" class="cat-te-btn cat-te-btn-primary cat-te-add-material-confirm">确认</button>
              </div>
            </div>
          </div>
          <div class="cat-te-modal-backdrop cat-te-settings-modal" hidden>
            <div class="cat-te-modal">
              <div class="cat-te-modal-header">
                <span>设置</span>
                <button type="button" class="cat-te-modal-close" title="关闭">${iconHtml("close", 16)}</button>
              </div>
              <div class="cat-te-modal-body">
                <label class="cat-te-modal-row">
                  <span>语言</span>
                  <select class="cat-te-lang-select">
                    <option value="zh">简体中文</option>
                    <option value="en">English</option>
                  </select>
                </label>
                <label class="cat-te-modal-row">
                  <span>自动保存间隔（秒）</span>
                  <input class="cat-te-autosave-interval" type="number" min="1" max="300" step="1" />
                </label>
              </div>
            </div>
          </div>
        `;
        document.body.appendChild(el);
        this._overlay = el;
        this.projectNameInput = el.querySelector(".cat-te-title");
        this.mediaStarFilterHost = el.querySelector(".cat-te-media-filters");
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
        this.promptInput = el.querySelector(".cat-te-prompt-input");
        attachRichPromptHandler(this.promptInput, { mode: "widget" });
        this.useGlobalCb = el.querySelector(".cat-te-use-global-cb");
        this.headExtendInput = el.querySelector(".cat-te-head-extend");
        this.tailExtendInput = el.querySelector(".cat-te-tail-extend");
        this.genPreviewVideoCb = el.querySelector(".cat-te-gen-preview-video");
        this.clipInfoDetail = el.querySelector(".cat-te-clip-info-detail");
        this.clipThumbWrap = el.querySelector(".cat-te-clip-thumb-wrap");
        this.clipThumb = el.querySelector(".cat-te-clip-thumb");
        this.clipNameEl = el.querySelector(".cat-te-clip-name");
        this.clipStartEl = el.querySelector(".cat-te-clip-start");
        this.clipEndEl = el.querySelector(".cat-te-clip-end");
        this.clipDurEl = el.querySelector(".cat-te-clip-dur");
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
        this.mediaPreviewReplaceBtn = el.querySelector(".cat-te-media-preview-replace");
        this.mediaPreviewEndFrameBtn = el.querySelector(".cat-te-media-preview-end-frame");
        this.mediaPreviewFooter = el.querySelector(".cat-te-media-preview-footer");
        this.mediaPreviewHint = el.querySelector(".cat-te-media-preview-hint");
        this.addMaterialModal = el.querySelector(".cat-te-add-material-modal");
        this.addMaterialPreview = el.querySelector(".cat-te-add-material-preview");
        this.addMaterialTitle = el.querySelector(".cat-te-add-material-title");
        this.addMaterialConfirmBtn = el.querySelector(".cat-te-add-material-confirm");
        this.insertAfterAddCb = el.querySelector(".cat-te-insert-after-add");

        this.settingsModal = el.querySelector(".cat-te-settings-modal");
        this.langSelect = el.querySelector(".cat-te-lang-select");
        this.autosaveIntervalInput = el.querySelector(".cat-te-autosave-interval");
        this.importZipInput = el.querySelector(".cat-te-import-zip");
        el.querySelector(".cat-te-import").addEventListener("click", (e) => this._showImportMenu(e));
        el.querySelector(".cat-te-export").addEventListener("click", (e) => this._showExportMenu(e));
        this.importZipInput.addEventListener("change", (e) => void this._importProjectZip(e));
        el.querySelector(".cat-te-header-close").addEventListener("click", () => this.close());
        this.addMaterialInput.addEventListener("change", (e) => this._previewSelectedMaterial(e));
        el.querySelector(".cat-te-add-material-close").addEventListener("click", () => this._closeAddMaterial());
        el.querySelector(".cat-te-add-material-cancel").addEventListener("click", () => this._closeAddMaterial());
        el.querySelector(".cat-te-add-material-confirm").addEventListener("click", () => void this._confirmAddMaterial());

        this.addMaterialModal.addEventListener("click", (e) => {
            if (e.target === this.addMaterialModal) this._closeAddMaterial();
        });
        el.querySelector(".cat-te-media-preview-close").addEventListener("click", () => this._closeMediaPreview());
        this.mediaPreviewModal.addEventListener("click", (e) => {
            if (e.target === this.mediaPreviewModal) this._closeMediaPreview();
        });
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
        this.mediaPreviewReplaceBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            this._replaceSelectedClipFromPreview();
        });
        this.mediaPreviewEndFrameBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            this._setEndFrameFromPreview();
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
        this.projectNameInput.addEventListener("blur", () => {
            this.projectNameInput.value = this.projectNameInput.value.trim() || "未命名项目";
            this._projectNameUndoArmed = false;
        });
        el.querySelector(".cat-te-settings").addEventListener("click", () => this._openSettings());
        this.settingsModal.querySelector(".cat-te-modal-close").addEventListener("click", () => this._closeSettings());
        this.settingsModal.addEventListener("click", (e) => {
            if (e.target === this.settingsModal) this._closeSettings();
        });
        this.langSelect.addEventListener("change", () => {
            localStorage.setItem("cat-te-lang", this.langSelect.value);
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

        el.querySelectorAll(".cat-te-tab").forEach(btn => {
            const tab = btn.dataset.tab;
            const iconName = MEDIA_TAB_ICONS[tab];
            if (iconName) btn.innerHTML = iconHtml(iconName, 14);
            btn.title = MEDIA_TAB_TITLES[tab] || tab;
            btn.addEventListener("click", () => {
                el.querySelectorAll(".cat-te-tab").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                this._mediaTab = btn.dataset.tab;
                if (this._mediaBatchMode) this._mediaBatchSelected.clear();
                this._renderMediaGrid();
            });
        });
        const mediaRefreshBtn = el.querySelector(".cat-te-media-refresh");
        if (mediaRefreshBtn) {
            mediaRefreshBtn.innerHTML = iconHtml("refresh", 14);
            mediaRefreshBtn.addEventListener("click", () => this._refreshMediaLists());
        }

        this.promptInput.addEventListener("focus", () => { this._promptUndoArmed = true; });
        this.promptInput.addEventListener("blur", () => { this._promptUndoArmed = false; });
        this.promptInput.addEventListener("input", () => this._onPromptInput());
        this.useGlobalCb.addEventListener("change", () => this._onUseGlobalChange());
        if (this.headExtendInput && !this.headExtendInput._catTeBound) {
            this.headExtendInput._catTeBound = true;
            this.headExtendInput.addEventListener("change", () => this._onHeadExtendChange());
            this.tailExtendInput?.addEventListener("change", () => this._onTailExtendChange());
            this.genPreviewVideoCb?.addEventListener("change", () => this._onGenPreviewVideoChange());
        }
        this.clipThumbWrap?.addEventListener("click", () => {
            const clip = this._selClip;
            if (clip) this._openClipMediaPreview(clip);
        });

        el.addEventListener("keydown", e => {
            if (!this.mediaPreviewModal.hidden && this._mediaPreviewState?.browse !== false
                && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
                this._stepMediaPreview(e.key === "ArrowRight" ? 1 : -1);
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            if (e.key === "Escape") {
                if (!this.addMaterialModal.hidden) { this._closeAddMaterial(); e.stopPropagation(); return; }
                if (!this.mediaPreviewModal.hidden) { this._closeMediaPreview(); e.stopPropagation(); return; }
                if (!this.settingsModal.hidden) { this._closeSettings(); e.stopPropagation(); return; }
                if (this._removeCtxMenu()) { e.stopPropagation(); return; }
                e.stopPropagation();
                this.close();
            }
        });

        document.addEventListener("click", this._onDocClick = () => {
            if (this._ignoreCtxCloseOnce) {
                this._ignoreCtxCloseOnce = false;
                return;
            }
            this._removeCtxMenu();
        });

        this._applySavedMediaPanelWidth();
        this._bindMediaPanelResize();
        this._applySavedSidebarPanelWidth();
        this._bindSidebarPanelResize();
        this._applySavedProgramPanelHeight();
        this._bindProgramPanelResize();
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
        try {
            const project = JSON.parse(this._w("project_json")?.value || "{}");
            const settings = project?.settings && typeof project.settings === "object" ? project.settings : {};
            return { ...this._readViewFromLocalCache(), ...settings };
        } catch {
            return this._readViewFromLocalCache() || {};
        }
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
                btn.title = track.locked ? "解锁轨道" : "锁定轨道";
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
            btn.title = "轨道可见性";
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
                const off = track.type === "audio" ? "解除静音" : "解除禁音";
                const on = track.type === "audio" ? "轨道静音" : "轨道禁音";
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
        actions.appendChild(this._makeTrackSlot(track, track.type === "image" ? "visible" : null));
        actions.appendChild(this._makeTrackSlot(track, (track.type === "audio" || track.type === "image" || track.type === "video") ? "mute" : null));
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
            ? `确定删除素材「${clips[0].name}」？`
            : `确定删除选中的 ${n} 个素材？`;
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

    _audioUrl(filename) {
        if (!filename) return null;
        return this._assetFileUrl(filename, "audio", "input");
    }

    /** Rebuild media lists from this project's resources + timeline refs only.
     * Do not scan the whole ComfyUI input folder — a new empty node stays empty. */
    async _reloadMediaLibrary() {
        const btn = this._overlay?.querySelector(".cat-te-media-refresh");
        btn?.classList.add("spinning");
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
            btn?.classList.remove("spinning");
        }
    }

    /** Re-check project media status (missing / present), then redraw. */
    async _refreshMediaLists() {
        await this._reloadMediaLibrary();
    }

    _mediaStarsId(kind, file) {
        return `${kind}:${file}`;
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
        const n = Number(this._mediaStarsByDir?.[this._mediaStarsId(kind, file)]);
        return Number.isFinite(n) && n >= 1 && n <= 5 ? n : undefined;
    }

    _setMediaStars(kind, file, stars) {
        const id = this._mediaStarsId(kind, file);
        const n = Number(stars);
        if (Number.isFinite(n) && n >= 1 && n <= 5) this._mediaStarsByDir[id] = n;
        else delete this._mediaStarsByDir[id];
        this._saveMediaStarsForDir();
    }

    _filterFilesByStars(files, kind) {
        if (!this._mediaStarFilter || this._mediaStarFilter === "all") return files;
        const stars = parseInt(this._mediaStarFilter, 10);
        if (!Number.isFinite(stars)) return files;
        return files.filter(file => {
            // Always keep missing items visible so they can be re-linked.
            if (this._mediaStatus.get(`${kind}:${file}`)?.location === "missing") return true;
            return this._getMediaStars(kind, file) === stars;
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
        const bar = document.createElement("div");
        bar.className = "cat-te-media-star-bar";

        const group = document.createElement("div");
        group.className = "cat-te-media-star-filter-group";
        const activeStars = this._mediaStarFilter === "all"
            ? 0
            : parseInt(this._mediaStarFilter, 10) || 0;
        for (let i = 1; i <= 5; i++) {
            const starBtn = document.createElement("button");
            starBtn.type = "button";
            starBtn.className = "cat-te-media-star-filter-star";
            starBtn.innerHTML = iconHtml("star", 12);
            starBtn.title = `筛选 ${i} 星素材`;
            if (i <= activeStars) starBtn.classList.add("on");
            if (String(i) === this._mediaStarFilter) starBtn.classList.add("active");
            starBtn.addEventListener("click", () => {
                this._mediaStarFilter = String(i) === this._mediaStarFilter ? "all" : String(i);
                this._renderMediaGrid();
            });
            group.appendChild(starBtn);
        }
        bar.appendChild(group);

        const actions = document.createElement("div");
        actions.className = "cat-te-media-toolbar-actions";

        const batchBtn = document.createElement("button");
        batchBtn.type = "button";
        batchBtn.className = "cat-te-media-tool-btn";
        batchBtn.classList.toggle("active", this._mediaBatchMode);
        batchBtn.innerHTML = iconHtml("check", 12);
        batchBtn.title = this._mediaBatchMode ? "退出批量选择" : "批量选择删除";
        batchBtn.addEventListener("click", () => this._toggleMediaBatchMode());
        actions.appendChild(batchBtn);

        if (this._mediaBatchMode) {
            const count = this._mediaBatchSelected.size;
            const delBtn = document.createElement("button");
            delBtn.type = "button";
            delBtn.className = "cat-te-media-tool-btn danger";
            delBtn.innerHTML = iconHtml("trash", 12);
            delBtn.title = count ? `删除选中的 ${count} 个素材` : "请先选择素材";
            delBtn.disabled = count === 0;
            if (count) {
                const badge = document.createElement("span");
                badge.className = "cat-te-media-tool-badge";
                badge.textContent = String(count);
                delBtn.appendChild(badge);
            }
            delBtn.addEventListener("click", () => void this._deleteSelectedLibraryMedia());
            actions.appendChild(delBtn);
        }

        const viewBtn = document.createElement("button");
        viewBtn.type = "button";
        viewBtn.className = "cat-te-media-tool-btn";
        viewBtn.classList.toggle("active", this._mediaListView);
        viewBtn.innerHTML = iconHtml(this._mediaListView ? "grid" : "list", 12);
        viewBtn.title = this._mediaListView ? "切换为网格视图" : "切换为列表视图（每行一个）";
        viewBtn.addEventListener("click", () => this._toggleMediaListView());
        actions.appendChild(viewBtn);

        bar.appendChild(actions);
        this.mediaStarFilterHost.appendChild(bar);
    }

    _renderMediaGrid() {
        this._renderMediaStarFilter();
        this.mediaGrid.replaceChildren();
        this._applyMediaGridView();
        if (this._mediaTab === "audio") {
            this._renderAudioMediaGrid();
        } else if (this._mediaTab === "video") {
            this._renderVideoMediaGrid();
        } else {
            this._renderImageMediaGrid();
        }
        requestAnimationFrame(() => this._relayoutMediaListThumbs());
    }

    _renderImageMediaGrid() {
        if (!this._imgFiles.length) {
            const msg = document.createElement("div");
            msg.style.cssText = "width:100%;font-size:10px;color:#666;padding:8px";
            msg.textContent = "暂无上传图片，点击上方按钮添加";
            this.mediaGrid.appendChild(msg);
            return;
        }
        const files = this._filterFilesByStars(this._imgFiles, "image");
        if (!files.length) {
            const msg = document.createElement("div");
            msg.style.cssText = "width:100%;font-size:10px;color:#666;padding:8px";
            msg.textContent = "没有符合筛选条件的素材";
            this.mediaGrid.appendChild(msg);
            return;
        }
        for (const file of files) {
            this.mediaGrid.appendChild(this._makeMediaItem(file, "image"));
        }
    }

    _renderAudioMediaGrid() {
        if (!this._audioFiles.length) {
            const msg = document.createElement("div");
            msg.style.cssText = "width:100%;font-size:10px;color:#666;padding:8px";
            msg.textContent = "暂无上传音频，点击上方按钮添加";
            this.mediaGrid.appendChild(msg);
            return;
        }
        const files = this._filterFilesByStars(this._audioFiles, "audio");
        if (!files.length) {
            const msg = document.createElement("div");
            msg.style.cssText = "width:100%;font-size:10px;color:#666;padding:8px";
            msg.textContent = "没有符合筛选条件的素材";
            this.mediaGrid.appendChild(msg);
            return;
        }
        for (const file of files) {
            this.mediaGrid.appendChild(this._makeMediaItem(file, "audio"));
        }
    }

    _renderVideoMediaGrid() {
        if (!this._videoFiles.length) {
            const msg = document.createElement("div");
            msg.style.cssText = "width:100%;font-size:10px;color:#666;padding:8px";
            msg.textContent = "暂无上传视频，点击上方按钮添加";
            this.mediaGrid.appendChild(msg);
            return;
        }
        const files = this._filterFilesByStars(this._videoFiles, "video");
        if (!files.length) {
            const msg = document.createElement("div");
            msg.style.cssText = "width:100%;font-size:10px;color:#666;padding:8px";
            msg.textContent = "没有符合筛选条件的素材";
            this.mediaGrid.appendChild(msg);
            return;
        }
        for (const file of files) {
            this.mediaGrid.appendChild(this._makeMediaItem(file, "video"));
        }
    }

    /** Whether `file` is already used by a clip on the timeline (as source or end frame). */
    _isMediaOnTimeline(file, kind) {
        if (!this._timeline) return false;
        if (kind === "audio") {
            return this._allAudioTracks().some(t => t.clips.some(c => c.src === file));
        }
        return this._allImageTracks().some(t => t.clips.some(c => {
            if (c.src === file) return true;
            // End-frame refs are image-only.
            if (kind === "image" && this._meta.get(c.id)?.endImage === file) return true;
            return false;
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
            ? `${file}\n点击选择 / 取消选择`
            : `${file}\n点击预览；右键可插入 / 替换 / 删除；也可拖到时间轴`;
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
            addedTag.textContent = "已添加";
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
            if (status.location === "missing") alert("素材文件缺失，请右键选择“重新关联文件”");
            else this._openMediaPreview(file, kind);
        });
        item.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this._mediaBatchMode) return;
            const items = [];
            if (status.location !== "missing") items.push({
                label: "插入时间轴",
                fn: () => {
                    if (kind === "audio") void this._addAudioAtPlayhead(file);
                    else if (kind === "video") void this._addVideoAtPlayhead(file);
                    else void this._addMediaAtPlayhead(file);
                },
            });
            if (status.location !== "missing") items.push({
                label: "替换素材",
                fn: () => this._chooseMaterialFile({ file, kind }),
            });
            if (status.location === "missing") items.push({
                label: "重新关联文件",
                fn: () => this._chooseMaterialFile({ file, kind }),
            });
            items.push({
                label: "删除",
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
        ghost.textContent = file.split(/[\\/]/).pop() || "素材";
        const thumb = item.querySelector("img");
        if (thumb?.src) ghost.style.backgroundImage = `url(${thumb.src})`;
        return ghost;
    }

    _updateMediaDragHover(clientX, clientY) {
        const scroll = this._timeline?.scrollEl;
        if (!scroll) return;
        const r = scroll.getBoundingClientRect();
        const over = clientX >= r.left && clientX <= r.right
            && clientY >= r.top && clientY <= r.bottom;
        scroll.classList.toggle("cat-te-drop-active", over);
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
        this._timeline?.scrollEl?.classList.remove("cat-te-drop-active");
        this._dndHoverClip?.el?.classList.remove("cat-te-drop-target");
        // Keep _dndHoverClip until _commitMediaDrop reads it.
    }

    _commitMediaDrop(media, clientX, clientY) {
        const tl = this._timeline;
        if (!tl || !media?.file) return;
        const scroll = tl.scrollEl;
        if (!scroll) return;
        const r = scroll.getBoundingClientRect();
        if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return;

        const { kind, file } = media;
        const targetClip = this._dndHoverClip
            || this._findClipAt(clientX, clientY)
            || this._findClipAtGeometry(clientX, clientY);
        this._dndHoverClip = null;

        if (targetClip && kind === "image" && targetClip.track.type === "image") {
            // Defer past the click synthesized after pointerup — otherwise the
            // document click listener removes the menu in the same gesture.
            const x = clientX;
            const y = clientY;
            setTimeout(() => this._showDropActionMenu(file, targetClip, x, y), 0);
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
            name: type === "audio" ? "音频" : "副轨道",
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

    /**
     * Package clips are a placeholder container on the image/video tracks —
     * for now they just occupy a slot at the playhead. What they can hold
     * (multiple images, other material) is still to be designed.
     */
    _insertPackageAtPlayhead() {
        if (!this._timeline) return;
        this._insertPackageAtTime(this._timeline.currentTime);
    }

    _insertPackageAtTime(atSec) {
        if (!this._timeline) return;
        const track = this._pickInsertImageTrack(atSec);
        if (!track) {
            alert("没有可插入的图片/视频轨道，或该位置已被占用");
            return;
        }
        const dur = Math.min(2, this._timeline.duration / 4) || 0.1;
        this._recordUndo();
        const clip = this._timeline.addClip(track.id, {
            name: "Package",
            startTime: atSec,
            duration: dur,
            color: "#d9a441",
        });
        const ti = this._trackIndex(track);
        this._meta.set(clip.id, { ...defaultImageMeta(ti), mediaKind: "package", items: [] });
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
        const clip = this._timeline.addClip(track.id, {
            name: filename.split(/[\\/]/).pop(),
            startTime: atSec,
            duration: dur,
            thumbnail: this._imgUrl(filename),
            src: filename,
            color: track.color,
        });
        const ti = this._trackIndex(track);
        this._meta.set(clip.id, { ...defaultImageMeta(ti) });
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
        this._meta.set(clip.id, { ...defaultAudioMeta(ti), sourceDuration: sourceDur, trimIn: 0 });
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
        this._meta.set(clip.id, { ...defaultImageMeta(ti), mediaKind: "video", sourceDuration: dur });
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

    async _grabVideoThumbnail(url, atSec = 0.15) {
        return new Promise((resolve, reject) => {
            const v = document.createElement("video");
            v.preload = "auto";
            v.muted = true;
            v.addEventListener("loadedmetadata", () => {
                v.currentTime = Math.min(Math.max(0, atSec), Math.max(0, v.duration - 0.05));
            });
            v.addEventListener("seeked", () => {
                try {
                    const canvas = document.createElement("canvas");
                    canvas.width = v.videoWidth || 320;
                    canvas.height = v.videoHeight || 180;
                    canvas.getContext("2d").drawImage(v, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL("image/jpeg", 0.72));
                } catch (err) { reject(err); }
            });
            v.addEventListener("error", () => reject(new Error("load failed")));
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
        if (!r.ok) throw new Error(`无法加载音频 (${r.status})`);
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
        for (const resource of this._projectResources) {
            if (resource?.file && resource?.kind) {
                wanted.set(`${resource.kind}:${resource.file}`, { kind: resource.kind, file: resource.file });
            }
        }
        for (const track of this._timeline.tracks) {
            for (const clip of track.clips) {
                const meta = this._meta.get(clip.id);
                if (clip.src) {
                    const kind = track.type === "audio" ? "audio" : (meta?.mediaKind === "video" ? "video" : "image");
                    wanted.set(`${kind}:${clip.src}`, { kind, file: clip.src });
                }
                if (meta?.endImage) wanted.set(`image:${meta.endImage}`, { kind: "image", file: meta.endImage });
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
                }
                out.push(clip);
            }
        }
        return out;
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
            src.connect(ctx.destination);

            let when, offset, dur;
            if (clip.startTime <= startPlayhead) {
                when = startCtxTime;
                offset = clip.sourceOffset + (startPlayhead - clip.startTime);
                dur = clip.endTime - startPlayhead;
            } else {
                when = startCtxTime + (clip.startTime - startPlayhead);
                offset = clip.sourceOffset;
                dur = clip.duration;
            }
            try {
                src.start(when, Math.max(0, offset), Math.max(0.001, dur));
                sources.push(src);
            } catch { /* clip's buffer/offset out of range — skip it */ }
        }
        this._activeAudioSources = sources;
    }

    _stopAudioPlayback() {
        if (this._seekAudioRaf) {
            cancelAnimationFrame(this._seekAudioRaf);
            this._seekAudioRaf = null;
        }
        for (const src of this._activeAudioSources) {
            try { src.stop(); } catch { /* already stopped */ }
            try { src.disconnect(); } catch { /* already disconnected */ }
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

    _applyScalarSettings(settings, { applySettingsFromProject = false } = {}) {
        for (const name of ["fps", "width", "height", "global_prompt"]) {
            const widget = this._w(name);
            if (!widget) continue;
            const sVal = settings[name];
            if (applySettingsFromProject) {
                if (sVal != null) widget.value = sVal;
                continue;
            }
            widget.value = this._resolvedScalar(widget.value, sVal, PY_SCALAR_DEFAULTS[name]);
        }
    }

    /** Keep project_json.settings aligned with node scalar widgets. */
    _syncScalarsToProjectJson() {
        const projectW = this._w("project_json");
        if (!projectW) return;
        let project;
        try {
            project = JSON.parse(projectW.value || "{}");
        } catch {
            return;
        }
        if (!project || typeof project !== "object" || Array.isArray(project)) return;
        if (!project.settings || typeof project.settings !== "object") project.settings = {};
        project.settings.fps = Number(this._w("fps")?.value ?? PY_SCALAR_DEFAULTS.fps);
        project.settings.width = Number(this._w("width")?.value ?? PY_SCALAR_DEFAULTS.width);
        project.settings.height = Number(this._w("height")?.value ?? PY_SCALAR_DEFAULTS.height);
        project.settings.global_prompt = String(this._w("global_prompt")?.value ?? "");
        delete project.settings.ignore_occluded;
        projectW.value = JSON.stringify(project);
        this.node.setDirtyCanvas(true, true);
    }

    async _initTimelineFromWidgetsAsync(projectOverride = null, { applySettingsFromProject = false } = {}) {
        this._meta.clear();
        this._trackInfo.clear();
        this.tlHost.replaceChildren();

        const fps = this.getFps();
        this._timeline = new Timeline(this.tlHost, {
            duration: 60,
            fps,
            timeFormat: "frames",
            zoom: 1.2,
            addTrackTypes: ["image", "audio"],
        });

        let project = projectOverride;
        if (!project) {
            try {
                project = JSON.parse(this._w("project_json")?.value || "{}");
                if (!project || typeof project !== "object" || Array.isArray(project)) throw new Error("invalid project");
            } catch {
                project = {
                    project_version: this._currentVersion(),
                    schema_version: this._currentVersion(),
                    settings: {},
                    tracks: [],
                };
            }
        }

        this._projectResources = Array.isArray(project.resources)
            ? project.resources.filter(resource => resource && resource.file && resource.kind).map(resource => ({ ...resource }))
            : [];
        for (const resource of this._projectResources) {
            if (resource.location) this._mediaStatus.set(`${resource.kind}:${resource.file}`, { location: resource.location });
        }
        this.projectNameInput.value = String(project.name || "未命名项目").trim() || "未命名项目";

        const settings = project.settings && typeof project.settings === "object" ? project.settings : {};
        this._applyScalarSettings(settings, { applySettingsFromProject });
        project.settings = {
            ...settings,
            fps: Number(this._w("fps")?.value ?? PY_SCALAR_DEFAULTS.fps),
            width: Number(this._w("width")?.value ?? PY_SCALAR_DEFAULTS.width),
            height: Number(this._w("height")?.value ?? PY_SCALAR_DEFAULTS.height),
            global_prompt: String(this._w("global_prompt")?.value ?? ""),
        };
        this._timeline.fps = this.getFps();

        const projectTracks = Array.isArray(project.tracks) ? project.tracks : [];
        const tracksCfg = projectTracks.map((track, order) => ({
            ...track,
            type: track.type === "audio" ? "audio" : "image",
            trackIndex: order,
            isMain: track.role === "main",
        }));

        if (!tracksCfg.length) {
            this._createDefaultTracks();
        } else {
            this._loadTracksFromJson(tracksCfg);
        }

        const clips = [];
        projectTracks.forEach((track, trackIndex) => {
            for (const clip of Array.isArray(track.clips) ? track.clips : []) {
                const source = clip.source && typeof clip.source === "object" ? clip.source : {};
                if (source.file && source.location) this._mediaStatus.set(`${clip.type}:${source.file}`, { location: source.location });
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
                    clip_type: clip.type,
                    track: trackIndex,
                    start_ms: startMsOut,
                    duration_ms: durationMsOut,
                    end_ms: startMsOut + durationMsOut,
                    start_image: source.file || null,
                    audio_file: source.file || null,
                    source_duration: (
                        Number(source.duration_ms) > 0
                            ? Number(source.duration_ms)
                            : Math.max(durationMsOut, Number(source.out_ms) - Number(source.in_ms))
                    ) / 1000,
                    trim_in: Math.max(0, Number(source.in_ms) || 0) / 1000,
                    disabled: clip.enabled === false,
                });
            }
        });

        await Promise.all(clips.map(c => this._addClipFromJson(c)));
        await this._reconcileClipSourceDurations();

        this._refreshTimelineDuration();
        this._applyTimelineZoomFromSettings(settings);
        // Merge local cache under project settings so project wins when present.
        const viewSettings = { ...this._readViewFromLocalCache(), ...settings };
        this._applyTimelineViewFromSettings(viewSettings, { applyZoom: false });
        this._decorateAllClips();
        this._bindTimelineEvents();
        this._configureTimelineUi();
        this._syncScalarsToProjectJson();
        this._ensureProgramPreviewObserver();
        this._scheduleProgramPreview();
    }

    _createDefaultTracks() {
        const tl = this._timeline;
        this._mainTrack = tl.addTrack({
            type: "image", name: "主轨道", isMain: true, height: TRACK_HEIGHT, color: "#3d6ec4",
        });
        this._overlayTrack = tl.addTrack({
            type: "image", name: "副轨道", height: TRACK_HEIGHT, color: "#8b4ec8",
        });
        this._audioTrack = tl.addTrack({
            type: "audio", name: "音频", height: TRACK_HEIGHT, color: "#3dd68c",
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
                name: row.name || (row.type === "audio" ? "音频" : "轨道"),
                isMain,
                height: TRACK_HEIGHT,
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
                role: row.role || (isMain ? "main" : (row.type === "audio" ? "audio" : "overlay")),
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
            const af = c.audio_file ?? c.src ?? "";
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
                name: af.split(/[\\/]/).pop() || "音频",
                startTime,
                duration: dur,
                sourceDuration: sourceDur,
                sourceOffset: trimIn,
                src: af,
                waveformPeaks: peaks,
                color: track.color,
            });
            clip._audioBuffer = buffer;
            this._meta.set(clip.id, {
                ...defaultAudioMeta(trackIdx),
                muted: !!c.muted,
                visible: c.visible !== false,
                sourceDuration: sourceDur,
                trimIn,
            });
            this._decorateClip(clip);
            return;
        }

        if (clipType === "package") {
            const clip = this._timeline.addClip(track.id, {
                id: c.id || uid(),
                name: c.name || "Package",
                startTime,
                duration: dur,
                color: "#d9a441",
            });
            this._meta.set(clip.id, {
                ...defaultImageMeta(trackIdx),
                mediaKind: "package",
                items: Array.isArray(c.items) ? c.items : [],
                disabled: !!c.disabled,
                headExtendSec: Math.max(0, Math.round(Number(c.head_extend_sec) || 0)),
                tailExtendSec: Math.max(0, Math.round(Number(c.tail_extend_sec) || 0)),
                generatePreviewVideo: !!c.generate_preview_video,
            });
            this._decorateClip(clip);
            return;
        }

        if (clipType === "video") {
            const vf = c.start_image ?? c.src ?? "";
            const fname = vf.split(/[\\/]/).pop() || "视频";
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
                mediaKind: "video",
                prompt: c.prompt ?? "",
                endImage: c.end_image ?? null,
                useGlobalPrompt: c.use_global_prompt !== false,
                disabled: !!c.disabled,
                visible: c.visible !== false,
                sourceDuration: sourceDur,
                muted: !!c.muted,
                headExtendSec: Math.max(0, Math.round(Number(c.head_extend_sec) || 0)),
                tailExtendSec: Math.max(0, Math.round(Number(c.tail_extend_sec) || 0)),
                generatePreviewVideo: !!c.generate_preview_video,
            });
            this._decorateClip(clip);
            return;
        }

        const img = c.start_image ?? "";
        const fname = img.split(/[\\/]/).pop() || "素材";
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
            prompt: c.prompt ?? "",
            endImage: c.end_image ?? null,
            useGlobalPrompt: c.use_global_prompt !== false,
            disabled: !!c.disabled,
            visible: c.visible !== false,
            headExtendSec: Math.max(0, Math.round(Number(c.head_extend_sec) || 0)),
            tailExtendSec: Math.max(0, Math.round(Number(c.tail_extend_sec) || 0)),
            generatePreviewVideo: !!c.generate_preview_video,
        });
        this._decorateClip(clip);
    }

    _decorateAllClips() {
        for (const track of this._timeline?.tracks ?? []) {
            for (const clip of track.clips) this._decorateClip(clip);
        }
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
        const trackHidden = track.type === "image" && track.visible === false;
        const trackMuted = track.type === "audio" && track.muted;
        const isAudio = m.clipType === "audio" || track.type === "audio";
        const disabled = !isAudio && (!!m.disabled || trackHidden);
        clip.el.classList.toggle("cat-te-clip-disabled", disabled);
        clip.el.classList.toggle("cat-te-clip-muted", isAudio && (!!m.muted || trackMuted));
        clip.el.classList.toggle("cat-te-clip-package", m.mediaKind === "package");
        if (!isAudio) this._scheduleProgramPreview();

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
            muteBadge.title = m.muted ? "解除禁音" : "禁音";
        } else if (muteBadge) {
            muteBadge.remove();
        }

        let badge = clip.el.querySelector(".cat-te-end-badge");
        if (!isAudio && track.type === "image" && m.mediaKind !== "package") {
            if (!badge) {
                badge = document.createElement("div");
                badge.className = "cat-te-end-badge";
                badge.title = "首尾帧（悬停预览）";
                badge.addEventListener("mouseenter", () => this._showStartEndPreview(clip, badge));
                badge.addEventListener("mouseleave", () => this._hideImagePreview());
                clip.el.appendChild(badge);
            }
            badge.textContent = m.endImage ? "首尾" : "首";
        } else if (badge) {
            badge.remove();
        }

        clip.el.querySelector(".cat-te-force-badge")?.remove();
    }

    _refreshClipAppearance(clip) {
        if (!clip?.el) return;
        const label = clip.el.querySelector(".tl-clip-label");
        if (label) label.textContent = clip.name || "素材";
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

    _replaceClipMedia(clip, filename, kind) {
        if (!clip || !filename) return;
        this._recordUndo();
        clip.src = filename;
        clip.name = filename.split(/[\\/]/).pop() || clip.name;

        if (clip.track?.type === "audio" || kind === "audio") {
            void this._fetchPeaks(this._audioUrl(filename)).then(r => {
                clip.waveformPeaks = r.peaks[0];
                clip._audioBuffer = r.buffer;
                clip.sourceDuration = r.duration;
                const m = this._meta.get(clip.id) ?? defaultAudioMeta();
                m.sourceDuration = r.duration;
                this._meta.set(clip.id, m);
                this._refreshClipAppearance(clip);
                this._saveToWidgets();
            }).catch(() => this._refreshClipAppearance(clip));
            this._refreshClipAppearance(clip);
        } else if (kind === "video") {
            const m = this._meta.get(clip.id) ?? defaultImageMeta();
            m.mediaKind = "video";
            m.clipType = "image";
            clip.hasAudio = false;
            clip._audioBuffer = null;
            clip.waveformPeaks = null;
            const url = this._videoUrl(filename);
            void this._grabVideoThumbnail(url).then(thumb => {
                clip.thumbnail = thumb;
                this._refreshClipAppearance(clip);
            }).catch(() => this._refreshClipAppearance(clip));
            void this._fetchPeaks(url).then(r => {
                clip.waveformPeaks = r.peaks[0];
                clip.hasAudio = true;
                clip._audioBuffer = r.buffer;
                this._refreshClipAppearance(clip);
            }).catch(() => {
                clip.hasAudio = false;
                this._refreshClipAppearance(clip);
            });
            void this._probeVideoDuration(url).then(d => {
                if (!Number.isFinite(d) || d <= 0) return;
                clip.sourceDuration = d;
                // Keep timeline length unless the clip was longer than the new source.
                if (clip.duration > d) clip.duration = d;
                clip.sourceOffset = Math.min(clip.sourceOffset || 0, Math.max(0, d - clip.duration));
                m.sourceDuration = d;
                this._meta.set(clip.id, m);
                clip._applyPosition();
                this._refreshTimelineDuration();
                this._saveToWidgets();
            }).catch(() => { /* keep existing */ });
            this._meta.set(clip.id, m);
            this._refreshClipAppearance(clip);
        } else {
            const m = this._meta.get(clip.id) ?? defaultImageMeta();
            m.mediaKind = "image";
            m.clipType = "image";
            clip.thumbnail = this._imgUrl(filename);
            clip.hasAudio = false;
            clip._audioBuffer = null;
            clip.waveformPeaks = null;
            clip.sourceDuration = Infinity;
            clip.sourceOffset = 0;
            delete m.sourceDuration;
            this._meta.set(clip.id, m);
            this._refreshClipAppearance(clip);
        }

        if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
        this._renderMediaGrid();
        this._saveToWidgets();
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

        for (const [label, src] of [["首", startSrc], ["尾", m.endImage ? this._imgUrl(m.endImage) : ""]]) {
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

    _getVisibleMediaFiles(kind) {
        const list = kind === "audio" ? this._audioFiles : kind === "video" ? this._videoFiles : this._imgFiles;
        return this._filterFilesByStars(list, kind);
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
            starBtn.title = `${i} 星`;
            if (i <= current) starBtn.classList.add("on");
            starBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                const cur = this._getMediaStars(kind, file) ?? 0;
                this._setMediaStars(kind, file, cur === i ? undefined : i);
                this._renderMediaPreviewStars(kind, file);
                this._renderMediaGrid();
                if (this._mediaPreviewState?.browse === false) return;
                if (this._mediaPreviewState) {
                    const files = this._getVisibleMediaFiles(kind);
                    if (!files.includes(file) && files.length) {
                        const idx = Math.min(this._mediaPreviewState.index, files.length - 1);
                        this._mediaPreviewState.files = files;
                        this._showMediaPreviewAt(idx);
                    } else {
                        this._mediaPreviewState.files = files;
                        this._mediaPreviewState.index = files.indexOf(file);
                    }
                }
            });
            this.mediaPreviewStars.appendChild(starBtn);
        }
    }

    _updateMediaPreviewNav() {
        this._applyMediaPreviewChrome();
    }

    _applyMediaPreviewChrome() {
        const state = this._mediaPreviewState;
        const browse = state?.browse !== false;
        const multi = browse && (state?.files?.length ?? 0) > 1;

        this.mediaPreviewModal?.classList.toggle("cat-te-media-preview-solo", !browse);

        if (this.mediaPreviewPrevBtn) {
            this.mediaPreviewPrevBtn.hidden = !browse;
            this.mediaPreviewPrevBtn.disabled = !multi;
        }
        if (this.mediaPreviewNextBtn) {
            this.mediaPreviewNextBtn.hidden = !browse;
            this.mediaPreviewNextBtn.disabled = !multi;
        }
        if (this.mediaPreviewFooter) this.mediaPreviewFooter.hidden = !browse;
        if (this.mediaPreviewHint) this.mediaPreviewHint.hidden = !browse;
        if (this.mediaPreviewInsertBtn) this.mediaPreviewInsertBtn.hidden = !browse;

        if (browse) {
            this._updateMediaPreviewInsertBtn();
            this._updateMediaPreviewClipActions();
        } else {
            if (this.mediaPreviewReplaceBtn) this.mediaPreviewReplaceBtn.hidden = true;
            if (this.mediaPreviewEndFrameBtn) this.mediaPreviewEndFrameBtn.hidden = true;
        }
    }

    _previewMediaKindForFile(file) {
        if (this._audioFiles.includes(file)) return "audio";
        if (this._videoFiles.includes(file)) return "video";
        return "image";
    }

    _clipAcceptsPreviewMedia(clip, kind) {
        if (!clip) return false;
        if (clip.track?.type === "audio") return kind === "audio";
        const m = this._meta.get(clip.id);
        if (m?.mediaKind === "package") return false;
        // Visual tracks accept image or video replacements either way.
        if (kind === "audio") return false;
        return kind === "image" || kind === "video";
    }

    _previewTargetClip() {
        const state = this._mediaPreviewState;
        if (state?.targetClipId) {
            const pinned = this._findClipById(state.targetClipId);
            if (pinned) return pinned;
        }
        return this.getSelectedClip();
    }

    _canSetEndFrameFromPreview(clip, kind) {
        if (kind !== "image" || !clip || clip.track?.type === "audio") return false;
        const m = this._meta.get(clip.id);
        if (m?.mediaKind === "package" || m?.mediaKind === "video") return false;
        return true;
    }

    _updateMediaPreviewClipActions() {
        const state = this._mediaPreviewState;
        const replaceBtn = this.mediaPreviewReplaceBtn;
        const endFrameBtn = this.mediaPreviewEndFrameBtn;
        if (!replaceBtn || !endFrameBtn || state?.browse === false) return;

        // Keep the clip pinned when preview opened; only refresh the pin when
        // the user explicitly selects another clip (don't clear on deselect).
        const selected = this.getSelectedClip();
        if (selected && state) state.targetClipId = selected.id;
        const clip = this._previewTargetClip();

        if (!clip || !state?.files?.length) {
            replaceBtn.hidden = true;
            replaceBtn.disabled = true;
            endFrameBtn.hidden = true;
            endFrameBtn.disabled = true;
            return;
        }

        const file = state.files[state.index];
        const kind = state.kind;
        const status = this._mediaStatus.get(`${kind}:${file}`);
        const missing = status?.location === "missing";
        const canReplace = this._clipAcceptsPreviewMedia(clip, kind);

        replaceBtn.hidden = !canReplace;
        replaceBtn.disabled = missing || !canReplace;
        replaceBtn.title = missing ? "素材文件缺失" : "用当前预览素材替换选中片段";

        const canEndFrame = this._canSetEndFrameFromPreview(clip, kind);
        endFrameBtn.hidden = !canEndFrame;
        endFrameBtn.disabled = missing || !canEndFrame;
        endFrameBtn.title = missing ? "素材文件缺失" : "将当前预览图片设为选中片段的尾帧";
    }

    _replaceSelectedClipFromPreview() {
        const state = this._mediaPreviewState;
        if (!state?.files?.length) return;
        const clip = this._previewTargetClip();
        if (!clip) {
            alert("请先在时间轴上选中要替换的片段");
            return;
        }
        const file = state.files[state.index];
        const kind = state.kind;
        if (!this._clipAcceptsPreviewMedia(clip, kind)) {
            alert(kind === "audio" ? "当前选中的不是音频片段" : "当前选中的片段无法替换为该素材");
            return;
        }
        const status = this._mediaStatus.get(`${kind}:${file}`);
        if (status?.location === "missing") {
            alert("素材文件缺失，无法替换");
            return;
        }
        this._replaceClipMedia(clip, file, kind);
        this._closeMediaPreview();
        this._saveToWidgets();
    }

    _setEndFrameFromPreview() {
        const state = this._mediaPreviewState;
        if (!state?.files?.length) return;
        const clip = this._previewTargetClip();
        if (!clip) {
            alert("请先在时间轴上选中要设置尾帧的片段");
            return;
        }
        const file = state.files[state.index];
        const kind = state.kind;
        if (!this._canSetEndFrameFromPreview(clip, kind)) {
            alert("仅图片片段可设置尾帧");
            return;
        }
        const status = this._mediaStatus.get(`${kind}:${file}`);
        if (status?.location === "missing") {
            alert("素材文件缺失，无法设为尾帧");
            return;
        }
        this._setEndImage(clip, file);
        this._closeMediaPreview();
        this._saveToWidgets();
    }

    _updateMediaPreviewInsertBtn() {
        const btn = this.mediaPreviewInsertBtn;
        const state = this._mediaPreviewState;
        if (!btn || state?.browse === false) return;
        if (!state?.files?.length || !this._timeline) {
            btn.disabled = true;
            btn.title = "";
            return;
        }
        const file = state.files[state.index];
        const kind = state.kind;
        const status = this._mediaStatus.get(`${kind}:${file}`);
        const missing = status?.location === "missing";
        btn.disabled = missing;
        const t = this._timeline.formatTime(this._timeline.currentTime);
        btn.title = missing ? "素材文件缺失，无法插入" : `插入到 Seek 位置（${t}）`;
    }

    _insertMediaPreviewAtSeek() {
        const state = this._mediaPreviewState;
        if (!state?.files?.length || !this._timeline) return;
        const file = state.files[state.index];
        const kind = state.kind;
        const status = this._mediaStatus.get(`${kind}:${file}`);
        if (status?.location === "missing") {
            alert("素材文件缺失，无法插入");
            return;
        }
        if (kind === "audio") void this._addAudioAtPlayhead(file);
        else if (kind === "video") void this._addVideoAtPlayhead(file);
        else void this._addMediaAtPlayhead(file);
    }

    _showMediaPreviewAt(index) {
        const state = this._mediaPreviewState;
        if (!state?.files?.length || !this.mediaPreviewModal || !this.mediaPreviewStage) return;

        const n = state.files.length;
        index = ((index % n) + n) % n;
        state.index = index;
        const file = state.files[index];
        const kind = state.kind;

        for (const media of this.mediaPreviewStage.querySelectorAll("audio, video")) {
            media.pause();
            media.removeAttribute("src");
            media.load();
        }
        this.mediaPreviewStage.replaceChildren();

        this.mediaPreviewTitle.textContent = file.split(/[\\/]/).pop() || "素材预览";
        this._renderMediaPreviewStars(kind, file);
        this._updateMediaPreviewNav();

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
        this._updateMediaPreviewClipActions();
    }

    _stepMediaPreview(delta) {
        const state = this._mediaPreviewState;
        if (state?.browse === false) return;
        if (!state?.files?.length || state.files.length <= 1) return;
        this._showMediaPreviewAt(state.index + delta);
    }

    _openMediaPreview(file, kind) {
        const targetClipId = this.getSelectedClip()?.id ?? null;
        const files = this._getVisibleMediaFiles(kind);
        let index = file ? files.indexOf(file) : -1;
        if (index < 0 && file) {
            this._mediaPreviewState = { kind, files: [file], index: 0, browse: true, targetClipId };
            this._showMediaPreviewAt(0);
            return;
        }
        if (!files.length) return;
        if (index < 0) index = 0;
        this._mediaPreviewState = { kind, files, index, browse: true, targetClipId };
        this._showMediaPreviewAt(index);
    }

    _clipMediaKind(clip) {
        const m = this._meta.get(clip.id);
        if (clip.track?.type === "audio" || m?.clipType === "audio") return "audio";
        if (m?.mediaKind === "video") return "video";
        if (m?.mediaKind === "package") return null;
        return "image";
    }

    _openClipMediaPreview(clip) {
        const kind = this._clipMediaKind(clip);
        if (!kind) return;
        const file = clip.src;
        if (!file) return;
        const status = this._mediaStatus.get(`${kind}:${file}`);
        if (status?.location === "missing") {
            alert("素材文件缺失，无法预览");
            return;
        }
        this._mediaPreviewState = { kind, files: [file], index: 0, browse: false };
        this._showMediaPreviewAt(0);
    }

    _closeMediaPreview() {
        if (!this.mediaPreviewModal || !this.mediaPreviewStage) return;
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

    _setAddMaterialMode(isReplace, count = 1) {
        if (this.addMaterialTitle) {
            if (isReplace) this.addMaterialTitle.textContent = "替换素材";
            else this.addMaterialTitle.textContent = count > 1 ? `添加素材（${count}）` : "添加素材";
        }
        if (this.addMaterialConfirmBtn) {
            this.addMaterialConfirmBtn.textContent = isReplace ? "确认替换" : "确认";
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
            alert("替换素材一次只能选择一个文件");
            return;
        }

        const items = [];
        const unsupported = [];
        for (const file of fileList) {
            const kind = this._materialKind(file);
            if (!kind) {
                unsupported.push(file.name);
                continue;
            }
            if (relink && relink.kind !== kind) {
                const expect = relink.kind === "image" ? "图片"
                    : relink.kind === "video" ? "视频" : "音频";
                alert(`请选择同类型的${expect}文件`);
                return;
            }
            items.push({ file, kind, objectUrl: URL.createObjectURL(file) });
        }
        if (!items.length) {
            alert(unsupported.length ? `不支持的素材格式：\n${unsupported.slice(0, 8).join("\n")}` : "不支持的素材格式");
            return;
        }
        if (unsupported.length) {
            alert(`已忽略 ${unsupported.length} 个不支持的文件：\n${unsupported.slice(0, 8).join("\n")}`);
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

    async _confirmAddMaterial() {
        const pending = this._pendingMaterial;
        const items = pending?.items || [];
        if (!items.length) return;
        const relink = pending.relink;
        if (relink) {
            const oldName = String(relink.file || "").split(/[\\/]/).pop() || relink.file;
            const newName = items[0].file?.name || "新素材";
            if (!confirm(`确定用「${newName}」替换「${oldName}」？\n时间轴上引用该素材的片段将一并更新。`)) {
                return;
            }
        }
        const shouldInsert = this.insertAfterAddCb.checked && !relink;
        const confirmBtn = this.addMaterialConfirmBtn;
        if (confirmBtn) confirmBtn.disabled = true;
        try {
            const uploaded = [];
            for (const item of items) {
                uploaded.push(await this._uploadMaterialItem(item));
            }
            this._closeAddMaterial();
            if (relink) {
                this._replaceMediaReference(relink.file, uploaded[0].file, uploaded[0].kind);
                this._saveToWidgets();
            } else {
                for (const u of uploaded) this._registerMediaFile(u.file, u.kind, u.location);
            }
            this._renderMediaGrid();
            if (shouldInsert && this._timeline) {
                let at = this._timeline.currentTime;
                for (const u of uploaded) {
                    this._timeline.setCurrentTime(at, { userSeek: false });
                    if (u.kind === "audio") await this._addAudioAtPlayhead(u.file);
                    else if (u.kind === "video") await this._addVideoAtPlayhead(u.file);
                    else await this._addMediaAtPlayhead(u.file);
                    const clip = this.getSelectedClip();
                    if (clip) at = clip.endTime;
                }
            }
        } catch (error) {
            alert(`${relink ? "替换" : "添加"}素材失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
            if (confirmBtn) confirmBtn.disabled = false;
        }
    }

    _registerMediaFile(file, kind, _location) {
        const location = "input";
        const list = kind === "audio" ? this._audioFiles : kind === "video" ? this._videoFiles : this._imgFiles;
        if (!list.includes(file)) list.push(file);
        this._mediaStatus.set(`${kind}:${file}`, { location });
        const existing = this._projectResources.find(resource => resource.kind === kind && resource.file === file);
        if (existing) existing.location = location;
        else this._projectResources.push({ file, kind, location });
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
        for (const track of this._timeline?.tracks ?? []) {
            for (const clip of track.clips) {
                const meta = this._meta.get(clip.id);
                const clipKind = track.type === "audio" ? "audio" : meta?.mediaKind === "video" ? "video" : "image";
                if (clipKind === kind && clip.src === oldFile) {
                    clip.src = newFile;
                    clip.name = newFile.split(/[\\/]/).pop() || clip.name;
                    clip._audioBuffer = null;
                    if (kind === "image") {
                        clip.thumbnail = this._imgUrl(newFile);
                        clip.hasAudio = false;
                        clip.waveformPeaks = null;
                        clip.sourceDuration = Infinity;
                        clip.sourceOffset = 0;
                    } else if (kind === "video") {
                        clip.thumbnail = null;
                        clip.hasAudio = false;
                        clip.waveformPeaks = null;
                        const url = this._videoUrl(newFile);
                        void this._grabVideoThumbnail(url).then(thumb => {
                            clip.thumbnail = thumb;
                            this._refreshClipAppearance(clip);
                        }).catch(() => this._refreshClipAppearance(clip));
                        void this._fetchPeaks(url).then(r => {
                            clip.waveformPeaks = r.peaks[0];
                            clip.hasAudio = true;
                            clip._audioBuffer = r.buffer;
                            this._refreshClipAppearance(clip);
                        }).catch(() => {
                            clip.hasAudio = false;
                            this._refreshClipAppearance(clip);
                        });
                        void this._probeVideoDuration(url).then(d => {
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
                    } else if (kind === "audio") {
                        void this._fetchPeaks(this._audioUrl(newFile)).then(r => {
                            clip.waveformPeaks = r.peaks[0];
                            clip._audioBuffer = r.buffer;
                            clip.sourceDuration = r.duration;
                            if (meta) {
                                meta.sourceDuration = r.duration;
                                this._meta.set(clip.id, meta);
                            }
                            this._refreshClipAppearance(clip);
                        }).catch(() => this._refreshClipAppearance(clip));
                    }
                    this._refreshClipAppearance(clip);
                    if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
                }
                if (kind === "image" && meta?.endImage === oldFile) {
                    meta.endImage = newFile;
                    this._decorateClip(clip);
                }
            }
        }
        this._swapMediaListEntry(oldFile, newFile, kind);
        let sawResource = false;
        for (const resource of this._projectResources) {
            if (resource.kind === kind && (resource.file === oldFile || resource.file === newFile)) {
                resource.file = newFile;
                resource.location = "input";
                sawResource = true;
            }
        }
        if (!sawResource) this._projectResources.push({ file: newFile, kind, location: "input" });
        this._projectResources = [...new Map(
            this._projectResources.map(resource => [`${resource.kind}:${resource.file}`, resource]),
        ).values()];
    }

    /** Remove one library media from project/timeline lists. Returns whether disk delete is needed. */
    _removeLibraryMediaEntry(file, kind) {
        const status = this._mediaStatus.get(`${kind}:${file}`) || { location: "input" };
        const missing = status.location === "missing";
        const removedClipIds = new Set();
        for (const track of this._timeline?.tracks ?? []) {
            for (const clip of [...track.clips]) {
                const meta = this._meta.get(clip.id);
                const clipKind = track.type === "audio" ? "audio" : meta?.mediaKind === "video" ? "video" : "image";
                if (clipKind === kind && clip.src === file) {
                    removedClipIds.add(clip.id);
                    this._meta.delete(clip.id);
                    this._timeline.removeClip(track.id, clip.id);
                    this._pruneEmptyTrack(track);
                    continue;
                }
                if (kind === "image" && meta?.endImage === file) {
                    meta.endImage = null;
                    this._meta.set(clip.id, meta);
                    this._decorateClip(clip);
                }
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
        this._setMediaStars(kind, file, undefined);
        this._projectResources = this._projectResources.filter(
            resource => !(resource.kind === kind && resource.file === file),
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
        if (!response.ok) throw new Error(data.error || "删除文件失败");
    }

    async _deleteLibraryMedia(file, kind) {
        const label = file.split(/[\\/]/).pop() || file;
        const onTimeline = this._isMediaOnTimeline(file, kind);
        const status = this._mediaStatus.get(`${kind}:${file}`) || { location: "input" };
        const missing = status.location === "missing";
        const msg = missing
            ? `确定删除失联素材「${label}」？相关时间轴素材将一并移除。`
            : onTimeline
                ? `确定删除素材「${label}」？将从素材库与磁盘移除，相关时间轴素材也会一并删除。`
                : `确定删除素材「${label}」？将从素材库与磁盘移除。`;
        if (!confirm(msg)) return;

        this._recordUndo();
        const { needDisk } = this._removeLibraryMediaEntry(file, kind);
        this._syncSelectedClip();
        this._updatePromptPanel();
        if (needDisk) {
            try {
                await this._deleteDiskAsset(file, kind);
            } catch (error) {
                alert(`素材已从工程移除，但磁盘文件删除失败：${error instanceof Error ? error.message : String(error)}`);
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
            ? `确定删除选中的 ${entries.length} 个素材？将从素材库与磁盘移除，相关时间轴素材也会一并删除。`
            : `确定删除选中的 ${entries.length} 个素材？将从素材库与磁盘移除。`;
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
            alert(`已从工程移除，但有 ${failed.length} 个磁盘文件删除失败。`);
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
            ?? (clip.track.type === "audio" ? defaultAudioMeta() : defaultImageMeta());
        const isAudio = clip.track.type === "audio" || m.clipType === "audio";
        const t = this._timeline.currentTime;
        const canSplit = t > clip.startTime && t < clip.endTime;
        const items = [
            ...(canSplit ? [{ label: "分割", fn: () => this._splitClip(clip) }] : []),
        ];
        if (isAudio) {
            items.push({
                label: m.muted ? "解除禁音" : "禁音",
                fn: () => {
                    m.muted = !m.muted;
                    this._meta.set(clip.id, m);
                    this._decorateClip(clip);
                },
            });
        } else {
            items.push(
                { label: "运行", fn: () => void this._runClipDownstream(clip) },
                { label: m.disabled ? "启用  Ctrl+B" : "禁用  Ctrl+B", strike: !!m.disabled, fn: () => this._toggleDisableClip(clip) },
                { label: "禁用其他素材  Ctrl+G", fn: () => this._disableOthers(clip) },
                ...(m.endImage ? [
                    { label: "交换首尾帧", fn: () => this._swapStartEndFrames(clip) },
                    { label: "移除尾帧", fn: () => this._clearEndImage(clip) },
                ] : []),
            );
        }
        items.push(
            { label: "复制  Ctrl+C", fn: () => this._copySelectedClips() },
            { label: "粘贴  Ctrl+V", fn: () => this._pasteClips() },
            { label: "删除", fn: () => this._deleteClip(clip), danger: true },
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
        return m;
    }

    _snapshotClip(clip) {
        const isAudio = clip.track?.type === "audio";
        const meta = this._meta.get(clip.id)
            ?? (isAudio ? defaultAudioMeta() : defaultImageMeta());
        return {
            trackId: clip.track.id,
            trackType: isAudio ? "audio" : "image",
            startTime: clip.startTime,
            duration: clip.duration,
            name: clip.name,
            src: clip.src,
            thumbnail: clip.thumbnail,
            color: clip.color,
            sourceDuration: clip.sourceDuration,
            sourceOffset: clip.sourceOffset || 0,
            hasAudio: !!clip.hasAudio,
            waveformPeaks: clip._waveform?.length ? clip._waveform.slice() : null,
            audioBuffer: clip._audioBuffer ?? null,
            meta: this._cloneClipMeta(meta),
        };
    }

    /** @returns {boolean} true if anything was copied */
    _copySelectedClips() {
        const clips = this._timeline?.getSelectedClips() ?? [];
        if (!clips.length) return false;
        const ordered = [...clips].sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
        CapTimelineEditorApp._clipClipboard = ordered.map(c => this._snapshotClip(c));
        return true;
    }

    _resolvePasteTrack(snap) {
        const tl = this._timeline;
        if (!tl || !snap) return null;
        const wantAudio = snap.trackType === "audio";
        const orig = tl.getTrack(snap.trackId);
        if (orig && !orig.locked && orig.visible !== false) {
            const ok = wantAudio ? orig.type === "audio" : (orig.type === "image" || orig.type === "video");
            if (ok) return orig;
        }
        if (wantAudio) {
            return this._allAudioTracks().find(t => !t.locked && t.visible !== false)
                ?? this._createInsertTrack("audio");
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

    /**
     * Paste clipboard clips after the last clip on the preferred track
     * (or at the playhead when it is already past that point), keeping
     * relative offsets within the copied group.
     * @returns {boolean} true if anything was pasted
     */
    _pasteClips() {
        const snaps = CapTimelineEditorApp._clipClipboard;
        const tl = this._timeline;
        if (!snaps?.length || !tl) return false;

        this._recordUndo();

        const minStart = Math.min(...snaps.map(s => s.startTime));
        const tracks = snaps.map(s => this._resolvePasteTrack(s));
        if (tracks.some(t => !t)) return false;

        let pasteBase = 0;
        for (const track of tracks) {
            for (const c of track.clips) pasteBase = Math.max(pasteBase, c.endTime);
        }
        if (tl.currentTime >= pasteBase) pasteBase = tl.currentTime;

        // Shift the whole group forward until every clip fits on its track.
        for (let guard = 0; guard < 64; guard++) {
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
                hasAudio: !!snap.hasAudio,
                waveformPeaks: snap.waveformPeaks || undefined,
            });
            if (!clip) continue;
            clip._audioBuffer = snap.audioBuffer ?? null;
            const meta = this._cloneClipMeta(snap.meta);
            meta.trackIndex = this._trackIndex(track);
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
        return true;
    }

    /**
     * Queue the workflow so Timeline Editor emits data_json / clips_audio for
     * only this visual clip (others temporarily disabled for the queue snapshot).
     */
    async _runClipDownstream(clip) {
        if (!clip || !this.node) return;
        const m = this._meta.get(clip.id) ?? defaultImageMeta();
        if (clip.track?.type === "audio" || m.clipType === "audio") {
            alert("音频片段不会进入 data_json，请选择图片/视频片段。");
            return;
        }
        if (typeof app?.queuePrompt !== "function") {
            alert("无法排队工作流：找不到 queuePrompt。");
            return;
        }

        // Snapshot enable/disable so the editor UI is restored after queue.
        const snapshot = [];
        for (const track of this._allImageTracks()) {
            for (const c of track.clips) {
                const meta = this._meta.get(c.id) ?? defaultImageMeta();
                snapshot.push({ id: c.id, disabled: !!meta.disabled });
            }
        }

        try {
            for (const track of this._allImageTracks()) {
                for (const c of track.clips) {
                    const meta = this._meta.get(c.id) ?? defaultImageMeta();
                    const next = c.id !== clip.id;
                    if (meta.disabled !== next) {
                        meta.disabled = next;
                        this._meta.set(c.id, meta);
                        this._decorateClip(c);
                    }
                }
            }
            // Ensure the chosen clip itself is enabled and its track is usable.
            const self = this._meta.get(clip.id) ?? defaultImageMeta();
            self.disabled = false;
            self.visible = true;
            this._meta.set(clip.id, self);
            if (clip.track?.visible === false) clip.track.setVisible?.(true);
            this._decorateClip(clip);
            this._saveToWidgets();
            this._openedProjectJson = JSON.stringify(this._buildProject());

            await app.queuePrompt(0);
        } catch (error) {
            alert(`运行失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
            for (const row of snapshot) {
                const c = this._findClipById(row.id);
                if (!c) continue;
                const meta = this._meta.get(c.id) ?? defaultImageMeta();
                if (meta.disabled !== row.disabled) {
                    meta.disabled = row.disabled;
                    this._meta.set(c.id, meta);
                    this._decorateClip(c);
                }
            }
            this._saveToWidgets();
            this._openedProjectJson = JSON.stringify(this._buildProject());
            this._updatePromptPanel();
        }
    }

    _showDropActionMenu(file, clip, x, y) {
        this._timeline.selectClip(clip);
        const items = [
            { label: "替换素材", fn: () => this._replaceClipMedia(clip, file, this._previewMediaKindForFile(file)) },
        ];
        if (this._canSetEndFrameFromPreview(clip, "image")) {
            items.push({ label: "设置为尾帧", fn: () => this._setEndImage(clip, file) });
        }
        this._buildCtxMenu(items, x, y);
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

    _setEndImage(clip, filename) {
        this._recordUndo();
        const m = this._meta.get(clip.id) ?? defaultImageMeta();
        m.endImage = filename;
        this._meta.set(clip.id, m);
        this._decorateClip(clip);
        this._renderMediaGrid();
    }

    _clearEndImage(clip) {
        this._recordUndo();
        const m = this._meta.get(clip.id) ?? defaultImageMeta();
        m.endImage = null;
        this._meta.set(clip.id, m);
        this._decorateClip(clip);
        this._renderMediaGrid();
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
        });
        left._audioBuffer = audioBuffer;
        this._meta.set(left.id, cloneMeta());

        const right = tl.addClip(track.id, {
            ...shared,
            startTime: t,
            duration: rightDur,
            // Keep media in sync: right half continues from the split point.
            sourceOffset: sourceOffset + leftDur,
        });
        right._audioBuffer = audioBuffer;
        this._meta.set(right.id, cloneMeta());

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
    }

    _disposeProgramPreview() {
        if (this._programPreviewRaf) {
            cancelAnimationFrame(this._programPreviewRaf);
            this._programPreviewRaf = 0;
        }
        this._programStageObserver?.disconnect();
        this._programStageObserver = null;
        for (const entry of this._previewVideos.values()) {
            try {
                entry.el.pause();
                entry.el.removeAttribute("src");
                entry.el.load();
            } catch { /* ignore */ }
        }
        this._previewVideos.clear();
        this._previewImages.clear();
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
            this._scheduleProgramPreview();
        };
        img.onerror = () => { entry.ready = false; };
        img.src = url;
        this._previewImages.set(url, entry);
        return entry;
    }

    _ensurePreviewVideo(file) {
        if (!file) return null;
        let entry = this._previewVideos.get(file);
        if (entry) return entry;
        const v = document.createElement("video");
        v.muted = true;
        v.playsInline = true;
        v.preload = "auto";
        entry = { el: v, ready: false, seeking: false, wantTime: 0 };
        v.addEventListener("loadeddata", () => {
            entry.ready = true;
            this._scheduleProgramPreview();
        });
        v.addEventListener("seeked", () => {
            entry.seeking = false;
            if (Math.abs((entry.wantTime || 0) - v.currentTime) > 0.05) {
                this._seekPreviewVideo(entry, entry.wantTime);
            } else {
                this._scheduleProgramPreview();
            }
        });
        v.addEventListener("error", () => { entry.ready = false; });
        v.src = this._videoUrl(file);
        this._previewVideos.set(file, entry);
        return entry;
    }

    _seekPreviewVideo(entry, mediaTime) {
        if (!entry?.el) return;
        const v = entry.el;
        const t = Math.max(0, Number(mediaTime) || 0);
        entry.wantTime = t;
        if (!entry.ready && v.readyState < 1) return;
        if (entry.seeking) return;
        const eps = this._timeline?._playing ? Math.max(0.05, 1 / this.getFps()) : 0.03;
        if (Math.abs(v.currentTime - t) <= eps) return;
        entry.seeking = true;
        try {
            v.currentTime = Math.min(t, Number.isFinite(v.duration) ? Math.max(0, v.duration - 0.001) : t);
        } catch {
            entry.seeking = false;
        }
    }

    _drawCover(ctx, media, cw, ch) {
        const mw = media.videoWidth || media.naturalWidth || media.width || 0;
        const mh = media.videoHeight || media.naturalHeight || media.height || 0;
        if (!mw || !mh) return false;
        const scale = Math.max(cw / mw, ch / mh);
        const dw = mw * scale;
        const dh = mh * scale;
        ctx.drawImage(media, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
        return true;
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
                if (m.mediaKind === "package") {
                    layers.push({ kind: "package", clip, meta: m });
                    continue;
                }
                if (m.mediaKind === "video") {
                    layers.push({ kind: "video", clip, meta: m });
                } else {
                    layers.push({ kind: "image", clip, meta: m });
                }
            }
        }
        return layers;
    }

    async _renderProgramPreview() {
        const layout = this._layoutProgramCanvas();
        const canvas = this.programCanvas;
        if (!layout || !canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const { canvasW: cw, canvasH: ch } = layout;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, cw, ch);

        const t = this._timeline?.currentTime ?? 0;
        const layers = this._collectPreviewLayers(t);
        let drew = false;

        for (const layer of layers) {
            if (layer.kind === "package") {
                ctx.fillStyle = "#1a1a28";
                ctx.fillRect(0, 0, cw, ch);
                ctx.fillStyle = "#8a8ab0";
                ctx.font = `${Math.max(12, Math.round(ch * 0.06))}px sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(layer.clip.name || "Package", cw / 2, ch / 2);
                drew = true;
                continue;
            }
            if (layer.kind === "video") {
                const entry = this._ensurePreviewVideo(layer.clip.src);
                if (!entry) continue;
                const mediaTime = (layer.clip.sourceOffset || 0) + (t - layer.clip.startTime);
                this._seekPreviewVideo(entry, mediaTime);
                if (entry.ready && entry.el.readyState >= 2) {
                    if (this._drawCover(ctx, entry.el, cw, ch)) drew = true;
                }
                continue;
            }
            // image (+ optional end-frame crossfade centered in the clip, ≤1s)
            const startUrl = layer.clip.src ? this._imgUrl(layer.clip.src) : "";
            const startEntry = this._ensurePreviewImage(startUrl);
            if (startEntry?.ready) {
                if (this._drawCover(ctx, startEntry.el, cw, ch)) drew = true;
            }
            if (layer.meta.endImage) {
                const endEntry = this._ensurePreviewImage(this._imgUrl(layer.meta.endImage));
                if (endEntry?.ready) {
                    const dur = Math.max(1e-6, layer.clip.duration);
                    const fadeDur = Math.min(1, dur);
                    const localT = t - layer.clip.startTime;
                    const fadeStart = (dur - fadeDur) / 2;
                    const fadeAlpha = Math.min(1, Math.max(0, (localT - fadeStart) / fadeDur));
                    if (fadeAlpha > 0) {
                        ctx.save();
                        ctx.globalAlpha = fadeAlpha;
                        if (this._drawCover(ctx, endEntry.el, cw, ch)) drew = true;
                        ctx.restore();
                    }
                }
            }
        }

        if (this.programEmpty) this.programEmpty.hidden = drew;
    }

    _configureTimelineUi() {
        const tl = this._timeline;
        if (!tl) return;
        this.footerPlayback.replaceChildren(tl.playbackControlsEl);

        const packageBtn = document.createElement("button");
        packageBtn.type = "button";
        packageBtn.className = "tl-btn tl-btn-add-package";
        packageBtn.title = "在播放头位置插入一个 Package";
        packageBtn.textContent = "+ 插入Package";
        packageBtn.addEventListener("click", () => this._insertPackageAtPlayhead());
        tl.toolbarEl.appendChild(packageBtn);

        const materialBtn = document.createElement("button");
        materialBtn.type = "button";
        materialBtn.className = "tl-btn tl-btn-insert-material";
        materialBtn.title = "添加素材（可多选）";
        materialBtn.textContent = "添加素材";
        materialBtn.addEventListener("click", () => this._chooseMaterialFile());
        tl.toolbarEl.appendChild(materialBtn);

        // Undo/redo is buttons-only, not a keyboard shortcut — Ctrl+Z can't
        // be reliably intercepted here (ComfyUI's own graph-undo shortcut
        // may be registered ahead of anything this extension attaches, so
        // stopPropagation can't guarantee it loses the race) and was
        // closing the fullscreen editor instead of undoing within it.
        this.undoBtn = document.createElement("button");
        this.undoBtn.type = "button";
        this.undoBtn.className = "tl-btn tl-btn-history";
        this.undoBtn.title = "还原";
        this.undoBtn.textContent = "↶ 还原";
        this.undoBtn.addEventListener("click", () => this.undo());

        this.redoBtn = document.createElement("button");
        this.redoBtn.type = "button";
        this.redoBtn.className = "tl-btn tl-btn-history";
        this.redoBtn.title = "重做";
        this.redoBtn.textContent = "↷ 重做";
        this.redoBtn.addEventListener("click", () => this.redo());
        tl.toolbarEl.prepend(this.undoBtn, this.redoBtn);

        this._updateHistoryButtons();

        // The "+ 轨道" dropdown is built and handled entirely inside
        // Timeline.js, so there's no app-level call site to record an undo
        // point right before the new track is actually added. Recording it
        // here (before the menu even opens) is the closest equivalent —
        // worst case, a cancelled menu leaves one harmless no-op undo step.
        tl.toolbarEl.querySelector(".tl-btn-add-track")
            ?.addEventListener("click", () => this._recordUndo());

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
                    [{ label: "粘贴  Ctrl+V", fn: () => this._pasteClips() }],
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
            this._updatePromptPanel();
            this._updateMediaPreviewClipActions();
            this._overlay?.focus();
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
            this._updateMediaPreviewClipActions();
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
                ?? (to.type === "audio" ? defaultAudioMeta() : defaultImageMeta());
            m.trackIndex = this._trackIndex(to);
            if (to.type === "audio") m.clipType = "audio";
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
        tl.on("clip:move", ({ clip }) => {
            if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
            this._refreshTimelineDuration();
            this._scheduleProgramPreview();
        });
        tl.on("clip:resize", ({ clip }) => {
            if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
            this._refreshTimelineDuration();
            this._scheduleProgramPreview();
        });
        // A drag (move/trim) fires many per-frame events; only the gesture
        // as a whole should become one undo step, and only if it actually
        // changed anything.
        tl.on("clip:movestart", () => this._beginPendingUndo());
        tl.on("clip:moveend", ({ moved }) => this._commitPendingUndo(moved));
        tl.on("clip:resizestart", () => this._beginPendingUndo());
        tl.on("clip:resizeend", ({ moved }) => this._commitPendingUndo(moved));
        tl.on("track:add", ({ track }) => {
            if (!this._trackInfo.has(track.id)) {
                this._trackInfo.set(track.id, { trackIndex: this._nextTrackIndex() });
            }
            track.height = TRACK_HEIGHT;
            track.el.style.height = `${TRACK_HEIGHT}px`;
            track.headerEl.style.height = `${TRACK_HEIGHT}px`;
            this._setupTrackControls(track);
        });
        tl.on("zoomchange", () => this._refreshTimelineDuration());
        tl.on("play", () => this._startAudioPlayback());
        tl.on("pause", () => this._stopAudioPlayback());
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
        this.clipInfoDetail.hidden = true;
        this.clipThumb.removeAttribute("src");
        this.clipThumb.style.display = "";
        this.clipThumb.parentElement.classList.remove("cat-te-clip-thumb-audio");
        this.clipThumbWrap?.classList.remove("cat-te-clip-thumb-clickable");
        this.clipThumbWrap?.removeAttribute("title");
        this.clipNameEl.textContent = "";
        this.clipStartEl.textContent = "";
        this.clipEndEl.textContent = "";
        this.clipDurEl.textContent = "";
    }

    _updateClipInfoPanel(clip) {
        if (!clip) {
            this._clearClipInfoPanel();
            return;
        }
        const tl = this._timeline;
        const track = clip.track;
        const isAudio = track.type === "audio";
        this.clipInfoDetail.hidden = false;
        if (isAudio) {
            this.clipThumb.removeAttribute("src");
            this.clipThumb.style.display = "none";
            this.clipThumb.parentElement.classList.add("cat-te-clip-thumb-audio");
        } else {
            this.clipThumb.style.display = "";
            this.clipThumb.parentElement.classList.remove("cat-te-clip-thumb-audio");
            this.clipThumb.src = clip.thumbnail || "";
        }
        const canPreview = !isAudio || !!clip.src;
        const isPackage = (this._meta.get(clip.id)?.mediaKind === "package");
        this.clipThumbWrap.classList.toggle("cat-te-clip-thumb-clickable", canPreview && !isPackage && !!clip.src);
        this.clipThumbWrap.title = (canPreview && !isPackage && clip.src) ? "点击预览素材" : "";
        this.clipNameEl.textContent = clip.name || "素材";
        this.clipStartEl.textContent = tl.formatTime(clip.startTime);
        this.clipEndEl.textContent = tl.formatTime(clip.endTime);
        const fps = this.getFps();
        const totalFrames = Math.max(0, frameIndexFromSecs(clip.endTime, fps) - frameIndexFromSecs(clip.startTime, fps));
        this.clipDurEl.textContent = `时长 ${tl.formatTime(clip.duration)}（总帧数 ${totalFrames}）`;
    }

    /** Ensure `_meta` has an entry for `clip` (create defaults if missing). */
    _ensureClipMeta(clip) {
        if (!clip) return null;
        let m = this._meta.get(clip.id);
        if (m) return m;
        const ti = this._trackIndex(clip.track);
        m = clip.track?.type === "audio" ? defaultAudioMeta(ti) : defaultImageMeta(ti);
        this._meta.set(clip.id, m);
        return m;
    }

    /** Re-resolve right-panel setting controls if refs are stale/missing. */
    _syncClipSettingRefs() {
        const el = this._overlay;
        if (!el) return;
        const head = el.querySelector(".cat-te-head-extend");
        const tail = el.querySelector(".cat-te-tail-extend");
        const gen = el.querySelector(".cat-te-gen-preview-video");
        if (!head) return;
        if (head === this.headExtendInput && tail === this.tailExtendInput && gen === this.genPreviewVideoCb) {
            return;
        }
        this.headExtendInput = head;
        this.tailExtendInput = tail;
        this.genPreviewVideoCb = gen;
        if (!head._catTeBound) {
            head._catTeBound = true;
            head.addEventListener("change", () => this._onHeadExtendChange());
            tail?.addEventListener("change", () => this._onTailExtendChange());
            gen?.addEventListener("change", () => this._onGenPreviewVideoChange());
        }
    }

    _updatePromptPanel() {
        const clip = this._syncSelectedClip();
        this._syncClipSettingRefs();
        this._updateClipInfoPanel(clip);
        // Visual vs audio is owned by the track; don't require `_meta` to already exist.
        const isAudio = clip?.track?.type === "audio";
        const m = clip ? this._ensureClipMeta(clip) : null;
        const isVisual = !!(clip && !isAudio);
        const label = this._overlay?.querySelector(".cat-te-prompt-label");
        if (isVisual) {
            // Enable clip settings first so a later prompt-mirror error cannot leave them stuck disabled.
            if (this.headExtendInput) {
                this.headExtendInput.disabled = false;
                this.headExtendInput.value = String(Math.max(0, Math.round(Number(m.headExtendSec) || 0)));
            }
            if (this.tailExtendInput) {
                this.tailExtendInput.disabled = false;
                this.tailExtendInput.value = String(Math.max(0, Math.round(Number(m.tailExtendSec) || 0)));
            }
            if (this.genPreviewVideoCb) {
                this.genPreviewVideoCb.disabled = false;
                this.genPreviewVideoCb.checked = !!m.generatePreviewVideo;
            }
            if (this.promptInput) this.promptInput.disabled = false;
            if (this.useGlobalCb) {
                this.useGlobalCb.disabled = false;
                this.useGlobalCb.checked = m.useGlobalPrompt !== false;
            }
            setRichPromptValue(this.promptInput, m.prompt ?? "", true);
            if (label) label.textContent = "Keyframe Prompt";
        } else {
            if (this.headExtendInput) {
                this.headExtendInput.disabled = true;
                this.headExtendInput.value = "0";
            }
            if (this.tailExtendInput) {
                this.tailExtendInput.disabled = true;
                this.tailExtendInput.value = "0";
            }
            if (this.genPreviewVideoCb) {
                this.genPreviewVideoCb.disabled = true;
                this.genPreviewVideoCb.checked = false;
            }
            if (this.promptInput) this.promptInput.disabled = true;
            if (this.useGlobalCb) this.useGlobalCb.disabled = true;
            setRichPromptValue(this.promptInput, "", false);
            if (label) label.textContent = isAudio ? "音频素材（无提示词）" : "Keyframe Prompt";
        }
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
            this._promptUndoArmed = false; // one undo step per focus session, not per keystroke
        }
        const m = this._meta.get(this._selClip.id) ?? defaultImageMeta();
        m.prompt = this.promptInput.value;
        this._meta.set(this._selClip.id, m);
    }

    _onUseGlobalChange() {
        if (!this._selClip) return;
        this._recordUndo();
        const m = this._meta.get(this._selClip.id) ?? defaultImageMeta();
        m.useGlobalPrompt = !!this.useGlobalCb.checked;
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

    /** Build the complete, editable and lossless project document. */
    _buildProject() {
        const fps = this.getFps();
        const tracks = (this._timeline?.tracks ?? []).map((track, order) => {
            const ti = this._trackIndex(track);
            const clips = track.clips.map(clip => {
                const m = this._meta.get(clip.id)
                    ?? (track.type === "audio" ? defaultAudioMeta(ti) : defaultImageMeta(ti));
                // Frame-grid ms so abutting clips share boundaries on reload.
                const { startMs, durationMs } = encodeClipTimingMs(clip.startTime, clip.duration, fps);
                const sourceInFrames = Math.max(0, Math.round((clip.sourceOffset || 0) * fps));
                const sourceInMs = Math.round((sourceInFrames * 1000) / fps);
                const source = {
                    kind: track.type === "audio" ? "audio" : (m.mediaKind || "image"),
                    file: clip.src || "",
                };
                source.location = "input";
                if (track.type === "audio" || m.mediaKind === "video") {
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
                    type: track.type === "audio" ? "audio" : (m.mediaKind || "image"),
                    enabled: !m.disabled,
                    visible: m.visible !== false,
                    start_ms: startMs,
                    duration_ms: durationMs,
                    source,
                };
                if (track.type === "audio") {
                    row.muted = !!m.muted;
                } else {
                    row.prompt = m.prompt ?? "";
                    row.end_image = m.endImage ?? null;
                    row.use_global_prompt = m.useGlobalPrompt !== false;
                    row.head_extend_sec = Math.max(0, Math.round(Number(m.headExtendSec) || 0));
                    row.tail_extend_sec = Math.max(0, Math.round(Number(m.tailExtendSec) || 0));
                    row.generate_preview_video = !!m.generatePreviewVideo;
                    if (m.mediaKind === "video") {
                        row.has_audio = !!clip.hasAudio;
                        row.muted = !!m.muted;
                    }
                    if (m.mediaKind === "package") {
                        row.name = clip.name || "Package";
                        row.items = Array.isArray(m.items) ? m.items : [];
                    }
                }
                return row;
            });
            const trackInfo = this._trackInfo.get(track.id) || {};
            return {
                id: track.id,
                type: track.type === "audio" ? "audio" : "visual",
                role: track.isMain ? "main" : (trackInfo.role || (track.type === "audio" ? "audio" : "overlay")),
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
            schema_version: this._currentVersion(),
            name: String(this.projectNameInput?.value || "未命名项目").trim() || "未命名项目",
            resources: this._projectResources.map(resource => ({
                file: resource.file,
                kind: resource.kind,
                location: "input",
            })),
            settings: {
                fps: Number(this._w("fps")?.value ?? 24),
                width: Number(this._w("width")?.value ?? 1280),
                height: Number(this._w("height")?.value ?? 720),
                global_prompt: String(this._w("global_prompt")?.value ?? ""),
                timeline_zoom: Number(this._timeline?.getZoom() ?? 1.2),
                current_time: Number(this._timeline?.currentTime ?? 0) || 0,
                timeline_scroll_left: Number(this._timeline?.scrollEl?.scrollLeft ?? 0) || 0,
                timeline_scroll_top: Number(this._timeline?.scrollEl?.scrollTop ?? 0) || 0,
            },
            tracks,
        };
    }

    _saveToWidgets() {
        const projectW = this._w("project_json");
        if (projectW) projectW.value = JSON.stringify(this._buildProject());
        try { this._persistViewToLocalCache(); } catch { /* ignore */ }
        try { this._persistPanelLayout(); } catch { /* ignore */ }

        this.node.setDirtyCanvas(true, true);
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

            const projectTracks = Array.isArray(snapshot.project?.tracks) ? snapshot.project.tracks : [];
            this._projectResources = Array.isArray(snapshot.project?.resources)
                ? snapshot.project.resources.map(resource => ({ ...resource }))
                : [];
            for (const resource of this._projectResources) {
                if (resource.location) this._mediaStatus.set(`${resource.kind}:${resource.file}`, { location: resource.location });
            }
            this.projectNameInput.value = String(snapshot.project?.name || "未命名项目").trim() || "未命名项目";
            const tracks = projectTracks.map((track, order) => ({
                ...track,
                type: track.type === "audio" ? "audio" : "image",
                trackIndex: order,
                isMain: track.role === "main",
            }));
            this._timeline.clearTracks();
            if (tracks.length) {
                this._loadTracksFromJson(tracks);
            } else {
                this._createDefaultTracks();
            }
            const clips = [];
            const fps = this.getFps();
            projectTracks.forEach((track, trackIndex) => {
                for (const clip of Array.isArray(track.clips) ? track.clips : []) {
                    const source = clip.source && typeof clip.source === "object" ? clip.source : {};
                    if (source.file && source.location) this._mediaStatus.set(`${clip.type}:${source.file}`, { location: source.location });
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
                        clip_type: clip.type,
                        track: trackIndex,
                        start_ms: startMsOut,
                        duration_ms: durationMsOut,
                        end_ms: startMsOut + durationMsOut,
                        start_image: source.file || null,
                        audio_file: source.file || null,
                        source_duration: (
                            Number(source.duration_ms) > 0
                                ? Number(source.duration_ms)
                                : Math.max(durationMsOut, Number(source.out_ms) - Number(source.in_ms))
                        ) / 1000,
                        trim_in: Math.max(0, Number(source.in_ms) || 0) / 1000,
                        disabled: clip.enabled === false,
                    });
                }
            });
            await Promise.all(clips.map(c => this._addClipFromJson(c)));

            this._decorateAllClips();
            this._refreshTimelineDuration();
            const snapSettings = snapshot.project?.settings ?? {};
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
