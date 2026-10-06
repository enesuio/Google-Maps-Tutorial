import type { Db } from './db.js';
import { addDays, dayNumber } from './dates.js';
import { totalCheckins } from './streaks.js';
import { loadChallenge, loadEnteredDates, type Challenge } from './views.js';

// ---- Shared types (mirror docs/API.md, T13) ----

export interface Milestone {
  day: number;
  date: string;
  label: string;
  reached: boolean;
  isToday: boolean;
}

export interface TeamView {
  today: string;
  day: number;
  challenge: Challenge;
  /** done = sum of both users' checked-in days; target = 2 × lengthDays. */
  ring: { done: number; target: number };
  perUser: Array<{ userId: number; name: string; isMe: boolean; checkins: number }>;
  /** Days 7, 15, 30, 45. */
  milestones: Milestone[];
}

/** The fixed milestone days with their labels and the phrase used in the push body. */
export const MILESTONES: ReadonlyArray<{ day: number; label: string; phrase: string }> = [
  { day: 7, label: 'One week', phrase: 'one week in' },
  { day: 15, label: 'A third in', phrase: 'a third in' },
  { day: 30, label: 'Two thirds', phrase: 'two thirds in' },
  { day: 45, label: 'Finish line', phrase: 'the finish line' },
];

export function milestonesFor(challenge: Challenge, today: string): Milestone[] {
  return MILESTONES.map((m) => {
    const date = addDays(challenge.startDate, m.day - 1);
    return { day: m.day, date, label: m.label, reached: date <= today, isToday: date === today };
  });
}

export async function buildTeamView(db: Db, meUserId: number, today: string): Promise<TeamView> {
  const challenge = await loadChallenge(db);
  const allUsers = await db.selectFrom('users').select(['id', 'name']).orderBy('id', 'asc').execute();
  const users = [...allUsers.filter((u) => u.id === meUserId), ...allUsers.filter((u) => u.id !== meUserId)];
  const entered = await loadEnteredDates(db, challenge.startDate, today);

  const perUser = users.map((u) => ({
    userId: u.id,
    name: u.name,
    isMe: u.id === meUserId,
    checkins: totalCheckins(entered.get(u.id) ?? new Set<string>(), challenge.startDate, today),
  }));

  return {
    today,
    day: dayNumber(today, challenge.startDate),
    challenge,
    ring: { done: perUser.reduce((sum, u) => sum + u.checkins, 0), target: users.length * challenge.lengthDays },
    perUser,
    milestones: milestonesFor(challenge, today),
  };
}

/** "Day 7 — one week in. Together you've logged 13 of 14 days." */
export function milestonePushBody(day: number, phrase: string, done: number, possible: number): string {
  return `Day ${day} — ${phrase}. Together you've logged ${done} of ${possible} days.`;
}
