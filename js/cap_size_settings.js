import { app } from "../../scripts/app.js";
import {
    applyWidgetValuesByNames,
    captureWidgetValues,
    restoreWidgetValues,
} from "./cap_widget_persist.js";

const NODE_CLASS = "CAP_SizeSettings";
const DEFAULT_SIZE = "720x1280 (9:16)";
const DEFAULT_ORIENTATION = "纵向";
const WIDGET_NAMES = [
    "size",
    "scale",
    "lock_aspect",
    "orientation",
    "custom_width",
    "custom_height",
    "fps",
    "count",
];

const SIZE_BASE = {
    "704x1280 (11:20)": [704, 1280],
    "720x1280 (9:16)": [720, 1280],
    "768x1024 (3:4)": [768, 1024],
    "768x1280 (3:5)": [768, 1280],
    "768x1344 (4:7)": [768, 1344],
    "1024x1024 (1:1)": [1024, 1024],
    "1080x2560 (9:21)": [1080, 2560],
};

function getWidget(node, name) {
    return node.widgets?.find((w) => w.name === name) ?? null;
}

function align8(value) {
    return Math.max(8, Math.round(Number(value) / 8) * 8);
}

function sizeFromPreset(size, scale, orientation) {
    let [width, height] = SIZE_BASE[size] ?? SIZE_BASE[DEFAULT_SIZE];
    if (orientation === "横向" && width !== height) {
        [width, height] = [height, width];
    }
    const s = Math.max(0.01, Number(scale) || 1);
    return [align8(width * s), align8(height * s)];
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

function isLocked(node) {
    return getWidget(node, "lock_aspect")?.value !== false;
}

function currentRatio(node) {
    const w = Math.max(1, Number(getWidget(node, "custom_width")?.value) || 1);
    const h = Math.max(1, Number(getWidget(node, "custom_height")?.value) || 1);
    return w / h;
}

function hasValidSizeWidgets(node) {
    const w = getWidget(node, "custom_width");
    const h = getWidget(node, "custom_height");
    const c = getWidget(node, "count");
    const fps = getWidget(node, "fps");
    return Number.isFinite(Number(w?.value))
        && Number.isFinite(Number(h?.value))
        && Number.isFinite(Number(c?.value))
        && Number.isFinite(Number(fps?.value))
        && Number(c.value) <= 256;
}

function normalizeOrientation(value) {
    if (value === "横向" || value === "横屏" || value === "水平") return "横向";
    return "纵向";
}

function repairLegacySizeValues(node, info) {
    const values = info?.widgets_values;
    if (!Array.isArray(values) || hasValidSizeWidgets(node)) return;

    // New order: size, scale, lock_aspect, orientation, width, height, fps, count
    if (values.length >= 8 && typeof values[0] === "string" && String(values[0]).includes("x")) {
        applyWidgetValuesByNames(node, WIDGET_NAMES, values);
        if (hasValidSizeWidgets(node)) return;
    }

    // Old order: aspect_ratio, resolution, orientation, width, height, count
    if (values.length >= 6) {
        const orient = normalizeOrientation(values[2]);
        const width = values[3];
        const height = values[4];
        const count = values[5];
        applyWidgetValuesByNames(node, WIDGET_NAMES, [
            DEFAULT_SIZE,
            1.0,
            true,
            orient,
            width,
            height,
            24.0,
            count,
        ]);
    }
}

function applyComputedSize(node) {
    const size = getWidget(node, "size")?.value ?? DEFAULT_SIZE;
    const scale = getWidget(node, "scale")?.value ?? 1.0;
    const orientation = normalizeOrientation(
        getWidget(node, "orientation")?.value ?? DEFAULT_ORIENTATION,
    );
    setWidgetValue(getWidget(node, "orientation"), orientation);
    const [width, height] = sizeFromPreset(size, scale, orientation);
    setWidgetValue(getWidget(node, "custom_width"), width);
    setWidgetValue(getWidget(node, "custom_height"), height);
    node._capSizeRatio = width / Math.max(1, height);
    node.setDirtyCanvas?.(true, true);
}

function onWidthChanged(node) {
    if (node._capSizeSyncing || !isLocked(node)) return;
    node._capSizeSyncing = true;
    try {
        const width = align8(getWidget(node, "custom_width")?.value ?? 720);
        setWidgetValue(getWidget(node, "custom_width"), width);
        const ratio = node._capSizeRatio || currentRatio(node);
        const height = align8(width / Math.max(1e-6, ratio));
        setWidgetValue(getWidget(node, "custom_height"), height);
        node._capSizeRatio = width / Math.max(1, height);
        node.setDirtyCanvas?.(true, true);
    } finally {
        node._capSizeSyncing = false;
    }
}

function onHeightChanged(node) {
    if (node._capSizeSyncing || !isLocked(node)) return;
    node._capSizeSyncing = true;
    try {
        const height = align8(getWidget(node, "custom_height")?.value ?? 1280);
        setWidgetValue(getWidget(node, "custom_height"), height);
        const ratio = node._capSizeRatio || currentRatio(node);
        const width = align8(height * ratio);
        setWidgetValue(getWidget(node, "custom_width"), width);
        node._capSizeRatio = Math.max(1, width) / Math.max(1, height);
        node.setDirtyCanvas?.(true, true);
    } finally {
        node._capSizeSyncing = false;
    }
}

function onLockChanged(node) {
    if (isLocked(node)) {
        node._capSizeRatio = currentRatio(node);
    }
}

function removeLegacyOrientUi(node) {
    node._capSizeOrientWrap?.remove?.();
    node._capSizeOrientWrap = null;
    const dom = getWidget(node, "cap_size_orient");
    if (dom?.element) {
        dom.element.remove?.();
        dom.computedHeight = 0;
        dom.computeSize = () => [0, -4];
    }
}

function hookOptionCallbacks(node) {
    if (node._capSizeHooked) return;
    node._capSizeHooked = true;

    chainCallback(getWidget(node, "size"), () => applyComputedSize(node));
    chainCallback(getWidget(node, "scale"), () => applyComputedSize(node));
    chainCallback(getWidget(node, "orientation"), () => applyComputedSize(node));
    chainCallback(getWidget(node, "lock_aspect"), () => onLockChanged(node));
    chainCallback(getWidget(node, "custom_width"), () => onWidthChanged(node));
    chainCallback(getWidget(node, "custom_height"), () => onHeightChanged(node));
}

function setupNode(node, info = null, { initialSync = false } = {}) {
    if (!getWidget(node, "size") && !getWidget(node, "aspect_ratio")) return false;
    if (!getWidget(node, "custom_width")) return false;

    if (info) repairLegacySizeValues(node, info);
    const snapshot = captureWidgetValues(node);
    removeLegacyOrientUi(node);
    restoreWidgetValues(node, snapshot);
    hookOptionCallbacks(node);

    const orient = getWidget(node, "orientation");
    if (orient) setWidgetValue(orient, normalizeOrientation(orient.value));

    if (initialSync) {
        applyComputedSize(node);
    } else if (!hasValidSizeWidgets(node)) {
        applyComputedSize(node);
    } else {
        node._capSizeRatio = currentRatio(node);
    }
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
