# MiniMaxH3

**Category:** `Capricorncd`

Runs ComfyUI’s **MiniMax H3 Reference to Video** from a single Timeline Editor / Audio Timeline clip in `data_json`. Clip media become H3 reference slots; frame count and prompt come from that clip.

Does not replace [Data Json Clip Parser](data-json-clip-parser.md) for generic pipelines — this node is the H3-specific path that parses the clip and builds references in one step.

---

## How it works

1. Load `data_json` and pick clip `index`
2. Collect visual refs (`images`, or `start_image` / `end_image` fallback) and `audios[]`
3. Map media into H3 refs (caps below); build prompt from AI / media / global / clip text
4. Call `MiniMaxH3ReferenceToVideo` with CLIP, VAE, Audio VAE, `width` / `height`, and aligned frame length
5. Also emit stacked clip stills, video frames, and mixed clip audio for inspection or downstream use

| Kind | H3 slot | Limit | Notes |
|------|---------|-------|-------|
| Image | `ref_image_1…` | 9 | Still refs |
| Video | `ref_video_1…` (+ soundtrack → `ref_video_audio_n`) | 3 | Resampled to 24 fps, max 15 s, padded to ≥5 frames |
| Audio | `ref_audio_1…` | 3 | From clip `audios[]` slices; end may extend slightly to match H3 frame alignment |

---

## Prompt

| Priority | Source |
|----------|--------|
| 1 | Clip AI prompt when the clip uses AI prompt |
| 2 | Otherwise: enabled media prompt lines (`<Picture n>` / `<Video n>` / `<Audio n>`), then global prompt (if Use Global), then clip keyframe prompt |

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
| `data_json` | STRING | — | Runtime JSON from Timeline Editor / Audio Timeline |
| `index` | INT | 0 | Zero-based clip index |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| `positive` | CONDITIONING | H3 positive conditioning |
| `latent` | LATENT | H3 latent for sampling |
| `total_frame_count` | INT | Aligned frame count for this clip |
| `prompt` | STRING | Effective prompt text sent to H3 |
| `images` | IMAGE | Stacked still refs (letterboxed); blank 64×64 if none |
| `videos` | IMAGE | Stacked video ref frames (letterboxed); blank if none |
| `audio` | AUDIO | Mixed clip audio (master trim or `audios[]`) |

Wire `positive` / `latent` into your MiniMax H3 sampler / decode chain as you would with the stock Reference to Video node.

---

## Typical workflow

```
Timeline Editor
  └── data_json      ──► MiniMaxH3 (index = loop counter)
  └── clips_length   ──► loop limit
  └── width / height ──► MiniMaxH3
                             ├── positive, latent ──► H3 sample / decode ──► Save / Seq To Video
                             └── prompt, images, videos, audio ──► optional inspect / sidecar
```

Disabled / hidden clips are already omitted from `data_json`, so selective re-runs use the same Disable / Enable flow as other timeline pipelines.
