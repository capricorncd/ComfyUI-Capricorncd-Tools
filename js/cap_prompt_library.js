/** Shared History / Preset library for Rich Prompt Input. */

import { app } from "../../scripts/app.js";
import { resolvePromptTextarea, updateRichPromptMirror } from "./rich_prompt.js";
import { iconHtml } from "./cap_icons.js";
import { ensureCapUiCss, mkUiBtn } from "./cap_ui.js";
import {
    PRESET_CATEGORIES,
    formatPresetWriteText,
    getBuiltinPresets,
} from "./cap_prompt_presets.js";

const STORAGE_HISTORY = "capricorncd.rich_prompt.history";
const STORAGE_PRESETS = "capricorncd.rich_prompt.presets";
const HISTORY_MAX = 80;
const NODE_CLASS = "CAP_RichPromptInput";
const PRESET_KINDS = new Set(["style", "quality", "other"]);
const EMPTY_LABEL = {
    history: "暂无历史记录",
    style: "暂无风格预设",
    quality: "暂无质量预设",
    other: "暂无其他预设",
};
const NO_TARGET_MSG = "请选中提示词节点后再操作";

function uid() {
    return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function loadList(key) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return [];
        const data = JSON.parse(raw);
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

function saveList(key, list) {
    localStorage.setItem(key, JSON.stringify(list));
}

function normalizeText(text) {
    return String(text ?? "").replace(/\r\n/g, "\n");
}

function previewText(text, max = 120) {
    const t = normalizeText(text).trim().replace(/\s+/g, " ");
    if (t.length <= max) return t || "(空)";
    return t.slice(0, max) + "…";
}

function formatTime(ts) {
    try {
        return new Date(ts).toLocaleString();
    } catch {
        return "";
    }
}

export function getPromptHistory() {
    return loadList(STORAGE_HISTORY);
}

export function getPromptPresets() {
    return loadList(STORAGE_PRESETS);
}

export function getPresetsForKind(kind) {
    if (kind === "style" || kind === "quality") {
        return getBuiltinPresets(kind);
    }
    if (kind === "other") {
        const user = getPromptPresets().map((item) => ({
            ...item,
            category: "other",
            builtin: false,
            title: item.name?.startsWith("#") ? item.name : `#${item.name || previewText(item.text, 40)}`,
        }));
        return [...getBuiltinPresets("other"), ...user];
    }
    return [];
}

function normalizeKind(kind) {
    if (kind === "history") return "history";
    if (PRESET_KINDS.has(kind)) return kind;
    if (kind === "presets") return "other";
    return "history";
}

export function addPromptHistory(text) {
    const value = normalizeText(text);
    if (!value.trim()) return getPromptHistory();
    let list = getPromptHistory().filter((item) => item.text !== value);
    list.unshift({ id: uid(), text: value, ts: Date.now() });
    if (list.length > HISTORY_MAX) list = list.slice(0, HISTORY_MAX);
    saveList(STORAGE_HISTORY, list);
    return list;
}

export function removePromptHistory(id) {
    const list = getPromptHistory().filter((item) => item.id !== id);
    saveList(STORAGE_HISTORY, list);
    return list;
}

export function clearPromptHistory() {
    saveList(STORAGE_HISTORY, []);
    return [];
}

export function addPromptPreset(text, name = "") {
    const value = normalizeText(text);
    if (!value.trim()) return getPromptPresets();
    const title = String(name || "").trim() || previewText(value, 40);
    const list = getPromptPresets();
    list.unshift({ id: uid(), name: title, text: value, ts: Date.now() });
    saveList(STORAGE_PRESETS, list);
    return list;
}

export function removePromptPreset(id) {
    const list = getPromptPresets().filter((item) => item.id !== id);
    saveList(STORAGE_PRESETS, list);
    return list;
}

export function clearPromptPresets() {
    saveList(STORAGE_PRESETS, []);
    return [];
}

function trackCaret(ta) {
    if (!ta || ta._capCaretTracked) return;
    ta._capCaretTracked = true;
    const save = () => {
        try {
            ta._capCaretPos = {
                start: ta.selectionStart,
                end: ta.selectionEnd,
                focused: document.activeElement === ta,
            };
        } catch {
            /* ignore */
        }
    };
    ta.addEventListener("keyup", save);
    ta.addEventListener("click", save);
    ta.addEventListener("select", save);
    ta.addEventListener("focus", save);
    ta.addEventListener("blur", save);
}

export function rememberPromptCaret(ta) {
    trackCaret(ta);
}

function resolveInsertRange(ta) {
    const caret = ta._capCaretPos;
    if (caret && caret.focused && Number.isFinite(caret.start) && Number.isFinite(caret.end)) {
        return { start: caret.start, end: caret.end };
    }
    if (caret && Number.isFinite(caret.start) && Number.isFinite(caret.end) && document.activeElement === ta) {
        return { start: caret.start, end: caret.end };
    }
    // Not focused / no remembered caret → append to end
    const len = ta.value.length;
    return { start: len, end: len };
}

/** Keep `#` comment lines at line start so node output filtering works. */
function wrapInsertBlock(before, after, value) {
    let text = value;
    if (before && !before.endsWith("\n")) text = `\n${text}`;
    if (after && !after.startsWith("\n") && !text.endsWith("\n")) text = `${text}\n`;
    return text;
}

export function applyPromptToTextarea(ta, text, mode = "insert") {
    if (!ta) return;
    trackCaret(ta);
    const value = normalizeText(text);
    if (mode === "replace") {
        ta.value = value;
        const pos = value.length;
        ta.setSelectionRange(pos, pos);
    } else {
        const { start, end } = resolveInsertRange(ta);
        const before = ta.value.slice(0, start);
        const after = ta.value.slice(end);
        const block = wrapInsertBlock(before, after, value);
        ta.value = before + block + after;
        const pos = before.length + block.length;
        ta.setSelectionRange(pos, pos);
        ta._capCaretPos = { start: pos, end: pos, focused: true };
    }
    ta.focus();
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    if (typeof ta.oninput === "function") {
        try { ta.oninput(); } catch { /* ignore */ }
    }
    updateRichPromptMirror(ta);
    // Sync ComfyUI widget value if present
    const widget = ta._capBoundWidget;
    if (widget && "value" in widget) widget.value = ta.value;
}

function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function pickJsonFile() {
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,application/json";
        input.addEventListener("change", async () => {
            const file = input.files?.[0];
            if (!file) {
                resolve(null);
                return;
            }
            try {
                const text = await file.text();
                resolve(JSON.parse(text));
            } catch {
                alert("无法解析 JSON 文件");
                resolve(null);
            }
        });
        input.click();
    });
}

