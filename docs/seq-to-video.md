# Seq To Video

**Category:** `Capricorncd`

Composes an image sequence and optional audio into an MP4 file using **ffmpeg**. The output file is written to the ComfyUI `output` directory. A video player is embedded at the bottom of the node and starts playing automatically after each successful render.

> **Requires ffmpeg** to be installed and available on the system `PATH`. If ffmpeg is not found a red error banner is displayed inside the node.

---

## Image sequence detection

The node scans `frames_dir` for image files (`jpg`, `jpeg`, `png`, `webp`, `bmp`) and auto-detects the ffmpeg glob pattern from the first filename. For example `MV_00001.jpg` → `MV_%05d.jpg`. The starting frame number is also detected automatically, so sequences that do not start at `0` or `1` work correctly.

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

Output length always follows the image sequence: `frame_count / fps`. If the audio track is longer than the video, it is truncated to match.

---

## Inputs

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `frames_dir` | STRING | — | Absolute path to the directory containing the image sequence |
| `fps` | FLOAT | 24.0 | Frame rate for the output video |
| `filename_prefix` | STRING | `STV` | Prefix for the output filename |
| `audio` | AUDIO | *(optional)* | Audio to mix into the video; omit for video-only output |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| `filename` | STRING | Output filename relative to the ComfyUI output directory |
