import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { users } from "../../db/schema.js";
import { syncFrequencyMirror } from "./identity-mirror.js";
import type { AuthUserRecord } from "./types.js";

export async function findUserByEmail(email: string): Promise<AuthUserRecord | undefined> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  return user;
}

export async function findUserByFrequencyName(
  frequencyName: string,
): Promise<AuthUserRecord | undefined> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.frequencyName, frequencyName))
    .limit(1);

  return user;
}

export async function findUserByFreqCode(freqCode: string): Promise<AuthUserRecord | undefined> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.freqCode, freqCode))
    .limit(1);

  return user;
}

export async function findUserById(id: string): Promise<AuthUserRecord | undefined> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  return user;
}

export async function createUser(params: {
  email: string;
  freqCode: string;
}): Promise<AuthUserRecord> {
  return db.transaction(async (transaction) => {
    const [user] = await transaction
      .insert(users)
      .values({
        email: params.email,
        freqCode: params.freqCode,
        isGuest: false,
      })
      .onConflictDoNothing({ target: users.email })
      .returning();

    if (user === undefined) {
      // Read and lock the conflict row inside this same transaction, so an
      // unlocked snapshot cannot overwrite a concurrent credential update.
      const [existingUser] = await transaction.select().from(users)
        .where(eq(users.email, params.email)).limit(1).for("update");
      if (existingUser !== undefined) {
        await syncFrequencyMirror(transaction, existingUser.id);
        return existingUser;
      }
      throw new Error("User insert returned no row.");
    }

    await syncFrequencyMirror(transaction, user.id);
    return user;
  });
}

export async function createGuestUser(params: {
  freqCode: string;
}): Promise<AuthUserRecord> {
  return db.transaction(async (transaction) => {
    const [user] = await transaction
      .insert(users)
      .values({ freqCode: params.freqCode })
      .returning();

    if (user === undefined) throw new Error("Guest user insert returned no row.");
    await syncFrequencyMirror(transaction, user.id);
    return user;
  });
}

export async function createPasswordFrequencyUser(params: {
  freqCode: string;
  passwordHash: string;
}): Promise<AuthUserRecord> {
  return db.transaction(async (transaction) => {
    const [user] = await transaction
      .insert(users)
      .values({
        freqCode: params.freqCode,
        isGuest: false,
        passwordHash: params.passwordHash,
      })
      .returning();

    if (user === undefined) throw new Error("Password frequency insert returned no row.");
    await syncFrequencyMirror(transaction, user.id);
    return user;
  });
}

export async function updateUserFrequencyCredentials(params: {
  frequencyName: string;
  passwordHash: string;
  userId: string;
}): Promise<AuthUserRecord | undefined> {
  return db.transaction(async (transaction) => {
    const [user] = await transaction
      .update(users)
      .set({
        frequencyName: params.frequencyName,
        isGuest: false,
        passwordHash: params.passwordHash,
        updatedAt: new Date(),
      })
      .where(eq(users.id, params.userId))
      .returning();

    if (user !== undefined) await syncFrequencyMirror(transaction, user.id);
    return user;
  });
}
