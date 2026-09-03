"""Shared i18n helper for backend user-facing strings.

ComfyUI's node-graph i18n (locales/<lang>/nodeDefs.json) covers node
titles, widget names and tooltips automatically. It does *not* cover text
this extension sends back at runtime -- HTTP API error/status messages,
default project/file names, exceptions surfaced in the node error popup,
etc. Those go through this module instead.

The browser doesn't forward ComfyUI's language setting to the server on
its own, so the frontend (see js/cap_i18n.js -> capFetch()) attaches the
resolved language as an `X-Cap-Locale` request header (or `?lang=` query
param as a fallback for plain <a>/download links). Route handlers call
`resolve_lang(request)` to read it, then `t(key, lang)` to translate.

Unknown languages and missing keys always fall back to English -- this
module never returns an empty string.
"""
from __future__ import annotations

from typing import Any

SUPPORTED_LANGS = ("en", "zh", "ja")
DEFAULT_LANG = "en"

# key -> {lang: text}. Every key MUST have an "en" entry; it is the
# fallback for unsupported languages and for zh/ja gaps.
_STRINGS: dict[str, dict[str, str]] = {
    "file_not_found": {
        "en": "File not found",
        "zh": "文件不存在",
        "ja": "ファイルが見つかりません",
    },
    "not_found": {
        "en": "Not found",
        "zh": "未找到",
        "ja": "見つかりません",
    },
    "missing_dir_or_name": {
        "en": "Missing dir or name",
        "zh": "缺少目录或文件名",
        "ja": "ディレクトリまたはファイル名がありません",
    },
    "invalid_filename": {
        "en": "Invalid filename",
        "zh": "无效的文件名",
        "ja": "無効なファイル名です",
    },
    "unsupported_file_type": {
        "en": "Unsupported file type",
        "zh": "不支持的文件类型",
        "ja": "サポートされていないファイル形式です",
    },
    "invalid_asset": {
        "en": "Invalid asset",
        "zh": "无效的资源",
        "ja": "無効なアセットです",
    },
    "only_timeline_uploads_deletable": {
        "en": "Only timeline uploads can be deleted",
        "zh": "仅可删除时间轴上传的文件",
        "ja": "タイムラインでアップロードしたファイルのみ削除できます",
    },
    "input_asset_not_found": {
        "en": "Input asset not found",
        "zh": "未找到输入资源",
        "ja": "入力アセットが見つかりません",
    },
    "invalid_project": {
        "en": "Invalid project",
        "zh": "无效的项目数据",
        "ja": "無効なプロジェクトデータです",
    },
    "invalid_payload": {
        "en": "Invalid payload",
        "zh": "无效的请求数据",
        "ja": "無効なリクエストデータです",
    },
    "missing_file": {
        "en": "Missing file",
        "zh": "缺少文件",
        "ja": "ファイルがありません",
    },
    "empty_zip": {
        "en": "Empty ZIP",
        "zh": "ZIP 文件为空",
        "ja": "ZIPファイルが空です",
    },
    "missing_image_field": {
        "en": "Missing image field",
        "zh": "缺少图片字段",
        "ja": "画像フィールドがありません",
    },
    "missing_filename": {
        "en": "Missing filename",
        "zh": "缺少文件名",
        "ja": "ファイル名がありません",
    },
    "agent_not_found": {
        "en": "Agent not found",
        "zh": "Agent 不存在",
        "ja": "エージェントが見つかりません",
    },
    "invalid_skill": {
        "en": "Invalid skill",
        "zh": "无效的技能",
        "ja": "無効なスキルです",
    },
    "skill_not_found": {
        "en": "Skill not found",
        "zh": "未找到该技能",
        "ja": "スキルが見つかりません",
    },
    "assets_dir_not_configured": {
        "en": "Assets directory is not configured",
        "zh": "未配置资源目录",
        "ja": "アセットディレクトリが設定されていません",
    },
    "untitled_project": {
        "en": "Untitled Project",
        "zh": "未命名项目",
        "ja": "無題のプロジェクト",
    },
    "unsupported_or_missing_file": {
        "en": "Unsupported or missing file",
        "zh": "文件缺失或格式不受支持",
        "ja": "ファイルがないか、サポートされていない形式です",
    },
    # -- node execute()/validation errors (surfaced in ComfyUI's node error popup) --
    "empty_directory_path": {
        "en": "Directory path is empty",
        "zh": "目录路径为空",
        "ja": "ディレクトリパスが空です",
    },
    "refuse_clear_root": {
        "en": "Refusing to clear root directory: {path}",
        "zh": "禁止清空根目录: {path}",
        "ja": "ルートディレクトリのクリアは禁止されています: {path}",
    },
    "recycle_bin_failed": {
        "en": "Failed to move to recycle bin (code {code}): {path}",
        "zh": "无法移入回收站 (code {code}): {path}",
        "ja": "ごみ箱への移動に失敗しました (コード {code}): {path}",
    },
    "recycle_bin_cancelled": {
        "en": "Move to recycle bin cancelled: {path}",
        "zh": "移入回收站已取消: {path}",
        "ja": "ごみ箱への移動がキャンセルされました: {path}",
    },
    "git_not_found": {
        "en": "Git not found; please install Git before updating the Skill library",
        "zh": "未找到 git，请先安装 Git 后再更新 Skill 库",
        "ja": "Gitが見つかりません。Skillライブラリを更新する前にGitをインストールしてください",
    },
    "skill_sync_in_progress": {
        "en": "Skill library sync already in progress, please wait",
        "zh": "正在同步 Skill 库，请稍候",
        "ja": "Skillライブラリを同期中です。しばらくお待ちください",
    },
    "zip_missing_project_json": {
        "en": "ZIP is missing project.json",
        "zh": "ZIP 中缺少 project.json",
        "ja": "ZIPにproject.jsonがありません",
    },
    "invalid_project_json_format": {
        "en": "project.json has an invalid format",
        "zh": "project.json 格式无效",
        "ja": "project.jsonの形式が無効です",
    },
    "missing_asset": {
        "en": "Missing asset: {file}",
        "zh": "缺少素材：{file}",
        "ja": "アセットが見つかりません: {file}",
    },
    "image_file_not_found": {
        "en": "Image file not found: {path}",
        "zh": "图片文件不存在: {path}",
        "ja": "画像ファイルが見つかりません: {path}",
    },
    "unsupported_image_format": {
        "en": "Unsupported image format: {path}",
        "zh": "不支持的图片格式: {path}",
        "ja": "サポートされていない画像形式です: {path}",
    },
    "empty_images_batch": {
        "en": "images batch is empty",
        "zh": "images 批次为空",
        "ja": "images バッチが空です",
    },
    "ffmpeg_failed": {
        "en": "ffmpeg failed:\n{detail}",
        "zh": "ffmpeg 执行失败:\n{detail}",
        "ja": "ffmpegの実行に失敗しました:\n{detail}",
    },
    "invalid_frames_dir": {
        "en": "frames_dir is not a valid directory: {path}",
        "zh": "frames_dir 不是有效目录: {path}",
        "ja": "frames_dir が有効なディレクトリではありません: {path}",
    },
    "no_image_sequence_found": {
        "en": "No image sequence found in directory: {path}",
        "zh": "在目录中未找到图片序列: {path}",
        "ja": "ディレクトリ内に画像シーケンスが見つかりません: {path}",
    },
    "path_escapes_dir": {
        "en": "Path is not allowed to escape the directory: {path}",
        "zh": "路径不允许跳出目录: {path}",
        "ja": "パスがディレクトリの外に出ることは許可されていません: {path}",
    },
    "clips_dir_empty_no_run_timestamp": {
        "en": "clips_dir is empty and data_json has no run_timestamp",
        "zh": "clips_dir 为空且 data_json 中没有 run_timestamp",
        "ja": "clips_dir が空で、data_json に run_timestamp がありません",
    },
    "clip_dir_not_found": {
        "en": "Clip directory not found: {path}",
        "zh": "片段目录不存在: {path}",
        "ja": "クリップディレクトリが見つかりません: {path}",
    },
    "ffmpeg_not_found": {
        "en": "ffmpeg not found; please install it and add it to PATH",
        "zh": "未找到 ffmpeg，请先安装并加入 PATH",
        "ja": "ffmpegが見つかりません。インストールしてPATHに追加してください",
    },
    "video_has_no_audio": {
        "en": "This video has no audio track",
        "zh": "该视频没有音轨",
        "ja": "この動画には音声トラックがありません",
    },
    "no_clips_in_data_json": {
        "en": "No usable clips in data_json",
        "zh": "data_json 中没有可用 clips",
        "ja": "data_json に使用可能な clips がありません",
    },
    "clip_video_not_found": {
        "en": "Clip video #{index} not found (stem={stem}) in {dir}",
        "zh": "未找到第 {index} 段视频（stem={stem}）于 {dir}",
        "ja": "クリップ動画 #{index} が見つかりません（stem={stem}）: {dir}",
    },
    "no_clips_to_compose": {
        "en": "No clip videos to compose",
        "zh": "没有可合成的片段视频",
        "ja": "合成できるクリップ動画がありません",
    },
    "invalid_generated_video_path": {
        "en": "Invalid generated video path: {path}",
        "zh": "生成视频路径非法: {path}",
        "ja": "生成された動画のパスが無効です: {path}",
    },
    "generated_video_not_found": {
        "en": "Generated video not found: {file}",
        "zh": "找不到生成视频: {file}",
        "ja": "生成された動画が見つかりません: {file}",
    },
    "audio_file_not_found": {
        "en": "Audio file not found: {file}",
        "zh": "找不到音频文件: {file}",
        "ja": "音声ファイルが見つかりません: {file}",
    },
    "no_generated_videos_to_compose": {
        "en": "No generated videos to compose (add and enable a generated video for a clip first)",
        "zh": "没有可合成的生成视频（请先为 clip 添加并启用生成视频）",
        "ja": "合成できる生成動画がありません（先にクリップに生成動画を追加して有効にしてください）",
    },
    "watermark_image_not_found": {
        "en": "Watermark image not found: {file}",
        "zh": "找不到水印图片: {file}",
        "ja": "透かし画像が見つかりません: {file}",
    },
    "provider_must_be_openai_gemini": {
        "en": "Provider must be OpenAI or Gemini",
        "zh": "服务商必须是 OpenAI 或 Gemini",
        "ja": "プロバイダーはOpenAIまたはGeminiである必要があります",
    },
    "agent_name_required": {
        "en": "Agent name is required and must be 80 characters or fewer",
        "zh": "Agent 名称不能为空且不能超过 80 个字符",
        "ja": "エージェント名は必須で、80文字以内で入力してください",
    },
    "model_name_required": {
        "en": "Model name is required and must be 120 characters or fewer",
        "zh": "模型名称不能为空且不能超过 120 个字符",
        "ja": "モデル名は必須で、120文字以内で入力してください",
    },
    "api_key_required_new_agent": {
        "en": "API Key is required when adding a new Agent",
        "zh": "新增 Agent 时必须填写 API Key",
        "ja": "新しいエージェントを追加するにはAPIキーが必要です",
    },
    "no_multimodal_model_selected": {
        "en": "No multimodal model selected",
        "zh": "未选择多模态模型",
        "ja": "マルチモーダルモデルが選択されていません",
    },
    "model_not_found": {
        "en": 'Model "{name}" not found. Place it under ComfyUI/models/prompt_generator/ or models/LLM/.',
        "zh": "找不到模型「{name}」。请放到 ComfyUI/models/prompt_generator/ 或 models/LLM/。",
        "ja": "モデル「{name}」が見つかりません。ComfyUI/models/prompt_generator/ または models/LLM/ に配置してください。",
    },
    "transformers_required": {
        "en": "transformers (>= 4.57 recommended) is required to run the multimodal prompt node",
        "zh": "需要 transformers（建议 >= 4.57）才能运行多模态提示词节点",
        "ja": "マルチモーダルプロンプトノードの実行には transformers（4.57以上を推奨）が必要です",
    },
    "qwen_subprocess_failed": {
        "en": "Qwen3-VL subprocess failed: {detail}",
        "zh": "Qwen3-VL 独立进程失败: {detail}",
        "ja": "Qwen3-VLの独立プロセスが失敗しました: {detail}",
    },
    "agent_not_found_reconfigure": {
        "en": "Selected Agent not found; please reconfigure it in the timeline settings",
        "zh": "找不到所选 Agent，请在时间轴设置中重新配置",
        "ja": "選択したエージェントが見つかりません。タイムライン設定で再設定してください",
    },
    "agent_disabled": {
        "en": "Selected Agent is disabled",
        "zh": "所选 Agent 已停用",
        "ja": "選択したエージェントは無効化されています",
    },
    "agent_missing_api_key": {
        "en": "Selected Agent has no API Key configured",
        "zh": "所选 Agent 尚未配置 API Key",
        "ja": "選択したエージェントにAPIキーが設定されていません",
    },
    "provider_api_request_failed": {
        "en": "{provider} API request failed ({code}): {detail}",
        "zh": "{provider} API 请求失败 ({code}): {detail}",
        "ja": "{provider} APIリクエストが失敗しました ({code}): {detail}",
    },
    "provider_api_connection_failed": {
        "en": "{provider} API connection failed: {reason}",
        "zh": "{provider} API 连接失败: {reason}",
        "ja": "{provider} API接続に失敗しました: {reason}",
    },
    "unsupported_agent_provider": {
        "en": "Unsupported Agent provider",
        "zh": "不支持的 Agent 服务商",
        "ja": "サポートされていないエージェントプロバイダーです",
    },
    "provider_api_no_text": {
        "en": "{provider} API returned no text",
        "zh": "{provider} API 没有返回文本",
        "ja": "{provider} APIがテキストを返しませんでした",
    },
    "local_qwen_model_not_found": {
        "en": "Local Qwen3-VL model not found; please place it under ComfyUI/models/prompt_generator/",
        "zh": "未找到本地 Qwen3-VL 模型，请放到 ComfyUI/models/prompt_generator/",
        "ja": "ローカルのQwen3-VLモデルが見つかりません。ComfyUI/models/prompt_generator/ に配置してください",
    },
}


