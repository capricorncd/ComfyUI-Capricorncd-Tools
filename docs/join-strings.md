# Join Strings

**Category:** `Capricorncd`

Joins a variable number of `STRING` / `INT` / `FLOAT` inputs into one string. Slots auto-grow (same pattern as Math Expression). Unconnected slots are skipped.

---

## Join separators

| `join_mode` | Separator |
|-------------|-----------|
| `newline` | newline |
| `comma` | `,` |
| `underscore` | `_` |
| `hyphen` | `-` |
| `slash` | `/` |
| `none` | empty (concatenate with no character, not a space) |

If `custom_sep` is non-empty, it is used instead of `join_mode`. Leave it empty to use the dropdown.

---

## Inputs

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `join_mode` | ENUM | `newline` | Preset separator (see table above) |
| `custom_sep` | STRING | `""` | Custom separator; overrides `join_mode` when non-empty |
| `leading_blank` | BOOLEAN | false | Insert an empty segment at the start |
| `trailing_blank` | BOOLEAN | false | Insert an empty segment at the end |
| `prefix` | STRING | `""` | Prepended to the joined result |
| `suffix` | STRING | `""` | Appended to the joined result |
| `texts` | STRING / INT / FLOAT | *(autogrow)* | Values to join; unconnected slots are skipped |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| `STRING` | STRING | Joined text: `{prefix}{parts joined by sep}{suffix}` |

---

## Notes

- `none` concatenates with no separator (`ab`), not a space (`a b`). Use `custom_sep` with a single space if you need spaces.
- `leading_blank` / `trailing_blank` insert empty parts before joining, so in `newline` mode they become blank lines.
- Existing workflows that only set `newline` or `comma` keep working.
