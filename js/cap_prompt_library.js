/** Shared History / Preset library for Rich Prompt Input. */

import { app } from "../../scripts/app.js";
import { resolvePromptTextarea, updateRichPromptMirror } from "./rich_prompt.js";
import { iconHtml } from "./cap_icons.js";
import { ensureCapUiCss, mkUiBtn, mkUiIconBtn } from "./cap_ui.js";
import {
    hoistNodeOverlay,
    positionOverlayFixedToHeader,
    positionOverlayInNodeHeader,
    positionOverlayOnCanvasTitle,
    watchCanvasTitleOverlay,
    watchNodeOverlayAnchor,
} from "./cap_widget_persist.js";
import {
    PRESET_CATEGORIES,
    PRESET_FILTER_ORDER,
    GU_FENG_FEMALE_SUB_FILTERS,
    formatPresetWriteText,
    getBuiltinPresets,
} from "./cap_prompt_presets.js";

const STORAGE_HISTORY = "capricorncd.rich_prompt.history";
const STORAGE_PRESETS = "capricorncd.rich_prompt.presets";
const STORAGE_HIDDEN_BUILTIN = "capricorncd.rich_prompt.hidden_builtin_presets";
const STORAGE_PRESET_META = "capricorncd.rich_prompt.preset_meta";
const HISTORY_MAX = 80;
const NODE_CLASS = "CAP_RichPromptInput";
const HISTORY_STAR_FILTERS = [
    { id: "all", label: "全部" },
    { id: "1", label: "★" },
    { id: "2", label: "★★" },
    { id: "3", label: "★★★" },
    { id: "4", label: "★★★★" },
    { id: "5", label: "★★★★★" },
];
const PRESET_CAT_FILTERS = [
    { id: "all", label: "全部" },
    ...PRESET_FILTER_ORDER.map((id) => ({ id, label: PRESET_CATEGORIES[id].label })),
];
const EMPTY_LABEL = {
    history: "暂无历史记录",
    preset: "暂无预设",
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
    return getAllPresets();
}

