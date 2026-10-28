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

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  const current = identity(request);
  if (request.method === "OPTIONS") return send(response, 204, undefined);
  if (request.method === "GET" && url.pathname === "/health") return ok(response, { synthetic: true });
  if (request.method === "POST" && url.pathname === "/__runtime/reset") {
    privateSignal.status = "DRAFT";
    return ok(response, { synthetic: true });
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
    const points = [...signals.values()]
      .filter((signal) => signal.status === "PUBLISHED" && (band === null || signal.frequencyProfile.primaryBand === band))
      .map((signal) => ({
        id: signal.id, createdAt: signal.createdAt, expandedText: signal.expandedText,
        frequencyProfile: signal.frequencyProfile, frequencyCode: signal.authorFreqCode,
        isMine: current?.id === signal.frequencyId, matchIds: [], position: signal.galaxyPosition,
        resonanceCount: 0, source: "seed", theme: signal.frequencyProfile.displayText,
      }));
    return ok(response, { generatedAt: now, points, bandOptions: [
      { label: "意义深空", value: "meaning_deep_space" },
      { label: "关系星云", value: "relationship_nebula" },
    ], themeOptions: [] });
  }
  const match = /^\/api\/signals\/([^/]+)(?:\/(publish|audio))?$/.exec(url.pathname);
  if (match !== null) {
    const signal = signals.get(match[1]);
    if (signal === undefined) return fail(response, 404, "NOT_FOUND");
    if (request.method === "POST" && match[2] === "publish") {
      if (current?.id !== signal.frequencyId) return fail(response, 404, "NOT_FOUND");
      signal.status = "PUBLISHED";
      return ok(response, { signal });
    }
    if (request.method === "GET") {
      if (signal.status !== "PUBLISHED" && current?.id !== signal.frequencyId) return fail(response, 404, "NOT_FOUND");
      if (match[2] === "audio") return ok(response, { audio: { signalId: signal.id, audioStatus: "NOT_REQUESTED" } });
      return ok(response, { signal: signal.status === "DRAFT" ? { ...signal, visibility: "PREVIEW_OWNER" } : signal });
    }
  }
  return fail(response, 404, "NOT_FOUND");
});

server.listen(port, "127.0.0.1", () => console.log(`Synthetic runtime API: http://127.0.0.1:${port}`));
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.close(() => process.exit(0)));
