import { app } from "../../scripts/app.js";

// ── formatting ────────────────────────────────────────────────────────────

function escapeHtml(t) {
    return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatLineHtml(line) {
    const isComment = line.startsWith("#");
    const boldMatch = /^\*\*(.*)\*\*$/.exec(line);
    let content = boldMatch ? boldMatch[1] : line;
    let style = "";
    if (boldMatch) style += "font-weight:bold;";
    if (isComment) style += "opacity:0.4;";
    content = escapeHtml(content).replace(/ {2}/g, " &nbsp;");
    if (!content) content = "&nbsp;";
    return `<div style="${style}">${content}</div>`;
}

// ── mirror ────────────────────────────────────────────────────────────────

function updateMirror(ta) {
    const m = ta._capMirror;
    if (!m) return;
    const lines = ta.value.split("\n");
    m.innerHTML =
        lines.map(formatLineHtml).join("") +
        (ta.value.endsWith("\n") ? "<div>&nbsp;</div>" : "");
    m.scrollTop = ta.scrollTop;
}

function ensureMirror(ta) {
    if (ta._capMirror || !ta.parentNode) return;

    // Read computed styles BEFORE making textarea transparent
    const cs         = getComputedStyle(ta);
    const textColor  = cs.color;
    const bgColor    = cs.backgroundColor;

    // Insert mirror as sibling (before textarea) — no wrapper div needed
    const mirror = document.createElement("pre");
    Object.assign(mirror.style, {
        position:      ta.style.position || "absolute",
        left:          ta.style.left,
        top:           ta.style.top,
        width:         "100%",
        height:        "100%",
        margin:        "0",
        padding:       cs.padding,
        overflow:      "hidden",
        whiteSpace:    "pre-wrap",
        wordWrap:      "break-word",
        wordBreak:     "break-word",
        pointerEvents: "none",
        fontFamily:    cs.fontFamily,
        fontSize:      cs.fontSize,
        lineHeight:    cs.lineHeight,
        letterSpacing: cs.letterSpacing,
        boxSizing:     "border-box",
        color:         textColor,
        // background:    bgColor,
        borderRadius:  cs.borderRadius,
        border:        cs.border,
    });

    ta.parentNode.insertBefore(mirror, ta);
    ta._capMirror = mirror;

    // Make textarea text invisible so mirror shows through
    ta.style.color      = "transparent";
    ta.style.caretColor = textColor;
    ta.style.background = bgColor;

    // LiteGraph updates the textarea's inline style when node moves/resizes.
    // Mirror stays in sync via MutationObserver.
    const syncPos = () => {
        mirror.style.left = ta.style.left;
        mirror.style.top  = ta.style.top;
    };
    syncPos();
    const mo = new MutationObserver(syncPos);
    mo.observe(ta, { attributes: true, attributeFilter: ["style"] });
    ta._capMirrorObserver = mo;

    updateMirror(ta);
}

// ── editing commands ──────────────────────────────────────────────────────

function toggleComment(ta) {
    const text     = ta.value;
    const selStart = ta.selectionStart;
    const selEnd   = ta.selectionEnd;

    const lineStart = text.lastIndexOf("\n", selStart - 1) + 1;
    let effEnd = selEnd;
    if (effEnd > selStart && text[effEnd - 1] === "\n") effEnd--;
    let lineEnd = text.indexOf("\n", effEnd);
    if (lineEnd === -1) lineEnd = text.length;

    const before  = text.slice(0, lineStart);
    const region  = text.slice(lineStart, lineEnd);
    const after   = text.slice(lineEnd);
    const lines   = region.split("\n");
    const allC    = lines.every(l => l.startsWith("#"));
    const newLines = allC ? lines.map(l => l.slice(1)) : lines.map(l => "#" + l);

    ta.value = before + newLines.join("\n") + after;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    updateMirror(ta);

    const delta  = allC ? -1 : 1;
    ta.setSelectionRange(
        Math.max(lineStart, selStart + delta),
        Math.max(lineStart, selEnd + delta * lines.length),
    );
}

function toggleBold(ta) {
    const text     = ta.value;
    const selStart = ta.selectionStart;
    const selEnd   = ta.selectionEnd;

    const lineStart = text.lastIndexOf("\n", selStart - 1) + 1;
    let lineEnd = text.indexOf("\n", selEnd > selStart ? selEnd : selStart);
    if (lineEnd === -1) lineEnd = text.length;

    const before    = text.slice(0, lineStart);
    const region    = text.slice(lineStart, lineEnd);
    const after     = text.slice(lineEnd);
    const boldMatch = /^\*\*(.*)\*\*$/.exec(region);
    const newRegion = boldMatch ? boldMatch[1] : `**${region}**`;

    ta.value = before + newRegion + after;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    updateMirror(ta);

    const delta = boldMatch ? -2 : 2;
    ta.setSelectionRange(
        Math.max(lineStart, selStart + delta),
        Math.max(lineStart, selEnd + delta),
    );
}

// ── handler attachment ────────────────────────────────────────────────────

function attachHandler(ta) {
    if (ta._capRichAttached) return;
    ta._capRichAttached = true;

    // Keydown — attach immediately, works before mirror is ready
    const onKeydown = (e) => {
        if (!document.contains(ta)) {
            window.removeEventListener("keydown", onKeydown, true);
            ta._capMirrorObserver?.disconnect();
            return;
        }
        if (e.target !== ta) return;

        const mod = e.ctrlKey || e.metaKey;
        if (mod && (e.key === "/" || e.code === "Slash")) {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            toggleComment(ta);
        } else if (mod && (e.key === "b" || e.key === "B" || e.code === "KeyB")) {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            toggleBold(ta);
        }
    };
    window.addEventListener("keydown", onKeydown, true);

    ta.addEventListener("input",  () => updateMirror(ta));
    ta.addEventListener("scroll", () => {
        if (ta._capMirror) ta._capMirror.scrollTop = ta.scrollTop;
    });
    ta.addEventListener("paste", (e) => {
        e.preventDefault();
        const txt   = (e.clipboardData || window.clipboardData).getData("text/plain");
        const s     = ta.selectionStart, end = ta.selectionEnd;
        ta.value    = ta.value.slice(0, s) + txt + ta.value.slice(end);
        ta.setSelectionRange(s + txt.length, s + txt.length);
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        updateMirror(ta);
    });

    // Mirror needs the element in the DOM — wait for it
    const tryMirror = (tries = 0) => {
        if (ta.parentNode) {
            ensureMirror(ta);
        } else if (tries < 100) {
            setTimeout(() => tryMirror(tries + 1), 50);
        }
    };
    tryMirror();
}

// ── extension ─────────────────────────────────────────────────────────────

app.registerExtension({
    name: "Capricorncd.RichPromptInput",

    nodeCreated(node) {
        if (node.comfyClass !== "CAP_RichPromptInput") return;

        for (const widget of node.widgets ?? []) {
            if (widget.name !== "prompt") continue;

            // ComfyUI multiline STRING widget stores textarea in inputEl
            const ta = widget.inputEl ?? widget.element;
            if (ta instanceof HTMLTextAreaElement) {
                attachHandler(ta);
            } else if (ta) {
                const inner = ta.querySelector?.("textarea");
                if (inner) attachHandler(inner);
            }
            break;
        }
    },
});
