import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { csvField, toCsv, type ExportJson } from '../src/export.js';
import { FORTNIGHT_NOW, seedFortnight } from './fortnight.js';
import { closeDb, cookieHeader, db, makeApp, migrateOnce, resetDb } from './helpers.js';

let app: Awaited<ReturnType<typeof makeApp>>;

beforeAll(async () => {
  await migrateOnce();
});
afterAll(async () => {
  await closeDb();
});
beforeEach(async () => {
  await resetDb();
  app = await makeApp({ now: FORTNIGHT_NOW });
});
afterEach(async () => {
  await app.close();
});

const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: cookieHeader(cookie) });
const lines = (body: string) => body.split('\n');

describe('CSV writer', () => {
  it('quotes commas, quotes and line breaks per RFC 4180, leaves plain fields bare and empties null', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField(1500)).toBe('1500');
    expect(csvField(true)).toBe('true');
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
    expect(csvField('')).toBe('');
    expect(csvField('a, b')).toBe('"a, b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
    expect(csvField('cr\r\nlf')).toBe('"cr\r\nlf"');
    // A cheer note with both a comma and a quote, as it would appear in a row.
    expect(toCsv([['date', 'note'], ['2026-10-06', 'Great class, "beast mode"!'], ['2026-10-07', null]])).toBe(
      'date,note\n2026-10-06,"Great class, ""beast mode""!"\n2026-10-07,\n',
    );
  });
});

describe('GET /api/export.json', () => {
  it('has every section with the expected rows, the partner’s metrics only when shared, own photos only', async () => {
    const f = await seedFortnight(app);
    const res = await get(f.enes, '/api/export.json');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(res.headers['content-disposition']).toBe('attachment; filename="hydrox45-export-2026-10-19.json"');

    const data = JSON.parse(res.body) as ExportJson;
    expect(Object.keys(data)).toEqual(['exportedAt', 'challenge', 'users', 'goals', 'checkins', 'cheers', 'healthDaily', 'bodyMetrics', 'finishTests', 'photos']);
    expect(data.exportedAt).toBe('2026-10-19T16:00:00.000Z');
    expect(data.challenge).toEqual({ name: 'Hydrox 45', startDate: '2026-10-06', lengthDays: 45 });
    expect(data.users).toEqual([
      { id: f.enesId, slug: 'enes', name: 'Enes', kcalTarget: 1600, proteinTargetG: 160 },
      { id: f.agnesId, slug: 'agnes', name: 'Agnes', kcalTarget: 1500, proteinTargetG: 130 },
    ]);
    // Goals: all ten incl. Enes's inactive "strength", with every field.
    expect(data.goals).toHaveLength(10);
    expect(data.goals.find((g) => g.key === 'strength')).toEqual({
      id: expect.any(Number), userId: f.enesId, key: 'strength', label: 'Strength training', kind: 'bool', unit: null,
      direction: null, dailyTarget: null, weeklyTarget: null, sort: 4, active: false, source: 'manual',
    });
    expect(data.goals.find((g) => g.key === 'f45')).toMatchObject({ userId: f.agnesId, weeklyTarget: 3, kind: 'bool', active: true });

    expect(data.checkins).toHaveLength(31); // 17 of Enes's + 14 of Agnes's
    expect(data.checkins[0]).toEqual({
      userId: f.enesId, date: '2026-10-06', day: 1, goalId: f.goals.walk, value: 1, hit: true, updatedAt: expect.any(String),
    });
    expect(data.checkins.filter((c) => c.userId === f.agnesId)).toHaveLength(14);
    expect(data.checkins.find((c) => c.goalId === f.goals.kcal && c.date === '2026-10-08')).toMatchObject({ value: 1700, hit: false });

    expect(data.cheers).toHaveLength(5);
    expect(data.cheers[0]).toMatchObject({ fromUserId: f.enesId, toUserId: f.agnesId, date: '2026-10-06', emoji: '👏', note: null });
    expect(data.healthDaily).toEqual([
      { userId: f.enesId, date: '2026-10-13', day: 8, steps: 9000, activeKcal: null, source: 'shortcut', updatedAt: expect.any(String) },
      { userId: f.enesId, date: '2026-10-15', day: 10, steps: 3000, activeKcal: null, source: 'shortcut', updatedAt: expect.any(String) },
      { userId: f.enesId, date: '2026-10-17', day: 12, steps: 12000, activeKcal: null, source: 'shortcut', updatedAt: expect.any(String) },
    ]);
    // Metrics: mine plus Agnes's (shared by default), oldest first.
    expect(data.bodyMetrics.map((m) => [m.userId, m.date, m.weightKg, m.waistCm])).toEqual([
      [f.enesId, '2026-10-06', 82, 92],
      [f.agnesId, '2026-10-07', 65, null],
      [f.enesId, '2026-10-18', 80.5, 90],
    ]);
    expect(data.bodyMetrics[0]).toMatchObject({ day: 1, hipsCm: null, chestCm: null, armCm: null, thighCm: null });
    expect(data.finishTests.map((t) => [t.userId, t.key])).toEqual([
      [f.agnesId, 'pushups'],
      [f.agnesId, 'pullup'],
    ]);
    expect(data.photos).toEqual([
      { id: f.photoId, date: '2026-10-06', kind: 'start', mime: 'image/png', bytes: 1234, width: 4, height: 3, createdAt: expect.any(String), url: `/api/photos/${f.photoId}/file` },
    ]);

    // Agnes's export: her metrics plus Enes's (shared); no photos of her own.
    let hers = JSON.parse((await get(f.agnes, '/api/export.json')).body) as ExportJson;
    expect(hers.bodyMetrics).toHaveLength(3);
    expect(hers.photos).toEqual([]);
    expect(hers.checkins).toHaveLength(31);

    // Enes stops sharing: Agnes no longer gets his rows; he still gets hers.
    await db.updateTable('users').set({ metrics_shared: false }).where('id', '=', f.enesId).execute();
    hers = JSON.parse((await get(f.agnes, '/api/export.json')).body) as ExportJson;
    expect(hers.bodyMetrics.map((m) => m.userId)).toEqual([f.agnesId]);
    const his = JSON.parse((await get(f.enes, '/api/export.json')).body) as ExportJson;
    expect(his.bodyMetrics).toHaveLength(3);

    expect((await app.inject({ method: 'GET', url: '/api/export.json' })).statusCode).toBe(401);
  });
});

