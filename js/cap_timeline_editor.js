import { app } from "../../scripts/app.js";
import { CapTimelineEditorApp } from "./CapTimelineEditorApp.js";

const NODE_CLASS = "CAP_TimelineEditor";

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
    },
});

console.log("[CAP_TimelineEditor] extension loaded");
