import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const metadata = JSON.parse(await readFile(path.join(root, "patches", "postgres-3.4.9-startup.json"), "utf8"));
const patchText = (await readFile(path.join(root, "patches", "postgres-3.4.9-startup.patch"), "utf8")).replaceAll("\r\n", "\n");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function parsePatch(text) {
  const files = new Map();
  let current;
  let hunk;
  for (const line of text.split("\n")) {
    const file = /^diff --git a\/node_modules\/postgres\/(\S+) b\/node_modules\/postgres\/\1$/u.exec(line);
    if (file) {
      current = [];
      if (files.has(file[1])) throw new Error("Duplicate PostgreSQL patch target.");
      files.set(file[1], current);
      hunk = undefined;
    } else if (line.startsWith("@@ ")) {
      const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u.exec(line);
      if (!current || !header) throw new Error("Invalid PostgreSQL patch hunk.");
      hunk = { start: Number(header[1]) - 1, lines: [] };
      current.push(hunk);
    } else if (hunk && /^[ +\-]/u.test(line)) {
      hunk.lines.push(line);
    } else if (line && !line.startsWith("--- ") && !line.startsWith("+++ ")) {
      throw new Error("Unsupported PostgreSQL patch content.");
    }
  }
  const expected = metadata.files.map((file) => file.path).sort();
  if (JSON.stringify([...files.keys()].sort()) !== JSON.stringify(expected)) throw new Error("Unexpected PostgreSQL patch targets.");
  return files;
}

const hunks = parsePatch(patchText);

function applyHunks(source, changes) {
  const lines = source.split("\n");
  const output = [];
  let cursor = 0;
  for (const hunk of changes) {
    if (hunk.start < cursor) throw new Error("Overlapping PostgreSQL patch hunks.");
    output.push(...lines.slice(cursor, hunk.start));
    cursor = hunk.start;
    for (const line of hunk.lines) {
      const content = line.slice(1);
      if (line[0] !== "+") {
        if (lines[cursor] !== content) throw new Error("PostgreSQL patch context changed.");
        cursor += 1;
      }
      if (line[0] !== "-") output.push(content);
    }
  }
  return [...output, ...lines.slice(cursor)].join("\n");
}

export async function applyPostgresStartupPatch(packageDirectory = path.join(root, "node_modules", "postgres")) {
  const base = path.resolve(packageDirectory);
  const pkg = JSON.parse(await readFile(path.join(base, "package.json"), "utf8"));
  const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
  const locked = lock.packages["node_modules/postgres"];
  if (pkg.name !== metadata.package || pkg.version !== metadata.version ||
      locked?.version !== metadata.version || locked.integrity !== metadata.integrity) {
    throw new Error("PostgreSQL startup patch requires the exact pinned package and lock integrity; review it before upgrading.");
  }
  const writes = [];
  for (const file of metadata.files) {
    const target = path.resolve(base, file.path);
    if (!target.startsWith(`${base}${path.sep}`)) throw new Error("Unsafe PostgreSQL patch path.");
    const source = await readFile(target, "utf8");
    const hash = sha256(source);
    if (hash === file.patchedSha256) continue;
    if (hash !== file.originalSha256) throw new Error(`Refusing an unknown PostgreSQL source: ${file.path}`);
    const patched = applyHunks(source, hunks.get(file.path));
    if (sha256(patched) !== file.patchedSha256) throw new Error(`PostgreSQL patch output hash mismatch: ${file.path}`);
    writes.push({ target, patched });
  }
  // Validate all ESM/CJS inputs and outputs before changing any installed file.
  // A known patched file is idempotent; source drift fails instead of guessing.
  for (const { target, patched } of writes) {
    const temporary = `${target}.unfreq-${process.pid}.tmp`;
    await writeFile(temporary, patched);
    await rename(temporary, target);
  }
  return { package: metadata.package, version: metadata.version, applied: writes.length, verified: metadata.files.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await applyPostgresStartupPatch()));
}
