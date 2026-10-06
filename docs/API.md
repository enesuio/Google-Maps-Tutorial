# Hydrox 45 — API contract (v1)

Both packages implement this file exactly. `api` serves it, `web` consumes it.
Change the contract here first, then both sides.

## Conventions

- All dates are local calendar dates in `America/Toronto`, formatted `YYYY-MM-DD`.
  Postgres columns are `date`, never `timestamptz`. "Today" is computed server-side
  in Toronto time; the client never derives the challenge day from its own clock.
- Challenge day = `(date - start_date) + 1`. Day 1 = 2026-10-06. Values below 1 or above
  `lengthDays` are returned as-is; the UI labels them "before the challenge" / "after".
- JSON everywhere. Errors: `{ "error": { "code": string, "message": string } }`.
- Auth: cookie `hx_session` (httpOnly, SameSite=Lax, Secure in production, 1 year).
  Any `/api/*` route without a valid session returns `401 { error: { code: "unauthenticated" } }`.
- Every request body, param and query is validated with zod; invalid input → `400 { code: "bad_request" }`.

## Shared TypeScript types

```ts
export type GoalKind = "bool" | "number";
export type GoalDirection = "at_least" | "at_most";

export interface Challenge {
  name: string;
  startDate: string;     // YYYY-MM-DD
  lengthDays: number;    // 45
}

export interface GoalView {
  id: number;
  key: string;           // stable seed key, e.g. "kcal"
  label: string;         // "Calories"
  kind: GoalKind;
  unit: string | null;   // "kcal", "g", null for bool
  direction: GoalDirection | null; // number goals only
  dailyTarget: number | null;
  weeklyTarget: number | null;     // e.g. 3 for "3+ F45 classes a week"
  value: number | null;  // bool goals: 1 or 0; null = not entered
  hit: boolean | null;   // null when value is null
  weekCount: number | null; // weekly goals only: hits in the Mon–Sun week containing `date`
}

export interface UserDayView {
  id: number;
  slug: string;
  name: string;
  isMe: boolean;
  goals: GoalView[];     // active goals, ordered by sort
}

export interface DayView {
  date: string;          // the day shown
  day: number;           // challenge day number for `date`
  today: string;         // server's Toronto today
  challenge: Challenge;
  users: UserDayView[];  // me first, then partner
}

export interface HistoryDay {
  date: string;
  day: number;
  users: Array<{ userId: number; hit: number; total: number; entered: boolean }>;
}

export interface HistoryView {
  challenge: Challenge;
  today: string;
  users: Array<{ id: number; slug: string; name: string; isMe: boolean }>;
  days: HistoryDay[];    // newest first, from startDate to today only
}

export interface CheckinEntry {
  goalId: number;
  value: number | boolean | null; // null clears the entry; booleans stored as 1/0
}

export interface PutCheckinsBody {
  entries: CheckinEntry[];
}

export interface Me {
  user: { id: number; slug: string; name: string };
}
```

`hit` rules: `bool` → `value === 1`. `number` with `direction = at_most` → `value <= dailyTarget`;
`at_least` → `value >= dailyTarget`; number goal with no target → `value !== null`.

## Endpoints

| Method | Path | Auth | Response |
| --- | --- | --- | --- |
| GET | `/health` | no | `{ ok: true, db: true }` (503 `{ ok:false }` if DB unreachable) |
| GET | `/setup/:token` | no | Consumes a one-time setup token, creates a session, sets cookie, `302 → /`. Invalid or used token → `404` HTML "This link is invalid or already used." |
| POST | `/api/logout` | yes | Deletes session, clears cookie, `204` |
| GET | `/api/me` | yes | `Me` |
| GET | `/api/today` | yes | `DayView` for Toronto today |
| GET | `/api/days/:date` | yes | `DayView` for `date`. 400 if malformed; 400 `future_date` if after today |
| PUT | `/api/checkins/:date` | yes | Upsert the caller's entries for `date`; body `PutCheckinsBody`; returns `DayView` for `date`. 400 `future_date` if after today; 400 `before_start` if before `startDate`; 400 `not_your_goal` if any goalId is not the caller's active goal |
| GET | `/api/history` | yes | `HistoryView`. Optional `?from=YYYY-MM-DD&to=YYYY-MM-DD`, clamped to `[startDate, today]` |

