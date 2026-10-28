import {
  signalBandLabels,
  signalBandSubFeelings,
  signalSubFeelingLabels,
} from "../signals/frequency-taxonomy.js";

export type ChatGenerationOptions = {
  frequency_penalty?: number;
  presence_penalty?: number;
  temperature?: number;
  top_p?: number;
};

export const signalExpansionBlockedPhrases = [
  "我把这句话留在心里",
  "我把这句种子",
  "我没有急着把它说出口",
  "我突然发现自己已经很久",
  "不是X，而是Y",
  "杯子凉了",
  "手机暗下去",
  "房间只剩风声",
  "沉默挡风",
  "绕着同一个问题走",
  "你辛苦了",
  "被世界接住",
  "被看见",
  "接住",
  "和解",
  "答案",
  "松弛",
  "内耗",
  "破碎",
  "自洽",
  "温柔地",
  "慢慢学会",
  "原来人生",
];

const promptByType: Record<string, string> = {
  classify:
    "Return only JSON: {\"channel\":\"MIDNIGHT|UNSENT|STARMAP\",\"confidence\":0-1,\"reason\":\"short reason\"}.",
  "content-analysis":
    "Return only JSON: {\"summary\":\"short Chinese summary\",\"emotions\":[\"1 to 4 short Chinese emotions\"],\"intensity\":0-1,\"riskLevel\":\"LOW|MEDIUM|HIGH\",\"reason\":\"short reason\",\"keywords\":[\"1 to 6 short Chinese keywords\"]}. Do not diagnose mental illness.",
  "echo-suggestion":
    "Return only JSON: {\"suggestion\":\"a short empathetic echo suggestion in Chinese\"}.",
  "monthly-recap":
    "Return only JSON: {\"themeWords\":[\"1 to 3 short Chinese theme words\"],\"summary\":\"Chinese monthly recap under 100 chars\"}. Summarize anonymous thought signals. Do not diagnose, score personality, make medical or psychological claims, quote private text, or exaggerate.",
  moderate:
    "Return only JSON: {\"action\":\"ALLOW|REVIEW|HIDE\",\"riskLevel\":\"LOW|MEDIUM|HIGH\",\"reason\":\"short reason\"}. Never delete content.",
  "signal-fingerprint": `Return only JSON: {"title":"short Chinese title","theme":"Chinese primary band label","primaryEmotion":"Chinese sub-feeling label","secondaryEmotions":["0 to 4 short tones"],"narrativeConflict":"same as innerConflict","hiddenNeed":"same as coreNeed","energy":0-1,"openness":0-1,"frequency":"SIG-XXXXXX","signalType":"primary_band key","tags":["2 to 5 human-readable Chinese labels"],"primaryBand":"one fixed key","subFeeling":"one fixed key","emotionTone":"short Chinese tone","coreNeed":"short Chinese need","innerConflict":"short Chinese conflict","resonanceKeywords":["2 to 3 short Chinese semantic keywords"],"displayText":"Chinese primary band label · Chinese sub-feeling label","riskLevel":"LOW|MEDIUM|HIGH"}. Fixed options only: primaryBand=${Object.entries(signalBandLabels).map(([key, label]) => `${key}:${label}`).join(", ")}. subFeeling by primaryBand=${Object.entries(signalBandSubFeelings).map(([band, feelings]) => `${band}=>${feelings.map((feeling) => `${feeling}:${signalSubFeelingLabels[feeling]}`).join("|")}`).join("; ")}. Do not invent primaryBand or subFeeling. If no exact match, choose the closest option. tags are display labels for people; resonanceKeywords are semantic hints for matching. Do not diagnose mental illness.`,
  "signal-material": [
    `Return only JSON: {"classification":{"type":"poetry|food|sports|daily_wish|observation|memory|absurd|question|emotion|unknown","inputKind":"quote|classic_poem|original_thought|fragment|wish|question|joke|absurd|unknown","userAct":"quote_for_aftertaste|state_feeling|state_opinion|make_wish|invite|ask_question|joke|record_fragment","expansionMode":"aftertaste|clarify_thought|light_scene|continue_image|joke_extension|ask_detail","inventionLevel":"none|low|medium","preserve":["1 to 6 exact words, images, or meanings that must stay"],"allowedInventions":["0 to 6 allowed addition scopes"],"forbiddenInventions":["0 to 6 forbidden addition scopes"],"confidence":0-1,"mood":"short English or Chinese mood","energy":"low|medium|high","shouldBeNegative":true|false,"keywords":["1 to 8 short Chinese keywords"],"intendedFocus":"one Chinese sentence explaining the user's real act and direction","mustAvoid":["same meaning as forbiddenInventions"],"sceneHint":"flexible direction; may be non-scene for aftertaste or clarify_thought"},"fingerprint":{"title":"short Chinese title","theme":"Chinese primary band label","primaryEmotion":"Chinese sub-feeling label","secondaryEmotions":["0 to 4 short tones"],"narrativeConflict":"same as innerConflict","hiddenNeed":"same as coreNeed","energy":0-1,"openness":0-1,"frequency":"SIG-XXXXXX","signalType":"primary_band key","tags":["2 to 5 human-readable Chinese labels"],"primaryBand":"one fixed key","subFeeling":"one fixed key","emotionTone":"short Chinese tone","coreNeed":"short Chinese need","innerConflict":"short Chinese conflict","resonanceKeywords":["2 to 3 short Chinese semantic keywords"],"displayText":"Chinese primary band label · Chinese sub-feeling label","riskLevel":"LOW|MEDIUM|HIGH"},"expansion":{"expandedText":"80 to 180 Chinese characters","followUpQuestion":"one concise Chinese question only, under 20 Chinese characters and ending with ? or ？"}}.`,
    `Fixed fingerprint options only: primaryBand=${Object.entries(signalBandLabels).map(([key, label]) => `${key}:${label}`).join(", ")}. subFeeling by primaryBand=${Object.entries(signalBandSubFeelings).map(([band, feelings]) => `${band}=>${feelings.map((feeling) => `${feeling}:${signalSubFeelingLabels[feeling]}`).join("|")}`).join("; ")}. Do not invent primaryBand or subFeeling. If no exact match, choose the closest option.`,
    "Infer classification first, then create fingerprint metadata, then write expansion from seedText and classification only. Fingerprint is metadata; do not let frequency labels, risk labels, or emotional tags drag expansion into generic loneliness.",
    "The expansion rules match signal-expansion: preserve seed direction, respect inventionLevel, mustAvoid, forbiddenInventions, and shouldBeNegative. Do not repeat seedText verbatim or hard-join it as an opening label.",
    "For compact oral, praise, joke-like, typo-like, or ambiguous seeds, preserve the distinctive wording and oddness. Mark inventionLevel=low unless the seed clearly asks for a full scene. Do not normalize a strange phrase into a generic workplace, domestic, or literary story.",
    "Do not mention resonance, frequency, signal, radio, broadcast, FM, galaxy, star map, soul, strangers, being understood, being seen, healing, or the universe in expandedText.",
    "Also avoid the Chinese product words 信号, 频率, 频段, 电台, 广播, 发射, 共振, 共鸣, 回响, 同频, 星河, 星图, 宇宙, 陌生人, 被看见, 被理解, 治愈.",
    "For non-food seeds, do not introduce kitchen, cooking, meals, drinks, ingredients, or caretaking objects unless they are present in seedText. For emotion seeds, preserve the exact relationship, pressure, loss, relief, or inner contrast.",
    `Avoid in expandedText: ${signalExpansionBlockedPhrases.join(", ")}.`,
  ].join(" "),
  "signal-program":
    "Return only JSON: {\"programTitle\":\"short Chinese title\",\"hostIntro\":\"short host intro\",\"leftSignalSummary\":\"summary of user signal\",\"rightSignalSummary\":\"summary of matched signal if present\",\"bridgeNarration\":\"short bridge\",\"closingQuestion\":\"short question\",\"shareQuote\":\"short share quote\"}. Keep it playable as radio narration.",
  "signal-intent-analysis": [
    "Return only JSON: {\"type\":\"poetry|food|sports|daily_wish|observation|memory|absurd|question|emotion|unknown\",\"inputKind\":\"quote|classic_poem|original_thought|fragment|wish|question|joke|absurd|unknown\",\"userAct\":\"quote_for_aftertaste|state_feeling|state_opinion|make_wish|invite|ask_question|joke|record_fragment\",\"expansionMode\":\"aftertaste|clarify_thought|light_scene|continue_image|joke_extension|ask_detail\",\"inventionLevel\":\"none|low|medium\",\"preserve\":[\"1 to 6 exact words, images, or meanings that must stay\"],\"allowedInventions\":[\"0 to 6 allowed addition scopes\"],\"forbiddenInventions\":[\"0 to 6 forbidden addition scopes\"],\"confidence\":0-1,\"mood\":\"short English or Chinese mood\",\"energy\":\"low|medium|high\",\"shouldBeNegative\":true|false,\"keywords\":[\"1 to 8 short Chinese keywords\"],\"intendedFocus\":\"one Chinese sentence explaining the user's real act and direction\",\"mustAvoid\":[\"same meaning as forbiddenInventions\"],\"sceneHint\":\"flexible direction; may be non-scene for aftertaste or clarify_thought\"}.",
    "Infer what the user is doing, not only what topic the seed contains. The intent fields are primary; type is only a compatibility hint.",
    "Classify what direction the seed should be expanded into. Do not write the expansion.",
    "Use aftertaste for quotes and classic poems that mainly ask to preserve residue. Use clarify_thought for opinions or feelings that do not need a full scene. Use light_scene only when a small concrete moment helps. Use continue_image for image-like fragments. Use joke_extension for jokes or absurd play.",
    "Set inventionLevel=none for direct quotes or classic lines that should not gain people, places, modern objects, or plot. Use low for compact opinions, feelings, or fragments. Use medium only when the user asks for a scene, wish, invitation, joke, food, sports, or concrete daily action.",
    "When inventionLevel is none or low, forbiddenInventions must list invented characters, named places, modern objects, full plot, diagnosis, life lesson, and any seed-specific forbidden material.",
    "For compact oral, praise, joke-like, typo-like, or ambiguous seeds, classify the user's act without correcting away the odd wording. Put the odd phrase or uncertain phrase in preserve, set inventionLevel=low, and forbid full external scenes unless the seed itself contains one.",
    "Set shouldBeNegative=false for food, sports, neutral scenery, wishes, playful or factual seeds unless the seed is explicitly sad, painful, angry, hopeless, or grieving.",
    "Examples: 空山新雨后，天气晚来秋 => inputKind=classic_poem, userAct=quote_for_aftertaste, expansionMode=aftertaste, inventionLevel=none, preserve=空山/新雨/晚秋, forbiddenInventions=人物/现代物件/完整剧情/解释诗句. 爱与不爱还是很明显的 => inputKind=original_thought, userAct=state_opinion, expansionMode=clarify_thought, inventionLevel=low, forbiddenInventions=厨房/做饭/饮食照料/剧情化人物. 蓝色回形针在抽屉里睡觉 => inputKind=absurd, userAct=record_fragment, expansionMode=continue_image, inventionLevel=low, preserve=蓝色回形针/抽屉/睡觉, forbiddenInventions=人生哲理/关系解释.",
  ].join(" "),
  "signal-seed-classification": [
    "Return the same JSON shape as signal-intent-analysis.",
    "Infer the user's real act and expansion direction. Prefer intent fields over rough topic type.",
  ].join(" "),
  "signal-expansion": [
    "Return only JSON: {\"expandedText\":\"80 to 180 Chinese characters\",\"followUpQuestion\":\"one concise Chinese question only, under 20 Chinese characters\"}.",
    "Use only seedText and classification. The main source of direction is classification.inputKind, userAct, expansionMode, inventionLevel, intendedFocus, preserve, allowedInventions, forbiddenInventions, and sceneHint. Type is secondary. Ignore product worlds, frequency labels, fingerprints, risk labels, and community concepts if they appear in the seed.",
    "Do not write a signal, confession, radio script, therapy note, inner monologue, life lesson, or resonance copy. Do not force every seed into a concrete scene.",
    "For classification.expansionMode=aftertaste, keep residue and image. Do not explain the original line, summarize psychology, add a modern narrator, or complete a plot.",
    "For classification.expansionMode=clarify_thought, clarify the user's opinion or feeling in restrained prose. A full scene is optional and should not invent people, kitchens, caretaking, or plot unless present in seedText.",
    "For classification.inventionLevel=none, do not add characters, named places, modern objects, dialogue, full plot, or life lessons. Keep the expansion conservative, close to preserve items, and near the lower bound of 80 Chinese characters.",
    "For classification.inventionLevel=low, use only small texture, spatial relation, rhythm, or one light image. Do not add new people, named places, modern objects, or full plot unless allowedInventions explicitly allows it. Prefer concise output near 80 to 110 Chinese characters.",
    "For classification.inventionLevel=medium, one small concrete moment is allowed, but it still must obey forbiddenInventions.",
    "For compact oral, praise, joke-like, typo-like, or ambiguous seeds, keep the odd wording visible and let the expansion explain its tone. Do not turn it into a normal office, school, kitchen, relationship, or literary scene unless those details are already in seedText.",
    "Use classification only for direction: poetry/aftertaste writes mountain, water, wind, light, season, air, and sound without explanation; food writes color, smell, texture, cooking, table, kitchen, and eating; sports writes people, ball, field, body movement, rhythm, noise, and crowd energy; daily_wish writes concrete daily objects and small actions; observation or clarify_thought may stay conceptual but precise; memory writes one recalled object, place, and time trace; question writes the moment before or after asking; emotion writes the exact relationship, pressure, loss, relief, or inner contrast from the seed without generic domestic care; unknown preserves the seed's concrete words; absurd keeps imagination and fun.",
    "seedText is already displayed separately. Do not repeat seedText verbatim unless the user explicitly asks for polishing or continuation. Preserve classification.preserve and the seed's concrete words through new prose instead of copying the full seed.",
    "Never concatenate seedText directly with generated prose. Avoid openings like seedText + 展开后, seedText + 像, seedText + 是, or any sentence that treats the seed as a label before the real text starts.",
    "For quote or classic-poem-like input, write the scene, aftertaste, or one concrete continuation of the image. Do not explain the quote and do not attach prose directly after the quoted line.",
    "Never invent anything listed in classification.mustAvoid or classification.forbiddenInventions. If forbidden rules conflict with a generic scene habit, obey the forbidden rules.",
    "If classification.shouldBeNegative is false, never add loneliness, regret, exhaustion, silence, grief, or life suffering.",
    "If expansionMode is aftertaste or clarify_thought, do not require two objects or visible action; require accurate residue, preserved meaning, and no over-invention instead. Other modes should include concrete objects, one visible action, and sensory detail such as sound, smell, taste, touch, light, color, or spatial relation.",
    "Do not mention resonance, frequency, signal, radio, broadcast, FM, galaxy, star map, soul, strangers, being understood, being seen, healing, or the universe in expandedText.",
    "Also avoid the Chinese product words 信号, 频率, 频段, 电台, 广播, 发射, 共振, 共鸣, 回响, 同频, 星河, 星图, 宇宙, 陌生人, 被看见, 被理解, 治愈.",
    "For non-food seeds, do not introduce kitchen, cooking, meals, drinks, ingredients, or caretaking objects unless they are present in seedText.",
    "For emotion seeds, do not replace the original emotional contrast with generic care scenes such as warm water, kitchen, soup, ginger sugar, red dates, or someone silently serving food or drink.",
    "Do not force a sharp quote. Poetry should have aftertaste, food should have smell and texture, sports should have rhythm and movement, observation may be sharp, emotion should stay close to the seed's exact relational or inner tension, absurd should be interesting.",
    "Follow-up question must be light, short, specific, and ask for a scene, person, time, object, or detail. Do not use therapy tone.",
    "If rewriteInstruction is present in the input JSON, obey it and fix those issues.",
    "Bad output: template opening, direct psychological explanation, life-summary ending, quote-like slogan, therapy tone, motivational tone, radio narration, decorative scenery unrelated to the seed.",
    `Avoid: ${signalExpansionBlockedPhrases.join(", ")}.`,
    "Before returning, silently check: seed preserved, intendedFocus preserved, preserve items kept, mustAvoid and forbiddenInventions respected, inventionLevel respected, expansionMode respected, no overbuilt scene, no blocked phrase, no forced sadness, no radio copy, no chicken soup. If any check fails, rewrite once.",
  ].join(" "),
  "signal-expansion-review": [
    "Return only JSON: {\"pass\":true|false,\"hasConcreteObjects\":true|false,\"hasSensoryDetails\":true|false,\"matchesSeedType\":true|false,\"preservesOriginalDirection\":true|false,\"isGenericLiteraryTemplate\":true|false,\"isForcedNegative\":true|false,\"problems\":[\"short problem\"],\"rewriteInstruction\":\"short Chinese rewrite instruction if failed, empty if passed\",\"score\":0-10}.",
    "Review whether expandedText matches the seed and classification.",
    "Pass only if it preserves the original direction, matches the intent-analysis, respects inventionLevel, respects forbiddenInventions, and avoids overbuilt scene habits.",
    "For compact oral, praise, joke-like, typo-like, or ambiguous seeds, fail if the expansion drops the distinctive wording or replaces it with a normal complete external scene.",
    "For expansionMode=aftertaste, do not require object count or visible action. Fail if it explains the quote, writes a psychological summary, or invents people, modern objects, places, or full plot when inventionLevel=none.",
    "For expansionMode=clarify_thought, do not require a full scene. Fail if it replaces the thought with kitchen, caretaking, decorative scenery, or a complete story.",
    "Fail if it forces sadness, loneliness, exhaustion, regret, life philosophy, therapy tone, or chicken soup when classification.shouldBeNegative=false.",
    "Fail if it reads like generic literary/radio template copy instead of a specific scene.",
    "Fail if it mentions resonance, frequency, signal, radio, broadcast, FM, galaxy, star map, soul, strangers, being understood, being seen, healing, or the universe.",
    "Fail if it mentions Chinese product words such as 信号, 频率, 频段, 电台, 广播, 发射, 共振, 共鸣, 回响, 同频, 星河, 星图, 宇宙, 陌生人, 被看见, 被理解, 治愈.",
    `Fail if it uses blocked template phrases or close variants: ${signalExpansionBlockedPhrases.join(", ")}.`,
    "Fail if it does not include concrete scene, object, action, sound, smell, taste, or visual detail.",
    "Do not apply the previous sentence to aftertaste or clarify_thought mode; those modes may pass with accurate image residue or clarified thought.",
    "Fail if a non-food seed introduces kitchen, cooking, meals, drinks, ingredients, or caretaking objects that are not in seedText.",
    "Fail if an emotion seed replaces the original emotional contrast with generic care scenes such as warm water, kitchen, soup, ginger sugar, red dates, or someone silently serving food or drink.",
    "Fail if food lacks sensory detail, sports lacks movement/crowd/rhythm, poetry lacks landscape/season/air/light/sound, emotion loses the original relationship, pressure, loss, relief, or inner contrast, or absurd loses fun.",
  ].join(" "),
  "signal-content":
    "Return only JSON: {\"rawInput\":\"30 to 100 Chinese characters\"}. Write one first-person unsent thought for the given persona. It must happen in one specific moment, with one concrete object or action from the persona's life. Let emotion hide inside the action; do not directly explain the psychology. The line should be natural, smooth, restrained, slightly poetic, and distinctive enough to feel written by a real person. Avoid advice, diagnosis, slogans, names, contacts, abstract self-help language, motivational tone, generic loneliness, and obvious AI style. Do not use the pattern \"不是X，而是Y\". Avoid these words unless unavoidable: 被看见, 接住, 和解, 答案, 松弛, 内耗, 宇宙, 灵魂, 光.",
  "signal-quality":
    "Return only JSON: {\"score\":1-5 integer,\"reason\":\"short Chinese reason\"}. Score anonymous unsent signal quality. 5 means fluent, concrete, emotionally true, restrained, safe, and distinctive. 4 means usable but less memorable. 3 means barely usable. Score 1-2 if it is awkward, generic, slogan-like, too abstract, too explanatory, promotional, diagnostic, unsafe, advice-like, or repeats AI cliches such as 被看见, 接住, 和解, 答案, 松弛, 内耗. Penalize the pattern \"不是X，而是Y\". Prefer a real scene, object, or gesture over direct emotion labels.",
  tags: "Return only JSON: {\"tags\":[\"1 to 5 short Chinese mood tags\"]}.",
};

const generationOptionsByType: Record<string, ChatGenerationOptions> = {
  "signal-content": {
    frequency_penalty: 0.25,
    presence_penalty: 0.35,
    temperature: 0.9,
    top_p: 0.92,
  },
  "signal-intent-analysis": {
    frequency_penalty: 0,
    presence_penalty: 0,
    temperature: 0.2,
    top_p: 0.85,
  },
  "signal-expansion": {
    frequency_penalty: 0.2,
    presence_penalty: 0.25,
    temperature: 0.82,
    top_p: 0.9,
  },
  "signal-material": {
    frequency_penalty: 0.2,
    presence_penalty: 0.25,
    temperature: 0.72,
    top_p: 0.9,
  },
};

export function getChatProviderPrompt(type: string): string {
  return promptByType[type] ?? "Return only valid JSON.";
}

export function getChatGenerationOptions(type: string): ChatGenerationOptions {
  return generationOptionsByType[type] ?? {};
}
