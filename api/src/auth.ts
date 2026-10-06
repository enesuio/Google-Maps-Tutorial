import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import type { Db } from './db.js';

export const SESSION_COOKIE = 'hx_session';
export const SESSION_DAYS = 365;
export const SESSION_MAX_AGE_SECONDS = SESSION_DAYS * 24 * 60 * 60;

export interface SessionUser {
  id: number;
  slug: string;
  name: string;
}

export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function createSetupToken(db: Db, userId: number): Promise<string> {
  const token = randomToken();
  await db.insertInto('setup_tokens').values({ token, user_id: userId }).execute();
  return token;
}

/** Marks the token used and returns its user id, or null if unknown / already used. Atomic. */
export async function consumeSetupToken(db: Db, token: string): Promise<number | null> {
  const row = await db
    .updateTable('setup_tokens')
    .set({ used_at: sql`now()` })
    .where('token', '=', token)
    .where('used_at', 'is', null)
    .returning('user_id')
    .executeTakeFirst();
  return row?.user_id ?? null;
}

export async function createSession(db: Db, userId: number, now: Date): Promise<string> {
  const id = randomToken();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000);
  await db.insertInto('sessions').values({ id, user_id: userId, created_at: now, expires_at: expiresAt }).execute();
  return id;
}

export async function findSessionUser(db: Db, sessionId: string, now: Date): Promise<SessionUser | null> {
  const row = await db
    .selectFrom('sessions')
    .innerJoin('users', 'users.id', 'sessions.user_id')
    .select(['users.id', 'users.slug', 'users.name'])
    .where('sessions.id', '=', sessionId)
    .where('sessions.expires_at', '>', now)
    .executeTakeFirst();
  return row ?? null;
}

export async function deleteSession(db: Db, sessionId: string): Promise<void> {
  await db.deleteFrom('sessions').where('id', '=', sessionId).execute();
}
