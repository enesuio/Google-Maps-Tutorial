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
