import { app } from "../../scripts/app.js";
import { AudioKeyframeTimelineUI } from "./AudioKeyframeTimelineUI.js";

const NODE_CLASS = "AudioKeyframeTimeline";

function isTypingTarget(target) {
    if (!target || !(target instanceof Element)) return false;
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    return !!target.closest?.("[contenteditable='true']");
}

/** ComfyUI uses canvas.selected_nodes; node.selected is not reliable on LiteGraph. */
function getSelectedAktlNode() {
    const sel = app.canvas?.selected_nodes;
    if (!sel) return null;
    const nodes = Object.values(sel);
    if (nodes.length !== 1) return null;
    const node = nodes[0];
    if (node.comfyClass !== NODE_CLASS) return null;
    return node;
}

function onAktlGlobalKeyDown(e) {
    if (e.defaultPrevented || e.repeat) return;
    if (isTypingTarget(e.target)) return;

    const node = getSelectedAktlNode();
    const ui = node?._audioKeyframeTimelineUI;
    if (!ui) return;

    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const delta = e.key === "ArrowLeft" ? -1 : 1;
        if (ui.handleArrowKey(delta)) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
        }
        return;
    }

    if (e.key === "Delete" || e.key === "Backspace") {
        if (ui.handleDeleteKey()) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
        }
    }
}

function bindAktlGlobalKeyCapture() {
    if (window.__aktlGlobalKeyCaptureBound) return;
    window.__aktlGlobalKeyCaptureBound = true;
    document.addEventListener("keydown", onAktlGlobalKeyDown, true);
}

const INT_WIDGET_DEFAULTS = {
    fps: 24,
    width: 720,
    height: 1280,
};

/** Logical save order (serializable widgets only, matches Python INPUT_TYPES). */
const WIDGET_NAMES_ORDER = [
    "audio",
    "start_time",
    "end_time",
    "fps",
    "width",
    "height",
    "keyframe_dir",
    "one_shot",
    "keyframes_ms",
];

const TIMECODE_RE = /^\d{1,2}:\d{2}(\.\d+)?$/;

function looksLikeTimecode(v) {
    return typeof v === "string" && TIMECODE_RE.test(v.trim());
}

function markNonSerializingWidgets(node) {
    for (const w of node.widgets ?? []) {
        if (w.name === "audioUI" || w.name === "upload" || w.name === "timeline_ui") {
            w.serialize = false;
        }
    }
}

/**
 * LiteGraph saves widgets_values[widgetIndex] but loads with a sequential counter,
 * skipping serialize:false widgets. That misaligns every field after audioUI.
 */
function restoreWidgetsValuesByIndex(node, values) {
    if (!values?.length || !node.widgets?.length) return;

    for (const [i, widget] of node.widgets.entries()) {
        if (widget.serialize === false) continue;
        if (i >= values.length) break;
        const v = values[i];
        if (v !== undefined && v !== null) {
            widget.value = v;
        }
    }
}

/** Old workflows saved as a compact list without holes for audioUI/upload. */
function restoreWidgetsValuesCompact(node, values) {
    if (!values?.length) return false;

    let vi = 0;
    for (const name of WIDGET_NAMES_ORDER) {
        const w = node.widgets?.find((widget) => widget.name === name);
        if (!w || w.serialize === false) continue;
        if (vi >= values.length) break;
        w.value = values[vi++];
    }
    return true;
}

function restoreNamedFromProperties(node, named) {
    if (!named || typeof named !== "object") return;
    for (const [name, val] of Object.entries(named)) {
        const w = node.widgets?.find((widget) => widget.name === name);
        if (w && val !== undefined && val !== null) {
            w.value = val;
        }
    }
}

function needsCompactFallback(node) {
    const fpsW = node.widgets?.find((w) => w.name === "fps");
    const dirW = node.widgets?.find((w) => w.name === "keyframe_dir");
    if (!fpsW || !dirW) return false;

    const fps = Number(fpsW.value);
    const fpsBad = !Number.isFinite(fps) || fps <= 0;
    const dirLooksLikeStart = looksLikeTimecode(String(dirW.value ?? ""));
    return fpsBad || dirLooksLikeStart;
}

function applyIntWidgetDefaults(node) {
    for (const [name, defaultVal] of Object.entries(INT_WIDGET_DEFAULTS)) {
        const w = node.widgets?.find((widget) => widget.name === name);
        if (!w || w.type !== "number") continue;
        const n = Number(w.value);
        if (!Number.isFinite(n) || n <= 0) {
            w.value = defaultVal;
        }
    }
}

