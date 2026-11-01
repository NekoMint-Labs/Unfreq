import { createHash } from "node:crypto";
import { readFile, readdir, lstat, readlink } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

// Run only in the disposable final image. No network or application data is read.
assert.equal(process.platform, "linux");
assert.equal(process.cwd(), "/app");
const require = createRequire("/app/package.json");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const swcPackage = `@next/swc-linux-${process.arch}-musl`;
require(swcPackage);
const swcNative = require.resolve(swcPackage);
assert.ok(swcNative.endsWith(".node") && require.cache[swcNative], "SWC native binary was not loaded");
const sharp = require("sharp");
const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: "#112233" } }).png().toBuffer();
assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
const sharpNative = Object.keys(require.cache).filter((file) =>
  file.includes(`/@img/sharp-linuxmusl-${process.arch}/`) && file.endsWith(".node"));
assert.equal(sharpNative.length, 1, "Expected the Linux musl sharp binary, not a fallback");
const nativeArtifacts = await Promise.all([swcNative, sharpNative[0]].map(async (file) => {
  const bytes = await readFile(file);
  return { path: file, bytes: bytes.length, sha256: sha(bytes) };
}));
const contracts = await import(pathToFileURL(require.resolve("@unfreq/contracts")).href);
assert.ok(Object.keys(contracts).length > 0);
const forbidden = [".env", ".env.local", ".git", "test-results", "tests", "apps/web/src", "apps/api/src"];
for (const relative of forbidden) {
  await assert.rejects(lstat(path.join("/app", relative)), { code: "ENOENT" });
}

const packages = [];
const links = [];
const notices = [];
async function inventory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const root = path.join(directory, entry.name);
    if (entry.name.startsWith("@") && entry.isDirectory()) { await inventory(root); continue; }
    if (entry.isSymbolicLink()) {
      const target = await readlink(root);
      let resolvable = true;
      try { await readFile(path.join(root, "package.json")); } catch { resolvable = false; }
      links.push({ path: root, target, resolvable });
      continue;
    }
    if (!entry.isDirectory()) continue;
    let bytes;
    try { bytes = await readFile(path.join(root, "package.json")); } catch { continue; }
    const pkg = JSON.parse(bytes);
    const ownNotices = [];
    for (const file of await readdir(root, { withFileTypes: true })) {
      if (!file.isFile() || !/^(licen[cs]e|copying|notice|copyright)([._-].*)?$/i.test(file.name)) continue;
      const location = path.join(root, file.name);
      const content = await readFile(location);
      assert.ok(content.length <= 1_048_576, "Unexpectedly large notice file");
      ownNotices.push(location);
      notices.push({ path: location, sha256: sha(content), bytes: content.length, text: content.toString("utf8") });
    }
    packages.push({ path: root, name: pkg.name, version: pkg.version, license: pkg.license ?? null,
      manifestSha256: sha(bytes), noticeFiles: ownNotices });
    try { await inventory(path.join(root, "node_modules")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}
await inventory("/app/node_modules");
const buildId = (await readFile("/app/apps/web/.next/BUILD_ID", "utf8")).trim();
assert.ok(buildId.length > 0 && buildId.length < 256);
console.log(JSON.stringify({
  syntheticOnly: true, node: process.versions.node, platform: process.platform, arch: process.arch,
  buildId, linuxSwcLoaded: true, sharpPngGenerated: true, contractsLoaded: true, forbiddenAbsent: forbidden,
  packageCount: packages.length, noticeCount: notices.length, packages, links, notices, nativeArtifacts,
  alpinePackages: execFileSync("apk", ["info", "-vv"], { encoding: "utf8" }).trim().split("\n"),
  limitations: ["Package-root notice inventory only; nested vendor assets and system-library notices require separate review.",
    "Presence and metadata are recorded, not a legal compliance verdict or a minimal Web-only dependency tree."],
}));
