import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../../", import.meta.url));
const target = path.resolve(source, process.argv[2] ?? "runtime-candidate");
const { FIXED_MAIN: main, FIXED_RUNTIME: runtime, SECURITY_HEAD: security } = process.env;
for (const revision of [main, runtime, security]) assert.match(revision ?? "", /^[a-f0-9]{40}$/u);
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });
assert.equal(git(target, "rev-parse", "HEAD").trim(), runtime);
const base = JSON.parse(git(source, "show", main + ":package.json"));
const candidate = JSON.parse(git(source, "show", security + ":package.json"));
const script = "test:dependency-security";
assert.equal(candidate.scripts[script], "node --test tests/dependencies/production-security.test.mjs tests/dependencies/development-security.test.mjs");
assert.equal(base.scripts[script], undefined);
const candidateScripts = { ...candidate.scripts };
delete candidateScripts[script];
assert.deepEqual(candidateScripts, base.scripts);
assert.deepEqual({ ...candidate, scripts: base.scripts, engines: base.engines }, base);

const manifestFile = path.join(target, "package.json");
const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
assert.deepEqual(manifest, JSON.parse(git(target, "show", runtime + ":package.json")));
assert.deepEqual(manifest.engines, candidate.engines);
manifest.scripts[script] = candidate.scripts[script];

const modulePath = "scripts/integration-runtime.mjs";
const baseModule = git(source, "show", main + ":" + modulePath);
const securityModule = git(source, "show", security + ":" + modulePath);
assert.equal(securityModule, baseModule.replace('"shared/log-redaction", "server"', '"shared/log-redaction", "shared/log-controller", "server"'));
const moduleFile = path.join(target, modulePath);
const previousModule = readFileSync(moduleFile, "utf8");
assert.equal(previousModule.replaceAll("\r\n", "\n"), git(target, "show", runtime + ":" + modulePath));
const anchor = '"shared/log-redaction", "scripts/migrate", "server"';
assert.equal(previousModule.split(anchor).length, 2);
const composedModule = previousModule.replace(anchor, '"shared/log-redaction", "shared/log-controller", "scripts/migrate", "server"');
writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(moduleFile, composedModule);
git(target, "add", "package.json", modulePath);
// SQL, the journal, schema, entrypoint and both driver patch sets remain owned
// by the fixed runtime candidate, never by this test-only composition helper.
git(target, "diff", "--exit-code", runtime, "--", "apps/api/src/db", "scripts/api-entrypoint.sh", "scripts/apply-postgres-lifecycle-patch.mjs");
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
console.log(JSON.stringify({
  fixedMain: main, fixedRuntime: runtime, securityHead: security,
  rootManifestSha256: sha256(readFileSync(manifestFile)), runtimeManifestSha256: sha256(composedModule),
  sourceChanges: ["scripts.test:dependency-security", "criticalSourceModules.shared/log-controller"],
  existingRuntimeScriptsPreserved: true, existingRuntimeMigrationAndDriverInputsPreserved: true,
}, null, 2));
