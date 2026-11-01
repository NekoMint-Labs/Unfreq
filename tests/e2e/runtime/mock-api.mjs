import { preview as historicalPreview, publicView as historicalPublicView, ownerView as historicalOwnerView, galaxyPoint as historicalGalaxyPoint } from "../publication-fixture.mjs";
import { e4InterpretationCases, e4OldConfirmedId, e4NewPublicationPreview, makeE4InterpretationSignals, makeE4OldConfirmedSignal, makeE4Recap } from "./interpretation-fixture.mjs";
import { createServer } from "node:http";
import { createHash } from "node:crypto";

// This server binds only to loopback and uses synthetic, process-local data.
// It checks the Web/Next boundary; it does not exercise Fastify or a database.
const port = Number(process.env.RUNTIME_API_PORT ?? 4200);
const webOrigin = process.env.RUNTIME_WEB_ORIGIN ?? "http://127.0.0.1:3200";
const now = "2026-10-28T00:00:00.000Z";
const sessionCookie = "unfreq_session";
const owner = {
  id: "runtime-owner", code: "FM 78.23", freqCode: "FM 78.23",
  createdAt: now, isGuest: false, role: "USER", status: "ACTIVE",
};
const other = { ...owner, id: "runtime-other", code: "FM 21.04", freqCode: "FM 21.04" };
const admin = { ...owner, id: "runtime-admin", code: "FM 99.99", freqCode: "FM 99.99", role: "ADMIN" };
let e4LegacyEvaluation = false;
function e4Evaluation() {
  // These values only exercise Web rendering. Real rule outputs are tested by API tests.
  const fixtureOutputs = [
    ...Array.from({ length: 4 }, (_, index) => ({ id: `e4-classification-${index}`, task: "classification", expected: ["STARMAP"], actual: ["STARMAP"], hit: true })),
    ...Array.from({ length: 4 }, (_, index) => ({ id: `e4-tags-${index}`, task: "tags", expected: ["synthetic"], actual: ["synthetic"], hit: true })),
    { id: "e4-moderation-0", task: "moderation", expected: ["HIGH"], actual: ["HIGH"], hit: true },
    ...Array.from({ length: 2 }, (_, index) => ({ id: `e4-matching-${index}`, task: "matching", expected: ["synthetic-candidate"], actual: ["synthetic-candidate"], hit: true })),
  ];
  const sampleSize = { classification: 4, tags: 4, moderation: 1, matching: 2 };
  if (e4LegacyEvaluation) return { generatedAt: now, sampleSize, ablations: [{ label: "去除语义信号", matchTopKRelevance: 50 }],
    groups: [{ method: "FINAL", label: "最终方案", metrics: [{ key: "matchTopKRelevance", label: "旧版 AI 相关性", value: 99.9, unit: "percent", description: "Legacy synthetic fixture" }] }] };
  return { generatedAt: now, sampleSize, ablations: [], ablationStatus: "NOT_RUN", evaluationKind: "DEMO_RULE_FIXTURES",
    modelQualityValidated: false, competitionEvidenceEligible: false,
    dataset: { version: "e4-browser-synthetic-v1", sha256: createHash("sha256").update(JSON.stringify(fixtureOutputs)).digest("hex"), judgmentSource: "synthetic-presets-not-human" },
    limitations: ["此处匹配为旧版演示规则，不是 E3 的生产召回与重排。"], fixtureOutputs,
    groups: [{ method: "RULE_BASELINE", label: "Demo / 本地规则夹具", metrics: [
      { key: "classificationAccuracy", label: "分类预设命中", numerator: 4, denominator: 4, value: 100, unit: "percent", method: "固定合成频道逐项比较", description: "只检查夹具预设。" },
      { key: "tagTopKHitRate", label: "标签预设命中", numerator: 4, denominator: 4, value: 100, unit: "percent", method: "每条至少命中一个预设标签", description: "只检查夹具预设。" },
      { key: "moderationRecall", label: "风险预设召回", numerator: 1, denominator: 1, value: 100, unit: "percent", method: "仅在风险预设样本中计数", description: "只检查夹具预设。" },
      { key: "matchTop1PresetHitRate", label: "演示匹配 Top-1 预设命中", numerator: 2, denominator: 2, value: 100, unit: "percent", method: "旧演示规则首位 ID 与预设比较", description: "不是人工相关性。" },
    ] }] };
}
const profile = {
  coreNeed: "A quiet moment", displayText: "意义深空 · 努力怀疑",
  emotionTone: "Reflective", innerConflict: "Finding time to pause",
  primaryBand: "meaning_deep_space", resonanceKeywords: ["pause"], subFeeling: "effort_doubt",
};

