import { api } from "../../scripts/api.js";
import WaveSurfer from "./wavesurfer.esm.js";
import { clamp, formatTimecode, parseTimecode, segmentFrameCount } from "./timecode.js";

const EXT_PREFIX = "ComfyUI-Capricorncd-Tools";

function uid() {
    return `cl_${Math.random().toString(36).slice(2, 9)}`;
}

function loadCss() {
    if (document.getElementById("cat-styles")) return;
    const link = document.createElement("link");
    link.id = "cat-styles";
    link.rel = "stylesheet";
    link.href = `/extensions/${EXT_PREFIX}/cap_audio_timeline.css`;
    document.head.appendChild(link);
}

// ── helpers ──────────────────────────────────────────────────────────────────

function removeContextMenu() {
    document.querySelector(".cat-ctx-menu")?.remove();
}

// ═════════════════════════════════════════════════════════════════════════════
export class CapAudioTimelineUI {
// ═════════════════════════════════════════════════════════════════════════════

constructor(node) {
    this.node = node;

    // waveform
    this.durationMs = 0;
    this.wavesurfer = null;
    this.isReady = false;
    this._loadingAudio = false;
    this._lastAudio = null;
    this._loadTimer = null;
    this._suppress = false;
    this._waveAudio = null;
    this._waveReady = false;
    this._waveUrl = null;
    this._trimDrag = null;   // 'start'|'end'
    this._selTrim = null;    // 'start'|'end'|null

    // timeline
    this.clips = [];
    this.selClipId = null;
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
    this._initWavePlay();
    this._initTlPlay();
    this._loadFromWidget();
    const dir = this._w("keyframe_dir")?.value;
    if (dir) this._scheduleDir();
}

// ── widget access ─────────────────────────────────────────────────────────

_w(name) { return this.node.widgets?.find(w => w.name === name); }
getFps()  { return Math.max(1, parseInt(this._w("fps")?.value ?? 24, 10) || 24); }
getOneShot() { return !!this._w("one_shot")?.value; }
_dir()    { return String(this._w("keyframe_dir")?.value ?? "").trim(); }
_frameMs(){ return Math.max(1, Math.round(1000 / this.getFps())); }

// ── DOM build ─────────────────────────────────────────────────────────────

_buildDom() {
    const root = document.createElement("div");
    root.className = "cat-root";
    root.tabIndex = -1;
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
          <button class="cat-addclip" disabled>＋ 添加图片</button>
        </div>
        <div class="cat-tl-body">
          <div class="cat-tl-scroll">
            <div class="cat-tl-inner">
              <div class="cat-ruler"></div>
              <div class="cat-tl-tracks">
                <div class="cat-clip-track"></div>
              </div>
              <div class="cat-playhead"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="cat-prompt-section">
        <div class="cat-prompt-label">关键帧提示词</div>
        <textarea class="cat-prompt-input" placeholder="选择素材后输入提示词…" rows="3" disabled></textarea>
      </div>

      <div class="cat-picker" style="display:none">
        <div class="cat-picker-hd">
          <span class="cat-picker-title">选择图片</span>
          <button class="cat-picker-refresh" title="刷新图片列表">↻</button>
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
    this.hdlS     = root.querySelector(".cat-hs");
    this.hdlE     = root.querySelector(".cat-he");
    this.wPlayBtn = root.querySelector(".cat-wplay");
    this.wTimeEl  = root.querySelector(".cat-wtime");

    this.tPlayBtn   = root.querySelector(".cat-tplay");
    this.tTimeEl    = root.querySelector(".cat-ttime");
    this.tDurEl     = root.querySelector(".cat-tdur");
    this.addClipBtn = root.querySelector(".cat-addclip");
    this.tlScroll   = root.querySelector(".cat-tl-scroll");
    this.tlInner    = root.querySelector(".cat-tl-inner");
    this.rulerEl    = root.querySelector(".cat-ruler");
    this.clipTrack  = root.querySelector(".cat-clip-track");
    this.playheadEl = root.querySelector(".cat-playhead");

    this.promptLabel = root.querySelector(".cat-prompt-label");
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
        getMinHeight: () => 440,
        getHeight: () => 440,
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
        const layout = baseLayoutSize?.(node) ?? { minHeight: 440, minWidth: 0 };
        // Fixed absolute minimum — do not tie to current node width (blocks user shrink).
        return { ...layout, minHeight: 440, minWidth: 480 };
    };

