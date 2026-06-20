/** @typedef {{ ms: number, id: string, isBoundary?: boolean }} Keyframe */

export function parseTimecode(value, fps = 24) {
    const text = String(value ?? "").trim();
    if (!text) return 0;
    fps = Math.max(1, Math.floor(fps));
    const parts = text.split(":");
    if (parts.length !== 2 && parts.length !== 3) {
        throw new Error(`Invalid timecode: ${value}`);
    }
    let hours = 0;
    let minutes;
    let secPart;
    if (parts.length === 2) {
        minutes = parseInt(parts[0], 10);
        secPart = parts[1];
    } else {
        hours = parseInt(parts[0], 10);
        minutes = parseInt(parts[1], 10);
        secPart = parts[2];
    }
    let seconds;
    let frames;
    if (secPart.includes(".")) {
        const [s, f] = secPart.split(".", 2);
        seconds = parseInt(s, 10);
        frames = parseInt(f, 10);
    } else {
        seconds = parseInt(secPart, 10);
        frames = 0;
    }
    if (
        [hours, minutes, seconds, frames].some((n) => Number.isNaN(n)) ||
        frames < 0 ||
        frames >= fps
    ) {
        throw new Error(`Invalid timecode: ${value}`);
    }
    const totalSeconds = hours * 3600 + minutes * 60 + seconds + frames / fps;
    return Math.max(0, Math.round(totalSeconds * 1000));
}

export function formatTimecode(ms, fps = 24) {
    fps = Math.max(1, Math.floor(fps));
    ms = Math.max(0, Math.floor(ms));
    const totalFrames = Math.round((ms * fps) / 1000);
    const frames = totalFrames % fps;
    const totalSeconds = Math.floor(totalFrames / fps);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const secPart = `${String(seconds).padStart(2, "0")}.${String(frames).padStart(2, "0")}`;
    if (hours > 0) {
        return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${secPart}`;
    }
    return `${String(minutes).padStart(2, "0")}:${secPart}`;
}

/** Frame count in (startMs, endMs] at given fps (matches formatTimecode rounding). */
export function segmentFrameCount(startMs, endMs, fps = 24) {
    fps = Math.max(1, Math.floor(fps));
    const a = Math.max(0, Math.round((Math.max(0, startMs) * fps) / 1000));
    const b = Math.max(0, Math.round((Math.max(0, endMs) * fps) / 1000));
    return Math.max(0, b - a);
}

export function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
}

export function parseKeyframesJson(raw) {
    try {
        const data = JSON.parse(raw || "[]");
        if (!Array.isArray(data)) return [];
        return data.map((v) => parseInt(v, 10)).filter((v) => !Number.isNaN(v));
    } catch {
        return [];
    }
}
