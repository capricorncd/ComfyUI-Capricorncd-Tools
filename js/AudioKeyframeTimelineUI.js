import { api } from "../../scripts/api.js";
import WaveSurfer from "./wavesurfer.esm.js";
import {
    clamp,
    formatTimecode,
    parseKeyframesJson,
    parseTimecode,
    segmentFrameCount,
} from "./timecode.js";

const EXT_PREFIX = "ComfyUI-Capricorncd-Tools";

function loadStylesheet() {
    if (document.getElementById("aktl-styles")) return;
    const link = document.createElement("link");
    link.id = "aktl-styles";
    link.rel = "stylesheet";
    link.href = `/extensions/${EXT_PREFIX}/audio_keyframe_timeline.css`;
    document.head.appendChild(link);
}

function makeId() {
    return `kf_${Math.random().toString(36).slice(2, 10)}`;
}

export class AudioKeyframeTimelineUI {
    constructor(node) {
        this.node = node;
        this.durationMs = 0;
        this.keyframes = [];
        this.selectedId = null;
        /** @type {null | 'start' | 'end'} */
        this.selectedTrim = null;
        this.keyframeFiles = [];
        this.keyframeFilesSource = [];
        this.wavesurfer = null;
        this.isReady = false;
        this._suppressWidgetSync = false;
        this._drag = null;
        this._loadingAudio = false;
        this._lastAudioFile = null;
        this._loadAudioTimer = null;
        this._keyframeDirTimer = null;
        this.playbackAudio = null;
        this._playbackReady = false;
        this._playbackUrl = null;
        this._lastPreviewAnchorIndex = null;
        this._lastPreviewClientX = null;

        loadStylesheet();
        this.root = this._buildDom();
        this._applyIntDefaults();
        this._bindNodeWidgets();
        this._attachDomWidget();
        this._bindEvents();
        this._initPlayback();
        this._syncTimeInputsFromWidgets();
        if (this.getKeyframeDir()) {
            this._scheduleKeyframeDirRefresh();
        }
        this._loadAudioFromWidget();
    }

    findWidget(name) {
        return this.node.widgets?.find((w) => w.name === name);
    }

    _applyIntDefaults() {
        const specs = { fps: 24, width: 720, height: 1280 };
        for (const [name, def] of Object.entries(specs)) {
            const w = this.findWidget(name);
            if (!w || w.type !== "number") continue;
            const n = Number(w.value);
            if (!Number.isFinite(n) || n <= 0) w.value = def;
        }
    }

    getFps() {
        const w = this.findWidget("fps");
        return Math.max(1, parseInt(w?.value ?? 24, 10) || 24);
    }

    getOneShot(explicit) {
        if (explicit !== undefined) return !!explicit;
        return !!this.findWidget("one_shot")?.value;
    }

    getKeyframeDir() {
        return String(this.findWidget("keyframe_dir")?.value ?? "").trim();
    }

    _buildDom() {
        const container = document.createElement("div");
        container.className = "aktl-root";
        container.tabIndex = -1;
        container.innerHTML = `
            <div class="aktl-time-row">
                <label>起 (start)
                    <input type="text" class="aktl-start-input" placeholder="00:00.00" />
                </label>
                <label>止 (end)
                    <input type="text" class="aktl-end-input" placeholder="00:00.00" />
                </label>
            </div>
            <div class="aktl-hint">双击波形添加关键帧；选中关键帧或起止滑块后 ←/→ 逐帧移动；悬停三角指针显示缩略图</div>
            <div class="aktl-wave-wrap">
                <div class="aktl-loading">选择音频文件以加载波形…</div>
                <div class="aktl-wave"></div>
                <div class="aktl-overlay">
                    <div class="aktl-trim-shade aktl-shade-left"></div>
                    <div class="aktl-trim-active"></div>
                    <div class="aktl-trim-shade aktl-shade-right"></div>
                    <div class="aktl-handle aktl-handle-start"></div>
                    <div class="aktl-handle aktl-handle-end"></div>
                    <div class="aktl-markers"></div>
                </div>
            </div>
            <div class="aktl-preview" style="display:none"></div>
            <div class="aktl-playback">
                <button type="button" class="aktl-play-btn" disabled title="播放 / 暂停">▶</button>
                <span class="aktl-playback-time" aria-live="polite">00:00.00</span>
                <span class="aktl-playback-hint">未选择音频</span>
            </div>
        `;

        this.startInput = container.querySelector(".aktl-start-input");
        this.endInput = container.querySelector(".aktl-end-input");
        this.loadingEl = container.querySelector(".aktl-loading");
        this.waveEl = container.querySelector(".aktl-wave");
        this.shadeLeft = container.querySelector(".aktl-shade-left");
        this.shadeRight = container.querySelector(".aktl-shade-right");
        this.trimActive = container.querySelector(".aktl-trim-active");
        this.handleStart = container.querySelector(".aktl-handle-start");
        this.handleEnd = container.querySelector(".aktl-handle-end");
        this.markersEl = container.querySelector(".aktl-markers");
        this.previewEl = container.querySelector(".aktl-preview");
        this.waveWrap = container.querySelector(".aktl-wave-wrap");
        this.rootEl = container;
        this.playbackBar = container.querySelector(".aktl-playback");
        this.playBtn = container.querySelector(".aktl-play-btn");
        this.playbackTimeEl = container.querySelector(".aktl-playback-time");
        this.playbackHintEl = container.querySelector(".aktl-playback-hint");

        return container;
    }

    _attachDomWidget() {
        const widget = this.node.addDOMWidget("timeline_ui", "aktl_timeline", this.root, {
            hideOnZoom: false,
            getMinHeight: () => 240,
            getHeight: () => 240,
        });
        widget.serialize = false;

        this.node.setSize([Math.max(this.node.size[0], 420), this.node.size[1]]);
        this.domWidget = widget;
    }

    _syncTimeInputsFromWidgets() {
        const fps = this.getFps();
        const startW = this.findWidget("start_time");
        const endW = this.findWidget("end_time");
        if (startW?.value) this.startInput.value = startW.value;
        else this.startInput.value = formatTimecode(0, fps);
        if (endW?.value) this.endInput.value = endW.value;
    }