function stripLeadingHash(text) {
    return String(text ?? "").trim().replace(/^#+/, "");
}

function loadPresetMeta() {
    try {
        const raw = localStorage.getItem(STORAGE_PRESET_META);
        if (!raw) return {};
        const data = JSON.parse(raw);
        return data && typeof data === "object" && !Array.isArray(data) ? data : {};
    } catch {
        return {};
    }
}

function savePresetMeta(meta) {
    localStorage.setItem(STORAGE_PRESET_META, JSON.stringify(meta));
}

function updateBuiltinPresetMeta(id, patch) {
    const meta = loadPresetMeta();
    const cur = { ...(meta[id] || {}) };
    if ("title" in patch) {
        const trimmed = String(patch.title ?? "").trim();
        if (trimmed) cur.title = trimmed;
        else delete cur.title;
    }
    if ("stars" in patch) {
        const n = Number(patch.stars);
        if (Number.isFinite(n) && n >= 1 && n <= 5) cur.stars = n;
        else delete cur.stars;
    }
    if (!cur.title && !cur.stars) delete meta[id];
    else meta[id] = cur;
    savePresetMeta(meta);
}

function getHiddenBuiltinPresetIds() {
    const list = loadList(STORAGE_HIDDEN_BUILTIN);
    return new Set(list.filter((id) => typeof id === "string" && id.startsWith("builtin_")));
}

function hideBuiltinPreset(id) {
    const hidden = getHiddenBuiltinPresetIds();
    hidden.add(id);
    saveList(STORAGE_HIDDEN_BUILTIN, [...hidden]);
}

function getAllPresets() {
    const hidden = getHiddenBuiltinPresetIds();
    const meta = loadPresetMeta();
    const user = getPromptPresets().map((item) => ({
        ...item,
        name: stripLeadingHash(item.name),
        category: item.category || "other",
        builtin: false,
    }));
    const builtin = PRESET_FILTER_ORDER.flatMap((id) => getBuiltinPresets(id))
        .filter((item) => !hidden.has(item.id))
        .map((item) => {
            const extra = meta[item.id] || {};
            return {
                ...item,
                title: extra.title,
                stars: extra.stars,
            };
        });
    return [...builtin, ...user];
}

function filterPresetsByCategory(list, categoryId) {
    if (!categoryId || categoryId === "all") return list;
    return list.filter((item) => item.category === categoryId);
}

function filterPresetsBySubCategory(list, categoryId, subCatId) {
    if (categoryId !== "gu_feng_female" || !subCatId || subCatId === "all") return list;
    return list.filter((item) => item.subCategory === subCatId);
}

function filterHistoryByStars(list, starFilter) {
    if (!starFilter || starFilter === "all") return list;
    const stars = parseInt(starFilter, 10);
    if (!Number.isFinite(stars)) return list;
    return list.filter((item) => item.stars === stars);
}

function normalizeKind(kind) {
    if (kind === "history") return "history";
    if (kind === "preset" || kind === "presets") return "preset";
    if (kind === "style" || kind === "quality" || kind === "other") return "preset";
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

export function updatePromptHistoryTitle(id, title) {
    const list = getPromptHistory();
    const item = list.find((x) => x.id === id);
    if (!item) return list;
    const trimmed = String(title ?? "").trim();
    item.title = trimmed || undefined;
    saveList(STORAGE_HISTORY, list);
    return list;
}

export function updatePromptHistoryStars(id, stars) {
    const list = getPromptHistory();
    const item = list.find((x) => x.id === id);
    if (!item) return list;
    const n = Number(stars);
    item.stars = Number.isFinite(n) && n >= 1 && n <= 5 ? n : undefined;
    saveList(STORAGE_HISTORY, list);
    return list;
}

export function clearPromptHistory() {
    saveList(STORAGE_HISTORY, []);
    return [];
}

export function addPromptPreset(text, name = "", category = "other") {
    const value = normalizeText(text);
    if (!value.trim()) return getPromptPresets();
    const presetName = stripLeadingHash(String(name || "").trim()) || previewText(value, 40);
    const list = getPromptPresets();
    list.unshift({
        id: uid(),
        name: presetName,
        text: value,
        ts: Date.now(),
        category: PRESET_CATEGORIES[category] ? category : "other",
    });
    saveList(STORAGE_PRESETS, list);
    return list;
}

export function updatePromptPresetTitle(id, title) {
    const list = getPromptPresets();
    const item = list.find((x) => x.id === id);
    if (!item) return list;
    const trimmed = String(title ?? "").trim();
    item.title = trimmed || undefined;
    saveList(STORAGE_PRESETS, list);
    return list;
}

export function updatePromptPresetStars(id, stars) {
    const list = getPromptPresets();
    const item = list.find((x) => x.id === id);
    if (!item) return list;
    const n = Number(stars);
    item.stars = Number.isFinite(n) && n >= 1 && n <= 5 ? n : undefined;
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
let _modalCatFilter = "all";
let _modalSubCatFilter = "all";
let _modalStarFilter = "all";
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
    _modalCatFilter = "all";
    _modalSubCatFilter = "all";
    _modalStarFilter = "all";
    _modalPos = null;
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

const MODAL_RIGHT_MARGIN_RATIO = 0.1;

function clampDialogPos(dialog, x, y) {
    const w = dialog.offsetWidth || 720;
    const h = dialog.offsetHeight || 240;
    const maxX = Math.max(0, window.innerWidth - w);
    const maxY = Math.max(0, window.innerHeight - h);
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
    const rightMargin = window.innerWidth * MODAL_RIGHT_MARGIN_RATIO;
    return {
        x: Math.max(0, window.innerWidth - w - rightMargin),
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

function ensureListLayout(body) {
    let catHost = body.querySelector(".cap-ui-cat-host");
    let scroll = body.querySelector(".cap-ui-list-scroll");
    if (!catHost || !scroll) {
        body.replaceChildren();
        catHost = document.createElement("div");
        catHost.className = "cap-ui-cat-host";
        scroll = document.createElement("div");
        scroll.className = "cap-ui-list-scroll";
        body.append(catHost, scroll);
    }
    return { catHost, scroll };
}

function resolveListBody(host) {
    return host?.closest?.(".cap-ui-body") ?? _modal?.querySelector?.(".cap-ui-body") ?? null;
}

function renderFilterBar(host, kind, filters, activeId, onToggle) {
    const bar = document.createElement("div");
    bar.className = "cap-ui-cat-bar";
    for (const { id, label } of filters) {
        const tag = document.createElement("button");
        tag.type = "button";
        tag.className = "cap-ui-cat-tag";
        tag.textContent = label;
        tag.dataset.filterId = id;
        if (activeId === id) tag.classList.add("active");
        tag.addEventListener("click", () => {
            onToggle(id);
            const listBody = resolveListBody(host);
            if (listBody) renderList(listBody, kind);
        });
        bar.appendChild(tag);
    }
    host.appendChild(bar);
}

function renderCategoryBar(host, kind) {
    if (kind === "history") {
        renderFilterBar(host, kind, HISTORY_STAR_FILTERS, _modalStarFilter, (id) => {
            _modalStarFilter = _modalStarFilter === id ? "all" : id;
        });
        return;
    }
    renderFilterBar(host, kind, PRESET_CAT_FILTERS, _modalCatFilter, (id) => {
        const next = _modalCatFilter === id ? "all" : id;
        _modalCatFilter = next;
        if (next !== "gu_feng_female") _modalSubCatFilter = "all";
    });
    if (_modalCatFilter === "gu_feng_female") {
        renderFilterBar(host, kind, GU_FENG_FEMALE_SUB_FILTERS, _modalSubCatFilter, (id) => {
            _modalSubCatFilter = _modalSubCatFilter === id ? "all" : id;
        });
    }
    renderFilterBar(host, kind, HISTORY_STAR_FILTERS, _modalStarFilter, (id) => {
        _modalStarFilter = _modalStarFilter === id ? "all" : id;
    });
}

function makeItemStars(item, kind, onChange) {
    const wrap = document.createElement("div");
    wrap.className = "cap-ui-history-stars";
    const current = item.stars ?? 0;
    for (let i = 1; i <= 5; i++) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cap-ui-star-btn";
        btn.textContent = "★";
        btn.title = `${i} 星`;
        if (i <= current) btn.classList.add("on");
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const next = item.stars === i ? undefined : i;
            if (kind === "history") updatePromptHistoryStars(item.id, next);
            else if (item.builtin) updateBuiltinPresetMeta(item.id, { stars: next });
            else updatePromptPresetStars(item.id, next);
            item.stars = next;
            onChange?.();
        });
        wrap.appendChild(btn);
    }
    return wrap;
}

function appendTitleInput(metaMain, item, kind) {
    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.className = "cap-ui-list-title-input";
    titleInput.value = item.title || "";
    titleInput.placeholder = "标题（可选）";
    titleInput.title = "点击编辑标题，失焦自动保存";
    titleInput.addEventListener("blur", () => {
        if (kind === "history") {
            updatePromptHistoryTitle(item.id, titleInput.value);
            const saved = getPromptHistory().find((x) => x.id === item.id);
            titleInput.value = saved?.title || "";
        } else if (item.builtin) {
            updateBuiltinPresetMeta(item.id, { title: titleInput.value });
            const extra = loadPresetMeta()[item.id] || {};
            item.title = extra.title;
            titleInput.value = extra.title || "";
        } else {
            updatePromptPresetTitle(item.id, titleInput.value);
            const saved = getPromptPresets().find((x) => x.id === item.id);
            titleInput.value = saved?.title || "";
        }
    });
    titleInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") titleInput.blur();
    });
    metaMain.append(titleInput);
}

