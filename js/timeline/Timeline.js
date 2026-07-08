import { EventEmitter } from './EventEmitter.js';
import { clamp, formatTime as _formatTime, TRACK_TYPES } from './utils.js';
import { iconHtml } from '../cap_icons.js';
import { Track } from './Track.js';
import { TimeRuler } from './TimeRuler.js';
import { PlayHead } from './PlayHead.js';

const BASE_PPS = 100; // pixels per second at zoom = 1

export class Timeline extends EventEmitter {
  /**
   * @param {string|HTMLElement} container
   * @param {object} [options]
   * @param {number} [options.duration=120]  total timeline length (seconds)
   * @param {number} [options.zoom=1]        initial zoom level
   * @param {number} [options.minZoom=0.05]
   * @param {number} [options.maxZoom=20]
   */
  constructor(container, options = {}) {
    super();
    this._container = typeof container === 'string'
      ? document.querySelector(container)
      : container;

    if (!this._container) throw new Error('Timeline: container not found');

    this.duration    = options.duration   ?? 120;
    this.fps         = options.fps        ?? 24;
    this.timeFormat  = options.timeFormat ?? 'frames'; // 'frames' | 'ms'
    this._zoom      = options.zoom      ?? 1;
    this.minZoom    = options.minZoom   ?? 0.05;
    this.maxZoom    = options.maxZoom   ?? 20;
    this.currentTime  = 0;
    this.tracks       = [];
    this._mainTrackId = null; // the primary (center) track separating overlays from audio
    this._selected    = null;
    this._selectedIds = new Set();
    this.addTrackTypes = options.addTrackTypes ?? null; // e.g. ['image','audio']
    this._playing   = false;
    this._rafId     = null;
    this._lastTs    = null;

    this._buildDOM();
    this._bindEvents();
    this._refresh();
  }

  // ─── public getters ───────────────────────────────────────────────────────

  get pixelsPerSecond() { return BASE_PPS * this._zoom; }
  /** Scrollable width: at least one viewport wide (matches ruler canvas). */
  get totalWidth() {
    const contentW = this.duration * this.pixelsPerSecond;
    const viewW = this.scrollEl?.clientWidth ?? 0;
    return Math.max(contentW, viewW);
  }

  /** Latest end time among all clips on all tracks. */
  _contentEndTime() {
    let maxEnd = 0;
    for (const track of this.tracks) {
      for (const clip of track.clips) {
        maxEnd = Math.max(maxEnd, clip.endTime);
      }
    }
    return maxEnd;
  }

  /** Playhead / seek cannot move past the last clip end (or full duration if empty). */
  _seekMaxTime() {
    const end = this._contentEndTime();
    return end > 0 ? end : this.duration;
  }

  // ─── DOM construction ─────────────────────────────────────────────────────

