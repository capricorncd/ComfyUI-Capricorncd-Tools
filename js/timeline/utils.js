export { ICONS } from "../cap_icons.js";

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

export const TRACK_TYPES = {
  video: { label: 'Video',  color: '#4a9eff', icon: '▶', height: 76 },
  audio: { label: '音频轨道',  color: '#3dd68c', icon: '♫', height: 60 },
  image: { label: '图片轨道',  color: '#c86aff', icon: '⬛', height: 76 },
  text:  { label: 'Text',   color: '#ff9e4a', icon: 'T',  height: 52 },
};

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
 */
export function bindDragSession(startEvent, { onMove, onEnd }) {
  let ended = false;
  const captureTarget = startEvent.currentTarget ?? startEvent.target;

  const finish = (ev) => {
    if (ended) return;
    ended = true;
    teardown();
    onEnd(ev);
  };

  const move = (ev) => {
    if (!ended) onMove(ev);
  };

  const teardown = () => {
    window.removeEventListener('mousemove', move, true);
    window.removeEventListener('mouseup', finish, true);
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', finish, true);
    window.removeEventListener('pointercancel', finish, true);
    window.removeEventListener('blur', finish);
    document.removeEventListener('mouseleave', finish, true);
    if (captureTarget?.releasePointerCapture && startEvent.pointerId != null) {
      try { captureTarget.releasePointerCapture(startEvent.pointerId); } catch { /* ignore */ }
    }
  };

  if (startEvent.pointerId != null && captureTarget?.setPointerCapture) {
    try { captureTarget.setPointerCapture(startEvent.pointerId); } catch { /* ignore */ }
    captureTarget.addEventListener('lostpointercapture', finish, { once: true });
  }

  window.addEventListener('mousemove', move, true);
  window.addEventListener('mouseup', finish, true);
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', finish, true);
  window.addEventListener('pointercancel', finish, true);
  window.addEventListener('blur', finish);
  document.addEventListener('mouseleave', finish, true);

  return finish;
}
