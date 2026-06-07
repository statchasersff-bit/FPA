# StatChasers

Fantasy football analytics platform. The FPA (Fantasy Points Allowed) page helps managers find exploitable defensive weaknesses by position.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/statchasers run dev` — run the frontend (dev server)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run ingest-fpa` — ingest FPA from nflverse into Postgres (append `-- --baseline 2025 --current 2026` to override seasons)
- Required env: `DATABASE_URL` — Postgres connection string
- Optional env: `FPA_BASELINE_SEASON` (default 2025), `FPA_CURRENT_SEASON` (default 2026)

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
- `artifacts/api-server/src/lib/nflverse.ts` — nflverse fetch + CSV parse + fantasy scoring (Std/Half/PPR)
- `artifacts/api-server/src/lib/fpa-ingest.ts` — FPA aggregation, baseline blend, Postgres writes
- `artifacts/api-server/src/scripts/ingest-fpa.ts` — ingest CLI
- `artifacts/api-server/src/routes/nfl/fpa.ts` — FPA route handlers + data mode logic
- `artifacts/statchasers/src/` — React frontend

## Architecture decisions

- **Data source is nflverse.** FPA is computed from the weekly player-stats CSV at `github.com/nflverse/nflverse-data/releases/download/player_stats/stats_player_week_<season>.csv`. Fantasy points are computed manually per player-row for all three formats (the CSV's own `fantasy_points`/`fantasy_points_ppr` columns are used only to validate the formula; Half-PPR is computed since it isn't shipped).
- Ingest groups scored rows by (season, week, opponent_team→defense, position) for QB/RB/WR/TE, then `raw_fpa = total points allowed to a position / games the defense played`. Granular rows land in `fantasy_points_allowed_games`; the per-defense/format served numbers land in `fantasy_points_allowed_snapshots`.
- Preseason baseline = `0.70 * full 2025 season FPA + 0.30 * final 8 weeks of 2025`. Once 2026 games exist, the baseline is blended with live 2026 FPA, with the live weight rising by week (wk1 .25 → wk4 .80 → wk12+ rolling 10-week window only).
- Adjusted FPA is a strength-of-schedule correction computed from the same data (a defense's raw FPA minus how much stronger/weaker than league-average the offenses it faced were, per position). Raw FPA is the primary/default view.
- Three scoring formats (standard/half/ppr) are stored as separate snapshot rows.
- Ingest is run via the `ingest-fpa` script (schedule it weekly in-season). As a fallback the API runs a one-time lazy ingest if the snapshots table is empty; concurrent requests share one in-flight ingest.
- CSV download is served directly from the API as `text/csv` — no client-side generation needed.

## Product

- `/nfl/fantasy-points-allowed` — sortable FPA table for all 32 NFL defenses, with Standard/Half-PPR/PPR and Raw/Adjusted toggles, CSV export, rank badges, and methodology note.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- If snapshots are empty, the first API request triggers a lazy nflverse ingest (fetches a ~7MB CSV + computes) — that one request is slow. Prefer running `ingest-fpa` ahead of time.
- nflverse uses `LA` (not `LAR`) for the Rams in `opponent_team`; see `TEAM_NAMES` in `nflverse.ts`. Seasons not yet published return HTTP 404 (`NflverseSeasonUnavailableError`) — handled as "preseason, baseline only".
- After OpenAPI spec changes always run `pnpm --filter @workspace/api-spec run codegen` before touching route or frontend code.
- Drizzle `numeric` columns return strings from the DB — always `parseFloat()` before arithmetic.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
