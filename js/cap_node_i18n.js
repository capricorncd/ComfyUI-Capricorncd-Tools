/**
 * Node-definition localization ComfyUI's own locale system can't cover:
 *
 * 1. BOOLEAN widget label_on/label_off text. ComfyUI's locales/<lang>/
 *    nodeDefs.json only supports overriding widget *names* and combo
 *    *option* labels (see docs.comfy.org/custom-nodes/i18n) -- there is
 *    no supported key for a boolean's on/off text yet, so every toggle
 *    would otherwise stay in whatever language its Python default uses
 *    (English), regardless of ComfyUI's language setting.
 *
 * 2. CAP_JoinStrings and CAP_ShowAnything, which are defined with the
 *    newer io.ComfyNode / io.Schema API. As of this writing ComfyUI's
 *    frontend does not apply locales/<lang>/nodeDefs.json to V3-schema
 *    nodes at all (see Comfy-Org/ComfyUI#10379) -- their title, widget
 *    names and tooltips need to be patched here too, or they simply
 *    never translate no matter what locales/ja or locales/zh contain.
 *
 * Both are patched in `beforeRegisterNodeDef`, which runs once per node
 * class when ComfyUI's node definitions load, before any node of that
 * class is placed on the canvas -- so this reads the current language at
 * that moment. Like the rest of ComfyUI's own localization, a change to
 * Settings > Comfy > Locale takes effect for newly-registered/reloaded
 * node defs; existing graphs pick it up after a page refresh.
 */
import { app } from "../../scripts/app.js";
import { getLocale } from "./cap_i18n.js";

// -- 1. BOOLEAN label_on/label_off, per node class + widget name. --
// English is omitted: it's already what the Python default provides,
// which is exactly the fallback this table needs when a locale (or a
// widget within it) isn't listed here.
const BOOLEAN_LABELS = {
    CAP_SizeSettings: {
        lock_aspect: {
            zh: { on: "锁定", off: "自由" },
            ja: { on: "固定", off: "自由" },
        },
    },
    CAP_SaveImages: {
        save_as_zip: {
            zh: { on: "打包 zip", off: "仅图片" },
            ja: { on: "ZIP にまとめる", off: "画像のみ" },
        },
        save_sidecar: {
            zh: { on: "保存 JSON", off: "不保存" },
            ja: { on: "JSON を保存", off: "保存しない" },
        },
    },
    CAP_SeqToVideo: {
        save_sidecar: {
            zh: { on: "保存 JSON", off: "不保存" },
            ja: { on: "JSON を保存", off: "保存しない" },
        },
    },
    CAP_ComposeClipVideos: {
        trim_extends: {
            zh: { on: "裁剪首尾扩展", off: "不裁剪" },
            ja: { on: "拡張部分をトリム", off: "トリムしない" },
        },
        save_sidecar: {
            zh: { on: "保存 JSON", off: "不保存" },
            ja: { on: "JSON を保存", off: "保存しない" },
        },
    },
    CAP_PromptFromBatch: {
        merge_global: {
            zh: { on: "合并", off: "不合并" },
            ja: { on: "結合", off: "結合しない" },
        },
    },
    CAP_JoinStrings: {
        leading_blank: {
            zh: { on: "插入开始空行", off: "无开始空行" },
            ja: { on: "先頭に空行", off: "先頭空行なし" },
        },
        trailing_blank: {
            zh: { on: "插入结尾空行", off: "无结尾空行" },
            ja: { on: "末尾に空行", off: "末尾空行なし" },
        },
    },
};

