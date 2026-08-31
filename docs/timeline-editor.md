# Timeline Editor

**Category:** `Capricorncd`

Fullscreen multi-track timeline editor for image / video / audio projects. Unlike [Audio Timeline](audio-timeline.md) (single audio + contiguous keyframe clips), Timeline Editor stores a **track-nested `project_json`** and emits a compact runtime `data_json` with per-clip audio slices.

Open the editor from the node launcher (fullscreen shell). Edits sync back into the node's `project_json` widget.

![timeline-editor](./timeline-editor.jpg)

---

## Compared with Audio Timeline

| | Audio Timeline | Timeline Editor |
|--|----------------|-----------------|
| Layout | Waveform + one clip track | Multi-track visual + audio tracks |
| Editable document | Widget values + clip list | Track-nested `project_json` |
| Runtime audio | Trim from one master `audio_path` | Mix overlapping slices into each clip's `audios[]` |

Downstream [Data Json Clip Parser](data-json-clip-parser.md) accepts both formats.

---

## Editor UI

### Media library (left)

- Tabs: **Image** / **Video** / **Audio**
- Lists files uploaded under ComfyUI `input/capricorncd-timeline/`
- Refresh rescans the upload directory
- Drag media onto the timeline, or right-click / insert at the playhead
- Star ratings and star filters for media bookmarks
- Double-click / preview modal for inspection
- Add media via the upload dialog (writes into `input`; no assets directory)

### Preview / Timeline (center)

- **Program monitor** above the timeline: composites the frame under the playhead at the node `width` × `height` aspect ratio (main + overlay layers; image cover; start/end crossfade centered in the clip, ≤1s; video sampled from trim-in); drag the bottom splitter to resize height
- Multiple tracks (visual and audio); add tracks from the toolbar menu
- Per-track: lock, visibility, mute (audio)
- Drag / resize clips; multi-select with `Ctrl+Click`
- Audio-track clips: drag the small corner handles to set linear **fade-in / fade-out** (diagonal overlay); stored as `fade_in_ms` / `fade_out_ms` and applied in playback, `clips_audio` mix, and Compose Video
- Package clips and material insert at the playhead
- **Gen Preview / Asset Preview** toolbar toggle (next to Insert Clip): one-click switch all clips that have generated videos between generated-video preview and asset preview
- Undo / Redo toolbar buttons (editor-local history)
- Zoom: `Ctrl+Wheel`; pan: `Alt+Wheel`

### Inspector (right)

- Selected clip thumbnails (start / end frame where applicable)
- Per-clip **Keyframe Prompt** and **Use Global** checkbox
- **Generated videos** list (when the clip has any): enable checkbox, mute (same icons as track mute), open preview, delete with confirm
- Shortcut reminders

### Project chrome

- Editable project name
- **Import** / **Export**:
  - Directory package or ZIP (all media + linked generated videos under `media/generated/` + `project.json`)
  - **Compose Video**: modal with `filename_prefix` (default `cap_timeline_compose/`), leaf name `projectName_yyyyMMdd_hhmmss.mp4`, and **Ignore audio tracks** (default off). When on, audio-track clips are skipped; unmuted generated-video audio is still mixed. ffmpeg writes under ComfyUI `output/`. Requires **ffmpeg** on `PATH`.
- Header shows `时间轴编辑器 | 项目名称`; click the project name to focus the right-panel name field (clears clip selection). Node width × height and fps are shown on the right (header + project panel).
- Global prompt lives only in the editor (right panel), not as a node widget.
- Close returns to the ComfyUI graph

### Clip context menu (visual)

- Run, AI optimize prompt, disable / disable others, rename, view materials, add generated video
- When the clip is in **generated-video preview** mode: **Mute / Unmute** for the active generated video
- Copy / Paste; **Delete** shown in red

### AI optimize prompt

- Modal: model, output language, Agent prompt, Prompt Skill, result
- Background-audio mode, Generate BGM, and Lyrics controls were removed

---

## Generated videos

Attach ComfyUI `output/` MP4s to a visual clip (context menu **Add generated video**, or after a run).

| Control | Behavior |
|---------|----------|
| Enable | Include in preview / compose selection |
| Mute | During timeline play and Compose Video, skip that file’s audio (default off = play sound) |
| Preview mode badge on clip | Toggle media vs generated preview |
| Delete | Confirm; removes the clip binding only (does not delete the file on disk) |

