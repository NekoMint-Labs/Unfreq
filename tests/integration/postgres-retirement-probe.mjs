import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import installedPostgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";

// Read-only assessment. Never alters node_modules, patches or a real database.
assert.equal(process.argv.length, 2, "This probe accepts no endpoint or path arguments.");
const root = fileURLToPath(new URL("../../", import.meta.url));
const metadata = JSON.parse(await readFile(path.join(root, "patches/postgres-4.0.0-lifecycle.json"), "utf8"));
const hash = (bytes, algorithm = "sha256", encoding = "hex") => createHash(algorithm).update(bytes).digest(encoding);
const exec = promisify(execFile);
const directory = await mkdtemp(path.join(tmpdir(), "unfreq-postgres-retirement-"));
const report = { checkedAt: new Date().toISOString(), version: metadata.version, budgetMs: 1800,
  syntheticLoopbackOnly: true, retirementEligible: false, controlsPassed: false, cleaned: false };
const fetchBytes = async (url) => {
  assert.equal(new URL(url).origin, "https://registry.npmjs.org");
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20_000) });
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.length < 5_000_000);
  return bytes;
};

function frame(type, payload) {
  const header = Buffer.alloc(5); header[0] = type.charCodeAt(0); header.writeInt32BE(payload.length + 4, 1);
  return Buffer.concat([header, payload]);
}
const authenticationReady = Buffer.concat([
  frame("R", Buffer.alloc(4)),
  frame("S", Buffer.from("server_version\0" + "16.0\0")),
  frame("S", Buffer.from("client_encoding\0UTF8\0")),
  frame("K", Buffer.alloc(8)), frame("Z", Buffer.from("I")),
]);
async function observe(factory, label, mode = "startup-fin") {
  const sockets = new Set();
  let connections = 0;
  let typeLoadObserved = 0;
  const server = createServer((socket) => {
    connections++;
    sockets.add(socket);
    socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
    if (mode === "startup-fin") { socket.on("data", () => {}); socket.end(); return; }
    let started = false;
    let input = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      input = Buffer.concat([input, chunk]);
      if (!started) {
        if (input.length < 8 || input.length < input.readInt32BE(0)) return;
        input = input.subarray(input.readInt32BE(0)); started = true;
        socket.write(authenticationReady);
      }
      if (input.includes(Buffer.from("pg_catalog.pg_type"))) {
        typeLoadObserved++; input = Buffer.alloc(0);
        if (mode === "type-load-fin") socket.end();
        // type-load-hang deliberately leaves the real socket open.
      }
    });
  });
  await new Promise((yes, no) => { server.once("error", no); server.listen(0, "127.0.0.1", yes); });
  const client = factory({ host: "127.0.0.1", port: server.address().port, user: "synthetic", password: "synthetic",
    database: "synthetic", infer: true, max: 2, connect_timeout: 1, prepare: false, fetch_types: true, ssl: false });
  const states = [];
  const start = performance.now();
  const operations = [
    ["query-1", () => client`select 1`], ["query-2", () => client`select 2`],
    ["reserve", async () => { const reserved = await client.reserve(); try { await reserved`select 1`; } finally { reserved.release(); } }],
    ["begin", () => client.begin(async (tx) => { await tx`select 1`; })],
    ["drizzle-transaction", () => drizzle(client).transaction(async (tx) => { await tx.execute(sql`select 1`); })],
  ];
  const work = operations.map(([operation, run]) => Promise.resolve().then(run).then(
    () => { states.push({ operation, state: "fulfilled", elapsedMs: performance.now() - start }); },
    (error) => { states.push({ operation, state: "rejected", elapsedMs: performance.now() - start,
      code: ["CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECT_TIMEOUT", "CONNECTION_DESTROYED"].includes(error?.code) ? error.code : "OTHER" }); },
  ));
  let timer;
  let closeTimer;
  try {
    await Promise.race([Promise.all(work), new Promise((yes) => { timer = setTimeout(yes, report.budgetMs); })]);
    const natural = states.filter((value) => value.elapsedMs <= report.budgetMs).map((value) => ({ ...value }));
    // Cleanup is deliberately outside the measured result. A forced end cannot
    // turn pending operations into a successful natural-settlement observation.
    const result = { label, mode, connections, typeLoadObserved, settledWithinBudget: natural.length, total: work.length,
      natural, pending: operations.map(([name]) => name).filter((name) => !natural.some((item) => item.operation === name)),
      forcedEndNeeded: natural.length !== work.length };
    const closing = client.end({ timeout: 0 });
    await Promise.race([closing, new Promise((_, no) => { closeTimer = setTimeout(() => no(new Error("Owned driver failed to close.")), 3000); })]);
    await Promise.all(work);
    return result;
  } finally {
    clearTimeout(timer); clearTimeout(closeTimer);
    for (const socket of sockets) socket.destroy();
    await new Promise((yes, no) => server.close((error) => error ? no(error) : yes()));
  }
}

