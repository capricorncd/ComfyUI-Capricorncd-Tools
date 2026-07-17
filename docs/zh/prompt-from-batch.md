# Prompt From Batch（从批次获取提示词）

**分类：** `Capricorncd`

按批次索引与长度截取有效场景提示词，并可选择是否在前面合并全局提示词。

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

## 注意事项

- 有效场景行与「提示词组合」相同：忽略空行 / 仅空白行。
- 截取范围为 `lines[批次索引 : 批次索引 + 批次长度]`。
- 负的批次索引从末尾计数（`-1` 为最后一行）。
- `合并全局提示词` 为 true 且全局文本非空时，输出为：全局提示词 + 换行 + 截取的场景行。
- 不合并时，仅输出截取的场景行（多行用换行连接）。
