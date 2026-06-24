# ComfyUI-Capricorncd-Tools

![ComfyUI-Capricorncd-Tools](./docs/ComfyUI-Capricorncd-Tools.png)

A collection of custom nodes for [ComfyUI](https://github.com/comfyanonymous/ComfyUI) focused on prompt editing, audio/image keyframe timeline editing, and video compositing.

---

## Nodes

| Node | Description | Doc |
|------|-------------|-----|
| **Prompt Input** | Multi-line prompt editor with `#` line-comment support | [→](docs/prompt-input.md) |
| **Rich Prompt Input** | Prompt editor with live syntax highlighting overlay | [→](docs/prompt-input.md) |
| **Audio Timeline** | Waveform trim + image keyframe clip track + per-clip prompts | [→](docs/audio-timeline.md) |
| **Data Json Clip Parser** | Extracts a single clip from Audio Timeline's `data_json` output | [→](docs/data-json-clip-parser.md) |
| **Seq To Video** | Composes an image sequence and audio into MP4 via ffmpeg | [→](docs/seq-to-video.md) |
| **Save Images** | Saves a batch of images to a configurable directory; returns the directory path and a comma-separated list of saved file paths | [→](docs/save-images.md) |

---

## Typical pipeline

```
Audio Timeline
  ├── trimmed_audio  ──► (audio processing)
  ├── clips_audio    ──► (per-clip audio)
  ├── frame_seq_dir  ──► Save Images (output directory for frame sequences)
  ├── data_json      ──► Data Json Clip Parser (looped per clip)
  │                          ├── audio, frame_count, first_frame, last_frame, prompt
  │                          └── ──► generation nodes ──► Save Images ──► Seq To Video
  └── clips_length   ──► loop limit
```

The **Disable / Enable** feature in Audio Timeline lets you re-generate a single segment without touching the rest of the timeline — disable all other clips, re-run, then re-enable. See the [Audio Timeline doc](docs/audio-timeline.md#clip-disable--enable) for details.

---

## Installation

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/capricorncd/ComfyUI-Capricorncd-Tools
```

Restart ComfyUI. No additional Python packages are required beyond a standard ComfyUI installation.

> **Seq To Video** additionally requires [ffmpeg](https://ffmpeg.org/download.html) to be installed and available on the system `PATH`.

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
