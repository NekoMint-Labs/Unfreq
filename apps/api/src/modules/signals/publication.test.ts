import { describe, expect, it } from "vitest";
import {
  toMatchSummary,
  toSavedSignalSummary,
  toSignalDetail,
} from "./service-mappers.js";
import type { SignalRecord } from "./types.js";
import {
  buildPublicationPreview,
  confirmPublicationSnapshot,
  digestPublicationContent,
  parsePublicationSnapshot,
  projectPublicGalaxy,
  projectPublicMatch,
  projectPublicSaved,
  projectPublicSignal,
  signalPublicContentSchema,
  signalPublicationPreviewSchema,
  signalPublicationSnapshotSchema,
  validatePublicationSnapshot,
  type PublicationProjectionState,
} from "./publication.js";

const createdAt = new Date("2026-10-29T00:00:00.000Z");

function signalFixture(): SignalRecord {
  return {
    publicationVersion: 0, publicationSnapshot: null, withdrawnAt: null, audioPublicationVersion: null,
    authorFreqCode: "FM 11.11",
    authorId: "00000000-0000-4000-8000-000000000001",
    audioError: "PRIVATE_AUDIO_ERROR",
    audioStatus: "READY",
    audioStorageKey: "PRIVATE_STORAGE",
    audioStorageKeyLeft: null,
    audioStorageKeyRight: null,
    audioUrl: "/unverified-old-audio",
    audioUrlLeft: null,
    audioUrlRight: null,
    createdAt,
    echoCount: 2,
    embedding: [0.1, 0.2],
    embeddingDimensions: 2,
    embeddingModel: "PRIVATE_MODEL",
    embeddingProvider: "PRIVATE_PROVIDER",
    embeddingVersion: "PRIVATE_EMBEDDING_VERSION",
    expandedText: "这是作者将在预览中确认的正文。",
    fingerprintJson: {
      coreNeed: "PRIVATE_NEED",
      displayText: "PRIVATE_DISPLAY",
      energy: 0.5,
      emotionTone: "PRIVATE_EMOTION",
      frequency: "PRIVATE_FINGERPRINT_FM",
      hiddenNeed: "PRIVATE_NEED",
      innerConflict: "PRIVATE_CONFLICT",
      narrativeConflict: "PRIVATE_CONFLICT",
      openness: 0.4,
      primaryBand: "relationship_nebula",
      primaryEmotion: "PRIVATE_EMOTION",
      resonanceKeywords: ["PRIVATE_KEYWORD"],
      riskLevel: "LOW",
      secondaryEmotions: ["PRIVATE_SECONDARY_EMOTION"],
      signalType: "PRIVATE_TYPE",
      subFeeling: "need_to_be_understood",
      tags: ["夜晚", "等待", "第四个不应公开的标签"],
      theme: "PRIVATE_THEME",
      title: "PRIVATE_TITLE",
    },
    followUpQuestion: "PRIVATE_FOLLOWUP",
    frequencyId: "PRIVATE_FREQUENCY_ID",
    galaxyPosition: { x: 0.1, y: 0.2, z: 0.3 },
    generationError: null,
    generationStatus: "COMPLETED",
    guestKey: "PRIVATE_GUEST",
    id: "00000000-0000-4000-8000-000000000002",
    coreNeed: "PRIVATE_NEED",
    emotionTone: "PRIVATE_EMOTION",
    innerConflict: "PRIVATE_CONFLICT",
    matchSignalId: "PRIVATE_MATCH_ID",
    parentSignalId: "PRIVATE_PARENT_ID",
    primaryBand: "relationship_nebula",
    programJson: {
      bridgeNarration: "PRIVATE_PROGRAM",
      closingQuestion: "PRIVATE_PROGRAM",
      hostIntro: "PRIVATE_PROGRAM",
      leftSignalSummary: "PRIVATE_PROGRAM",
      programTitle: "PRIVATE_PROGRAM",
      rightSignalSummary: "PRIVATE_COPIED_SUMMARY",
      shareQuote: "PRIVATE_PROGRAM",
    },
    qualityReason: "PRIVATE_QUALITY",
    qualityScore: 4,
    rawInput: "PRIVATE_SEED",
    resonanceCount: 3,
    resonanceKeywords: ["PRIVATE_KEYWORD"],
    seedText: "PRIVATE_SEED",
    source: "human",
    status: "PUBLISHED",
    subFeeling: "need_to_be_understood",
    isKept: true,
    updatedAt: createdAt,
  };
}

