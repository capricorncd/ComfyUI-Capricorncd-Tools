/** Keep DOM widgets out of widgets_values index alignment. */

import { app } from "../../scripts/app.js";

const NODE_TITLE_HEIGHT = 30;
const MIN_TITLE_OVERLAY_SCALE = 0.5;

export function markNonSerializableWidget(w) {
    if (!w) return;
    w.serialize = false;
    w.serializeValue = () => undefined;
}

/** True when the node lives in the graph the canvas is currently showing.
 * When a subgraph is opened, canvas.graph is the subgraph, so nodes from an
 * outer graph must hide their DOM overlays. */
function isNodeOnDisplayedGraph(node) {
    const active = app.canvas?.graph;
    const owner = node?.graph;
    if (!active || !owner) return true;
    return owner === active;
}

function resolveNodeHost(node, el) {
    if (node?.id != null) {
        const vueNode = document.querySelector(`[data-node-id="${node.id}"]`);
        if (vueNode) return vueNode;
    }

    const promptEl = node?.widgets?.find((w) => w.name === "prompt")?.inputEl;
    const fromEl = el?.closest?.("[data-node-id]")
        ?? el?.closest?.("[data-id]")
        ?? el?.closest?.(".lg-node")
        ?? el?.closest?.(".comfy-node");
    if (fromEl) return fromEl;

    return node?.element
        ?? promptEl?.closest?.("[data-node-id]")
        ?? promptEl?.closest?.("[data-id]")
        ?? promptEl?.closest?.(".lg-node")
        ?? promptEl?.closest?.(".comfy-node")
        ?? null;
}

export function resolveNodeHeader(node, el) {
    if (node?.id != null) {
        const vueNode = document.querySelector(`[data-node-id="${node.id}"]`);
        if (vueNode) {
            return vueNode.querySelector?.(".lg-node-header") ?? vueNode;
        }
    }
    const host = resolveNodeHost(node, el);
    if (!host) return null;
    return host.querySelector?.(".lg-node-header")
        ?? host.querySelector?.('[data-testid^="node-header-"]')
        ?? null;
}

export function appendDomWidgetLast(node, widget) {
    if (!widget || !node.widgets) return;
    markNonSerializableWidget(widget);
    const i = node.widgets.indexOf(widget);
    if (i >= 0 && i < node.widgets.length - 1) {
        node.widgets.splice(i, 1);
        node.widgets.push(widget);
    }
}

export function captureWidgetValues(node) {
    const out = {};
    for (const w of node.widgets ?? []) {
        if (w.serialize === false) continue;
        if (w.name) out[w.name] = w.value;
    }
    return out;
}

export function restoreWidgetValues(node, values) {
    if (!values) return;
    for (const w of node.widgets ?? []) {
        if (w.serialize === false) continue;
        if (w.name in values) w.value = values[w.name];
    }
}

export function applyWidgetValuesByNames(node, names, values) {
    if (!Array.isArray(values) || !names?.length) return;
    let i = 0;
    for (const name of names) {
        const w = node.widgets?.find((x) => x.name === name);
        if (!w || w.serialize === false) continue;
        if (i >= values.length) break;
        w.value = values[i++];
    }
}

export function positionOverlayInNodeHeader(node, el, { right = 40, top = 0 } = {}) {
    if (!el) return null;
    if (!isNodeOnDisplayedGraph(node)) {
        el.style.display = "none";
        return null;
    }
    const header = resolveNodeHeader(node, el);
    if (!header) return null;
    el.style.display = "";
    if (getComputedStyle(header).position === "static") {
        header.style.position = "relative";
    }
    if (el.parentElement !== header) header.appendChild(el);
    el.classList.add("cap-ui-node-btn-wrap--header");
    el.classList.remove("cap-ui-node-btn-wrap--hoisted");
    el.style.position = "absolute";
    el.style.top = `${top}px`;
    el.style.right = `${right}px`;
    el.style.left = "auto";
    el.style.bottom = "auto";
    el.style.height = "auto";
    el.style.zIndex = "50";
    el.style.pointerEvents = "none";
    for (const child of el.children) {
        child.style.pointerEvents = "auto";
    }
    return header;
}

export function positionOverlayFixedToHeader(node, el) {
    if (!el || node?.id == null) return null;
    if (!isNodeOnDisplayedGraph(node)) {
        el.style.display = "none";
        return null;
    }
    const header = resolveNodeHeader(node, el);
    if (!header) return null;
    el.style.display = "";
    if (el.parentElement !== document.body) document.body.appendChild(el);
    el.classList.add("cap-ui-node-btn-wrap--header", "cap-ui-node-btn-wrap--fixed");
    el.classList.remove("cap-ui-node-btn-wrap--hoisted");
    const rect = header.getBoundingClientRect();
    el.style.position = "fixed";
    el.style.height = "auto";
    el.style.zIndex = "1";
    el.style.pointerEvents = "none";
    for (const child of el.children) {
        child.style.pointerEvents = "auto";
    }
    const layout = () => {
        const r = header.getBoundingClientRect();
        el.style.top = `${r.top + 2}px`;
        el.style.left = `${r.right - el.offsetWidth - 8}px`;
        el.style.right = "auto";
        el.style.bottom = "auto";
    };
    layout();
    requestAnimationFrame(layout);
    return header;
}

