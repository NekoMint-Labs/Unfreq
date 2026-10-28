import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import type { AuthUserRecord } from "./types.js";

const authStores = vi.hoisted(() => {
  return {
    usersByEmail: new Map<string, AuthUserRecord>(),
    usersByFrequencyName: new Map<string, AuthUserRecord>(),
    usersByFreqCode: new Map<string, AuthUserRecord>(),
    usersById: new Map<string, AuthUserRecord>(),
  };
});

const redisMock = vi.hoisted(() => {
  type StoredValue = {
    expiresAtMs?: number;
    value: string;
  };

  const store = new Map<string, StoredValue>();

  const deleteExpired = (key: string) => {
    const existing = store.get(key);

    if (existing?.expiresAtMs !== undefined && existing.expiresAtMs <= Date.now()) {
      store.delete(key);
    }
  };

  class Redis {
    status: "end" | "ready" | "wait" = "ready";

    connect(): Promise<void> {
      this.status = "ready";
      return Promise.resolve();
    }

    del(key: string): Promise<number> {
      const didDelete = store.delete(key);
      return Promise.resolve(didDelete ? 1 : 0);
    }

    disconnect(): void {
      this.status = "end";
    }

    get(key: string): Promise<string | null> {
      deleteExpired(key);
      return Promise.resolve(store.get(key)?.value ?? null);
    }

    on(_event: string, _listener: (error: Error) => void): this {
      return this;
    }

    ping(): Promise<"PONG"> {
      return Promise.resolve("PONG");
    }

    set(
      key: string,
      value: string,
      ...args: Array<number | string>
    ): Promise<"OK" | null> {
      deleteExpired(key);

      if (args.includes("NX") && store.has(key)) {
        return Promise.resolve(null);
      }

      const exIndex = args.indexOf("EX");
      const exSeconds = exIndex >= 0 ? Number(args[exIndex + 1]) : undefined;
      const expiresAtMs =
        exSeconds === undefined || Number.isNaN(exSeconds)
          ? undefined
          : Date.now() + exSeconds * 1000;

      store.set(key, {
        expiresAtMs,
        value,
      });

      return Promise.resolve("OK");
    }

    ttl(key: string): Promise<number> {
      deleteExpired(key);

      const existing = store.get(key);

      if (existing === undefined) {
        return Promise.resolve(-2);
      }

      if (existing.expiresAtMs === undefined) {
        return Promise.resolve(-1);
      }

      return Promise.resolve(Math.ceil((existing.expiresAtMs - Date.now()) / 1000));
    }
  }

  return {
    Redis,
    store,
  };
});

const testSessionSecret = process.env.SESSION_SECRET ?? "local-dev-session-secret-change-before-production";

function signTestSessionValue(value: string): string {
  return createHmac("sha256", testSessionSecret).update(value).digest("base64url");
}

function createTestSessionCookie(userId: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      exp: Math.floor(Date.now() / 1000) + 60,
      sub: userId,
    }),
    "utf8",
  ).toString("base64url");
  const token = `v1.${payload}.${signTestSessionValue(`v1.${payload}`)}`;

  return `unfreq_session=${token}`;
}

vi.mock("ioredis", () => {
  return {
    Redis: redisMock.Redis,
  };
});