Compose Video uses each clip’s first **enabled** generated video, placed from the clip’s `start_ms` through `end_ms` (first `duration` seconds of the file).

---

## Clip disable / enable

Same idea as Audio Timeline: re-generate one segment without rebuilding the rest.

| Shortcut | Action |
|----------|--------|
| `Ctrl+B` | Disable / enable the selected clip(s) |
| `Ctrl+G` | Disable all other clips (toggle) |

Disabled / hidden / muted clips are omitted from runtime `data_json`. Tracks that are disabled or invisible are skipped entirely.

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
| `width` | INT | 1344 | Output width (written to `data_json`) |
| `height` | INT | 768 | Output height (written to `data_json`) |
| `swap_wh` | BOOLEAN | false | Toggling swaps the current width and height values |
| `project_version` | STRING | package version | Written into project / runtime JSON |
| `project_json` | STRING | empty project | Full editable timeline document (tracks, clips, resources, settings) |
| `trim_offset` | INT | 1 | Reserved for audio tail workflows; runtime clip timings in `data_json` are not extended by this field |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| `fps` | FLOAT | Frames per second |
| `width` | INT | Video width |
| `height` | INT | Video height |
| `global_prompt` | STRING | Effective global prompt from the editor (`project_json.settings.global_prompt`) |
| `data_json` | STRING | Runtime JSON for enabled visible segments only (see below) |
| `clips_length` | INT | Number of runtime clips |
| `total_frame_count` | INT | Sum of runtime clip frame counts at `fps` |
| `clips_audio` | AUDIO | Full-timeline mix of unmuted audio (and video-with-audio) clips |
| `frame_seq_dir` | STRING | Temp directory for frame sequences (`output/temp/capricorncd-frame-sequences`); created on first run, cleared on each subsequent run |

---

## `project_json` (editable)

Full project document stored on the node widget. Current shape is **`schema_version: 2`** (integer; independent of the Python package `project_version`). Older documents (schema 1 or top-level `resources`) are migrated to schema 2 on load.

Normally owned by the fullscreen editor — you do not edit it by hand. The tables and example below match what the editor writes via `_buildProject()`.

### Top level

| Field | Type | Description |
|-------|------|-------------|
| `project_version` | string | Package version string (e.g. `"0.x.y"`), refreshed on save |
| `schema_version` | int | Document shape version; currently `2` |
| `name` | string | Project name |
| `media` | array | Media catalog (schema 2); clips reference entries by `media_ids` |
| `settings` | object | Project settings (global prompt, watermark, timeline view state, …) |
| `tracks` | array | Tracks in `order` |

Legacy `resources` is migration input only and is not written back.

### `media[]` (catalog)

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Media id (e.g. `md_…`); referenced by clip `media_ids` |
| `kind` | string | `image` / `video` / `audio` |
| `file` | string | Path relative to ComfyUI `input/` (often under `capricorncd-timeline/`) |
| `location` | string | Usually `"input"` |
| `name` | string | Display name |
| `prompt` | string | Per-media prompt |
| `media_type` | string | Asset-type tag (character / scene / prop / other, or empty) |
| `tags` | string[] | Tags |
| `stars` | int? | 1–5; omitted when unrated |

### `settings`

| Field | Type | Description |
|-------|------|-------------|
| `fps` / `width` / `height` | number | Cached copies of node scalars |
| `global_prompt` | string | Global prompt |
| `timeline_zoom` | number | Timeline zoom |
| `current_time` | number | Playhead time (seconds) |
| `timeline_scroll_left` / `timeline_scroll_top` | number | Timeline scroll |
| `watermark` | object | Compose-video watermark (below) |
| `use_clip_specified_video_filename` | bool | Default `true`. When on, Run writes `output_video` and auto-links that path; when off, keep legacy auto-detect |
| `runtime_only_clip_ids` | string[]? | Temporary; set only during single-clip Run |
| `gen_video_stamp` | string? | Temporary stamp (`yyyyMMdd-HHmmss`) for aligning `output_video` with the frontend expected path |

#### `settings.watermark`

