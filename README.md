# Hydrox 45

A two-person accountability app for a 45-day fitness challenge (Oct 6 – Nov 19, 2026).
One screen, both people's daily check-ins, under 30 seconds a day. No passwords, no social
features, no food logging. Self-hosted on a homelab behind a Cloudflare Tunnel.

The spec lives in [`docs/ROADMAP.md`](docs/ROADMAP.md); the API contract in
[`docs/API.md`](docs/API.md); deployment in [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Stack

| Layer | Choice |
| --- | --- |
| API | Fastify 5 + TypeScript, Kysely over `pg`, zod |
| Database | PostgreSQL 16, plain SQL migrations |
| Web | Vite + React, mobile-first, served by the API in production |
| Jobs (Phase 2) | BullMQ + Redis |
| Push (Phase 2) | Web Push with VAPID |

## Run it locally

```sh
pnpm install
cp .env.example .env            # set SESSION_SECRET to something long and random
docker compose up -d db redis   # or point DATABASE_URL at any Postgres 16
pnpm migrate && pnpm seed
pnpm setup-link enes            # prints a one-time login URL; open it in the browser
pnpm dev                        # api http://localhost:3000, web http://localhost:5173
```

Checks: `pnpm typecheck`, `pnpm test` (API tests need `TEST_DATABASE_URL`, default
`postgres://hydrox:hydrox@localhost:5432/hydrox_test`), `pnpm build`.

## Run it in production

```sh
docker compose up -d --build    # migrates, seeds, serves on :3000
docker compose exec app node api/dist/cli/setup-link.js enes
docker compose exec app node api/dist/cli/setup-link.js agnes
```

Send each person their link. Opening it once on their phone signs them in for a year.

## Repo layout

```
api/          Fastify API, migrations, seed, CLI
web/          React app
docs/         roadmap (spec), API contract, deploy guide
scripts/      backup and restore helpers
```

## Status

| Phase | Tickets | State |
| --- | --- | --- |
| 1. v1 | login, day counter, check-in, shared today screen, history with backfill | built |
| 2. Habit loop | PWA, push reminders, cheers, forgiving streaks, weight trend | built |
| 3. Delight | Apple Health import, weekly recap, milestones and team ring, private photos and measurements | built |
| 4. Finish | Day 45 summary with finish-line tests, JSON/CSV export | built |

T5 (deploy to the homelab) is yours; see `docs/DEPLOY.md`. Apple Health setup: `docs/HEALTH-IMPORT.md`.
