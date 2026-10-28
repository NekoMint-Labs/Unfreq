import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../config/env.js";
import * as schema from "./schema.js";

const queryClient = postgres(env.databaseUrl, {
  connect_timeout: Math.ceil(env.healthDependencyTimeoutMs / 1000),
  max: env.dbPoolMax,
  prepare: false,
});

export const db = drizzle(queryClient, { schema });

export async function checkDatabaseConnection() {
  await queryClient`select 1`;
}

export async function closeDatabaseConnection() {
  await queryClient.end({ timeout: 5 });
}
