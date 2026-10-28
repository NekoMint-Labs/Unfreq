import { createServer } from "node:http";

const port = Number(process.env.E2E_API_PORT ?? 4100);
const webOrigin = process.env.E2E_WEB_ORIGIN ?? "http://127.0.0.1:3100";
const now = "2026-05-23T00:00:00.000Z";
const primarySignalId = "signal-core-001";
const matchSignalId = "signal-match-001";

const frequency = {
  code: "FM 78.23",
  createdAt: now,
  freqCode: "FM 78.23",
  id: "frequency-core-001",
  isGuest: false,
  role: "USER",
  status: "ACTIVE",
};

const frequencyProfile = {
  coreNeed: "确认努力是否还通向自己的生活",
  displayText: "意义深空 · 努力怀疑",
  emotionTone: "清醒疲惫",
  innerConflict: "想继续努力，但怀疑努力是否真的通向自己想要的生活",
  primaryBand: "meaning_deep_space",
  resonanceKeywords: ["忙碌", "空转", "自我价值"],
  subFeeling: "effort_doubt",
};

const fingerprint = {
  coreNeed: frequencyProfile.coreNeed,
  displayText: frequencyProfile.displayText,
  emotionTone: frequencyProfile.emotionTone,
  energy: 0.48,
  frequency: "FM 78.23",
  hiddenNeed: "想确认这份忙碌不是空转",
  innerConflict: frequencyProfile.innerConflict,
  narrativeConflict: "房间很安静，键盘声像是在替人回答问题。",
  openness: 0.62,
  primaryBand: frequencyProfile.primaryBand,
  primaryEmotion: "疲惫",
  resonanceKeywords: frequencyProfile.resonanceKeywords,
  riskLevel: "LOW",
  secondaryEmotions: ["清醒", "犹疑"],
  signalType: "self-reflection",
  subFeeling: frequencyProfile.subFeeling,
  tags: ["忙碌", "空转", "价值"],
  theme: "意义深空",
  title: "忙碌后的空房间",
};

function createSignal(overrides = {}) {
  const id = overrides.id ?? primarySignalId;
  const seedText = overrides.seedText ?? "所有忙，都是不敢停下来面对空白。";

  return {
    audioStatus: "NOT_REQUESTED",
    authorFreqCode: overrides.authorFreqCode ?? "FM 78.23",
    createdAt: now,
    echoCount: 0,
    expandedText:
      overrides.expandedText ??
      "凌晨的屏幕还亮着，杯底的咖啡已经冷掉。你把待办事项一条条划掉，却始终没有碰那件真正想做的事。忙碌像一层体面的噪声，替你盖住房间里那个空白的问题。",
    fingerprint,
    followUpQuestion: "你最近一次真正停下来，是在什么时候？",
    frequencyId: frequency.id,
    frequencyProfile,
    galaxyPosition: overrides.galaxyPosition ?? { x: 0.1, y: -0.2, z: 0.3 },
    guestKey: undefined,
    hasSaved: false,
    id,
    isKept: false,
    matchSignalId: undefined,
    matches: [],
    parentSignalId: undefined,
    program: {
      bridgeNarration: "还有一个相近频率正在回应。",
      closingQuestion: "你愿意把这句话留在这里吗？",
      hostIntro: "今晚的信号来自一个刚刚停下来的频率。",
      leftSignalSummary: "用忙碌遮住空白。",
      programTitle: "空白之前",
      shareQuote: "忙碌像一层体面的噪声。",
    },
    qualityReason: undefined,
    qualityScore: 5,
    rawInput: seedText,
    resonanceCount: overrides.resonanceCount ?? 0,
    seedText,
    source: "human",
    status: "PUBLISHED",
    updatedAt: now,
  };
}

const matchSignal = createSignal({
  authorFreqCode: "FM 21.04",
  expandedText:
    "他把所有窗口都打开，像这样就能证明自己没有停下。可真正让他不安的，不是任务太多，而是安静下来以后不知道该先面对哪一个自己。",
  galaxyPosition: { x: -0.35, y: 0.15, z: -0.1 },
  id: matchSignalId,
  resonanceCount: 3,
  seedText: "我一直忙到忘了为什么开始。",
});

const primarySignal = {
  ...createSignal(),
  matches: [
    {
      distance: 0.18,
      expandedText: matchSignal.expandedText,
      frequencyCode: "FM 21.04",
      frequencyProfile,
      id: matchSignalId,
      primaryEmotion: "疲惫",
      resonanceCount: 3,
      score: 0.82,
      seedText: matchSignal.seedText,
      signalType: "self-reflection",
      source: "PUBLISHED",
      summary: "忙到忘记为什么开始。",
      tags: ["忙碌", "空转"],
      title: "另一个空房间",
    },
  ],
};
const monthlyRecap = {
  createdAt: now,
  frequencyId: frequency.id,
  generatedAt: now,
  id: "monthly-recap-core-001",
  signalCount: 2,
  summary: "这个月的信号集中在忙碌、自我价值和停下来的不安。",
  themeWords: ["忙碌", "空转", "自我价值"],
  topSignal: toMySignalSummary(matchSignal),
  totalResonanceCount: 4,
  updatedAt: now,
  yearMonth: "2026-05",
};

const signals = new Map([
  [primarySignal.id, primarySignal],
  [matchSignal.id, matchSignal],
]);
let primaryPublished = true;

