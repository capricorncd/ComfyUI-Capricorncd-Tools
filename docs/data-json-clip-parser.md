# Data Json Clip Parser

**Category:** `Capricorncd`

Parses the `data_json` output from **Audio Timeline** and extracts a single clip by index. Connect in a loop (via a counter or batch index node) to iterate over all clips and drive per-segment generation.

---

## How it works

`data_json` contains a list of clips with absolute image paths, timing in milliseconds, and prompts. This node picks one clip by `index` and outputs everything a generation node needs for that segment:

- The corresponding audio slice (trimmed from the original audio file using `trim_start_ms` + clip offsets)
- The frame count at the timeline FPS
- The start and end keyframe images
- The effective prompt (per-clip if set, otherwise the global prompt)

---

## `trim_offset`

Adds extra seconds to the audio clip's end time. This is useful when the generation process needs a slightly longer audio tail for fade-out or overlap — it does **not** affect `frame_count`, only the duration of the `audio` output.

---

## Inputs

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `data_json` | STRING | — | JSON string from the Audio Timeline `data_json` output |
| `index` | INT | 0 | Zero-based index of the clip to extract |
| `trim_offset` | INT | 1 | Extra seconds added to the clip's audio end time; does **not** affect `frame_count` |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| `audio` | AUDIO | Trimmed audio for this clip (extended by `trim_offset` seconds) |
| `frame_count` | INT | Number of frames in this clip at the timeline FPS |
| `first_frame` | IMAGE | Start keyframe image; 64×64 blank if none assigned |
| `last_frame` | IMAGE | End keyframe image; 64×64 blank if none assigned |
| `prompt` | STRING | Per-clip prompt, or `global_prompt` if the clip has none |

---

## Typical workflow

```
Audio Timeline
  └── data_json  ──►  Data Json Clip Parser (index = loop counter)
  └── clips_length ──► loop limit
                            ├── audio       ──► generation node
                            ├── frame_count ──► generation node
                            ├── first_frame ──► generation node
                            ├── last_frame  ──► generation node
                            └── prompt      ──► generation node
```

Because **Audio Timeline** excludes disabled clips from `data_json`, you can selectively re-run individual segments by disabling all other clips in the timeline — without changing any index wiring in the downstream graph.