vi.mock("./repository.js", () => {
  const toUser = (params: {
    email: string | null;
    frequencyName?: string | null;
    freqCode: string;
    id: string;
    isGuest: boolean;
    passwordHash?: string | null;
  }): AuthUserRecord => {
    const now = new Date("2026-05-10T00:00:00.000Z");

    return {
      createdAt: now,
      email: params.email,
      frequencyName: params.frequencyName ?? null,
      freqCode: params.freqCode,
      id: params.id,
      isGuest: params.isGuest,
      passwordHash: params.passwordHash ?? null,
      role: "USER",
      status: "ACTIVE",
      updatedAt: now,
    };
  };

  const storeUser = (user: AuthUserRecord) => {
    if (user.email !== null) {
      authStores.usersByEmail.set(user.email, user);
    }

    if (user.frequencyName !== null) {
      authStores.usersByFrequencyName.set(user.frequencyName, user);
    }

    authStores.usersById.set(user.id, user);
    authStores.usersByFreqCode.set(user.freqCode, user);
  };

  return {
    createGuestUser: vi.fn((params: { freqCode: string }) => {
      const user = toUser({
        email: null,
        freqCode: params.freqCode,
        id: `user-${authStores.usersById.size + 1}`,
        isGuest: true,
      });

      storeUser(user);

      return Promise.resolve(user);
    }),
    createPasswordFrequencyUser: vi.fn(
      (params: { freqCode: string; passwordHash: string }) => {
        const user = toUser({
          email: null,
          freqCode: params.freqCode,
          id: `user-${authStores.usersById.size + 1}`,
          isGuest: false,
          passwordHash: params.passwordHash,
        });

        storeUser(user);

        return Promise.resolve(user);
      },
    ),
    createUser: vi.fn((params: { email: string; freqCode: string }) => {
      const user = toUser({
        email: params.email,
        freqCode: params.freqCode,
        id: `user-${authStores.usersById.size + 1}`,
        isGuest: false,
      });

      storeUser(user);

      return Promise.resolve(user);
    }),
    findUserByEmail: vi.fn((email: string) => {
      return Promise.resolve(authStores.usersByEmail.get(email));
    }),
    findUserByFrequencyName: vi.fn((frequencyName: string) => {
      return Promise.resolve(authStores.usersByFrequencyName.get(frequencyName));
    }),
    findUserByFreqCode: vi.fn((freqCode: string) => {
      return Promise.resolve(authStores.usersByFreqCode.get(freqCode));
    }),
    findUserById: vi.fn((id: string) => {
      return Promise.resolve(authStores.usersById.get(id));
    }),
    updateUserFrequencyCredentials: vi.fn(
      (params: { frequencyName: string; passwordHash: string; userId: string }) => {
        const user = authStores.usersById.get(params.userId);

        if (user === undefined) {
          return Promise.resolve(undefined);
        }

        if (user.frequencyName !== null) {
          authStores.usersByFrequencyName.delete(user.frequencyName);
        }

        user.frequencyName = params.frequencyName;
        user.isGuest = false;
        user.passwordHash = params.passwordHash;
        user.updatedAt = new Date("2026-05-10T00:01:00.000Z");
        authStores.usersByFrequencyName.set(user.frequencyName, user);

        return Promise.resolve(user);
      },
    ),
  };
});

let app: FastifyInstance | undefined;

async function requestLoginCode(testApp: FastifyInstance, email: string) {
  const response = await testApp.inject({
    method: "POST",
    payload: {
      email,
    },
    url: "/api/auth/login",
  });
  const payload = response.json() as {
    data: {
      delivery: {
        code?: string;
        mode: string;
      };
    };
  };

  expect(response.statusCode).toBe(200);
  expect(payload.data.delivery).toMatchObject({
    code: expect.stringMatching(/^\d{6}$/),
    mode: "local-log",
  });

  return payload.data.delivery.code ?? "";
}

async function loginWithVerification(testApp: FastifyInstance, email: string) {
  const code = await requestLoginCode(testApp, email);

  return testApp.inject({
    method: "POST",
    payload: {
      code,
      email,
    },
    url: "/api/auth/login/verify",
  });
}

beforeEach(() => {
  authStores.usersByEmail.clear();
  authStores.usersByFrequencyName.clear();
  authStores.usersById.clear();
  authStores.usersByFreqCode.clear();
  redisMock.store.clear();
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.useRealTimers();
});

