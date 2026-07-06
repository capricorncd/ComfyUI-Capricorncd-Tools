import { api } from "../../scripts/api.js";
import { Timeline, ICONS } from "./timeline/index.js";
import { parseTimecode, formatTimecode } from "./timecode.js";
import { attachRichPromptHandler, setRichPromptValue } from "./rich_prompt.js";

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
        visible: true,
        muted: false,
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
        this._mediaStatus = new Map();
        this._projectResources = [];
        this._videoThumbCache = new Map();
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
        this._playbackCtx = null;
        this._activeAudioSources = [];
        loadEditorCss();
        this._buildLauncher();
    }

    _w(name) { return this.node.widgets?.find(w => w.name === name); }
    _currentVersion() { return String(this._w("project_version")?.value || "0.0.0"); }
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

    async _openEditor() {
        this._historyReady = false;
        this._openedWidgetValues = Object.fromEntries(
            ["fps", "width", "height", "global_prompt"].map(name => [name, this._w(name)?.value]),
        );
        await this._initTimelineFromWidgets();
        await Promise.all([this._loadMediaList(), this._loadVideoFileList(), this._loadAudioFileList()]);
        await this._syncProjectMedia();
        this._refreshTimelineDuration();
        requestAnimationFrame(() => this._timeline?._refresh());
        this._undoStack = [];
        this._redoStack = [];
        this._historyReady = true;
        this._openedProjectJson = JSON.stringify(this._buildProject());
        this._updateHistoryButtons();
    }

    _hasUnsavedChanges() {
        if (!this._timeline) return false;
        return JSON.stringify(this._buildProject()) !== this._openedProjectJson;
    }

    /**
     * Closing "discard" (save=false) with pending edits asks first — a
     * last-resort safety net for whenever something outside our control
     * (e.g. Ctrl+Z leaking through to ComfyUI's own graph undo) causes the
     * editor to close: better a confirm prompt than silently losing work.
     * Skipped entirely if there's nothing to lose.
     */
    close(save = true) {
        if (!this._overlay) return;
        if (!save && this._hasUnsavedChanges()) {
            if (confirm("有未保存的修改，是否保存后再关闭？\n点击“取消”将放弃这些修改。")) {
                save = true;
            }
        }
        this._closeInternal(save);
    }

    _closeInternal(save) {
        if (!this._overlay) return;
        this._historyReady = false;
        this._stopAudioPlayback();
        this._closeMediaPreview();
        this._closeAddMaterial();
        if (save) this._saveToWidgets();
        else if (this._openedWidgetValues) {
            for (const [name, value] of Object.entries(this._openedWidgetValues)) {
                const widget = this._w(name);
                if (widget && value !== undefined) widget.value = value;
            }
        }
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

    _chooseProjectImport() {
        if (this._hasUnsavedChanges() && !confirm("当前时间轴已有未保存的更改，是否用导入的项目覆盖？")) return;
        this.importFileInput.value = "";
        this.importFileInput.click();
    }

    _exportProject() {
        const json = JSON.stringify(this._buildProject(), null, 2);
        const blob = new Blob([json], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const projectName = String(this.projectNameInput?.value || "未命名项目").trim() || "未命名项目";
        const safeName = projectName
            .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
            .replace(/[. ]+$/g, "")
            .slice(0, 80) || "未命名项目";
        link.href = url;
        link.download = `${safeName}-${stamp}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    async _importProject(event) {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        try {
            const project = JSON.parse(await file.text());
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

            this._historyReady = false;
            this._stopAudioPlayback();
            this._timeline?.destroy();
            this._timeline = null;
            await this._initTimelineFromWidgets(project);
            this._undoStack = [];
            this._redoStack = [];
            this._historyReady = true;
            this._updateHistoryButtons();
            requestAnimationFrame(() => this._timeline?._refresh());
        } catch (error) {
            alert(`导入失败：${error instanceof Error ? error.message : String(error)}`);
        }
    }

    destroy() {
        // Bypasses the unsaved-changes confirm in close() — by the time
        // onRemoved fires the node is already gone from the graph, so
        // there's nothing left to meaningfully save, and blocking node
        // teardown on a dialog would be surprising.
        this._closeInternal(false);
        document.removeEventListener("click", this._onDocClick);
        if (this._onWinResize) {
            window.removeEventListener("resize", this._onWinResize);
            this._onWinResize = null;
        }
        if (this._playbackCtx) {
            this._playbackCtx.close().catch(() => {});
            this._playbackCtx = null;
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
            <input class="cat-te-title" type="text" value="未命名项目" aria-label="项目名称" />
            <div class="cat-te-header-spacer"></div>
            <button type="button" class="cat-te-btn cat-te-import">导入</button>
            <button type="button" class="cat-te-btn cat-te-export">导出</button>
            <button type="button" class="cat-te-btn cat-te-settings">⚙ 设置</button>
            <input class="cat-te-import-file" type="file" accept="application/json,.json" hidden />
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
                <div class="cat-te-prompt-input-wrap">
                  <textarea class="cat-te-prompt-input" placeholder="选中素材后编辑提示词…" disabled></textarea>
                </div>
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
            <div class="cat-te-footer-left">
              <button type="button" class="cat-te-btn cat-te-add-material">＋ 添加素材</button>
              <input class="cat-te-add-material-file" type="file" accept="image/*,video/*,audio/*" hidden />
            </div>
            <div class="cat-te-footer-center"></div>
            <div class="cat-te-footer-right">
              <button type="button" class="cat-te-btn cat-te-btn-primary cat-te-save">保存并关闭</button>
              <button type="button" class="cat-te-btn cat-te-close">关闭</button>
            </div>
          </footer>
          <div class="cat-te-frame-preview"></div>
          <div class="cat-te-modal-backdrop cat-te-media-preview-modal" hidden>
            <div class="cat-te-modal cat-te-media-preview-dialog">
              <div class="cat-te-modal-header">
                <span class="cat-te-media-preview-title">素材预览</span>
                <button type="button" class="cat-te-modal-close cat-te-media-preview-close" title="关闭">×</button>
              </div>
              <div class="cat-te-media-preview-body"></div>
            </div>
          </div>
          <div class="cat-te-modal-backdrop cat-te-add-material-modal" hidden>
            <div class="cat-te-modal cat-te-add-material-dialog">
              <div class="cat-te-modal-header">
                <span class="cat-te-add-material-title">添加素材</span>
                <button type="button" class="cat-te-modal-close cat-te-add-material-close" title="取消">×</button>
              </div>
              <div class="cat-te-add-material-preview"></div>
              <div class="cat-te-add-material-options">
                <label><input class="cat-te-copy-to-assets" type="checkbox" checked /> 移动素材到设置目录</label>
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
        this.projectNameInput = el.querySelector(".cat-te-title");
        this.mediaGrid = el.querySelector(".cat-te-media-grid");
        this.tlHost = el.querySelector(".cat-te-timeline-host");
        this.promptInput = el.querySelector(".cat-te-prompt-input");
        attachRichPromptHandler(this.promptInput, { mode: "widget" });
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
        this.footerPlayback = el.querySelector(".cat-te-footer-center");
        this.addMaterialInput = el.querySelector(".cat-te-add-material-file");
        this.mediaPreviewModal = el.querySelector(".cat-te-media-preview-modal");
        this.mediaPreviewTitle = el.querySelector(".cat-te-media-preview-title");
        this.mediaPreviewBody = el.querySelector(".cat-te-media-preview-body");
        this.addMaterialModal = el.querySelector(".cat-te-add-material-modal");
        this.addMaterialPreview = el.querySelector(".cat-te-add-material-preview");
        this.copyToAssetsCb = el.querySelector(".cat-te-copy-to-assets");
        this.insertAfterAddCb = el.querySelector(".cat-te-insert-after-add");

        el.querySelector(".cat-te-save").addEventListener("click", () => this.close(true));
        el.querySelector(".cat-te-close").addEventListener("click", () => this.close(false));

        this.settingsModal = el.querySelector(".cat-te-settings-modal");
        this.langSelect = el.querySelector(".cat-te-lang-select");
        this.importFileInput = el.querySelector(".cat-te-import-file");
        el.querySelector(".cat-te-import").addEventListener("click", () => this._chooseProjectImport());
        el.querySelector(".cat-te-export").addEventListener("click", () => this._exportProject());
        this.importFileInput.addEventListener("change", (e) => void this._importProject(e));
        el.querySelector(".cat-te-add-material").addEventListener("click", () => this._chooseMaterialFile());
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
                if (!this.addMaterialModal.hidden) { this._closeAddMaterial(); e.stopPropagation(); return; }
                if (!this.mediaPreviewModal.hidden) { this._closeMediaPreview(); e.stopPropagation(); return; }
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
            for (const file of this._imgFiles) this._mediaStatus.set(`image:${file}`, { location: "assets" });
        } catch { this._imgFiles = []; }
        this._renderMediaGrid();
    }

    _imgUrl(file) {
        const status = this._mediaStatus.get(`image:${file}`);
        if (status?.location === "input") return this._assetFileUrl(file, "image", "input");
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
            for (const file of this._videoFiles) this._mediaStatus.set(`video:${file}`, { location: "assets" });
        } catch { this._videoFiles = []; }
        if (this._mediaTab === "video") this._renderMediaGrid();
    }

    _videoUrl(file) {
        const status = this._mediaStatus.get(`video:${file}`);
        if (status?.location === "input") return this._assetFileUrl(file, "video", "input");
        const dir = this._dir();
        return api.apiURL(
            `/audio_keyframe_timeline/keyframe_video?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(file)}`
        );
    }

    async _loadAudioFileList() {
        const dir = this._dir();
        if (!dir) { this._audioFiles = []; if (this._mediaTab === "audio") this._renderMediaGrid(); return; }
        try {
            const r = await fetch(api.apiURL(`/audio_keyframe_timeline/audios?dir=${encodeURIComponent(dir)}`));
            const d = await r.json();
            this._audioFiles = Array.isArray(d.files) ? d.files : [];
            for (const file of this._audioFiles) this._mediaStatus.set(`audio:${file}`, { location: "assets" });
        } catch { this._audioFiles = []; }
        if (this._mediaTab === "audio") this._renderMediaGrid();
    }

    /** Re-scan the assets directory (and its subfolders) for all three media
     * kinds, then redraw whichever tab is currently showing. */
    async _refreshMediaLists() {
        const btn = this._overlay?.querySelector(".cat-te-media-refresh");
        btn?.classList.add("spinning");
        this._videoThumbCache.clear();
        try {
            await Promise.all([
                this._loadMediaList(),
                this._loadVideoFileList(),
                this._loadAudioFileList(),
            ]);
            await this._syncProjectMedia();
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
        const dir = this._dir();
        if (!dir) {
            const msg = document.createElement("div");
            msg.style.cssText = "width:100%;font-size:10px;color:#666;padding:8px";
            msg.textContent = "请先设置资源目录";
            this.mediaGrid.appendChild(msg);
            return;
        }
        if (!this._audioFiles.length) {
            const msg = document.createElement("div");
            msg.style.cssText = "width:100%;font-size:10px;color:#666;padding:8px";
            msg.textContent = "目录中无音频";
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
        const status = this._mediaStatus.get(`${kind}:${file}`) || { location: "assets" };
        item.className = `cat-te-media-item cat-te-media-${kind}`;
        item.classList.toggle("cat-te-media-missing", status.location === "missing");
        item.classList.toggle("cat-te-media-input", status.location === "input");
        item.title = `${file}\n点击预览；右键插入时间轴；也可拖到时间轴`;
        item.draggable = status.location !== "missing";
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
        if (status.location === "input") {
            const warning = document.createElement("div");
            warning.className = "cat-te-media-warning";
            warning.textContent = "⚠";
            warning.title = "素材仅位于 ComfyUI Input，设置目录中不存在";
            item.appendChild(warning);
        }
        item.addEventListener("click", () => {
            if (status.location === "missing") alert("素材文件缺失，请右键选择“重新关联文件”");
            else this._openMediaPreview(file, kind);
        });
        item.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const items = [];
            if (status.location !== "missing") items.push({
                label: "插入时间轴",
                fn: () => {
                    if (kind === "audio") void this._addAudioAtPlayhead(file);
                    else if (kind === "video") void this._addVideoAtPlayhead(file);
                    else void this._addMediaAtPlayhead(file);
                },
            });
            if (status.location === "missing") items.push({
                label: "重新关联文件",
                fn: () => this._chooseMaterialFile({ file, kind }),
            });
            if (status.location === "input") items.push({
                label: "移动到设置目录",
                fn: () => void this._moveInputAsset(file, kind),
            });
            this._buildCtxMenu(items, e.clientX, e.clientY);
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
        this._autoFitZoom();
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
        this._autoFitZoom();
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
        this._autoFitZoom();
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

    _audioUrl(filename) {
        if (!filename) return null;
        const status = this._mediaStatus.get(`audio:${filename}`);
        if (status?.location === "input") return this._assetFileUrl(filename, "audio", "input");
        const dir = this._dir();
        return api.apiURL(
            `/audio_keyframe_timeline/keyframe_audio?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(filename)}`
        );
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
            if (list.includes(file)) continue;
            let status = { location: "missing" };
            try {
                const url = api.apiURL(`/audio_keyframe_timeline/asset_status?dir=${encodeURIComponent(this._dir())}&name=${encodeURIComponent(file)}&kind=${kind}`);
                const response = await fetch(url);
                const data = await response.json();
                if (data.assets_exists) status = { location: "assets" };
                else if (data.input_exists) status = { location: "input" };
            } catch { /* retain missing status */ }
            this._mediaStatus.set(`${kind}:${file}`, status);
            list.push(file);
        }
    }

    _assetFileUrl(file, kind, location = "assets") {
        return api.apiURL(
            `/audio_keyframe_timeline/asset_file?dir=${encodeURIComponent(this._dir())}`
            + `&name=${encodeURIComponent(file)}&kind=${encodeURIComponent(kind)}`
            + `&location=${encodeURIComponent(location)}`
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
        for (const src of this._activeAudioSources) {
            try { src.stop(); } catch { /* already stopped */ }
            try { src.disconnect(); } catch { /* already disconnected */ }
        }
        this._activeAudioSources = [];
    }

    _initTimelineFromWidgets(projectOverride = null) {
        return this._initTimelineFromWidgetsAsync(projectOverride);
    }

    async _initTimelineFromWidgetsAsync(projectOverride = null) {
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
        for (const name of ["fps", "width", "height", "global_prompt"]) {
            if (settings[name] == null) continue;
            const widget = this._w(name);
            if (widget) widget.value = settings[name];
        }
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
                const durationMs = Math.max(0, Number(clip.duration_ms) || 0);
                clips.push({
                    ...clip,
                    clip_type: clip.type,
                    track: trackIndex,
                    end_ms: startMs + durationMs,
                    start_image: source.file || null,
                    audio_file: source.file || null,
                    source_duration: Math.max(durationMs, Number(source.out_ms) - Number(source.in_ms)) / 1000,
                    trim_in: Math.max(0, Number(source.in_ms) || 0) / 1000,
                    disabled: clip.enabled === false,
                });
            }
        });

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
        this._trackInfo.set(this._mainTrack.id, { trackIndex: 0, enabled: true, role: "main" });
        this._trackInfo.set(this._overlayTrack.id, { trackIndex: 1, enabled: true, role: "overlay" });
        this._trackInfo.set(this._audioTrack.id, { trackIndex: 2, enabled: true, role: "audio" });
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
            this._trackInfo.set(track.id, {
                trackIndex: row.trackIndex ?? this._nextTrackIndex(),
                enabled: row.enabled !== false,
                role: row.role || (row.isMain ? "main" : (row.type === "audio" ? "audio" : "overlay")),
            });
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
                startTime: startMs / 1000,
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
                visible: c.visible !== false,
            });
            this._decorateClip(clip);
            return;
        }

        const img = c.start_image ?? "";
        const fname = img.split(/[\\/]/).pop() || "素材";
        const clip = this._timeline.addClip(track.id, {
            id: c.id || uid(),
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
            visible: c.visible !== false,
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

    _openMediaPreview(file, kind) {
        if (!this.mediaPreviewModal || !this.mediaPreviewBody) return;
        this._closeMediaPreview();
        this.mediaPreviewTitle.textContent = file.split(/[\\/]/).pop() || "素材预览";

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
        this.mediaPreviewBody.appendChild(media);
        this.mediaPreviewModal.hidden = false;
    }

    _closeMediaPreview() {
        if (!this.mediaPreviewModal || !this.mediaPreviewBody) return;
        for (const media of this.mediaPreviewBody.querySelectorAll("audio, video")) {
            media.pause();
            media.removeAttribute("src");
            media.load();
        }
        this.mediaPreviewBody.replaceChildren();
        this.mediaPreviewModal.hidden = true;
    }

    _chooseMaterialFile(relink = null) {
        this._pendingRelink = relink;
        this.addMaterialInput.value = "";
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

    _previewSelectedMaterial(event) {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        const kind = this._materialKind(file);
        if (!kind) { alert("不支持的素材格式"); return; }
        if (this._pendingRelink && this._pendingRelink.kind !== kind) {
            alert(`请选择同类型的${this._pendingRelink.kind === "image" ? "图片" : this._pendingRelink.kind === "video" ? "视频" : "音频"}文件`);
            return;
        }
        this._pendingMaterial = { file, kind, objectUrl: URL.createObjectURL(file), relink: this._pendingRelink };
        this._pendingRelink = null;
        this.addMaterialPreview.replaceChildren();
        const media = document.createElement(kind === "image" ? "img" : kind);
        media.src = this._pendingMaterial.objectUrl;
        if (kind !== "image") media.controls = true;
        this.addMaterialPreview.appendChild(media);
        this.copyToAssetsCb.checked = !!this._dir();
        this.copyToAssetsCb.disabled = !this._dir();
        this.copyToAssetsCb.closest("label").title = this._dir() ? "" : "请先设置资源目录";
        this.insertAfterAddCb.checked = false;
        this.insertAfterAddCb.closest("label").hidden = !!this._pendingMaterial.relink;
        this.addMaterialModal.hidden = false;
    }

    _closeAddMaterial() {
        if (!this.addMaterialModal) return;
        for (const media of this.addMaterialPreview.querySelectorAll("audio, video")) media.pause();
        if (this._pendingMaterial?.objectUrl) URL.revokeObjectURL(this._pendingMaterial.objectUrl);
        this._pendingMaterial = null;
        this._pendingRelink = null;
        this.addMaterialPreview.replaceChildren();
        this.addMaterialModal.hidden = true;
    }

    async _confirmAddMaterial() {
        const pending = this._pendingMaterial;
        if (!pending) return;
        const form = new FormData();
        form.append("kind", pending.kind);
        form.append("dir", this._dir());
        form.append("to_assets", this.copyToAssetsCb.checked ? "true" : "false");
        form.append("file", pending.file, pending.file.name);
        try {
            const response = await fetch(api.apiURL("/audio_keyframe_timeline/import_asset"), { method: "POST", body: form });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
            const shouldInsert = this.insertAfterAddCb.checked && !pending.relink;
            const relink = pending.relink;
            const kind = pending.kind;
            this._closeAddMaterial();
            this._registerMediaFile(result.file, kind, result.location);
            if (relink) this._replaceMediaReference(relink.file, result.file, kind);
            this._renderMediaGrid();
            if (shouldInsert) {
                if (kind === "audio") await this._addAudioAtPlayhead(result.file);
                else if (kind === "video") await this._addVideoAtPlayhead(result.file);
                else await this._addMediaAtPlayhead(result.file);
            }
        } catch (error) {
            alert(`添加素材失败：${error instanceof Error ? error.message : String(error)}`);
        }
    }

    _registerMediaFile(file, kind, location) {
        const list = kind === "audio" ? this._audioFiles : kind === "video" ? this._videoFiles : this._imgFiles;
        if (!list.includes(file)) list.push(file);
        this._mediaStatus.set(`${kind}:${file}`, { location });
        const existing = this._projectResources.find(resource => resource.kind === kind && resource.file === file);
        if (existing) existing.location = location;
        else this._projectResources.push({ file, kind, location });
    }

    _replaceMediaReference(oldFile, newFile, kind, recordUndo = true) {
        if (recordUndo) this._recordUndo();
        for (const track of this._timeline?.tracks ?? []) {
            for (const clip of track.clips) {
                const meta = this._meta.get(clip.id);
                const clipKind = track.type === "audio" ? "audio" : meta?.mediaKind === "video" ? "video" : "image";
                if (clipKind === kind && clip.src === oldFile) {
                    clip.src = newFile;
                    clip._audioBuffer = null;
                    if (kind === "image") clip.thumbnail = this._imgUrl(newFile);
                    else if (kind === "video") clip.thumbnail = null;
                    this._refreshClipAppearance(clip);
                }
                if (kind === "image" && meta?.endImage === oldFile) meta.endImage = newFile;
            }
        }
        const list = kind === "audio" ? this._audioFiles : kind === "video" ? this._videoFiles : this._imgFiles;
        const index = list.indexOf(oldFile);
        if (index >= 0) list.splice(index, 1);
        this._mediaStatus.delete(`${kind}:${oldFile}`);
        for (const resource of this._projectResources) {
            if (resource.kind === kind && resource.file === oldFile) {
                resource.file = newFile;
                resource.location = this._mediaStatus.get(`${kind}:${newFile}`)?.location || "assets";
            }
        }
        this._projectResources = [...new Map(
            this._projectResources.map(resource => [`${resource.kind}:${resource.file}`, resource]),
        ).values()];
    }

    async _moveInputAsset(file, kind) {
        try {
            const response = await fetch(api.apiURL("/audio_keyframe_timeline/move_asset"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ dir: this._dir(), name: file, kind }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
            this._registerMediaFile(result.file, kind, "assets");
            this._replaceMediaReference(file, result.file, kind, false);
            await this._refreshMediaLists();
        } catch (error) {
            alert(`移动素材失败：${error instanceof Error ? error.message : String(error)}`);
        }
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
        this.footerPlayback.replaceChildren(tl.playbackControlsEl);

        const packageBtn = document.createElement("button");
        packageBtn.type = "button";
        packageBtn.className = "tl-btn tl-btn-add-package";
        packageBtn.title = "在播放头位置插入一个 Package";
        packageBtn.textContent = "+ 插入Package";
        packageBtn.addEventListener("click", () => this._insertPackageAtPlayhead());
        tl.toolbarEl.appendChild(packageBtn);

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
        tl.on("play", () => this._startAudioPlayback());
        tl.on("pause", () => this._stopAudioPlayback());
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
            setRichPromptValue(this.promptInput, m.prompt ?? "");
            this.useGlobalCb.checked = m.useGlobalPrompt !== false;
            label.textContent = "Keyframe Prompt";
        } else {
            this.promptInput.disabled = true;
            this.useGlobalCb.disabled = true;
            setRichPromptValue(this.promptInput, "");
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

    /** Build the complete, editable and lossless project document. */
    _buildProject() {
        const tracks = (this._timeline?.tracks ?? []).map((track, order) => {
            const ti = this._trackIndex(track);
            const clips = track.clips.map(clip => {
                const m = this._meta.get(clip.id)
                    ?? (track.type === "audio" ? defaultAudioMeta(ti) : defaultImageMeta(ti));
                const startMs = Math.round(clip.startTime * 1000);
                const durationMs = Math.max(1, Math.round(clip.duration * 1000));
                const sourceInMs = Math.max(0, Math.round((clip.sourceOffset || 0) * 1000));
                const source = {
                    kind: track.type === "audio" ? "audio" : (m.mediaKind || "image"),
                    file: clip.src || "",
                };
                source.location = this._mediaStatus.get(`${source.kind}:${source.file}`)?.location || "assets";
                if (track.type === "audio" || m.mediaKind === "video") {
                    source.in_ms = sourceInMs;
                    source.out_ms = sourceInMs + durationMs;
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
            resources: this._projectResources.map(resource => ({ ...resource })),
            settings: {
                fps: Number(this._w("fps")?.value ?? 24),
                width: Number(this._w("width")?.value ?? 720),
                height: Number(this._w("height")?.value ?? 1280),
                global_prompt: String(this._w("global_prompt")?.value ?? ""),
            },
            tracks,
        };
    }

    _saveToWidgets() {
        const projectW = this._w("project_json");
        if (projectW) projectW.value = JSON.stringify(this._buildProject());

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
            projectTracks.forEach((track, trackIndex) => {
                for (const clip of Array.isArray(track.clips) ? track.clips : []) {
                    const source = clip.source && typeof clip.source === "object" ? clip.source : {};
                    if (source.file && source.location) this._mediaStatus.set(`${clip.type}:${source.file}`, { location: source.location });
                    const startMs = Number(clip.start_ms) || 0;
                    const durationMs = Math.max(0, Number(clip.duration_ms) || 0);
                    clips.push({
                        ...clip,
                        clip_type: clip.type,
                        track: trackIndex,
                        end_ms: startMs + durationMs,
                        start_image: source.file || null,
                        audio_file: source.file || null,
                        source_duration: Math.max(durationMs, Number(source.out_ms) - Number(source.in_ms)) / 1000,
                        trim_in: Math.max(0, Number(source.in_ms) || 0) / 1000,
                        disabled: clip.enabled === false,
                    });
                }
            });
            await Promise.all(clips.map(c => this._addClipFromJson(c)));

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
