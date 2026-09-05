import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { CapTimelineEditorApp } from "./CapTimelineEditorApp.js";

const NODE_CLASS = "CAP_TimelineEditor";
const SCALAR_WIDGETS = ["fps", "width", "height"];
const OBSOLETE_WIDGETS = ["ignore_occluded", "assets_dir", "global_prompt"];
function flushOpenTimelineEditors() {
    const graph = app.rootGraph ?? app.graph;
    CapTimelineEditorApp.flushOpenEditors(graph);
    for (const node of graph?._nodes ?? []) {
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
        CapTimelineEditorApp.flushOpenEditors(this);
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
        CapTimelineEditorApp.flushOpenEditors(this);
        CapTimelineEditorApp.forceCloseAll();
        return orig.apply(this, args);
    };
    proto.clear._capTeHooked = true;
}

/**
 * Flush timeline widgets BEFORE loadGraphData's beforeLoadNewGraph capture,
 * so the leaving tab's draft includes the latest project_json.
 * When returning to a tab, prefer the frozen snapshot taken on deactivate so a
 * corrupted in-memory activeState cannot wipe nodes / AI prompts.
 */
function hookLoadGraphData() {
    if (typeof app.loadGraphData !== "function" || app.loadGraphData._capTeHooked) return;
    const orig = app.loadGraphData;
    app.loadGraphData = async function (graphData, ...rest) {
        try {
            CapTimelineEditorApp.flushOpenEditors(app.rootGraph ?? app.graph);
        } catch { /* ignore */ }

        // loadGraphData(data, clean?, restore?, workflow?, options?)
        const workflow = rest.length >= 3 ? rest[2] : null;
        const frozen = workflow?._capTeFrozenActiveState
            ?? workflow?.changeTracker?._capTeFrozenActiveState
            ?? null;
        const data = frozen || graphData;
        if (frozen && workflow?.changeTracker) {
            try { workflow.changeTracker.activeState = frozen; } catch { /* ignore */ }
        }
        return orig.call(this, data, ...rest);
    };
    app.loadGraphData._capTeHooked = true;
}

function _capTeCloneGraphState(state) {
    if (!state) return null;
    try { return JSON.parse(JSON.stringify(state)); } catch { return null; }
}

function _capTeResolveChangeTrackerClass() {
    const fromApi = globalThis.comfyAPI?.changeTracker?.ChangeTracker;
    if (fromApi?.prototype?.deactivate) return fromApi;
    // Fallback once any workflow tracker exists (comfyAPI may boot late).
    try {
        const proto = Object.getPrototypeOf(
            globalThis.comfyAPI?.workflowService?.()?.activeWorkflow?.changeTracker ?? {},
        );
        if (proto?.deactivate) return proto.constructor;
    } catch { /* ignore */ }
    return null;
}

/**
 * ComfyUI ChangeTracker.squashState is debounced 50ms after deactivate/capture.
 * On tab switch the old workflow stays "active" briefly while rootGraph already
 * shows the new workflow — squash then overwrites the old tab's activeState with
 * the new graph. Coming back loads that corrupted activeState → nodes / AI prompts
 * look "reset". Both tabs having Timeline Editor makes the race easy to hit.
 */
function _capTeFullscreenOpen() {
    const te = CapTimelineEditorApp._open;
    return !!(te && !te._destroyed && te._overlay?.classList.contains("open"));
}

/**
 * ChangeTracker.init binds window keydown (capture) and defers Ctrl+Z to rAF.
 * stopImmediatePropagation on our handler cannot cancel that already-queued
 * undo — which restores the graph and closes the timeline editor. Block
 * tracker undo/redo while the fullscreen shell is open.
 */
function _capTePatchChangeTrackerUndo() {
    const CT = _capTeResolveChangeTrackerClass();
    if (!CT?.prototype || CT.prototype.undoRedo?._capTeUndoPatched) {
        return !!CT?.prototype?.undoRedo?._capTeUndoPatched;
    }
    const origUndoRedo = CT.prototype.undoRedo;
    CT.prototype.undoRedo = async function (e) {
        if (_capTeFullscreenOpen()) return true;
        return origUndoRedo.apply(this, arguments);
    };
    CT.prototype.undoRedo._capTeUndoPatched = true;

    if (typeof CT.prototype.undo === "function") {
        const origUndo = CT.prototype.undo;
        CT.prototype.undo = async function (...args) {
            if (_capTeFullscreenOpen()) return;
            return origUndo.apply(this, args);
        };
    }
    if (typeof CT.prototype.redo === "function") {
        const origRedo = CT.prototype.redo;
        CT.prototype.redo = async function (...args) {
            if (_capTeFullscreenOpen()) return;
            return origRedo.apply(this, args);
        };
    }
    return true;
}

