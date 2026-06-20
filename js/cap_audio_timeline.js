import { app } from "../../scripts/app.js";
import { CapAudioTimelineUI } from "./CapAudioTimelineUI.js";

const NODE_CLASS = "CAP_AudioTimeline";

function isTypingTarget(el) {
    if (!el || !(el instanceof Element)) return false;
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    return !!el.closest?.("[contenteditable='true']");
}

function getActiveCatNode() {
    const sel = app.canvas?.selected_nodes;
    if (!sel) return null;
    const nodes = Object.values(sel);
    if (nodes.length !== 1) return null;
    const node = nodes[0];
    return node.comfyClass === NODE_CLASS ? node : null;
}

function onGlobalKeyDown(e) {
    if (e.defaultPrevented || e.repeat) return;
    // Let prompt textarea handle its own typing
    if (isTypingTarget(e.target) && e.target.closest?.(".cat-prompt-input")) return;
    if (isTypingTarget(e.target)) return;

    const node = getActiveCatNode();
    const ui = node?._catUI;
    if (!ui) return;
    ui._onKeyDown(e);
}

function markNoSerialize(node) {
    for (const w of node.widgets ?? []) {
        if (w.name === "audioUI" || w.name === "cat_ui") {
            w.serialize = false;
        }
        // Canvas widgets — hide by type so LiteGraph skips draw + height
        if (w.name === "start_time" || w.name === "end_time") {
            w.type = "hidden";
        }
        // DOM widgets (textarea) — hide element + zero out size
        if (w.name === "clips_json") {
            if (w.element) w.element.style.display = "none";
            w.computeSize = () => [0, -4];
        }
    }
}

app.registerExtension({
    name: "Capricorncd.AudioTimeline",

    async setup() {
        document.addEventListener("keydown", onGlobalKeyDown, true);
    },

    commands: [
        {
            id: "Capricorncd.AudioTimeline.tlLeft",
            label: "音频时间轴：播放头左移1帧",
            function: () => { getActiveCatNode()?._catUI?._onKeyDown({ key: "ArrowLeft", preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} }); },
        },
        {
            id: "Capricorncd.AudioTimeline.tlRight",
            label: "音频时间轴：播放头右移1帧",
            function: () => { getActiveCatNode()?._catUI?._onKeyDown({ key: "ArrowRight", preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} }); },
        },
    ],

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_CLASS) return;

        const computeSize = nodeType.prototype.computeSize;
        nodeType.prototype.computeSize = function (out) {
            const size = computeSize?.apply(this, arguments) ?? out ?? [0, 0];
            size[1] = Math.max(size[1], 440);
            return size;
        };

        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            this._catUI?.destroy();
            this._catUI = null;
            return onRemoved?.apply(this, arguments);
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            onConfigure?.apply(this, arguments);
            markNoSerialize(this);
            this._catUI?._syncFromConfigure(info);
        };

        const onSerialize = nodeType.prototype.onSerialize;
        nodeType.prototype.onSerialize = function (info) {
            onSerialize?.apply(this, arguments);
            // Save a named copy so restore survives serialize:false widgets
            if (!info.properties) info.properties = {};
            const named = {};
            for (const w of this.widgets ?? []) {
                if (w?.name && w.serialize !== false) named[w.name] = w.value;
            }
            info.properties.cat_named = named;
        };
    },

    async nodeCreated(node) {
        if (node.comfyClass !== NODE_CLASS) return;
        markNoSerialize(node);
        if (!node._catUI) {
            node._catUI = new CapAudioTimelineUI(node);
        }
    },
});

console.log("[CAP_AudioTimeline] extension loaded");
