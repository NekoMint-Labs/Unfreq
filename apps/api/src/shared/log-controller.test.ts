import { get } from "node:http";
import { Readable } from "node:stream";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { ApiLogController } from "./log-controller.js";

type LogRecord = { level: number; msg: string; err?: { message?: string } };

async function exerciseStream(error: Error): Promise<LogRecord[]> {
  const records: LogRecord[] = [];
  const app = Fastify({
    logController: new ApiLogController(),
    logger: { level: "info", stream: { write(line: string) { records.push(JSON.parse(line) as LogRecord); } } },
  });
  let stream: Readable | undefined;
  app.get("/normal", async () => ({ ok: true }));
  app.get("/stream", async (_request, reply) => {
    stream = new Readable({ read() {} });
    stream.push("partial");
    return reply.send(stream);
  });
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === "string") throw new Error("Expected a loopback listener.");
    const normal = await app.inject({
      url: "/normal?private=PRIVATE_QUERY",
      headers: { authorization: "Bearer PRIVATE_TOKEN" },
    });
    expect(normal.statusCode).toBe(200);
    expect(normal.json()).toEqual({ ok: true });
    await new Promise<void>((resolve, reject) => {
      const client = get({
        hostname: "127.0.0.1", port: address.port, path: "/stream?private=PRIVATE_QUERY",
        headers: { authorization: "Bearer PRIVATE_TOKEN" },
      }, (response) => {
        response.once("error", () => {});
        response.once("data", () => stream?.destroy(error));
        response.once("close", resolve);
      });
      client.once("error", reject);
    });
    return records;
  } finally {
    stream?.destroy();
    await app.close();
  }
}

describe("API request logging compatibility", () => {
  it("retains real response-stream warnings without request content logs", async () => {
    const records = await exerciseStream(new Error("SYNTHETIC_DISK_READ_FAILED"));
    const failures = records.filter((record) => record.msg === "response terminated with an error with headers already sent");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ level: 40, err: { message: "SYNTHETIC_DISK_READ_FAILED" } });
    expect(records.some((record) => ["incoming request", "request completed", "request errored"].includes(record.msg))).toBe(false);
    expect(JSON.stringify(records)).not.toContain("PRIVATE_QUERY");
    expect(JSON.stringify(records)).not.toContain("PRIVATE_TOKEN");
  });

  it("keeps premature stream closes quiet", async () => {
    const error = Object.assign(new Error("synthetic client close"), { code: "ERR_STREAM_PREMATURE_CLOSE" });
    const records = await exerciseStream(error);
    expect(records.some((record) => record.msg === "stream closed prematurely")).toBe(false);
    expect(records.some((record) => record.level >= 40)).toBe(false);
    expect(JSON.stringify(records)).not.toContain("PRIVATE_QUERY");
    expect(JSON.stringify(records)).not.toContain("PRIVATE_TOKEN");
  });
});
