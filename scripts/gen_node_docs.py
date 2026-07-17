#!/usr/bin/env python3
"""Regenerate <!-- AUTO:API --> sections in docs/ from node metadata.

Reads DOC_SLUG, DESCRIPTION, INPUT_TYPES tooltips, RETURN_*, and OUTPUT_TOOLTIPS
from Python node modules via AST (no ComfyUI import required).

Usage (from package root):
    python scripts/gen_node_docs.py
    python scripts/gen_node_docs.py --check   # exit 1 if docs are stale
"""

from __future__ import annotations

import argparse
import ast
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"

BEGIN = "<!-- AUTO:API:begin -->"
END = "<!-- AUTO:API:end -->"

# Modules that participate in doc generation.
SOURCE_FILES = [
    "cap_save_images.py",
    "cap_size_settings.py",
    "cap_format_json.py",
    "cap_image_batch.py",
    "cap_load_images_from_dir.py",
    "cap_clear_directory.py",
    "prompt_input_rich.py",
    "cap_prompt_group.py",
]


def _literal(node):
    if node is None:
        return None
    try:
        return ast.literal_eval(node)
    except Exception:
        if isinstance(node, ast.Name):
            return node.id
        if isinstance(node, ast.Attribute):
            return ast.unparse(node) if hasattr(ast, "unparse") else None
        if isinstance(node, ast.JoinedStr):
            return ast.unparse(node) if hasattr(ast, "unparse") else None
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
            left, right = _literal(node.left), _literal(node.right)
            if isinstance(left, str) and isinstance(right, str):
                return left + right
        return None


def _const_str(node) -> str | None:
    value = _literal(node)
    return value if isinstance(value, str) else None


def _type_label(type_node) -> str:
    value = _literal(type_node)
    if isinstance(value, str):
        known = {
            "IMAGE", "STRING", "INT", "FLOAT", "BOOLEAN", "AUDIO", "MASK",
            "LATENT", "MODEL", "CLIP", "VAE", "CONDITIONING",
        }
        if value in known:
            return value
        # Module-level enum tuple constants (e.g. ASPECT_RATIOS)
        if value.isupper() or value.endswith("S"):
            return "ENUM"
        return value
    if isinstance(value, (list, tuple)) and value:
        return "ENUM"
    if isinstance(type_node, ast.Name):
        known = {
            "IMAGE", "STRING", "INT", "FLOAT", "BOOLEAN", "AUDIO", "MASK",
            "LATENT", "MODEL", "CLIP", "VAE", "CONDITIONING",
        }
        if type_node.id in known:
            return type_node.id
        return "ENUM"
    if hasattr(ast, "unparse"):
        return ast.unparse(type_node)
    return "?"


def _format_default(value) -> str:
    if value is None:
        return "—"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return f"`{value}`" if value else '`""`'
    return f"`{value}`"


def _parse_input_entry(key: str, value_node, *, optional: bool) -> dict:
    name = key
    if optional:
        name = f"{key} *(optional)*"

    if isinstance(value_node, ast.Tuple) and value_node.elts:
        type_label = _type_label(value_node.elts[0])
        opts = {}
        if len(value_node.elts) > 1 and isinstance(value_node.elts[1], ast.Dict):
            opts = {
                _literal(k): _literal(v)
                for k, v in zip(value_node.elts[1].keys, value_node.elts[1].values)
                if isinstance(_literal(k), str)
            }
        return {
            "name": name,
            "type": type_label,
            "default": _format_default(opts.get("default")),
            "tooltip": opts.get("tooltip") if isinstance(opts.get("tooltip"), str) else "",
        }

    if isinstance(value_node, ast.Name):
        return {"name": name, "type": value_node.id, "default": "—", "tooltip": ""}

    return {"name": name, "type": "?", "default": "—", "tooltip": ""}


def _parse_input_types_method(method: ast.FunctionDef) -> list[dict]:
    inputs: list[dict] = []
    for node in method.body:
        if not isinstance(node, ast.Return) or not isinstance(node.value, ast.Dict):
            continue
        for section_key, section_val in zip(node.value.keys, node.value.values):
            section = _literal(section_key)
            if section not in ("required", "optional") or not isinstance(section_val, ast.Dict):
                continue
            optional = section == "optional"
            for ik, iv in zip(section_val.keys, section_val.values):
                name = _literal(ik)
                if not isinstance(name, str):
                    continue
                inputs.append(_parse_input_entry(name, iv, optional=optional))
    return inputs


def _class_attr_assign(node: ast.Assign) -> tuple[str | None, object]:
    if len(node.targets) != 1 or not isinstance(node.targets[0], ast.Name):
        return None, None
    return node.targets[0].id, _literal(node.value)


