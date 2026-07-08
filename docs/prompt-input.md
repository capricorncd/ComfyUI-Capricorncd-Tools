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
| Tabs | 历史记录 / 风格 / 质量 / 其他预设 |
| History | Recent prompts (auto-saved after each successful node run; also manual save) |
| Built-in presets | Style / quality / other snippets managed in `js/cap_prompt_presets.js` |
| Insert / Replace | Writes `#title` then prompt body into the **currently selected** Rich Prompt node |
| Export / Import | JSON round-trip for history and user presets under 其他预设 |

| Output | Type | Description |
|--------|------|-------------|
| `prompt` | STRING | Active lines with `#` comment markers removed |
