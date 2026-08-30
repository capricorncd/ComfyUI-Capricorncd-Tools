export { ICONS } from "../cap_icons.js";
import { t as i18nT } from "../i18n/timeline_widget.js";

let _id = 0;
export const generateId = (p = 'tl') => `${p}_${++_id}_${Date.now().toString(36)}`;

export const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/**
 * Format seconds as a time string.
 * @param {number} secs
 * @param {number|null} fps  When provided → "m:ss.ff" (frames); null → "m:ss.mmm" (milliseconds)
 */
export const formatTime = (secs, fps = null) => {
  const s = Math.abs(secs);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  if (fps != null && fps > 0) {
    const frame = Math.floor((s - Math.floor(s)) * fps + 1e-9);
    const pad = String(fps - 1).length; // 24fps→2 digits, 120fps→3 digits
    return `${m}:${String(sec).padStart(2, '0')}.${String(frame).padStart(pad, '0')}`;
  }
  const ms = Math.round((s % 1) * 1000);
  return `${m}:${String(sec).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
};

// `label` intentionally omitted here: it needs to follow ComfyUI's current
// language at the moment a track is created/listed, not whatever language
// happened to be active when this module was first imported. Use
// trackTypeLabel(type) below instead of TRACK_TYPES[type].label.
export const TRACK_TYPES = {
  video: { color: '#4a9eff', icon: '▶', height: 76 },
  audio: { color: '#3dd68c', icon: '♫', height: 60 },
  image: { color: '#c86aff', icon: '⬛', height: 76 },
  text:  { color: '#ff9e4a', icon: 'T',  height: 39 },
};

const TRACK_TYPE_LABEL_KEYS = {
  video: 'video_track',
  audio: 'audio_track',
  image: 'image_track',
  text: 'text_track',
};

/** Localized display label for a track type ('video' | 'audio' | 'image' | 'text'). */
export function trackTypeLabel(type) {
  return i18nT(TRACK_TYPE_LABEL_KEYS[type] || TRACK_TYPE_LABEL_KEYS.video);
}

/**
 * Returns major/minor tick intervals (seconds) for the given pixels-per-second.
 * Aims for ~100px between major ticks.
 */
export function getRulerInterval(pps) {
  const NICE = [
    0.001, 0.002, 0.005,
    0.01, 0.02, 0.05,
    0.1, 0.2, 0.5,
    1, 2, 5, 10, 15, 30,
    60, 120, 300, 600, 1800, 3600,
  ];
  const TARGET_PX = 100;
  let major = NICE[NICE.length - 1];
  for (const t of NICE) {
    if (t * pps >= TARGET_PX) { major = t; break; }
  }
  const minor = major / 5;
  return { major, minor };
}

/** Generate a seeded pseudo-random waveform array (0..1) of given length. */
export function generateWaveform(seed, len = 80) {
  let x = seed;
  const rand = () => { x = (x * 1664525 + 1013904223) & 0xffffffff; return (x >>> 0) / 0xffffffff; };
  const raw = Array.from({ length: len }, () => 0.15 + rand() * 0.85);
  // simple smoothing pass
  return raw.map((v, i) => {
    const a = raw[i - 1] ?? v, b = raw[i + 1] ?? v;
    return (a + v * 2 + b) / 4;
  });
}

/**
 * Bind a drag session that ends reliably even when the pointer is released
 * over overlays (sidebar, media panel, etc.) outside the timeline.
 *
 * Mouse-only: clip/trim/fade all start from `mousedown`. Mixing pointer
 * capture / pointerup / blur races with sidebar DOM updates on select and
 * can leave stuck window listeners that eat the next clicks.
 *
 * Do not listen for `mouseleave` in capture on `document`: that event fires
 * for every element the pointer exits, so the first move off a handle's
 * inner span would end the gesture before any resize/move can apply.
 */
export function bindDragSession(startEvent, { onMove, onEnd }) {
  let ended = false;

  const finish = (ev) => {
    if (ended) return;
    ended = true;
    teardown();
    onEnd(ev);
  };

  const move = (ev) => {
    if (!ended) onMove(ev);
  };

  /** End only when the pointer leaves the browser viewport. */
  const onViewportLeave = (ev) => {
    if (ev.target === document.documentElement) finish(ev);
  };

  const teardown = () => {
    window.removeEventListener('mousemove', move, true);
    window.removeEventListener('mouseup', finish, true);
    document.documentElement.removeEventListener('mouseleave', onViewportLeave);
  };

  window.addEventListener('mousemove', move, true);
  window.addEventListener('mouseup', finish, true);
  document.documentElement.addEventListener('mouseleave', onViewportLeave);

  return finish;
}
