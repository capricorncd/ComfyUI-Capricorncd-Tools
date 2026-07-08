import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { bindCanvasWheelPassthrough } from "./cap_canvas_wheel.js";

const NODE_CLASS     = "CAP_SeqToVideo";
const EXT_PREFIX     = "ComfyUI-Capricorncd-Tools";
const PLAYER_H       = 200;  // placeholder / initial height in px
const MIN_NODE_WIDTH = 300;  // px

function loadCss() {
    if (document.getElementById("stv-styles")) return;
    const link = document.createElement("link");
    link.id   = "stv-styles";
    link.rel  = "stylesheet";
    link.href = `/extensions/${EXT_PREFIX}/cap_seq_to_video.css`;
    document.head.appendChild(link);
}

function videoUrl(info) {
    return api.apiURL(
        `/view?filename=${encodeURIComponent(info.filename)}&type=${info.type}&subfolder=${encodeURIComponent(info.subfolder ?? "")}`
    );
}

function clampWidth(size) {
    return [Math.max(size[0], MIN_NODE_WIDTH), size[1]];
}

function clearStvWidgetWidth(node) {
    const w = node._stvWidget;
    if (w && w.width != null) delete w.width;
}

// ── ffmpeg status — checked once, result cached ────────────────────────────

let _ffmpegPromise = null;

async function checkFfmpeg() {
    if (_ffmpegPromise) return _ffmpegPromise;
    _ffmpegPromise = fetch(api.apiURL("/cap/ffmpeg_status"))
        .then(r => r.ok ? r.json() : { available: false, version: null })
        .catch(() => ({ available: false, version: null }));
    return _ffmpegPromise;
}

// ── Extension ──────────────────────────────────────────────────────────────

app.registerExtension({
    name: "Capricorncd.SeqToVideo",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_CLASS) return;
        loadCss();

        // ── prevent automatic layout from narrowing the node ────────────────
        nodeType.prototype.setSize = function (size) {
            const isUserResize = app.canvas?.resizing_node === this;
            if (!isUserResize) {
                const curW = this.size?.[0] ?? 0;
                if (curW > 0 && size[0] < curW) size = [curW, size[1]];
            }
            this.size = clampWidth(size);
            this.onResize?.(this.size);
        };

        const computeSize = nodeType.prototype.computeSize;
        nodeType.prototype.computeSize = function (out) {
            const size = computeSize?.apply(this, arguments) ?? (out ? [...out] : [0, 0]);
            return clampWidth(size);
        };

        const configure = nodeType.prototype.configure;
        nodeType.prototype.configure = function (info) {
            configure?.apply(this, arguments);
            if ((this.size?.[0] ?? 0) < MIN_NODE_WIDTH) {
                this.setSize([MIN_NODE_WIDTH, this.size[1]]);
            }
            clearStvWidgetWidth(this);
            // Restore last video after workflow reload / browser refresh
            const vi = info?.properties?.stv_video;
            if (vi && !this._stvCurrent) {
                this._stvLastVideoInfo = vi;
                const url = videoUrl(vi);
                this._stvCurrent = url;
                requestAnimationFrame(() => {
                    if (this._stvRoot && !this._stvVideo) _loadVideo(this, url);
                });
            }
        };

        // Persist last video info in workflow JSON
        const onSerialize = nodeType.prototype.onSerialize;
        nodeType.prototype.onSerialize = function (info) {
            onSerialize?.apply(this, arguments);
            if (!info.properties) info.properties = {};
            if (this._stvLastVideoInfo) {
                info.properties.stv_video = this._stvLastVideoInfo;
            }
        };

        const onSelected = nodeType.prototype.onSelected;
        nodeType.prototype.onSelected = function () {
            onSelected?.apply(this, arguments);
            clearStvWidgetWidth(this);
        };

        // ── node created ────────────────────────────────────────────────────
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            this._stvRoot          = null;
            this._stvVideo         = null;
            this._stvHolder        = null;
            this._stvWidget        = null;
            this._stvCurrent       = null;
            this._stvLastVideoInfo = null;
            this._stvPlayerH       = PLAYER_H;
            this._stvResizeObs     = null;
            _buildPlayer(this);
        };

        // ── execution result ────────────────────────────────────────────────
        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (output) {
            onExecuted?.apply(this, arguments);
            const info = output?.video?.[0];
            if (!info || !this._stvRoot) return;
            this._stvLastVideoInfo = info;  // persist across refresh
            const url = videoUrl(info);
            if (url === this._stvCurrent) return;
            this._stvCurrent = url;
            _loadVideo(this, url);
        };

        // ── cleanup ─────────────────────────────────────────────────────────
        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            _destroyPlayer(this);
            onRemoved?.apply(this, arguments);
        };
    },
});

