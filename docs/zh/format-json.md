# Format JSON（格式化 JSON）

**分类：** `Capricorncd`

将 JSON 字符串格式化为缩进文本，便于在画布上阅读。解析失败时会在输出前附加错误注释，并保留原始文本。

适合查看 **Timeline Editor** / **Audio Timeline** 的 `data_json`，无需离开 ComfyUI。

---

<!-- AUTO:API:begin -->
Format a JSON string with indentation; shows the result on the node and outputs formatted_json.

#### Inputs

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `json_text` | STRING | `""` | JSON string to format (connect from another node) |

#### Outputs

| Name | Type | Description |
|------|------|-------------|
| `formatted_json` | STRING | Indented JSON, or an error comment plus the original text |
<!-- AUTO:API:end -->

该节点为输出节点：格式化结果也会显示在节点 UI 上。
