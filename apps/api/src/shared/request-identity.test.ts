import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { canonicalClientIp, getCanonicalClientIp, parseTrustedProxyCidrs, safeRequestId } from "./request-identity.js";
import { sendData } from "./response.js";

const ownedApps: FastifyInstance[] = [];
beforeAll(async () => {
  // Framework cold initialization belongs to fixture setup. Production also
  // finishes ready() before serving requests; keep each behavior case at 5s.
  const setup = Fastify({ logger: false });
  setup.get("/setup", () => ({ ok: true }));
  try { await setup.ready(); await setup.inject({ method: "GET", url: "/setup" }); }
  finally { await setup.close(); }
});
function identityApp(cidrs = "") {
  const trusted = parseTrustedProxyCidrs(cidrs);
  const app = Fastify({
    logger: false,
    trustProxy: trusted.length === 0 ? false : trusted,
    genReqId: (request) => safeRequestId(request.headers["x-request-id"]),
  });
  const counts = new Map<string, number>();
  app.get("/identity", (request, reply) => {
    const ip = getCanonicalClientIp(request);
    const seen = (counts.get(ip) ?? 0) + 1;
    counts.set(ip, seen);
    return sendData(reply, request, { ip, seen });
  });
  ownedApps.push(app);
  return app;
}
afterEach(async () => {
  await Promise.all(ownedApps.splice(0).map((app) => app.close()));
});

