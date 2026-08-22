import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { CapTimelineEditorApp } from "./CapTimelineEditorApp.js";

const NODE_CLASS = "CAP_TimelineEditor";
const SCALAR_WIDGETS = ["fps", "width", "height", "global_prompt"];
const OBSOLETE_WIDGETS = ["ignore_occluded", "assets_dir"];
function flushOpenTimelineEditors() {
    CapTimelineEditorApp.flushOpenEditors();
    for (const node of app.graph?._nodes ?? []) {
        if (node.comfyClass === NODE_CLASS && node._teApp?._timeline) {
            try { node._teApp._saveToWidgets(); } catch { /* ignore */ }
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

/** Flush open editors into widgets before ComfyUI serializes the graph
 * (workflow tab switch persists the draft via serialize). */
function hookGraphSerialize() {
    const proto = app.graph?.constructor?.prototype;
    if (!proto || typeof proto.serialize !== "function" || proto.serialize._capTeHooked) return;
    const orig = proto.serialize;
    proto.serialize = function (...args) {
        CapTimelineEditorApp.flushOpenEditors();
        return orig.apply(this, args);
    };
    proto.serialize._capTeHooked = true;
}

/** Close fullscreen UI before nodes are torn down on graph.clear(). */
function hookGraphClear() {
    const proto = app.graph?.constructor?.prototype;
    if (!proto || typeof proto.clear !== "function" || proto.clear._capTeHooked) return;
    const orig = proto.clear;
    proto.clear = function (...args) {
        CapTimelineEditorApp.flushOpenEditors();
        CapTimelineEditorApp.forceCloseAll();
        return orig.apply(this, args);
    };
    proto.clear._capTeHooked = true;
}

function swapWhWidgets(node) {
    const widthW = node.widgets?.find(w => w.name === "width");
    const heightW = node.widgets?.find(w => w.name === "height");
    if (!widthW || !heightW) return;
    const prevW = widthW.value;
    widthW.value = heightW.value;
    heightW.value = prevW;
    node._teApp?._syncScalarsToProjectJson?.();
    node._teApp?._scheduleProgramPreview?.();
    node.setDirtyCanvas?.(true, true);
}

function hookSwapWhWidget(node) {
    const w = node.widgets?.find(widget => widget.name === "swap_wh");
    if (!w || w._capSwapWhHooked) return;
    w._capSwapWhHooked = true;
    const orig = w.callback;
    w.callback = function (...args) {
        const ret = orig?.apply(this, args);
        // Toggle only: exchange current width/height (do not force presets).
        swapWhWidgets(node);
        return ret;
    };
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
            if (name === "global_prompt") node._teApp?._onNodeGlobalPromptInput?.();
            return ret;
        };
        if (name === "global_prompt") node._teApp?._bindGlobalPromptWidget?.();
    }
    hookSwapWhWidget(node);
}

function onTeGlobalKeyDown(e) {
    const te = CapTimelineEditorApp._open;
    if (!te) return;
    if (te.handleMediaPreviewKey(e)) return;
    if (te.handleDeleteKey(e)) return;
    te.handleShortcutKey(e);
}

function removeObsoleteWidgets(node) {
    if (!node.widgets?.length) return;
    for (let i = node.widgets.length - 1; i >= 0; i--) {
        if (OBSOLETE_WIDGETS.includes(node.widgets[i]?.name)) {
            node.widgets.splice(i, 1);
        }
    }
}

function markNoSerialize(node) {
    removeObsoleteWidgets(node);
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

function ensureTimelineApp(node) {
    if (node._teApp && !node._teApp._destroyed) {
        if (!node.widgets?.some(w => w.name === "te_launcher")) {
            node._teApp._buildLauncher();
        }
        return node._teApp;
    }
    // Node survived a forced teardown (rare) — drop stale launcher widgets
    // before constructing a fresh app that would add another.
    if (node.widgets) {
        for (let i = node.widgets.length - 1; i >= 0; i--) {
            if (node.widgets[i]?.name === "te_launcher") node.widgets.splice(i, 1);
        }
    }
    node._teApp = new CapTimelineEditorApp(node);
    return node._teApp;
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
        const bindGraphHooks = () => {
            hookGraphSerialize();
            hookGraphClear();
        };
        bindGraphHooks();

        // Subgraph open/close swaps the live canvas graph without always
        // removing parent nodes — only close the fullscreen shell here.
        const bindSetGraph = () => {
            const canvasEl = app.canvas?.canvas;
            if (!canvasEl || canvasEl._capTeSetGraphHooked) return;
            canvasEl._capTeSetGraphHooked = true;
            canvasEl.addEventListener("litegraph:set-graph", () => {
                CapTimelineEditorApp.closeOpenEditor();
            });
        };
        bindSetGraph();
        // canvas / graph may be created slightly after setup on some builds
        setTimeout(() => {
            bindGraphHooks();
            bindSetGraph();
        }, 0);
    },

    async beforeConfigureGraph() {
        CapTimelineEditorApp.forceCloseAll();
    },

    async afterConfigureGraph() {
        CapTimelineEditorApp.scrubGlobalUi();
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
        node.setSize([360, 280]);
        const te = ensureTimelineApp(node);
        hookScalarWidgets(node);
        te._syncScalarsToProjectJson();
    },
});

console.log("[CAP_TimelineEditor] extension loaded");