describe("legacy private mapper boundary characterization", () => {
  const cases = [
    ["detail Seed", "PRIVATE_SEED", () => toSignalDetail(signalFixture())],
    ["detail conflict", "PRIVATE_CONFLICT", () => toSignalDetail(signalFixture())],
    ["detail program", "PRIVATE_PROGRAM", () => toSignalDetail(signalFixture())],
    ["detail guest", "PRIVATE_GUEST", () => toSignalDetail(signalFixture())],
    ["saved Seed", "PRIVATE_SEED", () => toSavedSignalSummary({ ...signalFixture(), savedAt: createdAt })],
    ["saved conflict", "PRIVATE_CONFLICT", () => toSavedSignalSummary({ ...signalFixture(), savedAt: createdAt })],
    ["match Seed", "PRIVATE_SEED", () => toMatchSummary(signalFixture(), 80)],
    ["match conflict", "PRIVATE_CONFLICT", () => toMatchSummary(signalFixture(), 80)],
  ] as const;

  // First executed with a negative public-output assertion: all eight failed,
  // while the author control passed. These remain private mappers, not public
  // adapters. The new pure helpers below have not yet been wired into queries.
  it.each(cases)("still includes %s and must not become a public DTO", (_label, marker, project) => {
    expect(JSON.stringify(project())).toContain(marker);
  });

  it("keeps Seed in the legitimate private author detail", () => {
    expect(toSignalDetail(signalFixture())).toMatchObject({
      rawInput: "PRIVATE_SEED",
      seedText: "PRIVATE_SEED",
    });
  });
});

function validState(): PublicationProjectionState {
  return {
    status: "PUBLISHED",
    generationStatus: "COMPLETED",
    withdrawnAt: null,
    currentPublicationVersion: 1,
    expectedPublicationVersion: 1,
  };
}

function confirmedSnapshot() {
  return confirmPublicationSnapshot(buildPublicationPreview(signalFixture(), 0), createdAt);
}

function projections(options: { state?: PublicationProjectionState; snapshot?: unknown } = {}) {
  const signal = signalFixture();
  const base = {
    signal,
    snapshot: options.snapshot ?? confirmedSnapshot(),
    state: options.state ?? validState(),
  };
  return [
    projectPublicSignal(base),
    projectPublicMatch({ ...base, score: 80 }),
    projectPublicSaved({ ...base, signal: { ...signal, savedAt: createdAt } }),
    projectPublicGalaxy({
      ...base,
      position: { x: 0.1, y: 0.2, z: 0.3 },
      isMine: false,
      matchIds: [],
      visibleSignalIds: new Set<string>(),
    }),
  ];
}