// ── Player helpers ─────────────────────────────────────────────────────────

function _buildPlayer(node) {
    const root = document.createElement("div");
    root.className = "stv-root";  // no stv-loaded → placeholder CSS applies
    bindCanvasWheelPassthrough(root);

    const holder = document.createElement("div");
    holder.className = "stv-placeholder";
    holder.textContent = "等待合成…";
    root.appendChild(holder);

    const w = node.addDOMWidget("stv_ui", "stv_player", root, {
        hideOnZoom: false,
        getMinHeight: () => node._stvPlayerH,
        getHeight:    () => node._stvPlayerH,
    });
    w.serialize = false;

    // Prevent stale widget.width from narrowing the player when node is selected
    Object.defineProperty(w, "width", {
        get() { return undefined; },
        set() {},
        enumerable: true,
        configurable: true,
    });

    // ── ResizeObserver: update getHeight when video changes root size ───────
    // Use current node width explicitly — never let computeSize() dictate the width,
    // as its base implementation returns LiteGraph's minimum (280px) when widgets
    // don't report a fixed size, which would shrink the node on every DOM resize.
    const ro = new ResizeObserver(() => {
        const h = root.offsetHeight;
        if (h > 0 && h !== node._stvPlayerH) {
            node._stvPlayerH = h;
            const curW = node.size?.[0] ?? MIN_NODE_WIDTH;
            const newH = (node.computeSize?.() ?? [curW, h])[1];
            node.setSize([curW, newH]);
            app.graph?.setDirtyCanvas(true, true);
        }
    });
    ro.observe(root);
    node._stvResizeObs = ro;

    node._stvRoot   = root;
    node._stvHolder = holder;
    node._stvWidget = w;

    // Async ffmpeg check — update placeholder if not found
    checkFfmpeg().then(status => {
        if (!node._stvRoot) return;
        if (node._stvVideo) return;
        if (!status.available) {
            _showError(node, "未检测到 ffmpeg，请安装后重启 ComfyUI");
        }
    });
}

function _showError(node, message) {
    const root = node._stvRoot;
    if (!root) return;
    node._stvHolder?.remove();

    const banner = document.createElement("div");
    banner.className = "stv-error";
    banner.innerHTML =
        `<span class="stv-error-icon">✕</span>` +
        `<span>${message}</span>`;
    root.appendChild(banner);
    node._stvHolder = banner;
}

function _loadVideo(node, url) {
    const root = node._stvRoot;
    if (!root) return;

    node._stvVideo?.remove();
    node._stvHolder?.remove();
    node._stvHolder = null;

    const video = document.createElement("video");
    video.className   = "stv-video";
    bindCanvasWheelPassthrough(video);
    video.loop        = true;
    video.muted       = true;   // start muted per browser autoplay policy
    video.autoplay    = false;
    video.playsInline = true;

    // Hover unmute — attach directly to <video> (same pattern as VideoHelperSuite)
    video.onmouseenter = () => { video.muted = false; video.volume = 1; };
    video.onmouseleave = () => { video.muted = true; };

    video.src = url;
    video.addEventListener("canplay", () => { video.play().catch(() => {}); }, { once: true });

    // Switch root from placeholder layout to auto-height layout
    root.classList.add("stv-loaded");
    root.appendChild(video);
    node._stvVideo = video;
}

function _destroyPlayer(node) {
    node._stvResizeObs?.disconnect();
    node._stvResizeObs = null;
    node._stvVideo?.pause();
    node._stvVideo?.removeAttribute("src");
    node._stvVideo   = null;
    node._stvRoot    = null;
    node._stvWidget  = null;
    node._stvCurrent = null;
}

console.log("[CAP_SeqToVideo] extension loaded");