export function positionOverlayOnCanvasTitle(node, el, { insetRight = 6, insetTop = 4 } = {}) {
    const canvas = app.canvas;
    if (!el || !canvas?.canvas || !node?.pos || !node?.size) return null;
    if (!isNodeOnDisplayedGraph(node)) {
        el.style.display = "none";
        return canvas.canvas;
    }
    if (node.flags?.collapsed) {
        el.style.display = "none";
        return canvas.canvas;
    }
    const scale = canvas.ds?.scale ?? 1;
    if (scale < MIN_TITLE_OVERLAY_SCALE) {
        el.style.display = "none";
        return canvas.canvas;
    }
    el.style.display = "";
    if (el.parentElement !== document.body) document.body.appendChild(el);
    el.classList.add("cap-ui-node-btn-wrap--header", "cap-ui-node-btn-wrap--canvas");
    el.classList.remove("cap-ui-node-btn-wrap--hoisted");
    el.style.position = "fixed";
    el.style.height = "auto";
    el.style.zIndex = "1";
    el.style.pointerEvents = "none";
    for (const child of el.children) {
        child.style.pointerEvents = "auto";
    }

    el.style.transform = `scale(${scale})`;
    el.style.transformOrigin = "100% 0%";

    const rect = canvas.canvas.getBoundingClientRect();
    const [gx, gy] = node.pos;
    const nw = node.size[0];
    const titleTop = gy - NODE_TITLE_HEIGHT;
    const rightX = gx + nw;
    const [cx, cy] = canvas.convertOffsetToCanvas([rightX, titleTop]);
    const anchorX = rect.left + cx - insetRight;
    const anchorY = rect.top + cy + insetTop;
    el.style.top = `${anchorY}px`;
    el.style.left = `${anchorX - el.offsetWidth}px`;
    el.style.right = "auto";
    el.style.bottom = "auto";
    return canvas.canvas;
}

export function watchCanvasTitleOverlay(node, el, anchorFn, key = "canvas") {
    if (!node || !el || typeof anchorFn !== "function") return;
    const run = () => anchorFn();
    run();

    const canvas = app.canvas;
    const cbs = canvas._capTitleOverlayCbs ?? (canvas._capTitleOverlayCbs = new Set());
    cbs.add(run);

    if (!canvas._capTitleOverlayHooked) {
        canvas._capTitleOverlayHooked = true;
        const origForeground = canvas.onDrawForeground;
        canvas.onDrawForeground = function (...args) {
            const result = origForeground?.apply(this, args);
            for (const cb of canvas._capTitleOverlayCbs) cb();
            return result;
        };
        const onResize = () => {
            for (const cb of canvas._capTitleOverlayCbs) cb();
        };
        window.addEventListener("resize", onResize);
        const ro = canvas.canvas ? new ResizeObserver(onResize) : null;
        ro?.observe(canvas.canvas);
        canvas._capTitleOverlayResizeCleanup = () => {
            window.removeEventListener("resize", onResize);
            ro?.disconnect();
        };
    }

    const cleanups = node._capOverlayCleanups ?? (node._capOverlayCleanups = []);
    cleanups.push(() => {
        cbs.delete(run);
    });
}

export function hoistNodeOverlay(node, el, { top = 4, left = 6 } = {}) {
    if (!el) return null;
    const host = resolveNodeHost(node, el);
    if (!host) return null;
    if (getComputedStyle(host).position === "static") {
        host.style.position = "relative";
    }
    if (el.parentElement !== host) host.appendChild(el);
    el.classList.add("cap-ui-node-btn-wrap--hoisted");
    el.style.position = "absolute";
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
    el.style.right = "auto";
    el.style.bottom = "auto";
    el.style.zIndex = "20";
    el.style.pointerEvents = "none";
    for (const child of el.children) {
        child.style.pointerEvents = "auto";
    }
    return host;
}

export function watchNodeOverlayAnchor(node, el, anchorFn, key = "default") {
    if (!node || !el || typeof anchorFn !== "function") return;
    const run = () => anchorFn();
    run();
    const flag = `_capOverlayWatch_${key}`;
    if (node[flag]) return;
    node[flag] = true;
    const host = resolveNodeHost(node, el);
    const ro = host ? new ResizeObserver(run) : null;
    if (ro && host) ro.observe(host);
    const header = resolveNodeHeader(node, el);
    const mo = new MutationObserver(() => {
        if (!el.isConnected) run();
    });
    if (header) {
        mo.observe(header, { childList: true });
    } else if (host) {
        mo.observe(host, { childList: true, subtree: true });
    }
    const cleanups = node._capOverlayCleanups ?? (node._capOverlayCleanups = []);
    cleanups.push(() => {
        ro?.disconnect();
        mo.disconnect();
        node[flag] = false;
    });
}

export function positionOverlayAboveWidget(node, overlayEl, widgetName, { offsetY = -26, left = 6 } = {}) {
    if (!overlayEl) return;
    const widget = node.widgets?.find((w) => w.name === widgetName);
    const anchor = widget?.inputEl?.closest?.(".comfyui-widget")
        ?? widget?.inputEl?.parentElement;
    const host = resolveNodeHost(node, overlayEl);
    if (!anchor || !host) return;
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    if (overlayEl.parentElement !== host) host.appendChild(overlayEl);
    overlayEl.style.position = "absolute";
    overlayEl.style.left = `${left}px`;
    overlayEl.style.top = `${Math.max(0, anchor.offsetTop + offsetY)}px`;
    overlayEl.style.zIndex = "20";
    overlayEl.style.pointerEvents = "none";
    for (const child of overlayEl.children) {
        child.style.pointerEvents = "auto";
    }
}
