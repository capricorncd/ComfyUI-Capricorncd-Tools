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
    const frame = Math.floor((s % 1) * fps);
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

const SVG_ATTRS = 'viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';

/** Small, self-contained SVG icon set (no external assets) for track headers/controls. */
export const ICONS = {
  lock: `<svg ${SVG_ATTRS}><rect x="3.5" y="7" width="9" height="6.5" rx="1.4"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>`,
  eye: `<svg ${SVG_ATTRS}><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5Z"/><circle cx="8" cy="8" r="2"/></svg>`,
  eyeOff: `<svg ${SVG_ATTRS}><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5Z"/><circle cx="8" cy="8" r="2"/><path d="M2 2l12 12"/></svg>`,
  volume: `<svg ${SVG_ATTRS}><path d="M2 6.2h2.6L8 3.5v9L4.6 9.8H2z" fill="currentColor" stroke="none"/><path d="M10.8 5.6a3.4 3.4 0 0 1 0 4.8M12.6 3.8a6 6 0 0 1 0 8.4"/></svg>`,
  volumeOff: `<svg ${SVG_ATTRS}><path d="M2 6.2h2.6L8 3.5v9L4.6 9.8H2z" fill="currentColor" stroke="none"/><path d="M11 6l4 4M15 6l-4 4"/></svg>`,
  trackType: {
    image: `<svg ${SVG_ATTRS}><rect x="1.5" y="2.5" width="13" height="11" rx="1.4"/><circle cx="5.2" cy="6" r="1.1" fill="currentColor" stroke="none"/><path d="M2 12l4-4 2.5 2.5L11 7l3 5"/></svg>`,
    audio: `<svg ${SVG_ATTRS}><path d="M6 11.5V3.2l7-1.4v8"/><circle cx="4.3" cy="11.7" r="2" fill="currentColor" stroke="none"/><circle cx="11.3" cy="9.8" r="2" fill="currentColor" stroke="none"/></svg>`,
    video: `<svg ${SVG_ATTRS}><rect x="1.5" y="2.5" width="13" height="11" rx="1.4"/><path d="M6.5 5.5l4 2.5-4 2.5z" fill="currentColor" stroke="none"/></svg>`,
    text: `<svg ${SVG_ATTRS}><path d="M3 3.5h10M8 3.5v9"/></svg>`,
  },
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