    node.setSize([
        Math.max(node.size[0], 480),
        Math.max(node.size[1], 440),
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
            clearTimeout(this._loadTimer);
            this._loadTimer = setTimeout(() => this._loadAudio(), 80);
        };
    }

    for (const name of ["fps", "one_shot"]) {
        const w = this._w(name);
        if (!w) continue;
        const orig = w.callback;
        w.callback = v => { orig?.(v); this._renderTimeline(); };
    }

    const dirW = this._w("keyframe_dir");
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

    // waveform background click → deselect trim
    this.waveWrap.addEventListener("mousedown", e => {
        if (!e.target.classList.contains("cat-hdl")) {
            this._selTrim = null;
            this._updateTrimUI();
        }
    });

    // playback buttons
    this.wPlayBtn.addEventListener("click", () => this._toggleWavePlay());
    this.tPlayBtn.addEventListener("click", () => this._toggleTlPlay());

    // add clip button
    this.addClipBtn.addEventListener("click", () => this._showAddClipPicker());

    // timeline click → set playhead (not on clips)
    this.tlScroll.addEventListener("click", e => {
        if (e.target.closest(".cat-clip")) return;
        const ms = this._tlPxToMs(e.clientX);
        this._setPlayhead(clamp(ms, 0, this._tlDurMs()));
        this.selClipId = null;
        this._renderClips();
        this._updatePromptContext();
    });

    // double-click clip track → add clip at position
    this.clipTrack.addEventListener("dblclick", e => {
        if (e.target.closest(".cat-clip")) return;
        const ms = this._tlPxToMs(e.clientX);
        this._addClip(ms);
    });

    // clip track context menu
    this.clipTrack.addEventListener("contextmenu", e => {
        e.preventDefault();
        e.stopPropagation();
        const clipEl = e.target.closest(".cat-clip");
        if (clipEl) this._showContextMenu(clipEl.dataset.id, e);
        else removeContextMenu();
    });

    // prompt input
    this.promptInput.addEventListener("input", () => this._onPromptChange());
    this.promptInput.addEventListener("keydown", e => e.stopPropagation()); // don't leak to canvas

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
        this._seekWave(this._getTrimMs().endMs);
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
}

_onWaveTick() {
    if (!this._waveAudio) return;
    const { endMs } = this._getTrimMs();
    const ms = Math.round(this._waveAudio.currentTime * 1000);
    if (ms >= endMs) { this._waveAudio.pause(); this._seekWave(endMs); return; }
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
    this._tlAudio.addEventListener("ended",  () => this._stopTlPlay());
    this._tlAudio.addEventListener("pause",  () => { this.tPlayBtn.textContent = "▶"; });
    this._tlAudio.addEventListener("play",   () => { this.tPlayBtn.textContent = "⏸"; });
}

_canTlPlay() { return this._tlReady && this.isReady; }

_updTlCtrl() {
    this.tPlayBtn.disabled = !this._canTlPlay();
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
    if (rel >= this._tlDurMs()) { this._stopTlPlay(); return; }
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

_renderClips({ layoutOnly = false, animate = false, dragId = null } = {}) {
    if (!layoutOnly) {
        this.clipTrack.replaceChildren();
        this._clipElMap.clear();
        const sorted = [...this.clips].sort((a, b) => a.startMs - b.startMs);
        for (const clip of sorted) {
            const el = this._createClipElement(clip);
            this._clipElMap.set(clip.id, el);
            this.clipTrack.appendChild(el);
        }
    }
    this._layoutClips({ animate, dragId });
}

_createClipElement(clip) {
    const el = document.createElement("div");
    el.className = "cat-clip";
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
        this._selectClip(clip.id);
        this._dragState = {
            type: "move", clipId: clip.id,
            originMs: this._tlPxToMs(e.clientX),
            os: clip.startMs, oe: clip.endMs,
        };
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
            this.clipTrack.appendChild(el);
        }

        const left = clip.startMs * pxPerMs;
        const width = Math.max(4, (clip.endMs - clip.startMs) * pxPerMs);
        const isDragged = dragId != null && clip.id === dragId;

        el.classList.toggle("selected", clip.id === this.selClipId);
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

        this.clipTrack.appendChild(el);
    }
}

