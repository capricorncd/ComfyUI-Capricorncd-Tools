import { EventEmitter } from './EventEmitter.js';
import { generateId, TRACK_TYPES, ICONS } from './utils.js';
import { Clip } from './Clip.js';

export class Track extends EventEmitter {
  constructor(timeline, data) {
    super();
    this.id = data.id || generateId('track');
    this.timeline = timeline;
    this.type = data.type || 'video';
    const meta = TRACK_TYPES[this.type] || TRACK_TYPES.video;
    this.name = data.name || meta.label;
    this.height = data.height || meta.height;
    this.color = data.color || meta.color;
    this.isMain = data.isMain ?? false;
    this.locked = data.locked ?? false;
    this.visible = data.visible ?? true;
    this.muted = data.muted ?? false;
    this.clips = [];

    this.el = this._buildTrack();
    this.headerEl = this._buildHeader();
    if (this.isMain) this._applyMainStyle();
  }

  _buildTrack() {
    const el = document.createElement('div');
    el.className = `tl-track tl-track-${this.type}`;
    el.dataset.trackId = this.id;
    el.style.height = `${this.height}px`;
    return el;
  }

  _buildHeader() {
    const el = document.createElement('div');
    el.className = `tl-track-header tl-track-header-${this.type}`;
    el.dataset.trackId = this.id;
    el.style.height = `${this.height}px`;
    el.style.setProperty('--track-color', this.color);
    el.title = this.name;

    const icon = document.createElement('span');
    icon.className = 'tl-track-icon';
    icon.innerHTML = ICONS.trackType[this.type] || ICONS.trackType.video;

    // Icon-only header — no visible name/type text (hover the row for its
    // name via the title tooltip). This spacer just pushes the action
    // icons to the right edge.
    const spacer = document.createElement('div');
    spacer.className = 'tl-track-spacer';

    const actions = document.createElement('div');
    actions.className = 'tl-track-actions';

    el.appendChild(icon);
    el.appendChild(spacer);
    el.appendChild(actions);
    this._actionsEl = actions;
    return el;
  }

  get actionsEl() { return this._actionsEl; }

  setLocked(v) {
    this.locked = !!v;
    this.el.classList.toggle('tl-track-locked', this.locked);
    this.headerEl.classList.toggle('tl-track-locked', this.locked);
  }

  setVisible(v) {
    this.visible = !!v;
    this.el.classList.toggle('tl-track-hidden', !this.visible);
    this.headerEl.classList.toggle('tl-track-hidden', !this.visible);
  }

  setMuted(v) {
    this.muted = !!v;
    this.el.classList.toggle('tl-track-muted', this.muted);
    this.headerEl.classList.toggle('tl-track-muted', this.muted);
  }

  /** Apply or re-apply the visual main-track indicators. */
  _applyMainStyle() {
    this.isMain = true;
    this.el.classList.add('tl-track-main');
    this.headerEl.classList.add('tl-track-header-main');
    this.headerEl.title = `${this.name} (MAIN)`;
  }

  addClip(data) {
    if (this.locked) return null;
    const clip = new Clip(this, data);
    this.clips.push(clip);
    this.el.appendChild(clip.el);
    clip._applyPosition();
    return clip;
  }

  removeClip(clipId) {
    const idx = this.clips.findIndex(c => c.id === clipId);
    if (idx === -1) return false;
    this.clips[idx].el.remove();
    this.clips.splice(idx, 1);
    return true;
  }

  getClip(clipId) { return this.clips.find(c => c.id === clipId); }

  refreshClips() { this.clips.forEach(c => c._applyPosition()); }

  /**
   * Find the nearest valid startTime for `clip` on this track so it doesn't
   * overlap any other clip.  Returns null if there is no room at all.
   */
  _constrainClip(clip, desiredStart) {
    const others = this.clips
      .filter(c => c.id !== clip.id)
      .sort((a, b) => a.startTime - b.startTime);
    const dur = clip.duration;
    const tMax = this.timeline.duration;

    // Build free intervals on this track
    const slots = [];
    let prev = 0;
    for (const c of others) {
      if (c.startTime > prev) slots.push([prev, c.startTime]);
      prev = c.endTime;
    }
    if (prev < tMax) slots.push([prev, tMax]);

    // Keep only slots that are wide enough
    const fittable = slots.filter(([s, e]) => e - s >= dur);
    if (fittable.length === 0) return null;

    // If desired position fits directly in a slot, use it
    for (const [s, e] of fittable) {
      if (desiredStart >= s && desiredStart + dur <= e) return desiredStart;
    }

    // Otherwise snap to the nearest slot edge
    let best = null, bestDist = Infinity;
    for (const [s, e] of fittable) {
      const maxStart = e - dur;
      const clamped = Math.max(s, Math.min(maxStart, desiredStart));
      const dist = Math.abs(clamped - desiredStart);
      if (dist < bestDist) { bestDist = dist; best = clamped; }
    }
    return best;
  }

  /** Highlight this track as a valid drop target during cross-track drag. */
  _setDropTarget(active) {
    this.el.classList.toggle('drop-target', active);
    this.headerEl.classList.toggle('drop-target', active);
  }

  destroy() {
    this.el.remove();
    this.headerEl.remove();
    this.clips = [];
    this.removeAllListeners();
  }

  toJSON() {
    return { id: this.id, type: this.type, name: this.name, clips: this.clips.map(c => c.toJSON()) };
  }
}
