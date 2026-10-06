// Dev-only in-memory API, enabled with `VITE_MOCK_API=1 pnpm --filter web dev`.
// Never imported in production builds (see main.tsx).
import type { DayView, GoalView, HistoryDay, HistoryView, PutCheckinsBody, UserDayView } from '../api/types';
import { addDays, daysBetween, isValidISODate, weekdayIndex } from '../lib/dates';
import { computeHit } from '../lib/goals';

const MOCK_MARKER = 'hx-mock-api-v1'; // grep target: must not appear in dist/

const challenge = { name: 'Hydrox 45', startDate: '2026-10-06', lengthDays: 45 };
let today = '2026-10-08';

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
function seed() {
  checkins.clear();
  const set = (u: number, d: string, g: number, v: number) => checkins.set(key(u, d, g), v);
  // Day 1
  set(1, '2026-10-06', 1, 1); set(1, '2026-10-06', 2, 1550); set(1, '2026-10-06', 3, 165);
  set(2, '2026-10-06', 10, 1); set(2, '2026-10-06', 11, 1480); set(2, '2026-10-06', 12, 120);
  // Day 2
  set(1, '2026-10-07', 1, 1); set(1, '2026-10-07', 2, 1700); set(1, '2026-10-07', 3, 150);
  set(2, '2026-10-07', 10, 0); set(2, '2026-10-07', 11, 1450); set(2, '2026-10-07', 12, 135);
  // Day 3 (today): I have started, partner has not checked in yet
  set(1, '2026-10-08', 1, 1);
}
seed();

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
    if (failNext && method === 'PUT') {
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
  };
  console.info(`[${MOCK_MARKER}] mock API installed; today=${today}`);
}
