const usage = `Read-only identity mirror audit. Reports counts, UUIDs and field names; never repairs data.
Usage: npm --workspace @unfreq/api run identity:audit -- [--limit <1-200>]`;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    process.stdout.write(`${usage}\n`);
    return;
  }
  const sampleLimit = args.length === 0 ? 50 : args.length === 2 && args[0] === "--limit" && /^\d+$/u.test(args[1]!)
    ? Number(args[1]) : NaN;
  if (!Number.isInteger(sampleLimit) || sampleLimit < 1 || sampleLimit > 200) throw new Error("Invalid arguments.");
  // Help and argument rejection do not load database/environment configuration.
  const { closeDatabaseConnection } = await import("../db/client.js");
  try {
    const { auditIdentityMirrors } = await import("../modules/auth/identity-audit.js");
    const result = await auditIdentityMirrors(sampleLimit);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.counts.missingMirror + result.counts.orphanMirror + result.counts.fieldMismatch > 0) process.exitCode = 2;
  } finally {
    await closeDatabaseConnection();
  }
}

main().catch(() => {
  // Database errors can contain secrets or row values. Keep stderr generic.
  process.stderr.write(`Identity audit failed. No repair was requested.\n${usage}\n`);
  process.exitCode = 1;
});
