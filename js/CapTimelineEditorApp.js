import { api } from "../../scripts/api.js";
import { Timeline, ICONS } from "./timeline/index.js";
import { parseTimecode, formatTimecode } from "./timecode.js";

const EXT_PREFIX = "ComfyUI-Capricorncd-Tools";
/** Right-side empty margin as a fraction of the timeline viewport width. */
const TIMELINE_RIGHT_VIEWPORT_FRAC = 0.3;
/** All tracks (main/overlay/audio) share one row height. */
const TRACK_HEIGHT = 78;

function loadEditorCss() {
    if (document.getElementById("cat-te-styles")) return;
    const link = document.createElement("link");
    link.id = "cat-te-styles";
    link.rel = "stylesheet";
    link.href = `/extensions/${EXT_PREFIX}/cap_timeline_editor.css`;
    document.head.appendChild(link);
    const tl = document.createElement("link");
    tl.id = "cat-te-tl-styles";
    tl.rel = "stylesheet";
    tl.href = `/extensions/${EXT_PREFIX}/timeline/timeline.css`;
    document.head.appendChild(tl);
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
        muted: false,
        trackIndex,
    };
}

function defaultAudioMeta(trackIndex = 2) {
    return {
        clipType: "audio",
        muted: false,
        sourceDuration: 0,
        trimIn: 0,
        trackIndex,
    };
}

/** @timeline/editor fullscreen shell bound to a ComfyUI node. */
export class CapTimelineEditorApp {
    static _open = null;

    constructor(node) {
        this.node = node;
        this._meta = new Map();
        this._trackInfo = new Map();
        this._imgFiles = [];
        this._videoFiles = [];
        this._audioFiles = [];
        this._mediaTab = "image";
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
        loadEditorCss();
        this._buildLauncher();
    }

    _w(name) { return this.node.widgets?.find(w => w.name === name); }
    getFps() { return Math.max(1, parseInt(this._w("fps")?.value ?? 24, 10) || 24); }
    _dir() { return String(this._w("assets_dir")?.value ?? "").trim(); }

    _buildLauncher() {
        const root = document.createElement("div");
        root.className = "cat-te-launcher";
        root.innerHTML = `
          <button type="button" class="cat-te-open-btn">⛶ 导演台</button>
          <div class="cat-te-launcher-hint">全屏编辑 · 拖入素材 · Ctrl+B/G · Alt+滚轮平移</div>
        `;
        root.querySelector(".cat-te-open-btn").addEventListener("click", () => this.open());
        const w = this.node.addDOMWidget("te_launcher", "timeline_editor", root, {
            getMinHeight: () => 72,
            getHeight: () => 72,
        });
        w.serialize = false;
        this.launcherWidget = w;
        this.node.setSize([Math.max(this.node.size[0], 320), Math.max(this.node.size[1], 120)]);
    }

    open() {
        if (CapTimelineEditorApp._open === this) return;
        if (CapTimelineEditorApp._open) CapTimelineEditorApp._open.close(false);
        this._ensureOverlay();
        this._overlay.classList.add("open");
        document.body.classList.add("cat-te-noscroll");
        CapTimelineEditorApp._open = this;
        this._overlay.focus();
        this._loadMediaList();
        this._loadVideoFileList();
        this._loadAudioFileList();
        void this._openEditor();
    }

    /** Selected clip on the timeline, or null. */
    getSelectedClip() {
        return this._timeline?._selected ?? this._selClip ?? null;
    }

    /**
     * Ctrl+B / Ctrl+G — only when a clip is selected.
     * @returns {boolean} true if the event was handled
     */
    handleShortcutKey(e) {
        if (!this._overlay?.classList.contains("open")) return false;
        if (e.repeat) return false;
        if (e.target?.closest?.("input, textarea, select")) return false;
        if (!e.ctrlKey || e.shiftKey || e.altKey) return false;
        const key = e.key?.toLowerCase();
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
     * Ctrl+Z / Ctrl+Shift+Z — undo/redo. Propagation is always stopped while
     * the editor is open so ComfyUI's own Ctrl+Z (graph undo) never also
     * fires and closes the director's console. When focus is in a text
     * field the browser's native text-undo is left alone (no
     * preventDefault); otherwise it drives the timeline's own history.
     * @returns {boolean} true if the event was handled
     */
    handleUndoRedoKey(e) {
        if (!this._overlay?.classList.contains("open")) return false;
        if (!e.ctrlKey && !e.metaKey) return false;
        if (e.key?.toLowerCase() !== "z") return false;

        e.stopPropagation();
        e.stopImmediatePropagation?.();

        if (e.target?.closest?.("input, textarea, select")) return true; // native text-field undo/redo

        e.preventDefault();
        if (e.shiftKey) void this.redo();
        else void this.undo();
        return true;
    }

    async _openEditor() {
        this._historyReady = false;
        await this._initTimelineFromWidgets();
        this._refreshTimelineDuration();
        requestAnimationFrame(() => this._timeline?._refresh());
        this._undoStack = [];
        this._redoStack = [];
        this._historyReady = true;
    }

    close(save = true) {
        if (!this._overlay) return;
        this._historyReady = false;
        if (save) this._saveToWidgets();
        this._timeline?.destroy();
        this._timeline = null;
        this._mainTrack = null;
        this._overlayTrack = null;
        this._selClip = null;
        this._overlay.classList.remove("open");
        document.body.classList.remove("cat-te-noscroll");
        if (CapTimelineEditorApp._open === this) CapTimelineEditorApp._open = null;
    }

    /** Settings dialog — language is the first setting; more will land here
     * later. Selection is only persisted for now, not yet wired to i18n. */
    _openSettings() {
        if (!this.settingsModal) return;
        this.langSelect.value = localStorage.getItem("cat-te-lang") || "zh";
        this.settingsModal.hidden = false;
    }

    _closeSettings() {
        if (this.settingsModal) this.settingsModal.hidden = true;
    }

