/**
 * Shared i18n runtime for ComfyUI-Capricorncd-Tools.
 *
 * Language follows ComfyUI's own "Comfy.Locale" setting by default. Any
 * locale ComfyUI doesn't map us to (or any string we haven't translated
 * yet) falls back to English — never to a blank string.
 *
 * Usage in a UI module:
 *
 *   import { makeT } from "../cap_i18n.js";
 *   const DICT = { en: { save: "Save" }, zh: { save: "保存" }, ja: { save: "保存" } };
 *   const t = makeT(DICT);
 *   t("save"); // -> "Save" / "保存" depending on ComfyUI's language setting
 *
 * `t()` re-reads the current locale on every call (cheap) so switching
 * ComfyUI's language and reopening a panel picks up the new language
 * without a page reload.
 */
import { app } from "../../scripts/app.js";

export const SUPPORTED_LOCALES = ["en", "zh", "ja"];
export const FALLBACK_LOCALE = "en";

const COMFY_LOCALE_SETTING_ID = "Comfy.Locale";

/**
 * Map an arbitrary locale string (from ComfyUI's setting, or the browser)
 * to one of the languages this extension ships. Anything unrecognized
 * (fr, ko, ru, zh-TW, es, ...) resolves to English, per spec: nodes show
 * English when there's no translation for the active language.
 * @param {string|null|undefined} raw
 * @returns {"en"|"zh"|"ja"}
 */
export function normalizeLocale(raw) {
    if (!raw) return FALLBACK_LOCALE;
    const lower = String(raw).trim().toLowerCase();
    if (lower.startsWith("zh")) return "zh";
    if (lower.startsWith("ja")) return "ja";
    if (lower.startsWith("en")) return "en";
    return FALLBACK_LOCALE;
}

/**
 * Current UI language, normalized to "en" | "zh" | "ja".
 * Reads ComfyUI's own "Comfy.Locale" setting (Settings > Comfy > Locale),
 * falling back to the browser language, then to English.
 * @returns {"en"|"zh"|"ja"}
 */
export function getLocale() {
    try {
        const fromComfy = app?.extensionManager?.setting?.get?.(COMFY_LOCALE_SETTING_ID);
        if (fromComfy) return normalizeLocale(fromComfy);
    } catch (e) {
        // Settings store not ready yet (very early script load) — fall through.
    }
    try {
        const fromBrowser = navigator?.language || navigator?.languages?.[0];
        if (fromBrowser) return normalizeLocale(fromBrowser);
    } catch (e) {
        // navigator unavailable in some execution contexts.
    }
    return FALLBACK_LOCALE;
}

/**
 * Build a `t(key, vars?)` translator bound to a per-module dictionary of
 * the shape `{ en: {...}, zh: {...}, ja: {...} }`. Every dictionary must
 * carry a complete "en" table — it's the guaranteed fallback both for
 * unsupported ComfyUI locales and for keys missing from zh/ja.
 * @param {Record<string, Record<string, string>>} dict
 */
export function makeT(dict) {
    const en = dict[FALLBACK_LOCALE] || {};
    return function t(key, vars) {
        const locale = getLocale();
        const table = dict[locale] || en;
        let str = table[key];
        if (str === undefined) str = en[key];
        if (str === undefined) return key;
        if (vars) {
            for (const k of Object.keys(vars)) {
                str = str.split(`{${k}}`).join(String(vars[k]));
            }
        }
        return str;
    };
}

/**
 * fetch() wrapper for this extension's own /audio_keyframe_timeline and
 * /cap API routes: attaches the current UI language as `X-Cap-Locale` so
 * the Python side (see cap_i18n.py) can localize error/status text it
 * sends back. Safe to use exactly like fetch() otherwise.
 * @param {string} url
 * @param {RequestInit} [options]
 */
export function capFetch(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (!headers.has("X-Cap-Locale")) headers.set("X-Cap-Locale", getLocale());
    return fetch(url, { ...options, headers });
}
