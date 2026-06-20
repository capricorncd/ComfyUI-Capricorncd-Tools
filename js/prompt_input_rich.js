import { app } from "../../scripts/app.js";

function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\u00A0/g, "&nbsp;");
}

function formatLineHtml(line) {
    const isComment = line.startsWith("#");
    const boldMatch = /^\*\*(.*)\*\*$/.exec(line);
    let content = line;
    let style = "";

    if (boldMatch) {
        content = boldMatch[1];
        style += "font-weight:bold;";
    }
    if (isComment) {
        style += "color:gray;opacity:0.5;";
    }

    content = escapeHtml(content).replace(/ {2}/g, " &nbsp;");
    if (content === "") {
        content = "&nbsp;";
    }

    return `<div style="${style}">${content}</div>`;
}

function updateMirror(textarea) {
    const mirror = textarea._capMirror;
    if (!mirror) return;
    const value = textarea.value;
    const lines = value.split("\n");
    mirror.innerHTML = lines.map(formatLineHtml).join("") + (value.endsWith("\n") ? "<div>&nbsp;</div>" : "");
    mirror.scrollTop = textarea.scrollTop;
    mirror.scrollLeft = textarea.scrollLeft;
}

function ensureMirror(textarea) {
    if (textarea._capMirror) return;

    const wrapper = document.createElement("div");
    wrapper.style.position = "relative";
    wrapper.style.width = "100%";
    wrapper.style.height = "100%";
    wrapper.style.minHeight = textarea.style.minHeight || "5rem";

    textarea.parentNode.insertBefore(wrapper, textarea);
    wrapper.appendChild(textarea);

    const mirror = document.createElement("pre");
    mirror.style.position = "absolute";
    mirror.style.top = "0";
    mirror.style.left = "0";
    mirror.style.right = "0";
    mirror.style.bottom = "0";
    mirror.style.margin = "0";
    mirror.style.padding = "6px 10px";
    mirror.style.overflow = "hidden";
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.wordWrap = "break-word";
    mirror.style.pointerEvents = "none";
    mirror.style.zIndex = "0";
    mirror.style.fontFamily = "inherit";
    mirror.style.fontSize = "inherit";
    mirror.style.lineHeight = "inherit";
    mirror.style.boxSizing = "border-box";
    mirror.style.color = "black";
    wrapper.insertBefore(mirror, textarea);

    textarea.style.background = "transparent";
    textarea.style.color = "transparent";
    textarea.style.caretColor = "black";
    textarea.style.position = "relative";
    textarea.style.zIndex = "1";
    textarea.style.resize = textarea.style.resize || "vertical";
    textarea.style.overflow = "auto";
    textarea.style.whiteSpace = "pre-wrap";
    textarea.style.wordWrap = "break-word";

    textarea._capMirror = mirror;

    const computed = getComputedStyle(textarea);
    mirror.style.fontFamily = computed.fontFamily;
    mirror.style.fontSize = computed.fontSize;
    mirror.style.lineHeight = computed.lineHeight;
    mirror.style.padding = computed.padding;
    mirror.style.borderRadius = computed.borderRadius;
    mirror.style.minHeight = textarea.offsetHeight + "px";

    updateMirror(textarea);
}

function toggleComment(textarea) {
    const text = textarea.value;
    const selStart = textarea.selectionStart;
    const selEnd = textarea.selectionEnd;

    const lineStart = text.lastIndexOf("\n", selStart - 1) + 1;
    let effectiveEnd = selEnd;
    if (selEnd > selStart && text[effectiveEnd - 1] === "\n") {
        effectiveEnd--;
    }
    let lineEnd = text.indexOf("\n", effectiveEnd);
    if (lineEnd === -1) lineEnd = text.length;

    const before = text.slice(0, lineStart);
    const region = text.slice(lineStart, lineEnd);
    const after = text.slice(lineEnd);

    const lines = region.split("\n");
    const allCommented = lines.every((l) => l.startsWith("#"));
    const newLines = allCommented
        ? lines.map((l) => l.slice(1))
        : lines.map((l) => "#" + l);

    textarea.value = before + newLines.join("\n") + after;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    updateMirror(textarea);

    const delta = allCommented ? -1 : 1;
    const newSelStart = Math.max(lineStart, selStart + delta);
    const newSelEnd = Math.max(newSelStart, selEnd + delta * lines.length);
    textarea.setSelectionRange(newSelStart, newSelEnd);
}

function toggleBold(textarea) {
    const text = textarea.value;
    const selStart = textarea.selectionStart;
    const selEnd = textarea.selectionEnd;

    const lineStart = text.lastIndexOf("\n", selStart - 1) + 1;
    const posForEnd = selEnd > selStart ? selEnd : selStart;
    let lineEnd = text.indexOf("\n", posForEnd);
    if (lineEnd === -1) lineEnd = text.length;

    const before = text.slice(0, lineStart);
    const region = text.slice(lineStart, lineEnd);
    const after = text.slice(lineEnd);

    const boldMatch = /^\*\*(.*)\*\*$/.exec(region);
    const newRegion = boldMatch ? boldMatch[1] : `**${region}**`;
    textarea.value = before + newRegion + after;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    updateMirror(textarea);

    const delta = boldMatch ? -2 : 2;
    const newSelStart = Math.max(lineStart, selStart + delta);
    const newSelEnd = Math.max(newSelStart, selEnd + delta);
    textarea.setSelectionRange(newSelStart, newSelEnd);
}

function attachHandler(inputEl) {
    if (inputEl._capRichPromptHandlerAdded) return;
    inputEl._capRichPromptHandlerAdded = true;

    ensureMirror(inputEl);
    inputEl.addEventListener("input", () => updateMirror(inputEl));
    inputEl.addEventListener("scroll", () => updateMirror(inputEl));

    const onKeydown = (e) => {
        if (!document.contains(inputEl)) {
            window.removeEventListener("keydown", onKeydown, true);
            return;
        }
        if (e.target !== inputEl) return;
        if ((e.ctrlKey || e.metaKey) && (e.key === "/" || e.code === "Slash")) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            toggleComment(inputEl);
        } else if ((e.ctrlKey || e.metaKey) && (e.key === "b" || e.key === "B" || e.code === "KeyB")) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            toggleBold(inputEl);
        }
    };
    window.addEventListener("keydown", onKeydown, true);

    inputEl.addEventListener("paste", (e) => {
        e.preventDefault();
        const pasteData = (e.clipboardData || window.clipboardData).getData("text/plain");
        const start = inputEl.selectionStart;
        const end = inputEl.selectionEnd;
        const value = inputEl.value;
        inputEl.value = value.slice(0, start) + pasteData + value.slice(end);
        const cursor = start + pasteData.length;
        inputEl.setSelectionRange(cursor, cursor);
        inputEl.dispatchEvent(new Event("input", { bubbles: true }));
        updateMirror(inputEl);
    });
}

app.registerExtension({
    name: "Capricorncd.RichPromptInput",

    nodeCreated(node) {
        if (node.comfyClass !== "CAP_RichPromptInput") return;

        for (const widget of node.widgets ?? []) {
            if (widget.name !== "prompt") continue;

            if (widget.inputEl) {
                attachHandler(widget.inputEl);
            } else {
                const timer = setInterval(() => {
                    if (widget.inputEl) {
                        clearInterval(timer);
                        attachHandler(widget.inputEl);
                    }
                }, 50);
                setTimeout(() => clearInterval(timer), 5000);
            }
            break;
        }
    },
});