try {
  const latest = JSON.parse((await fetchBytes("https://registry.npmjs.org/postgres/latest")).toString());
  report.registryLatest = latest.version;
  report.newerReleaseAvailable = latest.version !== metadata.version;
  const published = JSON.parse((await fetchBytes(`https://registry.npmjs.org/postgres/${metadata.version}`)).toString());
  assert.equal(published.version, metadata.version);
  assert.equal(published.dist.integrity, metadata.integrity);
  const archive = await fetchBytes(published.dist.tarball);
  assert.equal("sha512-" + hash(archive, "sha512", "base64"), metadata.integrity);
  report.registryIntegrityVerified = true;
  const archivePath = path.join(directory, "official.tgz");
  await writeFile(archivePath, archive, { flag: "wx" });
  const { stdout } = await exec("tar", ["-tzf", archivePath], { timeout: 10_000, windowsHide: true });
  for (const entry of stdout.trim().split(/\r?\n/u)) {
    assert.ok(entry.startsWith("package/") && !entry.includes("\\") && !entry.split("/").includes(".."));
  }
  await exec("tar", ["-xzf", archivePath, "-C", directory], { timeout: 10_000, windowsHide: true });
  for (const file of metadata.files) {
    assert.equal(hash(await readFile(path.join(directory, "package", file.path))), file.originalSha256);
    assert.equal(hash(await readFile(path.join(root, "node_modules/postgres", file.path))), file.patchedSha256);
  }
  report.sourceHashesVerified = true;
  const pristine = (await import(pathToFileURL(path.join(directory, "package/src/index.js")).href)).default;
  report.observations = [];
  for (const mode of ["startup-fin", "type-load-fin", "type-load-hang"]) {
    const official = await observe(pristine, "official-registry-unpatched", mode);
    const patched = await observe(installedPostgres, "locked-local-patch", mode);
    if (mode !== "startup-fin") {
      assert.ok(official.typeLoadObserved > 0 && patched.typeLoadObserved > 0, "Type load must actually reach the wire fault.");
    }
    report.observations.push({ mode, official, patched });
  }
  const settled = (probe) => probe.settledWithinBudget === 5 && probe.natural.every((item) => item.state === "rejected");
  report.controlsPassed = report.observations.every(({ patched }) => settled(patched));
  report.retirementEligible = false; // Real PostgreSQL recovery and other existing gates still apply.
  report.failingGates = report.observations.filter(({ official }) => !settled(official)).map(({ mode }) => mode);
  report.decision = report.failingGates.length ? "KEEP_PATCH_UNSETTLED_UPSTREAM_WORK" : "OTHER_EXISTING_GATES_STILL_REQUIRED";
  assert.equal(report.controlsPassed, true, "Patched positive control must pass the original budget.");
} finally {
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
  assert.ok(path.basename(directory).startsWith("unfreq-postgres-retirement-"));
  await rm(directory, { recursive: true, force: true });
  report.cleaned = true;
  await mkdir(path.join(root, "test-results"), { recursive: true });
  await writeFile(path.join(root, "test-results/postgres-retirement.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
}
