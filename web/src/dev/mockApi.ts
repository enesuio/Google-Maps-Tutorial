// Dev-only in-memory API, enabled with `VITE_MOCK_API=1 pnpm --filter web dev`.
// Never imported in production builds (see main.tsx).
import type {
  Cheer,
  DayView,
  GoalView,
  HistoryDay,
  HistoryView,
  MetricPoint,
  MetricsSeries,
  MetricsView,
  PostCheerBody,
  PushStatus,
  PushSubscriptionBody,
  PutCheckinsBody,
  PutMetricsBody,
  PutMetricsSharingBody,
  Streak,
  UserDayView,
} from '../api/types';
import { CHEER_EMOJI } from '../api/types';
import { addDays, daysBetween, isValidISODate, weekdayIndex } from '../lib/dates';
import { avg7 } from '../lib/chart';
import { computeHit } from '../lib/goals';

const MOCK_MARKER = 'hx-mock-api-v2'; // grep target: must not appear in dist/

const challenge = { name: 'Hydrox 45', startDate: '2026-10-06', lengthDays: 45 };
let today = '2026-10-15'; // Day 10

type GoalDef = Omit<GoalView, 'value' | 'hit' | 'weekCount'>;
interface UserDef {
  id: number;
  slug: string;
  name: string;
  goals: GoalDef[];
}

const users: UserDef[] = [
  {
    id: 1,
    slug: 'enes',
    name: 'Enes',
    goals: [
      { id: 1, key: 'walk', label: 'Daily walk', kind: 'bool', unit: null, direction: null, dailyTarget: null, weeklyTarget: null },
      { id: 2, key: 'kcal', label: 'Calories', kind: 'number', unit: 'kcal', direction: 'at_most', dailyTarget: 1600, weeklyTarget: null },
      { id: 3, key: 'protein', label: 'Protein', kind: 'number', unit: 'g', direction: 'at_least', dailyTarget: 160, weeklyTarget: null },
    ],
  },
  {
    id: 2,
    slug: 'partner',
    name: 'Mia',
    goals: [
      { id: 10, key: 'f45', label: 'F45 class', kind: 'bool', unit: null, direction: null, dailyTarget: null, weeklyTarget: 3 },
      { id: 11, key: 'kcal', label: 'Calories', kind: 'number', unit: 'kcal', direction: 'at_most', dailyTarget: 1500, weeklyTarget: null },
      { id: 12, key: 'protein', label: 'Protein', kind: 'number', unit: 'g', direction: 'at_least', dailyTarget: 130, weeklyTarget: null },
    ],
  },
];
const ME_ID = 1;

// checkins: `${userId}|${date}|${goalId}` → value
const checkins = new Map<string, number>();
const key = (u: number, d: string, g: number) => `${u}|${d}|${g}`;
// cheers, newest id last
let cheers: Cheer[] = [];
let nextCheerId = 100;

// body metrics: `${userId}|${date}` → { weightKg, waistCm }
interface MetricRow {
  weightKg: number | null;
  waistCm: number | null;
}
const metrics = new Map<string, MetricRow>();
const mkey = (u: number, d: string) => `${u}|${d}`;
const metricsShared = new Map<number, boolean>();

// push
const pushEnabled = true;
const FAKE_VAPID_PUBLIC = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';
const pushSubs = new Set<string>(); // endpoints for ME

