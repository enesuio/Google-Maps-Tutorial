# Hydrox 45 — Accountability App Roadmap

Oct 5, 2026 · @Enes

## Goal & constraints

Ship a usable v1 within the first 2 days, so all 45 days are tracked; everything else gets layered on during the challenge.

- **Users:** two. Her: official Hydrox participant at F45, 3+ classes a week. Him: unofficial, at home, daily walking now and strength training later.
- **Window:** 45 days. Day 1 is Tue Oct 6, 2026; Day 45 is Thu Nov 19, 2026.
- **Core job:** a daily check-in that takes under 30 seconds, and each person's effort visible to the other.
- **Non-goals:** no food-by-food calorie logging (keep using the existing tracker app and enter only the daily total), no public or social features, no native app.
- **Fallback:** if v1 isn't live on Day 1, write Day 1 down on paper and backfill it. Never let the app delay the challenge.

## Motivation design

The app works if it makes showing up visible and noticed; features that don't serve that wait.

- **Shared today screen.** Both people's check-ins on one screen. Seeing the other person's progress does most of the accountability work.
- **Compete on consistency, not outcomes.** You have different bodies, targets and rates of loss, so weight is never ranked or compared. Days checked in and goals hit are the shared scoreboard.
- **One-tap cheers.** A reaction or a short note on the other person's day, with a push notification when one arrives.
- **Forgiving streaks.** A streak survives one missed day and breaks only on two in a row ("never miss twice"). One bad day shouldn't feel like losing everything.
- **Team goal.** A combined 45-day ring (for example, 90 person-days of check-ins) that you fill together.
- **Milestones.** Small moments at Days 7, 15, 30 and 45, plus a Sunday recap of the week.
- **She picks her goals.** Before building, sit down for 10 minutes and let her choose her own 3 to 5 daily goals and what she wants to see. Ownership makes her far more likely to use it.

## Features

v1 is only check-ins and the shared today screen; everything else lands while the challenge is running.

| Feature | Phase | Notes |
| --- | --- | --- |
| Login for 2 users | 1 | Seeded accounts, long-lived session cookie |
| Day counter | 1 | "Day X of 45" on every screen |
| Daily check-in | 1 | 3 to 5 goals per person, yes/no or number, under 30 seconds |
| Shared today screen | 1 | Both people's cards side by side |
| History | 1 | Simple list of past days, editable for backfill |
| Installable PWA | 2 | Add to iPhone home screen |
| Push reminders | 2 | Evening nudge if not checked in; alert when partner checks in |
| Cheers and notes | 2 | One tap plus optional text |
| Forgiving streaks | 2 | Break only on two missed days in a row |
| Weight trend | 2 | 7-day average line, shared between you by default |
| Apple Health import | 3 | iOS Shortcut posts steps and active calories daily |
| Weekly recap | 3 | Sunday summary for both |
| Milestones | 3 | Days 7, 15, 30, 45 |
| Measurements and photos | 3 | Private; Day 1 and Day 45 photos |
| Day 45 summary | 4 | Before/after numbers, totals, best streaks |
| Data export | 4 | JSON/CSV, so the data outlives the challenge |

Seed targets from the nutrition plans: him 1,600 kcal and 160 g protein, her 1,500 kcal and 130 g protein. Calories stay a single daily total typed in from the tracker app.

## Data model

Goals are rows, not columns, so either person can add or change a goal mid-challenge without a migration, and the same schema can later grow into a general habit tracker.

| Table | Key fields | Notes |
| --- | --- | --- |
| users | id, name, timezone, kcal\_target, protein\_target\_g | 2 rows, seeded |
| challenges | id, name, start\_date, length\_days | One row: Hydrox, 2026-10-06, 45 |
| goals | id, user\_id, label, kind (bool / number), unit, daily\_target, weekly\_target, sort, active | Weekly targets cover "3+ F45 classes a week" |
| checkins | user\_id, date, goal\_id, value, updated\_at | Unique on (user\_id, date, goal\_id); upsert on save |
| body\_metrics | user\_id, date, weight\_kg, waist\_cm, shared (bool) | Shared by default; either person can switch theirs to private |
| cheers | id, from\_user, to\_user, date, emoji, note, created\_at | Shown on the receiver's card |
| push\_subscriptions | user\_id, endpoint, p256dh, auth | One per device |
| photos | user\_id, date, path, kind (start / end / progress) | Phase 3, stored on disk, never shared by default |

Store dates as local calendar dates (`date` type) in America/Toronto, not timestamps, so a check-in at 11:50 pm never lands on the wrong day.

## Stack & architecture

Use the stack you already know and host it at home; nothing here should need learning something new on a deadline.

- **API:** Fastify + TypeScript, Kysely or Drizzle for queries, zod for request schemas.
- **Database:** PostgreSQL with plain SQL migrations.
- **Frontend:** Vite + React, mobile-first, served as static files by Fastify. Add a manifest and service worker in Phase 2 to make it an installable PWA.
- **Jobs:** BullMQ + Redis for repeatable jobs: evening reminders, Sunday recap, milestone checks.
- **Push:** Web Push with VAPID keys (`web-push` package). On iPhone, push only works once the PWA is added to the home screen (iOS 16.4+).
- **Hosting:** one LXC or Docker host on the Proxmox box. Expose it through a Cloudflare Tunnel, which avoids port forwarding and works with a dynamic IP.
- **Auth:** two seeded users. A one-time setup link per person sets a 1-year httpOnly session cookie. No passwords, no email.
- **Apple Health (Phase 3):** an iOS Shortcut automation reads steps and active energy each evening and POSTs them to `/api/import` with a per-user token. No native app needed.
- **Backups:** nightly `pg_dump` to a second disk or offsite. 45 days of data is small but irreplaceable.

