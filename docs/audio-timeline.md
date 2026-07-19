# Audio Timeline

**Category:** `Capricorncd`

A full-featured audio waveform editor with an image keyframe clip track, per-clip prompts, and structured JSON output. Designed for audio-driven video generation pipelines where each segment of the audio corresponds to a generated video clip.

![Audio Timeline/ComfyUI-Capricorncd-Tools](./audio-timeline-01.jpg)

![Audio Timeline/ComfyUI-Capricorncd-Tools](./audio-timeline-02.jpg)

## Panels

### Waveform panel

- Visual waveform powered by [WaveSurfer.js](https://wavesurfer.xyz/)
- Drag the left / right yellow handles to define the trim region (`start_time` / `end_time`)
- Click anywhere on the waveform to move the playhead
- `▶` button plays / pauses the trimmed audio segment
- `←` / `→` arrow keys nudge the active trim handle by one frame

### Clip track

Each clip represents one generation segment: a time range, a start keyframe image, an optional end keyframe image, and a per-clip prompt.

There are two tracks:

| Track | `track` value | Layout | Behaviour |
|-------|----------------|--------|-----------|
| Main track | `0` | Always contiguous | Clips pack left automatically after any move, resize, or delete; no gaps |
| Overlay (sub) track | `1` | Free-form, gaps allowed | Clips keep whatever position you place them at; overlapping another overlay clip is rejected |

Overlay-track clips render on top (`z_index 2`) and **occlude** whatever part of the main track (`z_index 1`) they cover — the covered main-track range is cut out of `data_json`/`total_frame_count` at export time, so the timeline behaves like a two-layer composite even though only one video is produced.

**Adding clips**

| Method | Behaviour |
|--------|-----------|
| `＋ Add Image` button | Opens the image picker; inserts into the main track if it's free at the playhead, otherwise the overlay track, otherwise shows an alert (both tracks occupied) |
| Double-click the main track | Adds a main-track clip at that time position (no image assigned) |
| Double-click the overlay track | Adds an overlay clip at that time position; alerts if the overlay track already has a clip there |

**Clip thumbnails and badges**

- Thumbnail shows the start keyframe image if assigned
- `[首]` badge: only a start frame is assigned; hover to preview it
- `[首尾]` badge: both start and end frames are assigned; hover to preview both

**Multi-select (Ctrl+Click)**

`Ctrl+Click` a clip to add/remove it from the selection. Right-click any selected clip in a multi-selection to open the multi-select menu:

| Item | Shortcut | Condition | Description |
|------|----------|-----------|-------------|
| 合并 (Merge) | — | Selected clips are contiguous on the same track | Keeps the first clip, extends its end time to the last selected clip's end time, and removes the rest |
| 禁用选中项 / 启用选中项 (Disable/Enable Selected) | `Ctrl+B` | any | Disable all selected clips, or re-enable them if all are already disabled |

The merge option is hidden when the selection is not contiguous or spans both tracks.

**Single-select context menu**

| Item | Shortcut | Description |
|------|----------|-------------|
| 替换素材 | — | Open image picker to replace the start keyframe |
| 选择尾帧图片 | — | Open image picker to assign an end keyframe |
| 首尾帧交换 | — | Swap start and end keyframe images (visible only when both are set) |
| 分割素材 | — | Split the clip at the current playhead position into two clips; left clip keeps the start keyframe, right clip keeps the end keyframe (visible only when the playhead is inside the clip) |
| 移到主轨道 / 移到副轨道 | — | Move the clip to the other track; rejected if the target position on the overlay track is already occupied |
| Disable / Enable | `Ctrl+B` | Toggle the clip's disabled state |
| Disable / Enable Others | `Ctrl+G` | Disable all other clips; if all others are already disabled, re-enable them all |
| 复制 | — | Copy this clip to the internal clipboard |
| 删除 | `Delete` | Remove this clip |
| 清除尾帧图片 | — | Remove the end keyframe assignment (visible only when an end image is set) |

### Clip disable / enable

The disable feature lets you **re-generate a single segment without touching the rest of the timeline**.

Typical workflow:
1. Run the full generation pass — all clips active.
2. A specific segment needs to be redone.
3. Select that clip → `Ctrl+G` to disable all others (only the target stays enabled).
4. Re-run the generation — only the active clip is processed.
5. `Ctrl+G` again on the same clip to re-enable everything.

Disabled clips:
- Appear faded with a strikethrough label
- Are **excluded** from `data_json` output and from the `total_frame_count` calculation
- Do not affect the enabled clips' timing; `clips_length` only counts active clips

### Prompt area

- When a clip is selected the prompt area switches to **per-clip** mode (label turns gold)
- When no clip is selected the textarea edits the **global prompt**
- Per-clip prompt takes priority; clips with no per-clip prompt fall back to the global prompt

---

## Assets directory (`assets_dir`)

`assets_dir` is the shared resource directory for both **audio files** and **keyframe images**.

- The image picker lists all image files found in this directory
- On Import, the audio filename stored in the exported JSON is resolved relative to this directory
- A `！` hint icon appears next to the input field — hover over it for a reminder

**↻ Refresh** re-scans the directory without closing the picker.

---

## Import / Export

| Button | Behaviour |
|--------|-----------|
| **Export** | Saves the full timeline configuration (all widget values including `audio` filename + clip list) as `{audio-stem}_{yyyyMMdd_HHmmss}.json` |
| **Import** | Restores all widget values (including audio) and the clip list from a previously exported `.json` file; triggers waveform reload automatically |

---

## Keyboard shortcuts

Click anywhere on the waveform or clip track to give the timeline focus. `Ctrl+B` and `Ctrl+G` work whenever a clip is selected regardless of focus.

| Key | Action |
|-----|--------|
| `Space` | Play / pause the timeline |
| `←` / `→` | Move playhead one frame; or nudge the active trim handle |
| `Q` | Trim the left edge of the selected clip to the playhead |
| `W` | Trim the right edge of the selected clip to the playhead |
| `Delete` / `Backspace` | Delete the selected clip |
| `Ctrl+C` | Copy the selected clip |
| `Ctrl+V` | Paste the clipboard clip after the last clip on its original track (main or overlay) |
| `Ctrl+B` | Disable / Enable the selected clip |
| `Ctrl+G` | Disable / Enable all other clips |
| `Escape` | Deselect / close picker or context menu |

---

## Inputs

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `audio` | FILE | — | Audio or video file from the ComfyUI input directory |
| `fps` | FLOAT | 24.0 | Frames per second |
| `width` | INT | 720 | Output video width (passed through to `data_json`) |
| `height` | INT | 1280 | Output video height (passed through to `data_json`) |
| `assets_dir` | STRING | — | Directory containing keyframe images and audio files; used by the image picker and during import |
| `one_shot` | BOOLEAN | true | In one-shot mode each non-last clip's end frame is automatically set to the next clip's start frame |
| `global_prompt` | STRING | — | Default prompt for clips that have no per-clip prompt |
| `trim_offset` | INT | 1 | Extra seconds appended to the `AUDIO` output end time for fade/overlap; does **not** affect `data_json` timings or frame counts |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| `trimmed_audio` | AUDIO | Trimmed audio extended by `trim_offset` seconds |
| `fps` | FLOAT | Frames per second |
| `one_shot` | BOOLEAN | One-shot flag |
| `width` | INT | Video width |
| `height` | INT | Video height |
| `global_prompt` | STRING | Global prompt string |
| `data_json` | STRING | Full configuration as JSON (see below); only active (non-disabled) clips are included |
| `clips_length` | INT | Number of active clips |
| `total_frame_count` | INT | Total frame count across all active clips |
| `clips_audio` | AUDIO | Concatenated audio segments from enabled clips only (excludes disabled clips and gaps) |
| `frame_seq_dir` | STRING | Temp directory for frame sequences (`output/temp/capricorncd-frame-sequences`); created on first run, fully cleared on each subsequent run |

---

## `data_json` structure

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
      "prompt": "close up portrait",
      "use_global_prompt": false,
      "z_index": 1
    }
  ]
}
```

| Clip field | Type | Description |
|------------|------|-------------|
| `start_ms` | number | Clip start time in milliseconds, relative to the trim start |
| `end_ms` | number | Clip end time in milliseconds, relative to the trim start |
| `start_image` | string | Absolute path to the start keyframe image (empty string if not set) |
| `end_image` | string | Absolute path to the end keyframe image; in `one_shot` mode, non-last clips use the next clip's `start_image` |
| `prompt` | string | Per-clip prompt (empty string if not set) |
| `use_global_prompt` | boolean | `true` if the clip uses the global prompt (either explicitly set or because per-clip prompt is empty) |
| `z_index` | number | `1` for main-track clips, `2` for overlay-track clips |

Disabled clips are **not** written to `clips`. The `total_frame_count` is the sum of active clip durations only. Main-track ranges covered by an enabled overlay clip are split around it (or dropped entirely if fully covered), so a single main-track UI clip can produce zero, one, or two entries in `clips`.