describe("request identity boundary", () => {
  it("puts equivalent IPv4-mapped and compressed IPv6 forms in one bucket", () => {
    expect(canonicalClientIp("::ffff:192.0.2.7")).toBe("192.0.2.7");
    expect(canonicalClientIp("::ffff:c000:0207")).toBe("192.0.2.7");
    expect(canonicalClientIp("2001:0DB8:0000:0000:0000:0000:0000:0001")).toBe("2001:db8::1");
    expect(canonicalClientIp("2001:db8::2")).not.toBe(canonicalClientIp("2001:db8::1"));
  });

  it("does not turn invalid addresses into arbitrary identities", () => {
    for (const input of ["forged-client", "192.0.2.7, 127.0.0.1", "010.000.000.001", "fe80::1%eth0"]) {
      expect(canonicalClientIp(input)).toBe("unknown");
    }
  });

  it("accepts explicit IP/CIDR trust while rejecting booleans, hop counts and malformed prefixes", () => {
    expect(parseTrustedProxyCidrs("")).toEqual([]);
    expect(parseTrustedProxyCidrs("127.0.0.1/32, ::1/128,127.0.0.1/32")).toEqual(["127.0.0.1/32", "::1/128"]);
    for (const input of ["true", "1", "*", "127.0.0.1/33", "::1/129", "127.0.0.1/", "10.0.0.1/1/2", "127.0.0.1,"]) {
      expect(() => parseTrustedProxyCidrs(input)).toThrow("Invalid trusted proxy configuration.");
    }
  });

  it("keeps short tracing IDs and replaces oversized, ambiguous or control-bearing headers", () => {
    expect(safeRequestId("trace-abc_123.test:1")).toBe("trace-abc_123.test:1");
    for (const header of [undefined, ["first", "second"], "", "x".repeat(81), "id\r\nprivate-token", "Bearer private", "含原文的ID"]) {
      expect(safeRequestId(header)).toMatch(/^[a-f0-9-]{36}$/u);
    }
  });

  it("keeps spoofed forwarding headers in the actual peer bucket when proxy trust is disabled", async () => {
    const app = identityApp();
    for (const [index, spoofed] of ["198.51.100.7", "203.0.113.19, 127.0.0.1"].entries()) {
      const response = await app.inject({ method: "GET", url: "/identity", remoteAddress: "192.0.2.7", headers: {
        "x-forwarded-for": spoofed, forwarded: "for=198.51.100.199", "x-real-ip": "203.0.113.199",
      } });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual({ ip: "192.0.2.7", seen: index + 1 });
    }
  });

  it("ignores the entire forwarded chain when the immediate peer is outside explicit trusted CIDRs", async () => {
    const app = identityApp("127.0.0.1/32,::1/128");
    const response = await app.inject({ method: "GET", url: "/identity", remoteAddress: "203.0.113.7", headers: {
      "x-forwarded-for": "198.51.100.4,127.0.0.1",
    } });
    expect(response.json().data.ip).toBe("203.0.113.7");
  });

  it("walks only the trusted right-hand chain and stops at the nearest untrusted hop", async () => {
    const app = identityApp("10.0.0.0/8,192.0.2.0/24");
    const response = await app.inject({ method: "GET", url: "/identity", remoteAddress: "10.2.3.4", headers: {
      "x-forwarded-for": "198.51.100.199,203.0.113.8,192.0.2.17",
    } });
    expect(response.json().data.ip).toBe("203.0.113.8");
    const stopped = await app.inject({ method: "GET", url: "/identity", remoteAddress: "10.2.3.4", headers: {
      "x-forwarded-for": "198.51.100.199,172.16.5.4",
    } });
    expect(stopped.json().data.ip).toBe("172.16.5.4");
  });

  it("trusts an explicitly allowed IPv4-mapped proxy and canonicalizes its IPv6 client", async () => {
    const app = identityApp("127.0.0.1/32");
    const response = await app.inject({ method: "GET", url: "/identity", remoteAddress: "::ffff:127.0.0.1", headers: {
      "x-forwarded-for": "2001:0DB8:0000:0000:0000:0000:0000:0001",
    } });
    expect(response.json().data.ip).toBe("2001:db8::1");
  });

  it("applies an explicit IPv6 proxy CIDR to each hop rather than trusting the whole header", async () => {
    const app = identityApp("::1/128,2001:db8:ffff::/48");
    const response = await app.inject({ method: "GET", url: "/identity", remoteAddress: "::1", headers: {
      "x-forwarded-for": "2001:db8:aaaa::99,2001:0DB8:0000:0000:0000:0000:0000:0001,2001:db8:ffff::17",
    } });
    expect(response.json().data.ip).toBe("2001:db8::1");
    const untrusted = await app.inject({ method: "GET", url: "/identity", remoteAddress: "2001:db8:aaaa::7", headers: {
      "x-forwarded-for": "2001:db8::1,2001:db8:ffff::17",
    } });
    expect(untrusted.json().data.ip).toBe("2001:db8:aaaa::7");
  });

  it("puts actual mapped IPv4 and equivalent IPv6 injected peers in the same respective buckets", async () => {
    const app = identityApp();
    for (const [index, remoteAddress] of ["192.0.2.7", "::ffff:c000:0207"].entries()) {
      const response = await app.inject({ method: "GET", url: "/identity", remoteAddress });
      expect(response.json().data).toEqual({ ip: "192.0.2.7", seen: index + 1 });
    }
    for (const [index, remoteAddress] of ["2001:0DB8:0000:0000:0000:0000:0000:0001", "2001:db8::1"].entries()) {
      const response = await app.inject({ method: "GET", url: "/identity", remoteAddress });
      expect(response.json().data).toEqual({ ip: "2001:db8::1", seen: index + 1 });
    }
  });

  it.each([
    { name: "oversized", header: "x".repeat(81) },
    { name: "tab-bearing", header: "trace-\tprivate" },
    { name: "control-bearing", header: "trace-\u0001private" },
  ])("replaces an unsafe $name tracing header through real Fastify injection", async ({ header }) => {
    const app = identityApp();
    const response = await app.inject({ method: "GET", url: "/identity", headers: { "x-request-id": header } });
    expect(response.statusCode).toBe(200);
    expect(response.json().meta.requestId).toMatch(/^[a-f0-9-]{36}$/u);
    expect(response.json().meta.requestId).not.toBe(header);
  });

  it("preserves an allowed request ID in the normal Fastify response envelope", async () => {
    const app = identityApp();
    const response = await app.inject({ method: "GET", url: "/identity", headers: { "x-request-id": "trace-abc_123.test:1" } });
    expect(response.json().meta.requestId).toBe("trace-abc_123.test:1");
  });
});
