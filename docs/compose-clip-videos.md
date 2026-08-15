# Compose Clip Videos

**Category:** `Capricorncd`

Concatenates per-clip MP4s (produced under `output/{run_prefix}`) into one timeline video via **ffmpeg**. Optionally trims head/tail extend so the final cut matches preview duration.

> **Requires ffmpeg** on the system `PATH`.

---

## Clip matching

Clips come from `data_json`. Each clip is matched to a video file in `clips_dir`:

| `name_mode` | Filename stem |
|-------------|----------------|
| `from_start` | `FROM_…` tag (same as Seq To Video prefix from Data Json Clip Parser) |
| `index` | four-digit index (`0000`, `0001`, …) |

`clips_dir` empty uses `output/{run_prefix}` from `data_json`. A relative path is under ComfyUI `output`. An absolute path is used as-is.

---

## Inputs

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `data_json` | STRING | `""` | Timeline / Audio Timeline clip list |
| `clips_dir` | STRING | `""` | Directory of per-clip videos; empty = `output/{run_prefix}` |
| `name_mode` | ENUM | `from_start` | How to match clip video filenames |
| `filename_prefix` | STRING | `composed` | Output prefix; may include subfolders under `output` |
| `trim_extends` | BOOLEAN | true | Trim head/tail extend before concat when the file is the extended-length render |
| `save_sidecar` | BOOLEAN | true | Write a same-name JSON next to the composed MP4 |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| `filename` | STRING | Output path relative to the ComfyUI output directory |

---

## Sidecar JSON

When `save_sidecar` is on, `{name}.mp4` gets `{name}.json` beside it. The file records graph prompts / models / sampler settings, plus per-clip prompts from `data_json`.
