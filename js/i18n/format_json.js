import { makeT } from "../cap_i18n.js";

export const DICT = {
    en: {
        preview_placeholder: "Formatted JSON appears here after running…",
    },
    zh: {
        preview_placeholder: "运行后在此显示格式化 JSON…",
    },
    ja: {
        preview_placeholder: "実行後にここへ整形済み JSON が表示されます…",
    },
};

export const t = makeT(DICT);