    _bindNodeWidgets() {
        const syncFromWidgets = () => {
            if (this._suppressWidgetSync || !this.isReady) return;
            this._suppressWidgetSync = true;
            try {
                const fps = this.getFps();
                const startMs = parseTimecode(
                    this.findWidget("start_time")?.value,
                    fps
                );
                const endMs = parseTimecode(
                    this.findWidget("end_time")?.value,
                    fps
                );
                this.startInput.value = formatTimecode(startMs, fps);
                this.endInput.value = formatTimecode(endMs, fps);
                this._setTrimMs(startMs, endMs, false);
                const times = parseKeyframesJson(
                    this.findWidget("keyframes_ms")?.value
                );
                this._setKeyframesFromMs(times, false);
            } catch {
                /* ignore while typing */
            } finally {
                this._suppressWidgetSync = false;
            }
        };

        for (const name of ["fps", "one_shot", "keyframe_dir"]) {
            const w = this.findWidget(name);
            if (!w) continue;
            const orig = w.callback;
            w.callback = (v) => {
                orig?.(v);
                if (name === "fps") this._updatePlaybackTimeDisplay();
                if (name === "keyframe_dir") this._onKeyframeDirChanged();
                if (name === "one_shot") {
                    this._onOneShotChanged(!!v);
                }
                this.node.setDirtyCanvas(true, true);
            };
            if (name === "keyframe_dir") {
                const inputEl = w.inputEl ?? w.element;
                if (inputEl && !inputEl._aktlDirBound) {
                    inputEl._aktlDirBound = true;
                    inputEl.addEventListener("change", () => this._onKeyframeDirChanged());
                    inputEl.addEventListener("blur", () => this._onKeyframeDirChanged());
                }
            }
            if (name === "one_shot" && !w._aktlOneShotBound) {
                w._aktlOneShotBound = true;
                const el = w.inputEl ?? w.element;
                if (el) {
                    el.addEventListener("change", () =>
                        this._onOneShotChanged(this.getOneShot())
                    );
                }
            }
        }

        for (const name of ["start_time", "end_time", "keyframes_ms"]) {
            const w = this.findWidget(name);
            if (!w) continue;
            const orig = w.callback;
            w.callback = (v) => {
                orig?.(v);
                syncFromWidgets();
            };
        }

        const audioW = this.findWidget("audio");
        if (audioW) {
            const orig = audioW.callback;
            audioW.callback = (v) => {
                orig?.(v);
                const url = v ? this._audioViewUrl(v) : null;
                this._reloadPlaybackSource(url);
                if (v === this._lastAudioFile) return;
                this._lastAudioFile = v;
                clearTimeout(this._loadAudioTimer);
                this._loadAudioTimer = setTimeout(
                    () => this._loadAudioFromWidget(),
                    80
                );
            };
        }
    }