function seed() {
  checkins.clear();
  const set = (u: number, d: string, g: number, v: number) => checkins.set(key(u, d, g), v);
  const me = (d: string, walk: number | null, kcal: number | null, protein: number | null) => {
    if (walk !== null) set(1, d, 1, walk);
    if (kcal !== null) set(1, d, 2, kcal);
    if (protein !== null) set(1, d, 3, protein);
  };
  const her = (d: string, f45: number | null, kcal: number | null, protein: number | null) => {
    if (f45 !== null) set(2, d, 10, f45);
    if (kcal !== null) set(2, d, 11, kcal);
    if (protein !== null) set(2, d, 12, protein);
  };
  // Me: Days 1–3 in, Day 4 missed (forgiven), Days 5–8 in, Day 9 missed, Day 10 (today) started.
  // → current streak 5 before today (Days 5–8 + today once something is entered), graceUsed.
  me('2026-10-06', 1, 1550, 165);
  me('2026-10-07', 1, 1700, 150);
  me('2026-10-08', 1, 1480, 170);
  // 2026-10-09 missed
  me('2026-10-10', 1, 1600, 162);
  me('2026-10-11', 1, 1520, 158);
  me('2026-10-12', 0, 1650, 171);
  me('2026-10-13', 1, 1590, 166);
  // 2026-10-14 missed
  me('2026-10-15', 1, null, null); // today: walk done, numbers not yet
  // Partner: every day in, no misses, 3 F45 classes last week.
  her('2026-10-06', 1, 1480, 120);
  her('2026-10-07', 0, 1450, 135);
  her('2026-10-08', 1, 1510, 128);
  her('2026-10-09', 0, 1420, 131);
  her('2026-10-10', 1, 1490, 140);
  her('2026-10-11', 0, 1600, 125);
  her('2026-10-12', 0, 1380, 133);
  her('2026-10-13', 1, 1470, 136);
  her('2026-10-14', 0, 1440, 129);
  her('2026-10-15', 1, 1390, null); // today

  cheers = [
    { id: 1, fromUserId: 2, toUserId: 1, date: '2026-10-06', emoji: '👏', note: 'Day 1 done!', createdAt: '2026-10-06T21:12:00Z' },
    { id: 2, fromUserId: 1, toUserId: 2, date: '2026-10-06', emoji: '🔥', note: null, createdAt: '2026-10-06T21:40:00Z' },
    { id: 3, fromUserId: 2, toUserId: 1, date: '2026-10-15', emoji: '💪', note: 'Nice walk streak', createdAt: '2026-10-15T08:02:00Z' },
    { id: 4, fromUserId: 1, toUserId: 2, date: '2026-10-15', emoji: '🫡', note: null, createdAt: '2026-10-15T09:30:00Z' },
  ];
  nextCheerId = 100;

  metrics.clear();
  const w = (u: number, d: string, weightKg: number | null, waistCm: number | null) => metrics.set(mkey(u, d), { weightKg, waistCm });
  w(1, '2026-10-06', 92.4, 101);
  w(1, '2026-10-07', 92.1, null);
  w(1, '2026-10-08', 92.6, null);
  w(1, '2026-10-09', 91.8, null);
  w(1, '2026-10-10', 91.9, null);
  w(1, '2026-10-11', 91.3, null);
  w(1, '2026-10-12', 91.7, null);
  w(1, '2026-10-13', 91.0, 100);
  w(1, '2026-10-14', 90.8, null);
  // today not yet entered for me
  w(2, '2026-10-06', 68.2, 78);
  w(2, '2026-10-07', 68.4, null);
  w(2, '2026-10-08', 67.9, null);
  w(2, '2026-10-10', 67.6, null);
  w(2, '2026-10-11', 67.8, null);
  w(2, '2026-10-12', 67.3, null);
  w(2, '2026-10-13', 67.5, 77);
  w(2, '2026-10-14', 67.1, null);
  w(2, '2026-10-15', 67.2, null);
  metricsShared.clear();
  metricsShared.set(1, true);
  metricsShared.set(2, true);

  pushSubs.clear();
}
seed();

// ---- streaks ("never miss twice"), same rules as docs/API.md ----
function enteredOn(userId: number, date: string): boolean {
  const u = users.find((x) => x.id === userId);
  return !!u && u.goals.some((g) => checkins.has(key(userId, date, g.id)));
}

function streakFor(userId: number, refDate: string): Streak {
  const start = challenge.startDate;
  let current = 0;
  let misses = 0;
  for (let d = refDate; d >= start; d = addDays(d, -1)) {
    if (enteredOn(userId, d)) {
      current += 1;
      misses = 0;
    } else if (d === today) {
      // today without entries is not a miss yet; it simply isn't counted
    } else {
      misses += 1;
      if (misses >= 2) break; // never miss twice
    }
  }
  const yesterday = addDays(refDate, -1);
  const graceUsed = current > 0 && yesterday >= start && !enteredOn(userId, yesterday);
  return { current, best: Math.max(current, bestStreak(userId, refDate)), graceUsed };
}

function bestStreak(userId: number, refDate: string): number {
  let best = 0;
  let run = 0;
  let misses = 0;
  for (let d = challenge.startDate; d <= refDate; d = addDays(d, 1)) {
    if (enteredOn(userId, d)) {
      run += 1;
      misses = 0;
      best = Math.max(best, run);
    } else if (d === today) {
      // ignore
    } else {
      misses += 1;
      if (misses >= 2) {
        run = 0;
        misses = 0;
      }
    }
  }
  return best;
}