function makeSignal(id, seedText, expandedText, overrides = {}) {
  return {
    id, createdAt: now, updatedAt: now, seedText, rawInput: seedText, expandedText,
    audioStatus: "NOT_REQUESTED", authorFreqCode: owner.freqCode, frequencyId: owner.id,
    echoCount: 0, frequencyProfile: profile, galaxyPosition: { x: 0.1, y: -0.2, z: 0.3 },
    hasSaved: false, isKept: false, matches: [], resonanceCount: 0,
    source: "seed", status: "PUBLISHED",
    fingerprint: {
      ...profile, energy: 0.4, frequency: owner.freqCode, hiddenNeed: "A quiet moment",
      narrativeConflict: "A pause between tasks", openness: 0.6, primaryEmotion: "Reflective",
      riskLevel: "LOW", secondaryEmotions: [], signalType: "self-reflection",
      tags: ["pause"], theme: "意义深空", title: "A quiet moment",
    },
    program: {
      bridgeNarration: "Another signal", closingQuestion: "Where would you pause?",
      hostIntro: "Synthetic runtime fixture", leftSignalSummary: "A quiet moment",
      programTitle: "Runtime fixture", shareQuote: "A moment to pause.",
    },
    ...overrides,
  };
}

const privateSignal = makeSignal(
  "runtime-private-001", "PRIVATE-SEED-runtime-7a38",
  "PRIVATE-EXPANSION-runtime-9b52. A moment that only its author may read before publishing.",
  { status: "DRAFT" },
);
const publicSignal = makeSignal(
  "runtime-public-001", "A synthetic public thought for runtime verification.",
  "PUBLIC-RUNTIME-SIGNAL. A quiet moment between two ordinary tasks.",
);
const relationshipSignal = makeSignal(
  "runtime-relationship-001", "A synthetic thought about being understood.",
  "PUBLIC-RELATIONSHIP-SIGNAL. A small greeting from another frequency.",
  {
    authorFreqCode: other.freqCode, frequencyId: other.id,
    galaxyPosition: { x: -0.35, y: 0.15, z: -0.1 },
    frequencyProfile: { ...profile, primaryBand: "relationship_nebula", subFeeling: "loneliness" },
  },
);
const signals = new Map([privateSignal, publicSignal, relationshipSignal].map((signal) => [signal.id, signal]));
const publicOriginalText = publicSignal.expandedText;
const savedSignals = new Set();
const resonatedSignals = new Set();
const d4Id = "d4000000-0000-4000-8000-000000000001";
const d4Parent = "d4000000-0000-4000-8000-000000000002";
const d4Signal = makeSignal(d4Id, "D4_SYNTHETIC_PENDING_SEED", "D4_SYNTHETIC_COMPLETE", { status: "DRAFT" });
let d4Complete = false;
let d4History = false;
let e4InterpretationFixture = false;
let e4Recap;