describe("auth routes", () => {
  it("rejects guest frequency creation", async () => {
    const testApp = await buildApp();
    app = testApp;

    const response = await testApp.inject({
      method: "POST",
      payload: {},
      url: "/api/auth/guest",
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: {
        code: "FORBIDDEN",
      },
    });
    expect(authStores.usersById.size).toBe(0);
  });

  it("registers a password frequency with a random FM code", async () => {
    const testApp = await buildApp();
    app = testApp;

    const response = await testApp.inject({
      method: "POST",
      payload: {
        password: "safe-password",
      },
      url: "/api/auth/register",
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers["set-cookie"]).toContain("unfreq_session=");
    expect(response.json()).toMatchObject({
      data: {
        frequency: {
          freqCode: expect.stringMatching(/^FM \d{2}\.\d{2}$/),
          isGuest: false,
          role: "USER",
          status: "ACTIVE",
        },
        isNewFrequency: true,
        sessionToken: expect.any(String),
      },
    });
    expect(authStores.usersById.size).toBe(1);
    expect([...authStores.usersById.values()][0]?.passwordHash).toMatch(/^scrypt:/);
  });

  it("restores a frequency through the current frequency endpoint when logged in", async () => {
    const testApp = await buildApp();
    app = testApp;

    const registerResponse = await testApp.inject({
      method: "POST",
      payload: {
        password: "safe-password",
      },
      url: "/api/auth/register",
    });

    const restoreResponse = await testApp.inject({
      headers: {
        cookie: registerResponse.headers["set-cookie"],
      },
      method: "POST",
      payload: {},
      url: "/api/frequencies",
    });

    expect(restoreResponse.statusCode).toBe(200);
    expect(restoreResponse.json()).toMatchObject({
      data: {
        frequency: {
          code: registerResponse.json().data.frequency.freqCode,
          freqCode: registerResponse.json().data.frequency.freqCode,
        },
      },
    });
    expect(restoreResponse.json().data.sessionToken).toBeUndefined();
  });

  it("rejects the current frequency endpoint without a session", async () => {
    const testApp = await buildApp();
    app = testApp;

    const response = await testApp.inject({
      method: "POST",
      payload: {},
      url: "/api/frequencies",
    });

    expect(response.statusCode).toBe(401);
    expect(authStores.usersById.size).toBe(0);
  });

  it("rejects legacy frequency naming", async () => {
    const testApp = await buildApp();
    app = testApp;

    const registerResponse = await testApp.inject({
      method: "POST",
      payload: {
        password: "temporary-password",
      },
      url: "/api/auth/register",
    });
    const response = await testApp.inject({
      headers: {
        cookie: registerResponse.headers["set-cookie"],
      },
      method: "POST",
      payload: {
        frequencyName: "Night_Signal",
        password: "safe-password",
      },
      url: "/api/auth/frequency/save",
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: {
        code: "FORBIDDEN",
      },
    });
    expect(authStores.usersByFrequencyName.size).toBe(0);
  });

  it("rejects frequency name suggestions", async () => {
    const testApp = await buildApp();
    app = testApp;

    const response = await testApp.inject({
      method: "POST",
      payload: {
        context: "Midnight signal after rain",
      },
      url: "/api/auth/frequency/suggestions",
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: {
        code: "FORBIDDEN",
      },
    });
  });

  it("rejects frequency-name login payloads", async () => {
    const testApp = await buildApp();
    app = testApp;

    const response = await testApp.inject({
      method: "POST",
      payload: {
        frequencyName: "returning-fm",
        password: "safe-password",
      },
      url: "/api/auth/frequency/login",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
      },
    });
  });

  it("logs in with an FM code and password", async () => {
    const testApp = await buildApp();
    app = testApp;

    const registerResponse = await testApp.inject({
      method: "POST",
      payload: {
        password: "safe-password",
      },
      url: "/api/auth/register",
    });
    const registeredCode = registerResponse.json().data.frequency.freqCode;

    const response = await testApp.inject({
      method: "POST",
      payload: {
        frequencyCode: registeredCode.replace(" ", "-"),
        password: "safe-password",
      },
      url: "/api/auth/frequency/login",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toContain("unfreq_session=");
    expect(response.json()).toMatchObject({
      data: {
        frequency: {
          freqCode: registeredCode,
          isGuest: false,
        },
        isNewFrequency: false,
      },
    });
  });

  it("rejects a wrong FM password with UNAUTHORIZED", async () => {
    const testApp = await buildApp();
    app = testApp;

    const registerResponse = await testApp.inject({
      method: "POST",
      payload: {
        password: "safe-password",
      },
      url: "/api/auth/register",
    });
    const registeredCode = registerResponse.json().data.frequency.freqCode;

    const response = await testApp.inject({
      method: "POST",
      payload: {
        frequencyCode: registeredCode,
        password: "wrong-password",
      },
      url: "/api/auth/frequency/login",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: {
        code: "UNAUTHORIZED",
      },
    });
  });

  it("issues a login challenge without creating a frequency identity", async () => {
    const testApp = await buildApp();
    app = testApp;

    const response = await testApp.inject({
      method: "POST",
      payload: {
        email: "FIRST@example.com",
      },
      url: "/api/auth/login",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(authStores.usersByEmail.size).toBe(0);
    expect(response.json()).toMatchObject({
      data: {
        challenge: {
          expiresAt: expect.any(String),
          retryAfterSeconds: 60,
        },
        delivery: {
          code: expect.stringMatching(/^\d{6}$/),
          mode: "local-log",
        },
      },
      meta: {
        requestId: expect.any(String),
      },
    });
    expect(response.json().data.localDelivery).toBeUndefined();
  });

  it("creates a new frequency identity after code verification and reuses it later", async () => {
    const testApp = await buildApp();
    app = testApp;

    const firstResponse = await loginWithVerification(testApp, "FIRST@example.com");

    expect(firstResponse.statusCode).toBe(200);
    expect(firstResponse.headers["set-cookie"]).toContain("unfreq_session=");

    const firstPayload = firstResponse.json();
    expect(firstPayload.data).toMatchObject({
      frequency: {
        freqCode: expect.stringMatching(/^FM \d{2}\.\d{2}$/),
        role: "USER",
        status: "ACTIVE",
      },
      isNewFrequency: true,
      sessionToken: expect.any(String),
    });

    redisMock.store.clear();

    const secondCode = await requestLoginCode(testApp, "first@example.com");
    const secondResponse = await testApp.inject({
      method: "POST",
      payload: {
        code: secondCode,
        email: "first@example.com",
      },
      url: "/api/auth/login/verify",
    });

    expect(secondResponse.statusCode).toBe(200);
    expect(secondResponse.json().data).toMatchObject({
      frequency: {
        freqCode: firstPayload.data.frequency.freqCode,
      },
      isNewFrequency: false,
    });
  });

  it("rejects /api/me without a session", async () => {
    const testApp = await buildApp();
    app = testApp;

    const response = await testApp.inject({
      method: "GET",
      url: "/api/me",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: {
        code: "UNAUTHORIZED",
      },
      meta: {
        requestId: expect.any(String),
      },
    });
  });

  it("rejects old guest sessions from the current frequency endpoint", async () => {
    const testApp = await buildApp();
    app = testApp;
    const now = new Date("2026-05-10T00:00:00.000Z");
    const guestUser: AuthUserRecord = {
      createdAt: now,
      email: null,
      frequencyName: null,
      freqCode: "FM 10.01",
      id: "guest-user-1",
      isGuest: true,
      passwordHash: null,
      role: "USER",
      status: "ACTIVE",
      updatedAt: now,
    };

    authStores.usersById.set(guestUser.id, guestUser);
    authStores.usersByFreqCode.set(guestUser.freqCode, guestUser);

    const response = await testApp.inject({
      headers: {
        cookie: createTestSessionCookie(guestUser.id),
      },
      method: "GET",
      url: "/api/me",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: {
        code: "UNAUTHORIZED",
      },
    });
  });

  it("returns the current frequency identity from the session cookie", async () => {
    const testApp = await buildApp();
    app = testApp;

    const loginResponse = await loginWithVerification(testApp, "me@example.com");

    const meResponse = await testApp.inject({
      headers: {
        cookie: loginResponse.headers["set-cookie"],
      },
      method: "GET",
      url: "/api/me",
    });

    expect(meResponse.statusCode).toBe(200);
    expect(meResponse.json()).toMatchObject({
      data: {
        frequency: {
          createdAt: "2026-05-10T00:00:00.000Z",
          freqCode: loginResponse.json().data.frequency.freqCode,
          id: "user-1",
          role: "USER",
          status: "ACTIVE",
        },
      },
      meta: {
        requestId: expect.any(String),
      },
    });
  });

  it("keeps malformed emails out of the login flow", async () => {
    const testApp = await buildApp();
    app = testApp;

    const response = await testApp.inject({
      method: "POST",
      payload: {
        email: "not-an-email",
      },
      url: "/api/auth/login",
    });

    expect(response.statusCode).toBe(400);
    expect(authStores.usersByEmail.size).toBe(0);
  });

  it("rejects an invalid verification code without creating a frequency identity", async () => {
    const testApp = await buildApp();
    app = testApp;

    const code = await requestLoginCode(testApp, "wrong-code@example.com");
    const wrongCode = code === "000000" ? "111111" : "000000";
    const response = await testApp.inject({
      method: "POST",
      payload: {
        code: wrongCode,
        email: "wrong-code@example.com",
      },
      url: "/api/auth/login/verify",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: {
        code: "UNAUTHORIZED",
        details: {
          remainingAttempts: 4,
        },
      },
      meta: {
        requestId: expect.any(String),
      },
    });
    expect(authStores.usersByEmail.size).toBe(0);
  });

  it("rejects an expired verification challenge", async () => {
    const testApp = await buildApp();
    app = testApp;

    const code = await requestLoginCode(testApp, "expired@example.com");

    for (const [key, storedValue] of redisMock.store.entries()) {
      if (key.startsWith("auth:login:challenge:")) {
        const record = JSON.parse(storedValue.value) as Record<string, unknown>;
        redisMock.store.set(key, {
          ...storedValue,
          value: JSON.stringify({
            ...record,
            expiresAt: "2026-05-10T00:00:00.000Z",
          }),
        });
      }
    }

    const response = await testApp.inject({
      method: "POST",
      payload: {
        code,
        email: "expired@example.com",
      },
      url: "/api/auth/login/verify",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: {
        code: "UNAUTHORIZED",
        details: {
          reason: "EXPIRED",
        },
      },
      meta: {
        requestId: expect.any(String),
      },
    });
    expect(authStores.usersByEmail.size).toBe(0);
  });

  it("rate-limits repeated login challenge requests", async () => {
    const testApp = await buildApp();
    app = testApp;

    await requestLoginCode(testApp, "repeat@example.com");

    const response = await testApp.inject({
      method: "POST",
      payload: {
        email: "REPEAT@example.com",
      },
      url: "/api/auth/login",
    });

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({
      error: {
        code: "RATE_LIMITED",
        details: {
          limitType: "AUTH_LOGIN_REQUEST",
          retryAfterSeconds: expect.any(Number),
        },
      },
      meta: {
        requestId: expect.any(String),
      },
    });
  });
});