function totalCheckins(userId: number, refDate: string): number {
  let n = 0;
  for (let d = challenge.startDate; d <= refDate; d = addDays(d, 1)) if (enteredOn(userId, d)) n += 1;
  return n;
}

let signedOut = false;

function dayNumber(date: string): number {
  return daysBetween(challenge.startDate, date) + 1;
}

/** Monday..Sunday week containing `date`. */
function weekRange(date: string): string[] {
  const wd = weekdayIndex(date); // 0 = Sun
  const offsetToMonday = (wd + 6) % 7;
  const monday = addDays(date, -offsetToMonday);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

function goalView(userId: number, goal: GoalDef, date: string): GoalView {
  const raw = checkins.get(key(userId, date, goal.id));
  const value = raw === undefined ? null : raw;
  const hit = computeHit(goal, value);
  let weekCount: number | null = null;
  if (goal.weeklyTarget !== null) {
    weekCount = 0;
    for (const d of weekRange(date)) {
      const v = checkins.get(key(userId, d, goal.id));
      if (v !== undefined && computeHit(goal, v) === true) weekCount += 1;
    }
  }
  return { ...goal, value, hit, weekCount };
}

function dayView(date: string): DayView {
  const ordered = [...users].sort((a, b) => Number(b.id === ME_ID) - Number(a.id === ME_ID));
  const us: UserDayView[] = ordered.map((u) => ({
    id: u.id,
    slug: u.slug,
    name: u.name,
    isMe: u.id === ME_ID,
    goals: u.goals.map((g) => goalView(u.id, g, date)),
    streak: streakFor(u.id, date),
    totalCheckins: totalCheckins(u.id, date),
    cheers: cheers
      .filter((c) => c.toUserId === u.id && c.date === date)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  }));
  return { date, day: dayNumber(date), today, challenge, users: us };
}

function historyView(): HistoryView {
  const days: HistoryDay[] = [];
  for (let d = today; d >= challenge.startDate; d = addDays(d, -1)) {
    days.push({
      date: d,
      day: dayNumber(d),
      users: users.map((u) => {
        const views = u.goals.map((g) => goalView(u.id, g, d));
        return {
          userId: u.id,
          hit: views.filter((g) => g.hit === true).length,
          total: views.length,
          entered: views.some((g) => g.value !== null),
        };
      }),
    });
  }
  const ordered = [...users].sort((a, b) => Number(b.id === ME_ID) - Number(a.id === ME_ID));
  return {
    challenge,
    today,
    users: ordered.map((u) => ({ id: u.id, slug: u.slug, name: u.name, isMe: u.id === ME_ID })),
    days,
  };
}

function metricsView(): MetricsView {
  const ordered = [...users].sort((a, b) => Number(b.id === ME_ID) - Number(a.id === ME_ID));
  const series: MetricsSeries[] = ordered.map((u) => {
    const isMe = u.id === ME_ID;
    const shared = metricsShared.get(u.id) ?? true;
    const rows: Array<{ date: string } & MetricRow> = [];
    for (const [k, row] of metrics) {
      const [uid, date] = k.split('|');
      if (Number(uid) === u.id && date && date >= challenge.startDate && date <= today) rows.push({ date, ...row });
    }
    rows.sort((a, b) => a.date.localeCompare(b.date));
    const visible = isMe || shared;
    const points: MetricPoint[] = visible
      ? rows.map((r) => ({ date: r.date, weightKg: r.weightKg, waistCm: r.waistCm, weightAvg7: avg7(rows, r.date) }))
      : [];
    const weights = rows.filter((r) => r.weightKg !== null);
    return {
      userId: u.id,
      name: u.name,
      isMe,
      shared,
      points,
      latestWeightKg: visible ? (weights[weights.length - 1]?.weightKg ?? null) : null,
      startWeightKg: visible ? (weights[0]?.weightKg ?? null) : null,
    };
  });
  return { challenge, today, series };
}

function parseBody<T>(body: string | null): T | undefined {
  try {
    return JSON.parse(body ?? '') as T;
  } catch {
    return undefined;
  }
}

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
  });
}
function error(status: number, code: string, message: string): Response {
  return json(status, { error: { code, message } });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function handle(method: string, path: string, body: string | null): Promise<Response> {
  await sleep(350);
  if (signedOut) return error(401, 'unauthenticated', 'Not signed in');

  if (method === 'POST' && path === '/api/logout') {
    signedOut = true;
    return json(204, undefined);
  }
  if (method === 'GET' && path === '/api/me') {
    const me = users.find((u) => u.id === ME_ID);
    return json(200, { user: { id: me?.id, slug: me?.slug, name: me?.name } });
  }
  if (method === 'GET' && path === '/api/today') return json(200, dayView(today));

  let m = /^\/api\/days\/([^/?]+)$/.exec(path);
  if (method === 'GET' && m) {
    const date = decodeURIComponent(m[1] ?? '');
    if (!isValidISODate(date)) return error(400, 'bad_request', 'Malformed date');
    if (date > today) return error(400, 'future_date', 'Date is in the future');
    return json(200, dayView(date));
  }

  m = /^\/api\/checkins\/([^/?]+)$/.exec(path);
  if (method === 'PUT' && m) {
    const date = decodeURIComponent(m[1] ?? '');
    if (!isValidISODate(date)) return error(400, 'bad_request', 'Malformed date');
    if (date > today) return error(400, 'future_date', 'Date is in the future');
    if (date < challenge.startDate) return error(400, 'before_start', 'Date is before the challenge');
    let parsed: PutCheckinsBody;
    try {
      parsed = JSON.parse(body ?? '') as PutCheckinsBody;
    } catch {
      return error(400, 'bad_request', 'Invalid JSON');
    }
    if (!parsed || !Array.isArray(parsed.entries)) return error(400, 'bad_request', 'entries required');
    const me = users.find((u) => u.id === ME_ID);
    for (const e of parsed.entries) {
      const goal = me?.goals.find((g) => g.id === e.goalId);
      if (!goal) return error(400, 'not_your_goal', `Goal ${e.goalId} is not yours`);
      if (e.value === null) checkins.delete(key(ME_ID, date, goal.id));
      else if (typeof e.value === 'boolean') checkins.set(key(ME_ID, date, goal.id), e.value ? 1 : 0);
      else if (typeof e.value === 'number' && Number.isFinite(e.value)) checkins.set(key(ME_ID, date, goal.id), e.value);
      else return error(400, 'bad_request', 'value must be a number, boolean or null');
    }
    return json(200, dayView(date));
  }

  if (method === 'GET' && path.startsWith('/api/history')) return json(200, historyView());

  // ---- cheers ----
  if (method === 'POST' && path === '/api/cheers') {
    const b = parseBody<PostCheerBody>(body);
    if (!b || typeof b.toUserId !== 'number' || typeof b.date !== 'string' || typeof b.emoji !== 'string')
      return error(400, 'bad_request', 'toUserId, date and emoji required');
    if (!(CHEER_EMOJI as readonly string[]).includes(b.emoji)) return error(400, 'bad_request', 'emoji not allowed');
    if (b.note !== undefined && (typeof b.note !== 'string' || b.note.length > 140))
      return error(400, 'bad_request', 'note too long');
    if (b.toUserId === ME_ID) return error(400, 'bad_request', 'You cannot cheer yourself');
    if (!users.some((u) => u.id === b.toUserId)) return error(400, 'bad_request', 'unknown user');
    if (!isValidISODate(b.date)) return error(400, 'bad_request', 'Malformed date');
    if (b.date > today) return error(400, 'future_date', 'Date is in the future');
    if (b.date < challenge.startDate) return error(400, 'before_start', 'Date is before the challenge');
    const note = b.note?.trim() ? b.note.trim() : null;
    const cheer: Cheer = {
      id: nextCheerId++,
      fromUserId: ME_ID,
      toUserId: b.toUserId,
      date: b.date,
      emoji: b.emoji,
      note,
      createdAt: new Date().toISOString(),
    };
    cheers.push(cheer);
    return json(201, cheer);
  }
  m = /^\/api\/cheers\/(\d+)$/.exec(path);
  if (method === 'DELETE' && m) {
    const id = Number(m[1]);
    const idx = cheers.findIndex((c) => c.id === id && c.fromUserId === ME_ID);
    if (idx < 0) return error(404, 'not_found', 'No such cheer');
    cheers.splice(idx, 1);
    return json(204, undefined);
  }

  // ---- body metrics ----
  if (method === 'GET' && path.startsWith('/api/metrics')) return json(200, metricsView());
  if (method === 'PUT' && path === '/api/metrics/sharing') {
    const b = parseBody<PutMetricsSharingBody>(body);
    if (!b || typeof b.shared !== 'boolean') return error(400, 'bad_request', 'shared must be a boolean');
    metricsShared.set(ME_ID, b.shared);
    return json(200, metricsView());
  }
  m = /^\/api\/metrics\/([^/?]+)$/.exec(path);
  if (method === 'PUT' && m) {
    const date = decodeURIComponent(m[1] ?? '');
    if (!isValidISODate(date)) return error(400, 'bad_request', 'Malformed date');
    if (date > today) return error(400, 'future_date', 'Date is in the future');
    if (date < challenge.startDate) return error(400, 'before_start', 'Date is before the challenge');
    const b = parseBody<PutMetricsBody>(body);
    if (!b || typeof b !== 'object') return error(400, 'bad_request', 'Invalid JSON');
    const row: MetricRow = metrics.get(mkey(ME_ID, date)) ?? { weightKg: null, waistCm: null };
    if (b.weightKg !== undefined) {
      if (b.weightKg !== null && !(typeof b.weightKg === 'number' && b.weightKg >= 20 && b.weightKg <= 400))
        return error(400, 'bad_request', 'weightKg must be 20–400');
      row.weightKg = b.weightKg;
    }
    if (b.waistCm !== undefined) {
      if (b.waistCm !== null && !(typeof b.waistCm === 'number' && b.waistCm >= 30 && b.waistCm <= 250))
        return error(400, 'bad_request', 'waistCm must be 30–250');
      row.waistCm = b.waistCm;
    }
    if (row.weightKg === null && row.waistCm === null) metrics.delete(mkey(ME_ID, date));
    else metrics.set(mkey(ME_ID, date), row);
    return json(200, metricsView());
  }

  // ---- push ----
  if (method === 'GET' && path === '/api/push/status') {
    const status: PushStatus = {
      enabled: pushEnabled,
      publicKey: pushEnabled ? FAKE_VAPID_PUBLIC : null,
      subscribed: pushSubs.size > 0,
    };
    return json(200, status);
  }
  if (method === 'POST' && path === '/api/push/subscribe') {
    if (!pushEnabled) return error(503, 'push_disabled', 'Push is not configured');
    const b = parseBody<PushSubscriptionBody>(body);
    if (!b || typeof b.endpoint !== 'string' || !b.keys || typeof b.keys.p256dh !== 'string' || typeof b.keys.auth !== 'string')
      return error(400, 'bad_request', 'endpoint and keys required');
    pushSubs.add(b.endpoint);
    return json(201, { ok: true });
  }
  if (method === 'DELETE' && path === '/api/push/subscribe') {
    const b = parseBody<{ endpoint: string }>(body);
    if (!b || typeof b.endpoint !== 'string') return error(400, 'bad_request', 'endpoint required');
    pushSubs.delete(b.endpoint);
    return json(204, undefined);
  }
  if (method === 'POST' && path === '/api/push/test') {
    if (!pushEnabled) return error(503, 'push_disabled', 'Push is not configured');
    console.info(`[${MOCK_MARKER}] push test → "Notifications are on" to ${pushSubs.size} device(s)`);
    return new Response(null, { status: 202 });
  }

  return error(404, 'not_found', `No mock route for ${method} ${path}`);
}

declare global {
  interface Window {
    __hxMock?: {
      marker: string;
      signOut: () => void;
      signIn: () => void;
      reset: () => void;
      setToday: (d: string) => void;
      failNextSave: () => void;
      setPartnerShared: (shared: boolean) => void;
    };
  }
}

let failNext = false;

export function installMockApi(): void {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(url, window.location.origin);
    if (u.origin !== window.location.origin || !u.pathname.startsWith('/api/')) return realFetch(input, init);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : null;
    if (failNext && (method === 'PUT' || method === 'POST')) {
      failNext = false;
      await sleep(350);
      return error(500, 'boom', 'Simulated save failure');
    }
    return handle(method, u.pathname, body);
  };
  window.__hxMock = {
    marker: MOCK_MARKER,
    signOut: () => {
      signedOut = true;
    },
    signIn: () => {
      signedOut = false;
    },
    reset: () => {
      seed();
      signedOut = false;
    },
    setToday: (d: string) => {
      today = d;
    },
    failNextSave: () => {
      failNext = true;
    },
    setPartnerShared: (shared: boolean) => {
      for (const u of users) if (u.id !== ME_ID) metricsShared.set(u.id, shared);
    },
  };
  console.info(`[${MOCK_MARKER}] mock API installed; today=${today}`);
}
