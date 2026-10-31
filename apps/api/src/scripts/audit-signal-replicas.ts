const usage = `Read-only signal replica inventory. Reports explicit IDs/counts and referenced audio states; never repairs or deletes.
Usage: npm --workspace @unfreq/api run replicas:audit -- <signal UUID> [--limit <1-200>]
Exit codes: 0 inventory produced; 2 signal missing; 1 invalid arguments or execution failed.`;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    process.stdout.write(`${usage}\n`);
    return;
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  const signalId = args[0];
  const sampleLimit = args.length === 1 ? 50 : args.length === 3 && args[1] === "--limit" && /^\d+$/u.test(args[2]!)
    ? Number(args[2]) : NaN;
  if (signalId === undefined || !uuid.test(signalId) || !Number.isInteger(sampleLimit) || sampleLimit < 1 || sampleLimit > 200) {
    throw new Error("Invalid arguments.");
  }
  // Do not initialize config/database on help or invalid parameters.
  const { closeDatabaseConnection } = await import("../db/client.js");
  try {
    const { auditSignalReplicas } = await import("../modules/signals/replica-audit.js");
    const report = await auditSignalReplicas(signalId.toLowerCase(), sampleLimit);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.signal === null) process.exitCode = 2;
  } finally {
    await closeDatabaseConnection();
  }
}

main().catch(() => {
  process.stderr.write(`Signal replica inventory failed. No repair or deletion was requested.\n${usage}\n`);
  process.exitCode = 1;
});