// -- 2. Full text for the two V3-schema nodes ComfyUI's own locale
// system ignores. English is what's already in the Python source
// (define_schema), listed here too so this table is self-contained.
const V3_NODE_TEXT = {
    CAP_JoinStrings: {
        display_name: {
            en: "Join Strings", zh: "字符串拼接", ja: "文字列を結合",
        },
        inputs: {
            join_mode: {
                name: { en: "Join Mode", zh: "拼接方式", ja: "結合方法" },
                tooltip: {
                    en: "Join separator: newline, comma, underscore, hyphen, slash, or none (empty). custom_sep takes priority when non-empty.",
                    zh: "拼接分隔：换行、逗号、下划线、横线、斜线、无（空字符）。custom_sep 非空时优先。",
                    ja: "結合の区切り: 改行、カンマ、アンダースコア、ハイフン、スラッシュ、なし（空文字）。custom_sep が空でない場合はそちらを優先します。",
                },
                // Option *values* (newline/comma/...) are intentionally left
                // untranslated -- see the note above beforeRegisterNodeDef's
                // v3Text handling.
            },
            custom_sep: {
                name: { en: "Custom Separator", zh: "自定义分隔符", ja: "カスタム区切り文字" },
                tooltip: {
                    en: "Custom separator; takes priority over join_mode when non-empty. Leave blank to use the option above.",
                    zh: "自定义分隔符；有内容时优先于拼接方式。空则使用上方选项。",
                    ja: "カスタム区切り文字。空でない場合は結合方法より優先されます。空欄の場合は上のオプションを使用します。",
                },
            },
            leading_blank: {
                name: { en: "Leading Blank", zh: "开始空行", ja: "先頭の空行" },
                tooltip: {
                    en: "Insert a blank segment before the joined result (a blank line, in newline mode)",
                    zh: "在拼接结果最前插入一个空段（换行模式下即空行）",
                    ja: "結合結果の先頭に空のセグメントを挿入します（改行モードでは空行になります）",
                },
            },
            trailing_blank: {
                name: { en: "Trailing Blank", zh: "结尾空行", ja: "末尾の空行" },
                tooltip: {
                    en: "Insert a blank segment after the joined result (a blank line, in newline mode)",
                    zh: "在拼接结果最后插入一个空段（换行模式下即空行）",
                    ja: "結合結果の末尾に空のセグメントを挿入します（改行モードでは空行になります）",
                },
            },
            prefix: {
                name: { en: "Prefix", zh: "前缀", ja: "接頭辞" },
                tooltip: { en: "Overall prefix", zh: "整体前缀", ja: "全体の接頭辞" },
            },
            suffix: {
                name: { en: "Suffix", zh: "后缀", ja: "接尾辞" },
                tooltip: { en: "Overall suffix", zh: "整体后缀", ja: "全体の接尾辞" },
            },
            texts: {
                name: { en: "Texts", zh: "文本", ja: "テキスト" },
            },
        },
        outputs: {
            STRING: { name: { en: "String", zh: "字符串", ja: "文字列" } },
        },
    },
    CAP_ShowAnything: {
        display_name: {
            en: "Show Anything", zh: "展示任何", ja: "何でも表示",
        },
        inputs: {
            anything: {
                name: { en: "Anything", zh: "输入任何", ja: "任意の値" },
                tooltip: {
                    en: "Any type of input; may be left unconnected",
                    zh: "任意类型输入；可空",
                    ja: "任意の型の入力。未接続でも構いません",
                },
            },
            format_json: {
                name: { en: "Format JSON", zh: "格式化 JSON", ja: "JSON を整形" },
            },
        },
        outputs: {
            output: { name: { en: "Output", zh: "输出", ja: "出力" } },
        },
    },
};

function pick(table, locale) {
    return table[locale] || table.en;
}

app.registerExtension({
    name: "Capricorncd.NodeI18n",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        const boolLabels = BOOLEAN_LABELS[nodeData.name];
        const v3Text = V3_NODE_TEXT[nodeData.name];
        if (!boolLabels && !v3Text) return;

        const locale = getLocale();
        const requiredInputs = nodeData.input?.required || {};
        const optionalInputs = nodeData.input?.optional || {};

        if (boolLabels) {
            for (const [widgetName, byLocale] of Object.entries(boolLabels)) {
                const cfg = (requiredInputs[widgetName] || optionalInputs[widgetName])?.[1];
                const text = byLocale[locale];
                if (cfg && text) {
                    cfg.label_on = text.on;
                    cfg.label_off = text.off;
                }
            }
        }

        if (v3Text) {
            if (v3Text.display_name) nodeData.display_name = pick(v3Text.display_name, locale);
            for (const [inputName, spec] of Object.entries(v3Text.inputs || {})) {
                const cfg = (requiredInputs[inputName] || optionalInputs[inputName])?.[1];
                if (!cfg) continue;
                if (spec.tooltip) cfg.tooltip = pick(spec.tooltip, locale);
                // Deliberately NOT translating join_mode's combo *values* here:
                // ["newline", "comma", ...] are also what execute() matches on
                // and what gets serialized into the saved workflow. Swapping
                // them for translated display text the way locales/*/nodeDefs
                // .json's "options" map does for classic nodes would change the
                // stored widget value itself for V3 combos (no separate
                // value/label split confirmed in this widget), breaking both
                // the node's own logic and cross-locale workflow portability.
                // Widget *names* on V3 nodes: best-effort only, since it isn't
                // documented which field the frontend reads for this -- if it's
                // not `label`, this line is a harmless no-op.
                if (spec.name) cfg.label = pick(spec.name, locale);
            }
            if (v3Text.outputs && Array.isArray(nodeData.output_name)) {
                const outputKeys = Object.keys(v3Text.outputs);
                nodeData.output_name = nodeData.output_name.map((raw, i) => {
                    const spec = v3Text.outputs[raw] || v3Text.outputs[outputKeys[i]];
                    return spec ? pick(spec.name, locale) : raw;
                });
            }
        }
    },
});