// Keep historical C1 fixtures unchanged. Only the dedicated E4 payloads model
// new empty-label previews and immutable, previously confirmed public content.
function preview(signal) {
  return signal.runtimeE4Interpretation ? e4NewPublicationPreview(signal) : historicalPreview(signal);
}
function publicView(signal) {
  const view = historicalPublicView(signal);
  if (!signal.runtimeE4Interpretation) return view;
  const { primaryBand: _oldBand, tags: _oldTags, expandedText: _oldBody, authorFreqCode: _oldFrequency, ...metadata } = view;
  const content = signal.runtimeE4ConfirmedContent ?? e4NewPublicationPreview(signal).content;
  return { ...metadata, ...content, tags: [...content.tags] };
}
function ownerView(signal) {
  const view = historicalOwnerView(signal);
  if (!signal.runtimeE4Interpretation) return view;
  const { runtimeE4Interpretation: _fixture, runtimeE4ConfirmedContent: _stored, ...owner } = view;
  return { ...owner, publication: { ...view.publication, preview: preview(signal),
    ...(view.publication.state === "PUBLIC" ? { publishedContent: { ...signal.runtimeE4ConfirmedContent, tags: [...signal.runtimeE4ConfirmedContent.tags] } } : {}) } };
}
function galaxyPoint(signal, isMine, matchIds = []) {
  const point = historicalGalaxyPoint(signal, isMine, matchIds);
  if (!signal.runtimeE4Interpretation) return point;
  const { primaryBand: _oldBand, tags: _oldTags, ...metadata } = point;
  const content = publicView(signal);
  return { ...metadata, expandedText: content.expandedText, authorFreqCode: content.authorFreqCode, tags: content.tags,
    ...(content.primaryBand === undefined ? {} : { primaryBand: content.primaryBand }) };
}
function d4Generation() { return { id: d4Id, createdAt: now, updatedAt: now, seedText: d4Signal.seedText, parentSignalId: d4Signal.parentSignalId,
  status: "DRAFT", visibility: "GENERATION_OWNER", generationStatus: "EXPANDING" }; }

function identity(request) {
  const value = (request.headers.cookie ?? "").split(";")
    .map((entry) => entry.trim()).find((entry) => entry.startsWith(`${sessionCookie}=`))?.split("=")[1];
  return value === "owner" ? owner : value === "other" ? other : value === "admin" ? admin : undefined;
}

function send(response, status, data, headers = {}) {
  response.writeHead(status, {
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "content-type,cookie",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-origin": webOrigin,
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(data));
}

function ok(response, data, headers) {
  send(response, 200, { data, meta: { requestId: "synthetic-runtime" } }, headers);
}

function fail(response, status, code) {
  send(response, status, { error: { code, message: code }, meta: { requestId: "synthetic-runtime" } });
}

async function readBody(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 16_384) throw new Error("Synthetic request too large");
  }
  return raw.length === 0 ? {} : JSON.parse(raw);
}

function summary(signal) {
  const { id, createdAt, expandedText, frequencyProfile, resonanceCount, seedText, status } = signal;
  return { id, createdAt, expandedText, frequencyProfile, resonanceCount, seedText, status };
}

