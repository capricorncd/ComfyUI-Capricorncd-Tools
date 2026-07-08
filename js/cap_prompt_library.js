/** Shared History / Preset library for Rich Prompt Input. */

import { updateRichPromptMirror } from "./rich_prompt.js";

const STORAGE_HISTORY = "capricorncd.rich_prompt.history";
const STORAGE_PRESETS = "capricorncd.rich_prompt.presets";
const HISTORY_MAX = 80;
const EXT_PREFIX = "ComfyUI-Capricorncd-Tools";

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
        ta.value = ta.value.slice(0, start) + value + ta.value.slice(end);
        const pos = start + value.length;
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

function loadCss() {
    if (document.getElementById("cap-prompt-library-styles")) return;
    const link = document.createElement("link");
    link.id = "cap-prompt-library-styles";
    link.rel = "stylesheet";
    link.href = `/extensions/${EXT_PREFIX}/cap_prompt_library.css`;
    document.head.appendChild(link);
}

let _modal = null;
let _modalKind = "presets";
let _modalTargetTa = null;
let _modalTargetWidget = null;

function closePromptLibraryModal() {
    if (_modal?._capOnKey) {
        window.removeEventListener("keydown", _modal._capOnKey, true);
    }
    _modal?.remove();
    _modal = null;
    _modalKind = "presets";
    _modalTargetTa = null;
    _modalTargetWidget = null;
}

function syncWidgetFromTa() {
    if (_modalTargetWidget && _modalTargetTa) {
        _modalTargetWidget.value = _modalTargetTa.value;
    }
}

function renderList(body, kind) {
    body.innerHTML = "";
    const list = kind === "history" ? getPromptHistory() : getPromptPresets();
    if (!list.length) {
        const empty = document.createElement("div");
        empty.className = "cap-plib-empty";
        empty.textContent = kind === "history" ? "暂无历史记录" : "暂无预设";
        body.appendChild(empty);
        return;
    }

    for (const item of list) {
        const row = document.createElement("div");
        row.className = "cap-plib-item";

        const meta = document.createElement("div");
        meta.className = "cap-plib-meta";
        const title = document.createElement("div");
        title.className = "cap-plib-title";
        if (kind === "history") {
            title.textContent = formatTime(item.ts);
            meta.append(title);
        } else {
            title.textContent = item.name || previewText(item.text, 40);
            const sub = document.createElement("div");
            sub.className = "cap-plib-sub";
            sub.textContent = formatTime(item.ts);
            meta.append(title, sub);
        }

        const preview = document.createElement("pre");
        preview.className = "cap-plib-preview";
        preview.textContent = item.text;

        const actions = document.createElement("div");
        actions.className = "cap-plib-actions";

        const btnInsert = document.createElement("button");
        btnInsert.type = "button";
        btnInsert.textContent = "插入";
        btnInsert.title = "插入到光标位置（无光标则追加到末尾）";
        btnInsert.addEventListener("click", () => {
            applyPromptToTextarea(_modalTargetTa, item.text, "insert");
            syncWidgetFromTa();
        });

        const btnReplace = document.createElement("button");
        btnReplace.type = "button";
        btnReplace.className = "cap-plib-primary";
        btnReplace.textContent = "替换";
        btnReplace.title = "替换输入框全部内容";
        btnReplace.addEventListener("click", () => {
            applyPromptToTextarea(_modalTargetTa, item.text, "replace");
            syncWidgetFromTa();
            closePromptLibraryModal();
        });

        const btnDel = document.createElement("button");
        btnDel.type = "button";
        btnDel.className = "cap-plib-danger";
        btnDel.textContent = "删除";
        btnDel.addEventListener("click", () => {
            if (kind === "history") removePromptHistory(item.id);
            else removePromptPreset(item.id);
            renderList(body, kind);
        });

        actions.append(btnInsert, btnReplace, btnDel);
        row.append(meta, preview, actions);
        body.appendChild(row);
    }
}