function patchChangeTrackerAgainstTabRace() {
    const CT = _capTeResolveChangeTrackerClass();
    _capTePatchChangeTrackerUndo();
    if (!CT?.prototype || CT.prototype.deactivate?._capTePatched) return !!CT?.prototype?.deactivate?._capTePatched;

    const origCapture = CT.prototype.captureCanvasState;
    CT.prototype.captureCanvasState = function (...args) {
        if (this._capTeInactive) return;
        return origCapture.apply(this, args);
    };

    const reviveSquash = (tracker) => {
        tracker._capTeInactive = false;
        if (tracker._capTeSquashStubbed && tracker._capTeSquashOrig) {
            tracker.squashState = tracker._capTeSquashOrig;
            tracker._capTeSquashStubbed = false;
            tracker._capTeSquashOrig = null;
        }
    };

    const freezeActiveState = (tracker) => {
        const frozen = _capTeCloneGraphState(tracker.activeState);
        if (!frozen) return;
        tracker.activeState = frozen;
        tracker._capTeFrozenActiveState = frozen;
        if (tracker.workflow) tracker.workflow._capTeFrozenActiveState = frozen;
    };

    const stubSquash = (tracker) => {
        try { tracker.squashState?.cancel?.(); } catch { /* ignore */ }
        if (typeof tracker.squashState !== "function" || tracker._capTeSquashStubbed) return;
        tracker._capTeSquashOrig = tracker.squashState;
        const stub = () => {};
        stub.cancel = () => {
            try { tracker._capTeSquashOrig?.cancel?.(); } catch { /* ignore */ }
        };
        stub.flush = () => {};
        tracker.squashState = stub;
        tracker._capTeSquashStubbed = true;
    };

    const origDeactivate = CT.prototype.deactivate;
    CT.prototype.deactivate = function (...args) {
        // Already left this tab — do not re-capture from a canvas that may now
        // belong to another workflow.
        if (this._capTeInactive && this._capTeFrozenActiveState) {
            stubSquash(this);
            return;
        }
        // Force capture even if a drag/gesture left changeCount > 0 (otherwise
        // deactivate silently keeps a stale activeState and coming back loses edits).
        this.changeCount = 0;
        this._capTeInactive = false;
        try {
            CapTimelineEditorApp.flushOpenEditors(app.rootGraph ?? app.graph);
        } catch { /* ignore */ }
        let ret;
        try {
            ret = origDeactivate.apply(this, args);
        } finally {
            this.changeCount = 0;
        }
        stubSquash(this);
        freezeActiveState(this);
        this._capTeInactive = true;
        return ret;
    };
    CT.prototype.deactivate._capTePatched = true;

    const origRestore = CT.prototype.restore;
    CT.prototype.restore = function (...args) {
        reviveSquash(this);
        return origRestore.apply(this, args);
    };

    const origReset = CT.prototype.reset;
    CT.prototype.reset = function (...args) {
        reviveSquash(this);
        const ret = origReset.apply(this, args);
        // Loaded graph is now authoritative — refresh freeze baseline.
        freezeActiveState(this);
        return ret;
    };

    return true;
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
            node._teApp?._syncProjectScalarDisplay?.();
            return ret;
        };
    }
    hookSwapWhWidget(node);
}

function onTeGlobalKeyDown(e) {
    const te = CapTimelineEditorApp._open;
    if (!te) return;
    if (e.key === "Alt") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        te._overlay?.focus?.({ preventScroll: true });
        return;
    }
    if (te.handleModalKey(e)) return;
    // Gen-edit modal owns Space / timeline keys — beat both Timeline instances.
    if (te.handleGenEditKey?.(e)) return;
    // Undo/redo first — must beat ComfyUI's capture-phase graph undo.
    if (te.handleShortcutKey(e)) return;
    if (te.handleMediaPreviewKey(e)) return;
    if (te.handleAiOptimizeKey(e)) return;
    if (te.handleDeleteKey(e)) return;
}

function onTeGlobalKeyUp(e) {
    const te = CapTimelineEditorApp._open;
    if (!te || e.key !== "Alt") return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
    te._overlay?.focus?.({ preventScroll: true });
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
        // Capture on `window` for timeline shortcuts. ComfyUI ChangeTracker
        // also listens on window (capture) but defers Ctrl+Z to rAF — so we
        // must patch tracker undo (see _capTePatchChangeTrackerUndo), not
        // rely on stopImmediatePropagation alone.
        window.addEventListener("keydown", onTeGlobalKeyDown, true);
        window.addEventListener("keyup", onTeGlobalKeyUp, true);
        hookQueuePrompt();
        hookLoadGraphData();
        // comfyAPI / ChangeTracker may boot after extension setup.
        const tryPatch = () => {
            _capTePatchChangeTrackerUndo();
            return patchChangeTrackerAgainstTabRace();
        };
        if (!tryPatch()) {
            for (const ms of [0, 200, 1000, 3000]) setTimeout(tryPatch, ms);
        }
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
            hookLoadGraphData();
            patchChangeTrackerAgainstTabRace();
        }, 0);
    },

    async beforeConfigureGraph() {
        // Flush first — forceCloseAll/destroy used to mark destroyed before save.
        CapTimelineEditorApp.flushOpenEditors(app.graph);
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
