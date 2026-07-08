import { app } from "../../scripts/app.js";
import {
    bindRichPromptWidget,
    detachRichPromptHandler,
    resolvePromptTextarea,
} from "./rich_prompt.js";
import {
    addPromptHistory,
    ensurePromptLibraryButtons,
    rememberPromptCaret,
} from "./cap_prompt_library.js";

const NODE_CLASS = "CAP_RichPromptInput";

function getPromptWidget(node) {
    return node.widgets?.find((w) => w.name === "prompt") ?? null;
}

function ensureRichBind(widget) {
    const ta = resolvePromptTextarea(widget);
    if (!ta) return false;
    if (widget._capBoundTa && widget._capBoundTa !== ta) {
        detachRichPromptHandler(widget._capBoundTa);
        widget._capBoundTa = null;
    }
    if (widget._capBoundTa === ta && ta._capRichAttached) return true;
    if (!bindRichPromptWidget(widget)) return false;
    widget._capBoundTa = resolvePromptTextarea(widget);
    if (widget._capBoundTa) {
        widget._capBoundTa._capBoundWidget = widget;
        rememberPromptCaret(widget._capBoundTa);
    }
    return true;
}

function setupNode(node) {
    const prompt = getPromptWidget(node);
    if (!prompt) return;
    // Clear any leftover height hacks from earlier builds.
    delete prompt.computedHeight;
    delete prompt._capLayoutKey;
    delete prompt._capPromptComputeSize;
    delete prompt._capAppliedH;
    ensurePromptLibraryButtons(node);
    ensureRichBind(prompt);
}

function tryBindWhenReady(node, tries = 0) {
    const widget = getPromptWidget(node);
    if (!widget) return;
    if (ensureRichBind(widget)) return;
    if (tries < 40) setTimeout(() => tryBindWhenReady(node, tries + 1), 50);
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
        nodeType.prototype.configure = function () {
            const result = configure?.apply(this, arguments);
            setupNode(this);
            tryBindWhenReady(this);
            return result;
        };

        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function () {
            onExecuted?.apply(this, arguments);
            recordHistoryFromNode(this);
        };
    },

    nodeCreated(node) {
        if (node.comfyClass !== NODE_CLASS) return;
        setupNode(node);
        tryBindWhenReady(node);
    },
});
