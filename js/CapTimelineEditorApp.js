import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { Timeline, ICONS } from "./timeline/index.js";
import { parseTimecode, formatTimecode, frameIndexFromSecs, encodeClipTimingMs, decodeClipTimingSecs } from "./timecode.js";
import { attachRichPromptHandler, setRichPromptValue, resolvePromptTextarea, updateRichPromptMirror } from "./rich_prompt.js";
import { loadExtensionCss } from "./cap_ui.js";
import { iconHtml } from "./cap_icons.js";
import { t as T } from "./i18n/timeline_editor.js";

/** Right-side empty margin as a fraction of the timeline viewport width. */
const TIMELINE_RIGHT_VIEWPORT_FRAC = 0.3;
/** Media / audio / voiceover tracks share full row height; subtitle tracks are half. */
const TRACK_HEIGHT = 78;
const SUBTITLE_TRACK_HEIGHT = TRACK_HEIGHT / 2;
const STORAGE_MEDIA_STARS = "capricorncd.timeline.media_stars";
const MEDIA_STARS_BUCKET = "comfyui-input";
const STORAGE_AUTOSAVE_INTERVAL = "cat-te-autosave-interval-sec";
const STORAGE_PROMPT_FONT_SIZE = "cat-te-prompt-font-size-px";
const DEFAULT_PROMPT_FONT_SIZE = 11;
const MIN_PROMPT_FONT_SIZE = 10;
const MAX_PROMPT_FONT_SIZE = 28;
const STORAGE_MEDIA_PANEL_W = "cat-te-media-panel-w";
const MIN_MEDIA_PANEL_W = 220;
const DEFAULT_MEDIA_PANEL_W = MIN_MEDIA_PANEL_W;
const MAX_MEDIA_PANEL_FRAC = 0.55;
const STORAGE_SIDEBAR_PANEL_W = "cat-te-sidebar-panel-w";
const MIN_SIDEBAR_PANEL_W = 220;
const DEFAULT_SIDEBAR_PANEL_W = 260;
const MAX_SIDEBAR_PANEL_FRAC = 0.45;
const STORAGE_PROGRAM_PANEL_H = "cat-te-program-panel-h";
const MIN_PROGRAM_PANEL_H = 120;
const DEFAULT_PROGRAM_PANEL_H = 240;
const MAX_PROGRAM_PANEL_FRAC = 0.7;
const STORAGE_GEN_EDIT_PREVIEW_H = "cat-te-gen-edit-preview-h";
const MIN_GEN_EDIT_PREVIEW_H = 120;
const DEFAULT_GEN_EDIT_PREVIEW_H = 280;
const MIN_GEN_EDIT_TL_H = 160;
const STORAGE_MEDIA_LIST_VIEW = "cat-te-media-list-view";
/** Per-node timeline viewport (scroll) when project settings lack it. */
const STORAGE_AI_PROMPT_MODEL = "cat-te-ai-prompt-model";
const STORAGE_AI_PROMPT_SKILL = "cat-te-ai-prompt-skill";
const STORAGE_AI_PROMPT_LANG = "cat-te-ai-prompt-lang";
const STORAGE_MODEL_PREVIEW_WORKFLOW = "cat-te-model-preview-workflow";
const STORAGE_MODEL_PREVIEW_WORKFLOW_NAME = "cat-te-model-preview-workflow-name";
const STORAGE_MODEL_PREVIEW_MODEL = "cat-te-model-preview-model";
const AI_PROMPT_LANGUAGES = ["简体中文", "繁體中文", "English", "日本語"];
const AGENT_DEFAULT_MODELS = { openai: "gpt-5.4", gemini: "gemini-3.7-flash" };
const SKILL_URL_DEFAULT = "https://github.com/T8mars/minimax-h3-prompt-skill-T8";
const DEFAULT_AUTOSAVE_INTERVAL_SEC = 5;
const MIN_AUTOSAVE_INTERVAL_SEC = 1;
const MAX_AUTOSAVE_INTERVAL_SEC = 300;
/** Must match CAP_TimelineEditor INPUT_TYPES defaults. */
const PY_SCALAR_DEFAULTS = { fps: 24, width: 1344, height: 768 };
/** Project-level prompt text fields stored under settings. */
const SETTING_PROMPT_KEYS = [
    "prepend_prompt",
    "append_prompt",
];
/**
 * Prompt parts for clip.prompt_includes and settings.prompt_concat_order.
 * Order of this constant is the default concatenation order.
 */
const PROMPT_PART_KEYS = ["clip", "detailed_description", "media"];
const PROMPT_PART_KEY_SET = new Set(PROMPT_PART_KEYS);
const DEFAULT_PROMPT_CONCAT_ORDER = [...PROMPT_PART_KEYS];
const DEFAULT_PROMPT_INCLUDES = ["clip", "detailed_description"];
const WATERMARK_FIXED_POSITIONS = [
    "top-left", "top-center", "top-right",
    "bottom-left", "bottom-center", "bottom-right",
    "center",
];
const WATERMARK_POSITIONS = new Set([...WATERMARK_FIXED_POSITIONS, "random-interval", "random-fixed"]);
const WATERMARK_POSITION_LABELS = {
    get "top-left"() { return T("wm_pos_top_left"); },
    get "top-center"() { return T("wm_pos_top_center"); },
    get "top-right"() { return T("wm_pos_top_right"); },
    get "bottom-left"() { return T("wm_pos_bottom_left"); },
    get "bottom-center"() { return T("wm_pos_bottom_center"); },
    get "bottom-right"() { return T("wm_pos_bottom_right"); },
    get "center"() { return T("wm_pos_center"); },
    get "random-interval"() { return T("wm_pos_random_interval"); },
    get "random-fixed"() { return T("wm_pos_random_fixed"); },
};
const OUTPUT_VIDEOS_TIME_RANGES = [
    { id: "1h", get label() { return T("time_range_1h"); }, hours: 1 },
    { id: "4h", get label() { return T("time_range_4h"); }, hours: 4 },
    { id: "1d", get label() { return T("time_range_1d"); }, hours: 24 },
    { id: "all", get label() { return T("time_range_all"); }, hours: null },
];
const MEDIA_LIBRARY_TABS = [
    { id: "image", get label() { return T("media_kind_image"); } },
    { id: "video", get label() { return T("media_kind_video"); } },
    { id: "audio", get label() { return T("media_kind_audio"); } },
];
const CLIP_ROLES = [
    { id: "multi_ref", get label() { return T("clip_role_multi_ref"); } },
    { id: "first_last", get label() { return T("clip_role_first_last"); } },
    { id: "t2v", get label() { return T("clip_role_t2v"); } },
    { id: "video_ref", get label() { return T("clip_role_video_ref"); } },
    { id: "video_edit", get label() { return T("clip_role_video_edit"); } },
    { id: "other", get label() { return T("clip_role_other"); } },
];
const CLIP_AGENTS = [
    { id: "MiniMaxH3", label: "MiniMaxH3" },
    { id: "LTX", label: "LTX" },
    { id: "Bernini", label: "Bernini" },
    { id: "Wan", label: "Wan" },
    { id: "other", get label() { return T("clip_role_other"); } },
];
const MEDIA_ASSET_TYPES = [
    { id: "character", get label() { return T("asset_type_character"); } },
    { id: "scene", get label() { return T("asset_type_scene"); } },
    { id: "prop", get label() { return T("asset_type_prop"); } },
    { id: "other", get label() { return T("asset_type_other"); } },
];
const DEFAULT_CLIP_NAME = "Clip";
const LEGACY_CLIP_NAMES = new Set(["Clip", "Package", "clip", "package"]);
function parseSchemaVersion(project) {
    const n = Number(project?.schema_version);
    return Number.isInteger(n) && n >= 1 ? n : 1;
}

function splitH3ProjectPrompt(value) {
    const text = String(value || "").replace(/^```[^\n]*\n?|```$/gm, "").trim();
    const pattern = /^(subject_definitions|summary|retention_analysis|detailed_description|overall_soundscape|non_diegetic_music)\s*:\s*/gmi;
    const matches = [...text.matchAll(pattern)];
    const sections = {};
    for (let index = 0; index < matches.length; index += 1) {
        const match = matches[index];
        const key = match[1].toLowerCase();
        const start = match.index + match[0].length;
        const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
        sections[key] = text.slice(start, end).trim();
    }
    const clipKeys = ["subject_definitions", "summary", "retention_analysis"];
    if (!clipKeys.every((key) => sections[key]) || !sections.detailed_description) return null;
    const soundAndMusic = ["overall_soundscape", "non_diegetic_music"]
        .filter((key) => sections[key])
        .map((key) => `${key}:\n${sections[key]}`)
        .join("\n\n");
    return {
        clipPrompt: clipKeys.map((key) => `${key}:\n${sections[key]}`).join("\n\n"),
        detailedDescription: sections.detailed_description,
        soundAndMusic,
    };
}

function joinPromptParts(...values) {
    const parts = [];
    for (const value of values) {
        const text = String(value || "").trim();
        if (text && !parts.includes(text)) parts.push(text);
    }
    return parts.join("\n\n");
}

function legacySettingPrompt(settings, key) {
    const text = String(settings[key] || "").trim();
    let prefix = String(settings[`${key}_prefix_line`] || "").trim();
    if (key === "non_diegetic_music" && prefix === "non_diegetic_music:") prefix = "";
    if (key === "style_prompt" && [
        "(填写MiniMax H3规范里的风格提示词英文：)",
        "MiniMax H3规范里的风格提示词英文标题",
    ].includes(prefix)) prefix = "Style opening:";
    if (!text || !prefix || text.startsWith(prefix)) return text;
    return `${prefix}\n\n${text}`;
}

function migrateProjectSettingPrompts(settings) {
    settings.prepend_prompt = joinPromptParts(
        settings.prepend_prompt,
        settings.prefix_prompt,
        settings.prompt_prefix,
        legacySettingPrompt(settings, "global_prompt"),
        legacySettingPrompt(settings, "style_prompt"),
    );
    settings.append_prompt = joinPromptParts(
        settings.append_prompt,
        settings.suffix_prompt,
        settings.prompt_suffix,
        legacySettingPrompt(settings, "non_diegetic_music"),
        legacySettingPrompt(settings, "negative_prompt"),
    );
    for (const key of ["global_prompt", "style_prompt", "non_diegetic_music", "negative_prompt"]) {
        delete settings[key];
        delete settings[`${key}_prefix_line`];
    }
    for (const key of ["prefix_prompt", "prompt_prefix", "suffix_prompt", "prompt_suffix"]) delete settings[key];
}

function genVideoUid() {
    return `gv_${Math.random().toString(36).slice(2, 11)}`;
}

function normalizeGeneratedVideo(row) {
    if (typeof row === "string") {
        const raw = row.trim().replace(/\\/g, "/");
        const file = normalizeOutputVideoPath(raw) || raw;
        return file
            ? {
                id: genVideoUid(),
                file,
                enabled: true,
                muted: false,
                note: "",
                prompt: "",
                duration_sec: null,
                trim_in_sec: 0,
                trim_out_sec: null,
                edit_start_sec: 0,
            }
            : null;
    }
    if (!row || typeof row !== "object") return null;
    const raw = String(row.file || row.src || "").trim().replace(/\\/g, "/");
    if (!raw) return null;
    const file = normalizeOutputVideoPath(raw) || raw;
    const durationSec = Number(row.duration_sec ?? row.durationSec);
    const trimIn = Number(row.trim_in_sec ?? row.trimInSec ?? row.trim_in ?? 0);
    const trimOutRaw = row.trim_out_sec ?? row.trimOutSec ?? row.trim_out;
    const trimOut = trimOutRaw == null || trimOutRaw === "" ? null : Number(trimOutRaw);
    return {
        id: String(row.id || "").trim() || genVideoUid(),
        file,
        enabled: row.enabled !== false,
        muted: row.muted === true,
        note: String(row.note || row.remark || ""),
        prompt: String(row.prompt || ""),
        duration_sec: Number.isFinite(durationSec) && durationSec > 0 ? durationSec : null,
        trim_in_sec: Number.isFinite(trimIn) && trimIn > 0 ? trimIn : 0,
        trim_out_sec: Number.isFinite(trimOut) && trimOut > 0 ? trimOut : null,
        edit_start_sec: (() => {
            const s = Number(row.edit_start_sec ?? row.editStartSec ?? 0);
            return Number.isFinite(s) && s > 0 ? s : 0;
        })(),
    };
}

const OUTPUT_VIDEO_EXT = /\.(mp4|webm|mov|mkv|avi|m4v)$/i;
const OUTPUT_AUDIO_EXT = /\.(wav|mp3|flac|ogg|m4a|aac|wma)$/i;
const INPUT_IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;

function mediaKindFromFilename(file, fallback = "") {
    const path = String(file || "").trim().replace(/\\/g, "/").split(/[?#]/, 1)[0];
    if (OUTPUT_VIDEO_EXT.test(path)) return "video";
    if (OUTPUT_AUDIO_EXT.test(path)) return "audio";
    if (INPUT_IMAGE_EXT.test(path)) return "image";
    const kind = String(fallback || "").toLowerCase();
    return ["image", "video", "audio"].includes(kind) ? kind : "";
}

function genAudioUid() {
    return `ga_${Math.random().toString(36).slice(2, 11)}`;
}

function normalizeGeneratedAudio(row) {
    if (typeof row === "string") {
        const raw = row.trim().replace(/\\/g, "/");
        const file = normalizeOutputVideoPath(raw) || raw;
        if (!file) return null;
        return {
            id: genAudioUid(),
            file,
            enabled: true,
            muted: false,
            note: "",
            prompt: "",
            duration_sec: null,
            trim_in_sec: 0,
            trim_out_sec: null,
            edit_start_sec: 0,
            fade_in_sec: 0,
            fade_out_sec: 0,
        };
    }
    if (!row || typeof row !== "object") return null;
    const raw = String(row.file || row.src || "").trim().replace(/\\/g, "/");
    if (!raw) return null;
    const file = normalizeOutputVideoPath(raw) || raw;
    const durationSec = Number(row.duration_sec ?? row.durationSec);
    const trimIn = Number(row.trim_in_sec ?? row.trimInSec ?? row.trim_in ?? 0);
    const trimOutRaw = row.trim_out_sec ?? row.trimOutSec ?? row.trim_out;
    const trimOut = trimOutRaw == null || trimOutRaw === "" ? null : Number(trimOutRaw);
    const fadeIn = Number(row.fade_in_sec ?? row.fadeInSec ?? row.fade_in_ms ?? row.fadeInMs);
    const fadeOut = Number(row.fade_out_sec ?? row.fadeOutSec ?? row.fade_out_ms ?? row.fadeOutMs);
    const fadeInSec = Number.isFinite(fadeIn)
        ? (row.fade_in_ms != null || row.fadeInMs != null ? fadeIn / 1000 : fadeIn)
        : 0;
    const fadeOutSec = Number.isFinite(fadeOut)
        ? (row.fade_out_ms != null || row.fadeOutMs != null ? fadeOut / 1000 : fadeOut)
        : 0;
    return {
        id: String(row.id || "").trim() || genAudioUid(),
        file,
        enabled: row.enabled !== false,
        muted: row.muted === true,
        note: String(row.note || row.remark || ""),
        prompt: String(row.prompt || ""),
        duration_sec: Number.isFinite(durationSec) && durationSec > 0 ? durationSec : null,
        trim_in_sec: Number.isFinite(trimIn) && trimIn > 0 ? trimIn : 0,
        trim_out_sec: Number.isFinite(trimOut) && trimOut > 0 ? trimOut : null,
        edit_start_sec: (() => {
            const s = Number(row.edit_start_sec ?? row.editStartSec ?? 0);
            return Number.isFinite(s) && s > 0 ? s : 0;
        })(),
        fade_in_sec: Math.max(0, fadeInSec || 0),
        fade_out_sec: Math.max(0, fadeOutSec || 0),
    };
}

function serializeGeneratedAudio(row) {
    const n = normalizeGeneratedAudio(row);
    if (!n) return null;
    const out = {
        id: n.id,
        file: n.file,
        enabled: n.enabled !== false,
        muted: n.muted === true,
        note: n.note || "",
    };
    if (n.prompt) out.prompt = n.prompt;
    if (Number.isFinite(n.duration_sec) && n.duration_sec > 0) out.duration_sec = n.duration_sec;
    if (n.trim_in_sec > 0) out.trim_in_sec = n.trim_in_sec;
    if (n.trim_out_sec != null && Number.isFinite(n.trim_out_sec)) out.trim_out_sec = n.trim_out_sec;
    if (n.edit_start_sec > 0) out.edit_start_sec = n.edit_start_sec;
    if (n.fade_in_sec > 0) out.fade_in_sec = n.fade_in_sec;
    if (n.fade_out_sec > 0) out.fade_out_sec = n.fade_out_sec;
    return out;
}

function normalizeOutputVideoPath(value) {
    let s = String(value || "").trim().replace(/\\/g, "/");
    if (!s || !OUTPUT_VIDEO_EXT.test(s)) return null;
    const marker = "/output/";
    const idx = s.toLowerCase().lastIndexOf(marker);
    if (idx >= 0) s = s.slice(idx + marker.length);
    s = s.replace(/^\/+/, "");
    // Export packages store generated videos under media/generated/; map back to output/.
    const pkg = "media/generated/";
    if (s.toLowerCase().startsWith(pkg)) s = s.slice(pkg.length);
    return s || null;
}

function loadEditorCss() {
    loadExtensionCss("cap_timeline_editor.css", "cat-te-styles");
    loadExtensionCss("timeline/timeline.css", "cat-te-tl-styles");
}

function uid() {
    return `cl_${Math.random().toString(36).slice(2, 9)}`;
}

function mediaUid() {
    return `md_${Math.random().toString(36).slice(2, 11)}`;
}

function normalizePromptConcatOrder(raw) {
    const out = [];
    const seen = new Set();
    if (Array.isArray(raw)) {
        for (const value of raw) {
            const rawKey = String(value || "").trim();
            const key = rawKey === "ai" ? "detailed_description" : rawKey;
            if (!PROMPT_PART_KEY_SET.has(key) || seen.has(key)) continue;
            seen.add(key);
            out.push(key);
        }
    }
    for (const key of DEFAULT_PROMPT_CONCAT_ORDER) {
        if (!seen.has(key)) out.push(key);
    }
    return out;
}

function normalizePromptIncludes(raw, { useAiPrompt, migrateLegacyFlags = false } = {}) {
    if (Array.isArray(raw)) {
        const seen = new Set();
        for (const value of raw) {
            const key = String(value || "").trim();
            if (!PROMPT_PART_KEY_SET.has(key) || seen.has(key)) continue;
            seen.add(key);
        }
        // Old projects wrote prompt_includes without clip/detailed_description, plus separate use_* flags.
        if (migrateLegacyFlags) {
            const hasNewKeys = seen.has("clip") || seen.has("detailed_description");
            if (!hasNewKeys) {
                seen.add("clip");
                if (useAiPrompt !== false) seen.add("detailed_description");
            } else if (useAiPrompt === true) {
                seen.add("detailed_description");
            } else if (useAiPrompt === false) {
                seen.delete("detailed_description");
            }
        }
        return PROMPT_PART_KEYS.filter((k) => seen.has(k));
    }
    if (migrateLegacyFlags || useAiPrompt !== undefined) {
        const out = [];
        out.push("clip");
        if (useAiPrompt !== false) out.push("detailed_description");
        return out;
    }
    return [...DEFAULT_PROMPT_INCLUDES];
}

function promptIncludesFromClipJson(c) {
    if (!c || typeof c !== "object") return [...DEFAULT_PROMPT_INCLUDES];
    const migrateLegacyFlags = ("use_ai_prompt" in c) || ("use_global_prompt" in c);
    if (Array.isArray(c.prompt_includes)) {
        return normalizePromptIncludes(c.prompt_includes, {
            useAiPrompt: c.use_ai_prompt,
            migrateLegacyFlags,
        });
    }
    return normalizePromptIncludes(null, {
        useAiPrompt: c.use_ai_prompt,
        migrateLegacyFlags: true,
    });
}

function defaultImageMeta(trackIndex = 0) {
    const promptIncludes = [...DEFAULT_PROMPT_INCLUDES];
    return {
        clipType: "image",
        mediaKind: "clip",
        prompt: "",
        detailedDescription: "",
        endImage: null,
        promptIncludes,
        disabled: false,
        visible: true,
        muted: false,
        headExtendSec: 0,
        tailExtendSec: 0,
        generatePreviewVideo: false,
        secondSample: false,
        h3MotionContextLength: 0,
        saveLatent: false,
        seed: -1,
        trackIndex,
        clipRole: "multi_ref",
        clipRoleCustom: "",
        agent: "MiniMaxH3",
        agentCustom: "",
        items: [],
        generatedVideos: [],
        genEditAudios: [],
        previewMode: "media",
    };
}

function normalizeClipItem(item) {
    if (!item) return null;
    if (typeof item === "string") {
        const file = item.trim();
        return file ? { id: "", kind: "image", file, useMediaPrompt: true, enabled: true } : null;
    }
    if (typeof item !== "object") return null;
    const file = String(item.file || item.src || "").trim();
    const id = String(item.id || "").trim();
    if (!file && !id) return null;
    const kind = item.kind === "video" ? "video" : item.kind === "audio" ? "audio" : "image";
    return {
        id,
        kind,
        file,
        useMediaPrompt: item.useMediaPrompt !== false,
        enabled: item.enabled !== false,
    };
}

function mediaFlagAt(flags, index) {
    if (!Array.isArray(flags) || index >= flags.length) return true;
    return flags[index] !== false;
}

function clipItemsFromLegacy(src, endImage, mediaKind) {
    const items = [];
    const start = String(src || "").trim();
    if (start) items.push({ kind: mediaKind === "video" ? "video" : "image", file: start });
    const end = String(endImage || "").trim();
    if (end && end !== start) items.push({ kind: "image", file: end });
    return items;
}

function isVisualGroupClip(meta) {
    const kind = meta?.mediaKind;
    return kind === "clip" || kind === "package" || kind === "image" || kind === "video" || !kind;
}

function isDefaultClipName(name) {
    return !name || LEGACY_CLIP_NAMES.has(String(name).trim());
}

function defaultAudioMeta(trackIndex = 2) {
    return {
        clipType: "audio",
        muted: false,
        visible: true,
        sourceDuration: 0,
        trimIn: 0,
        fadeInMs: 0,
        fadeOutMs: 0,
        trackIndex,
    };
}

function defaultVoiceoverMeta(trackIndex = 2) {
    return {
        clipType: "voiceover",
        muted: false,
        visible: true,
        disabled: false,
        prompt: "",
        stylePrompt: "",
        generatedAudios: [],
        trackIndex,
    };
}

function defaultSubtitleMeta(trackIndex = 0) {
    return {
        clipType: "subtitle",
        text: "",
        fontFamily: "",
        fontPath: "",
        fontSize: 48,
        letterSpacing: 0,
        color: "#ffffff",
        bold: false,
        italic: false,
        opacity: 1,
        strokeEnabled: true,
        strokeColor: "#000000",
        strokeWidth: 3,
        shadowEnabled: true,
        shadowColor: "rgba(0,0,0,0.75)",
        shadowBlur: 4,
        shadowOffsetX: 2,
        shadowOffsetY: 2,
        align: "center",
        vAlign: "bottom",
        offsetX: 0,
        offsetY: 8,
        disabled: false,
        visible: true,
        trackIndex,
    };
}

const SUBTITLE_STYLE_KEYS = [
    "fontFamily", "fontPath", "fontSize", "letterSpacing", "color", "bold", "italic", "opacity",
    "strokeEnabled", "strokeColor", "strokeWidth",
    "shadowEnabled", "shadowColor", "shadowBlur", "shadowOffsetX", "shadowOffsetY",
    "align", "vAlign", "offsetX", "offsetY",
];

function pickSubtitleStyle(meta) {
    const src = meta && typeof meta === "object" ? meta : {};
    const out = {};
    for (const key of SUBTITLE_STYLE_KEYS) {
        if (src[key] !== undefined) out[key] = src[key];
    }
    return out;
}

function subtitleStyleFromJson(value) {
    const src = value && typeof value === "object" ? value : {};
    return pickSubtitleStyle({
        fontFamily: src.font_family ?? src.fontFamily,
        fontPath: src.font_path ?? src.fontPath,
        fontSize: src.font_size ?? src.fontSize,
        letterSpacing: src.letter_spacing ?? src.letterSpacing,
        color: src.color,
        bold: src.bold,
        italic: src.italic,
        opacity: src.opacity,
        strokeEnabled: src.stroke_enabled ?? src.strokeEnabled,
        strokeColor: src.stroke_color ?? src.strokeColor,
        strokeWidth: src.stroke_width ?? src.strokeWidth,
        shadowEnabled: src.shadow_enabled ?? src.shadowEnabled,
        shadowColor: src.shadow_color ?? src.shadowColor,
        shadowBlur: src.shadow_blur ?? src.shadowBlur,
        shadowOffsetX: src.shadow_offset_x ?? src.shadowOffsetX,
        shadowOffsetY: src.shadow_offset_y ?? src.shadowOffsetY,
        align: src.align,
        vAlign: src.v_align ?? src.vAlign,
        offsetX: src.offset_x ?? src.offsetX,
        offsetY: src.offset_y ?? src.offsetY,
    });
}

function serializeSubtitleStyle(meta) {
    const style = { ...pickSubtitleStyle(defaultSubtitleMeta()), ...pickSubtitleStyle(meta) };
    return {
        font_family: style.fontFamily,
        font_path: style.fontPath || "",
        font_size: style.fontSize,
        letter_spacing: style.letterSpacing ?? 0,
        color: style.color,
        bold: !!style.bold,
        italic: !!style.italic,
        opacity: style.opacity,
        stroke_enabled: style.strokeEnabled !== false,
        stroke_color: style.strokeColor,
        stroke_width: style.strokeWidth,
        shadow_enabled: style.shadowEnabled !== false,
        shadow_color: style.shadowColor,
        shadow_blur: style.shadowBlur,
        shadow_offset_x: style.shadowOffsetX,
        shadow_offset_y: style.shadowOffsetY,
        align: style.align,
        v_align: style.vAlign,
        offset_x: style.offsetX,
        offset_y: style.offsetY,
    };
}

function isSubtitleTrackType(type) {
    const t = String(type || "").toLowerCase();
    return t === "text" || t === "subtitle";
}

function isVoiceoverTrackType(type) {
    return String(type || "").toLowerCase() === "voiceover";
}

function isDirectorTrackType(type) {
    return String(type || "").toLowerCase() === "image";
}

function isMediaTrackType(type) {
    const t = String(type || "").toLowerCase();
    return t === "video" || t === "media";
}

function trackHeightFor(type) {
    return isSubtitleTrackType(type) ? SUBTITLE_TRACK_HEIGHT : TRACK_HEIGHT;
}

function isSubtitleClipMeta(meta, track) {
    if (isSubtitleTrackType(track?.type)) return true;
    return String(meta?.clipType || "").toLowerCase() === "subtitle";
}

function isVoiceoverClipMeta(meta, track) {
    if (isVoiceoverTrackType(track?.type)) return true;
    return String(meta?.clipType || "").toLowerCase() === "voiceover";
}

const BODY_UI_CLASSES = [
    "cat-te-noscroll",
    "cat-te-col-resize",
    "cat-te-row-resize",
    "cat-te-media-dnd",
    "cat-te-media-dnd-over-tl",
];

/** @timeline/editor fullscreen shell bound to a ComfyUI node. */
export class CapTimelineEditorApp {
    static _open = null;
    /** @type {Set<CapTimelineEditorApp>} */
    static _instances = new Set();
    /** Session clipboard for timeline clips (survives editor close/reopen). */
    static _clipClipboard = null;
    /**
     * FIFO jobs applied inside graphToPrompt so each queued batch item keeps the
     * correct runtime_only_clip_ids (ComfyUI may defer graphToPrompt after
     * queuePrompt returns false while processingQueue is busy).
     * @type {{ clipId: string, stamp: string|null, expectedFile: string|null }[]}
     */
    static _clipRunJobs = [];
    /** @type {CapTimelineEditorApp|null} */
    static _clipRunEditor = null;

    /** Drop body-level classes / orphaned DOM left by a killed editor. */
    static scrubGlobalUi() {
        document.body.classList.remove(...BODY_UI_CLASSES);
        document.querySelectorAll(".cat-te-media-drag-ghost, .cat-te-ctx-menu")
            .forEach((el) => el.remove());
        // Drop overlays that no longer belong to a live instance (or whose
        // instance was destroyed mid-teardown without removing the node).
        const live = new Set(
            [...CapTimelineEditorApp._instances]
                .filter((te) => !te._destroyed && te._overlay)
                .map((te) => te._overlay),
        );
        document.querySelectorAll(".cat-te-overlay").forEach((el) => {
            if (!live.has(el)) el.remove();
        });
        for (const te of CapTimelineEditorApp._instances) {
            if (te._overlay && !te._overlay.isConnected) te._overlay = null;
        }
        CapTimelineEditorApp._open = null;
    }

    /** Walk to the outermost graph (root) for a LiteGraph graph / subgraph. */
    static _graphRoot(graph) {
        if (!graph) return null;
        let cur = graph;
        const seen = new Set();
        while (cur && !seen.has(cur)) {
            seen.add(cur);
            const parent = cur.parent_graph ?? cur.parent ?? null;
            if (!parent) return cur;
            cur = parent;
        }
        return graph;
    }

    /**
     * Persist open editors into node widgets (for serialize / tab switch).
     * When `forGraph` is set, only flush editors whose node still belongs to
     * that graph tree — avoids writing timeline state into the wrong workflow
     * if a serialize runs while another graph is active.
     */
    static flushOpenEditors(forGraph = null) {
        const root = forGraph ? CapTimelineEditorApp._graphRoot(forGraph) : null;
        for (const te of CapTimelineEditorApp._instances) {
            if (te._destroyed || !te._overlay?.classList.contains("open") || !te._timeline) continue;
            if (!te.node?.graph) continue;
            if (root && CapTimelineEditorApp._graphRoot(te.node.graph) !== root) continue;
            try { te._saveToWidgets(); } catch { /* node may be mid-teardown */ }
        }
    }

    /** Close the fullscreen shell without destroying node-bound instances. */
    static closeOpenEditor() {
        const open = CapTimelineEditorApp._open;
        if (open && !open._destroyed) {
            try { open.close(); } catch { /* ignore */ }
        }
        document.body.classList.remove(...BODY_UI_CLASSES);
        document.querySelectorAll(".cat-te-media-drag-ghost, .cat-te-ctx-menu")
            .forEach((el) => el.remove());
        CapTimelineEditorApp._open = null;
    }

    /** Close every live editor and scrub global UI leftovers. */
    static forceCloseAll() {
        for (const te of [...CapTimelineEditorApp._instances]) {
            try { te.destroy(); } catch { /* continue scrubbing */ }
        }
        CapTimelineEditorApp.scrubGlobalUi();
    }

    constructor(node) {
        this.node = node;
        this._destroyed = false;
        this._meta = new Map();
        this._trackInfo = new Map();
        this._imgFiles = [];
        this._videoFiles = [];
        this._audioFiles = [];
        this._mediaStatus = new Map();
        this._projectResources = [];
        this._videoThumbCache = new Map();
        this._mediaTab = "image";
        this._mediaStarFilter = "all";
        this._mediaTypeFilters = new Set();
        this._mediaTagFilters = new Set();
        this._mediaFilterOpen = false;
        this._mediaStarsByDir = {};
        this._mediaBatchMode = false;
        this._mediaBatchSelected = new Set();
        this._mediaListView = localStorage.getItem(STORAGE_MEDIA_LIST_VIEW) === "1";
        this._mediaPreviewState = null;
        this._clipPreviewIndex = new Map();
        this._overlay = null;
        this._timeline = null;
        this._mainTrack = null;
        this._overlayTrack = null;
        this._audioTrack = null;
        this._selClip = null;
        this._selClips = [];
        this._undoStack = [];
        this._redoStack = [];
        this._historyReady = false;
        this._restoringHistory = false;
        this._playbackCtx = null;
        this._activeAudioSources = [];
        this._autoSaveTimer = null;
        /** In-flight media-library HTML5 drag payload (same-document DnD). */
        this._dndMedia = null;
        this._dndHoverClip = null;
        this._abortMediaDrag = null;
        /** Guard against overlapping OS file drops / uploads. */
        this._fileDropBusy = false;
        this._previewImages = new Map();
        this._previewVideos = new Map();
        this._programPreviewRaf = 0;
        this._programStageObserver = null;
        this._programHadFrame = false;
        this._programCanvasKey = "";
        this._programFrameKey = null;
        this._programOffscreen = null;
        this._onProgramVisChange = null;
        this._pendingGeneratedJobs = [];
        this._deferredGeneratedJobs = [];
        /** prompt_id of the job currently executing (from execution_start). */
        this._runningPromptId = null;
        /** clip id marked as running on the timeline. */
        this._runningClipId = null;
        /** 0..1 progress for the running clip (sampler / progress_state). */
        this._runningProgress = 0;
        this._queueReconcileTimer = 0;
        this._genVideoState = null;
        /** Working state for the generated-video editor; edits are applied immediately. */
        this._genEditState = null;
        this._outputVideosClipId = null;
        this._outputVideosCache = [];
        this._outputPickerKind = "video";
        this._outputVideosTimeRange = OUTPUT_VIDEOS_TIME_RANGES[0].id;
        this._outputVideosThumbIo = null;
        this._outputVideoHoverEl = null;
        this._outputVideoHoverVideo = null;
        this._outputVideoHoverFile = null;
        this._outputVideoHoverHideTimer = 0;
        this._outputVideoHoverAnchor = null;
        /**
         * Resource-edit mode: play a generated video in the program monitor
         * without moving the timeline playhead / currentTime.
         * { clipId, file, video }
         */
        this._resourceGenPreview = null;
        this._resourceGenPreviewRaf = 0;
        this._resourceGenPreviewStopTimer = 0;
        /** Live KJ Model Preview Override blobs while a clip is sampling: clipId → { url, mime }. */
        this._runPreviewByClipId = new Map();
        /** Decoded audio from generated/output videos: file → Promise<AudioBuffer|null>. */
        this._genAudioBufferCache = new Map();
        /** Web Audio sources for gen-edit modal playback (canvas videos stay muted). */
        this._genEditAudioSources = [];
        this._composeBusy = false;
        this._aiOptimizeBusy = false;
        this._aiOptimizeAbort = null;
        this._modelPreviewPromptId = null;
        this._modelPreviewClipId = null;
        this._modelPreviewRunning = false;
        this._modelPreviewEntry = null;
        this._watermark = this._defaultWatermark();
        this._promptConcatOrder = [...DEFAULT_PROMPT_CONCAT_ORDER];
        /** When true, Run associates CapTimelineEditor/..._{clipId}.mp4 by specified name. */
        this._useClipSpecifiedVideoFilename = true;
        /**
         * Per-clip preview uses meta.previewMode ("media" | "generated").
         * Legacy projects may still carry settings.timeline_edit_mode.
         */
        this._legacyTimelineEditMode = null;
        /** Temporary stamp written into project settings for one queuePrompt. */
        this._genVideoStamp = null;
        this._systemFonts = null;
        this._systemFontsPromise = null;
        /** When set, next queued project_json asks Python to emit only these clip ids. */
        this._runtimeOnlyClipIds = null;
        this._composePreviewRaf = 0;
        this._videoThumbActive = 0;
        this._videoThumbWaiters = [];
        this._timelineReady = false;
        this._loadSeq = 0;
        this._openGen = 0;
        this._bindExecutionWatch();
        CapTimelineEditorApp._instances.add(this);
        loadEditorCss();
        this._buildLauncher();
    }

    _w(name) { return this.node.widgets?.find(w => w.name === name); }
    _currentVersion() { return String(this._w("project_version")?.value || "0.0.0"); }
    _currentSchemaVersion() {
        const value = Number(this._w("schema_version")?.value);
        return Number.isInteger(value) && value >= 1 ? value : 1;
    }
    getFps() { return Math.max(1, parseInt(this._w("fps")?.value ?? 24, 10) || 24); }
    getPreviewSize() {
        const w = Math.max(1, Math.round(Number(this._w("width")?.value ?? PY_SCALAR_DEFAULTS.width) || PY_SCALAR_DEFAULTS.width));
        const h = Math.max(1, Math.round(Number(this._w("height")?.value ?? PY_SCALAR_DEFAULTS.height) || PY_SCALAR_DEFAULTS.height));
        return { w, h };
    }

    _buildLauncher() {
        const root = document.createElement("div");
        root.className = "cat-te-launcher";
        root.innerHTML = `
          <button type="button" class="cat-te-open-btn">${T("launcher_open_btn")}</button>
          <div class="cat-te-launcher-hint">${T("launcher_hint")}</div>
        `;
        const btn = root.querySelector(".cat-te-open-btn");
        // Stop LiteGraph/ComfyUI from treating launcher clicks as node selection
        // (which opens the properties panel and can swallow the button action).
        const blockNodeSelect = (e) => {
            e.stopPropagation();
        };
        for (const type of ["pointerdown", "mousedown", "mouseup", "click", "dblclick"]) {
            root.addEventListener(type, blockNodeSelect);
        }
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.open();
        });
        const w = this.node.addDOMWidget("te_launcher", "timeline_editor", root, {
            getMinHeight: () => 72,
            getHeight: () => 72,
        });
        w.serialize = false;
        // DomWidgets: size = (widget.width ?? node.width) - margin*2.
        // Keep width unset so a stale widget.width cannot outgrow the node.
        Object.defineProperty(w, "width", {
            get() { return undefined; },
            set() {},
            enumerable: true,
            configurable: true,
        });
        this.launcherWidget = w;
        this.node.setSize([360, 280]);
    }

    open() {
        // Already visible for this node — ignore duplicate opens.
        if (CapTimelineEditorApp._open === this && this._overlay?.classList.contains("open")) {
            return;
        }
        // Stale flag: marked open but overlay is hidden (close aborted mid-way).
        if (CapTimelineEditorApp._open === this) {
            CapTimelineEditorApp._open = null;
        } else if (CapTimelineEditorApp._open) {
            CapTimelineEditorApp._open.close();
        }
        this._ensureOverlay();
        this._overlay.classList.add("open");
        document.body.classList.add("cat-te-noscroll");
        CapTimelineEditorApp._open = this;
        this._overlay.focus();
        void this._ensureFontList();
        const gen = ++this._openGen;
        void this._openEditor(gen);
    }

    /** Selected clip on the timeline, or null. */
    getSelectedClip() {
        return this._timeline?._selected ?? this._selClip ?? null;
    }

    _fieldHasTextSelection(el) {
        if (!el) return false;
        const tag = el.tagName;
        if (tag === "TEXTAREA" || (tag === "INPUT" && /^(text|search|url|tel|password|number|email)$/i.test(el.type || "text"))) {
            try {
                return el.selectionStart !== el.selectionEnd;
            } catch {
                return false;
            }
        }
        if (el.isContentEditable || el.getAttribute?.("contenteditable") === "true") {
            const sel = window.getSelection?.();
            return !!(sel && !sel.isCollapsed && el.contains(sel.anchorNode));
        }
        return false;
    }

    _shortcutModKey(e) {
        const code = e.code || "";
        if (code.startsWith("Key") && code.length === 4) return code.slice(3).toLowerCase();
        const key = String(e.key || "").toLowerCase();
        if (key.length === 1) return key;
        return key;
    }

    /**
     * While the generated-video edit modal is open, Space toggles the modal
     * sub-timeline (not the main one). Other bare Timeline keys are swallowed
     * so the main timeline cannot seek/play underneath.
     * @returns {boolean}
     */
    handleGenEditKey(e) {
        if (!this.genEditModal || this.genEditModal.hidden) return false;
        if (e.target?.closest?.("input, textarea, select, [contenteditable='true']")) return false;
        const code = e.code || "";
        const isSpace = code === "Space" || e.key === " ";
        const isTlKey = isSpace
            || code === "Delete" || code === "Backspace"
            || code === "KeyQ" || code === "KeyW"
            || code === "Home" || code === "End"
            || code === "ArrowLeft" || code === "ArrowRight";
        if (!isTlKey) return false;
        if (e.ctrlKey || e.metaKey || e.altKey) return false;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        if (e.repeat) return true;

        const sub = this._genEditState?.timeline;
        if (!sub) return true;
        if (isSpace) {
            sub.togglePlay?.();
            return true;
        }
        // Forward to the sub-timeline handler when present.
        try { sub._onKey?.(e); } catch { /* ignore */ }
        return true;
    }

    /**
     * Editor shortcuts when fullscreen is open.
     * Ctrl/Cmd+Z/Y drive the timeline undo/redo stack (outside text fields).
     * Graph undo is blocked separately by patching ChangeTracker (its keydown
     * defers undo to rAF, so stopImmediatePropagation alone is not enough).
     * Ctrl+C/V copy/paste clips when clips are selected (even if focus is in a
     * prompt field), unless that field has a text selection — then native wins.
     * @returns {boolean} true if the event was handled
     */
    handleShortcutKey(e) {
        if (!this._overlay?.classList.contains("open")) return false;
        if (e.repeat) return false;
        const mod = e.ctrlKey || e.metaKey;
        if (!mod || e.altKey) return false;

        const key = this._shortcutModKey(e);
        const inField = !!e.target?.closest?.("input, textarea, select, [contenteditable='true']");

        // Claim the shortcut so other bubble handlers skip; tracker undo is
        // patched while fullscreen is open (see _capTePatchChangeTrackerUndo).
        if (key === "z" || key === "y") {
            e.stopPropagation();
            e.stopImmediatePropagation?.();
            // Gen-edit modal has no undo stack — only swallow graph undo.
            if (this.genEditModal && !this.genEditModal.hidden) {
                e.preventDefault();
                return true;
            }
            if (inField) {
                // Native text undo/redo — do not preventDefault.
                return true;
            }
            e.preventDefault();
            if (key === "y" || (key === "z" && e.shiftKey)) void this.redo();
            else void this.undo();
            return true;
        }

        if (e.shiftKey) return false;

        if (key === "c") {
            // Let native copy win when the user highlighted text in an input.
            if (inField && this._fieldHasTextSelection(e.target?.closest?.("input, textarea, select, [contenteditable='true']") || e.target)) {
                return false;
            }
            if (!this._copySelectedClips()) return false;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();
            this._overlay?.focus?.();
            return true;
        }
        if (key === "v") {
            // Never hijack paste inside text fields.
            if (inField) return false;
            if (!this._pasteClips()) return false;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();
            this._overlay?.focus?.();
            return true;
        }
        if (inField) return false;
        if (key !== "b" && key !== "g") return false;
        const clip = this.getSelectedClip();
        if (!clip) return false;
        if (clip.track?.type === "audio") return false;
        if (key === "b") this._toggleDisableClip(clip);
        else this._disableOthers(clip);
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        return true;
    }

    /**
     * Arrow keys — browse media preview when the modal is open.
     * @returns {boolean} true if the event was handled
     */
    handleMediaPreviewKey(e) {
        if (!this._overlay?.classList.contains("open")) return false;
        if (this.mediaPreviewModal?.hidden) return false;
        if (this.rawMetaModal && !this.rawMetaModal.hidden) return false;
        if (e.target?.closest?.("[role='tab']")) return false;
        if (this._mediaPreviewState?.browse === false) return false;
        if (e.target?.closest?.("input, textarea, select")) return false;
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return false;
        this._stepMediaPreview(e.key === "ArrowRight" ? 1 : -1);
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        return true;
    }

    /**
     * Arrow keys — switch clip while AI Optimize modal is open.
     * @returns {boolean} true if the event was handled
     */
    handleAiOptimizeKey(e) {
        if (!this._overlay?.classList.contains("open")) return false;
        if (!this.aiOptimizeModal || this.aiOptimizeModal.hidden) return false;
        if (e.target?.closest?.("input, textarea, select, [contenteditable='true']")) return false;
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return false;
        void this._stepAiOptimizeClip(e.key === "ArrowRight" ? 1 : -1);
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        return true;
    }

    async _openEditor(gen = this._openGen) {
        this._historyReady = false;
        this._openedWidgetValues = Object.fromEntries(
            ["fps", "width", "height"].map(name => [name, this._w(name)?.value]),
        );
        // Re-apply panel layout each open (window size / localStorage may have changed).
        this._applySavedMediaPanelWidth();
        this._applySavedSidebarPanelWidth();
        this._applySavedProgramPanelHeight();
        // Bind (or re-bind) OS file drops — overlay may predate this feature.
        this._bindExternalFileDrop();
        try {
            await this._initTimelineFromWidgets();
        } catch (error) {
            this._discardTimeline();
            alert(T("load_timeline_failed", { msg: error instanceof Error ? error.message : String(error) }));
            return;
        }
        if (gen !== this._openGen || CapTimelineEditorApp._open !== this || !this._overlay?.classList.contains("open")) {
            if (CapTimelineEditorApp._open !== this || !this._overlay?.classList.contains("open")) {
                this._discardTimeline();
            }
            return;
        }
        await this._reloadMediaLibrary();
        if (gen !== this._openGen || CapTimelineEditorApp._open !== this || !this._overlay?.classList.contains("open")) {
            if (CapTimelineEditorApp._open !== this || !this._overlay?.classList.contains("open")) {
                this._discardTimeline();
            }
            return;
        }
        this._refreshTimelineDuration();
        this._applyDeferredGeneratedVideos();
        const viewSettings = this._readViewSettingsFromProjectWidget();
        requestAnimationFrame(() => {
            if (gen !== this._openGen) return;
            this._timeline?._refresh();
            // Scroll needs laid-out viewport; restore again after paint.
            this._applyTimelineViewFromSettings(viewSettings, { applyZoom: false });
        });
        this._undoStack = [];
        this._redoStack = [];
        this._historyReady = true;
        this._openedProjectJson = JSON.stringify(this._buildProject());
        this._updateHistoryButtons();
        this._selClip = null;
        this._selClips = [];
        this._updatePromptPanel();
        this._startAutoSave();
        this._scheduleProgramPreview();
    }

    _getAutosaveIntervalSec() {
        const n = parseInt(localStorage.getItem(STORAGE_AUTOSAVE_INTERVAL) ?? String(DEFAULT_AUTOSAVE_INTERVAL_SEC), 10);
        if (!Number.isFinite(n)) return DEFAULT_AUTOSAVE_INTERVAL_SEC;
        return Math.min(MAX_AUTOSAVE_INTERVAL_SEC, Math.max(MIN_AUTOSAVE_INTERVAL_SEC, n));
    }

    _startAutoSave() {
        this._stopAutoSave();
        const tick = () => {
            if (this._overlay?.classList.contains("open")) this._autoSaveIfDirty();
            this._autoSaveTimer = setTimeout(tick, this._getAutosaveIntervalSec() * 1000);
        };
        this._autoSaveTimer = setTimeout(tick, this._getAutosaveIntervalSec() * 1000);
    }

    _stopAutoSave() {
        if (this._autoSaveTimer) {
            clearTimeout(this._autoSaveTimer);
            this._autoSaveTimer = null;
        }
    }

    _autoSaveIfDirty() {
        if (!this._timeline || !this._historyReady) return;
        if (!this._hasUnsavedChanges()) return;
        this._saveToWidgets();
        this._openedProjectJson = JSON.stringify(this._buildProject());
    }

    _hasUnsavedChanges() {
        if (!this._timeline) return false;
        return JSON.stringify(this._buildProject()) !== this._openedProjectJson;
    }

    close() {
        if (!this._overlay) return;
        this._closeInternal(true);
    }

    _closeInternal(save) {
        // Invalidate any in-flight _openEditor so it won't rebuild after close.
        this._openGen += 1;
        this._historyReady = false;
        try {
            this._abortMediaDrag?.();
            this._abortMediaDrag = null;
            this._stopAutoSave();
            this._stopAudioPlayback();
            try { this._closeMediaPreview(); } catch { /* ignore */ }
            try { this._closeGenVideoModal(); } catch { /* ignore */ }
            try { this._closeGenEditModal(); } catch { /* ignore */ }
        try { this._closeVoiceoverEditModal(false); } catch { /* ignore */ }
            try { this._closeOutputVideosPicker(); } catch { /* ignore */ }
            try { this._closeComposeModal(true); } catch { /* ignore */ }
            try { this._closeAddMaterial(); } catch { /* ignore */ }
            try { this._closeSettings(); } catch { /* ignore */ }
            this._removeCtxMenu();
            try { this._persistPanelLayout(); } catch { /* ignore */ }
            try { this._persistViewToLocalCache(); } catch { /* ignore */ }
            if (save) {
                try { this._saveToWidgets(); } catch { /* node may already be removed */ }
            } else if (this._openedWidgetValues) {
                for (const [name, value] of Object.entries(this._openedWidgetValues)) {
                    const widget = this._w(name);
                    if (!widget || value === undefined) continue;
                    widget.value = value;
                }
            }
            this._discardTimeline();
            this._mainTrack = null;
            this._overlayTrack = null;
            this._selClip = null;
            this._mediaBatchMode = false;
            this._mediaBatchSelected.clear();
            this._mediaListResizeObserver?.disconnect();
            this._mediaListResizeObserver = null;
            try { this._clearClipInfoPanel(); } catch { /* overlay may be gone */ }
        } finally {
            this._overlay?.classList.remove("open");
            document.body.classList.remove(...BODY_UI_CLASSES);
            if (CapTimelineEditorApp._open === this) CapTimelineEditorApp._open = null;
        }
    }

    _discardTimeline() {
        this._timelineReady = false;
        this._historyReady = false;
        this._disposeProgramPreview();
        try { this._timeline?.destroy(); } catch { /* ignore */ }
        this._timeline = null;
        this._mainTrack = null;
        this._overlayTrack = null;
        this._audioTrack = null;
        this._selClip = null;
        this._selClips = [];
    }

    _parseProjectWidgetValue() {
        const raw = this._w("project_json")?.value;
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
            return { project: raw, error: null };
        }
        const text = String(raw ?? "").trim();
        if (!text) return { project: null, error: null };
        try {
            const project = JSON.parse(text);
            if (!project || typeof project !== "object" || Array.isArray(project)) {
                return { project: null, error: new Error(T("project_json_root_invalid")) };
            }
            return { project, error: null };
        } catch (error) {
            return { project: null, error: error instanceof Error ? error : new Error(String(error)) };
        }
    }

    _openSettings() {
        if (!this.settingsModal) return;
        this.autosaveIntervalInput.value = String(this._getAutosaveIntervalSec());
        if (this.promptFontSizeInput) this.promptFontSizeInput.value = String(this._getPromptFontSize());
        if (this.useClipVideoFilenameCb) {
            this.useClipVideoFilenameCb.checked = this._useClipSpecifiedVideoFilename !== false;
        }
        if (this.modelPreviewModelInput) {
            this.modelPreviewModelInput.value = localStorage.getItem(STORAGE_MODEL_PREVIEW_MODEL) || "";
        }
        this._updateModelPreviewConfigName();
        this.settingsModal.hidden = false;
        void this._loadAgentConfigs();
    }

    _updateModelPreviewConfigName() {
        if (!this.modelPreviewConfigName) return;
        const name = localStorage.getItem(STORAGE_MODEL_PREVIEW_WORKFLOW_NAME) || "";
        this.modelPreviewConfigName.textContent = name
            ? T("model_preview_workflow_loaded", { name })
            : T("model_preview_workflow_missing");
    }

    async _importModelPreviewWorkflow(event) {
        const input = event?.target;
        const file = input?.files?.[0];
        if (!file) return;
        try {
            const parsed = JSON.parse(await file.text());
            const prompt = parsed?.output || parsed?.prompt || parsed;
            if (!prompt || typeof prompt !== "object" || Array.isArray(prompt)
                || !Object.values(prompt).some((node) => node && typeof node === "object" && node.class_type)) {
                throw new Error(T("model_preview_api_workflow_required"));
            }
            localStorage.setItem(STORAGE_MODEL_PREVIEW_WORKFLOW, JSON.stringify(prompt));
            localStorage.setItem(STORAGE_MODEL_PREVIEW_WORKFLOW_NAME, file.name);
            this._updateModelPreviewConfigName();
        } catch (error) {
            alert(T("model_preview_import_failed", { msg: error instanceof Error ? error.message : String(error) }));
        } finally {
            if (input) input.value = "";
        }
    }

    _clearModelPreviewWorkflow() {
        localStorage.removeItem(STORAGE_MODEL_PREVIEW_WORKFLOW);
        localStorage.removeItem(STORAGE_MODEL_PREVIEW_WORKFLOW_NAME);
        this._updateModelPreviewConfigName();
    }

    _clampPromptFontSize(value) {
        if (value == null || String(value).trim() === "") return DEFAULT_PROMPT_FONT_SIZE;
        const size = Math.round(Number(value));
        if (!Number.isFinite(size)) return DEFAULT_PROMPT_FONT_SIZE;
        return Math.min(MAX_PROMPT_FONT_SIZE, Math.max(MIN_PROMPT_FONT_SIZE, size));
    }

    _getPromptFontSize() {
        return this._clampPromptFontSize(localStorage.getItem(STORAGE_PROMPT_FONT_SIZE));
    }

    _applyPromptFontSize() {
        this._overlay?.style.setProperty("--cat-te-prompt-font-size", `${this._getPromptFontSize()}px`);
    }

    _closeSettings() {
        if (this.settingsModal) this.settingsModal.hidden = true;
        this._cancelAgentEdit();
    }

    async _loadAgentConfigs() {
        if (!this.agentList) return;
        this.agentList.textContent = T("loading_ellipsis");
        try {
            const response = await fetch(api.apiURL("/audio_keyframe_timeline/agents"));
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            this._agentConfigs = Array.isArray(data.agents) ? data.agents : [];
            this._renderAgentConfigs();
        } catch (error) {
            this.agentList.textContent = T("load_failed", { msg: error instanceof Error ? error.message : String(error) });
        }
    }

    _renderAgentConfigs() {
        if (!this.agentList) return;
        this.agentList.replaceChildren();
        if (!this._agentConfigs?.length) {
            const empty = document.createElement("div");
            empty.className = "cat-te-agent-empty";
            empty.textContent = T("no_agents_yet");
            this.agentList.appendChild(empty);
            return;
        }
        for (const config of this._agentConfigs) {
            const row = document.createElement("div");
            row.className = "cat-te-agent-row";
            const text = document.createElement("div");
            text.className = "cat-te-agent-row-text";
            const title = document.createElement("strong");
            title.textContent = config.label || T("unnamed");
            const detail = document.createElement("span");
            detail.textContent = `${config.provider === "gemini" ? "Gemini" : "OpenAI"} · ${config.model}${config.enabled ? "" : T("agent_disabled_suffix")}`;
            text.append(title, detail);
            const edit = document.createElement("button");
            edit.type = "button";
            edit.className = "cat-te-btn";
            edit.textContent = T("edit_btn");
            edit.addEventListener("click", () => this._editAgentConfig(config));
            row.append(text, edit);
            this.agentList.appendChild(row);
        }
    }

    _editAgentConfig(config = null) {
        if (!this.agentForm) return;
        this._editingAgentId = config?.id || "";
        this.agentLabelInput.value = config?.label || "";
        this.agentProviderSelect.value = config?.provider || "openai";
        this.agentModelInput.value = config?.model || AGENT_DEFAULT_MODELS[this.agentProviderSelect.value] || "";
        this.agentKeyInput.value = "";
        this.agentKeyInput.placeholder = config?.has_key ? T("leave_blank_keep_key") : T("enter_api_key");
        this.agentEnabledCb.checked = config?.enabled !== false;
        this.agentDeleteBtn.hidden = !config;
        this.agentForm.hidden = false;
        this.agentLabelInput.focus();
    }

    _cancelAgentEdit() {
        this._editingAgentId = "";
        if (this.agentForm) this.agentForm.hidden = true;
        if (this.agentKeyInput) this.agentKeyInput.value = "";
    }

    async _saveAgentConfig() {
        const payload = {
            id: this._editingAgentId || undefined,
            label: this.agentLabelInput?.value.trim() || "",
            provider: this.agentProviderSelect?.value || "openai",
            model: this.agentModelInput?.value.trim() || "",
            api_key: this.agentKeyInput?.value.trim() || "",
            enabled: !!this.agentEnabledCb?.checked,
        };
        try {
            const response = await fetch(api.apiURL("/audio_keyframe_timeline/agents"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            this._cancelAgentEdit();
            await this._loadAgentConfigs();
        } catch (error) {
            alert(T("save_agent_failed", { msg: error instanceof Error ? error.message : String(error) }));
        }
    }

    async _deleteAgentConfig() {
        const agentId = this._editingAgentId;
        if (!agentId) return;
        this._openDeleteConfirm(T("confirm_delete_agent"), () => this._performDeleteAgentConfig(agentId));
    }

    async _performDeleteAgentConfig(agentId) {
        try {
            const response = await fetch(api.apiURL(`/audio_keyframe_timeline/agents/${encodeURIComponent(agentId)}`), { method: "DELETE" });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            if (this._editingAgentId === agentId) this._cancelAgentEdit();
            await this._loadAgentConfigs();
        } catch (error) {
            alert(T("delete_agent_failed", { msg: error instanceof Error ? error.message : String(error) }));
        }
    }

    _confirmOverwriteImport() {
        return !(this._hasUnsavedChanges() && !confirm(T("confirm_overwrite_import")));
    }

    _showImportMenu(e) {
        const r = e.currentTarget.getBoundingClientRect();
        this._buildCtxMenu([
            { label: T("import_from_directory"), fn: () => void this._importFromDirectory() },
            { label: T("import_from_zip"), fn: () => this._chooseZipImport() },
        ], r.left, r.bottom + 4);
    }

    _showExportMenu(e) {
        const r = e.currentTarget.getBoundingClientRect();
        this._buildCtxMenu([
            { label: T("export_to_directory"), fn: () => void this._exportToDirectory() },
            { label: T("export_as_zip"), fn: () => void this._exportAsZip() },
            { label: T("compose_video_menu"), fn: () => void this._composeGeneratedVideosExport() },
        ], r.left, r.bottom + 4);
    }

    _showRunMenu(e) {
        const r = e.currentTarget.getBoundingClientRect();
        this._buildCtxMenu([
            { label: T("run_all_clips_menu"), fn: () => void this._runAllActiveClipsDownstream() },
            { label: T("run_track_left_menu"), fn: () => void this._runSelectedTrackSide("left") },
            { label: T("run_track_right_menu"), fn: () => void this._runSelectedTrackSide("right") },
            {
                label: T("run_clips_without_generated_menu"),
                fn: () => void this._runAllActiveClipsDownstream({ withoutGenerated: true }),
            },
            { label: T("run_workflow_menu"), fn: () => void this._runWorkflow() },
        ], r.left, r.bottom + 4);
    }

    _resetTrackOrder() {
        this._applyTrackTypeOrder({ recordUndo: true, save: true });
    }

    _trackTypeRank(track) {
        if (isSubtitleTrackType(track?.type)) return 0;
        if (isMediaTrackType(track?.type)) return 1;
        if (isDirectorTrackType(track?.type)) return 2;
        if (isVoiceoverTrackType(track?.type)) return 3;
        if (track?.type === "audio") return 4;
        return 5;
    }

    _applyTrackTypeOrder({ recordUndo = false, save = false } = {}) {
        const tl = this._timeline;
        if (!tl) return;
        const tracks = [...tl.tracks].sort((a, b) => this._trackTypeRank(a) - this._trackTypeRank(b));
        const changed = tracks.some((track, index) => track !== tl.tracks[index]);
        if (changed && recordUndo) this._recordUndo();
        tl.tracks = tracks;
        tracks.forEach((track, index) => {
            tl._tracksEl.appendChild(track.el);
            tl._trackHeadersEl.appendChild(track.headerEl);
            const info = this._trackInfo.get(track.id);
            if (info) info.trackIndex = index;
            for (const clip of track.clips) {
                const meta = this._meta.get(clip.id);
                if (meta) meta.trackIndex = index;
            }
        });
        tl._refresh();
        this._syncTrackRoleRefs();
        this._scheduleProgramPreview();
        if (save) this._saveToWidgets();
    }

    _showAddTrackMenu(e) {
        const r = e.currentTarget.getBoundingClientRect();
        this._buildCtxMenu([
            { label: T("subtitle_track_menu"), fn: () => this._addUserTrack("text") },
            { label: T("media_track_menu"), fn: () => this._addUserTrack("video") },
            { label: T("director_track_menu"), fn: () => this._addUserTrack("image") },
            { label: T("voiceover_track_menu"), fn: () => this._addUserTrack("voiceover") },
            { label: T("audio_track_menu"), fn: () => this._addUserTrack("audio") },
        ], r.left, r.bottom + 4);
    }

    _showTrackTypeMenu(track, anchor) {
        if (!track || !anchor) return;
        clearTimeout(this._trackTypeMenuHideTimer);
        const items = [{
            label: track.name || T("generic_track_name"),
            trackName: true,
            fn: () => this._openTrackRenameModal(track),
        }, {
            label: T("track_color_menu"),
            fn: () => this._openTrackColorModal(track),
        }];
        if (isDirectorTrackType(track.type) || isMediaTrackType(track.type)) {
            const toMedia = isDirectorTrackType(track.type);
            items.push({
                label: T(toMedia ? "convert_to_media_track" : "convert_to_director_track"),
                fn: () => this._convertVisualTrackType(track, toMedia ? "video" : "image"),
            });
        }
        items.push({
            label: T("delete_track_menu"),
            danger: true,
            disabled: !!track.locked,
            fn: () => this._deleteTrack(track),
        });
        const r = anchor.getBoundingClientRect();
        const menu = this._buildCtxMenu(items, r.right + 4, r.top, { ignoreNextClick: false });
        if (!menu) return;
        menu.dataset.trackTypeMenu = "1";
        menu.addEventListener("mouseenter", () => clearTimeout(this._trackTypeMenuHideTimer));
        menu.addEventListener("mouseleave", () => this._scheduleTrackTypeMenuHide());
    }

    _scheduleTrackTypeMenuHide() {
        clearTimeout(this._trackTypeMenuHideTimer);
        this._trackTypeMenuHideTimer = setTimeout(() => {
            const menu = document.querySelector(".cat-te-ctx-menu[data-track-type-menu='1']");
            if (menu) this._removeCtxMenu();
        }, 180);
    }

    _deleteTrack(track) {
        if (!track || track.locked || !this._timeline?.tracks.includes(track)) return;
        this._pendingDeleteTrackId = track.id;
        this.trackDeleteMessage.textContent = T("confirm_delete_track", { name: track.name, n: track.clips.length });
        this.trackDeleteModal.hidden = false;
        this.trackDeleteModal.querySelector(".cat-te-track-delete-cancel")?.focus();
    }

    _closeTrackDeleteModal() {
        this._pendingDeleteTrackId = null;
        if (this.trackDeleteModal) this.trackDeleteModal.hidden = true;
    }

    _openTrackRenameModal(track) {
        if (!track || !this.trackRenameModal || !this.trackRenameInput) return;
        this._pendingRenameTrackId = track.id;
        this.trackRenameInput.value = track.name || "";
        this.trackRenameModal.hidden = false;
        this.trackRenameInput.focus();
        this.trackRenameInput.select();
    }

    _closeTrackRenameModal() {
        this._pendingRenameTrackId = null;
        if (this.trackRenameModal) this.trackRenameModal.hidden = true;
    }

    _confirmTrackRename() {
        const track = this._timeline?.getTrack(this._pendingRenameTrackId);
        const name = String(this.trackRenameInput?.value || "").trim();
        if (!track || !name) {
            this.trackRenameInput?.focus();
            return;
        }
        this._recordUndo();
        track.name = name;
        track.headerEl.removeAttribute("title");
        this._closeTrackRenameModal();
        this._saveToWidgets();
    }

    _openTrackColorModal(track) {
        if (!track || !this.trackColorModal || !this.trackColorInput) return;
        this._pendingColorTrackId = track.id;
        this.trackColorInput.value = /^#[0-9a-f]{6}$/i.test(track.color || "") ? track.color : "#8b4ec8";
        this.trackColorModal.hidden = false;
        this.trackColorInput.focus();
    }

    _closeTrackColorModal() {
        this._pendingColorTrackId = null;
        if (this.trackColorModal) this.trackColorModal.hidden = true;
    }

    _confirmTrackColor() {
        const track = this._timeline?.getTrack(this._pendingColorTrackId);
        const color = String(this.trackColorInput?.value || "");
        if (!track || !/^#[0-9a-f]{6}$/i.test(color)) return;
        this._recordUndo();
        track.color = color;
        track.el.style.setProperty("--track-color", color);
        track.headerEl.style.setProperty("--track-color", color);
        for (const clip of track.clips) {
            clip.color = color;
            clip.el.style.setProperty("--clip-color", color);
        }
        this._closeTrackColorModal();
        this._saveToWidgets();
    }

    _showTrackConvertError(clip) {
        if (!this.trackConvertModal || !this.trackConvertMessage) return;
        this.trackConvertMessage.textContent = T("convert_to_media_invalid_clip", {
            name: clip?.name || DEFAULT_CLIP_NAME,
        });
        this.trackConvertModal.hidden = false;
        this.trackConvertModal.querySelector(".cat-te-track-convert-ok")?.focus();
    }

    _closeTrackConvertModal() {
        if (this.trackConvertModal) this.trackConvertModal.hidden = true;
    }

    _confirmDeleteTrack() {
        const track = this._timeline?.getTrack(this._pendingDeleteTrackId);
        this._closeTrackDeleteModal();
        if (!track) return;
        this._recordUndo();
        for (const clip of track.clips) this._meta.delete(clip.id);
        if (this._timeline._mainTrackId === track.id) this._timeline._mainTrackId = null;
        if (!this._timeline.removeTrack(track.id)) return;
        this._syncTrackRoleRefs();
        this._syncSelectedClip();
        this._updatePromptPanel();
        this._applyTrackTypeOrder({ save: true });
        this._refreshTimelineDuration();
        this._renderMediaGrid();
        this._scheduleProgramPreview();
    }

    _convertVisualTrackType(track, type) {
        if (!track || track.type === type || !["image", "video"].includes(type)) return;
        const toMedia = isMediaTrackType(type);
        if (toMedia) {
            const invalidClip = track.clips.find((clip) => {
                const meta = this._meta.get(clip.id) ?? defaultImageMeta();
                const items = this._clipItems(meta);
                return items.length !== 1
                    || !["image", "video"].includes(String(items[0]?.kind || "").toLowerCase())
                    || this._clipGeneratedVideos(meta).length > 0;
            });
            if (invalidClip) {
                this._showTrackConvertError(invalidClip);
                return;
            }
        }
        this._recordUndo();
        const oldType = track.type;
        track.type = type;
        track.name = T(toMedia ? "media_track_name" : "director_track_name");
        track.color = toMedia ? "#ef4444" : "#8b4ec8";
        track.el.classList.remove(`tl-track-${oldType}`);
        track.el.classList.add(`tl-track-${type}`);
        track.el.style.setProperty("--track-color", track.color);
        track.headerEl.classList.remove(`tl-track-header-${oldType}`);
        track.headerEl.classList.add(`tl-track-header-${type}`);
        track.headerEl.style.setProperty("--track-color", track.color);
        track.headerEl.removeAttribute("title");
        const icon = track.headerEl.querySelector(".tl-track-icon");
        if (icon) icon.innerHTML = toMedia ? ICONS.film : ICONS.clapperboard;
        if (toMedia && track.isMain) {
            track.isMain = false;
            if (this._timeline?._mainTrackId === track.id) this._timeline._mainTrackId = null;
            track.el.classList.remove("tl-track-main");
            track.headerEl.classList.remove("tl-track-header-main");
        }
        const info = this._trackInfo.get(track.id) || {};
        info.role = toMedia ? "media" : "director";
        this._trackInfo.set(track.id, info);
        for (const clip of track.clips) {
            clip.color = track.color;
            clip.el.style.setProperty("--clip-color", track.color);
            const meta = this._meta.get(clip.id) ?? defaultImageMeta();
            meta.clipType = toMedia ? "media" : "image";
            meta.mediaKind = toMedia ? "media" : "clip";
            this._meta.set(clip.id, meta);
            this._decorateClip(clip);
        }
        this._applyTrackTypeOrder({ save: true });
        this._updatePromptPanel();
        this._scheduleProgramPreview();
    }

    _addUserTrack(type) {
        if (!this._timeline) return;
        const name = type === "audio"
            ? T("audio_track_name")
            : isVoiceoverTrackType(type)
                ? T("voiceover_track_name")
                : isSubtitleTrackType(type)
                    ? T("subtitle_track_name")
                    : isMediaTrackType(type)
                        ? T("media_track_name")
                        : T("director_track_name");
        const track = this._timeline.addTrack({
            type,
            name,
            height: trackHeightFor(type),
            isMain: false,
        });
        this._trackInfo.set(track.id, {
            trackIndex: this._nextTrackIndex(),
            enabled: true,
            role: type === "audio"
                ? "audio"
                : isVoiceoverTrackType(type)
                    ? "voiceover"
                    : isSubtitleTrackType(type)
                        ? "subtitle"
                        : isMediaTrackType(type)
                            ? "media"
                            : "director",
            ...(isSubtitleTrackType(type)
                ? { subtitleStyle: pickSubtitleStyle(defaultSubtitleMeta()) }
                : {}),
        });
        this._setupTrackControls(track);
        this._applyTrackTypeOrder();
        this._saveToWidgets();
        return track;
    }

    /** Visual clips that are not disabled (and whose track is enabled). */
    _listActiveVisualClips({ withoutGenerated = false, track: onlyTrack = null, anchor = null, side = null } = {}) {
        const out = [];
        const tracks = onlyTrack ? [onlyTrack] : this._allImageTracks();
        for (const track of tracks) {
            if (!this._allImageTracks().includes(track)) continue;
            const info = this._trackInfo.get(track.id) || {};
            if (info.enabled === false) continue;
            for (const clip of track.clips) {
                if (anchor && clip.id !== anchor.id) {
                    if (side === "left" && clip.startTime > anchor.startTime) continue;
                    if (side === "right" && clip.startTime < anchor.startTime) continue;
                }
                const meta = this._meta.get(clip.id) ?? defaultImageMeta();
                if (meta.disabled || meta.clipType === "audio" || meta.clipType === "subtitle" || meta.clipType === "voiceover") continue;
                if (isSubtitleClipMeta(meta, track)) continue;
                // Empty package clips have nothing to generate.
                if (this._isEmptyGroupClip(meta)) continue;
                if (withoutGenerated && this._clipGeneratedVideos(meta).length) continue;
                out.push(clip);
            }
        }
        out.sort((a, b) => {
            const dt = (a.startTime || 0) - (b.startTime || 0);
            if (dt !== 0) return dt;
            return String(a.id).localeCompare(String(b.id));
        });
        return out;
    }

    async _runSelectedTrackSide(side) {
        const anchor = this.getSelectedClip();
        if (!anchor || !this._allImageTracks().includes(anchor.track)) {
            alert(T("select_visual_clip_for_side_run"));
            return;
        }
        const clips = this._listActiveVisualClips({
            track: anchor.track,
            anchor,
            side,
        });
        if (!clips.some((clip) => clip.id === anchor.id)) {
            alert(T("no_active_clips_to_run"));
            return;
        }
        await this._runAllActiveClipsDownstream({ clips });
    }

    async _runWorkflow() {
        if (typeof app?.queuePrompt !== "function") {
            alert(T("queue_prompt_not_found"));
            return;
        }
        try {
            this._saveToWidgets();
            await app.queuePrompt(0);
        } catch (error) {
            alert(T("run_failed", { msg: error instanceof Error ? error.message : String(error) }));
        }
    }

    async _runAllActiveClipsDownstream({ withoutGenerated = false, clips: requestedClips = null } = {}) {
        const clips = Array.isArray(requestedClips)
            ? requestedClips
            : this._listActiveVisualClips({ withoutGenerated });
        if (!clips.length) {
            alert(withoutGenerated
                ? T("no_clips_without_generated_to_run")
                : T("no_active_clips_to_run"));
            return;
        }
        if (typeof app?.queuePrompt !== "function") {
            alert(T("queue_prompt_not_found"));
            return;
        }
        if (this._runAllClipsBusy) return;
        this._runAllClipsBusy = true;

        const stamp = this._useClipSpecifiedVideoFilename !== false
            ? this._makeGenVideoStamp()
            : null;
        const projectJson = JSON.stringify(this._buildProject());
        const jobs = clips.map((clip) => ({
            clipId: String(clip.id),
            stamp,
            expectedFile: stamp ? this._clipSpecifiedVideoPath(clip.id, stamp) : null,
            projectJson,
        }));

        CapTimelineEditorApp._installClipRunJobHook();
        CapTimelineEditorApp._clipRunEditor = this;
        CapTimelineEditorApp._clipRunJobs = jobs.slice();

        let queued = 0;
        try {
            // Chunk by BatchCountLimit so a low UI limit (e.g. 30) cannot truncate
            // a large run-all — each chunk still applies one clip filter per item.
            const limit = CapTimelineEditorApp._batchCountLimit();
            for (let offset = 0; offset < jobs.length; ) {
                if (this._destroyed || !this._timeline) break;
                const chunk = Math.min(limit, jobs.length - offset);
                await this._waitForQueueIdle();
                // Keep remaining jobs at the front for this chunk's graphToPrompt calls.
                CapTimelineEditorApp._clipRunJobs = jobs.slice(offset);
                CapTimelineEditorApp._clipRunEditor = this;
                const pendingBefore = CapTimelineEditorApp._clipRunJobs.length;
                // Register pending UI jobs before queuePrompt so execution_start
                // (which can race ahead of the await) can mark them running.
                const chunkJobs = jobs.slice(offset, offset + chunk);
                for (const job of chunkJobs) {
                    this._notePendingGeneratedJob({
                        clipId: job.clipId,
                        promptId: null,
                        files: [],
                        expectedFile: job.expectedFile,
                        stamp: job.stamp || stamp,
                    });
                }
                const result = await app.queuePrompt(0, chunk);
                if (result === false) {
                    // Request was pushed while another processor was starting; keep
                    // jobs until graphToPrompt consumes them.
                    await this._waitForQueueIdle();
                }
                const consumed = Math.max(0, pendingBefore - CapTimelineEditorApp._clipRunJobs.length);
                // Drop unused pre-registered slots if the chunk was truncated.
                if (consumed < chunkJobs.length) {
                    for (let i = chunkJobs.length - 1; i >= consumed; i--) {
                        const dropId = String(chunkJobs[i].clipId);
                        const idx = this._pendingGeneratedJobs.findIndex(
                            (j) => String(j.clipId) === dropId && !j.promptId && !(j.files?.length),
                        );
                        if (idx >= 0) this._pendingGeneratedJobs.splice(idx, 1);
                    }
                    this._syncClipRunDecorations();
                }
                const pid = this._promptIdFromQueueResult(result);
                if (pid && consumed > 0) {
                    this._bindPromptIdToPendingJob(pid, chunkJobs[0].clipId);
                }
                this._schedulePendingJobsQueueReconcile();
                queued += consumed;
                offset += consumed;
                // Validation/API error aborts the batch early — stop rather than
                // spinning on the same failing prompt.
                if (consumed < chunk) break;
            }
            if (queued < jobs.length) {
                alert(T("run_all_partial", { queued, total: jobs.length }));
            }
        } catch (error) {
            alert(T("run_failed", { msg: error instanceof Error ? error.message : String(error) }));
        } finally {
            CapTimelineEditorApp._clipRunJobs = [];
            CapTimelineEditorApp._clipRunEditor = null;
            this._runtimeOnlyClipIds = null;
            // Keep gen_video_stamp until pending jobs finish so Python save path matches.
            if (!this._pendingGeneratedJobs.some((j) => j.stamp || j.expectedFile)) {
                this._genVideoStamp = null;
            }
            this._saveToWidgets();
            this._openedProjectJson = JSON.stringify(this._buildProject());
            this._runAllClipsBusy = false;
        }
    }

    /** ComfyUI setting: max tasks per queuePrompt batch (UI default 100). */
    static _batchCountLimit() {
        try {
            const n = Number(app.extensionManager?.setting?.get?.("Comfy.QueueButton.BatchCountLimit"));
            if (Number.isFinite(n) && n >= 1) return Math.floor(n);
        } catch { /* ignore */ }
        try {
            const n = Number(app.ui?.settings?.getSettingValue?.("Comfy.QueueButton.BatchCountLimit"));
            if (Number.isFinite(n) && n >= 1) return Math.floor(n);
        } catch { /* ignore */ }
        return 100;
    }

    static _installClipRunJobHook() {
        if (typeof app?.graphToPrompt !== "function" || app.graphToPrompt._capTeClipRunHooked) return;
        const orig = app.graphToPrompt;
        app.graphToPrompt = async function (...args) {
            const jobs = CapTimelineEditorApp._clipRunJobs;
            const job = jobs?.[0];
            const editor = CapTimelineEditorApp._clipRunEditor;
            if (job && editor && !editor._destroyed) {
                editor._runtimeOnlyClipIds = [String(job.clipId)];
                editor._genVideoStamp = job.stamp || null;
                try {
                    const project = JSON.parse(job.projectJson);
                    project.settings = {
                        ...(project.settings || {}),
                        runtime_only_clip_ids: [String(job.clipId)],
                        ...(job.stamp ? { gen_video_stamp: job.stamp } : {}),
                    };
                    editor._writeProjectJson(JSON.stringify(project));
                } catch { /* ignore */ }
            }
            try {
                return await orig.apply(this, args);
            } finally {
                if (job && jobs?.[0] === job) {
                    jobs.shift();
                    if (editor && !editor._destroyed) {
                        editor._runtimeOnlyClipIds = null;
                        editor._genVideoStamp = null;
                        try {
                            if (editor._timeline && editor._timelineReady) editor._saveToWidgets();
                            else editor._writeProjectJson(job.projectJson);
                        } catch { /* ignore */ }
                    }
                }
            }
        };
        app.graphToPrompt._capTeClipRunHooked = true;
    }

    async _waitForQueueIdle(timeoutMs = 120000) {
        const start = Date.now();
        while (app.processingQueue) {
            if (Date.now() - start > timeoutMs) {
                throw new Error(T("queue_busy_timeout"));
            }
            await new Promise((r) => setTimeout(r, 50));
        }
    }

    _safeProjectFilename(fallback = T("untitled_project")) {
        const projectName = String(this.projectNameInput?.value || fallback).trim() || fallback;
        return projectName
            .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
            .replace(/[. ]+$/g, "")
            .slice(0, 80) || fallback;
    }

    _makeGenVideoStamp() {
        const d = new Date();
        const p = (n) => String(n).padStart(2, "0");
        return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    }

    _clipSpecifiedVideoPath(clipId, stamp = this._genVideoStamp) {
        const name = this._safeProjectFilename();
        const id = String(clipId || "clip").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 80) || "clip";
        const st = String(stamp || this._makeGenVideoStamp());
        return `CapTimelineEditor/${name}/${st}_${id}.mp4`;
    }

    /** Parse clip id from CapTimelineEditor/{project}/{YYYYMMDD-HHMMSS}_{clipId}.mp4 */
    _clipIdFromSpecifiedVideoPath(file) {
        const n = normalizeOutputVideoPath(file);
        if (!n) return null;
        const m = n.match(/^CapTimelineEditor\/[^/]+\/(\d{8}-\d{6})_(.+)\.mp4$/i);
        return m ? String(m[2]).trim() || null : null;
    }

    _teNotifyBelongsHere(clipId, file) {
        const id = String(clipId || "").trim();
        if (id) {
            if (this._findClipById(id)) return true;
            if (this._pendingGeneratedJobs.some((j) => String(j.clipId) === id)) return true;
        }
        const n = normalizeOutputVideoPath(file);
        if (!n) return false;
        const prefix = `CapTimelineEditor/${this._safeProjectFilename()}/`;
        if (n.startsWith(prefix)) return true;
        const expected = normalizeOutputVideoPath(file);
        return this._pendingGeneratedJobs.some(
            (j) => j.expectedFile && normalizeOutputVideoPath(j.expectedFile) === expected,
        );
    }

    async _pickDirectory(mode = "readwrite") {
        if (typeof window.showDirectoryPicker !== "function") {
            throw new Error(T("directory_picker_unsupported"));
        }
        return window.showDirectoryPicker({ mode });
    }

    async _writeRelativeFile(root, relPath, data) {
        const parts = String(relPath || "").replace(/\\/g, "/").split("/").filter(Boolean);
        if (!parts.length) throw new Error(T("invalid_export_path"));
        let dir = root;
        for (let i = 0; i < parts.length - 1; i++) {
            dir = await dir.getDirectoryHandle(parts[i], { create: true });
        }
        const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
        const writable = await fh.createWritable();
        await writable.write(data);
        await writable.close();
    }

    async _readRelativeFile(root, relPath) {
        const parts = String(relPath || "").replace(/\\/g, "/").split("/").filter(Boolean);
        if (!parts.length) throw new Error(T("invalid_import_path"));
        let dir = root;
        for (let i = 0; i < parts.length - 1; i++) {
            dir = await dir.getDirectoryHandle(parts[i]);
        }
        const fh = await dir.getFileHandle(parts[parts.length - 1]);
        return fh.getFile();
    }

    async _readImportMediaFile(root, kind, file) {
        const rel = String(file || "").replace(/\\/g, "/");
        const base = rel.split("/").filter(Boolean).pop() || "";
        const kindDir = kind === "audio" ? "audios" : kind === "video" ? "videos" : "images";
        const candidates = [...new Set([
            rel,
            base ? `media/${kindDir}/${base}` : "",
            base ? `${kindDir}/${base}` : "",
            base,
        ].filter(Boolean))];
        let lastError = null;
        for (const path of candidates) {
            try {
                return await this._readRelativeFile(root, path);
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError || new Error(T("missing_asset_file", { file }));
    }

    _downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    _validateImportedProject(project) {
        if (!project || typeof project !== "object" || Array.isArray(project)) {
            throw new Error(T("project_root_must_be_object"));
        }
        if (!Array.isArray(project.tracks) && !Array.isArray(project.media) && !Array.isArray(project.resources)) {
            throw new Error(T("project_missing_tracks_media"));
        }
        if (!Array.isArray(project.tracks)) project.tracks = [];
        return this._migrateProjectDocument(project);
    }

    async _applyImportedProject(project, warnings = []) {
        project = this._validateImportedProject(project);
        this._historyReady = false;
        this._stopAudioPlayback();
        this._timeline?.destroy();
        this._timeline = null;
        await this._initTimelineFromWidgets(project, { applySettingsFromProject: true });
        await this._reloadMediaLibrary();
        this._undoStack = [];
        this._redoStack = [];
        this._historyReady = true;
        this._updateHistoryButtons();
        requestAnimationFrame(() => this._timeline?._refresh());
        if (warnings?.length) {
            alert(T("import_complete_with_warnings", { n: warnings.length, list: warnings.slice(0, 8).join("\n") + (warnings.length > 8 ? "\n…" : "") }));
        }
    }

    _iterProjectMedia(project) {
        const doc = this._migrateProjectDocument(project);
        const seen = new Set();
        const rows = [];
        const add = (kind, file, location = "input") => {
            kind = String(kind || "").toLowerCase();
            file = String(file || "").trim().replace(/\\/g, "/");
            if (!kind || !file || !["image", "video", "audio"].includes(kind)) return;
            const key = `${kind}|${file}`;
            if (seen.has(key)) return;
            seen.add(key);
            rows.push({ kind, file, location: String(location || "input") });
        };
        for (const resource of doc.media || []) {
            if (resource && typeof resource === "object") {
                add(resource.kind, resource.file, resource.location);
            }
        }
        return rows;
    }

    _remapProjectFiles(project, mapping) {
        const out = this._migrateProjectDocument(project);
        const mapFile = (kind, file) => {
            file = String(file || "").trim().replace(/\\/g, "/");
            if (!file) return file;
            return mapping.get(`${kind}|${file}`) || file;
        };
        out.media = (out.media || []).filter((r) => r && typeof r === "object").map((resource) => {
            const kind = String(resource.kind || "").toLowerCase();
            return { ...resource, file: mapFile(kind, resource.file), location: "input" };
        });
        delete out.resources;
        const catalog = new Set((out.media || []).map((row) => String(row.id || "")));
        for (const track of out.tracks || []) {
            if (!track || typeof track !== "object") continue;
            for (const clip of track.clips || []) {
                if (!clip || typeof clip !== "object") continue;
                const ids = Array.isArray(clip.media_ids) ? clip.media_ids : [];
                const valid = ids.map((id) => String(id)).filter((id) => catalog.has(id));
                if (valid.length) {
                    clip.media_ids = valid;
                    if (clip.source && typeof clip.source === "object") {
                        const source = {};
                        if (clip.source.in_ms != null) source.in_ms = clip.source.in_ms;
                        if (clip.source.out_ms != null) source.out_ms = clip.source.out_ms;
                        if (clip.source.duration_ms != null) source.duration_ms = clip.source.duration_ms;
                        if (Object.keys(source).length) clip.source = source;
                        else delete clip.source;
                    }
                    delete clip.items;
                    delete clip.end_image;
                    delete clip.start_image;
                    delete clip.audio_file;
                }
            }
        }
        return out;
    }

    async _uploadImportBlob(kind, filename, blob) {
        const form = new FormData();
        form.append("kind", kind);
        form.append("file", blob, filename || `file.${kind === "audio" ? "wav" : kind === "video" ? "mp4" : "png"}`);
        const response = await fetch(api.apiURL("/audio_keyframe_timeline/import_asset"), {
            method: "POST",
            body: form,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || T("upload_asset_failed", { filename }));
        return data;
    }

    async _exportToDirectory() {
        try {
            const dir = await this._pickDirectory("readwrite");
            const response = await fetch(api.apiURL("/audio_keyframe_timeline/export_prepare"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(this._buildProject()),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || T("export_prepare_failed"));
            const missing = [...(data.missing || [])];
            await this._writeRelativeFile(
                dir,
                "project.json",
                new Blob([JSON.stringify(data.project, null, 2)], { type: "application/json;charset=utf-8" }),
            );
            for (const entry of data.files || []) {
                const location = entry.location === "output" ? "output" : "input";
                const url = location === "output"
                    ? this._outputVideoUrl(entry.file)
                    : this._assetFileUrl(entry.file, entry.kind, "input");
                const fileRes = await fetch(url);
                if (!fileRes.ok) {
                    missing.push(entry.file);
                    continue;
                }
                await this._writeRelativeFile(dir, entry.arcname, await fileRes.blob());
            }
            if (missing.length) {
                alert(T("export_to_dir_missing", { n: missing.length, list: missing.slice(0, 8).join("\n") + (missing.length > 8 ? "\n…" : "") }));
            } else {
                alert(T("exported_to_directory"));
            }
        } catch (error) {
            if (error?.name === "AbortError") return;
            alert(T("export_failed", { msg: error instanceof Error ? error.message : String(error) }));
        }
    }

    _composeGeneratedVideosExport() {
        this._openComposeModal();
    }

    _composeDefaultFilename() {
        const stamp = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        const tag = `${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}`
            + `_${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`;
        return `${this._safeProjectFilename()}_${tag}.mp4`;
    }

    _openComposeModal() {
        if (!this.composeModal) return;
        if (this.composePrefixInput && !String(this.composePrefixInput.value || "").trim()) {
            this.composePrefixInput.value = "cap_timeline_compose/";
        }
        if (this.composeFilenameInput) this.composeFilenameInput.value = this._composeDefaultFilename();
        if (this.composeIgnoreAudioCb) this.composeIgnoreAudioCb.checked = false;
        if (this.composeUseGenSizeCb) this.composeUseGenSizeCb.checked = true;
        if (this.composeStatus) {
            this.composeStatus.hidden = true;
            this.composeStatus.textContent = "";
            this.composeStatus.classList.remove("is-error", "is-ok");
        }
        this._composeDone = false;
        this._lastComposeOutput = null;
        if (this.composeRunBtn) {
            this.composeRunBtn.disabled = false;
            this.composeRunBtn.textContent = T("compose_start_btn");
        }
        this._clampWatermarkMargin();
        this._wmActiveTab = this._watermark.image.file ? "image" : "text";
        this._syncWatermarkUiFromState();
        void this._ensureFontList();
        this.composeModal.hidden = false;
        this._scheduleComposePreview();
    }

    _closeComposeModal(force = false) {
        if (this._composeBusy && !force) return;
        this._composeBusy = false;
        if (this.composeRunBtn) this.composeRunBtn.disabled = false;
        if (this.composeModal) this.composeModal.hidden = true;
    }

    _setComposeStatus(text, { error = false, ok = false } = {}) {
        if (!this.composeStatus) return;
        this.composeStatus.hidden = !text;
        this.composeStatus.textContent = text || "";
        this.composeStatus.classList.toggle("is-error", !!error);
        this.composeStatus.classList.toggle("is-ok", !!ok);
    }

    async _runComposeVideoExport() {
        if (this._composeBusy || !this.composeModal) return;
        let filenamePrefix = String(this.composePrefixInput?.value || "").trim() || "cap_timeline_compose/";
        filenamePrefix = filenamePrefix.replace(/\\/g, "/");
        if (this.composePrefixInput) this.composePrefixInput.value = filenamePrefix;

        let filename = String(this.composeFilenameInput?.value || "").trim();
        if (!filename) filename = this._composeDefaultFilename();
        if (!filename.toLowerCase().endsWith(".mp4")) filename += ".mp4";
        filename = filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/g, "");
        if (!filename.toLowerCase().endsWith(".mp4")) filename += ".mp4";
        if (this.composeFilenameInput) this.composeFilenameInput.value = filename;

        this._saveToWidgets();
        const project = this._buildProject();
        this._composeBusy = true;
        if (this.composeRunBtn) this.composeRunBtn.disabled = true;
        this._setComposeStatus(T("composing_please_wait"));
        try {
            const response = await fetch(api.apiURL("/audio_keyframe_timeline/compose_video"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    project,
                    filename_prefix: filenamePrefix,
                    filename,
                    ignore_audio_tracks: !!this.composeIgnoreAudioCb?.checked,
                    use_generated_video_size: this.composeUseGenSizeCb
                        ? !!this.composeUseGenSizeCb.checked
                        : true,
                    watermark: this._watermark,
                }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || T("compose_failed_http", { status: response.status }));

            const outName = data.filename || filename;
            const sub = String(data.subfolder || "").replace(/^\/+|\/+$/g, "");
            const rel = sub ? `${sub}/${outName}` : outName;
            this._lastComposeOutput = { filename: outName, subfolder: sub };
            this._composeDone = true;
            if (this.composeRunBtn) this.composeRunBtn.textContent = T("open_folder_btn");
            this._setComposeStatus(T("saved_to_output", { rel }), { ok: true });
        } catch (error) {
            if (error?.name === "AbortError") {
                this._setComposeStatus("");
                return;
            }
            this._setComposeStatus(error instanceof Error ? error.message : String(error), { error: true });
        } finally {
            this._composeBusy = false;
            if (this.composeRunBtn) this.composeRunBtn.disabled = false;
        }
    }

    async _revealComposeOutput() {
        if (!this._lastComposeOutput) return;
        try {
            const response = await fetch(api.apiURL("/audio_keyframe_timeline/reveal_output"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(this._lastComposeOutput),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || T("open_folder_prepare_failed"));
        } catch (error) {
            alert(T("open_folder_failed", { msg: error instanceof Error ? error.message : String(error) }));
        }
    }

    // ─── Watermark (compose modal) ─────────────────────────────────────────

    _defaultWatermark() {
        return {
            mode: "none",
            text: { content: "", fontFamily: "", fontPath: "", fontSize: 32, letterSpacing: 0, color: "#ffffff" },
            image: { file: "", disabled: false },
            opacity: 80,
            scale: 100,
            position: "bottom-right",
            margin: { top: 24, right: 24, bottom: 24, left: 24, locked: true },
        };
    }

    _normalizeWatermark(raw) {
        const d = this._defaultWatermark();
        const r = raw && typeof raw === "object" ? raw : {};
        const text = r.text && typeof r.text === "object" ? r.text : {};
        const image = r.image && typeof r.image === "object" ? r.image : {};
        const margin = r.margin && typeof r.margin === "object" ? r.margin : {};
        const num = (v, min, max, def) => {
            const n = Number(v);
            return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def;
        };
        const out = {
            text: {
                content: String(text.content ?? d.text.content),
                fontFamily: String(text.fontFamily ?? d.text.fontFamily),
                fontPath: String(text.fontPath ?? d.text.fontPath),
                fontSize: num(text.fontSize, 6, 400, d.text.fontSize),
                letterSpacing: num(text.letterSpacing ?? text.letter_spacing, -50, 200, d.text.letterSpacing),
                color: /^#[0-9a-fA-F]{6}$/.test(text.color || "") ? text.color : d.text.color,
            },
            image: {
                file: String(image.file ?? d.image.file),
                disabled: image.disabled === true,
            },
            opacity: num(r.opacity, 0, 100, d.opacity),
            scale: num(r.scale, 10, 300, d.scale),
            position: WATERMARK_POSITIONS.has(r.position) ? r.position : d.position,
            margin: {
                top: num(margin.top, 0, 100000, d.margin.top),
                right: num(margin.right, 0, 100000, d.margin.right),
                bottom: num(margin.bottom, 0, 100000, d.margin.bottom),
                left: num(margin.left, 0, 100000, d.margin.left),
                locked: margin.locked !== false,
            },
        };
        out.mode = (out.image.file && !out.image.disabled) ? "image" : (out.text.content.trim() ? "text" : "none");
        return out;
    }

    _clampWatermarkMargin() {
        const { w, h } = this.getPreviewSize();
        const maxX = Math.floor(w / 2);
        const maxY = Math.floor(h / 2);
        const m = this._watermark.margin;
        m.top = Math.min(m.top, maxY);
        m.bottom = Math.min(m.bottom, maxY);
        m.left = Math.min(m.left, maxX);
        m.right = Math.min(m.right, maxX);
    }

    _deriveWatermarkMode() {
        const wm = this._watermark;
        const useImage = wm.image.file && !wm.image.disabled;
        wm.mode = useImage ? "image" : (String(wm.text.content || "").trim() ? "text" : "none");
    }

    async _ensureFontList() {
        if (this._systemFonts) return this._systemFonts;
        if (this._systemFontsPromise) return this._systemFontsPromise;
        this._systemFontsPromise = fetch(api.apiURL("/audio_keyframe_timeline/system_fonts"))
            .then((r) => r.json())
            .then((data) => {
                this._systemFonts = Array.isArray(data?.fonts) ? data.fonts : [];
                this._populateFontSelect();
                this._scheduleComposePreview();
                return this._systemFonts;
            })
            .catch(() => {
                this._systemFonts = [];
                this._populateFontSelect();
                return this._systemFonts;
            });
        return this._systemFontsPromise;
    }

    /** CSS font-family value safe for inline style. */
    _cssFontFamily(family) {
        const fam = String(family || "").trim().replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        return fam ? `"${fam}", sans-serif` : "sans-serif";
    }

    _syncFontSelectPreview(select) {
        if (!select) return;
        select.style.fontFamily = this._cssFontFamily(select.value);
    }

    /** Custom dropdown so each row renders in that font (native <option> cannot). */
    _bindFontSelectPreview(select) {
        if (!select || select.dataset.fontPreviewBound) return;
        select.dataset.fontPreviewBound = "1";
        select.classList.add("cat-te-font-select");
        select.addEventListener("mousedown", (e) => {
            if (select.disabled) return;
            e.preventDefault();
            e.stopPropagation();
            this._openFontPicker(select);
        });
        select.addEventListener("keydown", (e) => {
            if (select.disabled) return;
            if (document.querySelector(".cat-te-font-picker")) return;
            if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                this._openFontPicker(select, { startDelta: e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0 });
            }
        });
    }

    _openFontPicker(select, { startDelta = 0 } = {}) {
        if (!select) return;
        this._removeCtxMenu();
        const fonts = [...select.options]
            .map((o) => ({
                family: o.value,
                label: o.textContent || o.value,
                path: o.dataset?.path || "",
            }))
            .filter((f) => f.family);
        if (!fonts.length) return;

        const prevFamily = String(select.value || "");
        const prevPath = String(select.selectedOptions?.[0]?.dataset?.path || "");
        let activeIndex = Math.max(0, fonts.findIndex((f) => f.family === prevFamily));
        if (startDelta) {
            activeIndex = Math.max(0, Math.min(fonts.length - 1, activeIndex + startDelta));
        }

        const menu = document.createElement("div");
        menu.className = "cat-te-font-picker";
        menu.tabIndex = -1;
        const r = select.getBoundingClientRect();
        menu.style.left = `${r.left}px`;
        menu.style.top = `${r.bottom + 2}px`;
        menu.style.minWidth = `${Math.max(r.width, 200)}px`;

        const items = [];
        const applyFontAt = (index, { commit = false } = {}) => {
            activeIndex = Math.max(0, Math.min(fonts.length - 1, index));
            items.forEach((row, i) => row.classList.toggle("is-active", i === activeIndex));
            const row = items[activeIndex];
            row?.scrollIntoView({ block: "nearest" });
            const f = fonts[activeIndex];
            if (!f) return;
            select.value = f.family;
            this._syncFontSelectPreview(select);
            // Subtitle panel listens to `input`; watermark listens to `change`.
            select.dispatchEvent(new Event("input", { bubbles: true }));
            select.dispatchEvent(new Event("change", { bubbles: true }));
            if (commit) this._removeCtxMenu();
        };

        fonts.forEach((f, index) => {
            const row = document.createElement("button");
            row.type = "button";
            row.className = "cat-te-font-picker-item";
            if (index === activeIndex) row.classList.add("is-active");
            row.style.fontFamily = this._cssFontFamily(f.family);
            row.textContent = f.label;
            row.title = f.family;
            row.addEventListener("mouseenter", () => applyFontAt(index));
            row.addEventListener("click", (e) => {
                e.stopPropagation();
                applyFontAt(index, { commit: true });
            });
            menu.appendChild(row);
            items.push(row);
        });

        const onKey = (e) => {
            if (!menu.isConnected) return;
            if (e.key === "ArrowDown") {
                e.preventDefault();
                e.stopPropagation();
                applyFontAt(activeIndex + 1);
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                e.stopPropagation();
                applyFontAt(activeIndex - 1);
            } else if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                applyFontAt(activeIndex, { commit: true });
            } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                select.value = prevFamily;
                this._syncFontSelectPreview(select);
                select.dispatchEvent(new Event("input", { bubbles: true }));
                select.dispatchEvent(new Event("change", { bubbles: true }));
                this._removeCtxMenu();
            } else if (e.key === "Home") {
                e.preventDefault();
                applyFontAt(0);
            } else if (e.key === "End") {
                e.preventDefault();
                applyFontAt(fonts.length - 1);
            }
        };
        menu._capFontKeyHandler = onKey;
        window.addEventListener("keydown", onKey, true);

        (this._overlay || document.body).appendChild(menu);
        this._ignoreCtxCloseOnce = true;
        const mr = menu.getBoundingClientRect();
        if (mr.right > window.innerWidth) {
            menu.style.left = `${Math.max(8, window.innerWidth - mr.width - 8)}px`;
        }
        if (mr.bottom > window.innerHeight) {
            menu.style.top = `${Math.max(8, r.top - mr.height - 2)}px`;
        }
        applyFontAt(activeIndex);
        try { menu.focus({ preventScroll: true }); } catch { /* ignore */ }
    }

    /** Fill a <select> with system fonts; keep `preferred` if present (or as custom option). */
    _fillSystemFontSelect(select, preferred, { autoPickFirst = false } = {}) {
        if (!select) return;
        const fonts = this._systemFonts || [];
        const prev = String(preferred || "").trim();
        select.innerHTML = "";
        if (!fonts.length) {
            const opt = document.createElement("option");
            opt.value = prev;
            opt.textContent = this._systemFonts ? T("font_not_found") : T("font_loading");
            select.appendChild(opt);
            this._syncFontSelectPreview(select);
            this._bindFontSelectPreview(select);
            return;
        }
        for (const f of fonts) {
            const opt = document.createElement("option");
            opt.value = f.family;
            opt.dataset.path = f.path || "";
            opt.textContent = f.family;
            opt.style.fontFamily = this._cssFontFamily(f.family);
            select.appendChild(opt);
        }
        if (prev && fonts.some((f) => f.family === prev)) {
            select.value = prev;
        } else if (prev) {
            const opt = document.createElement("option");
            opt.value = prev;
            opt.textContent = prev;
            opt.style.fontFamily = this._cssFontFamily(prev);
            select.appendChild(opt);
            select.value = prev;
        } else if (autoPickFirst) {
            select.value = fonts[0].family;
        } else {
            select.value = fonts[0].family;
        }
        this._syncFontSelectPreview(select);
        this._bindFontSelectPreview(select);
    }

    _populateFontSelect() {
        const fonts = this._systemFonts || [];
        const wmSelect = this.wmFontFamily;
        if (wmSelect) {
            const current = this._watermark.text.fontFamily;
            this._fillSystemFontSelect(wmSelect, current, { autoPickFirst: true });
            if (fonts.length) {
                if (current && fonts.some((f) => f.family === current)) {
                    wmSelect.value = current;
                } else {
                    wmSelect.value = fonts[0].family;
                    this._watermark.text.fontFamily = fonts[0].family;
                    this._watermark.text.fontPath = fonts[0].path;
                }
            }
        }
        const subSelect = this.subFontSelect;
        if (subSelect) {
            let preferred = subSelect.value;
            const clip = this._selClip;
            if (clip && isSubtitleTrackType(clip.track?.type)) {
                preferred = this._meta.get(clip.id)?.fontFamily || preferred;
            }
            this._fillSystemFontSelect(subSelect, preferred, { autoPickFirst: !preferred });
        }
    }

    async _onWatermarkImagePicked(event) {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        try {
            const uploaded = await this._uploadImportBlob("image", file.name, file);
            this._watermark.image.file = uploaded.file;
            this._watermark.image.disabled = false;
            this._deriveWatermarkMode();
            this._wmActiveTab = "image";
            this._syncWatermarkUiFromState();
            this._scheduleComposePreview();
        } catch (error) {
            alert(T("upload_watermark_image_failed", { msg: error instanceof Error ? error.message : String(error) }));
        }
    }

    _removeWatermarkImage() {
        if (!this._watermark.image.file) return;
        this._openDeleteConfirm(T("confirm_remove_watermark_image"), () => this._removeWatermarkImageNow());
    }

    _removeWatermarkImageNow() {
        this._watermark.image.file = "";
        this._watermark.image.disabled = false;
        this._deriveWatermarkMode();
        this._wmActiveTab = "text";
        this._syncWatermarkUiFromState();
        this._scheduleComposePreview();
    }

    _bindWatermarkUi() {
        this.wmTabs?.forEach((btn) => {
            btn.addEventListener("click", () => {
                this._wmActiveTab = btn.dataset.mode;
                this._syncWatermarkUiFromState();
            });
        });
        this.wmTextContent?.addEventListener("input", () => {
            this._watermark.text.content = this.wmTextContent.value;
            this._deriveWatermarkMode();
            this._scheduleComposePreview();
        });
        this.wmFontFamily?.addEventListener("change", () => {
            const opt = this.wmFontFamily.selectedOptions?.[0];
            this._watermark.text.fontFamily = this.wmFontFamily.value;
            this._watermark.text.fontPath = opt?.dataset.path || "";
            this._syncFontSelectPreview(this.wmFontFamily);
            this._scheduleComposePreview();
        });
        this.wmFontSize?.addEventListener("input", () => {
            this._watermark.text.fontSize = Math.max(6, Math.min(400, Number(this.wmFontSize.value) || 32));
            this._scheduleComposePreview();
        });
        this.wmLetterSpacing?.addEventListener("input", () => {
            this._watermark.text.letterSpacing = Math.max(-50, Math.min(200, Number(this.wmLetterSpacing.value) || 0));
            this._scheduleComposePreview();
        });
        this.wmFontColor?.addEventListener("input", () => {
            this._watermark.text.color = this.wmFontColor.value;
            this._scheduleComposePreview();
        });
        this.wmImageUploadBtn?.addEventListener("click", () => this.wmImageFileInput?.click());
        this.wmImageFileInput?.addEventListener("change", (e) => void this._onWatermarkImagePicked(e));
        this.wmImageDeleteBtn?.addEventListener("click", () => this._removeWatermarkImage());
        this.wmImageDisabledCb?.addEventListener("change", () => {
            this._watermark.image.disabled = !!this.wmImageDisabledCb.checked;
            this._deriveWatermarkMode();
            this._scheduleComposePreview();
        });
        this.wmOpacity?.addEventListener("input", () => {
            this._watermark.opacity = Number(this.wmOpacity.value) || 0;
            if (this.wmOpacityReadout) this.wmOpacityReadout.textContent = `${this._watermark.opacity}%`;
            this._scheduleComposePreview();
        });
        this.wmScale?.addEventListener("input", () => {
            this._watermark.scale = Number(this.wmScale.value) || 100;
            if (this.wmScaleReadout) this.wmScaleReadout.textContent = `${this._watermark.scale}%`;
            this._scheduleComposePreview();
        });
        this.wmPosButtons?.forEach((btn) => {
            btn.addEventListener("click", () => {
                this._watermark.position = btn.dataset.pos;
                this._syncWatermarkPositionUi();
                this._scheduleComposePreview();
            });
        });
        const marginInputs = [
            [this.wmMarginTop, "top"], [this.wmMarginRight, "right"],
            [this.wmMarginBottom, "bottom"], [this.wmMarginLeft, "left"],
        ];
        marginInputs.forEach(([input, key]) => {
            if (!input) return;
            input.addEventListener("input", () => {
                const { w, h } = this.getPreviewSize();
                const limit = (key === "top" || key === "bottom") ? Math.floor(h / 2) : Math.floor(w / 2);
                const v = Math.max(0, Math.min(limit, Math.round(Number(input.value) || 0)));
                input.value = String(v);
                if (this._watermark.margin.locked) {
                    this._watermark.margin.top = v;
                    this._watermark.margin.right = v;
                    this._watermark.margin.bottom = v;
                    this._watermark.margin.left = v;
                    if (this.wmMarginTop) this.wmMarginTop.value = String(v);
                    if (this.wmMarginRight) this.wmMarginRight.value = String(v);
                    if (this.wmMarginBottom) this.wmMarginBottom.value = String(v);
                    if (this.wmMarginLeft) this.wmMarginLeft.value = String(v);
                } else {
                    this._watermark.margin[key] = v;
                }
                this._scheduleComposePreview();
            });
        });
        this.wmMarginLockBtn?.addEventListener("click", () => {
            this._watermark.margin.locked = !this._watermark.margin.locked;
            if (this._watermark.margin.locked) {
                const v = this._watermark.margin.top;
                this._watermark.margin.right = v;
                this._watermark.margin.bottom = v;
                this._watermark.margin.left = v;
                if (this.wmMarginRight) this.wmMarginRight.value = String(v);
                if (this.wmMarginBottom) this.wmMarginBottom.value = String(v);
                if (this.wmMarginLeft) this.wmMarginLeft.value = String(v);
                this._scheduleComposePreview();
            }
            this._syncWatermarkMarginLockUi();
        });
    }

    _syncWatermarkMarginLockUi() {
        const locked = this._watermark.margin.locked;
        if (this.wmMarginLockBtn) {
            this.wmMarginLockBtn.innerHTML = iconHtml(locked ? "lock" : "lockOpen", 14);
            this.wmMarginLockBtn.classList.toggle("is-active", locked);
            this.wmMarginLockBtn.title = locked ? T("watermark_lock_locked_title") : T("watermark_lock_unlocked_title");
        }
    }

    _syncWatermarkPositionUi() {
        const pos = this._watermark.position;
        this.wmPosButtons?.forEach((btn) => btn.classList.toggle("is-active", btn.dataset.pos === pos));
    }

    _syncWatermarkUiFromState() {
        const wm = this._watermark;
        if (this.wmTextContent) this.wmTextContent.value = wm.text.content;
        if (this.wmFontSize) this.wmFontSize.value = String(wm.text.fontSize);
        if (this.wmLetterSpacing) this.wmLetterSpacing.value = String(wm.text.letterSpacing ?? 0);
        if (this.wmFontColor) this.wmFontColor.value = wm.text.color;
        if (this.wmOpacity) this.wmOpacity.value = String(wm.opacity);
        if (this.wmOpacityReadout) this.wmOpacityReadout.textContent = `${wm.opacity}%`;
        if (this.wmScale) this.wmScale.value = String(wm.scale);
        if (this.wmScaleReadout) this.wmScaleReadout.textContent = `${wm.scale}%`;
        if (this.wmMarginTop) this.wmMarginTop.value = String(wm.margin.top);
        if (this.wmMarginRight) this.wmMarginRight.value = String(wm.margin.right);
        if (this.wmMarginBottom) this.wmMarginBottom.value = String(wm.margin.bottom);
        if (this.wmMarginLeft) this.wmMarginLeft.value = String(wm.margin.left);
        this._syncWatermarkMarginLockUi();
        this._syncWatermarkPositionUi();
        if (this.wmImagePreview) {
            if (wm.image.file) {
                this.wmImagePreview.src = this._imgUrl(wm.image.file);
                this.wmImagePreview.hidden = false;
            } else {
                this.wmImagePreview.hidden = true;
                this.wmImagePreview.removeAttribute("src");
            }
        }
        if (this.wmImageDeleteBtn) this.wmImageDeleteBtn.hidden = !wm.image.file;
        if (this.wmImageDisabledRow) this.wmImageDisabledRow.hidden = !wm.image.file;
        if (this.wmImageDisabledCb) this.wmImageDisabledCb.checked = !!wm.image.disabled;
        const tab = this._wmActiveTab || (wm.image.file ? "image" : "text");
        this.wmTabs?.forEach((btn) => btn.classList.toggle("is-active", btn.dataset.mode === tab));
        if (this.wmPanelText) this.wmPanelText.hidden = tab !== "text";
        if (this.wmPanelImage) this.wmPanelImage.hidden = tab !== "image";
        this._populateFontSelect();
    }

    _scheduleComposePreview() {
        if (!this.composePreviewCanvas) return;
        if (this._composePreviewRaf) return;
        this._composePreviewRaf = requestAnimationFrame(() => {
            this._composePreviewRaf = 0;
            this._renderComposePreview();
        });
    }

    _layoutComposePreviewCanvas() {
        const stage = this.composePreviewStage;
        const canvas = this.composePreviewCanvas;
        if (!stage || !canvas) return null;
        const { w, h } = this.getPreviewSize();
        const sw = stage.clientWidth;
        const sh = stage.clientHeight;
        if (sw < 2 || sh < 2) return null;
        const scale = Math.min(sw / w, sh / h);
        const cssW = Math.max(1, Math.floor(w * scale));
        const cssH = Math.max(1, Math.floor(h * scale));
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const pw = Math.max(1, Math.round(cssW * dpr));
        const ph = Math.max(1, Math.round(cssH * dpr));
        if (canvas.width !== pw) canvas.width = pw;
        if (canvas.height !== ph) canvas.height = ph;
        return { canvasW: pw, canvasH: ph };
    }

    _watermarkXY(position, margin, cw, ch, ow, oh) {
        switch (position) {
            case "top-left": return { x: margin.left, y: margin.top };
            case "top-right": return { x: cw - ow - margin.right, y: margin.top };
            case "bottom-left": return { x: margin.left, y: ch - oh - margin.bottom };
            case "bottom-right": return { x: cw - ow - margin.right, y: ch - oh - margin.bottom };
            case "top-center": return { x: (cw - ow) / 2, y: margin.top };
            case "bottom-center": return { x: (cw - ow) / 2, y: ch - oh - margin.bottom };
            case "center":
            default: return { x: (cw - ow) / 2, y: (ch - oh) / 2 };
        }
    }

    _measureTextWithLetterSpacing(ctx, text, letterSpacing) {
        const s = String(text ?? "");
        if (!s) return 0;
        const spacing = Number(letterSpacing) || 0;
        if (!spacing) return ctx.measureText(s).width;
        const chars = Array.from(s);
        let w = 0;
        for (let i = 0; i < chars.length; i++) {
            w += ctx.measureText(chars[i]).width;
            if (i < chars.length - 1) w += spacing;
        }
        return w;
    }

    _drawTextWithLetterSpacing(ctx, text, x, y, letterSpacing, mode = "fill") {
        const s = String(text ?? "");
        if (!s) return;
        const spacing = Number(letterSpacing) || 0;
        if (!spacing) {
            if (mode === "stroke") ctx.strokeText(s, x, y);
            else ctx.fillText(s, x, y);
            return;
        }
        const chars = Array.from(s);
        const totalW = this._measureTextWithLetterSpacing(ctx, s, spacing);
        const align = ctx.textAlign || "left";
        let startX = x;
        if (align === "center") startX = x - totalW / 2;
        else if (align === "right" || align === "end") startX = x - totalW;
        const prevAlign = ctx.textAlign;
        ctx.textAlign = "left";
        let cx = startX;
        for (let i = 0; i < chars.length; i++) {
            if (mode === "stroke") ctx.strokeText(chars[i], cx, y);
            else ctx.fillText(chars[i], cx, y);
            cx += ctx.measureText(chars[i]).width + (i < chars.length - 1 ? spacing : 0);
        }
        ctx.textAlign = prevAlign;
    }

    _drawWatermarkOnCanvas(ctx, cw, ch) {
        const wm = this._watermark;
        if (!wm || wm.mode === "none") return;
        const previewPos = (wm.position === "random-interval" || wm.position === "random-fixed")
            ? "bottom-right" : wm.position;
        const { w: baseW } = this.getPreviewSize();
        const scaleFactor = cw / baseW;
        const margin = {
            top: wm.margin.top * scaleFactor,
            right: wm.margin.right * scaleFactor,
            bottom: wm.margin.bottom * scaleFactor,
            left: wm.margin.left * scaleFactor,
        };
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, (wm.opacity ?? 80) / 100));
        if (wm.mode === "image" && wm.image.file) {
            const entry = this._ensurePreviewImage(this._imgUrl(wm.image.file));
            if (entry?.ready) {
                const iw = entry.el.naturalWidth * scaleFactor * (wm.scale / 100);
                const ih = entry.el.naturalHeight * scaleFactor * (wm.scale / 100);
                const { x, y } = this._watermarkXY(previewPos, margin, cw, ch, iw, ih);
                ctx.drawImage(entry.el, x, y, iw, ih);
            }
        } else if (wm.mode === "text" && wm.text.content) {
            const fontSize = Math.max(1, wm.text.fontSize * scaleFactor * (wm.scale / 100));
            const letterSpacing = (Number(wm.text.letterSpacing) || 0) * scaleFactor * (wm.scale / 100);
            const family = wm.text.fontFamily ? `"${wm.text.fontFamily}", sans-serif` : "sans-serif";
            ctx.font = `${fontSize}px ${family}`;
            ctx.fillStyle = wm.text.color || "#ffffff";
            ctx.textBaseline = "top";
            ctx.textAlign = "left";
            const lines = String(wm.text.content).split("\n");
            const lineHeight = fontSize * 1.25;
            const textW = Math.max(0, ...lines.map((l) => this._measureTextWithLetterSpacing(ctx, l, letterSpacing)));
            const textH = lineHeight * lines.length;
            const { x, y } = this._watermarkXY(previewPos, margin, cw, ch, textW, textH);
            lines.forEach((line, i) => {
                this._drawTextWithLetterSpacing(ctx, line, x, y + i * lineHeight, letterSpacing, "fill");
            });
        }
        ctx.restore();
    }

    _renderComposePreview() {
        const layout = this._layoutComposePreviewCanvas();
        const canvas = this.composePreviewCanvas;
        if (!layout || !canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const { canvasW: cw, canvasH: ch } = layout;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, cw, ch);
        const t = this._timeline?.currentTime ?? 0;
        this._drawPreviewLayersOnce(ctx, cw, ch, t);
        this._drawSubtitleOverlays(ctx, cw, ch, t);
        this._drawWatermarkOnCanvas(ctx, cw, ch);
    }

    async _exportAsZip() {
        try {
            const response = await fetch(api.apiURL("/audio_keyframe_timeline/export_zip"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(this._buildProject()),
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || T("export_zip_failed"));
            }
            const blob = await response.blob();
            const headerName = response.headers.get("X-Export-Filename");
            const filename = headerName || `${this._safeProjectFilename()}.zip`;
            const missingHeader = response.headers.get("X-Export-Missing") || "";
            const missing = missingHeader ? missingHeader.split(",").filter(Boolean) : [];

            try {
                const dir = await this._pickDirectory("readwrite");
                await this._writeRelativeFile(dir, filename, blob);
            } catch (pickerError) {
                if (pickerError?.name === "AbortError") return;
                if (typeof window.showDirectoryPicker !== "function") {
                    this._downloadBlob(blob, filename);
                } else {
                    throw pickerError;
                }
            }
            if (missing.length) {
                alert(T("export_zip_missing", { n: missing.length, list: missing.slice(0, 8).join("\n") + (missing.length > 8 ? "\n…" : "") }));
            }
        } catch (error) {
            if (error?.name === "AbortError") return;
            alert(T("export_failed", { msg: error instanceof Error ? error.message : String(error) }));
        }
    }

    _chooseZipImport() {
        if (!this._confirmOverwriteImport()) return;
        this.importZipInput.value = "";
        this.importZipInput.click();
    }

    async _importFromDirectory() {
        if (!this._confirmOverwriteImport()) return;
        try {
            const dir = await this._pickDirectory("read");
            const projectFile = await this._readRelativeFile(dir, "project.json");
            const project = this._validateImportedProject(JSON.parse(await projectFile.text()));
            const mapping = new Map();
            const warnings = [];
            for (const row of this._iterProjectMedia(project)) {
                let fileObj;
                try {
                    fileObj = await this._readImportMediaFile(dir, row.kind, row.file);
                } catch {
                    warnings.push(T("missing_asset_file", { file: row.file }));
                    continue;
                }
                const uploaded = await this._uploadImportBlob(row.kind, fileObj.name || row.file.split("/").pop(), fileObj);
                mapping.set(`${row.kind}|${row.file}`, uploaded.file);
            }
            const remapped = this._remapProjectFiles(project, mapping);
            const clipCount = (remapped.tracks || []).reduce(
                (n, track) => n + (Array.isArray(track?.clips) ? track.clips.length : 0),
                0,
            );
            if (!clipCount) {
                alert(T("import_no_clips"));
            }
            await this._applyImportedProject(remapped, warnings);
        } catch (error) {
            if (error?.name === "AbortError") return;
            alert(T("import_failed", { msg: error instanceof Error ? error.message : String(error) }));
        }
    }

    async _importProjectZip(event) {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        try {
            const form = new FormData();
            form.append("file", file, file.name || "project.zip");
            const response = await fetch(api.apiURL("/audio_keyframe_timeline/import_project_zip"), {
                method: "POST",
                body: form,
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || T("import_zip_failed"));
            await this._applyImportedProject(data.project, data.warnings || []);
        } catch (error) {
            alert(T("import_failed", { msg: error instanceof Error ? error.message : String(error) }));
        }
    }

    destroy() {
        if (this._destroyed) return;
        // Save BEFORE marking destroyed — `_saveToWidgets` bails on `_destroyed`,
        // and tab-switch teardown (beforeConfigureGraph) used to skip the flush.
        try { this._closeInternal(true); } catch { /* continue teardown */ }
        this._destroyed = true;
        if (this._onDocClick) {
            document.removeEventListener("click", this._onDocClick);
            this._onDocClick = null;
        }
        if (this._onWinResize) {
            window.removeEventListener("resize", this._onWinResize);
            this._onWinResize = null;
        }
        if (this._onMediaPanelWinResize) {
            window.removeEventListener("resize", this._onMediaPanelWinResize);
            this._onMediaPanelWinResize = null;
        }
        if (this._onProgramPanelWinResize) {
            window.removeEventListener("resize", this._onProgramPanelWinResize);
            this._onProgramPanelWinResize = null;
        }
        if (this._playbackCtx) {
            this._playbackCtx.close().catch(() => {});
            this._playbackCtx = null;
        }
        this._modalObserver?.disconnect();
        this._overlay?.remove();
        this._overlay = null;
        CapTimelineEditorApp._instances.delete(this);
        if (CapTimelineEditorApp._open === this) CapTimelineEditorApp._open = null;
        this._unbindExecutionWatch();
        this._clearAllRunPreviews();
        if (this._modelPreviewEntry?.url) URL.revokeObjectURL(this._modelPreviewEntry.url);
        this._modelPreviewEntry = null;
        document.body.classList.remove(...BODY_UI_CLASSES);
    }

    _ensureOverlay() {
        if (this._overlay) {
            this._syncClipSettingRefs();
            return;
        }
        const el = document.createElement("div");
        el.className = "cat-te-overlay";
        el.tabIndex = -1;
        el.innerHTML = `
          <header class="cat-te-header">
            <div class="cat-te-brand">
              ${iconHtml("rabbit", 22)}
              <span class="cat-te-brand-name">${T("header_brand_name")}</span>
              <span class="cat-te-brand-sep"> | </span>
              <button type="button" class="cat-te-brand-project" title="${T("edit_project_name_title")}">${T("untitled_project")}</button>
            </div>
            <div class="cat-te-header-spacer"></div>
            <div class="cat-te-header-scalars" title="${T("node_size_fps_title")}"></div>
            <button type="button" class="cat-te-btn cat-te-import">${T("import_btn_caret")}</button>
            <button type="button" class="cat-te-btn cat-te-export">${T("export_btn_caret")}</button>
            <button type="button" class="cat-te-btn cat-te-settings">${T("settings_btn")}</button>
            <button type="button" class="cat-te-btn cat-te-header-close" title="${T("close_title")}">${iconHtml("close", 16)}</button>
            <input class="cat-te-import-zip" type="file" accept=".zip,application/zip" hidden />
          </header>
          <div class="cat-te-main">
            <aside class="cat-te-media">
              <div class="cat-te-media-header">
                <div class="cat-te-media-title">${T("media_title")}</div>
                <div class="cat-te-media-header-actions"></div>
              </div>
              <div class="cat-te-media-tabs" role="tablist" aria-label="${T("media_title")}">
                ${MEDIA_LIBRARY_TABS.map((tab) => `<button type="button" class="cat-te-media-tab" role="tab" data-kind="${tab.id}" aria-selected="${tab.id === "image"}">${tab.label}</button>`).join("")}
              </div>
              <div class="cat-te-media-grid"></div>
              <div class="cat-te-media-footer">
                <button type="button" class="cat-te-btn cat-te-media-primary-action"></button>
              </div>
            </aside>
            <div class="cat-te-media-split" role="separator" aria-orientation="vertical" aria-label="${T("media_split_aria")}" title="${T("media_split_title")}"></div>
            <div class="cat-te-center">
              <div class="cat-te-program">
                <div class="cat-te-program-stage">
                  <canvas class="cat-te-program-canvas" aria-label="${T("program_preview_aria")}"></canvas>
                  <div class="cat-te-program-empty" hidden>${T("no_frame")}</div>
                </div>
                <div class="cat-te-program-meta"></div>
              </div>
              <div class="cat-te-program-split" role="separator" aria-orientation="horizontal" aria-label="${T("program_split_aria")}" title="${T("program_split_title")}"></div>
              <div class="cat-te-timeline-host"></div>
            </div>
            <div class="cat-te-sidebar-split" role="separator" aria-orientation="vertical" aria-label="${T("sidebar_split_aria")}" title="${T("sidebar_split_title")}"></div>
            <aside class="cat-te-sidebar">
              <div class="cat-te-panel-title cat-te-sidebar-title">${T("project_settings_title")}</div>
              <div class="cat-te-project-panel">
                <div class="cat-te-project-body">
                  <label class="cat-te-project-name-row">
                    <span>${T("project_name_label")}</span>
                    <input class="cat-te-title" type="text" value="${T("untitled_project")}" aria-label="${T("project_name_label")}" />
                  </label>
                  <div class="cat-te-project-scalars" aria-label="${T("scalars_aria")}"></div>
                  <div class="cat-te-settings-prompts">
                    <div class="cat-te-prompt-wrap cat-te-settings-prompt-wrap" data-setting-prompt="prepend_prompt">
                      <div class="cat-te-prompt-label-row">
                        <div class="cat-te-prompt-label">${T("prepend_prompt_label")}</div>
                      </div>
                      <div class="cat-te-prompt-input-wrap">
                        <textarea class="cat-te-settings-prompt-input cat-te-prepend-prompt-input" data-setting-prompt-input="prepend_prompt" placeholder="${T("prepend_prompt_placeholder")}"></textarea>
                      </div>
                    </div>
                    <div class="cat-te-prompt-wrap cat-te-settings-prompt-wrap" data-setting-prompt="append_prompt">
                      <div class="cat-te-prompt-label-row">
                        <div class="cat-te-prompt-label">${T("append_prompt_label")}</div>
                      </div>
                      <div class="cat-te-prompt-input-wrap">
                        <textarea class="cat-te-settings-prompt-input" data-setting-prompt-input="append_prompt" placeholder="${T("append_prompt_placeholder")}"></textarea>
                      </div>
                    </div>
                    <div class="cat-te-prompt-order" aria-label="${T("prompt_concat_order_label")}">
                      <div class="cat-te-prompt-order-label">${T("prompt_concat_order_label")}</div>
                      <div class="cat-te-prompt-order-hint">${T("prompt_concat_order_hint")}</div>
                      <div class="cat-te-prompt-order-list"></div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="cat-te-clip-panel" hidden>
              <div class="cat-te-clip-info">
                <div class="cat-te-clip-info-body">
                  <div class="cat-te-clip-info-detail" hidden>
                    <div class="cat-te-clip-swiper">
                      <button type="button" class="cat-te-clip-swiper-nav prev" title="${T("prev_material")}" hidden>‹</button>
                      <div class="cat-te-clip-thumb-wrap">
                        <img class="cat-te-clip-thumb" alt="" />
                        <video class="cat-te-clip-thumb-video" muted playsinline hidden></video>
                        <div class="cat-te-clip-thumb-empty" hidden>${T("empty_clip")}</div>
                        <div class="cat-te-clip-thumb-subtitle" hidden>T</div>
                        <button type="button" class="cat-te-clip-thumb-sort" title="${T("view_material_title")}" hidden>${iconHtml("squareArrowOutUpRight", 12)}</button>
                        <button type="button" class="cat-te-clip-thumb-delete" title="${T("remove_from_clip_title")}" hidden>${iconHtml("trash", 12)}</button>
                      </div>
                      <button type="button" class="cat-te-clip-swiper-nav next" title="${T("next_material")}" hidden>›</button>
                      <span class="cat-te-clip-item-index"></span>
                    </div>
                    <div class="cat-te-clip-meta">
                      <div class="cat-te-clip-name-row">
                        <div class="cat-te-clip-name"></div>
                      </div>
                      <div class="cat-te-clip-id" hidden></div>

                      <div class="cat-te-clip-times">
                        <span class="cat-te-clip-start"></span>
                        <span class="cat-te-clip-sep">→</span>
                        <span class="cat-te-clip-end"></span>
                      </div>
                      <div class="cat-te-clip-source-trim" hidden>
                        <span class="cat-te-clip-source-trim-label"></span>
                        <span class="cat-te-clip-source-in"></span>
                        <span class="cat-te-clip-sep">→</span>
                        <span class="cat-te-clip-source-out"></span>
                      </div>
                      <div class="cat-te-clip-source-dur" hidden></div>
                      <div class="cat-te-clip-dur"></div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="cat-te-visual-clip-body">
              <div class="cat-te-clip-settings">
                <label class="cat-te-clip-setting-row">
                  <span>${T("type_label")}</span>
                  <select class="cat-te-clip-role" disabled>
                    <option value="multi_ref">${T("clip_role_multi_ref")}</option>
                    <option value="first_last">${T("clip_role_first_last")}</option>
                    <option value="t2v">${T("clip_role_t2v")}</option>
                    <option value="video_ref">${T("clip_role_video_ref")}</option>
                    <option value="video_edit">${T("clip_role_video_edit")}</option>
                    <option value="other">${T("clip_role_other")}</option>
                  </select>
                </label>
                <label class="cat-te-clip-setting-row cat-te-clip-role-custom-row" hidden>
                  <span>${T("custom_type_label")}</span>
                  <input class="cat-te-clip-role-custom" type="text" placeholder="${T("enter_type_placeholder")}" disabled />
                </label>
                <label class="cat-te-clip-setting-row">
                  <span>Agent</span>
                  <select class="cat-te-clip-agent" disabled>
                    <option value="MiniMaxH3">MiniMaxH3</option>
                    <option value="LTX">LTX</option>
                    <option value="Bernini">Bernini</option>
                    <option value="Wan">Wan</option>
                    <option value="other">${T("clip_role_other")}</option>
                  </select>
                </label>
                <label class="cat-te-clip-setting-row cat-te-clip-agent-custom-row" hidden>
                  <span>${T("custom_agent_label")}</span>
                  <input class="cat-te-clip-agent-custom" type="text" placeholder="${T("enter_model_name_placeholder")}" disabled />
                </label>
                <label class="cat-te-clip-setting-row">
                  <span>${T("head_extend_label")}</span>
                  <input class="cat-te-head-extend" type="number" min="0" max="600" step="1" value="0" disabled />
                </label>
                <label class="cat-te-clip-setting-row">
                  <span>${T("tail_extend_label")}</span>
                  <input class="cat-te-tail-extend" type="number" min="0" max="600" step="1" value="0" disabled />
                </label>
                <label class="cat-te-clip-setting-check">
                  <input class="cat-te-gen-preview-video" type="checkbox" disabled />
                  <span>${T("gen_preview_video_label")}</span>
                </label>
                <label class="cat-te-clip-setting-check">
                  <input class="cat-te-second-sample" type="checkbox" disabled />
                  <span>${T("second_sample_label")}</span>
                </label>
                <label class="cat-te-clip-setting-row" title="${T("h3_motion_context_length_title")}">
                  <span>${T("h3_motion_context_length_label")}</span>
                  <input class="cat-te-h3-motion-context" type="number" min="0" step="1" list="cat-te-h3-motion-context-values" value="0" disabled />
                  <datalist id="cat-te-h3-motion-context-values">
                    <option value="0"></option>
                    <option value="5"></option>
                    <option value="22"></option>
                    <option value="39"></option>
                    <option value="90"></option>
                    <option value="141"></option>
                    <option value="192"></option>
                  </datalist>
                </label>
                <label class="cat-te-clip-setting-check" title="${T("save_latent_title")}">
                  <input class="cat-te-save-latent" type="checkbox" disabled />
                  <span>${T("save_latent_label")}</span>
                </label>
                <div class="cat-te-clip-setting-row cat-te-seed-row" title="${T("clip_seed_title")}">
                  <span>${T("clip_seed_label")}</span>
                  <input class="cat-te-clip-seed" type="number" min="-1" max="9007199254740991" step="1" value="-1" disabled />
                  <button type="button" class="cat-te-btn cat-te-clip-seed-random" title="${T("randomize_seed_title")}" disabled>${iconHtml("refresh", 12)}</button>
                </div>
              </div>
              <div class="cat-te-prompt-wrap">
                <div class="cat-te-prompt-label-row">
                  <div class="cat-te-prompt-label">${T("final_composed_prompt_label")}</div>
                  <button type="button" class="cat-te-ai-optimize-btn" title="${T("edit_prompt_title")}" disabled>${iconHtml("text", 12)}<span>${T("edit_btn")}</span></button>
                </div>
                <div class="cat-te-prompt-input-wrap cat-te-final-prompt-wrap">
                  <textarea class="cat-te-prompt-input cat-te-final-prompt" readonly placeholder="${T("final_composed_prompt_placeholder")}" disabled></textarea>
                </div>
              </div>
              <div class="cat-te-clip-videos" hidden>
                <div class="cat-te-clip-videos-header">
                  <span>${T("gen_video_label")}</span>
                  <button type="button" class="cat-te-clip-videos-open" title="${T("preview_manage_title")}">${iconHtml("squareArrowOutUpRight", 12)}</button>
                </div>
                <div class="cat-te-clip-videos-list"></div>
              </div>
              </div>
              <div class="cat-te-subtitle-panel" hidden>
                <label class="cat-te-clip-setting-row cat-te-sub-text-row">
                  <span>${T("subtitle_text_label")}</span>
                  <textarea class="cat-te-sub-text" rows="3" placeholder="${T("subtitle_default_text")}"></textarea>
                </label>
                <div class="cat-te-sub-style-title">${T("subtitle_track_style_title")}</div>
                <label class="cat-te-clip-setting-row">
                  <span>${T("subtitle_font_label")}</span>
                  <select class="cat-te-sub-font"></select>
                </label>
                <label class="cat-te-clip-setting-row">
                  <span>${T("subtitle_size_label")}</span>
                  <input class="cat-te-sub-size" type="number" min="8" max="400" step="1" value="48" />
                </label>
                <label class="cat-te-clip-setting-row">
                  <span>${T("letter_spacing_label")}</span>
                  <input class="cat-te-sub-letter-spacing" type="number" min="-50" max="200" step="1" value="0" />
                </label>
                <label class="cat-te-clip-setting-row">
                  <span>${T("subtitle_color_label")}</span>
                  <input class="cat-te-sub-color" type="color" value="#ffffff" />
                </label>
                <div class="cat-te-sub-check-row">
                  <label class="cat-te-clip-setting-check"><input class="cat-te-sub-bold" type="checkbox" /><span>${T("subtitle_bold_label")}</span></label>
                  <label class="cat-te-clip-setting-check"><input class="cat-te-sub-italic" type="checkbox" /><span>${T("subtitle_italic_label")}</span></label>
                </div>
                <label class="cat-te-clip-setting-row">
                  <span>${T("subtitle_opacity_label")}</span>
                  <input class="cat-te-sub-opacity" type="range" min="0" max="100" step="1" value="100" />
                  <span class="cat-te-sub-opacity-val">100%</span>
                </label>
                <label class="cat-te-clip-setting-check"><input class="cat-te-sub-stroke" type="checkbox" checked /><span>${T("subtitle_stroke_label")}</span></label>
                <label class="cat-te-clip-setting-row">
                  <span>${T("subtitle_stroke_color_label")}</span>
                  <input class="cat-te-sub-stroke-color" type="color" value="#000000" />
                </label>
                <label class="cat-te-clip-setting-row">
                  <span>${T("subtitle_stroke_width_label")}</span>
                  <input class="cat-te-sub-stroke-width" type="number" min="0" max="40" step="0.5" value="3" />
                </label>
                <label class="cat-te-clip-setting-check"><input class="cat-te-sub-shadow" type="checkbox" checked /><span>${T("subtitle_shadow_label")}</span></label>
                <label class="cat-te-clip-setting-row">
                  <span>${T("subtitle_shadow_color_label")}</span>
                  <input class="cat-te-sub-shadow-color" type="color" value="#000000" />
                </label>
                <label class="cat-te-clip-setting-row">
                  <span>${T("subtitle_shadow_blur_label")}</span>
                  <input class="cat-te-sub-shadow-blur" type="number" min="0" max="64" step="1" value="4" />
                </label>
                <label class="cat-te-clip-setting-row">
                  <span>${T("subtitle_shadow_x_label")}</span>
                  <input class="cat-te-sub-shadow-x" type="number" min="-64" max="64" step="1" value="2" />
                </label>
                <label class="cat-te-clip-setting-row">
                  <span>${T("subtitle_shadow_y_label")}</span>
                  <input class="cat-te-sub-shadow-y" type="number" min="-64" max="64" step="1" value="2" />
                </label>
                <label class="cat-te-clip-setting-row">
                  <span>${T("subtitle_align_label")}</span>
                  <select class="cat-te-sub-align">
                    <option value="left">${T("subtitle_align_left")}</option>
                    <option value="center" selected>${T("subtitle_align_center")}</option>
                    <option value="right">${T("subtitle_align_right")}</option>
                  </select>
                </label>
                <label class="cat-te-clip-setting-row">
                  <span>${T("subtitle_valign_label")}</span>
                  <select class="cat-te-sub-valign">
                    <option value="top">${T("subtitle_valign_top")}</option>
                    <option value="middle">${T("subtitle_valign_middle")}</option>
                    <option value="bottom" selected>${T("subtitle_valign_bottom")}</option>
                  </select>
                </label>
                <label class="cat-te-clip-setting-row">
                  <span>${T("subtitle_offset_x_label")}</span>
                  <input class="cat-te-sub-offset-x" type="number" min="-50" max="50" step="1" value="0" />
                </label>
                <label class="cat-te-clip-setting-row">
                  <span>${T("subtitle_offset_y_label")}</span>
                  <input class="cat-te-sub-offset-y" type="number" min="-50" max="50" step="1" value="8" />
                </label>
                <div class="cat-te-sub-apply-row">
                  <button type="button" class="cat-te-btn cat-te-sub-apply-all">${T("subtitle_apply_all_btn")}</button>
                </div>
              </div>
              <div class="cat-te-voiceover-panel" hidden>
                <label class="cat-te-clip-setting-row cat-te-vo-prompt-row">
                  <span>${T("desc_prompt_label")}</span>
                  <textarea class="cat-te-vo-prompt" rows="4" placeholder="${T("voiceover_prompt_placeholder")}"></textarea>
                </label>
                <label class="cat-te-clip-setting-row cat-te-vo-prompt-row">
                  <span>${T("style_prompt_label")}</span>
                  <textarea class="cat-te-vo-style-prompt" rows="3" placeholder="${T("style_prompt_placeholder")}"></textarea>
                </label>
                <div class="cat-te-clip-videos cat-te-vo-audios">
                  <div class="cat-te-clip-videos-header">
                    <span>${T("gen_audio_label")}</span>
                    <div class="cat-te-vo-audios-actions">
                      <button type="button" class="cat-te-btn cat-te-vo-audio-add" title="${T("linked_generated_audios_title")}">${T("voiceover_add_audio_btn")}</button>
                      <button type="button" class="cat-te-clip-videos-open cat-te-vo-audio-edit" title="${T("voiceover_edit_title")}">${iconHtml("squareArrowOutUpRight", 12)}</button>
                    </div>
                  </div>
                  <div class="cat-te-vo-audios-list"></div>
                </div>
              </div>
              </div>
              <div class="cat-te-shortcuts">
                ${T("shortcuts_html")}
              </div>
            </aside>
          </div>
          <footer class="cat-te-footer">
            <div class="cat-te-footer-center"></div>
            <input class="cat-te-add-material-file" type="file" accept="image/*,video/*,audio/*" multiple hidden />
          </footer>
          <div class="cat-te-frame-preview"></div>
          <div class="cat-te-modal-backdrop cat-te-media-preview-modal" hidden>
            <div class="cat-te-modal cat-te-media-preview-dialog">
              <div class="cat-te-modal-header cat-te-media-preview-header">
                <span class="cat-te-media-preview-title">${T("media_preview_title")}</span>
                <div class="cat-te-media-preview-stars"></div>
                <button type="button" class="cat-te-modal-close cat-te-media-preview-close" title="${T("close_title")}">${iconHtml("close", 16)}</button>
              </div>
              <div class="cat-te-media-preview-body">
                <button type="button" class="cat-te-media-preview-nav prev" title="${T("prev_image_title")}" aria-label="${T("prev_image_aria")}">‹</button>
                <div class="cat-te-media-preview-stage"></div>
                <button type="button" class="cat-te-media-preview-nav next" title="${T("next_image_title")}" aria-label="${T("next_image_aria")}">›</button>
              </div>
              <div class="cat-te-media-preview-meta">
                <div class="cat-te-media-info-tabs" role="tablist">
                  <button type="button" class="cat-te-btn active" role="tab" aria-selected="true" data-media-tab="settings">${T("media_basic_settings")}</button>
                  <button type="button" class="cat-te-btn" role="tab" aria-selected="false" data-media-tab="info">${T("media_file_info")}</button>
                </div>
                <div class="cat-te-media-settings-panel" role="tabpanel">
                  <div class="cat-te-media-preview-meta-row cat-te-media-preview-desc-row">
                    <span class="cat-te-media-preview-desc-label">${T("desc_prompt_label")}</span>
                    <div class="cat-te-media-preview-desc-wrap">
                      <textarea class="cat-te-media-preview-desc" rows="3" placeholder="${T("asset_desc_placeholder")}"></textarea>
                    </div>
                  </div>
                  <div class="cat-te-media-preview-meta-row cat-te-media-preview-desc-row">
                    <span class="cat-te-media-preview-desc-label">${T("media_generation_prompt")}</span>
                    <div class="cat-te-media-preview-desc-wrap">
                      <textarea class="cat-te-media-generation-prompt" rows="3" placeholder="${T("media_generation_prompt_placeholder")}"></textarea>
                    </div>
                  </div>
                  <div class="cat-te-media-preview-meta-row cat-te-media-preview-desc-row">
                    <span class="cat-te-media-preview-desc-label">${T("media_asset_description")}</span>
                    <div class="cat-te-media-preview-desc-wrap">
                      <textarea class="cat-te-media-setting-description" rows="3" placeholder="${T("media_asset_description_placeholder")}"></textarea>
                    </div>
                  </div>
                  <div class="cat-te-media-preview-meta-grid">
                    <label class="cat-te-media-preview-meta-row">
                      <span>${T("type_label")}</span>
                      <select class="cat-te-media-preview-type">
                        <option value="">${T("not_set_option")}</option>
                        <option value="character">${T("asset_type_character")}</option>
                        <option value="scene">${T("asset_type_scene")}</option>
                        <option value="prop">${T("asset_type_prop")}</option>
                        <option value="other">${T("asset_type_other")}</option>
                      </select>
                    </label>
                    <label class="cat-te-media-preview-meta-row cat-te-media-preview-type-custom-row" hidden>
                      <span>${T("custom_type_label")}</span>
                      <input class="cat-te-media-preview-type-custom" type="text" placeholder="${T("enter_type_placeholder")}" />
                    </label>
                    <label class="cat-te-media-preview-meta-row cat-te-media-preview-tags-row">
                      <span>${T("tags_label")}</span>
                      <input class="cat-te-media-preview-tags" type="text" placeholder="${T("tags_placeholder")}" />
                    </label>
                  </div>
                </div>
                <div class="cat-te-media-info-panel" role="tabpanel" hidden></div>
                <div class="cat-te-media-meta-actions">
                  <button type="button" class="cat-te-btn cat-te-media-meta-open">${T("media_view_meta")}</button>
                </div>
              </div>
              <div class="cat-te-media-preview-footer">
                <span class="cat-te-media-preview-hint">${T("media_preview_hint")}</span>
                <div class="cat-te-media-preview-actions">
                  <button type="button" class="cat-te-btn cat-te-btn-primary cat-te-media-preview-insert">${T("insert_at_position_btn")}</button>
                </div>
              </div>
            </div>
          </div>
          <div class="cat-te-modal-backdrop cat-te-raw-meta-modal" hidden>
            <div class="cat-te-modal cat-te-raw-meta-dialog" role="dialog" aria-modal="true" aria-label="${T("media_raw_meta")}">
              <div class="cat-te-modal-header">
                <span>${T("media_raw_meta")}</span>
                <button type="button" class="cat-te-modal-close cat-te-raw-meta-close" title="${T("close_title")}">${iconHtml("close", 16)}</button>
              </div>
              <pre class="cat-te-raw-meta-text" tabindex="0"></pre>
            </div>
          </div>
          <div class="cat-te-modal-backdrop cat-te-clip-items-modal" hidden>
            <div class="cat-te-modal cat-te-clip-items-dialog">
              <div class="cat-te-modal-header">
                <span class="cat-te-clip-items-title">${T("clip_items_title")}</span>
                <button type="button" class="cat-te-modal-close cat-te-clip-items-close" title="${T("close_title")}">${iconHtml("close", 16)}</button>
              </div>
              <div class="cat-te-clip-items-body"></div>
            </div>
          </div>
          <div class="cat-te-modal-backdrop cat-te-gen-video-modal" hidden>
            <div class="cat-te-modal cat-te-media-preview-dialog">
              <div class="cat-te-modal-header cat-te-media-preview-header">
                <span class="cat-te-gen-video-title">${T("gen_video_label")}</span>
                <button type="button" class="cat-te-modal-close cat-te-gen-video-close" title="${T("close_title")}">${iconHtml("close", 16)}</button>
              </div>
              <div class="cat-te-media-preview-body cat-te-gen-video-body">
                <button type="button" class="cat-te-media-preview-nav prev cat-te-gen-video-prev" title="${T("prev_short")}" aria-label="${T("prev_short")}">‹</button>
                <div class="cat-te-media-preview-stage cat-te-gen-video-stage"></div>
                <button type="button" class="cat-te-media-preview-nav next cat-te-gen-video-next" title="${T("next_short")}" aria-label="${T("next_short")}">›</button>
              </div>
              <div class="cat-te-media-preview-meta cat-te-gen-video-meta">
                <label class="cat-te-clip-setting-check">
                  <input class="cat-te-gen-video-enabled" type="checkbox" checked />
                  <span>${T("enabled_label")}</span>
                </label>
                <label class="cat-te-clip-setting-check">
                  <input class="cat-te-gen-video-muted" type="checkbox" />
                  <span>${T("muted_label")}</span>
                </label>
                <label class="cat-te-media-preview-meta-row">
                  <span>${T("note_label")}</span>
                  <textarea class="cat-te-gen-video-note" rows="3" placeholder="${T("video_note_placeholder")}"></textarea>
                </label>
                <button type="button" class="cat-te-btn cat-te-gen-video-delete">${T("delete_btn")}</button>
              </div>
            </div>
          </div>
          <div class="cat-te-modal-backdrop cat-te-gen-edit-modal" hidden>
            <div class="cat-te-modal cat-te-gen-edit-dialog">
              <div class="cat-te-modal-header">
                <span class="cat-te-gen-edit-title">${T("gen_edit_modal_title")}</span>
                <button type="button" class="cat-te-modal-close cat-te-gen-edit-close" title="${T("close_title")}">${iconHtml("close", 16)}</button>
              </div>
              <div class="cat-te-gen-edit-body">
                <div class="cat-te-gen-edit-left">
                  <div class="cat-te-gen-edit-preview">
                    <canvas class="cat-te-gen-edit-preview-canvas"></canvas>
                    <div class="cat-te-gen-edit-preview-empty">${T("gen_edit_preview_empty")}</div>
                  </div>
                  <div class="cat-te-gen-edit-vsplit" title="${T("gen_edit_resize_preview_title")}"></div>
                  <div class="cat-te-gen-edit-tl-host"></div>
                </div>
                <div class="cat-te-gen-edit-right">
                  <div class="cat-te-gen-edit-name" title=""></div>
                  <div class="cat-te-gen-edit-file" title=""></div>
                  <label class="cat-te-gen-edit-field">
                    <span>${T("desc_prompt_label")}</span>
                    <textarea class="cat-te-gen-edit-prompt" rows="8" placeholder="${T("gen_edit_prompt_placeholder")}"></textarea>
                  </label>
                  <button type="button" class="cat-te-btn cat-te-gen-edit-dub" disabled title="${T("gen_edit_dub_todo_title")}">${T("gen_edit_dub_btn")}</button>
                  <p class="cat-te-gen-edit-hint">${T("gen_edit_select_hint")}</p>
                </div>
              </div>
            </div>
          </div>
          <div class="cat-te-modal-backdrop cat-te-vo-edit-modal" hidden>
            <div class="cat-te-modal cat-te-gen-edit-dialog cat-te-vo-edit-dialog">
              <div class="cat-te-modal-header">
                <span class="cat-te-vo-edit-title">${T("voiceover_edit_modal_title")}</span>
                <button type="button" class="cat-te-modal-close cat-te-vo-edit-close" title="${T("close_title")}">${iconHtml("close", 16)}</button>
              </div>
              <div class="cat-te-gen-edit-body">
                <div class="cat-te-gen-edit-left cat-te-vo-edit-left">
                  <div class="cat-te-vo-edit-preview">
                    <audio class="cat-te-vo-edit-audio" controls preload="metadata"></audio>
                    <div class="cat-te-vo-edit-preview-empty">${T("voiceover_edit_preview_empty")}</div>
                  </div>
                  <div class="cat-te-gen-edit-tl-host cat-te-vo-edit-tl-host"></div>
                </div>
                <div class="cat-te-gen-edit-right">
                  <div class="cat-te-vo-edit-name" title=""></div>
                  <div class="cat-te-vo-edit-file" title=""></div>
                  <label class="cat-te-gen-edit-field">
                    <span>${T("desc_prompt_label")}</span>
                    <textarea class="cat-te-vo-edit-prompt" rows="8" placeholder="${T("voiceover_item_prompt_placeholder")}"></textarea>
                  </label>
                  <p class="cat-te-gen-edit-hint">${T("voiceover_edit_hint")}</p>
                </div>
              </div>
              <div class="cat-te-gen-edit-footer">
                <button type="button" class="cat-te-btn cat-te-vo-edit-cancel">${T("cancel_btn")}</button>
                <button type="button" class="cat-te-btn cat-te-btn-primary cat-te-vo-edit-save">${T("save_btn")}</button>
              </div>
            </div>
          </div>
          <div class="cat-te-floating-panel cat-te-output-videos-modal" hidden>
            <div class="cat-te-modal cat-te-output-videos-dialog">
              <div class="cat-te-modal-header cat-te-output-videos-drag">
                <span class="cat-te-output-videos-title">${T("linked_generated_videos_title")}</span>
                <button type="button" class="cat-te-modal-close cat-te-output-videos-close" title="${T("close_title")}">${iconHtml("close", 16)}</button>
              </div>
              <div class="cat-te-output-videos-toolbar">
                <div class="cat-te-output-videos-toolbar-row">
                  <input class="cat-te-output-videos-filter" type="search" placeholder="${T("filter_filename_placeholder")}" />
                  <button type="button" class="cat-te-btn cat-te-output-videos-auto-link" title="${T("auto_associate_videos_title")}">${T("auto_associate_videos_btn")}</button>
                </div>
                <div class="cat-te-output-videos-time-filter">
                  ${OUTPUT_VIDEOS_TIME_RANGES.map((r) => `
                    <button type="button" class="cat-te-output-videos-time-btn${r.id === "1h" ? " is-active" : ""}" data-range="${r.id}">${r.label}</button>
                  `).join("")}
                </div>
              </div>
              <div class="cat-te-output-videos-body"></div>
            </div>
          </div>
          <div class="cat-te-modal-backdrop cat-te-compose-modal" hidden>
            <div class="cat-te-modal cat-te-compose-dialog">
              <div class="cat-te-modal-header">
                <span>${T("compose_video_title")}</span>
                <button type="button" class="cat-te-modal-close cat-te-compose-close" title="${T("close_title")}">${iconHtml("close", 16)}</button>
              </div>
              <div class="cat-te-compose-body">
                <div class="cat-te-compose-preview">
                  <div class="cat-te-compose-preview-stage">
                    <canvas class="cat-te-compose-preview-canvas"></canvas>
                  </div>
                </div>
                <div class="cat-te-compose-settings">
                  <div class="cat-te-compose-field">
                    <span class="cat-te-ai-field-label">
                      ${T("filename_prefix_label")}
                      <span class="cat-te-info-tip" tabindex="0" aria-label="${T("filename_prefix_info_aria")}">
                        ${iconHtml("info", 12)}
                        <span class="cat-te-info-tip-pop">
                          ${T("filename_prefix_info_html")}
                        </span>
                      </span>
                    </span>
                    <input class="cat-te-compose-prefix" type="text" value="cap_timeline_compose/" />
                  </div>
                  <label class="cat-te-compose-field">
                    <span>${T("filename_label")}</span>
                    <input class="cat-te-compose-filename" type="text" />
                  </label>
                  <div class="cat-te-compose-check-row">
                    <label class="cat-te-compose-check">
                      <input class="cat-te-compose-use-gen-size" type="checkbox" checked />
                      <span>${T("use_generated_video_size_label")}</span>
                    </label>
                    <span class="cat-te-info-tip" tabindex="0" aria-label="${T("use_generated_video_size_info_aria")}">
                      ${iconHtml("info", 12)}
                      <span class="cat-te-info-tip-pop">
                        ${T("use_generated_video_size_info_text")}
                      </span>
                    </span>
                  </div>
                  <div class="cat-te-compose-check-row">
                    <label class="cat-te-compose-check">
                      <input class="cat-te-compose-ignore-audio" type="checkbox" />
                      <span>${T("ignore_audio_track_label")}</span>
                    </label>
                    <span class="cat-te-info-tip" tabindex="0" aria-label="${T("ignore_audio_track_info_aria")}">
                      ${iconHtml("info", 12)}
                      <span class="cat-te-info-tip-pop">
                        ${T("ignore_audio_track_info_text")}
                      </span>
                    </span>
                  </div>

                  <div class="cat-te-wm-section">
                    <div class="cat-te-wm-heading">${T("watermark_heading")}</div>
                    <div class="cat-te-wm-tabs">
                      <button type="button" class="cat-te-wm-tab cat-te-wm-tab-text" data-mode="text">${iconHtml("text", 12)}<span>${T("text_watermark_label")}</span></button>
                      <button type="button" class="cat-te-wm-tab cat-te-wm-tab-image" data-mode="image">${iconHtml("image", 12)}<span>${T("image_watermark_label")}</span></button>
                    </div>

                    <div class="cat-te-wm-panel cat-te-wm-panel-text">
                      <label class="cat-te-compose-field">
                        <span>${T("text_content_label")}</span>
                        <textarea class="cat-te-wm-text-content" rows="2" placeholder="${T("watermark_text_placeholder")}"></textarea>
                      </label>
                      <div class="cat-te-wm-row cat-te-wm-text-style-row">
                        <label class="cat-te-compose-field">
                          <span>${T("font_label")}</span>
                          <select class="cat-te-wm-font-family"></select>
                        </label>
                        <label class="cat-te-compose-field cat-te-wm-narrow">
                          <span>${T("font_size_label")}</span>
                          <input class="cat-te-wm-font-size" type="number" min="6" max="400" step="1" />
                        </label>
                        <label class="cat-te-compose-field cat-te-wm-narrow">
                          <span>${T("letter_spacing_label")}</span>
                          <input class="cat-te-wm-letter-spacing" type="number" min="-50" max="200" step="1" />
                        </label>
                        <label class="cat-te-compose-field cat-te-wm-narrow">
                          <span>${T("color_label")}</span>
                          <input class="cat-te-wm-font-color" type="color" />
                        </label>
                      </div>
                    </div>

                    <div class="cat-te-wm-panel cat-te-wm-panel-image" hidden>
                      <div class="cat-te-wm-image-row">
                        <div class="cat-te-wm-image-thumb"><img class="cat-te-wm-image-preview" alt="" hidden /></div>
                        <div class="cat-te-wm-image-actions">
                          <button type="button" class="cat-te-btn cat-te-wm-image-upload">${T("upload_image_btn")}</button>
                          <button type="button" class="cat-te-btn cat-te-wm-image-delete" hidden>${iconHtml("trash", 12)}<span>${T("delete_btn")}</span></button>
                          <input class="cat-te-wm-image-file" type="file" accept="image/*" hidden />
                        </div>
                      </div>
                      <label class="cat-te-compose-check cat-te-wm-image-disable-row" hidden>
                        <input class="cat-te-wm-image-disabled" type="checkbox" />
                        <span>${T("not_used_label")}</span>
                      </label>
                    </div>

                    <div class="cat-te-wm-row">
                      <label class="cat-te-compose-field">
                        <span>${T("opacity_label")}<span class="cat-te-wm-readout cat-te-wm-opacity-readout"></span></span>
                        <input class="cat-te-wm-opacity" type="range" min="0" max="100" step="1" />
                      </label>
                      <label class="cat-te-compose-field">
                        <span>${T("scale_label")}<span class="cat-te-wm-readout cat-te-wm-scale-readout"></span></span>
                        <input class="cat-te-wm-scale" type="range" min="10" max="300" step="1" />
                      </label>
                    </div>

                    <div class="cat-te-compose-field">
                      <span>${T("position_label")}</span>
                      <div class="cat-te-wm-pos-row">
                        <div class="cat-te-wm-pos-grid">
                          <button type="button" class="cat-te-wm-pos" data-pos="top-left" title="${T("wm_pos_top_left")}"></button>
                          <button type="button" class="cat-te-wm-pos" data-pos="top-center" title="${T("wm_pos_top_center")}"></button>
                          <button type="button" class="cat-te-wm-pos" data-pos="top-right" title="${T("wm_pos_top_right")}"></button>
                          <button type="button" class="cat-te-wm-pos" data-pos="center" title="${T("wm_pos_center")}"></button>
                          <button type="button" class="cat-te-wm-pos" data-pos="bottom-left" title="${T("wm_pos_bottom_left")}"></button>
                          <button type="button" class="cat-te-wm-pos" data-pos="bottom-center" title="${T("wm_pos_bottom_center")}"></button>
                          <button type="button" class="cat-te-wm-pos" data-pos="bottom-right" title="${T("wm_pos_bottom_right")}"></button>
                        </div>
                        <div class="cat-te-wm-pos-random">
                          <button type="button" class="cat-te-wm-pos-chip" data-pos="random-interval">${T("wm_pos_random_interval")}</button>
                          <button type="button" class="cat-te-wm-pos-chip" data-pos="random-fixed">${T("wm_pos_random_fixed")}</button>
                        </div>
                      </div>
                    </div>

                    <div class="cat-te-compose-field">
                      <span>${T("margin_label")}</span>
                      <div class="cat-te-wm-margin-box">
                        <input class="cat-te-wm-margin cat-te-wm-margin-top" type="number" min="0" step="1" title="${T("margin_top_title")}" />
                        <input class="cat-te-wm-margin cat-te-wm-margin-right" type="number" min="0" step="1" title="${T("margin_right_title")}" />
                        <input class="cat-te-wm-margin cat-te-wm-margin-bottom" type="number" min="0" step="1" title="${T("margin_bottom_title")}" />
                        <input class="cat-te-wm-margin cat-te-wm-margin-left" type="number" min="0" step="1" title="${T("margin_left_title")}" />
                        <button type="button" class="cat-te-wm-margin-lock" title="${T("lock_margin_title")}">${iconHtml("lock", 14)}</button>
                      </div>
                    </div>
                  </div>

                  <div class="cat-te-compose-status" hidden></div>
                </div>
              </div>
              <div class="cat-te-compose-actions">
                <button type="button" class="cat-te-btn cat-te-compose-cancel">${T("cancel_btn")}</button>
                <button type="button" class="cat-te-btn cat-te-btn-primary cat-te-compose-run">${T("compose_start_btn")}</button>
              </div>
            </div>
          </div>
          <div class="cat-te-modal-backdrop cat-te-add-material-modal" hidden>
            <div class="cat-te-modal cat-te-add-material-dialog">
              <div class="cat-te-modal-header">
                <span class="cat-te-add-material-title">${T("add_material_title")}</span>
                <button type="button" class="cat-te-modal-close cat-te-add-material-close" title="${T("close_title")}">${iconHtml("close", 16)}</button>
              </div>
              <div class="cat-te-add-material-preview"></div>
              <div class="cat-te-add-material-options">
                <label><input class="cat-te-insert-after-add" type="checkbox" /> ${T("insert_to_timeline_label")}</label>
              </div>
              <div class="cat-te-add-material-actions">
                <button type="button" class="cat-te-btn cat-te-btn-primary cat-te-add-material-confirm">${T("confirm_btn")}</button>
              </div>
            </div>
          </div>
          <div class="cat-te-modal-backdrop cat-te-ai-optimize-modal" hidden>
            <div class="cat-te-ai-optimize-shell">
              <button type="button" class="cat-te-ai-optimize-nav prev" title="${T("ai_optimize_prev_clip_title")}" aria-label="${T("ai_optimize_prev_clip_title")}" disabled>${iconHtml("chevronLeft", 20)}</button>
              <div class="cat-te-modal cat-te-ai-optimize-dialog">
              <div class="cat-te-modal-header">
                <span class="cat-te-ai-optimize-title">${T("prompt_manager_title")}</span>
                <button type="button" class="cat-te-modal-close cat-te-ai-optimize-close" title="${T("close_title")}">${iconHtml("close", 16)}</button>
              </div>
              <div class="cat-te-ai-optimize-body">
                <div class="cat-te-ai-optimize-left">
                  <div class="cat-te-ai-optimize-tabs">
                    <button type="button" class="cat-te-ai-src-tab is-clip-scope is-active" data-src="detailed_description">${T("ai_prompt_tab")}</button>
                    <button type="button" class="cat-te-ai-src-tab is-clip-scope" data-src="clip">${T("clip_prompt_tab")}</button>
                    <button type="button" class="cat-te-ai-src-tab is-shared-scope" data-src="media">${T("media_prompt_tab")}</button>
                    <button type="button" class="cat-te-ai-src-tab is-shared-scope" data-src="prepend">${T("prepend_prompt_tab")}</button>
                    <button type="button" class="cat-te-ai-src-tab is-shared-scope" data-src="append">${T("append_prompt_tab")}</button>
                  </div>
                  <textarea class="cat-te-ai-src-text"></textarea>
                </div>
                <div class="cat-te-ai-optimize-right">
                  <div class="cat-te-prompt-includes" aria-label="${T("prompt_includes_label")}">
                    <div class="cat-te-prompt-includes-label">${T("prompt_includes_label")}</div>
                    <div class="cat-te-prompt-includes-chips" role="group">
                      <button type="button" class="cat-te-prompt-include-chip" data-include="clip" title="${T("prompt_include_clip_title")}">${T("prompt_include_clip")}</button>
                      <button type="button" class="cat-te-prompt-include-chip" data-include="detailed_description" title="${T("prompt_include_ai_title")}">${T("prompt_include_ai")}</button>
                      <button type="button" class="cat-te-prompt-include-chip" data-include="media" title="${T("prompt_include_media_title")}">${T("prompt_include_media")}</button>
                    </div>
                  </div>
                  <div class="cat-te-ai-field-row">
                    <div class="cat-te-ai-field">
                      <span class="cat-te-ai-field-label">
                        ${T("model_label")}
                        <span class="cat-te-info-tip" tabindex="0" aria-label="${T("model_info_aria")}">
                          ${iconHtml("info", 12)}
                          <span class="cat-te-info-tip-pop">
                            ${T("model_info_html")}
                          </span>
                        </span>
                      </span>
                      <select class="cat-te-ai-model"></select>
                    </div>
                    <label class="cat-te-ai-field">
                      <span>${T("output_language_label")}</span>
                      <select class="cat-te-ai-lang">
                        <option value="简体中文" selected>简体中文</option>
                        <option value="繁體中文">繁體中文</option>
                        <option value="English">English</option>
                        <option value="日本語">日本語</option>
                      </select>
                    </label>
                  </div>
                  <label class="cat-te-ai-field">
                    <span>${T("agent_prompt_label")}</span>
                    <textarea class="cat-te-ai-system" rows="6"></textarea>
                  </label>
                  <div class="cat-te-ai-skill-head">
                    <span>Prompt Skill</span>
                    <div class="cat-te-ai-skill-actions">
                      <button type="button" class="cat-te-btn cat-te-skill-pick-btn">${T("select_btn")}</button>
                      <button type="button" class="cat-te-btn cat-te-skill-sync-btn" title="${T("sync_latest_skill_title")}">${iconHtml("refresh", 12)}<span>${T("update_btn")}</span></button>
                    </div>
                  </div>
                  <textarea class="cat-te-ai-skill" rows="3" placeholder="${T("skill_placeholder")}"></textarea>
                  <label class="cat-te-ai-field cat-te-ai-result-field">
                    <span>${T("ai_instruction_label")}</span>
                    <textarea class="cat-te-ai-result" rows="8" placeholder="${T("ai_instruction_placeholder")}"></textarea>
                  </label>
                  <div class="cat-te-ai-preview" hidden>
                    <div class="cat-te-ai-preview-head">
                      <span>${T("model_preview_title")}</span>
                      <span class="cat-te-ai-preview-status"></span>
                    </div>
                    <div class="cat-te-ai-preview-stage">
                      <img class="cat-te-ai-preview-image" alt="${T("model_preview_title")}" hidden />
                      <video class="cat-te-ai-preview-video" autoplay loop muted playsinline hidden></video>
                      <div class="cat-te-ai-preview-empty"></div>
                    </div>
                  </div>
                  <div class="cat-te-ai-optimize-actions">
                    <button type="button" class="cat-te-btn cat-te-btn-primary cat-te-ai-generate">${iconHtml("sparkles", 12)}<span>${T("generate_btn")}</span></button>
                    <button type="button" class="cat-te-btn cat-te-ai-preview-run">${iconHtml("eye", 12)}<span>${T("preview_btn")}</span></button>
                    <button type="button" class="cat-te-btn cat-te-ai-run">${iconHtml("play", 12)}<span>${T("run_and_close")}</span></button>
                  </div>
                </div>
              </div>
              </div>
              <button type="button" class="cat-te-ai-optimize-nav next" title="${T("ai_optimize_next_clip_title")}" aria-label="${T("ai_optimize_next_clip_title")}" disabled>${iconHtml("chevronLeft", 20)}</button>
            </div>
          </div>
          <div class="cat-te-modal-backdrop cat-te-skill-picker-modal" hidden>
            <div class="cat-te-modal cat-te-skill-picker-dialog">
              <div class="cat-te-modal-header">
                <span>${T("select_prompt_skill_title")}</span>
                <input class="cat-te-skill-picker-filter" type="search" placeholder="${T("search_name_placeholder")}" />
                <button type="button" class="cat-te-modal-close cat-te-skill-picker-close" title="${T("close_title")}">${iconHtml("close", 16)}</button>
              </div>
              <div class="cat-te-skill-picker-body"></div>
            </div>
          </div>
          <div class="cat-te-modal-backdrop cat-te-track-rename-modal" hidden>
            <div class="cat-te-modal cat-te-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="cat-te-track-rename-title">
              <div class="cat-te-modal-header">
                <span id="cat-te-track-rename-title">${T("rename_track_title")}</span>
                <button type="button" class="cat-te-modal-close cat-te-track-rename-close" title="${T("close_title")}">${iconHtml("close", 16)}</button>
              </div>
              <div class="cat-te-modal-body">
                <input class="cat-te-track-rename-input" type="text" maxlength="120" aria-label="${T("name_label")}" />
                <div class="cat-te-confirm-actions">
                  <button type="button" class="cat-te-btn cat-te-track-rename-cancel">${T("cancel_btn")}</button>
                  <button type="button" class="cat-te-btn cat-te-btn-primary cat-te-track-rename-confirm">${T("confirm_btn")}</button>
                </div>
              </div>
            </div>
          </div>
          <div class="cat-te-modal-backdrop cat-te-track-color-modal" hidden>
            <div class="cat-te-modal cat-te-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="cat-te-track-color-title">
              <div class="cat-te-modal-header">
                <span id="cat-te-track-color-title">${T("track_color_title")}</span>
                <button type="button" class="cat-te-modal-close cat-te-track-color-close" title="${T("close_title")}">${iconHtml("close", 16)}</button>
              </div>
              <div class="cat-te-modal-body">
                <input class="cat-te-track-color-input" type="color" aria-label="${T("track_color_title")}" />
                <div class="cat-te-confirm-actions">
                  <button type="button" class="cat-te-btn cat-te-track-color-cancel">${T("cancel_btn")}</button>
                  <button type="button" class="cat-te-btn cat-te-btn-primary cat-te-track-color-confirm">${T("confirm_btn")}</button>
                </div>
              </div>
            </div>
          </div>
          <div class="cat-te-modal-backdrop cat-te-track-delete-modal" hidden>
            <div class="cat-te-modal cat-te-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="cat-te-track-delete-title">
              <div class="cat-te-modal-header">
                <span id="cat-te-track-delete-title">${T("delete_track_menu")}</span>
                <button type="button" class="cat-te-modal-close cat-te-track-delete-close" title="${T("close_title")}">${iconHtml("close", 16)}</button>
              </div>
              <div class="cat-te-modal-body">
                <div class="cat-te-track-delete-message"></div>
                <div class="cat-te-confirm-actions">
                  <button type="button" class="cat-te-btn cat-te-track-delete-cancel">${T("cancel_btn")}</button>
                  <button type="button" class="cat-te-btn cat-te-btn-danger cat-te-track-delete-confirm">${T("delete_btn")}</button>
                </div>
              </div>
            </div>
          </div>
          <div class="cat-te-modal-backdrop cat-te-media-delete-modal" hidden>
            <div class="cat-te-modal cat-te-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="cat-te-media-delete-title">
              <div class="cat-te-modal-header">
                <span id="cat-te-media-delete-title">${T("delete_asset_title")}</span>
                <button type="button" class="cat-te-modal-close cat-te-media-delete-close" title="${T("close_title")}">${iconHtml("close", 16)}</button>
              </div>
              <div class="cat-te-modal-body">
                <div class="cat-te-media-delete-message"></div>
                <div class="cat-te-confirm-actions">
                  <button type="button" class="cat-te-btn cat-te-media-delete-cancel">${T("cancel_btn")}</button>
                  <button type="button" class="cat-te-btn cat-te-btn-danger cat-te-media-delete-confirm">${T("delete_btn")}</button>
                </div>
              </div>
            </div>
          </div>
          <div class="cat-te-modal-backdrop cat-te-track-convert-modal" hidden>
            <div class="cat-te-modal cat-te-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="cat-te-track-convert-title">
              <div class="cat-te-modal-header">
                <span id="cat-te-track-convert-title">${T("convert_to_media_failed_title")}</span>
                <button type="button" class="cat-te-modal-close cat-te-track-convert-close" title="${T("close_title")}">${iconHtml("close", 16)}</button>
              </div>
              <div class="cat-te-modal-body">
                <div class="cat-te-track-convert-message"></div>
                <div class="cat-te-confirm-actions">
                  <button type="button" class="cat-te-btn cat-te-btn-primary cat-te-track-convert-ok">${T("confirm_btn")}</button>
                </div>
              </div>
            </div>
          </div>
          <div class="cat-te-modal-backdrop cat-te-settings-modal" hidden>
            <div class="cat-te-modal cat-te-settings-dialog">
              <div class="cat-te-modal-header">
                <span>${T("settings_title")}</span>
                <button type="button" class="cat-te-modal-close" title="${T("close_title")}">${iconHtml("close", 16)}</button>
              </div>
              <div class="cat-te-modal-body">
                <label class="cat-te-modal-row">
                  <span>${T("autosave_interval_label")}</span>
                  <input class="cat-te-autosave-interval" type="number" min="1" max="300" step="1" />
                </label>
                <label class="cat-te-modal-row">
                  <span>${T("prompt_font_size_label")}</span>
                  <input class="cat-te-prompt-font-size" type="number" min="10" max="28" step="1" />
                </label>
                <label class="cat-te-modal-check-row">
                  <input class="cat-te-use-clip-video-filename" type="checkbox" checked />
                  <span>${T("use_clip_specified_video_filename_label")}</span>
                  <span class="cat-te-info-tip" tabindex="0" aria-label="${T("use_clip_specified_video_filename_info_aria")}">
                    ${iconHtml("info", 12)}
                    <span class="cat-te-info-tip-pop">${T("use_clip_specified_video_filename_info_text")}</span>
                  </span>
                </label>
                <div class="cat-te-model-preview-settings">
                  <div class="cat-te-agent-heading">
                    <span>${T("model_preview_settings_title")}</span>
                    <div class="cat-te-model-preview-config-actions">
                      <button type="button" class="cat-te-btn cat-te-model-preview-import">${T("import_preview_workflow_btn")}</button>
                      <button type="button" class="cat-te-btn cat-te-model-preview-clear">${T("clear_btn")}</button>
                    </div>
                  </div>
                  <label class="cat-te-modal-row">
                    <span>${T("model_preview_model_label")}</span>
                    <input class="cat-te-model-preview-model" type="text" placeholder="${T("model_preview_model_placeholder")}" />
                  </label>
                  <div class="cat-te-model-preview-config-name"></div>
                  <div class="cat-te-agent-note">${T("model_preview_workflow_hint")}</div>
                  <input class="cat-te-model-preview-file" type="file" accept="application/json,.json" hidden />
                </div>
                <div class="cat-te-agent-settings">
                  <div class="cat-te-agent-heading">
                    <span>AI Agent</span>
                    <button type="button" class="cat-te-btn cat-te-agent-add">${T("add_btn")}</button>
                  </div>
                  <div class="cat-te-agent-list"></div>
                  <div class="cat-te-agent-form" hidden>
                    <label><span>${T("name_label")}</span><input class="cat-te-agent-label" type="text" maxlength="80" placeholder="${T("eg_chatgpt_placeholder")}" /></label>
                    <label><span>${T("provider_label")}</span><select class="cat-te-agent-provider"><option value="openai">OpenAI</option><option value="gemini">Gemini</option></select></label>
                    <label><span>${T("model_label")}</span><input class="cat-te-agent-model" type="text" maxlength="120" placeholder="${T("eg_model_placeholder")}" /></label>
                    <label><span>API Key</span><input class="cat-te-agent-key" type="password" autocomplete="new-password" placeholder="${T("enter_api_key")}" /></label>
                    <label class="cat-te-agent-enabled"><input type="checkbox" checked /><span>${T("enable_show_in_ai_optimize_label")}</span></label>
                    <div class="cat-te-agent-form-actions">
                      <button type="button" class="cat-te-btn cat-te-agent-delete" hidden>${T("delete_btn")}</button>
                      <span></span>
                      <button type="button" class="cat-te-btn cat-te-agent-cancel">${T("cancel_btn")}</button>
                      <button type="button" class="cat-te-btn cat-te-btn-primary cat-te-agent-save">${T("save_btn")}</button>
                    </div>
                  </div>
                  <div class="cat-te-agent-note">${T("agent_note")}</div>
                </div>
              </div>
            </div>
          </div>
        `;
        document.body.appendChild(el);
        this._overlay = el;
        this.projectNameInput = el.querySelector(".cat-te-title");
        this.brandProjectBtn = el.querySelector(".cat-te-brand-project");
        this.headerScalarsEl = el.querySelector(".cat-te-header-scalars");
        this.projectScalarsEl = el.querySelector(".cat-te-project-scalars");
        this.sidebarTitle = el.querySelector(".cat-te-sidebar-title");
        this.projectPanel = el.querySelector(".cat-te-project-panel");
        this.clipPanel = el.querySelector(".cat-te-clip-panel");
        this.visualClipBody = el.querySelector(".cat-te-visual-clip-body");
        this.subtitlePanel = el.querySelector(".cat-te-subtitle-panel");
        this.voiceoverPanel = el.querySelector(".cat-te-voiceover-panel");
        this.voPromptInput = el.querySelector(".cat-te-vo-prompt");
        this.voStylePromptInput = el.querySelector(".cat-te-vo-style-prompt");
        this.voAudiosList = el.querySelector(".cat-te-vo-audios-list");
        this.voAudioAddBtn = el.querySelector(".cat-te-vo-audio-add");
        this.voAudioEditBtn = el.querySelector(".cat-te-vo-audio-edit");
        this._settingPromptInputs = Object.fromEntries(
            SETTING_PROMPT_KEYS.map((key) => [key, el.querySelector(`[data-setting-prompt-input="${key}"]`)]),
        );
        this._settingPromptUndoArmed = Object.fromEntries(SETTING_PROMPT_KEYS.map((key) => [key, false]));
        this.mediaStarFilterHost = el.querySelector(".cat-te-media-header-actions");
        this.mediaTabs = el.querySelectorAll(".cat-te-media-tab");
        this.mediaGrid = el.querySelector(".cat-te-media-grid");
        this.mediaPrimaryActionBtn = el.querySelector(".cat-te-media-primary-action");
        this.mediaPanel = el.querySelector(".cat-te-media");
        this.mediaPanelSplit = el.querySelector(".cat-te-media-split");
        this.sidebarPanel = el.querySelector(".cat-te-sidebar");
        this.sidebarPanelSplit = el.querySelector(".cat-te-sidebar-split");
        this.tlHost = el.querySelector(".cat-te-timeline-host");
        this.programRoot = el.querySelector(".cat-te-program");
        this.programSplit = el.querySelector(".cat-te-program-split");
        this.programStage = el.querySelector(".cat-te-program-stage");
        this.programCanvas = el.querySelector(".cat-te-program-canvas");
        this.programEmpty = el.querySelector(".cat-te-program-empty");
        this.programMeta = el.querySelector(".cat-te-program-meta");
        this.promptInput = el.querySelector(".cat-te-clip-panel .cat-te-prompt-input");
        this.aiOptimizeBtn = el.querySelector(".cat-te-ai-optimize-btn");
        this._attachPromptCopyButtons(el);
        for (const key of SETTING_PROMPT_KEYS) {
            const input = this._settingPromptInputs[key];
            if (input) attachRichPromptHandler(input, { mode: "widget" });
        }
        this.promptIncludesHost = el.querySelector(".cat-te-prompt-includes");
        this.promptIncludeChips = el.querySelectorAll(".cat-te-prompt-include-chip");
        this.promptOrderList = el.querySelector(".cat-te-prompt-order-list");
        this.headExtendInput = el.querySelector(".cat-te-head-extend");
        this.tailExtendInput = el.querySelector(".cat-te-tail-extend");
        this.genPreviewVideoCb = el.querySelector(".cat-te-gen-preview-video");
        this.secondSampleCb = el.querySelector(".cat-te-second-sample");
        this.h3MotionContextInput = el.querySelector(".cat-te-h3-motion-context");
        this.saveLatentCb = el.querySelector(".cat-te-save-latent");
        this.clipSeedInput = el.querySelector(".cat-te-clip-seed");
        this.clipSeedRandomBtn = el.querySelector(".cat-te-clip-seed-random");
        this.clipRoleSelect = el.querySelector(".cat-te-clip-role");
        this.clipRoleCustomInput = el.querySelector(".cat-te-clip-role-custom");
        this.clipRoleCustomRow = el.querySelector(".cat-te-clip-role-custom-row");
        this.clipAgentSelect = el.querySelector(".cat-te-clip-agent");
        this.clipAgentCustomInput = el.querySelector(".cat-te-clip-agent-custom");
        this.clipAgentCustomRow = el.querySelector(".cat-te-clip-agent-custom-row");
        this.subTextInput = el.querySelector(".cat-te-sub-text");
        this.subFontSelect = el.querySelector(".cat-te-sub-font");
        this.subSizeInput = el.querySelector(".cat-te-sub-size");
        this.subLetterSpacingInput = el.querySelector(".cat-te-sub-letter-spacing");
        this.subColorInput = el.querySelector(".cat-te-sub-color");
        this.subBoldCb = el.querySelector(".cat-te-sub-bold");
        this.subItalicCb = el.querySelector(".cat-te-sub-italic");
        this.subOpacityInput = el.querySelector(".cat-te-sub-opacity");
        this.subOpacityVal = el.querySelector(".cat-te-sub-opacity-val");
        this.subStrokeCb = el.querySelector(".cat-te-sub-stroke");
        this.subStrokeColorInput = el.querySelector(".cat-te-sub-stroke-color");
        this.subStrokeWidthInput = el.querySelector(".cat-te-sub-stroke-width");
        this.subShadowCb = el.querySelector(".cat-te-sub-shadow");
        this.subShadowColorInput = el.querySelector(".cat-te-sub-shadow-color");
        this.subShadowBlurInput = el.querySelector(".cat-te-sub-shadow-blur");
        this.subShadowXInput = el.querySelector(".cat-te-sub-shadow-x");
        this.subShadowYInput = el.querySelector(".cat-te-sub-shadow-y");
        this.subAlignSelect = el.querySelector(".cat-te-sub-align");
        this.subVAlignSelect = el.querySelector(".cat-te-sub-valign");
        this.subOffsetXInput = el.querySelector(".cat-te-sub-offset-x");
        this.subOffsetYInput = el.querySelector(".cat-te-sub-offset-y");
        this.subApplyAllBtn = el.querySelector(".cat-te-sub-apply-all");
        this.clipInfoDetail = el.querySelector(".cat-te-clip-info-detail");
        this.clipSwiper = el.querySelector(".cat-te-clip-swiper");
        this.clipSwiperPrev = el.querySelector(".cat-te-clip-swiper-nav.prev");
        this.clipSwiperNext = el.querySelector(".cat-te-clip-swiper-nav.next");
        this.clipThumbWrap = el.querySelector(".cat-te-clip-thumb-wrap");
        this.clipThumb = el.querySelector(".cat-te-clip-thumb");
        this.clipThumbVideo = el.querySelector(".cat-te-clip-thumb-video");
        this.clipThumbEmpty = el.querySelector(".cat-te-clip-thumb-empty");
        this.clipThumbSubtitle = el.querySelector(".cat-te-clip-thumb-subtitle");
        this.clipThumbSortBtn = el.querySelector(".cat-te-clip-thumb-sort");
        this.clipThumbDeleteBtn = el.querySelector(".cat-te-clip-thumb-delete");
        this.clipVideosHost = el.querySelector(".cat-te-clip-videos");
        this.clipVideosList = el.querySelector(".cat-te-clip-videos-list");
        this.clipVideosOpenBtn = el.querySelector(".cat-te-clip-videos-open");
        this.clipNameEl = el.querySelector(".cat-te-clip-name");
        this.clipIdEl = el.querySelector(".cat-te-clip-id");
        this.clipStartEl = el.querySelector(".cat-te-clip-start");
        this.clipEndEl = el.querySelector(".cat-te-clip-end");
        this.clipSourceTrimEl = el.querySelector(".cat-te-clip-source-trim");
        this.clipSourceTrimLabelEl = el.querySelector(".cat-te-clip-source-trim-label");
        this.clipSourceInEl = el.querySelector(".cat-te-clip-source-in");
        this.clipSourceOutEl = el.querySelector(".cat-te-clip-source-out");
        this.clipSourceDurEl = el.querySelector(".cat-te-clip-source-dur");
        this.clipDurEl = el.querySelector(".cat-te-clip-dur");
        this.clipItemIndexEl = el.querySelector(".cat-te-clip-item-index");
        this.framePreview = el.querySelector(".cat-te-frame-preview");
        this.footerPlayback = el.querySelector(".cat-te-footer-center");
        this.addMaterialInput = el.querySelector(".cat-te-add-material-file");
        this.mediaPreviewModal = el.querySelector(".cat-te-media-preview-modal");
        this.mediaPreviewTitle = el.querySelector(".cat-te-media-preview-title");
        this.mediaPreviewStars = el.querySelector(".cat-te-media-preview-stars");
        this.mediaPreviewBody = el.querySelector(".cat-te-media-preview-body");
        this.mediaPreviewStage = el.querySelector(".cat-te-media-preview-stage");
        this.mediaPreviewPrevBtn = el.querySelector(".cat-te-media-preview-nav.prev");
        this.mediaPreviewNextBtn = el.querySelector(".cat-te-media-preview-nav.next");
        this.mediaPreviewInsertBtn = el.querySelector(".cat-te-media-preview-insert");
        this.mediaPreviewFooter = el.querySelector(".cat-te-media-preview-footer");
        this.mediaPreviewHint = el.querySelector(".cat-te-media-preview-hint");
        this.mediaPreviewDesc = el.querySelector(".cat-te-media-preview-desc");
        attachRichPromptHandler(this.mediaPreviewDesc, { mode: "widget" });
        this.mediaGenerationPrompt = el.querySelector(".cat-te-media-generation-prompt");
        this.mediaSettingDescription = el.querySelector(".cat-te-media-setting-description");
        attachRichPromptHandler(this.mediaGenerationPrompt, { mode: "widget" });
        attachRichPromptHandler(this.mediaSettingDescription, { mode: "widget" });
        this.mediaPreviewType = el.querySelector(".cat-te-media-preview-type");
        this.mediaPreviewTypeCustom = el.querySelector(".cat-te-media-preview-type-custom");
        this.mediaPreviewTypeCustomRow = el.querySelector(".cat-te-media-preview-type-custom-row");
        this.mediaPreviewTags = el.querySelector(".cat-te-media-preview-tags");
        this.clipItemsModal = el.querySelector(".cat-te-clip-items-modal");
        this.clipItemsTitle = el.querySelector(".cat-te-clip-items-title");
        this.clipItemsBody = el.querySelector(".cat-te-clip-items-body");
        this.addMaterialModal = el.querySelector(".cat-te-add-material-modal");
        this.addMaterialPreview = el.querySelector(".cat-te-add-material-preview");
        this.addMaterialTitle = el.querySelector(".cat-te-add-material-title");
        this.addMaterialConfirmBtn = el.querySelector(".cat-te-add-material-confirm");
        this.insertAfterAddCb = el.querySelector(".cat-te-insert-after-add");
        this.genVideoModal = el.querySelector(".cat-te-gen-video-modal");
        this.genVideoTitle = el.querySelector(".cat-te-gen-video-title");
        this.genVideoStage = el.querySelector(".cat-te-gen-video-stage");
        this.genVideoPrevBtn = el.querySelector(".cat-te-gen-video-prev");
        this.genVideoNextBtn = el.querySelector(".cat-te-gen-video-next");
        this.genVideoEnabledCb = el.querySelector(".cat-te-gen-video-enabled");
        this.genVideoMutedCb = el.querySelector(".cat-te-gen-video-muted");
        this.genVideoNote = el.querySelector(".cat-te-gen-video-note");
        this.genVideoDeleteBtn = el.querySelector(".cat-te-gen-video-delete");
        this.genEditModal = el.querySelector(".cat-te-gen-edit-modal");
        this.genEditTitle = el.querySelector(".cat-te-gen-edit-title");
        this.genEditTlHost = el.querySelector(".cat-te-gen-edit-tl-host");
        this.genEditPreviewCanvas = el.querySelector(".cat-te-gen-edit-preview-canvas");
        this.genEditPreviewEmpty = el.querySelector(".cat-te-gen-edit-preview-empty");
        this.genEditPreviewEl = el.querySelector(".cat-te-gen-edit-preview");
        this.genEditVSplit = el.querySelector(".cat-te-gen-edit-vsplit");
        this.genEditLeft = el.querySelector(".cat-te-gen-edit-left");
        this.genEditNameEl = el.querySelector(".cat-te-gen-edit-name");
        this.genEditFileEl = el.querySelector(".cat-te-gen-edit-file");
        this.genEditPrompt = el.querySelector(".cat-te-gen-edit-prompt");
        this.genEditDubBtn = el.querySelector(".cat-te-gen-edit-dub");
        this.voEditModal = el.querySelector(".cat-te-vo-edit-modal");
        this.voEditTitle = el.querySelector(".cat-te-vo-edit-title");
        this.voEditTlHost = el.querySelector(".cat-te-vo-edit-tl-host");
        this.voEditAudio = el.querySelector(".cat-te-vo-edit-audio");
        this.voEditPreviewEmpty = el.querySelector(".cat-te-vo-edit-preview-empty");
        this.voEditNameEl = el.querySelector(".cat-te-vo-edit-name");
        this.voEditFileEl = el.querySelector(".cat-te-vo-edit-file");
        this.voEditPrompt = el.querySelector(".cat-te-vo-edit-prompt");
        this.outputVideosModal = el.querySelector(".cat-te-output-videos-modal");
        this.outputVideosBody = el.querySelector(".cat-te-output-videos-body");
        this.outputVideosFilter = el.querySelector(".cat-te-output-videos-filter");
        this.outputVideosAutoLinkBtn = el.querySelector(".cat-te-output-videos-auto-link");
        this.outputVideosTimeButtons = el.querySelectorAll(".cat-te-output-videos-time-btn");
        this.outputVideosTitle = el.querySelector(".cat-te-output-videos-title");
        this.composeModal = el.querySelector(".cat-te-compose-modal");
        this.composePrefixInput = el.querySelector(".cat-te-compose-prefix");
        this.composeFilenameInput = el.querySelector(".cat-te-compose-filename");
        this.composeIgnoreAudioCb = el.querySelector(".cat-te-compose-ignore-audio");
        this.composeUseGenSizeCb = el.querySelector(".cat-te-compose-use-gen-size");
        this.composeStatus = el.querySelector(".cat-te-compose-status");
        this.composeRunBtn = el.querySelector(".cat-te-compose-run");
        this.composePreviewCanvas = el.querySelector(".cat-te-compose-preview-canvas");
        this.composePreviewStage = el.querySelector(".cat-te-compose-preview-stage");
        this.wmTabs = el.querySelectorAll(".cat-te-wm-tab");
        this.wmPanelText = el.querySelector(".cat-te-wm-panel-text");
        this.wmPanelImage = el.querySelector(".cat-te-wm-panel-image");
        this.wmTextContent = el.querySelector(".cat-te-wm-text-content");
        this.wmFontFamily = el.querySelector(".cat-te-wm-font-family");
        this.wmFontSize = el.querySelector(".cat-te-wm-font-size");
        this.wmLetterSpacing = el.querySelector(".cat-te-wm-letter-spacing");
        this.wmFontColor = el.querySelector(".cat-te-wm-font-color");
        this.wmImagePreview = el.querySelector(".cat-te-wm-image-preview");
        this.wmImageUploadBtn = el.querySelector(".cat-te-wm-image-upload");
        this.wmImageDeleteBtn = el.querySelector(".cat-te-wm-image-delete");
        this.wmImageFileInput = el.querySelector(".cat-te-wm-image-file");
        this.wmImageDisabledRow = el.querySelector(".cat-te-wm-image-disable-row");
        this.wmImageDisabledCb = el.querySelector(".cat-te-wm-image-disabled");
        this.wmOpacity = el.querySelector(".cat-te-wm-opacity");
        this.wmOpacityReadout = el.querySelector(".cat-te-wm-opacity-readout");
        this.wmScale = el.querySelector(".cat-te-wm-scale");
        this.wmScaleReadout = el.querySelector(".cat-te-wm-scale-readout");
        this.wmPosButtons = el.querySelectorAll(".cat-te-wm-pos, .cat-te-wm-pos-chip");
        this.wmMarginTop = el.querySelector(".cat-te-wm-margin-top");
        this.wmMarginRight = el.querySelector(".cat-te-wm-margin-right");
        this.wmMarginBottom = el.querySelector(".cat-te-wm-margin-bottom");
        this.wmMarginLeft = el.querySelector(".cat-te-wm-margin-left");
        this.wmMarginLockBtn = el.querySelector(".cat-te-wm-margin-lock");
        this.aiOptimizeModal = el.querySelector(".cat-te-ai-optimize-modal");
        this.aiOptimizeTitle = el.querySelector(".cat-te-ai-optimize-title");
        this.aiOptimizePrevBtn = el.querySelector(".cat-te-ai-optimize-nav.prev");
        this.aiOptimizeNextBtn = el.querySelector(".cat-te-ai-optimize-nav.next");
        this.aiModelSelect = el.querySelector(".cat-te-ai-model");
        this.aiLangSelect = el.querySelector(".cat-te-ai-lang");
        this.aiSystemInput = el.querySelector(".cat-te-ai-system");
        this.aiSkillInput = el.querySelector(".cat-te-ai-skill");
        this.skillPickBtn = el.querySelector(".cat-te-skill-pick-btn");
        this.skillSyncBtn = el.querySelector(".cat-te-skill-sync-btn");
        this.skillPickerModal = el.querySelector(".cat-te-skill-picker-modal");
        this.skillPickerBody = el.querySelector(".cat-te-skill-picker-body");
        this.skillPickerFilter = el.querySelector(".cat-te-skill-picker-filter");
        this.trackRenameModal = el.querySelector(".cat-te-track-rename-modal");
        this.trackRenameInput = el.querySelector(".cat-te-track-rename-input");
        this.trackColorModal = el.querySelector(".cat-te-track-color-modal");
        this.trackColorInput = el.querySelector(".cat-te-track-color-input");
        this.trackDeleteModal = el.querySelector(".cat-te-track-delete-modal");
        this.trackDeleteMessage = el.querySelector(".cat-te-track-delete-message");
        this.mediaDeleteModal = el.querySelector(".cat-te-media-delete-modal");
        this.mediaDeleteTitle = el.querySelector("#cat-te-media-delete-title");
        this.mediaDeleteMessage = el.querySelector(".cat-te-media-delete-message");
        this.trackConvertModal = el.querySelector(".cat-te-track-convert-modal");
        this.trackConvertMessage = el.querySelector(".cat-te-track-convert-message");
        this.aiResultInput = el.querySelector(".cat-te-ai-result");
        this.aiGenerateBtn = el.querySelector(".cat-te-ai-generate");
        this.aiPreviewBtn = el.querySelector(".cat-te-ai-preview-run");
        this.aiPreviewPanel = el.querySelector(".cat-te-ai-preview");
        this.aiPreviewStatus = el.querySelector(".cat-te-ai-preview-status");
        this.aiPreviewImage = el.querySelector(".cat-te-ai-preview-image");
        this.aiPreviewVideo = el.querySelector(".cat-te-ai-preview-video");
        this.aiPreviewEmpty = el.querySelector(".cat-te-ai-preview-empty");
        this.aiSrcText = el.querySelector(".cat-te-ai-src-text");
        this.aiSrcTabs = el.querySelectorAll(".cat-te-ai-src-tab");
        attachRichPromptHandler(this.aiSrcText, { mode: "widget" });

        this.settingsModal = el.querySelector(".cat-te-settings-modal");
        this.autosaveIntervalInput = el.querySelector(".cat-te-autosave-interval");
        this.promptFontSizeInput = el.querySelector(".cat-te-prompt-font-size");
        this.useClipVideoFilenameCb = el.querySelector(".cat-te-use-clip-video-filename");
        this.modelPreviewModelInput = el.querySelector(".cat-te-model-preview-model");
        this.modelPreviewFileInput = el.querySelector(".cat-te-model-preview-file");
        this.modelPreviewConfigName = el.querySelector(".cat-te-model-preview-config-name");
        this.agentList = el.querySelector(".cat-te-agent-list");
        this.agentForm = el.querySelector(".cat-te-agent-form");
        this.agentLabelInput = el.querySelector(".cat-te-agent-label");
        this.agentProviderSelect = el.querySelector(".cat-te-agent-provider");
        this.agentModelInput = el.querySelector(".cat-te-agent-model");
        this.agentKeyInput = el.querySelector(".cat-te-agent-key");
        this.agentEnabledCb = el.querySelector(".cat-te-agent-enabled input");
        this.agentDeleteBtn = el.querySelector(".cat-te-agent-delete");
        this.importZipInput = el.querySelector(".cat-te-import-zip");
        el.querySelector(".cat-te-import").addEventListener("click", (e) => this._showImportMenu(e));
        el.querySelector(".cat-te-export").addEventListener("click", (e) => this._showExportMenu(e));
        this.importZipInput.addEventListener("change", (e) => void this._importProjectZip(e));
        el.querySelector(".cat-te-header-close").addEventListener("click", () => this.close());
        this.addMaterialInput.addEventListener("change", (e) => this._previewSelectedMaterial(e));
        el.querySelector(".cat-te-add-material-close").addEventListener("click", () => this._closeAddMaterial());
        el.querySelector(".cat-te-add-material-confirm").addEventListener("click", () => void this._confirmAddMaterial());

        this.mediaInfoPanel = el.querySelector(".cat-te-media-info-panel");
        this.mediaSettingsPanel = el.querySelector(".cat-te-media-settings-panel");
        this.rawMetaModal = el.querySelector(".cat-te-raw-meta-modal");
        this.rawMetaText = el.querySelector(".cat-te-raw-meta-text");
        this.mediaMetaOpenBtn = el.querySelector(".cat-te-media-meta-open");
        const tabs = [...el.querySelectorAll("[data-media-tab]")];
        const selectTab = (tab) => {
            for (const button of tabs) {
                const active = button === tab;
                button.classList.toggle("active", active);
                button.setAttribute("aria-selected", String(active));
                button.tabIndex = active ? 0 : -1;
            }
            this.mediaSettingsPanel.hidden = tab.dataset.mediaTab !== "settings";
            this.mediaInfoPanel.hidden = tab.dataset.mediaTab !== "info";
            if (!this.mediaInfoPanel.hidden) void this._loadMediaFileInfo();
        };
        for (const tab of tabs) {
            tab.tabIndex = tab.dataset.mediaTab === "settings" ? 0 : -1;
            tab.addEventListener("click", () => selectTab(tab));
            tab.addEventListener("keydown", (e) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
                e.preventDefault();
                e.stopPropagation();
                const next = tabs[e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (tabs.indexOf(tab) + 1) % tabs.length];
                selectTab(next);
                next.focus();
            });
        }
        this.mediaMetaOpenBtn.addEventListener("click", () => {
            this.rawMetaModal.hidden = false;
            el.querySelector(".cat-te-raw-meta-close").focus();
            void this._loadMediaFileInfo(true);
        });
        el.querySelector(".cat-te-raw-meta-close").addEventListener("click", () => this._closeRawMeta());
        this.rawMetaModal.addEventListener("click", (e) => {
            if (e.target === this.rawMetaModal) this._closeRawMeta();
        });
        this.rawMetaModal.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key === "Escape") { e.preventDefault(); this._closeRawMeta(); }
            if (e.key === "Tab") {
                e.preventDefault();
                const close = el.querySelector(".cat-te-raw-meta-close");
                (e.target === close ? this.rawMetaText : close).focus();
            }
        });
        el.querySelector(".cat-te-media-preview-close").addEventListener("click", () => this._closeMediaPreview());
        this.mediaPreviewPrevBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            this._stepMediaPreview(-1);
        });
        this.mediaPreviewNextBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            this._stepMediaPreview(1);
        });
        this.mediaPreviewInsertBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            void this._insertMediaPreviewAtSeek();
        });
        this.mediaPreviewBody?.addEventListener("mousedown", (e) => {
            if (this.mediaPreviewModal.hidden) return;
            if (this._mediaPreviewState?.browse === false) return;
            if (e.button !== 0) return;
            if (e.target.closest(".cat-te-media-preview-stars, .cat-te-media-preview-nav, .cat-te-modal-close, .cat-te-media-preview-actions")) return;
            if (e.target.closest("video, audio")) return;
            e.preventDefault();
            this._stepMediaPreview(1);
        });
        this.mediaPreviewBody?.addEventListener("contextmenu", (e) => {
            if (this.mediaPreviewModal.hidden) return;
            if (this._mediaPreviewState?.browse === false) return;
            if (e.target.closest(".cat-te-media-preview-stars, .cat-te-media-preview-nav, .cat-te-modal-close, .cat-te-media-preview-actions")) return;
            e.preventDefault();
            e.stopPropagation();
            this._stepMediaPreview(-1);
        });
        this.projectNameInput.addEventListener("focus", () => { this._projectNameUndoArmed = false; });
        this.projectNameInput.addEventListener("beforeinput", () => {
            if (!this._projectNameUndoArmed) {
                this._recordUndo();
                this._projectNameUndoArmed = true;
            }
        });
        this.projectNameInput.addEventListener("input", () => this._syncBrandProjectName());
        this.projectNameInput.addEventListener("blur", () => {
            this.projectNameInput.value = this.projectNameInput.value.trim() || T("untitled_project");
            this._projectNameUndoArmed = false;
            this._syncBrandProjectName();
        });
        this.brandProjectBtn?.addEventListener("click", () => this._focusProjectNameFromBrand());
        for (const key of SETTING_PROMPT_KEYS) {
            const input = this._settingPromptInputs?.[key];
            input?.addEventListener("focus", () => {
                if (this._settingPromptUndoArmed) this._settingPromptUndoArmed[key] = true;
            });
            input?.addEventListener("blur", () => {
                if (this._settingPromptUndoArmed) this._settingPromptUndoArmed[key] = false;
            });
            input?.addEventListener("input", () => this._onSettingPromptInput(key));
        }
        el.querySelector(".cat-te-settings").addEventListener("click", () => this._openSettings());
        this.settingsModal.querySelector(".cat-te-modal-close").addEventListener("click", () => this._closeSettings());
        el.querySelector(".cat-te-model-preview-import")?.addEventListener("click", () => this.modelPreviewFileInput?.click());
        el.querySelector(".cat-te-model-preview-clear")?.addEventListener("click", () => this._clearModelPreviewWorkflow());
        this.modelPreviewFileInput?.addEventListener("change", (e) => void this._importModelPreviewWorkflow(e));
        this.modelPreviewModelInput?.addEventListener("change", () => {
            localStorage.setItem(STORAGE_MODEL_PREVIEW_MODEL, String(this.modelPreviewModelInput.value || "").trim());
        });
        el.querySelector(".cat-te-track-rename-close")?.addEventListener("click", () => this._closeTrackRenameModal());
        el.querySelector(".cat-te-track-rename-cancel")?.addEventListener("click", () => this._closeTrackRenameModal());
        el.querySelector(".cat-te-track-rename-confirm")?.addEventListener("click", () => this._confirmTrackRename());
        this.trackRenameInput?.addEventListener("keydown", (e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            this._confirmTrackRename();
        });
        this.trackRenameModal?.addEventListener("click", (e) => {
            if (e.target === this.trackRenameModal) this._closeTrackRenameModal();
        });
        el.querySelector(".cat-te-track-color-close")?.addEventListener("click", () => this._closeTrackColorModal());
        el.querySelector(".cat-te-track-color-cancel")?.addEventListener("click", () => this._closeTrackColorModal());
        el.querySelector(".cat-te-track-color-confirm")?.addEventListener("click", () => this._confirmTrackColor());
        this.trackColorModal?.addEventListener("click", (e) => {
            if (e.target === this.trackColorModal) this._closeTrackColorModal();
        });
        el.querySelector(".cat-te-track-delete-close")?.addEventListener("click", () => this._closeTrackDeleteModal());
        el.querySelector(".cat-te-track-delete-cancel")?.addEventListener("click", () => this._closeTrackDeleteModal());
        el.querySelector(".cat-te-track-delete-confirm")?.addEventListener("click", () => this._confirmDeleteTrack());
        this.trackDeleteModal?.addEventListener("click", (e) => {
            if (e.target === this.trackDeleteModal) this._closeTrackDeleteModal();
        });
        el.querySelector(".cat-te-media-delete-close")?.addEventListener("click", () => this._closeMediaDeleteModal());
        el.querySelector(".cat-te-media-delete-cancel")?.addEventListener("click", () => this._closeMediaDeleteModal());
        el.querySelector(".cat-te-media-delete-confirm")?.addEventListener("click", () => void this._confirmDeleteAction());
        this.mediaDeleteModal?.addEventListener("click", (e) => {
            if (e.target === this.mediaDeleteModal) this._closeMediaDeleteModal();
        });
        el.querySelector(".cat-te-track-convert-close")?.addEventListener("click", () => this._closeTrackConvertModal());
        el.querySelector(".cat-te-track-convert-ok")?.addEventListener("click", () => this._closeTrackConvertModal());
        this.trackConvertModal?.addEventListener("click", (e) => {
            if (e.target === this.trackConvertModal) this._closeTrackConvertModal();
        });
        el.querySelector(".cat-te-agent-add")?.addEventListener("click", () => this._editAgentConfig());
        el.querySelector(".cat-te-agent-cancel")?.addEventListener("click", () => this._cancelAgentEdit());
        el.querySelector(".cat-te-agent-save")?.addEventListener("click", () => void this._saveAgentConfig());
        this.agentDeleteBtn?.addEventListener("click", () => void this._deleteAgentConfig());
        this.agentProviderSelect?.addEventListener("change", () => {
            if (Object.values(AGENT_DEFAULT_MODELS).includes(this.agentModelInput.value) || !this.agentModelInput.value.trim()) {
                this.agentModelInput.value = AGENT_DEFAULT_MODELS[this.agentProviderSelect.value] || "";
            }
        });
        this.autosaveIntervalInput.addEventListener("change", () => {
            const n = parseInt(this.autosaveIntervalInput.value, 10);
            if (!Number.isFinite(n)) {
                this.autosaveIntervalInput.value = String(this._getAutosaveIntervalSec());
                return;
            }
            const clamped = Math.min(MAX_AUTOSAVE_INTERVAL_SEC, Math.max(MIN_AUTOSAVE_INTERVAL_SEC, n));
            localStorage.setItem(STORAGE_AUTOSAVE_INTERVAL, String(clamped));
            this.autosaveIntervalInput.value = String(clamped);
            if (this._overlay?.classList.contains("open")) this._startAutoSave();
        });
        this.useClipVideoFilenameCb?.addEventListener("change", () => {
            this._useClipSpecifiedVideoFilename = !!this.useClipVideoFilenameCb.checked;
            this._saveToWidgets();
        });
        this.promptFontSizeInput?.addEventListener("change", () => {
            const size = this._clampPromptFontSize(this.promptFontSizeInput.value);
            localStorage.setItem(STORAGE_PROMPT_FONT_SIZE, String(size));
            this.promptFontSizeInput.value = String(size);
            this._applyPromptFontSize();
        });
        this.mediaTabs?.forEach((tab) => {
            tab.addEventListener("click", () => {
                const kind = tab.dataset.kind;
                if (!MEDIA_LIBRARY_TABS.some((item) => item.id === kind) || kind === this._mediaTab) return;
                this._mediaTab = kind;
                this._mediaStarFilter = "all";
                this._mediaTypeFilters.clear();
                this._mediaTagFilters.clear();
                this._mediaBatchSelected.clear();
                this._renderMediaGrid();
            });
        });
        this.mediaPrimaryActionBtn?.addEventListener("click", () => {
            if (this._mediaBatchMode) void this._deleteSelectedLibraryMedia();
            else this._chooseMaterialFile();
        });

        this.promptInput?.addEventListener("click", () => void this._openAiOptimizeModal());
        this.aiOptimizeBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            if (this._aiOptimizeBusy) this._cancelAiOptimize();
            else void this._openAiOptimizeModal();
        });
        this.promptIncludeChips?.forEach((chip) => {
            chip.addEventListener("click", (e) => {
                e.stopPropagation();
                this._onPromptIncludeToggle(chip.dataset.include);
            });
        });
        this._renderPromptConcatOrderList();
        if (this.headExtendInput && !this.headExtendInput._catTeBound) {
            this.headExtendInput._catTeBound = true;
            this.headExtendInput.addEventListener("change", () => this._onHeadExtendChange());
            this.tailExtendInput?.addEventListener("change", () => this._onTailExtendChange());
            this.genPreviewVideoCb?.addEventListener("change", () => this._onGenPreviewVideoChange());
            this.secondSampleCb?.addEventListener("change", () => this._onSecondSampleChange());
            this.h3MotionContextInput?.addEventListener("change", () => this._onH3MotionContextChange());
            this.saveLatentCb?.addEventListener("change", () => this._onSaveLatentChange());
            this.clipSeedInput?.addEventListener("change", () => this._onClipSeedChange());
            this.clipSeedRandomBtn?.addEventListener("click", () => this._randomizeClipSeed());
        }
        this.clipRoleSelect?.addEventListener("change", () => this._onClipRoleChange());
        this.clipRoleCustomInput?.addEventListener("change", () => this._onClipRoleCustomChange());
        this.clipAgentSelect?.addEventListener("change", () => this._onClipAgentChange());
        this.clipAgentCustomInput?.addEventListener("change", () => this._onClipAgentCustomChange());
        this._bindSubtitlePanelEvents();
        this.clipSwiperPrev?.addEventListener("click", (e) => {
            e.stopPropagation();
            this._stepClipPreview(-1);
        });
        this.clipSwiperNext?.addEventListener("click", (e) => {
            e.stopPropagation();
            this._stepClipPreview(1);
        });
        this.clipThumbWrap?.addEventListener("click", () => {
            const clip = this._selClip;
            if (clip) this._openClipMediaPreview(clip);
        });
        this.clipThumbSortBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            const clip = this._selClip;
            if (clip) this._openClipItemsModal(clip);
        });
        this.clipThumbDeleteBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            this._removeCurrentClipItem();
        });
        this.clipVideosOpenBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            const clip = this._selClip;
            if (clip) this._openGenVideoModal(clip, 0);
        });
        el.querySelector(".cat-te-gen-video-close")?.addEventListener("click", () => this._closeGenVideoModal());
        this.genVideoPrevBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            this._stepGenVideoPreview(-1);
        });
        this.genVideoNextBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            this._stepGenVideoPreview(1);
        });
        this.genVideoEnabledCb?.addEventListener("change", () => this._onGenVideoEnabledChange());
        this.genVideoMutedCb?.addEventListener("change", () => this._onGenVideoMutedChange());
        this.genVideoNote?.addEventListener("change", () => this._onGenVideoNoteChange());
        this.genVideoNote?.addEventListener("blur", () => this._onGenVideoNoteChange());
        this.genVideoDeleteBtn?.addEventListener("click", () => this._deleteCurrentGenVideo());
        el.querySelector(".cat-te-gen-edit-close")?.addEventListener("click", () => this._closeGenEditModal());
        this.genEditPrompt?.addEventListener("input", () => this._onGenEditPromptInput());
        this._bindGenEditPreviewResize();
        el.querySelector(".cat-te-vo-edit-close")?.addEventListener("click", () => this._closeVoiceoverEditModal(false));
        el.querySelector(".cat-te-vo-edit-cancel")?.addEventListener("click", () => this._closeVoiceoverEditModal(false));
        el.querySelector(".cat-te-vo-edit-save")?.addEventListener("click", () => this._closeVoiceoverEditModal(true));
        this.voEditPrompt?.addEventListener("input", () => this._onVoiceoverEditPromptInput());
        this.voAudioAddBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            const clip = this._selClip;
            if (clip && isVoiceoverTrackType(clip.track?.type)) void this._openOutputAudiosPicker(clip);
        });
        this.voAudioEditBtn?.addEventListener("click", () => {
            const clip = this._selClip;
            if (clip && isVoiceoverTrackType(clip.track?.type)) void this._openVoiceoverEditModal(clip);
        });
        for (const input of [this.voPromptInput, this.voStylePromptInput]) {
            if (!input) continue;
            attachRichPromptHandler(input, { mode: "widget" });
            input.addEventListener("focus", () => { this._voPromptUndoArmed = true; });
            input.addEventListener("blur", () => { this._voPromptUndoArmed = false; });
            input.addEventListener("input", () => this._onVoiceoverPromptInput());
        }
        el.querySelector(".cat-te-output-videos-close")?.addEventListener("click", () => this._closeOutputVideosPicker());
        this.outputVideosFilter?.addEventListener("input", () => this._renderOutputVideosPicker());
        this.outputVideosAutoLinkBtn?.addEventListener("click", () => void this._autoAssociateOutputMedia());
        this.outputVideosTimeButtons?.forEach((btn) => {
            btn.addEventListener("click", () => {
                this._outputVideosTimeRange = btn.dataset.range;
                this.outputVideosTimeButtons.forEach((b) => b.classList.toggle("is-active", b === btn));
                this._renderOutputVideosPicker();
            });
        });
        this.outputVideosBody?.addEventListener("scroll", () => this._hideOutputVideoHoverPreview(), { passive: true });
        el.querySelector(".cat-te-sidebar")?.addEventListener("scroll", () => {
            if (this.clipVideosList?.contains(this._outputVideoHoverAnchor)) this._hideOutputVideoHoverPreview();
        }, { capture: true, passive: true });
        this._bindModalInteractions();
        el.querySelector(".cat-te-compose-close")?.addEventListener("click", () => this._closeComposeModal());
        el.querySelector(".cat-te-compose-cancel")?.addEventListener("click", () => this._closeComposeModal());
        this.composeRunBtn?.addEventListener("click", () => {
            if (this._composeDone) { void this._revealComposeOutput(); return; }
            void this._runComposeVideoExport();
        });
        this._bindWatermarkUi();
        this.mediaPreviewDesc?.addEventListener("input", () => this._saveMediaPreviewMeta());
        this.mediaPreviewDesc?.addEventListener("change", () => this._saveMediaPreviewMeta());
        this.mediaPreviewDesc?.addEventListener("blur", () => this._saveMediaPreviewMeta());
        this.mediaPreviewType?.addEventListener("change", () => this._onMediaPreviewTypeChange());
        this.mediaPreviewTypeCustom?.addEventListener("change", () => this._saveMediaPreviewMeta());
        this.mediaPreviewTypeCustom?.addEventListener("blur", () => this._saveMediaPreviewMeta());
        this.mediaPreviewTags?.addEventListener("change", () => this._saveMediaPreviewMeta());
        this.mediaPreviewTags?.addEventListener("blur", () => this._saveMediaPreviewMeta());
        el.querySelector(".cat-te-clip-items-close")?.addEventListener("click", () => this._closeClipItemsModal());
        el.querySelector(".cat-te-ai-optimize-close")?.addEventListener("click", () => this._closeAiOptimizeModal());
        this.aiOptimizePrevBtn?.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            void this._stepAiOptimizeClip(-1);
        });
        this.aiOptimizeNextBtn?.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            void this._stepAiOptimizeClip(1);
        });
        this.aiSrcTabs?.forEach((tab) => {
            tab.addEventListener("click", () => this._setAiOptimizeSrcTab(tab.dataset.src));
        });
        this.aiSrcText?.addEventListener("focus", () => { this._promptManagerUndoArmed = true; });
        this.aiSrcText?.addEventListener("blur", () => { this._promptManagerUndoArmed = false; });
        this.aiSrcText?.addEventListener("input", () => this._onPromptManagerSourceInput());
        this.aiGenerateBtn?.addEventListener("click", () => {
            if (this._aiOptimizeBusy) this._cancelAiOptimize();
            else void this._runAiOptimize();
        });
        this.aiPreviewBtn?.addEventListener("click", () => {
            if (this._modelPreviewPromptId) void this._stopModelPreview();
            else void this._startModelPreview();
        });
        el.querySelector(".cat-te-ai-run").addEventListener("click", () => {
            const clip = this._findClipById(this._aiOptimizeClipId);
            if (!clip) return;
            void this._runClipDownstream(clip);
            this._closeAiOptimizeModal();
        });
        this.aiLangSelect?.addEventListener("change", () => {
            const lang = this._aiOutputLanguage();
            localStorage.setItem(STORAGE_AI_PROMPT_LANG, lang);
        });
        this.skillPickBtn?.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            void this._openSkillPicker();
        });
        this.skillSyncBtn?.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            void this._syncH3Skills();
        });
        el.querySelector(".cat-te-skill-picker-close")?.addEventListener("click", () => this._closeSkillPicker());
        this.skillPickerFilter?.addEventListener("input", () => this._renderSkillPicker());
        this.skillPickerBody?.addEventListener("click", (e) => {
            const btn = e.target.closest?.(".cat-te-skill-apply");
            if (!btn) return;
            e.preventDefault();
            void this._applyH3Skill(btn.dataset.skillId);
        });

        el.addEventListener("keydown", e => {
            const typing = !!e.target?.closest?.("input, textarea, select, [contenteditable='true']");
            if (this._blockingModal === this.mediaPreviewModal && this._mediaPreviewState?.browse !== false
                && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !typing) {
                this._stepMediaPreview(e.key === "ArrowRight" ? 1 : -1);
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            if (this._blockingModal === this.genVideoModal && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !typing) {
                this._stepGenVideoPreview(e.key === "ArrowRight" ? 1 : -1);
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            if (this._blockingModal === this.aiOptimizeModal
                && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !typing) {
                void this._stepAiOptimizeClip(e.key === "ArrowRight" ? 1 : -1);
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            if (e.key === "Escape") {
                if (this.mediaDeleteModal && !this.mediaDeleteModal.hidden) {
                    this._closeMediaDeleteModal();
                    e.stopPropagation();
                    return;
                }
                if (this.outputVideosModal && !this.outputVideosModal.hidden) {
                    this._closeOutputVideosPicker();
                    e.stopPropagation();
                    return;
                }
                if (this.genEditModal && !this.genEditModal.hidden) {
                    this._closeGenEditModal();
                    e.stopPropagation();
                    return;
                }
                if (this.voEditModal && !this.voEditModal.hidden) {
                    this._closeVoiceoverEditModal(false);
                    e.stopPropagation();
                    return;
                }
                if (this._modalsBlockFileDrop()) { e.stopPropagation(); return; }
                if (this._removeCtxMenu()) { e.stopPropagation(); return; }
                if (this._closeMediaFilterPanel()) { e.stopPropagation(); return; }
                e.stopPropagation();
                this.close();
            }
        });

        document.addEventListener("click", this._onDocClick = (e) => {
            if (this._ignoreCtxCloseOnce) {
                this._ignoreCtxCloseOnce = false;
                return;
            }
            this._removeCtxMenu();
            if (!e.target.closest?.(".cat-te-media-filter-wrap")) this._closeMediaFilterPanel();
        });

        this._applySavedMediaPanelWidth();
        this._bindMediaPanelResize();
        this._applySavedSidebarPanelWidth();
        this._bindSidebarPanelResize();
        this._applySavedProgramPanelHeight();
        this._bindProgramPanelResize();
        this._bindExternalFileDrop();
        this._renderMediaStarFilter();
        this._applyPromptFontSize();
    }

    _mediaPanelMaxWidth() {
        const main = this._overlay?.querySelector(".cat-te-main");
        const mainW = main?.clientWidth ?? 0;
        if (mainW <= 0) return MIN_MEDIA_PANEL_W + 400;
        return Math.max(MIN_MEDIA_PANEL_W, Math.floor(mainW * MAX_MEDIA_PANEL_FRAC));
    }

    _setMediaPanelWidth(w) {
        const clamped = Math.min(this._mediaPanelMaxWidth(), Math.max(MIN_MEDIA_PANEL_W, Math.round(w)));
        this._overlay?.style.setProperty("--cat-te-media-w", `${clamped}px`);
        return clamped;
    }

    _applySavedMediaPanelWidth() {
        const saved = parseInt(localStorage.getItem(STORAGE_MEDIA_PANEL_W), 10);
        if (Number.isFinite(saved) && saved >= MIN_MEDIA_PANEL_W) {
            this._setMediaPanelWidth(saved);
        } else {
            this._setMediaPanelWidth(DEFAULT_MEDIA_PANEL_W);
        }
    }

    _bindMediaPanelResize() {
        const split = this.mediaPanelSplit;
        const panel = this.mediaPanel;
        if (!split || !panel) return;

        split.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            const startX = e.clientX;
            const startW = panel.offsetWidth;
            split.classList.add("dragging");
            document.body.classList.add("cat-te-col-resize");

            const onMove = (ev) => {
                this._setMediaPanelWidth(startW + (ev.clientX - startX));
            };
            const onUp = () => {
                split.classList.remove("dragging");
                document.body.classList.remove("cat-te-col-resize");
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
                localStorage.setItem(STORAGE_MEDIA_PANEL_W, String(panel.offsetWidth));
                this._refreshTimelineDuration();
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        });

        if (!this._onMediaPanelWinResize) {
            this._onMediaPanelWinResize = () => {
                if (!this._overlay?.classList.contains("open")) return;
                const w = this._setMediaPanelWidth(panel.offsetWidth);
                localStorage.setItem(STORAGE_MEDIA_PANEL_W, String(w));
                this._setSidebarPanelWidth(this.sidebarPanel?.offsetWidth ?? DEFAULT_SIDEBAR_PANEL_W);
            };
            window.addEventListener("resize", this._onMediaPanelWinResize);
        }
    }

    _sidebarPanelMaxWidth() {
        const main = this._overlay?.querySelector(".cat-te-main");
        const mainW = main?.clientWidth ?? 0;
        if (mainW <= 0) return DEFAULT_SIDEBAR_PANEL_W + 200;
        return Math.max(MIN_SIDEBAR_PANEL_W, Math.floor(mainW * MAX_SIDEBAR_PANEL_FRAC));
    }

    _setSidebarPanelWidth(w) {
        const clamped = Math.min(this._sidebarPanelMaxWidth(), Math.max(MIN_SIDEBAR_PANEL_W, Math.round(w)));
        this._overlay?.style.setProperty("--cat-te-sidebar-w", `${clamped}px`);
        return clamped;
    }

    _applySavedSidebarPanelWidth() {
        const saved = parseInt(localStorage.getItem(STORAGE_SIDEBAR_PANEL_W), 10);
        if (Number.isFinite(saved) && saved >= MIN_SIDEBAR_PANEL_W) {
            this._setSidebarPanelWidth(saved);
        } else {
            this._setSidebarPanelWidth(DEFAULT_SIDEBAR_PANEL_W);
        }
    }

    _bindSidebarPanelResize() {
        const split = this.sidebarPanelSplit;
        const panel = this.sidebarPanel;
        if (!split || !panel) return;

        split.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            const startX = e.clientX;
            const startW = panel.offsetWidth;
            split.classList.add("dragging");
            document.body.classList.add("cat-te-col-resize");

            const onMove = (ev) => {
                // Dragging the left edge of the right panel: move left → wider.
                this._setSidebarPanelWidth(startW - (ev.clientX - startX));
            };
            const onUp = () => {
                split.classList.remove("dragging");
                document.body.classList.remove("cat-te-col-resize");
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
                localStorage.setItem(STORAGE_SIDEBAR_PANEL_W, String(panel.offsetWidth));
                this._refreshTimelineDuration();
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        });

        if (!this._onSidebarPanelWinResize) {
            this._onSidebarPanelWinResize = () => {
                if (!this._overlay?.classList.contains("open")) return;
                const w = this._setSidebarPanelWidth(panel.offsetWidth);
                localStorage.setItem(STORAGE_SIDEBAR_PANEL_W, String(w));
            };
            window.addEventListener("resize", this._onSidebarPanelWinResize);
        }
    }

    _programPanelMaxHeight() {
        const center = this._overlay?.querySelector(".cat-te-center");
        const ch = center?.clientHeight ?? 0;
        if (ch <= 0) return DEFAULT_PROGRAM_PANEL_H + 200;
        return Math.max(MIN_PROGRAM_PANEL_H, Math.floor(ch * MAX_PROGRAM_PANEL_FRAC));
    }

    _setProgramPanelHeight(h) {
        const clamped = Math.min(this._programPanelMaxHeight(), Math.max(MIN_PROGRAM_PANEL_H, Math.round(h)));
        this._overlay?.style.setProperty("--cat-te-program-h", `${clamped}px`);
        return clamped;
    }

    _applySavedProgramPanelHeight() {
        const saved = parseInt(localStorage.getItem(STORAGE_PROGRAM_PANEL_H), 10);
        if (Number.isFinite(saved) && saved >= MIN_PROGRAM_PANEL_H) {
            this._setProgramPanelHeight(saved);
        } else {
            this._setProgramPanelHeight(DEFAULT_PROGRAM_PANEL_H);
        }
    }

    _bindProgramPanelResize() {
        const split = this.programSplit;
        const panel = this.programRoot;
        if (!split || !panel) return;

        split.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            const startY = e.clientY;
            const startH = panel.offsetHeight;
            split.classList.add("dragging");
            document.body.classList.add("cat-te-row-resize");

            const onMove = (ev) => {
                this._setProgramPanelHeight(startH + (ev.clientY - startY));
                this._scheduleProgramPreview();
            };
            const onUp = () => {
                split.classList.remove("dragging");
                document.body.classList.remove("cat-te-row-resize");
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
                const h = this._setProgramPanelHeight(panel.offsetHeight);
                localStorage.setItem(STORAGE_PROGRAM_PANEL_H, String(h));
                this._refreshTimelineDuration();
                this._scheduleProgramPreview();
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        });

        if (!this._onProgramPanelWinResize) {
            this._onProgramPanelWinResize = () => {
                if (!this._overlay?.classList.contains("open")) return;
                const h = this._setProgramPanelHeight(panel.offsetHeight);
                localStorage.setItem(STORAGE_PROGRAM_PANEL_H, String(h));
                this._scheduleProgramPreview();
            };
            window.addEventListener("resize", this._onProgramPanelWinResize);
        }
    }

    _viewportRightPaddingSec() {
        const tl = this._timeline;
        if (!tl?.scrollEl) return 0;
        const vw = tl.scrollEl.clientWidth || 0;
        if (vw <= 0) return 0;
        return (vw * TIMELINE_RIGHT_VIEWPORT_FRAC) / Math.max(1e-6, tl.pixelsPerSecond);
    }

    /**
     * Zoom level (relative to the current one) at which the furthest clip
     * end exactly fills 70% of the viewport width, leaving 30% blank margin
     * visible with no scrolling. Returns null when there's no content or the
     * viewport hasn't been laid out yet.
     */
    _computeFitZoom() {
        const tl = this._timeline;
        if (!tl?.scrollEl) return null;
        const vw = tl.scrollEl.clientWidth || 0;
        if (vw <= 0) return null;

        let maxEnd = 0;
        for (const track of tl.tracks) {
            for (const clip of track.clips) {
                maxEnd = Math.max(maxEnd, clip.endTime);
            }
        }
        if (maxEnd <= 0) return null;

        const pps = tl.pixelsPerSecond;
        const desiredPps = (vw * (1 - TIMELINE_RIGHT_VIEWPORT_FRAC)) / maxEnd;
        return tl._zoom * (desiredPps / pps);
    }

    /**
     * Zoom out (never in) just enough that the furthest clip end still fits
     * within 70% of the viewport width, leaving the reserved 30% margin
     * actually visible on screen instead of requiring a scroll.
     */
    _autoFitZoom() {
        const tl = this._timeline;
        const fitZoom = this._computeFitZoom();
        if (fitZoom == null || fitZoom >= tl._zoom) return; // content already fits within the 70% zone

        tl.setZoom(fitZoom);
        tl.scrollEl.scrollLeft = 0;
    }

    /**
     * Pin the "zoomed all the way out" floor to the same 70/30 fit point, so
     * manually zooming out (Ctrl+wheel, slider, − button) can't go past a
     * state that still requires scrolling to see the reserved margin.
     */
    _syncMinZoom() {
        const tl = this._timeline;
        if (!tl) return;
        const fitZoom = this._computeFitZoom();
        const absoluteFloor = 0.02;
        tl.minZoom = fitZoom != null
            ? Math.min(Math.max(fitZoom, absoluteFloor), tl.maxZoom)
            : absoluteFloor;
    }

    _readTimelineZoom(settings) {
        const z = Number(settings?.timeline_zoom);
        return Number.isFinite(z) && z > 0 ? z : null;
    }

    _applyTimelineZoomFromSettings(settings, { autoFitIfMissing = true } = {}) {
        const tl = this._timeline;
        if (!tl) return;
        const saved = this._readTimelineZoom(settings);
        if (saved != null) {
            tl.setZoom(saved);
        } else if (autoFitIfMissing) {
            this._autoFitZoom();
        }
    }

    _viewCacheKey() {
        const id = this.node?.id;
        return `${STORAGE_VIEW_PREFIX}${id != null ? id : "default"}`;
    }

    _readViewFromLocalCache() {
        try {
            const raw = localStorage.getItem(this._viewCacheKey());
            if (!raw) return null;
            const data = JSON.parse(raw);
            return data && typeof data === "object" ? data : null;
        } catch {
            return null;
        }
    }

    _persistViewToLocalCache() {
        const tl = this._timeline;
        if (!tl) return;
        const payload = {
            current_time: Number(tl.currentTime) || 0,
            timeline_zoom: Number(tl.getZoom?.() ?? tl._zoom) || 1.2,
            timeline_scroll_left: Number(tl.scrollEl?.scrollLeft) || 0,
            timeline_scroll_top: Number(tl.scrollEl?.scrollTop) || 0,
        };
        try {
            localStorage.setItem(this._viewCacheKey(), JSON.stringify(payload));
        } catch { /* quota / private mode */ }
    }

    _persistPanelLayout() {
        const mediaW = this.mediaPanel?.offsetWidth;
        const sidebarW = this.sidebarPanel?.offsetWidth;
        const programH = this.programRoot?.offsetHeight;
        if (Number.isFinite(mediaW) && mediaW >= MIN_MEDIA_PANEL_W) {
            localStorage.setItem(STORAGE_MEDIA_PANEL_W, String(Math.round(mediaW)));
        }
        if (Number.isFinite(sidebarW) && sidebarW >= MIN_SIDEBAR_PANEL_W) {
            localStorage.setItem(STORAGE_SIDEBAR_PANEL_W, String(Math.round(sidebarW)));
        }
        if (Number.isFinite(programH) && programH >= MIN_PROGRAM_PANEL_H) {
            localStorage.setItem(STORAGE_PROGRAM_PANEL_H, String(Math.round(programH)));
        }
    }

    _readViewSettingsFromProjectWidget() {
        const parsed = this._parseProjectWidgetValue();
        const settings = parsed.project?.settings && typeof parsed.project.settings === "object"
            ? parsed.project.settings
            : {};
        return { ...this._readViewFromLocalCache(), ...settings };
    }

    /**
     * Restore playhead + scroll (and optionally zoom) from project settings /
     * local cache. Zoom should already be applied when applyZoom is false.
     */
    _applyTimelineViewFromSettings(settings, { applyZoom = false, autoFitIfMissing = false } = {}) {
        const tl = this._timeline;
        if (!tl) return;
        if (applyZoom) {
            this._applyTimelineZoomFromSettings(settings, { autoFitIfMissing });
        }
        const t = Number(settings?.current_time);
        if (Number.isFinite(t) && t >= 0) {
            tl.setCurrentTime(t, { userSeek: false });
        }
        const scrollEl = tl.scrollEl;
        if (!scrollEl) return;
        const sl = Number(settings?.timeline_scroll_left);
        const st = Number(settings?.timeline_scroll_top);
        if (Number.isFinite(sl) && sl >= 0) scrollEl.scrollLeft = sl;
        if (Number.isFinite(st) && st >= 0) scrollEl.scrollTop = st;
    }

    _computeTimelineDuration() {
        let maxEnd = 0;
        for (const track of this._timeline?.tracks ?? []) {
            for (const clip of track.clips) {
                maxEnd = Math.max(maxEnd, clip.endTime);
            }
        }
        const fps = this.getFps();
        const step = 1 / fps;
        const pad = this._viewportRightPaddingSec();
        if (maxEnd <= 0) {
            return Math.max(60, this._timeline?.duration ?? 60);
        }
        return Math.ceil((maxEnd + pad) / step) * step;
    }

    _ensureTimelineLength(minEndSec) {
        if (!this._timeline) return;
        const pad = this._viewportRightPaddingSec();
        const need = Math.max(minEndSec + pad, 60);
        if (need <= this._timeline.duration) return;
        this._timeline.duration = need;
        if (this._timeline._durEl) {
            this._timeline._durEl.textContent = `/ ${this._timeline.formatTime(need)}`;
        }
        this._timeline._refresh();
    }

    _refreshTimelineDuration() {
        if (!this._timeline) return;
        const dur = this._computeTimelineDuration();
        this._timeline.duration = dur;
        this._syncMinZoom();
        if (this._timeline._durEl) {
            this._timeline._durEl.textContent = `/ ${this._timeline.formatTime(dur)}`;
        }
        this._timeline._refresh();
    }

    _allImageTracks() {
        return (this._timeline?.tracks ?? []).filter(t => t.type === "image");
    }

    _allMediaTracks() {
        return (this._timeline?.tracks ?? []).filter(t => isMediaTrackType(t.type));
    }

    _allRenderableTracks() {
        return (this._timeline?.tracks ?? []).filter(t => isDirectorTrackType(t.type) || isMediaTrackType(t.type));
    }

    _allAudioTracks() {
        return (this._timeline?.tracks ?? []).filter(t => t.type === "audio");
    }

    _allVoiceoverTracks() {
        return (this._timeline?.tracks ?? []).filter(t => isVoiceoverTrackType(t.type));
    }

    _allTextTracks() {
        return (this._timeline?.tracks ?? []).filter(t => isSubtitleTrackType(t.type));
    }

    _trackIndex(track) {
        return this._trackInfo.get(track.id)?.trackIndex ?? 0;
    }

    _nextTrackIndex() {
        let max = -1;
        for (const v of this._trackInfo.values()) {
            max = Math.max(max, v.trackIndex ?? 0);
        }
        return max + 1;
    }

    /** Icon-only slot shared by every track row. `null` renders an empty,
     * non-interactive placeholder so the same-function icon in other rows
     * (lock/eye/mute) always lines up in the same column. */
    _makeTrackSlot(track, kind) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cat-te-track-btn";
        if (kind === null) {
            btn.classList.add("placeholder");
            btn.disabled = true;
            btn.tabIndex = -1;
            return btn;
        }
        if (kind === "lock") {
            const render = () => {
                btn.innerHTML = track.locked ? ICONS.lock : ICONS.lockOpen;
                btn.classList.toggle("active", track.locked);
                btn.title = track.locked ? T("unlock_track_title") : T("lock_track_title");
            };
            btn.addEventListener("click", e => {
                e.stopPropagation();
                this._recordUndo();
                track.setLocked(!track.locked);
                render();
            });
            render();
        } else if (kind === "visible") {
            const render = () => {
                btn.innerHTML = track.visible ? ICONS.eye : ICONS.eyeOff;
                btn.classList.toggle("active", !track.visible);
            };
            btn.title = T("track_visibility_title");
            btn.addEventListener("click", e => {
                e.stopPropagation();
                this._recordUndo();
                track.setVisible(!track.visible);
                render();
                this._decorateAllClips();
                this._scheduleProgramPreview();
            });
            render();
        } else if (kind === "mute") {
            const render = () => {
                btn.innerHTML = track.muted ? ICONS.volumeOff : ICONS.volume;
                btn.classList.toggle("active", track.muted);
                const off = T("unmute_label");
                const on = T("mute_label");
                btn.title = track.muted ? off : on;
            };
            btn.addEventListener("click", e => {
                e.stopPropagation();
                this._recordUndo();
                track.setMuted(!track.muted);
                render();
                this._decorateAllClips();
                this._scheduleProgramPreview();
                if (this._timeline?._playing) this._startAudioPlayback();
            });
            render();
        }
        return btn;
    }

    _setupTrackControls(track) {
        const icon = track.headerEl?.querySelector(".tl-track-icon");
        if (icon && !icon.dataset.catTeTypeMenuBound) {
            icon.dataset.catTeTypeMenuBound = "1";
            icon.style.cursor = "pointer";
            icon.addEventListener("mouseenter", () => this._showTrackTypeMenu(track, icon));
            icon.addEventListener("mouseleave", () => this._scheduleTrackTypeMenuHide());
        }
        const actions = track.actionsEl;
        if (!actions || actions.dataset.catTeBound) return;
        actions.dataset.catTeBound = "1";
        actions.replaceChildren();

        // Fixed column order for every track type: lock, visibility, mute.
        // A track that doesn't support a slot gets a blank placeholder
        // instead of skipping it, so the icons that DO apply still align
        // vertically with the same column in other rows.
        actions.appendChild(this._makeTrackSlot(track, "lock"));
        actions.appendChild(this._makeTrackSlot(
            track,
            (isDirectorTrackType(track.type) || isMediaTrackType(track.type) || isSubtitleTrackType(track.type)) ? "visible" : null,
        ));
        // Audio / voiceover: mute; image/video: mute (embedded audio); subtitle: placeholder.
        actions.appendChild(this._makeTrackSlot(
            track,
            (track.type === "audio" || isVoiceoverTrackType(track.type)
                || track.type === "image" || track.type === "video") ? "mute" : null,
        ));
    }

    /** User-added tracks (not the default main/overlay/audio ones) disappear
     * on their own once emptied — there's no manual delete button. */
    _pruneEmptyTrack(track) {
        if (!track) return;
        if ([this._subtitleTrack, this._mediaTrack, this._mainTrack, this._voiceoverTrack, this._audioTrack].includes(track)) return;
        if (track.clips.length > 0) return;
        this._timeline?.removeTrack(track.id);
    }

    handleDeleteKey(e) {
        if (!this._overlay?.classList.contains("open")) return false;
        if (e.target?.closest?.("input, textarea, select")) return false;
        if (e.key !== "Delete" && e.key !== "Backspace") return false;
        const clips = this._timeline?.getSelectedClips() ?? [];
        if (!clips.length) return false;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        const n = clips.length;
        const msg = n === 1
            ? T("confirm_delete_named_clip", { name: clips[0].name })
            : T("confirm_delete_selected_n_clips", { n });
        this._openDeleteConfirm(msg, () => this._removeTimelineClips(clips));
        return true;
    }

    _removeTimelineClips(clips) {
        const existing = clips.filter((clip) => clip?.track?.getClip?.(clip.id));
        if (!existing.length) return;
        this._recordUndo();
        for (const clip of existing) {
            this._meta.delete(clip.id);
            this._timeline.removeClip(clip.track.id, clip.id);
        }
        if (!this._timeline.getSelectedClips().length) {
            this._timeline.selectClip(null);
        }
        this._updatePromptPanel();
        this._refreshTimelineDuration();
    }

    _imgUrl(file) {
        return this._assetFileUrl(file, "image", "input");
    }

    _videoUrl(file) {
        return this._assetFileUrl(file, "video", "input");
    }

    _outputVideoUrl(file) {
        const rel = normalizeOutputVideoPath(file)
            || String(file || "").replace(/\\/g, "/").replace(/^\/+/, "");
        if (!rel) return "";
        const slash = rel.lastIndexOf("/");
        const filename = slash >= 0 ? rel.slice(slash + 1) : rel;
        const subfolder = slash >= 0 ? rel.slice(0, slash) : "";
        return api.apiURL(
            `/view?filename=${encodeURIComponent(filename)}`
            + `&type=output&subfolder=${encodeURIComponent(subfolder)}`,
        );
    }

    _getOutputVideoThumbnail(file) {
        const key = `output:${file}`;
        if (this._videoThumbCache.has(key)) return this._videoThumbCache.get(key);
        const p = this._grabVideoThumbnail(this._outputVideoUrl(file)).catch(() => null);
        this._videoThumbCache.set(key, p);
        return p;
    }

    _audioUrl(filename) {
        if (!filename) return null;
        return this._assetFileUrl(filename, "audio", "input");
    }

    /** Rebuild media lists from this project's resources + timeline refs only.
     * Do not scan the whole ComfyUI input folder — a new empty node stays empty. */
    async _reloadMediaLibrary() {
        this._mediaReloading = true;
        this._overlay?.querySelector(".cat-te-media-refresh")?.classList.add("spinning");
        this._videoThumbCache.clear();
        this._loadMediaStarsForDir();
        try {
            this._imgFiles = [];
            this._videoFiles = [];
            this._audioFiles = [];
            this._mediaStatus.clear();
            await this._syncProjectMedia();
            this._renderMediaGrid();
        } finally {
            this._mediaReloading = false;
            this._overlay?.querySelector(".cat-te-media-refresh")?.classList.remove("spinning");
        }
    }

    /** Re-check project media status (missing / present), then redraw. */
    async _refreshMediaLists() {
        await this._reloadMediaLibrary();
    }

    _mediaStarsId(kind, file) {
        return `${kind}:${file}`;
    }

    _findMediaById(id) {
        const key = String(id || "");
        if (!key) return null;
        return this._projectResources.find((row) => row?.id === key) || null;
    }

    _findMedia(kind, file) {
        file = String(file || "").trim();
        kind = mediaKindFromFilename(file, kind);
        if (!kind || !file) return null;
        return this._projectResources.find((row) => row.kind === kind && row.file === file) || null;
    }

    _ensureMedia(kind, file, extras = {}) {
        file = String(file || "").trim();
        kind = mediaKindFromFilename(file, kind);
        if (!kind || !file || !["image", "video", "audio"].includes(kind)) return null;
        let row = this._findMedia(kind, file);
        if (!row) {
            const local = this._parseMediaMeta(this._mediaStarsByDir?.[this._mediaStarsId(kind, file)]);
            row = {
                id: mediaUid(),
                kind,
                file,
                location: "input",
                name: file.split(/[\\/]/).pop() || file,
                prompt: local.prompt || "",
                generation_prompt: local.generationPrompt || "",
                setting_description: local.settingDescription || "",
                media_type: local.mediaType || "",
                tags: Array.isArray(local.tags) ? [...local.tags] : [],
            };
            if (local.stars) row.stars = local.stars;
            this._projectResources.push(row);
        }
        if (!row.id) row.id = mediaUid();
        row.location = "input";
        if (extras && typeof extras === "object") Object.assign(row, extras);
        const list = kind === "audio" ? this._audioFiles : kind === "video" ? this._videoFiles : this._imgFiles;
        if (!list.includes(file)) list.push(file);
        this._mediaStatus.set(`${kind}:${file}`, { location: "input" });
        return row;
    }

    _serializeMediaCatalog() {
        const seen = new Set();
        const out = [];
        for (const row of this._projectResources) {
            if (!row?.kind || !row?.file) continue;
            const kind = mediaKindFromFilename(row.file, row.kind);
            if (!kind) continue;
            const key = `${kind}:${row.file}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const entry = {
                id: row.id || mediaUid(),
                kind,
                file: row.file,
                location: "input",
                name: row.name || String(row.file).split(/[\\/]/).pop(),
                prompt: String(row.prompt || ""),
                generation_prompt: String(row.generation_prompt || ""),
                setting_description: String(row.setting_description || ""),
                media_type: String(row.media_type || "").trim(),
                tags: Array.isArray(row.tags) ? row.tags.map((t) => String(t || "").trim()).filter(Boolean) : [],
            };
            const stars = Number(row.stars);
            if (Number.isFinite(stars) && stars >= 1 && stars <= 5) entry.stars = stars;
            if (!row.id) row.id = entry.id;
            out.push(entry);
        }
        return out;
    }

    _migrateProjectDocument(project) {
        const src = project && typeof project === "object" && !Array.isArray(project)
            ? JSON.parse(JSON.stringify(project))
            : {};
        const schemaVersion = parseSchemaVersion(src);
        if (!Array.isArray(src.tracks)) src.tracks = [];
        if (!src.settings || typeof src.settings !== "object") src.settings = {};
        migrateProjectSettingPrompts(src.settings);
        src.name = String(src.name || T("untitled_project")).trim() || T("untitled_project");
        this._loadMediaStarsForDir();
        if (schemaVersion < 2) this._migrateProjectSchema1To2(src);
        else this._hydrateMediaCatalog(src);
        if (schemaVersion < 3) this._migrateProjectSchema2To3(src);
        this._normalizeH3PromptFields(src);
        src.settings.prompt_concat_order = normalizePromptConcatOrder(src.settings.prompt_concat_order);
        for (const track of src.tracks) {
            for (const clip of track?.clips || []) {
                if (!clip || typeof clip !== "object") continue;
                clip.prompt_includes = promptIncludesFromClipJson(clip);
                delete clip.use_global_prompt;
                delete clip.use_ai_prompt;
            }
        }
        src.schema_version = this._currentSchemaVersion();
        src.project_version = this._currentVersion();
        return src;
    }

    _migrateProjectSchema2To3(project) {
        for (const track of project.tracks || []) {
            for (const clip of track?.clips || []) {
                if (!clip || typeof clip !== "object") continue;
                if (!("detailed_description" in clip) && "ai_prompt" in clip) {
                    const split = splitH3ProjectPrompt(clip.ai_prompt);
                    if (split) {
                        const currentPrompt = String(clip.prompt || "").trim();
                        clip.prompt = currentPrompt
                            ? `${split.clipPrompt}\n\n${currentPrompt}`
                            : split.clipPrompt;
                        clip.detailed_description = split.detailedDescription;
                        this._storeH3SoundAndMusic(project, split.soundAndMusic);
                    } else {
                        clip.detailed_description = clip.ai_prompt || "";
                    }
                }
                delete clip.ai_prompt;
                if (Array.isArray(clip.prompt_includes)) {
                    clip.prompt_includes = clip.prompt_includes.map((key) => (
                        key === "ai" ? "detailed_description" : key
                    ));
                }
            }
        }
    }

    _storeH3SoundAndMusic(project, text) {
        const sound = String(text || "").trim();
        if (!sound) return;
        const settings = project.settings && typeof project.settings === "object" ? project.settings : (project.settings = {});
        const current = String(settings.append_prompt || "").trim();
        if (!current) settings.append_prompt = sound;
        else if (!current.includes(sound)) settings.append_prompt = `${sound}\n\n${current}`;
    }

    _normalizeH3PromptFields(project) {
        for (const track of project.tracks || []) {
            for (const clip of track?.clips || []) {
                if (!clip || typeof clip !== "object") continue;
                const split = splitH3ProjectPrompt(clip.detailed_description);
                if (!split) continue;
                const currentPrompt = String(clip.prompt || "").trim();
                if (!currentPrompt) clip.prompt = split.clipPrompt;
                else if (!currentPrompt.includes(split.clipPrompt)) clip.prompt = `${split.clipPrompt}\n\n${currentPrompt}`;
                clip.detailed_description = split.detailedDescription;
                const includes = Array.isArray(clip.prompt_includes) ? clip.prompt_includes : [];
                for (const key of ["clip", "detailed_description"]) {
                    if (!includes.includes(key)) includes.push(key);
                }
                clip.prompt_includes = includes;
                this._storeH3SoundAndMusic(project, split.soundAndMusic);
            }
        }
    }

    _hydrateMediaCatalog(project) {
        const media = [];
        const seenKey = new Set();
        const seenId = new Set();
        for (const row of project.media || project.resources || []) {
            if (!row || typeof row !== "object") continue;
            const file = String(row.file || "").trim();
            const declaredKind = String(row.kind || "").toLowerCase();
            const kind = mediaKindFromFilename(file, declaredKind);
            if (!kind || !file || !["image", "video", "audio"].includes(kind)) continue;
            const key = `${kind}:${file}`;
            if (seenKey.has(key)) continue;
            seenKey.add(key);
            let id = String(row.id || "").trim() || mediaUid();
            if (seenId.has(id)) id = mediaUid();
            seenId.add(id);
            const local = this._parseMediaMeta(
                this._mediaStarsByDir?.[this._mediaStarsId(kind, file)]
                ?? this._mediaStarsByDir?.[this._mediaStarsId(declaredKind, file)],
            );
            const tags = Array.isArray(row.tags) ? row.tags : (local.tags || []);
            const entry = {
                id,
                kind,
                file,
                location: "input",
                name: row.name || file.split(/[\\/]/).pop() || file,
                prompt: String(row.prompt || local.prompt || ""),
                generation_prompt: String(row.generation_prompt || row.generationPrompt || local.generationPrompt || ""),
                setting_description: String(row.setting_description || row.settingDescription || local.settingDescription || ""),
                media_type: String(row.media_type || row.mediaType || local.mediaType || "").trim(),
                tags: tags.map((t) => String(t || "").trim()).filter(Boolean),
            };
            const stars = Number(row.stars ?? local.stars);
            if (Number.isFinite(stars) && stars >= 1 && stars <= 5) entry.stars = stars;
            media.push(entry);
        }
        project.media = media;
        delete project.resources;
        const catalog = new Map(media.map((row) => [row.id, row]));
        for (const track of project.tracks || []) {
            if (!track || typeof track !== "object") continue;
            for (const clip of track.clips || []) {
                if (!clip || typeof clip !== "object") continue;
                const ids = Array.isArray(clip.media_ids) ? clip.media_ids.map((id) => String(id)) : [];
                const valid = ids.filter((id) => catalog.has(id));
                if (valid.length) {
                    clip.media_ids = valid;
                    this._stripLegacyClipFiles(clip);
                    continue;
                }
                const refs = this._legacyClipMediaRefs(clip, track);
                clip.media_ids = refs.map((row) => {
                    let found = media.find((m) => m.kind === row.kind && m.file === row.file);
                    if (!found) {
                        found = {
                            id: mediaUid(),
                            kind: row.kind,
                            file: row.file,
                            location: "input",
                            name: row.file.split(/[\\/]/).pop() || row.file,
                            prompt: "",
                            generation_prompt: "",
                            setting_description: "",
                            media_type: "",
                            tags: [],
                        };
                        media.push(found);
                        catalog.set(found.id, found);
                    }
                    return found.id;
                });
                this._stripLegacyClipFiles(clip);
            }
        }
    }

    _legacyClipMediaRefs(clip, track) {
        const trackType = String(track?.type || "visual").toLowerCase();
        const clipType = String(clip.type || (trackType === "audio" ? "audio" : "image")).toLowerCase();
        const isAudio = clipType === "audio" || trackType === "audio";
        const refs = [];
        const add = (kind, file) => {
            file = String(file || "").trim();
            kind = mediaKindFromFilename(file, kind);
            if (!kind || !file) return;
            if (refs.some((r) => r.kind === kind && r.file === file)) return;
            refs.push({ kind, file });
        };
        if (Array.isArray(clip.items)) {
            for (const item of clip.items) {
                if (typeof item === "string") add("image", item);
                else if (item && typeof item === "object") {
                    add(item.kind || "image", item.file || item.src);
                }
            }
        }
        if (!refs.length) {
            const source = clip.source && typeof clip.source === "object" ? clip.source : {};
            const kind = isAudio ? "audio" : (clipType === "video" || source.kind === "video" ? "video" : "image");
            add(kind, source.file || clip.start_image || clip.audio_file || clip.src);
        }
        if (!isAudio) add("image", clip.end_image);
        return refs;
    }

    _stripLegacyClipFiles(clip) {
        if (clip.source && typeof clip.source === "object") {
            const source = {};
            if (clip.source.in_ms != null) source.in_ms = clip.source.in_ms;
            if (clip.source.out_ms != null) source.out_ms = clip.source.out_ms;
            if (clip.source.duration_ms != null) source.duration_ms = clip.source.duration_ms;
            if (Object.keys(source).length) clip.source = source;
            else delete clip.source;
        }
        delete clip.items;
        delete clip.end_image;
        delete clip.start_image;
        delete clip.audio_file;
        if (clip.type !== "audio") clip.type = "clip";
    }

    _migrateProjectSchema1To2(project) {
        this._hydrateMediaCatalog(project);
    }

    _applyMediaCatalogFromProject(project) {
        this._projectResources = Array.isArray(project?.media)
            ? project.media.filter((row) => row && row.file && row.kind).map((row) => ({
                ...row,
                kind: mediaKindFromFilename(row.file, row.kind),
            }))
            : [];
        this._imgFiles = [];
        this._videoFiles = [];
        this._audioFiles = [];
        for (const resource of this._projectResources) {
            const file = String(resource.file || "").trim();
            const kind = mediaKindFromFilename(file, resource.kind);
            if (!kind || !file) continue;
            resource.kind = kind;
            const list = kind === "audio" ? this._audioFiles : kind === "video" ? this._videoFiles : this._imgFiles;
            if (!list.includes(file)) list.push(file);
            if (resource.location) this._mediaStatus.set(`${kind}:${file}`, { location: resource.location });
        }
    }

    _jsonClipMediaRows(clip) {
        const ids = Array.isArray(clip?.media_ids) ? clip.media_ids : [];
        const fromIds = ids.map((id) => this._findMediaById(id)).filter(Boolean);
        if (fromIds.length) return fromIds;
        const items = Array.isArray(clip?.items) ? clip.items.map(normalizeClipItem).filter(Boolean) : [];
        const rows = [];
        for (const item of items) {
            const media = (item.id && this._findMediaById(item.id))
                || this._ensureMedia(item.kind, item.file);
            if (media) rows.push(media);
        }
        if (rows.length) return rows;
        const fallback = String(clip?.start_image || clip?.src || clip?.audio_file || "").trim();
        if (fallback) {
            const kind = clip?.clip_type === "audio" || clip?.type === "audio"
                ? "audio"
                : (clip?.clip_type === "video" || clip?.type === "video" ? "video" : "image");
            const media = this._ensureMedia(kind, fallback);
            if (media) rows.push(media);
        }
        const endImage = String(clip?.end_image || "").trim();
        if (endImage && endImage !== fallback) {
            const media = this._ensureMedia("image", endImage);
            if (media) rows.push(media);
        }
        return rows;
    }

    _clipsFromProjectTracks(project, fps) {
        const clips = [];
        const projectTracks = Array.isArray(project?.tracks) ? project.tracks : [];
        projectTracks.forEach((track, trackIndex) => {
            const trackType = String(track?.type || "visual").toLowerCase();
            for (const clip of Array.isArray(track.clips) ? track.clips : []) {
                if (!clip || typeof clip !== "object") continue;
                const source = clip.source && typeof clip.source === "object" ? clip.source : {};
                const mediaRows = this._jsonClipMediaRows(clip);
                const isAudio = clip.type === "audio" || trackType === "audio";
                const isVoiceover = !isAudio && (
                    clip.type === "voiceover" || trackType === "voiceover"
                );
                const isSubtitle = !isAudio && !isVoiceover && (
                    clip.type === "subtitle"
                    || trackType === "subtitle"
                    || trackType === "text"
                );
                const first = mediaRows[0];
                const startMs = Number(clip.start_ms) || 0;
                const durationMs = Number(clip.duration_ms);
                const legacyEndMs = Number(clip.end_ms);
                const { startTime, duration } = decodeClipTimingSecs(
                    startMs,
                    durationMs,
                    Number.isFinite(legacyEndMs) ? legacyEndMs : null,
                    fps,
                );
                const startMsOut = Math.round(startTime * 1000);
                const durationMsOut = Math.max(1, Math.round(duration * 1000));
                clips.push({
                    ...clip,
                    clip_type: isAudio
                        ? "audio"
                        : isVoiceover
                            ? "voiceover"
                            : isSubtitle
                                ? "subtitle"
                                : "clip",
                    track: trackIndex,
                    start_ms: startMsOut,
                    duration_ms: durationMsOut,
                    end_ms: startMsOut + durationMsOut,
                    items: isAudio || isVoiceover || isSubtitle
                        ? []
                        : mediaRows
                            .filter((row) => row.kind !== "audio")
                            .map((row) => ({ id: row.id, kind: row.kind, file: row.file })),
                    start_image: isAudio || isVoiceover || isSubtitle ? null : (first?.file || null),
                    audio_file: isAudio ? (first?.file || null) : null,
                    text: isSubtitle ? String(clip.text ?? clip.name ?? "") : undefined,
                    source_duration: (
                        Number(source.duration_ms) > 0
                            ? Number(source.duration_ms)
                            : Math.max(durationMsOut, Number(source.out_ms) - Number(source.in_ms) || 0)
                    ) / 1000,
                    trim_in: Math.max(0, Number(source.in_ms) || 0) / 1000,
                    disabled: clip.enabled === false,
                });
            }
        });
        return clips;
    }

    _clipMediaIds(meta, clip) {
        if (Array.isArray(meta?.mediaIds) && meta.mediaIds.length) return meta.mediaIds.map(String);
        return this._clipItems(meta).map((item) => item.id).filter(Boolean);
    }

    _loadMediaStarsForDir() {
        try {
            const all = JSON.parse(localStorage.getItem(STORAGE_MEDIA_STARS) || "{}");
            const bucket = all[MEDIA_STARS_BUCKET];
            this._mediaStarsByDir = bucket && typeof bucket === "object" ? { ...bucket } : {};
        } catch {
            this._mediaStarsByDir = {};
        }
    }

    _saveMediaStarsForDir() {
        try {
            const all = JSON.parse(localStorage.getItem(STORAGE_MEDIA_STARS) || "{}");
            if (!Object.keys(this._mediaStarsByDir).length) delete all[MEDIA_STARS_BUCKET];
            else all[MEDIA_STARS_BUCKET] = this._mediaStarsByDir;
            localStorage.setItem(STORAGE_MEDIA_STARS, JSON.stringify(all));
        } catch { /* ignore */ }
    }

    _getMediaStars(kind, file) {
        const meta = this._getMediaMeta(kind, file);
        return meta.stars;
    }

    _setMediaStars(kind, file, stars) {
        const meta = this._getMediaMeta(kind, file);
        const n = Number(stars);
        if (Number.isFinite(n) && n >= 1 && n <= 5) meta.stars = n;
        else delete meta.stars;
        this._writeMediaMeta(kind, file, meta);
    }

    _parseMediaMeta(raw) {
        if (typeof raw === "number") {
            return Number.isFinite(raw) && raw >= 1 && raw <= 5 ? { stars: raw } : {};
        }
        if (!raw || typeof raw !== "object") return {};
        const out = {};
        const stars = Number(raw.stars);
        if (Number.isFinite(stars) && stars >= 1 && stars <= 5) out.stars = stars;
        if (typeof raw.prompt === "string") out.prompt = raw.prompt;
        if (typeof raw.generationPrompt === "string") out.generationPrompt = raw.generationPrompt;
        else if (typeof raw.generation_prompt === "string") out.generationPrompt = raw.generation_prompt;
        if (typeof raw.settingDescription === "string") out.settingDescription = raw.settingDescription;
        else if (typeof raw.setting_description === "string") out.settingDescription = raw.setting_description;
        if (typeof raw.mediaType === "string") out.mediaType = raw.mediaType.trim();
        if (typeof raw.mediaTypeCustom === "string") out.mediaTypeCustom = raw.mediaTypeCustom;
        if (Array.isArray(raw.tags)) {
            out.tags = raw.tags.map((t) => String(t || "").trim()).filter(Boolean);
        }
        return out;
    }

    _getMediaMeta(kind, file) {
        const row = this._findMedia(kind, file);
        if (row) {
            return {
                stars: Number.isFinite(Number(row.stars)) ? Number(row.stars) : undefined,
                prompt: String(row.prompt || ""),
                generationPrompt: String(row.generation_prompt || ""),
                settingDescription: String(row.setting_description || ""),
                mediaType: String(row.media_type || "").trim(),
                tags: Array.isArray(row.tags) ? [...row.tags] : [],
            };
        }
        return this._parseMediaMeta(this._mediaStarsByDir?.[this._mediaStarsId(kind, file)]);
    }

    _writeMediaMeta(kind, file, meta) {
        const next = this._parseMediaMeta(meta);
        const row = this._ensureMedia(kind, file);
        if (row) {
            row.prompt = next.prompt || "";
            row.generation_prompt = next.generationPrompt || "";
            row.setting_description = next.settingDescription || "";
            row.media_type = next.mediaType || "";
            row.tags = Array.isArray(next.tags) ? [...next.tags] : [];
            if (next.stars) row.stars = next.stars;
            else delete row.stars;
        }
        const id = this._mediaStarsId(kind, file);
        if (!next.stars && !next.prompt && !next.generationPrompt && !next.settingDescription && !next.mediaType && !(next.tags?.length)) {
            delete this._mediaStarsByDir[id];
        } else {
            this._mediaStarsByDir[id] = next;
        }
        this._saveMediaStarsForDir();
    }

    _parseTagList(text) {
        return String(text || "")
            .split(/[,，;；]/)
            .map((t) => t.trim())
            .filter(Boolean);
    }

    _mediaTypeLabel(id) {
        return MEDIA_ASSET_TYPES.find((t) => t.id === id)?.label || id || "";
    }

    _clipRoleLabel(id, custom = "") {
        if (id === "other") return String(custom || "").trim() || T("clip_role_other");
        return CLIP_ROLES.find((r) => r.id === id)?.label || T("clip_role_multi_ref");
    }

    _knownClipRole(id) {
        return CLIP_ROLES.some((r) => r.id === id) ? id : "multi_ref";
    }

    _knownClipAgent(id) {
        return CLIP_AGENTS.some((a) => a.id === id) ? id : "MiniMaxH3";
    }

    _clipItems(meta) {
        const raw = Array.isArray(meta?.items)
            ? meta.items
            : (Array.isArray(meta?.mediaIds) ? meta.mediaIds : []);
        return raw.map((item) => {
            if (typeof item === "string") {
                const media = this._findMediaById(item);
                return media
                    ? { id: media.id, kind: media.kind, file: media.file, useMediaPrompt: true, enabled: true }
                    : null;
            }
            const parsed = normalizeClipItem(item);
            if (!parsed) return null;
            const media = (parsed.id && this._findMediaById(parsed.id))
                || this._findMedia(parsed.kind, parsed.file);
            const useMediaPrompt = parsed.useMediaPrompt !== false;
            const enabled = parsed.enabled !== false;
            if (media) return { id: media.id, kind: media.kind, file: media.file, useMediaPrompt, enabled };
            if (!parsed.file) return null;
            const created = this._ensureMedia(parsed.kind, parsed.file);
            return created
                ? { id: created.id, kind: created.kind, file: created.file, useMediaPrompt, enabled }
                : { ...parsed, useMediaPrompt, enabled };
        }).filter(Boolean);
    }

    _enabledClipItems(meta) {
        return this._clipItems(meta).filter((item) => item.enabled !== false);
    }

    _clipGeneratedVideos(meta) {
        const raw = Array.isArray(meta?.generatedVideos) ? meta.generatedVideos : [];
        return raw.map(normalizeGeneratedVideo).filter(Boolean);
    }

    _firstEnabledGeneratedVideo(meta) {
        return this._clipGeneratedVideos(meta).find((row) => row.enabled) || null;
    }

    _clipUsesGeneratedPreview(meta) {
        return meta?.previewMode === "generated" && !!this._firstEnabledGeneratedVideo(meta);
    }

    _genEffectiveDurationSec(gen) {
        if (!gen) return null;
        const tin = Math.max(0, Number(gen.trim_in_sec) || 0);
        const full = Number(gen.duration_sec);
        let tout = gen.trim_out_sec == null ? null : Number(gen.trim_out_sec);
        if (!(Number.isFinite(tout) && tout > tin)) {
            tout = Number.isFinite(full) && full > tin ? full : null;
        }
        if (tout != null && tout > tin) return tout - tin;
        return null;
    }

    _ensureResourceDuration(clip, meta) {
        const m = meta || this._ensureClipMeta(clip);
        const cur = Number(m.resourceDurationSec);
        if (!(Number.isFinite(cur) && cur > 0)) {
            m.resourceDurationSec = Math.max(0.05, Number(clip.duration) || 0.05);
        }
        return m.resourceDurationSec;
    }

    _ensureResourceStart(clip, meta) {
        const m = meta || this._ensureClipMeta(clip);
        const cur = Number(m.resourceStartSec);
        if (!(Number.isFinite(cur) && cur >= 0)) {
            m.resourceStartSec = Math.max(0, Number(clip.startTime) || 0);
        }
        return m.resourceStartSec;
    }

    /** Push later clips on a track so expanded durations do not overlap (gaps kept). */
    _reflowTrackNoOverlap(track) {
        if (!track?.clips?.length) return;
        const clips = [...track.clips].sort((a, b) => (
            (a.startTime - b.startTime) || String(a.id).localeCompare(String(b.id))
        ));
        let cursor = 0;
        for (const clip of clips) {
            let st = Math.max(0, Number(clip.startTime) || 0);
            if (st < cursor - 1e-6) {
                st = cursor;
                clip.startTime = st;
            }
            const dur = Math.max(0.05, Number(clip.duration) || 0.05);
            cursor = st + dur;
            clip._applyPosition?.();
        }
    }

    _trimGeneratedVideoHead(clip, seconds) {
        if (!(seconds > 0)) return;
        const m = this._ensureClipMeta(clip);
        m.generatedVideos = this._clipGeneratedVideos(m).flatMap((gen) => {
            const start = Math.max(0, Number(gen.edit_start_sec) || 0);
            const cut = Math.max(0, seconds - start);
            const duration = this._genEffectiveDurationSec(gen);
            if (duration > 0 && cut >= duration - 1e-9) return [];
            return [{
                ...gen,
                edit_start_sec: Math.max(0, start - seconds),
                trim_in_sec: Math.max(0, Number(gen.trim_in_sec) || 0) + cut,
            }];
        });
        m.genEditAudios = this._normalizeGenEditAudioDraft(m.genEditAudios).flatMap((audio) => {
            const cut = Math.max(0, seconds - audio.edit_start_sec);
            if (cut >= audio.duration - 1e-9) return [];
            return [{
                ...audio,
                edit_start_sec: Math.max(0, audio.edit_start_sec - seconds),
                source_offset: audio.source_offset + cut,
                duration: audio.duration - cut,
            }];
        });
        this._meta.set(clip.id, m);
    }

    _rememberResourceTiming(clip, meta) {
        if (!clip) return;
        const m = meta || this._ensureClipMeta(clip);
        m.resourceStartSec = Math.max(0, Number(clip.startTime) || 0);
        m.resourceDurationSec = Math.max(0.05, Number(clip.duration) || 0.05);
        this._meta.set(clip.id, m);
    }

    async _probeOutputVideoDuration(file) {
        const url = this._outputVideoUrl(file);
        if (!url) return null;
        return new Promise((resolve) => {
            const video = document.createElement("video");
            video.preload = "metadata";
            video.muted = true;
            const done = (sec) => {
                video.removeAttribute("src");
                try { video.load(); } catch { /* ignore */ }
                resolve(sec);
            };
            video.onloadedmetadata = () => {
                const d = Number(video.duration);
                done(Number.isFinite(d) && d > 0 ? d : null);
            };
            video.onerror = () => done(null);
            video.src = url;
        });
    }

    async _ensureGenVideoDuration(gen) {
        if (!gen?.file) return null;
        const cur = Number(gen.duration_sec);
        if (Number.isFinite(cur) && cur > 0) return cur;
        const dur = await this._probeOutputVideoDuration(gen.file);
        if (dur != null) {
            gen.duration_sec = dur;
            if (gen.trim_out_sec == null) gen.trim_out_sec = dur;
        }
        return gen.duration_sec;
    }

    _setClipPreviewMode(clip, mode, { recordUndo = true, refresh = true } = {}) {
        if (!clip) return false;
        const m = this._ensureClipMeta(clip);
        const gen = this._firstEnabledGeneratedVideo(m);
        const next = mode === "generated" && gen ? "generated" : "media";
        if (m.previewMode === next) return false;
        if (recordUndo) this._recordUndo();
        m.previewMode = next;
        this._meta.set(clip.id, m);
        if (refresh) {
            this._decorateClip(clip);
            this._syncClipPrimaryAppearance(clip, { refreshVideo: true });
            this._scheduleProgramPreview();
            if (this._timeline?._playing) this._startAudioPlayback();
            this._updateEditModeToolbar();
            this._saveToWidgets();
        }
        return true;
    }

    _toggleClipPreviewMode(clip) {
        if (!clip) return;
        const m = this._ensureClipMeta(clip);
        if (!this._firstEnabledGeneratedVideo(m)) return;
        const next = m.previewMode === "generated" ? "media" : "generated";
        this._setClipPreviewMode(clip, next);
    }

    /** Refresh clip decorations / thumbnails from per-clip previewMode. */
    async _applyTimelineEditMode() {
        this.tlHost?.classList.remove("is-gen-edit-mode");
        const jobs = [];
        for (const track of this._allImageTracks()) {
            for (const clip of track.clips) {
                const m = this._ensureClipMeta(clip);
                this._ensureResourceDuration(clip, m);
                this._ensureResourceStart(clip, m);
                if (!this._firstEnabledGeneratedVideo(m) && m.previewMode === "generated") {
                    m.previewMode = "media";
                }
                this._meta.set(clip.id, m);
                const gen = this._clipUsesGeneratedPreview(m)
                    ? this._firstEnabledGeneratedVideo(m)
                    : null;
                if (gen) {
                    jobs.push((async () => {
                        await this._ensureGenVideoDuration(gen);
                        this._decorateClip(clip);
                        this._syncClipPrimaryAppearance(clip, { refreshVideo: true });
                    })());
                } else {
                    this._decorateClip(clip);
                    this._syncClipPrimaryAppearance(clip, { refreshVideo: true });
                }
            }
        }
        if (jobs.length) await Promise.all(jobs);
        this._updateEditModeToolbar();
        this._refreshTimelineDuration();
        this._scheduleProgramPreview();
        if (this._timeline?._playing) this._startAudioPlayback();
    }

    _restoreLinkedTrackResourceStarts() {
        const linked = [
            ...this._allAudioTracks(),
            ...this._allVoiceoverTracks(),
            ...this._allTextTracks(),
        ];
        for (const track of linked) {
            for (const clip of track.clips) {
                const m = this._meta.get(clip.id);
                if (!m) continue;
                const resStart = Number(m.resourceStartSec);
                if (Number.isFinite(resStart) && resStart >= 0) {
                    clip.startTime = resStart;
                    clip._applyPosition?.();
                }
            }
        }
    }

    /**
     * After image clips expand in generated edit mode, push audio/subtitle clips
     * so the whole timeline stays in sync. Time warp is driven by the main track.
     */
    _rippleLinkedTracksFromImageLayout() {
        const main = this._mainTrack;
        const imageClips = [];
        for (const clip of main?.clips ?? []) {
            const m = this._ensureClipMeta(clip);
            const resStart = this._ensureResourceStart(clip, m);
            imageClips.push({
                resStart,
                resEnd: resStart + this._ensureResourceDuration(clip, m),
                outStart: Math.max(0, Number(clip.startTime) || 0),
                outEnd: Math.max(0, Number(clip.startTime) || 0)
                    + Math.max(0.05, Number(clip.duration) || 0.05),
            });
        }
        if (!imageClips.length) return;
        imageClips.sort((a, b) => a.resStart - b.resStart);

        const mapStart = (resT) => {
            let t = Math.max(0, Number(resT) || 0);
            let shift = 0;
            for (const seg of imageClips) {
                if (seg.resEnd <= t + 1e-9) {
                    shift += (seg.outEnd - seg.outStart) - (seg.resEnd - seg.resStart);
                    continue;
                }
                if (seg.resStart <= t && t < seg.resEnd) {
                    const local = t - seg.resStart;
                    const resDur = Math.max(1e-6, seg.resEnd - seg.resStart);
                    const outDur = Math.max(0.05, seg.outEnd - seg.outStart);
                    return seg.outStart + (local / resDur) * outDur;
                }
                break;
            }
            return t + shift;
        };

        const linked = [
            ...this._allAudioTracks(),
            ...this._allVoiceoverTracks(),
            ...this._allTextTracks(),
        ];
        for (const track of linked) {
            for (const clip of track.clips) {
                const m = this._meta.get(clip.id);
                const resStart = Number.isFinite(Number(m?.resourceStartSec))
                    ? Number(m.resourceStartSec)
                    : Math.max(0, Number(clip.startTime) || 0);
                if (m) {
                    if (!(Number.isFinite(Number(m.resourceStartSec)) && m.resourceStartSec >= 0)) {
                        m.resourceStartSec = resStart;
                    }
                    if (!(Number.isFinite(Number(m.resourceDurationSec)) && m.resourceDurationSec > 0)) {
                        m.resourceDurationSec = Math.max(0.05, Number(clip.duration) || 0.05);
                    }
                    this._meta.set(clip.id, m);
                }
                clip.startTime = mapStart(resStart);
                clip._applyPosition?.();
            }
            this._reflowTrackNoOverlap(track);
        }
    }

    _syncGenTrimFromClip(_clip) {
        // Main-timeline resize no longer writes gen trim (see gen-edit modal).
    }

    _updateEditModeToolbar() {
        if (this.insertClipBtn) {
            this.insertClipBtn.disabled = false;
            this.insertClipBtn.title = T("insert_empty_clip_title");
        }
        if (this.runMenuBtn) {
            this.runMenuBtn.disabled = false;
            this.runMenuBtn.title = T("run_menu_title");
        }
        const modeBtn = this.editModeBtn;
        if (modeBtn) {
            const active = this._allGeneratedPreviewActive();
            const hasTargets = this._clipsWithEnabledGeneratedVideo().length > 0;
            modeBtn.disabled = !hasTargets;
            modeBtn.classList.toggle("is-active", active);
            modeBtn.innerHTML = iconHtml(active ? "videoOff" : "video", 14);
            modeBtn.title = active
                ? T("edit_mode_back_to_resource_title")
                : T("edit_mode_switch_to_generated_title");
        }
    }

    _updateAllGeneratedPreviewButton() {
        this._updateEditModeToolbar();
    }

    _toggleAllGeneratedPreview() {
        const targets = this._clipsWithEnabledGeneratedVideo();
        if (!targets.length) return;
        const next = this._allGeneratedPreviewActive() ? "media" : "generated";
        this._recordUndo();
        for (const { clip, meta } of targets) {
            meta.previewMode = next;
            this._meta.set(clip.id, meta);
            this._decorateClip(clip);
            this._syncClipPrimaryAppearance(clip, { refreshVideo: true });
        }
        this._updateEditModeToolbar();
        this._scheduleProgramPreview();
        if (this._timeline?._playing) this._startAudioPlayback();
        this._saveToWidgets();
    }

    _allGeneratedPreviewActive() {
        const targets = this._clipsWithEnabledGeneratedVideo();
        return targets.length > 0 && targets.every(({ meta }) => meta.previewMode === "generated");
    }

    _generatedVideosFromJson(clip) {
        const raw = Array.isArray(clip?.generated_videos) ? clip.generated_videos : [];
        return raw.map(normalizeGeneratedVideo).filter(Boolean);
    }

    _previewModeFromJson(clip) {
        return clip?.preview_mode === "generated" ? "generated" : "media";
    }

    _bindExecutionWatch() {
        if (this._execWatchBound || !api?.addEventListener) return;
        this._execWatchBound = true;
        this._onExecuted = (e) => this._onPromptExecuted(e);
        this._onExecSuccess = (e) => this._flushPendingGeneratedVideos(e);
        this._onExecAbort = (e) => this._abortPendingGeneratedJob(e);
        this._onExecStart = (e) => this._onExecutionStart(e);
        this._onProgress = (e) => this._onRunProgress(e);
        this._onProgressState = (e) => this._onRunProgressState(e);
        this._onQueueStatus = (e) => this._onQueueStatusEvent(e);
        this._onTeClipRunning = (e) => this._onTimelineClipRunning(e);
        this._onTeVideoSaved = (e) => this._onTimelineVideoSaved(e);
        this._onKjPreviewOverride = (e) => this._onKjPreviewOverrideEvent(e);
        this._onTimelinePreview = (e) => this._onTimelinePreviewEvent(e);
        api.addEventListener("executed", this._onExecuted);
        api.addEventListener("execution_success", this._onExecSuccess);
        api.addEventListener("execution_error", this._onExecAbort);
        api.addEventListener("execution_interrupted", this._onExecAbort);
        api.addEventListener("execution_start", this._onExecStart);
        api.addEventListener("progress", this._onProgress);
        api.addEventListener("progress_state", this._onProgressState);
        api.addEventListener("status", this._onQueueStatus);
        api.addEventListener("cat_te_clip_running", this._onTeClipRunning);
        api.addEventListener("cat_te_video_saved", this._onTeVideoSaved);
        api.addEventListener("kj_preview_override", this._onKjPreviewOverride);
        api.addEventListener("cap_timeline_preview", this._onTimelinePreview);
    }

    _unbindExecutionWatch() {
        if (!this._execWatchBound) return;
        this._execWatchBound = false;
        api.removeEventListener?.("executed", this._onExecuted);
        api.removeEventListener?.("execution_success", this._onExecSuccess);
        api.removeEventListener?.("execution_error", this._onExecAbort);
        api.removeEventListener?.("execution_interrupted", this._onExecAbort);
        api.removeEventListener?.("execution_start", this._onExecStart);
        api.removeEventListener?.("progress", this._onProgress);
        api.removeEventListener?.("progress_state", this._onProgressState);
        api.removeEventListener?.("status", this._onQueueStatus);
        api.removeEventListener?.("cat_te_clip_running", this._onTeClipRunning);
        api.removeEventListener?.("cat_te_video_saved", this._onTeVideoSaved);
        api.removeEventListener?.("kj_preview_override", this._onKjPreviewOverride);
        api.removeEventListener?.("cap_timeline_preview", this._onTimelinePreview);
        if (this._queueReconcileTimer) {
            clearTimeout(this._queueReconcileTimer);
            this._queueReconcileTimer = 0;
        }
        this._onExecuted = null;
        this._onExecSuccess = null;
        this._onExecAbort = null;
        this._onExecStart = null;
        this._onProgress = null;
        this._onProgressState = null;
        this._onQueueStatus = null;
        this._onTeClipRunning = null;
        this._onTeVideoSaved = null;
        this._onKjPreviewOverride = null;
        this._onTimelinePreview = null;
    }

    _promptIdFromQueueResult(result) {
        if (!result || typeof result !== "object") return null;
        const id = result.prompt_id ?? result.promptId;
        const s = String(id || "").trim();
        return s || null;
    }

    _promptIdFromEvent(e) {
        const detail = e?.detail;
        if (!detail || typeof detail !== "object") return null;
        const id = detail.prompt_id ?? detail.promptId;
        const s = String(id || "").trim();
        return s || null;
    }

    _findPendingGeneratedJob(promptId) {
        const jobs = this._pendingGeneratedJobs;
        if (!jobs?.length) return null;
        if (promptId) {
            const hit = jobs.find((j) => j.promptId === promptId);
            if (hit) return hit;
            // Do not steal a job that is already bound to another prompt.
            return jobs.find((j) => !j.promptId) || null;
        }
        return jobs.find((j) => !j.promptId) || null;
    }

    _takePendingGeneratedJob(promptId) {
        const jobs = this._pendingGeneratedJobs;
        if (!jobs?.length) return null;
        let idx = -1;
        if (promptId) {
            idx = jobs.findIndex((j) => j.promptId === promptId);
            if (idx < 0) idx = jobs.findIndex((j) => !j.promptId);
        } else {
            idx = jobs.findIndex((j) => !j.promptId);
        }
        if (idx < 0) return null;
        return jobs.splice(idx, 1)[0] || null;
    }

    _abortPendingGeneratedJob(e) {
        const promptId = this._promptIdFromEvent(e);
        if (promptId && promptId === this._modelPreviewPromptId) {
            this._finishModelPreview(T("model_preview_stopped"));
            return;
        }
        let droppedStamp = null;
        const droppedIds = [];
        if (promptId) {
            const dropped = this._pendingGeneratedJobs.filter((j) => j.promptId === promptId);
            droppedStamp = dropped[0]?.stamp || null;
            for (const j of dropped) {
                if (j?.clipId != null) droppedIds.push(j.clipId);
            }
            this._pendingGeneratedJobs = this._pendingGeneratedJobs.filter(
                (j) => j.promptId !== promptId,
            );
        } else {
            // Interrupt / error without id: drop the oldest unmatched job only.
            const idx = this._pendingGeneratedJobs.findIndex((j) => !j.promptId);
            if (idx >= 0) {
                droppedStamp = this._pendingGeneratedJobs[idx]?.stamp || null;
                if (this._pendingGeneratedJobs[idx]?.clipId != null) {
                    droppedIds.push(this._pendingGeneratedJobs[idx].clipId);
                }
                this._pendingGeneratedJobs.splice(idx, 1);
            }
        }
        if (this._runningClipId != null) droppedIds.push(this._runningClipId);
        this._clearRunningForPrompt(promptId);
        for (const id of droppedIds) this._clearRunPreview(id);
        if (droppedStamp) this._maybeClearGenVideoStamp(droppedStamp);
        this._syncClipRunDecorations();
    }

    /**
     * Queue UI delete/clear does not emit execution_interrupted — only status.
     * Reconcile pending clip jobs against the live Comfy queue.
     */
    _onQueueStatusEvent(e) {
        if (this._destroyed) return;
        if (!this._pendingGeneratedJobs.length && !this._runningPromptId) return;
        const remaining = Number(e?.detail?.exec_info?.queue_remaining);
        if (remaining === 0) {
            if (this._queueReconcileTimer) {
                clearTimeout(this._queueReconcileTimer);
                this._queueReconcileTimer = 0;
            }
            this._pendingGeneratedJobs = [];
            this._clearRunningForPrompt(this._runningPromptId);
            this._clearAllRunPreviews();
            this._genVideoStamp = null;
            this._syncClipRunDecorations();
            return;
        }
        this._schedulePendingJobsQueueReconcile();
    }

    _schedulePendingJobsQueueReconcile() {
        if (this._queueReconcileTimer) return;
        this._queueReconcileTimer = setTimeout(() => {
            this._queueReconcileTimer = 0;
            void this._reconcilePendingJobsWithQueue();
        }, 60);
    }

    async _reconcilePendingJobsWithQueue() {
        if (this._destroyed) return;
        if (!this._pendingGeneratedJobs.length && !this._runningPromptId) return;
        if (typeof api?.fetchApi !== "function") return;
        let data = null;
        try {
            const res = await api.fetchApi("/queue");
            data = await res.json();
        } catch {
            return;
        }
        if (this._destroyed) return;
        const liveIds = new Set();
        for (const row of [...(data?.queue_running || []), ...(data?.queue_pending || [])]) {
            const pid = row?.[1];
            if (pid != null && String(pid)) liveIds.add(String(pid));
        }
        const beforeLen = this._pendingGeneratedJobs.length;
        const beforeRun = this._runningClipId;
        const beforeIds = new Set(this._pendingGeneratedJobs.map((j) => String(j.clipId)));

        // Only drop jobs whose promptId is known and no longer in the live queue.
        // Do NOT invent promptId bindings from unrelated queue items — that mis-associates
        // generated videos onto the wrong clip.
        let kept = this._pendingGeneratedJobs.filter((j) => {
            if (!j.promptId) return true;
            return liveIds.has(String(j.promptId));
        });
        // Unbound jobs may only remain while the live queue still has unmatched slots.
        const bound = kept.filter((j) => j.promptId).length;
        let nullSlots = Math.max(0, liveIds.size - bound);
        kept = kept.filter((j) => {
            if (j.promptId) return true;
            if (nullSlots > 0) {
                nullSlots -= 1;
                return true;
            }
            return false;
        });
        this._pendingGeneratedJobs = kept;
        const keptIds = new Set(kept.map((j) => String(j.clipId)));
        for (const id of beforeIds) {
            if (!keptIds.has(id)) this._clearRunPreview(id);
        }
        if (this._runningPromptId && !liveIds.has(String(this._runningPromptId))) {
            this._clearRunningForPrompt(this._runningPromptId);
        } else if (
            this._runningClipId != null
            && !kept.some((j) => String(j.clipId) === String(this._runningClipId))
            && !(this._runningPromptId && liveIds.has(String(this._runningPromptId)))
        ) {
            this._clearRunningForPrompt(this._runningPromptId);
        }
        if (beforeLen !== kept.length || beforeRun !== this._runningClipId) {
            this._syncClipRunDecorations();
        }
    }

    _bindPromptIdToPendingJob(promptId, preferredClipId = null) {
        const pid = String(promptId || "").trim();
        if (!pid) return null;
        let job = this._pendingGeneratedJobs.find((j) => j.promptId === pid);
        if (!job && preferredClipId != null) {
            job = this._pendingGeneratedJobs.find(
                (j) => !j.promptId && String(j.clipId) === String(preferredClipId),
            );
        }
        if (!job) job = this._pendingGeneratedJobs.find((j) => !j.promptId);
        if (!job) return null;
        job.promptId = pid;
        if (this._runningPromptId === pid || !this._runningPromptId) {
            // execution_start may have already fired; or bind eagerly from queue result.
            if (!this._runningPromptId) this._runningPromptId = pid;
            this._runningClipId = job.clipId ?? null;
            this._syncClipRunDecorations();
        }
        return job;
    }

    _onExecutionStart(e) {
        if (this._destroyed || !this._isNodeOnLiveGraph()) return;
        const promptId = this._promptIdFromEvent(e);
        if (promptId && promptId === this._modelPreviewPromptId) {
            this._modelPreviewRunning = true;
            this._renderModelPreview(this._modelPreviewEntry, T("model_preview_running"));
            return;
        }
        // Keep prompt id even when the pending list races behind queuePrompt.
        if (promptId) this._runningPromptId = promptId;
        let job = null;
        if (promptId) {
            job = this._pendingGeneratedJobs.find((j) => j.promptId === promptId);
            if (!job) {
                // app.queuePrompt often returns without prompt_id — bind FIFO.
                job = this._pendingGeneratedJobs.find((j) => !j.promptId);
                if (job) job.promptId = promptId;
            }
        } else {
            job = this._pendingGeneratedJobs.find((j) => !j.promptId)
                || this._pendingGeneratedJobs[0]
                || null;
            if (job?.promptId) this._runningPromptId = job.promptId;
        }
        this._runningClipId = job?.clipId ?? null;
        this._runningProgress = 0;
        this._syncClipRunDecorations();
    }

    /**
     * For-loop / batch: Data Json Clip Parser emits which timeline clip is starting.
     * Prefer this over prompt_id FIFO — one prompt can run many clips.
     */
    _onTimelineClipRunning(e) {
        if (this._destroyed || !this._isNodeOnLiveGraph()) return;
        const d = e?.detail;
        if (!d || typeof d !== "object") return;
        const clipId = String(d.clip_id || "").trim();
        if (!clipId || !this._teNotifyBelongsHere(clipId, null)) return;
        const promptId = String(d.prompt_id ?? d.promptId ?? "").trim();
        const job = this._pendingGeneratedJobs.find((j) => String(j.clipId) === clipId);
        if (job && promptId && !job.promptId) job.promptId = promptId;
        if (promptId) this._runningPromptId = promptId;
        const prevClip = this._runningClipId;
        this._runningClipId = clipId;
        this._runningProgress = 0;
        if (prevClip != null && String(prevClip) !== clipId) this._clearRunPreview(prevClip);
        this._syncClipRunDecorations();
    }

    /**
     * Seq To Video finished one file — attach immediately (do not wait for prompt success).
     */
    _onTimelineVideoSaved(e) {
        if (this._destroyed || !this._isNodeOnLiveGraph()) return;
        const d = e?.detail;
        if (!d || typeof d !== "object") return;
        let file = normalizeOutputVideoPath(d.file);
        if (!file) {
            const name = d.filename || d.file;
            if (name) {
                const sub = String(d.subfolder || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
                file = normalizeOutputVideoPath(sub ? `${sub}/${name}` : name);
            }
        }
        if (!file) return;

        let clipId = String(d.clip_id || "").trim()
            || this._clipIdFromSpecifiedVideoPath(file)
            || "";
        if (!clipId) {
            const expected = file;
            const job = this._pendingGeneratedJobs.find(
                (j) => j.expectedFile && normalizeOutputVideoPath(j.expectedFile) === expected,
            );
            clipId = job?.clipId ? String(job.clipId) : "";
        }
        if (!clipId || !this._teNotifyBelongsHere(clipId, file)) return;

        const idx = this._pendingGeneratedJobs.findIndex((j) => String(j.clipId) === clipId);
        let stamp = null;
        if (idx >= 0) {
            stamp = this._pendingGeneratedJobs[idx]?.stamp || null;
            this._pendingGeneratedJobs.splice(idx, 1);
        }
        if (this._runningClipId != null && String(this._runningClipId) === clipId) {
            this._runningClipId = null;
            this._runningProgress = 0;
        }
        this._clearRunPreview(clipId);
        this._syncClipRunDecorations();
        this._persistGeneratedVideosToProjectJson(clipId, [file]);
        if (!this._timeline || !this._timelineReady) {
            this._deferredGeneratedJobs.push({ clipId, files: [file] });
        } else {
            this._attachGeneratedVideos(clipId, [file]);
        }
        if (stamp) this._maybeClearGenVideoStamp(stamp);
    }

    _clearRunningForPrompt(promptId) {
        if (promptId && this._runningPromptId && this._runningPromptId !== promptId) return;
        const wasClip = this._runningClipId;
        this._runningPromptId = null;
        this._runningClipId = null;
        this._runningProgress = 0;
        if (wasClip != null) this._clearRunPreview(wasClip);
    }

    _b64ToBlob(b64, mime) {
        const bin = atob(b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return new Blob([arr], { type: mime || "application/octet-stream" });
    }

    _runPreviewKey(clipId) {
        return `__run__:${String(clipId)}`;
    }

    _clearRunPreview(clipId) {
        if (clipId == null || !this._runPreviewByClipId) return;
        const key = String(clipId);
        const prev = this._runPreviewByClipId.get(key);
        if (!prev) return;
        this._runPreviewByClipId.delete(key);
        if (prev.url) {
            try { URL.revokeObjectURL(prev.url); } catch { /* ignore */ }
        }
        if (this._resourceGenPreview?.clipId != null
            && String(this._resourceGenPreview.clipId) === key
            && String(this._resourceGenPreview.file || "") === this._runPreviewKey(key)) {
            this._stopResourceGenProgramPreview();
        }
    }

    _clearAllRunPreviews() {
        if (!this._runPreviewByClipId?.size) return;
        for (const id of [...this._runPreviewByClipId.keys()]) this._clearRunPreview(id);
    }

    _renderModelPreview(entry = this._modelPreviewEntry, status = "") {
        if (!this.aiPreviewPanel) return;
        this.aiPreviewPanel.hidden = false;
        if (this.aiPreviewStatus) this.aiPreviewStatus.textContent = status;
        this.aiPreviewVideo?.pause();
        if (this.aiPreviewVideo) {
            this.aiPreviewVideo.hidden = true;
            this.aiPreviewVideo.removeAttribute("src");
            this.aiPreviewVideo.load();
        }
        if (this.aiPreviewImage) {
            this.aiPreviewImage.hidden = true;
            this.aiPreviewImage.removeAttribute("src");
        }
        if (entry?.url && entry.mime === "video/mp4" && this.aiPreviewVideo) {
            this.aiPreviewVideo.src = entry.url;
            this.aiPreviewVideo.hidden = false;
            void this.aiPreviewVideo.play().catch(() => {});
        } else if (entry?.url && this.aiPreviewImage) {
            this.aiPreviewImage.src = entry.url;
            this.aiPreviewImage.hidden = false;
        }
        if (this.aiPreviewEmpty) {
            this.aiPreviewEmpty.hidden = !!entry?.url;
            this.aiPreviewEmpty.textContent = entry?.url ? "" : (status || T("model_preview_waiting"));
        }
    }

    _syncModelPreviewButton() {
        if (!this.aiPreviewBtn) return;
        const active = !!this._modelPreviewPromptId;
        this.aiPreviewBtn.classList.toggle("is-running", active);
        this.aiPreviewBtn.innerHTML = active
            ? `${iconHtml("stop", 12)}<span>${T("stop_preview_btn")}</span>`
            : `${iconHtml("eye", 12)}<span>${T("preview_btn")}</span>`;
    }

    _replaceModelPreviewTokens(value, values) {
        if (Array.isArray(value)) return value.map((item) => this._replaceModelPreviewTokens(item, values));
        if (value && typeof value === "object") {
            return Object.fromEntries(Object.entries(value).map(([key, item]) => [
                key,
                this._replaceModelPreviewTokens(item, values),
            ]));
        }
        if (typeof value !== "string") return value;
        const exact = /^\{\{([a-z0-9_]+)\}\}$/i.exec(value);
        if (exact && Object.hasOwn(values, exact[1])) return values[exact[1]];
        return value.replace(/\{\{([a-z0-9_]+)\}\}/gi, (match, key) => (
            Object.hasOwn(values, key) ? String(values[key]) : match
        ));
    }

    async _startModelPreview() {
        const clip = this._findClipById(this._aiOptimizeClipId);
        if (!clip || this._modelPreviewPromptId) return;
        let workflow;
        try {
            workflow = JSON.parse(localStorage.getItem(STORAGE_MODEL_PREVIEW_WORKFLOW) || "");
        } catch {
            workflow = null;
        }
        if (!workflow) {
            this._renderModelPreview(null, T("model_preview_config_required"));
            return;
        }
        if (!Object.values(workflow).some((node) => node?.class_type === "CAP_TimelinePreview")) {
            this._renderModelPreview(null, T("model_preview_override_required"));
            return;
        }
        const meta = this._ensureClipMeta(clip);
        if (this._normalizeClipSeed(meta.seed) < 0) {
            meta.seed = this._randomClipSeed();
            this._meta.set(clip.id, meta);
            if (this._selClip?.id === clip.id && this.clipSeedInput) {
                this.clipSeedInput.value = String(meta.seed);
            }
            this._saveToWidgets();
        }
        const files = this._clipAiOptimizeFiles(clip);
        const values = {
            prompt: this._composeFinalPrompt(clip, meta),
            seed: meta.seed,
            duration: Number(clip.duration) || 0,
            context: this._clampH3MotionContextLength(meta.h3MotionContextLength),
            width: Number(this._w("width")?.value ?? PY_SCALAR_DEFAULTS.width),
            height: Number(this._w("height")?.value ?? PY_SCALAR_DEFAULTS.height),
            fps: Number(this._w("fps")?.value ?? 24),
            model: localStorage.getItem(STORAGE_MODEL_PREVIEW_MODEL) || "",
        };
        files.forEach((file, index) => {
            values[`media_${index + 1}`] = file.file;
            if (file.kind === "image") values[`image_${index + 1}`] = file.file;
            if (file.kind === "video") values[`video_${index + 1}`] = file.file;
        });
        this._saveToWidgets();
        const projectValue = this._w("project_json")?.value;
        const projectJson = typeof projectValue === "string"
            ? projectValue
            : JSON.stringify(projectValue || {});
        const prompt = this._replaceModelPreviewTokens(workflow, values);
        for (const node of Object.values(prompt)) {
            if (node?.class_type !== "CAP_TimelinePreview") continue;
            node.inputs = {
                ...(node.inputs || {}),
                project_json: projectJson,
                clip_id: String(clip.id),
                width: values.width,
                height: values.height,
                seed: values.seed,
            };
        }
        const requestPromptId = crypto.randomUUID();
        this._modelPreviewClipId = String(clip.id);
        this._modelPreviewPromptId = requestPromptId;
        this._modelPreviewEntry = null;
        this._syncModelPreviewButton();
        this._renderModelPreview(null, T("model_preview_queueing"));
        try {
            const response = await api.fetchApi("/prompt", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    prompt,
                    prompt_id: requestPromptId,
                    client_id: api.clientId || app?.clientId || crypto.randomUUID(),
                }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.error) {
                throw new Error(data?.error?.message || data?.error || `HTTP ${response.status}`);
            }
            const returnedPromptId = String(data.prompt_id || "").trim();
            if (!returnedPromptId) throw new Error(T("model_preview_no_prompt_id"));
            this._modelPreviewPromptId = returnedPromptId;
            this._syncModelPreviewButton();
            this._renderModelPreview(null, T("model_preview_queued"));
        } catch (error) {
            this._modelPreviewPromptId = null;
            this._modelPreviewClipId = null;
            this._syncModelPreviewButton();
            this._renderModelPreview(null, T("model_preview_failed", { msg: error instanceof Error ? error.message : String(error) }));
        }
    }

    async _stopModelPreview() {
        const promptId = this._modelPreviewPromptId;
        if (!promptId) return;
        let status = T("model_preview_stopped");
        try {
            if (this._modelPreviewRunning) await api.interrupt(promptId);
            else if (typeof api.deleteItem === "function") await api.deleteItem("queue", promptId);
            else await api.fetchApi("/queue", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ delete: [promptId] }),
            });
        } catch (error) {
            status = T("model_preview_failed", {
                msg: error instanceof Error ? error.message : String(error),
            });
        } finally {
            this._finishModelPreview(status);
        }
    }

    _finishModelPreview(status) {
        const clipId = this._modelPreviewClipId;
        this._modelPreviewPromptId = null;
        this._modelPreviewClipId = null;
        this._modelPreviewRunning = false;
        this._syncModelPreviewButton();
        if (String(this._aiOptimizeClipId) === String(clipId)) {
            this._renderModelPreview(this._modelPreviewEntry, status);
        }
    }

    _onTimelinePreviewEvent(e) {
        if (this._destroyed || !this._isNodeOnLiveGraph()) return;
        const d = e?.detail;
        const promptId = String(d?.prompt_id || "").trim();
        if (!d || promptId !== String(this._modelPreviewPromptId || "")) return;
        if (typeof d.video !== "string" || d.mime !== "video/mp4") return;
        let blob;
        try {
            blob = this._b64ToBlob(d.video, d.mime);
        } catch {
            return;
        }
        if (this._modelPreviewEntry?.url) {
            try { URL.revokeObjectURL(this._modelPreviewEntry.url); } catch { /* ignore */ }
        }
        this._modelPreviewEntry = {
            url: URL.createObjectURL(blob),
            mime: d.mime,
            clipId: String(d.clip_id || this._modelPreviewClipId || ""),
            step: 0,
            total: 0,
            seed: Number(d.seed),
        };
        this._renderModelPreview(this._modelPreviewEntry, T("model_preview_receiving"));
    }

    /**
     * KJNodes Model Preview Override pushes sampling frames/videos over WS.
     * Attach the latest video/mp4 blob to the running timeline clip for hover preview.
     */
    _onKjPreviewOverrideEvent(e) {
        if (this._destroyed || !this._isNodeOnLiveGraph()) return;
        const d = e?.detail;
        if (!d || typeof d.image !== "string") return;
        const mime = typeof d.mime === "string" ? d.mime : "";
        if (this._modelPreviewRunning && ["image/jpeg", "image/webp", "video/mp4"].includes(mime)) {
            let blob;
            try {
                blob = this._b64ToBlob(d.image, mime);
            } catch {
                return;
            }
            if (this._modelPreviewEntry?.url) {
                try { URL.revokeObjectURL(this._modelPreviewEntry.url); } catch { /* ignore */ }
            }
            this._modelPreviewEntry = {
                url: URL.createObjectURL(blob),
                mime,
                clipId: this._modelPreviewClipId,
                step: Number(d.step) || 0,
                total: Number(d.total) || 0,
            };
            if (String(this._aiOptimizeClipId) === String(this._modelPreviewClipId)) {
                const status = this._modelPreviewEntry.step > 0 && this._modelPreviewEntry.total > 0
                    ? T("model_preview_step", { step: this._modelPreviewEntry.step, total: this._modelPreviewEntry.total })
                    : T("model_preview_receiving");
                this._renderModelPreview(this._modelPreviewEntry, status);
            }
            return;
        }
        if (mime !== "video/mp4") return;

        let clipId = this._runningClipId;
        if (clipId == null && this._runningPromptId) {
            const head = this._pendingGeneratedJobs.find((j) => (
                j.promptId === this._runningPromptId || !j.promptId
            ));
            clipId = head?.clipId ?? null;
        }
        if (clipId == null) return;
        if (this._clipRunState(clipId) !== "running") return;

        let blob;
        try {
            blob = this._b64ToBlob(d.image, mime);
        } catch {
            return;
        }
        const url = URL.createObjectURL(blob);
        const key = String(clipId);
        const prev = this._runPreviewByClipId.get(key);
        if (prev?.url) {
            try { URL.revokeObjectURL(prev.url); } catch { /* ignore */ }
        }
        this._runPreviewByClipId.set(key, { url, mime });

        const clip = this._findClipById(clipId);
        if (clip) this._decorateClip(clip);
        if (clip
            && this._resourceGenPreview?.clipId != null
            && String(this._resourceGenPreview.clipId) === key
            && String(this._resourceGenPreview.file || "") === this._runPreviewKey(key)) {
            this._startResourceGenProgramPreview(clip, this._runPreviewKey(key), url);
        }
    }

    _setRunningProgress(ratio) {
        const next = Math.max(0, Math.min(1, Number(ratio) || 0));
        if (Math.abs(next - this._runningProgress) < 0.002) return;
        this._runningProgress = next;
        // Progress can arrive before we bound a clip id — promote FIFO then.
        if (this._runningClipId == null && this._runningPromptId) {
            this._bindPromptIdToPendingJob(this._runningPromptId);
        }
        const clip = this._findClipById(this._runningClipId);
        if (clip) this._decorateClip(clip);
    }

    _onRunProgress(e) {
        if (this._destroyed) return;
        const d = e?.detail;
        if (!d || typeof d !== "object") return;
        const pid = String(d.prompt_id ?? d.promptId ?? "").trim();
        if (pid && pid === this._modelPreviewPromptId) {
            const max = Number(d.max);
            if (max > 0) this._renderModelPreview(
                this._modelPreviewEntry,
                T("model_preview_progress", { pct: Math.round((Number(d.value) || 0) * 100 / max) }),
            );
            return;
        }
        if (pid) {
            if (this._runningPromptId && this._runningPromptId !== pid) return;
            if (!this._runningPromptId) this._runningPromptId = pid;
            if (this._runningClipId == null) this._bindPromptIdToPendingJob(pid);
        } else if (!this._runningPromptId) {
            return;
        }
        const max = Number(d.max);
        if (!(max > 0)) return;
        this._setRunningProgress(Number(d.value) / max);
    }

    _onRunProgressState(e) {
        if (this._destroyed) return;
        const d = e?.detail;
        if (!d || typeof d !== "object") return;
        const pid = String(d.prompt_id ?? d.promptId ?? "").trim();
        if (pid && pid === this._modelPreviewPromptId) return;
        if (pid) {
            if (this._runningPromptId && this._runningPromptId !== pid) return;
            if (!this._runningPromptId) this._runningPromptId = pid;
            if (this._runningClipId == null) this._bindPromptIdToPendingJob(pid);
        } else if (!this._runningPromptId) {
            return;
        }
        const nodes = d.nodes && typeof d.nodes === "object" ? Object.values(d.nodes) : [];
        let best = 0;
        for (const n of nodes) {
            const max = Number(n?.max);
            if (!(max > 0)) continue;
            const state = String(n?.state || "").toLowerCase();
            // Prefer the actively running node; otherwise keep the highest ratio.
            const ratio = Math.min(1, (Number(n.value) || 0) / max);
            if (state === "running") {
                this._setRunningProgress(ratio);
                return;
            }
            if (ratio > best) best = ratio;
        }
        if (best > 0) this._setRunningProgress(best);
    }

    /** @returns {"queued"|"running"|null} */
    _clipRunState(clipId) {
        if (clipId == null) return null;
        const id = String(clipId);
        if (this._runningClipId != null && String(this._runningClipId) === id) return "running";
        // Parser notify already named the active clip — do not also mark the
        // FIFO pending head as running (same prompt / for-loop left both green).
        if (this._runningClipId != null) {
            if (this._pendingGeneratedJobs.some((j) => String(j.clipId) === id)) return "queued";
            return null;
        }
        // No notify yet: treat the head pending job of the active prompt as running.
        if (this._runningPromptId) {
            const job = this._pendingGeneratedJobs.find((j) => String(j.clipId) === id);
            if (job && (job.promptId === this._runningPromptId || !job.promptId)) {
                const head = this._pendingGeneratedJobs.find((j) => (
                    j.promptId === this._runningPromptId || !j.promptId
                ));
                if (head && String(head.clipId) === id) return "running";
            }
        }
        if (this._pendingGeneratedJobs.some((j) => String(j.clipId) === id)) return "queued";
        return null;
    }

    _syncClipRunDecorations() {
        if (!this._timeline || this._destroyed) return;
        for (const track of this._timeline.tracks || []) {
            for (const clip of track.clips || []) this._decorateClip(clip);
        }
    }

    _notePendingGeneratedJob(job) {
        this._pendingGeneratedJobs.push(job);
        this._syncClipRunDecorations();
    }

    _collectExecutedOutputVideos(detail) {
        const out = [];
        const seen = new Set();
        const add = (file) => {
            const n = normalizeOutputVideoPath(file);
            if (!n || seen.has(n)) return;
            seen.add(n);
            out.push(n);
        };
        const walk = (value, depth = 0) => {
            if (value == null || depth > 6) return;
            if (typeof value === "string") {
                add(value);
                return;
            }
            if (Array.isArray(value)) {
                for (const item of value) walk(item, depth + 1);
                return;
            }
            if (typeof value !== "object") return;
            const type = String(value.type || value.location || "output").toLowerCase();
            const name = value.filename || value.file;
            if (name) {
                if (type === "output" || type === "") {
                    const sub = String(value.subfolder || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
                    add(sub ? `${sub}/${name}` : name);
                }
                return;
            }
            for (const child of Object.values(value)) walk(child, depth + 1);
        };
        walk(detail?.output);
        return out;
    }

    _onPromptExecuted(e) {
        if (this._destroyed || !this._isNodeOnLiveGraph()) return;
        if (this._promptIdFromEvent(e) === this._modelPreviewPromptId) return;
        const files = this._collectExecutedOutputVideos(e?.detail);
        if (!files.length) return;
        const promptId = this._promptIdFromEvent(e);
        for (const file of files) {
            const clipId = this._clipIdFromSpecifiedVideoPath(file);
            if (clipId) {
                const job = this._pendingGeneratedJobs.find((j) => String(j.clipId) === clipId);
                if (job) {
                    if (promptId && !job.promptId) job.promptId = promptId;
                    job.files.push(file);
                }
                continue;
            }
            const job = this._findPendingGeneratedJob(promptId);
            if (job) job.files.push(file);
        }
    }

    _flushPendingGeneratedVideos(e) {
        if (this._destroyed || !this._isNodeOnLiveGraph()) return;
        const promptId = this._promptIdFromEvent(e);
        if (promptId && promptId === this._modelPreviewPromptId) {
            this._finishModelPreview(
                this._modelPreviewEntry ? T("model_preview_complete") : T("model_preview_not_received"),
            );
            return;
        }
        // One prompt may finish several for-loop clips — flush every matching job.
        const jobs = [];
        if (promptId) {
            this._pendingGeneratedJobs = this._pendingGeneratedJobs.filter((j) => {
                if (j.promptId === promptId) {
                    jobs.push(j);
                    return false;
                }
                return true;
            });
            // Unbound leftovers only when nothing else claims them (single-run race).
            if (!jobs.length) {
                const job = this._takePendingGeneratedJob(null);
                if (job) jobs.push(job);
            }
        } else {
            const job = this._takePendingGeneratedJob(null);
            if (job) jobs.push(job);
        }
        this._clearRunningForPrompt(promptId);
        this._syncClipRunDecorations();
        for (const job of jobs) {
            this._flushOnePendingGeneratedJob(job);
        }
    }

    _flushOnePendingGeneratedJob(job) {
        if (!job) return;
        let files = [...new Set(
            (job.files || []).map((f) => normalizeOutputVideoPath(f)).filter(Boolean),
        )];
        const expected = job.expectedFile ? normalizeOutputVideoPath(job.expectedFile) : null;
        if (expected) {
            if (files.includes(expected)) {
                files = [expected];
            } else if (files.length) {
                const base = expected.split("/").pop() || "";
                const clipHint = String(job.clipId || "");
                const matched = files.filter((f) => (
                    (base && f.endsWith(base))
                    || (clipHint && f.includes(clipHint))
                ));
                if (matched.length) files = matched;
            } else {
                files = [];
            }
        }
        if (!this._pendingGeneratedJobs.some((j) => j.expectedFile && j.stamp === job.stamp)) {
            this._maybeClearGenVideoStamp(job.stamp);
        }
        if (!files.length) return;
        this._persistGeneratedVideosToProjectJson(job.clipId || null, files);
        if (!this._timeline || !this._timelineReady) {
            this._deferredGeneratedJobs.push({
                clipId: job.clipId || null,
                files,
            });
            return;
        }
        this._attachGeneratedVideos(job.clipId, files);
    }

    _maybeClearGenVideoStamp(stamp) {
        if (!stamp || this._genVideoStamp !== stamp) return;
        if (this._pendingGeneratedJobs.some((j) => j.stamp === stamp || j.expectedFile)) return;
        this._genVideoStamp = null;
        this._saveToWidgets();
    }

    _applyDeferredGeneratedVideos() {
        const jobs = this._deferredGeneratedJobs || [];
        this._deferredGeneratedJobs = [];
        if (!this._timeline || !jobs.length) return;
        for (const job of jobs) {
            if (job?.files?.length) this._attachGeneratedVideos(job.clipId, job.files);
        }
    }

    _attachGeneratedVideos(clipId, files) {
        let clip = this._findClipById(clipId);
        if (!clip) {
            const enabled = [];
            for (const track of this._allImageTracks()) {
                if (track.visible === false) continue;
                const info = this._trackInfo.get(track.id) || {};
                if (info.enabled === false) continue;
                for (const c of track.clips) {
                    const m = this._meta.get(c.id) ?? defaultImageMeta();
                    if (m.disabled || m.visible === false) continue;
                    enabled.push(c);
                }
            }
            if (enabled.length === 1) clip = enabled[0];
        }
        if (!clip) {
            this._deferredGeneratedJobs.push({
                clipId: clipId || null,
                files: [...(files || [])],
            });
            return;
        }
        this._addGeneratedVideosToClip(clip, files);
    }

    _addGeneratedVideosToClip(clip, files, { recordUndo = true } = {}) {
        if (!clip || !this._isOutputPickerClip(clip, "video")) return false;
        const m = this._ensureClipMeta(clip);
        const rows = this._clipGeneratedVideos(m);
        const have = new Set(rows.map((row) => row.file));
        const added = [];
        for (const file of files || []) {
            const n = normalizeOutputVideoPath(file);
            if (!n || have.has(n)) continue;
            have.add(n);
            added.push(normalizeGeneratedVideo({
                id: genVideoUid(),
                file: n,
                enabled: true,
                muted: false,
                note: "",
            }));
        }
        if (!added.length) return false;
        if (recordUndo) this._recordUndo();
        m.generatedVideos = [...added, ...rows];
        this._ensureResourceDuration(clip, m);
        this._meta.set(clip.id, m);
        this._decorateClip(clip);
        if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
        if (this._genVideoState?.clipId === clip.id) this._showGenVideoAt(this._genVideoState.index || 0);
            if (this._timeline && this._timelineReady) {
            this._saveToWidgets();
            if (this._historyReady) {
                this._openedProjectJson = JSON.stringify(this._buildProject());
            }
            this._decorateClip(clip);
            this._syncClipPrimaryAppearance(clip, { refreshVideo: true });
            this._updateEditModeToolbar();
            this._scheduleProgramPreview();
        } else {
            this._persistGeneratedVideosToProjectJson(clip.id, added.map((row) => row.file));
        }
        for (const row of added) void this._ensureGenVideoDuration(row);
        return true;
    }

    /** Visual clips that have at least one enabled generated video. */
    _clipsWithEnabledGeneratedVideo() {
        const out = [];
        for (const track of this._allImageTracks()) {
            for (const clip of track.clips) {
                const meta = this._meta.get(clip.id) ?? defaultImageMeta();
                if (!this._firstEnabledGeneratedVideo(meta)) continue;
                out.push({ clip, meta });
            }
        }
        return out;
    }

    _renderClipGeneratedVideosList(clip, meta, isAudio) {
        const rows = isAudio ? [] : this._clipGeneratedVideos(meta);
        if (this.clipVideosHost) this.clipVideosHost.hidden = !rows.length;
        if (!this.clipVideosList) return;
        if (this.clipVideosList.contains(this._outputVideoHoverAnchor)) this._hideOutputVideoHoverPreview();
        this.clipVideosList.replaceChildren();
        for (const [index, row] of rows.entries()) {
            const item = document.createElement("div");
            item.className = "cat-te-clip-video-row";
            if (!row.enabled) item.classList.add("is-disabled");

            const enable = document.createElement("input");
            enable.type = "checkbox";
            enable.className = "cat-te-clip-video-enabled";
            enable.checked = row.enabled !== false;
            enable.title = row.enabled ? T("disable_label") : T("enable_label");
            enable.addEventListener("click", (e) => e.stopPropagation());
            enable.addEventListener("change", () => {
                this._setGeneratedVideoEnabled(clip, row.id, !!enable.checked);
            });

            const thumb = document.createElement("img");
            thumb.className = "cat-te-clip-video-thumb";
            thumb.alt = "";
            thumb.title = T("hover_preview_video_title");
            thumb.addEventListener("mouseenter", () => this._showOutputVideoHoverPreview(thumb, row.file));
            thumb.addEventListener("mouseleave", () => this._scheduleOutputVideoHoverHide());

            const name = document.createElement("button");
            name.type = "button";
            name.className = "cat-te-clip-video-name";
            name.textContent = String(row.file || "").split(/[\\/]/).pop() || T("asset_fallback_name");
            name.title = row.file || "";
            name.addEventListener("click", () => this._openGenVideoModal(clip, index));

            const mute = document.createElement("button");
            mute.type = "button";
            mute.className = "cat-te-clip-video-mute";
            const muted = row.muted === true;
            mute.innerHTML = muted ? ICONS.volumeOff : ICONS.volume;
            mute.classList.toggle("active", muted);
            mute.title = muted ? T("unmute_label") : T("mute_label");
            mute.addEventListener("click", (e) => {
                e.stopPropagation();
                this._setGeneratedVideoMuted(clip, row.id, !muted);
            });

            const del = document.createElement("button");
            del.type = "button";
            del.className = "cat-te-clip-video-del";
            del.title = T("delete_btn");
            del.textContent = "×";
            del.addEventListener("click", (e) => {
                e.stopPropagation();
                this._deleteGeneratedVideo(clip, row.id);
            });

            const insert = document.createElement("button");
            insert.type = "button";
            insert.className = "cat-te-clip-video-insert";
            insert.innerHTML = ICONS.pictureInPicture;
            insert.title = T("insert_at_position_btn");
            insert.setAttribute("aria-label", insert.title);
            insert.addEventListener("click", async (e) => {
                e.stopPropagation();
                insert.disabled = true;
                try {
                    await this._insertGeneratedVideoAtPlayhead(row.file);
                } catch (error) {
                    alert(T("import_asset_failed", { msg: error instanceof Error ? error.message : String(error) }));
                } finally {
                    insert.disabled = false;
                }
            });

            item.append(enable, thumb, name, insert, mute, del);
            this.clipVideosList.appendChild(item);
            void this._getOutputVideoThumbnail(row.file).then((url) => {
                if (url && thumb.isConnected) thumb.src = url;
            });
        }
    }

    async _insertGeneratedVideoAtPlayhead(file) {
        const timeline = this._timeline;
        if (!timeline) return;
        const atSec = timeline.currentTime;
        const response = await fetch(this._outputVideoUrl(file));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const uploaded = await this._uploadImportBlob("video", file.split(/[\\/]/).pop(), blob);
        if (this._timeline !== timeline) return;
        await this._addVideoAtTime(uploaded.file, atSec, null, { mediaTrack: true });
        this._renderMediaGrid();
        this._saveToWidgets();
    }

    _setGeneratedVideoEnabled(clip, videoId, enabled) {
        if (!clip) return;
        const m = this._ensureClipMeta(clip);
        m.generatedVideos = this._clipGeneratedVideos(m);
        const row = m.generatedVideos.find((item) => item.id === videoId);
        if (!row || row.enabled === enabled) return;
        this._recordUndo();
        row.enabled = enabled;
        if (!this._firstEnabledGeneratedVideo(m) && m.previewMode === "generated") {
            m.previewMode = "media";
        }
        this._meta.set(clip.id, m);
        this._decorateClip(clip);
        this._syncClipPrimaryAppearance(clip);
        this._scheduleProgramPreview();
        if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
        if (this._genVideoState?.clipId === clip.id) this._showGenVideoAt(this._genVideoState.index || 0);
        this._saveToWidgets();
        this._updateAllGeneratedPreviewButton();
    }

    _setGeneratedVideoMuted(clip, videoId, muted) {
        if (!clip) return;
        const m = this._ensureClipMeta(clip);
        m.generatedVideos = this._clipGeneratedVideos(m);
        const row = m.generatedVideos.find((item) => item.id === videoId);
        if (!row || row.muted === muted) return;
        this._recordUndo();
        row.muted = muted === true;
        this._meta.set(clip.id, m);
        this._scheduleProgramPreview();
        if (this._timeline?._playing) this._startAudioPlayback();
        if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
        if (this._genVideoState?.clipId === clip.id) {
            const cur = this._currentGenVideo();
            if (cur?.row?.id === videoId && this.genVideoMutedCb) {
                this.genVideoMutedCb.checked = row.muted === true;
            }
        }
        this._saveToWidgets();
    }

    _deleteGeneratedVideo(clip, videoId) {
        if (!clip) return;
        const m = this._ensureClipMeta(clip);
        const rows = this._clipGeneratedVideos(m);
        const row = rows.find((item) => item.id === videoId);
        if (!row) return;
        const name = row.file.split(/[\\/]/).pop();
        this._openDeleteConfirm(T("confirm_remove_from_clip", { name }), () => this._removeGeneratedVideo(clip, videoId));
    }

    _removeGeneratedVideo(clip, videoId) {
        if (!clip) return;
        const m = this._ensureClipMeta(clip);
        const rows = this._clipGeneratedVideos(m);
        if (!rows.some((item) => item.id === videoId)) return;
        this._recordUndo();
        m.generatedVideos = rows.filter((item) => item.id !== videoId);
        if (!this._firstEnabledGeneratedVideo(m) && m.previewMode === "generated") {
            m.previewMode = "media";
        }
        this._meta.set(clip.id, m);
        this._decorateClip(clip);
        this._syncClipPrimaryAppearance(clip);
        this._scheduleProgramPreview();
        if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
        this._saveToWidgets();
        this._updateAllGeneratedPreviewButton();
        if (this._genVideoState?.clipId === clip.id) {
            if (!m.generatedVideos.length) this._closeGenVideoModal();
            else this._showGenVideoAt(Math.min(this._genVideoState.index || 0, m.generatedVideos.length - 1));
        }
    }

    _openGenVideoModal(clip, index = 0) {
        if (!this.genVideoModal || !clip || clip.track?.type === "audio") return;
        const rows = this._clipGeneratedVideos(this._ensureClipMeta(clip));
        if (!rows.length) return;
        this._genVideoState = { clipId: clip.id, index: 0 };
        this.genVideoModal.hidden = false;
        this._showGenVideoAt(index);
    }

    _closeGenVideoModal() {
        if (this.genVideoStage) {
            for (const media of this.genVideoStage.querySelectorAll("video")) {
                media.pause();
                media.removeAttribute("src");
                media.load();
            }
            this.genVideoStage.replaceChildren();
        }
        this._genVideoState = null;
        if (this.genVideoModal) this.genVideoModal.hidden = true;
    }

    _currentGenVideo() {
        const clip = this._findClipById(this._genVideoState?.clipId);
        if (!clip) return null;
        const rows = this._clipGeneratedVideos(this._ensureClipMeta(clip));
        if (!rows.length) return null;
        const n = rows.length;
        const index = ((Number(this._genVideoState.index) % n) + n) % n;
        return { clip, rows, index, row: rows[index] };
    }

    _showGenVideoAt(index) {
        const clip = this._findClipById(this._genVideoState?.clipId);
        if (!clip || !this.genVideoStage) {
            this._closeGenVideoModal();
            return;
        }
        const rows = this._clipGeneratedVideos(this._ensureClipMeta(clip));
        if (!rows.length) {
            this._closeGenVideoModal();
            return;
        }
        const n = rows.length;
        index = ((index % n) + n) % n;
        this._genVideoState = { clipId: clip.id, index };
        const row = rows[index];
        const name = row.file.split(/[\\/]/).pop() || T("gen_video_label");
        if (this.genVideoTitle) this.genVideoTitle.textContent = n > 1 ? `${index + 1} / ${n}  ${name}` : name;
        if (this.genVideoEnabledCb) this.genVideoEnabledCb.checked = row.enabled !== false;
        if (this.genVideoMutedCb) this.genVideoMutedCb.checked = row.muted === true;
        if (this.genVideoNote) this.genVideoNote.value = row.note || "";
        if (this.genVideoPrevBtn) this.genVideoPrevBtn.disabled = n <= 1;
        if (this.genVideoNextBtn) this.genVideoNextBtn.disabled = n <= 1;
        for (const media of this.genVideoStage.querySelectorAll("video")) {
            media.pause();
            media.removeAttribute("src");
            media.load();
        }
        this.genVideoStage.replaceChildren();
        const video = document.createElement("video");
        video.className = "cat-te-media-preview-content cat-te-media-preview-video";
        video.src = this._outputVideoUrl(row.file);
        video.controls = true;
        video.preload = "metadata";
        this.genVideoStage.appendChild(video);
        this.genVideoModal.hidden = false;
    }

    _stepGenVideoPreview(delta) {
        const cur = this._currentGenVideo();
        if (!cur || cur.rows.length <= 1) return;
        this._showGenVideoAt(cur.index + delta);
    }

    _onGenVideoEnabledChange() {
        const cur = this._currentGenVideo();
        if (!cur || !this.genVideoEnabledCb) return;
        this._setGeneratedVideoEnabled(cur.clip, cur.row.id, !!this.genVideoEnabledCb.checked);
    }

    _onGenVideoMutedChange() {
        const cur = this._currentGenVideo();
        if (!cur || !this.genVideoMutedCb) return;
        this._setGeneratedVideoMuted(cur.clip, cur.row.id, !!this.genVideoMutedCb.checked);
    }

    _onGenVideoNoteChange() {
        const cur = this._currentGenVideo();
        if (!cur || !this.genVideoNote) return;
        const note = String(this.genVideoNote.value || "");
        const m = this._ensureClipMeta(cur.clip);
        m.generatedVideos = this._clipGeneratedVideos(m);
        const row = m.generatedVideos.find((item) => item.id === cur.row.id) || m.generatedVideos[cur.index];
        if (!row || row.note === note) return;
        this._recordUndo();
        row.note = note;
        this._meta.set(cur.clip.id, m);
        this._saveToWidgets();
    }

    _deleteCurrentGenVideo() {
        const cur = this._currentGenVideo();
        if (!cur) return;
        this._deleteGeneratedVideo(cur.clip, cur.row.id);
    }

    _genEditPreviewMaxHeight() {
        const left = this.genEditLeft;
        const leftH = left?.clientHeight ?? 0;
        if (leftH <= 0) return DEFAULT_GEN_EDIT_PREVIEW_H + 200;
        // Leave room for splitter (~6) + timeline min.
        return Math.max(MIN_GEN_EDIT_PREVIEW_H, leftH - MIN_GEN_EDIT_TL_H - 8);
    }

    _setGenEditPreviewHeight(h) {
        const maxH = this._genEditPreviewMaxHeight();
        const clamped = Math.min(maxH, Math.max(MIN_GEN_EDIT_PREVIEW_H, Math.round(h)));
        const host = this.genEditLeft || this.genEditModal;
        host?.style.setProperty("--cat-te-gen-edit-preview-h", `${clamped}px`);
        return clamped;
    }

    _applySavedGenEditPreviewHeight() {
        const saved = parseInt(localStorage.getItem(STORAGE_GEN_EDIT_PREVIEW_H), 10);
        if (Number.isFinite(saved) && saved >= MIN_GEN_EDIT_PREVIEW_H) {
            this._setGenEditPreviewHeight(saved);
        } else {
            this._setGenEditPreviewHeight(DEFAULT_GEN_EDIT_PREVIEW_H);
        }
    }

    _bindGenEditPreviewResize() {
        const split = this.genEditVSplit;
        const preview = this.genEditPreviewEl;
        if (!split || !preview || split._catTeBound) return;
        split._catTeBound = true;
        split.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            const startY = e.clientY;
            const startH = preview.offsetHeight;
            split.classList.add("dragging");
            document.body.classList.add("cat-te-row-resize");
            const onMove = (ev) => {
                this._setGenEditPreviewHeight(startH + (ev.clientY - startY));
                this._scheduleGenEditPreview();
            };
            const onUp = () => {
                split.classList.remove("dragging");
                document.body.classList.remove("cat-te-row-resize");
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
                const h = this._setGenEditPreviewHeight(preview.offsetHeight);
                localStorage.setItem(STORAGE_GEN_EDIT_PREVIEW_H, String(h));
                this._scheduleGenEditPreview();
                try { this._genEditState?.timeline?._refresh?.(); } catch { /* ignore */ }
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        });
    }

    _cloneGenVideoDraft(row) {
        const n = normalizeGeneratedVideo(row);
        return n ? { ...n } : null;
    }

    _genEditParentDuration() {
        const clip = this._findClipById(this._genEditState?.clipId);
        if (!clip) return 1;
        const m = this._ensureClipMeta(clip);
        return Math.max(0.05, this._ensureResourceDuration(clip, m));
    }


    /** Timeline length for gen-edit: at least parent clip + room to show source overhang. */
    _genEditTimelineDuration(clipDur, draft) {
        let maxEnd = Math.max(0.05, Number(clipDur) || 0.05);
        for (const g of draft || []) {
            const tin = Math.max(0, Number(g.trim_in_sec) || 0);
            let eff = this._genEffectiveDurationSec(g);
            const full = Number(g.duration_sec);
            if (!(eff > 0)) {
                eff = Number.isFinite(full) && full > tin ? full - tin : 0;
            }
            const start = Math.max(0, Number(g.edit_start_sec) || 0);
            if (eff > 0) maxEnd = Math.max(maxEnd, start + eff);
            if (Number.isFinite(full) && full > 0) maxEnd = Math.max(maxEnd, full);
        }
        return Math.max(maxEnd, clipDur + Math.max(1, clipDur * 0.25));
    }

    _syncGenEditOutOfBoundsUI(tl, clipDur) {
        if (!tl?._contentEl) return;
        let host = tl._contentEl.querySelector(".cat-te-gen-edit-oob");
        if (!host) {
            host = document.createElement("div");
            host.className = "cat-te-gen-edit-oob";
            host.innerHTML = [
                '<div class="cat-te-gen-edit-oob-fill"></div>',
                '<div class="cat-te-gen-edit-oob-line"></div>',
                '<div class="cat-te-gen-edit-oob-label"></div>',
            ].join("");
            tl._contentEl.appendChild(host);
        }
        const pps = tl.pixelsPerSecond;
        const startPx = Math.max(0, clipDur * pps);
        const widthPx = Math.max(0, tl.duration * pps - startPx);
        host.style.left = `${startPx}px`;
        host.style.width = `${widthPx}px`;
        host.hidden = widthPx < 1;
        const label = host.querySelector(".cat-te-gen-edit-oob-label");
        if (label) {
            label.textContent = T("gen_edit_oob_label", { time: tl.formatTime(clipDur) });
        }
        for (const track of tl.tracks) {
            for (const c of track.clips || []) {
                const oob = c.startTime >= clipDur - 1e-6;
                c.el?.classList.toggle("cat-te-gen-edit-clip-oob", oob);
            }
        }
    }

    async _openGenEditModal(clip) {
        if (!this.genEditModal || !clip || clip.track?.type === "audio") return;
        if (isSubtitleTrackType(clip.track?.type)) return;
        const m = this._ensureClipMeta(clip);
        const rows = this._clipGeneratedVideos(m);
        if (!rows.length) {
            alert(T("gen_edit_no_videos"));
            return;
        }
        this._closeGenVideoModal();
        const draft = rows.map((r) => this._cloneGenVideoDraft(r)).filter(Boolean);
        await Promise.all(draft.map((g) => this._ensureGenVideoDuration(g)));
        const clipDur = Math.max(0.05, this._ensureResourceDuration(clip, m));
        for (const g of draft) {
            const tin = Math.max(0, Number(g.trim_in_sec) || 0);
            let eff = this._genEffectiveDurationSec(g);
            const full = Number(g.duration_sec);
            if (!(eff > 0)) {
                eff = Number.isFinite(full) && full > tin ? full - tin : clipDur;
            }
            // Keep placements past the parent clip window — they stay editable
            // but are outside the playable / rendered range.
            const start = Math.max(0, Number(g.edit_start_sec) || 0);
            g.edit_start_sec = start;
            if (!(Number.isFinite(Number(g.duration_sec)) && g.duration_sec > 0) && Number.isFinite(full)) {
                g.duration_sec = full;
            }
            if (!(eff > 0)) {
                g.trim_out_sec = tin + Math.max(0.05, clipDur);
            }
        }
        this._genEditState = {
            clipId: clip.id,
            draft,
            audioDraft: this._normalizeGenEditAudioDraft(m.genEditAudios),
            undoRecorded: false,
            // generatedVideos is newest-first; select the newest entry.
            selectedId: draft[0]?.id || null,
            clipMap: new Map(),
            audioMap: new Map(),
            previewRaf: 0,
        };
        if (this.genEditTitle) {
            this.genEditTitle.textContent = T("gen_edit_modal_title_named", { name: clip.name || DEFAULT_CLIP_NAME });
        }
        this.genEditModal.hidden = false;
        try { this._timeline?.pause?.(); } catch { /* ignore */ }
        this._stopAudioPlayback?.();
        // Cancel main program monitor so it cannot steal shared <video> decoders.
        if (this._programPreviewRaf) {
            cancelAnimationFrame(this._programPreviewRaf);
            this._programPreviewRaf = 0;
        }
        this._pauseUnusedPreviewVideos(new Set());
        if (this._timeline) this._timeline._keyboardSuspended = true;
        this._applySavedGenEditPreviewHeight();
        this._buildGenEditTimeline();
        this._syncGenEditInspector();
        // Warm-decode audio so play doesn't start silent / delayed.
        for (const g of draft) {
            if (g?.file) void this._ensureGenVideoAudioBuffer(g.file, "output");
        }
        for (const a of this._genEditState.audioDraft || []) {
            if (a?.file) void this._ensureGenVideoAudioBuffer(a.file, "input");
        }
        // Layout may not be ready on the same frame the modal unhides.
        this._scheduleGenEditPreview();
        requestAnimationFrame(() => {
            this._applySavedGenEditPreviewHeight();
            this._scheduleGenEditPreview();
        });
        setTimeout(() => this._scheduleGenEditPreview(), 80);
    }

    _buildGenEditTimeline() {
        const st = this._genEditState;
        if (!st || !this.genEditTlHost) return;
        this._destroyGenEditTimeline();
        const clipDur = this._genEditParentDuration();
        const tlDur = this._genEditTimelineDuration(clipDur, st.draft);
        const fps = this.getFps();
        const tl = new Timeline(this.genEditTlHost, {
            duration: tlDur,
            playEndTime: clipDur,
            fps,
            timeFormat: "frames",
            zoom: 1.4,
            addTrackTypes: [],
        });
        tl.toolbarEl?.querySelector(".tl-btn-add-track")?.remove();
        tl.toolbarEl?.querySelector(".tl-btn-history")?.remove();
        if (tl._durEl) {
            tl._durEl.textContent = `/ ${tl.formatTime(clipDur)}`;
            tl._durEl.title = T("gen_edit_playable_duration_title");
        }
        st.timeline = tl;
        st.clipMap = new Map();
        st.clipDur = clipDur;

        const n = st.draft.length;
        for (let i = 0; i < n; i++) {
            const gen = st.draft[i];
            const track = tl.addTrackAt({
                type: "image",
                name: (gen.file || "").split(/[\\/]/).pop() || T("gen_video_label"),
                isMain: i === n - 1,
            }, i);
            track.height = TRACK_HEIGHT;
            track.el.style.height = `${TRACK_HEIGHT}px`;
            track.headerEl.style.height = `${TRACK_HEIGHT}px`;
            track.setVisible(gen.enabled !== false);
            track.setMuted(gen.muted === true);
            this._setupGenEditTrackControls(track, gen.id);

            const tin = Math.max(0, Number(gen.trim_in_sec) || 0);
            let eff = this._genEffectiveDurationSec(gen);
            if (!(eff > 0)) {
                const full = Number(gen.duration_sec);
                eff = Number.isFinite(full) && full > tin
                    ? full - tin
                    : Math.max(0.05, clipDur);
            }
            const startSec = Math.max(0, Number(gen.edit_start_sec) || 0);
            const dur = Math.max(0.05, eff);
            const src = this._outputVideoUrl(gen.file);
            const c = track.addClip({
                name: (gen.file || "").split(/[\\/]/).pop() || T("gen_video_label"),
                startTime: startSec,
                duration: dur,
                sourceOffset: tin,
                sourceDuration: Number.isFinite(Number(gen.duration_sec)) && gen.duration_sec > 0
                    ? gen.duration_sec
                    : Infinity,
                src,
                thumbnail: src,
                color: "#3d6b9e",
            });
            if (c) {
                st.clipMap.set(c.id, gen.id);
                c.el.dataset.genId = gen.id;
                this._syncGenEditClipDisabled(c, gen.enabled !== false);
            }
        }

        // Detached audio lives only in this modal (not the main timeline).
        st.audioMap = new Map();
        const audioRows = Array.isArray(st.audioDraft) ? st.audioDraft : [];
        if (audioRows.length) {
            const aTrack = tl.addTrack({
                type: "audio",
                name: T("audio_track_name"),
                height: TRACK_HEIGHT,
            });
            aTrack.height = TRACK_HEIGHT;
            aTrack.el.style.height = `${TRACK_HEIGHT}px`;
            aTrack.headerEl.style.height = `${TRACK_HEIGHT}px`;
            // Track-level mute (same as main timeline); draft rows share it.
            if (audioRows.some((r) => r.muted === true)) aTrack.setMuted(true);
            this._setupGenEditAudioTrackControls(aTrack);
            for (const row of audioRows) {
                if (!row?.file) continue;
                const startSec = Math.max(0, Number(row.edit_start_sec) || 0);
                const dur = Math.max(0.05, Number(row.duration) || 0.05);
                const srcOff = Math.max(0, Number(row.source_offset) || 0);
                const url = this._audioUrl(row.file) || "";
                const c = aTrack.addClip({
                    name: (row.file || "").split(/[\\/]/).pop() || T("audio_track_name"),
                    startTime: startSec,
                    duration: dur,
                    sourceOffset: srcOff,
                    sourceDuration: Number.isFinite(Number(row.source_duration)) && row.source_duration > 0
                        ? row.source_duration
                        : Infinity,
                    src: row.file,
                    color: aTrack.color || "#6a9a6a",
                });
                if (c) {
                    st.audioMap.set(c.id, row.id);
                    c.el.dataset.audioId = row.id;
                    c.hasAudio = true;
                    // Waveform optional — load async without blocking.
                    if (url) {
                        void this._fetchPeaks(url).then((r) => {
                            if (!c.el?.isConnected) return;
                            c.waveformPeaks = r.peaks?.[0] || null;
                            c._audioBuffer = r.buffer || null;
                            c.sourceDuration = r.duration || c.sourceDuration;
                            if (typeof c._refreshWaveRow === "function") c._refreshWaveRow();
                        }).catch(() => {});
                    }
                }
            }
        }

        tl.duration = Math.max(tlDur, this._genEditTimelineDuration(clipDur, st.draft));
        tl.setPlayEndTime(clipDur);
        this._syncGenEditOutOfBoundsUI(tl, clipDur);
        tl._refresh?.();

        const refreshBound = () => {
            const cd = this._genEditParentDuration();
            st.clipDur = cd;
            tl.setPlayEndTime(cd);
            let maxEnd = this._genEditTimelineDuration(cd, st.draft);
            for (const track of tl.tracks) {
                for (const c of track.clips || []) maxEnd = Math.max(maxEnd, c.endTime);
            }
            if (maxEnd > tl.duration + 1e-3) {
                tl.duration = maxEnd + Math.max(0.5, cd * 0.1);
                tl._refresh?.();
            }
            this._syncGenEditOutOfBoundsUI(tl, cd);
            if (tl._durEl) tl._durEl.textContent = `/ ${tl.formatTime(cd)}`;
        };

        tl.on("clip:select", ({ clip: c }) => {
            if (!c) return;
            if (st.audioMap?.get(c.id) || c.el?.dataset?.audioId) {
                st.selectedId = null;
                this._syncGenEditInspector();
                return;
            }
            const gid = st.clipMap.get(c?.id) || c?.el?.dataset?.genId;
            if (gid) {
                st.selectedId = gid;
                this._syncGenEditInspector();
            }
        });
        tl.on("clip:moveend", () => {
            this._pullGenEditDraftFromTimeline();
            this._applyGenEditChanges();
            refreshBound();
            this._scheduleGenEditPreview();
        });
        tl.on("clip:resizeend", () => {
            this._pullGenEditDraftFromTimeline();
            this._applyGenEditChanges();
            refreshBound();
            this._scheduleGenEditPreview();
        });
        tl.on("clip:trackchange", () => {
            this._pullGenEditDraftFromTimeline();
            this._applyGenEditChanges();
            refreshBound();
        });
        tl.on("timechange", () => this._scheduleGenEditPreview());
        tl.on("seek", () => {
            this._scheduleGenEditPreview();
            if (tl._playing) void this._startGenEditAudioPlayback();
        });
        tl.on("play", () => {
            this._scheduleGenEditPreview();
            void this._startGenEditAudioPlayback();
        });
        tl.on("pause", () => {
            this._stopGenEditAudioPlayback();
            this._pauseUnusedPreviewVideos(new Set());
            this._scheduleGenEditPreview();
        });
        tl.on("zoomchange", () => requestAnimationFrame(refreshBound));

        tl.scrollEl?.addEventListener("contextmenu", (e) => {
            const clipEl = e.target?.closest?.(".tl-clip");
            if (!clipEl) return;
            e.preventDefault();
            e.stopPropagation();
            const c = tl.tracks.flatMap((t) => t.clips).find((x) => x.el === clipEl || x.id === clipEl.dataset.clipId);
            if (!c) return;
            tl.selectClip(c);
            const gid = st.clipMap.get(c.id);
            if (gid) st.selectedId = gid;
            this._syncGenEditInspector();
            const t = tl.currentTime;
            const cd = st.clipDur ?? clipDur;
            const canSplit = t > c.startTime + 1e-3 && t < c.endTime - 1e-3 && t < cd - 1e-3;
            const isAudioClip = !!(st.audioMap?.get(c.id) || c.el?.dataset?.audioId || c.track?.type === "audio");
            const items = isAudioClip
                ? [{
                    label: T("delete_btn"),
                    danger: true,
                    fn: () => this._deleteGenEditAudioClip(c),
                }]
                : [
                    ...(canSplit ? [{ label: T("menu_split"), fn: () => this._splitGenEditClip(c) }] : []),
                    {
                        label: T("menu_separate_audio"),
                        fn: () => void this._separateGenEditClipAudio(c),
                    },
                    {
                        label: T("delete_btn"),
                        danger: true,
                        fn: () => this._deleteGenEditClip(c),
                    },
                ];
            this._buildCtxMenu(items, e.clientX, e.clientY);
        });
    }

    _setupGenEditTrackControls(track, genId) {
        const actions = track.actionsEl;
        if (!actions) return;
        actions.replaceChildren();

        const makeBtn = (kind) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "cat-te-track-btn";
            if (kind === "lock") {
                const render = () => {
                    btn.innerHTML = track.locked ? ICONS.lock : ICONS.lockOpen;
                    btn.classList.toggle("active", track.locked);
                    btn.title = track.locked ? T("unlock_track_title") : T("lock_track_title");
                };
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    track.setLocked(!track.locked);
                    render();
                });
                render();
            } else if (kind === "visible") {
                const render = () => {
                    btn.innerHTML = track.visible ? ICONS.eye : ICONS.eyeOff;
                    btn.classList.toggle("active", !track.visible);
                    btn.title = T("track_visibility_title");
                };
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const st = this._genEditState;
                    const row = st?.draft?.find((g) => g.id === genId);
                    if (!row) return;
                    row.enabled = !(row.enabled !== false);
                    track.setVisible(row.enabled !== false);
                    for (const c of track.clips || []) {
                        this._syncGenEditClipDisabled(c, row.enabled !== false);
                    }
                    render();
                    this._applyGenEditChanges();
                    this._scheduleGenEditPreview();
                });
                render();
            } else if (kind === "mute") {
                const render = () => {
                    btn.innerHTML = track.muted ? ICONS.volumeOff : ICONS.volume;
                    btn.classList.toggle("active", track.muted);
                    btn.title = track.muted ? T("unmute_label") : T("mute_label");
                };
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const st = this._genEditState;
                    const row = st?.draft?.find((g) => g.id === genId);
                    if (!row) return;
                    row.muted = !row.muted;
                    track.setMuted(!!row.muted);
                    render();
                    this._applyGenEditChanges();
                    this._scheduleGenEditPreview();
                    if (this._genEditState?.timeline?._playing) {
                        void this._startGenEditAudioPlayback();
                    }
                });
                render();
            }
            return btn;
        };

        // Same column order as the main timeline: lock / visibility / mute.
        actions.append(makeBtn("lock"), makeBtn("visible"), makeBtn("mute"));
    }

    /** Audio track in gen-edit: lock + mute (visibility slot is a placeholder). */
    _setupGenEditAudioTrackControls(track) {
        const actions = track?.actionsEl;
        if (!actions) return;
        actions.replaceChildren();

        const makeSlot = (kind) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "cat-te-track-btn";
            if (kind === null) {
                btn.classList.add("placeholder");
                btn.disabled = true;
                btn.tabIndex = -1;
                return btn;
            }
            if (kind === "lock") {
                const render = () => {
                    btn.innerHTML = track.locked ? ICONS.lock : ICONS.lockOpen;
                    btn.classList.toggle("active", track.locked);
                    btn.title = track.locked ? T("unlock_track_title") : T("lock_track_title");
                };
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    track.setLocked(!track.locked);
                    render();
                });
                render();
            } else if (kind === "mute") {
                const render = () => {
                    btn.innerHTML = track.muted ? ICONS.volumeOff : ICONS.volume;
                    btn.classList.toggle("active", track.muted);
                    btn.title = track.muted ? T("unmute_label") : T("mute_label");
                };
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const st = this._genEditState;
                    track.setMuted(!track.muted);
                    const muted = track.muted === true;
                    if (st?.audioDraft) {
                        for (const row of st.audioDraft) row.muted = muted;
                    }
                    render();
                    this._applyGenEditChanges();
                    if (st?.timeline?._playing) void this._startGenEditAudioPlayback();
                });
                render();
            }
            return btn;
        };

        // Same columns as main timeline audio: lock / (empty) / mute.
        actions.append(makeSlot("lock"), makeSlot(null), makeSlot("mute"));
    }

    _pullGenEditDraftFromTimeline() {
        const st = this._genEditState;
        const tl = st?.timeline;
        if (!st || !tl) return;
        // Preserve placements past the parent clip window; playback ignores them.
        const next = [];
        const nextAudio = [];
        for (const track of tl.tracks) {
            if (track.type === "audio") {
                for (const c of [...track.clips].sort((a, b) => a.startTime - b.startTime)) {
                    const aid = st.audioMap?.get(c.id) || c.el?.dataset?.audioId;
                    const prev = (st.audioDraft || []).find((a) => a.id === aid);
                    if (!prev && !c.src) continue;
                    nextAudio.push({
                        id: aid || genAudioUid(),
                        file: String(c.src || prev?.file || "").replace(/\\/g, "/"),
                        edit_start_sec: Math.max(0, Number(c.startTime) || 0),
                        duration: Math.max(0.05, Number(c.duration) || 0.05),
                        source_offset: Math.max(0, Number(c.sourceOffset) || 0),
                        source_duration: Number.isFinite(Number(c.sourceDuration)) && c.sourceDuration > 0
                            ? Number(c.sourceDuration)
                            : (prev?.source_duration ?? null),
                        muted: track.muted === true,
                        from_gen_id: prev?.from_gen_id || null,
                    });
                }
                continue;
            }
            for (const c of [...track.clips].sort((a, b) => a.startTime - b.startTime)) {
                const gid = st.clipMap.get(c.id) || c.el?.dataset?.genId;
                const prev = st.draft.find((g) => g.id === gid);
                if (!prev) continue;
                const tin = Math.max(0, Number(c.sourceOffset) || 0);
                const dur = Math.max(0.05, Number(c.duration) || 0.05);
                const start = Math.max(0, Number(c.startTime) || 0);
                next.push({
                    ...prev,
                    enabled: track.visible !== false,
                    muted: track.muted === true,
                    edit_start_sec: start,
                    trim_in_sec: tin,
                    trim_out_sec: tin + dur,
                    duration_sec: Number.isFinite(Number(c.sourceDuration)) && c.sourceDuration > 0
                        ? c.sourceDuration
                        : prev.duration_sec,
                });
            }
        }
        st.draft = next;
        st.audioDraft = nextAudio.filter((a) => a.file);
    }

    _syncGenEditClipDisabled(clip, enabled) {
        if (!clip?.el) return;
        clip.el.classList.toggle("cat-te-clip-disabled", enabled === false);
    }

    _splitGenEditClip(clip) {
        const st = this._genEditState;
        const tl = st?.timeline;
        if (!st || !tl || !clip) return;
        const t = tl.currentTime;
        if (!(t > clip.startTime + 1e-3 && t < clip.endTime - 1e-3)) return;
        this._pullGenEditDraftFromTimeline();
        const gid = st.clipMap.get(clip.id);
        const idx = st.draft.findIndex((g) => g.id === gid);
        if (idx < 0) return;
        const src = st.draft[idx];
        const local = t - clip.startTime;
        const tin = Math.max(0, Number(src.trim_in_sec) || 0);
        const leftOut = tin + local;
        const rightIn = leftOut;
        const rightStart = Math.max(0, Number(src.edit_start_sec) || 0) + local;
        const fullOut = src.trim_out_sec != null ? Number(src.trim_out_sec) : (Number(src.duration_sec) || rightIn + 0.05);
        src.trim_out_sec = leftOut;
        const right = {
            ...src,
            id: genVideoUid(),
            edit_start_sec: rightStart,
            trim_in_sec: rightIn,
            trim_out_sec: Number.isFinite(fullOut) && fullOut > rightIn ? fullOut : rightIn + 0.05,
            prompt: src.prompt || "",
        };
        st.draft.splice(idx + 1, 0, right);
        st.selectedId = right.id;
        this._applyGenEditChanges();
        this._buildGenEditTimeline();
        this._syncGenEditInspector();
        this._scheduleGenEditPreview();
    }

    _deleteGenEditClip(clip) {
        const st = this._genEditState;
        if (!st || !clip) return;
        const gid = st.clipMap.get(clip.id);
        if (!gid) return;
        this._openDeleteConfirm(T("confirm_delete_named_clip", { name: clip.name }), () => this._removeGenEditClip(clip, gid));
    }

    _removeGenEditClip(clip, gid) {
        const st = this._genEditState;
        if (!st || !clip || st.clipMap.get(clip.id) !== gid) return;
        st.draft = st.draft.filter((g) => g.id !== gid);
        st.audioDraft = (st.audioDraft || []).filter((a) => a.from_gen_id !== gid);
        this._applyGenEditChanges();
        if (!st.draft.length) {
            this._closeGenEditModal();
            return;
        }
        if (st.selectedId === gid) st.selectedId = st.draft[st.draft.length - 1].id;
        this._buildGenEditTimeline();
        this._syncGenEditInspector();
        this._scheduleGenEditPreview();
    }

    /**
     * Extract audio from a generated-video row into the gen-edit modal's own
     * audio track (never the main timeline).
     */
    async _separateGenEditClipAudio(tlClip) {
        const st = this._genEditState;
        if (!st || !tlClip) return;
        if (tlClip.track?.type === "audio") return;
        this._pullGenEditDraftFromTimeline();
        const gid = st.clipMap.get(tlClip.id) || tlClip.el?.dataset?.genId;
        const gen = st.draft.find((g) => g.id === gid);
        if (!gen?.file) return;

        const tin = Math.max(0, Number(gen.trim_in_sec) || 0);
        let eff = this._genEffectiveDurationSec(gen);
        if (!(eff > 0)) {
            const full = Number(gen.duration_sec);
            eff = Number.isFinite(full) && full > tin
                ? full - tin
                : Math.max(0.05, Number(tlClip.duration) || 0.05);
        }
        const startSec = Math.max(0, Number(gen.edit_start_sec) || 0);

        try {
            const file = await this._extractAudioFromMedia(gen.file, {
                location: "output",
                trimInSec: tin,
                durationSec: eff,
            });
            if (this._genEditState !== st) return;
            const current = st.draft.find((row) => row.id === gen.id);
            if (!current) return;
            st.audioDraft = (st.audioDraft || []).filter((a) => a.from_gen_id !== gen.id);
            st.audioDraft.push({
                id: genAudioUid(),
                file,
                edit_start_sec: startSec,
                duration: eff,
                source_offset: 0,
                source_duration: eff,
                muted: false,
                from_gen_id: gen.id,
            });
            current.muted = true;
            this._applyGenEditChanges();
            void this._ensureGenVideoAudioBuffer(file, "input");
            this._buildGenEditTimeline();
            this._syncGenEditInspector();
            this._scheduleGenEditPreview();
            if (st.timeline?._playing) void this._startGenEditAudioPlayback();
        } catch (error) {
            alert(T("separate_audio_failed", {
                msg: error instanceof Error ? error.message : String(error),
            }));
        }
    }

    _deleteGenEditAudioClip(clip) {
        const st = this._genEditState;
        if (!st || !clip) return;
        this._pullGenEditDraftFromTimeline();
        const aid = st.audioMap?.get(clip.id) || clip.el?.dataset?.audioId;
        if (!aid) return;
        const row = (st.audioDraft || []).find((audio) => audio.id === aid);
        const name = String(row?.file || clip.name || "").split(/[\\/]/).pop();
        this._openDeleteConfirm(T("confirm_remove_from_clip", { name }), () => this._removeGenEditAudioClip(clip, aid));
    }

    _removeGenEditAudioClip(clip, aid) {
        const st = this._genEditState;
        if (!st || !clip) return;
        const currentId = st.audioMap?.get(clip.id) || clip.el?.dataset?.audioId;
        if (currentId !== aid) return;
        st.audioDraft = (st.audioDraft || []).filter((a) => a.id !== aid);
        this._applyGenEditChanges();
        this._buildGenEditTimeline();
        this._scheduleGenEditPreview();
        if (st.timeline?._playing) void this._startGenEditAudioPlayback();
    }

    _normalizeGenEditAudioDraft(rows) {
        if (!Array.isArray(rows)) return [];
        return rows.map((row) => {
            if (!row || typeof row !== "object") return null;
            const file = String(row.file || "").replace(/\\/g, "/").replace(/^\/+/, "");
            if (!file) return null;
            return {
                id: String(row.id || "").trim() || genAudioUid(),
                file,
                edit_start_sec: Math.max(0, Number(row.edit_start_sec ?? row.editStartSec) || 0),
                duration: Math.max(0.05, Number(row.duration ?? row.duration_sec) || 0.05),
                source_offset: Math.max(0, Number(row.source_offset ?? row.sourceOffset) || 0),
                source_duration: Number.isFinite(Number(row.source_duration ?? row.sourceDuration))
                    && Number(row.source_duration ?? row.sourceDuration) > 0
                    ? Number(row.source_duration ?? row.sourceDuration)
                    : null,
                muted: row.muted === true,
                from_gen_id: row.from_gen_id || row.fromGenId || null,
            };
        }).filter(Boolean);
    }

    /** Extract audio from a main-timeline visual clip (generated video preferred). */
    async _separateClipAudio(clip) {
        if (!clip || clip.track?.type === "audio") return;
        const m = this._ensureClipMeta(clip);
        if (isSubtitleClipMeta(m, clip.track) || isVoiceoverClipMeta(m, clip.track)) return;

        const gen = this._firstEnabledGeneratedVideo(m);
        let file = "";
        let location = "output";
        let trimIn = 0;
        let durationSec = Math.max(0.05, Number(clip.duration) || 0.05);
        let atSec = Math.max(0, Number(clip.startTime) || 0);

        if (gen?.file) {
            file = gen.file;
            location = "output";
            trimIn = Math.max(0, Number(gen.trim_in_sec) || 0);
            const editStart = Math.max(0, Number(gen.edit_start_sec) || 0);
            let eff = this._genEffectiveDurationSec(gen);
            if (!(eff > 0)) {
                const full = Number(gen.duration_sec);
                eff = Number.isFinite(full) && full > trimIn
                    ? full - trimIn
                    : Math.max(0.05, (Number(clip.duration) || 0.05) - editStart);
            }
            durationSec = eff;
            atSec = Math.max(0, (Number(clip.startTime) || 0) + editStart);
        } else {
            const items = typeof this._enabledClipItems === "function"
                ? (this._enabledClipItems(m) || [])
                : [];
            const videoItem = items.find((it) => it?.kind === "video" && it.file) || null;
            file = videoItem?.file || (m.mediaKind === "video" ? clip.src : "") || "";
            location = "input";
            trimIn = Math.max(0, Number(clip.sourceOffset) || Number(m.trimIn) || 0);
            durationSec = Math.max(0.05, Number(clip.duration) || 0.05);
            atSec = Math.max(0, Number(clip.startTime) || 0);
        }
        if (!file) {
            alert(T("separate_audio_failed", { msg: T("gen_edit_no_videos") }));
            return;
        }

        try {
            const audioFile = await this._extractAudioFromMedia(file, {
                location,
                trimInSec: trimIn,
                durationSec,
            });
            await this._addAudioAtTime(audioFile, atSec, null);
            if (gen) {
                this._setGeneratedVideoMuted(clip, gen.id, true);
            } else {
                this._recordUndo();
                m.muted = true;
                this._meta.set(clip.id, m);
                this._decorateClip(clip);
            }
            this._saveToWidgets();
            this._scheduleProgramPreview();
        } catch (error) {
            alert(T("separate_audio_failed", {
                msg: error instanceof Error ? error.message : String(error),
            }));
        }
    }

    async _extractAudioFromMedia(file, {
        location = "output",
        trimInSec = 0,
        durationSec = null,
    } = {}) {
        const rel = String(file || "").replace(/\\/g, "/").replace(/^\/+/, "");
        if (!rel) throw new Error("missing file");
        const res = await api.fetchApi("/audio_keyframe_timeline/extract_audio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                file: rel,
                location,
                trim_in_sec: Math.max(0, Number(trimInSec) || 0),
                duration_sec: durationSec == null ? null : Math.max(0.05, Number(durationSec) || 0.05),
            }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || `HTTP ${res.status}`);
        }
        const out = String(data.file || "").trim();
        if (!out) throw new Error("empty extract result");
        return out;
    }

    _syncGenEditInspector() {
        const st = this._genEditState;
        const row = st?.draft?.find((g) => g.id === st.selectedId) || st?.draft?.[st.draft.length - 1];
        const name = row ? ((row.file || "").split(/[\\/]/).pop() || T("gen_video_label")) : "";
        if (this.genEditNameEl) {
            this.genEditNameEl.textContent = name || T("gen_edit_select_hint");
            this.genEditNameEl.title = name;
        }
        if (this.genEditFileEl) {
            this.genEditFileEl.textContent = row?.file || "";
            this.genEditFileEl.title = row?.file || "";
        }
        if (this.genEditPrompt) {
            this.genEditPrompt.disabled = !row;
            this.genEditPrompt.value = row?.prompt || "";
        }
    }

    _onGenEditPromptInput() {
        const st = this._genEditState;
        if (!st || !this.genEditPrompt) return;
        const row = st.draft.find((g) => g.id === st.selectedId);
        if (!row) return;
        row.prompt = String(this.genEditPrompt.value || "");
        this._applyGenEditChanges();
    }

    _scheduleGenEditPreview() {
        const st = this._genEditState;
        if (!st) return;
        if (st.previewRaf) return;
        st.previewRaf = requestAnimationFrame(() => {
            st.previewRaf = 0;
            void this._renderGenEditPreview();
        });
    }

    async _renderGenEditPreview() {
        const st = this._genEditState;
        const canvas = this.genEditPreviewCanvas;
        if (!st || !canvas || this.genEditModal?.hidden) return;
        const stage = canvas.parentElement;
        const w = Math.max(2, Math.floor(stage?.clientWidth || 320));
        const h = Math.max(2, Math.floor(stage?.clientHeight || 180));
        const sizeChanged = canvas.width !== w || canvas.height !== h;
        if (sizeChanged) {
            canvas.width = w;
            canvas.height = h;
            st.previewHadFrame = false;
        }
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const t = st.timeline?.currentTime ?? 0;
        const clipDur = this._genEditParentDuration();
        const playing = !!st.timeline?._playing;

        // Outside the parent clip window: no playback / no render.
        if (t >= clipDur - 1e-9) {
            this._stopGenEditAudioPlayback();
            this._pauseUnusedPreviewVideos(new Set());
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, w, h);
            if (this.genEditPreviewEmpty) {
                this.genEditPreviewEmpty.hidden = false;
                this.genEditPreviewEmpty.textContent = T("gen_edit_oob_preview");
            }
            st.previewHadFrame = false;
            if (playing) st.timeline.pause?.();
            return;
        }
        if (this.genEditPreviewEmpty && this.genEditPreviewEmpty.dataset.oobRestored !== "1") {
            this.genEditPreviewEmpty.dataset.defaultText = this.genEditPreviewEmpty.textContent;
            this.genEditPreviewEmpty.dataset.oobRestored = "1";
        }
        if (this.genEditPreviewEmpty?.dataset.defaultText) {
            this.genEditPreviewEmpty.textContent = this.genEditPreviewEmpty.dataset.defaultText;
        }

        const layers = this._collectGenEditPreviewLayers(t);
        const usedVideoKeys = new Set();

        if (!layers.length) {
            this._pauseUnusedPreviewVideos(usedVideoKeys);
            if (playing && st.previewHadFrame) {
                if (this.genEditPreviewEmpty) this.genEditPreviewEmpty.hidden = true;
                this._scheduleGenEditPreview();
                return;
            }
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, w, h);
            st.previewHadFrame = false;
            if (this.genEditPreviewEmpty) this.genEditPreviewEmpty.hidden = false;
            if (playing) this._scheduleGenEditPreview();
            return;
        }

        // Same path as main program monitor: offscreen draw → hold frame while seeking.
        let off = st.previewOffscreen;
        if (!off || off.width !== w || off.height !== h) {
            off = document.createElement("canvas");
            off.width = w;
            off.height = h;
            st.previewOffscreen = off;
        }
        const octx = off.getContext("2d");
        if (!octx) return;
        octx.setTransform(1, 0, 0, 1, 0, 0);
        octx.fillStyle = "#000";
        octx.fillRect(0, 0, w, h);
        const drew = this._drawPreviewLayersOnce(octx, w, h, t, {
            onVideoUsed: (key) => usedVideoKeys.add(key),
            layers,
            fit: "contain",
        });
        this._pauseUnusedPreviewVideos(usedVideoKeys);

        if (drew) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.drawImage(off, 0, 0);
            st.previewHadFrame = true;
            st.previewDrawnTime = t;
        } else if (playing && st.previewHadFrame) {
            this._scheduleGenEditPreview();
        } else if (sizeChanged || !st.previewHadFrame) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, w, h);
            st.previewHadFrame = false;
            st.previewDrawnTime = t;
        }

        if (this.genEditPreviewEmpty) {
            this.genEditPreviewEmpty.hidden = !!st.previewHadFrame;
        }
        if (playing) this._scheduleGenEditPreview();
    }

    /** Layers for gen-edit modal — same shape as main generated preview layers. */
    _collectGenEditPreviewLayers(t) {
        const st = this._genEditState;
        if (!st) return [];
        const clipDur = this._genEditParentDuration();
        if (!(t < clipDur - 1e-9)) return [];
        const hostClip = {
            startTime: 0,
            duration: clipDur,
            sourceOffset: 0,
            name: this._findClipById(st.clipId)?.name || DEFAULT_CLIP_NAME,
        };
        const layers = [];
        // draft is newest-first; paint older first so newest ends on top.
        for (const gen of [...st.draft].reverse()) {
            if (gen.enabled === false || !gen.file) continue;
            const start = Math.max(0, Number(gen.edit_start_sec) || 0);
            let eff = this._genEffectiveDurationSec(gen);
            if (!(eff > 0)) {
                const tin0 = Math.max(0, Number(gen.trim_in_sec) || 0);
                const full = Number(gen.duration_sec);
                eff = Number.isFinite(full) && full > tin0
                    ? Math.min(full - tin0, Math.max(0.05, clipDur - start))
                    : Math.max(0.05, clipDur - start);
            }
            if (t < start - 1e-6 || t >= start + eff - 1e-9) continue;
            layers.push({
                kind: "generated",
                clip: hostClip,
                file: gen.file,
                muted: gen.muted === true,
                trimInSec: Math.max(0, Number(gen.trim_in_sec) || 0),
                editStartSec: start,
            });
        }
        return layers;
    }

    _destroyGenEditTimeline() {
        const st = this._genEditState;
        this._stopGenEditAudioPlayback();
        if (st?.previewRaf) {
            cancelAnimationFrame(st.previewRaf);
            st.previewRaf = 0;
        }
        if (st) {
            st.previewOffscreen = null;
            st.previewHadFrame = false;
        }
        if (st?.timeline) {
            try { st.timeline.pause?.(); } catch { /* ignore */ }
            try { st.timeline.destroy?.(); } catch { /* ignore */ }
            st.timeline = null;
        }
        this._pauseUnusedPreviewVideos(new Set());
        this.genEditTlHost?.replaceChildren();
    }

    async _ensureGenVideoAudioBuffer(file, location = "output") {
        const rel = String(file || "").replace(/\\/g, "/").replace(/^\/+/, "");
        if (!rel) return null;
        const key = `${location}:${rel}`;
        if (this._genAudioBufferCache.has(key)) return this._genAudioBufferCache.get(key);
        const p = (async () => {
            try {
                const url = location === "output"
                    ? this._outputVideoUrl(rel)
                    : (this._audioUrl(rel) || this._videoUrl(rel));
                if (!url) return null;
                const r = await this._fetchPeaks(url);
                return r?.buffer || null;
            } catch {
                return null;
            }
        })();
        this._genAudioBufferCache.set(key, p);
        return p;
    }

    _stopGenEditAudioPlayback() {
        for (const row of this._genEditAudioSources || []) {
            const src = row?.src ?? row;
            const gain = row?.gain;
            try { src.stop(); } catch { /* already stopped */ }
            try { src.disconnect(); } catch { /* already disconnected */ }
            if (gain) {
                try { gain.disconnect(); } catch { /* already disconnected */ }
            }
        }
        this._genEditAudioSources = [];
    }

    /**
     * Gen-edit audio via Web Audio. Canvas <video> decoders stay muted.
     * Prefer detached audioDraft clips in the modal; else unmuted video audio.
     */
    async _startGenEditAudioPlayback() {
        this._stopGenEditAudioPlayback();
        const st = this._genEditState;
        const tl = st?.timeline;
        if (!st || !tl || !tl._playing) return;
        const ctx = this._ensurePlaybackContext();
        const startCtxTime = ctx.currentTime + 0.03;
        const startPlayhead = tl.currentTime;
        const clipDur = this._genEditParentDuration();
        const sources = [];
        const token = (st._audioPlayToken = (st._audioPlayToken || 0) + 1);

        const jobs = [];
        const audioTrackMuted = (tl.tracks || []).some((t) => t.type === "audio" && t.muted);
        for (const row of st.audioDraft || []) {
            if (audioTrackMuted || row.muted === true || !row.file) continue;
            const start = Math.max(0, Number(row.edit_start_sec) || 0);
            const end = Math.min(clipDur, start + Math.max(0.05, Number(row.duration) || 0.05));
            if (end <= startPlayhead + 1e-6) continue;
            jobs.push({
                file: row.file,
                location: "input",
                tin: Math.max(0, Number(row.source_offset) || 0),
                start,
                end,
            });
        }
        if (!jobs.length) {
            // Fallback: embedded audio from unmuted generated videos.
            for (const gen of st.draft) {
                if (gen.enabled === false || gen.muted === true || !gen.file) continue;
                const start = Math.max(0, Number(gen.edit_start_sec) || 0);
                let eff = this._genEffectiveDurationSec(gen);
                if (!(eff > 0)) {
                    const tin0 = Math.max(0, Number(gen.trim_in_sec) || 0);
                    const full = Number(gen.duration_sec);
                    eff = Number.isFinite(full) && full > tin0
                        ? Math.min(full - tin0, Math.max(0.05, clipDur - start))
                        : Math.max(0.05, clipDur - start);
                }
                const end = Math.min(clipDur, start + eff);
                if (end <= startPlayhead + 1e-6) continue;
                if (startPlayhead >= start - 1e-6 && startPlayhead < end - 1e-9) {
                    jobs.push({
                        file: gen.file,
                        location: "output",
                        tin: Math.max(0, Number(gen.trim_in_sec) || 0),
                        start,
                        end,
                    });
                    break;
                }
            }
        }

        for (const job of jobs) {
            const buffer = await this._ensureGenVideoAudioBuffer(job.file, job.location);
            if (!buffer || st._audioPlayToken !== token || !tl._playing) return;
            const src = ctx.createBufferSource();
            src.buffer = buffer;
            const gain = ctx.createGain();
            src.connect(gain);
            gain.connect(ctx.destination);
            gain.gain.setValueAtTime(1, startCtxTime);

            let when;
            let offset;
            let dur;
            if (job.start <= startPlayhead) {
                when = startCtxTime;
                offset = job.tin + (startPlayhead - job.start);
                dur = job.end - startPlayhead;
            } else {
                when = startCtxTime + (job.start - startPlayhead);
                offset = job.tin;
                dur = job.end - job.start;
            }
            const maxOff = Math.max(0, buffer.duration - 0.001);
            offset = Math.max(0, Math.min(offset, maxOff));
            dur = Math.max(0.001, Math.min(dur, Math.max(0.001, buffer.duration - offset)));
            try {
                src.start(when, offset, dur);
                sources.push({ src, gain });
            } catch { /* ignore */ }
        }
        this._genEditAudioSources = sources;
    }

    _applyGenEditChanges() {
        const st = this._genEditState;
        const clip = this._findClipById(st?.clipId);
        if (!st || !clip) return;
        const m = this._ensureClipMeta(clip);
        const videos = st.draft.map((g) => ({ ...g }));
        const audios = this._normalizeGenEditAudioDraft(st.audioDraft);
        if (JSON.stringify(m.generatedVideos || []) === JSON.stringify(videos)
            && JSON.stringify(m.genEditAudios || []) === JSON.stringify(audios)) return;
        if (!st.undoRecorded) {
            this._recordUndo();
            st.undoRecorded = true;
        }
        m.generatedVideos = videos;
        m.genEditAudios = audios;
        if (this._firstEnabledGeneratedVideo(m)) m.previewMode = "generated";
        this._meta.set(clip.id, m);
        this._decorateClip(clip);
        this._syncClipPrimaryAppearance(clip, { refreshVideo: true });
        this._updateEditModeToolbar();
        if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
        this._saveToWidgets();
        this._scheduleProgramPreview();
    }

    _closeGenEditModal() {
        this._destroyGenEditTimeline();
        this._genEditState = null;
        if (this._timeline) this._timeline._keyboardSuspended = false;
        if (this.genEditModal) this.genEditModal.hidden = true;
        this._scheduleProgramPreview();
    }

    _clipGeneratedAudios(meta) {
        const rows = Array.isArray(meta?.generatedAudios) ? meta.generatedAudios : [];
        return rows.map((row) => normalizeGeneratedAudio(row)).filter(Boolean);
    }

    _firstEnabledGeneratedAudio(meta) {
        return this._clipGeneratedAudios(meta).find((row) => row.enabled !== false) || null;
    }

    _generatedAudioUrl(file) {
        const rel = String(file || "").replace(/\\/g, "/").replace(/^\/+/, "");
        if (!rel) return "";
        if (rel.includes("/")) return this._outputVideoUrl(rel) || this._audioUrl(rel);
        return this._audioUrl(rel) || this._outputVideoUrl(rel);
    }

    _attachPromptCopyButtons(root) {
        if (!root) return;
        const selector = [
            ".cat-te-settings-prompt-input",
            ".cat-te-prompt-input",
            ".cat-te-ai-prompt-input",
            ".cat-te-vo-prompt",
            ".cat-te-vo-style-prompt",
            ".cat-te-vo-edit-prompt",
            ".cat-te-media-preview-desc",
            ".cat-te-gen-edit-prompt",
            ".cat-te-ai-src-text",
            ".cat-te-ai-system",
            ".cat-te-ai-skill",
            ".cat-te-ai-result",
        ].join(",");
        for (const ta of root.querySelectorAll(selector)) {
            if (!(ta instanceof HTMLTextAreaElement) || ta.dataset.promptCopyAttached === "1") continue;
            ta.dataset.promptCopyAttached = "1";

            let host = ta.parentElement;
            const reuseHost = host && (
                host.classList.contains("cat-te-prompt-input-wrap")
                || host.classList.contains("cat-te-media-preview-desc-wrap")
                || host.classList.contains("cat-te-prompt-copy-host")
            );
            if (!reuseHost) {
                host = document.createElement("div");
                host.className = "cat-te-prompt-copy-host";
                ta.parentNode.insertBefore(host, ta);
                host.appendChild(ta);
            } else {
                host.classList.add("cat-te-prompt-copy-host");
            }

            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "cat-te-prompt-copy-btn";
            btn.title = T("copy_prompt_title");
            btn.setAttribute("aria-label", T("copy_prompt_title"));
            btn.innerHTML = iconHtml("copy", 12);
            btn.addEventListener("mousedown", (e) => e.preventDefault());
            btn.addEventListener("click", async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const text = ta.value ?? "";
                let ok = false;
                try {
                    if (navigator.clipboard?.writeText) {
                        await navigator.clipboard.writeText(text);
                        ok = true;
                    }
                } catch {
                    ok = false;
                }
                if (!ok) {
                    const prev = ta.selectionStart;
                    const prevEnd = ta.selectionEnd;
                    ta.focus();
                    ta.select();
                    try {
                        ok = document.execCommand("copy");
                    } catch {
                        ok = false;
                    }
                    try {
                        ta.setSelectionRange(prev, prevEnd);
                    } catch {
                        /* ignore */
                    }
                }
                if (!ok) return;
                btn.classList.add("is-copied");
                btn.title = T("copy_prompt_done_title");
                btn.innerHTML = iconHtml("check", 12);
                clearTimeout(btn._copyResetTimer);
                btn._copyResetTimer = setTimeout(() => {
                    btn.classList.remove("is-copied");
                    btn.title = T("copy_prompt_title");
                    btn.innerHTML = iconHtml("copy", 12);
                }, 1200);
            });
            host.appendChild(btn);
        }
    }

    _onVoiceoverPromptInput() {
        const clip = this._selClip;
        if (!clip || !isVoiceoverTrackType(clip.track?.type)) return;
        if (this._voPromptUndoArmed) {
            this._recordUndo();
            this._voPromptUndoArmed = false;
        }
        const m = this._ensureClipMeta(clip);
        m.prompt = this.voPromptInput?.value ?? "";
        m.stylePrompt = this.voStylePromptInput?.value ?? "";
        this._meta.set(clip.id, m);
    }

    _fillVoiceoverPanel(meta) {
        if (!meta) return;
        if (this.voPromptInput) setRichPromptValue(this.voPromptInput, meta.prompt ?? "", true);
        if (this.voStylePromptInput) setRichPromptValue(this.voStylePromptInput, meta.stylePrompt ?? "", true);
        this._renderVoiceoverAudiosList(this._selClip, meta);
    }

    _renderVoiceoverAudiosList(clip, meta) {
        if (!this.voAudiosList) return;
        const rows = this._clipGeneratedAudios(meta);
        this.voAudiosList.replaceChildren();
        for (const [index, row] of rows.entries()) {
            const item = document.createElement("div");
            item.className = "cat-te-clip-video-row cat-te-vo-audio-row";
            if (!row.enabled) item.classList.add("is-disabled");

            const enable = document.createElement("input");
            enable.type = "checkbox";
            enable.className = "cat-te-clip-video-enabled";
            enable.checked = row.enabled !== false;
            enable.title = row.enabled ? T("disable_label") : T("enable_label");
            enable.addEventListener("click", (e) => e.stopPropagation());
            enable.addEventListener("change", () => {
                this._setGeneratedAudioEnabled(clip, row.id, !!enable.checked);
            });

            const icon = document.createElement("div");
            icon.className = "cat-te-vo-audio-icon";
            icon.innerHTML = iconHtml("micVocal", 16) || "♫";

            const name = document.createElement("button");
            name.type = "button";
            name.className = "cat-te-clip-video-name";
            name.textContent = String(row.file || "").split(/[\\/]/).pop() || T("asset_fallback_name");
            name.title = row.file || "";
            name.addEventListener("click", () => this._previewGeneratedAudio(clip, index));

            const up = document.createElement("button");
            up.type = "button";
            up.className = "cat-te-vo-audio-move";
            up.title = T("move_up_title");
            up.innerHTML = iconHtml("arrowUp", 12);
            up.disabled = index === 0;
            up.addEventListener("click", (e) => {
                e.stopPropagation();
                this._moveGeneratedAudio(clip, row.id, -1);
            });

            const down = document.createElement("button");
            down.type = "button";
            down.className = "cat-te-vo-audio-move";
            down.title = T("move_down_title");
            down.innerHTML = iconHtml("arrowDown", 12);
            down.disabled = index >= rows.length - 1;
            down.addEventListener("click", (e) => {
                e.stopPropagation();
                this._moveGeneratedAudio(clip, row.id, 1);
            });

            const mute = document.createElement("button");
            mute.type = "button";
            mute.className = "cat-te-clip-video-mute";
            const muted = row.muted === true;
            mute.innerHTML = muted ? ICONS.volumeOff : ICONS.volume;
            mute.classList.toggle("active", muted);
            mute.title = muted ? T("unmute_label") : T("mute_label");
            mute.addEventListener("click", (e) => {
                e.stopPropagation();
                this._setGeneratedAudioMuted(clip, row.id, !muted);
            });

            const del = document.createElement("button");
            del.type = "button";
            del.className = "cat-te-clip-video-del";
            del.title = T("delete_btn");
            del.textContent = "×";
            del.addEventListener("click", (e) => {
                e.stopPropagation();
                this._deleteGeneratedAudio(clip, row.id);
            });

            item.append(enable, icon, name, up, down, mute, del);
            this.voAudiosList.appendChild(item);
        }
    }

    _setGeneratedAudioEnabled(clip, audioId, enabled) {
        if (!clip) return;
        const m = this._ensureClipMeta(clip);
        m.generatedAudios = this._clipGeneratedAudios(m);
        const row = m.generatedAudios.find((item) => item.id === audioId);
        if (!row || row.enabled === enabled) return;
        this._recordUndo();
        row.enabled = enabled;
        this._meta.set(clip.id, m);
        this._decorateClip(clip);
        this._scheduleProgramPreview();
        if (this._selClip?.id === clip.id) this._fillVoiceoverPanel(m);
        this._saveToWidgets();
    }

    _setGeneratedAudioMuted(clip, audioId, muted) {
        if (!clip) return;
        const m = this._ensureClipMeta(clip);
        m.generatedAudios = this._clipGeneratedAudios(m);
        const row = m.generatedAudios.find((item) => item.id === audioId);
        if (!row || row.muted === muted) return;
        this._recordUndo();
        row.muted = muted === true;
        this._meta.set(clip.id, m);
        this._scheduleProgramPreview();
        if (this._timeline?._playing) this._startAudioPlayback();
        if (this._selClip?.id === clip.id) this._fillVoiceoverPanel(m);
        this._saveToWidgets();
    }

    _deleteGeneratedAudio(clip, audioId) {
        if (!clip) return;
        const m = this._ensureClipMeta(clip);
        const before = this._clipGeneratedAudios(m);
        const row = before.find((item) => item.id === audioId);
        if (!row) return;
        const name = String(row.file || "").split(/[\\/]/).pop();
        this._openDeleteConfirm(T("confirm_remove_from_clip", { name }), () => this._removeGeneratedAudio(clip, audioId));
    }

    _removeGeneratedAudio(clip, audioId) {
        if (!clip) return;
        const m = this._ensureClipMeta(clip);
        const before = this._clipGeneratedAudios(m);
        const next = before.filter((item) => item.id !== audioId);
        if (next.length === before.length) return;
        this._recordUndo();
        m.generatedAudios = next;
        this._meta.set(clip.id, m);
        this._decorateClip(clip);
        this._scheduleProgramPreview();
        if (this._selClip?.id === clip.id) this._fillVoiceoverPanel(m);
        this._saveToWidgets();
    }

    _moveGeneratedAudio(clip, audioId, delta) {
        if (!clip || !delta) return;
        const m = this._ensureClipMeta(clip);
        const rows = this._clipGeneratedAudios(m);
        const i = rows.findIndex((item) => item.id === audioId);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= rows.length) return;
        this._recordUndo();
        const [row] = rows.splice(i, 1);
        rows.splice(j, 0, row);
        m.generatedAudios = rows;
        this._meta.set(clip.id, m);
        if (this._selClip?.id === clip.id) this._fillVoiceoverPanel(m);
        this._saveToWidgets();
    }

    _addGeneratedAudiosToClip(clip, files, { recordUndo = true } = {}) {
        if (!clip || !isVoiceoverTrackType(clip.track?.type)) return false;
        const list = (Array.isArray(files) ? files : [files])
            .map((f) => normalizeGeneratedAudio(f))
            .filter(Boolean);
        if (!list.length) return false;
        const m = this._ensureClipMeta(clip);
        const existing = this._clipGeneratedAudios(m);
        const have = new Set(existing.map((r) => normalizeOutputVideoPath(r.file) || r.file));
        const added = [];
        for (const row of list) {
            const key = normalizeOutputVideoPath(row.file) || row.file;
            if (!key || have.has(key)) continue;
            have.add(key);
            added.push(row);
        }
        if (!added.length) return false;
        if (recordUndo) this._recordUndo();
        m.generatedAudios = [...existing, ...added];
        this._meta.set(clip.id, m);
        this._decorateClip(clip);
        if (this._selClip?.id === clip.id) this._fillVoiceoverPanel(m);
        this._saveToWidgets();
        this._scheduleProgramPreview();
        return true;
    }

    _previewGeneratedAudio(clip, index) {
        const m = this._ensureClipMeta(clip);
        const rows = this._clipGeneratedAudios(m);
        const row = rows[index];
        if (!row?.file) return;
        const url = this._generatedAudioUrl(row.file);
        if (!url) return;
        // Reuse media preview stage as a simple audio player.
        if (!this.mediaPreviewModal || !this.mediaPreviewStage) {
            const a = new Audio(url);
            void a.play().catch(() => {});
            return;
        }
        this.mediaPreviewModal.hidden = false;
        if (this.mediaPreviewTitle) {
            this.mediaPreviewTitle.textContent = String(row.file).split(/[\\/]/).pop() || T("gen_audio_label");
        }
        this.mediaPreviewStage.replaceChildren();
        const audio = document.createElement("audio");
        audio.controls = true;
        audio.preload = "metadata";
        audio.src = url;
        audio.style.maxWidth = "100%";
        this.mediaPreviewStage.appendChild(audio);
        void audio.play().catch(() => {});
    }

    _voiceoverParentDuration(clip) {
        const m = this._ensureClipMeta(clip);
        return Math.max(0.05, Number(m.resourceDurationSec) || Number(clip.duration) || 0.05);
    }

    async _ensureGeneratedAudioDuration(row) {
        if (!row || (Number.isFinite(Number(row.duration_sec)) && row.duration_sec > 0)) return;
        const url = this._generatedAudioUrl(row.file);
        if (!url) return;
        try {
            const dur = await this._probeAudioDuration(url);
            if (Number.isFinite(dur) && dur > 0) row.duration_sec = dur;
        } catch { /* keep null */ }
    }

    async _openVoiceoverEditModal(clip) {
        if (!this.voEditModal || !clip || !isVoiceoverTrackType(clip.track?.type)) return;
        const m = this._ensureClipMeta(clip);
        const rows = this._clipGeneratedAudios(m);
        if (!rows.length) {
            alert(T("voiceover_edit_no_audio"));
            return;
        }
        this._closeVoiceoverEditModal(false);
        const draft = rows.map((r) => normalizeGeneratedAudio(r)).filter(Boolean);
        await Promise.all(draft.map((g) => this._ensureGeneratedAudioDuration(g)));
        const clipDur = this._voiceoverParentDuration(clip);
        for (const g of draft) {
            const tin = Math.max(0, Number(g.trim_in_sec) || 0);
            const full = Number(g.duration_sec);
            let eff = Number.isFinite(full) && full > tin
                ? (g.trim_out_sec != null && Number(g.trim_out_sec) > tin
                    ? Number(g.trim_out_sec) - tin
                    : full - tin)
                : clipDur;
            let start = Math.max(0, Number(g.edit_start_sec) || 0);
            if (start >= clipDur) start = 0;
            const maxDur = Math.max(0.05, clipDur - start);
            if (eff > maxDur) {
                eff = maxDur;
                g.trim_out_sec = tin + eff;
            }
            g.edit_start_sec = start;
        }
        this._voEditState = {
            clipId: clip.id,
            draft,
            selectedId: draft[0]?.id || null,
            clipMap: new Map(),
        };
        if (this.voEditTitle) {
            this.voEditTitle.textContent = T("voiceover_edit_modal_title_named", {
                name: clip.name || T("voiceover_clip_default_name"),
            });
        }
        this.voEditModal.hidden = false;
        try { this._timeline?.pause?.(); } catch { /* ignore */ }
        if (this._timeline) this._timeline._keyboardSuspended = true;
        await this._buildVoiceoverEditTimeline();
        this._syncVoiceoverEditInspector();
    }

    async _buildVoiceoverEditTimeline() {
        const st = this._voEditState;
        if (!st || !this.voEditTlHost) return;
        this._destroyVoiceoverEditTimeline();
        const parent = this._findClipById(st.clipId);
        const clipDur = parent ? this._voiceoverParentDuration(parent) : 1;
        const fps = this.getFps();
        const tl = new Timeline(this.voEditTlHost, {
            duration: clipDur,
            fps,
            timeFormat: "frames",
            zoom: 1.4,
            addTrackTypes: [],
        });
        tl.toolbarEl?.querySelector(".tl-btn-add-track")?.remove();
        tl.toolbarEl?.querySelector(".tl-btn-history")?.remove();
        st.timeline = tl;
        st.clipMap = new Map();

        for (let i = 0; i < st.draft.length; i++) {
            const gen = st.draft[i];
            const track = tl.addTrack({
                type: "audio",
                name: (gen.file || "").split(/[\\/]/).pop() || T("gen_audio_label"),
                isMain: false,
                height: trackHeightFor("audio"),
                color: "#5bc0de",
            });
            track.setMuted(gen.muted === true);
            track.setVisible(gen.enabled !== false);
            this._setupVoiceoverEditTrackControls(track, gen.id);

            const tin = Math.max(0, Number(gen.trim_in_sec) || 0);
            const full = Number(gen.duration_sec);
            let eff = Number.isFinite(full) && full > tin
                ? (gen.trim_out_sec != null && Number(gen.trim_out_sec) > tin
                    ? Number(gen.trim_out_sec) - tin
                    : full - tin)
                : Math.max(0.05, clipDur - (Number(gen.edit_start_sec) || 0));
            const start = Math.max(0, Math.min(clipDur - 0.05, Number(gen.edit_start_sec) || 0));
            const dur = Math.max(0.05, Math.min(eff, clipDur - start));
            const url = this._generatedAudioUrl(gen.file);
            let peaks = null;
            if (url) {
                try {
                    const r = await this._fetchPeaks(url);
                    peaks = r.peaks[0];
                    if (!(Number.isFinite(full) && full > 0) && Number.isFinite(r.duration)) {
                        gen.duration_sec = r.duration;
                    }
                } catch { /* placeholder wave */ }
            }
            const c = track.addClip({
                name: (gen.file || "").split(/[\\/]/).pop() || T("gen_audio_label"),
                startTime: start,
                duration: dur,
                sourceOffset: tin,
                sourceDuration: Number.isFinite(Number(gen.duration_sec)) && gen.duration_sec > 0
                    ? gen.duration_sec
                    : Infinity,
                src: gen.file || "",
                waveformPeaks: peaks || undefined,
                fadeIn: Math.max(0, Number(gen.fade_in_sec) || 0),
                fadeOut: Math.max(0, Number(gen.fade_out_sec) || 0),
                color: "#5bc0de",
            });
            if (c) {
                st.clipMap.set(c.id, gen.id);
                c.el.dataset.genId = gen.id;
                c._clampFades?.();
                c._updateFadeUI?.();
            }
        }
        tl.duration = clipDur;
        tl._refresh?.();

        tl.on("clip:select", ({ clip: c }) => {
            const gid = st.clipMap.get(c?.id) || c?.el?.dataset?.genId;
            if (gid) {
                st.selectedId = gid;
                this._syncVoiceoverEditInspector();
            }
        });
        tl.on("clip:moveend", () => this._pullVoiceoverEditDraftFromTimeline());
        tl.on("clip:resizeend", () => this._pullVoiceoverEditDraftFromTimeline());
        tl.on("clip:fadeend", () => this._pullVoiceoverEditDraftFromTimeline());
        if (st.draft[0]) {
            const first = [...st.clipMap.entries()].find(([, gid]) => gid === st.selectedId)
                || [...st.clipMap.entries()][0];
            if (first) {
                const c = tl.tracks.flatMap((t) => t.clips).find((x) => x.id === first[0]);
                if (c) tl.selectClip(c);
            }
        }
    }

    _setupVoiceoverEditTrackControls(track, genId) {
        const actions = track.actionsEl;
        if (!actions) return;
        actions.replaceChildren();
        const makeBtn = (kind) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "cat-te-track-btn";
            if (kind === "lock") {
                const render = () => {
                    btn.innerHTML = track.locked ? ICONS.lock : ICONS.lockOpen;
                    btn.classList.toggle("active", track.locked);
                    btn.title = track.locked ? T("unlock_track_title") : T("lock_track_title");
                };
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    track.setLocked(!track.locked);
                    render();
                });
                render();
            } else if (kind === "visible") {
                const render = () => {
                    btn.innerHTML = track.visible ? ICONS.eye : ICONS.eyeOff;
                    btn.classList.toggle("active", !track.visible);
                    btn.title = T("track_visibility_title");
                };
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const st = this._voEditState;
                    const row = st?.draft?.find((g) => g.id === genId);
                    if (!row) return;
                    row.enabled = !(row.enabled !== false);
                    track.setVisible(row.enabled !== false);
                    render();
                });
                render();
            } else if (kind === "mute") {
                const render = () => {
                    btn.innerHTML = track.muted ? ICONS.volumeOff : ICONS.volume;
                    btn.classList.toggle("active", track.muted);
                    btn.title = track.muted ? T("unmute_label") : T("mute_label");
                };
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const st = this._voEditState;
                    const row = st?.draft?.find((g) => g.id === genId);
                    if (!row) return;
                    row.muted = !row.muted;
                    track.setMuted(!!row.muted);
                    render();
                });
                render();
            }
            return btn;
        };
        actions.append(makeBtn("lock"), makeBtn("visible"), makeBtn("mute"));
    }

    _pullVoiceoverEditDraftFromTimeline() {
        const st = this._voEditState;
        const tl = st?.timeline;
        if (!st || !tl) return;
        const parent = this._findClipById(st.clipId);
        const clipDur = parent ? this._voiceoverParentDuration(parent) : tl.duration;
        tl.duration = clipDur;
        const next = [];
        for (const track of tl.tracks) {
            for (const c of [...track.clips].sort((a, b) => a.startTime - b.startTime)) {
                const gid = st.clipMap.get(c.id) || c.el?.dataset?.genId;
                const prev = st.draft.find((g) => g.id === gid);
                if (!prev) continue;
                const tin = Math.max(0, Number(c.sourceOffset) || 0);
                const dur = Math.max(0.05, Number(c.duration) || 0.05);
                next.push({
                    ...prev,
                    edit_start_sec: Math.max(0, Number(c.startTime) || 0),
                    trim_in_sec: tin,
                    trim_out_sec: tin + dur,
                    fade_in_sec: Math.max(0, Number(c.fadeIn) || 0),
                    fade_out_sec: Math.max(0, Number(c.fadeOut) || 0),
                    enabled: track.visible !== false,
                    muted: !!track.muted,
                    duration_sec: Number.isFinite(Number(c.sourceDuration)) && c.sourceDuration > 0
                        ? c.sourceDuration
                        : prev.duration_sec,
                });
            }
        }
        if (next.length) st.draft = next;
        this._syncVoiceoverEditInspector();
    }

    _syncVoiceoverEditInspector() {
        const st = this._voEditState;
        const row = st?.draft?.find((g) => g.id === st.selectedId) || st?.draft?.[0];
        if (this.voEditNameEl) {
            this.voEditNameEl.textContent = row
                ? (String(row.file || "").split(/[\\/]/).pop() || T("gen_audio_label"))
                : "";
            this.voEditNameEl.title = row?.file || "";
        }
        if (this.voEditFileEl) {
            this.voEditFileEl.textContent = row?.file || "";
            this.voEditFileEl.title = row?.file || "";
        }
        if (this.voEditPrompt) {
            this.voEditPrompt.value = row?.prompt || "";
            this.voEditPrompt.disabled = !row;
        }
        if (this.voEditAudio) {
            const url = row?.file ? this._generatedAudioUrl(row.file) : "";
            if (url) {
                if (this.voEditAudio.src !== url) this.voEditAudio.src = url;
                this.voEditAudio.hidden = false;
                if (this.voEditPreviewEmpty) this.voEditPreviewEmpty.hidden = true;
            } else {
                this.voEditAudio.removeAttribute("src");
                this.voEditAudio.hidden = true;
                if (this.voEditPreviewEmpty) this.voEditPreviewEmpty.hidden = false;
            }
        }
    }

    _onVoiceoverEditPromptInput() {
        const st = this._voEditState;
        if (!st) return;
        const row = st.draft.find((g) => g.id === st.selectedId);
        if (!row) return;
        row.prompt = this.voEditPrompt?.value ?? "";
    }

    _destroyVoiceoverEditTimeline() {
        const st = this._voEditState;
        try { st?.timeline?.destroy?.(); } catch { /* ignore */ }
        if (st) st.timeline = null;
        this.voEditTlHost?.replaceChildren();
        if (this.voEditAudio) {
            try { this.voEditAudio.pause(); } catch { /* ignore */ }
            this.voEditAudio.removeAttribute("src");
        }
    }

    _closeVoiceoverEditModal(save) {
        const st = this._voEditState;
        if (!st) {
            if (this._timeline) this._timeline._keyboardSuspended = false;
            if (this.voEditModal) this.voEditModal.hidden = true;
            return;
        }
        if (save) {
            this._pullVoiceoverEditDraftFromTimeline();
            const clip = this._findClipById(st.clipId);
            if (clip) {
                this._recordUndo();
                const m = this._ensureClipMeta(clip);
                m.generatedAudios = st.draft.map((g) => normalizeGeneratedAudio(g)).filter(Boolean);
                this._meta.set(clip.id, m);
                this._decorateClip(clip);
                if (this._selClip?.id === clip.id) this._fillVoiceoverPanel(m);
                this._saveToWidgets();
                this._scheduleProgramPreview();
            }
        }
        this._destroyVoiceoverEditTimeline();
        this._voEditState = null;
        if (this._timeline) this._timeline._keyboardSuspended = false;
        if (this.voEditModal) this.voEditModal.hidden = true;
    }

    _isOutputPickerClip(clip, kind = this._outputPickerKind) {
        if (!clip) return false;
        if (kind === "audio") return isVoiceoverTrackType(clip.track?.type);
        return isDirectorTrackType(clip.track?.type);
    }

    _openOutputVideosPicker(clip) {
        return this._openOutputMediaPicker(clip, "video");
    }

    _openOutputAudiosPicker(clip) {
        return this._openOutputMediaPicker(clip, "audio");
    }

    async _openOutputMediaPicker(clip, kind = "video") {
        if (!this.outputVideosModal || !this._isOutputPickerClip(clip, kind)) return;
        const alreadyOpen = !this.outputVideosModal.hidden;
        const kindChanged = this._outputPickerKind !== kind;
        this._outputPickerKind = kind;
        this._outputVideosClipId = clip.id;
        this._syncOutputPickerChrome();
        this._syncOutputVideosPickerTitle(clip);
        if (!alreadyOpen || kindChanged) {
            this.outputVideosModal.hidden = false;
            if (this.outputVideosFilter) this.outputVideosFilter.value = "";
            this._outputVideosTimeRange = OUTPUT_VIDEOS_TIME_RANGES[0].id;
            this.outputVideosTimeButtons?.forEach((b) => b.classList.toggle("is-active", b.dataset.range === this._outputVideosTimeRange));
            if (this.outputVideosBody) this.outputVideosBody.textContent = T("loading_ellipsis");
            const endpoint = kind === "audio"
                ? "/audio_keyframe_timeline/output_audios"
                : "/audio_keyframe_timeline/output_videos";
            try {
                const response = await fetch(api.apiURL(endpoint));
                const data = await response.json();
                this._outputVideosCache = Array.isArray(data.files) ? data.files : [];
            } catch {
                this._outputVideosCache = [];
            }
        }
        // Drop stale target if the open request finished after a newer selection.
        if (this._outputVideosClipId !== clip.id || this._outputPickerKind !== kind) return;
        this._renderOutputVideosPicker();
    }

    _retargetOutputVideosPickerFromSelection() {
        if (!this.outputVideosModal || this.outputVideosModal.hidden) return;
        const clip = this._selClip;
        if (!this._isOutputPickerClip(clip)) return;
        if (this._outputVideosClipId === clip.id) {
            this._syncOutputVideosPickerTitle(clip);
            return;
        }
        this._outputVideosClipId = clip.id;
        this._syncOutputVideosPickerTitle(clip);
        this._renderOutputVideosPicker();
    }

    _syncOutputPickerChrome() {
        const isAudio = this._outputPickerKind === "audio";
        this.outputVideosModal?.classList.toggle("is-audio-picker", isAudio);
        if (this.outputVideosAutoLinkBtn) {
            this.outputVideosAutoLinkBtn.textContent = isAudio
                ? T("auto_associate_audios_btn")
                : T("auto_associate_videos_btn");
            this.outputVideosAutoLinkBtn.title = isAudio
                ? T("auto_associate_audios_title")
                : T("auto_associate_videos_title");
        }
    }

    _syncOutputVideosPickerTitle(clip = null) {
        if (!this.outputVideosTitle) return;
        const target = clip || this._findClipById(this._outputVideosClipId);
        const name = String(target?.name || "").trim();
        const base = this._outputPickerKind === "audio"
            ? T("linked_generated_audios_title")
            : T("linked_generated_videos_title");
        this.outputVideosTitle.textContent = name ? `${base} · ${name}` : base;
    }

    _bindModalInteractions() {
        const modals = [...this._overlay.querySelectorAll(":scope > .cat-te-modal-backdrop, :scope > .cat-te-floating-panel")];
        this._openModals = [];
        const sync = () => {
            const previous = this._blockingModal;
            this._openModals = this._openModals.filter((modal) => !modal.hidden);
            for (const modal of modals) {
                if (modal.hidden || this._openModals.includes(modal)) continue;
                const dialog = modal.querySelector(".cat-te-ai-optimize-shell, .cat-te-modal");
                dialog.style.position = "";
                dialog.style.left = "";
                dialog.style.top = "";
                this._openModals.push(modal);
            }
            const blocking = this._openModals.filter((modal) => modal !== this.outputVideosModal || modal.classList.contains("is-audio-picker"));
            this._blockingModal = blocking.at(-1) || null;
            for (const modal of this._openModals) {
                modal.style.zIndex = String(modal === this.outputVideosModal && !modal.classList.contains("is-audio-picker")
                    ? 100009 : 100010 + blocking.indexOf(modal));
            }
            for (const child of this._overlay.children) child.inert = !!this._blockingModal && child !== this._blockingModal;
            if (this._timeline) this._timeline._keyboardSuspended = !!this._blockingModal;
            if (previous !== this._blockingModal) {
                if (this._blockingModal) {
                    if (!this._blockingModal.contains(document.activeElement)) this._blockingModal.querySelector(".cat-te-modal-close")?.focus();
                } else if (previous) this._overlay.focus();
            }
        };
        this._modalObserver = new MutationObserver((records) => {
            for (const record of records) {
                if (record.attributeName === "hidden" && record.oldValue === null) {
                    this._openModals = this._openModals.filter((modal) => modal !== record.target);
                }
            }
            sync();
        });
        for (const modal of modals) {
            this._modalObserver.observe(modal, { attributes: true, attributeFilter: ["hidden", "class"], attributeOldValue: true });
            const dialog = modal.querySelector(".cat-te-modal");
            const dragTarget = dialog.closest(".cat-te-ai-optimize-shell") || dialog;
            const handle = dialog.querySelector(".cat-te-modal-header");
            handle.addEventListener("pointerdown", (e) => {
                if (e.button !== 0 || e.target.closest("button, input, select, textarea, a, [contenteditable='true']")) return;
                e.preventDefault();
                const rect = dragTarget.getBoundingClientRect();
                const ox = e.clientX - rect.left;
                const oy = e.clientY - rect.top;
                handle.setPointerCapture(e.pointerId);
                dialog.classList.add("is-dragging");
                const move = (event) => {
                    dragTarget.style.position = "fixed";
                    dragTarget.style.left = `${Math.max(8, Math.min(window.innerWidth - rect.width - 8, event.clientX - ox))}px`;
                    dragTarget.style.top = `${Math.max(8, Math.min(window.innerHeight - rect.height - 8, event.clientY - oy))}px`;
                };
                const end = () => {
                    dialog.classList.remove("is-dragging");
                    handle.removeEventListener("pointermove", move);
                    handle.removeEventListener("lostpointercapture", end);
                };
                handle.addEventListener("pointermove", move);
                handle.addEventListener("lostpointercapture", end);
            });
        }
        sync();
    }

    handleModalKey(e) {
        const modal = this._blockingModal;
        if (!modal || !this._overlay?.classList.contains("open")) return false;
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopImmediatePropagation();
            modal.querySelector(".cat-te-modal-close")?.click();
            return true;
        }
        if (e.key === "Tab") {
            const fields = [...modal.querySelectorAll("button, input, select, textarea, a[href], [tabindex]")]
                .filter((field) => !field.disabled && field.tabIndex >= 0 && field.getClientRects().length);
            const next = e.shiftKey ? fields.at(-1) : fields[0];
            if (!modal.contains(document.activeElement) || document.activeElement === (e.shiftKey ? fields[0] : fields.at(-1))) {
                e.preventDefault();
                next?.focus();
            }
        }
        if (modal === this.genEditModal && this.handleGenEditKey(e)) return true;
        if (modal === this.mediaPreviewModal && this.handleMediaPreviewKey(e)) return true;
        if (modal === this.aiOptimizeModal && this.handleAiOptimizeKey(e)) return true;
        const typing = e.target?.closest?.("input, textarea, select, [contenteditable='true']");
        if (!typing && (e.key === "Delete" || e.key === "Backspace" || ((e.ctrlKey || e.metaKey) && ["z", "y", "v", "b", "g"].includes(e.key.toLowerCase())))) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
        return true;
    }

    _closeOutputVideosPicker() {
        this._hideOutputVideoHoverPreview();
        this._outputVideosClipId = null;
        this._outputPickerKind = "video";
        this._outputVideosThumbIo?.disconnect();
        this._outputVideosThumbIo = null;
        if (this.outputVideosModal) {
            this.outputVideosModal.hidden = true;
            this.outputVideosModal.classList.remove("is-audio-picker");
        }
        this.outputVideosBody?.replaceChildren();
        this._syncOutputPickerChrome();
        this._syncOutputVideosPickerTitle(null);
    }

    /** Files already linked on any visual clip (normalized output paths). */
    _allLinkedGeneratedVideoFiles() {
        const have = new Set();
        for (const track of this._timeline?.tracks ?? []) {
            if (track.type === "audio" || isVoiceoverTrackType(track.type) || isSubtitleTrackType(track.type)) continue;
            for (const clip of track.clips) {
                for (const row of this._clipGeneratedVideos(this._meta.get(clip.id))) {
                    const n = normalizeOutputVideoPath(row.file) || row.file;
                    if (n) have.add(n);
                }
            }
        }
        return have;
    }

    /** Files already linked on any voiceover clip (normalized output paths). */
    _allLinkedGeneratedAudioFiles() {
        const have = new Set();
        for (const track of this._timeline?.tracks ?? []) {
            if (!isVoiceoverTrackType(track.type)) continue;
            for (const clip of track.clips) {
                for (const row of this._clipGeneratedAudios(this._meta.get(clip.id))) {
                    const n = normalizeOutputVideoPath(row.file) || row.file;
                    if (n) have.add(n);
                }
            }
        }
        return have;
    }

    _clipIdFromSpecifiedAudioPath(file) {
        const n = normalizeOutputVideoPath(file);
        if (!n) return null;
        const m = n.match(/^CapTimelineEditor\/[^/]+\/(\d{8}-\d{6})_(.+)\.(wav|mp3|flac|ogg|m4a|aac|wma)$/i);
        return m ? String(m[2]).trim() || null : null;
    }

    /**
     * Scan output media under CapTimelineEditor/{project}/…_{clipId}.* and
     * link each file to the matching timeline clip. Used when live WS attach
     * was missed (e.g. switched workflows while generating).
     */
    async _autoAssociateOutputMedia() {
        if (!this.outputVideosModal || this.outputVideosModal.hidden) return;
        const isAudio = this._outputPickerKind === "audio";
        const btn = this.outputVideosAutoLinkBtn;
        if (btn?.disabled) return;
        if (btn) {
            btn.disabled = true;
            btn.classList.add("is-loading");
        }
        try {
            const endpoint = isAudio
                ? "/audio_keyframe_timeline/output_audios"
                : "/audio_keyframe_timeline/output_videos";
            try {
                const response = await fetch(api.apiURL(endpoint));
                const data = await response.json();
                this._outputVideosCache = Array.isArray(data.files) ? data.files : [];
            } catch {
                /* keep existing cache */
            }
            const projectPrefix = `CapTimelineEditor/${this._safeProjectFilename()}/`.toLowerCase();
            const already = isAudio
                ? this._allLinkedGeneratedAudioFiles()
                : this._allLinkedGeneratedVideoFiles();
            /** @type {Map<string, string[]>} */
            const byClip = new Map();
            for (const row of this._outputVideosCache || []) {
                const file = normalizeOutputVideoPath(row?.file) || String(row?.file || "").trim();
                if (!file) continue;
                const key = normalizeOutputVideoPath(file) || file;
                if (already.has(key)) continue;
                if (!key.toLowerCase().startsWith(projectPrefix)) continue;
                const clipId = isAudio
                    ? this._clipIdFromSpecifiedAudioPath(key)
                    : this._clipIdFromSpecifiedVideoPath(key);
                if (!clipId || !this._findClipById(clipId)) continue;
                if (isAudio && !isVoiceoverTrackType(this._findClipById(clipId)?.track?.type)) continue;
                if (!isAudio && !this._isOutputPickerClip(this._findClipById(clipId), "video")) continue;
                const list = byClip.get(clipId) || [];
                list.push(key);
                byClip.set(clipId, list);
            }
            let linked = 0;
            if (byClip.size) {
                this._recordUndo();
                for (const [clipId, files] of byClip) {
                    const clip = this._findClipById(clipId);
                    if (!clip) continue;
                    const ok = isAudio
                        ? this._addGeneratedAudiosToClip(clip, files, { recordUndo: false })
                        : this._addGeneratedVideosToClip(clip, files, { recordUndo: false });
                    if (ok) {
                        linked += files.length;
                        for (const f of files) already.add(f);
                    }
                }
            }
            this._renderOutputVideosPicker();
            if (linked > 0) {
                alert(T(isAudio ? "auto_associate_audios_done" : "auto_associate_videos_done", { count: linked }));
            } else {
                alert(T(isAudio ? "auto_associate_audios_none" : "auto_associate_videos_none"));
            }
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.classList.remove("is-loading");
            }
        }
    }

    async _autoAssociateOutputVideos() {
        this._outputPickerKind = "video";
        return this._autoAssociateOutputMedia();
    }

    _cancelOutputVideoHoverHide() {
        if (this._outputVideoHoverHideTimer) {
            clearTimeout(this._outputVideoHoverHideTimer);
            this._outputVideoHoverHideTimer = 0;
        }
    }

    _scheduleOutputVideoHoverHide() {
        this._cancelOutputVideoHoverHide();
        this._outputVideoHoverHideTimer = setTimeout(() => {
            this._outputVideoHoverHideTimer = 0;
            this._hideOutputVideoHoverPreview();
        }, 160);
    }

    _ensureOutputVideoHoverPreview() {
        if (this._outputVideoHoverEl?.isConnected) return this._outputVideoHoverEl;
        this._outputVideoHoverEl = null;
        this._outputVideoHoverVideo = null;
        const host = this._overlay || document.body;
        const el = document.createElement("div");
        el.className = "cat-te-output-video-hover-preview";
        el.hidden = true;
        const video = document.createElement("video");
        video.className = "cat-te-output-video-hover-video";
        video.controls = true;
        video.playsInline = true;
        video.preload = "metadata";
        video.muted = false;
        video.setAttribute("controlsList", "nodownload");
        el.appendChild(video);
        el.addEventListener("mouseenter", () => this._cancelOutputVideoHoverHide());
        el.addEventListener("mouseleave", () => this._scheduleOutputVideoHoverHide());
        // Keep list-row click from firing when interacting with the popup.
        el.addEventListener("mousedown", (e) => e.stopPropagation());
        el.addEventListener("click", (e) => e.stopPropagation());
        host.appendChild(el);
        this._outputVideoHoverEl = el;
        this._outputVideoHoverVideo = video;
        return el;
    }

    _positionOutputVideoHoverPreview(anchorEl) {
        const el = this._outputVideoHoverEl;
        const video = this._outputVideoHoverVideo;
        if (!el || el.hidden || !anchorEl?.isConnected) return;
        const rect = anchorEl.getBoundingClientRect();
        const vh = 200;
        const vw = video?.videoWidth && video?.videoHeight
            ? Math.max(120, Math.round(vh * (video.videoWidth / video.videoHeight)))
            : Math.round(vh * 16 / 9);
        const gap = 28;
        const margin = 8;
        // Keep the whole preview clear of the floating picker (usually docked right).
        const panel = anchorEl.closest(".cat-te-modal, .cat-te-sidebar")?.getBoundingClientRect();
        const preferLeft = (panel && Number.isFinite(panel.left) ? panel.left : rect.left) - vw - gap;
        const preferRight = (panel && Number.isFinite(panel.right) ? panel.right : rect.right) + gap;
        let left;
        if (preferLeft >= margin) left = preferLeft;
        else if (preferRight + vw <= window.innerWidth - margin) left = preferRight;
        else left = margin;
        left = Math.min(left, window.innerWidth - vw - margin);
        left = Math.max(margin, left);
        let top = rect.top + (rect.height - vh) / 2;
        top = Math.min(Math.max(margin, top), window.innerHeight - vh - margin);
        el.style.left = `${Math.round(left)}px`;
        el.style.top = `${Math.round(top)}px`;
        if (video) {
            video.style.height = `${vh}px`;
            video.style.width = `${vw}px`;
        }
    }

    _hideOutputVideoHoverPreview() {
        this._cancelOutputVideoHoverHide();
        this._outputVideoHoverFile = null;
        this._outputVideoHoverAnchor = null;
        const video = this._outputVideoHoverVideo;
        if (video) {
            try { video.pause(); } catch { /* ignore */ }
            video.removeAttribute("src");
            video.load();
        }
        if (this._outputVideoHoverEl) this._outputVideoHoverEl.hidden = true;
    }

    _ensureResourceGenProgramVideo() {
        if (this._resourceGenPreview?.video?.isConnected) return this._resourceGenPreview.video;
        const stage = this.programStage;
        if (!stage) return null;
        let video = stage.querySelector(".cat-te-program-gen-preview-video");
        if (!video) {
            video = document.createElement("video");
            video.className = "cat-te-program-gen-preview-video";
            video.playsInline = true;
            video.preload = "auto";
            video.controls = false;
            video.setAttribute("controlsList", "nodownload");
            stage.appendChild(video);
        }
        return video;
    }

    _layoutResourceGenProgramVideo() {
        const video = this._resourceGenPreview?.video;
        const canvas = this.programCanvas;
        if (!video || !canvas) return;
        const w = canvas.style.width || `${canvas.clientWidth}px`;
        const h = canvas.style.height || `${canvas.clientHeight}px`;
        video.style.width = w;
        video.style.height = h;
    }

    /**
     * Resource edit: play generated video in the program monitor.
     * Does not change timeline currentTime / playhead.
     * @param {string|null} [urlOverride] blob/object URL (e.g. live sampling preview)
     */
    _startResourceGenProgramPreview(clip, file, urlOverride = null) {
        if (!clip) return;
        const url = urlOverride || (file ? this._outputVideoUrl(file) : "");
        if (!url) return;
        const fileKey = file || url;
        this._cancelResourceGenProgramPreviewStop();
        this._hideOutputVideoHoverPreview();
        // Pause timeline transport so audio/preview don't fight, but keep seek time.
        if (this._timeline?._playing) this._timeline.pause();
        this._stopAudioPlayback?.();
        this._pauseUnusedPreviewVideos(new Set());

        const same = this._resourceGenPreview?.clipId === clip.id
            && this._resourceGenPreview?.file === fileKey
            && this._resourceGenPreview?.video;
        const video = this._ensureResourceGenProgramVideo();
        if (!video) return;

        if (same && !video.paused && this._resourceGenPreview?.file === fileKey
            && video.getAttribute("src") === url) {
            this._layoutResourceGenProgramVideo();
            return;
        }

        const prevClipId = this._resourceGenPreview?.clipId;
        this._stopResourceGenPreviewLoop();
        try { video.pause(); } catch { /* ignore */ }
        video.onended = () => this._stopResourceGenProgramPreview();
        video.onloadedmetadata = () => {
            if (this._resourceGenPreview?.file !== fileKey) return;
            this._layoutResourceGenProgramVideo();
        };
        if (this._resourceGenPreview?.file !== fileKey || video.getAttribute("src") !== url) {
            video.src = url;
            video.currentTime = 0;
        }
        video.muted = false;
        video.volume = 1;
        video.hidden = false;
        this.programStage?.classList.add("is-gen-previewing");
        if (this.programEmpty) this.programEmpty.hidden = true;
        this._resourceGenPreview = { clipId: clip.id, file: fileKey, video };
        this._layoutProgramCanvas();
        this._layoutResourceGenProgramVideo();
        if (prevClipId && prevClipId !== clip.id) {
            const prev = this._findClipById(prevClipId);
            if (prev) this._decorateClip(prev);
        }
        this._decorateClip(clip);
        void video.play().catch(() => {
            video.muted = true;
            void video.play().then(() => {
                video.muted = false;
            }).catch(() => { /* ignore */ });
        });
        this._startResourceGenPreviewLoop();
    }

    _cancelResourceGenProgramPreviewStop() {
        if (this._resourceGenPreviewStopTimer) {
            clearTimeout(this._resourceGenPreviewStopTimer);
            this._resourceGenPreviewStopTimer = 0;
        }
    }

    _scheduleResourceGenProgramPreviewStop() {
        this._cancelResourceGenProgramPreviewStop();
        this._resourceGenPreviewStopTimer = setTimeout(() => {
            this._resourceGenPreviewStopTimer = 0;
            this._stopResourceGenProgramPreview();
        }, 80);
    }

    _stopResourceGenPreviewLoop() {
        if (this._resourceGenPreviewRaf) {
            cancelAnimationFrame(this._resourceGenPreviewRaf);
            this._resourceGenPreviewRaf = 0;
        }
    }

    _startResourceGenPreviewLoop() {
        this._stopResourceGenPreviewLoop();
        const tick = () => {
            this._resourceGenPreviewRaf = 0;
            if (!this._resourceGenPreview?.video) return;
            this._layoutResourceGenProgramVideo();
            this._resourceGenPreviewRaf = requestAnimationFrame(tick);
        };
        this._resourceGenPreviewRaf = requestAnimationFrame(tick);
    }

    _stopResourceGenProgramPreview() {
        this._cancelResourceGenProgramPreviewStop();
        this._stopResourceGenPreviewLoop();
        const prevClipId = this._resourceGenPreview?.clipId;
        const video = this._resourceGenPreview?.video
            || this.programStage?.querySelector(".cat-te-program-gen-preview-video");
        if (video) {
            try { video.pause(); } catch { /* ignore */ }
            video.onended = null;
            video.onloadedmetadata = null;
            video.removeAttribute("src");
            try { video.load(); } catch { /* ignore */ }
            video.hidden = true;
        }
        this._resourceGenPreview = null;
        this.programStage?.classList.remove("is-gen-previewing");
        if (prevClipId) {
            const clip = this._findClipById(prevClipId);
            if (clip) this._decorateClip(clip);
        }
        this._scheduleProgramPreview();
    }

    _showOutputVideoHoverPreview(anchorEl, file) {
        if (!anchorEl || !file) return;
        this._cancelOutputVideoHoverHide();
        if (this._outputVideoHoverFile === file && this._outputVideoHoverEl && !this._outputVideoHoverEl.hidden) {
            this._outputVideoHoverAnchor = anchorEl;
            this._positionOutputVideoHoverPreview(anchorEl);
            return;
        }
        const el = this._ensureOutputVideoHoverPreview();
        const video = this._outputVideoHoverVideo;
        const url = this._outputVideoUrl(file);
        if (!url || !video) return;
        this._outputVideoHoverFile = file;
        this._outputVideoHoverAnchor = anchorEl;
        try { video.pause(); } catch { /* ignore */ }
        video.onloadedmetadata = () => {
            if (this._outputVideoHoverFile !== file) return;
            this._positionOutputVideoHoverPreview(this._outputVideoHoverAnchor || anchorEl);
        };
        video.src = url;
        video.muted = false;
        video.volume = 1;
        video.currentTime = 0;
        el.hidden = false;
        this._positionOutputVideoHoverPreview(anchorEl);
        void video.play().catch(() => {
            // Some browsers require a muted start; retry muted then unmute.
            video.muted = true;
            void video.play().then(() => {
                video.muted = false;
            }).catch(() => { /* ignore */ });
        });
    }

    _renderOutputVideosPicker() {
        if (!this.outputVideosBody) return;
        this._hideOutputVideoHoverPreview();
        this._outputVideosThumbIo?.disconnect();
        this._outputVideosThumbIo = null;
        const isAudio = this._outputPickerKind === "audio";
        const clip = this._findClipById(this._outputVideosClipId);
        this._syncOutputVideosPickerTitle(clip);
        const have = new Set(
            (isAudio
                ? this._clipGeneratedAudios(clip ? this._ensureClipMeta(clip) : null)
                : this._clipGeneratedVideos(clip ? this._ensureClipMeta(clip) : null))
                .map((row) => normalizeOutputVideoPath(row.file) || row.file),
        );
        const q = String(this.outputVideosFilter?.value || "").trim().toLowerCase();
        const range = OUTPUT_VIDEOS_TIME_RANGES.find((r) => r.id === this._outputVideosTimeRange) || OUTPUT_VIDEOS_TIME_RANGES[0];
        const cutoff = range.hours != null ? (Date.now() / 1000 - range.hours * 3600) : null;
        const rows = this._outputVideosCache.filter((row) => {
            if (cutoff != null && Number(row?.mtime) < cutoff) return false;
            return !q || String(row?.file || "").toLowerCase().includes(q);
        });
        this.outputVideosBody.replaceChildren();
        if (!rows.length) {
            const empty = document.createElement("div");
            empty.className = "cat-te-output-videos-empty";
            empty.textContent = this._outputVideosCache.length
                ? T(isAudio ? "no_matching_audios" : "no_matching_videos")
                : T(isAudio ? "no_audios_in_output_dir" : "no_videos_in_output_dir");
            this.outputVideosBody.appendChild(empty);
            return;
        }
        const io = isAudio ? null : new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const thumb = entry.target;
                const file = thumb.dataset?.file;
                io.unobserve(thumb);
                if (!file) continue;
                void this._getOutputVideoThumbnail(file).then((url) => {
                    if (url && thumb.isConnected) thumb.src = url;
                });
            }
        }, { root: this.outputVideosBody, rootMargin: "120px 0px" });
        this._outputVideosThumbIo = io;
        for (const row of rows) {
            const file = row.file;
            const key = normalizeOutputVideoPath(file) || file;
            const item = document.createElement("div");
            item.className = "cat-te-output-video-row";
            if (isAudio) item.classList.add("is-audio");
            const added = have.has(key);
            if (added) item.classList.add("is-added");
            const thumbWrap = document.createElement("span");
            thumbWrap.className = "cat-te-output-video-thumb-wrap";
            if (isAudio) {
                thumbWrap.classList.add("is-audio");
                thumbWrap.innerHTML = iconHtml("audio", 16);
                thumbWrap.title = T("preview_audio_title");
                thumbWrap.addEventListener("click", (e) => {
                    e.stopPropagation();
                    this._previewOutputAudioFile(file);
                });
            } else {
                const thumb = document.createElement("img");
                thumb.className = "cat-te-output-video-thumb";
                thumb.alt = "";
                thumb.dataset.file = file;
                const playHint = document.createElement("span");
                playHint.className = "cat-te-output-video-thumb-play";
                playHint.innerHTML = iconHtml("play", 12);
                playHint.setAttribute("aria-hidden", "true");
                thumbWrap.append(thumb, playHint);
                thumbWrap.title = T("hover_preview_video_title");
                thumbWrap.addEventListener("mouseenter", () => this._showOutputVideoHoverPreview(thumbWrap, file));
                thumbWrap.addEventListener("mouseleave", () => this._scheduleOutputVideoHoverHide());
                if (io) io.observe(thumb);
            }
            const name = document.createElement("button");
            name.type = "button";
            name.className = "cat-te-output-video-name";
            name.textContent = file;
            name.title = file;
            name.disabled = added;
            const tag = document.createElement("span");
            tag.className = "cat-te-output-video-tag";
            tag.textContent = added ? T("added_tag") : T("add_btn");
            item.append(thumbWrap, name, tag);
            if (!added) {
                const add = () => {
                    const target = this._findClipById(this._outputVideosClipId);
                    if (!this._isOutputPickerClip(target, isAudio ? "audio" : "video")) return;
                    const ok = isAudio
                        ? this._addGeneratedAudiosToClip(target, [file])
                        : this._addGeneratedVideosToClip(target, [file]);
                    if (!ok) return;
                    item.classList.add("is-added");
                    name.disabled = true;
                    tag.textContent = T("added_tag");
                };
                name.addEventListener("click", add);
                tag.addEventListener("click", add);
            }
            this.outputVideosBody.appendChild(item);
        }
    }

    _previewOutputAudioFile(file) {
        const url = this._generatedAudioUrl(file);
        if (!url) return;
        if (!this.mediaPreviewModal || !this.mediaPreviewStage) {
            const a = new Audio(url);
            void a.play().catch(() => {});
            return;
        }
        this.mediaPreviewModal.hidden = false;
        if (this.mediaPreviewTitle) {
            this.mediaPreviewTitle.textContent = String(file).split(/[\\/]/).pop() || T("gen_audio_label");
        }
        this.mediaPreviewStage.replaceChildren();
        const audio = document.createElement("audio");
        audio.controls = true;
        audio.preload = "metadata";
        audio.src = url;
        audio.style.maxWidth = "100%";
        this.mediaPreviewStage.appendChild(audio);
        void audio.play().catch(() => {});
    }

    _isEmptyGroupClip(meta) {
        return this._clipItems(meta).length === 0;
    }

    _clipPreviewItemIndex(clip, meta) {
        const items = this._clipItems(meta);
        if (!items.length) return 0;
        const raw = Number(this._clipPreviewIndex.get(clip.id));
        if (!Number.isFinite(raw)) return 0;
        return Math.max(0, Math.min(items.length - 1, raw));
    }

    _setClipPreviewItemIndex(clip, index) {
        const items = this._clipItems(this._meta.get(clip.id));
        if (!items.length) {
            this._clipPreviewIndex.delete(clip.id);
            return 0;
        }
        const next = ((index % items.length) + items.length) % items.length;
        this._clipPreviewIndex.set(clip.id, next);
        return next;
    }

    _normalizeVisualMeta(clip, meta, { seedFromClip = true } = {}) {
        if (!clip || !meta || clip.track?.type === "audio") return meta;
        const oldKind = meta.mediaKind;
        let items = this._clipItems(meta);
        if (!items.length && seedFromClip) {
            items = clipItemsFromLegacy(clip.src, meta.endImage, oldKind);
        }
        meta.items = items.map((item) => {
            const media = (item.id && this._findMediaById(item.id))
                || this._ensureMedia(item.kind, item.file);
            const useMediaPrompt = item.useMediaPrompt !== false;
            const enabled = item.enabled !== false;
            return media
                ? { id: media.id, kind: media.kind, file: media.file, useMediaPrompt, enabled }
                : { ...item, useMediaPrompt, enabled };
        });
        meta.mediaIds = meta.items.map((item) => item.id).filter(Boolean);
        const first = items.find((it) => it.enabled !== false) || items[0] || null;
        const images = items.filter((it) => it.kind === "image");
        clip.src = first?.file || "";
        meta.endImage = images.length >= 2 ? images[images.length - 1].file : null;
        meta.mediaKind = "clip";
        meta.clipRole = meta.clipRole === "other"
            ? "other"
            : this._knownClipRole(meta.clipRole);
        if (meta.clipRole !== "other") meta.clipRoleCustom = "";
        else meta.clipRoleCustom = String(meta.clipRoleCustom || "").trim();
        meta.agent = meta.agent === "other" ? "other" : this._knownClipAgent(meta.agent);
        if (meta.agent !== "other") meta.agentCustom = "";
        else meta.agentCustom = String(meta.agentCustom || "").trim();
        meta.seed = this._normalizeClipSeed(meta.seed);
        meta.promptIncludes = normalizePromptIncludes(meta.promptIncludes);
        if (!items.length) {
            clip.thumbnail = null;
            clip.hasAudio = false;
            clip.waveformPeaks = null;
            clip._audioBuffer = null;
        }
        return meta;
    }

    _syncClipPrimaryAppearance(clip, { refreshVideo = true } = {}) {
        const m = this._ensureClipMeta(clip);
        this._normalizeVisualMeta(clip, m);
        const items = this._clipItems(m);
        const first = items.find((it) => it.enabled !== false) || items[0];
        const enabledGen = this._firstEnabledGeneratedVideo(m);
        const gen = this._clipUsesGeneratedPreview(m) ? enabledGen : null;
        if (isDefaultClipName(clip.name)) {
            clip.name = first?.file?.split(/[\\/]/).pop()
                || gen?.file?.split(/[\\/]/).pop()
                || DEFAULT_CLIP_NAME;
        }
        if (gen) {
            if (refreshVideo) {
                const url = this._outputVideoUrl(gen.file);
                void this._grabVideoThumbnail(url).then((thumb) => {
                    clip.thumbnail = thumb;
                    this._refreshClipAppearance(clip);
                    if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
                }).catch(() => this._refreshClipAppearance(clip));
            }
            if (!first) {
                clip.hasAudio = false;
                clip.waveformPeaks = null;
                clip._audioBuffer = null;
            }
            this._refreshClipAppearance(clip);
            if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
            return;
        }
        if (!first) {
            clip.thumbnail = null;
            clip.hasAudio = false;
            clip.waveformPeaks = null;
            clip._audioBuffer = null;
            this._refreshClipAppearance(clip);
            return;
        }
        if (first.kind === "video") {
            if (refreshVideo) {
                const url = this._videoUrl(first.file);
                void this._grabVideoThumbnail(url).then((thumb) => {
                    clip.thumbnail = thumb;
                    this._refreshClipAppearance(clip);
                    if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
                }).catch(() => this._refreshClipAppearance(clip));
                void this._fetchPeaks(url).then((r) => {
                    clip.waveformPeaks = r.peaks[0];
                    clip.hasAudio = true;
                    clip._audioBuffer = r.buffer;
                    this._refreshClipAppearance(clip);
                }).catch(() => {
                    clip.hasAudio = false;
                    this._refreshClipAppearance(clip);
                });
            }
        } else {
            clip.thumbnail = this._imgUrl(first.file);
            clip.hasAudio = false;
            clip.waveformPeaks = null;
            clip._audioBuffer = null;
        }
        this._refreshClipAppearance(clip);
        if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
    }

    _insertItemIntoClip(clip, file, kind) {
        if (!clip || !file || clip.track?.type === "audio") return;
        this._recordUndo();
        const m = this._ensureClipMeta(clip);
        this._normalizeVisualMeta(clip, m);
        const media = this._ensureMedia(kind === "video" ? "video" : "image", file);
        const item = media
            ? { id: media.id, kind: media.kind, file: media.file, useMediaPrompt: true, enabled: true }
            : normalizeClipItem({ kind, file });
        if (!item) return;
        m.items.push(item);
        this._meta.set(clip.id, m);
        this._setClipPreviewItemIndex(clip, m.items.length - 1);
        this._syncClipPrimaryAppearance(clip);
        this._renderMediaGrid();
        this._saveToWidgets();
        if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
        if (this._clipItemsModalClipId === clip.id) this._renderClipItemsModal(clip);
    }

    _applyClipItemOrder(clip, orderedItems) {
        if (!clip || !Array.isArray(orderedItems)) return false;
        const m = this._ensureClipMeta(clip);
        this._normalizeVisualMeta(clip, m, { seedFromClip: false });
        const itemKey = (item) => item?.id || `${item?.kind}:${item?.file}`;
        const same = orderedItems.length === m.items.length
            && orderedItems.every((item, i) => itemKey(item) === itemKey(m.items[i]));
        if (same) return false;
        this._recordUndo();
        m.items = orderedItems.map((item) => ({
            id: item.id,
            kind: item.kind,
            file: item.file,
            useMediaPrompt: item.useMediaPrompt !== false,
            enabled: item.enabled !== false,
        }));
        m.mediaIds = m.items.map((item) => item.id).filter(Boolean);
        this._normalizeVisualMeta(clip, m, { seedFromClip: false });
        this._meta.set(clip.id, m);
        this._syncClipPrimaryAppearance(clip);
        this._scheduleProgramPreview();
        this._saveToWidgets();
        return true;
    }

    _removeClipItem(clip, index) {
        if (!clip || clip.track?.type === "audio") return;
        const m = this._ensureClipMeta(clip);
        this._normalizeVisualMeta(clip, m, { seedFromClip: false });
        const items = this._clipItems(m);
        const current = items[index];
        if (!current) return;
        const name = current.file.split(/[\\/]/).pop() || current.file;
        this._openDeleteConfirm(T("confirm_remove_from_clip", { name }), () => this._removeClipItemNow(clip, current.id, index));
    }

    _removeClipItemNow(clip, itemId, fallbackIndex) {
        if (!clip || clip.track?.type === "audio") return;
        const m = this._ensureClipMeta(clip);
        this._normalizeVisualMeta(clip, m, { seedFromClip: false });
        const items = this._clipItems(m);
        const index = items.findIndex((item) => item.id === itemId);
        const removeIndex = index >= 0 ? index : fallbackIndex;
        if (removeIndex < 0 || removeIndex >= items.length) return;
        this._recordUndo();
        m.items = items.filter((_, i) => i !== removeIndex).map((item) => ({
            id: item.id,
            kind: item.kind,
            file: item.file,
            useMediaPrompt: item.useMediaPrompt !== false,
            enabled: item.enabled !== false,
        }));
        m.mediaIds = m.items.map((item) => item.id).filter(Boolean);
        this._normalizeVisualMeta(clip, m, { seedFromClip: false });
        this._meta.set(clip.id, m);
        this._setClipPreviewItemIndex(clip, Math.min(removeIndex, Math.max(0, m.items.length - 1)));
        this._syncClipPrimaryAppearance(clip);
        this._scheduleProgramPreview();
        this._saveToWidgets();
        if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
        if (this._clipItemsModalClipId === clip.id) this._renderClipItemsModal(clip);
    }

    _removeCurrentClipItem() {
        const clip = this._selClip;
        if (!clip || clip.track?.type === "audio") return;
        const m = this._ensureClipMeta(clip);
        this._normalizeVisualMeta(clip, m, { seedFromClip: false });
        this._removeClipItem(clip, this._clipPreviewItemIndex(clip, m));
    }

    _activeMediaFilterCount() {
        let n = 0;
        if (this._mediaStarFilter && this._mediaStarFilter !== "all") n += 1;
        n += this._mediaTypeFilters.size;
        n += this._mediaTagFilters.size;
        return n;
    }

    _clearMediaFilters() {
        this._mediaStarFilter = "all";
        this._mediaTypeFilters.clear();
        this._mediaTagFilters.clear();
        this._renderMediaGrid();
    }

    _closeMediaFilterPanel() {
        if (!this._mediaFilterOpen) return false;
        this._mediaFilterOpen = false;
        this._overlay?.querySelector(".cat-te-media-filter-panel")?.remove();
        this._overlay?.querySelector(".cat-te-media-filter-btn")?.classList.remove("active");
        return true;
    }

    _matchesMediaTab(kind) {
        return kind === this._mediaTab;
    }

    _libraryMediaEntries() {
        const out = [];
        for (const file of this._imgFiles) out.push({ file, kind: "image" });
        for (const file of this._videoFiles) out.push({ file, kind: "video" });
        for (const file of this._audioFiles) out.push({ file, kind: "audio" });
        return out;
    }

    _visibleMediaEntries() {
        const out = [];
        const groups = [
            ["image", this._imgFiles],
            ["video", this._videoFiles],
            ["audio", this._audioFiles],
        ];
        for (const [kind, files] of groups) {
            for (const file of this._filterMediaFiles(files, kind)) out.push({ file, kind });
        }
        return out;
    }

    _collectMediaFilterOptions() {
        const types = new Set();
        const tags = new Set();
        for (const { file, kind } of this._libraryMediaEntries()) {
            if (!this._matchesMediaTab(kind)) continue;
            const meta = this._getMediaMeta(kind, file);
            if (meta.mediaType) types.add(meta.mediaType);
            for (const tag of meta.tags || []) tags.add(tag);
        }
        return { types: [...types].sort(), tags: [...tags].sort() };
    }

    _filterMediaFiles(files, kind) {
        if (!this._matchesMediaTab(kind)) return [];
        const star = this._mediaStarFilter && this._mediaStarFilter !== "all"
            ? parseInt(this._mediaStarFilter, 10)
            : null;
        const types = this._mediaTypeFilters;
        const tags = this._mediaTagFilters;
        if (!(Number.isFinite(star) || types.size || tags.size)) return files;
        return files.filter((file) => {
            if (this._mediaStatus.get(`${kind}:${file}`)?.location === "missing") return true;
            const meta = this._getMediaMeta(kind, file);
            if (Number.isFinite(star) && meta.stars !== star) return false;
            if (types.size) {
                const t = meta.mediaType || "";
                const known = MEDIA_ASSET_TYPES.some((x) => x.id === t);
                const matchKnown = types.has(t);
                const matchOther = types.has("other") && (t === "other" || (t && !known));
                if (!matchKnown && !matchOther) return false;
            }
            if (tags.size) {
                const have = new Set(meta.tags || []);
                for (const tag of tags) {
                    if (!have.has(tag)) return false;
                }
            }
            return true;
        });
    }

    _mediaBatchKey(kind, file) {
        return `${kind}:${file}`;
    }

    _applyMediaGridView() {
        this.mediaGrid?.classList.toggle("cat-te-media-grid-list", !!this._mediaListView);
        this.mediaPanel?.classList.toggle("cat-te-media-batch", !!this._mediaBatchMode);
        this._ensureMediaListStyle();
        this._relayoutMediaListThumbs();
        this._observeMediaListResize();
    }

    /** Inject high-priority list-view rules (avoids stale/cached extension CSS). */
    _ensureMediaListStyle() {
        let style = document.getElementById("cat-te-media-list-style");
        if (!style) {
            style = document.createElement("style");
            style.id = "cat-te-media-list-style";
            document.head.appendChild(style);
        }
        style.textContent = `
.cat-te-media-grid.cat-te-media-grid-list{
  display:flex !important;
  flex-direction:column !important;
  grid-template-columns:none !important;
  grid-auto-rows:auto !important;
  gap:6px !important;
  align-content:stretch !important;
}
.cat-te-media-grid.cat-te-media-grid-list>.cat-te-media-item{
  width:100% !important;
  height:auto !important;
  min-height:0 !important;
  max-height:none !important;
  flex:0 0 auto !important;
  align-self:stretch !important;
}
.cat-te-media-grid.cat-te-media-grid-list>.cat-te-media-item>img{
  width:100% !important;
  height:auto !important;
  min-height:0 !important;
  max-height:none !important;
  object-fit:contain !important;
  display:block !important;
}
.cat-te-media-grid.cat-te-media-grid-list>.cat-te-media-item>.cat-te-video-icon,
.cat-te-media-grid.cat-te-media-grid-list>.cat-te-media-item>.cat-te-audio-icon,
.cat-te-media-grid.cat-te-media-grid-list>.cat-te-media-item>.cat-te-missing-icon{
  width:100% !important;
  min-height:120px !important;
  aspect-ratio:16/9 !important;
}
`;
    }

    /** Force list-view thumbs to keep intrinsic aspect ratio via explicit pixel height. */
    _bindMediaThumbAspect(img) {
        if (!img) return;
        const apply = () => {
            if (!img.isConnected) return;
            const item = img.parentElement;
            if (!this._mediaListView) {
                img.style.removeProperty("width");
                img.style.removeProperty("height");
                img.style.removeProperty("max-height");
                img.style.removeProperty("min-height");
                img.style.removeProperty("object-fit");
                img.style.removeProperty("aspect-ratio");
                item?.style.removeProperty("height");
                item?.style.removeProperty("min-height");
                return;
            }
            const nw = img.naturalWidth || 0;
            const nh = img.naturalHeight || 0;
            const cw = item?.clientWidth || img.clientWidth || 0;
            if (nw <= 0 || nh <= 0 || cw <= 0) return;
            const ph = Math.max(1, Math.round((cw * nh) / nw));
            img.style.setProperty("width", "100%", "important");
            img.style.setProperty("height", `${ph}px`, "important");
            img.style.setProperty("max-height", "none", "important");
            img.style.setProperty("min-height", "0", "important");
            img.style.setProperty("object-fit", "fill", "important");
            item?.style.setProperty("height", "auto", "important");
            item?.style.setProperty("min-height", "0", "important");
        };
        img._catTeAspectApply = apply;
        if (img.complete && img.naturalWidth > 0) apply();
        else img.addEventListener("load", apply);
    }

    _relayoutMediaListThumbs() {
        if (!this.mediaGrid) return;
        for (const img of this.mediaGrid.querySelectorAll(".cat-te-media-item > img")) {
            if (typeof img._catTeAspectApply === "function") img._catTeAspectApply();
            else this._bindMediaThumbAspect(img);
        }
    }

    _observeMediaListResize() {
        if (!this.mediaGrid) return;
        if (this._mediaListResizeObserver) return;
        this._mediaListResizeObserver = new ResizeObserver(() => {
            if (!this._mediaListView) return;
            this._relayoutMediaListThumbs();
        });
        this._mediaListResizeObserver.observe(this.mediaGrid);
    }

    _toggleMediaBatchMode() {
        this._mediaBatchMode = !this._mediaBatchMode;
        if (!this._mediaBatchMode) this._mediaBatchSelected.clear();
        this._renderMediaGrid();
    }

    _toggleMediaListView() {
        this._mediaListView = !this._mediaListView;
        try {
            localStorage.setItem(STORAGE_MEDIA_LIST_VIEW, this._mediaListView ? "1" : "0");
        } catch { /* ignore */ }
        this._applyMediaGridView();
        this._renderMediaStarFilter();
        requestAnimationFrame(() => {
            this._relayoutMediaListThumbs();
            requestAnimationFrame(() => this._relayoutMediaListThumbs());
        });
    }

    _toggleMediaBatchSelect(kind, file, itemEl = null) {
        const key = this._mediaBatchKey(kind, file);
        if (this._mediaBatchSelected.has(key)) this._mediaBatchSelected.delete(key);
        else this._mediaBatchSelected.add(key);
        itemEl?.classList.toggle("cat-te-media-selected", this._mediaBatchSelected.has(key));
        this._renderMediaStarFilter();
    }

    _renderMediaStarFilter() {
        if (!this.mediaStarFilterHost) return;
        this.mediaStarFilterHost.replaceChildren();

        const refreshBtn = document.createElement("button");
        refreshBtn.type = "button";
        refreshBtn.className = "cat-te-media-tool-btn cat-te-media-refresh";
        refreshBtn.innerHTML = iconHtml("refresh", 12);
        refreshBtn.title = T("refresh_media_list_title");
        if (this._mediaReloading) refreshBtn.classList.add("spinning");
        refreshBtn.addEventListener("click", () => this._refreshMediaLists());
        this.mediaStarFilterHost.appendChild(refreshBtn);

        const batchBtn = document.createElement("button");
        batchBtn.type = "button";
        batchBtn.className = "cat-te-media-tool-btn";
        batchBtn.classList.toggle("active", this._mediaBatchMode);
        batchBtn.innerHTML = iconHtml("check", 12);
        batchBtn.title = this._mediaBatchMode ? T("exit_batch_select_title") : T("batch_select_delete_title");
        batchBtn.addEventListener("click", () => this._toggleMediaBatchMode());
        this.mediaStarFilterHost.appendChild(batchBtn);

        const viewBtn = document.createElement("button");
        viewBtn.type = "button";
        viewBtn.className = "cat-te-media-tool-btn";
        viewBtn.classList.toggle("active", this._mediaListView);
        viewBtn.innerHTML = iconHtml(this._mediaListView ? "grid" : "list", 12);
        viewBtn.title = this._mediaListView ? T("switch_to_grid_view_title") : T("switch_to_list_view_title");
        viewBtn.addEventListener("click", () => this._toggleMediaListView());
        this.mediaStarFilterHost.appendChild(viewBtn);

        const filterWrap = document.createElement("div");
        filterWrap.className = "cat-te-media-filter-wrap";
        const filterBtn = document.createElement("button");
        filterBtn.type = "button";
        filterBtn.className = "cat-te-media-tool-btn cat-te-media-filter-btn";
        filterBtn.innerHTML = iconHtml("filter", 12);
        filterBtn.title = T("filter_assets_title");
        filterBtn.classList.toggle("active", this._mediaFilterOpen || this._activeMediaFilterCount() > 0);
        const count = this._activeMediaFilterCount();
        if (count) {
            const badge = document.createElement("span");
            badge.className = "cat-te-media-tool-badge";
            badge.textContent = String(count);
            filterBtn.appendChild(badge);
        }
        filterBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (this._mediaFilterOpen) this._closeMediaFilterPanel();
            else this._openMediaFilterPanel(filterWrap);
        });
        filterWrap.appendChild(filterBtn);
        this.mediaStarFilterHost.appendChild(filterWrap);

        const actionBtn = this.mediaPrimaryActionBtn;
        if (actionBtn) {
            const selectedCount = this._mediaBatchSelected.size;
            actionBtn.classList.toggle("cat-te-btn-danger", this._mediaBatchMode);
            actionBtn.innerHTML = this._mediaBatchMode
                ? `${iconHtml("trash", 14)}<span>${selectedCount ? T("delete_selected_n_assets_title", { n: selectedCount }) : T("delete_btn")}</span>`
                : `<span>${T("add_material_title")}</span>`;
            actionBtn.title = this._mediaBatchMode
                ? (selectedCount ? T("delete_selected_n_assets_title", { n: selectedCount }) : T("select_asset_first_title"))
                : T("add_material_multi_select_title");
            actionBtn.disabled = this._mediaBatchMode && selectedCount === 0;
        }

        if (this._mediaFilterOpen) this._openMediaFilterPanel(filterWrap);
    }

    _openMediaFilterPanel(host) {
        this._mediaFilterOpen = true;
        host.querySelector(".cat-te-media-filter-panel")?.remove();
        host.querySelector(".cat-te-media-filter-btn")?.classList.add("active");
        const panel = document.createElement("div");
        panel.className = "cat-te-media-filter-panel";
        panel.addEventListener("click", (e) => e.stopPropagation());

        const starRow = document.createElement("div");
        starRow.className = "cat-te-media-filter-section";
        const starTitle = document.createElement("div");
        starTitle.className = "cat-te-media-filter-label";
        starTitle.textContent = T("star_rating_label");
        const starGroup = document.createElement("div");
        starGroup.className = "cat-te-media-star-filter-group";
        const activeStars = this._mediaStarFilter === "all" ? 0 : parseInt(this._mediaStarFilter, 10) || 0;
        for (let i = 1; i <= 5; i++) {
            const starBtn = document.createElement("button");
            starBtn.type = "button";
            starBtn.className = "cat-te-media-star-filter-star";
            starBtn.innerHTML = iconHtml("star", 12);
            starBtn.title = T("filter_n_star_assets_title", { n: i });
            if (i <= activeStars) starBtn.classList.add("on");
            if (String(i) === this._mediaStarFilter) starBtn.classList.add("active");
            starBtn.addEventListener("click", () => {
                this._mediaStarFilter = String(i) === this._mediaStarFilter ? "all" : String(i);
                this._renderMediaGrid();
            });
            starGroup.appendChild(starBtn);
        }
        starRow.append(starTitle, starGroup);
        panel.appendChild(starRow);

        const typeRow = document.createElement("div");
        typeRow.className = "cat-te-media-filter-section";
        const typeTitle = document.createElement("div");
        typeTitle.className = "cat-te-media-filter-label";
        typeTitle.textContent = T("type_label");
        const typeGroup = document.createElement("div");
        typeGroup.className = "cat-te-media-filter-chips";
        const extra = this._collectMediaFilterOptions();
        const typeOptions = [
            ...MEDIA_ASSET_TYPES,
            ...extra.types
                .filter((id) => !MEDIA_ASSET_TYPES.some((t) => t.id === id))
                .map((id) => ({ id, label: id })),
        ];
        for (const opt of typeOptions) {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "cat-te-media-filter-chip";
            chip.textContent = opt.label;
            chip.classList.toggle("active", this._mediaTypeFilters.has(opt.id));
            chip.addEventListener("click", () => {
                if (this._mediaTypeFilters.has(opt.id)) this._mediaTypeFilters.delete(opt.id);
                else this._mediaTypeFilters.add(opt.id);
                this._renderMediaGrid();
            });
            typeGroup.appendChild(chip);
        }
        if (!typeOptions.length) {
            const empty = document.createElement("div");
            empty.className = "cat-te-media-filter-empty";
            empty.textContent = T("no_types_yet");
            typeGroup.appendChild(empty);
        }
        typeRow.append(typeTitle, typeGroup);
        panel.appendChild(typeRow);

        const tagRow = document.createElement("div");
        tagRow.className = "cat-te-media-filter-section";
        const tagTitle = document.createElement("div");
        tagTitle.className = "cat-te-media-filter-label";
        tagTitle.textContent = T("tags_label");
        const tagGroup = document.createElement("div");
        tagGroup.className = "cat-te-media-filter-chips";
        if (!extra.tags.length) {
            const empty = document.createElement("div");
            empty.className = "cat-te-media-filter-empty";
            empty.textContent = T("no_tags_yet");
            tagGroup.appendChild(empty);
        } else {
            for (const tag of extra.tags) {
                const chip = document.createElement("button");
                chip.type = "button";
                chip.className = "cat-te-media-filter-chip";
                chip.textContent = tag;
                chip.classList.toggle("active", this._mediaTagFilters.has(tag));
                chip.addEventListener("click", () => {
                    if (this._mediaTagFilters.has(tag)) this._mediaTagFilters.delete(tag);
                    else this._mediaTagFilters.add(tag);
                    this._renderMediaGrid();
                });
                tagGroup.appendChild(chip);
            }
        }
        tagRow.append(tagTitle, tagGroup);
        panel.appendChild(tagRow);

        const clearBtn = document.createElement("button");
        clearBtn.type = "button";
        clearBtn.className = "cat-te-btn cat-te-media-filter-clear";
        clearBtn.textContent = T("clear_all_filters_btn");
        clearBtn.disabled = this._activeMediaFilterCount() === 0;
        clearBtn.addEventListener("click", () => this._clearMediaFilters());
        panel.appendChild(clearBtn);

        host.appendChild(panel);
    }

    _renderMediaGrid() {
        this.mediaTabs?.forEach((tab) => {
            const active = tab.dataset.kind === this._mediaTab;
            tab.classList.toggle("is-active", active);
            tab.setAttribute("aria-selected", String(active));
            tab.tabIndex = active ? 0 : -1;
        });
        this._renderMediaStarFilter();
        this.mediaGrid.replaceChildren();
        this._applyMediaGridView();
        const library = this._libraryMediaEntries().filter(({ kind }) => this._matchesMediaTab(kind));
        if (!library.length) {
            const msg = document.createElement("div");
            msg.className = "cat-te-media-empty";
            msg.textContent = T("no_assets_drag_or_add_hint");
            this.mediaGrid.appendChild(msg);
            return;
        }
        const files = this._visibleMediaEntries();
        if (!files.length) {
            const msg = document.createElement("div");
            msg.className = "cat-te-media-empty";
            msg.textContent = T("no_assets_match_filter");
            this.mediaGrid.appendChild(msg);
            return;
        }
        for (const { file, kind } of files) {
            this.mediaGrid.appendChild(this._makeMediaItem(file, kind));
        }
        requestAnimationFrame(() => this._relayoutMediaListThumbs());
    }

    /** Whether `file` is already used by a clip on the timeline. */
    _isMediaOnTimeline(file, kind) {
        if (!this._timeline) return false;
        const media = this._findMedia(kind, file);
        const mediaId = media?.id;
        if (kind === "audio") {
            return this._allAudioTracks().some((t) => t.clips.some((c) => {
                const meta = this._meta.get(c.id);
                return (mediaId && meta?.mediaId === mediaId) || c.src === file;
            }));
        }
        return this._allRenderableTracks().some((t) => t.clips.some((c) => {
            const meta = this._meta.get(c.id);
            return this._clipItems(meta).some((item) => (mediaId && item.id === mediaId) || item.file === file);
        }));
    }

    _makeMediaItem(file, kind) {
        const item = document.createElement("div");
        const status = this._mediaStatus.get(`${kind}:${file}`) || { location: "input" };
        const batchKey = this._mediaBatchKey(kind, file);
        item.className = `cat-te-media-item cat-te-media-${kind}`;
        item.dataset.mediaKey = batchKey;
        item.classList.toggle("cat-te-media-missing", status.location === "missing");
        item.classList.toggle("cat-te-media-selected", this._mediaBatchSelected.has(batchKey));
        item.title = this._mediaBatchMode
            ? T("media_item_title_batch", { file })
            : T("media_item_title_normal", { file });
        // Native HTML5 DnD is unreliable in Tauri/WebView2 (no drag ghost /
        // drop disabled). Use pointer-driven drag instead; keep the attribute
        // off so the webview doesn't swallow the gesture.
        item.draggable = false;

        const check = document.createElement("div");
        check.className = "cat-te-media-check";
        check.innerHTML = iconHtml("check", 12);
        item.appendChild(check);

        if (this._isMediaOnTimeline(file, kind)) {
            const addedTag = document.createElement("div");
            addedTag.className = "cat-te-media-added-tag";
            addedTag.textContent = T("added_tag");
            item.appendChild(addedTag);
        }
        if (status.location === "missing") {
            const icon = document.createElement("div");
            icon.className = "cat-te-missing-icon";
            icon.textContent = "!";
            item.appendChild(icon);
        } else if (kind === "image") {
            const img = document.createElement("img");
            img.src = this._imgUrl(file);
            img.alt = "";
            img.draggable = false;
            item.appendChild(img);
            this._bindMediaThumbAspect(img);
        } else if (kind === "video") {
            const icon = document.createElement("div");
            icon.className = "cat-te-video-icon";
            icon.textContent = "▶";
            item.appendChild(icon);
            this._getVideoThumbnail(file).then(dataUrl => {
                if (!dataUrl || !item.isConnected) return;
                const img = document.createElement("img");
                img.src = dataUrl;
                img.alt = "";
                img.draggable = false;
                icon.replaceWith(img);
                this._bindMediaThumbAspect(img);
            }).catch(() => { /* keep the icon placeholder */ });
        } else {
            const icon = document.createElement("div");
            icon.className = "cat-te-audio-icon";
            icon.textContent = "♫";
            item.appendChild(icon);
        }
        const nm = document.createElement("div");
        nm.className = "cat-te-media-name";
        nm.textContent = file.split(/[\\/]/).pop();
        const dragHint = document.createElement("div");
        dragHint.className = "cat-te-media-drag-hint";
        dragHint.textContent = "⋮⋮";
        item.append(nm, dragHint);
        item.addEventListener("click", () => {
            if (item._catTeSuppressClick) {
                item._catTeSuppressClick = false;
                return;
            }
            if (this._mediaBatchMode) {
                this._toggleMediaBatchSelect(kind, file, item);
                return;
            }
            if (status.location === "missing") alert(T("asset_missing_relink_hint"));
            else this._openMediaPreview(file, kind);
        });
        item.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this._mediaBatchMode) return;
            const items = [];
            if (status.location !== "missing") items.push({
                label: T("insert_to_timeline_ctx"),
                fn: () => {
                    if (kind === "audio") void this._addAudioAtPlayhead(file);
                    else if (kind === "video") void this._addVideoAtPlayhead(file);
                    else void this._addMediaAtPlayhead(file);
                },
            });
            if (status.location !== "missing") items.push({
                label: T("replace_material_label"),
                fn: () => this._chooseMaterialFile({ file, kind }),
            });
            if (status.location === "missing") items.push({
                label: T("relink_file_menu"),
                fn: () => this._chooseMaterialFile({ file, kind }),
            });
            items.push({
                label: T("delete_btn"),
                fn: () => void this._deleteLibraryMedia(file, kind),
                danger: true,
            });
            this._buildCtxMenu(items, e.clientX, e.clientY);
        });
        if (status.location !== "missing" && !this._mediaBatchMode) {
            this._bindMediaPointerDrag(item, kind, file);
        }
        return item;
    }

    /**
     * Pointer-based media drag (Tauri/WebView2-safe). Native HTML5 DnD often
     * never starts a drag gesture inside the launcher webview.
     */
    _bindMediaPointerDrag(item, kind, file) {
        const THRESHOLD = 6;
        const GHOST_W = 88;
        const GHOST_H = 64;
        item.addEventListener("pointerdown", (e) => {
            if (e.button !== 0) return;
            if (e.target.closest("button")) return;

            const startX = e.clientX;
            const startY = e.clientY;
            // Keep the grab point under the cursor (map item → ghost size).
            const rect = item.getBoundingClientRect();
            const grabX = Math.min(
                GHOST_W - 1,
                Math.max(0, (e.clientX - rect.left) * (GHOST_W / Math.max(1, rect.width))),
            );
            const grabY = Math.min(
                GHOST_H - 1,
                Math.max(0, (e.clientY - rect.top) * (GHOST_H / Math.max(1, rect.height))),
            );
            let started = false;
            let ghost = null;
            const pointerId = e.pointerId;
            try { item.setPointerCapture(pointerId); } catch { /* ignore */ }

            const placeGhost = (clientX, clientY) => {
                if (!ghost) return;
                ghost.style.transform = `translate(${clientX - grabX}px, ${clientY - grabY}px)`;
            };

            const onMove = (ev) => {
                if (ev.pointerId !== pointerId) return;
                const dx = ev.clientX - startX;
                const dy = ev.clientY - startY;
                if (!started) {
                    if (dx * dx + dy * dy < THRESHOLD * THRESHOLD) return;
                    started = true;
                    item._catTeSuppressClick = true;
                    this._dndMedia = { kind, file };
                    item.classList.add("dragging");
                    ghost = this._makeMediaDragGhost(item, file);
                    document.body.appendChild(ghost);
                    document.body.classList.add("cat-te-media-dnd");
                    placeGhost(ev.clientX, ev.clientY);
                }
                ev.preventDefault();
                placeGhost(ev.clientX, ev.clientY);
                this._updateMediaDragHover(ev.clientX, ev.clientY);
            };

            const onUp = (ev) => {
                if (ev.pointerId !== pointerId) return;
                window.removeEventListener("pointermove", onMove, true);
                window.removeEventListener("pointerup", onUp, true);
                window.removeEventListener("pointercancel", onUp, true);
                if (this._abortMediaDrag === abortDrag) this._abortMediaDrag = null;
                try { item.releasePointerCapture(pointerId); } catch { /* ignore */ }

                const media = started ? this._dndMedia : null;
                const dropX = ev.clientX;
                const dropY = ev.clientY;
                this._clearMediaDragVisuals(item, ghost);
                this._dndMedia = null;
                if (!started || !media?.file) return;
                this._commitMediaDrop(media, dropX, dropY);
            };

            const abortDrag = () => {
                window.removeEventListener("pointermove", onMove, true);
                window.removeEventListener("pointerup", onUp, true);
                window.removeEventListener("pointercancel", onUp, true);
                try { item.releasePointerCapture(pointerId); } catch { /* ignore */ }
                this._clearMediaDragVisuals(item, ghost);
                this._dndMedia = null;
                this._dndHoverClip = null;
            };
            this._abortMediaDrag = abortDrag;

            window.addEventListener("pointermove", onMove, true);
            window.addEventListener("pointerup", onUp, true);
            window.addEventListener("pointercancel", onUp, true);
        });
    }

    _makeMediaDragGhost(item, file) {
        const ghost = document.createElement("div");
        ghost.className = "cat-te-media-drag-ghost";
        ghost.textContent = file.split(/[\\/]/).pop() || T("asset_fallback_name");
        const thumb = item.querySelector("img");
        if (thumb?.src) ghost.style.backgroundImage = `url(${thumb.src})`;
        return ghost;
    }

    _updateMediaDragHover(clientX, clientY) {
        const host = this.tlHost;
        const scroll = this._timeline?.scrollEl;
        if (!host && !scroll) return;
        const r = (host || scroll).getBoundingClientRect();
        const over = clientX >= r.left && clientX <= r.right
            && clientY >= r.top && clientY <= r.bottom;
        host?.classList.toggle("cat-te-file-drop-over", over);
        scroll?.classList.toggle("cat-te-drop-active", over);
        document.body.classList.toggle("cat-te-media-dnd-over-tl", over);

        const prev = this._dndHoverClip;
        const next = over ? (this._findClipAtGeometry(clientX, clientY) ?? null) : null;
        if (prev?.id !== next?.id) {
            prev?.el?.classList.remove("cat-te-drop-target");
            next?.el?.classList.add("cat-te-drop-target");
            this._dndHoverClip = next;
        }
    }

    _clearMediaDragVisuals(item, ghost) {
        item?.classList.remove("dragging");
        ghost?.remove();
        document.body.classList.remove("cat-te-media-dnd", "cat-te-media-dnd-over-tl");
        this.tlHost?.classList.remove("cat-te-file-drop-over");
        this._timeline?.scrollEl?.classList.remove("cat-te-drop-active");
        this._dndHoverClip?.el?.classList.remove("cat-te-drop-target");
        // Keep _dndHoverClip until _commitMediaDrop reads it.
    }

    _commitMediaDrop(media, clientX, clientY) {
        const tl = this._timeline;
        if (!tl || !media?.file) return;
        // Hit-test the whole timeline host (not only scrollEl) so drops on
        // track headers / padding still count.
        const host = this.tlHost || tl.scrollEl;
        if (!host) return;
        const r = host.getBoundingClientRect();
        if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return;

        const { kind, file } = media;
        const targetClip = this._dndHoverClip
            || this._findClipAt(clientX, clientY)
            || this._findClipAtGeometry(clientX, clientY);
        this._dndHoverClip = null;

        if (targetClip && (kind === "image" || kind === "video") && targetClip.track.type === "image") {
            this._timeline.selectClip(targetClip);
            this._insertItemIntoClip(targetClip, file, kind);
            return;
        }
        const t = tl.currentTime;
        if (kind === "audio") void this._addAudioAtTime(file, t, clientY);
        else if (kind === "video") void this._addVideoAtTime(file, t, clientY);
        else void this._addImageAtTime(file, t, clientY);
    }

    _trackHasRoom(track, atSec, duration) {
        if (!track || track.locked) return false;
        const next = [...track.clips].sort((a, b) => a.startTime - b.startTime)
            .find(clip => clip.endTime > atSec);
        if (!next) return true;
        if (next.startTime < atSec + duration) return false;
        return true;
    }

    _createInsertTrack(kind) {
        const type = kind === "audio"
            ? "audio"
            : kind === "voiceover"
                ? "voiceover"
                : isMediaTrackType(kind)
                    ? "video"
                    : "image";
        const track = this._timeline.addTrack({
            type,
            name: type === "audio"
                ? T("audio_track_name")
                : type === "voiceover"
                    ? T("voiceover_track_name")
                    : isMediaTrackType(type)
                        ? T("media_track_name")
                        : T("director_track_name"),
            height: trackHeightFor(type),
        });
        this._trackInfo.set(track.id, {
            trackIndex: this._nextTrackIndex(), enabled: true,
            role: type === "audio" ? "audio" : type === "voiceover" ? "voiceover" : isMediaTrackType(type) ? "media" : "director",
        });
        this._setupTrackControls(track);
        this._applyTrackTypeOrder();
        return track;
    }

    _pickInsertImageTrack(atSec, duration = 0.05) {
        const tracks = this._allImageTracks().filter(t => !t.locked && t.visible !== false);
        for (const track of tracks) {
            if (this._trackHasRoom(track, atSec, duration)) return track;
        }
        return this._createInsertTrack("image");
    }

    _pickInsertMediaTrack(atSec, duration = 0.05) {
        const tracks = this._allMediaTracks().filter(t => !t.locked && t.visible !== false);
        for (const track of tracks) {
            if (this._trackHasRoom(track, atSec, duration)) return track;
        }
        return this._createInsertTrack("video");
    }

    _pickAudioTrack(clientY, atSec = 0, duration = 0.05) {
        const hovered = this._timeline?._findTrackAtY(clientY, "audio");
        if (hovered && this._trackHasRoom(hovered, atSec, duration)) return hovered;
        return this._allAudioTracks().find(t => this._trackHasRoom(t, atSec, duration))
            ?? this._createInsertTrack("audio");
    }

    _addMediaAtPlayhead(filename) {
        if (!this._timeline) return;
        this._addImageAtTime(filename, this._timeline.currentTime, null);
    }

    _addAudioAtPlayhead(filename) {
        if (!this._timeline) return;
        this._addAudioAtTime(filename, this._timeline.currentTime, null);
    }

    _addVideoAtPlayhead(filename) {
        if (!this._timeline) return;
        this._addVideoAtTime(filename, this._timeline.currentTime, null);
    }

    _showInsertClipMenu(e) {
        const r = e.currentTarget.getBoundingClientRect();
        this._buildCtxMenu([
            { label: T("insert_director_clip_menu"), fn: () => this._insertPackageAtTime(this._timeline?.currentTime ?? 0) },
            { label: T("insert_voiceover_clip_menu"), fn: () => this._insertVoiceoverAtTime(this._timeline?.currentTime ?? 0) },
            { label: T("insert_subtitle_clip_menu"), fn: () => this._insertSubtitleAtTime(this._timeline?.currentTime ?? 0) },
        ], r.left, r.bottom + 4);
    }

    /**
     * Empty Clip containers on image/video tracks — used for 文生视频
     * or as a group that later holds multiple stills / videos.
     */
    _insertPackageAtPlayhead() {
        if (!this._timeline) return;
        this._insertPackageAtTime(this._timeline.currentTime);
    }

    _insertVoiceoverAtTime(atSec, preferredTrack = null) {
        if (!this._timeline) return;
        let track = preferredTrack && isVoiceoverTrackType(preferredTrack.type) ? preferredTrack : null;
        if (track?.locked) track = null;
        const dur = Math.min(2, this._timeline.duration / 4) || 1;
        if (!track) {
            track = this._allVoiceoverTracks().find((t) => !t.locked && this._trackHasRoom(t, atSec, dur));
        }
        this._recordUndo();
        if (!track) {
            track = this._addUserTrack("voiceover") || this._createInsertTrack("voiceover");
        }
        if (!track || track.locked) return;
        this._ensureTimelineLength(atSec + dur);
        const clip = this._timeline.addClip(track.id, {
            name: T("voiceover_clip_default_name"),
            startTime: atSec,
            duration: dur,
            sourceDuration: Infinity,
            sourceOffset: 0,
            src: "",
            color: track.color || "#5bc0de",
        });
        this._meta.set(clip.id, {
            ...defaultVoiceoverMeta(this._trackIndex(track)),
            resourceStartSec: atSec,
            resourceDurationSec: dur,
        });
        this._timeline.selectClip(clip);
        this._timeline.setCurrentTime(atSec);
        this._decorateClip(clip);
        this._refreshTimelineDuration();
        this._scheduleProgramPreview();
    }

    _insertSubtitleAtTime(atSec, preferredTrack = null) {
        if (!this._timeline) return;
        let track = preferredTrack && isSubtitleTrackType(preferredTrack.type) ? preferredTrack : null;
        if (track?.locked) track = null;
        if (!track) {
            track = this._allTextTracks().find((t) => !t.locked && this._trackHasRoom(t, atSec, 0.05));
        }
        this._recordUndo();
        if (!track) {
            track = this._addUserTrack("text");
        }
        if (!track || track.locked) return;
        const dur = Math.min(2, this._timeline.duration / 4) || 1;
        const text = T("subtitle_default_text");
        const clip = this._timeline.addClip(track.id, {
            name: text,
            startTime: atSec,
            duration: dur,
            color: track.color || "#ff9e4a",
        });
        this._meta.set(clip.id, {
            ...defaultSubtitleMeta(this._trackIndex(track)),
            ...pickSubtitleStyle(this._trackInfo.get(track.id)?.subtitleStyle),
            text,
        });
        this._timeline.selectClip(clip);
        this._timeline.setCurrentTime(atSec);
        this._decorateClip(clip);
        this._refreshTimelineDuration();
        this._scheduleProgramPreview();
    }

    _insertPackageAtTime(atSec) {
        if (!this._timeline) return;
        const track = this._pickInsertImageTrack(atSec);
        if (!track) {
            alert(T("no_insertable_track"));
            return;
        }
        const dur = Math.min(2, this._timeline.duration / 4) || 0.1;
        this._recordUndo();
        const clip = this._timeline.addClip(track.id, {
            name: DEFAULT_CLIP_NAME,
            startTime: atSec,
            duration: dur,
            color: "#d9a441",
        });
        const ti = this._trackIndex(track);
        this._meta.set(clip.id, {
            ...defaultImageMeta(ti),
            mediaKind: "clip",
            clipRole: "t2v",
            items: [],
        });
        this._timeline.selectClip(clip);
        this._timeline.setCurrentTime(atSec);
        this._decorateClip(clip);
        this._refreshTimelineDuration();
        this._saveToWidgets();
    }

    async _addImageAtTime(filename, atSec, clientY, { mediaTrack = true } = {}) {
        if (!this._timeline) return;
        const dur = Math.min(2, this._timeline.duration / 4) || 0.1;
        this._recordUndo();
        let track = clientY != null
            ? (this._timeline._findTrackAtY(clientY, "video") || this._timeline._findTrackAtY(clientY, "image"))
            : null;
        if (track?.visible === false || !this._trackHasRoom(track, atSec, dur)) track = null;
        if (!track) track = mediaTrack ? this._pickInsertMediaTrack(atSec, dur) : this._pickInsertImageTrack(atSec, dur);
        const media = this._ensureMedia("image", filename);
        const item = media
            ? { id: media.id, kind: media.kind, file: media.file, useMediaPrompt: true, enabled: true }
            : { kind: "image", file: filename, useMediaPrompt: true, enabled: true };
        const clip = this._timeline.addClip(track.id, {
            name: filename.split(/[\\/]/).pop(),
            startTime: atSec,
            duration: dur,
            thumbnail: this._imgUrl(filename),
            src: filename,
            color: track.color,
        });
        const ti = this._trackIndex(track);
        this._meta.set(clip.id, {
            ...defaultImageMeta(ti),
            clipType: isMediaTrackType(track.type) ? "media" : "image",
            mediaKind: isMediaTrackType(track.type) ? "media" : "clip",
            clipRole: "multi_ref",
            items: [item],
            mediaIds: item.id ? [item.id] : [],
        });
        this._timeline.selectClip(clip);
        this._timeline.setCurrentTime(atSec);
        this._decorateClip(clip);
        this._refreshTimelineDuration();
    }

    async _addAudioAtTime(filename, atSec, clientY) {
        if (!this._timeline) return;
        const url = this._audioUrl(filename);
        let peaks = null;
        let sourceDur = 30;
        let buffer = null;
        try {
            const r = await this._fetchPeaks(url);
            peaks = r.peaks[0];
            sourceDur = r.duration;
            buffer = r.buffer;
        } catch {
            try {
                sourceDur = await this._probeAudioDuration(url);
            } catch { /* keep default */ }
        }
        const dur = Math.max(0.05, sourceDur);
        this._ensureTimelineLength(atSec + dur);
        this._recordUndo();
        const media = this._ensureMedia("audio", filename);
        const track = this._pickAudioTrack(clientY ?? 0, atSec, dur);
        const clip = this._timeline.addClip(track.id, {
            name: filename.split(/[\\/]/).pop(),
            startTime: atSec,
            duration: dur,
            sourceDuration: sourceDur,
            sourceOffset: 0,
            src: filename,
            waveformPeaks: peaks,
            color: track.color,
        });
        clip._audioBuffer = buffer;
        const ti = this._trackIndex(track);
        this._meta.set(clip.id, {
            ...defaultAudioMeta(ti),
            sourceDuration: sourceDur,
            trimIn: 0,
            mediaId: media?.id || "",
        });
        this._timeline.selectClip(clip);
        this._timeline.setCurrentTime(atSec);
        this._decorateClip(clip);
        this._refreshTimelineDuration();
        this._saveToWidgets();
    }

    /** Video clips use their source length. Their waveform is shown only
     * when the source actually contains an audio stream. */
    async _addVideoAtTime(filename, atSec, clientY, { mediaTrack = true } = {}) {
        if (!this._timeline) return;
        const url = this._videoUrl(filename);
        let videoDur = 2;
        try {
            videoDur = await this._probeVideoDuration(url);
        } catch { /* keep default */ }
        const dur = Math.max(0.05, videoDur);

        let thumbnail = null;
        try {
            thumbnail = await this._grabVideoThumbnail(url);
        } catch { /* no preview available */ }

        let peaks = null;
        let hasAudio = false;
        let buffer = null;
        try {
            const r = await this._fetchPeaks(url);
            peaks = r.peaks[0];
            hasAudio = true;
            buffer = r.buffer;
        } catch { hasAudio = false; }

        this._ensureTimelineLength(atSec + dur);
        this._recordUndo();
        const media = this._ensureMedia("video", filename);
        const item = media
            ? { id: media.id, kind: media.kind, file: media.file, useMediaPrompt: true, enabled: true }
            : { kind: "video", file: filename, useMediaPrompt: true, enabled: true };
        let track = clientY != null
            ? (this._timeline._findTrackAtY(clientY, "video") || this._timeline._findTrackAtY(clientY, "image"))
            : null;
        if (track?.visible === false || !this._trackHasRoom(track, atSec, dur)) track = null;
        if (!track) track = mediaTrack ? this._pickInsertMediaTrack(atSec, dur) : this._pickInsertImageTrack(atSec, dur);
        const clip = this._timeline.addClip(track.id, {
            name: filename.split(/[\\/]/).pop(),
            startTime: atSec,
            duration: dur,
            sourceDuration: dur,
            sourceOffset: 0,
            thumbnail,
            src: filename,
            waveformPeaks: peaks,
            hasAudio,
            color: track.color,
        });
        clip._audioBuffer = buffer;
        const ti = this._trackIndex(track);
        this._meta.set(clip.id, {
            ...defaultImageMeta(ti),
            clipType: isMediaTrackType(track.type) ? "media" : "image",
            mediaKind: isMediaTrackType(track.type) ? "media" : "clip",
            clipRole: "video_ref",
            sourceDuration: dur,
            items: [item],
            mediaIds: item.id ? [item.id] : [],
        });
        this._timeline.selectClip(clip);
        this._timeline.setCurrentTime(atSec);
        this._decorateClip(clip);
        this._refreshTimelineDuration();
    }

    async _probeVideoDuration(url) {
        return new Promise((resolve, reject) => {
            const v = document.createElement("video");
            v.preload = "metadata";
            v.muted = true;
            v.addEventListener("loadedmetadata", () => {
                if (Number.isFinite(v.duration) && v.duration > 0) resolve(v.duration);
                else reject(new Error("invalid duration"));
            });
            v.addEventListener("error", () => reject(new Error("load failed")));
            v.src = url;
        });
    }

    _runVideoThumbJob(fn) {
        return new Promise((resolve, reject) => {
            this._videoThumbWaiters.push({ fn, resolve, reject });
            this._pumpVideoThumbQueue();
        });
    }

    _pumpVideoThumbQueue() {
        const max = 2;
        while (this._videoThumbActive < max && this._videoThumbWaiters.length) {
            const job = this._videoThumbWaiters.shift();
            this._videoThumbActive += 1;
            Promise.resolve()
                .then(() => job.fn())
                .then(job.resolve, job.reject)
                .finally(() => {
                    this._videoThumbActive = Math.max(0, this._videoThumbActive - 1);
                    this._pumpVideoThumbQueue();
                });
        }
    }

    async _grabVideoThumbnail(url, atSec = 0.15) {
        return this._runVideoThumbJob(() => this._grabVideoThumbnailOnce(url, atSec));
    }

    _grabVideoThumbnailOnce(url, atSec = 0.15) {
        return new Promise((resolve, reject) => {
            const v = document.createElement("video");
            v.preload = "metadata";
            v.muted = true;
            v.playsInline = true;
            let done = false;
            const finish = (fn, value) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                try {
                    v.removeAttribute("src");
                    v.load();
                } catch { /* ignore */ }
                fn(value);
            };
            const timer = setTimeout(() => finish(reject, new Error("thumb timeout")), 8000);
            const draw = () => {
                try {
                    const srcW = Math.max(1, v.videoWidth || 160);
                    const srcH = Math.max(1, v.videoHeight || 90);
                    const maxSide = 160;
                    const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
                    const canvas = document.createElement("canvas");
                    canvas.width = Math.max(1, Math.round(srcW * scale));
                    canvas.height = Math.max(1, Math.round(srcH * scale));
                    canvas.getContext("2d").drawImage(v, 0, 0, canvas.width, canvas.height);
                    finish(resolve, canvas.toDataURL("image/jpeg", 0.72));
                } catch (err) {
                    finish(reject, err);
                }
            };
            v.addEventListener("loadedmetadata", () => {
                const dur = Number.isFinite(v.duration) ? v.duration : 0;
                const t = dur > 0
                    ? Math.min(Math.max(0, atSec), Math.max(0, dur - 0.05))
                    : 0;
                const seek = () => {
                    try {
                        v.currentTime = t;
                    } catch {
                        draw();
                    }
                };
                // Some files already sit at the target time and never fire `seeked`.
                if (Math.abs((v.currentTime || 0) - t) < 0.001) {
                    if (v.readyState >= 2) draw();
                    else v.addEventListener("loadeddata", draw, { once: true });
                    return;
                }
                v.addEventListener("seeked", draw, { once: true });
                seek();
            });
            v.addEventListener("error", () => finish(reject, new Error("load failed")));
            v.src = url;
        });
    }

    /** Cached (and de-duped) thumbnail lookup for the video media grid —
     * each file is only decoded/seeked once per editor session. */
    _getVideoThumbnail(file) {
        if (this._videoThumbCache.has(file)) return this._videoThumbCache.get(file);
        const p = this._grabVideoThumbnail(this._videoUrl(file)).catch(() => null);
        this._videoThumbCache.set(file, p);
        return p;
    }

    _audioBufferToPeaks(buf, max = 8000) {
        const ch = Math.min(2, buf.numberOfChannels || 1);
        const peaks = [];
        for (let c = 0; c < ch; c++) {
            const d = buf.getChannelData(c);
            const chunk = Math.max(1, Math.floor(d.length / max));
            const list = [];
            for (let i = 0; i < max; i++) {
                const s = i * chunk;
                const end = Math.min(s + chunk, d.length);
                let m = 0;
                for (let j = s; j < end; j++) {
                    const v = Math.abs(d[j]);
                    if (v > m) m = v;
                }
                list.push(m);
            }
            peaks.push(list);
        }
        if (peaks.length === 1) peaks.push(peaks[0].slice());
        return peaks;
    }

    async _probeAudioDuration(url) {
        return new Promise((resolve, reject) => {
            const a = new Audio();
            a.preload = "metadata";
            const done = (v) => { a.src = ""; resolve(v); };
            a.addEventListener("loadedmetadata", () => {
                if (Number.isFinite(a.duration) && a.duration > 0) done(a.duration);
                else reject(new Error("invalid duration"));
            });
            a.addEventListener("error", () => reject(new Error("load failed")));
            a.src = url;
        });
    }

    /** Restore full media length when project JSON only stored the trimmed window. */
    async _reconcileClipSourceDurations() {
        const tl = this._timeline;
        if (!tl) return;
        const tasks = [];
        for (const track of tl.tracks) {
            for (const clip of track.clips) {
                if (!clip.src) continue;
                const isAudio = track.type === "audio";
                const m = this._meta.get(clip.id);
                const isVideo = m?.mediaKind === "video";
                if (!isAudio && !isVideo) continue;
                const cur = Number(clip.sourceDuration);
                if (Number.isFinite(cur) && cur > clip.duration + 0.01) continue;
                const url = isAudio ? this._audioUrl(clip.src) : this._videoUrl(clip.src);
                if (!url) continue;
                tasks.push((async () => {
                    try {
                        const probed = isAudio
                            ? await this._probeAudioDuration(url)
                            : await this._probeVideoDuration(url);
                        if (!Number.isFinite(probed) || probed <= clip.duration + 0.01) return;
                        clip.sourceDuration = probed;
                        const meta = this._meta.get(clip.id)
                            ?? (isAudio ? defaultAudioMeta() : defaultImageMeta());
                        meta.sourceDuration = probed;
                        this._meta.set(clip.id, meta);
                    } catch { /* keep existing */ }
                })());
            }
        }
        await Promise.all(tasks);
    }

    async _fetchPeaks(url) {
        const r = await fetch(url, { credentials: "same-origin" });
        if (!r.ok) throw new Error(T("audio_load_failed_status", { status: r.status }));
        const ab = await r.arrayBuffer();
        const ctx = new AudioContext();
        try {
            const buf = await ctx.decodeAudioData(ab.slice(0));
            // `buf` stays valid after this context closes — AudioBuffers aren't
            // tied to the context that decoded them, so it's cached on the
            // clip for playback instead of being re-fetched/re-decoded later.
            return { peaks: this._audioBufferToPeaks(buf), duration: buf.duration, buffer: buf };
        } finally {
            await ctx.close();
        }
    }

    async _syncProjectMedia() {
        if (!this._timeline) return;
        const wanted = new Map();
        const add = (kind, file) => {
            file = String(file || "").trim();
            kind = mediaKindFromFilename(file, kind);
            if (!kind || !file || !["image", "video", "audio"].includes(kind)) return;
            wanted.set(`${kind}:${file}`, { kind, file });
            this._ensureMedia(kind, file);
        };
        for (const resource of this._projectResources) {
            add(resource.kind, resource.file);
        }
        for (const track of this._timeline.tracks) {
            for (const clip of track.clips) {
                const meta = this._meta.get(clip.id);
                if (track.type === "audio") add("audio", clip.src);
                else {
                    for (const item of this._clipItems(meta)) add(item.kind, item.file);
                }
            }
        }
        for (const { kind, file } of wanted.values()) {
            const list = kind === "audio" ? this._audioFiles : kind === "video" ? this._videoFiles : this._imgFiles;
            let status = { location: "missing" };
            try {
                const url = api.apiURL(
                    `/audio_keyframe_timeline/asset_status?dir=&name=${encodeURIComponent(file)}&kind=${kind}`,
                );
                const response = await fetch(url);
                const data = await response.json();
                if (data.input_exists) status = { location: "input" };
            } catch { /* retain missing status */ }
            this._mediaStatus.set(`${kind}:${file}`, status);
            if (!list.includes(file)) list.push(file);
        }
    }

    _assetFileUrl(file, kind, location = "input") {
        return api.apiURL(
            `/audio_keyframe_timeline/asset_file?dir=`
            + `&name=${encodeURIComponent(file)}&kind=${encodeURIComponent(kind)}`
            + `&location=${encodeURIComponent(location || "input")}`
        );
    }

    // ─── Audio playback ─────────────────────────────────────────────────
    //
    // At any seek position there can be several simultaneous audio-bearing
    // sources: one clip per audio track (a track can't have overlapping
    // clips, but there can be several audio tracks), plus a video-with-audio
    // clip on the main track and/or the overlay track. Rather than mixing
    // these down into one buffer ourselves, each audible clip gets its own
    // AudioBufferSourceNode connected to the same AudioContext destination —
    // the Web Audio API mixes any number of simultaneous sources for free.

    _ensurePlaybackContext() {
        if (!this._playbackCtx) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            this._playbackCtx = new Ctx();
        }
        if (this._playbackCtx.state === "suspended") this._playbackCtx.resume();
        return this._playbackCtx;
    }

    /** Clips that should actually be heard: not muted, not hidden, not
     * disabled — mirrors what `_decorateClip` already treats as "excluded
     * from the render" for image/video tracks. */
    _collectAudibleClips() {
        const out = [];
        for (const track of this._timeline?.tracks ?? []) {
            for (const clip of track.clips) {
                if (!clip._audioBuffer) continue;
                const m = this._meta.get(clip.id);
                if (track.type === "audio") {
                    if (track.muted || m?.muted) continue;
                } else {
                    if (!clip.hasAudio) continue;
                    if (track.visible === false || m?.disabled) continue;
                    if (track.muted) continue;
        // Generated-video preview audio is scheduled separately
                    // via Web Audio (canvas <video> stays muted).
                    if (this._clipUsesGeneratedPreview(m)) continue;
                }
                out.push(clip);
            }
        }
        return out;
    }

    /**
     * Generated-video audio jobs from `fromTime` onward (absolute timeline secs).
     * Canvas preview videos stay muted; these feed Web Audio instead.
     */
    _collectGeneratedVideoAudioJobs(fromTime) {
        const jobs = [];
        const t0 = Math.max(0, Number(fromTime) || 0);
        for (const track of this._allImageTracks()) {
            if (track.visible === false || track.muted) continue;
            const info = this._trackInfo.get(track.id) || {};
            if (info.enabled === false) continue;
            for (const clip of track.clips) {
                const m = this._meta.get(clip.id) ?? defaultImageMeta();
                if (m.disabled || m.visible === false) continue;
                if (!this._clipUsesGeneratedPreview(m)) continue;
                const gens = this._clipGeneratedVideos(m).filter((g) => g.enabled !== false);
                // Newest-first: one unmuted gen per clip (topmost).
                let picked = null;
                for (const gen of gens) {
                    if (gen.muted === true || !gen.file) continue;
                    const editStart = Math.max(0, Number(gen.edit_start_sec) || 0);
                    const tin = Math.max(0, Number(gen.trim_in_sec) || 0);
                    let eff = this._genEffectiveDurationSec(gen);
                    if (!(eff > 0)) {
                        const full = Number(gen.duration_sec);
                        eff = Number.isFinite(full) && full > tin
                            ? Math.min(full - tin, Math.max(0.05, clip.duration - editStart))
                            : Math.max(0.05, clip.duration - editStart);
                    }
                    const absStart = clip.startTime + editStart;
                    const absEnd = Math.min(clip.endTime, absStart + eff);
                    if (absEnd <= t0 + 1e-6) continue;
                    picked = { file: gen.file, location: "output", tin, absStart, absEnd };
                    break;
                }
                if (picked) jobs.push(picked);
                // Detached audios from gen-edit modal (saved on the clip).
                for (const row of this._normalizeGenEditAudioDraft(m.genEditAudios)) {
                    if (row.muted === true || !row.file) continue;
                    const absStart = clip.startTime + Math.max(0, Number(row.edit_start_sec) || 0);
                    const absEnd = absStart + Math.max(0.05, Number(row.duration) || 0.05);
                    if (absEnd <= t0 + 1e-6) continue;
                    jobs.push({
                        file: row.file,
                        location: "input",
                        tin: Math.max(0, Number(row.source_offset) || 0),
                        absStart,
                        absEnd,
                    });
                }
            }
        }
        return jobs;
    }

    async _scheduleGeneratedVideoWebAudio(startCtxTime, startPlayhead) {
        const tl = this._timeline;
        if (!tl?._playing) return;
        const token = (this._genMainAudioToken = (this._genMainAudioToken || 0) + 1);
        const ctx = this._ensurePlaybackContext();
        const jobs = this._collectGeneratedVideoAudioJobs(startPlayhead);
        for (const job of jobs) {
            const buffer = await this._ensureGenVideoAudioBuffer(job.file, job.location || "output");
            if (!buffer || this._genMainAudioToken !== token || !tl._playing) return;
            const src = ctx.createBufferSource();
            src.buffer = buffer;
            const gain = ctx.createGain();
            src.connect(gain);
            gain.connect(ctx.destination);
            gain.gain.setValueAtTime(1, startCtxTime);

            let when;
            let offset;
            let dur;
            if (job.absStart <= startPlayhead) {
                when = startCtxTime;
                offset = job.tin + (startPlayhead - job.absStart);
                dur = job.absEnd - startPlayhead;
            } else {
                when = startCtxTime + (job.absStart - startPlayhead);
                offset = job.tin;
                dur = job.absEnd - job.absStart;
            }
            const maxOff = Math.max(0, buffer.duration - 0.001);
            offset = Math.max(0, Math.min(offset, maxOff));
            dur = Math.max(0.001, Math.min(dur, Math.max(0.001, buffer.duration - offset)));
            try {
                src.start(when, offset, dur);
                this._activeAudioSources.push({ src, gain });
            } catch { /* skip */ }
        }
    }

    /** Linear fade envelope for Web Audio playback of an audio-track clip. */
    _scheduleAudioFadeGain(gainNode, when, localStart, playDur, fadeIn, fadeOut, clipDur) {
        const clamp01 = (v) => Math.max(0, Math.min(1, v));
        const gAt = (t) => {
            let g = 1;
            if (fadeIn > 0 && t < fadeIn) g = Math.min(g, t / fadeIn);
            if (fadeOut > 0 && t > clipDur - fadeOut) {
                g = Math.min(g, Math.max(0, (clipDur - t) / fadeOut));
            }
            return clamp01(g);
        };
        const localEnd = localStart + playDur;
        const pts = [localStart, localEnd];
        if (fadeIn > 0 && fadeIn > localStart && fadeIn < localEnd) pts.push(fadeIn);
        const fadeOutStart = clipDur - fadeOut;
        if (fadeOut > 0 && fadeOutStart > localStart && fadeOutStart < localEnd) {
            pts.push(fadeOutStart);
        }
        pts.sort((a, b) => a - b);
        const uniq = [];
        for (const p of pts) {
            const r = Math.round(p * 1e6) / 1e6;
            if (!uniq.length || Math.abs(uniq[uniq.length - 1] - r) > 1e-6) uniq.push(r);
        }
        gainNode.gain.cancelScheduledValues(when);
        for (let i = 0; i < uniq.length; i++) {
            const localT = uniq[i];
            const t = when + (localT - localStart);
            const g = gAt(localT);
            if (i === 0) gainNode.gain.setValueAtTime(g, Math.max(when, t));
            else gainNode.gain.linearRampToValueAtTime(g, Math.max(when, t));
        }
    }

    _startAudioPlayback() {
        this._stopAudioPlayback();
        const tl = this._timeline;
        if (!tl) return;
        const ctx = this._ensurePlaybackContext();
        const startCtxTime = ctx.currentTime + 0.03; // small lead-in so scheduling never lands in the past
        const startPlayhead = tl.currentTime;
        const sources = [];

        for (const clip of this._collectAudibleClips()) {
            if (clip.endTime <= startPlayhead) continue; // already fully played past

            const src = ctx.createBufferSource();
            src.buffer = clip._audioBuffer;
            const gain = ctx.createGain();
            src.connect(gain);
            gain.connect(ctx.destination);

            let when, offset, dur, localStart;
            if (clip.startTime <= startPlayhead) {
                when = startCtxTime;
                localStart = startPlayhead - clip.startTime;
                offset = clip.sourceOffset + localStart;
                dur = clip.endTime - startPlayhead;
            } else {
                when = startCtxTime + (clip.startTime - startPlayhead);
                localStart = 0;
                offset = clip.sourceOffset;
                dur = clip.duration;
            }
            const fadeIn = clip.track?.type === "audio" ? Math.max(0, clip.fadeIn || 0) : 0;
            const fadeOut = clip.track?.type === "audio" ? Math.max(0, clip.fadeOut || 0) : 0;
            if (fadeIn > 0 || fadeOut > 0) {
                this._scheduleAudioFadeGain(gain, when, localStart, dur, fadeIn, fadeOut, clip.duration);
            } else {
                gain.gain.setValueAtTime(1, when);
            }
            try {
                src.start(when, Math.max(0, offset), Math.max(0.001, dur));
                sources.push({ src, gain });
            } catch { /* clip's buffer/offset out of range — skip it */ }
        }
        this._activeAudioSources = sources;
        // Generated-video audio (was HTML5 unmute on canvas decoders → noise).
        void this._scheduleGeneratedVideoWebAudio(startCtxTime, startPlayhead);
    }

    _stopAudioPlayback() {
        this._genMainAudioToken = (this._genMainAudioToken || 0) + 1;
        if (this._seekAudioRaf) {
            cancelAnimationFrame(this._seekAudioRaf);
            this._seekAudioRaf = null;
        }
        for (const row of this._activeAudioSources) {
            const src = row?.src ?? row;
            const gain = row?.gain;
            try { src.stop(); } catch { /* already stopped */ }
            try { src.disconnect(); } catch { /* already disconnected */ }
            if (gain) {
                try { gain.disconnect(); } catch { /* already disconnected */ }
            }
        }
        this._activeAudioSources = [];
    }

    _initTimelineFromWidgets(projectOverride = null, options = {}) {
        return this._initTimelineFromWidgetsAsync(projectOverride, options);
    }

    _resolvedScalar(widgetVal, settingsVal, defaultVal) {
        const w = widgetVal ?? defaultVal;
        if (settingsVal == null) return w;
        if (w !== settingsVal) return w;
        return settingsVal;
    }

    _setWidgetText(widget, text) {
        if (!widget) return;
        const next = String(text ?? "");
        if (widget.value !== next) widget.value = next;
        const ta = resolvePromptTextarea(widget);
        if (ta && ta.value !== next) {
            ta.value = next;
            updateRichPromptMirror(ta);
        }
    }

    _applyScalarSettings(settings, { applySettingsFromProject = false } = {}) {
        for (const name of ["fps", "width", "height"]) {
            const widget = this._w(name);
            if (!widget) continue;
            const sVal = settings[name];
            const next = applySettingsFromProject
                ? (sVal != null ? sVal : widget.value)
                : this._resolvedScalar(widget.value, sVal, PY_SCALAR_DEFAULTS[name]);
            widget.value = next;
        }
        this._syncProjectScalarDisplay();
    }

    /** Keep project_json.settings aligned with node scalar widgets. */
    _syncScalarsToProjectJson() {
        const projectW = this._w("project_json");
        if (!projectW) return;
        const parsed = this._parseProjectWidgetValue();
        if (parsed.error || !parsed.project) return;
        const project = parsed.project;
        if (!project.settings || typeof project.settings !== "object") project.settings = {};
        migrateProjectSettingPrompts(project.settings);
        project.settings.fps = Number(this._w("fps")?.value ?? PY_SCALAR_DEFAULTS.fps);
        project.settings.width = Number(this._w("width")?.value ?? PY_SCALAR_DEFAULTS.width);
        project.settings.height = Number(this._w("height")?.value ?? PY_SCALAR_DEFAULTS.height);
        for (const key of SETTING_PROMPT_KEYS) {
            project.settings[key] = this._readSettingPrompt(key);
        }
        project.settings.prompt_concat_order = this._getPromptConcatOrder();
        delete project.settings.ignore_occluded;
        this._writeProjectJson(JSON.stringify(project));
        this._syncProjectScalarDisplay();
    }

    async _initTimelineFromWidgetsAsync(projectOverride = null, { applySettingsFromProject = false } = {}) {
        const loadSeq = ++this._loadSeq;
        this._timelineReady = false;
        this._meta.clear();
        this._trackInfo.clear();
        if (loadSeq !== this._loadSeq) return;
        this.tlHost.replaceChildren();

        const fps = this.getFps();
        this._timeline = new Timeline(this.tlHost, {
            duration: 60,
            fps,
            timeFormat: "frames",
            zoom: 1.2,
            addTrackTypes: ["text", "video", "image", "voiceover", "audio"],
        });

        let project = projectOverride;
        if (!project) {
            const parsed = this._parseProjectWidgetValue();
            if (parsed.error) throw parsed.error;
            project = parsed.project || {
                project_version: this._currentVersion(),
                schema_version: this._currentSchemaVersion(),
                media: [],
                settings: {},
                tracks: [],
            };
        }
        project = this._migrateProjectDocument(project);
        this._applyMediaCatalogFromProject(project);
        this.projectNameInput.value = String(project.name || T("untitled_project")).trim() || T("untitled_project");
        this._syncBrandProjectName();

        const settings = project.settings && typeof project.settings === "object" ? project.settings : {};
        this._applyScalarSettings(settings, { applySettingsFromProject });
        this._watermark = this._normalizeWatermark(settings.watermark);
        this._promptConcatOrder = normalizePromptConcatOrder(settings.prompt_concat_order);
        this._renderPromptConcatOrderList();
        this._useClipSpecifiedVideoFilename = settings.use_clip_specified_video_filename !== false;
        // Legacy global mode → migrate onto per-clip previewMode after clips load.
        this._legacyTimelineEditMode = settings.timeline_edit_mode === "generated" ? "generated" : null;
        project.settings = {
            ...settings,
            fps: Number(this._w("fps")?.value ?? PY_SCALAR_DEFAULTS.fps),
            width: Number(this._w("width")?.value ?? PY_SCALAR_DEFAULTS.width),
            height: Number(this._w("height")?.value ?? PY_SCALAR_DEFAULTS.height),
            ...Object.fromEntries(SETTING_PROMPT_KEYS.map((key) => [
                key,
                String(settings[key] ?? this._readSettingPrompt(key) ?? ""),
            ])),
            prompt_concat_order: this._getPromptConcatOrder(),
            use_clip_specified_video_filename: this._useClipSpecifiedVideoFilename !== false,
        };
        let wroteAnySettingPrompt = false;
        this._settingPromptSyncing = true;
        try {
            for (const key of SETTING_PROMPT_KEYS) {
                const input = this._settingPromptInputs?.[key];
                if (!input) continue;
                if (settings[key] != null) {
                    setRichPromptValue(input, String(settings[key]), true);
                    wroteAnySettingPrompt = true;
                }
            }
        } finally {
            this._settingPromptSyncing = false;
        }
        if (wroteAnySettingPrompt) this._syncScalarsToProjectJson();
        else this._syncSettingPromptInputs();
        this._syncProjectScalarDisplay();
        this._timeline.fps = this.getFps();

        const projectTracks = Array.isArray(project.tracks) ? project.tracks : [];
        const tracksCfg = projectTracks.map((track, order) => {
            const rawType = String(track.type || "visual").toLowerCase();
            const type = rawType === "audio"
                ? "audio"
                : rawType === "voiceover"
                    ? "voiceover"
                    : (rawType === "subtitle" || rawType === "text")
                        ? "text"
                        : (rawType === "media" || rawType === "video")
                            ? "video"
                            : "image";
            return {
                ...track,
                type,
                trackIndex: order,
                isMain: track.role === "main",
            };
        });

        if (!tracksCfg.length) {
            this._createDefaultTracks();
        } else {
            this._loadTracksFromJson(tracksCfg);
        }

        const clips = this._clipsFromProjectTracks(project, this.getFps());
        if (loadSeq !== this._loadSeq) return;
        await Promise.all(clips.map((c) => this._addClipFromJson(c).catch(() => null)));
        if (loadSeq !== this._loadSeq) return;
        await this._reconcileClipSourceDurations();
        if (loadSeq !== this._loadSeq) return;
        this._applyTrackTypeOrder();

        this._refreshTimelineDuration();
        this._applyTimelineZoomFromSettings(settings);
        // Merge local cache under project settings so project wins when present.
        const viewSettings = { ...this._readViewFromLocalCache(), ...settings };
        this._applyTimelineViewFromSettings(viewSettings, { applyZoom: false });
        this._decorateAllClips();
        this._bindTimelineEvents();
        this._configureTimelineUi();
        if (loadSeq !== this._loadSeq) return;
        this._timelineReady = true;
        if (this._legacyTimelineEditMode === "generated") {
            for (const { clip, meta } of this._clipsWithEnabledGeneratedVideo()) {
                if (meta.previewMode !== "generated") {
                    meta.previewMode = "generated";
                    this._meta.set(clip.id, meta);
                }
            }
            this._legacyTimelineEditMode = null;
        }
        void this._applyTimelineEditMode();
        this._saveToWidgets();
        this._ensureProgramPreviewObserver();
        this._scheduleProgramPreview();
    }

    _createDefaultTracks() {
        const tl = this._timeline;
        this._overlayTrack = null;
        this._subtitleTrack = tl.addTrack({
            type: "text", name: T("subtitle_track_name"), height: trackHeightFor("text"), color: "#ff9e4a",
        });
        this._mediaTrack = tl.addTrack({
            type: "video", name: T("media_track_name"), height: TRACK_HEIGHT, color: "#ef4444",
        });
        this._mainTrack = tl.addTrack({
            type: "image", name: T("director_track_name"), isMain: true, height: TRACK_HEIGHT, color: "#8b4ec8",
        });
        this._voiceoverTrack = tl.addTrack({
            type: "voiceover", name: T("voiceover_track_name"), height: TRACK_HEIGHT, color: "#5bc0de",
        });
        this._audioTrack = tl.addTrack({
            type: "audio", name: T("audio_track_name"), height: trackHeightFor("audio"), color: "#3dd68c",
        });
        this._trackInfo.set(this._subtitleTrack.id, {
            trackIndex: 0, enabled: true, role: "subtitle", subtitleStyle: pickSubtitleStyle(defaultSubtitleMeta()),
        });
        this._trackInfo.set(this._mediaTrack.id, { trackIndex: 1, enabled: true, role: "media" });
        this._trackInfo.set(this._mainTrack.id, { trackIndex: 2, enabled: true, role: "director" });
        this._trackInfo.set(this._voiceoverTrack.id, { trackIndex: 3, enabled: true, role: "voiceover" });
        this._trackInfo.set(this._audioTrack.id, { trackIndex: 4, enabled: true, role: "audio" });
        for (const t of [this._subtitleTrack, this._mediaTrack, this._mainTrack, this._voiceoverTrack, this._audioTrack]) {
            this._setupTrackControls(t);
        }
    }

    _loadTracksFromJson(rows) {
        const tl = this._timeline;
        const ordered = [...rows].sort((a, b) => (a.trackIndex ?? 0) - (b.trackIndex ?? 0));

        ordered.forEach((row, index) => {
            const isMain = !!row.isMain;
            const isSubtitle = isSubtitleTrackType(row.type);
            const track = tl.addTrackAt({
                id: row.id,
                type: row.type || "image",
                name: row.name || (
                    row.type === "audio"
                        ? T("audio_track_name")
                        : isVoiceoverTrackType(row.type)
                            ? T("voiceover_track_name")
                            : isSubtitleTrackType(row.type)
                                ? T("subtitle_track_name")
                                : isMediaTrackType(row.type)
                                    ? T("media_track_name")
                                    : T("director_track_name")
                ),
                isMain,
                height: trackHeightFor(row.type),
                color: row.color,
                locked: !!row.locked,
                visible: row.visible !== false,
                muted: !!row.muted,
            }, index);
            track.setLocked(!!row.locked);
            track.setVisible(row.visible !== false);
            track.setMuted(!!row.muted);
            const savedSubtitleStyle = row.subtitle_style && typeof row.subtitle_style === "object"
                ? row.subtitle_style
                : null;
            const legacySubtitleClip = isSubtitle
                ? (Array.isArray(row.clips) ? row.clips : []).find((clip) => clip && typeof clip === "object")
                : null;
            this._trackInfo.set(track.id, {
                trackIndex: row.trackIndex ?? index,
                enabled: row.enabled !== false,
                role: row.role || (
                    isMain
                        ? "main"
                        : row.type === "audio"
                            ? "audio"
                            : isVoiceoverTrackType(row.type)
                                ? "voiceover"
                                : isSubtitleTrackType(row.type)
                                 ? "subtitle"
                                     : isMediaTrackType(row.type)
                                         ? "media"
                                         : "director"
                ),
                ...(isSubtitle
                    ? {
                        subtitleStyle: {
                            ...pickSubtitleStyle(defaultSubtitleMeta()),
                            ...subtitleStyleFromJson(savedSubtitleStyle || legacySubtitleClip?.style || legacySubtitleClip),
                        },
                    }
                    : {}),
            });
            this._setupTrackControls(track);
        });
        this._syncTrackRoleRefs();
    }

    /** Re-bind main / overlay / audio track refs after rebuild from JSON. */
    _syncTrackRoleRefs() {
        this._mainTrack = null;
        this._overlayTrack = null;
        this._mediaTrack = null;
        this._subtitleTrack = null;
        this._voiceoverTrack = null;
        this._audioTrack = null;
        for (const track of this._timeline?.tracks ?? []) {
            const role = this._trackInfo.get(track.id)?.role;
            if (isSubtitleTrackType(track.type)) {
                if (!this._subtitleTrack) this._subtitleTrack = track;
                continue;
            }
            if (isMediaTrackType(track.type)) {
                if (!this._mediaTrack) this._mediaTrack = track;
                continue;
            }
            if (isVoiceoverTrackType(track.type)) {
                if (!this._voiceoverTrack) this._voiceoverTrack = track;
                continue;
            }
            if (track.type === "audio") {
                if (!this._audioTrack) this._audioTrack = track;
                continue;
            }
            if (track.isMain || role === "main") {
                this._mainTrack = track;
                continue;
            }
            if (!this._overlayTrack && isDirectorTrackType(track.type)) {
                this._overlayTrack = track;
            }
        }
        if (!this._mainTrack) {
            this._mainTrack = this._allImageTracks().find(t => t.isMain) ?? this._allImageTracks().at(-1) ?? null;
        }
    }

    _resolveTrackForClip(trackIdx, clipType) {
        const direct = this._trackByIndex(trackIdx);
        if (direct) return direct;
        if (clipType === "audio") return this._audioTrack;
        if (clipType === "voiceover") return this._allVoiceoverTracks()[0] ?? null;
        if (trackIdx === 1) return this._overlayTrack ?? this._mainTrack;
        return this._mainTrack;
    }

    _trackByIndex(idx) {
        for (const track of this._timeline?.tracks ?? []) {
            if (this._trackIndex(track) === idx) return track;
        }
        return null;
    }

    _addRestoredClip(track, data) {
        const locked = track.locked;
        track.locked = false;
        try {
            return this._timeline.addClip(track.id, data);
        } finally {
            track.locked = locked;
        }
    }

    async _addClipFromJson(c) {
        let clipType = String(c.clip_type || "").toLowerCase();
        const trackIdx = Number(c.track ?? 0);
        if (!clipType) {
            clipType = c.audio_file ? "audio" : "image";
        }
        const track = this._resolveTrackForClip(trackIdx, clipType);
        if (!track) return;

        const startMs = Number(c.start_ms) || 0;
        const endMs = Number(c.end_ms) || startMs + 1000;
        const fps = this.getFps();
        const decoded = decodeClipTimingSecs(startMs, endMs - startMs, endMs, fps);
        const startTime = decoded.startTime;
        const dur = Math.max(1 / fps, decoded.duration);

        if (clipType === "audio") {
            const mediaRows = this._jsonClipMediaRows(c);
            const audioRow = mediaRows.find((row) => row.kind === "audio") || mediaRows[0];
            const af = audioRow?.file || c.audio_file || c.src || "";
            const audioMedia = audioRow || this._ensureMedia("audio", af);
            const sourceDur = Number(c.source_duration) || dur;
            const trimIn = Math.max(0, Number(c.trim_in) || 0);
            let peaks = null;
            let buffer = null;
            if (af) {
                try {
                    const r = await this._fetchPeaks(this._audioUrl(af));
                    peaks = r.peaks[0];
                    buffer = r.buffer;
                } catch { /* placeholder */ }
            }
            const clip = this._addRestoredClip(track, {
                id: c.id || uid(),
                name: af.split(/[\\/]/).pop() || T("media_kind_audio"),
                startTime,
                duration: dur,
                sourceDuration: sourceDur,
                sourceOffset: trimIn,
                src: af,
                waveformPeaks: peaks,
                color: track.color,
            });
            clip._audioBuffer = buffer;
            const fadeInMs = Math.max(0, Number(c.fade_in_ms) || 0);
            const fadeOutMs = Math.max(0, Number(c.fade_out_ms) || 0);
            clip.fadeIn = fadeInMs / 1000;
            clip.fadeOut = fadeOutMs / 1000;
            clip._clampFades?.();
            clip._updateFadeUI?.();
            this._meta.set(clip.id, {
                ...defaultAudioMeta(trackIdx),
                muted: !!c.muted,
                visible: c.visible !== false,
                sourceDuration: sourceDur,
                trimIn,
                fadeInMs,
                fadeOutMs,
                mediaId: audioMedia?.id || "",
                resourceStartSec: Math.max(0, Number(c.resource_start_sec) || startTime),
                resourceDurationSec: Math.max(0.05, Number(c.resource_duration_sec) || dur),
            });
            this._decorateClip(clip);
            return;
        }

        if (clipType === "voiceover" || isVoiceoverTrackType(track.type)) {
            const name = String(c.name || T("voiceover_clip_default_name"));
            const clip = this._addRestoredClip(track, {
                id: c.id || uid(),
                name: name.slice(0, 40) || T("voiceover_clip_default_name"),
                startTime,
                duration: dur,
                sourceDuration: Infinity,
                sourceOffset: 0,
                src: "",
                color: track.color || "#5bc0de",
            });
            this._meta.set(clip.id, {
                ...defaultVoiceoverMeta(trackIdx),
                muted: !!c.muted,
                visible: c.visible !== false,
                disabled: !!c.disabled || c.enabled === false,
                prompt: String(c.prompt ?? ""),
                stylePrompt: String(c.style_prompt ?? c.stylePrompt ?? ""),
                generatedAudios: (Array.isArray(c.generated_audios) ? c.generated_audios : [])
                    .map((row) => normalizeGeneratedAudio(row))
                    .filter(Boolean),
                resourceStartSec: Math.max(0, Number(c.resource_start_sec) || startTime),
                resourceDurationSec: Math.max(0.05, Number(c.resource_duration_sec) || dur),
            });
            this._decorateClip(clip);
            return;
        }

        if (clipType === "subtitle" || clipType === "text" || isSubtitleTrackType(track.type)) {
            const text = String(c.text ?? c.name ?? T("subtitle_default_text"));
            const clip = this._addRestoredClip(track, {
                id: c.id || uid(),
                name: text.slice(0, 40) || T("subtitle_default_text"),
                startTime,
                duration: dur,
                color: track.color || "#ff9e4a",
            });
            const trackStyle = this._trackInfo.get(track.id)?.subtitleStyle;
            this._meta.set(clip.id, {
                ...defaultSubtitleMeta(trackIdx),
                ...pickSubtitleStyle(trackStyle),
                text,
                disabled: !!c.disabled,
                visible: c.visible !== false,
                trackIndex: trackIdx,
                resourceStartSec: Math.max(0, Number(c.resource_start_sec) || startTime),
                resourceDurationSec: Math.max(0.05, Number(c.resource_duration_sec) || dur),
            });
            this._decorateClip(clip);
            return;
        }

        if (clipType === "package" || clipType === "clip" || clipType === "media" || clipType === "image" || clipType === "video") {
            const mediaRows = this._jsonClipMediaRows(c);
            const flags = Array.isArray(c.use_media_prompts) ? c.use_media_prompts : [];
            const enabledFlags = Array.isArray(c.media_enabled) ? c.media_enabled : [];
            const items = (mediaRows.length
                ? mediaRows
                    .filter((row) => row.kind !== "audio")
                    .map((row) => ({ id: row.id, kind: row.kind, file: row.file }))
                : (Array.isArray(c.items) && c.items.length
                    ? c.items.map(normalizeClipItem).filter(Boolean)
                    : clipItemsFromLegacy(c.start_image || c.src, c.end_image, c.clip_type))
            ).map((item, i) => ({
                ...item,
                useMediaPrompt: mediaFlagAt(flags, i),
                enabled: mediaFlagAt(enabledFlags, i),
            }));
            const first = items[0];
            const sourceDur = Number(c.source_duration) || dur;
            const trimIn = Math.max(0, Number(c.trim_in) || 0);
            const clip = this._addRestoredClip(track, {
                id: c.id || uid(),
                name: c.name || first?.file?.split(/[\\/]/).pop() || DEFAULT_CLIP_NAME,
                startTime,
                duration: dur,
                sourceDuration: first?.kind === "video" ? sourceDur : Infinity,
                sourceOffset: first?.kind === "video" ? trimIn : 0,
                src: first?.file || "",
                thumbnail: first?.kind === "image" && first.file ? this._imgUrl(first.file) : null,
                color: items.length ? track.color : "#d9a441",
            });
            const promptIncludes = promptIncludesFromClipJson(c);
            const meta = {
                ...defaultImageMeta(trackIdx),
                clipType: isMediaTrackType(track.type) ? "media" : "image",
                mediaKind: isMediaTrackType(track.type) ? "media" : "clip",
                prompt: c.prompt ?? "",
                detailedDescription: c.detailed_description ?? c.ai_prompt ?? "",
                promptIncludes,
                disabled: !!c.disabled,
                visible: c.visible !== false,
                items,
                mediaIds: items.map((item) => item.id).filter(Boolean),
                clipRole: c.clip_role || (items.length ? "multi_ref" : "t2v"),
                clipRoleCustom: c.clip_role_custom ?? "",
                agent: c.agent || "MiniMaxH3",
                agentCustom: c.agent_custom ?? "",
                headExtendSec: Math.max(0, Math.round(Number(c.head_extend_sec) || 0)),
                tailExtendSec: Math.max(0, Math.round(Number(c.tail_extend_sec) || 0)),
                generatePreviewVideo: !!c.generate_preview_video,
                secondSample: !!c.second_sample,
                h3MotionContextLength: Math.max(0, Math.round(Number(c.h3_motion_context_length) || 0)),
                saveLatent: !!c.save_latent,
                seed: this._normalizeClipSeed(c.seed),
                generatedVideos: this._generatedVideosFromJson(c),
                genEditAudios: this._normalizeGenEditAudioDraft(c.gen_edit_audios),
                previewMode: this._previewModeFromJson(c),
                resourceDurationSec: Math.max(
                    0.05,
                    Number(c.resource_duration_sec) || dur,
                ),
                resourceStartSec: Math.max(
                    0,
                    Number(c.resource_start_sec) || startTime,
                ),
            };
            if (first?.kind === "video") {
                meta.sourceDuration = sourceDur;
                meta.muted = !!c.muted;
            }
            this._normalizeVisualMeta(clip, meta, { seedFromClip: false });
            this._meta.set(clip.id, meta);
            this._decorateClip(clip);
            // Always refresh thumb (incl. generated-video preview mode).
            this._syncClipPrimaryAppearance(clip);
            return;
        }

        if (clipType === "video") {
            const vf = c.start_image ?? c.src ?? "";
            const fname = vf.split(/[\\/]/).pop() || T("media_kind_video");
            const sourceDur = Number(c.source_duration) || dur;
            const trimIn = Math.max(0, Number(c.trim_in) || 0);
            const url = vf ? this._videoUrl(vf) : null;
            let thumbnail = null;
            let peaks = null;
            let hasAudio = false;
            let buffer = null;
            if (url) {
                try { thumbnail = await this._grabVideoThumbnail(url); } catch { /* no preview */ }
                try {
                    const r = await this._fetchPeaks(url);
                    peaks = r.peaks[0];
                    hasAudio = true;
                    buffer = r.buffer;
                } catch { hasAudio = false; }
            }
            const clip = this._addRestoredClip(track, {
                id: c.id || uid(),
                name: fname,
                startTime,
                duration: dur,
                sourceDuration: sourceDur,
                sourceOffset: trimIn,
                src: vf,
                thumbnail,
                waveformPeaks: peaks,
                hasAudio,
                color: track.color,
            });
            clip._audioBuffer = buffer;
            const promptIncludes = promptIncludesFromClipJson(c);
            this._meta.set(clip.id, {
                ...defaultImageMeta(trackIdx),
                mediaKind: "clip",
                clipRole: c.clip_role || "video_ref",
                clipRoleCustom: c.clip_role_custom ?? "",
                agent: c.agent || "MiniMaxH3",
                agentCustom: c.agent_custom ?? "",
                prompt: c.prompt ?? "",
                detailedDescription: c.detailed_description ?? c.ai_prompt ?? "",
                endImage: c.end_image ?? null,
                promptIncludes,
                disabled: !!c.disabled,
                visible: c.visible !== false,
                sourceDuration: sourceDur,
                muted: !!c.muted,
                headExtendSec: Math.max(0, Math.round(Number(c.head_extend_sec) || 0)),
                tailExtendSec: Math.max(0, Math.round(Number(c.tail_extend_sec) || 0)),
                generatePreviewVideo: !!c.generate_preview_video,
                secondSample: !!c.second_sample,
            items: (Array.isArray(c.items) && c.items.length
                ? c.items.map(normalizeClipItem).filter(Boolean)
                : clipItemsFromLegacy(vf, c.end_image, "video")
            ).map((item, i) => ({
                ...item,
                useMediaPrompt: mediaFlagAt(c.use_media_prompts, i),
                enabled: mediaFlagAt(c.media_enabled, i),
            })),
                generatedVideos: this._generatedVideosFromJson(c),
                genEditAudios: this._normalizeGenEditAudioDraft(c.gen_edit_audios),
                previewMode: this._previewModeFromJson(c),
                resourceDurationSec: Math.max(
                    0.05,
                    Number(c.resource_duration_sec) || dur,
                ),
                resourceStartSec: Math.max(
                    0,
                    Number(c.resource_start_sec) || startTime,
                ),
                h3MotionContextLength: Math.max(0, Math.round(Number(c.h3_motion_context_length) || 0)),
                saveLatent: !!c.save_latent,
                seed: this._normalizeClipSeed(c.seed),
            });
            this._normalizeVisualMeta(clip, this._meta.get(clip.id), { seedFromClip: false });
            this._decorateClip(clip);
            this._syncClipPrimaryAppearance(clip);
            return;
        }

        const img = c.start_image ?? "";
        const fname = img.split(/[\\/]/).pop() || T("asset_fallback_name");
        const clip = this._addRestoredClip(track, {
            id: c.id || uid(),
            name: fname,
            startTime,
            duration: dur,
            src: img,
            thumbnail: img ? this._imgUrl(img) : null,
            color: track.color,
        });
        const promptIncludes = promptIncludesFromClipJson(c);
        this._meta.set(clip.id, {
            ...defaultImageMeta(trackIdx),
            mediaKind: "clip",
            clipRole: c.clip_role || (c.end_image ? "first_last" : "multi_ref"),
            clipRoleCustom: c.clip_role_custom ?? "",
            agent: c.agent || "MiniMaxH3",
            agentCustom: c.agent_custom ?? "",
            prompt: c.prompt ?? "",
            detailedDescription: c.detailed_description ?? c.ai_prompt ?? "",
            endImage: c.end_image ?? null,
            promptIncludes,
            disabled: !!c.disabled,
            visible: c.visible !== false,
            headExtendSec: Math.max(0, Math.round(Number(c.head_extend_sec) || 0)),
            tailExtendSec: Math.max(0, Math.round(Number(c.tail_extend_sec) || 0)),
            generatePreviewVideo: !!c.generate_preview_video,
                secondSample: !!c.second_sample,
            items: (Array.isArray(c.items) && c.items.length
                ? c.items.map(normalizeClipItem).filter(Boolean)
                : clipItemsFromLegacy(img, c.end_image, "image")
            ).map((item, i) => ({
                ...item,
                useMediaPrompt: mediaFlagAt(c.use_media_prompts, i),
                enabled: mediaFlagAt(c.media_enabled, i),
            })),
            generatedVideos: this._generatedVideosFromJson(c),
            genEditAudios: this._normalizeGenEditAudioDraft(c.gen_edit_audios),
            previewMode: this._previewModeFromJson(c),
            resourceDurationSec: Math.max(
                0.05,
                Number(c.resource_duration_sec) || dur,
            ),
            resourceStartSec: Math.max(
                0,
                Number(c.resource_start_sec) || startTime,
            ),
            h3MotionContextLength: Math.max(0, Math.round(Number(c.h3_motion_context_length) || 0)),
            saveLatent: !!c.save_latent,
            seed: this._normalizeClipSeed(c.seed),
        });
        this._normalizeVisualMeta(clip, this._meta.get(clip.id), { seedFromClip: false });
        this._decorateClip(clip);
        this._syncClipPrimaryAppearance(clip);
    }

    _decorateAllClips() {
        for (const track of this._timeline?.tracks ?? []) {
            for (const clip of track.clips) this._decorateClip(clip);
        }
        this._updateAllGeneratedPreviewButton();
    }

    _findClipById(id) {
        for (const track of this._timeline?.tracks ?? []) {
            const c = track.clips.find(c => c.id === id);
            if (c) return c;
        }
        return null;
    }

    /** Keep app selection aligned with the timeline after clip removal. */
    _syncSelectedClip() {
        const tl = this._timeline;
        if (!tl) {
            this._selClip = null;
            this._selClips = [];
            return null;
        }
        this._selClips = tl.getSelectedClips();
        const primary = tl._selected ?? null;
        if (primary && this._findClipById(primary.id)) {
            this._selClip = primary;
            return this._selClip;
        }
        const fallback = this._selClips.at(-1) ?? null;
        this._selClip = fallback && this._findClipById(fallback.id) ? fallback : null;
        return this._selClip;
    }

    _findClipAt(clientX, clientY) {
        // DOM hit-test first; fall back to geometry — pointer-capture / Tauri
        // WebView2 often returns the drag source from elementFromPoint on up.
        const el = document.elementFromPoint(clientX, clientY)?.closest?.(".tl-clip");
        if (el?.dataset?.clipId) {
            const hit = this._findClipById(el.dataset.clipId);
            if (hit) return hit;
        }
        return this._findClipAtGeometry(clientX, clientY);
    }

    /** Resolve clip under a point via track bounds + timeline time. */
    _findClipAtGeometry(clientX, clientY) {
        const tl = this._timeline;
        if (!tl?.scrollEl) return null;
        const track = tl._findTrackAtY(clientY, "image")
            || tl._findTrackAtY(clientY, "text")
            || tl._findTrackAtY(clientY, "voiceover")
            || tl._findTrackAtY(clientY, "audio")
            || tl._findTrackAtY(clientY, "video");
        if (!track) return null;
        const rect = tl.scrollEl.getBoundingClientRect();
        const x = clientX - rect.left + tl.scrollEl.scrollLeft;
        const t = Math.max(0, x / Math.max(1e-6, tl.pixelsPerSecond));
        return track.clips.find(c => t >= c.startTime - 1e-6 && t < c.endTime + 1e-6) ?? null;
    }

    _decorateClip(clip) {
        if (!clip?.el) return;
        const m = this._ensureClipMeta(clip);
        const track = clip.track;
        const trackHidden = (isDirectorTrackType(track.type) || isMediaTrackType(track.type) || isSubtitleTrackType(track.type)) && track.visible === false;
        const trackMuted = (track.type === "audio" || isVoiceoverTrackType(track.type)) && track.muted;
        const isAudio = m.clipType === "audio" || track.type === "audio";
        const isVoiceover = isVoiceoverClipMeta(m, track);
        const isSubtitle = isSubtitleClipMeta(m, track);
        const disabled = !isAudio && (!!m.disabled || trackHidden);
        clip.el.classList.toggle("cat-te-clip-disabled", disabled);
        clip.el.classList.toggle("cat-te-clip-muted", (isAudio || isVoiceover) && (!!m.muted || trackMuted));
        clip.el.classList.toggle("cat-te-clip-package", isDirectorTrackType(track.type) && this._isEmptyGroupClip(m));
        clip.el.classList.toggle("cat-te-clip-voiceover", isVoiceover);
        const runState = isDirectorTrackType(track.type) ? this._clipRunState(clip.id) : null;
        clip.el.classList.toggle("cat-te-clip-queued", runState === "queued");
        clip.el.classList.toggle("cat-te-clip-running", runState === "running");
        let runBar = clip.el.querySelector(".cat-te-clip-run-progress");
        if (runState === "running") {
            if (!runBar) {
                runBar = document.createElement("div");
                runBar.className = "cat-te-clip-run-progress";
                runBar.innerHTML = `<div class="cat-te-clip-run-progress-fill"></div>`;
                clip.el.appendChild(runBar);
            }
            const fill = runBar.querySelector(".cat-te-clip-run-progress-fill");
            const pct = Math.round((this._runningProgress || 0) * 1000) / 10;
            if (fill) {
                fill.style.width = `${pct}%`;
                fill.classList.toggle("is-indeterminate", !(this._runningProgress > 0.01));
            }
            runBar.title = T("clip_running_progress_title", { pct: Math.round(pct) });
        } else if (runBar) {
            runBar.remove();
        }
        if (runState === "queued") {
            clip.el.title = T("clip_queued_title");
        } else if (runState === "running") {
            if (clip.el.getAttribute("title") === T("clip_queued_title")) {
                clip.el.removeAttribute("title");
            }
        } else if (clip.el.getAttribute("title") === T("clip_queued_title")) {
            clip.el.removeAttribute("title");
        }
        if (isSubtitle) {
            const label = (m.text || clip.name || T("subtitle_default_text")).trim() || T("subtitle_default_text");
            clip.name = label.slice(0, 40);
            const labelEl = clip.el.querySelector(".tl-clip-label");
            if (labelEl) labelEl.textContent = clip.name;
        } else if (isVoiceover) {
            const label = (clip.name || T("voiceover_clip_default_name")).trim() || T("voiceover_clip_default_name");
            clip.name = label.slice(0, 40);
            const labelEl = clip.el.querySelector(".tl-clip-label");
            if (labelEl) labelEl.textContent = clip.name;
        }

        let muteBadge = clip.el.querySelector(".cat-te-mute-badge");
        if (isAudio || isVoiceover) {
            if (!muteBadge) {
                muteBadge = document.createElement("button");
                muteBadge.type = "button";
                muteBadge.className = "cat-te-mute-badge";
                muteBadge.textContent = "🔇";
                muteBadge.addEventListener("click", e => {
                    e.stopPropagation();
                    if (track.locked) return;
                    this._recordUndo();
                    const meta = this._ensureClipMeta(clip);
                    meta.muted = !meta.muted;
                    this._decorateClip(clip);
                });
                clip.el.appendChild(muteBadge);
            }
            muteBadge.textContent = (m.muted || trackMuted) ? "🔇" : "🔊";
            muteBadge.title = m.muted ? T("unmute_label") : T("mute_label");
        } else if (muteBadge) {
            muteBadge.remove();
        }

        let badge = clip.el.querySelector(".cat-te-end-badge");
        if (badge && !badge.classList.contains("cat-te-clip-preview-badge")) badge.remove();
        let previewBadge = clip.el.querySelector(".cat-te-clip-preview-badge");
        const enabledGen = !isAudio && !isSubtitle && !isVoiceover && track.type === "image"
            ? this._firstEnabledGeneratedVideo(m)
            : null;
        const runPreview = !isAudio && !isSubtitle && !isVoiceover && track.type === "image"
            ? this._runPreviewByClipId.get(String(clip.id))
            : null;
        clip.el.classList.remove("cat-te-clip-gen-empty");
        const genPreview = this._clipUsesGeneratedPreview(m);
        // Video badge: hover plays finished generated video (or live sampling);
        // click toggles normal ↔ generated preview state.
        const showPreviewBadge = !!(enabledGen || runPreview?.url);
        if (showPreviewBadge) {
            if (!previewBadge) {
                previewBadge = document.createElement("button");
                previewBadge.type = "button";
                previewBadge.className = "cat-te-end-badge cat-te-clip-preview-badge";
                previewBadge.addEventListener("mouseenter", () => {
                    if (this._timeline?._playing) return;
                    const live = this._runPreviewByClipId.get(String(clip.id));
                    if (live?.url) {
                        this._startResourceGenProgramPreview(
                            clip,
                            this._runPreviewKey(clip.id),
                            live.url,
                        );
                        return;
                    }
                    const meta = this._meta.get(clip.id) ?? defaultImageMeta();
                    const gen = this._firstEnabledGeneratedVideo(meta);
                    if (gen?.file) this._startResourceGenProgramPreview(clip, gen.file);
                });
                previewBadge.addEventListener("mouseleave", () => {
                    this._scheduleResourceGenProgramPreviewStop();
                });
                previewBadge.addEventListener("click", (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    if (!this._firstEnabledGeneratedVideo(this._meta.get(clip.id) ?? defaultImageMeta())) {
                        return;
                    }
                    this._stopResourceGenProgramPreview();
                    this._toggleClipPreviewMode(clip);
                });
                clip.el.appendChild(previewBadge);
            }
            previewBadge.innerHTML = iconHtml(genPreview ? "videoOff" : "video", 12);
            previewBadge.title = runPreview?.url
                ? T("program_preview_sampling_video_title")
                : (genPreview
                    ? T("clip_preview_generated_title")
                    : T("clip_preview_normal_title"));
            previewBadge.classList.toggle("is-sampling", !!runPreview?.url);
            previewBadge.classList.toggle("is-generated", genPreview);
            previewBadge.classList.toggle(
                "is-previewing",
                this._resourceGenPreview?.clipId === clip.id,
            );
        } else if (previewBadge) {
            if (this._resourceGenPreview?.clipId === clip.id) {
                this._stopResourceGenProgramPreview();
            }
            previewBadge.remove();
        }

        clip.el.querySelector(".cat-te-force-badge")?.remove();
    }

    _refreshClipAppearance(clip) {
        if (!clip?.el) return;
        const label = clip.el.querySelector(".tl-clip-label");
        if (label) label.textContent = clip.name || T("asset_fallback_name");
        if (clip._thumbRow) {
            clip._applyThumbnail();
        } else {
            const body = clip.el.querySelector(".tl-clip-body");
            if (body) {
                if (clip.thumbnail) {
                    const src = String(clip.thumbnail).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
                    body.style.backgroundImage = `url("${src}")`;
                } else {
                    body.style.backgroundImage = "";
                }
            }
        }
        if (typeof clip._refreshWaveRow === "function") clip._refreshWaveRow();
        this._decorateClip(clip);
    }

    _startFramePreviewSrc(clip, meta) {
        if (clip.thumbnail) return clip.thumbnail;
        if (!clip.src) return "";
        return meta?.mediaKind === "video" ? this._videoUrl(clip.src) : this._imgUrl(clip.src);
    }

    _showStartEndPreview(clip, anchor) {
        if (!this.framePreview || !anchor || !clip) return;
        const m = this._meta.get(clip.id) ?? defaultImageMeta();
        const startSrc = this._startFramePreviewSrc(clip, m);
        if (!startSrc && !m.endImage) return;

        this.framePreview.replaceChildren();

        const row = document.createElement("div");
        row.className = "cat-te-frame-preview-row";

        for (const [label, src] of [[T("frame_first"), startSrc], [T("frame_last"), m.endImage ? this._imgUrl(m.endImage) : ""]]) {
            if (!src) continue;
            const item = document.createElement("div");
            item.className = "cat-te-frame-preview-item";
            const cap = document.createElement("span");
            cap.className = "cat-te-frame-preview-label";
            cap.textContent = label;
            const img = document.createElement("img");
            img.src = src;
            img.alt = label;
            item.appendChild(cap);
            item.appendChild(img);
            row.appendChild(item);
        }

        this.framePreview.appendChild(row);
        this.framePreview.style.display = "block";

        const r = anchor.getBoundingClientRect();
        const pr = this.framePreview.getBoundingClientRect();
        let left = r.left + r.width / 2 - pr.width / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - pr.width - 8));
        this.framePreview.style.left = `${left}px`;
        this.framePreview.style.top = `${r.bottom + 8}px`;
    }

    _hideImagePreview() {
        if (!this.framePreview) return;
        this.framePreview.style.display = "none";
    }

    _mediaPreviewCount() {
        const s = this._mediaPreviewState;
        return s?.items?.length || s?.files?.length || 0;
    }

    _mediaPreviewItem() {
        const s = this._mediaPreviewState;
        if (!s) return null;
        if (s.items?.length) return s.items[s.index] || null;
        if (s.files?.length) return { file: s.files[s.index], kind: s.kind };
        return null;
    }

    _renderMediaPreviewStars(kind, file) {
        if (!this.mediaPreviewStars) return;
        this.mediaPreviewStars.replaceChildren();
        const current = this._getMediaStars(kind, file) ?? 0;
        for (let i = 1; i <= 5; i++) {
            const starBtn = document.createElement("button");
            starBtn.type = "button";
            starBtn.className = "cat-te-media-preview-star-btn";
            starBtn.innerHTML = iconHtml("star", 14);
            starBtn.title = T("star_n_title", { n: i });
            if (i <= current) starBtn.classList.add("on");
            starBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                const cur = this._getMediaStars(kind, file) ?? 0;
                this._setMediaStars(kind, file, cur === i ? undefined : i);
                this._saveToWidgets();
                this._renderMediaPreviewStars(kind, file);
                this._renderMediaGrid();
                if (this._mediaPreviewState?.source === "clip") return;
                if (this._mediaPreviewState?.browse === false) return;
                if (this._mediaPreviewState) {
                    const items = this._visibleMediaEntries();
                    const still = items.findIndex((e) => e.kind === kind && e.file === file);
                    if (still < 0 && items.length) {
                        const idx = Math.min(this._mediaPreviewState.index, items.length - 1);
                        this._mediaPreviewState.items = items;
                        delete this._mediaPreviewState.files;
                        this._showMediaPreviewAt(idx);
                    } else {
                        this._mediaPreviewState.items = items.length ? items : [{ file, kind }];
                        delete this._mediaPreviewState.files;
                        this._mediaPreviewState.index = still < 0 ? 0 : still;
                    }
                }
            });
            this.mediaPreviewStars.appendChild(starBtn);
        }
    }

    _updateMediaPreviewNav() {
        this._applyMediaPreviewChrome();
    }

    _mediaPreviewIsClipSource() {
        return this._mediaPreviewState?.source === "clip";
    }

    _applyMediaPreviewChrome() {
        const state = this._mediaPreviewState;
        const clipSource = this._mediaPreviewIsClipSource();
        const browse = state?.browse !== false;
        const multi = browse && this._mediaPreviewCount() > 1;
        const libraryBrowse = browse && !clipSource;

        this.mediaPreviewModal?.classList.toggle("cat-te-media-preview-solo", !multi);

        if (this.mediaPreviewPrevBtn) {
            this.mediaPreviewPrevBtn.hidden = !multi;
            this.mediaPreviewPrevBtn.disabled = !multi;
        }
        if (this.mediaPreviewNextBtn) {
            this.mediaPreviewNextBtn.hidden = !multi;
            this.mediaPreviewNextBtn.disabled = !multi;
        }
        if (this.mediaPreviewFooter) this.mediaPreviewFooter.hidden = !libraryBrowse;
        if (this.mediaPreviewHint) this.mediaPreviewHint.hidden = !libraryBrowse;
        if (this.mediaPreviewInsertBtn) this.mediaPreviewInsertBtn.hidden = !libraryBrowse;

        if (libraryBrowse) {
            this._updateMediaPreviewInsertBtn();
        }
    }

    _updateMediaPreviewInsertBtn() {
        const btn = this.mediaPreviewInsertBtn;
        const state = this._mediaPreviewState;
        if (!btn || state?.browse === false) return;
        const item = this._mediaPreviewItem();
        if (!item || !this._timeline) {
            btn.disabled = true;
            btn.title = "";
            return;
        }
        const { file, kind } = item;
        const status = this._mediaStatus.get(`${kind}:${file}`);
        const missing = status?.location === "missing";
        btn.disabled = missing;
        const t = this._timeline.formatTime(this._timeline.currentTime);
        btn.title = missing ? T("asset_missing_cannot_insert") : T("insert_at_seek_position", { time: t });
    }

    _insertMediaPreviewAtSeek() {
        const item = this._mediaPreviewItem();
        if (!item || !this._timeline) return;
        const { file, kind } = item;
        const status = this._mediaStatus.get(`${kind}:${file}`);
        if (status?.location === "missing") {
            alert(T("asset_missing_cannot_insert"));
            return;
        }
        if (kind === "audio") void this._addAudioAtPlayhead(file);
        else if (kind === "video") void this._addVideoAtPlayhead(file);
        else void this._addMediaAtPlayhead(file);
    }

    _showMediaPreviewAt(index) {
        const state = this._mediaPreviewState;
        const n = this._mediaPreviewCount();
        if (!n || !this.mediaPreviewModal || !this.mediaPreviewStage) return;

        index = ((index % n) + n) % n;
        state.index = index;
        const item = this._mediaPreviewItem();
        if (!item) return;
        const { file, kind } = item;

        for (const media of this.mediaPreviewStage.querySelectorAll("audio, video")) {
            media.pause();
            media.removeAttribute("src");
            media.load();
        }
        this.mediaPreviewStage.replaceChildren();

        const name = file.split(/[\\/]/).pop() || T("asset_preview_fallback_name");
        this.mediaPreviewTitle.textContent = n > 1 ? `${index + 1} / ${n}  ${name}` : name;
        this._renderMediaPreviewStars(kind, file);
        this._fillMediaPreviewMeta(kind, file);
        this._mediaInfoRequest = null;
        this._mediaRawRequest = null;
        this.mediaInfoPanel.replaceChildren();
        if (!this.mediaInfoPanel.hidden) void this._loadMediaFileInfo();
        this._updateMediaPreviewNav();
        this._syncClipPanelFromMediaPreview(index);

        let media;
        if (kind === "image") {
            media = document.createElement("img");
            media.src = this._imgUrl(file);
            media.alt = this.mediaPreviewTitle.textContent;
            media.draggable = false;
        } else if (kind === "video") {
            media = document.createElement("video");
            media.src = this._videoUrl(file);
            media.controls = true;
            media.preload = "metadata";
        } else {
            media = document.createElement("audio");
            media.src = this._audioUrl(file);
            media.controls = true;
            media.preload = "metadata";
        }
        media.className = `cat-te-media-preview-content cat-te-media-preview-${kind}`;
        this.mediaPreviewStage.appendChild(media);
        this.mediaPreviewModal.hidden = false;
    }

    _stepMediaPreview(delta) {
        const state = this._mediaPreviewState;
        if (state?.browse === false && !this._mediaPreviewIsClipSource()) return;
        if (this._mediaPreviewCount() <= 1) return;
        this._saveMediaPreviewMeta();
        this._showMediaPreviewAt(state.index + delta);
    }

    _syncClipPanelFromMediaPreview(index) {
        const state = this._mediaPreviewState;
        if (state?.source !== "clip" || !state.clipId) return;
        const clip = this._findClipById(state.clipId);
        if (!clip) return;
        this._setClipPreviewItemIndex(clip, index);
        if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
    }

    _clipPreviewMediaEntries(clip) {
        if (!clip) return [];
        const m = this._ensureClipMeta(clip);
        if (clip.track?.type === "audio" || m?.clipType === "audio") {
            const file = String(clip.src || "").trim();
            return file ? [{ file, kind: "audio" }] : [];
        }
        return this._clipItems(m)
            .filter((it) => it?.file)
            .map((it) => ({ file: it.file, kind: it.kind, id: it.id }));
    }

    _openMediaPreview(file, kind) {
        const items = this._visibleMediaEntries();
        let index = file ? items.findIndex((e) => e.file === file && e.kind === kind) : -1;
        if (index < 0 && file) {
            this._mediaPreviewState = { items: [{ file, kind }], index: 0, browse: true, source: "library" };
            this._showMediaPreviewAt(0);
            return;
        }
        if (!items.length) return;
        if (index < 0) index = 0;
        this._mediaPreviewState = { items, index, browse: true, source: "library" };
        this._showMediaPreviewAt(index);
    }

    _clipMediaKind(clip) {
        const m = this._meta.get(clip.id);
        if (clip.track?.type === "audio" || m?.clipType === "audio") return "audio";
        const items = this._clipItems(m);
        const idx = this._clipPreviewItemIndex(clip, m);
        return items[idx]?.kind || items[0]?.kind || null;
    }

    _openClipMediaPreview(clip) {
        const items = this._clipPreviewMediaEntries(clip);
        if (!items.length) return;
        const m = this._ensureClipMeta(clip);
        let index = this._clipPreviewItemIndex(clip, m);
        if (index < 0 || index >= items.length) index = 0;
        const current = items[index];
        const status = this._mediaStatus.get(`${current.kind}:${current.file}`);
        if (status?.location === "missing") {
            alert(T("asset_missing_cannot_preview"));
            return;
        }
        this._mediaPreviewState = {
            items,
            index,
            browse: true,
            source: "clip",
            clipId: clip.id,
        };
        this._showMediaPreviewAt(index);
    }

    _closeMediaPreview() {
        if (!this.mediaPreviewModal || !this.mediaPreviewStage) return;
        this._saveMediaPreviewMeta();
        for (const media of this.mediaPreviewStage.querySelectorAll("audio, video")) {
            media.pause();
            media.removeAttribute("src");
            media.load();
        }
        this.mediaPreviewStage.replaceChildren();
        this.mediaPreviewStars?.replaceChildren();
        this.mediaPreviewModal.hidden = true;
        this.rawMetaModal.hidden = true;
        this._mediaInfoRequest = null;
        this._mediaRawRequest = null;
        this._mediaPreviewState = null;
        this._applyMediaPreviewChrome();
    }

    _closeRawMeta() {
        this.rawMetaModal.hidden = true;
        this.mediaMetaOpenBtn.focus();
    }

    async _loadMediaFileInfo(raw = false) {
        const item = this._mediaPreviewItem();
        if (!item) {
            (raw ? this.rawMetaText : this.mediaInfoPanel).textContent = T("media_not_recorded");
            return;
        }
        const request = {};
        const requestKey = raw ? "_mediaRawRequest" : "_mediaInfoRequest";
        this[requestKey] = request;
        const target = raw ? this.rawMetaText : this.mediaInfoPanel;
        target.textContent = T("loading_ellipsis");
        try {
            const url = this._assetFileUrl(item.file, item.kind).replace("/asset_file?", "/asset_metadata?") + (raw ? "&raw=1" : "");
            const response = await api.fetchApi(url);
            if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
            const info = await response.json();
            if (this[requestKey] !== request) return;
            if (raw) {
                target.textContent = info.metadata_error ? T("load_failed", { msg: info.metadata_error }) : info.raw || T("media_not_recorded");
                return;
            }
            const meta = this._getMediaMeta(item.kind, item.file);
            if ((!meta.generationPrompt && info.prompt) || (!meta.settingDescription && info.description)) {
                this._writeMediaMeta(item.kind, item.file, {
                    ...meta,
                    generationPrompt: meta.generationPrompt || info.prompt || "",
                    settingDescription: meta.settingDescription || info.description || "",
                });
                this._fillMediaPreviewMeta(item.kind, item.file);
                this._saveToWidgets();
            }
            target.replaceChildren();
            const date = (value) => value ? new Date(value).toLocaleString() : "";
            const fields = [
                ["media_generation_prompt", info.prompt],
                ["media_asset_description", info.description],
                ["media_created_at", date(info.created_at)],
                ["media_modified_at", date(info.modified_at)],
                ["media_file_path", info.path],
                ["media_file_size", `${Number(info.size_bytes).toLocaleString()} bytes`],
            ];
            for (const [label, value] of fields) {
                const row = document.createElement("div");
                row.className = "cat-te-media-file-field";
                const title = document.createElement("span");
                title.textContent = T(label);
                const text = document.createElement("div");
                text.textContent = value || T("media_not_recorded");
                row.append(title, text);
                target.appendChild(row);
            }
            if (info.metadata_error) {
                const error = document.createElement("div");
                error.textContent = T("load_failed", { msg: info.metadata_error });
                target.appendChild(error);
            }
        } catch (error) {
            if (this[requestKey] === request) target.textContent = T("load_failed", { msg: error.message });
        }
    }

    _fillMediaPreviewMeta(kind, file) {
        const meta = this._getMediaMeta(kind, file);
        const known = MEDIA_ASSET_TYPES.some((t) => t.id === meta.mediaType);
        if (this.mediaPreviewDesc) setRichPromptValue(this.mediaPreviewDesc, meta.prompt || "", true);
        if (this.mediaGenerationPrompt) setRichPromptValue(this.mediaGenerationPrompt, meta.generationPrompt || "", true);
        if (this.mediaSettingDescription) setRichPromptValue(this.mediaSettingDescription, meta.settingDescription || "", true);
        if (this.mediaPreviewType) {
            this.mediaPreviewType.value = !meta.mediaType ? "" : (known ? meta.mediaType : "other");
        }
        if (this.mediaPreviewTypeCustom) {
            this.mediaPreviewTypeCustom.value = known ? "" : (meta.mediaType || "");
        }
        if (this.mediaPreviewTypeCustomRow) {
            this.mediaPreviewTypeCustomRow.hidden = this.mediaPreviewType?.value !== "other";
        }
        if (this.mediaPreviewTags) this.mediaPreviewTags.value = (meta.tags || []).join(", ");
    }

    _onMediaPreviewTypeChange() {
        if (this.mediaPreviewTypeCustomRow) {
            this.mediaPreviewTypeCustomRow.hidden = this.mediaPreviewType?.value !== "other";
        }
        this._saveMediaPreviewMeta();
    }

    _saveMediaPreviewMeta() {
        const item = this._mediaPreviewItem();
        if (!item) return;
        const { file, kind } = item;
        const prev = this._getMediaMeta(kind, file);
        let mediaType = String(this.mediaPreviewType?.value || "").trim();
        if (mediaType === "other") {
            mediaType = String(this.mediaPreviewTypeCustom?.value || "").trim() || "other";
        }
        this._writeMediaMeta(kind, file, {
            ...prev,
            prompt: String(this.mediaPreviewDesc?.value || ""),
            generationPrompt: String(this.mediaGenerationPrompt?.value || ""),
            settingDescription: String(this.mediaSettingDescription?.value || ""),
            mediaType,
            tags: this._parseTagList(this.mediaPreviewTags?.value),
        });
        this._saveToWidgets();
    }

    _chooseMaterialFile(relink = null) {
        this._pendingRelink = relink;
        this.addMaterialInput.value = "";
        // Replace mode is always single-file; add mode supports multi-select.
        this.addMaterialInput.multiple = !relink;
        if (relink?.kind === "image") this.addMaterialInput.accept = "image/*";
        else if (relink?.kind === "video") this.addMaterialInput.accept = "video/*";
        else if (relink?.kind === "audio") this.addMaterialInput.accept = "audio/*";
        else this.addMaterialInput.accept = "image/*,video/*,audio/*";
        this.addMaterialInput.click();
    }

    _materialKind(file) {
        const type = String(file?.type || "").toLowerCase();
        const ext = String(file?.name || "").split(".").pop().toLowerCase();
        if (type.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif", "bmp"].includes(ext)) return "image";
        if (type.startsWith("video/") || ["mp4", "webm", "mov", "mkv", "avi", "m4v"].includes(ext)) return "video";
        if (type.startsWith("audio/") || ["wav", "mp3", "flac", "ogg", "m4a", "aac"].includes(ext)) return "audio";
        return null;
    }

    _materialItemsFromFiles(fileList, { withObjectUrl = false } = {}) {
        const items = [];
        const unsupported = [];
        for (const file of fileList || []) {
            const kind = this._materialKind(file);
            if (!kind) {
                unsupported.push(file?.name || T("unknown_file"));
                continue;
            }
            const item = { file, kind };
            if (withObjectUrl) item.objectUrl = URL.createObjectURL(file);
            items.push(item);
        }
        return { items, unsupported };
    }

    _isExternalFileDrag(event) {
        const dt = event?.dataTransfer;
        if (!dt) return false;
        // On drop, files is populated; during dragover it is often empty.
        if (dt.files && dt.files.length > 0) return true;
        if (dt.items && dt.items.length) {
            for (let i = 0; i < dt.items.length; i++) {
                if (dt.items[i]?.kind === "file") return true;
            }
        }
        const types = dt.types;
        if (!types) return false;
        for (let i = 0; i < types.length; i++) {
            const t = String(types[i] || "").toLowerCase();
            if (t === "files" || t.includes("filename") || t.includes("file")) return true;
        }
        return false;
    }

    _filesFromDataTransfer(dt) {
        if (!dt) return [];
        if (dt.files?.length) return Array.from(dt.files);
        const out = [];
        if (dt.items) {
            for (let i = 0; i < dt.items.length; i++) {
                const item = dt.items[i];
                if (item?.kind !== "file") continue;
                const file = item.getAsFile?.();
                if (file) out.push(file);
            }
        }
        return out;
    }

    _fileDropModeAt(clientX, clientY) {
        const el = document.elementFromPoint(clientX, clientY);
        if (!el || !this._overlay?.contains(el)) return null;
        if (el.closest(".cat-te-media")) return "library";
        if (el.closest(".cat-te-timeline-host, .tl-root, .tl-scroll, .tl-main, .cat-te-center")) {
            return "timeline";
        }
        return "library";
    }

    _setFileDropHighlight(mode) {
        this.mediaPanel?.classList.toggle("cat-te-file-drop-over", mode === "library");
        this.tlHost?.classList.toggle("cat-te-file-drop-over", mode === "timeline");
        this._timeline?.scrollEl?.classList.toggle("cat-te-drop-active", mode === "timeline");
        document.body.classList.toggle("cat-te-media-dnd-over-tl", mode === "timeline");
    }

    _showFileDropStatus(text) {
        let bar = this._overlay?.querySelector(".cat-te-file-drop-status");
        if (!bar && this._overlay) {
            bar = document.createElement("div");
            bar.className = "cat-te-file-drop-status";
            this._overlay.appendChild(bar);
        }
        if (!bar) return;
        bar.textContent = text || "";
        bar.hidden = !text;
    }

    /**
     * Accept OS file drops on the media library and timeline.
     * Uses capture on the fullscreen overlay so nested timeline widgets
     * cannot swallow dragover (which would block drop entirely).
     */
    _bindExternalFileDrop() {
        const overlay = this._overlay;
        if (!overlay) return;
        if (this.mediaPanel) {
            this.mediaPanel.title = T("media_panel_drop_hint_title");
        }
        if (overlay._catTeFileDropBound) return;
        overlay._catTeFileDropBound = true;

        const onDragEnterOrOver = (e) => {
            if (!overlay.classList.contains("open")) return;
            if (!this._isExternalFileDrag(e)) return;
            // Required: without preventDefault the browser never fires drop.
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
            if (this._modalsBlockFileDrop()) {
                this._setFileDropHighlight(null);
                return;
            }
            this._setFileDropHighlight(this._fileDropModeAt(e.clientX, e.clientY));
        };

        const onDragLeave = (e) => {
            if (!overlay.classList.contains("open")) return;
            const next = e.relatedTarget;
            if (next && overlay.contains(next)) return;
            this._setFileDropHighlight(null);
        };

        const onDrop = (e) => {
            if (!overlay.classList.contains("open")) return;
            const files = this._filesFromDataTransfer(e.dataTransfer);
            if (!files.length && !this._isExternalFileDrag(e)) return;
            e.preventDefault();
            e.stopPropagation();
            const mode = this._fileDropModeAt(e.clientX, e.clientY) || "library";
            this._setFileDropHighlight(null);
            void this._onExternalFilesDropped(files, mode, e.clientY, e.clientX);
        };

        overlay.addEventListener("dragenter", onDragEnterOrOver, true);
        overlay.addEventListener("dragover", onDragEnterOrOver, true);
        overlay.addEventListener("dragleave", onDragLeave, true);
        overlay.addEventListener("drop", onDrop, true);

        // Some hosts only deliver drag events on window; keep drop alive while open.
        const onWinDragOver = (e) => {
            if (!overlay.classList.contains("open")) return;
            if (!this._isExternalFileDrag(e)) return;
            e.preventDefault();
        };
        const onWinDrop = (e) => {
            if (!overlay.classList.contains("open")) return;
            const files = this._filesFromDataTransfer(e.dataTransfer);
            if (!files.length) return;
            // Only claim drops that land inside the editor.
            if (!overlay.contains(e.target) && this._fileDropModeAt(e.clientX, e.clientY) == null) return;
            e.preventDefault();
            e.stopPropagation();
            const mode = this._fileDropModeAt(e.clientX, e.clientY) || "library";
            this._setFileDropHighlight(null);
            void this._onExternalFilesDropped(files, mode, e.clientY, e.clientX);
        };
        window.addEventListener("dragover", onWinDragOver, true);
        window.addEventListener("drop", onWinDrop, true);
        overlay._catTeFileDropWinCleanup = () => {
            window.removeEventListener("dragover", onWinDragOver, true);
            window.removeEventListener("drop", onWinDrop, true);
        };
    }

    _modalsBlockFileDrop() {
        return Boolean(
            (this.addMaterialModal && !this.addMaterialModal.hidden)
            || (this.mediaPreviewModal && !this.mediaPreviewModal.hidden)
            || (this.clipItemsModal && !this.clipItemsModal.hidden)
            || (this.genVideoModal && !this.genVideoModal.hidden)
            || (this.genEditModal && !this.genEditModal.hidden)
            || (this.voEditModal && !this.voEditModal.hidden)
            || (this.trackRenameModal && !this.trackRenameModal.hidden)
            || (this.trackColorModal && !this.trackColorModal.hidden)
            || (this.trackDeleteModal && !this.trackDeleteModal.hidden)
            || (this.mediaDeleteModal && !this.mediaDeleteModal.hidden)
            || (this.trackConvertModal && !this.trackConvertModal.hidden)
            || (this.settingsModal && !this.settingsModal.hidden)
            || (this.aiOptimizeModal && !this.aiOptimizeModal.hidden)
            || (this.skillPickerModal && !this.skillPickerModal.hidden),
        );
    }

    async _onExternalFilesDropped(fileList, mode, clientY = null, clientX = null) {
        if (!this._overlay?.classList.contains("open") || this._modalsBlockFileDrop()) return;
        if (this._fileDropBusy) return;

        const { items, unsupported } = this._materialItemsFromFiles(fileList || []);
        if (!items.length) {
            alert(unsupported.length
                ? T("unsupported_asset_format_list", { list: unsupported.slice(0, 8).join("\n") })
                : T("no_importable_files_detected"));
            return;
        }
        if (unsupported.length) {
            alert(T("ignored_unsupported_files", { n: unsupported.length, list: unsupported.slice(0, 8).join("\n") }));
        }

        let targetClip = null;
        if (mode === "timeline" && Number.isFinite(clientX) && Number.isFinite(clientY)) {
            targetClip = this._findClipAt(clientX, clientY) || this._findClipAtGeometry(clientX, clientY);
            if (targetClip?.track?.type !== "image") targetClip = null;
        }

        this._fileDropBusy = true;
        this._showFileDropStatus(
            targetClip
                ? T("importing_into_clip_status", { n: items.length })
                : mode === "timeline"
                    ? T("importing_insert_status", { n: items.length })
                    : T("importing_status", { n: items.length }),
        );
        try {
            await this._importMaterialItems(items, {
                insertToTimeline: mode === "timeline" && !targetClip,
                clientY,
                targetClip,
            });
            this._showFileDropStatus(
                mode === "timeline"
                    ? T("inserted_n_assets", { n: items.length })
                    : T("added_n_assets", { n: items.length }),
            );
            setTimeout(() => {
                if (!this._fileDropBusy) this._showFileDropStatus("");
            }, 1600);
        } catch (error) {
            this._showFileDropStatus("");
            alert(T("import_asset_failed", { msg: error instanceof Error ? error.message : String(error) }));
        } finally {
            this._fileDropBusy = false;
        }
    }

    _setAddMaterialMode(isReplace, count = 1) {
        if (this.addMaterialTitle) {
            if (isReplace) this.addMaterialTitle.textContent = T("replace_material_label");
            else this.addMaterialTitle.textContent = count > 1 ? T("add_material_with_count", { count }) : T("add_material_title");
        }
        if (this.addMaterialConfirmBtn) {
            this.addMaterialConfirmBtn.textContent = isReplace ? T("confirm_replace_btn") : T("confirm_btn");
        }
    }

    _renderAddMaterialPreview(items) {
        this.addMaterialPreview.replaceChildren();
        const list = document.createElement("div");
        list.className = "cat-te-add-material-list";
        for (const item of items) {
            const cell = document.createElement("div");
            cell.className = "cat-te-add-material-item";
            const media = document.createElement(item.kind === "image" ? "img" : item.kind);
            media.src = item.objectUrl;
            media.className = "cat-te-add-material-thumb";
            if (item.kind !== "image") media.controls = true;
            const name = document.createElement("div");
            name.className = "cat-te-add-material-item-name";
            name.textContent = item.file.name;
            name.title = item.file.name;
            cell.append(media, name);
            list.appendChild(cell);
        }
        this.addMaterialPreview.appendChild(list);
    }

    _previewSelectedMaterial(event) {
        const fileList = Array.from(event.target.files || []);
        event.target.value = "";
        const relink = this._pendingRelink;
        this._pendingRelink = null;
        if (!fileList.length) return;

        if (relink && fileList.length > 1) {
            alert(T("replace_material_single_file_only"));
            return;
        }

        const { items, unsupported } = this._materialItemsFromFiles(fileList, { withObjectUrl: true });
        if (relink && items.length) {
            if (items[0].kind !== relink.kind) {
                for (const item of items) {
                    if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
                }
                const expect = relink.kind === "image" ? T("media_kind_image")
                    : relink.kind === "video" ? T("media_kind_video") : T("media_kind_audio");
                alert(T("select_same_type_file", { expect }));
                return;
            }
        }
        if (!items.length) {
            alert(unsupported.length ? T("unsupported_asset_format_list", { list: unsupported.slice(0, 8).join("\n") }) : T("unsupported_asset_format_generic"));
            return;
        }
        if (unsupported.length) {
            alert(T("ignored_unsupported_files", { n: unsupported.length, list: unsupported.slice(0, 8).join("\n") }));
        }

        this._pendingMaterial = { items, relink };
        this._renderAddMaterialPreview(items);
        this.insertAfterAddCb.checked = false;
        this.insertAfterAddCb.closest("label").hidden = !!relink;
        this._setAddMaterialMode(!!relink, items.length);
        this.addMaterialModal.hidden = false;
    }

    _closeAddMaterial() {
        if (!this.addMaterialModal) return;
        for (const media of this.addMaterialPreview.querySelectorAll("audio, video")) media.pause();
        for (const item of this._pendingMaterial?.items || []) {
            if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
        }
        this._pendingMaterial = null;
        this._pendingRelink = null;
        this.addMaterialPreview.replaceChildren();
        this._setAddMaterialMode(false);
        this.addMaterialInput.accept = "image/*,video/*,audio/*";
        this.addMaterialInput.multiple = true;
        this.addMaterialModal.hidden = true;
    }

    async _uploadMaterialItem(item) {
        const form = new FormData();
        form.append("kind", item.kind);
        form.append("to_assets", "false");
        form.append("file", item.file, item.file.name);
        const response = await fetch(api.apiURL("/audio_keyframe_timeline/import_asset"), { method: "POST", body: form });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
        return {
            file: result.file,
            kind: item.kind,
            location: result.location,
            generation_prompt: result.generation_prompt || "",
            setting_description: result.setting_description || "",
        };
    }

    async _importMaterialItems(items, { insertToTimeline = false, clientY = null, targetClip = null } = {}) {
        if (!items.length) return [];
        const uploaded = [];
        for (const item of items) {
            uploaded.push(await this._uploadMaterialItem(item));
        }
        for (const u of uploaded) this._registerMediaFile(u.file, u.kind, u.location, u);
        this._renderMediaGrid();
        const visual = uploaded.filter((u) => u.kind === "image" || u.kind === "video");
        if (targetClip && visual.length) {
            this._timeline?.selectClip(targetClip);
            for (const u of visual) this._insertItemIntoClip(targetClip, u.file, u.kind);
        } else if (insertToTimeline && this._timeline) {
            let at = this._timeline.currentTime;
            for (const u of uploaded) {
                if (u.kind === "audio") await this._addAudioAtTime(u.file, at, clientY);
                else if (u.kind === "video") await this._addVideoAtTime(u.file, at, clientY);
                else await this._addImageAtTime(u.file, at, clientY);
                const clip = this.getSelectedClip();
                if (clip) at = clip.endTime;
            }
        }
        this._saveToWidgets();
        return uploaded;
    }

    async _confirmAddMaterial() {
        const pending = this._pendingMaterial;
        const items = pending?.items || [];
        if (!items.length) return;
        const relink = pending.relink;
        if (relink) {
            const oldName = String(relink.file || "").split(/[\\/]/).pop() || relink.file;
            const newName = items[0].file?.name || T("new_asset_fallback_name");
            if (!confirm(T("confirm_replace_asset", { newName, oldName }))) {
                return;
            }
        }
        const shouldInsert = this.insertAfterAddCb.checked && !relink;
        const confirmBtn = this.addMaterialConfirmBtn;
        if (confirmBtn) confirmBtn.disabled = true;
        try {
            if (relink) {
                const uploaded = await this._uploadMaterialItem(items[0]);
                this._closeAddMaterial();
                this._replaceMediaReference(relink.file, uploaded.file, uploaded.kind, true, uploaded);
                this._saveToWidgets();
                this._renderMediaGrid();
            } else {
                const uploaded = await this._importMaterialItems(items, { insertToTimeline: shouldInsert });
                this._closeAddMaterial();
                if (!uploaded.length) return;
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            alert(relink ? T("replace_asset_failed", { msg }) : T("add_asset_failed", { msg }));
        } finally {
            if (confirmBtn) confirmBtn.disabled = false;
        }
    }

    _registerMediaFile(file, kind, _location, metadata = {}) {
        this._ensureMedia(kind, file, {
            generation_prompt: String(metadata.generation_prompt || ""),
            setting_description: String(metadata.setting_description || ""),
        });
    }

    /** Swap `oldFile` → `newFile` in the media library list, keeping position. */
    _swapMediaListEntry(oldFile, newFile, kind) {
        const list = kind === "audio" ? this._audioFiles : kind === "video" ? this._videoFiles : this._imgFiles;
        const next = [];
        let placed = false;
        for (const name of list) {
            if (name === oldFile || name === newFile) {
                if (!placed) {
                    next.push(newFile);
                    placed = true;
                }
                continue;
            }
            next.push(name);
        }
        if (!placed) next.push(newFile);
        list.length = 0;
        list.push(...next);

        this._mediaStatus.delete(`${kind}:${oldFile}`);
        this._mediaStatus.set(`${kind}:${newFile}`, { location: "input" });

        const oldStarKey = this._mediaStarsId(kind, oldFile);
        const newStarKey = this._mediaStarsId(kind, newFile);
        if (oldFile !== newFile && Object.prototype.hasOwnProperty.call(this._mediaStarsByDir, oldStarKey)) {
            if (!Object.prototype.hasOwnProperty.call(this._mediaStarsByDir, newStarKey)) {
                this._mediaStarsByDir[newStarKey] = this._mediaStarsByDir[oldStarKey];
            }
            delete this._mediaStarsByDir[oldStarKey];
            this._saveMediaStarsForDir();
        }
    }

    _replaceMediaReference(oldFile, newFile, kind, recordUndo = true, metadata = {}) {
        if (!oldFile || !newFile || !kind) return;
        if (recordUndo) this._recordUndo();
        const row = this._findMedia(kind, oldFile);
        const dup = oldFile !== newFile ? this._findMedia(kind, newFile) : null;
        if (row) {
            row.file = newFile;
            row.name = newFile.split(/[\\/]/).pop() || row.name;
            row.location = "input";
            row.generation_prompt = String(metadata.generation_prompt || "");
            row.setting_description = String(metadata.setting_description || "");
            if (dup && dup !== row) {
                for (const track of this._timeline?.tracks ?? []) {
                    for (const clip of track.clips) {
                        const meta = this._meta.get(clip.id);
                        if (!meta) continue;
                        if (meta.mediaId === dup.id) meta.mediaId = row.id;
                        if (Array.isArray(meta.mediaIds)) {
                            meta.mediaIds = meta.mediaIds.map((id) => id === dup.id ? row.id : id);
                        }
                        if (Array.isArray(meta.items)) {
                            for (const item of meta.items) {
                                if (item?.id === dup.id) {
                                    item.id = row.id;
                                    item.file = newFile;
                                    item.kind = kind;
                                }
                            }
                        }
                    }
                }
                this._projectResources = this._projectResources.filter((resource) => resource !== dup);
            }
        } else {
            this._ensureMedia(kind, newFile, {
                generation_prompt: String(metadata.generation_prompt || ""),
                setting_description: String(metadata.setting_description || ""),
            });
        }
        const mediaId = (row || this._findMedia(kind, newFile))?.id;
        for (const track of this._timeline?.tracks ?? []) {
            for (const clip of track.clips) {
                const meta = this._meta.get(clip.id);
                const uses = track.type === "audio" || kind === "audio"
                    ? ((mediaId && meta?.mediaId === mediaId) || clip.src === oldFile)
                    : this._clipItems(meta).some((item) => (mediaId && item.id === mediaId) || item.file === oldFile);
                if (!uses) continue;
                if (track.type === "audio" || kind === "audio") {
                    clip.src = newFile;
                    clip.name = newFile.split(/[\\/]/).pop() || clip.name;
                    clip._audioBuffer = null;
                    if (mediaId && meta) meta.mediaId = mediaId;
                    void this._fetchPeaks(this._audioUrl(newFile)).then((r) => {
                        clip.waveformPeaks = r.peaks[0];
                        clip._audioBuffer = r.buffer;
                        clip.sourceDuration = r.duration;
                        if (meta) {
                            meta.sourceDuration = r.duration;
                            this._meta.set(clip.id, meta);
                        }
                        this._refreshClipAppearance(clip);
                    }).catch(() => this._refreshClipAppearance(clip));
                    this._refreshClipAppearance(clip);
                } else {
                    this._normalizeVisualMeta(clip, meta, { seedFromClip: false });
                    this._syncClipPrimaryAppearance(clip);
                    const first = this._clipItems(meta)[0];
                    if (first?.kind === "video") {
                        const url = this._videoUrl(first.file);
                        void this._probeVideoDuration(url).then((d) => {
                            if (!Number.isFinite(d) || d <= 0) return;
                            clip.sourceDuration = d;
                            if (clip.duration > d) clip.duration = d;
                            clip.sourceOffset = Math.min(clip.sourceOffset || 0, Math.max(0, d - clip.duration));
                            if (meta) {
                                meta.sourceDuration = d;
                                this._meta.set(clip.id, meta);
                            }
                            clip._applyPosition();
                            this._refreshTimelineDuration();
                        }).catch(() => { /* keep */ });
                    }
                }
                if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
            }
        }
        this._swapMediaListEntry(oldFile, newFile, kind);
        this._writeMediaMeta(kind, newFile, this._getMediaMeta(kind, newFile));
    }

    /** Remove one library media from project/timeline lists. Returns whether disk delete is needed. */
    _removeLibraryMediaEntry(file, kind) {
        const status = this._mediaStatus.get(`${kind}:${file}`) || { location: "input" };
        const missing = status.location === "missing";
        const media = this._findMedia(kind, file);
        const mediaId = media?.id;
        const removedClipIds = new Set();
        for (const track of this._timeline?.tracks ?? []) {
            for (const clip of [...track.clips]) {
                const meta = this._meta.get(clip.id);
                if (track.type === "audio") {
                    if (kind !== "audio") continue;
                    if ((mediaId && meta?.mediaId === mediaId) || clip.src === file) {
                        removedClipIds.add(clip.id);
                        this._meta.delete(clip.id);
                        this._timeline.removeClip(track.id, clip.id);
                        this._pruneEmptyTrack(track);
                    }
                    continue;
                }
                const items = this._clipItems(meta);
                const next = items.filter((item) => !(mediaId && item.id === mediaId) && !(item.kind === kind && item.file === file));
                if (next.length === items.length) continue;
                if (!meta) continue;
                meta.items = next;
                meta.mediaIds = next.map((item) => item.id).filter(Boolean);
                this._meta.set(clip.id, meta);
                this._normalizeVisualMeta(clip, meta, { seedFromClip: false });
                this._syncClipPrimaryAppearance(clip);
            }
        }
        if (this._selClip && removedClipIds.has(this._selClip.id)) {
            this._selClip = null;
            this._selClips = [];
            this._timeline.clearSelection();
        }
        const list = kind === "audio" ? this._audioFiles : kind === "video" ? this._videoFiles : this._imgFiles;
        const index = list.indexOf(file);
        if (index >= 0) list.splice(index, 1);
        this._mediaStatus.delete(`${kind}:${file}`);
        delete this._mediaStarsByDir[this._mediaStarsId(kind, file)];
        this._saveMediaStarsForDir();
        this._projectResources = this._projectResources.filter(
            (resource) => resource.id !== mediaId && !(resource.kind === kind && resource.file === file),
        );
        if (kind === "video") this._videoThumbCache.delete(file);
        this._mediaBatchSelected.delete(this._mediaBatchKey(kind, file));
        return { needDisk: !missing, removedClipIds };
    }

    async _deleteDiskAsset(file, kind) {
        const response = await fetch(api.apiURL("/audio_keyframe_timeline/delete_asset"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: file, kind }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || T("delete_file_failed"));
    }

    async _deleteLibraryMedia(file, kind) {
        const label = file.split(/[\\/]/).pop() || file;
        const onTimeline = this._isMediaOnTimeline(file, kind);
        const status = this._mediaStatus.get(`${kind}:${file}`) || { location: "input" };
        const missing = status.location === "missing";
        const msg = missing
            ? T("confirm_delete_orphan_asset", { label })
            : onTimeline
                ? T("confirm_delete_asset_on_timeline", { label })
                : T("confirm_delete_asset", { label });
        this._openMediaDeleteModal([{ file, kind }], msg, false);
    }

    async _deleteSelectedLibraryMedia() {
        const entries = [...this._mediaBatchSelected].map((key) => {
            const i = key.indexOf(":");
            return { kind: key.slice(0, i), file: key.slice(i + 1) };
        }).filter((row) => row.kind && row.file);
        if (!entries.length) return;
        const onTimeline = entries.some(({ file, kind }) => this._isMediaOnTimeline(file, kind));
        const msg = onTimeline
            ? T("confirm_delete_selected_n_on_timeline", { n: entries.length })
            : T("confirm_delete_selected_n", { n: entries.length });
        this._openMediaDeleteModal(entries, msg, true);
    }

    _openMediaDeleteModal(entries, message, batch) {
        if (!entries?.length) return;
        this._openDeleteConfirm(message, () => this._performMediaDelete(entries, batch), T("delete_asset_title"));
    }

    _openDeleteConfirm(message, action, title = T("delete_btn")) {
        if (!this.mediaDeleteModal || typeof action !== "function") return;
        this._pendingDeleteAction = action;
        if (this.mediaDeleteTitle) this.mediaDeleteTitle.textContent = title;
        this.mediaDeleteMessage.textContent = message;
        this.mediaDeleteModal.hidden = false;
        this.mediaDeleteModal.querySelector(".cat-te-media-delete-cancel")?.focus();
    }

    _closeMediaDeleteModal() {
        this._pendingDeleteAction = null;
        if (this.mediaDeleteModal) this.mediaDeleteModal.hidden = true;
    }

    async _confirmDeleteAction() {
        const action = this._pendingDeleteAction;
        if (typeof action !== "function") return;
        this._closeMediaDeleteModal();
        await action();
    }

    async _performMediaDelete(entries, batch) {
        this._recordUndo();
        const diskJobs = [];
        for (const { file, kind } of entries) {
            const { needDisk } = this._removeLibraryMediaEntry(file, kind);
            if (needDisk) diskJobs.push(this._deleteDiskAsset(file, kind).catch((err) => err));
        }
        this._syncSelectedClip();
        this._updatePromptPanel();
        const results = await Promise.all(diskJobs);
        const failed = results.filter((r) => r instanceof Error);
        if (batch) {
            this._mediaBatchSelected.clear();
            this._mediaBatchMode = false;
        }
        this._renderMediaGrid();
        this._refreshTimelineDuration();
        this._scheduleProgramPreview();
        if (failed.length) {
            alert(entries.length === 1
                ? T("asset_removed_disk_delete_failed", { msg: failed[0].message })
                : T("removed_with_n_disk_delete_failures", { n: failed.length }));
        }
    }

    _removeCtxMenu() {
        let removed = false;
        const m = document.querySelector(".cat-te-ctx-menu");
        if (m) { m.remove(); removed = true; }
        const fp = document.querySelector(".cat-te-font-picker");
        if (fp) {
            if (typeof fp._capFontKeyHandler === "function") {
                window.removeEventListener("keydown", fp._capFontKeyHandler, true);
                fp._capFontKeyHandler = null;
            }
            fp.remove();
            removed = true;
        }
        return removed;
    }

    _buildCtxMenu(items, x, y, { ignoreNextClick = true } = {}) {
        this._removeCtxMenu();
        if (!items?.length) return;
        const menu = document.createElement("div");
        menu.className = "cat-te-ctx-menu";
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        for (const { label, fn, danger, strike, trackName, disabled } of items) {
            const div = document.createElement("div");
            div.className = `cat-te-ctx-item${danger ? " danger" : ""}${strike ? " strike" : ""}${trackName ? " track-name" : ""}${disabled ? " disabled" : ""}`;
            div.textContent = label;
            if (disabled) div.setAttribute("aria-disabled", "true");
            div.addEventListener("click", (e) => {
                e.stopPropagation();
                if (disabled) return;
                fn();
                this._removeCtxMenu();
            });
            menu.appendChild(div);
        }
        // Prefer overlay so stacking stays above the editor chrome.
        (this._overlay || document.body).appendChild(menu);
        this._ignoreCtxCloseOnce = ignoreNextClick;
        const r = menu.getBoundingClientRect();
        if (r.right > window.innerWidth) menu.style.left = `${window.innerWidth - r.width - 8}px`;
        if (r.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - r.height - 8}px`;
        return menu;
    }

    _showClipCtxMenu(clip, e) {
        const selected = this._timeline.getSelectedClips();
        if (!selected.some(c => c.id === clip.id)) {
            this._timeline.selectClip(clip);
        }
        const m = this._meta.get(clip.id)
            ?? (clip.track.type === "audio"
                ? defaultAudioMeta()
                : isVoiceoverTrackType(clip.track.type)
                    ? defaultVoiceoverMeta()
                    : isSubtitleTrackType(clip.track.type)
                        ? defaultSubtitleMeta()
                        : defaultImageMeta());
        const isAudio = clip.track.type === "audio" || m.clipType === "audio";
        const isVoiceover = isVoiceoverClipMeta(m, clip.track);
        const isSubtitle = isSubtitleClipMeta(m, clip.track);
        const isMedia = isMediaTrackType(clip.track.type);
        const t = this._timeline.currentTime;
        const canSplit = t > clip.startTime && t < clip.endTime;
        const items = [
            ...(canSplit ? [{ label: T("menu_split"), fn: () => this._splitClip(clip) }] : []),
        ];
        if (isAudio) {
            items.push({
                label: m.muted ? T("unmute_label") : T("mute_label"),
                fn: () => {
                    m.muted = !m.muted;
                    this._meta.set(clip.id, m);
                    this._decorateClip(clip);
                },
            });
        } else if (isVoiceover) {
            items.push(
                {
                    label: m.muted ? T("unmute_label") : T("mute_label"),
                    fn: () => {
                        m.muted = !m.muted;
                        this._meta.set(clip.id, m);
                        this._decorateClip(clip);
                    },
                },
                { label: T("linked_generated_audios_title"), fn: () => void this._openOutputAudiosPicker(clip) },
                { label: T("voiceover_edit_menu"), fn: () => void this._openVoiceoverEditModal(clip) },
                { label: m.disabled ? T("menu_enable_shortcut") : T("menu_disable_shortcut"), strike: !!m.disabled, fn: () => this._toggleDisableClip(clip) },
                { label: T("menu_set_title"), fn: () => this._renameClip(clip) },
            );
        } else if (isSubtitle) {
            items.push(
                { label: m.disabled ? T("menu_enable_shortcut") : T("menu_disable_shortcut"), strike: !!m.disabled, fn: () => this._toggleDisableClip(clip) },
                { label: T("menu_set_title"), fn: () => this._renameClip(clip) },
            );
        } else if (isMedia) {
            items.push(
                ...(clip.hasAudio ? [{
                    label: m.muted ? T("unmute_label") : T("mute_label"),
                    fn: () => {
                        m.muted = !m.muted;
                        this._meta.set(clip.id, m);
                        this._decorateClip(clip);
                    },
                }] : []),
                { label: m.disabled ? T("menu_enable_shortcut") : T("menu_disable_shortcut"), strike: !!m.disabled, fn: () => this._toggleDisableClip(clip) },
                { label: T("menu_set_title"), fn: () => this._renameClip(clip) },
                ...(clip.hasAudio ? [{ label: T("menu_separate_audio"), fn: () => void this._separateClipAudio(clip) }] : []),
            );
        } else {
            const runState = this._clipRunState(clip.id);
            if (runState === "queued" || runState === "running") {
                items.push({
                    label: T("menu_abort"),
                    fn: () => void this._abortClipDownstream(clip),
                });
            } else {
                items.push({ label: T("menu_run"), fn: () => void this._runClipDownstream(clip) });
            }
            items.push(
                { label: T("menu_ai_optimize_prompt"), fn: () => void this._openAiOptimizeModal(clip) },
                { label: m.disabled ? T("menu_enable_shortcut") : T("menu_disable_shortcut"), strike: !!m.disabled, fn: () => this._toggleDisableClip(clip) },
                { label: T("menu_disable_others_assets_shortcut"), fn: () => this._disableOthers(clip) },
                { label: T("menu_set_title"), fn: () => this._renameClip(clip) },
                { label: T("view_material_title"), fn: () => this._openClipItemsModal(clip) },
                { label: T("linked_generated_videos_title"), fn: () => void this._openOutputVideosPicker(clip) },
                { label: T("menu_separate_audio"), fn: () => void this._separateClipAudio(clip) },
            );
            if (this._clipGeneratedVideos(m).length) {
                items.splice(2, 0, {
                    label: T("menu_trim_video"),
                    fn: () => void this._openGenEditModal(clip),
                });
            }
            if (this._clipUsesGeneratedPreview(m)) {
                const gen = this._firstEnabledGeneratedVideo(m);
                if (gen) {
                    const muted = gen.muted === true;
                    items.push({
                        label: muted ? T("unmute_label") : T("mute_label"),
                        fn: () => this._setGeneratedVideoMuted(clip, gen.id, !muted),
                    });
                }
            }
        }
        items.push(
            { label: T("menu_copy_shortcut"), fn: () => this._copySelectedClips() },
            { label: T("menu_paste_shortcut"), fn: () => this._pasteClips() },
            { label: T("delete_btn"), fn: () => this._deleteClip(clip), danger: true },
        );
        this._buildCtxMenu(items, e.clientX, e.clientY);
    }

    _cloneClipMeta(meta) {
        const m = { ...(meta || {}) };
        if (Array.isArray(meta?.items)) {
            m.items = meta.items.map((item) => (
                item && typeof item === "object" ? { ...item } : item
            ));
        }
        if (Array.isArray(meta?.generatedVideos)) {
            m.generatedVideos = meta.generatedVideos.map((row) => (
                row && typeof row === "object" ? { ...row } : row
            ));
        }
        if (Array.isArray(meta?.genEditAudios)) {
            m.genEditAudios = meta.genEditAudios.map((row) => (
                row && typeof row === "object" ? { ...row } : row
            ));
        }
        return m;
    }

    _snapshotClip(clip) {
        const isAudio = clip.track?.type === "audio";
        const isVoiceover = isVoiceoverTrackType(clip.track?.type);
        const isSubtitle = isSubtitleTrackType(clip.track?.type);
        const meta = this._meta.get(clip.id)
            ?? (isAudio
                ? defaultAudioMeta()
                : isVoiceover
                    ? defaultVoiceoverMeta()
                    : isSubtitle
                        ? defaultSubtitleMeta()
                        : defaultImageMeta());
        return {
            trackId: clip.track.id,
            trackType: isAudio
                ? "audio"
                : isVoiceover
                    ? "voiceover"
                    : isSubtitle
                        ? "text"
                        : "image",
            startTime: clip.startTime,
            duration: clip.duration,
            name: clip.name,
            src: clip.src,
            thumbnail: clip.thumbnail,
            color: clip.color,
            sourceDuration: isVoiceover ? Infinity : clip.sourceDuration,
            sourceOffset: clip.sourceOffset || 0,
            fadeIn: isAudio ? Math.max(0, clip.fadeIn || 0) : 0,
            fadeOut: isAudio ? Math.max(0, clip.fadeOut || 0) : 0,
            hasAudio: !!clip.hasAudio,
            waveformPeaks: clip._waveform?.length ? clip._waveform.slice() : null,
            audioBuffer: clip._audioBuffer ?? null,
            meta: this._cloneClipMeta(meta),
            subtitleStyle: isSubtitle
                ? pickSubtitleStyle(this._trackInfo.get(clip.track.id)?.subtitleStyle || meta)
                : null,
        };
    }

    /** @returns {boolean} true if anything was copied */
    _copySelectedClips() {
        let clips = this._timeline?.getSelectedClips() ?? [];
        if (!clips.length) {
            const one = this.getSelectedClip();
            if (one) clips = [one];
        }
        if (!clips.length) return false;
        const ordered = [...clips].sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
        CapTimelineEditorApp._clipClipboard = ordered.map(c => this._snapshotClip(c));
        return true;
    }

    _resolvePasteTrack(snap) {
        const tl = this._timeline;
        if (!tl || !snap) return null;
        const wantAudio = snap.trackType === "audio";
        const wantVoiceover = isVoiceoverTrackType(snap.trackType);
        const wantSub = isSubtitleTrackType(snap.trackType);
        const wantMedia = isMediaTrackType(snap.trackType);
        const orig = tl.getTrack(snap.trackId);
        if (orig && !orig.locked && orig.visible !== false) {
            const ok = wantAudio
                ? orig.type === "audio"
                : wantVoiceover
                    ? isVoiceoverTrackType(orig.type)
                    : wantSub
                        ? isSubtitleTrackType(orig.type)
                        : wantMedia
                            ? isMediaTrackType(orig.type)
                            : isDirectorTrackType(orig.type);
            if (ok) return orig;
        }
        if (wantAudio) {
            return this._allAudioTracks().find(t => !t.locked && t.visible !== false)
                ?? this._createInsertTrack("audio");
        }
        if (wantVoiceover) {
            return this._allVoiceoverTracks().find(t => !t.locked && t.visible !== false)
                ?? this._addUserTrack("voiceover")
                ?? this._createInsertTrack("voiceover");
        }
        if (wantSub) {
            return this._allTextTracks().find(t => !t.locked && t.visible !== false)
                ?? this._addUserTrack("text");
        }
        if (wantMedia) {
            return this._allMediaTracks().find(t => !t.locked && t.visible !== false)
                ?? this._createInsertTrack("video");
        }
        return this._allImageTracks().find(t => !t.locked && t.visible !== false)
            ?? this._createInsertTrack("image");
    }

    _createPasteTrack(snap) {
        let track = null;
        if (snap.trackType === "audio") {
            track = this._createInsertTrack("audio");
        } else if (isVoiceoverTrackType(snap.trackType)) {
            track = this._addUserTrack("voiceover") || this._createInsertTrack("voiceover");
        } else if (isSubtitleTrackType(snap.trackType)) {
            track = this._addUserTrack("text");
            const info = track ? (this._trackInfo.get(track.id) || {}) : null;
            if (info) {
                info.subtitleStyle = {
                    ...pickSubtitleStyle(defaultSubtitleMeta()),
                    ...pickSubtitleStyle(snap.subtitleStyle || snap.meta),
                };
                this._trackInfo.set(track.id, info);
            }
        } else {
            track = this._createInsertTrack(isMediaTrackType(snap.trackType) ? "video" : "image");
        }
        return track;
    }

    /** True if every snapshot fits on its paste track when the group starts at `base`. */
    _pasteGroupFitsAt(snaps, tracks, minStart, base) {
        for (let i = 0; i < snaps.length; i++) {
            const start = base + (snaps[i].startTime - minStart);
            if (!this._trackHasRoom(tracks[i], start, snaps[i].duration)) return false;
        }
        return true;
    }

    /**
     * Paste clipboard clips keeping relative offsets within the copied group.
     * Paste at the seek (playhead); create compatible tracks for copied track
     * groups that do not fit there.
     * @returns {boolean} true if anything was pasted
     */
    _pasteClips() {
        const snaps = CapTimelineEditorApp._clipClipboard;
        const tl = this._timeline;
        if (!snaps?.length || !tl) return false;

        const minStart = Math.min(...snaps.map(s => s.startTime));
        const tracks = snaps.map(s => this._resolvePasteTrack(s));
        if (tracks.some(t => !t)) return false;

        this._recordUndo();

        const seek = typeof tl._snapTime === "function"
            ? tl._snapTime(tl.currentTime)
            : Math.max(0, tl.currentTime);
        const pasteBase = seek;
        if (!this._pasteGroupFitsAt(snaps, tracks, minStart, pasteBase)) {
            const groups = new Map();
            for (let i = 0; i < snaps.length; i++) {
                const key = `${snaps[i].trackId || ""}:${snaps[i].trackType || "image"}`;
                const indices = groups.get(key) || [];
                indices.push(i);
                groups.set(key, indices);
            }
            for (const indices of groups.values()) {
                const fits = indices.every((i) => {
                    const start = pasteBase + (snaps[i].startTime - minStart);
                    return this._trackHasRoom(tracks[i], start, snaps[i].duration);
                });
                if (fits) continue;
                const newTrack = this._createPasteTrack(snaps[indices[0]]);
                if (!newTrack) return false;
                for (const i of indices) tracks[i] = newTrack;
            }
        }

        const created = [];
        for (let i = 0; i < snaps.length; i++) {
            const snap = snaps[i];
            const track = tracks[i];
            const start = pasteBase + (snap.startTime - minStart);
            this._ensureTimelineLength(start + snap.duration);
            const clip = tl.addClip(track.id, {
                name: snap.name,
                startTime: start,
                duration: snap.duration,
                src: snap.src,
                thumbnail: snap.thumbnail,
                color: snap.color ?? track.color,
                sourceDuration: snap.sourceDuration,
                sourceOffset: snap.sourceOffset || 0,
                fadeIn: track.type === "audio" ? Math.max(0, snap.fadeIn || 0) : 0,
                fadeOut: track.type === "audio" ? Math.max(0, snap.fadeOut || 0) : 0,
                hasAudio: !!snap.hasAudio,
                waveformPeaks: snap.waveformPeaks || undefined,
            });
            if (!clip) continue;
            clip._audioBuffer = snap.audioBuffer ?? null;
            const meta = this._cloneClipMeta(snap.meta);
            meta.trackIndex = this._trackIndex(track);
            meta.resourceStartSec = start;
            meta.resourceDurationSec = Math.max(0.05, snap.duration);
            if (track.type === "audio") {
                meta.fadeInMs = Math.round((clip.fadeIn || 0) * 1000);
                meta.fadeOutMs = Math.round((clip.fadeOut || 0) * 1000);
            }
            this._meta.set(clip.id, meta);
            this._decorateClip(clip);
            created.push(clip);
        }
        if (!created.length) return false;

        tl.selectClip(created[0]);
        for (let i = 1; i < created.length; i++) {
            tl.selectClip(created[i], { additive: true });
        }
        this._updatePromptPanel();
        this._refreshTimelineDuration();
        this._scheduleProgramPreview();
        this._saveToWidgets();
        return true;
    }

    /**
     * Queue the workflow so Timeline Editor emits data_json / clips_audio for
     * only this visual clip. Uses settings.runtime_only_clip_ids (not temporary
     * disable flags) so the filter survives queuePrompt flush / restore races.
     */
    async _runClipDownstream(clip) {
        if (!clip || !this.node) return;
        const m = this._meta.get(clip.id) ?? defaultImageMeta();
        if (clip.track?.type === "audio" || m.clipType === "audio") {
            alert(T("audio_clip_not_in_data_json"));
            return;
        }
        if (isSubtitleTrackType(clip.track?.type) || isSubtitleClipMeta(m, clip.track)) {
            return;
        }
        if (this._isEmptyGroupClip(m)) return;
        if (typeof app?.queuePrompt !== "function") {
            alert(T("queue_prompt_not_found"));
            return;
        }

        CapTimelineEditorApp._installClipRunJobHook();
        let expectedFile = null;
        let stamp = null;
        if (this._useClipSpecifiedVideoFilename !== false) {
            stamp = this._makeGenVideoStamp();
            expectedFile = this._clipSpecifiedVideoPath(clip.id, stamp);
        }
        const job = {
            clipId: String(clip.id),
            stamp,
            expectedFile,
            projectJson: JSON.stringify(this._buildProject()),
        };
        CapTimelineEditorApp._clipRunEditor = this;
        CapTimelineEditorApp._clipRunJobs = [job];
        this._runtimeOnlyClipIds = [job.clipId];
        this._genVideoStamp = stamp;
        try {
            this._saveToWidgets();
            this._openedProjectJson = JSON.stringify(this._buildProject());
            await this._waitForQueueIdle();
            this._notePendingGeneratedJob({
                clipId: clip.id,
                promptId: null,
                files: [],
                expectedFile,
                stamp,
            });
            const result = await app.queuePrompt(0, 1);
            if (result === false) {
                await this._waitForQueueIdle();
            }
            const pid = this._promptIdFromQueueResult(result);
            if (pid) this._bindPromptIdToPendingJob(pid, clip.id);
            this._schedulePendingJobsQueueReconcile();
        } catch (error) {
            const idx = CapTimelineEditorApp._clipRunJobs.indexOf(job);
            if (idx >= 0) CapTimelineEditorApp._clipRunJobs.splice(idx, 1);
            this._pendingGeneratedJobs = this._pendingGeneratedJobs.filter(
                (j) => String(j.clipId) !== String(clip.id) || j.promptId || (j.files?.length),
            );
            this._clearRunPreview(clip.id);
            this._syncClipRunDecorations();
            alert(T("run_failed", { msg: error instanceof Error ? error.message : String(error) }));
        } finally {
            if (CapTimelineEditorApp._clipRunEditor === this
                && CapTimelineEditorApp._clipRunJobs.length === 0) {
                CapTimelineEditorApp._clipRunEditor = null;
            }
            this._runtimeOnlyClipIds = null;
            // Keep stamp while this run's pending job is still open.
            if (!this._pendingGeneratedJobs.some((j) => j.stamp === stamp || j.expectedFile === expectedFile)) {
                this._genVideoStamp = null;
            }
            this._saveToWidgets();
            this._openedProjectJson = JSON.stringify(this._buildProject());
        }
    }

    /**
     * Abort this clip's queued/running prompt (interrupt workflow or dequeue).
     */
    async _abortClipDownstream(clip) {
        if (!clip) return;
        const clipId = String(clip.id);
        const state = this._clipRunState(clipId);
        if (state !== "queued" && state !== "running") return;

        const job = this._pendingGeneratedJobs.find((j) => String(j.clipId) === clipId) || null;
        const promptId = String(
            job?.promptId
            || (String(this._runningClipId) === clipId ? this._runningPromptId : "")
            || "",
        ).trim() || null;
        const stamp = job?.stamp || null;

        try {
            if (state === "running") {
                if (typeof api?.interrupt === "function") {
                    await api.interrupt(promptId || undefined);
                } else if (typeof api?.fetchApi === "function") {
                    await api.fetchApi("/interrupt", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(promptId ? { prompt_id: promptId } : {}),
                    });
                }
            } else if (promptId) {
                if (typeof api?.deleteItem === "function") {
                    await api.deleteItem("queue", promptId);
                } else if (typeof api?.fetchApi === "function") {
                    await api.fetchApi("/queue", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ delete: [promptId] }),
                    });
                }
            } else if (typeof api?.interrupt === "function") {
                // Queued locally but prompt_id not bound yet — best-effort global interrupt.
                await api.interrupt();
            }
        } catch (error) {
            alert(T("abort_failed", { msg: error instanceof Error ? error.message : String(error) }));
        }

        this._pendingGeneratedJobs = this._pendingGeneratedJobs.filter(
            (j) => String(j.clipId) !== clipId,
        );
        if (String(this._runningClipId) === clipId) {
            this._clearRunningForPrompt(this._runningPromptId);
        }
        this._clearRunPreview(clipId);
        if (stamp) this._maybeClearGenVideoStamp(stamp);
        this._syncClipRunDecorations();
    }

    _toggleDisableClip(clip) {
        this._recordUndo();
        const m = this._meta.get(clip.id) ?? defaultImageMeta();
        m.disabled = !m.disabled;
        this._meta.set(clip.id, m);
        this._decorateClip(clip);
        if (this._selClip?.id === clip.id) this._updatePromptPanel();
    }

    _disableOthers(clip) {
        const all = (clip.track?.clips || []).filter(c => c.id !== clip.id);
        if (!all.length) return;
        this._recordUndo();
        const target = all.every(c => (this._meta.get(c.id) ?? defaultImageMeta()).disabled) ? false : true;
        for (const c of all) {
            const m = this._meta.get(c.id) ?? defaultImageMeta();
            if (m.disabled !== target) {
                m.disabled = target;
                this._meta.set(c.id, m);
                this._decorateClip(c);
            }
        }
        const self = this._meta.get(clip.id) ?? defaultImageMeta();
        if (self.disabled) {
            self.disabled = false;
            this._meta.set(clip.id, self);
            this._decorateClip(clip);
            if (this._selClip?.id === clip.id) this._updatePromptPanel();
        }
    }

    _mediaKindForFile(file) {
        return mediaKindFromFilename(file, this._videoFiles.includes(file) ? "video" : "image");
    }

    _swapStartEndFrames(clip) {
        this._recordUndo();
        const m = this._meta.get(clip.id) ?? defaultImageMeta();
        if (!m.endImage || !clip.src) return;

        const prevStart = clip.src;
        clip.src = m.endImage;
        m.endImage = prevStart;
        clip.name = clip.src.split(/[\\/]/).pop() || clip.name;
        m.mediaKind = this._mediaKindForFile(clip.src);

        if (m.mediaKind === "video") {
            clip.hasAudio = false;
            clip._audioBuffer = null;
            clip.waveformPeaks = null;
            const url = this._videoUrl(clip.src);
            void this._grabVideoThumbnail(url).then(thumb => {
                clip.thumbnail = thumb;
                this._refreshClipAppearance(clip);
            }).catch(() => this._refreshClipAppearance(clip));
            void this._fetchPeaks(url).then(r => {
                clip.waveformPeaks = r.peaks[0];
                clip.hasAudio = true;
                clip._audioBuffer = r.buffer;
                this._refreshClipAppearance(clip);
            }).catch(() => this._refreshClipAppearance(clip));
        } else {
            clip.thumbnail = this._imgUrl(clip.src);
            clip.hasAudio = false;
            clip._audioBuffer = null;
            clip.waveformPeaks = null;
        }

        this._meta.set(clip.id, m);
        this._refreshClipAppearance(clip);
        if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
    }

    _renameClip(clip) {
        if (!clip) return;
        const next = prompt(T("clip_title_prompt"), clip.name || DEFAULT_CLIP_NAME);
        if (next == null) return;
        const name = String(next).trim();
        if (!name || name === clip.name) return;
        this._recordUndo();
        clip.name = name;
        this._refreshClipAppearance(clip);
        if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
        this._saveToWidgets();
    }

    _closeClipItemsModal() {
        if (!this.clipItemsModal) return;
        this.clipItemsModal.hidden = true;
        this._clipItemsModalClipId = null;
        this.clipItemsBody?.replaceChildren();
    }

    _openClipItemsModal(clip) {
        if (!this.clipItemsModal || !clip || clip.track?.type === "audio") return;
        const m = this._ensureClipMeta(clip);
        this._normalizeVisualMeta(clip, m);
        this._clipItemsModalClipId = clip.id;
        this.clipItemsModal.hidden = false;
        if (this.clipItemsTitle) this.clipItemsTitle.textContent = T("clip_items_title_dynamic", { name: clip.name || DEFAULT_CLIP_NAME });
        this._renderClipItemsModal(clip);
    }

    _renderClipItemsModal(clip) {
        if (!this.clipItemsBody) return;
        const m = this._ensureClipMeta(clip);
        const items = this._clipItems(m);
        this.clipItemsBody.replaceChildren();
        if (!items.length) {
            const empty = document.createElement("div");
            empty.className = "cat-te-clip-items-empty";
            empty.textContent = T("empty_clip_drag_hint");
            this.clipItemsBody.appendChild(empty);
            return;
        }
        items.forEach((item, index) => {
            const row = document.createElement("div");
            row.className = "cat-te-clip-item-row";
            row.dataset.index = String(index);

            const move = document.createElement("div");
            move.className = "cat-te-clip-item-move";
            const up = document.createElement("button");
            up.type = "button";
            up.className = "cat-te-clip-item-move-btn";
            up.title = T("move_up_title");
            up.innerHTML = iconHtml("arrowUp", 12);
            up.disabled = index === 0;
            up.addEventListener("click", (e) => {
                e.stopPropagation();
                this._moveClipItem(clip, index, -1);
            });
            const down = document.createElement("button");
            down.type = "button";
            down.className = "cat-te-clip-item-move-btn";
            down.title = T("move_down_title");
            down.innerHTML = iconHtml("arrowDown", 12);
            down.disabled = index === items.length - 1;
            down.addEventListener("click", (e) => {
                e.stopPropagation();
                this._moveClipItem(clip, index, 1);
            });
            move.append(up, down);

            const thumb = document.createElement(item.kind === "video" ? "video" : "img");
            thumb.className = "cat-te-clip-item-thumb";
            thumb.src = item.kind === "video" ? this._videoUrl(item.file) : this._imgUrl(item.file);
            if (item.kind === "video") {
                thumb.muted = true;
                thumb.playsInline = true;
            }

            const name = document.createElement("div");
            name.className = "cat-te-clip-item-name";
            name.textContent = item.file.split(/[\\/]/).pop();
            name.title = item.file;

            const kind = document.createElement("span");
            kind.className = "cat-te-clip-item-kind";
            kind.textContent = item.kind === "video" ? T("media_kind_video") : T("media_kind_image");

            const enable = document.createElement("label");
            enable.className = "cat-te-clip-item-enable";
            const enableCb = document.createElement("input");
            enableCb.type = "checkbox";
            enableCb.checked = item.enabled !== false;
            enableCb.title = item.enabled !== false ? T("disable_label") : T("enable_label");
            enableCb.addEventListener("click", (e) => e.stopPropagation());
            enableCb.addEventListener("change", () => {
                this._setClipItemEnabled(clip, index, !!enableCb.checked);
            });
            const enableText = document.createElement("span");
            enableText.textContent = T("enable_label");
            enable.append(enableCb, enableText);

            const del = document.createElement("button");
            del.type = "button";
            del.className = "cat-te-clip-item-delete";
            del.title = T("delete_asset_title");
            del.innerHTML = iconHtml("trash", 12);
            del.addEventListener("click", (e) => {
                e.stopPropagation();
                this._removeClipItem(clip, index);
            });

            if (item.enabled === false) row.classList.add("is-disabled");
            row.append(move, thumb, name, kind, enable, del);
            this.clipItemsBody.appendChild(row);
        });
    }

    _setClipItemEnabled(clip, index, enabled) {
        if (!clip || clip.track?.type === "audio") return;
        const m = this._ensureClipMeta(clip);
        this._normalizeVisualMeta(clip, m, { seedFromClip: false });
        if (!m.items[index]) return;
        const next = !!enabled;
        if ((m.items[index].enabled !== false) === next) return;
        this._recordUndo();
        m.items[index].enabled = next;
        this._meta.set(clip.id, m);
        this._syncClipPrimaryAppearance(clip);
        this._scheduleProgramPreview();
        this._saveToWidgets();
        if (this._clipItemsModalClipId === clip.id) this._renderClipItemsModal(clip);
        if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
    }

    _moveClipItem(clip, index, delta) {
        if (!clip || clip.track?.type === "audio" || !delta) return;
        const m = this._ensureClipMeta(clip);
        this._normalizeVisualMeta(clip, m, { seedFromClip: false });
        const items = this._clipItems(m);
        const nextIndex = index + delta;
        if (nextIndex < 0 || nextIndex >= items.length) return;
        const next = items.slice();
        const [moved] = next.splice(index, 1);
        next.splice(nextIndex, 0, moved);
        if (!this._applyClipItemOrder(clip, next)) return;
        this._setClipPreviewItemIndex(clip, nextIndex);
        this._renderClipItemsModal(clip);
        if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
    }

    _deleteClip(clip) {
        if (!clip) return;
        this._openDeleteConfirm(
            T("confirm_delete_named_clip", { name: clip.name }),
            () => this._removeTimelineClips([clip]),
        );
    }

    _splitClip(clip) {
        const tl = this._timeline;
        const t = tl.currentTime;
        if (t <= clip.startTime || t >= clip.endTime) return;
        const track = clip.track;
        const frameMin = 1 / Math.max(1, this.getFps());
        const leftDur = t - clip.startTime;
        const rightDur = clip.endTime - t;
        if (leftDur < frameMin || rightDur < frameMin) return;

        this._recordUndo();
        const isAudio = track.type === "audio";
        const baseMeta = this._meta.get(clip.id)
            ?? (isAudio ? defaultAudioMeta() : defaultImageMeta());
        const cloneMeta = () => this._cloneClipMeta(baseMeta);
        const clipId = clip.id;
        const clipStart = clip.startTime;
        const sourceOffset = clip.sourceOffset || 0;
        const fadeIn = isAudio ? Math.max(0, clip.fadeIn || 0) : 0;
        const fadeOut = isAudio ? Math.max(0, clip.fadeOut || 0) : 0;
        const shared = {
            name: clip.name,
            src: clip.src,
            thumbnail: clip.thumbnail,
            color: clip.color,
            sourceDuration: clip.sourceDuration,
            hasAudio: !!clip.hasAudio,
            waveformPeaks: clip._waveform?.length ? clip._waveform : undefined,
        };
        const audioBuffer = clip._audioBuffer;

        tl.removeClip(track.id, clipId);
        this._meta.delete(clipId);

        const left = tl.addClip(track.id, {
            ...shared,
            startTime: clipStart,
            duration: leftDur,
            sourceOffset,
            fadeIn: Math.min(fadeIn, leftDur),
            fadeOut: 0,
        });
        left._audioBuffer = audioBuffer;
        {
            const lm = cloneMeta();
            lm.resourceStartSec = clipStart;
            lm.resourceDurationSec = leftDur;
            if (isAudio) {
                lm.fadeInMs = Math.round((left.fadeIn || 0) * 1000);
                lm.fadeOutMs = 0;
            }
            this._meta.set(left.id, lm);
        }

        const right = tl.addClip(track.id, {
            ...shared,
            startTime: t,
            duration: rightDur,
            // Keep media in sync: right half continues from the split point.
            sourceOffset: sourceOffset + leftDur,
            fadeIn: 0,
            fadeOut: Math.min(fadeOut, rightDur),
        });
        right._audioBuffer = audioBuffer;
        {
            const rm = cloneMeta();
            rm.resourceStartSec = t;
            rm.resourceDurationSec = rightDur;
            if (isAudio) {
                rm.fadeInMs = 0;
                rm.fadeOutMs = Math.round((right.fadeOut || 0) * 1000);
            }
            this._meta.set(right.id, rm);
        }

        this._decorateClip(left);
        this._decorateClip(right);
        tl.selectClip(left);
        this._updatePromptPanel();
        this._scheduleProgramPreview();
    }

    _addMediaAtTime(filename, atSec, clientY) {
        return this._addImageAtTime(filename, atSec, clientY);
    }

    // ─── Program monitor (preview above timeline) ────────────────────────

    _ensureProgramPreviewObserver() {
        if (!this.programStage || this._programStageObserver) return;
        this._programStageObserver = new ResizeObserver(() => this._scheduleProgramPreview());
        this._programStageObserver.observe(this.programStage);
        this._bindProgramPreviewVisibility();
    }

    _bindProgramPreviewVisibility() {
        if (this._onProgramVisChange) return;
        this._onProgramVisChange = () => {
            if (document.hidden) return;
            if (!this._overlay?.classList.contains("open")) return;
            this._recoverProgramPreviewVideos();
        };
        document.addEventListener("visibilitychange", this._onProgramVisChange);
        window.addEventListener("focus", this._onProgramVisChange);
        window.addEventListener("pageshow", this._onProgramVisChange);
    }

    _unbindProgramPreviewVisibility() {
        if (!this._onProgramVisChange) return;
        document.removeEventListener("visibilitychange", this._onProgramVisChange);
        window.removeEventListener("focus", this._onProgramVisChange);
        window.removeEventListener("pageshow", this._onProgramVisChange);
        this._onProgramVisChange = null;
    }

    _clearPreviewSeekWatch(entry) {
        if (!entry?._seekTimer) return;
        clearTimeout(entry._seekTimer);
        entry._seekTimer = 0;
    }

    /** Unstick seeks that never fire "seeked" (tab switch / decoder busy). */
    _armPreviewSeekWatch(entry) {
        this._clearPreviewSeekWatch(entry);
        if (!entry) return;
        entry._seekTimer = setTimeout(() => {
            entry._seekTimer = 0;
            if (!entry.seeking) return;
            entry.seeking = false;
            const v = entry.el;
            const want = entry.wantTime || 0;
            if (v && Math.abs((v.currentTime || 0) - want) > 0.08) {
                try {
                    entry.seeking = true;
                    v.currentTime = want;
                    this._armPreviewSeekWatch(entry);
                } catch {
                    entry.seeking = false;
                }
            }
            if (this._isGenEditModalOpen()) this._scheduleGenEditPreview();
            else this._scheduleProgramPreview();
        }, 450);
    }

    _recoverProgramPreviewVideos() {
        for (const entry of this._previewVideos.values()) {
            if (!entry.active) continue;
            const v = entry?.el;
            if (!v) continue;
            this._clearPreviewSeekWatch(entry);
            entry.seeking = false;
            if (v.readyState >= 2) entry.ready = true;
            const want = Math.max(0, Number(entry.wantTime) || 0);
            try {
                // Nudge the decoder after background/GPU contention drops frames.
                entry.seeking = true;
                v.currentTime = want;
                this._armPreviewSeekWatch(entry);
            } catch {
                entry.seeking = false;
            }
            const wantPlay = this._isGenEditModalOpen()
                ? !!(this._genEditState?.timeline?._playing)
                : !!this._timeline?._playing;
            if (wantPlay && v.paused) {
                void v.play().catch(() => {});
            }
        }
        if (this._isGenEditModalOpen()) this._scheduleGenEditPreview();
        else this._scheduleProgramPreview();
    }

    _disposeProgramPreview() {
        this._stopResourceGenProgramPreview();
        if (this._programPreviewRaf) {
            cancelAnimationFrame(this._programPreviewRaf);
            this._programPreviewRaf = 0;
        }
        this._programStageObserver?.disconnect();
        this._programStageObserver = null;
        this._unbindProgramPreviewVisibility();
        for (const entry of this._previewVideos.values()) {
            this._clearPreviewSeekWatch(entry);
            try {
                entry.el.pause();
                entry.el.removeAttribute("src");
                entry.el.load();
            } catch { /* ignore */ }
        }
        this._previewVideos.clear();
        this._previewImages.clear();
        this._programHadFrame = false;
        this._programCanvasKey = "";
        this._programOffscreen = null;
    }

    _isGenEditModalOpen() {
        return !!(this.genEditModal && !this.genEditModal.hidden && this._genEditState);
    }

    _scheduleProgramPreview() {
        if (!this.programCanvas || !this._overlay?.classList.contains("open")) return;
        // Gen-edit owns the shared preview decoders while its modal is open.
        if (this._isGenEditModalOpen()) return;
        if (this._programPreviewRaf) return;
        this._programPreviewRaf = requestAnimationFrame(() => {
            this._programPreviewRaf = 0;
            void this._renderProgramPreview();
        });
    }

    _layoutProgramCanvas() {
        const stage = this.programStage;
        const canvas = this.programCanvas;
        if (!stage || !canvas) return null;
        const { w, h } = this.getPreviewSize();
        const sw = stage.clientWidth;
        const sh = stage.clientHeight;
        if (sw < 2 || sh < 2) return null;
        const scale = Math.min(sw / w, sh / h);
        const cssW = Math.max(1, Math.floor(w * scale));
        const cssH = Math.max(1, Math.floor(h * scale));
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const pw = Math.max(1, Math.round(cssW * dpr));
        const ph = Math.max(1, Math.round(cssH * dpr));
        if (canvas.width !== pw) canvas.width = pw;
        if (canvas.height !== ph) canvas.height = ph;
        if (this.programMeta) this.programMeta.textContent = `${w} × ${h}`;
        return { canvasW: pw, canvasH: ph, logicalW: w, logicalH: h };
    }

    _ensurePreviewImage(url) {
        if (!url) return null;
        let entry = this._previewImages.get(url);
        if (entry) return entry;
        const img = new Image();
        img.decoding = "async";
        entry = { el: img, ready: false };
        img.onload = () => {
            entry.ready = true;
            const t = this._timeline?.currentTime ?? 0;
            if (this._collectPreviewLayers(t).some((layer) => layer.kind === "image")) {
                this._scheduleProgramPreview();
            }
        };
        img.onerror = () => { entry.ready = false; };
        img.src = url;
        this._previewImages.set(url, entry);
        return entry;
    }

    _ensurePreviewVideo(file, location = "input") {
        if (!file) return null;
        const key = `${location}:${file}`;
        let entry = this._previewVideos.get(key);
        if (entry) return entry;
        const v = document.createElement("video");
        v.muted = true;
        v.playsInline = true;
        v.preload = "auto";
        entry = { el: v, active: false, ready: false, seeking: false, wantTime: 0, _seekTimer: 0, _hasDrawn: false };
        const kickPreview = () => {
            if (this._isGenEditModalOpen()) this._scheduleGenEditPreview();
            else this._scheduleProgramPreview();
        };
        const kick = () => {
            entry.ready = v.readyState >= 2;
            kickPreview();
        };
        v.addEventListener("loadeddata", kick);
        v.addEventListener("canplay", kick);
        v.addEventListener("playing", kickPreview);
        v.addEventListener("seeked", () => {
            this._clearPreviewSeekWatch(entry);
            entry.seeking = false;
            entry.ready = v.readyState >= 2;
            const playing = this._isGenEditModalOpen()
                ? !!(this._genEditState?.timeline?._playing)
                : !!this._timeline?._playing;
            const drift = Math.abs((entry.wantTime || 0) - v.currentTime);
            if (!playing && drift > 0.05) {
                this._seekPreviewVideo(entry, entry.wantTime);
            } else {
                kickPreview();
            }
        });
        v.addEventListener("error", () => { entry.ready = false; });
        v.addEventListener("stalled", kickPreview);
        v.addEventListener("suspend", () => {
            // Decoder may drop frames under GPU load — retry shortly.
            setTimeout(kickPreview, 200);
        });
        v.src = location === "output" ? this._outputVideoUrl(file) : this._videoUrl(file);
        this._previewVideos.set(key, entry);
        return entry;
    }

    _seekPreviewVideo(entry, mediaTime, { force = false } = {}) {
        if (!entry?.el) return;
        const v = entry.el;
        const t = Math.max(0, Number(mediaTime) || 0);
        const dur = Number.isFinite(v.duration) ? v.duration : null;
        const clamped = dur != null && dur > 0 ? Math.min(t, Math.max(0, dur - 0.001)) : t;
        entry.wantTime = clamped;
        if (!entry.ready && v.readyState < 1) return;
        if (entry.seeking) return;
        const playing = this._isGenEditModalOpen()
            ? !!(this._genEditState?.timeline?._playing)
            : !!this._timeline?._playing;
        // First activation / warm prefetch: tighter tolerance so we don't paint
        // a wrong near-zero frame before the real in-point seek settles.
        // While freewheeling, only correct large drift (avoids seek thrash / jumps).
        const eps = force || !entry._hasDrawn ? 0.04 : (playing ? 1.0 : 0.04);
        if (Math.abs((v.currentTime || 0) - clamped) <= eps) return;
        entry.seeking = true;
        this._armPreviewSeekWatch(entry);
        try {
            v.currentTime = clamped;
        } catch {
            entry.seeking = false;
            this._clearPreviewSeekWatch(entry);
        }
    }

    _syncPreviewVideo(entry, mediaTime, { audible = false, playing = null } = {}) {
        if (!entry?.el) return;
        entry.active = true;
        const v = entry.el;
        const t = Math.max(0, Number(mediaTime) || 0);
        const dur = Number.isFinite(v.duration) ? v.duration : null;
        const clamped = dur != null && dur > 0 ? Math.min(t, Math.max(0, dur - 0.001)) : t;
        entry.wantTime = clamped;
        const isPlaying = playing == null
            ? (this._isGenEditModalOpen()
                ? !!(this._genEditState?.timeline?._playing)
                : !!this._timeline?._playing)
            : !!playing;
        // Canvas decoder videos must stay muted. HTML5 unmute + seek/sync
        // produces crackle/noise; real audio is played via Web Audio.
        v.muted = true;
        if (isPlaying) {
            const drift = Math.abs((v.currentTime || 0) - clamped);
            // Freewheel after the first sync — only hard-correct large drift.
            const needSync = !entry._playSynced || !entry._hasDrawn || drift > 1.0;
            if (needSync) {
                this._seekPreviewVideo(entry, clamped, { force: !entry._hasDrawn });
                entry._playSynced = true;
            }
            if (v.paused && (entry.ready || v.readyState >= 2)) {
                void v.play().catch(() => {});
            }
            return;
        }
        entry._playSynced = false;
        if (!v.paused) v.pause();
        this._seekPreviewVideo(entry, clamped, { force: !entry._hasDrawn });
    }

    _previewVideoCanDraw(entry) {
        const v = entry?.el;
        if (!v || v.readyState < 2 || !(v.videoWidth > 0) || !(v.videoHeight > 0)) return false;
        // Wait for the first in-point seek so we don't flash a wrong frame;
        // after that, keep painting while freewheeling (even mid-seek).
        if (entry.seeking && !entry._hasDrawn) return false;
        return true;
    }

    _pauseUnusedPreviewVideos(usedKeys) {
        for (const [key, entry] of this._previewVideos) {
            if (usedKeys.has(key)) continue;
            entry.active = false;
            entry._playSynced = false;
            entry._hasDrawn = false;
            entry.seeking = false;
            this._clearPreviewSeekWatch(entry);
            if (!entry.el.paused) entry.el.pause();
            entry.el.muted = true;
        }
    }

    _warmNextPreviewVideo(t, usedKeys) {
        const horizon = 1.25;
        let nextTime = Infinity;
        for (const track of this._allRenderableTracks()) {
            if (track.visible === false || this._trackInfo.get(track.id)?.enabled === false) continue;
            for (const clip of track.clips) {
                const m = this._meta.get(clip.id) ?? defaultImageMeta();
                if (m.disabled || m.visible === false) continue;
                for (const edge of [clip.startTime, clip.endTime]) {
                    if (edge > t + 1e-6 && edge < nextTime) nextTime = edge;
                }
                if (isDirectorTrackType(track.type) && this._clipUsesGeneratedPreview(m)) {
                    for (const gen of this._clipGeneratedVideos(m)) {
                        if (gen.enabled === false) continue;
                        const edge = clip.startTime + Math.max(0, Number(gen.edit_start_sec) || 0);
                        if (edge > t + 1e-6 && edge < nextTime) nextTime = edge;
                    }
                }
            }
        }
        if (!Number.isFinite(nextTime) || nextTime - t > horizon) return;
        let layers = this._collectPreviewLayers(nextTime + 0.5 / Math.max(1, this.getFps()));
        if (layers.some((layer) => layer.kind === "generated")) layers = layers.slice(-1);
        const layer = layers.at(-1);
        if (!layer || (layer.kind !== "generated" && layer.kind !== "video")) return;
        const file = layer.kind === "generated" ? layer.file : (layer.item?.file || layer.clip.src);
        const location = layer.kind === "generated" ? "output" : "input";
        const key = `${location}:${file}`;
        if (!file || usedKeys.has(key)) return;
        const entry = this._ensurePreviewVideo(file, location);
        if (!entry) return;
        let mediaTime = (layer.clip.sourceOffset || 0) + (nextTime - layer.clip.startTime);
        if (layer.kind === "generated") {
            mediaTime = Math.max(0, Number(layer.trimInSec) || 0)
                + Math.max(0, nextTime - layer.clip.startTime - (Number(layer.editStartSec) || 0));
        }
        entry.active = false;
        entry.el.muted = true;
        if (!entry.el.paused) entry.el.pause();
        this._seekPreviewVideo(entry, mediaTime, { force: true });
        usedKeys.add(key);
    }

    _drawCover(ctx, media, cw, ch) {
        const mw = media.videoWidth || media.naturalWidth || media.width || 0;
        const mh = media.videoHeight || media.naturalHeight || media.height || 0;
        if (!mw || !mh) return false;
        const scale = Math.max(cw / mw, ch / mh);
        const dw = mw * scale;
        const dh = mh * scale;
        try {
            ctx.drawImage(media, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
        } catch {
            return false;
        }
        return true;
    }

    /** Fit entire media inside the box (letterbox); used by gen-edit preview. */
    _drawContain(ctx, media, cw, ch) {
        const mw = media.videoWidth || media.naturalWidth || media.width || 0;
        const mh = media.videoHeight || media.naturalHeight || media.height || 0;
        if (!mw || !mh) return false;
        const scale = Math.min(cw / mw, ch / mh);
        const dw = mw * scale;
        const dh = mh * scale;
        try {
            ctx.drawImage(media, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
        } catch {
            return false;
        }
        return true;
    }

    _clipPreviewItemAtTime(clip, items, t) {
        if (!items?.length) return null;
        if (items.length === 1) return { item: items[0], index: 0 };
        const dur = Math.max(1e-6, clip.duration);
        const localT = Math.max(0, Math.min(dur - 1e-9, t - clip.startTime));
        const index = Math.min(items.length - 1, Math.floor((localT / dur) * items.length));
        return { item: items[index], index };
    }

    _collectPreviewLayers(t) {
        const layers = [];
        // tracks[] has overlays first (top), then main — paint bottom→top via reverse.
        for (const track of [...this._allRenderableTracks()].reverse()) {
            if (track.visible === false) continue;
            const info = this._trackInfo.get(track.id) || {};
            if (info.enabled === false) continue;
            for (const clip of track.clips) {
                if (!(t >= clip.startTime - 1e-6 && t < clip.endTime - 1e-9)) continue;
                const m = this._meta.get(clip.id) ?? defaultImageMeta();
                if (m.disabled || m.visible === false) continue;
                if (isDirectorTrackType(track.type) && this._clipUsesGeneratedPreview(m)) {
                    const gens = this._clipGeneratedVideos(m).filter((g) => g.enabled !== false);
                    if (!gens.length) {
                        layers.push({ kind: "package", clip, meta: m, mediaTrack: false });
                        continue;
                    }
                    const localT = Math.max(0, t - clip.startTime);
                    // generatedVideos is newest-first; paint older first so newest ends on top.
                    for (const gen of [...gens].reverse()) {
                        const start = Math.max(0, Number(gen.edit_start_sec) || 0);
                        let eff = this._genEffectiveDurationSec(gen);
                        if (!(eff > 0)) {
                            const full = Number(gen.duration_sec);
                            eff = Number.isFinite(full) && full > 0
                                ? Math.min(full, Math.max(0.05, clip.duration - start))
                                : Math.max(0.05, clip.duration - start);
                        }
                        if (localT < start - 1e-6 || localT >= start + eff - 1e-9) continue;
                        layers.push({
                            kind: "generated",
                            clip,
                            meta: m,
                            file: gen.file,
                            muted: gen.muted === true || !!track.muted || !!m.muted,
                            trimInSec: Math.max(0, Number(gen.trim_in_sec) || 0),
                            editStartSec: start,
                            mediaTrack: false,
                        });
                    }
                    continue;
                }
                const items = this._enabledClipItems(m);
                if (!items.length) {
                    layers.push({ kind: "package", clip, meta: m, mediaTrack: isMediaTrackType(track.type) });
                    continue;
                }
                const at = this._clipPreviewItemAtTime(clip, items, t);
                const item = at?.item || items[0];
                layers.push({
                    kind: item.kind === "video" ? "video" : "image",
                    clip,
                    meta: m,
                    item,
                    itemIndex: at?.index ?? 0,
                    items,
                    mediaTrack: isMediaTrackType(track.type),
                });
            }
        }
        if (layers.some((layer) => layer.kind === "generated")) {
            return layers.filter((layer) => layer.mediaTrack || (layer.kind !== "image" && layer.kind !== "package"));
        }
        return layers;
    }

    /** Draw the timeline's layers (generated/video/image/package) at time `t`
     * into any canvas context — shared by the main program monitor and the
     * compose modal's watermark preview. Does not touch video pause/resume
     * bookkeeping; pass `onVideoUsed` to track that in the caller.
     * `fit`: "cover" (default, crop to fill) or "contain" (letterbox). */
    _drawPreviewLayersOnce(ctx, cw, ch, t, { onVideoUsed, layers: layersOpt, fit = "cover" } = {}) {
        const layers = layersOpt || this._collectPreviewLayers(t);
        const generatedActive = layers.some((layer) => layer.kind === "generated");
        const drawMedia = fit === "contain"
            ? (c, m, w, h) => this._drawContain(c, m, w, h)
            : (c, m, w, h) => this._drawCover(c, m, w, h);
        let drew = false;

        for (const layer of layers) {
            if (generatedActive && !layer.mediaTrack && (layer.kind === "image" || layer.kind === "package")) continue;
            if (layer.kind === "package") {
                ctx.fillStyle = "#1a1a28";
                ctx.fillRect(0, 0, cw, ch);
                ctx.fillStyle = "#8a8ab0";
                ctx.font = `${Math.max(12, Math.round(ch * 0.06))}px sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(layer.clip.name || DEFAULT_CLIP_NAME, cw / 2, ch / 2);
                drew = true;
                continue;
            }
            if (layer.kind === "generated" || layer.kind === "video") {
                const file = layer.kind === "generated" ? layer.file : (layer.item?.file || layer.clip.src);
                const location = layer.kind === "generated" ? "output" : "input";
                const entry = this._ensurePreviewVideo(file, location);
                if (!entry) continue;
                onVideoUsed?.(`${location}:${file}`);
                const items = layer.items || [];
                let mediaTime = (layer.clip.sourceOffset || 0) + (t - layer.clip.startTime);
                if (layer.kind === "generated") {
                    const tin = Math.max(0, Number(layer.trimInSec ?? layer.clip.sourceOffset) || 0);
                    const editStart = Math.max(0, Number(layer.editStartSec) || 0);
                    mediaTime = tin + Math.max(0, (t - layer.clip.startTime) - editStart);
                } else if (items.length > 1) {
                    const slice = layer.clip.duration / items.length;
                    mediaTime = Math.max(0, (t - layer.clip.startTime) - (layer.itemIndex || 0) * slice);
                }
                this._syncPreviewVideo(entry, mediaTime, {
                    audible: layer.kind === "generated" && layer.muted !== true,
                });
                const drawLayer = layer.mediaTrack
                    ? (c, m, w, h) => this._drawContain(c, m, w, h)
                    : drawMedia;
                if (this._previewVideoCanDraw(entry) && drawLayer(ctx, entry.el, cw, ch)) {
                    entry._hasDrawn = true;
                    drew = true;
                }
                continue;
            }
            const items = layer.items || [];
            for (const item of items) {
                if (item.kind !== "video") this._ensurePreviewImage(this._imgUrl(item.file));
            }
            const file = layer.item?.file || layer.clip.src;
            const startEntry = this._ensurePreviewImage(file ? this._imgUrl(file) : "");
            if (startEntry?.ready) {
                const drawLayer = layer.mediaTrack
                    ? (c, m, w, h) => this._drawContain(c, m, w, h)
                    : drawMedia;
                if (drawLayer(ctx, startEntry.el, cw, ch)) drew = true;
            }
        }
        return drew;
    }

    _hasVisibleSubtitleAt(t) {
        for (const track of this._allTextTracks()) {
            if (track.visible === false) continue;
            const info = this._trackInfo.get(track.id) || {};
            if (info.enabled === false) continue;
            for (const clip of track.clips) {
                if (!(t >= clip.startTime - 1e-6 && t < clip.endTime - 1e-9)) continue;
                const m = this._meta.get(clip.id) ?? defaultSubtitleMeta();
                if (m.disabled || m.visible === false) continue;
                if (String(m.text || "").trim()) return true;
            }
        }
        return false;
    }

    async _renderProgramPreview() {
        if (this._isGenEditModalOpen()) return;
        if (this._resourceGenPreview?.video && !this._resourceGenPreview.video.hidden) {
            this._layoutProgramCanvas();
            this._layoutResourceGenProgramVideo();
            if (this.programEmpty) this.programEmpty.hidden = true;
            return;
        }
        const layout = this._layoutProgramCanvas();
        const canvas = this.programCanvas;
        if (!layout || !canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const { canvasW: cw, canvasH: ch } = layout;
        const sizeKey = `${cw}x${ch}`;
        const sizeChanged = this._programCanvasKey !== sizeKey;
        this._programCanvasKey = sizeKey;

        const t = this._timeline?.currentTime ?? 0;
        const playing = !!this._timeline?._playing;
        const fps = this.getFps();
        const frameKey = playing ? `${fps}:${Math.floor(t * fps)}` : null;
        if (playing && !sizeChanged && this._programFrameKey === frameKey) {
            this._scheduleProgramPreview();
            return;
        }
        this._programFrameKey = frameKey;
        let layers = this._collectPreviewLayers(t);
        // Generated playback fills the monitor: the top layer covers all lower videos.
        if (layers.some((layer) => layer.kind === "generated")) layers = layers.slice(-1);
        const hasSub = this._hasVisibleSubtitleAt(t);
        const usedVideoKeys = new Set();

        if (!layers.length && !hasSub) {
            this._pauseUnusedPreviewVideos(usedVideoKeys);
            // During playback, keep the last good frame across tiny gaps / load
            // holes between abutting clips instead of flashing black.
            if (playing && this._programHadFrame) {
                this._scheduleProgramPreview();
                if (this.programEmpty) this.programEmpty.hidden = true;
                return;
            }
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, cw, ch);
            this._programHadFrame = false;
            if (this.programEmpty) this.programEmpty.hidden = false;
            return;
        }

        // Draw offscreen first. If video is mid-seek / decoder busy, keep the
        // previous on-screen frame instead of flashing black.
        let off = this._programOffscreen;
        if (!off || off.width !== cw || off.height !== ch) {
            off = document.createElement("canvas");
            off.width = cw;
            off.height = ch;
            this._programOffscreen = off;
        }
        const octx = off.getContext("2d");
        if (!octx) return;
        octx.setTransform(1, 0, 0, 1, 0, 0);
        octx.fillStyle = "#000";
        octx.fillRect(0, 0, cw, ch);
        const drewVisual = this._drawPreviewLayersOnce(octx, cw, ch, t, {
            layers,
            onVideoUsed: (key) => usedVideoKeys.add(key),
        });
        this._drawSubtitleOverlays(octx, cw, ch, t);
        const drew = drewVisual || hasSub;
        if (playing) this._warmNextPreviewVideo(t, usedVideoKeys);
        this._pauseUnusedPreviewVideos(usedVideoKeys);

        if (drew) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.drawImage(off, 0, 0);
            this._programHadFrame = true;
        } else if (playing && this._programHadFrame) {
            // Next clip still seeking/buffering — hold previous pixels.
            this._scheduleProgramPreview();
        } else if (sizeChanged || !this._programHadFrame) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, cw, ch);
            this._programHadFrame = false;
        }
        if (this.programEmpty) this.programEmpty.hidden = this._programHadFrame;
    }

    _configureTimelineUi() {
        const tl = this._timeline;
        if (!tl) return;
        this.footerPlayback.replaceChildren(tl.playbackControlsEl);

        const packageBtn = document.createElement("button");
        packageBtn.type = "button";
        packageBtn.className = "tl-btn tl-btn-add-package";
        packageBtn.title = T("insert_empty_clip_title");
        packageBtn.textContent = T("insert_clip_btn");
        packageBtn.addEventListener("click", (e) => {
            this._showInsertClipMenu(e);
        });
        tl.toolbarEl.appendChild(packageBtn);
        this.insertClipBtn = packageBtn;

        this.editModeBtn = document.createElement("button");
        this.editModeBtn.type = "button";
        this.editModeBtn.className = "tl-btn tl-btn-edit-mode tl-btn-all-gen-preview";
        this.editModeBtn.addEventListener("click", () => {
            this._toggleAllGeneratedPreview();
        });
        this.genEditModeBtn = null;
        // Keep old alias so lingering call sites still refresh the toolbar.
        this.allGenPreviewBtn = this.editModeBtn;

        this.runMenuBtn = document.createElement("button");
        this.runMenuBtn.type = "button";
        this.runMenuBtn.className = "tl-btn tl-btn-run-menu";
        this.runMenuBtn.textContent = T("run_btn_caret");
        this.runMenuBtn.title = T("run_menu_title");
        this.runMenuBtn.addEventListener("click", (e) => {
            this._showRunMenu(e);
        });
        tl.toolbarEl.appendChild(this.runMenuBtn);
        tl.toolbarEl.appendChild(this.editModeBtn);
        const moreBtn = document.createElement("button");
        moreBtn.type = "button";
        moreBtn.className = "tl-btn";
        moreBtn.innerHTML = iconHtml("ellipsisVertical", 16);
        moreBtn.title = T("timeline_more");
        moreBtn.setAttribute("aria-label", moreBtn.title);
        moreBtn.setAttribute("aria-haspopup", "menu");
        moreBtn.addEventListener("click", (e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            this._buildCtxMenu([
                { label: T("reset_track_order"), fn: () => this._resetTrackOrder() },
            ], rect.left, rect.bottom + 4);
        });
        tl.toolbarEl.appendChild(moreBtn);
        this._updateEditModeToolbar();

        // Timeline undo/redo: Ctrl/Cmd+Z/Y are intercepted in handleShortcutKey
        // (capture on window) so ComfyUI graph-undo cannot close this editor.
        this.undoBtn = document.createElement("button");
        this.undoBtn.type = "button";
        this.undoBtn.className = "tl-btn tl-btn-history";
        this.undoBtn.title = T("undo_title");
        this.undoBtn.textContent = T("undo_btn_label");
        this.undoBtn.addEventListener("click", () => this.undo());

        this.redoBtn = document.createElement("button");
        this.redoBtn.type = "button";
        this.redoBtn.className = "tl-btn tl-btn-history";
        this.redoBtn.title = T("redo_title");
        this.redoBtn.textContent = T("redo_btn_label");
        this.redoBtn.addEventListener("click", () => this.redo());
        tl.toolbarEl.prepend(this.undoBtn, this.redoBtn);

        this._updateHistoryButtons();

        // Replace Timeline's built-in add-track menu with the same ctx popup as Run.
        const addTrackBtn = tl.toolbarEl.querySelector(".tl-btn-add-track");
        if (addTrackBtn) {
            const neu = addTrackBtn.cloneNode(true);
            addTrackBtn.replaceWith(neu);
            neu.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._recordUndo();
                this._showAddTrackMenu(e);
            });
        }

        tl._tracksEl?.addEventListener("dblclick", (e) => {
            const clipEl = e.target.closest?.(".tl-clip");
            if (clipEl) {
                const clip = this._findClipById(clipEl.dataset.clipId);
                if (!clip) return;
                const meta = this._meta.get(clip.id) ?? defaultImageMeta();
                if (clip.track?.type === "audio" || meta.clipType === "audio") return;
                if (isVoiceoverTrackType(clip.track?.type) || isVoiceoverClipMeta(meta, clip.track)) return;
                if (isSubtitleTrackType(clip.track?.type) || isSubtitleClipMeta(meta, clip.track)) return;
                if (isMediaTrackType(clip.track?.type)) return;
                e.preventDefault();
                e.stopPropagation();
                this._timeline.selectClip(clip);
                void this._openAiOptimizeModal(clip);
                return;
            }
            const trackEl = e.target.closest?.(".tl-track");
            if (!trackEl) return;
            const track = tl.tracks.find((row) => row.el === trackEl);
            if (!isSubtitleTrackType(track?.type) || track.locked) return;
            const rect = tl.scrollEl.getBoundingClientRect();
            const x = e.clientX - rect.left + tl.scrollEl.scrollLeft;
            const at = Math.max(0, x / Math.max(1e-6, tl.pixelsPerSecond));
            this._insertSubtitleAtTime(at, track);
        });

        const scroll = tl.scrollEl;
        scroll.addEventListener("dragover", (e) => {
            if (!this._dndMedia?.file) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            scroll.classList.add("cat-te-drop-active");
        });
        scroll.addEventListener("dragleave", (e) => {
            if (!scroll.contains(e.relatedTarget)) scroll.classList.remove("cat-te-drop-active");
        });
        scroll.addEventListener("drop", (e) => {
            scroll.classList.remove("cat-te-drop-active");
            const media = this._dndMedia;
            this._dndMedia = null;
            if (!media?.file) return;
            e.preventDefault();
            this._commitMediaDrop(media, e.clientX, e.clientY);
        });
        scroll.addEventListener("contextmenu", (e) => {
            const clipEl = e.target.closest?.(".tl-clip");
            if (!clipEl) {
                if (!CapTimelineEditorApp._clipClipboard?.length) return;
                e.preventDefault();
                this._buildCtxMenu(
                    [{ label: T("menu_paste_shortcut"), fn: () => this._pasteClips() }],
                    e.clientX,
                    e.clientY,
                );
                return;
            }
            e.preventDefault();
            const clip = this._findClipById(clipEl.dataset.clipId);
            if (clip) this._showClipCtxMenu(clip, e);
        });
    }

    _bindTimelineEvents() {
        const tl = this._timeline;
        tl.bodyEl.addEventListener("click", (e) => {
            const input = document.activeElement;
            if (!input?.matches("textarea") || !this._overlay.contains(input)) return;
            if (e.target.closest("input, textarea, select, [contenteditable='true']")) return;
            // Wait until the mouse/drag sequence is complete before moving focus.
            this._overlay.focus({ preventScroll: true });
        }, true);
        tl.on("clip:select", ({ selected }) => {
            this._selClips = selected ?? tl.getSelectedClips();
            this._syncSelectedClip();
            // Do not focus the overlay here: focus during clip mousedown aborts
            // the mouse sequence and can leave drag listeners stuck, which then
            // eat sidebar clicks (settings look dead, drag feels broken).
            try {
                this._updatePromptPanel();
                this._retargetOutputVideosPickerFromSelection();
            } catch (err) {
                console.error("[CapTE] clip settings panel sync failed", err);
            }
        });
        tl.on("clip:add", ({ clip }) => {
            this._decorateClip(clip);
            this._renderMediaGrid();
            this._scheduleProgramPreview();
        });
        tl.on("clip:deselect", () => {
            this._selClip = null;
            this._selClips = [];
            this._updatePromptPanel();
        });
        tl.on("clip:remove", ({ clipId, trackId }) => {
            this._meta.delete(clipId);
            this._syncSelectedClip();
            this._updatePromptPanel();
            this._refreshTimelineDuration();
            this._pruneEmptyTrack(tl.getTrack(trackId));
            this._renderMediaGrid();
            this._scheduleProgramPreview();
        });
        tl.on("clip:trackchange", ({ clip, from, to }) => {
            const m = this._meta.get(clip.id)
                ?? (to.type === "audio"
                    ? defaultAudioMeta()
                    : isSubtitleTrackType(to.type)
                        ? defaultSubtitleMeta()
                        : defaultImageMeta());
            m.trackIndex = this._trackIndex(to);
            if (to.type === "audio") m.clipType = "audio";
            else if (isSubtitleTrackType(to.type)) m.clipType = "subtitle";
            else if (isMediaTrackType(to.type)) m.clipType = "media";
            else m.clipType = "image";
            this._meta.set(clip.id, m);
            this._updateClipInfoPanel(clip);
            this._pruneEmptyTrack(from);
            this._scheduleProgramPreview();
        });
        tl.on("track:remove", ({ trackId }) => {
            this._trackInfo.delete(trackId);
            this._scheduleProgramPreview();
        });
        // Per-frame move/resize: only refresh the info readout. Duration /
        // program preview run on gesture end - refreshing duration every
        // frame can clamp the live drag against a shrinking timeline.
        tl.on("clip:move", ({ clip }) => {
            if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
        });
        tl.on("clip:resize", ({ clip }) => {
            if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
        });
        // A drag (move/trim) fires many per-frame events; only the gesture
        // as a whole should become one undo step, and only if it actually
        // changed anything.
        tl.on("clip:movestart", () => this._beginPendingUndo());
        tl.on("clip:moveend", ({ clip, moved }) => {
            if (moved && clip?.track?.type === "image") this._rememberResourceTiming(clip);
            else if (moved && clip && (
                clip.track?.type === "audio"
                || isVoiceoverTrackType(clip.track?.type)
                || isSubtitleTrackType(clip.track?.type)
            )) {
                const m = this._ensureClipMeta(clip);
                m.resourceStartSec = Math.max(0, Number(clip.startTime) || 0);
                this._meta.set(clip.id, m);
            }
            this._commitPendingUndo(moved);
            this._refreshTimelineDuration();
            this._scheduleProgramPreview();
        });
        let resizeStartTime = null;
        tl.on("clip:resizestart", ({ clip }) => {
            resizeStartTime = clip.startTime;
            this._beginPendingUndo();
        });
        tl.on("clip:resizeend", ({ clip, moved }) => {
            this._syncAudioFadeMeta(clip);
            if (moved && clip?.track?.type === "image") {
                if (resizeStartTime != null) this._trimGeneratedVideoHead(clip, clip.startTime - resizeStartTime);
                this._rememberResourceTiming(clip);
                this._commitPendingUndo(moved);
                this._decorateClip(clip);
                if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
                this._saveToWidgets();
            } else {
                if (moved && clip && isVoiceoverTrackType(clip.track?.type)) {
                    const m = this._ensureClipMeta(clip);
                    m.resourceStartSec = Math.max(0, Number(clip.startTime) || 0);
                    m.resourceDurationSec = Math.max(0.05, Number(clip.duration) || 0.05);
                    this._meta.set(clip.id, m);
                }
                this._commitPendingUndo(moved);
            }
            resizeStartTime = null;
            this._refreshTimelineDuration();
            this._scheduleProgramPreview();
        });
        tl.on("clip:fadestart", () => this._beginPendingUndo());
        tl.on("clip:fadeend", ({ clip, moved }) => {
            this._syncAudioFadeMeta(clip);
            this._commitPendingUndo(moved);
        });
        tl.on("clip:fade", ({ clip }) => {
            if (this._selClip?.id === clip.id) this._updateClipInfoPanel(clip);
            if (this._timeline?._playing) this._startAudioPlayback();
        });
        tl.on("track:add", ({ track }) => {
            if (!this._trackInfo.has(track.id)) {
                this._trackInfo.set(track.id, { trackIndex: this._nextTrackIndex() });
            }
            const h = trackHeightFor(track.type);
            track.height = h;
            track.el.style.height = `${h}px`;
            track.headerEl.style.height = `${h}px`;
            this._setupTrackControls(track);
        });
        tl.on("zoomchange", () => this._refreshTimelineDuration());
        tl.on("play", () => {
            this._programFrameKey = null;
            this._stopResourceGenProgramPreview();
            this._startAudioPlayback();
            this._scheduleProgramPreview();
        });
        tl.on("pause", () => {
            this._stopAudioPlayback();
            this._pauseUnusedPreviewVideos(new Set());
            this._scheduleProgramPreview();
        });
        tl.on("timechange", () => this._scheduleProgramPreview());
        tl.on("seek", () => {
            this._stopResourceGenProgramPreview();
            this._updateMediaPreviewInsertBtn();
            this._scheduleProgramPreview();
            if (!tl._playing) return;
            if (this._seekAudioRaf) cancelAnimationFrame(this._seekAudioRaf);
            this._seekAudioRaf = requestAnimationFrame(() => {
                this._seekAudioRaf = null;
                this._startAudioPlayback();
            });
        });
        if (!this._onWinResize) {
            this._onWinResize = () => {
                if (this._overlay?.classList.contains("open") && this._timeline) {
                    this._refreshTimelineDuration();
                    this._scheduleProgramPreview();
                }
            };
            window.addEventListener("resize", this._onWinResize);
        }
    }

    _clearClipInfoPanel() {
        if (this.clipInfoDetail) this.clipInfoDetail.hidden = true;
        if (this.clipThumb) {
            this.clipThumb.removeAttribute("src");
            this.clipThumb.style.display = "";
            this.clipThumb.parentElement?.classList.remove("cat-te-clip-thumb-audio");
        }
        this.clipThumbWrap?.classList.remove("cat-te-clip-thumb-clickable", "cat-te-clip-thumb-audio");
        this.clipThumbWrap?.removeAttribute("title");
        if (this.clipNameEl) this.clipNameEl.textContent = "";
        if (this.clipIdEl) {
            this.clipIdEl.hidden = true;
            this.clipIdEl.textContent = "";
        }
        if (this.clipStartEl) this.clipStartEl.textContent = "";
        if (this.clipEndEl) this.clipEndEl.textContent = "";
        if (this.clipSourceTrimEl) this.clipSourceTrimEl.hidden = true;
        if (this.clipSourceInEl) this.clipSourceInEl.textContent = "";
        if (this.clipSourceOutEl) this.clipSourceOutEl.textContent = "";
        if (this.clipSourceDurEl) {
            this.clipSourceDurEl.hidden = true;
            this.clipSourceDurEl.textContent = "";
        }
        if (this.clipDurEl) this.clipDurEl.textContent = "";
        if (this.clipItemIndexEl) this.clipItemIndexEl.textContent = "";
        if (this.clipThumbVideo) {
            this.clipThumbVideo.pause();
            this.clipThumbVideo.removeAttribute("src");
            this.clipThumbVideo.hidden = true;
        }
        if (this.clipThumbEmpty) this.clipThumbEmpty.hidden = true;
        if (this.clipThumbSubtitle) this.clipThumbSubtitle.hidden = true;
        if (this.clipSwiperPrev) this.clipSwiperPrev.hidden = true;
        if (this.clipSwiperNext) this.clipSwiperNext.hidden = true;
        if (this.clipThumbSortBtn) this.clipThumbSortBtn.hidden = true;
        if (this.clipThumbDeleteBtn) this.clipThumbDeleteBtn.hidden = true;
        if (this.clipVideosHost) this.clipVideosHost.hidden = true;
        if (this.clipVideosList?.contains(this._outputVideoHoverAnchor)) this._hideOutputVideoHoverPreview();
        this.clipVideosList?.replaceChildren();
    }
    _stepClipPreview(delta) {
        const clip = this._selClip;
        if (!clip) return;
        const m = this._ensureClipMeta(clip);
        const items = this._clipItems(m);
        if (items.length <= 1) return;
        this._setClipPreviewItemIndex(clip, this._clipPreviewItemIndex(clip, m) + delta);
        this._updateClipInfoPanel(clip);
    }

    _updateClipInfoPanel(clip) {
        if (!clip) {
            this._clearClipInfoPanel();
            return;
        }
        const tl = this._timeline;
        const track = clip.track;
        const isAudio = track.type === "audio";
        const isVoiceover = isVoiceoverTrackType(track.type);
        const isSubtitle = isSubtitleTrackType(track.type);
        const isMedia = isMediaTrackType(track.type);
        // Reset thumb overlays before any meta work that might throw.
        if (this.clipThumbVideo) {
            this.clipThumbVideo.pause();
            this.clipThumbVideo.hidden = true;
        }
        if (this.clipThumbEmpty) this.clipThumbEmpty.hidden = true;
        if (this.clipThumbSubtitle) this.clipThumbSubtitle.hidden = true;
        this.clipThumbWrap?.classList.remove("cat-te-clip-thumb-audio");
        if (this.clipThumb) {
            this.clipThumb.style.display = "";
            this.clipThumb.parentElement?.classList.remove("cat-te-clip-thumb-audio");
        }

        const m = this._ensureClipMeta(clip);
        const items = (isAudio || isVoiceover || isSubtitle) ? [] : this._clipItems(m);
        const idx = this._clipPreviewItemIndex(clip, m);
        const current = items[idx] || null;
        if (this.clipInfoDetail) this.clipInfoDetail.hidden = false;

        if (isAudio || isVoiceover) {
            if (this.clipThumb) {
                this.clipThumb.removeAttribute("src");
                this.clipThumb.style.display = "none";
                this.clipThumb.parentElement?.classList.add("cat-te-clip-thumb-audio");
            }
            this.clipThumbWrap?.classList.add("cat-te-clip-thumb-audio");
        } else if (isSubtitle) {
            if (this.clipThumb) {
                this.clipThumb.removeAttribute("src");
                this.clipThumb.style.display = "none";
            }
            if (this.clipThumbSubtitle) this.clipThumbSubtitle.hidden = false;
        } else if (!current) {
            if (this.clipThumb) {
                this.clipThumb.removeAttribute("src");
                this.clipThumb.style.display = "none";
            }
            if (this.clipThumbEmpty) this.clipThumbEmpty.hidden = false;
        } else if (current.kind === "video") {
            if (this.clipThumb) {
                this.clipThumb.removeAttribute("src");
                this.clipThumb.style.display = "none";
            }
            if (this.clipThumbVideo) {
                this.clipThumbVideo.hidden = false;
                const url = this._videoUrl(current.file);
                if (this.clipThumbVideo.src !== url) this.clipThumbVideo.src = url;
            }
        } else if (this.clipThumb) {
            this.clipThumb.style.display = "";
            this.clipThumb.src = this._imgUrl(current.file);
        }

        const canPreview = isAudio ? !!clip.src : (isSubtitle || isVoiceover) ? false : !!current;
        if (this.clipThumbWrap) {
            this.clipThumbWrap.classList.toggle("cat-te-clip-thumb-clickable", canPreview);
            this.clipThumbWrap.title = canPreview ? T("click_to_preview_asset_title") : "";
        }
        if (this.clipNameEl) {
            this.clipNameEl.textContent = isSubtitle
                ? ((m.text || clip.name || T("subtitle_default_text")).trim() || T("subtitle_default_text"))
                : (current?.file?.split(/[\\/]/).pop() || clip.name || DEFAULT_CLIP_NAME);
        }
        if (this.clipIdEl) {
            const id = String(clip.id || "").trim();
            this.clipIdEl.hidden = !id;
            this.clipIdEl.textContent = id ? T("clip_id_label", { id }) : "";
        }
        if (this.clipStartEl) this.clipStartEl.textContent = tl.formatTime(clip.startTime);
        if (this.clipEndEl) this.clipEndEl.textContent = tl.formatTime(clip.endTime);
        const fps = this.getFps();
        const totalFrames = Math.max(0, frameIndexFromSecs(clip.endTime, fps) - frameIndexFromSecs(clip.startTime, fps));
        if (this.clipDurEl) {
            this.clipDurEl.textContent = T("clip_duration_frames", { duration: tl.formatTime(clip.duration), frames: totalFrames });
        }
        if (isAudio) {
            const srcIn = Math.max(0, Number(clip.sourceOffset) || Number(m.trimIn) || 0);
            const srcOut = srcIn + Math.max(0, Number(clip.duration) || 0);
            const srcDur = Math.max(0, Number(clip.sourceDuration ?? m.sourceDuration) || 0);
            if (this.clipSourceTrimLabelEl) this.clipSourceTrimLabelEl.textContent = T("clip_source_trim_label");
            if (this.clipSourceInEl) this.clipSourceInEl.textContent = tl.formatTime(srcIn);
            if (this.clipSourceOutEl) this.clipSourceOutEl.textContent = tl.formatTime(srcOut);
            if (this.clipSourceTrimEl) this.clipSourceTrimEl.hidden = false;
            if (this.clipSourceDurEl) {
                if (srcDur > 0) {
                    this.clipSourceDurEl.hidden = false;
                    this.clipSourceDurEl.textContent = T("clip_source_duration", { duration: tl.formatTime(srcDur) });
                } else {
                    this.clipSourceDurEl.hidden = true;
                    this.clipSourceDurEl.textContent = "";
                }
            }
        } else {
            if (this.clipSourceTrimEl) this.clipSourceTrimEl.hidden = true;
            if (this.clipSourceDurEl) {
                this.clipSourceDurEl.hidden = true;
                this.clipSourceDurEl.textContent = "";
            }
        }
        if (this.clipItemIndexEl) {
            this.clipItemIndexEl.textContent = current ? `${idx + 1}/${items.length}` : "";
        }
        const multi = items.length > 1;
        if (this.clipSwiperPrev) this.clipSwiperPrev.hidden = !multi;
        if (this.clipSwiperNext) this.clipSwiperNext.hidden = !multi;
        if (this.clipThumbSortBtn) this.clipThumbSortBtn.hidden = isAudio || isSubtitle;
        if (this.clipThumbDeleteBtn) this.clipThumbDeleteBtn.hidden = isAudio || isSubtitle || !current;
        this._renderClipGeneratedVideosList(clip, m, isAudio || isSubtitle || isMedia);
    }

    /** Ensure `_meta` has an entry for `clip` (create defaults if missing). */
    _ensureClipMeta(clip) {
        if (!clip) return null;
        let m = this._meta.get(clip.id);
        if (!m) {
            const ti = this._trackIndex(clip.track);
            if (clip.track?.type === "audio") m = defaultAudioMeta(ti);
            else if (isVoiceoverTrackType(clip.track?.type)) m = defaultVoiceoverMeta(ti);
            else if (isSubtitleTrackType(clip.track?.type)) m = defaultSubtitleMeta(ti);
            else m = defaultImageMeta(ti);
            this._meta.set(clip.id, m);
        }
        if (
            clip.track?.type !== "audio"
            && !isVoiceoverClipMeta(m, clip.track)
            && !isSubtitleClipMeta(m, clip.track)
        ) {
            this._normalizeVisualMeta(clip, m);
        }
        return m;
    }

    /** Re-resolve right-panel setting controls if refs are stale/missing. */
    _syncClipSettingRefs() {
        const el = this._overlay;
        if (!el) return;
        const head = el.querySelector(".cat-te-head-extend");
        const tail = el.querySelector(".cat-te-tail-extend");
        const gen = el.querySelector(".cat-te-gen-preview-video");
        const secondSample = el.querySelector(".cat-te-second-sample");
        const h3Motion = el.querySelector(".cat-te-h3-motion-context");
        const saveLatent = el.querySelector(".cat-te-save-latent");
        const seed = el.querySelector(".cat-te-clip-seed");
        const seedRandom = el.querySelector(".cat-te-clip-seed-random");
        const role = el.querySelector(".cat-te-clip-role");
        const agent = el.querySelector(".cat-te-clip-agent");
        if (!head) return;
        this.headExtendInput = head;
        this.tailExtendInput = tail;
        this.genPreviewVideoCb = gen;
        this.secondSampleCb = secondSample;
        this.h3MotionContextInput = h3Motion;
        this.saveLatentCb = saveLatent;
        this.clipSeedInput = seed;
        this.clipSeedRandomBtn = seedRandom;
        this.clipRoleSelect = role;
        this.clipRoleCustomInput = el.querySelector(".cat-te-clip-role-custom");
        this.clipRoleCustomRow = el.querySelector(".cat-te-clip-role-custom-row");
        this.clipAgentSelect = agent;
        this.clipAgentCustomInput = el.querySelector(".cat-te-clip-agent-custom");
        this.clipAgentCustomRow = el.querySelector(".cat-te-clip-agent-custom-row");
        if (!head._catTeBound) {
            head._catTeBound = true;
            head.addEventListener("change", () => this._onHeadExtendChange());
            tail?.addEventListener("change", () => this._onTailExtendChange());
            gen?.addEventListener("change", () => this._onGenPreviewVideoChange());
            secondSample?.addEventListener("change", () => this._onSecondSampleChange());
            h3Motion?.addEventListener("change", () => this._onH3MotionContextChange());
            saveLatent?.addEventListener("change", () => this._onSaveLatentChange());
            seed?.addEventListener("change", () => this._onClipSeedChange());
            seedRandom?.addEventListener("click", () => this._randomizeClipSeed());
        }
    }

    _setVisualSettingsEnabled(enabled, m = null) {
        const disabled = !enabled;
        if (this.headExtendInput) {
            this.headExtendInput.disabled = disabled;
            this.headExtendInput.value = enabled
                ? String(Math.max(0, Math.round(Number(m?.headExtendSec) || 0)))
                : "0";
        }
        if (this.tailExtendInput) {
            this.tailExtendInput.disabled = disabled;
            this.tailExtendInput.value = enabled
                ? String(Math.max(0, Math.round(Number(m?.tailExtendSec) || 0)))
                : "0";
        }
        if (this.genPreviewVideoCb) {
            this.genPreviewVideoCb.disabled = disabled;
            this.genPreviewVideoCb.checked = enabled && !!m?.generatePreviewVideo;
        }
        if (this.secondSampleCb) {
            this.secondSampleCb.disabled = disabled;
            this.secondSampleCb.checked = enabled && !!m?.secondSample;
        }
        if (this.h3MotionContextInput) {
            this.h3MotionContextInput.disabled = disabled;
            this.h3MotionContextInput.value = enabled
                ? String(this._clampH3MotionContextLength(m?.h3MotionContextLength))
                : "0";
        }
        if (this.saveLatentCb) {
            this.saveLatentCb.disabled = disabled;
            this.saveLatentCb.checked = enabled && !!m?.saveLatent;
        }
        if (this.clipSeedInput) {
            this.clipSeedInput.disabled = disabled;
            this.clipSeedInput.value = enabled ? String(this._normalizeClipSeed(m?.seed)) : "-1";
        }
        if (this.clipSeedRandomBtn) this.clipSeedRandomBtn.disabled = disabled;
        if (this.clipRoleSelect) {
            this.clipRoleSelect.disabled = disabled;
            this.clipRoleSelect.value = enabled ? this._knownClipRole(m?.clipRole) : "multi_ref";
        }
        if (this.clipAgentSelect) {
            this.clipAgentSelect.disabled = disabled;
            this.clipAgentSelect.value = enabled
                ? (m?.agent === "other" ? "other" : this._knownClipAgent(m?.agent))
                : "MiniMaxH3";
        }
        if (this.clipRoleCustomInput) {
            this.clipRoleCustomInput.disabled = disabled || m?.clipRole !== "other";
            this.clipRoleCustomInput.value = enabled ? (m?.clipRoleCustom || "") : "";
        }
        if (this.clipAgentCustomInput) {
            this.clipAgentCustomInput.disabled = disabled || m?.agent !== "other";
            this.clipAgentCustomInput.value = enabled ? (m?.agentCustom || "") : "";
        }
        this.clipRoleCustomRow && (this.clipRoleCustomRow.hidden = !enabled || m?.clipRole !== "other");
        this.clipAgentCustomRow && (this.clipAgentCustomRow.hidden = !enabled || m?.agent !== "other");
        if (this.aiOptimizeBtn) this.aiOptimizeBtn.disabled = !enabled;
    }

    _disableVisualPromptControls() {
        this._setVisualSettingsEnabled(false);
        if (this.promptInput) this.promptInput.disabled = true;
        this._setPromptIncludesEnabled(false);
        try {
            setRichPromptValue(this.promptInput, "", false);
        } catch (err) {
            console.error("[CapTE] clear prompt failed", err);
        }
    }

    _setPromptIncludesEnabled(enabled, includes = null) {
        const selected = normalizePromptIncludes(includes);
        this.promptIncludeChips?.forEach((chip) => {
            chip.disabled = !enabled;
            const key = chip.dataset.include;
            chip.classList.toggle("is-active", enabled && selected.includes(key));
        });
        this.promptIncludesHost?.classList.toggle("is-disabled", !enabled);
    }

    _syncPromptIncludesUi(meta) {
        this._setPromptIncludesEnabled(true, normalizePromptIncludes(meta?.promptIncludes));
    }

    _updatePromptPanel() {
        const clip = this._syncSelectedClip();
        this._syncClipSettingRefs();
        this._syncSidebarMode(!!clip);
        const isAudio = clip?.track?.type === "audio";
        const isVoiceover = isVoiceoverTrackType(clip?.track?.type);
        const isSubtitle = isSubtitleTrackType(clip?.track?.type);
        const isVisual = !!clip && isDirectorTrackType(clip.track?.type);
        // Unlock / show panels before any meta / info work. Controls ship as
        // HTML `disabled`; a throw in _ensureClipMeta or info view used to
        // leave the sidebar looking interactive but dead.
        if (this.visualClipBody) this.visualClipBody.hidden = !isVisual;
        if (this.subtitlePanel) this.subtitlePanel.hidden = !clip || !isSubtitle;
        if (this.voiceoverPanel) this.voiceoverPanel.hidden = !clip || !isVoiceover;
        if (!clip || isAudio || isSubtitle) {
            this._disableVisualPromptControls();
        } else if (isVoiceover) {
            this._disableVisualPromptControls();
            try {
                const m = this._ensureClipMeta(clip);
                this._fillVoiceoverPanel(m);
            } catch (err) {
                console.error("[CapTE] voiceover panel fill failed", err);
            }
        } else {
            // Enable immediately with whatever meta we already have (or defaults).
            // Full normalize can throw on corrupt media rows — do that after unlock.
            let m = this._meta.get(clip.id) || defaultImageMeta(this._trackIndex(clip.track));
            this._setVisualSettingsEnabled(true, m);
            if (this.promptInput) this.promptInput.disabled = false;
            this._syncPromptIncludesUi(m);
            try {
                m = this._ensureClipMeta(clip) || m;
                this._setVisualSettingsEnabled(true, m);
                this._syncPromptIncludesUi(m);
                this._refreshFinalPromptDisplay(clip, m);
            } catch (err) {
                console.error("[CapTE] clip meta / prompt fill failed", err);
                try {
                    this._refreshFinalPromptDisplay(clip, m);
                } catch { /* keep controls enabled */ }
            }
        }
        if (isSubtitle) {
            try {
                const subtitleMeta = this._ensureClipMeta(clip);
                const info = this._trackInfo.get(clip.track.id) || {};
                Object.assign(subtitleMeta, pickSubtitleStyle(info.subtitleStyle));
                this._fillSubtitlePanel(subtitleMeta);
                info.subtitleStyle = pickSubtitleStyle(subtitleMeta);
                this._trackInfo.set(clip.track.id, info);
            } catch (err) {
                console.error("[CapTE] subtitle panel fill failed", err);
            }
        }
        try {
            this._updateClipInfoPanel(clip);
        } catch (err) {
            console.error("[CapTE] clip info view failed", err);
        }
    }


    _bindSubtitlePanelEvents() {
        const bind = (el, ev, fn) => el?.addEventListener(ev, fn);
        bind(this.subTextInput, "focus", () => { this._subUndoArmed = true; });
        bind(this.subTextInput, "blur", () => { this._subUndoArmed = false; });
        bind(this.subTextInput, "input", () => this._onSubtitleFieldChange({ text: true }));
        for (const [el, key, cast] of [
            [this.subFontSelect, "fontFamily", "str"],
            [this.subSizeInput, "fontSize", "num"],
            [this.subLetterSpacingInput, "letterSpacing", "num"],
            [this.subColorInput, "color", "str"],
            [this.subBoldCb, "bold", "bool"],
            [this.subItalicCb, "italic", "bool"],
            [this.subOpacityInput, "opacity", "opacity"],
            [this.subStrokeCb, "strokeEnabled", "bool"],
            [this.subStrokeColorInput, "strokeColor", "str"],
            [this.subStrokeWidthInput, "strokeWidth", "num"],
            [this.subShadowCb, "shadowEnabled", "bool"],
            [this.subShadowColorInput, "shadowColor", "str"],
            [this.subShadowBlurInput, "shadowBlur", "num"],
            [this.subShadowXInput, "shadowOffsetX", "num"],
            [this.subShadowYInput, "shadowOffsetY", "num"],
            [this.subAlignSelect, "align", "str"],
            [this.subVAlignSelect, "vAlign", "str"],
            [this.subOffsetXInput, "offsetX", "num"],
            [this.subOffsetYInput, "offsetY", "num"],
        ]) {
            const isSelect = el?.tagName === "SELECT";
            const ev = el?.type === "checkbox" || el?.type === "range" || isSelect || el?.type === "color"
                ? "input"
                : "change";
            bind(el, ev === "input" ? "input" : "change", () => this._onSubtitleFieldChange({ [key]: cast }));
            // Custom font picker dispatches both; native select needs change too.
            if (isSelect) bind(el, "change", () => this._onSubtitleFieldChange({ [key]: cast }));
            if (ev === "input" && (el?.type === "number")) {
                bind(el, "change", () => this._onSubtitleFieldChange({ [key]: cast }));
            }
        }
        bind(this.subApplyAllBtn, "click", () => this._applySubtitleStyleToAllUnlocked());
    }

    _fillSubtitlePanel(m) {
        if (!m) return;
        this._subPanelFilling = true;
        try {
            if (this.subTextInput) this.subTextInput.value = m.text ?? "";
            if (this.subFontSelect) {
                let font = String(m.fontFamily || "").trim();
                if (!font && this._systemFonts?.length) {
                    font = this._systemFonts[0].family;
                    m.fontFamily = font;
                    m.fontPath = this._systemFonts[0].path || "";
                }
                this._fillSystemFontSelect(this.subFontSelect, font || "sans-serif", { autoPickFirst: true });
                if (!m.fontPath) {
                    m.fontPath = this.subFontSelect.selectedOptions?.[0]?.dataset?.path || "";
                }
                void this._ensureFontList();
            }
            if (this.subSizeInput) this.subSizeInput.value = String(Math.max(8, Math.round(Number(m.fontSize) || 48)));
            if (this.subLetterSpacingInput) {
                this.subLetterSpacingInput.value = String(Math.max(-50, Math.min(200, Math.round(Number(m.letterSpacing) || 0))));
            }
            if (this.subColorInput) this.subColorInput.value = /^#[0-9a-fA-F]{6}$/.test(m.color) ? m.color : "#ffffff";
            if (this.subBoldCb) this.subBoldCb.checked = !!m.bold;
            if (this.subItalicCb) this.subItalicCb.checked = !!m.italic;
            const opacityPct = Math.round(Math.max(0, Math.min(1, Number(m.opacity) || 1)) * 100);
            if (this.subOpacityInput) this.subOpacityInput.value = String(opacityPct);
            if (this.subOpacityVal) this.subOpacityVal.textContent = `${opacityPct}%`;
            if (this.subStrokeCb) this.subStrokeCb.checked = m.strokeEnabled !== false;
            if (this.subStrokeColorInput) {
                this.subStrokeColorInput.value = /^#[0-9a-fA-F]{6}$/.test(m.strokeColor) ? m.strokeColor : "#000000";
            }
            if (this.subStrokeWidthInput) this.subStrokeWidthInput.value = String(Number(m.strokeWidth) || 0);
            if (this.subShadowCb) this.subShadowCb.checked = m.shadowEnabled !== false;
            const shadowHex = String(m.shadowColor || "#000000");
            if (this.subShadowColorInput) {
                this.subShadowColorInput.value = /^#[0-9a-fA-F]{6}$/.test(shadowHex) ? shadowHex : "#000000";
            }
            if (this.subShadowBlurInput) this.subShadowBlurInput.value = String(Number(m.shadowBlur) || 0);
            if (this.subShadowXInput) this.subShadowXInput.value = String(Number(m.shadowOffsetX) || 0);
            if (this.subShadowYInput) this.subShadowYInput.value = String(Number(m.shadowOffsetY) || 0);
            if (this.subAlignSelect) this.subAlignSelect.value = ["left", "center", "right"].includes(m.align) ? m.align : "center";
            if (this.subVAlignSelect) this.subVAlignSelect.value = ["top", "middle", "bottom"].includes(m.vAlign) ? m.vAlign : "bottom";
            if (this.subOffsetXInput) this.subOffsetXInput.value = String(Number(m.offsetX) || 0);
            if (this.subOffsetYInput) this.subOffsetYInput.value = String(Number(m.offsetY) || 0);
        } finally {
            this._subPanelFilling = false;
        }
    }

    _readSubtitlePanelInto(meta) {
        if (!meta) return meta;
        meta.text = String(this.subTextInput?.value ?? meta.text ?? "");
        meta.fontFamily = String(this.subFontSelect?.value || meta.fontFamily || "sans-serif");
        meta.fontPath = String(
            this.subFontSelect?.selectedOptions?.[0]?.dataset?.path
            || meta.fontPath
            || "",
        );
        meta.fontSize = Math.max(8, Math.round(Number(this.subSizeInput?.value) || meta.fontSize || 48));
        meta.letterSpacing = Math.max(-50, Math.min(200, Math.round(Number(this.subLetterSpacingInput?.value) || 0)));
        meta.color = String(this.subColorInput?.value || meta.color || "#ffffff");
        meta.bold = !!this.subBoldCb?.checked;
        meta.italic = !!this.subItalicCb?.checked;
        const opacityPct = Math.max(0, Math.min(100, Number(this.subOpacityInput?.value) || 100));
        meta.opacity = opacityPct / 100;
        if (this.subOpacityVal) this.subOpacityVal.textContent = `${Math.round(opacityPct)}%`;
        meta.strokeEnabled = !!this.subStrokeCb?.checked;
        meta.strokeColor = String(this.subStrokeColorInput?.value || meta.strokeColor || "#000000");
        meta.strokeWidth = Math.max(0, Number(this.subStrokeWidthInput?.value) || 0);
        meta.shadowEnabled = !!this.subShadowCb?.checked;
        meta.shadowColor = String(this.subShadowColorInput?.value || meta.shadowColor || "#000000");
        meta.shadowBlur = Math.max(0, Number(this.subShadowBlurInput?.value) || 0);
        meta.shadowOffsetX = Number(this.subShadowXInput?.value) || 0;
        meta.shadowOffsetY = Number(this.subShadowYInput?.value) || 0;
        meta.align = String(this.subAlignSelect?.value || "center");
        meta.vAlign = String(this.subVAlignSelect?.value || "bottom");
        meta.offsetX = Number(this.subOffsetXInput?.value) || 0;
        meta.offsetY = Number(this.subOffsetYInput?.value) || 0;
        return meta;
    }

    _onSubtitleFieldChange(changes = {}) {
        if (this._subPanelFilling) return;
        const clip = this._selClip;
        if (!clip || !isSubtitleTrackType(clip.track?.type)) return;
        if (this._subUndoArmed) {
            this._recordUndo();
            this._subUndoArmed = false;
        } else if (!this._subStyleUndoArmed) {
            this._recordUndo();
            this._subStyleUndoArmed = true;
            clearTimeout(this._subStyleUndoTimer);
            this._subStyleUndoTimer = setTimeout(() => { this._subStyleUndoArmed = false; }, 600);
        }
        const m = this._ensureClipMeta(clip);
        this._readSubtitlePanelInto(m);
        if (!changes.text) {
            const style = pickSubtitleStyle(m);
            const info = this._trackInfo.get(clip.track.id) || {};
            info.subtitleStyle = style;
            this._trackInfo.set(clip.track.id, info);
            for (const other of clip.track.clips) {
                const otherMeta = this._ensureClipMeta(other);
                Object.assign(otherMeta, style);
                this._meta.set(other.id, otherMeta);
                this._decorateClip(other);
            }
        }
        this._syncFontSelectPreview(this.subFontSelect);
        const label = (m.text || T("subtitle_default_text")).trim() || T("subtitle_default_text");
        clip.name = label.slice(0, 40);
        const labelEl = clip.el?.querySelector?.(".tl-clip-label");
        if (labelEl) labelEl.textContent = clip.name;
        this._meta.set(clip.id, m);
        if (this.clipNameEl) this.clipNameEl.textContent = clip.name;
        this._decorateClip(clip);
        this._saveToWidgets();
        this._scheduleProgramPreview();
    }

    _applySubtitleStyleToAllUnlocked() {
        const clip = this._selClip;
        if (!clip || !isSubtitleTrackType(clip.track?.type)) return;
        const style = pickSubtitleStyle(this._ensureClipMeta(clip));
        this._recordUndo();
        for (const track of this._allTextTracks()) {
            if (track.locked) continue;
            const info = this._trackInfo.get(track.id) || {};
            info.subtitleStyle = { ...style };
            this._trackInfo.set(track.id, info);
            for (const other of track.clips) {
                const m = this._ensureClipMeta(other);
                Object.assign(m, style);
                const label = (m.text || T("subtitle_default_text")).trim() || T("subtitle_default_text");
                other.name = label.slice(0, 40);
                const labelEl = other.el?.querySelector?.(".tl-clip-label");
                if (labelEl) labelEl.textContent = other.name;
                this._meta.set(other.id, m);
                this._decorateClip(other);
            }
        }
        this._saveToWidgets();
        this._scheduleProgramPreview();
    }

    _drawSubtitleOverlays(ctx, cw, ch, t) {
        const tracks = [...this._allTextTracks()].reverse();
        for (const track of tracks) {
            if (track.visible === false) continue;
            const info = this._trackInfo.get(track.id) || {};
            if (info.enabled === false) continue;
            for (const clip of track.clips) {
                if (!(t >= clip.startTime - 1e-6 && t < clip.endTime - 1e-9)) continue;
                const m = this._meta.get(clip.id) ?? defaultSubtitleMeta();
                if (m.disabled || m.visible === false) continue;
                this._paintSubtitle(ctx, cw, ch, {
                    ...m,
                    ...pickSubtitleStyle(info.subtitleStyle),
                });
            }
        }
    }

    _paintSubtitle(ctx, cw, ch, m) {
        const text = String(m.text || "").trim();
        if (!text) return;
        const scale = ch / Math.max(1, Number(this._w("height")?.value) || ch);
        const fontSize = Math.max(8, Number(m.fontSize) || 48) * scale;
        const letterSpacing = (Number(m.letterSpacing) || 0) * scale;
        const weight = m.bold ? "700" : "400";
        const style = m.italic ? "italic" : "normal";
        const family = m.fontFamily ? `"${String(m.fontFamily).replace(/"/g, "")}", sans-serif` : "sans-serif";
        ctx.save();
        ctx.font = `${style} ${weight} ${fontSize}px ${family}`;
        ctx.textAlign = m.align === "left" || m.align === "right" ? m.align : "center";
        ctx.textBaseline = "middle";
        ctx.globalAlpha = Math.max(0, Math.min(1, Number(m.opacity) || 1));

        const lines = text.split(/\r?\n/);
        const lineHeight = fontSize * 1.25;
        const blockH = lineHeight * lines.length;
        const padX = cw * 0.04;
        let x = cw / 2;
        if (m.align === "left") x = padX;
        else if (m.align === "right") x = cw - padX;
        x += (Number(m.offsetX) || 0) / 100 * cw;

        let y;
        const oy = (Number(m.offsetY) || 0) / 100 * ch;
        if (m.vAlign === "top") y = padX + blockH / 2 + oy;
        else if (m.vAlign === "middle") y = ch / 2 + oy;
        else y = ch - padX - blockH / 2 - oy;

        if (m.shadowEnabled !== false) {
            ctx.shadowColor = m.shadowColor || "rgba(0,0,0,0.75)";
            ctx.shadowBlur = Math.max(0, Number(m.shadowBlur) || 0);
            ctx.shadowOffsetX = Number(m.shadowOffsetX) || 0;
            ctx.shadowOffsetY = Number(m.shadowOffsetY) || 0;
        } else {
            ctx.shadowColor = "transparent";
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
        }

        const startY = y - (blockH - lineHeight) / 2;
        for (let i = 0; i < lines.length; i++) {
            const ly = startY + i * lineHeight;
            if (m.strokeEnabled !== false && Number(m.strokeWidth) > 0) {
                ctx.lineWidth = Number(m.strokeWidth) || 1;
                ctx.strokeStyle = m.strokeColor || "#000";
                ctx.lineJoin = "round";
                this._drawTextWithLetterSpacing(ctx, lines[i], x, ly, letterSpacing, "stroke");
            }
            ctx.fillStyle = m.color || "#fff";
            this._drawTextWithLetterSpacing(ctx, lines[i], x, ly, letterSpacing, "fill");
        }
        ctx.restore();
    }

    _syncSidebarMode(hasClip) {
        if (this.sidebarTitle) this.sidebarTitle.textContent = hasClip ? T("clip_settings_title") : T("project_settings_title");
        if (this.projectPanel) this.projectPanel.hidden = !!hasClip;
        if (this.clipPanel) this.clipPanel.hidden = !hasClip;
        if (hasClip) {
            if (document.activeElement === this.projectNameInput) this.projectNameInput.blur();
        } else {
            this._syncSettingPromptInputs();
            this._syncProjectScalarDisplay();
        }
    }

    _syncBrandProjectName() {
        const name = String(this.projectNameInput?.value || T("untitled_project")).trim() || T("untitled_project");
        if (this.brandProjectBtn) this.brandProjectBtn.textContent = name;
    }

    _focusProjectNameFromBrand() {
        this._timeline?.clearSelection?.();
        this._selClip = null;
        this._selClips = [];
        this._updatePromptPanel();
        requestAnimationFrame(() => {
            this.projectNameInput?.focus();
            this.projectNameInput?.select?.();
        });
    }

    _syncProjectScalarDisplay() {
        const fps = Number(this._w("fps")?.value ?? PY_SCALAR_DEFAULTS.fps);
        const width = Math.round(Number(this._w("width")?.value ?? PY_SCALAR_DEFAULTS.width) || PY_SCALAR_DEFAULTS.width);
        const height = Math.round(Number(this._w("height")?.value ?? PY_SCALAR_DEFAULTS.height) || PY_SCALAR_DEFAULTS.height);
        const fpsText = Number.isFinite(fps) ? (Number.isInteger(fps) ? String(fps) : fps.toFixed(1)) : "24";
        const sizeText = `${width} × ${height}`;
        const fpsLabel = `${fpsText} fps`;
        if (this.headerScalarsEl) this.headerScalarsEl.textContent = `${sizeText} · ${fpsLabel}`;
        if (this.projectScalarsEl) this.projectScalarsEl.textContent = `${sizeText} · ${fpsLabel}`;
    }

    _readSettingPrompt(key) {
        const input = this._settingPromptInputs?.[key];
        if (input && (document.activeElement === input || typeof input.value === "string")) {
            return String(input.value ?? "");
        }
        const parsed = this._parseProjectWidgetValue();
        const settings = parsed?.project?.settings;
        if (settings && typeof settings === "object" && settings[key] != null) {
            return String(settings[key]);
        }
        return "";
    }

    _writeSettingPrompt(key, text) {
        const next = String(text ?? "");
        this._settingPromptSyncing = true;
        try {
            const input = this._settingPromptInputs?.[key];
            if (input) setRichPromptValue(input, next, true);
            this._syncScalarsToProjectJson();
            this.node.setDirtyCanvas?.(true, true);
            this._refreshFinalPromptDisplay();
        } finally {
            this._settingPromptSyncing = false;
        }
    }

    _syncSettingPromptInputs() {
        if (this._settingPromptSyncing) return;
        for (const key of SETTING_PROMPT_KEYS) {
            const input = this._settingPromptInputs?.[key];
            if (!input) continue;
            if (document.activeElement === input) continue;
            const value = this._readSettingPrompt(key);
            if (input.value === value) {
                updateRichPromptMirror(input);
                continue;
            }
            setRichPromptValue(input, value, true);
        }
    }

    _onSettingPromptInput(key) {
        if (this._settingPromptUndoArmed?.[key]) {
            this._recordUndo();
            this._settingPromptUndoArmed[key] = false;
        }
        this._writeSettingPrompt(key, this._settingPromptInputs?.[key]?.value ?? "");
    }

    _parseExtendSec(input) {
        const n = Math.round(Number(input?.value));
        if (!Number.isFinite(n) || n < 0) return 0;
        return Math.min(600, n);
    }

    _stripPromptComments(text) {
        return String(text ?? "")
            .split(/\r?\n/)
            .filter((line) => !line.trimStart().startsWith("#"))
            .join("\n")
            .trim();
    }

    _composeFinalPrompt(clip, meta = null) {
        if (!clip) return "";
        const m = meta || this._ensureClipMeta(clip);
        const includes = normalizePromptIncludes(m.promptIncludes);
        const values = {
            clip: m.prompt,
            detailed_description: m.detailedDescription,
            media: this._clipItems(m)
                .filter((item) => item.enabled !== false)
                .map((item) => {
                    const media = (item.id && this._findMediaById(item.id)) || this._findMedia(item.kind, item.file);
                    return this._stripPromptComments(media?.prompt);
                })
                .filter(Boolean)
                .join("\n\n"),
        };
        const parts = [];
        const prepend = this._stripPromptComments(this._readSettingPrompt("prepend_prompt"));
        if (prepend) parts.push(prepend);
        for (const key of this._getPromptConcatOrder()) {
            if (!includes.includes(key)) continue;
            const text = this._stripPromptComments(values[key]);
            if (!text) continue;
            if (key === "detailed_description" && !text.startsWith("detailed_description:")) {
                parts.push(`detailed_description:\n\n${text}`);
            } else {
                parts.push(text);
            }
        }
        const append = this._stripPromptComments(this._readSettingPrompt("append_prompt"));
        if (append) parts.push(append);
        return parts.join("\n\n");
    }

    _refreshFinalPromptDisplay(clip = this._selClip, meta = null) {
        if (!this.promptInput) return;
        this.promptInput.value = this._composeFinalPrompt(clip, meta);
    }

    _promptManagerSettingKey(tab) {
        if (tab === "prepend") return "prepend_prompt";
        if (tab === "append") return "append_prompt";
        return null;
    }

    _promptManagerValue(tab, clip) {
        if (!clip) return "";
        const meta = this._ensureClipMeta(clip);
        if (tab === "detailed_description") return String(meta.detailedDescription || "");
        if (tab === "clip") return String(meta.prompt || "");
        if (tab === "media") return this._mediaPromptBlock(clip);
        const key = this._promptManagerSettingKey(tab);
        return key ? this._readSettingPrompt(key) : "";
    }

    _writePromptManagerValue(tab, text, { recordUndo = true } = {}) {
        const clip = this._findClipById(this._aiOptimizeClipId) || this._selClip;
        if (!clip || tab === "media") return false;
        if (recordUndo) this._recordUndo();
        const value = String(text ?? "");
        if (tab === "detailed_description" || tab === "clip") {
            const meta = this._ensureClipMeta(clip);
            if (tab === "detailed_description") meta.detailedDescription = value;
            else meta.prompt = value;
            this._meta.set(clip.id, meta);
        } else {
            const key = this._promptManagerSettingKey(tab);
            if (!key) return false;
            this._writeSettingPrompt(key, value);
        }
        this._refreshFinalPromptDisplay();
        this._saveToWidgets();
        return true;
    }

    _onPromptManagerSourceInput() {
        if (!this.aiSrcText || this.aiSrcText.readOnly || this._aiOptimizeSrc === "media") return;
        if (this._promptManagerUndoArmed) {
            this._recordUndo();
            this._promptManagerUndoArmed = false;
        }
        this._writePromptManagerValue(this._aiOptimizeSrc, this.aiSrcText.value, { recordUndo: false });
    }

    _mediaPromptBlock(clip) {
        const m = this._ensureClipMeta(clip);
        const items = this._clipItems(m);
        const lines = [];
        items.forEach((item, index) => {
            if (item.enabled === false) return;
            const media = (item.id && this._findMediaById(item.id)) || this._findMedia(item.kind, item.file);
            const name = (item.file || "").split(/[\\/]/).pop() || item.file || T("asset_index_fallback", { index: index + 1 });
            const kind = item.kind === "video" ? T("media_kind_video") : T("media_kind_image");
            const type = media?.media_type || "";
            const tags = Array.isArray(media?.tags) ? media.tags.filter(Boolean).join(", ") : "";
            const prompt = String(media?.prompt || "");
            const meta = [kind, type, tags].filter(Boolean).join(" · ");
            lines.push(`${index + 1}. ${name}${meta ? `（${meta}）` : ""}`);
            lines.push(prompt || T("empty_paren"));
            lines.push("");
        });
        return lines.join("\n").trim() || T("no_media_prompt_for_clip");
    }

    _clipAiOptimizeFiles(clip) {
        const m = this._ensureClipMeta(clip);
        return this._clipItems(m)
            .filter((item) => item.enabled !== false)
            .map((item) => {
            const media = (item.id && this._findMediaById(item.id)) || this._findMedia(item.kind, item.file);
            const status = this._mediaStatus.get(`${item.kind}:${item.file}`);
            return {
                kind: item.kind,
                file: item.file,
                location: status?.location || media?.location || "input",
                prompt: String(media?.prompt || ""),
                generation_prompt: String(media?.generation_prompt || ""),
                setting_description: String(media?.setting_description || ""),
                media_type: String(media?.media_type || ""),
                tags: Array.isArray(media?.tags) ? media.tags : [],
            };
        });
    }

    _setAiOptimizeSrcTab(tab) {
        const allowed = new Set(["detailed_description", "clip", "media", "prepend", "append"]);
        const next = allowed.has(tab) ? tab : "detailed_description";
        this._aiOptimizeSrc = next;
        this.aiSrcTabs?.forEach((btn) => {
            btn.classList.toggle("is-active", btn.dataset.src === next);
            btn.setAttribute("aria-selected", btn.dataset.src === next ? "true" : "false");
        });
        if (this.aiSrcText) {
            this.aiSrcText.readOnly = next === "media";
            this.aiSrcText.classList.toggle("is-readonly", next === "media");
            this.aiSrcText.title = next === "media" ? T("material_prompt_readonly_hint") : "";
        }
        this._promptManagerUndoArmed = false;
        this._fillAiOptimizeSrc();
        this._setAiOptimizeBusy(this._aiOptimizeBusy);
    }

    _fillAiOptimizeSrc() {
        if (!this.aiSrcText) return;
        const clip = this._findClipById(this._aiOptimizeClipId);
        if (!clip) {
            setRichPromptValue(this.aiSrcText, "", true);
            return;
        }
        const tab = this._aiOptimizeSrc || "detailed_description";
        setRichPromptValue(this.aiSrcText, this._promptManagerValue(tab, clip), true);
        this.aiSrcText.placeholder = tab === "media" ? T("material_prompt_readonly_hint") : "";
    }

    _restoreAiOutputLanguage() {
        if (!this.aiLangSelect) return;
        const saved = localStorage.getItem(STORAGE_AI_PROMPT_LANG) || "简体中文";
        this.aiLangSelect.value = AI_PROMPT_LANGUAGES.includes(saved) ? saved : "简体中文";
    }

    _aiOutputLanguage() {
        const value = String(this.aiLangSelect?.value || "").trim();
        return AI_PROMPT_LANGUAGES.includes(value) ? value : "简体中文";
    }

    async _openAiOptimizeModal(clip = this._selClip) {
        if (!clip || !isDirectorTrackType(clip.track?.type) || !this.aiOptimizeModal) return;
        this.aiOptimizeModal.hidden = false;
        this._aiOptimizeSrc = "detailed_description";
        if (this.aiResultInput) this.aiResultInput.value = "";
        await this._bindAiOptimizeToClip(clip, { reloadModels: true });
    }

    _closeAiOptimizeModal() {
        this._cancelAiOptimize();
        if (!this.aiOptimizeModal) return;
        this.aiOptimizeModal.hidden = true;
        this.aiPreviewVideo?.pause();
        this._aiOptimizeClipId = null;
        this._syncAiOptimizeNavButtons();
    }

    _aiOptimizeEligibleClips() {
        const out = [];
        for (const track of this._timeline?.tracks ?? []) {
            if (!isDirectorTrackType(track.type)) continue;
            const clips = [...track.clips].sort((a, b) => a.startTime - b.startTime || String(a.id).localeCompare(String(b.id)));
            out.push(...clips);
        }
        return out;
    }

    _syncAiOptimizeNavButtons() {
        const open = !!(this.aiOptimizeModal && !this.aiOptimizeModal.hidden);
        const clips = open ? this._aiOptimizeEligibleClips() : [];
        const multi = clips.length > 1;
        if (this.aiOptimizePrevBtn) this.aiOptimizePrevBtn.disabled = !multi;
        if (this.aiOptimizeNextBtn) this.aiOptimizeNextBtn.disabled = !multi;
    }

    async _bindAiOptimizeToClip(clip, { reloadModels = false } = {}) {
        if (!clip || !this.aiOptimizeModal) return;
        this._cancelAiOptimize();
        const meta = this._ensureClipMeta(clip);
        this._aiOptimizeClipId = clip.id;
        if (this.aiOptimizeTitle) {
            this.aiOptimizeTitle.textContent = T("prompt_manager_title");
        }
        if (this.aiSkillInput && !String(this.aiSkillInput.value || "").trim()) {
            this.aiSkillInput.value = localStorage.getItem(STORAGE_AI_PROMPT_SKILL) || "";
        }
        this._restoreAiOutputLanguage();
        this._setAiOptimizeSrcTab(this._aiOptimizeSrc || "detailed_description");
        this._syncPromptIncludesUi(meta);
        if (reloadModels) await this._loadAiOptimizeModels();
        await this._loadAiAgentPrompt(meta.agent || "MiniMaxH3", meta.clipRole || "multi_ref");
        this._syncAiOptimizeNavButtons();
        if (String(clip.id) === String(this._modelPreviewClipId)
            || String(clip.id) === String(this._modelPreviewEntry?.clipId)) {
            this._renderModelPreview(this._modelPreviewEntry, this._modelPreviewPromptId
                ? T("model_preview_running")
                : T("model_preview_complete"));
        } else if (this.aiPreviewPanel) {
            this.aiPreviewPanel.hidden = true;
        }
        this._syncModelPreviewButton();
    }

    async _stepAiOptimizeClip(delta) {
        if (!this.aiOptimizeModal || this.aiOptimizeModal.hidden) return;
        const clips = this._aiOptimizeEligibleClips();
        if (clips.length < 2) return;
        let idx = clips.findIndex((c) => c.id === this._aiOptimizeClipId);
        if (idx < 0) idx = 0;
        const next = clips[(idx + delta + clips.length * 10) % clips.length];
        if (!next || next.id === this._aiOptimizeClipId) return;
        this._timeline?.selectClip(next);
        await this._bindAiOptimizeToClip(next, { reloadModels: false });
    }

    _cancelAiOptimize() {
        const controller = this._aiOptimizeAbort;
        this._aiOptimizeAbort = null;
        controller?.abort();
        this._setAiOptimizeBusy(false);
    }

    async _loadAiOptimizeModels() {
        if (!this.aiModelSelect) return;
        try {
            const response = await fetch(api.apiURL("/audio_keyframe_timeline/vl_models"));
            const data = await response.json();
            const models = Array.isArray(data.models) ? data.models : [];
            const agents = Array.isArray(data.agents) ? data.agents : [];
            if (data.skill_url && this.aiSkillLink) this.aiSkillLink.href = data.skill_url;
            const saved = localStorage.getItem(STORAGE_AI_PROMPT_MODEL) || "";
            this.aiModelSelect.replaceChildren();
            if (!models.length && !agents.length) {
                const opt = document.createElement("option");
                opt.value = "";
                opt.textContent = T("no_model_or_agent_found");
                this.aiModelSelect.appendChild(opt);
                this.aiModelSelect.disabled = true;
                return;
            }
            this.aiModelSelect.disabled = false;
            if (agents.length) {
                const group = document.createElement("optgroup");
                group.label = T("configured_agents_group_label");
                for (const agent of agents) {
                    const opt = document.createElement("option");
                    opt.value = `agent:${agent.id}`;
                    opt.textContent = `${agent.label} · ${agent.model}`;
                    group.appendChild(opt);
                }
                this.aiModelSelect.appendChild(group);
            }
            if (models.length) {
                const group = document.createElement("optgroup");
                group.label = T("local_qwen_group_label");
                for (const name of models) {
                    const opt = document.createElement("option");
                    opt.value = `local:${name}`;
                    opt.textContent = name;
                    group.appendChild(opt);
                }
                this.aiModelSelect.appendChild(group);
            }
            const values = [...this.aiModelSelect.options].map((option) => option.value);
            const normalizedSaved = saved && !saved.includes(":") ? `local:${saved}` : saved;
            this.aiModelSelect.value = values.includes(normalizedSaved) ? normalizedSaved : values[0];
        } catch {
            this.aiModelSelect.replaceChildren();
            const opt = document.createElement("option");
            opt.value = "";
            opt.textContent = T("model_list_load_failed");
            this.aiModelSelect.appendChild(opt);
            this.aiModelSelect.disabled = true;
        }
    }

    async _loadAiAgentPrompt(agent, clipRole) {
        if (!this.aiSystemInput) return;
        try {
            const query = `agent=${encodeURIComponent(agent || "MiniMaxH3")}&clip_role=${encodeURIComponent(clipRole || "multi_ref")}`;
            const response = await fetch(api.apiURL(`/audio_keyframe_timeline/clip_prompt_agent?${query}`));
            const data = await response.json();
            this.aiSystemInput.value = String(data.system_prompt || "");
            if (data.skill_url && this.aiSkillLink) this.aiSkillLink.href = data.skill_url;
        } catch {
            this.aiSystemInput.value = "";
        }
    }

    _setAiOptimizeBusy(busy) {
        this._aiOptimizeBusy = !!busy;
        this.aiSrcTabs?.forEach((tab) => { tab.disabled = !!busy; });
        if (busy) {
            if (this.aiOptimizePrevBtn) this.aiOptimizePrevBtn.disabled = true;
            if (this.aiOptimizeNextBtn) this.aiOptimizeNextBtn.disabled = true;
        } else {
            this._syncAiOptimizeNavButtons();
        }
        if (this.aiOptimizeBtn) {
            const audio = this._selClip?.track?.type === "audio";
            this.aiOptimizeBtn.disabled = !busy && (!this._selClip || audio);
            this.aiOptimizeBtn.classList.toggle("is-loading", false);
            this.aiOptimizeBtn.classList.toggle("is-cancel", busy);
            const span = this.aiOptimizeBtn.querySelector("span");
            if (span) span.textContent = busy ? T("terminate_label") : T("edit_btn");
        }
        if (this.aiGenerateBtn) {
            this.aiGenerateBtn.disabled = !busy && this._aiOptimizeSrc === "media";
            this.aiGenerateBtn.classList.toggle("is-loading", false);
            this.aiGenerateBtn.classList.toggle("is-cancel", busy);
            this.aiGenerateBtn.innerHTML = busy
                ? `${iconHtml("sparkles", 12)}<span>${T("terminate_label")}</span>`
                : `${iconHtml("sparkles", 12)}<span>${T("generate_btn")}</span>`;
        }
    }

    async _runAiOptimize() {
        const clip = this._findClipById(this._aiOptimizeClipId) || this._selClip;
        const targetTab = this._aiOptimizeSrc || "detailed_description";
        if (!clip || clip.track?.type === "audio" || this._aiOptimizeBusy || targetTab === "media") return;
        const meta = this._ensureClipMeta(clip);
        const modelChoice = String(this.aiModelSelect?.value || "").trim();
        if (!modelChoice) {
            alert(T("no_available_model_or_agent_alert"));
            return;
        }
        localStorage.setItem(STORAGE_AI_PROMPT_MODEL, modelChoice);
        const isAgent = modelChoice.startsWith("agent:");
        const model = modelChoice.startsWith("local:") ? modelChoice.slice(6) : "";
        const agentId = isAgent ? modelChoice.slice(6) : "";
        const skill = String(this.aiSkillInput?.value || "");
        localStorage.setItem(STORAGE_AI_PROMPT_SKILL, skill);
        const outputLanguage = this._aiOutputLanguage();
        localStorage.setItem(STORAGE_AI_PROMPT_LANG, outputLanguage);
        const ac = new AbortController();
        this._aiOptimizeAbort = ac;
        this._setAiOptimizeBusy(true);
        try {
            const payload = {
                model,
                agent_id: agentId,
                system_prompt: String(this.aiSystemInput?.value || ""),
                skill,
                output_language: outputLanguage,
                agent: meta.agent || "MiniMaxH3",
                clip_role: meta.clipRole || "multi_ref",
                audio_mode: "none",
                generate_bgm: false,
                lyrics: "",
                duration_sec: Number(clip.duration) || 0,
                clip_prompt: this._promptManagerValue(targetTab, clip),
                global_prompt: this._readSettingPrompt("prepend_prompt"),
                user_prompt: String(this.aiResultInput?.value || "").trim(),
                files: this._clipAiOptimizeFiles(clip),
                keep_loaded: false,
            };
            const response = await fetch(api.apiURL("/audio_keyframe_timeline/optimize_clip_prompt"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                signal: ac.signal,
            });
            const data = await response.json().catch(() => ({}));
            if (ac.signal.aborted || data.cancelled || response.status === 499) return;
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            const text = String(data.prompt || "").trim();
            if (!text) throw new Error(T("model_no_prompt_returned"));
            const preview = text.length > 800 ? `${text.slice(0, 800)}…` : text;
            const h3Sections = meta.agent === "MiniMaxH3" ? splitH3ProjectPrompt(text) : null;
            const target = h3Sections
                ? `${this._promptManagerTabLabel("clip")} + ${this._promptManagerTabLabel("detailed_description")}`
                : this._promptManagerTabLabel(targetTab);
            if (!confirm(T("confirm_apply_generated_prompt", { target, preview }))) return;
            if (h3Sections) {
                this._recordUndo();
                meta.prompt = h3Sections.clipPrompt;
                meta.detailedDescription = h3Sections.detailedDescription;
                if (h3Sections.soundAndMusic) {
                    const input = this._settingPromptInputs?.append_prompt;
                    if (input) {
                        setRichPromptValue(input, joinPromptParts(h3Sections.soundAndMusic, input.value), true);
                    }
                }
                this._meta.set(clip.id, meta);
                this._refreshFinalPromptDisplay();
                this._saveToWidgets();
            } else {
                this._writePromptManagerValue(targetTab, text, { recordUndo: true });
            }
            this._fillAiOptimizeSrc();
        } catch (error) {
            if (ac.signal.aborted || error?.name === "AbortError") return;
            alert(T("ai_optimize_failed", { msg: error instanceof Error ? error.message : String(error) }));
        } finally {
            if (this._aiOptimizeAbort === ac) {
                this._aiOptimizeAbort = null;
                this._setAiOptimizeBusy(false);
            }
        }
    }

    _closeSkillPicker() {
        if (this.skillPickerModal) this.skillPickerModal.hidden = true;
    }

    _setSkillSyncBusy(busy) {
        this._skillSyncBusy = !!busy;
        if (!this.skillSyncBtn) return;
        this.skillSyncBtn.disabled = !!busy;
        this.skillSyncBtn.classList.toggle("is-loading", !!busy);
        const span = this.skillSyncBtn.querySelector("span");
        if (span) span.textContent = busy ? T("syncing_ellipsis") : T("update_btn");
    }

    async _syncH3Skills() {
        if (this._skillSyncBusy) return;
        this._setSkillSyncBusy(true);
        try {
            const response = await fetch(api.apiURL("/audio_keyframe_timeline/h3_skills_sync"), { method: "POST" });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            this._h3Skills = Array.isArray(data.skills) ? data.skills : [];
            if (!this.skillPickerModal?.hidden) this._renderSkillPicker();
            alert(T("synced_n_skills", { n: this._h3Skills.length }));
        } catch (error) {
            alert(T("sync_failed", { msg: error instanceof Error ? error.message : String(error) }));
        } finally {
            this._setSkillSyncBusy(false);
        }
    }

    async _openSkillPicker() {
        if (!this.skillPickerModal) return;
        this.skillPickerModal.hidden = false;
        if (this.skillPickerFilter) this.skillPickerFilter.value = "";
        this.skillPickerBody && (this.skillPickerBody.textContent = T("loading_ellipsis"));
        try {
            const response = await fetch(api.apiURL("/audio_keyframe_timeline/h3_skills"));
            const data = await response.json().catch(() => ({}));
            this._h3Skills = Array.isArray(data.skills) ? data.skills : [];
            this._renderSkillPicker();
        } catch (error) {
            if (this.skillPickerBody) {
                this.skillPickerBody.textContent = T("load_failed", { msg: error instanceof Error ? error.message : String(error) });
            }
        }
    }

    _renderSkillPicker() {
        const body = this.skillPickerBody;
        if (!body) return;
        const query = String(this.skillPickerFilter?.value || "").trim().toLowerCase();
        const rows = (this._h3Skills || []).filter((row) => {
            if (!query) return true;
            const title = String(row.title || "").toLowerCase();
            const name = String(row.name || row.id || "").toLowerCase();
            return title.includes(query) || name.includes(query);
        });
        body.replaceChildren();
        if (!rows.length) {
            const empty = document.createElement("div");
            empty.className = "cat-te-skill-picker-empty";
            empty.textContent = (this._h3Skills || []).length
                ? T("no_matching_skill")
                : T("no_local_skills_hint");
            body.appendChild(empty);
            return;
        }
        const grid = document.createElement("div");
        grid.className = "cat-te-skill-picker-grid";
        for (const row of rows) {
            const card = document.createElement("div");
            card.className = "cat-te-skill-card";
            const img = document.createElement("img");
            img.alt = "";
            img.loading = "lazy";
            if (row.has_preview) {
                img.src = api.apiURL(`/audio_keyframe_timeline/h3_skill_preview?id=${encodeURIComponent(row.id)}`);
            }
            const name = document.createElement("div");
            name.className = "cat-te-skill-card-name";
            name.textContent = row.title || row.name || row.id;
            name.title = row.summary || name.textContent;
            const apply = document.createElement("button");
            apply.type = "button";
            apply.className = "cat-te-btn cat-te-btn-primary cat-te-skill-apply";
            apply.dataset.skillId = row.id;
            apply.textContent = T("apply_btn");
            card.append(img, name, apply);
            grid.appendChild(card);
        }
        body.appendChild(grid);
    }

    async _applyH3Skill(skillId) {
        const id = String(skillId || "").trim();
        if (!id) return;
        try {
            const response = await fetch(api.apiURL(`/audio_keyframe_timeline/h3_skill?id=${encodeURIComponent(id)}`));
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            const text = String(data.text || "");
            if (this.aiSkillInput) this.aiSkillInput.value = text;
            localStorage.setItem(STORAGE_AI_PROMPT_SKILL, text);
            this._closeSkillPicker();
        } catch (error) {
            alert(T("apply_skill_failed", { msg: error instanceof Error ? error.message : String(error) }));
        }
    }

    _onPromptIncludeToggle(key) {
        if (!this._selClip || !PROMPT_PART_KEY_SET.has(key)) return;
        this._recordUndo();
        const m = this._meta.get(this._selClip.id) ?? defaultImageMeta();
        const current = normalizePromptIncludes(m.promptIncludes);
        const next = current.includes(key)
            ? current.filter((k) => k !== key)
            : [...current, key];
        m.promptIncludes = PROMPT_PART_KEYS.filter((k) => next.includes(k));
        this._meta.set(this._selClip.id, m);
        this._syncPromptIncludesUi(m);
        this._refreshFinalPromptDisplay(this._selClip, m);
        this._saveToWidgets();
    }

    _promptManagerTabLabel(key) {
        switch (key) {
            case "detailed_description": return T("ai_prompt_tab");
            case "clip": return T("clip_prompt_tab");
            case "media": return T("media_prompt_tab");
            case "prepend": return T("prepend_prompt_tab");
            case "append": return T("append_prompt_tab");
            default: return key;
        }
    }

    _promptPartLabel(key) {
        switch (key) {
            case "clip": return T("prompt_include_clip");
            case "detailed_description": return T("prompt_include_ai");
            case "media": return T("prompt_include_media");
            default: return key;
        }
    }

    _getPromptConcatOrder() {
        return normalizePromptConcatOrder(this._promptConcatOrder);
    }

    _setPromptConcatOrder(order, { recordUndo = true } = {}) {
        const next = normalizePromptConcatOrder(order);
        const prev = this._getPromptConcatOrder().join(",");
        if (next.join(",") === prev) return;
        if (recordUndo) this._recordUndo();
        this._promptConcatOrder = next;
        this._renderPromptConcatOrderList();
        this._saveToWidgets();
    }

    _movePromptConcatOrder(index, delta) {
        const order = this._getPromptConcatOrder();
        const to = index + delta;
        if (to < 0 || to >= order.length) return;
        const next = order.slice();
        const [row] = next.splice(index, 1);
        next.splice(to, 0, row);
        this._setPromptConcatOrder(next);
    }

    _renderPromptConcatOrderList() {
        if (!this.promptOrderList) return;
        const order = this._getPromptConcatOrder();
        this.promptOrderList.replaceChildren();
        order.forEach((key, index) => {
            const row = document.createElement("div");
            row.className = "cat-te-prompt-order-row";
            row.dataset.key = key;
            const label = document.createElement("span");
            label.className = "cat-te-prompt-order-name";
            label.textContent = this._promptPartLabel(key);
            const actions = document.createElement("div");
            actions.className = "cat-te-prompt-order-actions";
            const up = document.createElement("button");
            up.type = "button";
            up.className = "cat-te-prompt-order-btn";
            up.title = T("move_up_title");
            up.disabled = index === 0;
            up.innerHTML = iconHtml("arrowUp", 12);
            up.addEventListener("click", (e) => {
                e.stopPropagation();
                this._movePromptConcatOrder(index, -1);
            });
            const down = document.createElement("button");
            down.type = "button";
            down.className = "cat-te-prompt-order-btn";
            down.title = T("move_down_title");
            down.disabled = index === order.length - 1;
            down.innerHTML = iconHtml("arrowDown", 12);
            down.addEventListener("click", (e) => {
                e.stopPropagation();
                this._movePromptConcatOrder(index, 1);
            });
            actions.append(up, down);
            row.append(label, actions);
            this.promptOrderList.appendChild(row);
        });
    }

    _onClipRoleChange() {
        if (!this._selClip || this.clipRoleSelect?.disabled) return;
        this._recordUndo();
        const m = this._ensureClipMeta(this._selClip);
        m.clipRole = this._knownClipRole(this.clipRoleSelect.value);
        if (m.clipRole !== "other") m.clipRoleCustom = "";
        this._meta.set(this._selClip.id, m);
        this._updatePromptPanel();
    }

    _onClipRoleCustomChange() {
        if (!this._selClip || this.clipRoleCustomInput?.disabled) return;
        this._recordUndo();
        const m = this._ensureClipMeta(this._selClip);
        m.clipRoleCustom = String(this.clipRoleCustomInput.value || "").trim();
        this.clipRoleCustomInput.value = m.clipRoleCustom;
        this._meta.set(this._selClip.id, m);
    }

    _onClipAgentChange() {
        if (!this._selClip || this.clipAgentSelect?.disabled) return;
        this._recordUndo();
        const m = this._ensureClipMeta(this._selClip);
        const value = String(this.clipAgentSelect.value || "");
        m.agent = value === "other" ? "other" : this._knownClipAgent(value);
        if (m.agent !== "other") m.agentCustom = "";
        this._meta.set(this._selClip.id, m);
        this._updatePromptPanel();
    }

    _onClipAgentCustomChange() {
        if (!this._selClip || this.clipAgentCustomInput?.disabled) return;
        this._recordUndo();
        const m = this._ensureClipMeta(this._selClip);
        m.agentCustom = String(this.clipAgentCustomInput.value || "").trim();
        this.clipAgentCustomInput.value = m.agentCustom;
        this._meta.set(this._selClip.id, m);
    }

    _onHeadExtendChange() {
        if (!this._selClip || this.headExtendInput?.disabled) return;
        this._recordUndo();
        const m = this._meta.get(this._selClip.id) ?? defaultImageMeta();
        m.headExtendSec = this._parseExtendSec(this.headExtendInput);
        this.headExtendInput.value = String(m.headExtendSec);
        this._meta.set(this._selClip.id, m);
    }

    _onTailExtendChange() {
        if (!this._selClip || this.tailExtendInput?.disabled) return;
        this._recordUndo();
        const m = this._meta.get(this._selClip.id) ?? defaultImageMeta();
        m.tailExtendSec = this._parseExtendSec(this.tailExtendInput);
        this.tailExtendInput.value = String(m.tailExtendSec);
        this._meta.set(this._selClip.id, m);
    }

    _onGenPreviewVideoChange() {
        if (!this._selClip || this.genPreviewVideoCb?.disabled) return;
        this._recordUndo();
        const m = this._meta.get(this._selClip.id) ?? defaultImageMeta();
        m.generatePreviewVideo = !!this.genPreviewVideoCb.checked;
        this._meta.set(this._selClip.id, m);
    }

    _onSecondSampleChange() {
        if (!this._selClip || this.secondSampleCb?.disabled) return;
        this._recordUndo();
        const m = this._meta.get(this._selClip.id) ?? defaultImageMeta();
        m.secondSample = !!this.secondSampleCb.checked;
        this._meta.set(this._selClip.id, m);
    }

    _clampH3MotionContextLength(frames) {
        return Math.max(0, Math.round(Number(frames) || 0));
    }

    _onH3MotionContextChange() {
        if (!this._selClip || this.h3MotionContextInput?.disabled) return;
        this._recordUndo();
        const m = this._meta.get(this._selClip.id) ?? defaultImageMeta();
        m.h3MotionContextLength = this._clampH3MotionContextLength(this.h3MotionContextInput.value);
        this.h3MotionContextInput.value = String(m.h3MotionContextLength);
        this._meta.set(this._selClip.id, m);
    }

    _onSaveLatentChange() {
        if (!this._selClip || this.saveLatentCb?.disabled) return;
        this._recordUndo();
        const m = this._meta.get(this._selClip.id) ?? defaultImageMeta();
        m.saveLatent = !!this.saveLatentCb.checked;
        this._meta.set(this._selClip.id, m);
    }

    _normalizeClipSeed(value) {
        const seed = Math.trunc(Number(value));
        if (!Number.isFinite(seed) || seed < -1) return -1;
        return Math.min(Number.MAX_SAFE_INTEGER, seed);
    }

    _randomClipSeed() {
        const values = new Uint32Array(2);
        crypto.getRandomValues(values);
        const seed = (BigInt(values[0]) << 32n) | BigInt(values[1]);
        return Number(seed % BigInt(Number.MAX_SAFE_INTEGER));
    }

    _onClipSeedChange() {
        if (!this._selClip || this.clipSeedInput?.disabled) return;
        this._recordUndo();
        const m = this._meta.get(this._selClip.id) ?? defaultImageMeta();
        m.seed = this._normalizeClipSeed(this.clipSeedInput.value);
        this.clipSeedInput.value = String(m.seed);
        this._meta.set(this._selClip.id, m);
        this._saveToWidgets();
    }

    _randomizeClipSeed() {
        if (!this._selClip || this.clipSeedRandomBtn?.disabled) return;
        this._recordUndo();
        const m = this._meta.get(this._selClip.id) ?? defaultImageMeta();
        m.seed = this._randomClipSeed();
        this._meta.set(this._selClip.id, m);
        if (this.clipSeedInput) this.clipSeedInput.value = String(m.seed);
        this._saveToWidgets();
    }

    /** Persist audio fade seconds from the Clip onto clip meta (ms). */
    _syncAudioFadeMeta(clip) {
        if (!clip || clip.track?.type !== "audio") return;
        clip._clampFades?.();
        const m = this._meta.get(clip.id) ?? defaultAudioMeta(this._trackIndex(clip.track));
        m.fadeInMs = Math.round((clip.fadeIn || 0) * 1000);
        m.fadeOutMs = Math.round((clip.fadeOut || 0) * 1000);
        this._meta.set(clip.id, m);
    }

    /** Build the complete, editable and lossless project document. */
    _buildProject() {
        const fps = this.getFps();
        const tracks = (this._timeline?.tracks ?? []).map((track, order) => {
            const ti = this._trackIndex(track);
            const isSubTrack = isSubtitleTrackType(track.type);
            const isVoiceoverTrack = isVoiceoverTrackType(track.type);
            const clips = track.clips.map(clip => {
                const m = this._meta.get(clip.id)
                    ?? (track.type === "audio"
                        ? defaultAudioMeta(ti)
                        : isVoiceoverTrack
                            ? defaultVoiceoverMeta(ti)
                            : isSubTrack
                                ? defaultSubtitleMeta(ti)
                                : defaultImageMeta(ti));
                if (track.type !== "audio" && !isVoiceoverTrack && !isSubTrack) {
                    this._normalizeVisualMeta(clip, m);
                }
                // Frame-grid ms so abutting clips share boundaries on reload.
                const { startMs, durationMs } = encodeClipTimingMs(clip.startTime, clip.duration, fps);
                if (isVoiceoverTrack) {
                    const voRow = {
                        id: clip.id,
                        type: "voiceover",
                        enabled: !m.disabled,
                        visible: m.visible !== false,
                        muted: !!m.muted,
                        start_ms: startMs,
                        duration_ms: durationMs,
                        name: clip.name || T("voiceover_clip_default_name"),
                        prompt: m.prompt ?? "",
                        style_prompt: m.stylePrompt ?? "",
                    };
                    const generated = this._clipGeneratedAudios(m)
                        .map((row) => serializeGeneratedAudio(row))
                        .filter(Boolean);
                    if (generated.length) voRow.generated_audios = generated;
                    if (Number.isFinite(Number(m.resourceStartSec)) && m.resourceStartSec >= 0) {
                        voRow.resource_start_sec = Number(m.resourceStartSec);
                    }
                    if (Number.isFinite(Number(m.resourceDurationSec)) && m.resourceDurationSec > 0) {
                        voRow.resource_duration_sec = Number(m.resourceDurationSec);
                    }
                    return voRow;
                }
                if (isSubTrack) {
                    const subRow = {
                        id: clip.id,
                        type: "subtitle",
                        enabled: !m.disabled,
                        visible: m.visible !== false,
                        start_ms: startMs,
                        duration_ms: durationMs,
                        text: m.text ?? "",
                    };
                    if (Number.isFinite(Number(m.resourceStartSec)) && m.resourceStartSec >= 0) {
                        subRow.resource_start_sec = Number(m.resourceStartSec);
                    }
                    if (Number.isFinite(Number(m.resourceDurationSec)) && m.resourceDurationSec > 0) {
                        subRow.resource_duration_sec = Number(m.resourceDurationSec);
                    }
                    return subRow;
                }
                const sourceInFrames = Math.max(0, Math.round((clip.sourceOffset || 0) * fps));
                const sourceInMs = Math.round((sourceInFrames * 1000) / fps);
                const items = track.type === "audio" ? [] : this._clipItems(m);
                const firstItem = items[0] || null;
                const firstKind = track.type === "audio"
                    ? "audio"
                    : (firstItem?.kind || "image");
                const audioMedia = track.type === "audio"
                    ? ((m.mediaId && this._findMediaById(m.mediaId)) || this._ensureMedia("audio", clip.src))
                    : null;
                const mediaIds = track.type === "audio"
                    ? (audioMedia?.id ? [audioMedia.id] : [])
                    : items.map((item) => item.id).filter(Boolean);
                const source = {};
                if (track.type === "audio" || firstKind === "video") {
                    source.in_ms = sourceInMs;
                    source.out_ms = sourceInMs + durationMs;
                    const fullSec = clip.sourceDuration ?? m.sourceDuration ?? clip.duration;
                    const fullFrames = Math.max(
                        sourceInFrames + Math.max(1, Math.round(clip.duration * fps)),
                        Number.isFinite(fullSec) ? Math.round(Math.max(0, fullSec) * fps) : 0,
                    );
                    source.duration_ms = Math.max(
                        source.out_ms,
                        Math.round((fullFrames * 1000) / fps),
                    );
                }
                const row = {
                    id: clip.id,
                    type: track.type === "audio" ? "audio" : isMediaTrackType(track.type) ? "media" : "clip",
                    enabled: !m.disabled,
                    visible: m.visible !== false,
                    start_ms: startMs,
                    duration_ms: durationMs,
                    media_ids: mediaIds,
                };
                if (Object.keys(source).length) row.source = source;
                if (track.type === "audio") {
                    row.muted = !!m.muted;
                    const fadeInMs = Math.max(0, Math.round((clip.fadeIn || 0) * 1000));
                    const fadeOutMs = Math.max(0, Math.round((clip.fadeOut || 0) * 1000));
                    if (fadeInMs > 0) row.fade_in_ms = fadeInMs;
                    if (fadeOutMs > 0) row.fade_out_ms = fadeOutMs;
                    m.fadeInMs = fadeInMs;
                    m.fadeOutMs = fadeOutMs;
                    if (Number.isFinite(Number(m.resourceStartSec)) && m.resourceStartSec >= 0) {
                        row.resource_start_sec = Number(m.resourceStartSec);
                    }
                    if (Number.isFinite(Number(m.resourceDurationSec)) && m.resourceDurationSec > 0) {
                        row.resource_duration_sec = Number(m.resourceDurationSec);
                    }
                } else {
                    row.name = clip.name || DEFAULT_CLIP_NAME;
                    row.prompt = m.prompt ?? "";
                    row.detailed_description = m.detailedDescription ?? "";
                    row.prompt_includes = normalizePromptIncludes(m.promptIncludes);
                    row.media_enabled = items.map((item) => item.enabled !== false);
                    row.head_extend_sec = Math.max(0, Math.round(Number(m.headExtendSec) || 0));
                    row.tail_extend_sec = Math.max(0, Math.round(Number(m.tailExtendSec) || 0));
                    row.generate_preview_video = !!m.generatePreviewVideo;
                    row.second_sample = !!m.secondSample;
                    row.h3_motion_context_length = this._clampH3MotionContextLength(m.h3MotionContextLength);
                    row.save_latent = !!m.saveLatent;
                    row.seed = this._normalizeClipSeed(m.seed);
                    row.clip_role = m.clipRole || "multi_ref";
                    row.clip_role_custom = m.clipRole === "other" ? (m.clipRoleCustom || "") : "";
                    row.agent = m.agent || "MiniMaxH3";
                    row.agent_custom = m.agent === "other" ? (m.agentCustom || "") : "";
                    const generated = this._clipGeneratedVideos(m);
                    if (generated.length) {
                        row.generated_videos = generated.map((v) => ({
                            id: v.id,
                            file: v.file,
                            enabled: v.enabled !== false,
                            muted: v.muted === true,
                            note: v.note || "",
                            ...(v.prompt ? { prompt: String(v.prompt) } : {}),
                            ...(Number.isFinite(Number(v.duration_sec)) && v.duration_sec > 0
                                ? { duration_sec: Number(v.duration_sec) }
                                : {}),
                            ...(Number(v.trim_in_sec) > 0 ? { trim_in_sec: Number(v.trim_in_sec) } : {}),
                            ...(v.trim_out_sec != null && Number.isFinite(Number(v.trim_out_sec))
                                ? { trim_out_sec: Number(v.trim_out_sec) }
                                : {}),
                            ...(Number(v.edit_start_sec) > 0
                                ? { edit_start_sec: Number(v.edit_start_sec) }
                                : {}),
                        }));
                    }
                    const genAudios = this._normalizeGenEditAudioDraft(m.genEditAudios);
                    if (genAudios.length) {
                        row.gen_edit_audios = genAudios.map((a) => ({
                            id: a.id,
                            file: a.file,
                            edit_start_sec: a.edit_start_sec,
                            duration: a.duration,
                            source_offset: a.source_offset,
                            ...(a.source_duration != null ? { source_duration: a.source_duration } : {}),
                            muted: a.muted === true,
                            ...(a.from_gen_id ? { from_gen_id: a.from_gen_id } : {}),
                        }));
                    }
                    if (Number.isFinite(Number(m.resourceDurationSec)) && m.resourceDurationSec > 0) {
                        row.resource_duration_sec = Number(m.resourceDurationSec);
                    }
                    if (Number.isFinite(Number(m.resourceStartSec)) && m.resourceStartSec >= 0) {
                        row.resource_start_sec = Number(m.resourceStartSec);
                    }
                    if (m.previewMode === "generated") row.preview_mode = "generated";
                    if (firstKind === "video") {
                        row.has_audio = !!clip.hasAudio;
                        row.muted = !!m.muted;
                    }
                }
                return row;
            });
            const trackInfo = this._trackInfo.get(track.id) || {};
            return {
                id: track.id,
                type: track.type === "audio"
                    ? "audio"
                    : isVoiceoverTrack
                        ? "voiceover"
                        : isSubTrack
                            ? "subtitle"
                            : isMediaTrackType(track.type)
                                ? "media"
                                : "director",
                role: track.isMain
                    ? "main"
                    : (trackInfo.role || (
                        track.type === "audio"
                            ? "audio"
                            : isVoiceoverTrack
                                ? "voiceover"
                                : isSubTrack
                                    ? "subtitle"
                                    : isMediaTrackType(track.type)
                                        ? "media"
                                        : "director"
                    )),
                name: track.name,
                order,
                enabled: trackInfo.enabled !== false,
                visible: track.visible !== false,
                muted: !!track.muted,
                locked: !!track.locked,
                color: track.color,
                ...(isSubTrack
                    ? {
                        subtitle_style: serializeSubtitleStyle(
                            trackInfo.subtitleStyle || this._meta.get(track.clips[0]?.id),
                        ),
                    }
                    : {}),
                clips,
            };
        });
        return {
            project_version: this._currentVersion(),
            schema_version: this._currentSchemaVersion(),
            name: String(this.projectNameInput?.value || T("untitled_project")).trim() || T("untitled_project"),
            media: this._serializeMediaCatalog(),
            settings: {
                fps: Number(this._w("fps")?.value ?? 24),
                width: Number(this._w("width")?.value ?? PY_SCALAR_DEFAULTS.width),
                height: Number(this._w("height")?.value ?? PY_SCALAR_DEFAULTS.height),
                ...Object.fromEntries(SETTING_PROMPT_KEYS.map((key) => [
                    key,
                    this._readSettingPrompt(key),
                ])),
                prompt_concat_order: this._getPromptConcatOrder(),
                timeline_zoom: Number(this._timeline?.getZoom() ?? 1.2),
                current_time: Number(this._timeline?.currentTime ?? 0) || 0,
                timeline_scroll_left: Number(this._timeline?.scrollEl?.scrollLeft ?? 0) || 0,
                timeline_scroll_top: Number(this._timeline?.scrollEl?.scrollTop ?? 0) || 0,
                watermark: this._watermark,
                use_clip_specified_video_filename: this._useClipSpecifiedVideoFilename !== false,
                ...(this._genVideoStamp
                    ? { gen_video_stamp: String(this._genVideoStamp) }
                    : {}),
                ...(Array.isArray(this._runtimeOnlyClipIds) && this._runtimeOnlyClipIds.length
                    ? { runtime_only_clip_ids: this._runtimeOnlyClipIds.map(String) }
                    : {}),
            },
            tracks,
        };
    }

    /** True when this editor's node still belongs to the live root graph. */
    _isNodeOnLiveGraph() {
        if (this._destroyed || !this.node?.graph) return false;
        const live = app.rootGraph ?? app.graph;
        if (!live) return false;
        return CapTimelineEditorApp._graphRoot(this.node.graph)
            === CapTimelineEditorApp._graphRoot(live);
    }

    _saveToWidgets() {
        if (this._destroyed) return;
        if (!this._isNodeOnLiveGraph()) return;
        if (!this._timeline || !this._timelineReady) return;
        this._writeProjectJson(JSON.stringify(this._buildProject()));
        try { this._persistViewToLocalCache(); } catch { /* ignore */ }
        try { this._persistPanelLayout(); } catch { /* ignore */ }
    }

    /** Write project_json to the widget and keep workflow restore mirrors in sync. */
    _writeProjectJson(json) {
        if (this._destroyed) return;
        const node = this.node;
        // Detached / other-tab nodes must not receive writes (dual Timeline Editor
        // workflows share one rootGraph object across tab switches).
        if (!this._isNodeOnLiveGraph()) return;

        const projectW = this._w("project_json");
        if (projectW) projectW.value = json;

        if (Array.isArray(node.widgets)) {
            const values = [];
            for (const w of node.widgets) {
                if (w.serialize === false) continue;
                values.push(w.name === "project_json" ? json : w.value);
            }
            node.widgets_values = values;

            if (!node.properties) node.properties = {};
            const named = { ...(node.properties.cat_named || {}) };
            for (const w of node.widgets) {
                if (!w?.name || w.serialize === false) continue;
                named[w.name] = w.name === "project_json" ? json : w.value;
            }
            node.properties.cat_named = named;
        }

        node.setDirtyCanvas?.(true, true);
    }

    /**
     * Persist generated-video links into project_json even when the fullscreen
     * timeline is closed / not ready (auto-associate after queue must survive
     * close → reopen).
     */
    _persistGeneratedVideosToProjectJson(clipId, files) {
        if (this._destroyed) return false;
        const normalized = [];
        const seen = new Set();
        for (const file of files || []) {
            const n = normalizeOutputVideoPath(file);
            if (!n || seen.has(n)) continue;
            seen.add(n);
            normalized.push(n);
        }
        if (!normalized.length) return false;

        const parsed = this._parseProjectWidgetValue();
        const project = parsed.project && typeof parsed.project === "object"
            ? parsed.project
            : null;
        if (!project || !Array.isArray(project.tracks)) return false;

        let target = null;
        if (clipId) {
            for (const track of project.tracks) {
                for (const clip of track.clips || []) {
                    if (clip && String(clip.id) === String(clipId)) {
                        target = clip;
                        break;
                    }
                }
                if (target) break;
            }
        }
        if (!target) {
            const enabled = [];
            for (const track of project.tracks) {
                if (String(track?.type || "").toLowerCase() === "audio") continue;
                if (track?.enabled === false) continue;
                for (const clip of track.clips || []) {
                    if (!clip || clip.enabled === false) continue;
                    if (String(clip.type || "").toLowerCase() === "audio") continue;
                    enabled.push(clip);
                }
            }
            if (enabled.length === 1) target = enabled[0];
        }
        if (!target) return false;

        const existing = Array.isArray(target.generated_videos)
            ? target.generated_videos.map(normalizeGeneratedVideo).filter(Boolean)
            : [];
        const have = new Set(existing.map((row) => row.file));
        const added = [];
        for (const file of normalized) {
            if (have.has(file)) continue;
            have.add(file);
            added.push({ id: genVideoUid(), file, enabled: true, muted: false, note: "" });
        }
        if (!added.length) return false;

        target.generated_videos = [...added, ...existing].map((v) => ({
            id: v.id,
            file: v.file,
            enabled: v.enabled !== false,
            muted: v.muted === true,
            note: v.note || "",
        }));
        this._writeProjectJson(JSON.stringify(project));
        return true;
    }

    // ─── Undo / redo ─────────────────────────────────────────────────────

    _captureSnapshot() {
        return {
            project: this._buildProject(),
            currentTime: this._timeline?.currentTime ?? 0,
        };
    }

    /** Reflect stack state on the toolbar's 还原/重做 buttons. */
    _updateHistoryButtons() {
        if (this.undoBtn) this.undoBtn.disabled = this._undoStack.length === 0;
        if (this.redoBtn) this.redoBtn.disabled = this._redoStack.length === 0;
    }

    /** Call right before a discrete, user-initiated mutation (add/remove/
     * toggle/etc.) so it becomes exactly one undo step. */
    _recordUndo() {
        if (!this._historyReady || this._restoringHistory || !this._timeline) return;
        this._undoStack.push(this._captureSnapshot());
        if (this._undoStack.length > 100) this._undoStack.shift();
        this._redoStack = [];
        this._updateHistoryButtons();
    }

    /** Drag gestures (move/trim) span many frames — stash the pre-drag
     * snapshot at the start and only commit it once, at the end, and only
     * if the gesture actually changed something. */
    _beginPendingUndo() {
        if (!this._historyReady || this._restoringHistory || !this._timeline) return;
        this._pendingUndoSnapshot = this._captureSnapshot();
    }

    _commitPendingUndo(moved) {
        const snapshot = this._pendingUndoSnapshot;
        this._pendingUndoSnapshot = null;
        if (!snapshot || !moved || !this._historyReady || this._restoringHistory) return;
        this._undoStack.push(snapshot);
        if (this._undoStack.length > 100) this._undoStack.shift();
        this._redoStack = [];
        this._updateHistoryButtons();
    }

    async _restoreSnapshot(snapshot) {
        if (!snapshot || !this._timeline) return;
        this._restoringHistory = true;
        try {
            this._timeline.selectClip(null);
            this._selClip = null;
            this._selClips = [];
            this._meta.clear();
            this._trackInfo.clear();
            this._mainTrack = null;
            this._overlayTrack = null;
            this._audioTrack = null;

            const project = this._migrateProjectDocument(snapshot.project || {});
            this._applyMediaCatalogFromProject(project);
            this.projectNameInput.value = String(project.name || T("untitled_project")).trim() || T("untitled_project");
            this._syncBrandProjectName();
            const snapSettings = project.settings ?? {};
            let wroteAnySettingPrompt = false;
            this._settingPromptSyncing = true;
            try {
                for (const key of SETTING_PROMPT_KEYS) {
                    const input = this._settingPromptInputs?.[key];
                    if (!input) continue;
                    if (snapSettings[key] != null) {
                        setRichPromptValue(input, String(snapSettings[key]), true);
                        wroteAnySettingPrompt = true;
                    }
                }
            } finally {
                this._settingPromptSyncing = false;
            }
            if (wroteAnySettingPrompt) this._syncScalarsToProjectJson();
            else this._syncSettingPromptInputs();
            this._syncProjectScalarDisplay();
            const projectTracks = Array.isArray(project.tracks) ? project.tracks : [];
            const tracks = projectTracks.map((track, order) => {
                const rawType = String(track.type || "visual").toLowerCase();
                const type = rawType === "audio"
                    ? "audio"
                    : rawType === "voiceover"
                        ? "voiceover"
                    : (rawType === "subtitle" || rawType === "text")
                        ? "text"
                        : (rawType === "media" || rawType === "video")
                            ? "video"
                            : "image";
                return {
                    ...track,
                    type,
                    trackIndex: order,
                    isMain: track.role === "main",
                };
            });
            this._timeline.clearTracks();
            if (tracks.length) {
                this._loadTracksFromJson(tracks);
            } else {
                this._createDefaultTracks();
            }
            const clips = this._clipsFromProjectTracks(project, this.getFps());
            await Promise.all(clips.map(c => this._addClipFromJson(c)));
            this._applyTrackTypeOrder();

            this._decorateAllClips();
            this._refreshTimelineDuration();
            this._applyTimelineZoomFromSettings(snapSettings, { autoFitIfMissing: false });
            this._applyTimelineViewFromSettings(
                { ...snapSettings, current_time: snapshot.currentTime || 0 },
                { applyZoom: false },
            );
            this._updatePromptPanel();
            this._renderMediaGrid();
        } finally {
            this._restoringHistory = false;
        }
    }

    async undo() {
        if (!this._undoStack.length || this._restoringHistory) return;
        const current = this._captureSnapshot();
        const prev = this._undoStack.pop();
        this._redoStack.push(current);
        await this._restoreSnapshot(prev);
        this._updateHistoryButtons();
    }

    async redo() {
        if (!this._redoStack.length || this._restoringHistory) return;
        const current = this._captureSnapshot();
        const next = this._redoStack.pop();
        this._undoStack.push(current);
        await this._restoreSnapshot(next);
        this._updateHistoryButtons();
    }
}
