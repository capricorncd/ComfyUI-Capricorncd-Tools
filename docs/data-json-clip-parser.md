# Data Json Clip Parser

**Category:** `Capricorncd`

Parses the `data_json` output from **Audio Timeline** or **Timeline Editor** and extracts a single clip by index. Connect in a loop (via a counter or batch index node) to iterate over all clips and drive per-segment generation.

---

## How it works

`data_json` contains a list of runtime clips with absolute image paths, timing in milliseconds, and prompts. This node picks one clip by `index` and outputs everything a generation node needs for that segment:

- The corresponding audio for this clip
- The frame count at the timeline FPS
- The start and end keyframe images
- The effective prompt (per-clip if set, otherwise the global prompt)

The node auto-detects which upstream format produced the JSON:

| Source | Audio handling |
|--------|----------------|
| **Audio Timeline** | Trims from the single `audio_path` using `trim_start_ms` + clip offsets |
| **Timeline Editor** | Loads and mixes each entry in the clip's `audios[]` slice list |

Both formats share the same clip fields used for images, timing, and prompts (`start_ms`, `end_ms`, `start_image`, `end_image`, `prompt`, `use_global_prompt`).

---

## Supported `data_json` formats

### Audio Timeline

Top-level fields include `audio_path`, `trim_start_ms`, and `trim_end_ms`. Each clip is a flat keyframe segment. See [Audio Timeline — `data_json` structure](audio-timeline.md#data_json-structure).

### Timeline Editor

Top-level fields include `project_version`, `schema_version`, and no `audio_path`. Each runtime clip may include an `audios` array describing overlapping audio slices for that visual segment. See [Timeline Editor — `data_json` structure](timeline-editor.md#data_json-structure-runtime).

```json
{
  "fps": 24.0,
  "width": 1344,
  "height": 768,
  "global_prompt": "cinematic",
  "clips": [
    {
      "id": "runtime_0001",
      "start_ms": 0,
      "end_ms": 5000,
      "start_image": "/absolute/path/to/start.jpg",
      "end_image": "/absolute/path/to/end.jpg",
      "prompt": "close up",
      "use_global_prompt": true,
      "audios": [
        {
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

| `audios[]` field | Description |
|------------------|-------------|
| `file` | Absolute path to the source audio/video file |
| `source_start_ms` / `source_end_ms` | Portion of the source file to use |
| `clip_offset_ms` | Where this slice starts within the visual clip timeline |

Multiple overlapping slices are mixed additively. Clips with no `audios` (or an empty list) output silence for the clip duration.

---

## `trim_offset`

Adds extra seconds to the clip's audio end time. This is useful when the generation process needs a slightly longer audio tail for fade-out or overlap — it does **not** affect `frame_count`, only the duration of the `audio` output.

- **Audio Timeline:** extends the trim end into the master `audio_path`
- **Timeline Editor:** extends slices that reach the clip end; remaining tail is silence if no source continues

---

## Inputs

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `data_json` | STRING | — | JSON string from **Audio Timeline** or **Timeline Editor** `data_json` output |
| `index` | INT | 0 | Zero-based index of the clip to extract |
| `trim_offset` | INT | 1 | Extra seconds added to the clip's audio end time; does **not** affect `frame_count` |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| `audio` | AUDIO | Audio for this clip (extended by `trim_offset` seconds) |
| `frame_count` | INT | Frame count for the extended runtime range |
| `first_frame` | IMAGE | Start keyframe image; 64×64 blank if none assigned |
| `last_frame` | IMAGE | End keyframe image; 64×64 blank if none assigned |
| `prompt` | STRING | Per-clip prompt, or `global_prompt` if the clip has none |
| `run_prefix` | STRING | Top-level `run_prefix` (`YYYYMMDD_HHMMSS`) for shared filename prefixes |
| `generate_preview_video` | BOOLEAN | Whether to also generate a preview-duration video |
| `second_sample` | BOOLEAN | Whether second-sample / secondary sampling is enabled for this clip |
| `from_start` | STRING | Extended start tag, e.g. `FROM_0010_12_480`; negative times use `FROM_N…` |
| `from_preview_start` | STRING | Preview (original timeline) start tag, e.g. `FROM_0012_12_432` |
| `seq_filename_prefix` | STRING | Prefix for Seq To Video (`run_timestamp/from_start` or `…/index`) |
| `images` | IMAGE | All clip stills as one IMAGE batch |
| `clip_role` | STRING | Clip role for agents |
| `agent` | STRING | Agent id |
| `ai_prompt` | STRING | Clip AI prompt text |
| `clip_json` | STRING | Self-contained clip JSON: `images` / `videos` with absolute `file` paths, resolved `audios`, and embedded `materials` |

`clip_json` is meant for nodes such as [MiniMaxH3](minimax-h3.md) that should not need the full `data_json` + `index`.

---

## Typical workflow

```
Timeline Editor / Audio Timeline
  └── data_json     ──►  Data Json Clip Parser (index = loop counter)
  └── clips_length  ──►  loop limit
                             ├── audio / frames / prompt ──► generation nodes
                             └── clip_json               ──► MiniMaxH3 (ignores data_json+index)
```

Both upstream nodes exclude disabled / occluded clips from `data_json`, so you can selectively re-run individual segments by disabling other clips in the editor — without changing any index wiring in the downstream graph.