    destroy() {
        this.close(false);
        document.removeEventListener("click", this._onDocClick);
        if (this._onWinResize) {
            window.removeEventListener("resize", this._onWinResize);
            this._onWinResize = null;
        }
        this._overlay?.remove();
    }

    _ensureOverlay() {
        if (this._overlay) return;
        const el = document.createElement("div");
        el.className = "cat-te-overlay";
        el.tabIndex = -1;
        el.innerHTML = `
          <header class="cat-te-header">
            <span class="cat-te-title">导演台</span>
            <div class="cat-te-header-spacer"></div>
            <button type="button" class="cat-te-btn cat-te-settings">⚙ 设置</button>
          </header>
          <div class="cat-te-main">
            <aside class="cat-te-media">
              <div class="cat-te-media-tabs">
                <button type="button" class="cat-te-tab active" data-tab="image">图片</button>
                <button type="button" class="cat-te-tab" data-tab="video">视频</button>
                <button type="button" class="cat-te-tab" data-tab="audio">音频</button>
                <button type="button" class="cat-te-media-refresh" title="刷新素材列表">⟳</button>
              </div>
              <div class="cat-te-media-grid"></div>
            </aside>
            <div class="cat-te-center">
              <div class="cat-te-timeline-host"></div>
            </div>
            <aside class="cat-te-sidebar">
              <div class="cat-te-clip-info">
                <div class="cat-te-panel-title">选中素材</div>
                <div class="cat-te-clip-info-body">
                  <div class="cat-te-clip-info-empty">点击时间轴上的素材进行编辑</div>
                  <div class="cat-te-clip-info-detail" hidden>
                    <div class="cat-te-clip-thumb-wrap">
                      <img class="cat-te-clip-thumb" alt="" />
                    </div>
                    <div class="cat-te-clip-meta">
                      <div class="cat-te-clip-name"></div>
                      <div class="cat-te-clip-track"></div>
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
              <div class="cat-te-prompt-wrap">
                <div class="cat-te-prompt-label">Keyframe Prompt</div>
                <textarea class="cat-te-prompt-input" placeholder="选中素材后编辑提示词…" disabled></textarea>
                <label class="cat-te-use-global">
                  <input class="cat-te-use-global-cb" type="checkbox" checked disabled />
                  <span>Use Global</span>
                </label>
              </div>
              <div class="cat-te-shortcuts">
                Ctrl+点击 多选 · Del 删除（确认）<br>
                选中素材时 Ctrl+B 禁用 · Ctrl+G 禁用其他<br>
                Ctrl+滚轮 缩放 · Alt+滚轮 左右滚动
              </div>
            </aside>
          </div>
          <footer class="cat-te-footer">
            <button type="button" class="cat-te-btn cat-te-btn-primary cat-te-save">保存并关闭</button>
            <button type="button" class="cat-te-btn cat-te-close">关闭</button>
          </footer>
          <div class="cat-te-frame-preview"></div>
          <div class="cat-te-modal-backdrop cat-te-settings-modal" hidden>
            <div class="cat-te-modal">
              <div class="cat-te-modal-header">
                <span>设置</span>
                <button type="button" class="cat-te-modal-close" title="关闭">✕</button>
              </div>
              <div class="cat-te-modal-body">
                <label class="cat-te-modal-row">
                  <span>语言</span>
                  <select class="cat-te-lang-select">
                    <option value="zh">简体中文</option>
                    <option value="en">English</option>
                  </select>
                </label>
              </div>
            </div>
          </div>
        `;
        document.body.appendChild(el);
        this._overlay = el;
        this.mediaGrid = el.querySelector(".cat-te-media-grid");
        this.tlHost = el.querySelector(".cat-te-timeline-host");
        this.promptInput = el.querySelector(".cat-te-prompt-input");
        this.useGlobalCb = el.querySelector(".cat-te-use-global-cb");
        this.clipInfoEmpty = el.querySelector(".cat-te-clip-info-empty");
        this.clipInfoDetail = el.querySelector(".cat-te-clip-info-detail");
        this.clipThumb = el.querySelector(".cat-te-clip-thumb");
        this.clipNameEl = el.querySelector(".cat-te-clip-name");
        this.clipTrackEl = el.querySelector(".cat-te-clip-track");
        this.clipStartEl = el.querySelector(".cat-te-clip-start");
        this.clipEndEl = el.querySelector(".cat-te-clip-end");
        this.clipDurEl = el.querySelector(".cat-te-clip-dur");
        this.framePreview = el.querySelector(".cat-te-frame-preview");

        el.querySelector(".cat-te-save").addEventListener("click", () => this.close(true));
        el.querySelector(".cat-te-close").addEventListener("click", () => this.close(false));

        this.settingsModal = el.querySelector(".cat-te-settings-modal");
        this.langSelect = el.querySelector(".cat-te-lang-select");
        el.querySelector(".cat-te-settings").addEventListener("click", () => this._openSettings());
        el.querySelector(".cat-te-modal-close").addEventListener("click", () => this._closeSettings());
        this.settingsModal.addEventListener("click", (e) => {
            if (e.target === this.settingsModal) this._closeSettings();
        });
        this.langSelect.addEventListener("change", () => {
            localStorage.setItem("cat-te-lang", this.langSelect.value);
        });

        el.querySelectorAll(".cat-te-tab").forEach(btn => {
            btn.addEventListener("click", () => {
                el.querySelectorAll(".cat-te-tab").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                this._mediaTab = btn.dataset.tab;
                this._renderMediaGrid();
            });
        });
        el.querySelector(".cat-te-media-refresh")?.addEventListener("click", () => this._refreshMediaLists());

        this.promptInput.addEventListener("focus", () => { this._promptUndoArmed = true; });
        this.promptInput.addEventListener("blur", () => { this._promptUndoArmed = false; });
        this.promptInput.addEventListener("input", () => this._onPromptInput());
        this.useGlobalCb.addEventListener("change", () => this._onUseGlobalChange());

        el.addEventListener("keydown", e => {
            if (e.key === "Escape") {
                if (!this.settingsModal.hidden) { this._closeSettings(); e.stopPropagation(); return; }
                if (this._removeCtxMenu()) { e.stopPropagation(); return; }
                e.stopPropagation();
                this.close(true);
            }
        });

        document.addEventListener("click", this._onDocClick = () => this._removeCtxMenu());
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
                btn.innerHTML = ICONS.lock;
                btn.classList.toggle("active", track.locked);
            };
            btn.title = "锁定轨道";
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
            });
            render();
        } else if (kind === "mute") {
            const render = () => {
                btn.innerHTML = track.muted ? ICONS.volumeOff : ICONS.volume;
                btn.classList.toggle("active", track.muted);
            };
            btn.title = "轨道静音";
            btn.addEventListener("click", e => {
                e.stopPropagation();
                this._recordUndo();
                track.setMuted(!track.muted);
                render();
                this._decorateAllClips();
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
        actions.appendChild(this._makeTrackSlot(track, track.type === "audio" ? "mute" : null));
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
        this._selClip = null;
        this._selClips = [];
        this._timeline.clearSelection();
        this._updatePromptPanel();
        this._refreshTimelineDuration();
        return true;
    }

    async _loadMediaList() {
        const dir = this._dir();
        this.mediaGrid.replaceChildren();
        if (!dir) {
            const msg = document.createElement("div");
            msg.style.cssText = "width:100%;font-size:10px;color:#666;padding:8px";
            msg.textContent = "请先设置资源目录";
            this.mediaGrid.appendChild(msg);
            return;
        }
        try {
            const r = await fetch(api.apiURL(`/audio_keyframe_timeline/keyframes?dir=${encodeURIComponent(dir)}`));
            const d = await r.json();
            this._imgFiles = Array.isArray(d.files) ? d.files : [];
        } catch { this._imgFiles = []; }
        this._renderMediaGrid();
    }

    _imgUrl(file) {
        const dir = this._dir();
        return api.apiURL(
            `/audio_keyframe_timeline/keyframe_image?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(file)}`
        );
    }

    async _loadVideoFileList() {
        const dir = this._dir();
        if (!dir) { this._videoFiles = []; if (this._mediaTab === "video") this._renderMediaGrid(); return; }
        try {
            const r = await fetch(api.apiURL(`/audio_keyframe_timeline/videos?dir=${encodeURIComponent(dir)}`));
            const d = await r.json();
            this._videoFiles = Array.isArray(d.files) ? d.files : [];
        } catch { this._videoFiles = []; }
        if (this._mediaTab === "video") this._renderMediaGrid();
    }

    _videoUrl(file) {
        const dir = this._dir();
        return api.apiURL(
            `/audio_keyframe_timeline/keyframe_video?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(file)}`
        );
    }

    async _loadAudioFileList() {
        try {
            const r = await fetch(api.apiURL("/audio_keyframe_timeline/input_audio"));
            const d = await r.json();
            this._audioFiles = Array.isArray(d.files) ? d.files : [];
        } catch { this._audioFiles = []; }
        if (this._mediaTab === "audio") this._renderMediaGrid();
    }

    /** Re-scan the assets directory (and its subfolders) plus the input-audio
     * list, then redraw whichever tab is currently showing. */
    async _refreshMediaLists() {
        const btn = this._overlay?.querySelector(".cat-te-media-refresh");
        btn?.classList.add("spinning");
        try {
            await Promise.all([
                this._loadMediaList(),
                this._loadVideoFileList(),
                this._loadAudioFileList(),
            ]);
            this._renderMediaGrid();
        } finally {
            btn?.classList.remove("spinning");
        }
    }

    _renderMediaGrid() {
        this.mediaGrid.replaceChildren();
        if (this._mediaTab === "audio") {
            this._renderAudioMediaGrid();
        } else if (this._mediaTab === "video") {
            this._renderVideoMediaGrid();
        } else {
            this._renderImageMediaGrid();
        }
    }

    _renderImageMediaGrid() {
        const dir = this._dir();
        if (!dir) {
            const msg = document.createElement("div");
            msg.style.cssText = "width:100%;font-size:10px;color:#666;padding:8px";
            msg.textContent = "请先设置资源目录";
            this.mediaGrid.appendChild(msg);
            return;
        }
        if (!this._imgFiles.length) {
            const msg = document.createElement("div");
            msg.style.cssText = "width:100%;font-size:10px;color:#666;padding:8px";
            msg.textContent = "目录中无图片";
            this.mediaGrid.appendChild(msg);
            return;
        }
        for (const file of this._imgFiles) {
            this.mediaGrid.appendChild(this._makeMediaItem(file, "image"));
        }
    }

    _renderAudioMediaGrid() {
        if (!this._audioFiles.length) {
            const msg = document.createElement("div");
            msg.style.cssText = "width:100%;font-size:10px;color:#666;padding:8px";
            msg.textContent = "input 目录中无音频";
            this.mediaGrid.appendChild(msg);
            return;
        }
        for (const file of this._audioFiles) {
            this.mediaGrid.appendChild(this._makeMediaItem(file, "audio"));
        }
    }

    _renderVideoMediaGrid() {
        const dir = this._dir();
        if (!dir) {
            const msg = document.createElement("div");
            msg.style.cssText = "width:100%;font-size:10px;color:#666;padding:8px";
            msg.textContent = "请先设置资源目录";
            this.mediaGrid.appendChild(msg);
            return;
        }
        if (!this._videoFiles.length) {
            const msg = document.createElement("div");
            msg.style.cssText = "width:100%;font-size:10px;color:#666;padding:8px";
            msg.textContent = "目录中无视频";
            this.mediaGrid.appendChild(msg);
            return;
        }
        for (const file of this._videoFiles) {
            this.mediaGrid.appendChild(this._makeMediaItem(file, "video"));
        }
    }

    /** Whether `file` is already used by a clip on the timeline (image/video
     * clips live on image tracks; audio clips on audio tracks). */
    _isMediaOnTimeline(file, kind) {
        if (!this._timeline) return false;
        const tracks = kind === "audio" ? this._allAudioTracks() : this._allImageTracks();
        return tracks.some(t => t.clips.some(c => c.src === file));
    }

    _makeMediaItem(file, kind) {
        const item = document.createElement("div");
        item.className = `cat-te-media-item cat-te-media-${kind}`;
        item.title = `${file}\n拖到时间轴或点击插入`;
        item.draggable = true;
        if (this._isMediaOnTimeline(file, kind)) {
            const addedTag = document.createElement("div");
            addedTag.className = "cat-te-media-added-tag";
            addedTag.textContent = "已添加";
            item.appendChild(addedTag);
        }
        if (kind === "image") {
            const img = document.createElement("img");
            img.src = this._imgUrl(file);
            img.alt = "";
            img.draggable = false;
            item.appendChild(img);
        } else if (kind === "video") {
            const icon = document.createElement("div");
            icon.className = "cat-te-video-icon";
            icon.textContent = "▶";
            item.appendChild(icon);
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
            if (kind === "audio") this._addAudioAtPlayhead(file);
            else if (kind === "video") this._addVideoAtPlayhead(file);
            else this._addMediaAtPlayhead(file);
        });
        item.addEventListener("dragstart", (e) => {
            const dragType = kind === "audio" ? "application/x-cat-te-audio"
                : kind === "video" ? "application/x-cat-te-video"
                : "application/x-cat-te-media";
            e.dataTransfer.setData(dragType, file);
            e.dataTransfer.effectAllowed = "copy";
            item.classList.add("dragging");
        });
        item.addEventListener("dragend", () => item.classList.remove("dragging"));
        return item;
    }

    _pickInsertImageTrack(atSec) {
        const tracks = this._allImageTracks().filter(t => !t.locked && t.visible !== false);
        for (const track of tracks) {
            const occupied = track.clips.some(c => atSec >= c.startTime && atSec < c.endTime);
            if (!occupied) return track;
        }
        return null;
    }

    _pickAudioTrack(clientY) {
        const hovered = this._timeline?._findTrackAtY(clientY, "audio");
        if (hovered && !hovered.locked) return hovered;
        return this._allAudioTracks().find(t => !t.locked) ?? null;
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
        this._autoFitZoom();
        this._refreshTimelineDuration();
    }

    async _addImageAtTime(filename, atSec, clientY) {
        if (!this._timeline) return;
        let track = clientY != null
            ? this._timeline._findTrackAtY(clientY, "image")
            : null;
        if (track?.locked || track?.visible === false) track = null;
        if (!track) track = this._pickInsertImageTrack(atSec);
        if (!track) {
            alert("没有可插入的图片轨道，或该位置已被占用");
            return;
        }
        const dur = Math.min(2, this._timeline.duration / 4) || 0.1;
        this._recordUndo();
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
        this._autoFitZoom();
        this._refreshTimelineDuration();
    }

    async _addAudioAtTime(filename, atSec, clientY) {
        if (!this._timeline) return;
        const track = this._pickAudioTrack(clientY ?? 0);
        if (!track) {
            alert("没有可用的音频轨道");
            return;
        }
        const url = this._audioUrl(filename);
        let peaks = null;
        let sourceDur = 30;
        try {
            const r = await this._fetchPeaks(url);
            peaks = r.peaks[0];
            sourceDur = r.duration;
        } catch {
            try {
                sourceDur = await this._probeAudioDuration(url);
            } catch { /* keep default */ }
        }
        const dur = Math.max(0.05, sourceDur);
        this._ensureTimelineLength(atSec + dur);
        this._recordUndo();
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
        const ti = this._trackIndex(track);
        this._meta.set(clip.id, { ...defaultAudioMeta(ti), sourceDuration: sourceDur, trimIn: 0 });
        this._timeline.selectClip(clip);
        this._timeline.setCurrentTime(atSec);
        this._decorateClip(clip);
        this._autoFitZoom();
        this._refreshTimelineDuration();
    }

    /** Video clips go on image tracks, trimmed to the source's own length
     * just like audio; row 3 of the clip shows a waveform only if the
     * file actually has an audio stream. */
    async _addVideoAtTime(filename, atSec, clientY) {
        if (!this._timeline) return;
        let track = clientY != null
            ? this._timeline._findTrackAtY(clientY, "image")
            : null;
        if (track?.locked || track?.visible === false) track = null;
        if (!track) track = this._pickInsertImageTrack(atSec);
        if (!track) {
            alert("没有可插入的图片轨道，或该位置已被占用");
            return;
        }
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
        try {
            const r = await this._fetchPeaks(url);
            peaks = r.peaks[0];
            hasAudio = true;
        } catch { hasAudio = false; }

        this._ensureTimelineLength(atSec + dur);
        this._recordUndo();
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
        const ti = this._trackIndex(track);
        this._meta.set(clip.id, { ...defaultImageMeta(ti), mediaKind: "video", sourceDuration: dur });
        this._timeline.selectClip(clip);
        this._timeline.setCurrentTime(atSec);
        this._decorateClip(clip);
        this._autoFitZoom();
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

    async _fetchPeaks(url) {
        const r = await fetch(url, { credentials: "same-origin" });
        if (!r.ok) throw new Error(`无法加载音频 (${r.status})`);
        const ab = await r.arrayBuffer();
        const ctx = new AudioContext();
        try {
            const buf = await ctx.decodeAudioData(ab.slice(0));
            return { peaks: this._audioBufferToPeaks(buf), duration: buf.duration };
        } finally {
            await ctx.close();
        }
    }

    _audioUrl(filename) {
        if (!filename) return null;
        let name = String(filename).replace(/\s*\[input\]\s*$/i, "").trim();
        let sub = "";
        if (name.includes("/") || name.includes("\\")) {
            const i = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
            sub = name.slice(0, i);
            name = name.slice(i + 1);
        }
        const p = new URLSearchParams({ filename: name, type: "input" });
        if (sub) p.set("subfolder", sub);
        return api.apiURL(`/view?${p}`);
    }

    _initTimelineFromWidgets() {
        return this._initTimelineFromWidgetsAsync();
    }

    async _initTimelineFromWidgetsAsync() {
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

        let tracksCfg = [];
        try {
            tracksCfg = JSON.parse(this._w("tracks_json")?.value || "[]");
            if (!Array.isArray(tracksCfg)) tracksCfg = [];
        } catch { tracksCfg = []; }

        if (!tracksCfg.length) {
            this._createDefaultTracks();
        } else {
            this._loadTracksFromJson(tracksCfg);
        }

        let clips = [];
        try {
            clips = JSON.parse(this._w("clips_json")?.value || "[]");
            if (!Array.isArray(clips)) clips = [];
        } catch { clips = []; }

        await Promise.all(clips.map(c => this._addClipFromJson(c)));

        this._autoFitZoom();
        this._refreshTimelineDuration();
        this._decorateAllClips();
        this._bindTimelineEvents();
        this._configureTimelineUi();
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
        this._trackInfo.set(this._mainTrack.id, { trackIndex: 0 });
        this._trackInfo.set(this._overlayTrack.id, { trackIndex: 1 });
        this._trackInfo.set(this._audioTrack.id, { trackIndex: 2 });
        for (const t of [this._mainTrack, this._overlayTrack, this._audioTrack]) {
            this._setupTrackControls(t);
        }
    }

    _loadTracksFromJson(rows) {
        const tl = this._timeline;
        const images = rows
            .filter(r => (r.type || "image") !== "audio")
            .sort((a, b) => {
                if (a.isMain) return -1;
                if (b.isMain) return 1;
                return (a.trackIndex ?? 0) - (b.trackIndex ?? 0);
            });
        const audios = rows
            .filter(r => r.type === "audio")
            .sort((a, b) => (a.trackIndex ?? 0) - (b.trackIndex ?? 0));

        for (const row of [...images, ...audios]) {
            const track = tl.addTrack({
                id: row.id,
                type: row.type || "image",
                name: row.name || (row.type === "audio" ? "音频" : "轨道"),
                isMain: !!row.isMain,
                height: TRACK_HEIGHT,
                color: row.color,
                locked: !!row.locked,
                visible: row.visible !== false,
                muted: !!row.muted,
            });
            track.setLocked(!!row.locked);
            track.setVisible(row.visible !== false);
            track.setMuted(!!row.muted);
            this._trackInfo.set(track.id, { trackIndex: row.trackIndex ?? this._nextTrackIndex() });
            if (row.isMain || track.isMain) this._mainTrack = track;
            if (row.trackIndex === 1 && row.type === "image") this._overlayTrack = track;
            if (row.type === "audio" && !this._audioTrack) this._audioTrack = track;
            this._setupTrackControls(track);
        }
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
        const track = this._trackByIndex(trackIdx)
            ?? (clipType === "audio" ? this._audioTrack : (trackIdx === 1 ? this._overlayTrack : this._mainTrack));
        if (!track) return;

        const startMs = Number(c.start_ms) || 0;
        const endMs = Number(c.end_ms) || startMs + 1000;
        const dur = Math.max(0.05, (endMs - startMs) / 1000);

        if (clipType === "audio") {
            const af = c.audio_file ?? c.src ?? "";
            const sourceDur = Number(c.source_duration) || dur;
            const trimIn = Math.max(0, Number(c.trim_in) || 0);
            let peaks = null;
            if (af) {
                try {
                    const r = await this._fetchPeaks(this._audioUrl(af));
                    peaks = r.peaks[0];
                } catch { /* placeholder */ }
            }
            const clip = this._timeline.addClip(track.id, {
                id: uid(),
                name: af.split(/[\\/]/).pop() || "音频",
                startTime: startMs / 1000,
                duration: dur,
                sourceDuration: sourceDur,
                sourceOffset: trimIn,
                src: af,
                waveformPeaks: peaks,
                color: track.color,
            });
            this._meta.set(clip.id, {
                ...defaultAudioMeta(trackIdx),
                muted: !!c.muted,
                sourceDuration: sourceDur,
                trimIn,
            });
            this._decorateClip(clip);
            return;
        }

        if (clipType === "package") {
            const clip = this._timeline.addClip(track.id, {
                id: uid(),
                name: c.name || "Package",
                startTime: startMs / 1000,
                duration: dur,
                color: "#d9a441",
            });
            this._meta.set(clip.id, {
                ...defaultImageMeta(trackIdx),
                mediaKind: "package",
                items: Array.isArray(c.items) ? c.items : [],
                disabled: !!c.disabled,
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
            if (url) {
                try { thumbnail = await this._grabVideoThumbnail(url); } catch { /* no preview */ }
                try {
                    const r = await this._fetchPeaks(url);
                    peaks = r.peaks[0];
                    hasAudio = true;
                } catch { hasAudio = false; }
            }
            const clip = this._timeline.addClip(track.id, {
                id: uid(),
                name: fname,
                startTime: startMs / 1000,
                duration: dur,
                sourceDuration: sourceDur,
                sourceOffset: trimIn,
                src: vf,
                thumbnail,
                waveformPeaks: peaks,
                hasAudio,
                color: track.color,
            });
            this._meta.set(clip.id, {
                ...defaultImageMeta(trackIdx),
                mediaKind: "video",
                prompt: c.prompt ?? "",
                endImage: c.end_image ?? null,
                useGlobalPrompt: c.use_global_prompt !== false,
                disabled: !!c.disabled,
                sourceDuration: sourceDur,
            });
            this._decorateClip(clip);
            return;
        }

        const img = c.start_image ?? "";
        const fname = img.split(/[\\/]/).pop() || "素材";
        const clip = this._timeline.addClip(track.id, {
            id: uid(),
            name: fname,
            startTime: startMs / 1000,
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

    _findClipAt(clientX, clientY) {
        const el = document.elementFromPoint(clientX, clientY)?.closest?.(".tl-clip");
        if (!el?.dataset?.clipId) return null;
        return this._findClipById(el.dataset.clipId);
    }

    _decorateClip(clip) {
        if (!clip?.el) return;
        const m = this._meta.get(clip.id) ?? defaultImageMeta();
        const track = clip.track;
        const trackHidden = track.type === "image" && track.visible === false;
        const trackMuted = track.type === "audio" && track.muted;
        const isAudio = m.clipType === "audio" || track.type === "audio";
        const disabled = !isAudio && (!!m.disabled || trackHidden);
        clip.el.classList.toggle("cat-te-clip-disabled", disabled);
        clip.el.classList.toggle("cat-te-clip-muted", isAudio && (!!m.muted || trackMuted));
        clip.el.classList.toggle("cat-te-clip-package", m.mediaKind === "package");

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
                    m.muted = !m.muted;
                    this._meta.set(clip.id, m);
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
        if (!isAudio && m.endImage) {
            if (!badge) {
                badge = document.createElement("div");
                badge.className = "cat-te-end-badge";
                badge.textContent = "尾";
                badge.title = "尾帧（悬停预览）";
                badge.addEventListener("mouseenter", () => this._showImagePreview(m.endImage, badge));
                badge.addEventListener("mouseleave", () => this._hideImagePreview());
                clip.el.appendChild(badge);
            }
        } else if (badge) {
            badge.remove();
        }
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
                body.style.backgroundImage = clip.thumbnail ? `url(${clip.thumbnail})` : "";
            }
        }
        this._decorateClip(clip);
    }

    _showImagePreview(file, anchor) {
        if (!this.framePreview || !anchor) return;
        this.framePreview.replaceChildren();
        const img = document.createElement("img");
        img.src = this._imgUrl(file);
        img.alt = "";
        this.framePreview.appendChild(img);
        this.framePreview.style.display = "block";
        const r = anchor.getBoundingClientRect();
        this.framePreview.style.left = `${Math.max(8, r.left + r.width / 2 - 160)}px`;
        this.framePreview.style.top = `${r.bottom + 8}px`;
    }

    _hideImagePreview() {
        if (this.framePreview) this.framePreview.style.display = "none";
    }

    _removeCtxMenu() {
        const m = document.querySelector(".cat-te-ctx-menu");
        if (m) { m.remove(); return true; }
        return false;
    }

    _buildCtxMenu(items, x, y) {
        this._removeCtxMenu();
        const menu = document.createElement("div");
        menu.className = "cat-te-ctx-menu";
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        for (const { label, fn, danger } of items) {
            const div = document.createElement("div");
            div.className = `cat-te-ctx-item${danger ? " danger" : ""}`;
            div.textContent = label;
            div.addEventListener("click", () => { fn(); this._removeCtxMenu(); });
            menu.appendChild(div);
        }
        document.body.appendChild(menu);
        const r = menu.getBoundingClientRect();
        if (r.right > window.innerWidth) menu.style.left = `${window.innerWidth - r.width - 8}px`;
        if (r.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - r.height - 8}px`;
    }

    _showClipCtxMenu(clip, e) {
        this._timeline.selectClip(clip);
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
                { label: m.disabled ? "启用" : "禁用", fn: () => this._toggleDisableClip(clip) },
                ...(m.endImage ? [{ label: "移除尾帧", fn: () => this._clearEndImage(clip) }] : []),
            );
        }
        items.push({ label: "删除", fn: () => this._deleteClip(clip), danger: true });
        this._buildCtxMenu(items, e.clientX, e.clientY);
    }

    _showDropActionMenu(file, clip, x, y) {
        this._timeline.selectClip(clip);
        this._buildCtxMenu([
            { label: "替换素材", fn: () => this._replaceClipImage(clip, file) },
            { label: "设置为尾帧", fn: () => this._setEndImage(clip, file) },
        ], x, y);
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
    }

    _replaceClipImage(clip, filename) {
        this._recordUndo();
        clip.src = filename;
        clip.name = filename.split(/[\\/]/).pop();
        clip.thumbnail = this._imgUrl(filename);
        this._refreshClipAppearance(clip);
        if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
        this._renderMediaGrid();
    }

    _setEndImage(clip, filename) {
        this._recordUndo();
        const m = this._meta.get(clip.id) ?? defaultImageMeta();
        m.endImage = filename;
        this._meta.set(clip.id, m);
        this._decorateClip(clip);
    }

    _clearEndImage(clip) {
        this._recordUndo();
        const m = this._meta.get(clip.id) ?? defaultImageMeta();
        m.endImage = null;
        this._meta.set(clip.id, m);
        this._decorateClip(clip);
    }

    _deleteClip(clip) {
        this._recordUndo();
        this._meta.delete(clip.id);
        this._timeline.removeClip(clip.track.id, clip.id);
        if (this._selClip?.id === clip.id) this._selClip = null;
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
        const metaCopy = { ...(this._meta.get(clip.id) ?? defaultImageMeta()) };
        const clipId = clip.id;
        const clipName = clip.name;
        const clipSrc = clip.src;
        const clipThumb = clip.thumbnail;
        const clipColor = clip.color;
        const clipStart = clip.startTime;

        tl.removeClip(track.id, clipId);
        this._meta.delete(clipId);

        const left = tl.addClip(track.id, {
            name: clipName,
            startTime: clipStart,
            duration: leftDur,
            src: clipSrc,
            thumbnail: clipThumb,
            color: clipColor,
        });
        this._meta.set(left.id, { ...metaCopy, endImage: null });

        const right = tl.addClip(track.id, {
            name: metaCopy.endImage ? metaCopy.endImage.split(/[\\/]/).pop() : clipName,
            startTime: t,
            duration: rightDur,
            src: null,
            thumbnail: null,
            color: track.color,
        });
        this._meta.set(right.id, { ...metaCopy });

        this._decorateClip(left);
        this._decorateClip(right);
        tl.selectClip(left);
        this._updatePromptPanel();
    }

    _addMediaAtTime(filename, atSec, clientY) {
        return this._addImageAtTime(filename, atSec, clientY);
    }

    _configureTimelineUi() {
        const tl = this._timeline;
        if (!tl) return;

        const packageBtn = document.createElement("button");
        packageBtn.type = "button";
        packageBtn.className = "tl-btn tl-btn-add-package";
        packageBtn.title = "在播放头位置插入一个 Package";
        packageBtn.textContent = "+ 插入Package";
        packageBtn.addEventListener("click", () => this._insertPackageAtPlayhead());
        tl.toolbarEl.appendChild(packageBtn);

        // The "+ 轨道" dropdown is built and handled entirely inside
        // Timeline.js, so there's no app-level call site to record an undo
        // point right before the new track is actually added. Recording it
        // here (before the menu even opens) is the closest equivalent —
        // worst case, a cancelled menu leaves one harmless no-op undo step.
        tl.toolbarEl.querySelector(".tl-btn-add-track")
            ?.addEventListener("click", () => this._recordUndo());

        const scroll = tl.scrollEl;
        scroll.addEventListener("dragover", (e) => {
            const types = [...e.dataTransfer.types];
            const hasMedia = types.includes("application/x-cat-te-media")
                || types.includes("application/x-cat-te-audio")
                || types.includes("application/x-cat-te-video");
            if (!hasMedia) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            scroll.classList.add("cat-te-drop-active");
        });
        scroll.addEventListener("dragleave", (e) => {
            if (!scroll.contains(e.relatedTarget)) scroll.classList.remove("cat-te-drop-active");
        });
        scroll.addEventListener("drop", (e) => {
            const audioFile = e.dataTransfer.getData("application/x-cat-te-audio");
            const imageFile = e.dataTransfer.getData("application/x-cat-te-media");
            const videoFile = e.dataTransfer.getData("application/x-cat-te-video");
            scroll.classList.remove("cat-te-drop-active");
            if (!audioFile && !imageFile && !videoFile) return;
            e.preventDefault();
            const targetClip = this._findClipAt(e.clientX, e.clientY);
            if (targetClip && imageFile && targetClip.track.type === "image") {
                this._showDropActionMenu(imageFile, targetClip, e.clientX, e.clientY);
                return;
            }
            const t = tl.clientXToTime(e.clientX);
            if (audioFile) {
                void this._addAudioAtTime(audioFile, t, e.clientY);
            } else if (videoFile) {
                void this._addVideoAtTime(videoFile, t, e.clientY);
            } else {
                void this._addImageAtTime(imageFile, t, e.clientY);
            }
        });
        scroll.addEventListener("contextmenu", (e) => {
            const clipEl = e.target.closest?.(".tl-clip");
            if (!clipEl) return;
            e.preventDefault();
            const clip = this._findClipById(clipEl.dataset.clipId);
            if (clip) this._showClipCtxMenu(clip, e);
        });
    }

    _bindTimelineEvents() {
        const tl = this._timeline;
        tl.on("clip:select", ({ clip, selected }) => {
            this._selClip = clip;
            this._selClips = selected ?? tl.getSelectedClips();
            this._updatePromptPanel();
            this._overlay?.focus();
        });
        tl.on("clip:add", ({ clip }) => {
            this._decorateClip(clip);
            this._renderMediaGrid();
        });
        tl.on("clip:deselect", () => {
            this._selClip = null;
            this._selClips = [];
            this._updatePromptPanel();
        });
        tl.on("clip:remove", ({ clipId, trackId }) => {
            this._meta.delete(clipId);
            if (this._selClip?.id === clipId) this._selClip = null;
            this._selClips = tl.getSelectedClips();
            this._updatePromptPanel();
            this._refreshTimelineDuration();
            this._pruneEmptyTrack(tl.getTrack(trackId));
            this._renderMediaGrid();
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
        });
        tl.on("track:remove", ({ trackId }) => {
            this._trackInfo.delete(trackId);
        });
        tl.on("clip:move", ({ clip }) => {
            if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
            this._refreshTimelineDuration();
        });
        tl.on("clip:resize", ({ clip }) => {
            if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
            this._refreshTimelineDuration();
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
        if (!this._onWinResize) {
            this._onWinResize = () => {
                if (this._overlay?.classList.contains("open") && this._timeline) {
                    this._refreshTimelineDuration();
                }
            };
            window.addEventListener("resize", this._onWinResize);
        }
    }

    _updateClipInfoPanel(clip) {
        if (!clip) {
            this.clipInfoEmpty.hidden = false;
            this.clipInfoDetail.hidden = true;
            return;
        }
        const tl = this._timeline;
        const track = clip.track;
        const isAudio = track.type === "audio";
        const isOverlay = !isAudio && track === this._overlayTrack;
        this.clipInfoEmpty.hidden = true;
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
        this.clipNameEl.textContent = clip.name || "素材";
        this.clipTrackEl.textContent = isAudio ? track.name : (isOverlay ? "副轨道" : "主轨道");
        this.clipTrackEl.className = `cat-te-clip-track ${isAudio ? "audio" : (isOverlay ? "overlay" : "main")}`;
        this.clipStartEl.textContent = tl.formatTime(clip.startTime);
        this.clipEndEl.textContent = tl.formatTime(clip.endTime);
        this.clipDurEl.textContent = `时长 ${tl.formatTime(clip.duration)}`;
    }

    _updatePromptPanel() {
        const clip = this._selClip;
        const m = clip ? this._meta.get(clip.id) : null;
        const isAudio = clip?.track?.type === "audio" || m?.clipType === "audio";
        this._updateClipInfoPanel(clip);
        const label = this._overlay.querySelector(".cat-te-prompt-label");
        if (clip && m && !isAudio) {
            this.promptInput.disabled = false;
            this.useGlobalCb.disabled = false;
            this.promptInput.value = m.prompt ?? "";
            this.useGlobalCb.checked = m.useGlobalPrompt !== false;
            label.textContent = "Keyframe Prompt";
        } else {
            this.promptInput.disabled = true;
            this.useGlobalCb.disabled = true;
            this.promptInput.value = "";
            label.textContent = isAudio ? "音频素材（无提示词）" : "Keyframe Prompt";
        }
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

    _packMainClips(clips) {
        const fps = this.getFps();
        const frameMs = Math.max(1, Math.round(1000 / fps));
        clips.sort((a, b) => a.startMs - b.startMs);
        let cursor = 0;
        for (const c of clips) {
            const dur = Math.max(frameMs, c.endMs - c.startMs);
            c.startMs = cursor;
            c.endMs = cursor + dur;
            cursor = c.endMs;
        }
        return clips;
    }

    /**
     * Build the clips_json rows. With `pack: true` (the saved/exported
     * shape) main-track clips are re-flowed back-to-back via
     * `_packMainClips`; with `pack: false` (undo/redo snapshots) exact
     * current positions/gaps are preserved.
     */
    _buildClipsRows(pack = true) {
        const main = [];
        const other = [];
        for (const track of this._timeline?.tracks ?? []) {
            const ti = this._trackIndex(track);
            const isMainImage = track.type === "image" && track.isMain;
            for (const clip of track.clips) {
                const m = this._meta.get(clip.id)
                    ?? (track.type === "audio" ? defaultAudioMeta(ti) : defaultImageMeta(ti));
                if (track.type === "audio" || m.clipType === "audio") {
                    other.push({
                        clip_type: "audio",
                        track: ti,
                        start_ms: Math.round(clip.startTime * 1000),
                        end_ms: Math.round(clip.endTime * 1000),
                        audio_file: clip.src || "",
                        muted: !!m.muted,
                        source_duration: Number.isFinite(clip.sourceDuration) ? clip.sourceDuration : (m.sourceDuration || clip.duration),
                        trim_in: clip.sourceOffset || 0,
                    });
                } else {
                    const isVideo = m.mediaKind === "video";
                    const isPackage = m.mediaKind === "package";
                    const row = {
                        clip_type: isPackage ? "package" : (isVideo ? "video" : "image"),
                        track: ti,
                        start_ms: Math.round(clip.startTime * 1000),
                        end_ms: Math.round(clip.endTime * 1000),
                        start_image: clip.src || null,
                        end_image: m.endImage ?? null,
                        prompt: m.prompt ?? "",
                        use_global_prompt: m.useGlobalPrompt !== false,
                        disabled: !!m.disabled,
                        z_index: ti === 1 ? 2 : 1,
                    };
                    if (isVideo) {
                        row.source_duration = Number.isFinite(clip.sourceDuration) ? clip.sourceDuration : clip.duration;
                        row.trim_in = clip.sourceOffset || 0;
                        row.has_audio = !!clip.hasAudio;
                    }
                    if (isPackage) {
                        row.name = clip.name || "Package";
                        row.items = Array.isArray(m.items) ? m.items : [];
                    }
                    (isMainImage ? main : other).push(row);
                }
            }
        }
        const finalMain = pack ? this._packMainClips(main) : main;
        return [...finalMain, ...other].sort((a, b) => a.start_ms - b.start_ms);
    }

    _buildTracksRows() {
        return (this._timeline?.tracks ?? []).map(track => ({
            id: track.id,
            type: track.type,
            name: track.name,
            trackIndex: this._trackIndex(track),
            locked: !!track.locked,
            visible: track.visible !== false,
            muted: !!track.muted,
            isMain: !!track.isMain,
            color: track.color,
        }));
    }

    _saveToWidgets() {
        const clipsW = this._w("clips_json");
        if (clipsW) clipsW.value = JSON.stringify(this._buildClipsRows(true));

        const tracksW = this._w("tracks_json");
        if (tracksW) tracksW.value = JSON.stringify(this._buildTracksRows());

        this.node.setDirtyCanvas(true, true);
    }

    // ─── Undo / redo ─────────────────────────────────────────────────────

    _captureSnapshot() {
        return {
            clips: this._buildClipsRows(false),
            tracks: this._buildTracksRows(),
            currentTime: this._timeline?.currentTime ?? 0,
        };
    }

    /** Call right before a discrete, user-initiated mutation (add/remove/
     * toggle/etc.) so it becomes exactly one undo step. */
    _recordUndo() {
        if (!this._historyReady || this._restoringHistory || !this._timeline) return;
        this._undoStack.push(this._captureSnapshot());
        if (this._undoStack.length > 100) this._undoStack.shift();
        this._redoStack = [];
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

            this._timeline.clearTracks();
            if (snapshot.tracks.length) {
                this._loadTracksFromJson(snapshot.tracks);
            } else {
                this._createDefaultTracks();
            }
            await Promise.all(snapshot.clips.map(c => this._addClipFromJson(c)));

            this._timeline.setCurrentTime(snapshot.currentTime || 0);
            this._decorateAllClips();
            this._autoFitZoom();
            this._refreshTimelineDuration();
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
    }

    async redo() {
        if (!this._redoStack.length || this._restoringHistory) return;
        const current = this._captureSnapshot();
        const next = this._redoStack.pop();
        this._undoStack.push(current);
        await this._restoreSnapshot(next);
    }
}
