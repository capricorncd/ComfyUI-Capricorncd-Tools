# ComfyUI-Capricorncd-Tools

![ComfyUI-Capricorncd-Tools](./docs/ComfyUI-Capricorncd-Tools.png)

A collection of custom nodes for [ComfyUI](https://github.com/comfyanonymous/ComfyUI) built around **Timeline Editor** — a fullscreen, multi-track visual editor for assembling image/video/audio sequences — plus prompt editing, audio/image keyframe timeline editing, image batch utilities, directory cleanup, and video compositing.

![/ComfyUI-Capricorncd-Tools/timeline-editor](./docs/timeline-editor.jpg)

---

## ✨ Timeline Editor

The flagship node: a fullscreen, multi-track timeline for building image/video/audio sequences directly inside ComfyUI.

- **Media library** — drag-and-drop image/video/audio assets, star ratings and filters, batch select, relink missing files
- **Multi-track canvas** — per-track lock/visibility/mute, drag/resize/split clips, undo/redo, zoom and pan
- **Per-clip prompts** — global + per-clip prompt fields, and an **AI Optimize** modal (Agent or local VL model, output-language selection, Prompt Skill library with GitHub sync)
- **Generated videos** — attach ComfyUI `output/` MP4s to a clip, enable/mute/preview, then **Export → Compose Video** mixes them with unmuted audio tracks into one MP4 (watermark, filename prefix, ignore-audio-tracks options)
- **Import / Export** — full project + assets as a directory or ZIP
- **Fully localized UI** — every panel, dialog, and menu follows ComfyUI's own **Settings → Comfy → Locale** setting (English / 简体中文 / 日本語), with English as the fallback; see [Internationalization](#internationalization-i18n) below

[Read the full guide →](docs/timeline-editor.md) · [中文文档](docs/zh/timeline-editor.md)

---

## Nodes

| Node | Description | Doc |
|------|-------------|-----|
| **Rich Prompt Input** | Prompt editor with live syntax highlighting, `#` comments, and history/presets | [→](docs/prompt-input.md) · [中文](docs/zh/prompt-input.md) |
| **Prompt Group** | Global / scene / negative prompts; counts non-empty scene prompt lines | [→](docs/prompt-group.md) · [中文](docs/zh/prompt-group.md) |
| **Prompt From Batch** | Slice scene prompts by index/length; optionally merge global prompt | [→](docs/prompt-from-batch.md) · [中文](docs/zh/prompt-from-batch.md) |
| **Audio Timeline** | Waveform trim + image keyframe clip track + per-clip prompts | [→](docs/audio-timeline.md) · [中文](docs/zh/audio-timeline.md) |
| **Timeline Editor** | Fullscreen multi-track editor; generated-video preview/mute; Export → Compose Video; `swap_wh`; outputs `data_json` and `frame_seq_dir` | [→](docs/timeline-editor.md) · [中文](docs/zh/timeline-editor.md) |
| **Generate Timeline Preview** | Current project + Clip ID → complete in-memory MiniMax H3 preview; sampling and AV decode are built in | [→](docs/timeline-editor.md#ai-optimize-prompt) · [中文](docs/zh/timeline-editor.md#ai-优化提示词) |
| **Data Json Clip Parser** | Extracts a single clip from Audio Timeline / Timeline Editor `data_json` output | [→](docs/data-json-clip-parser.md) · [中文](docs/zh/data-json-clip-parser.md) |
| **MiniMaxH3** | Timeline `data_json` clip → MiniMax H3 Reference to Video (refs + prompt + latent) | [→](docs/minimax-h3.md) · [中文](docs/zh/minimax-h3.md) |
| **Save Images** | Saves an `IMAGE` batch to disk; optional `{prefix}.json` sidecar with prompts and models | [→](docs/save-images.md) · [中文](docs/zh/save-images.md) |
| **Load Images From Dir** | Loads images from a directory into an `IMAGE` batch | [→](docs/load-images-from-dir.md) · [中文](docs/zh/load-images-from-dir.md) |
| **Image Batch Count** | Returns the number of images in a batch | [→](docs/image-batch.md) · [中文](docs/zh/image-batch.md) |
| **Image From Batch Index** | Extracts one image from a batch by index | [→](docs/image-batch.md) · [中文](docs/zh/image-batch.md) |
| **Seq To Video** | Composes frames + optional audio into MP4 via ffmpeg; writes a same-name JSON with prompts and models | [→](docs/seq-to-video.md) · [中文](docs/zh/seq-to-video.md) |
| **Compose Clip Videos** | Concatenates per-clip MP4s into one timeline video; optional same-name JSON sidecar | [→](docs/compose-clip-videos.md) · [中文](docs/zh/compose-clip-videos.md) |
| **Join Strings** | Joins a variable number of string/int/float inputs; newline, comma, `_`, `-`, `/`, none, or custom separator | [→](docs/join-strings.md) · [中文](docs/zh/join-strings.md) |
| **Clear Directory** | Deletes selected media files in a directory; supports Recycle Bin on Windows | [→](docs/clear-directory.md) · [中文](docs/zh/clear-directory.md) |
| **Size Settings** | Size preset / scale / lock aspect / orientation → `width`, `height`, `count`, `fps` | [→](docs/size-settings.md) · [中文](docs/zh/size-settings.md) |
| **Format JSON** | Pretty-print a JSON string in the graph UI | [→](docs/format-json.md) · [中文](docs/zh/format-json.md) |
| **Show Anything** | Show any value on the node; persists across refresh; optional Format JSON | [→](docs/show-anything.md) · [中文](docs/zh/show-anything.md) |

---

## Typical pipeline

```
Timeline Editor / Audio Timeline
  ├── trimmed_audio / clips_audio ──► (audio processing)
  ├── frame_seq_dir               ──► Save Images (frame output directory)
  ├── data_json                   ──► Data Json Clip Parser (looped per clip)
  │                                     ├── audio, frame_count, first_frame, last_frame, prompt
  │                                     └── ──► generation nodes ──► Save Images
  │                                               ├── image_paths ──► Seq To Video
  │                                               └── image_dir   ──► Clear Directory (cleanup)
  │                           or ──► MiniMaxH3 (index loop) ──► H3 sample / decode
  └── clips_length                ──► loop limit
```

**Seq To Video** accepts frames from three sources (only one is used per run):

1. `images` — direct `IMAGE` batch input
2. `image_paths` — comma-separated paths from **Save Images**
3. `frames_dir` — numbered sequence scan from a directory

The **Disable / Enable** feature in Audio Timeline / Timeline Editor lets you re-generate a single segment without touching the rest of the timeline. See [Audio Timeline](docs/audio-timeline.md#clip-disable--enable) and [Timeline Editor](docs/timeline-editor.md#clip-disable--enable).

**Timeline Editor** can also attach ComfyUI `output/` MP4s as **generated videos** per clip (enable / mute / preview), and **Export → Compose Video** mixes enabled generated videos with unmuted audio tracks into one MP4 under `output/` (default prefix `cap_timeline_compose/`). See [Timeline Editor](docs/timeline-editor.md#generated-videos).

---

## Installation

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/capricorncd/ComfyUI-Capricorncd-Tools
```

Restart ComfyUI. No additional Python packages are required beyond a standard ComfyUI installation.

> **Seq To Video**, **Compose Clip Videos**, and Timeline Editor **Compose Video** require [ffmpeg](https://ffmpeg.org/download.html) on the system `PATH`.

---

## Documentation

Hand-written guides live under `docs/`. Input/output tables marked with `<!-- AUTO:API -->` can be regenerated from node metadata:

```bash
python scripts/gen_node_docs.py
```

```
docs/
├── prompt-input.md
├── prompt-group.md
├── prompt-from-batch.md
├── audio-timeline.md
├── timeline-editor.md
├── data-json-clip-parser.md
├── minimax-h3.md
├── save-images.md
├── load-images-from-dir.md
├── image-batch.md
├── seq-to-video.md
├── compose-clip-videos.md
├── join-strings.md
├── clear-directory.md
├── size-settings.md
├── format-json.md
├── show-anything.md
└── zh/                  # 简体中文文档
    └── (same set)
```

Node API fields are defined in code (`DESCRIPTION`, input `tooltip`, `OUTPUT_TOOLTIPS`) so the graph UI and docs stay aligned.

---

## Internationalization (i18n)

The whole extension — not just node graph metadata — follows ComfyUI's own **Settings → Comfy → Locale** setting automatically, falling back to English wherever a language isn't available:

- **Node graph metadata** (titles, widget names, tooltips, boolean on/off labels) via ComfyUI's built-in i18n system, plus a small patch for the two newer-schema nodes ComfyUI's own locale loader doesn't reach yet
- **Every custom UI panel** — Timeline Editor (media library, clip settings, AI Optimize modal, Prompt Skill picker, import/export, compose video, etc.), Audio Timeline, and the Prompt Library (history/presets) — all dialogs, buttons, menus, and status/error messages
- **Backend error and status text** returned to the frontend

Locale files live in `locales/`:

```
locales/
├── en/nodeDefs.json
├── zh/nodeDefs.json, commands.json
└── ja/nodeDefs.json, commands.json
```

| Language | Code |
|----------|------|
| English  | `en` |
| 简体中文  | `zh` |
| 日本語   | `ja` |

A language change takes effect for newly-registered node defs and for panels opened after the change; an already-open panel picks it up on the next page refresh.

---

## License

MIT
