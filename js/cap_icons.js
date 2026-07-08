/** Shared SVG icons for Capricorncd Tools (no external assets). */

export const SVG_ATTRS =
    'viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';

export const ICONS = {
    close: `<svg ${SVG_ATTRS}><path d="M4 4l8 8M12 4l-8 8"/></svg>`,
    play: `<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>`,
    pause: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="3" width="4" height="18"/><rect x="15" y="3" width="4" height="18"/></svg>`,
    stop: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16"/></svg>`,
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
 * @param {string} name  Top-level icon name or `trackType.<type>`.
 * @param {number} [size=16]
 */
export function iconHtml(name, size = 16) {
    let svg = ICONS[name];
    if (!svg && name.startsWith("trackType.")) {
        svg = ICONS.trackType?.[name.slice("trackType.".length)];
    }
    if (!svg) return "";
    if (size === 16 && svg.includes(SVG_ATTRS)) return svg;
    return svg.replace(
        /viewBox="([^"]+)"/,
        `width="${size}" height="${size}" viewBox="$1"`,
    );
}
