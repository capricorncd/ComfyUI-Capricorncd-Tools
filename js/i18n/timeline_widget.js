import { makeT } from "../cap_i18n.js";

export const DICT = {
    en: {
        add_track: "+ Track",
        add_track_title: "Add an image or audio track",
        video_track: "Video Track",
        audio_track: "Audio Track",
        image_track: "Image Track",
        text_track: "Text Track",
    },
    zh: {
        add_track: "+ 轨道",
        add_track_title: "添加图片或音频轨道",
        video_track: "视频轨道",
        audio_track: "音频轨道",
        image_track: "图片轨道",
        text_track: "文字轨道",
    },
    ja: {
        add_track: "+ トラック",
        add_track_title: "画像またはオーディオのトラックを追加",
        video_track: "ビデオトラック",
        audio_track: "オーディオトラック",
        image_track: "画像トラック",
        text_track: "テキストトラック",
    },
};

export const t = makeT(DICT);