let revokeAfterPublicReads;
const reportReceipts = new Map();
let reportSequence = 0;

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  const current = identity(request);
  if (request.method === "OPTIONS") return send(response, 204, undefined);
  if (request.method === "GET" && url.pathname === "/health") return ok(response, { synthetic: true });
  if (request.method === "POST" && url.pathname === "/__runtime/reset") {
    privateSignal.status = "DRAFT"; privateSignal.publicationVersion = 0; privateSignal.withdrawn = false;
    publicSignal.withdrawn = false; revokeAfterPublicReads = undefined;
    publicSignal.galaxyPosition = { x: 0.1, y: -0.2, z: 0.3 };
    reportReceipts.clear(); reportSequence = 0;
    publicSignal.expandedText = publicOriginalText;
    publicSignal.matches = [];
    e4LegacyEvaluation = false;
    e4InterpretationFixture = false; e4Recap = undefined;
    savedSignals.clear(); resonatedSignals.clear();
    d4Complete = false; d4History = false; d4Signal.seedText = "D4_SYNTHETIC_PENDING_SEED"; d4Signal.parentSignalId = undefined;
    for (const id of signals.keys()) if (id.startsWith("d1000000-") || id.startsWith("runtime-e3-source-") || id.startsWith("e4000000-")) signals.delete(id);
    return ok(response, { synthetic: true });
  }
  if (request.method === "POST" && url.pathname === "/__runtime/e4-interpretations") {
    const expressions = makeE4InterpretationSignals(makeSignal);
    for (const signal of expressions) signals.set(signal.id, signal);
    signals.set(e4OldConfirmedId, makeE4OldConfirmedSignal(makeSignal));
    e4InterpretationFixture = true;
    e4Recap = makeE4Recap(owner, now, summary(signals.get(e4OldConfirmedId)));
    return ok(response, { synthetic: true, expressionCount: e4InterpretationCases.length });
  }
  if (request.method === "POST" && url.pathname === "/__runtime/e4-legacy-evaluation") {
    e4LegacyEvaluation = true;
    return ok(response, { synthetic: true });
  }
  if (url.pathname.startsWith("/api/admin/")) {
    if (current?.role !== "ADMIN") return fail(response, current ? 403 : 401, "UNAUTHORIZED");
    if (request.method !== "GET") return fail(response, 405, "METHOD_NOT_ALLOWED");
    if (url.pathname === "/api/admin/ai-evaluation") return ok(response, { evaluation: e4Evaluation() });
    if (url.pathname === "/api/admin/overview") return ok(response, { overview: {
      aiReviews: { total: 0 }, aiOperations: { chatFallbacks: 0, embeddingFailures: 0, rerankerFailures: 0, ttsFailures: 0 },
      capabilities: { chat: "disabled", embedding: "disabled", reranker: "disabled", tts: "disabled" },
      frequencies: { active: 0, banned: 0, muted: 0 }, galaxy: { missingCoordinates: 0 }, reports: { pending: 0, rejected: 0, resolved: 0 },
      signals: { total: 0, draft: 0, published: 0, reviewing: 0, hidden: 0, deleted: 0 }, users: { active: 0, banned: 0, muted: 0 },
    } });
    if (url.pathname === "/api/admin/signals") return ok(response, { signals: { items: [], total: 0, limit: 20, hasNextPage: false } });
    if (url.pathname === "/api/admin/ai-signals") return ok(response, { signals: { items: [], total: 0, limit: 20, hasNextPage: false } });
    const field = new Map([["/api/admin/reports", "reports"], ["/api/admin/frequencies", "frequencies"], ["/api/admin/users", "users"], ["/api/admin/ai-reviews", "aiReviews"], ["/api/admin/provider-configs", "providerConfigs"]]).get(url.pathname);
    return field ? ok(response, { [field]: [] }) : fail(response, 404, "NOT_FOUND");
  }
  if (request.method === "POST" && url.pathname === "/__runtime/e3-matches") {
    const mode = url.searchParams.get("mode");
    const sources = mode === "sources" ? ["human", "ai_generated", "seed"] : mode === "legacy" ? [undefined] : [];
    const matches = sources.map((source, index) => {
      const item = makeSignal(`runtime-e3-source-${index}`, "E3_PRIVATE_BROWSER_SEED", `E3_BROWSER_SOURCE_${source ?? "unknown"}. A synthetic public expression.`, { source: source ?? "human" });
      signals.set(item.id, item);
      return { id: item.id, authorFreqCode: item.authorFreqCode, expandedText: item.expandedText, score: 90, resonanceCount: 0, contentSource: source };
    });
    signals.get(publicSignal.id).matches = matches;
    return ok(response, { synthetic: true });
  }
  if (request.method === "POST" && url.pathname === "/__runtime/revoke-after-first-public-read") {
    revokeAfterPublicReads = 1;
    return ok(response, { synthetic: true });
  }
  if (request.method === "POST" && url.pathname === "/__runtime/resolve-reports") {
    for (const receipt of reportReceipts.values()) { receipt.status = "RESOLVED"; receipt.resolvedAt = now; }
    return ok(response, { synthetic: true });
  }
  if (request.method === "POST" && url.pathname === "/__runtime/center-public-point") {
    // Synthetic inverse-layout coordinates put this point at scene origin.
    // Its real WebGL hit area then stays at canvas center during rotation.
    publicSignal.galaxyPosition = { x: -1.5781108127302552, y: 0.09866504459490696, z: -0.18001785278681656 };
    return ok(response, { synthetic: true });
  }
  if (request.method === "POST" && url.pathname === "/__runtime/large-galaxy") {
    for (let index = 0; index < 520; index += 1) {
      const id = `d1000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
      signals.set(id, makeSignal(id, "D1_PRIVATE_BROWSER_SEED", `D1_BROWSER_${index}. A synthetic public expression.`, {
        createdAt: new Date(Date.UTC(2030, 0, 1, 0, 0, index)).toISOString(),
      }));
    }
    return ok(response, { synthetic: true });
  }
  if (request.method === "POST" && url.pathname === "/__runtime/long-galaxy-expression") {
    publicSignal.expandedText = `${"这是一段用于验证移动阅读的合成表达，需要完整显示并可以向下滚动。".repeat(60)} ${"x".repeat(180)} D3_LONG_END`;
    return ok(response, { synthetic: true });
  }
  if (request.method === "POST" && url.pathname === "/__runtime/offline-og") {
    publicSignal.expandedText = "中文离线分享：保持原文，表情与稀字在图片中明确占位。🙂 👩🏽‍💻 🇨🇳 1️⃣ 𠮷 " + "🙂".repeat(100);
    return ok(response, { synthetic: true });
  }
  if (request.method === "POST" && url.pathname === "/__runtime/d4-complete") { d4Complete = true; return ok(response, { synthetic: true }); }
  if (request.method === "POST" && url.pathname === "/__runtime/d4-history") { d4History = true; return ok(response, { synthetic: true }); }
  if (request.method === "POST" && url.pathname === "/api/signals") {
    if (!current) return fail(response, 401, "UNAUTHORIZED");
    const body = await readBody(request); d4Signal.seedText = body.seedText; d4Signal.parentSignalId = body.parentSignalId;
    return ok(response, { signal: d4Generation() });
  }
  if (request.method === "GET" && url.pathname === `/api/signals/${d4Id}`) {
    if (current?.id !== owner.id) return fail(response, 404, "NOT_FOUND");
    return ok(response, { signal: d4Complete ? ownerView(d4Signal) : d4Generation() });
  }
  if (request.method === "GET" && url.pathname === `/api/signals/${d4Parent}`) {
    if (current?.id !== owner.id) return fail(response, 404, "NOT_FOUND");
    return ok(response, { signal: ownerView(makeSignal(d4Parent, "D4_PARENT_SEED", "D4_PARENT_BODY", { status: "DRAFT", followUpQuestion: "D4_FOLLOW_UP_PRIVATE" })) });
  }
  const interaction = /^\/api\/signals\/([^/]+)\/(save|resonance)$/.exec(url.pathname);
  if (interaction && request.method === "POST") {
    const signal = signals.get(interaction[1]);
    if (!signal || signal.status !== "PUBLISHED" || signal.withdrawn) return fail(response, 404, "NOT_FOUND");
    if (!current) return fail(response, 401, "UNAUTHORIZED");
    const key = `${current.id}:${signal.id}`;
    if (interaction[2] === "save") { savedSignals.add(key); return ok(response, { save: { hasSaved: true } }); }
    resonatedSignals.add(key);
    return ok(response, { resonance: { hasResonated: true, resonanceCount: [...resonatedSignals].filter((entry) => entry.endsWith(`:${signal.id}`)).length } });
  }
  const reportStatusMatch = /^\/api\/reports\/signal\/([^/]+)$/.exec(url.pathname);
  if (request.method === "GET" && reportStatusMatch) {
    if (!current) return fail(response, 401, "UNAUTHORIZED");
    return ok(response, { report: reportReceipts.get(`${current.id}:${reportStatusMatch[1]}`) });
  }
  if (request.method === "POST" && url.pathname === "/api/reports") {
    if (!current) return fail(response, 401, "UNAUTHORIZED");
    const body = await readBody(request);
    const target = signals.get(body.targetId);
    if (!target || target.status !== "PUBLISHED" || target.withdrawn) return fail(response, 404, "NOT_FOUND");
    const key = `${current.id}:${target.id}`;
    if (reportReceipts.get(key)?.status !== "PENDING") reportReceipts.set(key, {
      id: `runtime-report-${++reportSequence}`, targetId: target.id, targetType: "SIGNAL", status: "PENDING", createdAt: now,
    });
    return ok(response, { report: reportReceipts.get(key) });
  }
  if (request.method === "POST" && url.pathname === "/api/auth/frequency/login") {
    let body;
    try { body = await readBody(request); } catch { return fail(response, 400, "VALIDATION_ERROR"); }
    const frequency = body.frequencyCode === owner.freqCode ? owner : body.frequencyCode === other.freqCode ? other : body.frequencyCode === admin.freqCode ? admin : undefined;
    if (frequency === undefined || body.password !== "runtime-password") return fail(response, 401, "UNAUTHORIZED");
    return ok(response, { frequency }, {
      "set-cookie": `${sessionCookie}=${frequency.id === owner.id ? "owner" : frequency.id === admin.id ? "admin" : "other"}; HttpOnly; Path=/; SameSite=Lax; Max-Age=900`,
    });
  }
  if (request.method === "GET" && url.pathname === "/api/me") {
    return current === undefined ? fail(response, 401, "UNAUTHORIZED") : ok(response, { frequency: current });
  }
  if (url.pathname.startsWith("/api/me/")) {
    if (current === undefined) return fail(response, 401, "UNAUTHORIZED");
    if (request.method === "GET" && url.pathname === "/api/me/signals") {
      if (e4InterpretationFixture && current.id === owner.id) {
        const expressions = e4InterpretationCases.map(({ id }) => summary(signals.get(id)));
        return ok(response, { signals: expressions, totalSignalCount: expressions.length, totalResonanceCount: 0,
          topSignal: expressions[0], page: { limit: 80, hasMore: false } });
      }
      if (d4History) {
        const all = Array.from({ length: 85 }, (_, index) => summary(makeSignal(`d4000000-0000-4000-8000-${String(1000 + index).padStart(12, "0")}`,
          `D4_HISTORY_${84 - index}`, "D4_HISTORY_BODY", { status: "DRAFT", resonanceCount: index === 84 ? 500 : 1 })));
        const offset = url.searchParams.has("cursor") ? 80 : 0;
        return ok(response, { signals: all.slice(offset, offset + 80), totalSignalCount: 85, totalResonanceCount: 584, topSignal: all[84],
          page: { limit: 80, hasMore: offset === 0, ...(offset === 0 ? { nextCursor: "ZDQtaGlzdG9yeS1uZXh0" } : {}) } });
      }
      return ok(response, { signals: [...signals.values()].filter((signal) => signal.frequencyId === current.id).slice(0, 80).map(summary), totalResonanceCount: 0 });
    }
    if (request.method === "GET" && url.pathname === "/api/me/saves") return ok(response, { signals: [] });
    if (request.method === "GET" && url.pathname === "/api/me/recaps/latest") return ok(response, current.id === owner.id && e4Recap ? { recap: e4Recap } : {});
    if (request.method === "GET" && url.pathname === "/api/me/recaps/2026-10") return current.id === owner.id && e4Recap ? ok(response, { recap: e4Recap }) : fail(response, 404, "NOT_FOUND");
    if (url.pathname === "/api/me/echo-summary" || url.pathname === "/api/me/echo-summary/seen") {
      return ok(response, { summary: { frequencyId: current.id, newResonanceCount: 0, totalResonanceCount: 0 } });
    }
  }
  if (request.method === "GET" && url.pathname === "/api/signals/galaxy") {
    const band = url.searchParams.get("band");
    const eligible = [...signals.values()]
      .filter((signal) => signal.status === "PUBLISHED" && !signal.withdrawn && (band === null || (signal.runtimeE4Interpretation ? signal.runtimeE4ConfirmedContent?.primaryBand : signal.frequencyProfile.primaryBand) === band))
      .map((signal) => galaxyPoint(signal, current?.id === signal.frequencyId));
    const latestOwn = eligible.filter((point) => point.isMine).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0];
    const focus = eligible.find((point) => point.id === url.searchParams.get("focus"));
    const points = [...new Map([...(focus ? [focus] : []), ...(latestOwn ? [latestOwn] : []), ...eligible].map((point) => [point.id, point])).values()].slice(0, 80);
    return ok(response, { generatedAt: now, points, bandOptions: [
      { label: "意义深空", value: "meaning_deep_space" },
      { label: "关系星云", value: "relationship_nebula" },
    ], themeOptions: [], coverage: { totalEligibleCount: eligible.length, returnedCount: points.length, sampleLimit: 80,
      samplingVersion: "recent-band-v1", filters: band ? { band } : {},
      ...(latestOwn ? { latestOwnSignalId: latestOwn.id } : {}), ...(focus ? { focusSignalId: focus.id } : {}),
      focusStatus: url.searchParams.has("focus") ? focus ? "available" : "unavailable" : "none" } });
  }
  const match = /^\/api\/signals\/([^/]+)(?:\/(publish|withdraw|publication-preview|audio))?$/.exec(url.pathname);
  if (match !== null) {
    const signal = signals.get(match[1]);
    if (signal === undefined) return fail(response, 404, "NOT_FOUND");
    if (request.method === "POST" && match[2] === "publish") {
      if (current?.id !== signal.frequencyId) return fail(response, 404, "NOT_FOUND");
      const body = await readBody(request); const expected = preview(signal);
      if (body.expectedVersion !== expected.version || body.digest !== expected.digest) return fail(response, 409, "CONFLICT");
      if (signal.runtimeE4Interpretation) signal.runtimeE4ConfirmedContent = structuredClone(expected.content);
      signal.status = "PUBLISHED"; signal.withdrawn = false; signal.publicationVersion = expected.version + 1;
      return ok(response, { signal: ownerView(signal) });
    }
    if (request.method === "POST" && match[2] === "withdraw") {
      if (current?.id !== signal.frequencyId) return fail(response, 404, "NOT_FOUND");
      const body = await readBody(request);
      if (!signal.withdrawn && body.expectedVersion !== (signal.publicationVersion ?? 1)) return fail(response, 409, "CONFLICT");
      if (!signal.withdrawn) signal.publicationVersion = (signal.publicationVersion ?? 1) + 1;
      signal.withdrawn = true;
      return ok(response, { withdrawal: { id: signal.id, withdrawn: true, publicationVersion: signal.publicationVersion } });
    }
    if (request.method === "GET") {
      if (signal.id === publicSignal.id && match[2] === undefined && current === undefined && revokeAfterPublicReads !== undefined) {
        if (revokeAfterPublicReads === 0) { signal.withdrawn = true; revokeAfterPublicReads = undefined; }
        else revokeAfterPublicReads -= 1;
      }
      if ((signal.status !== "PUBLISHED" || signal.withdrawn) && current?.id !== signal.frequencyId) return fail(response, 404, "NOT_FOUND");
      if (match[2] === "audio" && (signal.withdrawn || signal.status !== "PUBLISHED")) return fail(response, 404, "NOT_FOUND");
      if (match[2] === "audio") return ok(response, { audio: { signalId: signal.id, audioStatus: "NOT_REQUESTED" } });
      if (match[2] === "publication-preview") return current?.id === signal.frequencyId ? ok(response, { preview: preview(signal) }) : fail(response, 404, "NOT_FOUND");
      return ok(response, { signal: current?.id === signal.frequencyId ? ownerView(signal) : publicView(signal) });
    }
  }
  return fail(response, 404, "NOT_FOUND");
});

server.listen(port, "127.0.0.1", () => console.log(`Synthetic runtime API: http://127.0.0.1:${port}`));
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.close(() => process.exit(0)));
