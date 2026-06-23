# Prompt Input / Rich Prompt Input

**Category:** `Capricorncd`

Two prompt editor nodes with line-comment support. Both strip `#`-prefixed lines from their output so you can keep notes, disabled variations, or alternative prompts directly in the text field without affecting generation.

---

## Prompt Input

A clean multi-line text area with comment toggling.

**Features**
- Lines beginning with `#` are treated as comments and removed from the output
- `Ctrl+/` toggles the `#` comment marker on the current line or all selected lines

| Output | Type | Description |
|--------|------|-------------|
| `prompt` | STRING | Active (non-commented) lines joined with newlines |

---

## Rich Prompt Input

An enhanced editor with live syntax highlighting rendered via a transparent overlay mirror.

**Features**
- Commented lines are visually dimmed in the editor
- `Ctrl+/` toggles `#` on the current line or selection
- Paste automatically strips rich-text formatting (plain text only)
- Comment markers are removed from the output; only the raw text content is passed downstream

| Output | Type | Description |
|--------|------|-------------|
| `prompt` | STRING | Active lines with `#` comment markers removed |
