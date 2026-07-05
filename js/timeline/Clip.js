import { EventEmitter } from './EventEmitter.js';
import { generateId, clamp, generateWaveform } from './utils.js';

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

    this._setupDrag(el, body, lh, rh);
    return el;
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
      this._thumbRow.style.backgroundImage = `url(${this.thumbnail})`;
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
      this.track.timeline.selectClip(this, { additive: e.ctrlKey || e.metaKey });
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
    const startTime = this.startTime;
    const origTrack = this.track;
    let liveTrack = this.track;
    let lastEvent = e;
    let raf = 0;

    tl.emit('clip:movestart', { clip: this, track: origTrack });

    this.el.classList.add('dragging', 'no-transition');

    const apply = () => {
      raf = 0;
      const e = lastEvent;
      let desiredStart = this._snap(startTime + (e.clientX - startX) / pps);
      desiredStart = Math.max(0, Math.min(tl.duration - this.duration, desiredStart));
      const hovered = tl._findTrackAtY(e.clientY, origTrack.type) || liveTrack;
      if (hovered !== liveTrack) {
        liveTrack._setDropTarget(false);
        liveTrack = hovered;
        if (liveTrack !== origTrack) liveTrack._setDropTarget(true);
        liveTrack.el.appendChild(this.el);
      }
      const valid = liveTrack._constrainClip(this, desiredStart);
      if (valid !== null) this.startTime = valid;
      const color = this.color || liveTrack.color;
      this.el.style.cssText =
        `left:${this.startTime * tl.pixelsPerSecond}px;width:${this.duration * tl.pixelsPerSecond}px;--clip-color:${color}`;
      tl.emit('clip:move', { clip: this, track: liveTrack });
    };

    const onMove = (ev) => {
      lastEvent = ev;
      if (!raf) raf = requestAnimationFrame(apply);
    };

    const onUp = () => {
      if (raf) cancelAnimationFrame(raf);
      apply();
      this.el.classList.remove('dragging', 'no-transition');
      liveTrack._setDropTarget(false);

      if (liveTrack !== origTrack) {
        origTrack.clips = origTrack.clips.filter(c => c.id !== this.id);
        liveTrack.clips.push(this);
        this.track = liveTrack;
        tl.emit('clip:trackchange', { clip: this, from: origTrack, to: liveTrack });
      }
      this._applyPosition();
      tl.emit('clip:moveend', { clip: this, track: liveTrack, moved: this.startTime !== startTime || liveTrack !== origTrack });

      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
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

    this.el.classList.add('resizing', 'no-transition');
    tl.emit('clip:resizestart', { clip: this, track: this.track });

    const others = this.track.clips
      .filter(c => c.id !== this.id)
      .sort((a, b) => a.startTime - b.startTime);

    const prevClip = [...others].reverse().find(c => c.endTime <= origStart + 0.001) ?? null;
    const nextClip = others.find(c => c.startTime >= origStart + origDur - 0.001) ?? null;

    const apply = () => {
      raf = 0;
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
        let newStart = this._snap(clamp(origStart + dt, minStart, origStart + origDur - MIN_DURATION));
        this.duration = origDur - (newStart - origStart);
        this.sourceOffset = origSourceOffset + (newStart - origStart);
        this.startTime = newStart;
      } else {
        // Dragging right reveals later source content; it can't go past
        // however much of the source remains after the current offset.
        const maxEnd = Math.min(
          nextClip ? nextClip.startTime : tl.duration,
          origStart + (this.sourceDuration - origSourceOffset),
        );
        const newDur = this._snap(clamp(origDur + dt, MIN_DURATION, maxEnd - origStart));
        this.duration = Math.max(MIN_DURATION, newDur);
      }
      this._applyPosition();
      tl.emit('clip:resize', { clip: this, track: this.track });
    };

    const onMove = (ev) => {
      lastEvent = ev;
      if (!raf) raf = requestAnimationFrame(apply);
    };

    const onUp = () => {
      if (raf) cancelAnimationFrame(raf);
      apply();
      this.el.classList.remove('resizing', 'no-transition');
      tl.emit('clip:resizeend', {
        clip: this,
        track: this.track,
        moved: this.startTime !== origStart || this.duration !== origDur,
      });
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  _applyPosition() {
    const pps = this.track.timeline.pixelsPerSecond;
    const color = this.color || this.track.color;
    this.el.style.cssText = `left:${this.startTime * pps}px;width:${this.duration * pps}px;--clip-color:${color}`;
    if (this._durEl) this._durEl.textContent = this.track.timeline.formatTime(this.duration);
  }

  setSelected(sel) {
    this.selected = sel;
    this.el.classList.toggle('selected', sel);
  }

  toJSON() {
    return { id: this.id, name: this.name, startTime: this.startTime, duration: this.duration, src: this.src, thumbnail: this.thumbnail };
  }
}