| Field | Description |
|-------|-------------|
| `mode` | Derived: `none` / `text` / `image` (image wins when file present and not disabled) |
| `text.content` | Watermark text |
| `text.fontFamily` / `text.fontPath` | Font family / local font path |
| `text.fontSize` | Font size (~6–400) |
| `text.letterSpacing` | Letter spacing (~-50–200, default 0) |
| `text.color` | `#RRGGBB` |
| `image.file` | Watermark image path; empty = none |
| `image.disabled` | When `true`, ignore image and fall back to text |
| `opacity` | 0–100 |
| `scale` | 10–300 (percent) |
| `position` | `top-left` / `top-center` / `top-right` / `bottom-left` / `bottom-center` / `bottom-right` / `center` / `random-interval` / `random-fixed` |
| `margin` | `{ top, right, bottom, left, locked }` in pixels; `locked` links all sides |

### `tracks[]`

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Track id |
| `type` | string | `visual` / `audio` / `subtitle` |
| `role` | string | `main` / `overlay` / `audio` / `subtitle`, … |
| `name` | string | Display name |
| `order` | int | Top-to-bottom order (from 0) |
| `enabled` | bool | Disabled tracks are omitted from runtime `data_json` |
| `visible` | bool | Invisible tracks are skipped |
| `muted` | bool | Audio / A/V mute |
| `locked` | bool | Lock |
| `color` | string | Track color |
| `clips` | array | Clips |

**Subtitle tracks** (`type: "subtitle"`) are preview overlays only; they are skipped when the node executes and do not appear in `data_json`.

### `tracks[].clips[]`

Times are milliseconds snapped to the project `fps` frame grid: `start_ms` / `duration_ms`.

#### Visual clip (`type: "clip"`)

| Field | Description |
|-------|-------------|
| `id` | Clip id |
| `enabled` / `visible` | Enable / visibility |
| `start_ms` / `duration_ms` | Timeline range |
| `media_ids` | Ordered refs into `media[].id` |
| `source` | Optional; video trim: `in_ms` / `out_ms` / `duration_ms` |
| `name` | Title |
| `prompt` / `ai_prompt` | Keyframe prompt / AI result |
| `use_global_prompt` / `use_ai_prompt` | Use global prompt / AI result |
| `use_media_prompts` | bool[] aligned with `media_ids` |
| `media_enabled` | bool[] aligned with `media_ids` |
| `head_extend_sec` / `tail_extend_sec` | Head / tail extend (seconds) |
| `generate_preview_video` / `second_sample` | Generation flags |
| `clip_role` | `multi_ref` / `first_last` / `t2v` / `video_ref` / `video_edit` / `other` |
| `clip_role_custom` | Custom text when `clip_role === "other"` |
| `agent` | `MiniMaxH3` / `LTX` / `Bernini` / `Wan` / `other` |
| `agent_custom` | Custom name when `agent === "other"` |
| `generated_videos` | Optional bound MP4s: `{ id, file, enabled, muted, note }` (`file` relative to `output/`) |
| `preview_mode` | Optional; `"generated"` for generated-video preview |
| `has_audio` / `muted` | Optional for video sources with audio |

#### Audio clip (`type: "audio"`)

| Field | Description |
|-------|-------------|
| `media_ids` | Usually one audio media id |
| `source` | `in_ms` / `out_ms` / `duration_ms` |
| `muted` | Mute |
| `fade_in_ms` / `fade_out_ms` | Optional; written when greater than 0 |

#### Subtitle clip (`type: "subtitle"`)

| Field | Description |
|-------|-------------|
| `text` | Subtitle body |
| `font_family` / `font_path` | Font |
| `font_size` | Size |
| `letter_spacing` | Letter spacing (default 0) |
| `color` | `#RRGGBB` |
| `bold` / `italic` | Bold / italic |
| `opacity` | 0–1 |
| `stroke_enabled` / `stroke_color` / `stroke_width` | Stroke |
| `shadow_enabled` / `shadow_color` / `shadow_blur` / `shadow_offset_x` / `shadow_offset_y` | Shadow |
| `align` | `left` / `center` / `right` |
| `v_align` | `top` / `middle` / `bottom` |
| `offset_x` / `offset_y` | Percent offsets vs canvas |

### Example (schema 2, illustrative)

