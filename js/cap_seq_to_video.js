import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_CLASS = "CAP_SeqToVideo";
const EXT_PREFIX = "ComfyUI-Capricorncd-Tools";
const PLAYER_H   = 200;   // px

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

        // ── node created ────────────────────────────────────────────────────
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            this._stvRoot    = null;
            this._stvVideo   = null;
            this._stvHolder  = null;
            this._stvCurrent = null;
            _buildPlayer(this);
        };

        // ── execution result ────────────────────────────────────────────────
        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (output) {
            onExecuted?.apply(this, arguments);
            const info = output?.video?.[0];
            if (!info || !this._stvRoot) return;
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
    root.className = "stv-root";
    root.style.height = `${PLAYER_H}px`;

    const holder = document.createElement("div");
    holder.className = "stv-placeholder";
    holder.textContent = "等待合成…";
    root.appendChild(holder);

    const w = node.addDOMWidget("stv_ui", "stv_player", root, {
        hideOnZoom: false,
        getMinHeight: () => PLAYER_H,
        getHeight:    () => PLAYER_H,
    });
    w.serialize = false;

    node._stvRoot   = root;
    node._stvHolder = holder;

    // Async ffmpeg check — update placeholder if not found
    checkFfmpeg().then(status => {
        if (!node._stvRoot) return;          // node already removed
        if (node._stvVideo) return;          // video already playing, don't overwrite
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
    video.loop        = true;
    video.muted       = true;
    video.autoplay    = false;
    video.playsInline = true;

    video.src = url;

    video.addEventListener("mouseenter", () => { video.muted = false; });
    video.addEventListener("mouseleave", () => { video.muted = true; });
    video.addEventListener("canplay", () => { video.play().catch(() => {}); }, { once: true });

    root.appendChild(video);
    node._stvVideo = video;
}

function _destroyPlayer(node) {
    node._stvVideo?.pause();
    node._stvVideo?.removeAttribute("src");
    node._stvVideo   = null;
    node._stvRoot    = null;
    node._stvCurrent = null;
}

console.log("[CAP_SeqToVideo] extension loaded");
