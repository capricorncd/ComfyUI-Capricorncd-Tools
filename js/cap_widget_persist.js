/** Keep DOM widgets out of widgets_values index alignment. */

export function markNonSerializableWidget(w) {
    if (!w) return;
    w.serialize = false;
    w.serializeValue = () => undefined;
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

export function hoistNodeOverlay(node, el, { top = 4, left = 6 } = {}) {
    if (!el) return;
    const nodeEl = node?.element ?? el.closest?.("[data-id]") ?? el.closest?.(".node");
    if (!nodeEl) return;
    if (getComputedStyle(nodeEl).position === "static") {
        nodeEl.style.position = "relative";
    }
    if (el.parentElement !== nodeEl) nodeEl.appendChild(el);
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
}

export function positionOverlayAboveWidget(node, overlayEl, widgetName, { offsetY = -26, left = 6 } = {}) {
    if (!overlayEl) return;
    const widget = node.widgets?.find((w) => w.name === widgetName);
    const anchor = widget?.inputEl?.closest?.(".comfyui-widget")
        ?? widget?.inputEl?.parentElement;
    const host = node?.element ?? overlayEl.closest?.("[data-id]") ?? overlayEl.closest?.(".node");
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
