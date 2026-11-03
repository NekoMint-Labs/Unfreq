import { createHash } from "node:crypto";

// Deliberately stale/private interpretation text exercises the Web's defensive
// display policy. These synthetic payloads are not real Fastify projections or
// evidence about Provider quality, PostgreSQL authorization, or human labels.
export const e4InterpretationCases = [
  { mode: "rules", id: "e4000000-0000-4000-8000-000000000001", seed: "今天吃到喜欢的冰淇淋。", interpretation: { version: 1, state: "unknown", source: "rules" } },
  { mode: "unknown", id: "e4000000-0000-4000-8000-000000000002", seed: "考试通过了，我很开心。", interpretation: { version: 1, state: "unknown", source: "unknown" } },
  { mode: "provider", id: "e4000000-0000-4000-8000-000000000003", seed: "月亮今天请假，太阳来加班。", interpretation: { version: 1, state: "unverified", source: "provider" } },
  { mode: "legacy", id: "e4000000-0000-4000-8000-000000000004", seed: "最近考试让我有点焦虑。" },
];
export const e4InvalidInterpretationCases = [
  { mode: "provider-unknown", id: "e4000000-0000-4000-8000-000000000005", interpretation: { version: 1, state: "unknown", source: "provider" } },
  { mode: "rules-unverified", id: "e4000000-0000-4000-8000-000000000006", interpretation: { version: 1, state: "unverified", source: "rules" } },
];
export const e4PsychologicalMarkers = ["E4_PSYCHOLOGICAL_TITLE_孤独的夜", "E4_UNSUPPORTED_NEED_希望被理解", "E4_UNSUPPORTED_CONFLICT_自我怀疑", "E4_UNSUPPORTED_TONE_压抑", "E4_UNSUPPORTED_TAG_被看见"];
export const e4OldConfirmedId = "e4000000-0000-4000-8000-000000000007";
export const e4OldConfirmedBody = "E4_OLD_CONFIRMED_BODY：这段正文和旧标签已经由合成作者确认，隐藏私密解读不能改变它。";
export const e4OldConfirmedTag = "E4作者确认旧标签";
export const e4RecapSummary = "E4_SAVED_RECAP_BODY：这份已保存的回顾保留原有正文，自动整理提示不会代替或改写内容。";

export function e4ExpressionBody(mode) {
  return `E4_BODY_START_${mode}。${"这是一段完整的合成表达，保留日常片段、原有语气和明确的收尾。".repeat(5)}E4_BODY_END_${mode}。`;
}

export function makeE4InterpretationSignals(makeSignal) {
  return [...e4InterpretationCases, ...e4InvalidInterpretationCases].map((item) => {
    const value = makeSignal(item.id, item.seed ?? "E4_INVALID_PAIR_SEED：来源与状态需要一致。", e4ExpressionBody(item.mode), { status: "DRAFT", source: "human", publicationVersion: 0, runtimeE4Interpretation: true });
    // Separate objects: never mutate makeSignal's shared historical profile.
    const frequencyProfile = { ...value.frequencyProfile, coreNeed: e4PsychologicalMarkers[1],
      innerConflict: e4PsychologicalMarkers[2], emotionTone: e4PsychologicalMarkers[3],
      ...(item.interpretation === undefined ? {} : { interpretation: { ...item.interpretation } }) };
    value.frequencyProfile = frequencyProfile;
    value.fingerprint = { ...value.fingerprint, ...frequencyProfile, title: e4PsychologicalMarkers[0],
      hiddenNeed: e4PsychologicalMarkers[1], narrativeConflict: e4PsychologicalMarkers[2],
      energy: .82, openness: .63, tags: [e4PsychologicalMarkers[4]] };
    return value;
  });
}

export function makeE4OldConfirmedSignal(makeSignal) {
  const value = makeE4InterpretationSignals(makeSignal).find((item) => item.id === e4InterpretationCases[3].id);
  return { ...value, id: e4OldConfirmedId, status: "PUBLISHED", expandedText: e4OldConfirmedBody,
    seedText: "E4_OLD_PRIVATE_SEED", rawInput: "E4_OLD_PRIVATE_SEED", publicationVersion: 7,
    runtimeE4ConfirmedContent: { expandedText: e4OldConfirmedBody, authorFreqCode: value.authorFreqCode,
      tags: ["意义深空", e4OldConfirmedTag], primaryBand: "meaning_deep_space" } };
}

export function e4NewPublicationPreview(signal) {
  const content = { expandedText: signal.expandedText, authorFreqCode: signal.authorFreqCode, tags: [] };
  return { content, digest: createHash("sha256").update(JSON.stringify(content)).digest("hex"), version: signal.publicationVersion ?? 0 };
}

export function makeE4Recap(owner, now, topSignal) {
  return { id: "e4000000-0000-4000-8000-000000000008", frequencyId: owner.id,
    createdAt: now, updatedAt: now, generatedAt: now, yearMonth: "2026-10",
    signalCount: e4InterpretationCases.length, totalResonanceCount: 0, summary: e4RecapSummary,
    themeWords: ["E4已保存主题"], topSignal };
}
