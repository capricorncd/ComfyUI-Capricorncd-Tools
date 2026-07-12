import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { CapTimelineEditorApp } from "./CapTimelineEditorApp.js";

const NODE_CLASS = "CAP_TimelineEditor";
const SCALAR_WIDGETS = ["fps", "width", "height", "global_prompt", "ignore_occluded"];

function flushOpenTimelineEditors() {
    for (const node of app.graph?._nodes ?? []) {
        if (node.comfyClass === NODE_CLASS && node._teApp?._timeline) {
            node._teApp._saveToWidgets();
        }
    }
}

function hookQueuePrompt() {
    const wrap = (target, key) => {
        if (!target || typeof target[key] !== "function" || target[key]._capTeHooked) return;
        const orig = target[key];
        target[key] = function (...args) {
            flushOpenTimelineEditors();
            return orig.apply(this, args);
        };
        target[key]._capTeHooked = true;
    };
    wrap(app, "queuePrompt");
    wrap(api, "queuePrompt");
}

function hookScalarWidgets(node) {
    for (const name of SCALAR_WIDGETS) {
        const w = node.widgets?.find(widget => widget.name === name);
        if (!w || w._capScalarHooked) continue;
        w._capScalarHooked = true;
        const orig = w.callback;
        w.callback = function (...args) {
            const ret = orig?.apply(this, args);
            node._teApp?._syncScalarsToProjectJson?.();
            return ret;
        };
    }
}

function onTeGlobalKeyDown(e) {
    const te = CapTimelineEditorApp._open;
    if (!te) return;
    if (te.handleMediaPreviewKey(e)) return;
    if (te.handleDeleteKey(e)) return;
    te.handleShortcutKey(e);
}

function markNoSerialize(node) {
    for (const w of node.widgets ?? []) {
        if (w.name === "te_launcher") {
            w.serialize = false;
            continue;
        }
        if (w.name === "audioUI" || w.name === "audio") {
            w.serialize = false;
            if (w.element) w.element.style.display = "none";
            w.computeSize = () => [0, -4];
        }
        if (w.name === "project_json" || w.name === "project_version") {
            if (w.name === "project_version") w.serialize = false;
            if (w.element) w.element.style.display = "none";
            w.computeSize = () => [0, -4];
        }
    }
}

app.registerExtension({
    name: "Capricorncd.TimelineEditor",

    async setup() {
        // Capture on `window`, not `document`: capture-phase listeners fire
        // in ancestor order (window before document before canvas/body),
        // so this runs before ComfyUI's own Ctrl+Z (graph undo) handler no
        // matter which DOM node or registration order that uses — otherwise
        // its undo can fire first and e.g. close the director's console.
        window.addEventListener("keydown", onTeGlobalKeyDown, true);
        hookQueuePrompt();
    },

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_CLASS) return;

        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            this._teApp?.destroy();
            this._teApp = null;
            return onRemoved?.apply(this, arguments);
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            onConfigure?.apply(this, arguments);
            markNoSerialize(this);
            const named = info?.properties?.cat_named;
            if (named) {
                for (const [k, v] of Object.entries(named)) {
                    const w = this.widgets?.find(w => w.name === k);
                    if (w) w.value = v;
                }
            }
            hookScalarWidgets(this);
            this._teApp?._syncScalarsToProjectJson?.();
        };

        const onSerialize = nodeType.prototype.onSerialize;
        nodeType.prototype.onSerialize = function (info) {
            onSerialize?.apply(this, arguments);
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
        node.setSize([1280, 720]);
        if (!node._teApp) {
            node._teApp = new CapTimelineEditorApp(node);
        }
        hookScalarWidgets(node);
        node._teApp._syncScalarsToProjectJson();
    },
});

console.log("[CAP_TimelineEditor] extension loaded");
