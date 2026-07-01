import { app } from "../../scripts/app.js";
import { CapAudioTimelineUI } from "./CapAudioTimelineUI.js";
import { CapTimelineEditorApp } from "./CapTimelineEditorApp.js";

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
    if (e.repeat) return;
    if (e.target?.classList?.contains("cat-prompt-input")) return;
    // Let prompt textarea handle its own typing
    if (isTypingTarget(e.target) && e.target.closest?.(".cat-prompt-input")) return;
    if (isTypingTarget(e.target)) return;

    const node = getActiveCatNode();
    const nodeUi = node?._catUI;

    // Ctrl+B / Ctrl+G conflict with ComfyUI's built-in Bypass / Group keybindings.
    // Delete removes the selected clip — use _lastActive as fallback so shortcuts work
    // even when the LiteGraph node isn't selected in the canvas (users often interact
    // with the widget without first clicking the node header).
    // Ctrl+B / Ctrl+G — skip when fullscreen timeline editor is open (it handles its own shortcuts)
    if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === "b" || e.key === "g")) {
        if (CapTimelineEditorApp._open?._overlay?.classList.contains("open")) return;
        const ui = nodeUi ?? CapAudioTimelineUI._lastActive;
        if (ui) ui._onKeyDown(e, true);
        return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && !isTypingTarget(e.target)) {
        const ui = nodeUi ?? CapAudioTimelineUI._lastActive;
        if (ui?.selClipId) {
            ui._onKeyDown(e, true);
            return;
        }
    }

    // For all other shortcuts (including Ctrl+C / Ctrl+V), require the LiteGraph node
    // to be selected. Using _lastActive here would cause _copyClip / _pasteClip to fire
    // unintentionally when the user copies or pastes ComfyUI nodes.
    if (!nodeUi) return;
    if (e.defaultPrevented) return;
    nodeUi._onKeyDown(e, true);
}

const MIN_NODE_WIDTH = 480;
const MIN_NODE_HEIGHT = 480;

function clampAbsMin(size) {
    return [
        Math.max(size[0], MIN_NODE_WIDTH),
        Math.max(size[1], MIN_NODE_HEIGHT),
    ];
}

/** DOM widgets use (widget.width ?? node.width); never keep a stale widget.width. */
function clearCatUiWidgetWidth(node) {
    const w = node._catUI?.domWidget;
    if (w && w.width != null) delete w.width;
}

function markNoSerialize(node) {
    for (const w of node.widgets ?? []) {
        if (w.name === "audioUI" || w.name === "cat_ui") {
            w.serialize = false;
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

        // Block automatic layout from narrowing the node; user drag-resize is allowed.
        nodeType.prototype.setSize = function (size) {
            const isUserResize = app.canvas?.resizing_node === this;
            if (!isUserResize) {
                const curW = this.size?.[0] ?? 0;
                if (curW > 0 && size[0] < curW) {
                    size = [curW, size[1]];
                }
            }
            this.size = clampAbsMin(size);
            this.onResize?.(this.size);
        };

        const computeSize = nodeType.prototype.computeSize;
        nodeType.prototype.computeSize = function (out) {
            const size = computeSize?.apply(this, arguments) ?? (out ? [...out] : [0, 0]);
            return clampAbsMin(size);
        };

        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            this._catUI?.destroy();
            this._catUI = null;
            return onRemoved?.apply(this, arguments);
        };

        // configure() assigns this.size directly — enforce absolute minimum only.
        const configure = nodeType.prototype.configure;
        nodeType.prototype.configure = function (info) {
            configure?.apply(this, arguments);
            if (this.size[0] < MIN_NODE_WIDTH || this.size[1] < MIN_NODE_HEIGHT) {
                this.setSize(clampAbsMin(this.size));
            }
            clearCatUiWidgetWidth(this);
            this._catUI?._onDomWidthChanged?.();
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            onConfigure?.apply(this, arguments);
            markNoSerialize(this);
            this._catUI?._syncFromConfigure(info);
        };

        const onSelected = nodeType.prototype.onSelected;
        nodeType.prototype.onSelected = function () {
            onSelected?.apply(this, arguments);
            clearCatUiWidgetWidth(this);
            this._catUI?._onDomWidthChanged?.();
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