  _buildDOM() {
    const c = this._container;
    c.classList.add('tl-root');
    c.innerHTML = '';

    // ── Toolbar ──────────────────────────────────────────────────────────────
    this.toolbarEl = el('div', 'tl-toolbar');

    // Playback group can be moved by host applications (e.g. into a footer).
    this.playbackControlsEl = el('div', 'tl-playback-controls');

    // Play/Pause
    this._playBtn = el('button', 'tl-btn tl-btn-play');
    this._playBtn.innerHTML = icon('play');
    this._playBtn.title = 'Play / Pause  (Space)';
    this._playBtn.addEventListener('click', () => this.togglePlay());
    this.playbackControlsEl.appendChild(this._playBtn);

    // Stop (return to 0)
    this._stopBtn = el('button', 'tl-btn tl-btn-icon');
    this._stopBtn.innerHTML = icon('stop');
    this._stopBtn.title = 'Stop';
    this._stopBtn.addEventListener('click', () => { this.pause(); this.setCurrentTime(0); });
    this.playbackControlsEl.appendChild(this._stopBtn);

    // Time display
    this._timeEl = el('span', 'tl-time-display');
    this._timeEl.textContent = '0:00.000';
    this.playbackControlsEl.appendChild(this._timeEl);

    // Duration display
    this._durEl = el('span', 'tl-dur-display');
    this._durEl.textContent = `/ ${this.formatTime(this.duration)}`;
    this.playbackControlsEl.appendChild(this._durEl);
    this.toolbarEl.appendChild(this.playbackControlsEl);

    // Spacer
    this.toolbarEl.appendChild(el('div', 'tl-spacer'));

    // Zoom controls
    const zoomGroup = el('div', 'tl-zoom-group');

    const zoomOut = el('button', 'tl-btn tl-btn-icon');
    zoomOut.textContent = '−';
    zoomOut.title = 'Zoom Out  (Ctrl −)';
    zoomOut.addEventListener('click', () => this.setZoom(this._zoom / 1.5));

    this._zoomSlider = el('input');
    this._zoomSlider.type = 'range';
    this._zoomSlider.className = 'tl-zoom-slider';
    this._zoomSlider.min = -4.3;
    this._zoomSlider.max = 4.3;
    this._zoomSlider.step = 0.05;
    this._zoomSlider.value = 0;
    this._zoomSlider.title = 'Zoom';
    this._zoomSlider.addEventListener('input', () => {
      this.setZoom(Math.pow(2, +this._zoomSlider.value), null, true);
    });

    this._zoomLabel = el('span', 'tl-zoom-label');
    this._zoomLabel.textContent = '1.0×';

    const zoomIn = el('button', 'tl-btn tl-btn-icon');
    zoomIn.textContent = '+';
    zoomIn.title = 'Zoom In  (Ctrl +)';
    zoomIn.addEventListener('click', () => this.setZoom(this._zoom * 1.5));

    zoomGroup.append(zoomOut, this._zoomSlider, this._zoomLabel, zoomIn);
    this.toolbarEl.appendChild(zoomGroup);

    // Add track button in toolbar
    const addBtn = el('button', 'tl-btn tl-btn-add-track');
    addBtn.textContent = '+ 轨道';
    addBtn.title = '添加图片或音频轨道';
    addBtn.addEventListener('click', () => this._showAddTrackMenu(addBtn));
    this.toolbarEl.appendChild(addBtn);

    c.appendChild(this.toolbarEl);

    // ── Body ─────────────────────────────────────────────────────────────────
    this.bodyEl = el('div', 'tl-body');

    // ── Sidebar ───────────────────────────────────────────────────────────────
    this.sidebarEl = el('div', 'tl-sidebar');

    this._sidebarRulerSpacer = el('div', 'tl-sidebar-ruler-spacer');
    this.sidebarEl.appendChild(this._sidebarRulerSpacer);

    this._trackHeadersEl = el('div', 'tl-track-headers');
    this.sidebarEl.appendChild(this._trackHeadersEl);

    this.bodyEl.appendChild(this.sidebarEl);

    // ── Main (ruler + scroll) ─────────────────────────────────────────────────
    this.mainEl = el('div', 'tl-main');

    this._ruler = new TimeRuler(this);
    this.mainEl.appendChild(this._ruler.el);

    this.scrollEl = el('div', 'tl-scroll');

    this._contentEl = el('div', 'tl-content');

    this._playhead = new PlayHead(this);
    this._contentEl.appendChild(this._playhead.el);

    this._tracksEl = el('div', 'tl-tracks');
    this._contentEl.appendChild(this._tracksEl);

    this.scrollEl.appendChild(this._contentEl);
    this.mainEl.appendChild(this.scrollEl);
    this.bodyEl.appendChild(this.mainEl);

    c.appendChild(this.bodyEl);
  }

  // ─── events ───────────────────────────────────────────────────────────────

