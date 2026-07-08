import { app } from "../../scripts/app.js";

function focusedTextareaIn(el) {
    const active = document.activeElement;
    if (active instanceof HTMLTextAreaElement && el.contains(active)) {
        return active;
    }
    return null;
}

function textareaCanScroll(ta, deltaY) {
    if (ta.scrollHeight <= ta.clientHeight) return false;
    const epsilon = 1;
    if (deltaY < 0) return ta.scrollTop > 0;
    if (deltaY > 0) return ta.scrollTop + ta.clientHeight < ta.scrollHeight - epsilon;
    return false;
}

export function bindCanvasWheelPassthrough(el) {
    if (!el || el.dataset.capWheelBound) return;
    el.dataset.capWheelBound = "1";
    el.addEventListener("wheel", (e) => {
        const ta = focusedTextareaIn(el);
        if (ta && e.target === ta && textareaCanScroll(ta, e.deltaY)) {
            return;
        }

        const canvas = app.canvas;
        if (!canvas?.processMouseWheel) return;
        canvas.processMouseWheel(e);
        e.preventDefault();
        e.stopPropagation();
    }, { passive: false, capture: true });
}
