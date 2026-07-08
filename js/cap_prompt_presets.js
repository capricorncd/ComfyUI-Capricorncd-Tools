/** Built-in prompt presets for Rich Prompt library. */

function ensureComma(text) {
    const t = String(text ?? "").trim();
    if (!t) return t;
    return t.endsWith(",") ? t : `${t},`;
}

function preset(category, id, name, text) {
    const title = name.startsWith("#") ? name : `#${name}`;
    const body = ensureComma(text);
    return {
        id: `builtin_${category}_${id}`,
        category,
        name: title.replace(/^#/, ""),
        title,
        text: body,
        builtin: true,
        ts: 0,
    };
}

/** @type {ReadonlyArray<{id:string,category:string,name:string,title:string,text:string,builtin:boolean,ts:number}>} */
export const BUILTIN_PRESETS = [
    // ── 质量 ──────────────────────────────────────────────
    preset(
        "quality",
        "hyper_detail",
        "超高画质与写实细节提示词",
        "photorealistic, hyperrealistic, 8k resolution, extremely detailed, sharp focus, cinematic lighting, masterpiece, award-winning, stunning visual, intricate textures",
    ),
    preset(
        "quality",
        "pro_photo_light",
        "专业摄影与布光提示词",
        "professional studio photography, shot on 35mm lens, depth of field, volumetric lighting, soft illumination, global illumination, ray tracing, DSLR quality, rim light",
    ),
    preset(
        "quality",
        "generic_hq",
        "通用高质量提示词",
        "masterpiece, best quality, ultra detailed, highly detailed, sharp focus, clean composition, beautiful lighting, rich details, professional artwork, high resolution, refined textures",
    ),
    preset(
        "quality",
        "photo_real",
        "摄影真实感提示词",
        "photorealistic, realistic skin texture, natural lighting, shallow depth of field, 85mm lens, f/1.8, soft bokeh, detailed facial features, cinematic color grading, high-end portrait photography",
    ),
    preset(
        "quality",
        "cinematic",
        "电影感提示词",
        "cinematic, dramatic lighting, moody atmosphere, film still, anamorphic lens, soft rim light, volumetric lighting, depth of field, realistic shadows, warm highlights, teal and orange color grading",
    ),
    preset(
        "quality",
        "cinematic_wide",
        "电影感宽银幕构图提示词",
        "cinematic composition, anamorphic aspect ratio, wide-angle shot, dramatic perspective, storytelling atmosphere, film grain, muted color palette, movie still",
    ),

    // ── 风格 ──────────────────────────────────────────────
    preset(
        "style",
        "cyberpunk_scifi",
        "赛博朋克与科幻风格提示词",
        "cyberpunk style, neon lights, futuristic city, holographic overlays, gritty urban landscape, high-tech, dark synthwave aesthetic, glowing wires, chrome reflections",
    ),
    preset(
        "style",
        "shinkai",
        "新海诚通流动漫风格提示词",
        "Makoto Shinkai style, anime aesthetic, vibrant colors, beautiful detailed sky, cumulus clouds, sun rays, nostalgic atmosphere, cinematic composition, hand-drawn texture",
    ),
    preset(
        "style",
        "watercolor_ink",
        "水彩与中国风国画提示词",
        "watercolor painting style, traditional Chinese ink painting, soft color washes, elegant brush strokes, splash ink, poetic atmosphere, minimalist background, misty mountains",
    ),
    preset(
        "style",
        "steampunk",
        "蒸汽朋克与复古机械提示词",
        "steampunk aesthetic, brass gears, copper pipes, Victorian fashion, smoky atmosphere, vintage mechanical devices, sepia tone, clockwork details, industrial revolution vibe",
    ),
    preset(
        "style",
        "ghibli",
        "吉卜力治愈系动漫风格提示词",
        "Studio Ghibli style, whimsical and enchanting, hand-painted background, lush green landscapes, retro anime aesthetic, nostalgic, soft and warm lighting, cozy atmosphere",
    ),
    preset(
        "style",
        "pixar",
        "皮克斯3D卡通风格提示词",
        "Pixar style, 3D render, cute character design, vibrant and rich colors, smooth clay texture, expressive eyes, playful lighting, ray-traced reflections, digital art",
    ),
    preset(
        "style",
        "ue5_cg",
        "虚幻引擎5流光溢彩游戏CG提示词",
        "Unreal Engine 5 render, cinematic CG, dark fantasy style, epic lighting, glowing magic runes, hyper-detailed armor, dramatic atmosphere, octane render, 3D shading",
    ),
    preset(
        "style",
        "anime_hq",
        "动漫高质量提示词",
        "anime style, beautiful character design, expressive eyes, clean lineart, detailed hair, vibrant colors, soft shading, delicate highlights, dynamic composition, polished illustration",
    ),
    preset(
        "style",
        "anime_25d",
        "2.5D动漫质感提示词",
        "2.5D anime style, semi-realistic character, soft 3D rendering, anime facial features, realistic lighting, detailed skin shading, glossy eyes, cinematic composition, smooth textures, high quality render",
    ),
    preset(
        "style",
        "cyberpunk",
        "赛博朋克提示词",
        "cyberpunk city, neon lights, futuristic fashion, rainy street, glowing signs, high contrast lighting, reflective surfaces, holographic elements, cinematic night scene, vibrant neon color palette",
    ),
    preset(
        "style",
        "dark_fantasy",
        "暗黑奇幻提示词",
        "dark fantasy, mysterious atmosphere, gothic architecture, dramatic backlight, foggy environment, ancient ruins, magical aura, deep shadows, intricate armor, epic composition",
    ),
    preset(
        "style",
        "jp_healing",
        "日系治愈风提示词",
        "Japanese healing aesthetic, soft natural light, quiet atmosphere, gentle colors, nostalgic mood, peaceful scenery, delicate composition, warm emotional tone, subtle film grain, slice of life style",
    ),
    preset(
        "style",
        "dreamy",
        "梦幻唯美提示词",
        "dreamlike atmosphere, ethereal glow, soft focus, floating particles, sparkling light, pastel colors, gentle lighting, romantic mood, delicate details, magical realism",
    ),

    // ── 其他 ──────────────────────────────────────────────
    preset(
        "other",
        "portrait",
        "人像写真提示词",
        "professional portrait, close-up shot, natural expression, clear facial features, soft studio lighting, smooth skin texture, detailed eyes, elegant pose, clean background, shallow depth of field",
    ),
    preset(
        "other",
        "fashion",
        "时尚杂志提示词",
        "fashion editorial, luxury magazine cover style, elegant styling, high fashion outfit, confident pose, studio photography, glossy finish, dramatic shadows, refined makeup, premium visual design",
    ),
    preset(
        "other",
        "char_concept",
        "游戏角色立绘提示词",
        "character concept art, full body character design, front view, detailed outfit, clean silhouette, fantasy costume, polished rendering, intricate accessories, white background, professional game art",
    ),
    preset(
        "other",
        "char_turnaround",
        "角色设计三视图提示词",
        "character reference sheet, front view, side view, back view, full body, close-up face detail, consistent character design, clean white background, natural soft lighting, no text, professional concept art",
    ),
    preset(
        "other",
        "mv_cover",
        "音乐视频封面提示词",
        "music video cover art, attractive main character, cinematic lighting, strong visual focus, emotional atmosphere, clean composition, vibrant colors, professional album cover design, high detail, no extra text",
    ),
    preset(
        "other",
        "yt_thumb",
        "YouTube缩略图提示词",
        "YouTube thumbnail style, strong central subject, eye-catching composition, bold lighting, high contrast, clear focal point, vibrant colors, dramatic background, professional digital artwork",
    ),
    preset(
        "other",
        "concert",
        "演唱会舞台提示词",
        "concert stage design, large LED screen, dramatic stage lighting, spotlights, atmospheric haze, colorful light beams, professional live performance setup, wide angle view, cinematic concert photography",
    ),
    preset(
        "other",
        "product_poster",
        "产品海报提示词",
        "commercial product poster, premium branding style, clean background, soft studio lighting, elegant composition, sharp product details, glossy reflections, modern advertising design, high-end visual presentation",
    ),
    preset(
        "other",
        "negative",
        "负面提示词通用",
        "low quality, worst quality, blurry, pixelated, bad anatomy, bad hands, extra fingers, missing fingers, deformed, distorted face, ugly, text, watermark, logo, cropped, duplicate, low resolution",
    ),
];

export const PRESET_CATEGORIES = {
    style: { id: "style", label: "风格" },
    quality: { id: "quality", label: "质量" },
    other: { id: "other", label: "其他预设" },
};

export function getBuiltinPresets(category) {
    return BUILTIN_PRESETS.filter((p) => p.category === category);
}

/** Payload written into the node prompt on insert/replace. */
export function formatPresetWriteText(item) {
    const title = item.title
        || (item.name ? (String(item.name).startsWith("#") ? item.name : `#${item.name}`) : "");
    const body = ensureComma(item.text ?? "");
    if (title && body) return `${title}\n${body}`;
    return title || body;
}
