import { eq, inArray } from "drizzle-orm";
import { closeDatabaseConnection, db } from "../db/client.js";
import { frequencies, users } from "../db/schema.js";

type PromoteAdminLookupTarget =
  | {
      type: "email";
      value: string;
    }
  | {
      type: "frequencyName";
      value: string;
    }
  | {
      type: "freqCode";
      value: string;
    }
  | {
      type: "id";
      value: string;
    };

type PromoteAdminTarget =
  | {
      type: "help";
    }
  | PromoteAdminLookupTarget;

type PromoteAdminResult = {
  email: string | null;
  frequencyName: string | null;
  freqCode: string;
  id: string;
  role: "ADMIN";
  status: "ACTIVE";
};

type ScriptLogger = {
  error: (fields: Record<string, unknown>, message: string) => void;
  info: (fields: Record<string, unknown>, message: string) => void;
};

const usage = `Usage:
  npm --workspace @unfreq/api run admin:promote -- --code <FM-code>
  npm --workspace @unfreq/api run admin:promote -- --email <email>
  npm --workspace @unfreq/api run admin:promote -- --name <legacy-frequency-name>
  npm --workspace @unfreq/api run admin:promote -- --id <user-id>`;

const logger: ScriptLogger = {
  error(fields, message) {
    console.error(JSON.stringify({ level: "error", message, ...fields }));
  },
  info(fields, message) {
    console.info(JSON.stringify({ level: "info", message, ...fields }));
  },
};

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeFrequencyName(value: string): string {
  return value.trim().toLowerCase();
}

function createFreqCodeCandidates(value: string): string[] {
  const trimmed = value.trim().toUpperCase();
  const compact = trimmed.replace(/^FM\s*/, "FM ");
  const hyphenated = compact.replace(/^FM\s+/, "FM-");
  const spaced = compact.replace(/^FM-/, "FM ");

  return Array.from(new Set([trimmed, compact, hyphenated, spaced]));
}

function maskEmail(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const [localPart, domain] = value.split("@");
  const visiblePrefix = (localPart ?? "").slice(0, 2);

  return `${visiblePrefix.length > 0 ? visiblePrefix : "**"}***@${domain ?? "unknown"}`;
}

function parsePromoteAdminTarget(argv: string[]): PromoteAdminTarget {
  const entries: PromoteAdminTarget[] = [];

  if (argv.length === 0) {
    throw new Error(usage);
  }

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];

    if (flag === "--help" || flag === "-h") {
      return { type: "help" };
    }

    if (value === undefined || value.startsWith("--")) {
      throw new Error(usage);
    }

    if (flag === "--email") {
      entries.push({ type: "email", value: normalizeEmail(value) });
      index += 1;
      continue;
    }

    if (flag === "--frequency-name" || flag === "--name") {
      entries.push({ type: "frequencyName", value: normalizeFrequencyName(value) });
      index += 1;
      continue;
    }

    if (flag === "--freq-code" || flag === "--code") {
      entries.push({ type: "freqCode", value });
      index += 1;
      continue;
    }

    if (flag === "--id") {
      entries.push({ type: "id", value: value.trim() });
      index += 1;
      continue;
    }

    throw new Error(usage);
  }

  if (entries.length !== 1) {
    throw new Error(usage);
  }

  return entries[0]!;
}

function toReason(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "unknown";
}

async function findUserByTarget(target: PromoteAdminLookupTarget) {
  if (target.type === "email") {
    const [user] = await db.select().from(users).where(eq(users.email, target.value)).limit(1);

    return user;
  }

  if (target.type === "frequencyName") {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.frequencyName, target.value))
      .limit(1);

    return user;
  }

  if (target.type === "id") {
    const [user] = await db.select().from(users).where(eq(users.id, target.value)).limit(1);

    return user;
  }

  const candidates = createFreqCodeCandidates(target.value);
  const [user] = await db
    .select()
    .from(users)
    .where(inArray(users.freqCode, candidates))
    .limit(1);

  return user;
}

async function promoteAdmin(target: PromoteAdminLookupTarget): Promise<PromoteAdminResult> {
  const existingUser = await findUserByTarget(target);

  if (existingUser === undefined) {
    throw new Error(`No user matched ${target.type}.`);
  }

  const updatedAt = new Date();

  const updatedUser = await db.transaction(async (transaction) => {
    const [user] = await transaction
      .update(users)
      .set({
        role: "ADMIN",
        status: "ACTIVE",
        updatedAt,
      })
      .where(eq(users.id, existingUser.id))
      .returning();

    if (user === undefined) {
      throw new Error("User disappeared before promotion.");
    }

    await transaction
      .insert(frequencies)
      .values({
        code: user.freqCode,
        createdAt: user.createdAt,
        frequencyName: user.frequencyName,
        id: user.id,
        isGuest: user.isGuest,
        passwordHash: user.passwordHash,
        role: "ADMIN",
        status: "ACTIVE",
        updatedAt,
      })
      .onConflictDoUpdate({
        target: frequencies.id,
        set: {
          code: user.freqCode,
          frequencyName: user.frequencyName,
          isGuest: user.isGuest,
          passwordHash: user.passwordHash,
          role: "ADMIN",
          status: "ACTIVE",
          updatedAt,
        },
      });

    return user;
  });

  return {
    email: updatedUser.email,
    frequencyName: updatedUser.frequencyName,
    freqCode: updatedUser.freqCode,
    id: updatedUser.id,
    role: "ADMIN",
    status: "ACTIVE",
  };
}

try {
  const target = parsePromoteAdminTarget(process.argv.slice(2));

  if (target.type === "help") {
    console.info(usage);
    process.exitCode = 0;
  } else {
    logger.info(
      {
        action: "admin.promote.start",
        targetType: target.type,
      },
      "admin promotion started",
    );

    const result = await promoteAdmin(target);

    logger.info(
      {
        action: "admin.promote.complete",
        email: maskEmail(result.email),
        frequencyName: result.frequencyName,
        freqCode: result.freqCode,
        role: result.role,
        status: result.status,
        userId: result.id,
      },
      "admin promotion completed",
    );
  }
} catch (error) {
  logger.error(
    {
      action: "admin.promote.failed",
      reason: toReason(error),
    },
    "admin promotion failed",
  );
  process.exitCode = 1;
} finally {
  await closeDatabaseConnection();
}
