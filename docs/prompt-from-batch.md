# Prompt From Batch

**Category:** `Capricorncd`

Takes a slice of effective scene prompt lines by batch index and length, and optionally prepends the global prompt.

---

<!-- AUTO:API:begin -->
Take batch_length effective scene prompt lines starting at batch_index. When merge_global is true, prepend global_prompt.

#### Inputs

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `global_prompt` | STRING | `""` | Global prompt; prepended when merge_global is true |
| `scene_prompt` | STRING | `""` | Scene prompts, one per non-empty line |
| `batch_index` | INT | `0` | Start index into effective scene lines; negative counts from the end |
| `batch_length` | INT | `1` | How many effective scene lines to take from batch_index |
| `merge_global` | BOOLEAN | true | When true, prepend global_prompt to the selected scene lines |

#### Outputs

| Name | Type | Description |
|------|------|-------------|
| `prompt` | STRING | Selected scene lines, optionally prepended with global_prompt |
<!-- AUTO:API:end -->

## Notes

- Effective scene lines are non-empty lines in `scene_prompt` (same rule as Prompt Group).
- Selection is `lines[batch_index : batch_index + batch_length]`.
- Negative `batch_index` counts from the end (`-1` = last line).
- When `merge_global` is true and global text is non-empty, output is `global_prompt` + newline + selected scenes.
- When `merge_global` is false, output is only the selected scene lines (joined by newlines).
