# Hydrox 45 — notes for agents

Read `docs/ROADMAP.md` (the spec) and `docs/API.md` (the contract) before changing anything.

## Layout

- `api/` — Fastify 5 + TypeScript (ESM), Kysely over `pg`, zod validation, plain SQL migrations in `api/migrations/`, seed in `api/seed/`.
- `web/` — Vite + React + TypeScript, mobile-first, plain CSS. Built output is served by the API in production.
- `docs/` — roadmap, API contract, deploy guide.
- pnpm workspaces. Node 22.

## Work rules (from the roadmap)

- TypeScript `strict` everywhere; no `any` without a comment saying why.
- Every endpoint validates params, query and body with zod.
- Migrations only append. Never edit an applied `.sql` file; add a new one.
- Integration tests run against a real Postgres (`TEST_DATABASE_URL`), not mocks.
- No new dependencies without a one-line reason in the PR or commit message.
- Dates are Toronto calendar dates (`YYYY-MM-DD`), stored as `date`. See `docs/API.md`.
- Mobile first: design for a 390px-wide iPhone screen, then let it grow.

## Commands

```
pnpm install
cp .env.example .env
docker compose up -d db redis     # or any Postgres 16 at DATABASE_URL
pnpm migrate && pnpm seed
pnpm setup-link enes               # prints a one-time login URL
pnpm dev                           # api on :3000, web on :5173 (proxies /api)
pnpm typecheck && pnpm test && pnpm build
```
