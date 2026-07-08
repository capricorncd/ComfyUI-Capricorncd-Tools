import { api } from "../../scripts/api.js";
import WaveSurfer from "./wavesurfer.esm.js";
import { clamp, formatTimecode, parseTimecode, segmentFrameCount } from "./timecode.js";
import { attachRichPromptHandler, detachRichPromptHandler, setRichPromptValue } from "./rich_prompt.js";
import { bindCanvasWheelPassthrough } from "./cap_canvas_wheel.js";
import { loadExtensionCss } from "./cap_ui.js";

function loadCss() {
    loadExtensionCss("cap_audio_timeline.css", "cat-styles");
}

function uid() {
    return `cl_${Math.random().toString(36).slice(2, 9)}`;
}

function clipUseGlobalPrompt(raw) {
    if (raw.use_global_prompt !== undefined) return raw.use_global_prompt !== false;
    return !String(raw.prompt ?? "").trim();
}

// ── helpers ──────────────────────────────────────────────────────────────────

function removeContextMenu() {
    document.querySelector(".cat-ctx-menu")?.remove();
}

// ═════════════════════════════════════════════════════════════════════════════
export class CapAudioTimelineUI {
// ═════════════════════════════════════════════════════════════════════════════

// Tracks the most recently interacted-with instance.
// Used by onGlobalKeyDown as a fallback when the ComfyUI node is not selected
// in LiteGraph (users often click directly into the widget without first
// clicking the node header to select it in the canvas).
static _lastActive = null;

constructor(node) {
    this.node = node;

    // waveform
    this.durationMs = 0;
    this.wavesurfer = null;
    this.isReady = false;
    this._loadingAudio = false;
    this._lastAudio = null;
    this._loadTimer = null;
    this._resetTrimOnLoad = false;  // reset start/end time when a new audio is picked
    this._suppress = false;
    this._waveAudio = null;
    this._waveReady = false;
    this._waveUrl = null;
    this._trimDrag = null;      // 'start'|'end'
    this._selTrim = null;       // 'start'|'end'|null
    this._selPlayhead = false;  // playhead selected for arrow-key nudge

    // timeline
    this.clips = [];
    this.selClipId = null;
    this.selClipIds = new Set();
    this.playheadMs = 0;
    this._tlAudio = null;
    this._tlReady = false;
    this._dragState = null;
    this._clipboard = null;
    this._imgFiles = [];
    this._dirTimer = null;
    this._pickerCtx = null;  // {clipId, field}
    this._clipElMap = new Map(); // clipId → HTMLElement

    loadCss();
    this._buildDom();
    this._attachWidget();
    this._bindWidgets();
    this._bindEvents();
    attachRichPromptHandler(this.promptInput, { mode: "overlay" });
    this._initWavePlay();
    this._initTlPlay();
    this._loadFromWidget();
    const dir = this._w("assets_dir")?.value;
    if (dir) this._scheduleDir();
}

// ── widget access ─────────────────────────────────────────────────────────

_w(name) { return this.node.widgets?.find(w => w.name === name); }
getFps()  { return Math.max(1, parseInt(this._w("fps")?.value ?? 24, 10) || 24); }
getOneShot() { return !!this._w("one_shot")?.value; }
_dir()    { return String(this._w("assets_dir")?.value ?? "").trim(); }
_frameMs(){ return Math.max(1, Math.round(1000 / this.getFps())); }

// ── DOM build ─────────────────────────────────────────────────────────────

_buildDom() {
    const root = document.createElement("div");
    root.className = "cat-root";
    root.tabIndex = -1;
    bindCanvasWheelPassthrough(root);
    root.innerHTML = `
      <div class="cat-wave-section">
        <div class="cat-time-row">
          <label>起<input class="cat-s-in" type="text" placeholder="00:00.00"/></label>
          <label>止<input class="cat-e-in" type="text" placeholder="00:00.00"/></label>
          <span class="cat-wave-hint">未选择音频</span>
        </div>
        <div class="cat-wave-wrap">
          <div class="cat-loading">选择音频文件以加载波形…</div>
          <div class="cat-wave"></div>
          <div class="cat-overlay">
            <div class="cat-shade cat-sl"></div>
            <div class="cat-shade cat-sr"></div>
            <div class="cat-sel-region"></div>
            <div class="cat-hdl cat-hs"></div>
            <div class="cat-hdl cat-he"></div>
          </div>
        </div>
        <div class="cat-wave-ctrl">
          <button class="cat-wplay" disabled>▶</button>
          <span class="cat-wtime">00:00.00</span>
        </div>
      </div>

      <div class="cat-tl-section">
        <div class="cat-tl-ctrl">
          <button class="cat-tplay" disabled>▶</button>
          <span class="cat-ttime">00:00.00</span>
          <span class="cat-tdur"></span>
          <button class="cat-clear" title="清空时间轴素材">Clear</button>
          <button class="cat-import" title="Import timeline config from JSON">Import</button>
          <button class="cat-export" title="Export timeline config as JSON">Export</button>
          <button class="cat-addclip" disabled>＋ Add Image</button>
          <input class="cat-import-file" type="file" accept=".json" style="display:none">
        </div>
        <div class="cat-tl-body">
          <div class="cat-tl-scroll">
            <div class="cat-tl-inner">
              <div class="cat-ruler"></div>
              <div class="cat-tl-tracks">
                <div class="cat-overlay-track" data-track="1"></div>
                <div class="cat-clip-track" data-track="0"></div>
              </div>
              <div class="cat-playhead"><div class="cat-playhead-tri"></div></div>
            </div>
          </div>
        </div>
      </div>

      <div class="cat-prompt-section">
        <div class="cat-prompt-header">
          <div class="cat-prompt-label">Keyframe Prompt</div>
          <label class="cat-prompt-use-global" title="When enabled, Data Json Clip Parser outputs global prompt + keyframe prompt">
            <input class="cat-prompt-use-global-cb" type="checkbox" checked disabled />
            <span>Use Global</span>
          </label>
        </div>
        <div class="cat-prompt-wrap">
          <textarea class="cat-prompt-input" placeholder="Select a clip to enter prompt… (Ctrl+/ comment)" rows="3" disabled></textarea>
        </div>
      </div>

      <div class="cat-picker" style="display:none">
        <div class="cat-picker-hd">
          <span class="cat-picker-title">Select Image</span>
          <button class="cat-picker-refresh" title="Refresh image list">↻</button>
          <button class="cat-picker-x">✕</button>
        </div>
        <div class="cat-picker-grid"></div>
      </div>
    `;

    // refs
    this.root     = root;
    this.sIn      = root.querySelector(".cat-s-in");
    this.eIn      = root.querySelector(".cat-e-in");
    this.waveHint = root.querySelector(".cat-wave-hint");
    this.loadEl   = root.querySelector(".cat-loading");
    this.waveEl   = root.querySelector(".cat-wave");
    this.waveWrap = root.querySelector(".cat-wave-wrap");
    this.shadeL   = root.querySelector(".cat-sl");
    this.shadeR   = root.querySelector(".cat-sr");
    this.selRegion = root.querySelector(".cat-sel-region");
    this.hdlS     = root.querySelector(".cat-hs");
    this.hdlE     = root.querySelector(".cat-he");
    this.wPlayBtn = root.querySelector(".cat-wplay");
    this.wTimeEl  = root.querySelector(".cat-wtime");

    this.tPlayBtn   = root.querySelector(".cat-tplay");
    this.tTimeEl    = root.querySelector(".cat-ttime");
    this.tDurEl     = root.querySelector(".cat-tdur");
    this.clearBtn     = root.querySelector(".cat-clear");
    this.importBtn    = root.querySelector(".cat-import");
    this.exportBtn    = root.querySelector(".cat-export");
    this.addClipBtn   = root.querySelector(".cat-addclip");
    this.importFileEl = root.querySelector(".cat-import-file");
    this.tlScroll   = root.querySelector(".cat-tl-scroll");
    this.tlInner    = root.querySelector(".cat-tl-inner");
    this.rulerEl    = root.querySelector(".cat-ruler");
    this.clipTrack  = root.querySelector(".cat-clip-track");
    this.overlayTrack = root.querySelector(".cat-overlay-track");
    this.playheadEl  = root.querySelector(".cat-playhead");
    this.playheadTri = root.querySelector(".cat-playhead-tri");

    this.promptLabel = root.querySelector(".cat-prompt-label");
    this.promptUseGlobal = root.querySelector(".cat-prompt-use-global");
    this.promptUseGlobalCb = root.querySelector(".cat-prompt-use-global-cb");
    this.promptWrap = root.querySelector(".cat-prompt-wrap");
    this.promptInput = root.querySelector(".cat-prompt-input");

    this.pickerEl    = root.querySelector(".cat-picker");
    this.pickerGrid  = root.querySelector(".cat-picker-grid");
    this.pickerTitle      = root.querySelector(".cat-picker-title");
    this.pickerRefreshBtn = root.querySelector(".cat-picker-refresh");
    this.pickerCloseBtn   = root.querySelector(".cat-picker-x");

    // shared frame preview panel (populated on badge hover)
    this.framePreview = document.createElement("div");
    this.framePreview.className = "cat-frame-preview";
    this.framePreview.style.display = "none";
    root.appendChild(this.framePreview);
}

_attachWidget() {
    const node = this.node;
    const w = node.addDOMWidget("cat_ui", "cat_timeline", this.root, {
        hideOnZoom: false,
        getMinHeight: () => 480,
        getHeight: () => 480,
        afterResize: () => this._onDomWidthChanged(),
    });
    w.serialize = false;
    this.domWidget = w;

    // DomWidgets.vue: size = (widget.width ?? node.width) - margin*2
    // Never allow a stale widget.width to narrow the timeline below the node.
    Object.defineProperty(w, "width", {
        get() { return undefined; },
        set() {},
        enumerable: true,
        configurable: true,
    });

    const baseLayoutSize = w.computeLayoutSize?.bind(w);
    w.computeLayoutSize = () => {
        const layout = baseLayoutSize?.(node) ?? { minHeight: 480, minWidth: 0 };
        // Fixed absolute minimum — do not tie to current node width (blocks user shrink).
        return { ...layout, minHeight: 480, minWidth: 480 };
    };

    node.setSize([
        Math.max(node.size[0], 480),
        Math.max(node.size[1], 480),
    ]);

    this._lastDomWidth = 0;
    this._resizeObs = new ResizeObserver(() => this._onDomWidthChanged());
    this._resizeObs.observe(this.root);
}

_onDomWidthChanged() {
    const cw = this.tlScroll?.clientWidth ?? this.root?.clientWidth ?? 0;
    if (cw > 0 && cw === this._lastDomWidth) return;
    this._lastDomWidth = cw;
    this._renderTrim();
    if (this.isReady) this._renderTimeline();
}

// ── widget binding ────────────────────────────────────────────────────────

_bindWidgets() {
    const audioW = this._w("audio");
    if (audioW) {
        const orig = audioW.callback;
        audioW.callback = v => {
            orig?.(v);
            const url = v ? this._audioUrl(v) : null;
            this._reloadWavePlay(url);
            this._reloadTlPlay(url);
            if (v === this._lastAudio) return;
            this._lastAudio = v;
            // User picked a different audio → reset trim to the new full range on load.
            this._resetTrimOnLoad = true;
            clearTimeout(this._loadTimer);
            this._loadTimer = setTimeout(() => this._loadAudio(), 80);
        };
    }

    for (const name of ["fps", "one_shot"]) {
        const w = this._w(name);
        if (!w) continue;
        const orig = w.callback;
        w.callback = v => {
            orig?.(v);
            this._renderTimeline();
            if (name === "fps") this._updatePromptContext();
        };
    }

    const dirW = this._w("assets_dir");
    if (dirW) {
        const orig = dirW.callback;
        dirW.callback = v => { orig?.(v); this._scheduleDir(); };
        const el = dirW.inputEl ?? dirW.element;
        if (el && !el._catDirBound) {
            el._catDirBound = true;
            el.addEventListener("blur", () => this._scheduleDir());
        }
    }

    // prompt area starts disabled; _updatePromptContext enables it when a clip is selected
}

_bindEvents() {
    // waveform time inputs
    this.sIn.addEventListener("change", () => this._onTimeInput());
    this.eIn.addEventListener("change", () => this._onTimeInput());
    this.sIn.addEventListener("keydown", e => { if (e.key === "Enter") this._onTimeInput(); });
    this.eIn.addEventListener("keydown", e => { if (e.key === "Enter") this._onTimeInput(); });

    // trim handles
    this.hdlS.addEventListener("mousedown", e => {
        e.stopPropagation();
        this._selTrim = "start";
        this._trimDrag = "start";
        this._updateTrimUI();
    });
    this.hdlE.addEventListener("mousedown", e => {
        e.stopPropagation();
        this._selTrim = "end";
        this._trimDrag = "end";
        this._updateTrimUI();
    });

    // waveform background click → deselect trim and playhead
    this.waveWrap.addEventListener("mousedown", e => {
        if (!e.target.classList.contains("cat-hdl")) {
            this._selTrim = null;
            this._selPlayhead = false;
            this._updateTrimUI();
            this._renderPlayhead();
        }
    });

    // playback buttons
    this.wPlayBtn.addEventListener("click", () => this._toggleWavePlay());
    this.tPlayBtn.addEventListener("click", () => this._toggleTlPlay());

    // timeline header buttons
    this.clearBtn.addEventListener("click", () => this._clearTimeline());
    this.importBtn.addEventListener("click", () => this.importFileEl.click());
    this.exportBtn.addEventListener("click", () => this._exportJson());
    this.addClipBtn.addEventListener("click", () => this._showAddClipPicker());
    this.importFileEl.addEventListener("change", e => this._importJson(e));

    // playhead triangle click → select playhead without moving it
    this.playheadTri.addEventListener("click", e => {
        e.stopPropagation();
        this._selTrim = null;
        this._updateTrimUI();
        this._selPlayhead = true;
        this._renderPlayhead();
        this.root.focus();
    });

    // timeline click → set playhead (not on clips)
    this.tlScroll.addEventListener("click", e => {
        if (e.target.closest(".cat-clip")) return;
        this._selTrim = null;
        this._updateTrimUI();
        this._selPlayhead = true;
        const ms = this._tlPxToMs(e.clientX);
        this._setPlayhead(clamp(ms, 0, this._tlDurMs()));
        this.selClipId = null;
        this.selClipIds.clear();
        this._renderClips();
        this._updatePromptContext();
    });

    // double-click main track → add main clip at position
    this.clipTrack.addEventListener("dblclick", e => {
        if (e.target.closest(".cat-clip")) return;
        const ms = this._tlPxToMs(e.clientX);
        this._openAddPicker(ms, 0);
    });

    // double-click overlay (sub) track → add overlay clip at position
    this.overlayTrack.addEventListener("dblclick", e => {
        if (e.target.closest(".cat-clip")) return;
        const ms = this._tlPxToMs(e.clientX);
        if (this._subOverlaps(ms, ms + 1, null)) {
            alert("副轨道该位置已有素材，无法插入");
            return;
        }
        this._openAddPicker(ms, 1);
    });

    // context menu (both tracks)
    const onCtx = e => {
        e.preventDefault();
        e.stopPropagation();
        const clipEl = e.target.closest(".cat-clip");
        if (clipEl) this._showContextMenu(clipEl.dataset.id, e);
        else removeContextMenu();
    };
    this.clipTrack.addEventListener("contextmenu", onCtx);
    this.overlayTrack.addEventListener("contextmenu", onCtx);

    // prompt input — stop bubbling so canvas shortcuts don't steal keys
    this.promptWrap.addEventListener("mousedown", e => {
        e.stopPropagation();
        if (!this.promptInput.disabled) this.promptInput.focus();
    });
    this.promptInput.addEventListener("mousedown", e => e.stopPropagation());
    this.promptInput.addEventListener("keydown", e => e.stopPropagation());
    this.promptInput.addEventListener("keyup", e => e.stopPropagation());
    this.promptInput.addEventListener("keypress", e => e.stopPropagation());
    this.promptInput.addEventListener("input", () => this._onPromptChange());
    this.promptUseGlobalCb.addEventListener("change", () => this._onUseGlobalChange());

    // image picker close / refresh
    this.pickerRefreshBtn.addEventListener("click", () => this._refreshPicker());
    this.pickerCloseBtn.addEventListener("click", () => this._hidePicker());

    // global mouse — dragend clears state if native drag intercepts mouseup
    this._onMove    = e => this._handleMove(e);
    this._onUp      = e => this._handleUp(e);
    this._onDragEnd = () => this._handleUp();
    window.addEventListener("mousemove", this._onMove);
    window.addEventListener("mouseup", this._onUp);
    window.addEventListener("dragend", this._onDragEnd);

    // Mark this instance as the last-active timeline on any user interaction,
    // so keyboard shortcuts work even when the ComfyUI node isn't selected.
    this.root.addEventListener("mousedown", () => {
        CapAudioTimelineUI._lastActive = this;
    }, true);

    // capture-phase keyboard handler: fires before ComfyUI's document-level shortcuts
    this._onKeyDownBound = e => this._onKeyDown(e);
    document.addEventListener("keydown", this._onKeyDownBound, { capture: true });

    // focus root on timeline background click so spacebar etc. work without a selected clip
    this.tlScroll.addEventListener("click", e => {
        if (!e.target.closest(".cat-clip")) this.root.focus();
    });
    this.waveWrap.addEventListener("click", () => this.root.focus());
}

// ── trim ─────────────────────────────────────────────────────────────────

_getTrimMs() {
    const fps = this.getFps();
    const sv = this._w("start_time")?.value ?? "00:00.00";
    const ev = this._w("end_time")?.value;
    const s = parseTimecode(sv, fps);
    let e;
    try { e = parseTimecode(ev ?? formatTimecode(this.durationMs, fps), fps); }
    catch { e = this.durationMs; }
    return { startMs: clamp(s, 0, this.durationMs), endMs: clamp(e, 0, this.durationMs) };
}

_setTrimMs(startMs, endMs, sync = true) {
    startMs = clamp(startMs, 0, this.durationMs);
    endMs   = clamp(Math.max(startMs + 1, endMs), 0, this.durationMs);
    this._suppress = true;
    try {
        if (sync) {
            const fps = this.getFps();
            const stc = formatTimecode(startMs, fps);
            const etc = formatTimecode(endMs, fps);
            const sw = this._w("start_time"); if (sw) sw.value = stc;
            const ew = this._w("end_time");   if (ew) ew.value = etc;
            this.sIn.value = stc;
            this.eIn.value = etc;
        }
        this._renderTrim();
        this._renderTimeline();
        this._updateWaveHint();
    } finally { this._suppress = false; }
}

_waveMs(clientX) {
    const r = this.waveWrap.getBoundingClientRect();
    return Math.round(clamp((clientX - r.left) / r.width, 0, 1) * this.durationMs);
}

_msToWavePct(ms) { return this.durationMs ? (ms / this.durationMs) * 100 : 0; }

_renderTrim() {
    const { startMs, endMs } = this._getTrimMs();
    const l = this._msToWavePct(startMs);
    const r = this._msToWavePct(endMs);
    this.shadeL.style.width = `${l}%`;
    this.shadeR.style.cssText = `width:${100-r}%; left:${r}%`;
    this.selRegion.style.cssText = `left:${l}%; width:${r-l}%`;
    this.hdlS.style.left = `${l}%`;
    this.hdlE.style.left = `${r}%`;
}

_updateTrimUI() {
    this.hdlS.classList.toggle("selected", this._selTrim === "start");
    this.hdlE.classList.toggle("selected", this._selTrim === "end");
}

_onTimeInput() {
    try {
        const fps = this.getFps();
        this._setTrimMs(parseTimecode(this.sIn.value, fps), parseTimecode(this.eIn.value, fps));
    } catch {}
}

// ── waveform playback ─────────────────────────────────────────────────────

_initWavePlay() {
    this._waveAudio = new Audio();
    this._waveAudio.preload = "auto";
    this._waveAudio.addEventListener("loadedmetadata", () => {
        this._waveReady = true;
        const { startMs } = this._getTrimMs();
        this._seekWave(startMs);
        this._updWaveCtrl();
    });
    this._waveAudio.addEventListener("error", () => { this._waveReady = false; this._updWaveCtrl(); });
    this._waveAudio.addEventListener("timeupdate", () => this._onWaveTick());
    this._waveAudio.addEventListener("ended", () => {
        this.wPlayBtn.textContent = "▶";
        this._seekWave(this._getTrimMs().startMs);
    });
    this._waveAudio.addEventListener("pause", () => { this.wPlayBtn.textContent = "▶"; });
    this._waveAudio.addEventListener("play",  () => { this.wPlayBtn.textContent = "⏸"; });
}

_canWavePlay() { return this._waveReady && !!this._waveUrl && this.isReady; }

_updWaveCtrl() {
    this.wPlayBtn.disabled = !this._canWavePlay();
    this._updateWaveHint();
}

_updateWaveHint() {
    if (!this._w("audio")?.value) { this.waveHint.textContent = "未选择音频"; return; }
    if (this._loadingAudio)       { this.waveHint.textContent = "加载中…"; return; }
    if (!this._waveReady)         { this.waveHint.textContent = "音频不可用"; return; }
    const { startMs, endMs } = this._getTrimMs();
    const fps = this.getFps();
    this.waveHint.textContent = `${formatTimecode(startMs, fps)} — ${formatTimecode(endMs, fps)}`;
}

_seekWave(ms) {
    if (!this._waveAudio || !this._waveReady) return;
    this._waveAudio.currentTime = ms / 1000;
    this.wTimeEl.textContent = formatTimecode(ms, this.getFps());
    try { this.wavesurfer?.setTime(ms / 1000); } catch {}
}

_onWaveTick() {
    if (!this._waveAudio) return;
    const { startMs, endMs } = this._getTrimMs();
    const ms = Math.round(this._waveAudio.currentTime * 1000);
    if (ms >= endMs) { this._waveAudio.pause(); this._seekWave(startMs); return; }
    this.wTimeEl.textContent = formatTimecode(ms, this.getFps());
    try { this.wavesurfer?.setTime(this._waveAudio.currentTime); } catch {}
}

async _toggleWavePlay() {
    if (!this._canWavePlay()) return;
    if (!this._waveAudio.paused) { this._waveAudio.pause(); return; }
    const { startMs, endMs } = this._getTrimMs();
    const ms = Math.round(this._waveAudio.currentTime * 1000);
    if (ms < startMs || ms >= endMs) this._seekWave(startMs);
    try { await this._waveAudio.play(); } catch {}
}

_reloadWavePlay(url) {
    this._waveAudio?.pause();
    this._waveReady = false;
    this._waveUrl = url || null;
    if (url) { this._waveAudio.src = url; this._waveAudio.load(); }
    else { this._waveAudio?.removeAttribute("src"); }
    this._updWaveCtrl();
}

// ── timeline geometry ─────────────────────────────────────────────────────

_tlDurMs() { const { startMs, endMs } = this._getTrimMs(); return Math.max(1, endMs - startMs); }

_tlPxPerMs() {
    const w = this.tlScroll.clientWidth || 400;
    return w / this._tlDurMs();
}

_tlMsToPx(ms) { return ms * this._tlPxPerMs(); }

_tlPxToMs(clientX) {
    const r = this.tlScroll.getBoundingClientRect();
    // r.width is in screen px (includes CSS zoom); clientWidth is in layout px.
    // Divide the screen-space offset by the zoom ratio to get layout px.
    const zoom = r.width / Math.max(1, this.tlScroll.clientWidth);
    const layoutPx = (clientX - r.left) / zoom + this.tlScroll.scrollLeft;
    return clamp(Math.round(layoutPx / this._tlPxPerMs()), 0, this._tlDurMs());
}

// ── timeline playback ─────────────────────────────────────────────────────

_initTlPlay() {
    this._tlAudio = new Audio();
    this._tlAudio.preload = "auto";
    this._tlAudio.addEventListener("loadedmetadata", () => { this._tlReady = true; this._updTlCtrl(); });
    this._tlAudio.addEventListener("error", () => { this._tlReady = false; this._updTlCtrl(); });
    this._tlAudio.addEventListener("timeupdate", () => this._onTlTick());
    this._tlAudio.addEventListener("ended",  () => { this._stopTlPlay(); this._setPlayhead(0); });
    this._tlAudio.addEventListener("pause",  () => { this.tPlayBtn.textContent = "▶"; });
    this._tlAudio.addEventListener("play",   () => { this.tPlayBtn.textContent = "⏸"; });
}

_canTlPlay() { return this._tlReady && this.isReady; }

_updTlCtrl() {
    this.tPlayBtn.disabled = !this._canTlPlay();
    this.clearBtn.disabled = !this.clips.length;
    this.addClipBtn.disabled = !this.isReady;
    const fps = this.getFps();
    this.tDurEl.textContent = `/ ${formatTimecode(this._tlDurMs(), fps)}`;
}

_setPlayhead(ms) {
    this.playheadMs = clamp(ms, 0, this._tlDurMs());
    this.tTimeEl.textContent = formatTimecode(this.playheadMs, this.getFps());
    this._renderPlayhead();
}

_onTlTick() {
    if (!this._tlAudio) return;
    const { startMs } = this._getTrimMs();
    const rel = Math.max(0, Math.round(this._tlAudio.currentTime * 1000) - startMs);
    if (rel >= this._tlDurMs()) { this._stopTlPlay(); this._setPlayhead(0); return; }
    this._setPlayhead(rel);
}

_reloadTlPlay(url) {
    this._tlAudio?.pause();
    this._tlReady = false;
    if (url) { this._tlAudio.src = url; this._tlAudio.load(); }
    else { this._tlAudio?.removeAttribute("src"); }
    this._updTlCtrl();
}

async _toggleTlPlay() {
    if (!this._canTlPlay()) return;
    if (!this._tlAudio.paused) { this._stopTlPlay(); return; }
    const dur = this._tlDurMs();
    if (this.playheadMs >= dur) this._setPlayhead(0);
    const { startMs } = this._getTrimMs();
    this._tlAudio.currentTime = (startMs + this.playheadMs) / 1000;
    try { await this._tlAudio.play(); } catch {}
}

_stopTlPlay() {
    this._tlAudio?.pause();
    this.tPlayBtn.textContent = "▶";
}

// ── timeline render ───────────────────────────────────────────────────────

_renderTimeline() {
    if (!this.isReady) return;
    const dur = this._tlDurMs();
    const pxPerMs = this._tlPxPerMs();
    const totalPx = Math.max(this.tlScroll.clientWidth || 400, dur * pxPerMs);

    this.tlInner.style.width = `${totalPx}px`;
    this._renderRuler(dur, pxPerMs, totalPx);
    this.clipTrack.style.width = `${totalPx}px`;
    this.overlayTrack.style.width = `${totalPx}px`;
    this._renderClips();
    this._renderPlayhead();
    this._updTlCtrl();
}

_renderRuler(dur, pxPerMs, totalPx) {
    this.rulerEl.style.width = `${totalPx}px`;
    this.rulerEl.replaceChildren();
    const fps = this.getFps();
    const minPx = 60;
    const steps = [100, 200, 500, 1000, 2000, 5000, 10000, 30000, 60000];
    const step = steps.find(s => s * pxPerMs >= minPx) ?? 60000;
    for (let ms = 0; ms <= dur; ms += step) {
        const tick = document.createElement("div");
        tick.className = "cat-tick";
        tick.style.left = `${ms * pxPerMs}px`;
        tick.textContent = formatTimecode(ms, fps);
        this.rulerEl.appendChild(tick);
    }
}

_trackEl(clip) { return (clip.track ?? 0) === 1 ? this.overlayTrack : this.clipTrack; }

_renderClips({ layoutOnly = false, animate = false, dragId = null } = {}) {
    if (!layoutOnly) {
        this.clipTrack.replaceChildren();
        this.overlayTrack.replaceChildren();
        this._clipElMap.clear();
        const sorted = [...this.clips].sort((a, b) => a.startMs - b.startMs);
        for (const clip of sorted) {
            const el = this._createClipElement(clip);
            this._clipElMap.set(clip.id, el);
            this._trackEl(clip).appendChild(el);
        }
    }
    this._layoutClips({ animate, dragId });
}

_createClipElement(clip) {
    const el = document.createElement("div");
    el.className = "cat-clip";
    if ((clip.track ?? 0) === 1) el.classList.add("cat-clip-overlay");
    el.dataset.id = clip.id;

    const thumb = document.createElement("div");
    thumb.className = "cat-clip-thumb";
    if (clip.startImage) {
        const img = document.createElement("img");
        img.src = this._imgUrl(clip.startImage);
        img.alt = "";
        img.draggable = false;
        img.onerror = () => img.remove();
        thumb.appendChild(img);
    }

    if (clip.endImage) {
        const img = document.createElement("img");
        img.src = this._imgUrl(clip.endImage);
        img.alt = "";
        img.draggable = false;
        img.onerror = () => img.remove();
        thumb.appendChild(img);
    }

    const lbl = document.createElement("div");
    lbl.className = "cat-clip-lbl";
    const fname = clip.startImage?.split(/[\\/]/).pop() ?? "（未选图片）";
    lbl.textContent = fname;
    lbl.title = fname;

    if (clip.startImage || clip.endImage) {
        const fb = document.createElement("div");
        fb.className = "cat-frame-badge";
        fb.textContent = clip.endImage ? "[首尾]" : "[首]";
        fb.addEventListener("mouseenter", () => this._showFramePreview(clip, fb));
        fb.addEventListener("mouseleave", () => this._hideFramePreview());
        el.appendChild(fb);
    }

    if (clip.prompt) {
        const pb = document.createElement("div");
        pb.className = "cat-prompt-badge";
        pb.title = clip.prompt;
        el.appendChild(pb);
    }

    const rh = document.createElement("div");
    rh.className = "cat-resize-hdl";

    el.append(thumb, lbl, rh);

    el.addEventListener("mousedown", e => {
        if (e.target.classList.contains("cat-resize-hdl")) return;
        e.preventDefault();
        e.stopPropagation();
        const multi = e.ctrlKey || e.metaKey;
        this._selectClip(clip.id, multi);
        if (!multi) {
            this._dragState = {
                type: "move", clipId: clip.id,
                originMs: this._tlPxToMs(e.clientX),
                os: clip.startMs, oe: clip.endMs,
            };
        }
    });

    rh.addEventListener("mousedown", e => {
        e.preventDefault();
        e.stopPropagation();
        this._selectClip(clip.id);
        this._dragState = {
            type: "resize", clipId: clip.id,
            originMs: this._tlPxToMs(e.clientX),
            os: clip.startMs, oe: clip.endMs,
        };
    });

    return el;
}

_layoutClips({ animate = false, dragId = null } = {}) {
    const pxPerMs = this._tlPxPerMs();
    const sorted = [...this.clips].sort((a, b) => a.startMs - b.startMs);
    const liveIds = new Set(sorted.map(c => c.id));

    for (const [id, el] of this._clipElMap) {
        if (!liveIds.has(id)) {
            el.remove();
            this._clipElMap.delete(id);
        }
    }

    for (const clip of sorted) {
        let el = this._clipElMap.get(clip.id);
        if (!el) {
            el = this._createClipElement(clip);
            this._clipElMap.set(clip.id, el);
            this._trackEl(clip).appendChild(el);
        }

        const left = clip.startMs * pxPerMs;
        const width = Math.max(4, (clip.endMs - clip.startMs) * pxPerMs);
        const isDragged = dragId != null && clip.id === dragId;

        el.classList.toggle("cat-clip-overlay", (clip.track ?? 0) === 1);
        el.classList.toggle("selected", this.selClipIds.has(clip.id));
        el.classList.toggle("cat-clip-disabled", !!clip.disabled);
        el.classList.toggle("cat-clip-dragging", isDragged);
        el.classList.toggle("cat-clip-anim", animate && !isDragged);
        el.style.width = `${width}px`;
        el.style.left = `${left}px`;

        const lbl = el.querySelector(".cat-clip-lbl");
        if (lbl) {
            const fname = clip.startImage?.split(/[\\/]/).pop() ?? "（未选图片）";
            lbl.textContent = fname;
            lbl.title = fname;
        }

        const hasPrompt = !!clip.prompt;
        let pb = el.querySelector(".cat-prompt-badge");
        if (hasPrompt && !pb) {
            pb = document.createElement("div");
            pb.className = "cat-prompt-badge";
            el.appendChild(pb);
        } else if (!hasPrompt && pb) {
            pb.remove();
        }
        if (pb) pb.title = clip.prompt ?? "";

        this._trackEl(clip).appendChild(el);
    }
}

_renderPlayhead() {
    this.playheadEl.style.left = `${this._tlMsToPx(this.playheadMs)}px`;
    this.playheadEl.classList.toggle("selected", this._selPlayhead);
}

// ── clip operations ───────────────────────────────────────────────────────

_selectClip(id, addToSelection = false) {
    if (addToSelection) {
        if (this.selClipIds.has(id)) {
            this.selClipIds.delete(id);
            this.selClipId = this.selClipIds.size > 0
                ? [...this.selClipIds].at(-1) : null;
        } else {
            this.selClipIds.add(id);
            this.selClipId = id;
        }
    } else {
        this.selClipIds.clear();
        this.selClipIds.add(id);
        this.selClipId = id;
    }
    this._selTrim = null;
    this._selPlayhead = false;
    this._updateTrimUI();
    this._renderClips();
    this._renderPlayhead();
    this._updatePromptContext();
    this.root.focus();
    this.node.setDirtyCanvas(true, true);
}

_deselectAll() {
    this.selClipId = null;
    this.selClipIds.clear();
    this._selTrim = null;
    this._selPlayhead = false;
    this._updateTrimUI();
    this._renderClips();
    this._renderPlayhead();
    this._updatePromptContext();
}

_addClip(startMs, startImage = null, track = 0) {
    if (track === 1) {
        // Overlay (sub) track: free position, no overlap, gaps allowed.
        const dur = this._tlDurMs();
        startMs = clamp(startMs, 0, dur);
        const { hi } = this._subSlot(null, startMs, startMs);
        const wanted = Math.min(2000, Math.round(dur / 4)) || this._frameMs();
        const endMs = Math.min(startMs + wanted, hi, dur);
        if (endMs - startMs < this._frameMs()) {
            alert("副轨道该位置空间不足，无法插入");
            return;
        }
        const clip = { id: uid(), startMs, endMs, startImage, endImage: null, prompt: "", useGlobalPrompt: true, disabled: false, track: 1 };
        this.clips.push(clip);
        this._selectClip(clip.id);
        this._saveClips();
        this._renderClips();
        this._updTlCtrl();
        return;
    }
    const defaultDur = Math.min(2000, Math.round(this._tlDurMs() / 4));
    // Use startMs only for ordering; _packClips will assign the actual position.
    const clip = { id: uid(), startMs, endMs: startMs + defaultDur, startImage, endImage: null, prompt: "", useGlobalPrompt: true, disabled: false, track: 0 };
    this.clips.push(clip);
    this._packClips();
    this._selectClip(clip.id);
    this._saveClips();
    this._updTlCtrl();
}

// Returns the free interval [lo, hi] on the overlay track around a clip's slot,
// bounded by neighbouring overlay clips (using its original start/end os, oe).
_subSlot(excludeId, os, oe) {
    let lo = 0, hi = this._tlDurMs();
    for (const c of this.clips) {
        if ((c.track ?? 0) !== 1 || c.id === excludeId) continue;
        if (c.endMs <= os && c.endMs > lo) lo = c.endMs;
        if (c.startMs >= oe && c.startMs < hi) hi = c.startMs;
    }
    return { lo, hi };
}

// True if [start, end) overlaps any overlay clip (excluding excludeId).
_subOverlaps(start, end, excludeId) {
    return this.clips.some(c =>
        (c.track ?? 0) === 1 && c.id !== excludeId &&
        start < c.endMs && end > c.startMs);
}

_confirmAction(message) {
    return window.confirm(message);
}

_confirmDeleteClip(id) {
    if (!id || !this.clips.some(c => c.id === id)) return;
    if (!this._confirmAction("确定要删除该素材吗？")) return;
    this._deleteClip(id);
}

_deleteClip(id) {
    this.clips = this.clips.filter(c => c.id !== id);
    this.selClipIds.delete(id);
    if (this.selClipId === id) { this.selClipId = this.selClipIds.size > 0 ? [...this.selClipIds].at(-1) : null; this._updatePromptContext(); }
    this._packClips();
    this._saveClips();
    this._renderClips();
    this._updTlCtrl();
}

_clearTimeline() {
    if (!this.clips.length) return;
    if (!this._confirmAction("确定要清空时间轴上的所有素材吗？")) return;
    this.clips = [];
    this.selClipId = null;
    this.selClipIds.clear();
    this._updatePromptContext();
    this._saveClips();
    this._renderClips();
    this._updTlCtrl();
}

_updateClip(id, patch) {
    const c = this.clips.find(c => c.id === id);
    if (!c) return;
    Object.assign(c, patch);
    this._saveClips();
    this._renderClips();
    if (id === this.selClipId) this._updatePromptContext();
}

_trimLeft(id) {
    const c = this.clips.find(c => c.id === id);
    if (!c || this.playheadMs <= c.startMs || this.playheadMs >= c.endMs) return;
    c.startMs = this.playheadMs;
    if ((c.track ?? 0) !== 1) this._packClips();
    this._saveClips();
    this._renderClips();
    if (id === this.selClipId) this._updatePromptContext();
}

_trimRight(id) {
    const c = this.clips.find(c => c.id === id);
    if (!c || this.playheadMs <= c.startMs || this.playheadMs >= c.endMs) return;
    c.endMs = this.playheadMs;
    if ((c.track ?? 0) !== 1) this._packClips();
    this._saveClips();
    this._renderClips();
    if (id === this.selClipId) this._updatePromptContext();
}

// Move a single clip between main (0) and overlay (1) tracks.
_moveClipToTrack(id, track) {
    const c = this.clips.find(c => c.id === id);
    if (!c || (c.track ?? 0) === track) return;
    if (track === 1) {
        if (this._subOverlaps(c.startMs, c.endMs, id)) {
            alert("副轨道该位置已有素材，无法移动");
            return;
        }
        c.track = 1;
        this._packClips();  // repack main without this clip
    } else {
        c.track = 0;
        this._packClips();  // insert into main order by current startMs
    }
    this._saveClips();
    this._renderClips();
    this._updTlCtrl();
    if (id === this.selClipId) this._updatePromptContext();
}

_copyClip(id) {
    const c = this.clips.find(c => c.id === id);
    if (!c) return;
    this._clipboard = { ...c, id: null, durationMs: c.endMs - c.startMs };
}

_pasteClip() {
    if (!this._clipboard) return;
    const cbTrack = this._clipboard.track ?? 0;
    const durMs = this._clipboard.durationMs;
    if (cbTrack === 1) {
        // Paste onto overlay track after the last overlay clip, clamped to no-overlap.
        const subs = this.clips.filter(c => (c.track ?? 0) === 1).sort((a, b) => a.startMs - b.startMs);
        const tlDur = this._tlDurMs();
        let s = subs.length ? subs[subs.length - 1].endMs : 0;
        let e = s + durMs;
        if (e > tlDur) { e = tlDur; s = Math.max(0, tlDur - durMs); }
        if (e - s < this._frameMs() || this._subOverlaps(s, e, null)) {
            alert("副轨道空间不足，无法粘贴");
            return;
        }
        const clip = { ...this._clipboard, id: uid(), startMs: s, endMs: e, track: 1 };
        this.clips.push(clip);
        this._selectClip(clip.id);
        this._saveClips();
        this._renderClips();
        this._updTlCtrl();
        return;
    }
    const main = this.clips.filter(c => (c.track ?? 0) !== 1).sort((a, b) => a.startMs - b.startMs);
    const last = main[main.length - 1];
    const s = last ? last.endMs : 0;
    const clip = { ...this._clipboard, id: uid(), startMs: s, endMs: s + durMs, track: 0 };
    this.clips.push(clip);
    this._packClips();
    this._selectClip(clip.id);
    this._saveClips();
}

_swapKeyframes(id) {
    const c = this.clips.find(c => c.id === id);
    if (!c) return;
    const tmp = c.startImage;
    c.startImage = c.endImage;
    c.endImage = tmp;
    this._saveClips();
    this._renderClips();
}

_splitClip(id) {
    const c = this.clips.find(c => c.id === id);
    if (!c) return;
    const ms = this.playheadMs;
    if (ms <= c.startMs || ms >= c.endMs) return;
    const left = {
        id: uid(), startMs: c.startMs, endMs: ms,
        startImage: c.startImage, endImage: null,
        prompt: c.prompt, useGlobalPrompt: c.useGlobalPrompt, disabled: c.disabled,
        track: c.track ?? 0,
    };
    const right = {
        id: uid(), startMs: ms, endMs: c.endMs,
        startImage: null, endImage: c.endImage,
        prompt: c.prompt, useGlobalPrompt: c.useGlobalPrompt, disabled: c.disabled,
        track: c.track ?? 0,
    };
    const idx = this.clips.findIndex(c => c.id === id);
    this.clips.splice(idx, 1, left, right);
    if (this.selClipId === id) this.selClipId = left.id;
    this._packClips();
    this._saveClips();
    this._renderClips();
    this._updTlCtrl();
    this._updatePromptContext();
}

_toggleDisable(id) {
    const c = this.clips.find(c => c.id === id);
    if (!c) return;
    c.disabled = !c.disabled;
    this._saveClips();
    this._renderClips();
}

_disableOthers(id) {
    const others = this.clips.filter(c => c.id !== id);
    if (!others.length) return;
    const target = others.every(c => c.disabled) ? false : true;
    let changed = false;
    for (const c of others) {
        if (c.disabled !== target) { c.disabled = target; changed = true; }
    }
    if (changed) { this._saveClips(); this._renderClips(); }
}

_areContiguous(ids) {
    if (ids.length < 2) return true;
    const idSet = new Set(ids);
    const sel = this.clips.filter(c => idSet.has(c.id));
    // Merge only within the same track.
    if (new Set(sel.map(c => c.track ?? 0)).size > 1) return false;
    const sorted = [...this.clips].sort((a, b) => a.startMs - b.startMs);
    const indices = sorted.reduce((acc, c, i) => { if (idSet.has(c.id)) acc.push(i); return acc; }, []);
    if (indices.length !== ids.length) return false;
    for (let i = 1; i < indices.length; i++) {
        if (indices[i] !== indices[i - 1] + 1) return false;
    }
    return true;
}

_mergeSelected() {
    if (this.selClipIds.size < 2) return;
    const idSet = this.selClipIds;
    const sorted = [...this.clips].sort((a, b) => a.startMs - b.startMs);
    const selected = sorted.filter(c => idSet.has(c.id));
    if (selected.length < 2 || !this._areContiguous([...idSet])) return;
    const first = selected[0];
    const last  = selected[selected.length - 1];
    first.endMs = last.endMs;
    const toRemove = new Set(selected.slice(1).map(c => c.id));
    this.clips = this.clips.filter(c => !toRemove.has(c.id));
    this.selClipIds.clear();
    this.selClipIds.add(first.id);
    this.selClipId = first.id;
    this._packClips();
    this._saveClips();
    this._renderClips();
    this._updTlCtrl();
    this._updatePromptContext();
}

_toggleDisableSelected() {
    if (!this.selClipIds.size) return;
    const selected = this.clips.filter(c => this.selClipIds.has(c.id));
    const target = selected.every(c => c.disabled) ? false : true;
    let changed = false;
    for (const c of selected) {
        if (c.disabled !== target) { c.disabled = target; changed = true; }
    }
    if (changed) { this._saveClips(); this._renderClips(); }
}

_snapMs(ms, excludeId) {
    const thr = 50;
    const dur = this._tlDurMs();
    let best = ms, bestD = thr;
    for (const c of this.clips) {
        if (c.id === excludeId) continue;
        for (const edge of [c.startMs, c.endMs]) {
            const d = Math.abs(ms - edge);
            if (d < bestD) { bestD = d; best = edge; }
        }
    }
    if (Math.abs(ms) < bestD) best = 0;
    if (Math.abs(ms - dur) < bestD) best = dur;
    return best;
}

// Pack only the MAIN track contiguously from 0, preserving durations.
// Overlay (sub) track clips keep their free positions (gaps allowed, no overlap).
_packClips() {
    const main = this.clips.filter(c => (c.track ?? 0) !== 1).sort((a, b) => a.startMs - b.startMs);
    let cursor = 0;
    for (const c of main) {
        const dur = Math.max(this._frameMs(), c.endMs - c.startMs);
        c.startMs = cursor;
        c.endMs   = cursor + dur;
        cursor    = c.endMs;
    }
}

// ── prompt area ───────────────────────────────────────────────────────────

_updatePromptContext() {
    const clip = this.clips.find(c => c.id === this.selClipId);
    if (clip) {
        const fps = this.getFps();
        const start = formatTimecode(clip.startMs, fps);
        const end = formatTimecode(clip.endMs, fps);
        const frames = segmentFrameCount(clip.startMs, clip.endMs, fps);
        this.promptLabel.textContent = `Keyframe Prompt · ${start}~${end} （${frames}）`;
        this.promptLabel.classList.add("clip-mode");
        this.promptInput.classList.add("clip-mode");
        this.promptInput.disabled = false;
        this.promptInput.tabIndex = 0;
        setRichPromptValue(this.promptInput, clip.prompt ?? "", true);
        this.promptUseGlobalCb.disabled = false;
        this.promptUseGlobalCb.checked = clip.useGlobalPrompt !== false;
        this.promptUseGlobal.classList.add("clip-mode");
    } else {
        this.promptLabel.textContent = "Keyframe Prompt";
        this.promptLabel.classList.remove("clip-mode");
        this.promptInput.classList.remove("clip-mode");
        this.promptInput.disabled = true;
        this.promptInput.tabIndex = -1;
        setRichPromptValue(this.promptInput, "", false);
        this.promptUseGlobalCb.checked = true;
        this.promptUseGlobalCb.disabled = true;
        this.promptUseGlobal.classList.remove("clip-mode");
    }
}

_onPromptChange() {
    const clip = this.clips.find(c => c.id === this.selClipId);
    if (!clip) return;
    clip.prompt = this.promptInput.value;
    this._saveClips();
    this._renderClips();
}

_onUseGlobalChange() {
    const clip = this.clips.find(c => c.id === this.selClipId);
    if (!clip) return;
    clip.useGlobalPrompt = !!this.promptUseGlobalCb.checked;
    this._saveClips();
}

// ── context menu ──────────────────────────────────────────────────────────

_buildMenu(items, e) {
    const menu = document.createElement("div");
    menu.className = "cat-ctx-menu";
    menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:9999`;
    for (const { label, shortcut, fn } of items) {
        const div = document.createElement("div");
        div.className = "cat-ctx-item";
        if (shortcut) {
            div.innerHTML = `<span>${label}</span><span class="cat-ctx-key">${shortcut}</span>`;
        } else {
            div.textContent = label;
        }
        div.addEventListener("click", () => { fn(); removeContextMenu(); });
        menu.appendChild(div);
    }
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener("click", removeContextMenu, { once: true }), 0);
}

_showContextMenu(clipId, e) {
    removeContextMenu();
    if (!this.clips.some(c => c.id === clipId)) return;

    // Multi-select menu when right-clicking on a selected clip in a multi-selection
    if (this.selClipIds.size > 1 && this.selClipIds.has(clipId)) {
        const selectedIds = [...this.selClipIds];
        const allDisabled = selectedIds.every(id => this.clips.find(c => c.id === id)?.disabled);
        const canMerge = this._areContiguous(selectedIds);
        const items = [
            ...(canMerge ? [{ label: "合并", fn: () => this._mergeSelected() }] : []),
            { label: allDisabled ? "启用选中项" : "禁用选中项", shortcut: "Ctrl+B", fn: () => this._toggleDisableSelected() },
        ];
        this._buildMenu(items, e);
        return;
    }

    // Single-select menu (ensure only this clip is selected)
    if (this.selClipId !== clipId) this._selectClip(clipId);
    const clip = this.clips.find(c => c.id === clipId);
    if (!clip) return;

    const disableLabel = clip.disabled ? "Enable" : "Disable";
    const others = this.clips.filter(c => c.id !== clipId);
    const othersAllDisabled = others.length > 0 && others.every(c => c.disabled);
    const othersLabel = othersAllDisabled ? "Enable Others" : "Disable Others";
    const canSplit = this.playheadMs > clip.startMs && this.playheadMs < clip.endMs;
    const isOverlay = (clip.track ?? 0) === 1;
    const items = [
        { label: "替换素材",     fn: () => this._openPicker(clipId, "startImage", "替换素材") },
        { label: "选择尾帧图片", fn: () => this._openPicker(clipId, "endImage", "选择尾帧图片") },
        ...(clip.startImage && clip.endImage ? [{ label: "首尾帧交换", fn: () => this._swapKeyframes(clipId) }] : []),
        ...(canSplit ? [{ label: "分割素材", fn: () => this._splitClip(clipId) }] : []),
        { label: isOverlay ? "移到主轨道" : "移到副轨道", fn: () => this._moveClipToTrack(clipId, isOverlay ? 0 : 1) },
        { label: disableLabel,   shortcut: "Ctrl+B", fn: () => this._toggleDisable(clipId) },
        { label: othersLabel,    shortcut: "Ctrl+G", fn: () => this._disableOthers(clipId) },
        { label: "复制",         fn: () => this._copyClip(clipId) },
        { label: "删除",         shortcut: "Delete", fn: () => this._confirmDeleteClip(clipId) },
        ...(clip.endImage ? [{ label: "清除尾帧图片", fn: () => this._updateClip(clipId, { endImage: null }) }] : []),
    ];
    this._buildMenu(items, e);
}

// ── frame preview (badge hover) ───────────────────────────────────────────

_showFramePreview(clip, badgeEl) {
    const fp = this.framePreview;
    fp.classList.remove("cat-frame-preview--center");
    fp.style.right = "";
    fp.style.transform = "";
    fp.replaceChildren();

    const makeItem = (src, label) => {
        const wrap = document.createElement("div");
        wrap.className = "cat-frame-preview-item";
        const img = document.createElement("img");
        img.src = `/audio_keyframe_timeline/keyframe_image?dir=${encodeURIComponent(this._getKeyframeDir())}&name=${encodeURIComponent(src)}`;
        const tag = document.createElement("div");
        tag.className = "cat-frame-preview-tag";
        tag.textContent = label;
        wrap.append(img, tag);
        return wrap;
    };

    if (clip.startImage) fp.appendChild(makeItem(clip.startImage, "首"));
    if (clip.endImage) fp.appendChild(makeItem(clip.endImage, "尾"));

    fp.style.display = "flex";

    // Position: above the badge, accounting for CSS zoom
    const root = this.root;
    const rootR = root.getBoundingClientRect();
    const zoom = rootR.width / root.clientWidth;
    const br = badgeEl.getBoundingClientRect();

    // Convert fixed-position badge coords into root-relative layout px
    const leftLayout = (br.left - rootR.left) / zoom;
    const topLayout  = (br.top  - rootR.top)  / zoom;

    fp.style.left = `${leftLayout}px`;
    fp.style.top  = `${topLayout - 4}px`; // will be shifted up via transform in CSS
}

_hideFramePreview() {
    this.framePreview.style.display = "none";
    this.framePreview.classList.remove("cat-frame-preview--center");
    this.framePreview.style.right = "";
    this.framePreview.style.transform = "";
}

// Large preview for a picker image, anchored below the hovered icon, centered horizontally.
_showImagePreview(file, anchorEl) {
    const fp = this.framePreview;
    fp.replaceChildren();
    const wrap = document.createElement("div");
    wrap.className = "cat-frame-preview-item";
    const img = document.createElement("img");
    img.src = this._imgUrl(file);
    wrap.append(img);
    fp.appendChild(wrap);
    fp.classList.add("cat-frame-preview--center");
    fp.style.display = "flex";

    const root = this.root;
    const rootR = root.getBoundingClientRect();
    const zoom = rootR.width / root.clientWidth;
    const ar = anchorEl.getBoundingClientRect();
    const bottomLayout = (ar.bottom - rootR.top) / zoom;
    fp.style.left = "50%";
    fp.style.top = `${bottomLayout + 6}px`;
}

_getKeyframeDir() {
    return this.node.widgets?.find(w => w.name === "assets_dir")?.value ?? "";
}

// ── image picker ──────────────────────────────────────────────────────────

_openPicker(clipId, field, title = "选择图片") {
    this._pickerCtx = { mode: "replace", clipId, field };
    this.pickerTitle.textContent = title;
    this._renderPickerGrid();
    this.pickerEl.style.display = "flex";
}

_hidePicker() {
    this.pickerEl.style.display = "none";
    this._pickerCtx = null;
}

async _refreshPicker() {
    this.pickerRefreshBtn.disabled = true;
    await this._fetchImages();
    this._renderPickerGrid();
    this.pickerRefreshBtn.disabled = false;
}

_renderPickerGrid() {
    this.pickerGrid.replaceChildren();
    if (!this._imgFiles.length) {
        const msg = document.createElement("div");
        msg.className = "cat-picker-empty";
        msg.textContent = this._dir() ? "目录中无图片" : "请先设置 assets_dir";
        this.pickerGrid.appendChild(msg);
        return;
    }
    for (const file of this._imgFiles) {
        const item = document.createElement("div");
        item.className = "cat-picker-item";
        const img = document.createElement("img");
        img.src = this._imgUrl(file);
        img.alt = "";
        img.onerror = () => img.style.display = "none";
        const nm = document.createElement("div");
        nm.className = "cat-picker-name";
        nm.textContent = file.split(/[\\/]/).pop();

        const zoom = document.createElement("div");
        zoom.className = "cat-picker-zoom";
        // zoom.title = "查看大图";
        zoom.textContent = "🔍";
        zoom.addEventListener("mouseenter", () => this._showImagePreview(file, zoom));
        zoom.addEventListener("mouseleave", () => this._hideFramePreview());
        zoom.addEventListener("click", e => e.stopPropagation());

        item.append(img, nm, zoom);
        item.addEventListener("click", () => {
            if (!this._pickerCtx) return;
            if (this._pickerCtx.mode === "add") {
                this._addClip(this._pickerCtx.atMs, file, this._pickerCtx.track ?? 0);
            } else {
                const { clipId, field } = this._pickerCtx;
                this._updateClip(clipId, { [field]: file });
            }
            this._hidePicker();
        });
        this.pickerGrid.appendChild(item);
    }
}

// Add Image button: insert at playhead, preferring the empty track.
_showAddClipPicker(atMs = this.playheadMs) {
    const track = this._pickInsertTrack(atMs);
    if (track === null) {
        alert("主轨道与副轨道在该位置都有素材，无法插入");
        return;
    }
    this._openAddPicker(atMs, track);
}

// Decide which track to insert into at a given time:
// main empty here → main; else sub empty → overlay; else null (both occupied).
_pickInsertTrack(atMs) {
    const mainAt = this.clips.some(c => (c.track ?? 0) !== 1 && atMs >= c.startMs && atMs < c.endMs);
    const subAt  = this.clips.some(c => (c.track ?? 0) === 1 && atMs >= c.startMs && atMs < c.endMs);
    if (!mainAt) return 0;
    if (!subAt)  return 1;
    return null;
}

_openAddPicker(atMs, track = 0) {
    this._pickerCtx = { mode: "add", atMs, track };
    this.pickerTitle.textContent = track === 1 ? "Add Image · 副轨道" : "Add Image";
    this._renderPickerGrid();
    this.pickerEl.style.display = "flex";
}

_imgUrl(filename) {
    if (!filename) return "";
    const dir = this._dir();
    if (dir) {
        return api.apiURL(
            `/audio_keyframe_timeline/keyframe_image?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(filename)}`
        );
    }
    return api.apiURL(`/view?filename=${encodeURIComponent(filename.split(/[\\/]/).pop())}&type=input`);
}

// ── image dir ─────────────────────────────────────────────────────────────

_scheduleDir() {
    clearTimeout(this._dirTimer);
    this._dirTimer = setTimeout(() => this._fetchImages(), 200);
}

async _fetchImages() {
    const dir = this._dir();
    if (!dir) { this._imgFiles = []; return; }
    try {
        const r = await fetch(api.apiURL(`/audio_keyframe_timeline/keyframes?dir=${encodeURIComponent(dir)}`));
        if (!r.ok) throw new Error();
        const d = await r.json();
        this._imgFiles = Array.isArray(d.files) ? d.files : [];
    } catch { this._imgFiles = []; }
}

// ── import / export ───────────────────────────────────────────────────────

_exportJson() {
    const wv = name => this._w(name)?.value ?? null;
    const data = {
        audio:         wv("audio"),
        start_time:    wv("start_time"),
        end_time:      wv("end_time"),
        fps:           wv("fps"),
        width:         wv("width"),
        height:        wv("height"),
        assets_dir:  wv("assets_dir"),
        one_shot:      wv("one_shot"),
        global_prompt: wv("global_prompt"),
        clips: this.clips.map(c => ({
            start_ms:    c.startMs,
            end_ms:      c.endMs,
            start_image: c.startImage ?? null,
            end_image:   c.endImage ?? null,
            prompt:      c.prompt ?? "",
            use_global_prompt: c.useGlobalPrompt !== false,
            disabled:    c.disabled ?? false,
            track:       (c.track ?? 0) === 1 ? 1 : 0,
            z_index:     (c.track ?? 0) === 1 ? 2 : 1,
        })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const audio = wv("audio");
    const stem  = audio ? String(audio).replace(/\.[^.]+$/, "").split(/[\\/]/).pop() : "timeline";
    const now   = new Date();
    const pad   = n => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    a.href = url;
    a.download = `${stem}_${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

_importJson(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
        try {
            const data = JSON.parse(ev.target.result);
            const set = (name, val) => { if (val == null) return; const w = this._w(name); if (w) w.value = val; };
            set("fps",           data.fps);
            set("width",         data.width);
            set("height",        data.height);
            set("one_shot",      data.one_shot);
            set("global_prompt", data.global_prompt);
            set("assets_dir",  data.assets_dir);
            if (data.start_time != null) { set("start_time", data.start_time); this.sIn.value = data.start_time; }
            if (data.end_time   != null) { set("end_time",   data.end_time);   this.eIn.value = data.end_time; }
            if (data.audio != null) {
                const audioW = this._w("audio");
                if (audioW) { audioW.value = data.audio; audioW.callback?.(data.audio); }
                // Imported config already carries its own start/end time → keep them.
                this._resetTrimOnLoad = false;
            }
            if (Array.isArray(data.clips)) {
                this.clips = data.clips.map(c => ({
                    id:         uid(),
                    startMs:    Number(c.start_ms) || 0,
                    endMs:      Number(c.end_ms)   || 0,
                    startImage: c.start_image ?? null,
                    endImage:   c.end_image   ?? null,
                    prompt:     c.prompt ?? "",
                    useGlobalPrompt: clipUseGlobalPrompt(c),
                    disabled:   c.disabled ?? false,
                    track:      Number(c.track) === 1 ? 1 : 0,
                }));
                this._saveClips();
            }
            if (data.assets_dir) this._scheduleDir();
            if (this.isReady) this._renderTimeline();
            this._updatePromptContext();
        } catch (err) {
            console.error("[CAP_AudioTimeline] import failed:", err);
        }
    };
    reader.readAsText(file);
    e.target.value = "";
}

// ── persistence ───────────────────────────────────────────────────────────

_saveClips() {
    const w = this._w("clips_json");
    if (!w) return;
    w.value = JSON.stringify(this.clips.map(c => ({
        start_ms: c.startMs, end_ms: c.endMs,
        start_image: c.startImage ?? null,
        end_image: c.endImage ?? null,
        prompt: c.prompt ?? "",
        use_global_prompt: c.useGlobalPrompt !== false,
        disabled: c.disabled ?? false,
        track: (c.track ?? 0) === 1 ? 1 : 0,
        z_index: (c.track ?? 0) === 1 ? 2 : 1,
    })));
    this.node.setDirtyCanvas(true, true);
}

_loadFromWidget() {
    const w = this._w("clips_json");
    if (!w?.value) return;
    try {
        const data = JSON.parse(w.value);
        if (Array.isArray(data)) {
            this.clips = data.map(c => ({
                id: uid(),
                startMs: Number(c.start_ms) || 0,
                endMs: Number(c.end_ms) || 0,
                startImage: c.start_image ?? null,
                endImage: c.end_image ?? null,
                prompt: c.prompt ?? "",
                useGlobalPrompt: clipUseGlobalPrompt(c),
                disabled: c.disabled ?? false,
                track: Number(c.track) === 1 ? 1 : 0,
            }));
        }
    } catch {}
}

// ── keyboard ──────────────────────────────────────────────────────────────

_onKeyDown(e, ignoreFocus = false) {
    // Keyframe prompt: let the textarea handle all keys (incl. shortcuts)
    if (e.target?.classList?.contains("cat-prompt-input")) return;

    // Only handle when this timeline's root (or a child) is the active element.
    // ignoreFocus=true is passed by onGlobalKeyDown (cap_audio_timeline.js) which
    // already verified the correct node is selected — no focus guard needed there.
    if (!ignoreFocus && !this.root.contains(document.activeElement)) return;

    const isTyping = e.target?.tagName === "INPUT" || e.target?.tagName === "TEXTAREA";
    const isPrompt = e.target?.classList?.contains("cat-prompt-input");

    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (isTyping && !isPrompt) return;
        if (isPrompt) return; // let textarea handle cursor
        const delta = e.key === "ArrowLeft" ? -1 : 1;
        if (this._selTrim) {
            this._nudgeTrim(this._selTrim, delta);
        } else {
            const ms = clamp(this.playheadMs + delta * this._frameMs(), 0, this._tlDurMs());
            this._setPlayhead(ms);
        }
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.();
        return;
    }