Static: in production Fastify serves `web/dist` at `/` with an SPA fallback (any non-`/api`, non-file path → `index.html`).

## Database (migration `001_init.sql`)

```sql
users(id serial pk, slug text unique, name text, timezone text default 'America/Toronto',
      kcal_target int, protein_target_g int, created_at timestamptz default now())
challenges(id serial pk, name text, start_date date, length_days int)
goals(id serial pk, user_id int fk, key text, label text, kind text check (kind in ('bool','number')),
      unit text, direction text check (direction in ('at_least','at_most')),
      daily_target numeric, weekly_target numeric, sort int default 0, active bool default true,
      unique (user_id, key))
checkins(user_id int fk, date date, goal_id int fk, value numeric not null,
         updated_at timestamptz default now(), primary key (user_id, date, goal_id))
sessions(id text pk, user_id int fk, created_at timestamptz, expires_at timestamptz)
setup_tokens(token text pk, user_id int fk, created_at timestamptz, used_at timestamptz)
```

Migrations are plain `.sql` files in `api/migrations/`, applied in filename order, tracked in
`schema_migrations(name text pk, applied_at)`. Append only; never edit an applied file.

## Seed

`api/seed/seed.json` holds the two users, the challenge and starter goals. The seed upserts users
by `slug`, the challenge by `name`, goals by `(slug, key)`; running it twice changes nothing.

## CLI (run via pnpm from the repo root)

| Command | Does |
| --- | --- |
| `pnpm migrate` | Apply pending migrations |
| `pnpm seed` | Idempotent seed |
| `pnpm setup-link <slug>` | Print a one-time login URL `${APP_ORIGIN}/setup/<token>` for that user |

---

# Phase 2 additions (T6–T10)

Everything above stays as is. Phase 2 adds fields to existing views and new endpoints.
Migration `002_phase2.sql` (append only).

## Schema additions

```sql
ALTER TABLE users ADD COLUMN metrics_shared boolean NOT NULL DEFAULT true;
cheers(id serial pk, from_user int fk, to_user int fk, date date, emoji text, note text,
       created_at timestamptz default now())
  -- index on (to_user, date)
body_metrics(user_id int fk, date date, weight_kg numeric, waist_cm numeric,
             updated_at timestamptz default now(), primary key (user_id, date))
push_subscriptions(id serial pk, user_id int fk, endpoint text unique, p256dh text, auth text,
                   created_at timestamptz default now(), last_error text, failed_at timestamptz)
```

## Streaks (T9)

A day is "checked in" for a user when they entered at least one value that day (same as
`HistoryDay.users[].entered`). Rules ("never miss twice"):

- Walk backwards from the reference day. Today (Toronto) never breaks a streak when it has no
  entries yet; it simply isn't counted until something is entered.
- A single missed day is forgiven: the streak continues through it. Two consecutive missed days
  end the streak.
- `current` = number of checked-in days in the run that reaches the reference day (forgiven days
  are not counted). `best` = the longest such run since `startDate`.
- Nothing before `startDate` counts.

Unit tests must cover gaps of 1, 2 and 3 days, a streak that starts today, and an empty history.

```ts
export interface Streak {
  current: number;
  best: number;
  graceUsed: boolean;   // true when the most recent day before today was missed (one more miss breaks it)
}
```

`UserDayView` gains `streak: Streak` and `totalCheckins: number` (checked-in days since startDate).

## Cheers (T8)

```ts
export interface Cheer {
  id: number;
  fromUserId: number;
  toUserId: number;
  date: string;          // the day the cheer is about
  emoji: string;         // one of the allowed set
  note: string | null;   // ≤ 140 chars
  createdAt: string;     // ISO timestamp
}
export const CHEER_EMOJI = ["👏", "🔥", "💪", "❤️", "😂", "🫡"] as const;
export interface PostCheerBody { toUserId: number; date: string; emoji: string; note?: string }
```

`UserDayView` gains `cheers: Cheer[]` — cheers *received* by that user for `date`, oldest first.

| Method | Path | Response |
| --- | --- | --- |
| POST | `/api/cheers` | `201 Cheer`. 400 `bad_request` if emoji not in set, note > 140, or `toUserId` is the caller; 400 `future_date` / `before_start` per existing rules. Sends a push to the receiver ("Enes cheered your Day 3 👏" + note). |
| DELETE | `/api/cheers/:id` | `204`. Only the sender may delete; otherwise 404. |

