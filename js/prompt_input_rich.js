import { app } from "../../scripts/app.js";
import {
    bindRichPromptWidget,
    detachRichPromptHandler,
    isRichPromptReady,
    resolvePromptTextarea,
} from "./rich_prompt.js";
import {
    addPromptHistory,
    ensurePromptLibraryButtons,
    rememberPromptCaret,
} from "./cap_prompt_library.js";

const NODE_CLASS = "CAP_RichPromptInput";

function widgetRoot(widget, node) {
    return widget.element
        ?? widget.inputEl?.parentElement
        ?? node?.el
        ?? null;
}

function isDomNode(value) {
    return value instanceof Node;
}

function isWatchActive(widget, node) {
    const ta = resolvePromptTextarea(widget);
    if (isDomNode(ta) && document.contains(ta)) return true;

    const root = widgetRoot(widget, node);
    if (isDomNode(root) && document.contains(root)) return true;

    if (!node?.id) return false;
    const graph = app.graph;
    const live = graph?._nodes_by_id?.[node.id] ?? graph?.getNodeById?.(node.id);
    return live === node;
}

function needsRichBind(widget) {
    const ta = resolvePromptTextarea(widget);
    if (!ta) return false;
    if (widget._capBoundTa && widget._capBoundTa !== ta) return true;
    return !isRichPromptReady(widget);
}

function getPromptWidget(node) {
    return node.widgets?.find((w) => w.name === "prompt") ?? null;
}

function ensureRichBind(widget, node) {
    const ta = resolvePromptTextarea(widget);
    if (!ta) return false;

    if (widget._capBoundTa && widget._capBoundTa !== ta) {
        detachRichPromptHandler(widget._capBoundTa);
        widget._capBoundTa = null;
    }

    if (!bindRichPromptWidget(widget)) return false;
    const bound = resolvePromptTextarea(widget);
    widget._capBoundTa = bound;
    if (bound) {
        bound._capBoundWidget = widget;
        rememberPromptCaret(bound);
    }
    return !!bound;
}

function stopRichWatch(widget) {
    widget._capRichObs?.disconnect();
    widget._capRichObs = null;
    if (widget._capRichInterval) {
        clearInterval(widget._capRichInterval);
        widget._capRichInterval = null;
    }
    if (widget._capBoundTa) {
        detachRichPromptHandler(widget._capBoundTa);
        widget._capBoundTa = null;
    }
    widget._capRichWatch = false;
}

function watchPromptWidget(widget, node) {
    if (widget._capRichWatch) return;
    widget._capRichWatch = true;

    const check = () => {
        if (!isWatchActive(widget, node)) {
            stopRichWatch(widget);
            return;
        }
        if (needsRichBind(widget)) ensureRichBind(widget, node);
    };

    const tryWatch = (tries = 0) => {
        ensureRichBind(widget, node);
        const root = widgetRoot(widget, node);
        if (!isDomNode(root)) {
            if (tries < 100) setTimeout(() => tryWatch(tries + 1), 50);
            return;
        }
        widget._capRichObs = new MutationObserver(check);
        widget._capRichObs.observe(root, { childList: true, subtree: true });
        widget._capRichInterval = setInterval(check, 750);
        check();
    };

    tryWatch();
}

function bindNodePromptWidgets(node) {
    const promptWidget = getPromptWidget(node);
    if (!promptWidget) return;
    watchPromptWidget(promptWidget, node);
    ensurePromptLibraryButtons(node);
}

function recordHistoryFromNode(node) {
    const widget = getPromptWidget(node);
    const ta = resolvePromptTextarea(widget);
    const text = ta?.value ?? widget?.value ?? "";
    addPromptHistory(text);
}

app.registerExtension({
    name: "Capricorncd.RichPromptInput",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_CLASS) return;

        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            for (const widget of this.widgets ?? []) {
                if (widget.name === "prompt") stopRichWatch(widget);
            }
            return onRemoved?.apply(this, arguments);
        };

        const onResize = nodeType.prototype.onResize;
        nodeType.prototype.onResize = function () {
            onResize?.apply(this, arguments);
            bindNodePromptWidgets(this);
        };

        const configure = nodeType.prototype.configure;
        nodeType.prototype.configure = function () {
            const result = configure?.apply(this, arguments);
            bindNodePromptWidgets(this);
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
        bindNodePromptWidgets(node);
    },
});