    if (isTyping) return;

    if (e.key === " ") {
        this._toggleTlPlay();
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.();
        return;
    }

    if ((e.key === "Delete" || e.key === "Backspace") && this.selClipId) {
        this._confirmDeleteClip(this.selClipId);
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.();
        return;
    }
    if (e.key === "q" && this.selClipId) {
        this._trimLeft(this.selClipId);
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.();
    }
    if (e.key === "w" && this.selClipId) {
        this._trimRight(this.selClipId);
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.();
    }
    if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === "b" && this.selClipId) {
        if (this.selClipIds.size > 1) this._toggleDisableSelected();
        else this._toggleDisable(this.selClipId);
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.();
        return;
    }
    if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === "g" && this.selClipId) {
        this._disableOthers(this.selClipId);
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.();
        return;
    }
    if (e.ctrlKey && e.key === "c" && this.selClipId) {
        this._copyClip(this.selClipId);
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.();
        return;
    }
    if (e.ctrlKey && e.key === "v") {
        this._pasteClip();
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.();
        return;
    }
    if (e.key === "Escape") {
        this._deselectAll();
        this._hidePicker();
        removeContextMenu();
    }
}

_nudgeTrim(role, delta) {
    let { startMs, endMs } = this._getTrimMs();
    const step = this._frameMs();
    if (role === "start") startMs = clamp(startMs + delta * step, 0, endMs - step);
    else                  endMs   = clamp(endMs   + delta * step, startMs + step, this.durationMs);
    this._setTrimMs(startMs, endMs);
}

