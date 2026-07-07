# Clear Directory

**Category:** `Capricorncd`

Deletes image, video, and/or audio files in a directory. Other file types (for example `.json`, `.txt`) and subdirectories themselves are left untouched.

Filesystem root directories (`C:\`, `D:\`, `/`, etc.) are blocked and raise an error.

---

## Inputs

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `directory` | STRING | `""` | Target directory. Relative paths are resolved the same way as other Capricorncd nodes (`input`, `output`, then cwd) |
| `delete_subdirs` | BOOLEAN | `false` | When enabled, matching files inside subdirectories are also deleted |
| `delete_images` | BOOLEAN | `true` | Delete image files |
| `delete_videos` | BOOLEAN | `true` | Delete video files |
| `delete_audio` | BOOLEAN | `true` | Delete audio files |
| `to_recycle_bin` | BOOLEAN | `true` | On Windows, send deleted files to the Recycle Bin instead of permanently removing them |

---

## Outputs

| Name | Type | Description |
|------|------|-------------|
| `directory` | STRING | Resolved absolute directory path |
| `deleted_count` | INT | Number of files deleted |

---

## Supported extensions

| Type | Extensions |
|------|------------|
| Images | `.png` `.jpg` `.jpeg` `.webp` `.gif` `.bmp` |
| Videos | `.mp4` `.webm` `.mov` `.mkv` `.avi` `.m4v` |
| Audio | `.wav` `.mp3` `.flac` `.ogg` `.m4a` `.aac` |

---

## Notes

- If all three media toggles are off, the node skips deletion and returns `deleted_count = 0`.
- With `delete_subdirs = false`, only files directly inside `directory` are considered.
- With `to_recycle_bin = true` on non-Windows systems, the node logs a warning and falls back to permanent deletion.
- With `to_recycle_bin = false`, files are permanently deleted via `os.unlink`.

---

## Example

Clean a temporary frame-sequence folder before re-rendering:

```
Clear Directory
  directory     = ./output/temp/capricorncd-frame-sequences
  delete_subdirs = false
  delete_images  = true
  delete_videos  = false
  delete_audio   = false
  to_recycle_bin = true
```