function sendJson(response, status, data) {
  response.writeHead(status, {
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "content-type,cookie",
    "access-control-allow-methods": "DELETE,GET,OPTIONS,PATCH,POST,PUT",
    "access-control-allow-origin": webOrigin,
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(data));
}

function ok(response, data) {
  sendJson(response, 200, {
    data,
    meta: {
      requestId: "req_e2e",
    },
  });
}

function notFound(response) {
  sendJson(response, 404, {
    error: {
      code: "NOT_FOUND",
      message: "Not found.",
    },
    meta: {
      requestId: "req_e2e",
    },
  });
}

function unavailable(response) {
  sendJson(response, 503, {
    error: {
      code: "AI_UNAVAILABLE",
      message: "Signal generation is temporarily unavailable.",
    },
    meta: {
      requestId: "req_e2e_unavailable",
    },
  });
}

function readBody(request) {
  return new Promise((resolve) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
    });

    request.on("end", () => {
      if (body.length === 0) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
  });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "content-type,cookie",
      "access-control-allow-methods": "DELETE,GET,OPTIONS,PATCH,POST,PUT",
      "access-control-allow-origin": webOrigin,
    });
    response.end();
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/me") {
    ok(response, { frequency });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/me/signals") {
    ok(response, {
      signals: [toMySignalSummary(primarySignal), toMySignalSummary(matchSignal)],
      totalResonanceCount: 4,
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/me/echo-summary") {
    ok(response, {
      summary: {
        frequencyId: frequency.id,
        newResonanceCount: 1,
        since: now,
        topSignal: toMySignalSummary(matchSignal),
        totalResonanceCount: 4,
      },
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/me/echo-summary/seen") {
    ok(response, {
      summary: {
        frequencyId: frequency.id,
        newResonanceCount: 0,
        since: now,
        topSignal: toMySignalSummary(matchSignal),
        totalResonanceCount: 4,
      },
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/me/saves") {
    ok(response, {
      signals: [
        {
          ...toMySignalSummary(matchSignal),
          authorFreqCode: matchSignal.authorFreqCode,
          savedAt: now,
          theme: frequencyProfile.displayText,
        },
      ],
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/me/recaps/latest") {
    ok(response, { recap: monthlyRecap });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/signals") {
    const body = await readBody(request);
    const seedText = typeof body.seedText === "string" ? body.seedText : primarySignal.seedText;

    if (seedText.includes("触发发射失败")) {
      unavailable(response);
      return;
    }

    primaryPublished = false;
    primarySignal.rawInput = seedText;
    primarySignal.seedText = seedText;
    primarySignal.status = "DRAFT";
    ok(response, {
      signal: {
        createdAt: now,
        generationStatus: "COMPLETED",
        id: primarySignal.id,
        seedText,
        status: "DRAFT",
        updatedAt: now,
        visibility: "GENERATION_OWNER",
      },
    });
    return;
  }

  if (request.method === "POST" && url.pathname === `/api/signals/${primarySignalId}/publish`) {
    primaryPublished = true;
    primarySignal.status = "PUBLISHED";
    ok(response, {
      signal: {
        ...primarySignal,
      },
    });
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/signals/")) {
    const [, , , signalId, action] = url.pathname.split("/");

    if (signalId === "galaxy") {
      ok(response, {
        bandOptions: [
          { label: "意义深空", value: "meaning_deep_space" },
          { label: "关系星云", value: "relationship_nebula" },
        ],
        generatedAt: now,
        points: [
          ...(primaryPublished ? [toGalaxyPoint(primarySignal, true)] : []),
          toGalaxyPoint(matchSignal, false),
        ],
        themeOptions: ["意义深空", "关系星云"],
      });
      return;
    }

    const signal = signals.get(signalId);

    if (signal === undefined) {
      notFound(response);
      return;
    }

    if (action === "audio") {
      ok(response, {
        audio: {
          audioStatus: "FAILED",
          signalId,
        },
      });
      return;
    }

    if (signalId === primarySignalId && !primaryPublished) {
      ok(response, {
        signal: {
          ...primarySignal,
          status: "DRAFT",
          visibility: "PREVIEW_OWNER",
        },
      });
      return;
    }

    ok(response, { signal });
    return;
  }

  if (request.method === "POST" && url.pathname.endsWith("/resonance")) {
    ok(response, {
      resonance: {
        hasResonated: true,
        resonanceCount: 1,
      },
    });
    return;
  }

  if (request.method === "POST" && url.pathname.endsWith("/save")) {
    ok(response, {
      save: {
        hasSaved: true,
      },
    });
    return;
  }

  notFound(response);
});

function toGalaxyPoint(signal, isMine) {
  return {
    createdAt: signal.createdAt,
    expandedText: signal.expandedText,
    frequencyCode: signal.authorFreqCode,
    frequencyProfile,
    id: signal.id,
    isMine,
    matchIds: signal.id === primarySignalId ? [matchSignalId] : [primarySignalId],
    position: signal.galaxyPosition,
    resonanceCount: signal.resonanceCount,
    source: signal.source,
    theme: frequencyProfile.displayText,
  };
}

function toMySignalSummary(signal) {
  return {
    createdAt: signal.createdAt,
    expandedText: signal.expandedText,
    frequencyProfile: signal.frequencyProfile,
    id: signal.id,
    parentSignalId: signal.parentSignalId,
    resonanceCount: signal.resonanceCount,
    seedText: signal.seedText,
    status: signal.status,
  };
}

server.listen(port, "127.0.0.1", () => {
  console.log(`E2E mock API listening on http://127.0.0.1:${port}`);
});

process.on("SIGTERM", () => {
  server.close(() => {
    process.exit(0);
  });
});
