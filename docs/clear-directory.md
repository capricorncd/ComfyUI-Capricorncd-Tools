# Clear Directory

**Category:** `Capricorncd`

Deletes image, video, and/or audio files in a directory. Other file types (for example `.json`, `.txt`) and subdirectories themselves are left untouched.

Filesystem root directories (`C:\`, `D:\`, `/`, etc.) are blocked and raise an error.

---



## Supported extensions

| Type | Extensions |
|------|------------|
| Images | `.png` `.jpg` `.jpeg` `.webp` `.gif` `.bmp` |
| Videos | `.mp4` `.webm` `.mov` `.mkv` `.avi` `.m4v` |
| Audio | `.wav` `.mp3` `.flac` `.ogg` `.m4a` `.aac` |

---

<!-- AUTO:API:begin -->
Delete image, video, and/or audio files in a directory. Filesystem root directories are blocked. On Windows, deleted files can be sent to the Recycle Bin.

#### Inputs

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `directory` | STRING | `""` | Target directory (filesystem roots are blocked) |
| `delete_subdirs` | BOOLEAN | false | When enabled, also delete matching files in subdirectories |
| `delete_images` | BOOLEAN | true | Delete image files |
| `delete_videos` | BOOLEAN | true | Delete video files |
| `delete_audio` | BOOLEAN | true | Delete audio files |
| `to_recycle_bin` | BOOLEAN | true | On Windows, send files to Recycle Bin; otherwise permanent delete |

#### Outputs

| Name | Type | Description |
|------|------|-------------|
| `directory` | STRING | Resolved absolute directory path that was cleaned |
| `deleted_count` | INT | Number of files deleted (or moved to Recycle Bin) |
<!-- AUTO:API:end -->

## Notes

- If `directory` does not exist, the node logs and skips instead of raising an error; it returns the input path unchanged and `deleted_count = 0`.
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
