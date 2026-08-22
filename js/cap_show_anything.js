import { app } from "../../scripts/app.js";
import { ComfyWidgets } from "../../scripts/widgets.js";

const NODE_CLASS = "CAP_ShowAnything";

function textWidgetsStart(node) {
    if (!node.widgets) return 0;
    const pos = node.widgets.findIndex((w) => w.name === "text");
    if (pos === -1) return node.widgets.length;
    for (let i = pos; i < node.widgets.length; i++) {
        node.widgets[i].onRemove?.();
    }
    node.widgets.length = pos;
    return pos;
}

function populate(node, texts) {
    textWidgetsStart(node);
    const rows = Array.isArray(texts) ? texts : [texts];
    for (const row of rows) {
        const { widget } = ComfyWidgets.STRING(
            node,
            "text",
            ["STRING", { multiline: true }],
            app,
        );
        widget.inputEl.readOnly = true;
        widget.inputEl.spellcheck = false;
        widget.inputEl.style.opacity = "0.85";
        widget.value = row == null ? "" : String(row);
    }

    requestAnimationFrame(() => {
        const sz = node.computeSize();
        if (sz[0] < node.size[0]) sz[0] = node.size[0];
        if (sz[1] < node.size[1]) sz[1] = node.size[1];
        node.onResize?.(sz);
        app.graph.setDirtyCanvas(true, false);
    });
}

function textsFromWidgetsValues(values) {
    if (!values?.length) return null;
    // [format_json, ...texts] after our execute persist / normal save
    if (typeof values[0] === "boolean") {
        return values.slice(1);
    }
    // Nested Easy-Use style: [[line1, line2]]
    if (values.length === 1 && Array.isArray(values[0])) {
        return values[0];
    }
    return values;
}

app.registerExtension({
    name: "Capricorncd.ShowAnything",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_CLASS) return;

        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            onExecuted?.apply(this, arguments);
            if (message?.text == null) return;
            const texts = Array.isArray(message.text) ? message.text : [message.text];
            populate(this, texts);
            const fmt = this.widgets?.find((w) => w.name === "format_json");
            this.widgets_values = [fmt ? !!fmt.value : true, ...texts.map((t) => String(t ?? ""))];
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            onConfigure?.apply(this, arguments);
            const texts = textsFromWidgetsValues(this.widgets_values);
            if (texts?.length) {
                populate(this, texts);
            }
        };
    },
});