// ── mouse drag ────────────────────────────────────────────────────────────

_handleMove(e) {
    if (this._trimDrag) {
        const ms = this._waveMs(e.clientX);
        const { startMs, endMs } = this._getTrimMs();
        if (this._trimDrag === "start") this._setTrimMs(Math.min(ms, endMs - 1), endMs);
        else this._setTrimMs(startMs, Math.max(ms, startMs + 1));
    }

    if (this._dragState) {
        const { type, clipId, originMs, os, oe } = this._dragState;
        const dMs = this._tlPxToMs(e.clientX) - originMs;
        const dur = this._tlDurMs();
        const c = this.clips.find(c => c.id === clipId);
        if (!c) return;

        if ((c.track ?? 0) === 1) {
            // Overlay track: free positioning within its gap; no overlap, no packing.
            const { lo, hi } = this._subSlot(clipId, os, oe);
            if (type === "move") {
                const clipDur = oe - os;
                const ns = clamp(os + dMs, lo, Math.max(lo, hi - clipDur));
                c.startMs = ns;
                c.endMs   = ns + clipDur;
            } else {
                c.endMs = clamp(oe + dMs, c.startMs + this._frameMs(), hi);
            }
        } else if (type === "move") {
            // Main track: set raw dragged position (for sort order), then pack — no gaps allowed.
            const clipDur = oe - os;
            c.startMs = clamp(os + dMs, 0, dur);
            c.endMs   = c.startMs + clipDur;
            this._packClips();
        } else {
            c.endMs = clamp(oe + dMs, c.startMs + this._frameMs(), dur);
            this._packClips();
        }
        this._renderClips({ layoutOnly: true, animate: type === "move" && (c.track ?? 0) !== 1, dragId: clipId });
        this._renderPlayhead();
    }
}