## Body metrics (T10)

Weight and waist are never ranked or compared; the UI shows each person's own trend, side by side
only in the sense of two separate charts. Sharing is per user and on by default.

```ts
export interface MetricPoint {
  date: string;
  weightKg: number | null;
  waistCm: number | null;
  weightAvg7: number | null; // mean of the entered weights in the 7 days ending on `date` (inclusive); null when none
}
export interface MetricsSeries {
  userId: number; name: string; isMe: boolean;
  shared: boolean;           // the user's metrics_shared flag
  points: MetricPoint[];     // one per entered date, ascending; partner's series is [] when not shared
  latestWeightKg: number | null;
  startWeightKg: number | null; // earliest entry since startDate
}
export interface MetricsView { challenge: Challenge; today: string; series: MetricsSeries[] }
export interface PutMetricsBody { weightKg?: number | null; waistCm?: number | null } // null clears
export interface PutMetricsSharingBody { shared: boolean }
```

| Method | Path | Response |
| --- | --- | --- |
| GET | `/api/metrics` | `MetricsView`, optional `?from&to` clamped to `[startDate, today]` |
| PUT | `/api/metrics/:date` | Upsert the caller's row; deleting both values removes the row. Returns `MetricsView`. 400 `future_date` / `before_start`. Weight 20–400 kg, waist 30–250 cm. |
| PUT | `/api/metrics/sharing` | Sets `metrics_shared`; returns `MetricsView` |

## Push (T7)

Env: `REDIS_URL`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a `mailto:`). If any
VAPID variable or `REDIS_URL` is missing, push and jobs are disabled, the server logs one warning,
and every other feature keeps working (tests may run this way). CLI `pnpm --filter api gen-vapid`
prints a fresh key pair in `.env` format.

```ts
export interface PushSubscriptionBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
export interface PushStatus { enabled: boolean; publicKey: string | null; subscribed: boolean }
```

| Method | Path | Response |
| --- | --- | --- |
| GET | `/api/push/status` | `PushStatus` (`subscribed` = caller has ≥1 subscription) |
| POST | `/api/push/subscribe` | Upsert by endpoint for the caller, `201 { ok: true }`. 503 `push_disabled` when disabled. |
| DELETE | `/api/push/subscribe` | Body `{ endpoint }`, `204` |
| POST | `/api/push/test` | Sends "Notifications are on" to the caller's devices, `202` |

Notification payload (JSON in the push body):
`{ title: string, body: string, url: string, tag: string }` — `url` is the in-app path to open on
tap (`/`, `/day/<date>`), `tag` dedupes (`reminder-<date>`, `checkin-<userId>-<date>`, `cheer-<id>`).
A 404 or 410 from the push service deletes that subscription.

Jobs (BullMQ, queue `hydrox`):
- `evening-reminder`: repeatable at 21:00 America/Toronto daily. For each user with no entry
  today: "Day X of 45 — nothing logged yet. 30 seconds?"
- `partner-checkin`: enqueued when a `PUT /api/checkins/:date` turns a day from no entries to
  some entries for `date === today`. To the partner: "<Name> checked in for Day X".
- `cheer`: enqueued on `POST /api/cheers`.
The worker runs inside the API process. Every job handler is a pure function `(db, sender) =>`
that tests can call directly with a fake sender; one integration test enqueues a job against the
real Redis at `REDIS_URL` and asserts the fake sender was called.

## PWA (T6)

- `web/public/manifest.webmanifest`: name "Hydrox 45", short_name "Hydrox 45", `display: standalone`,
  `start_url: /`, `scope: /`, theme and background colors matching the app, icons 192 and 512 PNG
  (plus `maskable` 512), `apple-touch-icon` 180 PNG linked from `index.html`,
  `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style: default`.
- `web/public/sw.js`, hand-written (no library): precache nothing at install beyond `/`; network
  first for navigations with a cached `/` fallback; cache-first for hashed `/assets/*`; `push`
  handler shows the payload above; `notificationclick` focuses an open client or opens `url`.
  Registered in production only. A `skipWaiting`/`clients.claim` so updates apply on next open.
- The API serves `/manifest.webmanifest` and `/sw.js` from `web/dist` with the right MIME types
  and `Cache-Control: no-cache` for `sw.js`.