  _bindEvents() {
    // Ruler redraws when timeline scrolls
    this.scrollEl.addEventListener('scroll', () => {
      this._ruler.render();
      this._trackHeadersEl.style.transform = `translateY(-${this.scrollEl.scrollTop}px)`;
    });

    // Ctrl/Meta + wheel → zoom; Alt + wheel → horizontal scroll
    this.scrollEl.addEventListener('wheel', (e) => {
      if (e.altKey) {
        e.preventDefault();
        this.scrollEl.scrollLeft += e.deltaY;
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = this.scrollEl.getBoundingClientRect();
        const pivotX = e.clientX - rect.left;
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        this.setZoom(this._zoom * factor, pivotX);
      }
    }, { passive: false });

    // Deselect clip on background click
    this._contentEl.addEventListener('mousedown', (e) => {
      if (e.target === this._contentEl || e.target === this._tracksEl) {
        this.selectClip(null);
      }
    });

    // Keyboard shortcuts. These are single bare keys (Q/W/Space/arrows/...)
    // that can collide with ComfyUI's own shortcuts (e.g. its own "W"
    // toggles the Workflows panel) — whenever we actually act on the key,
    // stop it from propagating any further so it can't also reach
    // ComfyUI's handling. Consumed at window-capture time (see below) so
    // this runs before ComfyUI's listeners regardless of where/when they
    // were attached.
    const consume = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); };
    this._onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      switch (e.code) {
        case 'Space':
          consume(e); this.togglePlay(); break;
        case 'Delete':
        case 'Backspace':
          if (this._selectedIds.size > 0 || this._selected) {
            consume(e);
            this.emit('clip:delete', {
              clips: this.getSelectedClips(),
              clipIds: [...this._selectedIds],
            });
          }
          break;
        case 'KeyQ':
          // Delete the portion of the selected clip to the LEFT of the playhead
          if (this._selected) { consume(e); this._trimClipAtPlayhead('left'); }
          break;
        case 'KeyW':
          // Delete the portion of the selected clip to the RIGHT of the playhead
          if (this._selected) { consume(e); this._trimClipAtPlayhead('right'); }
          break;
        case 'Home':
          consume(e); this.setCurrentTime(0); break;
        case 'End':
          consume(e); this.setCurrentTime(this._seekMaxTime()); break;
        case 'ArrowLeft':
          consume(e);
          this.setCurrentTime(this.currentTime - (e.shiftKey ? 1 : 1 / this.fps)); break;
        case 'ArrowRight':
          consume(e);
          this.setCurrentTime(this.currentTime + (e.shiftKey ? 1 : 1 / this.fps)); break;
        case 'Equal':
        case 'NumpadAdd':
          if (e.ctrlKey || e.metaKey) { consume(e); this.setZoom(this._zoom * 1.5); } break;
        case 'Minus':
        case 'NumpadSubtract':
          if (e.ctrlKey || e.metaKey) { consume(e); this.setZoom(this._zoom / 1.5); } break;
      }
    };
    // Capture on `window` (not `document`, not bubble phase): capture-phase
    // listeners fire in strict ancestor order (window before document
    // before canvas/body), so this always runs before ComfyUI's own
    // shortcut handling, regardless of registration order.
    window.addEventListener('keydown', this._onKey, true);

    this.on('clip:move', () => this._clampCurrentTime());
    this.on('clip:resize', () => this._clampCurrentTime());

    if (window.ResizeObserver) {
      this._ro = new ResizeObserver(() => {
        this._syncRulerSpacerWidth();
        this._syncContentWidth();
        this._ruler.render();
      });
      this._ro.observe(this.scrollEl);
    }
  }

  _syncRulerSpacerWidth() {
    this._sidebarRulerSpacer.style.height = `${this._ruler.height}px`;
  }

  // ─── add-track menu ───────────────────────────────────────────────────────

  _showAddTrackMenu(anchor) {
    const existing = document.querySelector('.tl-add-menu');
    if (existing) { existing.remove(); return; }

    const menu = el('div', 'tl-add-menu');
    const allowed = this.addTrackTypes;
    Object.entries(TRACK_TYPES).forEach(([type, meta]) => {
      if (allowed && !allowed.includes(type)) return;
      const item = el('button', 'tl-add-menu-item');
      item.innerHTML = `<span class="tl-add-menu-icon" style="color:${meta.color}">${meta.icon}</span> ${meta.label}`;
      item.addEventListener('click', () => {
        this.addTrack({ type });
        menu.remove();
      });
      menu.appendChild(item);
    });

    const rect = anchor.getBoundingClientRect();
    const rootRect = this._container.getBoundingClientRect();
    menu.style.right = `${rootRect.right - rect.right}px`;
    menu.style.top = `${rect.bottom - rootRect.top + 4}px`;
    this._container.appendChild(menu);

    const close = (e) => {
      if (!menu.contains(e.target) && e.target !== anchor) {
        menu.remove();
        document.removeEventListener('mousedown', close);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', close), 0);
  }

  // ─── internal render ──────────────────────────────────────────────────────

  _syncContentWidth() {
    const w = `${this.totalWidth}px`;
    this._contentEl.style.width = w;
    this._contentEl.style.minWidth = w;
    this._tracksEl.style.width = w;
    this._tracksEl.style.minWidth = w;
    for (const track of this.tracks) {
      track.el.style.width = w;
      track.el.style.minWidth = w;
    }
  }

  _refresh() {
    this._syncRulerSpacerWidth();
    this._syncContentWidth();
    this._ruler.render();
    this._playhead.update();
  }

  // ─── track management ─────────────────────────────────────────────────────

  /**
   * Add a track with zone-aware placement:
   *   • First non-audio track → becomes the Main track (appended at current bottom)
   *   • Subsequent non-audio tracks → overlays, inserted at position 0 (above all overlays)
   *   • Audio tracks → always appended at the very bottom
   *
   * Pass `isMain: true` to force-designate a track as Main regardless of order.
   *
   * @param {{ type?: string, name?: string, color?: string, isMain?: boolean }} data
   */
  addTrack(data = {}) {
    const isAudio = (data.type || 'video') === 'audio';
    const forceMain = !!data.isMain;

    // Auto-designate: first non-audio track becomes Main
    const willBeMain = forceMain || (!isAudio && !this._mainTrackId);
    const track = new Track(this, { ...data, isMain: willBeMain });

    if (willBeMain) {
      this._mainTrackId = track.id;
    }

    if (!isAudio && !willBeMain && this._mainTrackId) {
      // Overlay track → insert at the very top (index 0), above previous overlays
      this.tracks.unshift(track);
      this._tracksEl.prepend(track.el);
      this._trackHeadersEl.prepend(track.headerEl);
    } else {
      // Main track (first non-audio), audio track, or no main yet → append
      this.tracks.push(track);
      this._tracksEl.appendChild(track.el);
      this._trackHeadersEl.appendChild(track.headerEl);
    }

    this.emit('track:add', { track });
    this._refresh();
    return track;
  }

  /** Remove a track by id. The Main track cannot be removed. */
  removeTrack(trackId) {
    if (trackId === this._mainTrackId) return false;
    const idx = this.tracks.findIndex(t => t.id === trackId);
    if (idx === -1) return false;
    const track = this.tracks[idx];
    if (this._selected?.track === track) this.selectClip(null);
    track.destroy();
    this.tracks.splice(idx, 1);
    this.emit('track:remove', { trackId });
    return true;
  }

  getTrack(trackId) { return this.tracks.find(t => t.id === trackId); }

  /** Remove every track (including Main) — used to rebuild the timeline
   * in place from an external snapshot (e.g. undo/redo) without recreating
   * the whole component and losing zoom/scroll state. */
  clearTracks() {
    this.selectClip(null);
    for (const track of this.tracks) track.destroy();
    this.tracks.length = 0;
    this._mainTrackId = null;
    this._refresh();
  }

  /**
   * Return the track of the given `type` whose DOM element is under clientY,
   * or null if none matches.  Used by Clip to find cross-track drag targets.
   */
  _findTrackAtY(clientY, type) {
    for (const track of this.tracks) {
      if (track.type !== type) continue;
      const r = track.el.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) return track;
    }
    return null;
  }

  /** Convert viewport X to timeline seconds (accounts for horizontal scroll). */
  clientXToTime(clientX) {
    const r = this.scrollEl.getBoundingClientRect();
    const x = clientX - r.left + this.scrollEl.scrollLeft;
    const secs = x / this.pixelsPerSecond;
    const fps = Math.max(1, this.fps || 24);
    const step = 1 / fps;
    const snapped = Math.round(secs / step) * step;
    return Math.max(0, Math.min(this._seekMaxTime(), snapped));
  }

  // ─── clip management ──────────────────────────────────────────────────────

  /**
   * Add a clip to a track.
   * @param {string} trackId
   * @param {{ name?, startTime?, duration?, src?, thumbnail?, color? }} data
   */
  addClip(trackId, data = {}) {
    const track = this.getTrack(trackId);
    if (!track) throw new Error(`Track "${trackId}" not found`);
    const clip = track.addClip(data);
    if (!clip) return null;
    this.emit('clip:add', { clip, track });
    return clip;
  }

  removeClip(trackId, clipId) {
    const track = this.getTrack(trackId);
    if (!track) return false;
    const ok = track.removeClip(clipId);
    if (ok) {
      this._selectedIds.delete(clipId);
      if (this._selected?.id === clipId) {
        this._selected = this._selectedIds.size
          ? this._findClipById([...this._selectedIds].at(-1))
          : null;
      }
      this.emit('clip:remove', { clipId, trackId });
      this._clampCurrentTime();
    }
    return ok;
  }

  /**
   * Trim the selected clip at the current playhead position.
   * @param {'left'|'right'} side  'left' removes everything before playhead,
   *                               'right' removes everything after playhead.
   */
  _trimClipAtPlayhead(side) {
    const clip = this._selected;
    if (!clip) return;

    const t = this.currentTime;
    const MIN = 1 / this.fps; // minimum 1 frame

    // Bail out before announcing anything if the playhead position means
    // there's nothing to cut — only emit resizestart/resizeend (which is
    // what the app hooks to record one undo step) once we know this will
    // actually change something, same as the drag-trim gesture does.
    if (side === 'left') {
      if (t <= clip.startTime) return;
    } else {
      if (t >= clip.endTime) return;
    }

    this.emit('clip:resizestart', { clip, track: clip.track });

    if (side === 'left') {
      if (t >= clip.endTime - MIN) {            // playhead at/past end — entire clip removed
        this.removeClip(clip.track.id, clip.id);
        this.selectClip(null);
        this.emit('clip:resizeend', { clip, track: clip.track, moved: true });
        return;
      }
      clip.duration = clip.endTime - t;
      clip.startTime = t;
    } else {
      if (t <= clip.startTime + MIN) {          // playhead at/before start — entire clip removed
        this.removeClip(clip.track.id, clip.id);
        this.selectClip(null);
        this.emit('clip:resizeend', { clip, track: clip.track, moved: true });
        return;
      }
      clip.duration = t - clip.startTime;
    }

    clip._applyPosition();
    this.emit('clip:resize', { clip, track: clip.track });
    this.emit('clip:resizeend', { clip, track: clip.track, moved: true });
  }

  updateClip(trackId, clipId, data) {
    const clip = this.getTrack(trackId)?.getClip(clipId);
    if (!clip) return false;
    Object.assign(clip, data);
    clip._applyPosition();
    this.emit('clip:update', { clip, track: clip.track });
    return true;
  }

  selectClip(clip, opts = {}) {
    const additive = !!opts.additive;

    if (!clip) {
      for (const id of this._selectedIds) {
        this._findClipById(id)?.setSelected(false);
      }
      this._selectedIds.clear();
      this._selected?.setSelected(false);
      this._selected = null;
      this.emit('clip:deselect', { clip: null, track: null });
      return;
    }

    if (additive) {
      if (this._selectedIds.has(clip.id)) {
        this._selectedIds.delete(clip.id);
        clip.setSelected(false);
        if (this._selected?.id === clip.id) {
          this._selected = this._selectedIds.size
            ? this._findClipById([...this._selectedIds].at(-1))
            : null;
        }
      } else {
        this._selectedIds.add(clip.id);
        clip.setSelected(true);
        this._selected = clip;
      }
      this.emit('clip:select', {
        clip: this._selected,
        track: this._selected?.track,
        selected: this.getSelectedClips(),
      });
      return;
    }

    for (const id of this._selectedIds) {
      if (id !== clip.id) this._findClipById(id)?.setSelected(false);
    }
    this._selectedIds.clear();
    this._selectedIds.add(clip.id);
    this._selected?.setSelected(false);
    this._selected = clip;
    clip.setSelected(true);
    this.emit('clip:select', {
      clip,
      track: clip.track,
      selected: this.getSelectedClips(),
    });
  }

  _findClipById(clipId) {
    for (const track of this.tracks) {
      const c = track.getClip(clipId);
      if (c) return c;
    }
    return null;
  }

  getSelectedClips() {
    return [...this._selectedIds]
      .map(id => this._findClipById(id))
      .filter(Boolean);
  }

  clearSelection() {
    this.selectClip(null);
  }

  // ─── playback ─────────────────────────────────────────────────────────────

  play() {
    if (this._playing) return;
    if (this.currentTime >= this._seekMaxTime()) this.setCurrentTime(0);
    this._playing = true;
    this._lastTs = performance.now();
    this._playBtn.innerHTML = icon('pause');
    this._playBtn.classList.add('is-playing');
    this._tick();
    this.emit('play', {});
  }

  pause() {
    if (!this._playing) return;
    this._playing = false;
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    this._playBtn.innerHTML = icon('play');
    this._playBtn.classList.remove('is-playing');
    this.emit('pause', {});
  }

  togglePlay() { this._playing ? this.pause() : this.play(); }

  _tick() {
    const now = performance.now();
    const dt = (now - this._lastTs) / 1000;
    this._lastTs = now;
    const t = this.currentTime + dt;
    const max = this._seekMaxTime();
    if (t >= max) {
      this.setCurrentTime(max);
      this.pause();
      return;
    }
    this.setCurrentTime(t);
    this._rafId = requestAnimationFrame(() => this._tick());
  }

  // ─── time control ─────────────────────────────────────────────────────────

  setCurrentTime(time) {
    this.currentTime = clamp(time, 0, this._seekMaxTime());
    this._playhead.update();
    this._timeEl.textContent = this.formatTime(this.currentTime);

    if (this._playing) {
      const x = this.currentTime * this.pixelsPerSecond;
      const sl = this.scrollEl.scrollLeft;
      const vw = this.scrollEl.clientWidth;
      if (x < sl + 20 || x > sl + vw - 60) {
        this.scrollEl.scrollLeft = x - vw * 0.25;
      }
    }

    this.emit('timechange', { time: this.currentTime });
  }

  _clampCurrentTime() {
    const max = this._seekMaxTime();
    if (this.currentTime > max) this.setCurrentTime(max);
  }

  // ─── zoom ────────────────────────────────────────────────────────────────

  /**
   * @param {number} zoom          new zoom value
   * @param {number|null} pivotX   viewport x-coordinate to keep fixed (null = don't adjust scroll)
   * @param {boolean} fromSlider   true when called by the slider (skip slider update)
   */
  setZoom(zoom, pivotX = null, fromSlider = false) {
    const oldZoom = this._zoom;
    const newZoom = clamp(zoom, this.minZoom, this.maxZoom);
    if (Math.abs(oldZoom - newZoom) < 1e-6) return;

    let pivotTime = null;
    if (pivotX !== null) {
      pivotTime = (this.scrollEl.scrollLeft + pivotX) / (BASE_PPS * oldZoom);
    }

    this._zoom = newZoom;
    this._syncContentWidth();
    this.tracks.forEach(t => t.refreshClips());
    this._playhead.update();

    if (pivotTime !== null) {
      this.scrollEl.scrollLeft = Math.max(0, pivotTime * this.pixelsPerSecond - pivotX);
    }

    this._ruler.render();

    if (!fromSlider) this._zoomSlider.value = Math.log2(newZoom);
    this._zoomLabel.textContent = `${newZoom.toFixed(1)}×`;

    this.emit('zoomchange', { zoom: newZoom });
  }

  getZoom() { return this._zoom; }

  /**
   * Format a time value (seconds) using the timeline's configured timeFormat.
   * 'frames' (default) → "m:ss.ff"  e.g. "0:01.12" at 24 fps
   * 'ms'               → "m:ss.mmm" e.g. "0:01.500"
   */
  formatTime(secs) {
    return _formatTime(secs, this.timeFormat === 'frames' ? this.fps : null);
  }

  // ─── serialization ────────────────────────────────────────────────────────

  toJSON() {
    return { duration: this.duration, zoom: this._zoom, currentTime: this.currentTime, tracks: this.tracks.map(t => t.toJSON()) };
  }

  // ─── destroy ──────────────────────────────────────────────────────────────

  destroy() {
    this.pause();
    window.removeEventListener('keydown', this._onKey, true);
    this._ro?.disconnect();
    this.removeAllListeners();
    this._container.innerHTML = '';
    this._container.classList.remove('tl-root');
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function icon(name) {
  return iconHtml(name, 14) || name;
}