_handleUp() {
    this._trimDrag = null;
    if (this._dragState) {
        const clipId = this._dragState.clipId;
        this._dragState = null;
        this._saveClips();
        this._renderClips();
        if (clipId === this.selClipId) this._updatePromptContext();
    }
}

// ── audio loading ─────────────────────────────────────────────────────────

_audioUrl(filename) {
    if (!filename) return null;
    let name = String(filename).replace(/\s*\[input\]\s*$/i, "").trim();
    let sub = "";
    if (name.includes("/")) {
        const i = name.lastIndexOf("/");
        sub = name.slice(0, i);
        name = name.slice(i + 1);
    }
    const p = new URLSearchParams({ filename: name, type: "input" });
    if (sub) p.set("subfolder", sub);
    return api.apiURL(`/view?${p}`);
}

_audioBufferToPeaks(buf, max = 8000) {
    const ch = Math.min(2, buf.numberOfChannels || 1);
    const peaks = [];
    for (let c = 0; c < ch; c++) {
        const d = buf.getChannelData(c);
        const chunk = Math.max(1, Math.floor(d.length / max));
        const list = [];
        for (let i = 0; i < max; i++) {
            const s = i * chunk, end = Math.min(s + chunk, d.length);
            let m = 0;
            for (let j = s; j < end; j++) { const v = Math.abs(d[j]); if (v > m) m = v; }
            list.push(m);
        }
        peaks.push(list);
    }
    if (peaks.length === 1) peaks.push(peaks[0].slice());
    return peaks;
}

