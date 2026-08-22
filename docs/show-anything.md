# Show Anything

**Category:** `Capricorncd`

Display any connected value on the node UI (same idea as Easy-Use **Show Any**), with an optional **Format JSON** toggle.

Unlike [Format JSON](format-json.md), this node:

- Accepts **any** type (`*`), not only strings
- Writes the last shown text into workflow `widgets_values`
- **Does not clear** the display when there is no input on a later run — so refresh / restart still shows the previous content after the workflow is restored

---

## Inputs

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `anything` | `*` | — | Optional. Any connected value to show and pass through |
| `format_json` | BOOLEAN | true | When on, pretty-print JSON strings / serializable objects |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| `output` | `*` | Passthrough of the input value (unchanged) |

---

## Persistence

On each successful display update the node stores:

```text
widgets_values = [format_json, ...display_texts]
```

The frontend restores those text widgets in `onConfigure`, so the last run’s content remains visible after browser refresh or ComfyUI restart (when the workflow is loaded again). Save the workflow after a run if your setup does not auto-save.
