import { EventEmitter } from './EventEmitter.js';
import { generateId, clamp, generateWaveform, bindDragSession } from './utils.js';

const MIN_DURATION = 0.05; // seconds

export class Clip extends EventEmitter {
  constructor(track, data) {
    super();
    this.id = data.id || generateId('clip');
    this.track = track;
    this.name = data.name || 'Clip';
    this.startTime = data.startTime ?? 0;
    this.duration = data.duration ?? 5;
    // Total length of the underlying source (e.g. an audio file) and how far
    // into it this clip's visible window currently starts. Trimming either
    // handle can reveal more of the source but never fabricate content past
    // sourceDuration or before offset 0.
    this.sourceDuration = data.sourceDuration ?? Infinity;
    this.sourceOffset = data.sourceOffset ?? 0;
    this.src = data.src || null;
    this.thumbnail = data.thumbnail || null;
    this.color = data.color || null;
    this.selected = false;
    // Audio-track fade envelopes (seconds). Visual clips ignore these.
    this.fadeIn = Math.max(0, Number(data.fadeIn) || 0);
    this.fadeOut = Math.max(0, Number(data.fadeOut) || 0);
    // Only image/video clips with an embedded audio track show the
    // waveform row; plain images never do.
    this.hasAudio = !!data.hasAudio;
    this._waveform = data.waveformPeaks?.length
      ? data.waveformPeaks
      : generateWaveform(this.id.charCodeAt(5) || 42);
    this.el = this._build();
  }

  get endTime() { return this.startTime + this.duration; }

  _snap(secs) {
    const fps = Math.max(1, this.track.timeline.fps || 24);
    const step = 1 / fps;
    return Math.round(secs / step) * step;
  }

  _build() {
    const el = document.createElement('div');
    el.className = 'tl-clip';
    el.dataset.clipId = this.id;

    const lh = document.createElement('div');
    lh.className = 'tl-clip-handle tl-clip-handle-l';
    lh.innerHTML = '<span></span>';

    const rh = document.createElement('div');
    rh.className = 'tl-clip-handle tl-clip-handle-r';
    rh.innerHTML = '<span></span>';

    const body = document.createElement('div');
    body.className = 'tl-clip-body';

    if (this.track.type === 'image' || this.track.type === 'video') {
      this._buildRows(body);
    } else {
      if (this.thumbnail) {
        body.style.backgroundImage = `url(${this.thumbnail})`;
        body.style.backgroundSize = 'cover';
        body.style.backgroundPosition = 'center';
      }

      const label = document.createElement('div');
      label.className = 'tl-clip-label';
      label.textContent = this.name;
      body.appendChild(label);

      // Waveform for audio tracks
      if (this.track.type === 'audio') {
        body.appendChild(this._buildWaveform());
      }
    }

    el.appendChild(lh);
    el.appendChild(body);
    el.appendChild(rh);
    // Fade overlays sit on the clip root (above trim handles) so bottom
    // corner hits don't steal into left/right duration resize.
    if (this.track.type === 'audio') {
      el.classList.add('tl-clip-audio');
      this._buildFadeOverlays(el);
    }

    this._setupDrag(el, body, lh, rh);
    return el;
  }

