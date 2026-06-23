/** Shared rich prompt editor: Ctrl+/ comment toggle + syntax mirror. */

export function escapeHtml(t) {
    return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatLineHtml(line) {
    const isComment = line.startsWith("#");
    const style = isComment ? "color:#7a8494;font-style:italic;opacity:0.75;" : "";
    let content = escapeHtml(line).replace(/ {2}/g, " &nbsp;");
    if (!content) content = "&nbsp;";
    return `<div style="${style}">${content}</div>`;
}

export function updateRichPromptMirror(ta) {
    const m = ta?._capMirror;
    if (!m) return;
    const lines = ta.value.split("\n");
    m.innerHTML =
        lines.map(formatLineHtml).join("") +
        (ta.value.endsWith("\n") ? "<div>&nbsp;</div>" : "");
    m.scrollTop = ta.scrollTop;
}

function ensureMirror(ta, mode) {
    if (ta._capMirror || !ta.parentNode) return;

    const cs = getComputedStyle(ta);
    const textColor = cs.color;
    const bgColor = cs.backgroundColor;

    const mirror = document.createElement("pre");
    mirror.className = "cap-rich-prompt-mirror";
    Object.assign(mirror.style, {
        margin: "0",
        padding: cs.padding,
        overflow: "hidden",
        whiteSpace: "pre-wrap",
        wordWrap: "break-word",
        wordBreak: "break-word",
        pointerEvents: "none",
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        lineHeight: cs.lineHeight,
        letterSpacing: cs.letterSpacing,
        boxSizing: "border-box",
        color: textColor,
        borderRadius: cs.borderRadius,
        border: cs.border,
    });

    if (mode === "overlay") {
        const wrap = ta.parentElement;
        wrap.style.position = "relative";
        Object.assign(mirror.style, {
            position: "absolute",
            inset: "0",
            width: "100%",
            height: "100%",
            border: "none",
            background: "transparent",
        });
        wrap.insertBefore(mirror, ta);
        ta.style.position = "relative";
        ta.style.zIndex = "1";
    } else {
        Object.assign(mirror.style, {
            position: ta.style.position || "absolute",
            left: ta.style.left,
            top: ta.style.top,
            width: "100%",
            height: "100%",
        });
        ta.parentNode.insertBefore(mirror, ta);

        const syncPos = () => {
            mirror.style.left = ta.style.left;
            mirror.style.top = ta.style.top;
        };
        syncPos();
        const mo = new MutationObserver(syncPos);
        mo.observe(ta, { attributes: true, attributeFilter: ["style"] });
        ta._capMirrorObserver = mo;
    }

    ta._capMirror = mirror;
    ta.style.color = "transparent";
    ta.style.caretColor = textColor;
    ta.style.background = bgColor;
    updateRichPromptMirror(ta);
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
    ta._capMirrorObserver?.disconnect();
    ta._capMirrorObserver = null;
    ta._capMirror?.remove();
    ta._capMirror = null;
    if (ta._capRichKeydown) {
        window.removeEventListener("keydown", ta._capRichKeydown, true);
        ta._capRichKeydown = null;
    }
    ta._capRichAttached = false;
    ta.style.color = "";
    ta.style.caretColor = "";
    ta.style.background = "";
    ta.style.position = "";
    ta.style.zIndex = "";
}

export function attachRichPromptHandler(ta, { mode = "widget" } = {}) {
    if (!ta || ta._capRichAttached) return;
    ta._capRichAttached = true;

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
        if (ta._capMirror) ta._capMirror.scrollTop = ta.scrollTop;
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

    const tryMirror = (tries = 0) => {
        if (ta.parentNode) {
            ensureMirror(ta, mode);
        } else if (tries < 100) {
            setTimeout(() => tryMirror(tries + 1), 50);
        }
    };
    tryMirror();
}
