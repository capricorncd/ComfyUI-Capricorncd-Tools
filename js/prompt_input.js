import { app } from "../../scripts/app.js";

/**
 * Toggle comment (#) on the current line or all selected lines.
 * If every selected line is already commented, removes the '#'.
 * Otherwise adds '#' to all selected lines.
 */
function toggleComment(textarea) {
    const text = textarea.value;
    const selStart = textarea.selectionStart;
    const selEnd = textarea.selectionEnd;

    // Start of the first selected line
    const lineStart = text.lastIndexOf("\n", selStart - 1) + 1;

    // End of the last selected line.
    // When the selection ends exactly at the beginning of a new line
    // (e.g. triple-click selects "line\n"), exclude that trailing empty line.
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

    const newRegion = newLines.join("\n");
    textarea.value = before + newRegion + after;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));

    // Move cursor / selection to track the shifted characters
    const delta = allCommented ? -1 : 1;
    const newSelStart = Math.max(lineStart, selStart + delta);
    const newSelEnd = Math.max(newSelStart, selEnd + delta * lines.length);
    textarea.setSelectionRange(newSelStart, newSelEnd);
}

function attachHandler(inputEl) {
    if (inputEl._capCommentHandlerAdded) return;
    inputEl._capCommentHandlerAdded = true;
    // Use capture phase so the shortcut fires before ComfyUI's own key handling
    inputEl.addEventListener(
        "keydown",
        (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "/") {
                e.preventDefault();
                e.stopPropagation();
                toggleComment(inputEl);
            }
        },
        true
    );
}

app.registerExtension({
    name: "Capricorncd.PromptInput",

    nodeCreated(node) {
        if (node.comfyClass !== "CAP_PromptInput") return;

        for (const widget of node.widgets ?? []) {
            if (widget.name !== "prompt") continue;

            if (widget.inputEl) {
                attachHandler(widget.inputEl);
            } else {
                // inputEl is created lazily on first draw; poll briefly for it
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
