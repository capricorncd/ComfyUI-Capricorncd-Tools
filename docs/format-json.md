# Format JSON

**Category:** `Capricorncd`

Pretty-prints a JSON string for reading in the graph UI. Invalid JSON is shown with a parse-error header and the original text is preserved in the output.

Useful for inspecting `data_json` from **Timeline Editor** / **Audio Timeline** without leaving ComfyUI.

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

The node is an output node: the formatted text is also shown on the node UI.
