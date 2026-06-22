# ComfyUI-Capricorncd-Tools

![ComfyUI-Capricorncd-Tools](./docs/ComfyUI-Capricorncd-Tools.png)

A collection of custom nodes for [ComfyUI](https://github.com/comfyanonymous/ComfyUI) focused on prompt editing, audio/image keyframe timeline editing, and video compositing.

---

## Nodes

### Prompt Input

**Category:** `Capricorncd`

A clean prompt input node that supports line comments. Lines beginning with `#` are treated as comments and stripped from the output automatically.

**Shortcut:** `Ctrl+/` — toggle comment on the current line or selected lines.

| Output | Type | Description |
|--------|------|-------------|
| `prompt` | STRING | Active (non-commented) lines joined with newlines |

---

### Rich Prompt Input

**Category:** `Capricorncd`

An enhanced prompt input with live in-editor syntax highlighting rendered via a transparent overlay mirror.

**Features:**
- `Ctrl+/` — toggle `#` comment on the current line or selection; commented lines are dimmed in the editor
- Paste strips formatting (plain text only)
- Comment markers are stripped from the output; only the raw text content is passed downstream

| Output | Type | Description |
|--------|------|-------------|
| `prompt` | STRING | Active lines with comment markers removed |

---

### Audio Timeline

**Category:** `Capricorncd`

A full-featured audio waveform timeline editor with image keyframe clip track, per-clip prompts, and structured JSON output.

**Waveform panel**
- Visual waveform display powered by [WaveSurfer.js](https://wavesurfer.xyz/)
- Drag the left / right handles to set the trim range (`start_time` / `end_time`)
- Click to place the playhead; `▶` button to play/pause the trimmed selection

**Clip track**
- `＋ 添加图片` — open image picker at the current playhead position; double-click the track to add at that position
- Clips are always contiguous (no gaps); they pack left automatically after any move, resize, or delete
- Each clip shows a `[首]` / `[首尾]` badge when start / end keyframe images are assigned; hover the badge to preview the frames
- Right-click a clip for the context menu: assign start image, assign end image, clear end image, copy, paste, delete

**Image picker**
- Lists all images found in `keyframe_dir`
- **↻ 刷新** button re-scans the directory without closing the picker

**Import / Export**
- **导出** — downloads the full timeline configuration (all widget values + clip list) as a `.json` file named after the loaded audio file
- **导入** — restores widget values and clip list from a previously exported `.json` file

**Keyboard shortcuts** (node must be selected)

| Key | Action |
|-----|--------|
| `←` / `→` | Move playhead one frame |
| `Q` | Trim left edge of selected clip to playhead |
| `W` | Trim right edge of selected clip to playhead |
| `Delete` / `Backspace` | Delete selected clip |
| `Ctrl+C` | Copy selected clip |
| `Ctrl+V` | Paste clip at end of timeline |
| `Escape` | Deselect / close picker |

**Inputs**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `audio` | FILE | — | Audio or video file from the ComfyUI input directory |
| `fps` | FLOAT | 24.0 | Frames per second |
| `width` | INT | 720 | Output video width |
| `height` | INT | 1280 | Output video height |
| `keyframe_dir` | STRING | — | Directory containing keyframe images |
| `one_shot` | BOOLEAN | true | In one-shot mode, each non-last clip's end frame is automatically set to the next clip's start frame |
| `global_prompt` | STRING | — | Default prompt applied to all clips that have no per-clip prompt |
| `trim_offset` | INT | 1 | Extra seconds appended to the `AUDIO` output end time (does **not** affect `data_json` timings or frame counts) |

**Outputs**

| Name | Type | Description |
|------|------|-------------|
| `audio` | AUDIO | Trimmed audio segment extended by `trim_offset` seconds |
| `fps` | FLOAT | Frames per second |
| `one_shot` | BOOLEAN | One-shot flag |
| `width` | INT | Video width |
| `height` | INT | Video height |
| `global_prompt` | STRING | Global prompt string |
| `data_json` | STRING | Full configuration as a JSON string (see below) |
| `clips_length` | INT | Number of clips in the timeline |
| `total_frame_count` | INT | Total frame count of the trimmed region |

**`data_json` structure**

```json
{
  "audio_path": "/absolute/path/to/audio.mp3",
  "trim_start_ms": 0,
  "trim_end_ms": 30000,
  "total_frame_count": 720,
  "fps": 24.0,
  "width": 720,
  "height": 1280,
  "one_shot": true,
  "global_prompt": "cinematic, 4k",
  "clips": [
    {
      "start_ms": 0,
      "end_ms": 5000,
      "start_image": "/absolute/path/to/frame_001.jpg",
      "end_image": "/absolute/path/to/frame_010.jpg",
      "prompt": "close up portrait"
    }
  ]
}
```

---

### Data Json Clip Parser

**Category:** `Capricorncd`

Parses the `data_json` output from **Audio Timeline** and extracts a single clip by index. Connect in a loop (via a counter or batch index) to iterate over all clips.

**Inputs**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `data_json` | STRING | — | JSON string from the Audio Timeline `data_json` output |
| `index` | INT | 0 | Zero-based clip index to extract |
| `trim_offset` | INT | 1 | Extra seconds appended to the clip's audio end time for overlap/fade; does **not** affect `frame_count` |

**Outputs**

| Name | Type | Description |
|------|------|-------------|
| `audio` | AUDIO | Trimmed audio segment for this clip (extended by `trim_offset`) |
| `frame_count` | INT | Number of frames in this clip at the timeline FPS |
| `first_frame` | IMAGE | Start keyframe image (64×64 blank if not assigned) |
| `last_frame` | IMAGE | End keyframe image (64×64 blank if not assigned) |
| `prompt` | STRING | Per-clip prompt, or `global_prompt` if the clip has none |

---

### Seq To Video

**Category:** `Capricorncd`

Composes an image sequence and optional audio into an MP4 file using **ffmpeg**. The output file is written to the ComfyUI `output` directory. A video player is embedded at the bottom of the node and starts playing automatically after each successful render.

> **Requires ffmpeg** to be installed and available on the system `PATH`. If ffmpeg is not found, a red error banner is displayed inside the node.

**Image sequence detection**

The node scans `frames_dir` for image files (`jpg`, `jpeg`, `png`, `webp`, `bmp`) and auto-detects the ffmpeg pattern from the first file's name (e.g. `MV_00001.jpg` → `MV_%05d.jpg`).

**Output filename**

`{filename_prefix}_{yyyyMMdd_HHmmss}.mp4`

**Video player**

- Loops automatically after compositing, no controls shown
- Muted by default; hover to unmute

**Inputs**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `frames_dir` | STRING | — | Absolute path to the directory containing the image sequence |
| `fps` | FLOAT | 24.0 | Frame rate for the output video |
| `filename_prefix` | STRING | `STV` | Prefix for the output filename |
| `use_seq_duration` | BOOLEAN | `true` | `true` — video length follows the image sequence; `false` — video length follows the audio (stops when audio ends) |
| `audio` | AUDIO | *(optional)* | Audio to mix into the video; omit for video-only output |

**Outputs**

| Name | Type | Description |
|------|------|-------------|
| `filename` | STRING | Output filename (relative to the ComfyUI output directory) |

---

## Internationalization (i18n)

Node display names, input labels, and output labels are localized via ComfyUI's built-in i18n system. Locale files are located in the `locales/` directory:

```
locales/
├── en/
│   └── nodeDefs.json
└── zh/
    └── nodeDefs.json
```

ComfyUI merges these files automatically on startup and applies the translations matching the active UI language. No additional configuration is required.

| Language | Code |
|----------|------|
| English  | `en` |
| 简体中文  | `zh` |

---

## Installation

Clone or copy this folder into your ComfyUI `custom_nodes` directory:

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/capricorncd/ComfyUI-Capricorncd-Tools
```

Restart ComfyUI. No additional Python packages are required beyond a standard ComfyUI installation.

> **Seq To Video** additionally requires [ffmpeg](https://ffmpeg.org/download.html) to be installed and on the system `PATH`.

---

## License

MIT