_renderPlayhead() {
    this.playheadEl.style.left = `${this._tlMsToPx(this.playheadMs)}px`;
}

// ── clip operations ───────────────────────────────────────────────────────

_selectClip(id) {
    this.selClipId = id;
    this._selTrim = null;
    this._updateTrimUI();
    this._renderClips();
    this._updatePromptContext();
    this.node.setDirtyCanvas(true, true);
}

_deselectAll() {
    this.selClipId = null;
    this._selTrim = null;
    this._updateTrimUI();
    this._renderClips();
    this._updatePromptContext();
}

_addClip(startMs, startImage = null) {
    const defaultDur = Math.min(2000, Math.round(this._tlDurMs() / 4));
    // Use startMs only for ordering; _packClips will assign the actual position.
    const clip = { id: uid(), startMs, endMs: startMs + defaultDur, startImage, endImage: null, prompt: "" };
    this.clips.push(clip);
    this._packClips();
    this._selectClip(clip.id);
    this._saveClips();
}

_deleteClip(id) {
    this.clips = this.clips.filter(c => c.id !== id);
    if (this.selClipId === id) { this.selClipId = null; this._updatePromptContext(); }
    this._packClips();
    this._saveClips();
    this._renderClips();
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
    this._packClips();
    this._saveClips();
    this._renderClips();
    if (id === this.selClipId) this._updatePromptContext();
}

_trimRight(id) {
    const c = this.clips.find(c => c.id === id);
    if (!c || this.playheadMs <= c.startMs || this.playheadMs >= c.endMs) return;
    c.endMs = this.playheadMs;
    this._packClips();
    this._saveClips();
    this._renderClips();
    if (id === this.selClipId) this._updatePromptContext();
}

_copyClip(id) {
    const c = this.clips.find(c => c.id === id);
    if (!c) return;
    this._clipboard = { ...c, id: null, durationMs: c.endMs - c.startMs };
}

