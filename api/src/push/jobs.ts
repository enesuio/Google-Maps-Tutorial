import { dayNumber, todayInToronto } from '../dates.js';
import type { Db } from '../db.js';
import { loadChallenge } from '../views.js';
import type { PushPayload, PushSender } from './sender.js';
import { sendToUser } from './subscriptions.js';

/** Job names on the `hydrox` queue and their data (docs/API.md). */
export interface JobData {
  'evening-reminder': Record<string, never>;
  'partner-checkin': { userId: number; date: string };
  cheer: { cheerId: number };
}
export type JobName = keyof JobData;

export const APP_TITLE = 'Hydrox 45';

export const testPayload = (): PushPayload => ({ title: APP_TITLE, body: 'Notifications are on', url: '/', tag: 'test' });

/**
 * 21:00 Toronto: nudge every user who has not logged anything today.
 * Only during the challenge (day 1..lengthDays); silent before or after.
 */
export async function handleEveningReminder(db: Db, sender: PushSender, now: Date): Promise<void> {
  const today = todayInToronto(now);
  const challenge = await loadChallenge(db);
  const day = dayNumber(today, challenge.startDate);
  if (day < 1 || day > challenge.lengthDays) return;

  const users = await db.selectFrom('users').select('id').orderBy('id', 'asc').execute();
  const entered = new Set(
    (await db.selectFrom('checkins').select('user_id').distinct().where('date', '=', today).execute()).map(
      (r) => r.user_id,
    ),
  );
  for (const user of users) {
    if (entered.has(user.id)) continue;
    await sendToUser(db, sender, user.id, {
      title: APP_TITLE,
      body: `Day ${day} of ${challenge.lengthDays} — nothing logged yet. 30 seconds?`,
      url: '/',
      tag: `reminder-${today}`,
    });
  }
}

/** `userId` just logged their first entry for `date`: tell the partner(s). */
export async function handlePartnerCheckin(
  db: Db,
  sender: PushSender,
  _now: Date,
  data: JobData['partner-checkin'],
): Promise<void> {
  const [challenge, user, others] = await Promise.all([
    loadChallenge(db),
    db.selectFrom('users').select('name').where('id', '=', data.userId).executeTakeFirst(),
    db.selectFrom('users').select('id').where('id', '!=', data.userId).orderBy('id', 'asc').execute(),
  ]);
  if (!user) return;
  const day = dayNumber(data.date, challenge.startDate);
  const payload: PushPayload = {
    title: APP_TITLE,
    body: `${user.name} checked in for Day ${day}`,
    url: `/day/${data.date}`,
    tag: `checkin-${data.userId}-${data.date}`,
  };
  for (const other of others) await sendToUser(db, sender, other.id, payload);
}

/** A cheer was posted: notify its receiver ("Enes cheered your Day 3 👏" + note). */
export async function handleCheer(db: Db, sender: PushSender, _now: Date, data: JobData['cheer']): Promise<void> {
  const cheer = await db
    .selectFrom('cheers')
    .innerJoin('users', 'users.id', 'cheers.from_user')
    .select(['cheers.id', 'cheers.to_user', 'cheers.date', 'cheers.emoji', 'cheers.note', 'users.name as from_name'])
    .where('cheers.id', '=', data.cheerId)
    .executeTakeFirst();
  if (!cheer) return; // deleted before the job ran
  const challenge = await loadChallenge(db);
  const day = dayNumber(cheer.date, challenge.startDate);
  const headline = `${cheer.from_name} cheered your Day ${day} ${cheer.emoji}`;
  await sendToUser(db, sender, cheer.to_user, {
    title: APP_TITLE,
    body: cheer.note ? `${headline} — ${cheer.note}` : headline,
    url: `/day/${cheer.date}`,
    tag: `cheer-${cheer.id}`,
  });
}

/** Dispatches a queued job to its handler. Unknown names are ignored (logged by the worker). */
export async function runJob<N extends JobName>(
  db: Db,
  sender: PushSender,
  now: Date,
  name: N,
  data: JobData[N],
): Promise<void> {
  switch (name) {
    case 'evening-reminder':
      return handleEveningReminder(db, sender, now);
    case 'partner-checkin':
      return handlePartnerCheckin(db, sender, now, data as JobData['partner-checkin']);
    case 'cheer':
      return handleCheer(db, sender, now, data as JobData['cheer']);
    default:
      throw new Error(`Unknown job: ${String(name)}`);
  }
}