    _bindEvents() {
        this.startInput.addEventListener("change", () => this._onTimeInput());
        this.endInput.addEventListener("change", () => this._onTimeInput());
        this.startInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") this._onTimeInput();
        });
        this.endInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") this._onTimeInput();
        });

        this.handleStart.addEventListener("mousedown", (e) => {
            e.stopPropagation();
            this._selectTrim("start");
            this._beginDrag(e, "trim-start");
        });
        this.handleEnd.addEventListener("mousedown", (e) => {
            e.stopPropagation();
            this._selectTrim("end");
            this._beginDrag(e, "trim-end");
        });

        this.waveWrap.addEventListener("dblclick", (e) => this._onWaveDblClick(e));

        this.root.addEventListener("contextmenu", (e) => {
            if (this.selectedId) {
                e.preventDefault();
                e.stopPropagation();
                this._deleteSelected();
            }
        });

        this._moveHandler = (e) => this._onDragMove(e);
        this._upHandler = () => this._endDrag();
        window.addEventListener("mousemove", this._moveHandler);
        window.addEventListener("mouseup", this._upHandler);
    }

    _initPlayback() {
        this.playbackAudio = new Audio();
        this.playbackAudio.preload = "auto";

        this.playbackAudio.addEventListener("loadedmetadata", () => {
            this._playbackReady = true;
            this._seekPlaybackToTrimStart(false);
            this._updatePlaybackControlsState();
        });
        this.playbackAudio.addEventListener("error", () => {
            this._playbackReady = false;
            this._setPlayingUi(false);
            this._updatePlaybackControlsState();
        });
        this.playbackAudio.addEventListener("timeupdate", () =>
            this._onPlaybackTimeUpdate()
        );
        this.playbackAudio.addEventListener("ended", () => {
            this._setPlayingUi(false);
            this._clampPlaybackToTrimEnd();
            this._updatePlaybackTimeDisplay();
        });
        this.playbackAudio.addEventListener("pause", () => this._setPlayingUi(false));
        this.playbackAudio.addEventListener("play", () => this._setPlayingUi(true));

        this.playBtn.addEventListener("click", () => this._togglePlayback());

        this._updatePlaybackControlsState();
    }

    _getSelectedAudioName() {
        const v = this.findWidget("audio")?.value;
        return v ? String(v).replace(/\s*\[input\]\s*$/i, "").trim() : "";
    }

    _canUsePlayback() {
        return (
            !!this._getSelectedAudioName() &&
            !!this._playbackUrl &&
            this._playbackReady &&
            this.isReady &&
            !this._loadingAudio
        );
    }

    _updatePlaybackControlsState() {
        const canPlay = this._canUsePlayback();
        this.playBtn.disabled = !canPlay;
        this.playbackBar?.classList.toggle("aktl-playback--disabled", !canPlay);

        if (!this._getSelectedAudioName()) {
            this.playbackHintEl.textContent = "未选择音频";
        } else if (!this._playbackUrl) {
            this.playbackHintEl.textContent = "音频路径无效";
        } else if (this._loadingAudio) {
            this.playbackHintEl.textContent = "加载中…";
        } else if (!this._playbackReady || !this.isReady) {
            this.playbackHintEl.textContent = "音频不可用或不存在";
        } else {
            const { startMs, endMs } = this._getTrimMs();
            const fps = this.getFps();
            this.playbackHintEl.textContent = `${formatTimecode(startMs, fps)} — ${formatTimecode(endMs, fps)}`;
        }

        if (!canPlay) {
            this._setPlayingUi(false);
        }
    }

    _setPlayingUi(playing) {
        if (!this.playBtn) return;
        this.playBtn.textContent = playing ? "⏸" : "▶";
        this.playBtn.classList.toggle("aktl-play-btn--playing", playing);
    }

    _getPlaybackPositionMs() {
        if (!this.playbackAudio) return 0;
        return Math.round(this.playbackAudio.currentTime * 1000);
    }

    _updatePlaybackTimeDisplay() {
        if (!this.playbackTimeEl) return;
        const fps = this.getFps();
        const ms = this._canUsePlayback()
            ? this._getPlaybackPositionMs()
            : 0;
        this.playbackTimeEl.textContent = formatTimecode(ms, fps);
    }

    _syncWavesurferCursor() {
        if (!this.wavesurfer || !this.isReady) return;
        const sec = this.playbackAudio?.currentTime ?? 0;
        try {
            this.wavesurfer.setTime(sec);
        } catch {
            /* ignore */
        }
    }

    _seekPlaybackToTrimStart(updateDisplay = true) {
        if (!this.playbackAudio || !this._playbackReady) return;
        const { startMs } = this._getTrimMs();
        this.playbackAudio.currentTime = startMs / 1000;
        if (updateDisplay) {
            this._updatePlaybackTimeDisplay();
            this._syncWavesurferCursor();
        }
    }

    _clampPlaybackToTrimEnd() {
        if (!this.playbackAudio) return;
        const { endMs } = this._getTrimMs();
        const endSec = endMs / 1000;
        if (this.playbackAudio.currentTime > endSec) {
            this.playbackAudio.currentTime = endSec;
        }
    }

    _onPlaybackTimeUpdate() {
        if (!this.playbackAudio) return;
        const { startMs, endMs } = this._getTrimMs();
        const ms = this._getPlaybackPositionMs();

        if (ms < startMs) {
            this.playbackAudio.currentTime = startMs / 1000;
        } else if (ms >= endMs) {
            this.playbackAudio.pause();
            this.playbackAudio.currentTime = endMs / 1000;
            this._setPlayingUi(false);
        }

        this._updatePlaybackTimeDisplay();
        this._syncWavesurferCursor();
    }

    _stopPlayback() {
        if (!this.playbackAudio) return;
        this.playbackAudio.pause();
        this._setPlayingUi(false);
    }

    async _togglePlayback() {
        if (!this._canUsePlayback()) return;

        if (!this.playbackAudio.paused) {
            this._stopPlayback();
            return;
        }

        const { startMs, endMs } = this._getTrimMs();
        let ms = this._getPlaybackPositionMs();
        if (ms < startMs || ms >= endMs) {
            this.playbackAudio.currentTime = startMs / 1000;
        }

        try {
            await this.playbackAudio.play();
            this._setPlayingUi(true);
        } catch (err) {
            console.warn("[AudioKeyframeTimeline] playback failed", err);
            this._setPlayingUi(false);
        }
    }

    _reloadPlaybackSource(url) {
        this._stopPlayback();
        this._playbackReady = false;
        this._playbackUrl = url || null;

        if (!this.playbackAudio) return;

        if (!url) {
            this.playbackAudio.removeAttribute("src");
            this._updatePlaybackTimeDisplay();
            this._updatePlaybackControlsState();
            return;
        }

        this.playbackAudio.src = url;
        this.playbackAudio.load();
        this._updatePlaybackControlsState();
    }

    _onPlaybackTrimChanged() {
        if (!this.playbackAudio || !this._playbackReady) {
            this._updatePlaybackControlsState();
            return;
        }
        const { startMs, endMs } = this._getTrimMs();
        const ms = this._getPlaybackPositionMs();
        if (ms < startMs) {
            this._seekPlaybackToTrimStart();
        } else if (ms > endMs) {
            this.playbackAudio.currentTime = endMs / 1000;
            this._stopPlayback();
            this._updatePlaybackTimeDisplay();
            this._syncWavesurferCursor();
        }
        this._updatePlaybackControlsState();
    }

    destroy() {
        window.removeEventListener("mousemove", this._moveHandler);
        window.removeEventListener("mouseup", this._upHandler);
        clearTimeout(this._loadAudioTimer);
        clearTimeout(this._keyframeDirTimer);
        this._stopPlayback();
        this.playbackAudio?.removeAttribute("src");
        this.playbackAudio = null;
        this.wavesurfer?.destroy();
    }

    _getTrimMs() {
        const fps = this.getFps();
        const startW = this.findWidget("start_time");
        const endW = this.findWidget("end_time");
        const startMs = parseTimecode(startW?.value ?? "00:00.00", fps);
        let endMs;
        try {
            endMs = parseTimecode(endW?.value ?? formatTimecode(this.durationMs, fps), fps);
        } catch {
            endMs = this.durationMs;
        }
        return {
            startMs: clamp(startMs, 0, this.durationMs),
            endMs: clamp(endMs, 0, this.durationMs),
        };
    }

    _frameStepMs() {
        const fps = this.getFps();
        return Math.max(1, Math.round(1000 / fps));
    }

    _msToFrameIndex(ms) {
        const fps = this.getFps();
        return Math.round((Math.max(0, ms) * fps) / 1000);
    }

    _frameIndexToMs(frameIndex) {
        const fps = this.getFps();
        return Math.round((Math.max(0, frameIndex) * 1000) / fps);
    }

    _nudgeMsByFrames(ms, deltaFrames) {
        return this._frameIndexToMs(this._msToFrameIndex(ms) + deltaFrames);
    }

    _selectTrim(role) {
        this.selectedTrim = role;
        const boundary = this.keyframes.find((k) => k.boundaryRole === role);
        this.selectedId = boundary?.id ?? null;
        this._updateTrimHandleSelectedUi();
        this._renderMarkers();
        this.root?.focus({ preventScroll: true });
        this.node.setDirtyCanvas(true, true);
    }

    _selectUserKeyframe(kf) {
        if (!kf || kf.boundaryRole) return;
        this._clearTrimSelection();
        this.selectedId = kf.id;
        this._renderMarkers();
        this.root?.focus({ preventScroll: true });
        this.node.setDirtyCanvas(true, true);
    }

    /** @returns {boolean} */
    handleArrowKey(deltaFrames) {
        if (!this.isReady) return false;
        if (this.selectedTrim) {
            this._nudgeTrimByFrames(this.selectedTrim, deltaFrames);
            return true;
        }
        const kf = this.keyframes.find((k) => k.id === this.selectedId);
        if (kf && !kf.boundaryRole) {
            this._nudgeKeyframeByFrames(kf, deltaFrames);
            return true;
        }
        return false;
    }

    /** @returns {boolean} */
    handleDeleteKey() {
        if (!this.selectedId || this.selectedTrim) return false;
        const kf = this.keyframes.find((k) => k.id === this.selectedId);
        if (!kf || kf.boundaryRole) return false;
        this._deleteSelected();
        return true;
    }

    _clearTrimSelection() {
        this.selectedTrim = null;
        this._updateTrimHandleSelectedUi();
    }

    _updateTrimHandleSelectedUi() {
        this.handleStart?.classList.toggle(
            "selected",
            this.selectedTrim === "start"
        );
        this.handleEnd?.classList.toggle("selected", this.selectedTrim === "end");
    }

    _nudgeTrimByFrames(role, deltaFrames) {
        if (!this.isReady) return;
        let { startMs, endMs } = this._getTrimMs();
        const minGap = this._frameStepMs();

        if (role === "start") {
            startMs = this._nudgeMsByFrames(startMs, deltaFrames);
            startMs = clamp(startMs, 0, Math.max(0, endMs - minGap));
        } else {
            endMs = this._nudgeMsByFrames(endMs, deltaFrames);
            endMs = clamp(
                endMs,
                Math.min(this.durationMs, startMs + minGap),
                this.durationMs
            );
        }

        this._setTrimMs(startMs, endMs, true, true);
        this._selectTrim(role);
        if (this.playbackAudio && this._playbackReady) {
            const t =
                role === "start" ? startMs / 1000 : endMs / 1000;
            this.playbackAudio.currentTime = t;
            this._updatePlaybackTimeDisplay();
            this._syncWavesurferCursor();
        }
    }

    _nudgeKeyframeByFrames(kf, deltaFrames) {
        if (!this.isReady || !kf) return;
        const sorted = this._sortedKeyframesInRange();
        const idx = sorted.findIndex((k) => k.id === kf.id);
        if (idx < 0) return;

        const { startMs, endMs } = this._getTrimMs();
        const minGap = 1;
        const prev = sorted[idx - 1];
        const next = sorted[idx + 1];

        let ms = this._nudgeMsByFrames(kf.ms, deltaFrames);
        const lo = prev ? prev.ms + minGap : startMs;
        const hi = next ? next.ms - minGap : endMs;
        ms = clamp(ms, lo, hi);
        if (ms === kf.ms) return;

        kf.ms = ms;
        this.keyframes.sort((a, b) => a.ms - b.ms);
        this._renderMarkers();
        this._syncKeyframesWidget();
        this.node.setDirtyCanvas(true, true);
    }

    _setTrimMs(startMs, endMs, syncWidgets = true, syncKeyframesWidget = true) {
        if (endMs < startMs) endMs = startMs;
        startMs = clamp(startMs, 0, this.durationMs);
        endMs = clamp(endMs, startMs, this.durationMs);

        const prevSuppress = this._suppressWidgetSync;
        this._suppressWidgetSync = true;
        try {
            if (syncWidgets) {
                const fps = this.getFps();
                const startW = this.findWidget("start_time");
                const endW = this.findWidget("end_time");
                const startTc = formatTimecode(startMs, fps);
                const endTc = formatTimecode(endMs, fps);
                if (startW) startW.value = startTc;
                if (endW) endW.value = endTc;
                this.startInput.value = startTc;
                this.endInput.value = endTc;
            }

            this._renderTrim();
            this._ensureBoundaryKeyframes(syncKeyframesWidget);
            this._onPlaybackTrimChanged();
        } finally {
            this._suppressWidgetSync = prevSuppress;
        }
    }

    _onTimeInput() {
        const fps = this.getFps();
        try {
            const startMs = parseTimecode(this.startInput.value, fps);
            const endMs = parseTimecode(this.endInput.value, fps);
            this._setTrimMs(startMs, endMs, true);
        } catch (err) {
            console.warn("[AudioKeyframeTimeline]", err);
        }
        this.node.setDirtyCanvas(true, true);
    }

    _pixelToMs(clientX) {
        const rect = this.waveWrap.getBoundingClientRect();
        const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
        return Math.round(ratio * this.durationMs);
    }

    _msToPercent(ms) {
        if (!this.durationMs) return 0;
        return (ms / this.durationMs) * 100;
    }

    _renderTrim() {
        const { startMs, endMs } = this._getTrimMs();
        const left = this._msToPercent(startMs);
        const right = this._msToPercent(endMs);
        this.shadeLeft.style.width = `${left}%`;
        this.shadeRight.style.width = `${100 - right}%`;
        this.shadeRight.style.left = `${right}%`;
        this.trimActive.style.left = `${left}%`;
        this.trimActive.style.width = `${right - left}%`;
        this.handleStart.style.left = `${left}%`;
        this.handleEnd.style.left = `${right}%`;
    }

    /** Remove boundary markers created by the old per-pixel trim drag bug. */
    _purgeOrphanBoundaryKeyframes() {
        this.keyframes = this.keyframes.filter(
            (k) =>
                !k.isBoundary ||
                k.boundaryRole === "start" ||
                k.boundaryRole === "end"
        );
    }

    _setBoundaryRole(role, ms) {
        let kf = this.keyframes.find((k) => k.boundaryRole === role);
        if (kf) {
            kf.ms = ms;
            kf.isBoundary = true;
            return;
        }
        this.keyframes.push({
            id: makeId(),
            ms,
            isBoundary: true,
            boundaryRole: role,
        });
    }

    _ensureBoundaryKeyframes(syncWidget = true) {
        const { startMs, endMs } = this._getTrimMs();
        this._purgeOrphanBoundaryKeyframes();
        this._setBoundaryRole("start", startMs);
        this._setBoundaryRole("end", endMs);

        this.keyframes = this.keyframes
            .filter((k) => k.ms >= startMs && k.ms <= endMs)
            .sort((a, b) => a.ms - b.ms);

        this._dedupeKeyframesByMs();
        this._refreshExpandedKeyframeFiles();
        this._renderMarkers();
        if (syncWidget) this._syncKeyframesWidget();
    }

    _dedupeKeyframesByMs() {
        const seen = new Map();
        for (const kf of [...this.keyframes].sort((a, b) => a.ms - b.ms)) {
            const key = String(kf.ms);
            const prev = seen.get(key);
            if (!prev) {
                seen.set(key, kf);
                continue;
            }
            if (kf.boundaryRole && !prev.boundaryRole) {
                seen.set(key, kf);
            }
        }
        this.keyframes = [...seen.values()].sort((a, b) => a.ms - b.ms);
    }

    /** Collapse trim-drag spam saved in older builds (dozens of ms per slider step). */
    _collapseSpamKeyframeTimes(times) {
        const unique = [...new Set(times)].sort((a, b) => a - b);
        if (unique.length <= 8) return unique;

        const { startMs, endMs } = this._getTrimMs();
        const inner = unique.filter((t) => t > startMs && t < endMs);
        if (inner.length >= 6) {
            console.warn(
                "[AudioKeyframeTimeline] 检测到异常密集关键帧，已重置为起止两点（可双击波形重新添加）"
            );
            return [startMs, endMs];
        }
        return unique;
    }

    _setKeyframesFromMs(times, syncWidget = true) {
        const { startMs, endMs } = this._getTrimMs();
        const filtered = [...new Set(times)]
            .map((t) => clamp(t, startMs, endMs))
            .sort((a, b) => a - b);
        const nextJson = JSON.stringify(filtered);
        const curJson = JSON.stringify(
            [...new Set(this.keyframes.map((k) => k.ms))].sort((a, b) => a - b)
        );
        if (nextJson === curJson) {
            this._renderMarkers();
            return;
        }
        this.keyframes = filtered.map((ms) => ({
            id: makeId(),
            ms,
        }));
        this._purgeOrphanBoundaryKeyframes();
        this._ensureBoundaryKeyframes(syncWidget);
    }

    _syncKeyframesWidget() {
        const w = this.findWidget("keyframes_ms");
        if (!w) return;
        const times = [...new Set(this.keyframes.map((k) => k.ms))].sort(
            (a, b) => a - b
        );
        const next = JSON.stringify(times);
        if (w.value === next) return;
        const prev = this._suppressWidgetSync;
        this._suppressWidgetSync = true;
        w.value = next;
        this._suppressWidgetSync = prev;
    }

    _sortedKeyframesInRange() {
        const { startMs, endMs } = this._getTrimMs();
        return this.keyframes
            .filter((k) => k.ms >= startMs && k.ms <= endMs)
            .sort((a, b) => a.ms - b.ms);
    }

    /** How many sequential preview slots the current anchors need. */
    _getRequiredKeyframeImageCount(oneShot = this.getOneShot()) {
        const n = this._sortedKeyframesInRange().length;
        if (n === 0) return 0;
        if (oneShot) {
            return n;
        }
        const userCount = Math.max(0, n - 2);
        return 2 * userCount + 2;
    }

    _expandKeyframeFiles(sourceFiles, requiredCount) {
        if (!sourceFiles?.length || requiredCount <= 0) return [];
        if (sourceFiles.length >= requiredCount) {
            return sourceFiles.slice(0, requiredCount);
        }
        const expanded = [];
        for (let i = 0; i < requiredCount; i++) {
            expanded.push(sourceFiles[i % sourceFiles.length]);
        }
        return expanded;
    }

    _refreshExpandedKeyframeFiles(oneShot = this.getOneShot()) {
        const source = this.keyframeFilesSource ?? [];
        if (!source.length) {
            this.keyframeFiles = [];
            return;
        }
        const needed = this._getRequiredKeyframeImageCount(oneShot);
        this.keyframeFiles = this._expandKeyframeFiles(source, needed);
    }

    _onOneShotChanged(oneShot) {
        this._refreshExpandedKeyframeFiles(oneShot);
        this._renderMarkers();
        const anchor = this._lastPreviewAnchorIndex;
        const x = this._lastPreviewClientX;
        if (anchor != null && x != null && this.keyframeFiles?.length) {
            this._showPreviewForAnchor(anchor, x, oneShot);
        } else {
            this._hidePreview();
        }
        this.node.setDirtyCanvas(true, true);
    }

    /**
     * Map anchor index (0=start, …user keyframes…, last=end) to expanded list slot indices.
     * one_shot: anchor i → slot i.
     * dual: start → [0]; user at i → [2i-1, 2i]; end → [2*userCount+1].
     */
    _getPreviewFileIndicesForAnchor(anchorIndex, oneShot = this.getOneShot()) {
        const sorted = this._sortedKeyframesInRange();
        const n = sorted.length;
        if (n === 0) return [];

        const i = clamp(anchorIndex, 0, n - 1);
        const userCount = Math.max(0, n - 2);

        if (oneShot) {
            return [i];
        }
        if (i === 0) {
            return [0];
        }
        if (i === n - 1) {
            return [2 * userCount + 1];
        }
        return [2 * i - 1, 2 * i];
    }

    /** Resolve logical slot index into expanded keyframeFiles array index. */
    _slotToFileIndex(slotIndex, oneShot = this.getOneShot()) {
        this._refreshExpandedKeyframeFiles(oneShot);
        const n = this.keyframeFiles?.length ?? 0;
        if (!n) return 0;
        return clamp(Math.floor(slotIndex), 0, n - 1);
    }

    _renderMarkers() {
        this.markersEl.replaceChildren();
        const sorted = this._sortedKeyframesInRange();

        for (let markerIndex = 0; markerIndex < sorted.length; markerIndex++) {
            const kf = sorted[markerIndex];
            const isBoundary =
                kf.boundaryRole === "start" || kf.boundaryRole === "end";
            const isSelected =
                kf.id === this.selectedId ||
                (isBoundary && kf.boundaryRole === this.selectedTrim);

            const el = document.createElement("div");
            el.className = "aktl-marker";
            if (isSelected) el.classList.add("selected");
            el.style.left = `${this._msToPercent(kf.ms)}%`;
            el.dataset.id = kf.id;

            const line = document.createElement("div");
            line.className = "aktl-marker-line";
            const headTop = document.createElement("div");
            headTop.className = isBoundary
                ? "aktl-marker-head aktl-marker-head--boundary"
                : "aktl-marker-head";
            if (isBoundary) {
                el.classList.add("aktl-marker--boundary");
            }
            if (isSelected && isBoundary) {
                headTop.classList.add("selected");
            }

            el.append(line, headTop);

            const onSelectDrag = (e) => {
                e.stopPropagation();
                this._selectUserKeyframe(kf);
                this._beginDrag(e, "marker", kf.id);
            };

            const onDelete = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.selectedId = kf.id;
                this._deleteSelected();
            };

            const onMarkerHover = (e) => {
                if (!this.keyframeFiles?.length) return;
                this._lastPreviewAnchorIndex = markerIndex;
                this._lastPreviewClientX = e.clientX;
                this._showPreviewForAnchor(markerIndex, e.clientX);
            };

            if (!isBoundary) {
                headTop.addEventListener("mousedown", onSelectDrag);
                headTop.addEventListener("contextmenu", onDelete);
            } else {
                headTop.addEventListener("mousedown", (e) => {
                    e.stopPropagation();
                    this._selectTrim(kf.boundaryRole);
                });
            }
            headTop.addEventListener("mouseenter", onMarkerHover);
            headTop.addEventListener("mousemove", onMarkerHover);
            headTop.addEventListener("mouseleave", () => this._hidePreview());

            this.markersEl.appendChild(el);
        }
    }

    _addKeyframe(ms) {
        const { startMs, endMs } = this._getTrimMs();
        ms = clamp(Math.round(ms), startMs, endMs);
        if (this.keyframes.some((k) => Math.abs(k.ms - ms) < 15)) return;
        const id = makeId();
        this.keyframes.push({ id, ms });
        this.keyframes.sort((a, b) => a.ms - b.ms);
        this._selectUserKeyframe({ id, ms });
        this._refreshExpandedKeyframeFiles();
        this._syncKeyframesWidget();
        this.node.setDirtyCanvas(true, true);
    }

    _deleteSelected() {
        const kf = this.keyframes.find((k) => k.id === this.selectedId);
        if (!kf) return;
        if (kf.boundaryRole === "start" || kf.boundaryRole === "end") return;
        this.keyframes = this.keyframes.filter((k) => k.id !== this.selectedId);
        this.selectedId = null;
        this._clearTrimSelection();
        this._refreshExpandedKeyframeFiles();
        this._renderMarkers();
        this._syncKeyframesWidget();
        this.node.setDirtyCanvas(true, true);
    }

    _onWaveDblClick(e) {
        if (!this.isReady) return;
        this._addKeyframe(this._pixelToMs(e.clientX));
    }

    _imageUrlForFileIndex(fileIndex) {
        const files = this.keyframeFiles;
        if (!files?.length) return null;
        const idx = clamp(Math.floor(fileIndex), 0, files.length - 1);
        const name = files[idx];
        if (!name) return null;
        const dir = encodeURIComponent(this.getKeyframeDir());
        const file = encodeURIComponent(name);
        return api.apiURL(
            `/audio_keyframe_timeline/keyframe_image?dir=${dir}&name=${file}`
        );
    }

    /**
     * @param {number} imageSlotIndex 0 = 段首 / single; 1 = 段尾 (dual user anchor)
     */
    _getPreviewCaptionMeta(anchorIndex, imageSlotIndex, oneShot) {
        const sorted = this._sortedKeyframesInRange();
        const n = sorted.length;
        const i = clamp(anchorIndex, 0, Math.max(0, n - 1));
        const fps = this.getFps();

        // Middle user keyframe, 2nd thumb: same instant as anchor, 0 frames (not next segment)
        if (!oneShot && i > 0 && i < n - 1 && imageSlotIndex === 1) {
            const endMs = sorted[i].ms;
            return {
                timecode: formatTimecode(endMs, fps),
                frames: 0,
            };
        }

        const endMs = sorted[i]?.ms ?? 0;
        const startMs = i > 0 ? sorted[i - 1].ms : endMs;
        return {
            timecode: formatTimecode(endMs, fps),
            frames: i > 0 ? segmentFrameCount(startMs, endMs, fps) : 0,
        };
    }

    _createPreviewItem(label, url, timecode, frameCount, onImageLayout) {
        const item = document.createElement("div");
        item.className = "aktl-preview-item";
        const img = document.createElement("img");
        img.src = url;
        img.alt = label;
        const notifyLayout = () => onImageLayout?.();
        img.addEventListener("load", notifyLayout);
        img.onerror = () => {
            item.classList.add("aktl-preview-item--error");
            notifyLayout();
        };
        const cap = document.createElement("div");
        cap.className = "aktl-preview-caption";

        const nameEl = document.createElement("div");
        nameEl.className = "aktl-preview-filename";
        nameEl.textContent = label;
        nameEl.title = label;

        const metaEl = document.createElement("div");
        metaEl.className = "aktl-preview-meta";

        const timeEl = document.createElement("span");
        timeEl.className = "aktl-preview-time";
        timeEl.textContent = timecode;

        metaEl.appendChild(timeEl);

        if (frameCount != null && Number.isFinite(frameCount)) {
            const framesEl = document.createElement("span");
            framesEl.className = "aktl-preview-frames";
            framesEl.textContent = `${frameCount}帧`;
            metaEl.appendChild(framesEl);
        }

        cap.append(nameEl, metaEl);
        item.append(img, cap);
        return item;
    }

    _lastPreviewAnchorX = 0;

    _positionPreviewFromClientX(clientX) {
        const rootRect = this.rootEl.getBoundingClientRect();
        const halfW = Math.max(this.previewEl.offsetWidth / 2, 24);
        const x = clamp(
            clientX - rootRect.left,
            halfW + 4,
            Math.max(halfW + 4, rootRect.width - halfW - 4)
        );
        this.previewEl.style.left = `${x}px`;
    }

    _bindPreviewLayout(anchorX) {
        this._lastPreviewAnchorX = anchorX;
        const reposition = () =>
            this._positionPreviewFromClientX(this._lastPreviewAnchorX);
        requestAnimationFrame(reposition);
        return reposition;
    }

    _showPreviewForAnchor(anchorIndex, clientX, oneShot = this.getOneShot()) {
        this._refreshExpandedKeyframeFiles(oneShot);
        if (!this.keyframeFiles?.length) {
            this._hidePreview();
            return;
        }

        const sorted = this._sortedKeyframesInRange();
        const rawIndices = this._getPreviewFileIndicesForAnchor(
            anchorIndex,
            oneShot
        );
        const indices = rawIndices.map((idx) =>
            this._slotToFileIndex(idx, oneShot)
        );
        if (!indices.length) {
            this._hidePreview();
            return;
        }

        const onLayout = this._bindPreviewLayout(clientX);

        this.previewEl.replaceChildren();
        this.previewEl.classList.remove("aktl-preview--single", "aktl-preview--dual");

        if (indices.length === 1) {
            const fileIdx = indices[0];
            const url = this._imageUrlForFileIndex(fileIdx);
            if (!url) {
                this._hidePreview();
                return;
            }
            const cap0 = this._getPreviewCaptionMeta(anchorIndex, 0, oneShot);
            const label =
                this.keyframeFiles[fileIdx] ??
                `第 ${rawIndices[0] + 1} 张`;
            this.previewEl.classList.add("aktl-preview--single");
            this.previewEl.appendChild(
                this._createPreviewItem(
                    label,
                    url,
                    cap0.timecode,
                    cap0.frames,
                    onLayout
                )
            );
        } else {
            const [fileIdxA, fileIdxB] = indices;
            const urlA = this._imageUrlForFileIndex(fileIdxA);
            const urlB = this._imageUrlForFileIndex(fileIdxB);
            if (!urlA && !urlB) {
                this._hidePreview();
                return;
            }
            const cap0 = this._getPreviewCaptionMeta(anchorIndex, 0, oneShot);
            const cap1 = this._getPreviewCaptionMeta(anchorIndex, 1, oneShot);
            this.previewEl.classList.add("aktl-preview--dual");
            if (urlA) {
                const labelA =
                    this.keyframeFiles[fileIdxA] ??
                    `第 ${rawIndices[0] + 1} 张`;
                this.previewEl.appendChild(
                    this._createPreviewItem(
                        `段首 · ${labelA}`,
                        urlA,
                        cap0.timecode,
                        cap0.frames,
                        onLayout
                    )
                );
            }
            if (urlB) {
                const labelB =
                    this.keyframeFiles[fileIdxB] ??
                    `第 ${rawIndices[1] + 1} 张`;
                this.previewEl.appendChild(
                    this._createPreviewItem(
                        `段尾 · ${labelB}`,
                        urlB,
                        cap1.timecode,
                        cap1.frames,
                        onLayout
                    )
                );
            }
        }

        this.previewEl.style.display = "flex";
        this._positionPreviewFromClientX(clientX);
    }

    _hidePreview() {
        this.previewEl.style.display = "none";
        this.previewEl.replaceChildren();
        this._lastPreviewAnchorIndex = null;
        this._lastPreviewClientX = null;
    }

    _beginDrag(e, mode, markerId = null) {
        e.preventDefault();
        e.stopPropagation();
        this._drag = { mode, markerId };
        if (mode === "marker") {
            this.markersEl
                .querySelector(`[data-id="${markerId}"]`)
                ?.classList.add("dragging");
        }
    }

    _onDragMove(e) {
        if (!this._drag || !this.isReady) return;
        const ms = this._pixelToMs(e.clientX);
        const { startMs, endMs } = this._getTrimMs();

        if (this._drag.mode === "trim-start") {
            this._setTrimMs(Math.min(ms, endMs - 1), endMs, true, false);
        } else if (this._drag.mode === "trim-end") {
            this._setTrimMs(startMs, Math.max(ms, startMs + 1), true, false);
        } else if (this._drag.mode === "marker") {
            const kf = this.keyframes.find((k) => k.id === this._drag.markerId);
            if (
                !kf ||
                kf.boundaryRole === "start" ||
                kf.boundaryRole === "end"
            )
                return;
            kf.ms = clamp(ms, startMs + 1, endMs - 1);
            this.keyframes.sort((a, b) => a.ms - b.ms);
            this._renderMarkers();
            this._syncKeyframesWidget();
        }
        this.node.setDirtyCanvas(true, true);
    }

    _endDrag() {
        if (!this._drag) return;
        const mode = this._drag.mode;
        if (mode === "marker") {
            this.markersEl
                .querySelector(`[data-id="${this._drag.markerId}"]`)
                ?.classList.remove("dragging");
        }
        this._drag = null;
        if (mode === "trim-start" || mode === "trim-end") {
            this._purgeOrphanBoundaryKeyframes();
            this._ensureBoundaryKeyframes(true);
        } else {
            this._ensureBoundaryKeyframes(true);
        }
    }

    async _fetchKeyframeImages() {
        const dir = this.getKeyframeDir();
        if (!dir) {
            this.keyframeFilesSource = [];
            this.keyframeFiles = [];
            return;
        }
        try {
            const res = await fetch(
                api.apiURL(
                    `/audio_keyframe_timeline/keyframes?dir=${encodeURIComponent(dir)}`
                )
            );
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const data = await res.json();
            this.keyframeFilesSource = Array.isArray(data.files)
                ? data.files
                : [];
            this._keyframeDirResolved = data.resolved_dir ?? "";
            this._refreshExpandedKeyframeFiles();
            if (!this.keyframeFilesSource.length) {
                console.warn(
                    "[AudioKeyframeTimeline] 目录无图片:",
                    data.resolved_dir || dir
                );
            } else {
                const needed = this._getRequiredKeyframeImageCount();
                const expanded = this.keyframeFiles.length;
                const msg =
                    expanded > this.keyframeFilesSource.length
                        ? `已加载 ${this.keyframeFilesSource.length} 张，按顺序循环扩展为 ${expanded} 张（需要 ${needed} 张）`
                        : `已加载 ${expanded} 张关键帧图`;
                console.info(`[AudioKeyframeTimeline] ${msg}`, data.resolved_dir);
            }
            this.node.setDirtyCanvas(true, true);
        } catch (err) {
            console.warn("[AudioKeyframeTimeline] keyframe list failed", err);
            this.keyframeFilesSource = [];
            this.keyframeFiles = [];
        }
    }

    _audioViewUrl(filename) {
        if (!filename) return null;
        let name = String(filename).replace(/\s*\[input\]\s*$/i, "").trim();
        let subfolder = "";
        if (name.includes("/")) {
            const idx = name.lastIndexOf("/");
            subfolder = name.slice(0, idx);
            name = name.slice(idx + 1);
        }
        const params = new URLSearchParams({ filename: name, type: "input" });
        if (subfolder) params.set("subfolder", subfolder);
        return api.apiURL(`/view?${params.toString()}`);
    }

    /** Build waveform peaks from AudioBuffer (avoids blob: URLs blocked by ComfyUI CSP). */
    _audioBufferToPeaks(audioBuffer, maxLength = 8000) {
        const channels = Math.min(2, audioBuffer.numberOfChannels || 1);
        const peaks = [];
        for (let c = 0; c < channels; c++) {
            const data = audioBuffer.getChannelData(c);
            const peakList = [];
            const chunk = Math.max(1, Math.floor(data.length / maxLength));
            for (let i = 0; i < maxLength; i++) {
                const start = i * chunk;
                const end = Math.min(start + chunk, data.length);
                let max = 0;
                for (let j = start; j < end; j++) {
                    const v = Math.abs(data[j]);
                    if (v > max) max = v;
                }
                peakList.push(max);
            }
            peaks.push(peakList);
        }
        if (peaks.length === 1) {
            peaks.push(peaks[0].slice());
        }
        return peaks;
    }

    async _fetchPeaksFromViewUrl(url) {
        const response = await fetch(url, { credentials: "same-origin" });
        if (!response.ok) {
            throw new Error(`无法加载音频 (${response.status})`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const audioContext = new AudioContext();
        try {
            const audioBuffer = await audioContext.decodeAudioData(
                arrayBuffer.slice(0)
            );
            return {
                peaks: this._audioBufferToPeaks(audioBuffer),
                duration: audioBuffer.duration,
            };
        } finally {
            await audioContext.close();
        }
    }

    _onWaveSurferReady() {
        this.durationMs = Math.round(this.wavesurfer.getDuration() * 1000);
        this.isReady = true;
        this.loadingEl.style.display = "none";

        const fps = this.getFps();
        const endW = this.findWidget("end_time");
        if (!String(endW?.value ?? "").trim()) {
            const endTc = formatTimecode(this.durationMs, fps);
            if (endW) endW.value = endTc;
            this.endInput.value = endTc;
        }

        const existing = parseKeyframesJson(
            this.findWidget("keyframes_ms")?.value
        );
        if (existing.length) {
            this._setKeyframesFromMs(this._collapseSpamKeyframeTimes(existing), true);
        } else {
            this._setTrimMs(0, this.durationMs, true);
        }

        this._fetchKeyframeImages();
        this._renderTrim();
        this._seekPlaybackToTrimStart();
        this._updatePlaybackControlsState();
        this.node.setDirtyCanvas(true, true);
    }

    _onKeyframeDirChanged() {
        clearTimeout(this._keyframeDirTimer);
        this._keyframeDirTimer = setTimeout(() => this._fetchKeyframeImages(), 150);
    }

    _scheduleKeyframeDirRefresh() {
        this._onKeyframeDirChanged();
    }

    async _loadAudioFromWidget() {
        const audio = this.findWidget("audio")?.value;
        const url = audio ? this._audioViewUrl(audio) : null;
        this._reloadPlaybackSource(url);

        if (!audio) {
            this.isReady = false;
            this._updatePlaybackControlsState();
            return;
        }
        if (this._loadingAudio) return;
        if (!url) {
            this._updatePlaybackControlsState();
            return;
        }

        this._loadingAudio = true;
        this.isReady = false;
        this._updatePlaybackControlsState();
        this.loadingEl.style.display = "flex";
        this.loadingEl.textContent = "加载波形…";

        try {
            this.wavesurfer?.destroy();
            this.waveEl.replaceChildren();

            this.wavesurfer = WaveSurfer.create({
                container: this.waveEl,
                height: 96,
                waveColor: "#4a6fa5",
                progressColor: "#8ab4ff",
                cursorColor: "#ffd166",
                barWidth: 2,
                barGap: 1,
                normalize: true,
                backend: "WebAudio",
            });

            this.wavesurfer.on("ready", () => this._onWaveSurferReady());
            this.wavesurfer.on("error", (err) => {
                console.error("[AudioKeyframeTimeline]", err);
                this.loadingEl.style.display = "flex";
                this.loadingEl.textContent = "波形加载失败";
                this.isReady = false;
                this._updatePlaybackControlsState();
            });

            const { peaks, duration } = await this._fetchPeaksFromViewUrl(url);
            // Pass peaks so WaveSurfer skips fetchBlob() (blob: violates CSP).
            await this.wavesurfer.load(url, peaks, duration);
        } catch (err) {
            console.error("[AudioKeyframeTimeline]", err);
            this.loadingEl.style.display = "flex";
            this.loadingEl.textContent =
                err instanceof Error ? err.message : "无法加载波形";
            this.isReady = false;
            this._playbackReady = false;
            this._updatePlaybackControlsState();
        } finally {
            this._loadingAudio = false;
            this._updatePlaybackControlsState();
        }
    }
}
