import assert from "node:assert/strict";
import { createServer } from "node:http";

// Disposable local endpoint: it never calls another service or returns model output.
assert.equal(process.platform, "linux");
assert.equal(process.cwd(), "/app");
const runId = process.env.UNFREQ_IMAGE_VERIFICATION_RUN ?? "";
assert.match(runId, /^[a-f0-9]{24}$/u);
assert.equal(process.argv.length, 2);
const markers = { first: `IMAGE_SHUTDOWN_${runId}`, control: `IMAGE_CONTROL_${runId}` };
const requests = [];
const receivedAt = new Map();
let attempts = 0;
let closing = false;
const state = () => ({ received: requests.length, closed: requests.filter((item) => item.closed).length,
  active: requests.filter((item) => !item.closed).length,
  oldestActiveMs: Math.max(0, ...requests.filter((item) => !item.closed).map((item) => performance.now() - receivedAt.get(item.seq))),
  requests: requests.map((item) => ({ ...item })) });
function reject(response, status) {
  response.writeHead(status, { "content-type": "application/json", connection: "close" });
  response.end(JSON.stringify({ rejected: true }));
}
const server = createServer((request, response) => {
  void (async () => {
    if (closing) { reject(response, 503); return; }
    if (request.method === "GET" && request.url === "/state") {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(state()));
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") { reject(response, 404); return; }
    if (request.headers.authorization !== "Bearer IMAGE-SYNTHETIC-ONLY") { reject(response, 403); return; }
    if (++attempts > 8) { reject(response, 429); return; }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes > 64 * 1024) { reject(response, 413); return; }
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = JSON.parse(raw);
    if (!Array.isArray(body?.messages) || body.messages.length === 0) { reject(response, 400); return; }
    const tags = Object.entries(markers).filter(([, marker]) => raw.includes(marker)).map(([tag]) => tag);
    if (tags.length !== 1) { reject(response, 400); return; }
    const entry = { seq: requests.length + 1, tag: tags[0], closed: false };
    receivedAt.set(entry.seq, performance.now());
    requests.push(entry);
    // ServerResponse.close observes this local HTTP connection only. It does
    // not establish whether a real remote provider stopped physical computation.
    response.once("close", () => { entry.closed = true; });
    // Intentionally leave the complete synthetic request's response pending.
    // Only the API's cancellation or fixture shutdown should close it.
  })().catch(() => {
    if (!response.headersSent && !response.destroyed) reject(response, 400);
    else response.destroy();
  });
});
server.requestTimeout = 5000;
server.headersTimeout = 5000;
server.keepAliveTimeout = 1000;
server.timeout = 0;
server.maxConnections = 16;
server.once("error", () => { process.exitCode = 1; });
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => {
  if (closing) return;
  closing = true;
  server.close();
  server.closeAllConnections();
});
server.listen(4010, "0.0.0.0", () => {
  console.log(JSON.stringify({ syntheticOnly: true, listening: true, port: 4010, runId }));
});