_pasteClip() {
    if (!this._clipboard) return;
    const sorted = [...this.clips].sort((a, b) => a.startMs - b.startMs);
    const last = sorted[sorted.length - 1];
    const s = last ? last.endMs : 0;
    const clip = { ...this._clipboard, id: uid(), startMs: s, endMs: s + this._clipboard.durationMs };
    this.clips.push(clip);
    this._packClips();
    this._selectClip(clip.id);
    this._saveClips();
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

// Sort all clips by startMs and pack them contiguously from 0, preserving durations.
_packClips() {
    if (!this.clips.length) return;
    this.clips.sort((a, b) => a.startMs - b.startMs);
    let cursor = 0;
    for (const c of this.clips) {
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
        this.promptLabel.textContent = `关键帧提示词 · ${start}~${end}`;
        this.promptLabel.classList.add("clip-mode");
        this.promptInput.classList.add("clip-mode");
        this.promptInput.value = clip.prompt ?? "";
        this.promptInput.disabled = false;
    } else {
        this.promptLabel.textContent = "关键帧提示词";
        this.promptLabel.classList.remove("clip-mode");
        this.promptInput.classList.remove("clip-mode");
        this.promptInput.value = "";
        this.promptInput.disabled = true;
    }
}

_onPromptChange() {
    const clip = this.clips.find(c => c.id === this.selClipId);
    if (!clip) return;
    clip.prompt = this.promptInput.value;
    this._saveClips();
    this._renderClips();
}

// ── context menu ──────────────────────────────────────────────────────────

_showContextMenu(clipId, e) {
    removeContextMenu();
    const clip = this.clips.find(c => c.id === clipId);
    if (!clip) return;

    const menu = document.createElement("div");
    menu.className = "cat-ctx-menu";
    menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:9999`;

    const items = [
        { label: "替换素材",       fn: () => this._openPicker(clipId, "startImage", "替换素材") },
        { label: "选择尾帧图片",   fn: () => this._openPicker(clipId, "endImage", "选择尾帧图片") },
        { label: "删除",           fn: () => this._deleteClip(clipId) },
        { label: "复制",           fn: () => this._copyClip(clipId) },
    ];
    if (clip.endImage) items.push({ label: "清除尾帧图片", fn: () => this._updateClip(clipId, { endImage: null }) });

    for (const { label, fn } of items) {
        const div = document.createElement("div");
        div.className = "cat-ctx-item";
        div.textContent = label;
        div.addEventListener("click", () => { fn(); removeContextMenu(); });
        menu.appendChild(div);
    }
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener("click", removeContextMenu, { once: true }), 0);
}

// ── frame preview (badge hover) ───────────────────────────────────────────

_showFramePreview(clip, badgeEl) {
    const fp = this.framePreview;
    fp.replaceChildren();

    const makeImg = (src) => {
        const img = document.createElement("img");
        img.src = `/audio_keyframe_timeline/keyframe_image?dir=${encodeURIComponent(this._getKeyframeDir())}&name=${encodeURIComponent(src)}`;
        img.style.cssText = "height:100%;width:auto;display:block;border-radius:3px;";
        return img;
    };

    if (clip.startImage) fp.appendChild(makeImg(clip.startImage));
    if (clip.endImage) fp.appendChild(makeImg(clip.endImage));

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
}

_getKeyframeDir() {
    return this.node.widgets?.find(w => w.name === "keyframe_dir")?.value ?? "";
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
        msg.textContent = this._dir() ? "目录中无图片" : "请先设置 keyframe_dir";
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
        item.append(img, nm);
        item.addEventListener("click", () => {
            if (!this._pickerCtx) return;
            if (this._pickerCtx.mode === "add") {
                this._addClip(this._pickerCtx.atMs, file);
            } else {
                const { clipId, field } = this._pickerCtx;
                this._updateClip(clipId, { [field]: file });
            }
            this._hidePicker();
        });
        this.pickerGrid.appendChild(item);
    }
}

_showAddClipPicker(atMs = this.playheadMs) {
    this._pickerCtx = { mode: "add", atMs };
    this.pickerTitle.textContent = "添加图片";
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

// ── persistence ───────────────────────────────────────────────────────────

_saveClips() {
    const w = this._w("clips_json");
    if (!w) return;
    w.value = JSON.stringify(this.clips.map(c => ({
        start_ms: c.startMs, end_ms: c.endMs,
        start_image: c.startImage ?? null,
        end_image: c.endImage ?? null,
        prompt: c.prompt ?? "",
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
            }));
        }
    } catch {}
}

// ── keyboard ──────────────────────────────────────────────────────────────

_onKeyDown(e) {
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

    if ((e.key === "Delete" || e.key === "Backspace") && this.selClipId) {
        this._deleteClip(this.selClipId);
        e.preventDefault(); e.stopImmediatePropagation?.();
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
    if (e.ctrlKey && e.key === "c" && this.selClipId) {
        this._copyClip(this.selClipId);
        e.preventDefault();
    }
    if (e.ctrlKey && e.key === "v") {
        this._pasteClip();
        e.preventDefault();
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

        if (type === "move") {
            // Set raw dragged position (for sort order), then pack — no gaps allowed.
            const clipDur = oe - os;
            c.startMs = clamp(os + dMs, 0, dur);
            c.endMs   = c.startMs + clipDur;
            this._packClips();
        } else {
            c.endMs = clamp(oe + dMs, c.startMs + this._frameMs(), dur);
            this._packClips();
        }
        this._renderClips({ layoutOnly: true, animate: type === "move", dragId: clipId });
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
            waveColor: "#4a6fa5",
            progressColor: "#8ab4ff",
            cursorColor: "#ffd166",
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
            if (!String(ew?.value ?? "").trim()) {
                const tc = formatTimecode(this.durationMs, fps);
                if (ew) ew.value = tc;
                this.eIn.value = tc;
            }
            const sw = this._w("start_time");
            this.sIn.value = sw?.value || formatTimecode(0, fps);
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

    // Also refresh keyframe_dir if set
    if (this._dir()) this._scheduleDir();
}

// ── destroy ───────────────────────────────────────────────────────────────

destroy() {
    this._resizeObs?.disconnect();
    this._resizeObs = null;
    this._clipElMap.clear();
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