function renderToolbar(toolbar, body, kind) {
    toolbar.innerHTML = "";
    const mkBtn = (label, cls, onClick) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        if (cls) b.className = cls;
        b.addEventListener("click", onClick);
        return b;
    };

    if (kind === "presets") {
        toolbar.appendChild(mkBtn("保存当前为预设", "cap-plib-primary", () => {
            const text = _modalTargetTa?.value ?? "";
            if (!String(text).trim()) {
                alert("当前提示词为空");
                return;
            }
            const name = prompt("预设名称（可留空）", previewText(text, 40));
            if (name === null) return;
            addPromptPreset(text, name);
            renderList(body, kind);
        }));
    } else {
        toolbar.appendChild(mkBtn("保存当前到历史", "cap-plib-primary", () => {
            const text = _modalTargetTa?.value ?? "";
            if (!String(text).trim()) {
                alert("当前提示词为空");
                return;
            }
            addPromptHistory(text);
            renderList(body, kind);
        }));
    }

    toolbar.appendChild(mkBtn("导出", null, () => {
        const list = kind === "history" ? getPromptHistory() : getPromptPresets();
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
        downloadJson(
            `cap-${kind}-${stamp}.json`,
            { kind, version: 1, items: list },
        );
    }));

    toolbar.appendChild(mkBtn("导入", null, async () => {
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
    }));

    toolbar.appendChild(mkBtn("清空", "cap-plib-danger", () => {
        if (!confirm(kind === "history" ? "清空全部历史记录？" : "清空全部预设？")) return;
        if (kind === "history") clearPromptHistory();
        else clearPromptPresets();
        renderList(body, kind);
    }));
}

function setActiveTab(tabsEl, kind) {
    for (const btn of tabsEl.querySelectorAll(".cap-plib-tab")) {
        btn.classList.toggle("active", btn.dataset.kind === kind);
    }
}

function buildModal(initialKind = "presets") {
    const overlay = document.createElement("div");
    overlay.className = "cap-plib-overlay";
    overlay.innerHTML = `
      <div class="cap-plib-dialog" role="dialog" aria-modal="true">
        <div class="cap-plib-hd">
          <h3 class="cap-plib-hd-title">预设 / 历史记录</h3>
          <button type="button" class="cap-plib-x" title="关闭">✕</button>
        </div>
        <div class="cap-plib-tabs">
          <button type="button" class="cap-plib-tab" data-kind="presets">预设</button>
          <button type="button" class="cap-plib-tab" data-kind="history">历史记录</button>
        </div>
        <div class="cap-plib-toolbar"></div>
        <div class="cap-plib-body"></div>
      </div>
    `;

    const dialog = overlay.querySelector(".cap-plib-dialog");
    const tabs = overlay.querySelector(".cap-plib-tabs");
    const toolbar = overlay.querySelector(".cap-plib-toolbar");
    const body = overlay.querySelector(".cap-plib-body");
    const btnClose = overlay.querySelector(".cap-plib-x");

    const switchKind = (kind) => {
        _modalKind = kind;
        setActiveTab(tabs, kind);
        renderToolbar(toolbar, body, kind);
        renderList(body, kind);
    };

    tabs.addEventListener("click", (e) => {
        const btn = e.target.closest(".cap-plib-tab");
        if (!btn) return;
        switchKind(btn.dataset.kind);
    });

    btnClose.addEventListener("click", closePromptLibraryModal);
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closePromptLibraryModal();
    });
    dialog.addEventListener("click", (e) => e.stopPropagation());

    const onKey = (e) => {
        if (e.key === "Escape") {
            closePromptLibraryModal();
        }
    };
    window.addEventListener("keydown", onKey, true);
    overlay._capOnKey = onKey;

    switchKind(initialKind === "history" ? "history" : "presets");
    return overlay;
}

export function openPromptLibraryModal({ kind = "presets", textarea, widget } = {}) {
    loadCss();
    closePromptLibraryModal();
    if (!textarea) {
        alert("未找到提示词输入框");
        return;
    }
    trackCaret(textarea);
    if (widget) textarea._capBoundWidget = widget;
    _modalKind = kind === "history" ? "history" : "presets";
    _modalTargetTa = textarea;
    _modalTargetWidget = widget ?? null;
    _modal = buildModal(_modalKind);
    document.body.appendChild(_modal);
}

export function ensurePromptLibraryButtons(node, getTextarea, getWidget) {
    const OLD_NAMES = new Set(["历史记录", "预设", "预设/历史记录"]);
    if (Array.isArray(node.widgets)) {
        node.widgets = node.widgets.filter((w) => !(w.type === "button" && OLD_NAMES.has(w.name)));
    }
    if (node._capPLibButtons) return;
    node._capPLibButtons = true;

    node.addWidget("button", "预设/历史记录", null, () => {
        openPromptLibraryModal({
            kind: "presets",
            textarea: getTextarea(),
            widget: getWidget(),
        });
    });
}
