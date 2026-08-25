import { makeT } from "../cap_i18n.js";

export const DICT = {
    en: {
        waiting_compose: "Waiting to compose…",
        ffmpeg_not_found: "ffmpeg not found; please install it and restart ComfyUI",
    },
    zh: {
        waiting_compose: "等待合成…",
        ffmpeg_not_found: "未检测到 ffmpeg，请安装后重启 ComfyUI",
    },
    ja: {
        waiting_compose: "合成待ち…",
        ffmpeg_not_found: "ffmpeg が見つかりません。インストール後に ComfyUI を再起動してください",
    },
};

export const t = makeT(DICT);
