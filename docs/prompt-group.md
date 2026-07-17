# Prompt Group

**Category:** `Capricorncd`

Collects a global prompt, scene prompts (one per non-empty line), and a negative prompt. Optionally filters which scenes are output via `output_scenes`.

---

<!-- AUTO:API:begin -->
Collect global, scene, and negative prompts. Optional output_scenes filters effective scene lines (1-based); effective_length is the number of lines actually output.

#### Inputs

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `global_prompt` | STRING | `""` | Global prompt applied across all scenes |
| `scene_prompt` | STRING | `""` | One scene prompt per non-empty line; empty lines are ignored for the count |
| `negative_prompt` | STRING | `""` | Negative prompt text |
| `output_scenes` | STRING | `""` | Optional 1-based scene numbers to keep, separated by spaces or commas (e.g. 1 2 3 or 1,3,5). Empty = all scenes. |

#### Outputs

| Name | Type | Description |
|------|------|-------------|
| `global_prompt` | STRING | Pass-through global prompt text |
| `negative_prompt` | STRING | Pass-through negative prompt text |
| `scene_prompt` | STRING | Scene prompt text (filtered when output_scenes is set) |
| `effective_length` | INT | Number of scene lines actually output |
<!-- AUTO:API:end -->

## Notes

- Empty lines / whitespace-only lines in `scene_prompt` are ignored when counting or selecting scenes.
- `output_scenes` empty: pass `scene_prompt` through; `effective_length` is all effective lines.
- `output_scenes` set (e.g. `1 3 5` or `1,3,5`): output only those 1-based effective lines; `effective_length` is how many were actually selected (out-of-range numbers are skipped).