let _modal = null;
let _modalKind = "history";
/** @type {{ x: number, y: number } | null} */
let _modalPos = null;
let _selectionWatch = null;

function closePromptLibraryModal() {
    if (_modal?._capOnKey) {
        window.removeEventListener("keydown", _modal._capOnKey, true);
    }
    if (_modal?._capDragCleanup) _modal._capDragCleanup();
    stopSelectionWatch();
    _modal?.remove();
    _modal = null;
    _modalKind = "history";
}

function getSelectedNodes() {
    const sel = app.canvas?.selected_nodes;
    if (!sel) return [];
    return Object.values(sel).filter(Boolean);
}

function getSelectedRichPromptNode() {
    const nodes = getSelectedNodes().filter((n) => n.comfyClass === NODE_CLASS);
    if (nodes.length !== 1) return null;
    return nodes[0];
}

function getPromptWidget(node) {
    return node?.widgets?.find((w) => w.name === "prompt") ?? null;
}

function resolveActiveTarget() {
    const node = getSelectedRichPromptNode();
    if (!node) return { node: null, widget: null, textarea: null };
    const widget = getPromptWidget(node);
    const textarea = resolvePromptTextarea(widget);
    if (textarea) {
        trackCaret(textarea);
        textarea._capBoundWidget = widget;
    }
    return { node, widget, textarea };
}

