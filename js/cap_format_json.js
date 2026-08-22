import { app } from "../../scripts/app.js";
import { ComfyWidgets } from "../../scripts/widgets.js";
import { loadExtensionCss } from "./cap_ui.js";

const NODE_CLASS = "CAP_FormatJson";
const MIN_PREVIEW_H = 100;
const TITLE_H = 30;
const SLOT_H = 20;
const NODE_PAD = 12;

function capFormatJsonChromeHeight(node) {
    let h = TITLE_H;
    h += Math.max(node.inputs?.length ?? 0, node.outputs?.length ?? 0) * SLOT_H;
    for (const w of node.widgets ?? []) {
        if (w === node._capFormatJsonPreview) continue;
        if (w.hidden) continue;
        if (w.element?.style?.display === "none") continue;
        if (typeof w.computeSize === "function" && w.computeSize !== w._capFormatJsonComputeSize) {
            try {
                h += w.computeSize(node.size?.[0] ?? 400)[1];
                continue;
            } catch { /* fall through */ }
        }
        h += 20;
    }
    return h + NODE_PAD;
}

function fitFormatJsonPreview(node) {
    const w = node._capFormatJsonPreview;
    if (!w?.inputEl || !node.size) return;
    const h = Math.max(MIN_PREVIEW_H, node.size[1] - capFormatJsonChromeHeight(node));
    w._capFormatJsonBodyH = h;
    w.inputEl.style.height = `${h}px`;
}

function hidePreviewLabel(widget) {
    const el = widget.inputEl;
    if (!el) return;
    const row = el.closest(".comfy-multiline-input")?.parentElement
        ?? el.closest("[data-widget-name]")
        ?? el.parentElement?.parentElement;
    const label = row?.querySelector("label, .widget-label, span.name");
    if (label) label.style.display = "none";
}

function setPreviewText(node, text) {
    const w = node._capFormatJsonPreview;
    if (!w) return;
    w.value = text ?? "";
}

function previewTextFromValues(values) {
    if (!values?.length) return null;
    const first = values[0];
    if (first == null) return null;
    if (Array.isArray(first)) return first.map((x) => String(x ?? "")).join("\n");
    return String(first);
}

function afterPreviewUpdate(node) {
    requestAnimationFrame(() => {
        fitFormatJsonPreview(node);
        const sz = node.computeSize();
        if (sz[0] < node.size[0]) sz[0] = node.size[0];
        if (sz[1] < node.size[1]) sz[1] = node.size[1];
        node.onResize?.(sz);
        app.graph.setDirtyCanvas(true, false);
    });
}

app.registerExtension({
    name: "Capricorncd.FormatJson",

    async setup() {
        loadExtensionCss("cap_ui.css", "cap-ui-styles");
    },

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_CLASS) return;

        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            onExecuted?.apply(this, arguments);
            if (message?.text?.[0] != null) {
                setPreviewText(this, message.text[0]);
                // Keep widgets_values in sync for save / refresh (Easy-Use Show Any style).
                this.widgets_values = [message.text[0]];
            }
            afterPreviewUpdate(this);
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            onConfigure?.apply(this, arguments);
            const text = previewTextFromValues(this.widgets_values);
            if (text != null) {
                setPreviewText(this, text);
                afterPreviewUpdate(this);
            }
        };

        const onResize = nodeType.prototype.onResize;
        nodeType.prototype.onResize = function (size) {
            const result = onResize?.apply(this, arguments);
            fitFormatJsonPreview(this);
            return result;
        };

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = onNodeCreated?.apply(this, arguments);

            const { widget } = ComfyWidgets.STRING(
                this,
                "preview",
                ["STRING", { multiline: true, default: "" }],
                app,
            );
            widget.inputEl.readOnly = true;
            widget.inputEl.spellcheck = false;
            widget.inputEl.classList.add("cap-format-json-preview");
            widget.inputEl.placeholder = "运行后在此显示格式化 JSON…";
            // Serializable: persist last preview in workflow widgets_values.
            hidePreviewLabel(widget);

            widget._capFormatJsonBodyH = MIN_PREVIEW_H;
            widget._capFormatJsonComputeSize = function (width) {
                const h = Math.max(MIN_PREVIEW_H, widget._capFormatJsonBodyH ?? MIN_PREVIEW_H);
                if (widget.inputEl) widget.inputEl.style.height = `${h}px`;
                return [width, h];
            };
            widget.computeSize = widget._capFormatJsonComputeSize;

            this._capFormatJsonPreview = widget;

            if (this.size?.[0] < 420) {
                this.setSize([420, Math.max(this.size?.[1] ?? 360, 360)]);
            }
            requestAnimationFrame(() => {
                const text = previewTextFromValues(this.widgets_values);
                if (text != null && !(widget.value || "").trim()) {
                    setPreviewText(this, text);
                }
                fitFormatJsonPreview(this);
            });

            return result;
        };
    },
});
