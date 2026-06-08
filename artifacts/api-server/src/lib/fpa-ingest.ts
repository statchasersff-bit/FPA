/**
 * Fantasy Points Allowed ingestion pipeline.
 *
 * Pulls weekly player stats from nflverse, computes fantasy points per player,
 * groups them by (season, week, defense, position), and derives per-defense
 * per-position Fantasy Points Allowed (FPA):
 *
 *     raw_fpa = (total fantasy points scored by a position against a defense)
 *               / (games that defense played)
 *
 * Because the 2026 season has not started, the served numbers are a preseason
 * baseline equal to the full 2025 season FPA (100% full-season weight).
 *
 * Once 2026 regular-season games exist, the baseline is blended with live 2026
 * FPA, with the weight on live data increasing as more weeks are played.
 *
 * Results are written to Postgres:
 *   - fantasy_points_allowed_games      (one row per season/week/defense/pos/format)
 *   - fantasy_points_allowed_snapshots  (one row per defense/format, served by the API)
 */

import { db } from "@workspace/db";
import {
  fantasyPointsAllowedGamesTable,
  fantasyPointsAllowedSnapshotsTable,
  type InsertFpaGame,
  type InsertFpaSnapshot,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { logger } from "./logger";
import {
  fetchScoredWeeklyStats,
  FANTASY_POSITIONS,
  SCORING_FORMATS,
  teamName,
  NflverseSeasonUnavailableError,
  type FantasyPosition,
  type ScoringFormat,
  type ScoredPlayerWeek,
} from "./nflverse";

export const DEFAULT_BASELINE_SEASON = Number(
  process.env.FPA_BASELINE_SEASON ?? 2025,
);
export const DEFAULT_CURRENT_SEASON = Number(
  process.env.FPA_CURRENT_SEASON ?? 2026,
);

const ROLLING_WINDOW_WEEKS = 10;
// The preseason baseline mirrors industry "Weeks 1–17" tables (e.g.
// FantasyPros) — Week 18 rests/blowouts are excluded.
const BASELINE_MAX_WEEK = 17;

const round2 = (n: number) => Math.round(n * 100) / 100;

// ─── Per-position FPA table for a set of rows + scoring format ────────────────

interface PositionFpa {
  raw: number; // points allowed per game
  adj: number; // schedule-strength adjusted
}
interface DefenseFpa {
  games: number;
  byPos: Record<FantasyPosition, PositionFpa>;
}
type FpaTable = Map<string, DefenseFpa>; // defense abbr -> fpa

function emptyPosRecord<T>(make: () => T): Record<FantasyPosition, T> {
  return Object.fromEntries(
    FANTASY_POSITIONS.map((p) => [p, make()]),
  ) as Record<FantasyPosition, T>;
}

/**
 * Compute raw and schedule-adjusted FPA for every defense, for one scoring
 * format, from the given scored player-weeks.
 *
 * Adjusted FPA corrects raw FPA for strength of schedule: a defense that faced
 * stronger-than-average offenses has its raw number nudged down, and vice
 * versa. Offense strength is each team's own per-game production at that
 * position (the mirror image of FPA), averaged over the opponents a defense
 * actually faced (repeat opponents counted per meeting).
 */
function computeFpaTable(
  rows: ScoredPlayerWeek[],
  format: ScoringFormat,
): FpaTable {
  // Defense side: points allowed + games played + opponent faced each week.
  const defWeeks = new Map<string, Set<number>>();
  const defTotals = new Map<string, Record<FantasyPosition, number>>();
  const defFacedByWeek = new Map<string, Map<number, string>>(); // D -> week -> offense

  // Offense side: points produced + games played.
  const offWeeks = new Map<string, Set<number>>();
  const offTotals = new Map<string, Record<FantasyPosition, number>>();

  for (const r of rows) {
    const pts = r.points[format];
    const D = r.defenseTeam;
    const O = r.team;

    if (!defWeeks.has(D)) {
      defWeeks.set(D, new Set());
      defTotals.set(D, emptyPosRecord(() => 0));
      defFacedByWeek.set(D, new Map());
    }
    defWeeks.get(D)!.add(r.week);
    defTotals.get(D)![r.position] += pts;
    defFacedByWeek.get(D)!.set(r.week, O);

    if (!offWeeks.has(O)) {
      offWeeks.set(O, new Set());
      offTotals.set(O, emptyPosRecord(() => 0));
    }
    offWeeks.get(O)!.add(r.week);
    offTotals.get(O)![r.position] += pts;
  }

  // Offense per-game production by position.
  const offPpg = new Map<string, Record<FantasyPosition, number>>();
  for (const [O, weeks] of offWeeks) {
    const g = weeks.size || 1;
    const totals = offTotals.get(O)!;
    offPpg.set(
      O,
      emptyPosRecord<number>(() => 0),
    );
    for (const p of FANTASY_POSITIONS) offPpg.get(O)![p] = totals[p] / g;
  }

  // League-average offensive production by position.
  const leagueAvg = emptyPosRecord(() => 0);
  for (const p of FANTASY_POSITIONS) {
    let sum = 0;
    let count = 0;
    for (const O of offPpg.keys()) {
      sum += offPpg.get(O)![p];
      count++;
    }
    leagueAvg[p] = count ? sum / count : 0;
  }

  const table: FpaTable = new Map();
  for (const [D, weeks] of defWeeks) {
    const games = weeks.size || 1;
    const totals = defTotals.get(D)!;
    const faced = [...defFacedByWeek.get(D)!.values()];

    const byPos = emptyPosRecord<PositionFpa>(() => ({ raw: 0, adj: 0 }));
    for (const p of FANTASY_POSITIONS) {
      const raw = totals[p] / games;

      // Average strength of the offenses faced, for this position.
      let sosSum = 0;
      let sosCount = 0;
      for (const off of faced) {
        const ppg = offPpg.get(off);
        if (ppg) {
          sosSum += ppg[p];
          sosCount++;
        }
      }
      const sos = sosCount ? sosSum / sosCount : leagueAvg[p];
      const adj = raw - (sos - leagueAvg[p]);

      byPos[p] = { raw, adj };
    }

    table.set(D, { games, byPos });
  }

  return table;
}

// ─── Window helpers ──────────────────────────────────────────────────────────

function distinctWeeksDesc(rows: ScoredPlayerWeek[]): number[] {
  return [...new Set(rows.map((r) => r.week))].sort((a, b) => b - a);
}

function rowsForWeeks(
  rows: ScoredPlayerWeek[],
  weeks: Set<number>,
): ScoredPlayerWeek[] {
  return rows.filter((r) => weeks.has(r.week));
}

/** Weight placed on live current-season data given how many weeks are played. */
function currentSeasonWeight(weeksPlayed: number): number {
  if (weeksPlayed <= 0) return 0;
  if (weeksPlayed === 1) return 0.25;
  if (weeksPlayed === 2) return 0.4;
  if (weeksPlayed === 3) return 0.6;
  if (weeksPlayed === 4) return 0.8;
  if (weeksPlayed < 12) return Math.min(0.9, 0.8 + (weeksPlayed - 4) * 0.02);
  return 1; // week 12+: rolling current-season window only
}

// ─── Blending ────────────────────────────────────────────────────────────────

interface BlendedDefense {
  abbr: string;
  games: number;
  byPos: Record<FantasyPosition, PositionFpa>;
}

// Preseason baseline = 100% full-season FPA.
function buildPreseasonBaseline(full: FpaTable): Map<string, BlendedDefense> {
  const out = new Map<string, BlendedDefense>();
  for (const [abbr, fullDef] of full) {
    const byPos = emptyPosRecord<PositionFpa>(() => ({ raw: 0, adj: 0 }));
    for (const p of FANTASY_POSITIONS) {
      byPos[p] = { ...fullDef.byPos[p] };
    }
    out.set(abbr, { abbr, games: fullDef.games, byPos });
  }
  return out;
}

function blendWithCurrent(
  baseline: Map<string, BlendedDefense>,
  current: FpaTable,
  weeksPlayed: number,
): Map<string, BlendedDefense> {
  const w = currentSeasonWeight(weeksPlayed);
  const out = new Map<string, BlendedDefense>();
  // Union of defenses across baseline + current.
  const abbrs = new Set<string>([...baseline.keys(), ...current.keys()]);
  for (const abbr of abbrs) {
    const base = baseline.get(abbr);
    const cur = current.get(abbr);
    const byPos = emptyPosRecord<PositionFpa>(() => ({ raw: 0, adj: 0 }));
    for (const p of FANTASY_POSITIONS) {
      const b = base?.byPos[p] ?? cur!.byPos[p];
      const c = cur?.byPos[p] ?? b;
      byPos[p] = {
        raw: (1 - w) * b.raw + w * c.raw,
        adj: (1 - w) * b.adj + w * c.adj,
      };
    }
    out.set(abbr, {
      abbr,
      games: cur?.games ?? base?.games ?? 0,
      byPos,
    });
  }
  return out;
}

// ─── DB row builders ─────────────────────────────────────────────────────────

function buildGamesRows(
  rows: ScoredPlayerWeek[],
  isBaseline: boolean,
): InsertFpaGame[] {
  // (season, week, defense, position, format) -> total points
  const acc = new Map<string, { row: ScoredPlayerWeek; pts: number }>();
  for (const r of rows) {
    for (const format of SCORING_FORMATS) {
      const key = `${r.season}|${r.week}|${r.defenseTeam}|${r.position}|${format}`;
      const existing = acc.get(key);
      if (existing) {
        existing.pts += r.points[format];
      } else {
        acc.set(key, { row: r, pts: r.points[format] });
      }
    }
  }
  const out: InsertFpaGame[] = [];
  for (const [key, { row, pts }] of acc) {
    const format = key.split("|")[4] as ScoringFormat;
    out.push({
      season: row.season,
      week: row.week,
      defenseTeamAbbr: row.defenseTeam,
      offenseTeamAbbr: row.team,
      position: row.position,
      scoringFormat: format,
      fantasyPoints: round2(pts).toString(),
      gamesCount: 1,
      isBaseline,
    });
  }
  return out;
}

function buildSnapshotRows(
  blended: Map<string, BlendedDefense>,
  format: ScoringFormat,
  season: number,
  weekNumber: number | null,
  dataMode: string,
): InsertFpaSnapshot[] {
  const out: InsertFpaSnapshot[] = [];
  for (const def of blended.values()) {
    const raw = def.byPos;
    const offRaw =
      raw.QB.raw + raw.RB.raw + raw.WR.raw + raw.TE.raw;
    const offAdj =
      raw.QB.adj + raw.RB.adj + raw.WR.adj + raw.TE.adj;
    out.push({
      season,
      weekNumber,
      defenseTeamAbbr: def.abbr,
      defenseTeamName: teamName(def.abbr),
      scoringFormat: format,
      // Store full precision; ranks (computed in routes/nfl/fpa.ts) and the
      // display layer (frontend toFixed(1)) consume these. Rounding here would
      // round-then-rank, letting sub-cent differences tie arbitrarily.
      qbFpaRaw: raw.QB.raw.toString(),
      rbFpaRaw: raw.RB.raw.toString(),
      wrFpaRaw: raw.WR.raw.toString(),
      teFpaRaw: raw.TE.raw.toString(),
      offFpaRaw: offRaw.toString(),
      qbFpaAdj: raw.QB.adj.toString(),
      rbFpaAdj: raw.RB.adj.toString(),
      wrFpaAdj: raw.WR.adj.toString(),
      teFpaAdj: raw.TE.adj.toString(),
      offFpaAdj: offAdj.toString(),
      gamesPlayed: def.games,
      dataMode,
    });
  }
  return out;
}

// ─── Public ingest entry point ───────────────────────────────────────────────

export interface IngestResult {
  currentSeason: number;
  baselineSeason: number;
  weekNumber: number | null;
  dataMode: string;
  isPreseason: boolean;
  snapshotRows: number;
  gameRows: number;
}

export interface IngestOptions {
  baselineSeason?: number;
  currentSeason?: number;
}

/**
 * Run the full ingest: fetch nflverse data, compute the baseline (blended with
 * live data if the current season has started), and persist games + snapshots.
 */
export async function ingestFpa(opts: IngestOptions = {}): Promise<IngestResult> {
  const baselineSeason = opts.baselineSeason ?? DEFAULT_BASELINE_SEASON;
  const currentSeason = opts.currentSeason ?? DEFAULT_CURRENT_SEASON;

  logger.info({ baselineSeason, currentSeason }, "FPA ingest started");

  const baselineRows = (await fetchScoredWeeklyStats(baselineSeason)).filter(
    (r) => r.week >= 1 && r.week <= BASELINE_MAX_WEEK,
  );
  if (baselineRows.length === 0) {
    throw new Error(
      `No baseline rows scored for ${baselineSeason}; aborting ingest`,
    );
  }

  // Try the current season; absent (404) or empty means we are in preseason.
  let currentRows: ScoredPlayerWeek[] = [];
  try {
    currentRows = await fetchScoredWeeklyStats(currentSeason);
  } catch (err) {
    if (err instanceof NflverseSeasonUnavailableError) {
      logger.info(
        { currentSeason },
        "current season not yet published — preseason baseline only",
      );
    } else {
      throw err;
    }
  }

  const currentWeeksPlayed = currentRows.length
    ? new Set(currentRows.map((r) => r.week)).size
    : 0;
  const isPreseason = currentWeeksPlayed === 0;

  // ── Blend per format ──
  const snapshotRows: InsertFpaSnapshot[] = [];
  const weekNumber = isPreseason ? null : Math.max(...currentRows.map((r) => r.week));
  const dataMode = isPreseason ? "preseason_baseline" : `week_${weekNumber}`;

  for (const format of SCORING_FORMATS) {
    const full = computeFpaTable(baselineRows, format);
    let blended = buildPreseasonBaseline(full);

    if (!isPreseason) {
      // Week 12+ uses a rolling current-season window only.
      const curWeeks =
        currentWeeksPlayed >= 12
          ? new Set(
              distinctWeeksDesc(currentRows).slice(0, ROLLING_WINDOW_WEEKS),
            )
          : new Set(currentRows.map((r) => r.week));
      const current = computeFpaTable(
        rowsForWeeks(currentRows, curWeeks),
        format,
      );
      blended = blendWithCurrent(blended, current, currentWeeksPlayed);
    }

    snapshotRows.push(
      ...buildSnapshotRows(blended, format, currentSeason, weekNumber, dataMode),
    );
  }

  // ── Games rows (granular grouping) ──
  const gameRows = [
    ...buildGamesRows(baselineRows, true),
    ...buildGamesRows(currentRows, false),
  ];

  // ── Persist (replace existing data for the seasons we touched) ──
  const touchedGameSeasons = [baselineSeason];
  if (currentRows.length) touchedGameSeasons.push(currentSeason);

  await db.transaction(async (tx) => {
    await tx
      .delete(fantasyPointsAllowedSnapshotsTable)
      .where(eq(fantasyPointsAllowedSnapshotsTable.season, currentSeason));
    await tx
      .delete(fantasyPointsAllowedGamesTable)
      .where(inArray(fantasyPointsAllowedGamesTable.season, touchedGameSeasons));

    for (let i = 0; i < gameRows.length; i += 1000) {
      await tx
        .insert(fantasyPointsAllowedGamesTable)
        .values(gameRows.slice(i, i + 1000));
    }
    if (snapshotRows.length) {
      await tx
        .insert(fantasyPointsAllowedSnapshotsTable)
        .values(snapshotRows);
    }
  });

  logger.info(
    {
      currentSeason,
      baselineSeason,
      isPreseason,
      weekNumber,
      snapshots: snapshotRows.length,
      games: gameRows.length,
    },
    "FPA ingest complete",
  );

  return {
    currentSeason,
    baselineSeason,
    weekNumber,
    dataMode,
    isPreseason,
    snapshotRows: snapshotRows.length,
    gameRows: gameRows.length,
  };
}
