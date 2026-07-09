import { app } from "../../scripts/app.js";
import { ensureCapUiCss } from "./cap_ui.js";
import {
    appendDomWidgetLast,
    applyWidgetValuesByNames,
    captureWidgetValues,
    positionOverlayAboveWidget,
    restoreWidgetValues,
} from "./cap_widget_persist.js";

const NODE_CLASS = "CAP_SizeSettings";
const ORIENT_DOM = "cap_size_orient";
const DEFAULT_ORIENTATION = "竖屏";
const WIDGET_NAMES = [
    "aspect_ratio",
    "resolution",
    "orientation",
    "custom_width",
    "custom_height",
    "count",
];

const RATIO_PARTS = {
    "1:1": [1, 1],
    "2:3": [2, 3],
    "3:4": [3, 4],
    "3:5": [3, 5],
    "4:7": [4, 7],
    "9:16": [9, 16],
    "9:21": [9, 21],
};

const LONG_EDGE = {
    "480P": 854,
    "720P": 1280,
    "1K": 1920,
    "2K": 2560,
    "4K": 3840,
    "8K": 7680,
};

const SQUARE_EDGE = {
    "480P": 512,
    "720P": 720,
    "1K": 1024,
    "2K": 2048,
    "4K": 4096,
    "8K": 8192,
};

function getWidget(node, name) {
    return node.widgets?.find((w) => w.name === name) ?? null;
}

function align8(value) {
    return Math.max(8, Math.round(value / 8) * 8);
}

function effectiveRatio(aspectRatio, orientation) {
    const parts = RATIO_PARTS[aspectRatio] ?? [9, 16];
    let [rw, rh] = parts;
    if (aspectRatio === "1:1") return [1, 1];
    if (orientation === "横屏") return [rh, rw];
    return [rw, rh];
}

function sizeFromRatio(aspectRatio, resolution, orientation) {
    const [rw, rh] = effectiveRatio(aspectRatio, orientation);
    if (rw === 1 && rh === 1) {
        const edge = align8(SQUARE_EDGE[resolution] ?? 1024);
        return [edge, edge];
    }

    const longEdge = LONG_EDGE[resolution] ?? 1920;
    if (rw > rh) {
        const width = longEdge;
        const height = align8((width * rh) / rw);
        return [align8(width), height];
    }

    const height = longEdge;
    const width = align8((height * rw) / rh);
    return [width, align8(height)];
}

function collapseFloatingWidget(w) {
    if (!w) return;
    w.serialize = false;
    w.serializeValue = () => undefined;
    w.computedHeight = 0;
    w.computeSize = () => [0, -4];
    if (w.options) {
        w.options.getMinHeight = () => 0;
        w.options.getHeight = () => 0;
    }
}

function hideWidgetRow(w) {
    if (!w) return;
    const row = w.inputEl?.closest?.(".comfyui-widget") ?? w.inputEl?.parentElement;
    if (row) row.style.display = "none";
    w.computeSize = () => [0, -4];
    if (w.options) {
        w.options.getMinHeight = () => 0;
        w.options.getHeight = () => 0;
    }
}

function chainCallback(widget, fn) {
    if (!widget || widget._capSizeChained) return;
    const orig = widget.callback;
    widget.callback = function (...args) {
        const result = orig?.apply(this, args);
        fn.apply(this, args);
        return result;
    };
    widget._capSizeChained = true;
}

function setWidgetValue(widget, value) {
    if (!widget) return;
    if (widget.value === value) return;
    widget.value = value;
}

function hasValidSizeWidgets(node) {
    const w = getWidget(node, "custom_width");
    const h = getWidget(node, "custom_height");
    const c = getWidget(node, "count");
    return Number.isFinite(Number(w?.value))
        && Number.isFinite(Number(h?.value))
        && Number.isFinite(Number(c?.value))
        && Number(c.value) <= 256;
}

function repairLegacySizeValues(node, info) {
    const values = info?.widgets_values;
    if (!Array.isArray(values) || hasValidSizeWidgets(node)) return;
    if (values.length >= 7) {
        applyWidgetValuesByNames(node, WIDGET_NAMES, values.slice(1));
        if (hasValidSizeWidgets(node)) return;
    }
    applyWidgetValuesByNames(node, WIDGET_NAMES, values);
}

function ensureDefaultOrientation(node) {
    const w = getWidget(node, "orientation");
    if (!w) return;
    if (w.value !== "竖屏" && w.value !== "横屏") {
        w.value = DEFAULT_ORIENTATION;
    }
}

function applyComputedSize(node) {
    ensureDefaultOrientation(node);
    const aspect = getWidget(node, "aspect_ratio")?.value ?? "9:16";
    const resolution = getWidget(node, "resolution")?.value ?? "1K";
    const orientation = getWidget(node, "orientation")?.value ?? DEFAULT_ORIENTATION;
    const [width, height] = sizeFromRatio(aspect, resolution, orientation);
    setWidgetValue(getWidget(node, "custom_width"), width);
    setWidgetValue(getWidget(node, "custom_height"), height);
    node.setDirtyCanvas?.(true, true);
}

