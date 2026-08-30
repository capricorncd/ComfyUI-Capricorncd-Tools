import { makeT } from "../cap_i18n.js";

export const DICT = {
    en: {
        add_track: "+ Track",
        add_track_title: "Add a media, audio, or subtitle track",
        video_track: "Video Track",
        audio_track: "Audio Track",
        image_track: "Media Track",
        text_track: "Subtitle Track",
    },
    zh: {
        add_track: "+ 轨道",
        add_track_title: "添加媒体、音频或字幕轨道",
        video_track: "视频轨道",
        audio_track: "音频轨道",
        image_track: "媒体轨道",
        text_track: "字幕轨道",
    },
    ja: {
        add_track: "+ トラック",
        add_track_title: "メディア・オーディオ・字幕トラックを追加",
        video_track: "ビデオトラック",
        audio_track: "オーディオトラック",
        image_track: "メディアトラック",
        text_track: "字幕トラック",
    },
};

export const t = makeT(DICT);