describe("author publication candidate and confirmation", () => {
  it("selects the exact body, author FM and three visible existing labels", () => {
    const preview = buildPublicationPreview(signalFixture(), 0);
    expect(preview).toEqual({
      content: {
        expandedText: signalFixture().expandedText,
        authorFreqCode: "FM 11.11",
        tags: ["关系星云", "夜晚", "等待"],
        primaryBand: "relationship_nebula",
      },
      digest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      version: 0,
    });
    expect(JSON.stringify(preview)).not.toContain("PRIVATE_");
    expect(JSON.stringify(preview)).not.toContain("第四个");
  });

  it("does not infer a profile from private Seed or conflict", () => {
    const signal = signalFixture();
    const before = buildPublicationPreview(signal, 0);
    signal.seedText = "不同的 PRIVATE_SEED";
    signal.rawInput = "不同的 PRIVATE_SEED";
    signal.innerConflict = "不同的 PRIVATE_CONFLICT";
    signal.fingerprintJson.innerConflict = "不同的 PRIVATE_CONFLICT";
    signal.fingerprintJson.resonanceKeywords = ["不同的 PRIVATE_KEYWORD"];
    expect(buildPublicationPreview(signal, 0)).toEqual(before);
  });

  it("shows short existing labels without truncating a long label into a new claim", () => {
    const signal = signalFixture();
    signal.fingerprintJson.tags = ["这是一段超过十六个字符且不能被裁剪成另一种结论的标签", "  等待  "];
    const preview = buildPublicationPreview(signal, 0);
    expect(preview.content.tags).toEqual(["关系星云", "等待"]);
    expect(preview.content.expandedText).toBe(signal.expandedText);
  });

  it("uses a stable content digest independent of object property insertion order", () => {
    const content = buildPublicationPreview(signalFixture(), 0).content;
    expect(digestPublicationContent({
      primaryBand: content.primaryBand,
      tags: [...content.tags],
      authorFreqCode: content.authorFreqCode,
      expandedText: content.expandedText,
    })).toBe(digestPublicationContent(content));
    expect(digestPublicationContent({ ...content, expandedText: `${content.expandedText} ` }))
      .not.toBe(digestPublicationContent(content));
    expect(digestPublicationContent({ ...content, tags: [...content.tags].reverse() }))
      .not.toBe(digestPublicationContent(content));
  });

  it("records only explicit confirmation, without a snapshot epoch", () => {
    const preview = buildPublicationPreview(signalFixture(), 0);
    const snapshot = confirmPublicationSnapshot(preview, createdAt);
    expect(snapshot).toEqual({
      kind: "AUTHOR_CONFIRMED",
      confirmedAt: createdAt.toISOString(),
      content: preview.content,
      digest: preview.digest,
    });
    expect(snapshot).not.toHaveProperty("version");
    expect(parsePublicationSnapshot(signalFixture())).toBeUndefined();
  });

  it("copies confirmed content rather than retaining mutable preview references", () => {
    const preview = buildPublicationPreview(signalFixture(), 0);
    const snapshot = confirmPublicationSnapshot(preview, createdAt);
    preview.content.expandedText = "later body";
    preview.content.tags.push("later tag");
    expect(snapshot.content.expandedText).toBe(signalFixture().expandedText);
    expect(snapshot.content.tags).toEqual(["关系星云", "夜晚", "等待"]);
  });

  it.each([null, ""])("rejects a missing author identity %j", (authorId) => {
    expect(() => buildPublicationPreview({ ...signalFixture(), authorId }, 0)).toThrow();
  });

  it.each([null, "", "PRIVATE_FINGERPRINT_FM"])("never substitutes a private FM for %j", (authorFreqCode) => {
    expect(() => buildPublicationPreview({ ...signalFixture(), authorFreqCode }, 0)).toThrow();
  });

  it("requires completed generation and safe preview versions", () => {
    expect(() => buildPublicationPreview({ ...signalFixture(), generationStatus: "WRITING" }, 0)).toThrow();
    for (const version of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => buildPublicationPreview(signalFixture(), version)).toThrow();
    }
    expect(() => confirmPublicationSnapshot(buildPublicationPreview(signalFixture(), 0), new Date(NaN))).toThrow();
  });

  it("rejects a tampered preview instead of confirming replacement text", () => {
    const preview = buildPublicationPreview(signalFixture(), 0);
    preview.content.expandedText = "unseen replacement";
    expect(signalPublicationPreviewSchema.safeParse(preview).success).toBe(false);
    expect(() => confirmPublicationSnapshot(preview, createdAt)).toThrow();
  });
});

