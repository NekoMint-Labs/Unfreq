import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../config/env.js";
import * as schema from "./schema.js";

const queryClient = postgres(env.databaseUrl, {
  // Retain v3 value inference while the separate v4 migration changes transport.
  infer: true,
  connect_timeout: Math.ceil(env.healthDependencyTimeoutMs / 1000),
  max: env.dbPoolMax,
  prepare: false,
});

export const db = drizzle(queryClient, { schema });

export async function checkDatabaseConnection() {
  await queryClient`select 1`;
}

export async function closeDatabaseConnection(options: { timeoutSeconds?: number } = {}) {
  await queryClient.end({ timeout: options.timeoutSeconds ?? 5 });
}