async _fetchPeaks(url) {
    const r = await fetch(url, { credentials: "same-origin" });
    if (!r.ok) throw new Error(`无法加载音频 (${r.status})`);
    const ab = await r.arrayBuffer();
    const ctx = new AudioContext();
    try {
        const buf = await ctx.decodeAudioData(ab.slice(0));
        return { peaks: this._audioBufferToPeaks(buf), duration: buf.duration };
    } finally { await ctx.close(); }
}

async _loadAudio() {
    const audio = this._w("audio")?.value;
    const url = audio ? this._audioUrl(audio) : null;

    this._reloadWavePlay(url);
    this._reloadTlPlay(url);

    if (!audio || !url) {
        this.isReady = false;
        this._updWaveCtrl();
        this._updTlCtrl();
        return;
    }
    if (this._loadingAudio) return;

    this._loadingAudio = true;
    this.isReady = false;
    this.loadEl.style.display = "flex";
    this.loadEl.textContent = "加载波形…";

    try {
        this.wavesurfer?.destroy();
        this.waveEl.replaceChildren();
        this.wavesurfer = WaveSurfer.create({
            container: this.waveEl,
            height: 72,
            waveColor: "#5a9fd8",
            progressColor: "#5a9fd8",  // same as waveColor → uniform waveform
            cursorColor: "#ffd166",
            cursorWidth: 2,
            barWidth: 2, barGap: 1,
            normalize: true,
            backend: "WebAudio",
        });

        this.wavesurfer.on("ready", () => {
            this.durationMs = Math.round(this.wavesurfer.getDuration() * 1000);
            this.isReady = true;
            this.loadEl.style.display = "none";
            const fps = this.getFps();
            const ew = this._w("end_time");
            const sw = this._w("start_time");
            if (this._resetTrimOnLoad) {
                // New audio selected (possibly different duration): reset trim to full range.
                this._resetTrimOnLoad = false;
                const stc = formatTimecode(0, fps);
                const etc = formatTimecode(this.durationMs, fps);
                if (sw) sw.value = stc;
                if (ew) ew.value = etc;
                this.sIn.value = stc;
                this.eIn.value = etc;
            } else {
                if (!String(ew?.value ?? "").trim()) {
                    const tc = formatTimecode(this.durationMs, fps);
                    if (ew) ew.value = tc;
                    this.eIn.value = tc;
                }
                this.sIn.value = sw?.value || formatTimecode(0, fps);
            }
            this._renderTrim();
            this._renderTimeline();
            this._loadFromWidget();
            this._renderClips();
            this._seekWave(this._getTrimMs().startMs);
            this._updWaveCtrl();
            this._updTlCtrl();
            this._updatePromptContext();
        });

        this.wavesurfer.on("error", err => {
            console.error("[CAP_AudioTimeline]", err);
            this.loadEl.textContent = "波形加载失败";
            this.isReady = false;
        });

        // Click on waveform → seek to that position (clamped to trim) and start playback
        this.wavesurfer.on("interaction", (clickedTimeSec) => {
            if (!this._canWavePlay()) return;
            const { startMs, endMs } = this._getTrimMs();
            const ms = clamp(Math.round(clickedTimeSec * 1000), startMs, endMs - 1);
            this._seekWave(ms);  // syncs _waveAudio + wavesurfer cursor
            if (this._waveAudio.paused) {
                this._waveAudio.play().catch(() => {});
            }
        });

        const { peaks, duration } = await this._fetchPeaks(url);
        await this.wavesurfer.load(url, peaks, duration);
    } catch (err) {
        console.error("[CAP_AudioTimeline]", err);
        this.loadEl.style.display = "flex";
        this.loadEl.textContent = err instanceof Error ? err.message : "无法加载波形";
        this.isReady = false;
    } finally {
        this._loadingAudio = false;
        this._updWaveCtrl();
        this._updTlCtrl();
    }
}

