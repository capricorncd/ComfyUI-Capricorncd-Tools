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
- Optional leading / trailing blank lines on output
- **History** and **Preset** via a single **预设/历史记录** button (modal with tabs; stored in browser `localStorage`)

### History / Presets

| Action | Behavior |
|--------|----------|
| 预设 / 历史记录 tabs | Switch between named presets and recent history in one modal |
| History | Recent prompts (auto-saved after each successful node run; also manual save) |
| Preset | Named prompt snippets you save manually |
| Insert | Inserts at the last known caret position; if caret is unknown, appends to the end |
| Replace | Replaces the entire textarea content |
| Export / Import | JSON round-trip for the active tab; import can merge or replace |

| Output | Type | Description |
|--------|------|-------------|
| `prompt` | STRING | Active lines with `#` comment markers removed |
