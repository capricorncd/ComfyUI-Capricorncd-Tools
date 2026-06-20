# ComfyUI-Capricorncd-Tools

![ComfyUI-Capricorncd-Tools](./docs/ComfyUI-Capricorncd-Tools.png)

A collection of custom nodes for [ComfyUI](https://github.com/comfyanonymous/ComfyUI) focused on prompt editing and audio/image(Keyframe) timeline editing.

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
- `Ctrl+B` — wrap / unwrap the current line in `**bold**` markup; bold lines are rendered with `font-weight: bold`
- Paste strips formatting (plain text only)
- Comments and bold markers are stripped from the output string; only the raw text content is passed downstream

| Output | Type | Description |
|--------|------|-------------|
| `prompt` | STRING | Active lines with markup removed |

---

### Audio Timeline

**Category:** `Capricorncd`

A full-featured audio waveform timeline editor with image keyframe clip track, per-clip prompts, and structured JSON output.

**Features:**

**Waveform panel**
- Visual waveform display powered by [WaveSurfer.js](https://wavesurfer.xyz/)
- Drag the left / right handles to set the trim range (`start_time` / `end_time`)
- Click to place the playhead; spacebar to play/pause

**Clip track**
- Add image clips to the timeline; clips are always contiguous (no gaps)
- Each clip shows a `[首]` / `[首尾]` badge when start/end keyframe images are assigned; hover the badge to preview the images
- Right-click a clip to open the context menu: assign start image, assign end image, clear end image, copy, paste, delete
- Clips automatically pack left after any move, resize, or delete operation

**Keyboard shortcuts (node must be selected)**

| Key | Action |
|-----|--------|
| `Space` | Play / pause |
| `←` / `→` | Move playhead one frame |
| `Q` | Trim left edge of selected clip to playhead |
| `W` | Trim right edge of selected clip to playhead |
| `Delete` / `Backspace` | Delete selected clip |

**Inputs**

| Name | Type | Description |
|------|------|-------------|
| `audio` | FILE | Audio or video file from the ComfyUI input directory |
| `fps` | INT | Frames per second (default 24) |
| `width` | INT | Output video width |
| `height` | INT | Output video height |
| `keyframe_dir` | STRING | Directory containing keyframe images |
| `one_shot` | BOOLEAN | One-shot mode flag passed through to `data_json` |
| `global_prompt` | STRING | Default prompt applied to all clips that have no per-clip prompt |

**Outputs**

| Name | Type | Description |
|------|------|-------------|
| `audio` | AUDIO | Trimmed audio segment (matches the waveform selection) |
| `fps` | INT | Frames per second |
| `one_shot` | BOOLEAN | One-shot flag |
| `width` | INT | Video width |
| `height` | INT | Video height |
| `global_prompt` | STRING | Global prompt string |
| `data_json` | STRING | Full configuration as a JSON string (see below) |

**`data_json` structure**

```json
{
  "audio_path": "/absolute/path/to/audio.mp3",
  "trim_start_ms": 0,
  "trim_end_ms": 30000,
  "fps": 24,
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

## Installation

Clone or copy this folder into your ComfyUI `custom_nodes` directory:

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/capricorncd/ComfyUI-Capricorncd-Tools
```

Restart ComfyUI. No additional Python packages are required beyond a standard ComfyUI installation.

---

## License

MIT
