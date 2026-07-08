/** Shared UI helpers: stylesheet loading, buttons. */

export const EXT_PREFIX = "ComfyUI-Capricorncd-Tools";

const _loaded = new Set();

/**
 * @param {string} filename  CSS file under the extension js/ folder.
 * @param {string} [id]  Optional link element id.
 */
export function loadExtensionCss(filename, id) {
    const linkId = id || `cap-css-${filename.replace(/\W/g, "-")}`;
    if (_loaded.has(linkId) || document.getElementById(linkId)) {
        _loaded.add(linkId);
        return;
    }
    const link = document.createElement("link");
    link.id = linkId;
    link.rel = "stylesheet";
    link.href = `/extensions/${EXT_PREFIX}/${filename}`;
    document.head.appendChild(link);
    _loaded.add(linkId);
}

export function ensureCapUiCss() {
    loadExtensionCss("cap_ui.css", "cap-ui-styles");
}

/**
 * @param {string} label
 * @param {{ variant?: "" | "primary" | "danger", title?: string, onClick?: () => void }} [opts]
 */
export function mkUiBtn(label, { variant = "", title = "", onClick, needTarget = false } = {}) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    const cls = ["cap-ui-btn"];
    if (variant === "primary") cls.push("cap-ui-btn-primary");
    else if (variant === "danger") cls.push("cap-ui-btn-danger");
    b.className = cls.join(" ");
    if (title) b.title = title;
    if (needTarget) b.dataset.capNeedTarget = "1";
    if (onClick) b.addEventListener("click", onClick);
    return b;
}