function requireTarget() {
    const target = resolveActiveTarget();
    if (!target.textarea) {
        alert(NO_TARGET_MSG);
        return null;
    }
    return target;
}

function selectGraphNode(node) {
    const canvas = app.canvas;
    if (!canvas || !node) return;
    if (typeof canvas.selectNodes === "function") {
        canvas.selectNodes([node]);
    } else if (typeof canvas.selectNode === "function") {
        canvas.selectNode(node, false);
    } else {
        for (const n of Object.values(canvas.selected_nodes || {})) {
            if (n) n.selected = false;
        }
        canvas.selected_nodes = { [node.id]: node };
        node.selected = true;
    }
    canvas.setDirty?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
}

function updateModalTargetHint() {
    if (!_modal) return;
    const hint = _modal.querySelector(".cap-ui-target-hint");
    if (!hint) return;
    const { node, textarea } = resolveActiveTarget();
    if (node && textarea) {
        const title = node.title || NODE_CLASS;
        hint.textContent = `· #${node.id} ${title}`;
        hint.title = `目标节点：#${node.id} ${title}`;
        hint.classList.remove("cap-ui-target-warn");
    } else {
        hint.textContent = `· ${NO_TARGET_MSG}`;
        hint.title = NO_TARGET_MSG;
        hint.classList.add("cap-ui-target-warn");
    }
    refreshModalTargetState();
}

function refreshModalTargetState() {
    if (!_modal) return;
    const ok = !!resolveActiveTarget().textarea;
    for (const btn of _modal.querySelectorAll("[data-cap-need-target='1']")) {
        btn.disabled = !ok;
        if (!ok) btn.title = NO_TARGET_MSG;
        else if (btn.dataset.capTitle) btn.title = btn.dataset.capTitle;
    }
}

function stopSelectionWatch() {
    if (_selectionWatch) {
        clearInterval(_selectionWatch);
        _selectionWatch = null;
    }
}

function startSelectionWatch() {
    stopSelectionWatch();
    let lastKey = "";
    const tick = () => {
        if (!_modal) {
            stopSelectionWatch();
            return;
        }
        const { node, textarea } = resolveActiveTarget();
        const key = node && textarea ? `${node.id}` : "";
        if (key !== lastKey) {
            lastKey = key;
            updateModalTargetHint();
        }
    };
    tick();
    _selectionWatch = setInterval(tick, 250);
}

function clampDialogPos(dialog, x, y) {
    const w = dialog.offsetWidth || 720;
    const h = dialog.offsetHeight || 240;
    const maxX = Math.max(0, window.innerWidth - Math.min(w, 80));
    const maxY = Math.max(0, window.innerHeight - 48);
    return {
        x: Math.min(Math.max(0, x), maxX),
        y: Math.min(Math.max(0, y), maxY),
    };
}

function placeDialog(dialog, pos) {
    const { x, y } = clampDialogPos(dialog, pos.x, pos.y);
    dialog.style.left = `${x}px`;
    dialog.style.top = `${y}px`;
    _modalPos = { x, y };
}

function defaultDialogPos(dialog) {
    const w = dialog.offsetWidth || Math.min(720, window.innerWidth * 0.96);
    const h = dialog.offsetHeight || 360;
    return {
        x: Math.max(16, Math.round((window.innerWidth - w) / 2)),
        y: Math.max(16, Math.round((window.innerHeight - h) / 2)),
    };
}

function enableDialogDrag(dialog, handle, root) {
    let dragging = false;
    let ox = 0;
    let oy = 0;

    const onDown = (e) => {
        if (e.button !== 0) return;
        if (e.target.closest("button, a, input, textarea, select")) return;
        dragging = true;
        const rect = dialog.getBoundingClientRect();
        ox = e.clientX - rect.left;
        oy = e.clientY - rect.top;
        handle.setPointerCapture?.(e.pointerId);
        e.preventDefault();
    };
    const onMove = (e) => {
        if (!dragging) return;
        placeDialog(dialog, { x: e.clientX - ox, y: e.clientY - oy });
    };
    const onUp = () => {
        dragging = false;
    };

    handle.addEventListener("pointerdown", onDown);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);

    root._capDragCleanup = () => {
        handle.removeEventListener("pointerdown", onDown);
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
    };
}

