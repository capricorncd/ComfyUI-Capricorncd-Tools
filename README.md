# ComfyUI-Capricorncd-Tools

![ComfyUI-Capricorncd-Tools](./docs/ComfyUI-Capricorncd-Tools.png)

A collection of custom nodes for [ComfyUI](https://github.com/comfyanonymous/ComfyUI) focused on prompt editing, audio/image keyframe timeline editing, image batch utilities, directory cleanup, and video compositing.

![Audio Timeline/ComfyUI-Capricorncd-Tools](docs/audio-timeline-00.jpg)

---

## Nodes

| Node | Description | Doc |
|------|-------------|-----|
| **Prompt Input** | Multi-line prompt editor with `#` line-comment support | [→](docs/prompt-input.md) · [中文](docs/zh/prompt-input.md) |
| **Rich Prompt Input** | Prompt editor with live syntax highlighting overlay | [→](docs/prompt-input.md) · [中文](docs/zh/prompt-input.md) |
| **Audio Timeline** | Waveform trim + image keyframe clip track + per-clip prompts | [→](docs/audio-timeline.md) · [中文](docs/zh/audio-timeline.md) |
| **Timeline Editor** | Fullscreen multi-track timeline editor; outputs `frame_seq_dir` for downstream frame workflows | [→](docs/audio-timeline.md) · [中文](docs/zh/audio-timeline.md) |
| **Data Json Clip Parser** | Extracts a single clip from Audio Timeline / Timeline Editor `data_json` output | [→](docs/data-json-clip-parser.md) · [中文](docs/zh/data-json-clip-parser.md) |
| **Save Images** | Saves an `IMAGE` batch to disk; returns directory path and comma-separated file paths | [→](docs/save-images.md) · [中文](docs/zh/save-images.md) |
| **Load Images From Dir** | Loads images from a directory into an `IMAGE` batch | [→](docs/load-images-from-dir.md) · [中文](docs/zh/load-images-from-dir.md) |
| **Image Batch Count** | Returns the number of images in a batch | [→](docs/image-batch.md) · [中文](docs/zh/image-batch.md) |
| **Image From Batch Index** | Extracts one image from a batch by index | [→](docs/image-batch.md) · [中文](docs/zh/image-batch.md) |
| **Seq To Video** | Composes frames + optional audio into MP4 via ffmpeg | [→](docs/seq-to-video.md) · [中文](docs/zh/seq-to-video.md) |
| **Clear Directory** | Deletes selected media files in a directory; supports Recycle Bin on Windows | [→](docs/clear-directory.md) · [中文](docs/zh/clear-directory.md) |

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
  └── clips_length                ──► loop limit
```

**Seq To Video** accepts frames from three sources (only one is used per run):

1. `images` — direct `IMAGE` batch input
2. `image_paths` — comma-separated paths from **Save Images**
3. `frames_dir` — numbered sequence scan from a directory

The **Disable / Enable** feature in Audio Timeline lets you re-generate a single segment without touching the rest of the timeline. See the [Audio Timeline doc](docs/audio-timeline.md#clip-disable--enable) for details.

---

## Installation

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/capricorncd/ComfyUI-Capricorncd-Tools
```

Restart ComfyUI. No additional Python packages are required beyond a standard ComfyUI installation.

> **Seq To Video** additionally requires [ffmpeg](https://ffmpeg.org/download.html) to be installed and available on the system `PATH`.

---

## Documentation

```
docs/
├── prompt-input.md
├── audio-timeline.md
├── data-json-clip-parser.md
├── save-images.md
├── load-images-from-dir.md
├── image-batch.md
├── seq-to-video.md
├── clear-directory.md
└── zh/                  # 简体中文文档
    ├── prompt-input.md
    ├── audio-timeline.md
    ├── data-json-clip-parser.md
    ├── save-images.md
    ├── load-images-from-dir.md
    ├── image-batch.md
    ├── seq-to-video.md
    └── clear-directory.md
```

---

## Internationalization (i18n)

Node display names and input/output labels are localized via ComfyUI's built-in i18n system. Locale files live in `locales/`:

```
locales/
├── en/nodeDefs.json
└── zh/nodeDefs.json
```

| Language | Code |
|----------|------|
| English  | `en` |
| 简体中文  | `zh` |

---

## License

MIT
