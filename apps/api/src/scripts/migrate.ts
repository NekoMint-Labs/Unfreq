import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const usage = "Usage: npm run api:migrate -- [--help]\nApply the bundled SQL migrations using DATABASE_URL; schema generation remains a development command.\n";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(usage);
    return;
  }
  if (args.length !== 0) throw new Error("Invalid migration arguments.");
  // Match the existing local drizzle.config.ts dotenv and URL fallback. This
  // command intentionally does not load unrelated API/provider configuration.
  await import("dotenv/config");
  const databaseUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/unfreq";
  // An empty string makes postgres use PGHOST/PGDATABASE defaults. The former
  // toolkit rejected empty URLs; do not silently migrate a different database.
  if (databaseUrl.trim().length === 0) throw new Error("Empty migration database URL.");
  const client = postgres(databaseUrl, {
    max: 1,
    onnotice: () => undefined,
  });
  try {
    await migrate(drizzle(client), {
      migrationsFolder: fileURLToPath(new URL("../../src/db/migrations/", import.meta.url)),
      migrationsSchema: "drizzle",
      migrationsTable: "__drizzle_migrations",
    });
  } finally {
    await client.end({ timeout: 5 });
  }
  process.stdout.write("Database migrations completed.\n");
}

main().catch(() => {
  // Driver/SQL errors may contain credentials, SQL or data. Do not serialize them.
  process.stderr.write("Database migration failed.\n");
  process.exitCode = 1;
});
