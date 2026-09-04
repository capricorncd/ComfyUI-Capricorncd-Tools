# 加载图像（提示词 / 描述） · Cap

节点 ID：`CAP_LoadImageMetadata`，分类：`Capricorncd`。

沿用 ComfyUI 原生加载图像的文件选择、上传、预览、图片/遮罩处理和文件变更检测。选图、重新打开工作流以及运行后均更新节点上的两个只读文本框。无需连接下游也可以运行。

输出：`image`（IMAGE）、`mask`（MASK）、`prompt`（STRING）、`description`（STRING）、`raw`（STRING）。三个文本输出可连接 Show Anything / 显示文本。

- 提示词优先使用 `ImageAssetMetadata.generation_prompt`；否则依次读取 `GenerationPrompt`、`generation_prompt`、`parameters`、`prompt`。原生 ComfyUI 的 `prompt` 可能是完整工作流 JSON，不会擅自猜测哪一个文本节点是正向提示词。
- 描述优先使用 `ImageAssetMetadata.setting_description`；否则读取 `Description`、`description`、`ImageDescription` 或 EXIF ImageDescription。
- 明确记录为 null 的原始提示词保持为空；没有文字信息时也输出空字符串。不调用 AI 补写。
- raw 是格式化 JSON，包含格式、尺寸、色彩模式、Pillow 读取到的完整 info（包括原始 prompt/workflow、自定义文本、EXIF/ICC/XMP 等）以及解码的 EXIF 字段。二进制值以 Base64 保留；不是像素数据或完整文件的转储。不承诺解析未被图像库识别的私有容器块。
- 支持 IDAT 后的 PNG 文本元数据。读取过程不修改源图片；元数据仅作为文本数据，不执行其中内容。

安装后重启 ComfyUI 并刷新浏览器，搜索“加载图像”或 `CAP_LoadImageMetadata`。