function updateOrientationSwitch(node, orientation) {
    const wrap = node._capSizeOrientWrap;
    if (!wrap) return;
    for (const btn of wrap.querySelectorAll(".cap-size-orient-opt")) {
        btn.classList.toggle("active", btn.dataset.orient === orientation);
    }
}

function setOrientation(node, orientation) {
    const w = getWidget(node, "orientation");
    if (!w) return;
    setWidgetValue(w, orientation);
    updateOrientationSwitch(node, orientation);
    applyComputedSize(node);
}

function layoutOrientSwitch(node) {
    const domWidget = getWidget(node, ORIENT_DOM);
    const wrap = node._capSizeOrientWrap ?? domWidget?.element;
    if (!wrap) return;
    positionOverlayAboveWidget(node, wrap, "aspect_ratio", { offsetY: -26, left: 6 });
}

function ensureOrientationSwitch(node) {
    const aspectWidget = getWidget(node, "aspect_ratio");
    if (!aspectWidget) return;

    hideWidgetRow(getWidget(node, "orientation"));

    let domWidget = getWidget(node, ORIENT_DOM);
    if (!domWidget) {
        ensureCapUiCss();

        const wrap = document.createElement("div");
        wrap.className = "cap-size-orient-wrap";

        const group = document.createElement("div");
        group.className = "cap-size-orient-switch";
        group.setAttribute("role", "group");
        group.setAttribute("aria-label", "方向");

        for (const [label, icon, title] of [
            ["竖屏", "↕", "竖屏"],
            ["横屏", "↔", "横屏"],
        ]) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "cap-size-orient-opt";
            btn.dataset.orient = label;
            btn.title = title;
            btn.textContent = icon;
            btn.addEventListener("click", () => setOrientation(node, label));
            group.appendChild(btn);
        }

        wrap.appendChild(group);
        node._capSizeOrientWrap = wrap;

        domWidget = node.addDOMWidget(ORIENT_DOM, ORIENT_DOM, wrap, {
            serialize: false,
            getMinHeight: () => 0,
            getHeight: () => 0,
        });
        collapseFloatingWidget(domWidget);
    }

    appendDomWidgetLast(node, domWidget);
    ensureDefaultOrientation(node);
    updateOrientationSwitch(node, getWidget(node, "orientation")?.value ?? DEFAULT_ORIENTATION);
    requestAnimationFrame(() => layoutOrientSwitch(node));
}

function hookOptionCallbacks(node) {
    if (node._capSizeHooked) return;
    node._capSizeHooked = true;

    chainCallback(getWidget(node, "aspect_ratio"), () => applyComputedSize(node));
    chainCallback(getWidget(node, "resolution"), () => applyComputedSize(node));
    chainCallback(getWidget(node, "orientation"), () => {
        updateOrientationSwitch(node, getWidget(node, "orientation")?.value ?? DEFAULT_ORIENTATION);
        applyComputedSize(node);
    });
}

function setupNode(node, info = null, { initialSync = false } = {}) {
    const aspectWidget = getWidget(node, "aspect_ratio");
    if (!aspectWidget) return false;
    if (info) repairLegacySizeValues(node, info);
    const snapshot = captureWidgetValues(node);
    ensureDefaultOrientation(node);
    ensureOrientationSwitch(node);
    restoreWidgetValues(node, snapshot);
    hookOptionCallbacks(node);
    if (initialSync) {
        applyComputedSize(node);
    } else if (!hasValidSizeWidgets(node)) {
        applyComputedSize(node);
    } else {
        updateOrientationSwitch(node, getWidget(node, "orientation")?.value ?? DEFAULT_ORIENTATION);
    }
    layoutOrientSwitch(node);
    return true;
}

function trySetupWhenReady(node, info = null, { initialSync = false, tries = 0 } = {}) {
    if (setupNode(node, info, { initialSync })) return;
    if (tries < 40) {
        setTimeout(() => trySetupWhenReady(node, info, { initialSync, tries: tries + 1 }), 50);
    }
}

app.registerExtension({
    name: "Capricorncd.SizeSettings",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_CLASS) return;

        const configure = nodeType.prototype.configure;
        nodeType.prototype.configure = function (info) {
            const result = configure?.apply(this, arguments);
            trySetupWhenReady(this, info);
            return result;
        };

        const onAfterGraphConfigured = nodeType.prototype.onAfterGraphConfigured;
        nodeType.prototype.onAfterGraphConfigured = function () {
            onAfterGraphConfigured?.apply(this, arguments);
            trySetupWhenReady(this);
        };
    },

    nodeCreated(node) {
        if (node.comfyClass !== NODE_CLASS) return;
        if (app.configuringGraph) return;
        trySetupWhenReady(node, null, { initialSync: true });
    },
});
