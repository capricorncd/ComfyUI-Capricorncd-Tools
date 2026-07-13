# Rich Prompt Input

**Category:** `Capricorncd`

Prompt editor with `#` line-comment support and a live syntax highlighting overlay. Lines beginning with `#` are removed from the output so you can keep notes or disabled variants in the field without affecting generation.

## Features

- Commented lines are visually dimmed in the editor
- `Ctrl+/` toggles `#` on the current line or selection
- Paste automatically strips rich-text formatting (plain text only)
- Comment markers are removed from the output; only the raw text content is passed downstream
- Optional leading / trailing blank lines on output
- **History** and **Presets** via a single node button (floating modal; shared browser `localStorage`)

## History / Presets

| Action | Behavior |
|--------|----------|
| Tabs | 历史记录 / 预设 |
| History | Recent prompts (auto-saved after each successful node run; also manual save) |
| Built-in presets | Style / quality / other snippets managed in `js/cap_prompt_presets.js` |
| Insert / Replace | Writes `#title` then prompt body into the **currently selected** Rich Prompt node |
| Export / Import | JSON round-trip for history and user presets |

<!-- AUTO:API:begin -->
Rich prompt editor with # line comments (stripped from output), Ctrl+/ toggle, plain-text paste, and history/preset library.

#### Inputs

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `prompt` | STRING | `""` | 富文本提示词输入：Ctrl+/ 注释切换，粘贴时仅保留纯文本。输出会过滤注释行。 |
| `add_blank_line_start` | BOOLEAN | false | 在输出字符串开头插入一个空行。 |
| `add_blank_line_end` | BOOLEAN | false | 在输出字符串末尾插入一个空行。 |

#### Outputs

| Name | Type | Description |
|------|------|-------------|
| `prompt` | STRING | Active lines with # comment markers removed |
<!-- AUTO:API:end -->