// ── sync from configure ───────────────────────────────────────────────────

_syncFromConfigure(info) {
    // Restore any named properties saved by onSerialize
    const named = info?.properties?.cat_named;
    if (named) {
        for (const [k, v] of Object.entries(named)) {
            const w = this._w(k);
            if (w) w.value = v;
        }
    }
    const sw = this._w("start_time");
    if (sw?.value) this.sIn.value = sw.value;
    const ew = this._w("end_time");
    if (ew?.value) this.eIn.value = ew.value;
    this._loadFromWidget();
    if (this.isReady) { this._renderTimeline(); }
    this._updatePromptContext();

    // onConfigure runs after widget values are restored by LiteGraph, but the
    // constructor's _loadAudio() ran before that — so audio was empty then.
    // Re-trigger loading now that the audio widget has its saved value.
    const audio = this._w("audio")?.value;
    if (audio && !this.isReady && !this._loadingAudio) {
        this._lastAudio = audio;
        const url = this._audioUrl(audio);
        this._reloadWavePlay(url);
        this._reloadTlPlay(url);
        clearTimeout(this._loadTimer);
        this._loadTimer = setTimeout(() => this._loadAudio(), 120);
    }

    // Also refresh assets_dir if set
    if (this._dir()) this._scheduleDir();
}

// ── destroy ───────────────────────────────────────────────────────────────

destroy() {
    if (CapAudioTimelineUI._lastActive === this) CapAudioTimelineUI._lastActive = null;
    this._resizeObs?.disconnect();
    this._resizeObs = null;
    this._clipElMap.clear();
    detachRichPromptHandler(this.promptInput);
    window.removeEventListener("mousemove", this._onMove);
    window.removeEventListener("mouseup", this._onUp);
    window.removeEventListener("dragend", this._onDragEnd);
    clearTimeout(this._loadTimer);
    clearTimeout(this._dirTimer);
    this._waveAudio?.pause();
    this._waveAudio?.removeAttribute?.("src");
    this._tlAudio?.pause();
    this._tlAudio?.removeAttribute?.("src");
    this.wavesurfer?.destroy();
    removeContextMenu();
}

// ═════════════════════════════════════════════════════════════════════════════
}
