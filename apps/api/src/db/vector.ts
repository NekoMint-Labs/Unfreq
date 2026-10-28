import { customType } from "drizzle-orm/pg-core";

type PgVectorConfig = {
  dimensions: number;
};

function assertFiniteVectorValue(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error("Vector values must be finite numbers.");
  }

  return String(value);
}

export function serializePgVector(value: number[]): string {
  return `[${value.map(assertFiniteVectorValue).join(",")}]`;
}

export function parsePgVector(value: number[] | string): number[] {
  if (Array.isArray(value)) {
    return value;
  }

  const text = value.trim();

  if (!text.startsWith("[") || !text.endsWith("]")) {
    throw new Error("Invalid pgvector value.");
  }

  const body = text.slice(1, -1).trim();

  if (body.length === 0) {
    return [];
  }

  const parsed = body.split(",").map((item) => Number(item.trim()));

  if (parsed.some((item) => !Number.isFinite(item))) {
    throw new Error("Invalid pgvector numeric value.");
  }

  return parsed;
}

export const pgVector = customType<{
  config: PgVectorConfig;
  configRequired: false;
  data: number[];
  driverData: string;
}>({
  dataType(config) {
    return config === undefined ? "vector" : `vector(${config.dimensions})`;
  },
  fromDriver(value) {
    return parsePgVector(value);
  },
  toDriver(value) {
    return serializePgVector(value);
  },
});