function renderList(body, kind) {
    const { catHost, scroll } = ensureListLayout(body);
    catHost.innerHTML = "";
    scroll.innerHTML = "";
    renderCategoryBar(catHost, kind);

    let list = kind === "history" ? getPromptHistory() : getAllPresets();
    if (kind === "history") {
        list = filterHistoryByStars(list, _modalStarFilter);
    } else {
        list = filterPresetsByCategory(list, _modalCatFilter);
        list = filterPresetsBySubCategory(list, _modalCatFilter, _modalSubCatFilter);
        list = filterHistoryByStars(list, _modalStarFilter);
    }

    if (!list.length) {
        const empty = document.createElement("div");
        empty.className = "cap-ui-empty";
        empty.textContent = EMPTY_LABEL[kind] || "暂无内容";
        scroll.appendChild(empty);
        refreshModalTargetState();
        return;
    }

    for (const item of list) {
        const row = document.createElement("div");
        row.className = "cap-ui-list-item";

        const meta = document.createElement("div");
        meta.className = "cap-ui-list-meta";
        const metaMain = document.createElement("div");
        metaMain.className = "cap-ui-list-meta-main";
        if (kind === "history" || kind === "preset") {
            appendTitleInput(metaMain, item, kind);
        }

        const actions = document.createElement("div");
        actions.className = "cap-ui-actions";

        const writeText = kind === "history"
            ? item.text
            : formatPresetWriteText(item);

        const btnInsert = mkUiIconBtn(iconHtml("insert"), {
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

        const btnReplace = mkUiIconBtn(iconHtml("replace"), {
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

        if (kind === "history") {
            const defaultName = item.title || previewText(item.text, 40);
            const btnToPreset = mkUiIconBtn(iconHtml("toPreset"), {
                title: "设为预设",
                onClick: () => {
                    const name = prompt("预设名称（可留空）", defaultName);
                    if (name === null) return;
                    addPromptPreset(item.text, name, "other");
                },
            });
            actions.append(btnToPreset);
        }

        if (kind === "history" || kind === "preset") {
            const btnDel = mkUiIconBtn(iconHtml("trash"), {
                variant: "danger",
                title: "删除",
                onClick: () => {
                    const msg = kind === "history"
                        ? "删除这条历史记录？"
                        : item.builtin
                            ? "删除这条内置预设？"
                            : "删除这条预设？";
                    if (!confirm(msg)) return;
                    if (kind === "history") removePromptHistory(item.id);
                    else if (item.builtin) hideBuiltinPreset(item.id);
                    else removePromptPreset(item.id);
                    renderList(body, kind);
                },
            });
            actions.append(btnDel);
        }

        meta.append(metaMain, actions);

        const preview = document.createElement("pre");
        preview.className = "cap-ui-code-preview";
        preview.textContent = item.text;

        row.append(meta, preview);

        const footer = document.createElement("div");
        footer.className = "cap-ui-list-footer";
        const date = document.createElement("span");
        date.className = "cap-ui-list-date";
        date.textContent = item.ts ? formatTime(item.ts) : "";
        footer.append(makeItemStars(item, kind, () => renderList(body, kind)), date);
        row.append(footer);

        scroll.appendChild(row);
    }

    refreshModalTargetState();
}

function renderToolbar(toolbar, body, kind) {
    toolbar.innerHTML = "";

    if (kind === "preset") {
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
                const cat = _modalCatFilter !== "all" && PRESET_CATEGORIES[_modalCatFilter]
                    ? _modalCatFilter
                    : "other";
                addPromptPreset(text, name, cat);
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

    if (kind === "history" || kind === "preset") {
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
                    const stars = Number(item.stars);
                    list.unshift({
                        id: item.id || uid(),
                        text,
                        ts: item.ts || Date.now(),
                        title: item.title || undefined,
                        stars: Number.isFinite(stars) && stars >= 1 && stars <= 5 ? stars : undefined,
                    });
                }
                if (list.length > HISTORY_MAX) list = list.slice(0, HISTORY_MAX);
                saveList(STORAGE_HISTORY, list);
            } else {
                let list = replace ? [] : getPromptPresets();
                for (const item of items) {
                    const text = normalizeText(item?.text ?? "");
                    if (!text.trim()) continue;
                    const stars = Number(item.stars);
                    list.unshift({
                        id: item.id || uid(),
                        name: stripLeadingHash(item.name || previewText(text, 40)),
                        text,
                        ts: item.ts || Date.now(),
                        title: item.title ? stripLeadingHash(item.title) : undefined,
                        stars: Number.isFinite(stars) && stars >= 1 && stars <= 5 ? stars : undefined,
                        category: PRESET_CATEGORIES[item.category] ? item.category : "other",
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
            <button type="button" class="cap-ui-tab" data-kind="preset">预设</button>
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
        _modalCatFilter = "all";
        _modalSubCatFilter = "all";
        _modalStarFilter = "all";
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

function clearCanvasTitleButtons(node) {
    if (!Array.isArray(node.title_buttons)) return;
    const had = node.title_buttons.some(
        (b) => b.name === "cap_plib" || b.name === "cap_save",
    );
    node.title_buttons = node.title_buttons.filter(
        (b) => b.name !== "cap_plib" && b.name !== "cap_save",
    );
    if (had) node.setDirtyCanvas?.(true, true);
}

function findVueNodeEl(node) {
    if (node?.id == null) return null;
    return document.querySelector(`[data-node-id="${node.id}"]`);
}

function removeLegacyPromptHeaderUi(node) {
    const LEGACY_NAMES = new Set(["历史记录", "预设", "历史 | 预设", "保存"]);
    if (Array.isArray(node.widgets)) {
        node.widgets = node.widgets.filter((w) => {
            if (w.name === "cap_plib_btn") {
                w.element?.remove?.();
                return false;
            }
            return !(w.type === "button" && LEGACY_NAMES.has(w.name));
        });
    }
}

function bindPromptHeaderButtons(wrap, node, openHistory, openPreset) {
    if (!wrap) return;
    wrap.classList.add("cap-ui-node-btn-wrap--row");

    let historyBtn = wrap.querySelector(".cap-ui-node-btn-history");
    if (!historyBtn) {
        historyBtn = document.createElement("button");
        historyBtn.type = "button";
        historyBtn.className = "cap-ui-node-btn cap-ui-node-btn-history cap-ui-node-btn-icon";
        wrap.appendChild(historyBtn);
    }
    historyBtn.classList.add("cap-ui-node-btn-icon");
    historyBtn.innerHTML = iconHtml("history", 13);
    historyBtn.title = "历史记录";
    historyBtn.onmousedown = (e) => e.stopPropagation();
    historyBtn.onclick = (e) => {
        e.stopPropagation();
        openHistory();
    };

    let presetBtn = wrap.querySelector(".cap-ui-node-btn-preset");
    if (!presetBtn) {
        presetBtn = document.createElement("button");
        presetBtn.type = "button";
        presetBtn.className = "cap-ui-node-btn cap-ui-node-btn-preset cap-ui-node-btn-icon";
        wrap.appendChild(presetBtn);
    }
    presetBtn.classList.add("cap-ui-node-btn-icon");
    presetBtn.innerHTML = iconHtml("preset", 13);
    presetBtn.title = "预设";
    presetBtn.onmousedown = (e) => e.stopPropagation();
    presetBtn.onclick = (e) => {
        e.stopPropagation();
        openPreset();
    };

    let saveBtn = wrap.querySelector(".cap-ui-node-btn-save");
    if (!saveBtn) {
        saveBtn = document.createElement("button");
        saveBtn.type = "button";
        saveBtn.className = "cap-ui-node-btn cap-ui-node-btn-save cap-ui-node-btn-icon";
        wrap.appendChild(saveBtn);
    } else {
        saveBtn.classList.add("cap-ui-node-btn-icon");
    }
    saveBtn.innerHTML = iconHtml("save", 13);
    saveBtn.title = "保存当前提示词到历史记录";
    saveBtn.onmousedown = (e) => e.stopPropagation();
    saveBtn.onclick = (e) => {
        e.stopPropagation();
        savePromptHistoryFromNode(node);
    };
}

function ensurePromptHeaderOverlay(node, openHistory, openPreset, tries = 0) {
    ensureCapUiCss();
    let wrap = node._capPlibBtnWrap;
    if (!wrap) {
        wrap = document.createElement("div");
        wrap.className = "cap-ui-node-btn-wrap cap-ui-node-btn-wrap--row";
        node._capPlibBtnWrap = wrap;
    }
    bindPromptHeaderButtons(wrap, node, openHistory, openPreset);

    const vueEl = findVueNodeEl(node);
    const anchor = () => {
        if (vueEl || findVueNodeEl(node)) {
            return positionOverlayInNodeHeader(node, wrap)
                ?? positionOverlayFixedToHeader(node, wrap);
        }
        return positionOverlayOnCanvasTitle(node, wrap)
            ?? hoistNodeOverlay(node, wrap, { top: 4, left: 6 });
    };
    const host = anchor();
    if (!host) {
        if (tries < 80) setTimeout(() => ensurePromptHeaderOverlay(node, openHistory, openPreset, tries + 1), 50);
        return;
    }
    if (vueEl || findVueNodeEl(node)) {
        watchNodeOverlayAnchor(node, wrap, anchor, "plib");
    } else {
        watchCanvasTitleOverlay(node, wrap, anchor, "plib");
    }
}

export function ensurePromptLibraryButtons(node) {
    removeLegacyPromptHeaderUi(node);
    clearCanvasTitleButtons(node);

    const openHistory = () => {
        selectGraphNode(node);
        openPromptLibraryModal({ kind: "history", node });
    };
    const openPreset = () => {
        selectGraphNode(node);
        openPromptLibraryModal({ kind: "preset", node });
    };

    ensurePromptHeaderOverlay(node, openHistory, openPreset);
}

function savePromptHistoryFromNode(node) {
    selectGraphNode(node);
    const widget = getPromptWidget(node);
    const ta = resolvePromptTextarea(widget);
    const text = ta?.value ?? widget?.value ?? "";
    if (!normalizeText(text).trim()) {
        alert("当前提示词为空");
        return false;
    }
    addPromptHistory(text);
    if (_modal && _modalKind === "history") {
        const body = _modal.querySelector(".cap-ui-body");
        if (body) renderList(body, "history");
    }
    return true;
}
