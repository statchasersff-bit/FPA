# StatChasers

Fantasy football analytics platform. The FPA (Fantasy Points Allowed) page helps managers find exploitable defensive weaknesses by position.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/statchasers run dev` — run the frontend (dev server)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Tailwind CSS + shadcn/ui + wouter
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — API contract source of truth
- `lib/db/src/schema/fantasyPointsAllowed.ts` — FPA DB schema (games + snapshots tables)
- `artifacts/api-server/src/routes/nfl/fpa.ts` — FPA route handlers + seed data + data mode logic
- `artifacts/statchasers/src/` — React frontend

## Architecture decisions

- FPA snapshots are seeded on first request (lazy seed pattern) — no separate migration/seed script needed.
- Three scoring formats (standard/half/ppr) are stored as separate snapshot rows; format adjustment is applied from half-PPR base values during seeding.
- Data mode weighting (preseason vs regular season) is determined server-side based on `weekNumber`; currently returns preseason baseline (70% 2025 full season + 30% final 8 weeks).
- Adjusted FPA uses per-team schedule bias offsets baked into seed data; in production these would be computed from actual schedule matchup data.
- CSV download is served directly from the API as `text/csv` — no client-side generation needed.

## Product

- `/nfl/fantasy-points-allowed` — sortable FPA table for all 32 NFL defenses, with Standard/Half-PPR/PPR and Raw/Adjusted toggles, CSV export, rank badges, and methodology note.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- DB seed runs lazily on first API request — first cold-start request takes ~80ms extra.
- After OpenAPI spec changes always run `pnpm --filter @workspace/api-spec run codegen` before touching route or frontend code.
- Drizzle `numeric` columns return strings from the DB — always `parseFloat()` before arithmetic.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