def normalize_lang(raw: Any) -> str:
    """Map an arbitrary language string to 'en' | 'zh' | 'ja', defaulting
    to English for anything unrecognized (matches the JS-side rule)."""
    if not raw:
        return DEFAULT_LANG
    low = str(raw).strip().lower()
    if low.startswith("zh"):
        return "zh"
    if low.startswith("ja"):
        return "ja"
    if low.startswith("en"):
        return "en"
    return DEFAULT_LANG


def resolve_lang(request) -> str:
    """Read the caller's language from the `X-Cap-Locale` header (set by
    js/cap_i18n.js's capFetch), falling back to a `lang` query param for
    plain-link requests, then to English. Also remembers it (see
    `get_last_known_lang`) so server-side code with no request object --
    a node's `execute()`, which runs during prompt processing rather than
    in response to one of our own HTTP calls -- can still guess the UI
    language for any error text it raises."""
    raw = None
    try:
        raw = request.headers.get("X-Cap-Locale")
        if not raw:
            raw = request.rel_url.query.get("lang")
    except Exception:
        raw = None
    lang = normalize_lang(raw)
    set_last_known_lang(lang)
    return lang


# Best-effort UI language for code that has no request to read (node
# `execute()` bodies). Updated by every request that carries a resolvable
# language (see resolve_lang / the "/cap/set_lang" beacon js/cap_i18n.js
# fires once per page load). This extension targets the standard local
# ComfyUI install -- one browser talking to one server -- so a single
# process-wide "last seen" value is an acceptable approximation; it is
# not meant to disambiguate multiple simultaneous users/browsers.
_last_known_lang = DEFAULT_LANG


def set_last_known_lang(lang: str) -> None:
    global _last_known_lang
    _last_known_lang = normalize_lang(lang)


def get_last_known_lang() -> str:
    return _last_known_lang


def t(key: str, lang: str = DEFAULT_LANG, **kwargs: Any) -> str:
    """Translate `key` into `lang`, falling back to English, then to the
    key itself if it isn't registered at all."""
    table = _STRINGS.get(key)
    if not table:
        return key
    lang = normalize_lang(lang)
    text = table.get(lang) or table.get(DEFAULT_LANG) or key
    if kwargs:
        try:
            text = text.format(**kwargs)
        except Exception:
            pass
    return text
