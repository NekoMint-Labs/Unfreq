import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { frequencies, users } from "../../db/schema.js";
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
  const [user] = await db
    .insert(users)
    .values({
      email: params.email,
      freqCode: params.freqCode,
      isGuest: false,
    })
    .onConflictDoNothing({
      target: users.email,
    })
    .returning();

  if (user === undefined) {
    const existingUser = await findUserByEmail(params.email);

    if (existingUser !== undefined) {
      await upsertFrequencyMirror(existingUser);

      return existingUser;
    }

    throw new Error("User insert returned no row.");
  }

  await upsertFrequencyMirror(user);

  return user;
}

export async function createGuestUser(params: {
  freqCode: string;
}): Promise<AuthUserRecord> {
  const [user] = await db
    .insert(users)
    .values({
      freqCode: params.freqCode,
    })
    .returning();

  if (user === undefined) {
    throw new Error("Guest user insert returned no row.");
  }

  await upsertFrequencyMirror(user);

  return user;
}

export async function createPasswordFrequencyUser(params: {
  freqCode: string;
  passwordHash: string;
}): Promise<AuthUserRecord> {
  const [user] = await db
    .insert(users)
    .values({
      freqCode: params.freqCode,
      isGuest: false,
      passwordHash: params.passwordHash,
    })
    .returning();

  if (user === undefined) {
    throw new Error("Password frequency insert returned no row.");
  }

  await upsertFrequencyMirror(user);

  return user;
}

export async function updateUserFrequencyCredentials(params: {
  frequencyName: string;
  passwordHash: string;
  userId: string;
}): Promise<AuthUserRecord | undefined> {
  const [user] = await db
    .update(users)
    .set({
      frequencyName: params.frequencyName,
      isGuest: false,
      passwordHash: params.passwordHash,
      updatedAt: new Date(),
    })
    .where(eq(users.id, params.userId))
    .returning();

  if (user !== undefined) {
    await upsertFrequencyMirror(user);
  }

  return user;
}

async function upsertFrequencyMirror(user: AuthUserRecord): Promise<void> {
  await db
    .insert(frequencies)
    .values({
      code: user.freqCode,
      createdAt: user.createdAt,
      frequencyName: user.frequencyName,
      id: user.id,
      isGuest: user.isGuest,
      passwordHash: user.passwordHash,
      role: user.role,
      status: user.status,
      updatedAt: user.updatedAt,
    })
    .onConflictDoUpdate({
      target: frequencies.id,
      set: {
        code: user.freqCode,
        frequencyName: user.frequencyName,
        isGuest: user.isGuest,
        passwordHash: user.passwordHash,
        role: user.role,
        status: user.status,
        updatedAt: user.updatedAt,
      },
    });
}