  /** CapCut-style fade-in / fade-out overlays + drag handles (audio only). */
  _buildFadeOverlays(host) {
    const mk = (side) => {
      const wrap = document.createElement('div');
      wrap.className = `tl-clip-fade tl-clip-fade-${side}`;
      const diag = document.createElement('div');
      diag.className = 'tl-clip-fade-diag';
      const handle = document.createElement('div');
      handle.className = 'tl-clip-fade-handle';
      handle.title = side === 'in' ? 'Fade in' : 'Fade out';
      wrap.appendChild(diag);
      wrap.appendChild(handle);
      handle.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        if (this.track.locked) return;
        this._dragFade(e, side);
      });
      return wrap;
    };
    this._fadeInEl = mk('in');
    this._fadeOutEl = mk('out');
    host.appendChild(this._fadeInEl);
    host.appendChild(this._fadeOutEl);
    this._clampFades();
    this._updateFadeUI();
  }

  _clampFades() {
    if (this.track.type !== 'audio') {
      this.fadeIn = 0;
      this.fadeOut = 0;
      return;
    }
    const d = Math.max(0, this.duration);
    let fi = Math.max(0, this.fadeIn || 0);
    let fo = Math.max(0, this.fadeOut || 0);
    if (fi + fo > d) {
      if (d <= 0) {
        fi = 0;
        fo = 0;
      } else {
        const s = d / (fi + fo);
        fi *= s;
        fo *= s;
      }
    }
    this.fadeIn = fi;
    this.fadeOut = fo;
  }

  _updateFadeUI() {
    if (!this._fadeInEl || !this._fadeOutEl) return;
    const pps = this.track.timeline.pixelsPerSecond;
    const fiPx = Math.max(0, (this.fadeIn || 0) * pps);
    const foPx = Math.max(0, (this.fadeOut || 0) * pps);
    const inActive = fiPx > 0.5;
    const outActive = foPx > 0.5;
    // When fade is 0, park a small hit strip inset past the trim handles
    // (9px) so duration resize and fade don't fight over the same corner.
    const parkW = 14;
    this._fadeInEl.style.width = `${inActive ? Math.max(fiPx, 1) : parkW}px`;
    this._fadeOutEl.style.width = `${outActive ? Math.max(foPx, 1) : parkW}px`;
    this._fadeInEl.classList.toggle('active', inActive);
    this._fadeOutEl.classList.toggle('active', outActive);
    this._fadeInEl.classList.toggle('parked', !inActive);
    this._fadeOutEl.classList.toggle('parked', !outActive);
    const inHandle = this._fadeInEl.querySelector('.tl-clip-fade-handle');
    const outHandle = this._fadeOutEl.querySelector('.tl-clip-fade-handle');
    if (inHandle) {
      if (inActive) {
        inHandle.style.left = 'auto';
        inHandle.style.right = '0';
      } else {
        // Inset past left trim handle.
        inHandle.style.left = '2px';
        inHandle.style.right = 'auto';
      }
    }
    if (outHandle) {
      if (outActive) {
        outHandle.style.left = '0';
        outHandle.style.right = 'auto';
      } else {
        outHandle.style.left = 'auto';
        outHandle.style.right = '2px';
      }
    }
  }

  _dragFade(e, side) {
    const tl = this.track.timeline;
    const pps = tl.pixelsPerSecond;
    const startX = e.clientX;
    const origIn = this.fadeIn || 0;
    const origOut = this.fadeOut || 0;
    const dur = this.duration;
    let lastEvent = e;
    let raf = 0;
    const MOVE_THRESHOLD_PX = 2;
    let dragging = false;

    const apply = () => {
      raf = 0;
      if (!dragging) return;
      const dx = (lastEvent.clientX - startX) / pps;
      if (side === 'in') {
        const maxIn = Math.max(0, dur - origOut);
        this.fadeIn = this._snap(clamp(origIn + dx, 0, maxIn));
      } else {
        const maxOut = Math.max(0, dur - origIn);
        this.fadeOut = this._snap(clamp(origOut - dx, 0, maxOut));
      }
      this._clampFades();
      this._updateFadeUI();
      tl.emit('clip:fade', { clip: this, track: this.track, side });
    };

    const onMove = (ev) => {
      lastEvent = ev;
      if (!dragging) {
        if (Math.abs(ev.clientX - startX) < MOVE_THRESHOLD_PX) return;
        dragging = true;
        this.el.classList.add('fading', 'no-transition');
        tl.emit('clip:fadestart', { clip: this, track: this.track, side });
      }
      if (!raf) raf = requestAnimationFrame(apply);
    };

    const onUp = () => {
      if (raf) cancelAnimationFrame(raf);
      if (!dragging) return;
      apply();
      this.el.classList.remove('fading', 'no-transition');
      const moved = side === 'in'
        ? this.fadeIn !== origIn
        : this.fadeOut !== origOut;
      tl.emit('clip:fadeend', { clip: this, track: this.track, side, moved });
    };

    bindDragSession(e, { onMove, onEnd: onUp });
  }

  /**
   * Image/video clip body split into 3 stacked rows: name + duration,
   * thumbnail, and (when applicable) the embedded audio waveform.
   */
  _buildRows(body) {
    body.classList.add('tl-clip-rows');

    const infoRow = document.createElement('div');
    infoRow.className = 'tl-clip-row tl-clip-row-info';

    const label = document.createElement('div');
    label.className = 'tl-clip-label';
    label.textContent = this.name;
    infoRow.appendChild(label);

    this._durEl = document.createElement('div');
    this._durEl.className = 'tl-clip-row-duration';
    this._durEl.textContent = this.track.timeline.formatTime(this.duration);
    infoRow.appendChild(this._durEl);

    this._thumbRow = document.createElement('div');
    this._thumbRow.className = 'tl-clip-row tl-clip-row-thumb';
    this._applyThumbnail();

    this._waveRow = document.createElement('div');
    this._waveRow.className = 'tl-clip-row tl-clip-row-wave';
    this._refreshWaveRow();

    body.appendChild(infoRow);
    body.appendChild(this._thumbRow);
    body.appendChild(this._waveRow);
  }

  /** Re-apply the thumbnail background onto the thumbnail row (row 2). */
  _applyThumbnail() {
    if (!this._thumbRow) return;
    if (this.thumbnail) {
      // Quote the URL — filenames often contain spaces (breaks unquoted css url()).
      const src = String(this.thumbnail).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      this._thumbRow.style.backgroundImage = `url("${src}")`;
      if (this.track.type === 'image') {
        this._thumbRow.style.backgroundSize = 'auto 100%';
        this._thumbRow.style.backgroundRepeat = 'repeat-x';
        this._thumbRow.style.backgroundPosition = 'left center';
      } else {
        this._thumbRow.style.backgroundSize = 'cover';
        this._thumbRow.style.backgroundRepeat = 'no-repeat';
        this._thumbRow.style.backgroundPosition = 'center';
      }
    } else {
      this._thumbRow.style.backgroundImage = '';
    }
  }

  /** Row 3 stays blank unless this clip actually has an embedded audio track. */
  _refreshWaveRow() {
    if (!this._waveRow) return;
    this._waveRow.replaceChildren();
    this._waveRow.classList.toggle('has-audio', this.hasAudio);
    if (this.hasAudio) {
      this._waveRow.appendChild(this._buildWaveform());
    }
  }

  _buildWaveform() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'tl-clip-waveform');
    svg.setAttribute('viewBox', `0 0 ${this._waveform.length} 1`);
    svg.setAttribute('preserveAspectRatio', 'none');

    const top = this._waveform.map((v, i) => `${i},${0.5 - v * 0.45}`).join(' ');
    const bot = [...this._waveform].reverse().map((v, i) =>
      `${this._waveform.length - 1 - i},${0.5 + v * 0.45}`).join(' ');

    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    poly.setAttribute('points', `${top} ${bot}`);
    poly.setAttribute('fill', 'rgba(255,255,255,0.35)');
    poly.setAttribute('stroke', 'none');
    svg.appendChild(poly);
    return svg;
  }

  _setupDrag(el, body, lh, rh) {
    const canEdit = () => !this.track.locked;

    body.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      // Keep select errors from blocking the drag session (panel sync can throw).
      try {
        this.track.timeline.selectClip(this, { additive: e.ctrlKey || e.metaKey });
      } catch (err) {
        console.error('[CapTE] selectClip failed', err);
      }
      if (!canEdit()) return;
      this._dragMove(e);
    });

    lh.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      if (!canEdit()) return;
      this._dragTrim(e, 'left');
    });

    rh.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      if (!canEdit()) return;
      this._dragTrim(e, 'right');
    });
  }

  _dragMove(e) {
    const tl = this.track.timeline;
    const pps = tl.pixelsPerSecond;
    const startX = e.clientX;
    const startY = e.clientY;
    const startTime = this.startTime;
    const origTrack = this.track;
    let liveTrack = this.track;
    let lastEvent = e;
    let raf = 0;
    // Click (no real drag) must not run overlap constraint — oversized
    // durations would otherwise teleport the clip to the track tail.
    const MOVE_THRESHOLD_PX = 4;
    let dragging = false;

    const apply = () => {
      raf = 0;
      if (!dragging) return;
      const e = lastEvent;
      let desiredStart = this._snap(startTime + (e.clientX - startX) / pps);
      // Don't pull an already-placed clip backward just because it overhangs
      // the timeline end (duration longer than remaining timeline length).
      const maxStart = Math.max(0, tl.duration - this.duration);
      desiredStart = Math.max(0, Math.min(Math.max(maxStart, startTime), desiredStart));
      const hovered = tl._findTrackAtY(e.clientY, origTrack.type) || liveTrack;
      if (hovered !== liveTrack) {
        liveTrack._setDropTarget(false);
        liveTrack = hovered;
        if (liveTrack !== origTrack) liveTrack._setDropTarget(true);
        liveTrack.el.appendChild(this.el);
      }
      const snapped = tl._snapMoveToClipEdges(this, desiredStart);
      desiredStart = snapped.start;
      const valid = liveTrack._constrainClip(this, desiredStart, { homeStart: startTime });
      if (valid !== null) this.startTime = valid;
      const guide = tl._alignedClipEdge(this);
      if (guide != null) tl._showSnapGuide(guide);
      else tl._hideSnapGuide();
      const color = this.color || liveTrack.color;
      this.el.style.cssText =
        `left:${this.startTime * tl.pixelsPerSecond}px;width:${this.duration * tl.pixelsPerSecond}px;--clip-color:${color}`;
      tl.emit('clip:move', { clip: this, track: liveTrack });
    };

    const onMove = (ev) => {
      lastEvent = ev;
      if (!dragging) {
        const dx = Math.abs(ev.clientX - startX);
        const dy = Math.abs(ev.clientY - startY);
        if (dx < MOVE_THRESHOLD_PX && dy < MOVE_THRESHOLD_PX) return;
        dragging = true;
        this.el.classList.add('dragging', 'no-transition');
        tl.emit('clip:movestart', { clip: this, track: origTrack });
      }
      if (!raf) raf = requestAnimationFrame(apply);
    };

    const onUp = () => {
      if (raf) cancelAnimationFrame(raf);
      if (!dragging) return;
      apply();
      tl._hideSnapGuide();
      this.el.classList.remove('dragging', 'no-transition');
      liveTrack._setDropTarget(false);

      if (liveTrack !== origTrack) {
        origTrack.clips = origTrack.clips.filter(c => c.id !== this.id);
        liveTrack.clips.push(this);
        this.track = liveTrack;
        tl.emit('clip:trackchange', { clip: this, from: origTrack, to: liveTrack });
      }
      this._applyPosition();
      tl.emit('clip:moveend', {
        clip: this,
        track: liveTrack,
        moved: this.startTime !== startTime || liveTrack !== origTrack,
      });
    };

    bindDragSession(e, { onMove, onEnd: onUp });
  }

  _dragTrim(e, side) {
    const tl = this.track.timeline;
    const pps = tl.pixelsPerSecond;
    const startX = e.clientX;
    const origStart = this.startTime;
    const origDur = this.duration;
    const origSourceOffset = this.sourceOffset;
    let lastEvent = e;
    let raf = 0;
    // Pure click on a handle must not resize — snap-after-clamp can otherwise
    // grow duration past the next clip and force a later relocate-to-tail.
    const MOVE_THRESHOLD_PX = 3;
    let resizing = false;

    const others = this.track.clips
      .filter(c => c.id !== this.id)
      .sort((a, b) => a.startTime - b.startTime);

    // Prefer non-overlapping neighbors; if we already slightly overlap (FP /
    // prior bad snap), still bind to the clip on that side so right-trim
    // cannot become unbounded for image clips (sourceDuration = Infinity).
    const EPS = 0.001;
    const prevClip = [...others].reverse().find(c => c.endTime <= origStart + EPS)
      ?? [...others].reverse().find(c => c.startTime < origStart - EPS)
      ?? null;
    const nextClip = others.find(c => c.startTime >= origStart + origDur - EPS)
      ?? others.find(c => c.startTime > origStart + EPS)
      ?? null;

    const apply = () => {
      raf = 0;
      if (!resizing) return;
      const e = lastEvent;
      const dt = (e.clientX - startX) / pps;
      if (side === 'left') {
        // Dragging left reveals earlier source content (offset shrinks);
        // it can't go past the source's own start (offset 0). Unbounded
        // clips (e.g. images, sourceDuration = Infinity) have no such limit.
        const minStart = Math.max(
          prevClip ? prevClip.endTime : 0,
          Number.isFinite(this.sourceDuration) ? origStart - origSourceOffset : -Infinity,
          0,
        );
        const maxStart = origStart + origDur - MIN_DURATION;
        let newStart = this._snap(clamp(origStart + dt, minStart, maxStart));
        newStart = tl._snapEdgeTime(this, newStart);
        newStart = clamp(newStart, minStart, maxStart);
        this.duration = origDur - (newStart - origStart);
        this.sourceOffset = origSourceOffset + (newStart - origStart);
        this.startTime = newStart;
      } else {
        // Dragging right reveals later source content; it can't go past
        // however much of the source remains after the current offset.
        const sourceMax = origStart + (this.sourceDuration - origSourceOffset);
        const maxEnd = Math.min(
          nextClip ? nextClip.startTime : tl.duration,
          sourceMax,
        );
        const minEnd = origStart + MIN_DURATION;
        let newEnd = this._snap(clamp(origStart + origDur + dt, minEnd, maxEnd));
        newEnd = tl._snapEdgeTime(this, newEnd);
        newEnd = clamp(newEnd, minEnd, maxEnd);
        this.duration = newEnd - origStart;
      }
      this._clampFades();
      this._applyPosition();
      const edge = side === 'left' ? this.startTime : this.endTime;
      const guide = tl._alignedClipEdge(this, edge);
      if (guide != null) tl._showSnapGuide(guide);
      else tl._hideSnapGuide();
      tl.emit('clip:resize', { clip: this, track: this.track });
    };

    const onMove = (ev) => {
      lastEvent = ev;
      if (!resizing) {
        if (Math.abs(ev.clientX - startX) < MOVE_THRESHOLD_PX) return;
        resizing = true;
        this.el.classList.add('resizing', 'no-transition');
        tl.emit('clip:resizestart', { clip: this, track: this.track });
      }
      if (!raf) raf = requestAnimationFrame(apply);
    };

    const onUp = () => {
      if (raf) cancelAnimationFrame(raf);
      if (!resizing) return;
      apply();
      tl._hideSnapGuide();
      this.el.classList.remove('resizing', 'no-transition');
      tl.emit('clip:resizeend', {
        clip: this,
        track: this.track,
        moved: this.startTime !== origStart || this.duration !== origDur,
      });
    };

    bindDragSession(e, { onMove, onEnd: onUp });
  }

  _applyPosition() {
    const pps = this.track.timeline.pixelsPerSecond;
    const color = this.color || this.track.color;
    this.el.style.cssText = `left:${this.startTime * pps}px;width:${this.duration * pps}px;--clip-color:${color}`;
    if (this._durEl) this._durEl.textContent = this.track.timeline.formatTime(this.duration);
    this._clampFades();
    this._updateFadeUI();
  }

  setSelected(sel) {
    this.selected = sel;
    this.el.classList.toggle('selected', sel);
  }

  toJSON() {
    return { id: this.id, name: this.name, startTime: this.startTime, duration: this.duration, src: this.src, thumbnail: this.thumbnail };
  }
}
