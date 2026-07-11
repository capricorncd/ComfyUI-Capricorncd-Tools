/** Built-in prompt presets for Rich Prompt library. */

function ensureComma(text) {
    const t = String(text ?? "").trim();
    if (!t) return t;
    return t.endsWith(",") ? t : `${t},`;
}

function preset(category, id, name, text, subCategory = undefined) {
    const cleanName = String(name ?? "").trim().replace(/^#+/, "");
    const body = ensureComma(text);
    return {
        id: `builtin_${category}_${id}`,
        category,
        name: cleanName,
        text: body,
        builtin: true,
        ts: 0,
        subCategory: subCategory || undefined,
    };
}

/** @type {ReadonlyArray<{id:string,category:string,name:string,text:string,builtin:boolean,ts:number,subCategory?:string}>} */
export const BUILTIN_PRESETS = [
    // ── 古风女 ──────────────────────────────────────────────
    preset(
        "gu_feng_female",
        "layout_turnaround",
        "构图 · 三视图角色设定图",
        "3D国漫仙侠人物角色设定图，纯白明亮背景，高精度三视图展示，从左至右依次为：正面全身像、侧面全身像、背面全身像、面部特写。",
        "layout",
    ),
    preset(
        "gu_feng_female",
        "layout_single_sheet",
        "构图 · 单人三视图排版",
        "一幅3D国漫仙侠风格的单人角色设定图，纯净明亮背景，画面采用标准三视图排版，从左至右依次为正面全身、侧面全身、背面全身和面部特写。",
        "layout",
    ),
    preset(
        "gu_feng_female",
        "overall_pbr_render",
        "整体 · 3D国风PBR渲染质感",
        "3D国风动漫风格，次世代PBR材质肌肤，皮肤细腻有自然瑕疵，超详细质感。画面清新干净，高细节，高清渲染，柔和光影，写实国风质感。",
        "overall",
    ),
    preset(
        "gu_feng_female",
        "overall_dual_ring_outfit",
        "整体 · 双环髻劲装仙女",
        "秀发如瀑，梳着古典双环望月髻，余发半束半披，发丝飘逸，鬓边垂落一缕龙须刘海，发间点缀金步摇、珠花与玉簪。身着月白与靛蓝相间的交领右衽劲装，外罩透薄轻纱广袖，内衬修身抹胸，腰束金丝绣云纹腰带，悬垂环佩与流苏。",
        "overall",
    ),
    preset(
        "gu_feng_female",
        "overall_cute_immortal",
        "整体 · 灵动可爱仙侠少女",
        "一位气质灵动、身材苗条有致、性感中带着可爱的仙侠少女，整体辨识度极高。她拥有精致小巧的鹅蛋脸，白皙细腻的皮肤透出淡淡红晕。一双桃花眼水润含笑，眼角微挑，瞳孔呈琥珀金色，睫毛纤长。眉毛为远山黛，细长而柔美。鼻子小巧挺翘，嘴唇饱满如樱花瓣，呈淡粉色。",
        "overall",
    ),
    preset(
        "gu_feng_female",
        "overall_color_scheme",
        "整体 · 月白靛蓝鹅黄配色",
        "整体色彩以月白、靛蓝、鹅黄为主，衣摆与飘带绣有细致的莲花与云纹，既显干练又不失仙气，恰到好处勾勒出凹凸有致的身形，既有成熟的妩媚又不失少女的纯真。",
        "overall",
    ),
    preset(
        "gu_feng_female",
        "overall_silk_light",
        "整体 · 丝绸纱质柔和渲染",
        "材质渲染细腻，光照柔和通透，突出丝绸光泽与纱质轻盈感，整体风格唯美国漫仙侠。",
        "overall",
    ),
    preset(
        "gu_feng_female",
        "face_gentle_fairy",
        "脸型 · 温柔仙女鹅蛋脸",
        "一名气质温柔、身姿曼妙的东方仙女，鹅蛋脸，皮肤白皙如凝脂，柳眉如烟，眼眸似含秋水，琼鼻秀挺，朱唇轻点。",
        "face",
    ),
    preset(
        "gu_feng_female",
        "face_oval_phoenix",
        "脸型 · 鹅蛋脸丹凤眼五官",
        "脸型鹅蛋脸，皮肤白皙无瑕；眼睛狭长丹凤眼，鼻子挺直秀美，眉毛远山黛，嘴唇薄而蔻丹色。",
        "face",
    ),
    preset(
        "gu_feng_female",
        "face_refined_features",
        "脸型 · 远山黛丹凤眼朱唇",
        "五官精致：远山黛眉，上挑丹凤眼，高挺琼鼻，朱唇饱满。",
        "face",
    ),
    preset(
        "gu_feng_female",
        "hair_snake_bun",
        "发饰 · 灵蛇髻龙须刘海",
        "发型为灵蛇髻古典长发，发丝飘逸，发饰搭配发簪、步摇和流苏，刘海龙须刘海，鬓发垂落耳畔",
        "hair",
    ),
    preset(
        "gu_feng_female",
        "hair_classical_snake",
        "发饰 · 古典灵蛇髻发型",
        "发型为古典灵蛇髻，发丝如墨飘逸，头顶两侧盘绕成环，余发垂落腰间；鬓发垂落耳畔，额前留一缕龙须刘海，更添俏丽。",
        "hair",
    ),
    preset(
        "gu_feng_female",
        "hair_butterfly_step_shake",
        "发饰 · 白玉蝴蝶步摇",
        "发饰为镶金白玉蝴蝶步摇和粉蓝珠串流苏，再点缀几朵浅紫绒花。",
        "hair",
    ),
    preset(
        "gu_feng_female",
        "hair_half_bun_jade",
        "发饰 · 半束半披高髻玉簪",
        "发型为半束半披古风高髻，发丝飘逸灵动，鬓发垂落耳侧，留一缕龙须刘海，发饰为金镶玉发簪与嵌宝步摇，点缀流苏珠串。",
        "hair",
    ),
    preset(
        "gu_feng_female",
        "outfit_high_slit",
        "服装 · 高开叉裙装",
        "裙子为高开叉设计，行走间露出修长玉腿，隐约可见大腿线条，既显干练又不失性感。",
        "outfit",
    ),
    preset(
        "gu_feng_female",
        "outfit_silk_embroidery",
        "服装 · 丝绸纱质暗纹刺绣",
        "服饰细节呈现丝绸光泽与纱质轻盈，暗纹刺绣精美，尽显仙侠风骨。",
        "outfit",
    ),
    preset(
        "gu_feng_female",
        "outfit_wide_sleeve_gown",
        "服装 · 交领广袖仙裙全套",
        "服饰为交领右衽广袖仙裙，多层领口，丝绸光泽与纱质轻盈结合，腰间束带配玉佩流苏，裙摆高开叉露大腿，刺绣暗纹云纹与莲花，色彩以靛蓝和月白为主，内衬抹胸，鞋子绣花鞋。整体光线柔和明亮，高精度渲染，材质细腻，3D质感，氛围仙气。",
        "outfit",
    ),
    preset(
        "gu_feng_female",
        "outfit_immortal_battle",
        "服装 · 仙侠劲装纱衣全套",
        "身穿一套女性仙侠劲装，交领右衽，外罩广袖纱衣，丝绸光泽若隐若现，内衬为月白色缠枝莲暗纹抹胸，外披渐变靛蓝至鹅黄的轻纱长衫，衣袖宽大如水袖，多层领口露出内衬，腰间束一条银丝刺绣云纹腰带，系玉佩并红色流苏，下身为同色飘逸长裙，开衩处隐约可见紧身裤与绣花短靴。",
        "outfit",
    ),
    preset(
        "gu_feng_female",
        "outfit_wrist_guards",
        "服装 · 护腕束手飘带",
        "手腕戴护腕金属束手，腰后垂落两条飘带。",
        "outfit",
    ),
    preset(
        "gu_feng_female",
        "outfit_wide_slit_gown",
        "服装 · 广袖长裙高开衩玉带",
        "服饰为仙侠风的交领右衽广袖长裙，外罩丝绸开衩裙，高开衩展露修长双腿，腰间束玉带，垂下流苏环佩",
        "outfit",
    ),
    preset(
        "gu_feng_female",
        "outfit_silver_bracers",
        "服装 · 银护腕软缎绣鞋",
        "手腕戴银色雕花护腕，内衬轻盈纱质，衣料以月白与靛蓝渐变为主，绣有暗纹云纹与莲花纹样，脚穿软缎绣鞋。",
        "outfit",
    ),
    preset(
        "gu_feng_female",
        "body_slender_sexy",
        "身材 · 清冷苗条凹凸有致",
        "女主，气质清冷脱俗，身材苗条性感，凹凸有致，大腿外露。",
        "body",
    ),
    preset(
        "gu_feng_female",
        "body_tall_cold",
        "身材 · 高挑冷艳修长双腿",
        "角色为年轻女性，气质高贵冷艳，身材高挑苗条，凹凸有致，鹅蛋脸，肌肤白皙通透。",
        "body",
    ),

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
    gu_feng_female: { id: "gu_feng_female", label: "古风女" },
    gu_feng_male: { id: "gu_feng_male", label: "古风男" },
    style: { id: "style", label: "风格" },
    quality: { id: "quality", label: "质量" },
    other: { id: "other", label: "其他" },
};

export const PRESET_FILTER_ORDER = [
    "gu_feng_female",
    "gu_feng_male",
    "style",
    "quality",
    "other",
];

export const GU_FENG_FEMALE_SUB_FILTERS = [
    { id: "all", label: "全部" },
    { id: "layout", label: "构图" },
    { id: "overall", label: "整体" },
    { id: "face", label: "脸型" },
    { id: "hair", label: "发饰" },
    { id: "outfit", label: "服装" },
    { id: "body", label: "身材" },
];

export function getBuiltinPresets(category) {
    return BUILTIN_PRESETS.filter((p) => p.category === category);
}

/** Payload written into the node prompt on insert/replace. */
export function formatPresetWriteText(item) {
    const raw = String(item.title ?? item.name ?? "").trim().replace(/^#+/, "");
    const title = raw ? `#${raw}` : "";
    const body = ensureComma(item.text ?? "");
    if (title && body) return `${title}\n${body}`;
    return title || body;
}