describe("strict confirmation parsing", () => {
  it("accepts a valid JSON round trip and validates its canonical digest", () => {
    const snapshot = confirmedSnapshot();
    expect(parsePublicationSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
    expect(validatePublicationSnapshot(snapshot)).toEqual(snapshot);
  });

  it.each([undefined, null, {}, [], "AUTHOR_CONFIRMED", { kind: "LEGACY_PUBLISHED" }])(
    "fails closed on unknown snapshot %j", (snapshot) => {
      expect(parsePublicationSnapshot(snapshot)).toBeUndefined();
    },
  );

  it.each([
    { kind: "SYSTEM_CONFIRMED" },
    { confirmedAt: "yesterday" },
    { digest: "0".repeat(64) },
    { version: 1 },
    { seedText: "PRIVATE_SEED" },
  ])("rejects unknown or tampered snapshot metadata %j", (extra) => {
    expect(parsePublicationSnapshot({ ...confirmedSnapshot(), ...extra })).toBeUndefined();
  });

  it.each(["expandedText", "authorFreqCode", "tags", "primaryBand"] as const)(
    "rejects a changed confirmed %s without a new digest", (field) => {
      const snapshot = confirmedSnapshot();
      const replacements = {
        expandedText: "replacement body",
        authorFreqCode: "FM 22.22",
        tags: ["关系星云", "不同标签"],
        primaryBand: undefined,
      };
      expect(parsePublicationSnapshot({
        ...snapshot,
        content: { ...snapshot.content, [field]: replacements[field] },
      })).toBeUndefined();
    },
  );

  it.each(["seedText", "rawInput", "program", "frequencyProfile", "guestKey", "frequencyId"])(
    "rejects an extra private content field %s", (field) => {
      const snapshot = confirmedSnapshot();
      const content = { ...snapshot.content, [field]: "PRIVATE_SENTINEL" };
      expect(signalPublicContentSchema.safeParse(content).success).toBe(false);
      expect(parsePublicationSnapshot({ ...snapshot, content })).toBeUndefined();
    },
  );

  it("enforces the three-label cap and binds optional band to a confirmed label", () => {
    const content = confirmedSnapshot().content;
    expect(signalPublicContentSchema.safeParse({ ...content, tags: [...content.tags, "第四项"] }).success).toBe(false);
    expect(signalPublicContentSchema.safeParse({ ...content, tags: ["夜晚"] }).success).toBe(false);
    expect(signalPublicContentSchema.safeParse({ ...content, tags: ["关系星云", "关系星云"] }).success).toBe(false);
    expect(signalPublicContentSchema.safeParse({ ...content, tags: [" 关系星云 "] }).success).toBe(false);
    expect(signalPublicContentSchema.safeParse({ expandedText: "正文", tags: [] }).success).toBe(true);
  });

  it("returns validation failure rather than throwing for invalid nested content", () => {
    expect(signalPublicationSnapshotSchema.safeParse({
      ...confirmedSnapshot(), content: { ...confirmedSnapshot().content, expandedText: "" },
    }).success).toBe(false);
  });
});

describe("public whitelist projections", () => {
  it("omits all private and copied fields across detail, match, save and Galaxy", () => {
    const outputs = projections();
    expect(outputs).toHaveLength(4);
    for (const output of outputs) {
      expect(output).toBeDefined();
      expect(JSON.stringify(output)).not.toContain("PRIVATE_");
      expect(output).toMatchObject({
        expandedText: signalFixture().expandedText,
        authorFreqCode: "FM 11.11",
        tags: ["关系星云", "夜晚", "等待"],
        primaryBand: "relationship_nebula",
        publicationVersion: 1,
      });
    }
    expect(Object.keys(outputs[0] ?? {}).sort()).toEqual([
      "authorFreqCode", "createdAt", "echoCount", "expandedText", "id", "matches",
      "primaryBand", "publicationVersion", "publishedAt", "resonanceCount", "source",
      "status", "tags", "updatedAt", "visibility",
    ].sort());
    expect(outputs[0]).not.toHaveProperty("audioUrl");
    expect(outputs[0]).not.toHaveProperty("parentSignalId");
    expect(outputs[0]).not.toHaveProperty("matchSignalId");
  });

  it("uses approved snapshot content even when the working body and analysis have changed", () => {
    const snapshot = confirmedSnapshot();
    const signal = signalFixture();
    signal.expandedText = "PRIVATE_LATE_REPLACEMENT";
    signal.authorFreqCode = "FM 22.22";
    signal.fingerprintJson.tags = ["PRIVATE_LATE_TAG"];
    const result = projectPublicSignal({ signal, snapshot, state: validState() });
    expect(result?.expandedText).toBe(snapshot.content.expandedText);
    expect(result?.authorFreqCode).toBe("FM 11.11");
    expect(result?.tags).toEqual(snapshot.content.tags);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_");
  });

  it("accepts retained confirmation after a later public epoch is independently rechecked", () => {
    const state = { ...validState(), currentPublicationVersion: 5, expectedPublicationVersion: 5 };
    expect(projections({ state }).every((result) => result?.publicationVersion === 5)).toBe(true);
  });

  it.each([
    { status: "DRAFT" as const },
    { status: "REVIEWING" as const },
    { status: "HIDDEN" as const },
    { status: "DELETED" as const },
    { generationStatus: "MATCHING" as const },
    { generationStatus: "FAILED" as const },
    { withdrawnAt: createdAt },
    { currentPublicationVersion: 2 },
    { currentPublicationVersion: 0, expectedPublicationVersion: 0 },
    { currentPublicationVersion: NaN, expectedPublicationVersion: NaN },
    { currentPublicationVersion: Number.MAX_SAFE_INTEGER + 1, expectedPublicationVersion: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects nonpublic or stale eligibility %j", (changes) => {
    expect(projections({ state: { ...validState(), ...changes } })).toEqual([
      undefined, undefined, undefined, undefined,
    ]);
  });

  it("requires every eligibility field rather than treating missing values as public", () => {
    for (const field of Object.keys(validState())) {
      const state: Partial<PublicationProjectionState> = { ...validState() };
      Reflect.deleteProperty(state, field);
      // Runtime input from a DB adapter can be malformed despite a TS annotation.
      const input = { signal: signalFixture(), snapshot: confirmedSnapshot(), state };
      expect(projectPublicSignal(input as Parameters<typeof projectPublicSignal>[0])).toBeUndefined();
    }
  });

  it("requires a valid snapshot and metadata, rather than copying legacy status/body", () => {
    expect(projectPublicSignal({ signal: signalFixture(), state: validState(), snapshot: undefined })).toBeUndefined();
    expect(projections({ snapshot: { ...confirmedSnapshot(), digest: "0".repeat(64) } })).toEqual([
      undefined, undefined, undefined, undefined,
    ]);
    expect(projectPublicSignal({ signal: { ...signalFixture(), createdAt: new Date(NaN) }, state: validState(), snapshot: confirmedSnapshot() })).toBeUndefined();
    expect(projectPublicSignal({ signal: { ...signalFixture(), resonanceCount: -1 }, state: validState(), snapshot: confirmedSnapshot() })).toBeUndefined();
  });

  it("accepts only strict public match values and never spreads legacy match summaries", () => {
    const signal = signalFixture();
    const base = { signal, snapshot: confirmedSnapshot(), state: validState() };
    const match = projectPublicMatch({ ...base, score: 80 });
    expect(match).toBeDefined();
    const detail = projectPublicSignal({ ...base, hasSaved: true, matches: match ? [match] : [] });
    expect(detail?.hasSaved).toBe(true);
    expect(detail?.matches).toEqual([match]);
    expect(JSON.stringify(detail)).not.toContain("PRIVATE_");
    const oldMatch = toMatchSummary(signal, 80);
    expect(projectPublicSignal({ ...base, matches: [oldMatch as unknown as NonNullable<typeof match>] })).toBeUndefined();
    expect(projectPublicSignal({ ...base, matches: [{ ...match, program: signal.programJson } as NonNullable<typeof match>] })).toBeUndefined();
  });

  it("enforces the E2 public scale and projects only safe score provenance", () => {
    const base = { signal: signalFixture(), snapshot: confirmedSnapshot(), state: validState() };
    const scoreProvenance = { version: "match-score-v1", scale: "zero_to_hundred", method: "cosine", reason: "reranker_failed" } as const;
    const match = projectPublicMatch({ ...base, score: 90, scoreProvenance });
    expect(match).toMatchObject({ score: 90, scoreProvenance });
    expect(projectPublicSignal({ ...base, matches: match ? [match] : [] })?.matches[0]?.scoreProvenance).toEqual(scoreProvenance);
    expect(JSON.stringify(match)).not.toContain("PRIVATE_");
    for (const score of [-1, 101, 250, NaN, Infinity]) expect(projectPublicMatch({ ...base, score })).toBeUndefined();
    expect(projectPublicMatch({ ...base, score: 90, scoreProvenance: { ...scoreProvenance, secret: "PRIVATE_MODEL" } as typeof scoreProvenance })?.scoreProvenance).toBeUndefined();
  });

  it("keeps Galaxy links only inside the caller's current visible set", () => {
    const signal = signalFixture();
    const visibleId = "00000000-0000-4000-8000-000000000003";
    const privateId = "00000000-0000-4000-8000-000000000004";
    const result = projectPublicGalaxy({
      signal, snapshot: confirmedSnapshot(), state: validState(),
      position: { x: 0, y: 0, z: 0 }, isMine: false,
      matchIds: [signal.id, visibleId, privateId, visibleId],
      visibleSignalIds: new Set([signal.id, visibleId]),
    });
    expect(result?.matchIds).toEqual([visibleId]);
    expect(projectPublicGalaxy({
      signal, snapshot: confirmedSnapshot(), state: validState(),
      position: { x: Infinity, y: 0, z: 0 }, isMine: false,
      matchIds: [], visibleSignalIds: new Set(),
    })).toBeUndefined();
  });

  it("returns independent arrays so response edits cannot mutate stored confirmation", () => {
    const snapshot = confirmedSnapshot();
    const result = projectPublicSignal({ signal: signalFixture(), snapshot, state: validState() });
    result?.tags.push("later tag");
    expect(snapshot.content.tags).toEqual(["关系星云", "夜晚", "等待"]);
    expect(parsePublicationSnapshot(snapshot)).toBeDefined();
  });
});
