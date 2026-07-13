# Rich Prompt Input（富文本提示词输入）

**分类：** `Capricorncd`

支持 `#` 行注释，并通过透明覆盖层做实时语法高亮。以 `#` 开头的行不会写入输出，便于在框内保留笔记或禁用草稿而不影响生成。

## 功能

- 注释行在编辑器中以较暗颜色显示
- `Ctrl+/` 为当前行或选中内容切换 `#`
- 粘贴时自动剥离富文本格式（仅保留纯文本）
- 注释不写入输出，只有正文向下传递
- 可选在输出开头 / 结尾追加空行
- **历史记录**与**预设**通过节点按钮打开浮动面板（浏览器 `localStorage` 共用）

## 历史记录 / 预设

| 操作 | 行为 |
|------|------|
| Tab | 历史记录 / 预设 |
| 历史记录 | 最近提示词（节点成功执行后自动保存；也可手动保存） |
| 内置预设 | 风格 / 质量 / 其他，数据在 `js/cap_prompt_presets.js` |
| 插入 / 替换 | `#标题` + 正文写入**当前选中的**富文本提示词节点 |
| 导出 / 导入 | 历史与用户自定义预设支持 JSON 往返 |

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