function restoreWidgetValues(node, info) {
    const values = info?.widgets_values;
    const named = info?.properties?.aktl_named;

    markNonSerializingWidgets(node);

    if (values?.length) {
        restoreWidgetsValuesByIndex(node, values);
    }

    if (needsCompactFallback(node) && values?.length) {
        restoreWidgetsValuesCompact(node, values);
    }

    if (named) {
        restoreNamedFromProperties(node, named);
    }

    applyIntWidgetDefaults(node);
}

function shieldAudioUIFromBlob(node) {
    const audioUI = node.widgets?.find((w) => w.name === "audioUI");
    if (!audioUI?.element) return;

    audioUI.serialize = false;
    audioUI.computeSize = () => [0, -4];

    const clearBlobSrc = () => {
        const el = audioUI.element;
        if (el?.src?.startsWith("blob:")) {
            el.removeAttribute("src");
        }
    };

    clearBlobSrc();

    const audioW = node.widgets?.find((w) => w.name === "audio");
    if (audioW && !audioW._aktlBlobShielded) {
        audioW._aktlBlobShielded = true;
        const orig = audioW.callback;
        audioW.callback = (v) => {
            orig?.(v);
            clearBlobSrc();
        };
    }
}

app.registerExtension({
    name: "ComfyUI.AudioKeyframeTimeline",

    async setup() {
        bindAktlGlobalKeyCapture();
    },

    commands: [
        {
            id: "ComfyUI.AudioKeyframeTimeline.nudgeFrameLeft",
            label: "音频关键帧：上一帧",
            function: () => {
                const ui = getSelectedAktlNode()?._audioKeyframeTimelineUI;
                ui?.handleArrowKey(-1);
            },
        },
        {
            id: "ComfyUI.AudioKeyframeTimeline.nudgeFrameRight",
            label: "音频关键帧：下一帧",
            function: () => {
                const ui = getSelectedAktlNode()?._audioKeyframeTimelineUI;
                ui?.handleArrowKey(1);
            },
        },
    ],

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_CLASS) return;

        let req = nodeData.input?.required;
        if (req) {
            // Comfy AUDIOUPLOAD expects audioUI widget (see uploadAudio.ts).
            if (!req.audioUI) {
                const next = {};
                for (const [key, val] of Object.entries(req)) {
                    next[key] = val;
                    if (key === "audio") {
                        next.audioUI = ["AUDIO_UI", {}];
                    }
                }
                nodeData.input.required = next;
                req = next;
            }

            for (const [name, def] of Object.entries(INT_WIDGET_DEFAULTS)) {
                if (req[name]?.[1]) {
                    req[name][1].default = def;
                }
            }
        }

        const computeSize = nodeType.prototype.computeSize;
        nodeType.prototype.computeSize = function (out) {
            const size = computeSize?.apply(this, arguments) ?? out;
            size[1] = Math.max(size[1], 300);
            return size;
        };

        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            this._audioKeyframeTimelineUI?.destroy();
            this._audioKeyframeTimelineUI = null;
            return onRemoved?.apply(this, arguments);
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            onConfigure?.apply(this, arguments);
            markNonSerializingWidgets(this);
            shieldAudioUIFromBlob(this);
            restoreWidgetValues(this, info);
            this._audioKeyframeTimelineUI?._syncTimeInputsFromWidgets?.();
            this._audioKeyframeTimelineUI?._scheduleKeyframeDirRefresh?.();
        };

        const onSerialize = nodeType.prototype.onSerialize;
        nodeType.prototype.onSerialize = function (info) {
            onSerialize?.apply(this, arguments);
            if (!info.properties) info.properties = {};
            const named = {};
            for (const w of this.widgets ?? []) {
                if (!w?.name || w.serialize === false) continue;
                named[w.name] = w.value;
            }
            info.properties.aktl_named = named;
        };
    },

    async nodeCreated(node) {
        if (node.comfyClass !== NODE_CLASS) return;

        markNonSerializingWidgets(node);
        shieldAudioUIFromBlob(node);

        if (!node._audioKeyframeTimelineUI) {
            node._audioKeyframeTimelineUI = new AudioKeyframeTimelineUI(node);
        }

        applyIntWidgetDefaults(node);
    },
});

console.log("[AudioKeyframeTimeline] extension loaded");
