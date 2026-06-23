/** Shared rich prompt editor: Ctrl+/ comment toggle + syntax mirror. */

export function escapeHtml(t) {
    return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const FALLBACK_TEXT_COLOR = "#d4d4d4";

function resolveTextColor(cs) {
    const c = cs?.color ?? "";
    if (!c || c === "transparent" || c === "rgba(0, 0, 0, 0)") {
        return FALLBACK_TEXT_COLOR;
    }
    return c;
}

function applyTextareaOverlayStyle(ta, textColor) {
    ta._capRichTextColor = textColor;
    ta.style.color = "transparent";
    ta.style.webkitTextFillColor = "transparent";
    ta.style.caretColor = textColor;
    ta.style.background = "transparent";
}

function refreshMirrorColors(ta) {
    const m = ta._capMirror;
    if (!m) return;
    const textColor = ta._capRichTextColor || resolveTextColor(getComputedStyle(ta));
    m.style.color = textColor;
}
function formatLineHtml(line) {
    const isComment = line.startsWith("#");
    let content = escapeHtml(line).replace(/ {2}/g, " &nbsp;");
    if (!content) content = "\u00a0";
    if (isComment) return `<span class="cap-rich-comment" style="opacity:0.4">${content}</span>`;
    return content;
}

export function updateRichPromptMirror(ta) {
    const m = ta?._capMirror;
    if (!m) return;
    const lines = ta.value.split("\n");
    m.innerHTML =
        lines.map(formatLineHtml).join("<br>") +
        (ta.value.endsWith("\n") ? "<br>" : "");
    m.scrollTop = ta.scrollTop;
    m.scrollLeft = ta.scrollLeft;
}

function syncMirrorLayout(ta) {
    const m = ta._capMirror;
    if (!m) return;
    const cs = getComputedStyle(ta);
    const copy = [
        "fontFamily", "fontSize", "fontWeight", "fontStyle",
        "lineHeight", "letterSpacing", "wordSpacing",
        "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
        "textIndent", "tabSize", "whiteSpace", "wordBreak", "overflowWrap",
    ];
    for (const key of copy) m.style[key] = cs[key];
    m.style.boxSizing = cs.boxSizing;
    refreshMirrorColors(ta);

    if (ta._capRichMode === "overlay" || ta._capRichMode === "widget") {
        const sb = Math.max(0, ta.offsetWidth - ta.clientWidth);
        m.style.top = "0";
        m.style.left = "0";
        m.style.bottom = "0";
        m.style.right = `${sb}px`;
        m.style.width = "";
        m.style.height = "";
    }
}

function applyMirrorSurface(mirror, cs, mode) {
    const bg = cs.backgroundColor;
    const isTransparentBg = !bg || bg === "transparent" || bg === "rgba(0, 0, 0, 0)";
    mirror.style.background = (mode === "overlay" || isTransparentBg) ? "transparent" : bg;
    mirror.style.border = mode === "overlay" ? "none" : cs.border;
    mirror.style.borderRadius = mode === "overlay" ? "0" : cs.borderRadius;
}

function ensureMirror(ta, mode) {
    if (ta._capMirror || !ta.parentNode) return !!ta._capMirror;

    const cs = getComputedStyle(ta);
    const textColor = resolveTextColor(cs);

    const mirror = document.createElement(mode === "widget" ? "pre" : "div");
    mirror.className = "cap-rich-prompt-mirror";
    Object.assign(mirror.style, {
        margin: "0",
        overflow: "hidden",
        pointerEvents: "none",
        color: textColor,
        whiteSpace: "pre-wrap",
        wordWrap: "break-word",
        wordBreak: "break-word",
    });
    applyMirrorSurface(mirror, cs, mode);

    if (mode === "overlay") {
        const wrap = ta.parentElement;
        wrap.classList.add("cat-prompt-rich-wrap");
        Object.assign(mirror.style, {
            position: "absolute",
            zIndex: "1",
        });
        wrap.insertBefore(mirror, ta);
        Object.assign(ta.style, {
            position: "relative",
            zIndex: "2",
            borderColor: "transparent",
        });
        applyTextareaOverlayStyle(ta, textColor);
    } else {
        const parent = ta.parentNode;
        const pcs = getComputedStyle(parent);
        if (pcs.position === "static") parent.style.position = "relative";
        Object.assign(mirror.style, {
            position: "absolute",
            left: "0",
            top: "0",
            width: "100%",
            height: "100%",
            zIndex: "0",
        });
        parent.insertBefore(mirror, ta);
        Object.assign(ta.style, {
            position: "relative",
            zIndex: "1",
        });
        applyTextareaOverlayStyle(ta, textColor);
    }

    ta._capMirror = mirror;
    if (!ta._capRichMode) ta._capRichMode = mode;
    syncMirrorLayout(ta);
    if (!ta._capMirrorResizeObs) {
        ta._capMirrorResizeObs = new ResizeObserver(() => {
            syncMirrorLayout(ta);
            updateRichPromptMirror(ta);
        });
        ta._capMirrorResizeObs.observe(ta);
    }
    updateRichPromptMirror(ta);
    return true;
}

function tryEnsureMirror(ta, mode, tries = 0) {
    if (ta._capMirror) return true;
    if (ta.parentNode) return ensureMirror(ta, mode);
    if (tries >= 100) return false;
    setTimeout(() => tryEnsureMirror(ta, mode, tries + 1), 50);
    return false;
}

export function ensureRichPromptMirror(ta, mode = "overlay") {
    if (!ta?.parentNode) return false;
    if (!ta._capRichMode) ta._capRichMode = mode;
    if (ta._capMirror) {
        syncMirrorLayout(ta);
        updateRichPromptMirror(ta);
        return true;
    }
    return ensureMirror(ta, mode);
}

function toggleComment(ta) {
    const text = ta.value;
    const selStart = ta.selectionStart;
    const selEnd = ta.selectionEnd;

    const lineStart = text.lastIndexOf("\n", selStart - 1) + 1;
    let effEnd = selEnd;
    if (effEnd > selStart && text[effEnd - 1] === "\n") effEnd--;
    let lineEnd = text.indexOf("\n", effEnd);
    if (lineEnd === -1) lineEnd = text.length;

    const before = text.slice(0, lineStart);
    const region = text.slice(lineStart, lineEnd);
    const after = text.slice(lineEnd);
    const lines = region.split("\n");
    const allC = lines.every(l => l.startsWith("#"));
    const newLines = allC ? lines.map(l => l.slice(1)) : lines.map(l => "#" + l);

    ta.value = before + newLines.join("\n") + after;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    updateRichPromptMirror(ta);

    const delta = allC ? -1 : 1;
    ta.setSelectionRange(
        Math.max(lineStart, selStart + delta),
        Math.max(lineStart, selEnd + delta * lines.length),
    );
}

export function detachRichPromptHandler(ta) {
    if (!ta) return;
    if (ta._capMirrorResizeObs) {
        ta._capMirrorResizeObs.disconnect();
        ta._capMirrorResizeObs = null;
    }
    ta._capMirrorObserver?.disconnect();
    ta._capMirrorObserver = null;
    ta._capMirror?.remove();
    ta._capMirror = null;
    ta.parentElement?.classList.remove("cat-prompt-rich-wrap");
    if (ta._capRichKeydown) {
        window.removeEventListener("keydown", ta._capRichKeydown, true);
        ta._capRichKeydown = null;
    }
    ta._capRichAttached = false;
    ta._capRichMode = null;
    ta.classList.remove("cap-rich-active");
    ta.style.color = "";
    ta.style.caretColor = "";
    ta.style.background = "";
    ta.style.borderColor = "";
    ta.style.position = "";
    ta.style.zIndex = "";
    ta.style.webkitTextFillColor = "";
}

export function syncRichPromptEnabled(ta, enabled) {
    if (!ta) return;
    const mode = ta._capRichMode || "overlay";
    if (enabled) ensureRichPromptMirror(ta, mode);

    if (!ta._capMirror) {
        ta.classList.remove("cap-rich-active");
        return;
    }

    ta.classList.toggle("cap-rich-active", !!enabled);
    ta.style.caretColor = enabled ? "#cbd5e0" : "";
    if (mode === "overlay") {
        ta.style.background = "transparent";
        ta.style.borderColor = enabled ? "transparent" : "";
    }
    syncMirrorLayout(ta);
    updateRichPromptMirror(ta);
}

export function setRichPromptValue(ta, value, enabled = true) {
    if (!ta) return;
    const mode = ta._capRichMode || "overlay";
    ta.value = value ?? "";
    if (enabled) {
        ensureRichPromptMirror(ta, mode);
        syncRichPromptEnabled(ta, true);
    } else {
        syncRichPromptEnabled(ta, false);
        updateRichPromptMirror(ta);
    }
}

export function attachRichPromptHandler(ta, { mode = "widget" } = {}) {
    if (!ta || ta._capRichAttached) return;
    ta._capRichAttached = true;
    ta._capRichMode = mode;

    const onKeydown = (e) => {
        if (!document.contains(ta)) {
            detachRichPromptHandler(ta);
            return;
        }
        if (e.target !== ta) return;

        const mod = e.ctrlKey || e.metaKey;
        if (mod && (e.key === "/" || e.code === "Slash")) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();
            toggleComment(ta);
        }
    };
    ta._capRichKeydown = onKeydown;
    window.addEventListener("keydown", onKeydown, true);

    ta.addEventListener("input", () => updateRichPromptMirror(ta));
    ta.addEventListener("scroll", () => {
        if (!ta._capMirror) return;
        ta._capMirror.scrollTop = ta.scrollTop;
        ta._capMirror.scrollLeft = ta.scrollLeft;
    });
    ta.addEventListener("paste", (e) => {
        e.preventDefault();
        const txt = (e.clipboardData || window.clipboardData).getData("text/plain");
        const s = ta.selectionStart;
        const end = ta.selectionEnd;
        ta.value = ta.value.slice(0, s) + txt + ta.value.slice(end);
        ta.setSelectionRange(s + txt.length, s + txt.length);
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        updateRichPromptMirror(ta);
    });

    if (ta.parentNode) ensureMirror(ta, mode);
    else tryEnsureMirror(ta, mode);
}

export function resolvePromptTextarea(widget) {
    if (!widget) return null;
    const direct = widget.inputEl ?? widget.element;
    if (direct instanceof HTMLTextAreaElement) return direct;
    return direct?.querySelector?.("textarea.comfy-multiline-input")
        ?? direct?.querySelector?.("textarea")
        ?? null;
}

export function bindRichPromptWidget(widget, { mode = "widget" } = {}) {
    const ta = resolvePromptTextarea(widget);
    if (!ta) return false;
    if (!ta._capRichAttached) attachRichPromptHandler(ta, { mode });
    else if (!ta._capMirror) tryEnsureMirror(ta, mode);
    return true;
}