def extract_nodes(path: Path) -> list[dict]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    display_names: dict[str, str] = {}
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        for target in node.targets:
            if isinstance(target, ast.Name) and target.id == "NODE_DISPLAY_NAME_MAPPINGS":
                value = _literal(node.value)
                if isinstance(value, dict):
                    display_names = {str(k): str(v) for k, v in value.items()}

    nodes = []
    for node in tree.body:
        if not isinstance(node, ast.ClassDef):
            continue
        info = {
            "class_name": node.name,
            "display_name": display_names.get(node.name, node.name),
            "doc_slug": None,
            "doc_section": None,
            "description": "",
            "category": "Capricorncd",
            "inputs": [],
            "return_types": [],
            "return_names": [],
            "output_tooltips": {},
            "source": path.name,
        }
        for item in node.body:
            if isinstance(item, ast.Assign):
                name, value = _class_attr_assign(item)
                if name == "DOC_SLUG" and isinstance(value, str):
                    info["doc_slug"] = value
                elif name == "DOC_SECTION" and isinstance(value, str):
                    info["doc_section"] = value
                elif name == "DESCRIPTION" and isinstance(value, str):
                    info["description"] = value
                elif name == "CATEGORY" and isinstance(value, str):
                    info["category"] = value
                elif name == "RETURN_TYPES" and isinstance(value, (list, tuple)):
                    info["return_types"] = list(value)
                elif name == "RETURN_NAMES" and isinstance(value, (list, tuple)):
                    info["return_names"] = list(value)
                elif name == "OUTPUT_TOOLTIPS" and isinstance(value, dict):
                    info["output_tooltips"] = {
                        str(k): str(v) for k, v in value.items()
                    }
            elif isinstance(item, ast.FunctionDef) and item.name == "INPUT_TYPES":
                info["inputs"] = _parse_input_types_method(item)
            elif isinstance(item, ast.Expr) and isinstance(item.value, ast.Constant):
                if isinstance(item.value.value, str) and not info["description"]:
                    # class docstring fallback
                    pass

        if node.body and isinstance(node.body[0], ast.Expr):
            doc = _const_str(node.body[0].value)
            if doc and not info["description"]:
                info["description"] = doc.strip().split("\n")[0]

        if info["doc_slug"]:
            nodes.append(info)
    return nodes


def render_api_block(nodes: list[dict]) -> str:
    chunks: list[str] = []
    multi = len(nodes) > 1 or any(n.get("doc_section") for n in nodes)

    for node in nodes:
        lines: list[str] = []
        if multi:
            lines.append(f"### {node.get('doc_section') or node['display_name']}")
            lines.append("")

        if node.get("description"):
            lines.append(node["description"])
            lines.append("")

        lines.append("#### Inputs")
        lines.append("")
        lines.append("| Name | Type | Default | Description |")
        lines.append("|------|------|---------|-------------|")
        for row in node["inputs"]:
            base = row["name"].split()[0]
            optional = "*(optional)*" in row["name"]
            name_cell = f"`{base}` *(optional)*" if optional else f"`{base}`"
            tip = (row["tooltip"] or "").replace("\n", " ")
            lines.append(f"| {name_cell} | {row['type']} | {row['default']} | {tip} |")

        lines.append("")
        lines.append("#### Outputs")
        lines.append("")
        lines.append("| Name | Type | Description |")
        lines.append("|------|------|-------------|")
        names = node["return_names"] or [f"out_{i}" for i in range(len(node["return_types"]))]
        types = node["return_types"]
        tips = node["output_tooltips"]
        for i, name in enumerate(names):
            typ = types[i] if i < len(types) else "?"
            tip = tips.get(name, "")
            lines.append(f"| `{name}` | {typ} | {tip} |")
        lines.append("")
        chunks.append("\n".join(lines))

    return "\n".join(chunks).rstrip() + "\n"


def replace_auto_block(text: str, body: str) -> str:
    block = f"{BEGIN}\n{body.rstrip()}\n{END}"
    pattern = re.compile(
        re.escape(BEGIN) + r".*?" + re.escape(END),
        re.DOTALL,
    )
    if pattern.search(text):
        text = pattern.sub(block, text, count=1)
    else:
        for marker in ("\n## Notes\n", "\n## 注意事项\n", "\n## Example\n", "\n## 示例\n"):
            idx = text.find(marker)
            if idx != -1:
                text = text[:idx] + "\n" + block + "\n" + text[idx + 1:]
                break
        else:
            text = text.rstrip() + "\n\n" + block + "\n"

    # Normalize spacing around the AUTO block.
    text = re.sub(r"\n{3,}" + re.escape(BEGIN), "\n\n" + BEGIN, text)
    text = re.sub(re.escape(END) + r"\n*(## )", END + r"\n\n\1", text)
    return text


def strip_manual_api_sections(text: str) -> str:
    """Remove hand-written Inputs/Outputs sections outside AUTO blocks."""
    if BEGIN in text:
        return text
    pattern = re.compile(
        r"\n## (?:Inputs|Outputs|输入参数|输出参数)\n.*?(?=\n## |\Z)",
        re.DOTALL,
    )
    return pattern.sub("\n", text)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Exit with status 1 if any doc would change",
    )
    args = parser.parse_args()

    by_slug: dict[str, list[dict]] = defaultdict(list)
    for rel in SOURCE_FILES:
        path = ROOT / rel
        if not path.exists():
            print(f"skip missing {rel}", file=sys.stderr)
            continue
        for node in extract_nodes(path):
            by_slug[node["doc_slug"]].append(node)

    changed = []
    for slug, nodes in sorted(by_slug.items()):
        body = render_api_block(nodes)
        for rel in (f"{slug}.md", f"zh/{slug}.md"):
            path = DOCS / rel
            if not path.exists():
                print(f"skip missing doc {rel}", file=sys.stderr)
                continue
            original = path.read_text(encoding="utf-8")
            prepared = strip_manual_api_sections(original) if BEGIN not in original else original
            updated = replace_auto_block(prepared, body)
            if updated != original:
                changed.append(rel)
                if not args.check:
                    path.write_text(updated, encoding="utf-8", newline="\n")

    if args.check:
        if changed:
            print("stale docs:", ", ".join(changed))
            return 1
        print("docs up to date")
        return 0

    if changed:
        print("updated:", ", ".join(changed))
    else:
        print("no changes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
