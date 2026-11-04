import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const advisoryUrl = "https://github.com/advisories/GHSA-g3hv-75wg-m249";
// The publisher lists the 10.x firstPhasePreProcess amplification mechanism:
// https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249
// The aggregate database instead matches every version <11.0.1. Keep its raw
// report intact; accept only this source-pinned v3 implementation, which has no
// preprocessing phase. Never waive another advisory or an additional copy.
const knownV3 = {
  version: "3.1.5",
  resolved: "https://registry.npmjs.org/minimatch/-/minimatch-3.1.5.tgz",
  integrity: "sha512-VgjWUsnnT6n+NUk6eZq77zeFdpW2LWDzP6zFGrCbHXiYNul5Dzqk2HHQ5uFH2DNW5Xbp8+jVzaeNt94ssEEl4w==",
  sourceSha256: "746849f267c4868a53729225bd85c7dccd387712136fb305fcc0a3eadd4a3d9d",
};

try {
  assert.equal(process.argv.length, 3, "Pass the complete official npm audit JSON report.");
  const report = JSON.parse(await readFile(path.resolve(process.argv[2]), "utf8"));
  assert.equal(report.auditReportVersion, 2, "Unexpected audit report format.");
  assert.ok(report.metadata?.vulnerabilities && report.vulnerabilities, "Missing official audit data.");
  const records = report.vulnerabilities;
  const names = Object.keys(records);
  assert.equal(report.metadata.vulnerabilities.total, names.length, "Audit metadata does not match its records.");
  if (names.length === 0) {
    console.log(JSON.stringify({ rawPackageRecords: 0, nonApplicableRecords: [], unexpectedRecords: [] }));
  } else {
    const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
    const pinned = lock.packages["node_modules/minimatch"];
    for (const key of ["version", "resolved", "integrity"]) assert.equal(pinned?.[key], knownV3[key], `Legacy minimatch ${key} changed; re-investigate the advisory.`);
    const installed = JSON.parse(await readFile(path.join(root, "node_modules/minimatch/package.json"), "utf8"));
    assert.equal(installed.version, knownV3.version);
    const source = await readFile(path.join(root, "node_modules/minimatch/minimatch.js"));
    assert.equal(createHash("sha256").update(source).digest("hex"), knownV3.sourceSha256, "Legacy minimatch source changed; its disposition no longer applies.");
    const leaf = records.minimatch;
    assert.ok(leaf, "The remaining reports have no known advisory leaf.");
    assert.deepEqual(leaf.nodes, ["node_modules/minimatch"], "An additional affected minimatch copy needs remediation.");
    assert.equal(leaf.via.length, 1);
    assert.equal(leaf.via[0].name, "minimatch");
    assert.equal(leaf.via[0].url, advisoryUrl);
    assert.equal(leaf.via[0].title, "minimatch has potential denial of service via globparts amplification");
    assert.equal(leaf.via[0].severity, "moderate");

    const knownOnly = (start) => {
      const seen = new Set();
      let reachedKnownLeaf = false;
      const visit = (name) => {
        if (seen.has(name)) return true; // Audit effects may form ESLint peer cycles.
        seen.add(name);
        const record = records[name];
        if (!record || record.name !== name || record.severity !== "moderate" || !Array.isArray(record.via) || record.via.length === 0) return false;
        return record.via.every((via) => {
          if (typeof via === "string") return visit(via);
          if (name !== "minimatch" || via.url !== advisoryUrl || via !== leaf.via[0]) return false;
          reachedKnownLeaf = true;
          return true;
        });
      };
      return visit(start) && reachedKnownLeaf;
    };
    const unexpected = names.filter((name) => !knownOnly(name));
    console.log(JSON.stringify({
      rawPackageRecords: names.length,
      nonApplicableAdvisory: advisoryUrl,
      nonApplicableVersion: knownV3.version,
      nonApplicableRecords: names.filter((name) => !unexpected.includes(name)),
      unexpectedRecords: unexpected,
      rawReportPreserved: true,
    }));
    assert.deepEqual(unexpected, [], "New or still-applicable dependency findings require remediation.");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
