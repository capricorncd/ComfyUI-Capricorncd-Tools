# Join Strings（字符串拼接）

**分类：** `Capricorncd`

将可变数量的 `STRING` / `INT` / `FLOAT` 输入拼成一条字符串。插槽会自动增长（与数学表达式节点相同）。未连接的插槽会被跳过。

---

## 拼接方式

| `join_mode` | 分隔符 |
|-------------|--------|
| `newline` | 换行 |
| `comma` | `,` |
| `underscore` | `_` |
| `hyphen` | `-` |
| `slash` | `/` |
| `none` | 空（直接粘在一起，不是空格） |

`custom_sep` 有内容时优先使用该字符串；留空则使用上方选项。

---

## 输入参数

| 名称 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `join_mode` | ENUM | `newline` | 预设分隔符（见上表） |
| `custom_sep` | STRING | `""` | 自定义分隔符；非空时优先于 `join_mode` |
| `leading_blank` | BOOLEAN | false | 在最前插入一个空段 |
| `trailing_blank` | BOOLEAN | false | 在最后插入一个空段 |
| `prefix` | STRING | `""` | 整体前缀 |
| `suffix` | STRING | `""` | 整体后缀 |
| `texts` | STRING / INT / FLOAT | *（自动增长）* | 要拼接的值；未连接的插槽跳过 |

## 输出参数

| 名称 | 类型 | 说明 |
|------|------|------|
| `STRING` | STRING | 拼接结果：`{prefix}{用分隔符连接的各段}{suffix}` |

---

## 注意事项

- `none` 是空字符拼接（`ab`），不是空格（`a b`）。需要空格时在 `custom_sep` 里填一个空格。
- `leading_blank` / `trailing_blank` 会在拼接前插入空段，因此在换行模式下表现为空行。
- 仅使用 `newline` / `comma` 的旧工作流不受影响。
