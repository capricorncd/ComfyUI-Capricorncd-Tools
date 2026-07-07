# Seq To Video

**Category:** `Capricorncd`

Composes image frames and optional audio into an MP4 file using **ffmpeg**. The output file is written to the ComfyUI `output` directory. A video player is embedded at the bottom of the node and starts playing automatically after each successful render.

> **Requires ffmpeg** to be installed and available on the system `PATH`. If ffmpeg is not found a red error banner is displayed inside the node.

---

## Frame sources (priority)

Only one source is used per run, in this order:

| Priority | Input | Mode | Description |
|----------|-------|------|-------------|
| 1 | `images` | `images` | `IMAGE` batch is written to temporary PNG files, then encoded |
| 2 | `image_paths` | `list` | Comma-separated file paths (same format as [Save Images](save-images.md) output) |
| 3 | `frames_dir` | `dir` | Scans a directory and auto-detects a numbered image sequence |

---

## Directory mode (`frames_dir`)

The node scans `frames_dir` for image files (`jpg`, `jpeg`, `png`, `webp`, `bmp`) and auto-detects the ffmpeg glob pattern from the first filename. For example `MV_00001.jpg` → `MV_%05d.jpg`. The starting frame number is also detected automatically, so sequences that do not start at `0` or `1` work correctly.

---

## List mode (`image_paths`)

Accepts a comma-separated path list, for example:

```
D:\ComfyUI\output\temp\img_00000.png, D:\ComfyUI\output\temp\img_00001.png
```

Paths may be quoted. Files are encoded in list order via ffmpeg's concat demuxer.

---

## Output filename

```
{filename_prefix}_{yyyyMMdd_HHmmss}.mp4
```

Each run produces a unique file; no previous renders are overwritten.

---

## Video player

- Embedded inside the node; plays automatically after each render
- Loops continuously; no transport controls shown
- **Muted by default** — hover over the video to unmute and hear the audio track
- The last rendered video is restored when you reload the browser or restart ComfyUI

---

## Video duration

Output length always follows the frame count: `frame_count / fps`. If the audio track is longer than the video, it is truncated to match.

---

## Inputs

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `frames_dir` | STRING | `""` | Directory for directory mode (used when `images` and `image_paths` are empty) |
| `fps` | FLOAT | 24.0 | Frame rate for the output video |
| `filename_prefix` | STRING | `STV` | Prefix for the output filename |
| `images` | IMAGE | *(optional)* | Highest-priority frame source |
| `image_paths` | STRING | `""` | Comma-separated image file paths |
| `audio` | AUDIO | *(optional)* | Audio to mix into the video; omit for video-only output |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| `filename` | STRING | Output filename relative to the ComfyUI output directory |

---

## Example wiring

```
Save Images.image_paths ──► Seq To Video.image_paths
Save Images.image_dir    ──► Clear Directory.directory   (cleanup before next run)
IMAGE batch              ──► Seq To Video.images         (direct encode)
```
