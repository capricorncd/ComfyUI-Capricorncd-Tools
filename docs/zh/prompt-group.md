# Prompt Group（提示词组合）

**分类：** `Capricorncd`

集中填写全局提示词、场景提示词（每行一条）与负面提示词。可通过「输出场景」筛选要输出的场景行。

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

## 注意事项

- 场景提示词中的空行 / 仅空白行在计数与筛选时忽略。
- `输出场景` 为空：场景提示词原样透传；`effective_length` 为全部有效行数。
- `输出场景` 非空（如 `1 3 5` 或 `1,3,5`）：只输出对应的 1-based 有效行；`effective_length` 为实际选出的条数（越界编号跳过）。
