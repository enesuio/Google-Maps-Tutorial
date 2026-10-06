import { expect } from 'vitest';
import type { makeApp } from './helpers.js';
import { cookieHeader, db, goalId, login, userId } from './helpers.js';

type App = Awaited<ReturnType<typeof makeApp>>;

/** Monday Oct 19 2026, noon Toronto → challenge day 14 (the fortnight fixture's "today"). */
export const FORTNIGHT_NOW = () => new Date('2026-10-19T16:00:00Z');
export const FORTNIGHT_TODAY = '2026-10-19';

const json = <T>(res: { body: string }): T => JSON.parse(res.body) as T;

export interface Fortnight {
  enes: string;
  agnes: string;
  enesId: number;
  agnesId: number;
  goals: { walk: number; kcal: number; protein: number; steps: number; f45: number; akcal: number; aprotein: number; practice: number };
  photoId: number;
}

/**
 * Two weeks of known data up to day 14 (Mon Oct 19 2026), used by the summary and export tests.
 *
 * Enes (4 active goals): logs Oct 6–10 (walk/kcal/protein), misses 11 and 12 (streak breaks),
 * logs 13, 14, 15, misses 16 (forgiven), logs 17, misses 18 and nothing yet today →
 * 9 days, best streak 5, current 4. Steps imported on 13 (9000), 15 (3000), 17 (12000).
 * Agnes (5 active goals): logs every other day Oct 6–19 including today → 8 days, streak 8;
 * F45 three times in week 1, twice in week 2, once today.
 * Cheers: Enes → Agnes 👏 🔥 👏 🔥 (tie → 👏 first); Agnes → Enes 💪.
 * Body: Enes 82 kg / 92 cm on Oct 6 and 80.5 / 90 on Oct 18; Agnes 65 kg on Oct 7.
 * Photos: one start photo for Enes (Oct 6).
 */
export async function seedFortnight(app: App): Promise<Fortnight> {
  const enes = await login(app, 'enes');
  const agnes = await login(app, 'agnes');
  const enesId = await userId('enes');
  const agnesId = await userId('agnes');
  const [walk, kcal, protein, steps] = await Promise.all([
    goalId('enes', 'walk'), goalId('enes', 'kcal'), goalId('enes', 'protein'), goalId('enes', 'steps'),
  ]);
  const [f45, akcal, aprotein, practice] = await Promise.all([
    goalId('agnes', 'f45'), goalId('agnes', 'kcal'), goalId('agnes', 'protein'), goalId('agnes', 'practice'),
  ]);

  async function checkin(cookie: string, date: string, entries: unknown[]) {
    const res = await app.inject({ method: 'PUT', url: `/api/checkins/${date}`, headers: cookieHeader(cookie), payload: { entries } });
    expect(res.statusCode, res.body).toBe(200);
  }
  async function cheer(cookie: string, toUserId: number, date: string, emoji: string) {
    const res = await app.inject({ method: 'POST', url: '/api/cheers', headers: cookieHeader(cookie), payload: { toUserId, date, emoji } });
    expect(res.statusCode, res.body).toBe(201);
  }
  async function metrics(cookie: string, date: string, payload: Record<string, number>) {
    const res = await app.inject({ method: 'PUT', url: `/api/metrics/${date}`, headers: cookieHeader(cookie), payload });
    expect(res.statusCode, res.body).toBe(200);
  }
  async function importSteps(cookie: string, dates: Array<[string, number]>) {
    const tok = await app.inject({ method: 'POST', url: '/api/import/token', headers: cookieHeader(cookie) });
    const { token } = json<{ token: string }>(tok);
    for (const [date, n] of dates) {
      const res = await app.inject({ method: 'POST', url: '/api/import', headers: { authorization: `Bearer ${token}` }, payload: { date, steps: n } });
      expect(res.statusCode, res.body).toBe(200);
    }
  }

  // Enes
  await checkin(enes, '2026-10-06', [{ goalId: walk, value: true }, { goalId: kcal, value: 1500 }, { goalId: protein, value: 170 }]); // 3 hits
  await checkin(enes, '2026-10-07', [{ goalId: walk, value: true }]); // 1
  await checkin(enes, '2026-10-08', [{ goalId: walk, value: false }, { goalId: kcal, value: 1700 }]); // 0
  await checkin(enes, '2026-10-09', [{ goalId: kcal, value: 1550 }]); // 1
  await checkin(enes, '2026-10-10', [{ goalId: walk, value: true }, { goalId: kcal, value: 1400 }]); // 2
  await checkin(enes, '2026-10-13', [{ goalId: walk, value: true }]); // 1 (+ steps hit)
  await checkin(enes, '2026-10-14', [{ goalId: kcal, value: 1600 }]); // 1 (at most 1600)
  await checkin(enes, '2026-10-15', [{ goalId: walk, value: true }, { goalId: protein, value: 165 }]); // 2 (steps miss)
  await checkin(enes, '2026-10-17', [{ goalId: walk, value: true }]); // 1 (+ steps hit)
  await importSteps(enes, [['2026-10-13', 9000], ['2026-10-15', 3000], ['2026-10-17', 12000]]);
  await metrics(enes, '2026-10-06', { weightKg: 82, waistCm: 92 });
  await metrics(enes, '2026-10-18', { weightKg: 80.5, waistCm: 90 });

  // Agnes
  await checkin(agnes, '2026-10-06', [{ goalId: f45, value: true }, { goalId: akcal, value: 1400 }]); // 2
  await checkin(agnes, '2026-10-08', [{ goalId: f45, value: true }]); // 1
  await checkin(agnes, '2026-10-10', [{ goalId: f45, value: true }, { goalId: practice, value: true }]); // 2 → F45 week 1: 3
  await checkin(agnes, '2026-10-12', [{ goalId: f45, value: true }, { goalId: akcal, value: 1600 }]); // 1
  await checkin(agnes, '2026-10-14', [{ goalId: f45, value: false }, { goalId: practice, value: true }]); // 1
  await checkin(agnes, '2026-10-15', [{ goalId: akcal, value: 1450 }, { goalId: aprotein, value: 140 }]); // 2
  await checkin(agnes, '2026-10-17', [{ goalId: f45, value: true }]); // 1 → F45 week 2: 2
  await checkin(agnes, '2026-10-19', [{ goalId: practice, value: true }, { goalId: f45, value: true }]); // 2 (today)
  await metrics(agnes, '2026-10-07', { weightKg: 65 });

  // Cheers (created in this order, so ties resolve to 👏)
  await cheer(enes, agnesId, '2026-10-06', '👏');
  await cheer(enes, agnesId, '2026-10-08', '🔥');
  await cheer(enes, agnesId, '2026-10-10', '👏');
  await cheer(enes, agnesId, '2026-10-12', '🔥');
  await cheer(agnes, enesId, '2026-10-13', '💪');

  // One start photo for Enes (metadata only; the summary and export never read the file).
  const photo = await db
    .insertInto('photos')
    .values({ user_id: enesId, date: '2026-10-06', kind: 'start', path: `${enesId}/1.png`, mime: 'image/png', bytes: 1234, width: 4, height: 3 })
    .returning('id')
    .executeTakeFirstOrThrow();

  return {
    enes,
    agnes,
    enesId,
    agnesId,
    goals: { walk, kcal, protein, steps, f45, akcal, aprotein, practice },
    photoId: photo.id,
  };
}
