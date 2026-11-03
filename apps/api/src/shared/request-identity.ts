import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type { FastifyRequest } from "fastify";

/** Proxy trust is opt-in and address/CIDR based; never a boolean or hop count. */
export function parseTrustedProxyCidrs(value: string): string[] {
  if (value.trim() === "") return [];
  const entries = value.split(",").map((item) => item.trim());
  if (entries.length > 32) throw new Error("Invalid trusted proxy configuration.");
  for (const entry of entries) {
    const [address, prefix, extra] = entry.split("/");
    const version = isIP(address ?? "");
    if (extra !== undefined || version === 0 || (prefix !== undefined &&
        (!/^\d{1,3}$/u.test(prefix) || Number(prefix) > (version === 4 ? 32 : 128)))) {
      throw new Error("Invalid trusted proxy configuration.");
    }
  }
  return [...new Set(entries)];
}

export function canonicalClientIp(value: string): string {
  if (isIP(value) === 4) return value;
  if (isIP(value) !== 6 || value.includes("%")) return "unknown";
  try {
    const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
    const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/u.exec(canonical);
    if (mapped) {
      const left = Number.parseInt(mapped[1], 16);
      const right = Number.parseInt(mapped[2], 16);
      return `${left >>> 8}.${left & 255}.${right >>> 8}.${right & 255}`;
    }
    return canonical;
  } catch { return "unknown"; }
}

export function getCanonicalClientIp(request: Pick<FastifyRequest, "ip">): string {
  // request.ip is resolved by Fastify using the explicit trusted proxy list.
  // Never read a caller's Forwarded/X-Forwarded-For header here.
  return canonicalClientIp(request.ip);
}

export function safeRequestId(value: string | string[] | undefined): string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,80}$/u.test(value) ? value : randomUUID();
}