function syncWidgetFromTa(target = resolveActiveTarget()) {
    if (target.widget && target.textarea) {
        target.widget.value = target.textarea.value;
    }
}

function renderList(body, kind) {
    body.innerHTML = "";
    const list = kind === "history" ? getPromptHistory() : getPresetsForKind(kind);
    if (!list.length) {
        const empty = document.createElement("div");
        empty.className = "cap-ui-empty";
        empty.textContent = EMPTY_LABEL[kind] || "暂无内容";
        body.appendChild(empty);
        return;
    }

    for (const item of list) {
        const row = document.createElement("div");
        row.className = "cap-ui-list-item";

        const meta = document.createElement("div");
        meta.className = "cap-ui-list-meta";
        const title = document.createElement("div");
        title.className = "cap-ui-list-title";
        if (kind === "history") {
            title.textContent = formatTime(item.ts);
            meta.append(title);
        } else {
            title.textContent = item.title || (item.name ? `#${item.name}` : previewText(item.text, 40));
            if (!item.builtin && item.ts) {
                const sub = document.createElement("div");
                sub.className = "cap-ui-list-sub";
                sub.textContent = formatTime(item.ts);
                meta.append(title, sub);
            } else {
                meta.append(title);
            }
        }

        const preview = document.createElement("pre");
        preview.className = "cap-ui-code-preview";
        preview.textContent = item.text;

        const actions = document.createElement("div");
        actions.className = "cap-ui-actions";

        const writeText = kind === "history"
            ? item.text
            : formatPresetWriteText(item);

        const btnInsert = mkUiBtn("插入", {
            needTarget: true,
            title: "插入到光标位置（无光标则追加到末尾）",
            onClick: () => {
                const target = requireTarget();
                if (!target) return;
                applyPromptToTextarea(target.textarea, writeText, "insert");
                syncWidgetFromTa(target);
            },
        });
        btnInsert.dataset.capTitle = btnInsert.title;

        const btnReplace = mkUiBtn("替换", {
            variant: "primary",
            needTarget: true,
            title: "替换输入框全部内容",
            onClick: () => {
                const target = requireTarget();
                if (!target) return;
                applyPromptToTextarea(target.textarea, writeText, "replace");
                syncWidgetFromTa(target);
            },
        });
        btnReplace.dataset.capTitle = btnReplace.title;

        actions.append(btnInsert, btnReplace);

        if (kind === "history" || (kind === "other" && !item.builtin)) {
            const btnDel = mkUiBtn("删除", {
                variant: "danger",
                onClick: () => {
                    if (!confirm(kind === "history" ? "删除这条历史记录？" : "删除这条预设？")) return;
                    if (kind === "history") removePromptHistory(item.id);
                    else removePromptPreset(item.id);
                    renderList(body, kind);
                },
            });
            actions.append(btnDel);
        }

        row.append(meta, preview, actions);
        body.appendChild(row);
    }

    refreshModalTargetState();
}

