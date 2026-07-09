import { app } from "../../scripts/app.js";
import {
    bindRichPromptWidget,
    detachRichPromptHandler,
    resolvePromptTextarea,
    syncTextareaFromPromptWidget,
} from "./rich_prompt.js";
import {
    addPromptHistory,
    ensurePromptLibraryButtons,
    rememberPromptCaret,
} from "./cap_prompt_library.js";
import {
    applyWidgetValuesByNames,
    captureWidgetValues,
    restoreWidgetValues,
} from "./cap_widget_persist.js";

const NODE_CLASS = "CAP_RichPromptInput";
const WIDGET_NAMES = ["prompt", "add_blank_line_start", "add_blank_line_end"];

function getPromptWidget(node) {
    return node.widgets?.find((w) => w.name === "prompt") ?? null;
}

function repairLegacyPromptValues(node, info) {
    const values = info?.widgets_values;
    if (!Array.isArray(values)) return;
    const prompt = getPromptWidget(node);
    if (!prompt || (typeof prompt.value === "string" && prompt.value.length > 0)) return;
    if (typeof values[0] === "string") {
        applyWidgetValuesByNames(node, WIDGET_NAMES, values);
        return;
    }
    if (typeof values[1] === "string") {
        applyWidgetValuesByNames(node, WIDGET_NAMES, values.slice(1));
    }
}

function ensureRichBind(widget) {
    const ta = resolvePromptTextarea(widget);
    if (!ta) return false;
    if (widget._capBoundTa && widget._capBoundTa !== ta) {
        detachRichPromptHandler(widget._capBoundTa);
        widget._capBoundTa = null;
    }
    ta._capBoundWidget = widget;
    if (widget._capBoundTa === ta && ta._capRichAttached) {
        syncTextareaFromPromptWidget(widget);
        return true;
    }
    if (!bindRichPromptWidget(widget)) return false;
    widget._capBoundTa = resolvePromptTextarea(widget);
    if (widget._capBoundTa) {
        widget._capBoundTa._capBoundWidget = widget;
        rememberPromptCaret(widget._capBoundTa);
        syncTextareaFromPromptWidget(widget);
    }
    return true;
}

function setupNodeUi(node, info = null) {
    const prompt = getPromptWidget(node);
    if (!prompt) return;
    if (info) repairLegacyPromptValues(node, info);
    const snapshot = captureWidgetValues(node);
    delete prompt.computedHeight;
    delete prompt._capLayoutKey;
    delete prompt._capPromptComputeSize;
    delete prompt._capAppliedH;
    ensurePromptLibraryButtons(node);
    restoreWidgetValues(node, snapshot);
    ensureRichBind(prompt);
}

function trySyncPromptDisplay(node, tries = 0) {
    const prompt = getPromptWidget(node);
    if (!prompt) return;
    if (ensureRichBind(prompt)) return;
    if (tries < 40) setTimeout(() => trySyncPromptDisplay(node, tries + 1), 50);
}

function recordHistoryFromNode(node) {
    const widget = getPromptWidget(node);
    const ta = resolvePromptTextarea(widget);
    addPromptHistory(ta?.value ?? widget?.value ?? "");
}

app.registerExtension({
    name: "Capricorncd.RichPromptInput",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_CLASS) return;

        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            const prompt = getPromptWidget(this);
            if (prompt?._capBoundTa) {
                detachRichPromptHandler(prompt._capBoundTa);
                prompt._capBoundTa = null;
            }
            return onRemoved?.apply(this, arguments);
        };

        const configure = nodeType.prototype.configure;
        nodeType.prototype.configure = function (info) {
            const result = configure?.apply(this, arguments);
            setupNodeUi(this, info);
            trySyncPromptDisplay(this);
            return result;
        };

        const onAfterGraphConfigured = nodeType.prototype.onAfterGraphConfigured;
        nodeType.prototype.onAfterGraphConfigured = function () {
            onAfterGraphConfigured?.apply(this, arguments);
            setupNodeUi(this);
            trySyncPromptDisplay(this);
        };

        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function () {
            onExecuted?.apply(this, arguments);
            recordHistoryFromNode(this);
        };
    },

    nodeCreated(node) {
        if (node.comfyClass !== NODE_CLASS) return;
        if (app.configuringGraph) return;
        setupNodeUi(node);
        trySyncPromptDisplay(node);
    },
});
