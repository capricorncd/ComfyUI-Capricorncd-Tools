# Timeline Editor

**Category:** `Capricorncd`

Fullscreen multi-track timeline editor for image / video / audio projects. Unlike [Audio Timeline](audio-timeline.md) (single audio + contiguous keyframe clips), Timeline Editor stores a **track-nested `project_json`** and emits a compact runtime `data_json` with per-clip audio slices.

Open the editor from the node launcher (fullscreen shell). Edits sync back into the node's `project_json` widget.

---

## Compared with Audio Timeline

| | Audio Timeline | Timeline Editor |
|--|----------------|-----------------|
| Layout | Waveform + one clip track | Multi-track visual + audio tracks |
| Editable document | Widget values + clip list | Track-nested `project_json` |
| Runtime audio | Trim from one master `audio_path` | Mix overlapping slices into each clip's `audios[]` |
| Occlusion | Contiguous clips (no stacking) | Higher tracks can occlude lower ones (`ignore_occluded`) |

Downstream [Data Json Clip Parser](data-json-clip-parser.md) accepts both formats.

---

## Editor UI

### Media library (left)

- Tabs: **Image** / **Video** / **Audio**
- Lists files under `assets_dir` (and ComfyUI input where applicable)
- Refresh rescans the directory
- Drag media onto the timeline, or right-click / insert at the playhead
- Star ratings and star filters for media bookmarks
- Double-click / preview modal for inspection

### Timeline (center)

- Multiple tracks (visual and audio); add tracks from the toolbar menu
- Per-track: lock, visibility, mute (audio)
- Drag / resize clips; multi-select with `Ctrl+Click`
- Package clips and material insert at the playhead
- Undo / Redo toolbar buttons (editor-local history)
- Zoom: `Ctrl+Wheel`; pan: `Alt+Wheel`

### Inspector (right)

- Selected clip thumbnails (start / end frame where applicable)
- **Force render** — still contribute to generation when covered by a higher track
- Per-clip **Keyframe Prompt** and **Use Global** checkbox
- Shortcut reminders

### Project chrome

- Editable project name
- **Import** / **Export** project JSON
- Close returns to the ComfyUI graph

---

## Clip disable / enable

Same idea as Audio Timeline: re-generate one segment without rebuilding the rest.

| Shortcut | Action |
|----------|--------|
| `Ctrl+B` | Disable / enable the selected clip(s) |
| `Ctrl+G` | Disable all other clips (toggle) |

Disabled / hidden / muted clips are omitted from runtime `data_json`. Tracks that are disabled or invisible are skipped entirely.

---

## Occlusion (`ignore_occluded`)

When **忽略遮挡 / ignore occluded** is on (default), a visual clip covered by a higher `z_index` track is split or dropped so only the visible time ranges become runtime clips — unless **强制渲染 (force render)** is set on that clip.

When off, every enabled visual clip is emitted in full (overlaps allowed).

---

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+Click` | Multi-select clips |
| `Delete` / `Backspace` | Delete selection (with confirm) |
| `Ctrl+B` | Disable / enable selected clip |
| `Ctrl+G` | Disable / enable all other clips |
| `Ctrl+Wheel` | Zoom timeline |
| `Alt+Wheel` | Scroll timeline horizontally |

---

## Inputs

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `fps` | FLOAT | 24.0 | Frames per second |
| `width` | INT | 1280 | Output width (written to `data_json`) |
| `height` | INT | 720 | Output height (written to `data_json`) |
| `assets_dir` | STRING | — | Media root for resolving relative `source.file` paths |
| `global_prompt` | STRING | — | Default prompt when a clip uses the global prompt |
| `ignore_occluded` | BOOLEAN | true | Collapse visually covered ranges (see above) |
| `project_version` | STRING | package version | Written into project / runtime JSON |
| `project_json` | STRING | empty project | Full editable timeline document (tracks, clips, resources, settings) |
| `trim_offset` | INT | 1 | Reserved for audio tail workflows; runtime clip timings in `data_json` are not extended by this field |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| `fps` | FLOAT | Frames per second |
| `width` | INT | Video width |
| `height` | INT | Video height |
| `global_prompt` | STRING | Effective global prompt |
| `data_json` | STRING | Runtime JSON for enabled visible segments only (see below) |
| `clips_length` | INT | Number of runtime clips |
| `total_frame_count` | INT | Sum of runtime clip frame counts at `fps` |
| `clips_audio` | AUDIO | Full-timeline mix of unmuted audio (and video-with-audio) clips |
| `frame_seq_dir` | STRING | Temp directory for frame sequences (`output/temp/capricorncd-frame-sequences`); created on first run, cleared on each subsequent run |

---

## `project_json` (editable)

High-level shape:

```json
{
  "project_version": "x.y.z",
  "schema_version": "x.y.z",
  "name": "Untitled",
  "resources": [],
  "settings": {
    "global_prompt": "",
    "ignore_occluded": true
  },
  "tracks": [
    {
      "id": "track_1",
      "type": "visual",
      "order": 0,
      "enabled": true,
      "visible": true,
      "clips": []
    }
  ]
}
```

The fullscreen editor owns this document; you normally do not edit it by hand.

---

## `data_json` structure (runtime)

```json
{
  "project_version": "x.y.z",
  "schema_version": "x.y.z",
  "fps": 24.0,
  "width": 1280,
  "height": 720,
  "global_prompt": "cinematic",
  "total_frame_count": 120,
  "clips": [
    {
      "id": "runtime_0001",
      "source_clip_id": "clip_abc",
      "clip_type": "image",
      "start_ms": 0,
      "end_ms": 5000,
      "start_image": "/absolute/path/to/start.jpg",
      "end_image": "/absolute/path/to/end.jpg",
      "prompt": "close up",
      "use_global_prompt": true,
      "z_index": 1,
      "audios": [
        {
          "source_clip_id": "audio_1",
          "source_kind": "audio",
          "file": "/absolute/path/to/voice.wav",
          "location": "assets",
          "source_start_ms": 1000,
          "source_end_ms": 6000,
          "clip_offset_ms": 0
        }
      ]
    }
  ]
}
```

| Field | Description |
|-------|-------------|
| `start_ms` / `end_ms` | Visible runtime range after occlusion (ms) |
| `start_image` / `end_image` | Absolute paths resolved via `assets_dir` |
| `audios[]` | Audio/video slices overlapping this visual range; mixed by [Data Json Clip Parser](data-json-clip-parser.md) |
| `z_index` | Track stacking order used when building segments |

There is no top-level `audio_path` (that field is Audio Timeline only).

---

## Typical pipeline

```
Timeline Editor
  ├── data_json      ──► Data Json Clip Parser (looped per clip)
  ├── clips_length   ──► loop limit
  ├── clips_audio    ──► optional audio processing / Seq To Video
  └── frame_seq_dir  ──► Save Images output directory for generated frames
```

See the [root README](../README.md#typical-pipeline) for the full generation → Seq To Video flow.