function renderToolbar(toolbar, body, kind) {
    toolbar.innerHTML = "";

    if (kind === "other") {
        const btnSave = mkUiBtn("保存当前为预设", {
            variant: "primary",
            needTarget: true,
            onClick: () => {
                const target = requireTarget();
                if (!target) return;
                const text = target.textarea.value ?? "";
                if (!String(text).trim()) {
                    alert("当前提示词为空");
                    return;
                }
                const name = prompt("预设名称（可留空）", previewText(text, 40));
                if (name === null) return;
                addPromptPreset(text, name);
                renderList(body, kind);
            },
        });
        toolbar.appendChild(btnSave);
    } else if (kind === "history") {
        const btnSave = mkUiBtn("保存当前到历史", {
            variant: "primary",
            needTarget: true,
            onClick: () => {
                const target = requireTarget();
                if (!target) return;
                const text = target.textarea.value ?? "";
                if (!String(text).trim()) {
                    alert("当前提示词为空");
                    return;
                }
                addPromptHistory(text);
                renderList(body, kind);
            },
        });
        toolbar.appendChild(btnSave);
    }

    if (kind === "history" || kind === "other") {
        toolbar.appendChild(mkUiBtn("导出", { onClick: () => {
            const list = kind === "history" ? getPromptHistory() : getPromptPresets();
            const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
            downloadJson(
                `cap-${kind}-${stamp}.json`,
                { kind, version: 1, items: list },
            );
        }}));

        toolbar.appendChild(mkUiBtn("导入", { onClick: async () => {
            const data = await pickJsonFile();
            if (!data) return;
            const items = Array.isArray(data) ? data : data.items;
            if (!Array.isArray(items)) {
                alert("JSON 格式无效，需要 items 数组");
                return;
            }
            const merge = confirm("确定导入？\n确定 = 合并到现有列表\n取消 = 终止");
            if (!merge) return;
            const replace = confirm("是否清空现有列表后导入？\n确定 = 替换\n取消 = 追加合并");
            if (kind === "history") {
                let list = replace ? [] : getPromptHistory();
                for (const item of items) {
                    const text = normalizeText(item?.text ?? item);
                    if (!text.trim()) continue;
                    list = list.filter((x) => x.text !== text);
                    list.unshift({
                        id: item.id || uid(),
                        text,
                        ts: item.ts || Date.now(),
                    });
                }
                if (list.length > HISTORY_MAX) list = list.slice(0, HISTORY_MAX);
                saveList(STORAGE_HISTORY, list);
            } else {
                let list = replace ? [] : getPromptPresets();
                for (const item of items) {
                    const text = normalizeText(item?.text ?? "");
                    if (!text.trim()) continue;
                    list.unshift({
                        id: item.id || uid(),
                        name: String(item.name || previewText(text, 40)),
                        text,
                        ts: item.ts || Date.now(),
                    });
                }
                saveList(STORAGE_PRESETS, list);
            }
            renderList(body, kind);
        }}));

        toolbar.appendChild(mkUiBtn("清空", { variant: "danger", onClick: () => {
            if (!confirm(kind === "history" ? "清空全部历史记录？" : "清空全部自定义预设？")) return;
            if (kind === "history") clearPromptHistory();
            else clearPromptPresets();
            renderList(body, kind);
        }}));
    }

    refreshModalTargetState();
}

function setActiveTab(tabsEl, kind) {
    for (const btn of tabsEl.querySelectorAll(".cap-ui-tab")) {
        btn.classList.toggle("active", btn.dataset.kind === kind);
    }
}

function buildModal(initialKind = "history") {
    const overlay = document.createElement("div");
    overlay.className = "cap-ui-overlay cap-ui-float";
    overlay.innerHTML = `
      <div class="cap-ui-dialog" role="dialog" aria-modal="false">
        <div class="cap-ui-hd cap-ui-drag">
          <h3 class="cap-ui-hd-title">历史记录 / 预设</h3>
          <span class="cap-ui-target-hint"></span>
          <button type="button" class="cap-ui-close" title="关闭">${iconHtml("close")}</button>
        </div>
        <div class="cap-ui-tabs">
          <div class="cap-ui-tab-list">
            <button type="button" class="cap-ui-tab" data-kind="history">历史记录</button>
            <button type="button" class="cap-ui-tab" data-kind="style">${PRESET_CATEGORIES.style.label}</button>
            <button type="button" class="cap-ui-tab" data-kind="quality">${PRESET_CATEGORIES.quality.label}</button>
            <button type="button" class="cap-ui-tab" data-kind="other">${PRESET_CATEGORIES.other.label}</button>
          </div>
          <div class="cap-ui-toolbar"></div>
        </div>
        <div class="cap-ui-body"></div>
      </div>
    `;

    const dialog = overlay.querySelector(".cap-ui-dialog");
    const header = overlay.querySelector(".cap-ui-hd");
    const tabs = overlay.querySelector(".cap-ui-tab-list");
    const toolbar = overlay.querySelector(".cap-ui-toolbar");
    const body = overlay.querySelector(".cap-ui-body");
    const btnClose = overlay.querySelector(".cap-ui-close");

    const switchKind = (kind) => {
        _modalKind = normalizeKind(kind);
        setActiveTab(tabs, _modalKind);
        renderToolbar(toolbar, body, _modalKind);
        renderList(body, _modalKind);
        updateModalTargetHint();
    };

    tabs.addEventListener("click", (e) => {
        const btn = e.target.closest(".cap-ui-tab");
        if (!btn) return;
        switchKind(btn.dataset.kind);
    });

    btnClose.addEventListener("click", closePromptLibraryModal);
    enableDialogDrag(dialog, header, overlay);

    const onKey = (e) => {
        if (e.key === "Escape") {
            closePromptLibraryModal();
        }
    };
    window.addEventListener("keydown", onKey, true);
    overlay._capOnKey = onKey;

    switchKind(normalizeKind(initialKind));
    return overlay;
}