describe('GET /api/export.csv', () => {
  it('lists every check-in of both users in long format with the exact header', async () => {
    const f = await seedFortnight(app);
    const res = await get(f.agnes, '/api/export.csv');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe('attachment; filename="hydrox45-checkins-2026-10-19.csv"');

    const rows = lines(res.body);
    expect(rows[0]).toBe('date,day,user,goal_key,goal_label,kind,unit,value,hit');
    expect(rows[rows.length - 1]).toBe(''); // ends with a newline
    expect(rows).toHaveLength(1 + 31 + 1);
    expect(rows.slice(1, 6)).toEqual([
      '2026-10-06,1,enes,walk,Daily walk,bool,,1,true',
      '2026-10-06,1,enes,kcal,Calories,number,kcal,1500,true',
      '2026-10-06,1,enes,protein,Protein,number,g,170,true',
      '2026-10-06,1,agnes,f45,F45 class,bool,,1,true',
      '2026-10-06,1,agnes,kcal,Calories,number,kcal,1400,true',
    ]);
    expect(rows).toContain('2026-10-08,3,enes,walk,Daily walk,bool,,0,false');
    expect(rows).toContain('2026-10-15,10,enes,steps,Steps,number,steps,3000,false');
    expect(rows).toContain('2026-10-19,14,agnes,f45,F45 class,bool,,1,true');
    expect(res.body.includes('\r')).toBe(false);
    expect((await app.inject({ method: 'GET', url: '/api/export.csv' })).statusCode).toBe(401);
  });

  it('is just the header when nothing was logged', async () => {
    const { login } = await import('./helpers.js');
    const enes = await login(app, 'enes');
    expect((await get(enes, '/api/export.csv')).body).toBe('date,day,user,goal_key,goal_label,kind,unit,value,hit\n');
    expect((await get(enes, '/api/export/metrics.csv')).body).toBe('date,day,weight_kg,waist_cm,hips_cm,chest_cm,arm_cm,thigh_cm\n');
    expect((await get(enes, '/api/export/health.csv')).body).toBe('date,day,user,steps,active_kcal\n');
  });
});

describe('GET /api/export/metrics.csv and health.csv', () => {
  it('metrics holds the caller’s rows only; health holds both users', async () => {
    const f = await seedFortnight(app);
    let res = await get(f.enes, '/api/export/metrics.csv');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe('attachment; filename="hydrox45-metrics-2026-10-19.csv"');
    expect(res.body).toBe('date,day,weight_kg,waist_cm,hips_cm,chest_cm,arm_cm,thigh_cm\n2026-10-06,1,82,92,,,,\n2026-10-18,13,80.5,90,,,,\n');

    // Hers, even though Enes shares his: the metrics CSV is never the partner's.
    res = await get(f.agnes, '/api/export/metrics.csv');
    expect(res.body).toBe('date,day,weight_kg,waist_cm,hips_cm,chest_cm,arm_cm,thigh_cm\n2026-10-07,2,65,,,,,\n');

    res = await get(f.agnes, '/api/export/health.csv');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="hydrox45-health-2026-10-19.csv"');
    expect(res.body).toBe('date,day,user,steps,active_kcal\n2026-10-13,8,enes,9000,\n2026-10-15,10,enes,3000,\n2026-10-17,12,enes,12000,\n');
    expect((await app.inject({ method: 'GET', url: '/api/export/health.csv' })).statusCode).toBe(401);
  });
});
