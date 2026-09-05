/** Shared UI helpers: stylesheet loading, buttons. */

export const EXT_PREFIX = "ComfyUI-Capricorncd-Tools";

const _loaded = new Set();

/**
 * @param {string} filename  CSS file under the extension js/ folder.
 * @param {string} [id]  Optional link element id.
 */
export function loadExtensionCss(filename, id) {
    const linkId = id || `cap-css-${filename.replace(/\W/g, "-")}`;
    const href = `/extensions/${EXT_PREFIX}/${filename}?v=20260906-confirm-dialog`;
    const existing = document.getElementById(linkId);
    if (existing) {
        if (existing.getAttribute("href") !== href) existing.setAttribute("href", href);
        _loaded.add(linkId);
        return;
    }
    if (_loaded.has(linkId)) return;
    const link = document.createElement("link");
    link.id = linkId;
    link.rel = "stylesheet";
    link.href = href;
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

/**
 * @param {string} icon  SVG markup
 * @param {{ variant?: "" | "primary" | "danger", title?: string, onClick?: () => void, needTarget?: boolean }} [opts]
 */
export function mkUiIconBtn(icon, { variant = "", title = "", onClick, needTarget = false } = {}) {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = icon;
    const cls = ["cap-ui-icon-btn"];
    if (variant === "primary") cls.push("cap-ui-icon-btn-primary");
    else if (variant === "danger") cls.push("cap-ui-icon-btn-danger");
    b.className = cls.join(" ");
    if (title) b.title = title;
    if (needTarget) b.dataset.capNeedTarget = "1";
    if (onClick) b.addEventListener("click", onClick);
    return b;
}

export function showCapConfirm(message, { title = "Confirm", confirmLabel = "OK", cancelLabel = "Cancel" } = {}) {
    ensureCapUiCss();
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "cap-ui-overlay cap-ui-confirm-overlay";
        overlay.innerHTML = `
          <div class="cap-ui-confirm-dialog" role="alertdialog" aria-modal="true">
            <div class="cap-ui-confirm-header">
              <strong></strong>
              <button type="button" class="cap-ui-confirm-close" aria-label="${cancelLabel}">×</button>
            </div>
            <div class="cap-ui-confirm-message"></div>
            <div class="cap-ui-confirm-actions">
              <button type="button" class="cap-ui-btn cap-ui-confirm-cancel"></button>
              <button type="button" class="cap-ui-btn cap-ui-btn-danger cap-ui-confirm-ok"></button>
            </div>
          </div>`;
        const dialog = overlay.querySelector(".cap-ui-confirm-dialog");
        const header = overlay.querySelector(".cap-ui-confirm-header");
        const cancel = overlay.querySelector(".cap-ui-confirm-cancel");
        const ok = overlay.querySelector(".cap-ui-confirm-ok");
        header.querySelector("strong").textContent = title;
        overlay.querySelector(".cap-ui-confirm-message").textContent = message;
        cancel.textContent = cancelLabel;
        ok.textContent = confirmLabel;

        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            window.removeEventListener("keydown", onKeyDown, true);
            overlay.remove();
            resolve(value);
        };
        const onKeyDown = (event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            finish(false);
        };
        overlay.addEventListener("click", (event) => {
            if (event.target === overlay) finish(false);
        });
        overlay.querySelector(".cap-ui-confirm-close").addEventListener("click", () => finish(false));
        cancel.addEventListener("click", () => finish(false));
        ok.addEventListener("click", () => finish(true));
        header.addEventListener("pointerdown", (event) => {
            if (event.button !== 0 || event.target.closest("button")) return;
            const rect = dialog.getBoundingClientRect();
            const dx = event.clientX - rect.left;
            const dy = event.clientY - rect.top;
            dialog.style.position = "fixed";
            dialog.style.left = `${rect.left}px`;
            dialog.style.top = `${rect.top}px`;
            const move = (moveEvent) => {
                const left = Math.max(0, Math.min(window.innerWidth - dialog.offsetWidth, moveEvent.clientX - dx));
                const top = Math.max(0, Math.min(window.innerHeight - dialog.offsetHeight, moveEvent.clientY - dy));
                dialog.style.left = `${left}px`;
                dialog.style.top = `${top}px`;
            };
            const up = () => {
                window.removeEventListener("pointermove", move, true);
                window.removeEventListener("pointerup", up, true);
            };
            window.addEventListener("pointermove", move, true);
            window.addEventListener("pointerup", up, true);
        });
        document.body.appendChild(overlay);
        window.addEventListener("keydown", onKeyDown, true);
        cancel.focus();
    });
}
