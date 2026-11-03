import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

const nativeFetch = globalThis.fetch;
let createWebImageFetchGuard;
try { ({ createWebImageFetchGuard } = await import("./web-fetch-guard.mjs")); }
finally { globalThis.fetch = nativeFetch; }

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
  });
}
async function close(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}

test("the image fetch guard refuses redirects and private URL logging while retaining inline and synthetic API reads", { timeout: 20_000 }, async () => {
  let destinationHits = 0;
  let redirectHits = 0;
  const destination = createServer((request, response) => {
    destinationHits += 1;
    response.writeHead(200); response.end("SYNTHETIC_REDIRECT_MUST_NOT_ARRIVE");
  });
  let destinationOrigin;
  const api = createServer((request, response) => {
    if (request.url === "/redirect") {
      redirectHits += 1;
      response.writeHead(302, { location: `${destinationOrigin}/SYNTHETIC_PRIVATE?key=SYNTHETIC_SECRET` });
      response.end();
    } else {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ synthetic: true }));
    }
  });
  const recorded = [];
  const nativeOptions = [];
  const guarded = createWebImageFetchGuard((input, options) => {
    nativeOptions.push({ redirect: options.redirect });
    return nativeFetch(input, options);
  }, (...args) => recorded.push(args));
  const read = (input, options = {}) => guarded(input, { signal: AbortSignal.timeout(2_000), ...options });
  try {
    // Never reuse a caller's existing service: EADDRINUSE fails before a fetch.
    await listen(api, 4200);
    await listen(destination, 0);
    destinationOrigin = `http://127.0.0.1:${destination.address().port}`;
    const redirect = "http://127.0.0.1:4200/redirect";
    const cases = [
      [redirect, undefined],
      [redirect, { redirect: "follow" }],
      [new Request(redirect, { redirect: "follow" }), undefined],
      [new Request(redirect, { redirect: "follow" }), { redirect: "follow" }],
    ];
    for (const [input, options] of cases) await assert.rejects(read(input, options), TypeError);
    assert.equal(redirectHits, cases.length, "The allowed API must actually return each redirect.");
    assert.equal(destinationHits, 0, "Native fetch must never follow the permitted API's redirect.");
    assert.deepEqual(recorded, [], "No initial external request was made in the redirect cases.");

    assert.deepEqual(await (await read("http://127.0.0.1:4200/ok")).json(), { synthetic: true });
    assert.equal(await (await read("data:text/plain,safe-inline")).text(), "safe-inline");
    assert.equal(nativeOptions.length, cases.length + 2);
    assert.ok(nativeOptions.every((options) => options.redirect === "error"));

    const privateUrl = `${destinationOrigin}/SYNTHETIC_PRIVATE?key=SYNTHETIC_SECRET`;
    const error = { message: "Synthetic image verification blocked external fetch." };
    await assert.rejects(read(privateUrl), error);
    await assert.rejects(read("SYNTHETIC_PRIVATE malformed URL"), error);
    assert.deepEqual(recorded, [[], []], "The counter receives no URL, token or error text.");
    assert.equal(nativeOptions.length, cases.length + 2, "Denied inputs must never reach native fetch.");
    assert.equal(destinationHits, 0);
  } finally { await Promise.all([close(api), close(destination)]); }
});