export function openPromptLibraryModal({ kind = "history", node = null } = {}) {
    ensureCapUiCss();
    if (node) selectGraphNode(node);
    closePromptLibraryModal();
    _modalKind = normalizeKind(kind);
    _modal = buildModal(_modalKind);
    document.body.appendChild(_modal);
    const dialog = _modal.querySelector(".cap-ui-dialog");
    placeDialog(dialog, _modalPos ?? defaultDialogPos(dialog));
    startSelectionWatch();
    updateModalTargetHint();
}

function collapseHeaderButtonWidget(w) {
    if (!w) return;
    w.serialize = false;
    w.computedHeight = 0;
    w.computeSize = () => [0, -4];
    if (w.options) {
        w.options.getMinHeight = () => 0;
        w.options.getHeight = () => 0;
    }
}

export function ensurePromptLibraryButtons(node) {
    const BTN_NAME = "历史 | 预设";
    // Drop legacy LiteGraph canvas buttons (split + old unified).
    const LEGACY_NAMES = new Set(["历史记录", "预设", BTN_NAME]);
    if (Array.isArray(node.widgets)) {
        node.widgets = node.widgets.filter((w) => !(w.type === "button" && LEGACY_NAMES.has(w.name)));
    }

    const open = () => {
        selectGraphNode(node);
        openPromptLibraryModal({ kind: "history", node });
    };

    const existing = node.widgets?.find((w) => w.name === "cap_plib_btn");
    if (existing) {
        collapseHeaderButtonWidget(existing);
        const btn = existing.element?.querySelector?.(".cap-ui-node-btn")
            ?? existing.element;
        if (btn?.tagName === "BUTTON" || btn?.classList?.contains("cap-ui-node-btn")) {
            btn.onclick = () => open();
        }
        // Keep collapsed widget first so absolute top offset aligns near title.
        const wi = node.widgets.indexOf(existing);
        if (wi > 0) {
            node.widgets.splice(wi, 1);
            node.widgets.unshift(existing);
        }
        node._capPLibButtons = true;
        return;
    }

    ensureCapUiCss();
    node._capPLibButtons = true;

    const wrap = document.createElement("div");
    wrap.className = "cap-ui-node-btn-wrap";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cap-ui-node-btn";
    btn.textContent = BTN_NAME;
    btn.title = BTN_NAME;
    btn.addEventListener("click", () => {
        // Do not stopPropagation — allow canvas to select this node.
        open();
    });
    wrap.appendChild(btn);

    const w = node.addDOMWidget("cap_plib_btn", "button", wrap, {
        serialize: false,
        getMinHeight: () => 0,
        getHeight: () => 0,
    });
    collapseHeaderButtonWidget(w);
    // First DOM slot → absolute offset sits on the canvas title row.
    const wi = node.widgets?.indexOf(w) ?? -1;
    if (wi > 0) {
        node.widgets.splice(wi, 1);
        node.widgets.unshift(w);
    }
}
