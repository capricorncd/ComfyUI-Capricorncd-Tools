# MiniMaxH3

**Category:** `Capricorncd`

Runs ComfyUI’s **MiniMax H3 Reference to Video** from a single Timeline Editor / Audio Timeline clip. Clip media become H3 reference slots; frame count and prompt come from that clip.

Accepts either:

- `data_json` + `index`, or
- **`clip_json`** from [Data Json Clip Parser](data-json-clip-parser.md) — when `clip_json` is non-empty, **`data_json` and `index` are ignored**

---

## How it works

1. Resolve the clip: prefer `clip_json`; otherwise load `data_json` and pick `index`
2. Collect visual refs (`images` + `videos`, or `start_image` / `end_image` fallback) and `audios[]`
3. Map media into H3 refs (caps below); build prompt from AI / media / global / clip text
4. Call `MiniMaxH3ReferenceToVideo` with CLIP, VAE, Audio VAE, `width` / `height`, and aligned frame length
5. Also emit stacked clip stills, video frames, and mixed clip audio for inspection or downstream use

| Kind | H3 slot | Limit | Notes |
|------|---------|-------|-------|
| Image | `ref_image_1…` | 9 | Still refs |
| Video | `ref_video_1…` (+ soundtrack → `ref_video_audio_n`) | 3 | Resampled to 24 fps, max 15 s, padded to ≥5 frames |
| Audio | `ref_audio_1…` | 3 | From clip `audios[]` slices; end may extend slightly to match H3 frame alignment |

`clip_json` is self-contained: `images` / `videos` entries already carry absolute `file` paths (and optional embedded `materials`).

---

## Prompt

Timeline Editor prompts are assembled in a fixed order: enabled `prepend_prompt` → enabled asset descriptions → enabled Clip prompt → enabled `append_prompt`. For MiniMax H3 projects, `clip.prompt` contains `subject_definitions`, `summary`, `retention_analysis`, and `detailed_description` as one complete structured prompt. Legacy Audio Timeline JSON keeps its older global-prompt behavior.

The Prompt Manager MiniMaxH3 Skill library supports both the [official MiniMax Skills](https://github.com/MiniMax-AI/MiniMax-H3/tree/main/skills) and the existing community repository, with official Skills listed first. Selecting `h3-prompt-writing` also injects `references/base-en.txt` and `references/ref-en.txt`, covering the official T2VA, I2VA, FL2VA, L2VA, and Ref2VA formats. On a Chinese UI, style Skills use `SKILL.cn.md` when provided.

---

## Inputs

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `clip` | CLIP | — | Text encoder for H3 |
| `vae` | VAE | — | Image / video VAE |
| `audio_vae` | VAE | — | Audio VAE |
| `width` | INT | 1344 | Generation width |
| `height` | INT | 768 | Generation height |
| `ref_image_size` | `match` / `max` | `match` | `match` = scale refs to generation pixel area; `max` = 2048px short edge |
| `data_json` | STRING | — | Runtime JSON from Timeline Editor / Audio Timeline (ignored when `clip_json` is set) |
| `index` | INT | 0 | Zero-based clip index (ignored when `clip_json` is set) |
| `clip_json` | STRING | — | Optional. Self-contained clip JSON; when non-empty, overrides `data_json` / `index` |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| `positive` | CONDITIONING | H3 positive conditioning |
| `latent` | LATENT | H3 latent for sampling |
| `total_frame_count` | INT | Aligned frame count at **clip_json / data_json fps** (Timeline Editor fps), on the H3 17k+5 grid. Example: 7s at 60fps → ~430. |
| `prompt` | STRING | Effective prompt text sent to H3 |
| `images` | IMAGE | Stacked still refs (letterboxed); blank 64×64 if none |
| `videos` | IMAGE | Stacked video ref frames (letterboxed); blank if none |
| `audio` | AUDIO | Mixed clip audio (master trim or `audios[]`) |

Wire `positive` / `latent` into your MiniMax H3 sampler / decode chain as you would with the stock Reference to Video node.

---

## Typical workflow

```
Timeline Editor
  └── data_json ──► Data Json Clip Parser (index = loop counter)
                         └── clip_json ──► MiniMaxH3
  └── width / height ──► MiniMaxH3
                             ├── positive, latent ──► H3 sample / decode ──► Save / Seq To Video
                             └── prompt, images, videos, audio ──► optional inspect / sidecar
```

Or wire `data_json` + `index` directly into MiniMaxH3 (no parser) when you do not need other parser outputs.

Disabled / hidden clips are already omitted from `data_json`, so selective re-runs use the same Disable / Enable flow as other timeline pipelines.