Request flow: phone (PWA) → Cloudflare Tunnel → Fastify → Postgres, with BullMQ workers sending pushes back to the phones.

## Roadmap

v1 ships by the end of Day 2, features freeze after Day 22, and the last stretch is only the Day 45 summary.

| Phase | Challenge days | Dates | Ships | Done when |
| --- | --- | --- | --- | --- |
| 0. Prep | Before Day 1 | Oct 5 | Goals chosen with her, paper log for Day 1 | Each person has 3 to 5 goals written down |
| 1. v1 | Days 1-2 | Oct 6-7 | Login, check-in, shared today screen, history | Both of you check in from your phones and Day 1 is backfilled |
| 2. Habit loop | Days 3-8 | Oct 8-13 | PWA, push reminders, cheers, streaks, weight trend | A reminder and a cheer arrive as push notifications |
| 3. Delight | Days 9-22 | Oct 14-27 | Health import, weekly recap, milestones, private photos | First Sunday recap sends on its own |
| 4. Finish | Days 23-45 | Oct 28-Nov 19 | Day 45 summary (built by Nov 15), export | Summary reviewed together on Day 45 |

After v1, timebox app work to about an hour a day. The challenge itself, and your own walking, matter more than the app.

## Agent tickets

One ticket per branch and PR, each with acceptance criteria an agent can verify; export this doc to Markdown and keep it in the repo as the spec agents read first.

Work rules for agents: TypeScript strict, every endpoint validated with zod, migrations only append, integration tests against a real Postgres in Docker, no new dependencies without a stated reason.

**Phase 1 (you own T1 and T5; agents can run T2 to T4 in parallel once T1 lands)**

- [x] **T1 Scaffold.** Monorepo (`api`, `web`), Fastify + TS, docker-compose with Postgres and Redis, migration runner, seed script for 2 users, the challenge row and starter goals. Done when `docker compose up` serves `/health` and the seed is idempotent.
- [x] **T2 Auth.** Setup-link endpoint that sets a 1-year httpOnly cookie; middleware that resolves the user. Done when an unauthenticated request gets 401 and a setup link logs in on a phone.
- [x] **T3 Check-in API.** `GET /api/today` (both users' goals, values, day number) and `PUT /api/checkins/:date` (upsert). Done when tests cover upsert, the date boundary at 11:59 pm Toronto time, and editing a past day.
- [x] **T4 Today screen.** Mobile-first: a card per person, tap to toggle, number inputs, "Day X of 45", plus a history list. Done when a full check-in takes under 30 seconds on an iPhone.
- [ ] **T5 Deploy.** LXC on Proxmox, Cloudflare Tunnel, nightly `pg_dump`. Done when it loads on cellular data and a restore from backup has been tested once.

**Phase 2**

- [x] **T6 PWA.** Manifest, icons, service worker. Done when it installs to the iPhone home screen and opens full screen.
- [x] **T7 Push.** Subscription endpoint, VAPID, BullMQ jobs: 9 pm reminder if not checked in, notify partner on check-in. Done when both pushes arrive on an installed PWA.
- [x] **T8 Cheers.** Emoji plus optional note, shown on the receiver's card, triggers a push.
- [x] **T9 Streaks.** Computed from check-ins, breaks only after two missed days in a row. Done when unit tests cover gaps of 1, 2 and 3 days.
- [x] **T10 Weight trend.** Body metrics entry and a 7-day average line, visible to both of you by default.

**Phase 3 and 4**

- [x] **T11 Health import.** `POST /api/import` with a per-user token, plus written steps to build the iOS Shortcut automation.
- [x] **T12 Weekly recap.** Sunday 7 pm job that builds and pushes each person's week.
- [x] **T13 Milestones.** Days 7, 15, 30 and 45, plus the team ring.
- [x] **T14 Photos and measurements.** Upload to disk, private by default.
- [ ] **T15 Day 45 summary.** Start vs end numbers, totals, best streaks, cheers sent.
- [ ] **T16 Export.** JSON and CSV download of all data.

## Risks and open questions

The biggest risk is the app becoming the project instead of the challenge.

| Risk | Mitigation |
| --- | --- |
| App work eats time meant for training and support | v1 in 2 days, then about an hour a day, feature freeze after Day 22 |
| Check-in fatigue | Cap at 5 goals per person; one screen, no required fields |
| Comparison discourages one of you | No weight or outcome rankings, only consistency |
| She stops opening it | Push reminders, cheers, and goals she chose herself |
| Homelab outage or data loss | Nightly backups; paper fallback for any missed day |
| iPhone push doesn't arrive | Must be installed to home screen; test on both phones in Phase 2 |

- [ ] What does her studio's Hydrox challenge actually track or score (for example, InBody scans, before/after photos, class count)? Mirror that in her goals.
- [ ] Which 3 to 5 daily goals does she want? Answer: she has no fixed targets beyond losing fat, so the seed uses consistency goals: F45 class (3 a week), calories at most 1,500 kcal, protein at least 130 g, and a daily push-up/pull-up practice toggle. Finish-line test on Day 45: 3 push-ups and 1 pull-up (she can do neither today); recorded once in the Day 45 summary (T15), not tracked daily. In the app she is "Agnes" (an inside joke; her name is Nur).
- [ ] Does she use an iPhone and an Apple Watch? This decides whether the Health import is worth building for her. Answer: she uses both, so it gets built for both of you.
- [ ] Should weight be private by default or shared between you? Answer: shared.