```json
{
  "project_version": "0.x.y",
  "schema_version": 2,
  "name": "Untitled",
  "media": [
    {
      "id": "md_abc123",
      "kind": "image",
      "file": "capricorncd-timeline/shot01.png",
      "location": "input",
      "name": "shot01.png",
      "prompt": "",
      "media_type": "character",
      "tags": [],
      "stars": 3
    }
  ],
  "settings": {
    "fps": 24,
    "width": 1344,
    "height": 768,
    "global_prompt": "cinematic lighting",
    "timeline_zoom": 1.2,
    "current_time": 0,
    "timeline_scroll_left": 0,
    "timeline_scroll_top": 0,
    "watermark": {
      "mode": "text",
      "text": {
        "content": "Cap",
        "fontFamily": "Arial",
        "fontPath": "",
        "fontSize": 32,
        "letterSpacing": 2,
        "color": "#ffffff"
      },
      "image": { "file": "", "disabled": false },
      "opacity": 80,
      "scale": 100,
      "position": "bottom-right",
      "margin": { "top": 24, "right": 24, "bottom": 24, "left": 24, "locked": true }
    }
  },
  "tracks": [
    {
      "id": "track_main",
      "type": "visual",
      "role": "main",
      "name": "Main",
      "order": 0,
      "enabled": true,
      "visible": true,
      "muted": false,
      "locked": false,
      "color": "#4ea1ff",
      "clips": [
        {
          "id": "clip_1",
          "type": "clip",
          "enabled": true,
          "visible": true,
          "start_ms": 0,
          "duration_ms": 5000,
          "media_ids": ["md_abc123"],
          "name": "Clip",
          "prompt": "close up",
          "ai_prompt": "",
          "use_global_prompt": true,
          "use_ai_prompt": true,
          "use_media_prompts": [true],
          "media_enabled": [true],
          "head_extend_sec": 0,
          "tail_extend_sec": 0,
          "generate_preview_video": false,
          "second_sample": false,
          "clip_role": "multi_ref",
          "clip_role_custom": "",
          "agent": "MiniMaxH3",
          "agent_custom": "",
          "generated_videos": [
            {
              "id": "gv_1",
              "file": "MiniMax_H3/clip_1.mp4",
              "enabled": true,
              "muted": false,
              "note": ""
            }
          ]
        }
      ]
    },
    {
      "id": "track_sub",
      "type": "subtitle",
      "role": "subtitle",
      "name": "Subtitles",
      "order": 1,
      "enabled": true,
      "visible": true,
      "muted": false,
      "locked": false,
      "color": "#ff9e4a",
      "clips": [
        {
          "id": "sub_1",
          "type": "subtitle",
          "enabled": true,
          "visible": true,
          "start_ms": 0,
          "duration_ms": 3000,
          "name": "Hello",
          "text": "Hello",
          "font_family": "Arial",
          "font_path": "",
          "font_size": 48,
          "letter_spacing": 0,
          "color": "#ffffff",
          "bold": false,
          "italic": false,
          "opacity": 1,
          "stroke_enabled": true,
          "stroke_color": "#000000",
          "stroke_width": 3,
          "shadow_enabled": true,
          "shadow_color": "#000000",
          "shadow_blur": 4,
          "shadow_offset_x": 2,
          "shadow_offset_y": 2,
          "align": "center",
          "v_align": "bottom",
          "offset_x": 0,
          "offset_y": 8
        }
      ]
    }
  ]
}
```

---

## `data_json` structure (runtime)

```json
{
  "project_version": "x.y.z",
  "schema_version": "x.y.z",
  "fps": 24.0,
  "width": 1344,
  "height": 768,
  "global_prompt": "cinematic",
  "total_frame_count": 120,
  "run_prefix": "20260805_224215",
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
          "location": "input",
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
| `run_prefix` | Per-execute timestamp string (`YYYYMMDD_HHMMSS`) for a shared filename / folder prefix |
| `start_ms` / `end_ms` | Runtime clip time range (ms) |
| `start_image` / `end_image` | Absolute paths resolved via ComfyUI `input` |
| `audios[]` | Audio/video slices overlapping this visual range; mixed by [Data Json Clip Parser](data-json-clip-parser.md) |
| `z_index` | Track stacking order used when building segments |
| `output_video` | Optional; when clip-specified filenames are enabled: `CapTimelineEditor/[project]/yyyyMMdd-HHmmss_[clip_id].mp4` (relative to `output/`) |

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
