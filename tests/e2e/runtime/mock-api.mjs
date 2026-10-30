import { preview, publicView, ownerView, galaxyPoint } from "../publication-fixture.mjs";
import { createServer } from "node:http";

// This server binds only to loopback and uses synthetic, process-local data.
// It checks the Web/Next boundary; it does not exercise Fastify or a database.
const port = Number(process.env.RUNTIME_API_PORT ?? 4200);
const webOrigin = process.env.RUNTIME_WEB_ORIGIN ?? "http://127.0.0.1:3200";
const now = "2026-10-28T00:00:00.000Z";
const sessionCookie = "unfreq_runtime_session";
const owner = {
  id: "runtime-owner", code: "FM 78.23", freqCode: "FM 78.23",
  createdAt: now, isGuest: false, role: "USER", status: "ACTIVE",
};
const other = { ...owner, id: "runtime-other", code: "FM 21.04", freqCode: "FM 21.04" };
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

function identity(request) {
  const value = (request.headers.cookie ?? "").split(";")
    .map((entry) => entry.trim()).find((entry) => entry.startsWith(`${sessionCookie}=`))?.split("=")[1];
  return value === "owner" ? owner : value === "other" ? other : undefined;
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
    savedSignals.clear(); resonatedSignals.clear();
    for (const id of signals.keys()) if (id.startsWith("d1000000-")) signals.delete(id);
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
    const frequency = body.frequencyCode === owner.freqCode ? owner : body.frequencyCode === other.freqCode ? other : undefined;
    if (frequency === undefined || body.password !== "runtime-password") return fail(response, 401, "UNAUTHORIZED");
    return ok(response, { frequency }, {
      "set-cookie": `${sessionCookie}=${frequency.id === owner.id ? "owner" : "other"}; HttpOnly; Path=/; SameSite=Lax; Max-Age=900`,
    });
  }
  if (request.method === "GET" && url.pathname === "/api/me") {
    return current === undefined ? fail(response, 401, "UNAUTHORIZED") : ok(response, { frequency: current });
  }
  if (url.pathname.startsWith("/api/me/")) {
    if (current === undefined) return fail(response, 401, "UNAUTHORIZED");
    if (request.method === "GET" && url.pathname === "/api/me/signals") {
      return ok(response, { signals: [...signals.values()].filter((signal) => signal.frequencyId === current.id).map(summary), totalResonanceCount: 0 });
    }
    if (request.method === "GET" && url.pathname === "/api/me/saves") return ok(response, { signals: [] });
    if (request.method === "GET" && url.pathname === "/api/me/recaps/latest") return ok(response, {});
    if (url.pathname === "/api/me/echo-summary" || url.pathname === "/api/me/echo-summary/seen") {
      return ok(response, { summary: { frequencyId: current.id, newResonanceCount: 0, totalResonanceCount: 0 } });
    }
  }
  if (request.method === "GET" && url.pathname === "/api/signals/galaxy") {
    const band = url.searchParams.get("band");
    const eligible = [...signals.values()]
      .filter((signal) => signal.status === "PUBLISHED" && !signal.withdrawn && (band === null || signal.frequencyProfile.primaryBand === band))
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
